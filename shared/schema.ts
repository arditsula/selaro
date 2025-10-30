import { sql } from "drizzle-orm";
import { pgTable, text, varchar, timestamp } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod";

export const users = pgTable("users", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  username: text("username").notNull().unique(),
  password: text("password").notNull(),
});

export const insertUserSchema = createInsertSchema(users).pick({
  username: true,
  password: true,
});

export type InsertUser = z.infer<typeof insertUserSchema>;
export type User = typeof users.$inferSelect;

export const callLogSchema = z.object({
  id: z.string(),
  name: z.string(),
  phone: z.string(),
  service: z.string(),
  preferredTime: z.string(),
  status: z.enum(["New", "Called", "Booked"]),
  createdAt: z.string(),
});

export const insertCallLogSchema = callLogSchema.omit({ id: true, status: true, createdAt: true });

export type CallLog = z.infer<typeof callLogSchema>;
export type InsertCallLog = z.infer<typeof insertCallLogSchema>;

export const appointmentSchema = z.object({
  id: z.string(),
  name: z.string(),
  phone: z.string(),
  service: z.string(),
  date: z.string(),
  time: z.string(),
  notes: z.string().optional(),
  status: z.enum(["Pending", "Confirmed", "Cancelled"]),
  createdAt: z.string(),
});

export const insertAppointmentSchema = appointmentSchema.omit({ id: true, status: true, createdAt: true });

export const updateAppointmentSchema = z.object({
  name: z.string().optional(),
  phone: z.string().optional(),
  status: z.enum(["Pending", "Confirmed", "Cancelled"]).optional(),
  notes: z.string().optional(),
  date: z.string().optional(),
  time: z.string().optional(),
});

export type Appointment = z.infer<typeof appointmentSchema>;
export type InsertAppointment = z.infer<typeof insertAppointmentSchema>;
export type UpdateAppointment = z.infer<typeof updateAppointmentSchema>;

export const knowledgeSchema = z.object({
  content: z.string(),
});

export type Knowledge = z.infer<typeof knowledgeSchema>;

export const chatMessageSchema = z.object({
  id: z.string(),
  role: z.enum(["user", "assistant"]),
  content: z.string(),
  timestamp: z.string(),
});

export const assistantRequestSchema = z.object({
  message: z.string().min(1, "Message cannot be empty"),
});

export type ChatMessage = z.infer<typeof chatMessageSchema>;
export type AssistantRequest = z.infer<typeof assistantRequestSchema>;
