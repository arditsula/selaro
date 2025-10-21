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
