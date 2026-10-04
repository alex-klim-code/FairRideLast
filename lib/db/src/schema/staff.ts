import { pgTable, text, boolean, timestamp, bigserial } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

export const staffPermissionsTable = pgTable("fairride_staff_permissions", {
  userId: text("user_id").primaryKey(),
  role: text("role").notNull(),
  disabled: boolean("disabled").notNull().default(false),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  updatedBy: text("updated_by").notNull(),
});
export const staffAuditTable = pgTable("fairride_staff_audit", {
  id: bigserial("id", { mode: "number" }).primaryKey(),
  userId: text("user_id").notNull(),
  role: text("role").notNull(),
  disabled: boolean("disabled").notNull(),
  changedBy: text("changed_by").notNull(),
  changedAt: timestamp("changed_at", { withTimezone: true }).notNull().defaultNow(),
});
export const insertStaffPermissionSchema = createInsertSchema(staffPermissionsTable).omit({ updatedAt: true });
export type InsertStaffPermission = z.infer<typeof insertStaffPermissionSchema>;
export type StaffPermissionRecord = typeof staffPermissionsTable.$inferSelect;