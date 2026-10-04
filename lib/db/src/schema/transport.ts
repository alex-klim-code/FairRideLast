import { pgTable, text, jsonb } from "drizzle-orm/pg-core";

// Server-owned shared demo aggregate. Mutations use a PostgreSQL row lock.
export const transportStateTable = pgTable("fairride_transport_state", {
  id: text("id").primaryKey(),
  state: jsonb("state").notNull(),
});