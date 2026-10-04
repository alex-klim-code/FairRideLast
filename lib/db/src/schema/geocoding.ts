import { pgTable, text, timestamp, jsonb, integer, index, serial } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

// No raw queries or user identifiers. Short-lived address results are shared by replicas.
export const geocodingCache = pgTable("geocoding_cache", {
  key: text("key").primaryKey(),
  payload: jsonb("payload").notNull(),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
}, table => [index("geocoding_cache_expiry").on(table.expiresAt)]);

export const geocodingGate = pgTable("geocoding_gate", {
  id: integer("id").primaryKey(),
  nextAt: timestamp("next_at", { withTimezone: true }).notNull(),
});

// Aggregate capacity accounting only. Never attach a query, result, session or IP.
export const geocodingUsage = pgTable("geocoding_usage", {
  id: serial("id").primaryKey(),
  requestedAt: timestamp("requested_at", { withTimezone: true }).notNull().defaultNow(),
}, table => [index("geocoding_usage_time").on(table.requestedAt)]);

export const insertGeocodingCacheSchema = createInsertSchema(geocodingCache);
export type InsertGeocodingCache = z.infer<typeof insertGeocodingCacheSchema>;
export const insertGeocodingGateSchema = createInsertSchema(geocodingGate);
export type InsertGeocodingGate = z.infer<typeof insertGeocodingGateSchema>;
export const insertGeocodingUsageSchema = createInsertSchema(geocodingUsage).omit({ id: true });
export type InsertGeocodingUsage = z.infer<typeof insertGeocodingUsageSchema>;