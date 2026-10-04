import { pool } from "@workspace/db";
import { mockTransport } from "./transport-providers";
import type { DemoActor, TransportState } from "./transport-domain";
import { TransportError, syncTransportFleet } from "./transport-domain";
import { transportSnapshot } from "./transport-feed-service";
import { permissionActor } from "./staff-permissions";

let ready: Promise<void> | undefined;
function initialize() {
  return ready ??= (async () => {
    // Separate aggregate for the explicit shared demo. A row lock makes
    // check-in vs inspection atomic across tabs, processes and deployments.
    await pool.query("CREATE TABLE IF NOT EXISTS fairride_transport_state (id text PRIMARY KEY, state jsonb NOT NULL)");
    const initial: TransportState = { version: 1, vehicles: structuredClone(mockTransport.vehicles), inspections: [], checkIns: [], updatedAt: new Date(0).toISOString() };
    await pool.query("INSERT INTO fairride_transport_state(id,state) VALUES ('demo',$1::jsonb) ON CONFLICT DO NOTHING", [JSON.stringify(initial)]);
  })().catch(error => { ready = undefined; throw error; });
}
export async function transportTransaction<T>(operation: (state: TransportState) => T, write = true): Promise<T> {
  return transportTransactionFor("verified", operation, write);
}
export async function transportTransactionFor<T>(mode: "demo" | "verified", operation: (state: TransportState, currentActor?: DemoActor) => T, write = true, actor?: DemoActor): Promise<T> {
  // Fetch before acquiring the DB row lock; network outages must not hold
  // up another conductor ending an inspection or a passenger checking out.
  const snapshot = mode === "demo" ? {
    vehicles: structuredClone(mockTransport.vehicles), catalog: mockTransport.catalog(), generatedAt: Date.now(),
  } : await transportSnapshot();
  await initialize();
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    let currentActor = actor;
    if (mode === "verified" && actor) {
      // A grant/revocation cannot commit between this authorization check and
      // the fleet mutation. Re-read after the potentially slow feed download.
      await client.query("SELECT pg_advisory_xact_lock_shared(740181)");
      const userId = actor.id.slice("clerk:".length);
      const permission = await client.query("SELECT role, disabled FROM fairride_staff_permissions WHERE user_id=$1", [userId]);
      currentActor = permissionActor(userId, permission.rows[0]);
    }
    // New aggregates intentionally do not import legacy public-role history.
    const id = mode === "demo" ? "sandbox" : "verified";
    const initial: TransportState = { version: 1, vehicles: [], inspections: [], checkIns: [], updatedAt: new Date(0).toISOString() };
    await client.query("INSERT INTO fairride_transport_state(id,state) VALUES ($1,$2::jsonb) ON CONFLICT DO NOTHING", [id, JSON.stringify(initial)]);
    const result = await client.query("SELECT state FROM fairride_transport_state WHERE id=$1 FOR UPDATE", [id]);
    const state = result.rows[0]?.state as TransportState | undefined;
    if (!state || state.version !== 1 || !Array.isArray(state.vehicles) || !Array.isArray(state.inspections) || !Array.isArray(state.checkIns)) {
      throw new TransportError(503, "Stored fleet data is unavailable. No inspection or check-in was changed.");
    }
    syncTransportFleet(state, snapshot.vehicles, snapshot.catalog.lines, snapshot.generatedAt);
    const value = operation(state, currentActor);
    // Reads also persist synchronized fleet state while holding the row lock.
    // `write` only indicates the caller's intent; feed reconciliation is a write.
    await client.query("UPDATE fairride_transport_state SET state=$1::jsonb WHERE id=$2", [JSON.stringify(state), id]);
    await client.query("COMMIT");
    return value;
  } catch (error) { await client.query("ROLLBACK"); throw error; }
  finally { client.release(); }
}