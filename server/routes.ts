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
          // critical: keep session stable per call
          "x-client-id": req.body.CallSid || req.headers["x-twilio-callsid"] || "anon"
        },
        body: JSON.stringify({ message: SpeechResult })
      });
      
      const assistantData = await assistantResponse.json();
      const reply = assistantData.reply || "Entschuldigung, ich habe das nicht verstanden.";
      
      const sid = req.body.CallSid || "anon";
      const lastId = getLastAppointmentId(sid);
      let haveName = false, havePhone = false;
      
      if (lastId) {
        try {
          const appt = await storage.getAppointment(lastId);
          haveName = !!(appt?.name && appt.name.trim());
          havePhone = !!(appt?.phone && appt.phone.trim());
        } catch {}
      }
      
      if (haveName && havePhone) {
        const twiml = `<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Say language="de-DE" voice="Polly.Marlene">${reply}</Say>
  <Say language="de-DE" voice="Polly.Marlene">Vielen Dank für Ihren Anruf. Auf Wiederhören!</Say>
  <Hangup/>
</Response>`;
        res.set('Content-Type', 'text/xml');
        return res.send(twiml);
      }
      
      let promptNext = reply;
      if (!haveName && havePhone) {
        promptNext = reply + " Könnten Sie mir bitte noch Ihren vollständigen Namen sagen?";
      }
      if (haveName && !havePhone) {
        promptNext = reply + " Könnten Sie mir bitte noch eine Rückrufnummer geben?";
      }
      
      const twiml = `<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Say language="de-DE" voice="Polly.Marlene">${promptNext}</Say>
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
    const bookingKeywords = ["termin", "vereinbaren", "buchen", "möchte", "kommen", "um", "uhr"];
    return bookingKeywords.some(keyword => lowerMessage.includes(keyword));
  }

  function formatDateToYYYYMMDD(date: Date): string {
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const day = String(date.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
  }

  function extractDate(message: string): string | null {
    const lowerMessage = message.toLowerCase();
    const today = new Date();
    
    if (lowerMessage.includes("heute")) {
      return formatDateToYYYYMMDD(today);
    }
    
    if (lowerMessage.includes("morgen")) {
      const tomorrow = new Date(today);
      tomorrow.setDate(tomorrow.getDate() + 1);
      return formatDateToYYYYMMDD(tomorrow);
    }
    
    const weekdayMap: Record<string, number> = {
      "montag": 1,
      "dienstag": 2,
      "mittwoch": 3,
      "donnerstag": 4,
      "freitag": 5,
      "samstag": 6,
      "sonntag": 0
    };
    
    for (const [dayName, targetDay] of Object.entries(weekdayMap)) {
      if (lowerMessage.includes(dayName)) {
        const currentDay = today.getDay();
        let daysToAdd = targetDay - currentDay;
        if (daysToAdd <= 0) {
          daysToAdd += 7;
        }
        const targetDate = new Date(today);
        targetDate.setDate(targetDate.getDate() + daysToAdd);
        return formatDateToYYYYMMDD(targetDate);
      }
    }
    
    return null;
  }

  function extractTime(message: string): string | null {
    const timePatternWithColon = /(\d{1,2})[.:](\d{2})/;
    const timePatternWithUhr = /(\d{1,2})\s*uhr/i;
    
    let match = message.match(timePatternWithColon);
    if (match) {
      const hours = match[1].padStart(2, '0');
      const minutes = match[2];
      return `${hours}:${minutes}`;
    }
    
    match = message.match(timePatternWithUhr);
    if (match) {
      const hours = match[1].padStart(2, '0');
      return `${hours}:00`;
    }
    
    return null;
  }

  function extractName(message: string): string | null {
    const lowerMessage = message.toLowerCase();
    
    const namePatterns = [
      /(?:ich\s+hei(?:ß|ss)e|mein\s+name\s+ist)\s+([a-zäöüß]+(?:\s+[a-zäöüß]+)*)/i,
      /^([A-ZÄÖÜ][a-zäöüß]+(?:\s+[A-ZÄÖÜ][a-zäöüß]+)+)$/
    ];
    
    for (const pattern of namePatterns) {
      const match = message.match(pattern);
      if (match && match[1]) {
        return match[1].trim();
      }
    }
    
    return null;
  }

  function extractPhone(message: string): string | null {
    const phonePatterns = [
      /(?:meine\s+(?:nummer|telefonnummer)\s+(?:ist|lautet))\s*([\d\s\-\/+()]+)/i,
      /\b((?:\+49|0)\s*\d{2,4}[\s\-\/]?\d{3,}[\s\-\/]?\d{3,})\b/
    ];
    
    for (const pattern of phonePatterns) {
      const match = message.match(pattern);
      if (match && match[1]) {
        return match[1].trim();
      }
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
      
      const nameMatch = validatedData.message.match(/(?:ich\s*hei(?:ße|sse)|mein\s+name\s+ist)\s+([a-zäöüß \-']{2,})/i);
      const phoneMatch = validatedData.message.match(/(?:meine\s+nummer\s+ist|rückrufnummer(?:\s*ist)?)\s*([+0-9][0-9 ()\-]{6,})/i);
      
      if (nameMatch || phoneMatch) {
        const lastId = getLastAppointmentId(sid);
        
        if (lastId) {
          if (nameMatch) {
            const fullName = nameMatch[1].trim();
            await storage.updateAppointment(lastId, { name: fullName });
            return res.json({ ok: true, reply: "Danke! Ich habe Ihren Namen zum Termin hinzugefügt." });
          }
          
          if (phoneMatch) {
            const raw = phoneMatch[1];
            const digits = raw.replace(/[^\d+]/g, "");
            await storage.updateAppointment(lastId, { phone: digits });
            return res.json({ ok: true, reply: "Perfekt! Ich habe Ihre Rückrufnummer gespeichert." });
          }
        }
      }
      
      const hasBookingIntent = detectBookingIntent(validatedData.message);
      
      if (hasBookingIntent) {
        const extractedDate = extractDate(validatedData.message);
        const extractedTime = extractTime(validatedData.message);
        
        if (extractedDate && extractedTime) {
          try {
            const appointmentData = {
              name: "Unbekannt",
              phone: "",
              service: "Allgemeine Behandlung",
              date: extractedDate,
              time: extractedTime,
              notes: "Created automatically via chat",
              status: "Pending"
            };
            
            const appointment = await storage.createAppointment(appointmentData);
            setLastAppointmentId(sid, appointment.id);
            
            const [year, month, day] = extractedDate.split('-');
            const formattedDate = `${day}.${month}.${year}`;
            
            const reply = `Super! Ich habe einen vorläufigen Termin für ${formattedDate} um ${extractedTime} eingetragen. Unser Team wird ihn in Kürze bestätigen. 😊`;
            return res.json({ ok: true, reply });
          } catch (appointmentError) {
            console.error("Failed to create appointment:", appointmentError);
            const reply = "Entschuldigung, ich konnte den Termin nicht erstellen. Bitte versuchen Sie es später erneut.";
            return res.json({ ok: true, reply });
          }
        } else {
          const reply = "Verstanden! Für welche Uhrzeit und welches Datum soll ich den Termin eintragen?";
          return res.json({ ok: true, reply });
        }
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

      const systemPrompt = "You are a friendly AI receptionist for a dental clinic. Use the knowledge provided by the clinic to answer accurately, warmly, and briefly.";
      
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

        const reply = completion.choices[0].message.content || "I apologize, but I couldn't generate a response. Please try again.";
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
