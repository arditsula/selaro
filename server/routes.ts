import type { Express } from "express";
import { createServer, type Server } from "http";
import { storage } from "./storage";
import { insertCallLogSchema, insertAppointmentSchema, updateAppointmentSchema, knowledgeSchema, assistantRequestSchema } from "@shared/schema";
import * as fs from "fs";
import * as path from "path";
import OpenAI from "openai";

const sessionAppointments = new Map<string, string>();

function setLastAppointmentId(clientId: string, appointmentId: string): void {
  sessionAppointments.set(clientId, appointmentId);
}

function getLastAppointmentId(clientId: string): string | undefined {
  return sessionAppointments.get(clientId);
}

async function sendSms(to: string, body: string): Promise<void> {
  const accountSid = process.env.TWILIO_ACCOUNT_SID;
  const authToken = process.env.TWILIO_AUTH_TOKEN;
  const fromNumber = process.env.TWILIO_FROM;

  if (!accountSid || !authToken || !fromNumber) {
    return;
  }

  try {
    const auth = Buffer.from(`${accountSid}:${authToken}`).toString('base64');
    const response = await fetch(
      `https://api.twilio.com/2010-04-01/Accounts/${accountSid}/Messages.json`,
      {
        method: 'POST',
        headers: {
          'Authorization': `Basic ${auth}`,
          'Content-Type': 'application/x-www-form-urlencoded',
        },
        body: new URLSearchParams({
          To: to,
          From: fromNumber,
          Body: body,
        }),
      }
    );

    if (!response.ok) {
      console.error('Failed to send SMS:', await response.text());
    }
  } catch (error) {
    console.error('SMS send error:', error);
  }
}

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
        error: error instanceof Error ? error.message : "Validation failed" 
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
        error: error instanceof Error ? error.message : "Failed to fetch calls" 
      });
    }
  });

  app.post("/api/twilio/voice", async (req, res) => {
    try {
      const { From, CallSid, SpeechResult } = req.body;
      
      if (!SpeechResult) {
        const twiml = `<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Say language="de-DE" voice="Polly.Marlene">Willkommen in unserer Zahnarztpraxis. Wie kann ich Ihnen helfen?</Say>
  <Gather input="speech" language="de-DE" speechTimeout="auto" action="/api/twilio/voice" method="POST" />
</Response>`;
        res.set('Content-Type', 'text/xml');
        return res.send(twiml);
      }
      
      const assistantResponse = await fetch("http://localhost:5000/api/assistant", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-client-id": req.body.CallSid || req.headers["x-twilio-callsid"] || "anon"
        },
        body: JSON.stringify({ message: SpeechResult })
      });
      
      const assistantData = await assistantResponse.json();
      let reply = assistantData.reply || "Entschuldigung, ich habe das nicht verstanden.";
      
      reply = reply.replace("__COMPLETE__", "").trim();
      
      const sid = req.body.CallSid || "anon";
      const lastId = getLastAppointmentId(sid);
      
      let needName = true;
      let needPhone = true;
      let needDT = true;
      let needService = true;
      
      if (lastId) {
        try {
          const appt = await storage.getAppointment(lastId);
          needName = !(appt?.name && appt.name.trim());
          needPhone = !(appt?.phone && appt.phone.trim());
          needDT = !(appt?.datetime && appt.datetime.trim());
          needService = !(appt?.service && appt.service.trim() && appt.service !== "Allgemeine Behandlung");
        } catch {}
      }
      
      if (!needName && !needPhone && !needDT && !needService) {
        if (lastId) {
          try {
            const appt = await storage.getAppointment(lastId);
            if (appt?.phone && appt?.datetime) {
              const dt = new Date(appt.datetime);
              const formattedDate = `${dt.getDate().toString().padStart(2, '0')}.${(dt.getMonth() + 1).toString().padStart(2, '0')}.${dt.getFullYear()}`;
              const formattedTime = `${dt.getHours().toString().padStart(2, '0')}:${dt.getMinutes().toString().padStart(2, '0')}`;
              const smsBody = `Ihr Termin ist vorgemerkt für ${formattedDate} ${formattedTime}. Wir melden uns zur Bestätigung.`;
              await sendSms(appt.phone, smsBody);
            }
          } catch (error) {
            console.error('Error sending SMS:', error);
          }
        }
        
        const twiml = `<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Say language="de-DE" voice="Polly.Marlene">${reply}</Say>
  <Say language="de-DE" voice="Polly.Marlene">Vielen Dank für Ihren Anruf. Auf Wiederhören!</Say>
  <Hangup/>
</Response>`;
        res.set('Content-Type', 'text/xml');
        return res.send(twiml);
      }
      
      if (needName) {
        reply += " Könnten Sie mir bitte noch Ihren vollständigen Namen sagen?";
      } else if (needPhone) {
        reply += " Könnten Sie mir bitte noch eine Rückrufnummer geben?";
      } else if (needDT) {
        reply += " Für welches Datum und welche Uhrzeit wünschen Sie den Termin?";
      } else if (needService) {
        reply += " Welchen Service wünschen Sie (z. B. Zahnreinigung, Füllung, Implantat)?";
      }
      
      const twiml = `<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Say language="de-DE" voice="Polly.Marlene">${reply}</Say>
  <Gather input="speech" language="de-DE" speechTimeout="auto" action="/api/twilio/voice" method="POST" />
</Response>`;
      res.set('Content-Type', 'text/xml');
      res.send(twiml);
    } catch (error) {
      console.error('Twilio webhook error:', error);
      const errorTwiml = `<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Say language="de-DE" voice="Polly.Marlene">Entschuldigung, bitte wiederholen Sie das.</Say>
  <Gather input="speech" language="de-DE" speechTimeout="auto" action="/api/twilio/voice" method="POST" />
</Response>`;
      res.set('Content-Type', 'text/xml');
      res.send(errorTwiml);
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
        error: error instanceof Error ? error.message : "Failed to fetch appointments" 
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
        error: error instanceof Error ? error.message : "Validation failed" 
      });
    }
  });

  app.patch("/api/appointments/:id", async (req, res) => {
    try {
      const { id } = req.params;
      const validatedData = updateAppointmentSchema.parse(req.body);
      const appointment = await storage.updateAppointment(id, validatedData);
      
      if (!appointment) {
        return res.status(404).json({ ok: false, error: "Appointment not found" });
      }
      
      res.json({ ok: true, appointment });
    } catch (error) {
      res.status(400).json({ 
        ok: false, 
        error: error instanceof Error ? error.message : "Validation failed" 
      });
    }
  });

  app.delete("/api/appointments/:id", async (req, res) => {
    try {
      const { id } = req.params;
      const deleted = await storage.deleteAppointment(id);
      
      if (!deleted) {
        return res.status(404).json({ ok: false, error: "Appointment not found" });
      }
      
      res.json({ ok: true });
    } catch (error) {
      res.status(500).json({ 
        ok: false, 
        error: error instanceof Error ? error.message : "Failed to delete appointment" 
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
        error: error instanceof Error ? error.message : "Failed to fetch knowledge" 
      });
    }
  });

  app.post("/api/knowledge", async (req, res) => {
    try {
      const validatedData = knowledgeSchema.parse(req.body);
      
      try {
        fs.writeFileSync(knowledgeFilePath, JSON.stringify(validatedData, null, 2), "utf-8");
        res.json({ ok: true });
      } catch (fsError) {
        res.status(500).json({ 
          ok: false, 
          error: fsError instanceof Error ? fsError.message : "Failed to save knowledge" 
        });
      }
    } catch (validationError) {
      res.status(400).json({ 
        ok: false, 
        error: validationError instanceof Error ? validationError.message : "Validation failed" 
      });
    }
  });

  // This is using OpenAI's API with your own API key
  const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

  function detectBookingIntent(message: string): boolean {
    const lowerMessage = message.toLowerCase();
    const bookingKeywords = ["termin", "vereinbaren", "buchen", "möchte", "kommen", "heute", "morgen", "montag", "dienstag", "mittwoch", "donnerstag", "freitag", "samstag", "sonntag"];
    return bookingKeywords.some(keyword => lowerMessage.includes(keyword));
  }

  function detectService(message: string): string | null {
    const lowerMessage = message.toLowerCase();
    const serviceMap: Record<string, string[]> = {
      "Zahnreinigung": ["prophylaxe", "zahnreinigung", "reinigung"],
      "Füllung": ["füllung", "loch", "karies"],
      "Schmerz/Notfall": ["notfall", "schmerzen", "akut"],
      "Implantat": ["implantat", "implantate"],
      "Krone/Brücke": ["krone", "brücke"],
      "Wurzelbehandlung": ["wurzel", "wurzelbehandlung"]
    };
    
    for (const [service, keywords] of Object.entries(serviceMap)) {
      if (keywords.some(keyword => lowerMessage.includes(keyword))) {
        return service;
      }
    }
    
    return null;
  }

  function parseOfficeHours(knowledgeText: string): { startHour: number; endHour: number; workDays: number[] } {
    const defaultHours = { startHour: 8, endHour: 19, workDays: [1, 2, 3, 4, 5] };
    
    const hoursMatch = knowledgeText.match(/(\d{1,2})\s*(?:am|:00)?\s*(?:to|bis|-|–)\s*(\d{1,2})\s*(?:pm|:00)?/i);
    if (hoursMatch) {
      let start = parseInt(hoursMatch[1], 10);
      let end = parseInt(hoursMatch[2], 10);
      
      if (hoursMatch[0].toLowerCase().includes('pm') && end < 12) end += 12;
      if (hoursMatch[0].toLowerCase().includes('am') && start === 12) start = 0;
      
      if (start >= 0 && start <= 23 && end >= 0 && end <= 23 && end > start) {
        return { ...defaultHours, startHour: start, endHour: end };
      }
    }
    
    return defaultHours;
  }

  function isWithinOfficeHours(datetimeStr: string, knowledgeText: string): boolean {
    const dt = new Date(datetimeStr);
    const dayOfWeek = dt.getDay();
    const hours = dt.getHours();
    
    const officeHours = parseOfficeHours(knowledgeText);
    
    if (!officeHours.workDays.includes(dayOfWeek)) {
      return false;
    }
    
    if (hours < officeHours.startHour || hours >= officeHours.endHour) {
      return false;
    }
    
    return true;
  }

  function parseExplicitDateTime(message: string): { date: string | null; time: string | null; datetime: string | null } {
    const today = new Date();
    let parsedDate: string | null = null;
    let parsedTime: string | null = null;
    
    const dateRe = /\b(?:am\s*)?(\d{1,2})[.\-/](\d{1,2})(?:[.\-/](\d{2,4}))?\b/i;
    const dateMatch = message.match(dateRe);
    if (dateMatch) {
      const day = parseInt(dateMatch[1], 10);
      const month = parseInt(dateMatch[2], 10);
      let year = dateMatch[3] ? parseInt(dateMatch[3], 10) : today.getFullYear();
      
      if (dateMatch[3] && year < 100) {
        year += 2000;
      }
      
      if (day >= 1 && day <= 31 && month >= 1 && month <= 12) {
        const paddedMonth = String(month).padStart(2, '0');
        const paddedDay = String(day).padStart(2, '0');
        parsedDate = `${year}-${paddedMonth}-${paddedDay}`;
      }
    }
    
    const timeRe = /\bum\s*(\d{1,2})[:.](\d{2})\b|\b(\d{1,2})\s*uhr\b/i;
    const timeMatch = message.match(timeRe);
    if (timeMatch) {
      let hour: number;
      let minute: number;
      
      if (timeMatch[1] !== undefined) {
        hour = parseInt(timeMatch[1], 10);
        minute = parseInt(timeMatch[2], 10);
      } else {
        hour = parseInt(timeMatch[3], 10);
        minute = 0;
      }
      
      if (hour >= 0 && hour <= 23 && minute >= 0 && minute <= 59) {
        parsedTime = `${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}`;
      }
    }
    
    const datetime = (parsedDate && parsedTime) ? `${parsedDate}T${parsedTime}` : null;
    
    return { date: parsedDate, time: parsedTime, datetime };
  }

  function parseDatetime(message: string): string | null {
    const lower = message.toLowerCase();
    const today = new Date();
    
    let targetDate: Date | null = null;
    let timeStr = "";
    
    if (lower.includes("heute")) {
      targetDate = today;
    } else if (lower.includes("morgen")) {
      targetDate = new Date(today);
      targetDate.setDate(targetDate.getDate() + 1);
    } else {
      const weekdayMap: Record<string, number> = {
        "montag": 1, "dienstag": 2, "mittwoch": 3,
        "donnerstag": 4, "freitag": 5, "samstag": 6, "sonntag": 0
      };
      
      for (const [dayName, targetDay] of Object.entries(weekdayMap)) {
        if (lower.includes(dayName)) {
          const currentDay = today.getDay();
          let daysToAdd = targetDay - currentDay;
          if (daysToAdd <= 0) daysToAdd += 7;
          targetDate = new Date(today);
          targetDate.setDate(targetDate.getDate() + daysToAdd);
          break;
        }
      }
    }
    
    const timeMatch = message.match(/(?:um\s+)?(\d{1,2})[:.:](\d{2})/);
    if (timeMatch) {
      const hour = parseInt(timeMatch[1], 10);
      const minute = parseInt(timeMatch[2], 10);
      if (hour >= 0 && hour <= 23 && minute >= 0 && minute <= 59) {
        timeStr = `${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}`;
      }
    } else {
      const uhrMatch = message.match(/(?:um\s+)?(\d{1,2})\s*uhr/i);
      if (uhrMatch) {
        const hour = parseInt(uhrMatch[1], 10);
        if (hour >= 0 && hour <= 23) {
          timeStr = `${String(hour).padStart(2, '0')}:00`;
        }
      }
    }
    
    if (targetDate && timeStr) {
      const year = targetDate.getFullYear();
      const month = String(targetDate.getMonth() + 1).padStart(2, '0');
      const day = String(targetDate.getDate()).padStart(2, '0');
      return `${year}-${month}-${day}T${timeStr}`;
    }
    
    return null;
  }

  app.post("/api/assistant", async (req, res) => {
    try {
      const validatedData = assistantRequestSchema.parse(req.body);

      if (!process.env.OPENAI_API_KEY) {
        return res.status(503).json({
          ok: false,
          error: "OpenAI API key not configured"
        });
      }

      const sid = (req.headers["x-client-id"] as string) || "anon";
      
      const hasBookingIntent = detectBookingIntent(validatedData.message);
      let appointmentId = getLastAppointmentId(sid);
      
      if (hasBookingIntent && !appointmentId) {
        const pendingAppt = await storage.createAppointment({
          name: "",
          phone: "",
          service: "Allgemeine Behandlung",
          datetime: "",
          notes: "Created via voice"
        });
        appointmentId = pendingAppt.id;
        setLastAppointmentId(sid, appointmentId);
      }
      
      let clinicKnowledge = "";
      if (fs.existsSync(knowledgeFilePath)) {
        try {
          const data = fs.readFileSync(knowledgeFilePath, "utf-8");
          const knowledge = JSON.parse(data);
          clinicKnowledge = knowledge.content || "";
        } catch (error) {
          console.error("Failed to read knowledge file:", error);
        }
      }

      const nameMatch = validatedData.message.match(/(?:ich\s*hei(?:ße|sse)|mein\s+name\s+ist)\s+([a-zäöüß \-']{2,})/i);
      const phoneMatch = validatedData.message.match(/(?:meine\s+nummer\s+ist|rückrufnummer(?:\s*ist)?)\s*([+0-9][0-9 ()\-]{6,})/i);
      
      const explicitParsed = parseExplicitDateTime(validatedData.message);
      const relativeParsed = parseDatetime(validatedData.message);
      
      const datetimeStr = explicitParsed.datetime || relativeParsed;
      const detectedService = detectService(validatedData.message);
      
      if (appointmentId && (nameMatch || phoneMatch || datetimeStr || explicitParsed.date || explicitParsed.time || detectedService)) {
        let reply = "";
        
        if (nameMatch) {
          const fullName = nameMatch[1].trim();
          await storage.updateAppointment(appointmentId, { name: fullName });
          reply = "Danke! Ich habe Ihren Namen zum Termin hinzugefügt.";
        } else if (phoneMatch) {
          const raw = phoneMatch[1];
          const digits = raw.replace(/[^\d+]/g, "");
          await storage.updateAppointment(appointmentId, { phone: digits });
          reply = "Perfekt! Ich habe Ihre Rückrufnummer gespeichert.";
        } else if (detectedService) {
          await storage.updateAppointment(appointmentId, { service: detectedService });
          reply = `Verstanden, ich habe "${detectedService}" notiert.`;
        } else if (datetimeStr) {
          if (!isWithinOfficeHours(datetimeStr, clinicKnowledge)) {
            reply = "Leider ist die Praxis dann geschlossen. Passt Ihnen ein Termin zwischen 08:00 und 19:00 Uhr (Mo–Fr)?";
            return res.json({ ok: true, reply });
          }
          await storage.updateAppointment(appointmentId, { datetime: datetimeStr });
          const dt = new Date(datetimeStr);
          const formattedDate = `${dt.getDate()}.${dt.getMonth() + 1}.${dt.getFullYear()}`;
          const formattedTime = datetimeStr.split('T')[1];
          reply = `Super! Ich habe den Termin für ${formattedDate} um ${formattedTime} Uhr notiert.`;
        } else if (explicitParsed.date && !explicitParsed.time) {
          reply = "Verstanden. Um wie viel Uhr passt es Ihnen?";
          return res.json({ ok: true, reply });
        } else if (explicitParsed.time && !explicitParsed.date) {
          reply = "Gerne. Für welches Datum wünschen Sie den Termin?";
          return res.json({ ok: true, reply });
        }
        
        const appt = await storage.getAppointment(appointmentId);
        const hasName = !!(appt?.name && appt.name.trim());
        const hasPhone = !!(appt?.phone && appt.phone.trim());
        const hasDatetime = !!(appt?.datetime && appt.datetime.trim());
        const hasService = !!(appt?.service && appt.service.trim() && appt.service !== "Allgemeine Behandlung");
        
        if (hasName && hasPhone && hasDatetime && hasService) {
          reply += " __COMPLETE__";
        }
        
        return res.json({ ok: true, reply });
      }

      const systemPrompt = "You are a friendly AI receptionist for a dental clinic. Use the knowledge provided by the clinic to answer accurately, warmly, and briefly in German.";
      
      const userMessage = clinicKnowledge 
        ? `Clinic Info: ${clinicKnowledge}\n\nPatient question: ${validatedData.message}`
        : validatedData.message;

      try {
        const completion = await openai.chat.completions.create({
          model: "gpt-4o-mini",
          messages: [
            { role: "system", content: systemPrompt },
            { role: "user", content: userMessage }
          ],
          temperature: 0.7,
          max_tokens: 300,
        });

        const reply = completion.choices[0].message.content || "Entschuldigung, ich konnte keine Antwort generieren.";
        res.json({ ok: true, reply });
      } catch (openaiError) {
        console.error("OpenAI API error:", openaiError);
        res.status(500).json({
          ok: false,
          error: "Failed to generate AI response. Please try again."
        });
      }
    } catch (validationError) {
      res.status(400).json({ 
        ok: false, 
        error: validationError instanceof Error ? validationError.message : "Validation failed" 
      });
    }
  });

  const httpServer = createServer(app);

  return httpServer;
}
