import type { Express } from "express";
import { createServer, type Server } from "http";
import { storage } from "./storage";
import {
  insertCallLogSchema,
  insertAppointmentSchema,
  updateAppointmentSchema,
  knowledgeSchema,
  assistantRequestSchema,
} from "@shared/schema";
import * as fs from "fs";
import * as path from "path";
import OpenAI from "openai";

// 🧠 memory (session chat + last appointment id)
import {
  getSession,
  pushToSession,
  setLastAppointmentId,
  getLastAppointmentId,
} from "./memory";

export async function registerRoutes(app: Express): Promise<Server> {
  app.post("/api/calls/log", async (req, res) => {
    try {
      const validatedData = insertCallLogSchema.parse(req.body);
      const saved = await storage.createCallLog(validatedData);
      const count = (await storage.getAllCallLogs()).length;

      res.json({ ok: true, saved, count });
    } catch (error) {
      res.status(400).json({
        ok: false,
        error: error instanceof Error ? error.message : "Validation failed",
      });
    }
  });

  app.get("/api/calls/all", async (_req, res) => {
    try {
      const rows = await storage.getAllCallLogs();
      res.json({ ok: true, rows });
    } catch (error) {
      res.status(500).json({
        ok: false,
        error: error instanceof Error ? error.message : "Failed to fetch calls",
      });
    }
  });

  app.post("/api/twilio/voice", async (req, res) => {
    try {
      const { From, To, CallSid, SpeechResult } = req.body;

      const callData = {
        name: SpeechResult || "Unknown",
        phone: From || "Unknown",
        service: "Phone inquiry",
        preferredTime: "Call back ASAP",
      };

      await storage.createCallLog(callData);

      const twiml = `<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Say language="de-DE" voice="Polly.Marlene">Danke! Wir melden uns bald zurück.</Say>
</Response>`;

      res.set("Content-Type", "text/xml");
      res.send(twiml);
    } catch (error) {
      console.error("Twilio webhook error:", error);
      const errorTwiml = `<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Say language="de-DE" voice="Polly.Marlene">Es tut uns leid, ein Fehler ist aufgetreten.</Say>
</Response>`;
      res.set("Content-Type", "text/xml");
      res.status(500).send(errorTwiml);
    }
  });

  app.get("/api/health", (_req, res) => {
    res.json({ ok: true });
  });

  app.get("/api/appointments", async (_req, res) => {
    try {
      const appointments = await storage.getAllAppointments();
      res.json({ ok: true, appointments });
    } catch (error) {
      res.status(500).json({
        ok: false,
        error:
          error instanceof Error
            ? error.message
            : "Failed to fetch appointments",
      });
    }
  });

  app.post("/api/appointments", async (req, res) => {
    try {
      const validatedData = insertAppointmentSchema.parse(req.body);
      const appointment = await storage.createAppointment(validatedData);
      res.json({ ok: true, appointment });
    } catch (error) {
      res.status(400).json({
        ok: false,
        error: error instanceof Error ? error.message : "Validation failed",
      });
    }
  });

  app.patch("/api/appointments/:id", async (req, res) => {
    try {
      const { id } = req.params;
      const validatedData = updateAppointmentSchema.parse(req.body);
      const appointment = await storage.updateAppointment(id, validatedData);

      if (!appointment) {
        return res
          .status(404)
          .json({ ok: false, error: "Appointment not found" });
      }

      res.json({ ok: true, appointment });
    } catch (error) {
      res.status(400).json({
        ok: false,
        error: error instanceof Error ? error.message : "Validation failed",
      });
    }
  });

  app.delete("/api/appointments/:id", async (req, res) => {
    try {
      const { id } = req.params;
      const deleted = await storage.deleteAppointment(id);

      if (!deleted) {
        return res
          .status(404)
          .json({ ok: false, error: "Appointment not found" });
      }

      res.json({ ok: true });
    } catch (error) {
      res.status(500).json({
        ok: false,
        error:
          error instanceof Error
            ? error.message
            : "Failed to delete appointment",
      });
    }
  });

  const knowledgeFilePath = path.join(process.cwd(), "knowledge.json");

  app.get("/api/knowledge", async (_req, res) => {
    try {
      if (fs.existsSync(knowledgeFilePath)) {
        const data = fs.readFileSync(knowledgeFilePath, "utf-8");
        const knowledge = JSON.parse(data);
        res.json({ ok: true, content: knowledge.content || "" });
      } else {
        res.json({ ok: true, content: "" });
      }
    } catch (error) {
      res.status(500).json({
        ok: false,
        error:
          error instanceof Error ? error.message : "Failed to fetch knowledge",
      });
    }
  });

  app.post("/api/knowledge", async (req, res) => {
    try {
      const validatedData = knowledgeSchema.parse(req.body);

      try {
        fs.writeFileSync(
          knowledgeFilePath,
          JSON.stringify(validatedData, null, 2),
          "utf-8",
        );
        res.json({ ok: true });
      } catch (fsError) {
        res.status(500).json({
          ok: false,
          error:
            fsError instanceof Error
              ? fsError.message
              : "Failed to save knowledge",
        });
      }
    } catch (validationError) {
      res.status(400).json({
        ok: false,
        error:
          validationError instanceof Error
            ? validationError.message
            : "Validation failed",
      });
    }
  });

  // --- OpenAI client ---
  const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

  // --- Helpers për intent/parse datë/orë (DE) ---
  function detectBookingIntent(message: string): boolean {
    const lowerMessage = message.toLowerCase();
    const bookingKeywords = [
      "termin",
      "vereinbaren",
      "buchen",
      "möchte",
      "kommen",
      "um",
      "uhr",
    ];
    return bookingKeywords.some((k) => lowerMessage.includes(k));
  }
  function formatDateToYYYYMMDD(date: Date): string {
    const y = date.getFullYear();
    const m = String(date.getMonth() + 1).padStart(2, "0");
    const d = String(date.getDate()).padStart(2, "0");
    return `${y}-${m}-${d}`;
  }
  function extractDate(message: string): string | null {
    const t = message.toLowerCase();
    const today = new Date();

    if (t.includes("heute")) return formatDateToYYYYMMDD(today);
    if (t.includes("morgen")) {
      const d = new Date(today);
      d.setDate(d.getDate() + 1);
      return formatDateToYYYYMMDD(d);
    }
    const weekdayMap: Record<string, number> = {
      montag: 1,
      dienstag: 2,
      mittwoch: 3,
      donnerstag: 4,
      freitag: 5,
      samstag: 6,
      sonntag: 0,
    };
    for (const [name, target] of Object.entries(weekdayMap)) {
      if (t.includes(name)) {
        const cur = today.getDay();
        let add = target - cur;
        if (add <= 0) add += 7;
        const d = new Date(today);
        d.setDate(d.getDate() + add);
        return formatDateToYYYYMMDD(d);
      }
    }
    // 23.10.2025 ose 23.10.
    const dmy = t.match(/(\d{1,2})[.](\d{1,2})(?:[.](\d{2,4}))?/);
    if (dmy) {
      const dd = parseInt(dmy[1], 10);
      const mm = parseInt(dmy[2], 10) - 1;
      const yyyy = dmy[3]
        ? parseInt(dmy[3], 10) < 100
          ? 2000 + parseInt(dmy[3], 10)
          : parseInt(dmy[3], 10)
        : today.getFullYear();
      const d = new Date(yyyy, mm, dd);
      return formatDateToYYYYMMDD(d);
    }
    return null;
  }
  function extractTime(message: string): string | null {
    const t1 = message.match(/(\d{1,2})[.:](\d{2})/);
    if (t1) {
      const h = t1[1].padStart(2, "0");
      const m = t1[2];
      return `${h}:${m}`;
    }
    const t2 = message.match(/(\d{1,2})\s*uhr/i);
    if (t2) {
      const h = t2[1].padStart(2, "0");
      return `${h}:00`;
    }
    return null;
  }

  // --- Helpers për session id + emër/telefon ---
  function getSessionId(req: any) {
    return (
      (req.headers["x-client-id"] as string) ||
      (req.headers["x-session-id"] as string) ||
      req.ip ||
      "anon"
    );
  }
  function extractName(message: string): string | null {
    const m =
      message.match(/\bich heiße\b\s+([a-zA-ZÀ-ÿ'’\-\s]{2,60})/i) ||
      message.match(/\bmein name ist\b\s+([a-zA-ZÀ-ÿ'’\-\s]{2,60})/i) ||
      message.match(/\bname\b[:\-]?\s*([a-zA-ZÀ-ÿ'’\-\s]{2,60})/i);
    return m?.[1]?.trim() || null;
  }
  function extractPhone(message: string): string | null {
    const m = message.match(/(\+?\d[\d\s\/\-\(\)]{6,})/);
    return m?.[1]?.replace(/[^\d+]/g, "").trim() || null;
  }

  // --- Assistant me persona "Lina", memorie, booking ---
  app.post("/api/assistant", async (req, res) => {
    try {
      const validatedData = assistantRequestSchema.parse(req.body);
      const userText = validatedData.message;

      if (!process.env.OPENAI_API_KEY) {
        return res
          .status(503)
          .json({ ok: false, error: "OpenAI API key not configured" });
      }

      // Session & memory
      const sid = getSessionId(req);
      const history = getSession(sid);

      // Knowledge (truncate për prompt)
      let clinicKnowledge = "";
      if (fs.existsSync(knowledgeFilePath)) {
        try {
          const data = fs.readFileSync(knowledgeFilePath, "utf-8");
          const knowledge = JSON.parse(data);
          clinicKnowledge = (knowledge.content || "").toString();
          if (clinicKnowledge.length > 6000)
            clinicKnowledge = clinicKnowledge.slice(0, 6000);
        } catch (e) {
          console.error("Failed to read knowledge file:", e);
        }
      }

      // --- Nëse kemi appointment të fundit dhe përdoruesi jep emër/telefon → PATCH ---
      const pendingId = getLastAppointmentId(sid);
      if (pendingId) {
        const name = extractName(userText);
        const phone = extractPhone(userText);

        if (name || phone) {
          const patch: any = {};
          if (name) patch.name = name;
          if (phone) patch.phone = phone;

          try {
            await storage.updateAppointment(pendingId, patch);
            const reply =
              name && phone
                ? `Vielen Dank, ${name}! Ich habe die Nummer ${phone} notiert. Unser Team bestätigt Ihren Termin in Kürze.`
                : name
                  ? `Danke, ${name}! Könnten Sie mir bitte auch eine Rückrufnummer geben?`
                  : `Danke! Ich habe die Nummer ${phone} notiert. Darf ich bitte noch Ihren vollständigen Namen haben?`;

            pushToSession(sid, { role: "user", content: userText });
            pushToSession(sid, { role: "assistant", content: reply });
            return res.json({ ok: true, reply });
          } catch (e) {
            console.error("PATCH appointment failed:", e);
            // vazhdo poshtë
          }
        }
      }

      // Intent & parse
      const hasBooking = detectBookingIntent(userText);
      const date = extractDate(userText);
      const time = extractTime(userText);

      // Krijo appointment kur kemi datë+orë
      if (hasBooking && date && time) {
        try {
          const created = await storage.createAppointment({
            name: "Unbekannt",
            phone: "",
            service: "Allgemeine Behandlung",
            date,
            time,
            notes: "Created automatically via chat",
            status: "Pending",
          });

          const apptId =
            (created && (created as any).id) ||
            (created as any)?.appointment?.id;
          if (apptId) setLastAppointmentId(sid, apptId);

          const [y, m, d] = date.split("-");
          const niceDate = `${d}.${m}.${y}`;
          const reply = `Super! Ich habe einen vorläufigen Termin für ${niceDate} um ${time} eingetragen. Darf ich bitte Ihren vollständigen Namen und eine Rückrufnummer haben?`;

          pushToSession(sid, { role: "user", content: userText });
          pushToSession(sid, { role: "assistant", content: reply });
          return res.json({ ok: true, reply });
        } catch (e) {
          console.error("Failed to create appointment:", e);
          const reply =
            "Entschuldigung, ich konnte den Termin nicht erstellen. Bitte versuchen Sie es später erneut.";
          return res.json({ ok: true, reply });
        }
      }

      // Nëse mungon një nga data/ora, kërko veç pjesën që mungon
      if (hasBooking && (!date || !time)) {
        const ask =
          !date && !time
            ? "Gerne! Für welchen Tag und um welche Uhrzeit passt es Ihnen?"
            : !date
              ? "Gerne! Für welches Datum möchten Sie den Termin?"
              : "Gerne! Welche Uhrzeit passt Ihnen?";

        pushToSession(sid, { role: "user", content: userText });
        pushToSession(sid, { role: "assistant", content: ask });
        return res.json({ ok: true, reply: ask });
      }

      // Persona: Lina
      const systemPrompt = `
Du bist "Lina", eine warme und professionelle Empfangsmitarbeiterin einer Zahnarztpraxis.
Antworte kurz, freundlich und klar. Nutze Praxis-Infos nur wenn relevant.
Wenn die Frage nicht in den Infos steht, antworte höflich knapp und biete an, dass das Team zurückruft.
Praxis-Infos (Kontext):
${clinicKnowledge}
`.trim();

      const messages = [
        { role: "system" as const, content: systemPrompt },
        ...history,
        { role: "user" as const, content: userText },
      ];

      const completion = await openai.chat.completions.create({
        model: "gpt-4o-mini",
        temperature: 0.3,
        max_tokens: 250,
        messages,
      });

      const reply =
        completion.choices?.[0]?.message?.content?.trim() ||
        "Ich bin da – könnten Sie das bitte anders formulieren?";

      pushToSession(sid, { role: "user", content: userText });
      pushToSession(sid, { role: "assistant", content: reply });
      return res.json({ ok: true, reply });
    } catch (validationError) {
      return res.status(400).json({
        ok: false,
        error:
          validationError instanceof Error
            ? validationError.message
            : "Validation failed",
      });
    }
  });

  const httpServer = createServer(app);
  return httpServer;
}
