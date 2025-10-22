import type { Express } from "express";
import { createServer, type Server } from "http";
import { storage } from "./storage";
import { insertCallLogSchema, insertAppointmentSchema, updateAppointmentSchema } from "@shared/schema";

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
      const { From, To, CallSid, SpeechResult } = req.body;
      
      const callData = {
        name: SpeechResult || "Unknown",
        phone: From || "Unknown",
        service: "Phone inquiry",
        preferredTime: "Call back ASAP"
      };
      
      await storage.createCallLog(callData);
      
      const twiml = `<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Say language="de-DE" voice="Polly.Marlene">Danke! Wir melden uns bald zurück.</Say>
</Response>`;
      
      res.set('Content-Type', 'text/xml');
      res.send(twiml);
    } catch (error) {
      console.error('Twilio webhook error:', error);
      const errorTwiml = `<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Say language="de-DE" voice="Polly.Marlene">Es tut uns leid, ein Fehler ist aufgetreten.</Say>
</Response>`;
      res.set('Content-Type', 'text/xml');
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

  const httpServer = createServer(app);

  return httpServer;
}
