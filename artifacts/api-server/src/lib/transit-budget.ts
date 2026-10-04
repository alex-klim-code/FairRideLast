import { randomUUID } from "node:crypto";
import { pool } from "@workspace/db";
import { TransitError } from "./google-transit";

export const DAILY_TRANSIT_LIMIT = 500;
export const PASSENGER_TRANSIT_LIMIT = 12;
const DAY_MS = 86_400_000;
const MINUTE_MS = 60_000;
// Longer than Google's existing 12s request timeout. Crashed workers cannot
// permanently occupy a slot; releasing a slot never refunds a paid attempt.
const LEASE_MS = 60_000;
const DB_TIMEOUT_MS = 3000;
type Lease = { token: string; expiresAt: number };
type Passenger = { id: string; expiresAt: number; count: number };

export class TransitBudgetError extends TransitError {
  constructor(status: number, message: string, public retryAfter: number) {
    super(status, message);
  }
}

const unavailable = () => new TransitBudgetError(503,
  "Ochrona limitu zapytań jest chwilowo niedostępna. Nie wysłano zapytania do Google. Spróbuj później.", 60);

// Bound pool acquisition too, not just SQL. A late connection must be returned.
async function connect(database: typeof pool) {
  let timedOut = false;
  let timer: ReturnType<typeof setTimeout>;
  const pending = database.connect().then(client => {
    if (timedOut) { client.release(); throw unavailable(); }
    return client;
  });
  try {
    return await Promise.race([pending, new Promise<never>((_, reject) => {
      timer = setTimeout(() => { timedOut = true; reject(unavailable()); }, DB_TIMEOUT_MS);
    })]);
  } finally { clearTimeout(timer!); }
}

export function createTransitBudgetGate(database = pool, id = "google-routes") {
  return {
    async reserve(passengerId: string): Promise<{ token: string; usable: () => boolean }> {
      // Reject raw addresses and missing identities rather than creating an
      // unprotected/global fallback bucket. All callers must provide an HMAC.
      if (!/^[a-f0-9]{64}$/.test(passengerId ?? "")) throw unavailable();
      const started = performance.now();
      const client = await connect(database).catch(() => { throw unavailable(); });
      const query = (text: string, values?: unknown[]) => {
        const config = { text, values, query_timeout: DB_TIMEOUT_MS };
        return client.query(config);
      };
      try {
        await query("BEGIN");
        await query("SET LOCAL statement_timeout = '3s'");
        await query("SET LOCAL lock_timeout = '3s'");
        await query(`INSERT INTO transit_budget (id, day_start, minute_start)
          VALUES ($1, clock_timestamp(), clock_timestamp()) ON CONFLICT (id) DO NOTHING`, [id]);
        // Serialize every reservation, including simultaneous initialization,
        // across all processes. Use DB time AFTER waiting for the row lock.
        const locked = await query("SELECT * FROM transit_budget WHERE id=$1 FOR UPDATE", [id]);
        const clock = await query("SELECT clock_timestamp() AS now");
        const now = new Date(clock.rows[0].now).getTime();
        const row = locked.rows[0];
        let dayStart = new Date(row.day_start).getTime();
        let minuteStart = new Date(row.minute_start).getTime();
        let daily: number = row.daily;
        let minute: number = row.minute;
        if (now - dayStart >= DAY_MS) { dayStart = now; daily = 0; }
        if (now - minuteStart >= MINUTE_MS) { minuteStart = now; minute = 0; }
        const leases: Lease[] = row.leases.filter((lease: Lease) => lease.expiresAt > now);
        const passengers: Passenger[] = row.passengers.filter((passenger: Passenger) => passenger.expiresAt > now);
        const passenger = passengers.find(entry => entry.id === passengerId);
        if (passenger && passenger.count >= PASSENGER_TRANSIT_LIMIT) {
          throw new TransitBudgetError(429, "Zbyt wiele zapytań o trasę. Odczekaj minutę.",
            Math.max(1, Math.ceil((passenger.expiresAt - now) / 1000)));
        }
        if (daily >= DAILY_TRANSIT_LIMIT) {
          throw new TransitBudgetError(429,
            "Osiągnięto dzienny limit 500 zapytań w tej wersji demo. Spróbuj po odnowieniu limitu.",
            Math.max(1, Math.ceil((dayStart + DAY_MS - now) / 1000)));
        }
        if (minute >= 30 || leases.length >= 4) {
          throw new TransitBudgetError(429, "Zbyt wiele zapytań o trasę. Odczekaj minutę.", 60);
        }
        const token = randomUUID();
        leases.push({ token, expiresAt: now + LEASE_MS });
        if (passenger) passenger.count++;
        else passengers.push({ id: passengerId, count: 1, expiresAt: now + MINUTE_MS });
        await query(`UPDATE transit_budget SET day_start=$2, daily=$3,
          minute_start=$4, minute=$5, leases=$6::jsonb, passengers=$7::jsonb WHERE id=$1`,
          [id, new Date(dayStart), daily + 1, new Date(minuteStart), minute + 1,
            JSON.stringify(leases), JSON.stringify(passengers)]);
        // Never invoke Google before COMMIT has been acknowledged. An ambiguous
        // commit consumes capacity conservatively, but cannot trigger a paid call.
        await query("COMMIT");
        client.release();
        return { token, usable: () => performance.now() - started < LEASE_MS - 15_000 };
      } catch (error) {
        // Destroying the connection rolls back any still-open transaction,
        // including SQL timeouts. Never expose raw database errors or secrets.
        client.release(true);
        if (error instanceof TransitBudgetError) throw error;
        throw unavailable();
      }
    },
    async release(token: string): Promise<void> {
      const client = await connect(database);
      try {
        const config = {
          text: `UPDATE transit_budget SET leases=COALESCE(
            (SELECT jsonb_agg(lease) FROM jsonb_array_elements(leases) AS lease
             WHERE lease->>'token' <> $2), '[]'::jsonb) WHERE id=$1`,
          values: [id, token], query_timeout: DB_TIMEOUT_MS,
        };
        await client.query(config);
        client.release();
      } catch {
        client.release(true);
        throw unavailable();
      }
    },
  };
}

export const transitBudgetGate = createTransitBudgetGate();