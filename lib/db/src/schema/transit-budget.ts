import { pgTable, text, timestamp, jsonb, integer } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

// Aggregate counters, HMAC peer pseudonyms and expiring concurrency tokens.
export const transitBudget = pgTable("transit_budget", {
  id: text("id").primaryKey(),
  dayStart: timestamp("day_start", { withTimezone: true }).notNull(),
  daily: integer("daily").notNull().default(0),
  minuteStart: timestamp("minute_start", { withTimezone: true }).notNull(),
  minute: integer("minute").notNull().default(0),
  leases: jsonb("leases").$type<{ token: string; expiresAt: number }[]>().notNull().default([]),
  passengers: jsonb("passengers").$type<{ id: string; expiresAt: number; count: number }[]>().notNull().default([]),
});

export const insertTransitBudgetSchema = createInsertSchema(transitBudget);
export type InsertTransitBudget = z.infer<typeof insertTransitBudgetSchema>;
export type TransitBudget = typeof transitBudget.$inferSelect;