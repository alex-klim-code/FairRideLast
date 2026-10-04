import { clerkClient } from "@clerk/express";
import { pool } from "@workspace/db";
import { TransportError, type DemoActor, type DemoRole } from "./transport-domain";

export interface StaffPermission { userId: string; role: DemoRole; disabled: boolean; updatedAt: string }
let ready: Promise<void> | undefined;
export function initializePermissions() {
  return ready ??= pool.query(`CREATE TABLE IF NOT EXISTS fairride_staff_permissions (
    user_id text PRIMARY KEY, role text NOT NULL CHECK (role IN ('USER','CONDUCTOR','ADMIN')),
    disabled boolean NOT NULL DEFAULT false, updated_at timestamptz NOT NULL DEFAULT now(),
    updated_by text NOT NULL
  );
  CREATE TABLE IF NOT EXISTS fairride_staff_audit (
    id bigserial PRIMARY KEY, user_id text NOT NULL, role text NOT NULL,
    disabled boolean NOT NULL, changed_by text NOT NULL, changed_at timestamptz NOT NULL DEFAULT now()
  )`).then(() => undefined).catch(error => { ready = undefined; throw error; });
}

export function permissionActor(userId: string, permission?: { role: DemoRole; disabled: boolean }): DemoActor {
  if (permission?.disabled) throw new TransportError(403, "This account's transport access has been suspended.");
  // Clerk IDs, not emails or browser IDs, own history across sign-out and reload.
  return { id: `clerk:${userId}`, role: permission?.role ?? "USER" };
}

export async function assertVerifiedUser(userId: string) {
  const user = await clerkClient.users.getUser(userId);
  const email = user.emailAddresses.find(e => e.id === user.primaryEmailAddressId);
  if (user.banned || user.locked || email?.verification?.status !== "verified") {
    throw new TransportError(403, "An active account with a verified primary email is required.");
  }
}

export async function currentPermissionActor(userId: string) {
  await initializePermissions();
  const result = await pool.query("SELECT role, disabled FROM fairride_staff_permissions WHERE user_id=$1", [userId]);
  return permissionActor(userId, result.rows[0]);
}

export async function listPermissions(): Promise<StaffPermission[]> {
  await initializePermissions();
  const result = await pool.query('SELECT user_id AS "userId", role, disabled, updated_at AS "updatedAt" FROM fairride_staff_permissions ORDER BY user_id');
  return result.rows.map(row => ({ ...row, updatedAt: row.updatedAt.toISOString() }));
}

// Also used by an operator-run CLI. There is deliberately no public bootstrap API.
export async function savePermission(changedBy: string, userId: string, role: DemoRole, disabled: boolean, bootstrap = false): Promise<StaffPermission> {
  if (!/^user_[A-Za-z0-9]+$/.test(userId)) throw new TransportError(400, "Enter an existing Clerk user ID.");
  await assertVerifiedUser(userId);
  await initializePermissions();
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    // Serialize provisioning, including two concurrent attempts to demote admins.
    await client.query("SELECT pg_advisory_xact_lock(740181)");
    const rows = await client.query("SELECT user_id, role, disabled FROM fairride_staff_permissions");
    const admins = rows.rows.filter(p => p.role === "ADMIN" && !p.disabled);
    if (bootstrap) {
      if (admins.length) throw new TransportError(409, "An Admin already exists. Use the signed-in Admin permissions page.");
    } else {
      const caller = rows.rows.find(p => `clerk:${p.user_id}` === changedBy);
      if (!caller || caller.role !== "ADMIN" || caller.disabled) throw new TransportError(403, "Verified Admin access required.");
    }
    if (admins.length === 1 && admins[0].user_id === userId && (role !== "ADMIN" || disabled)) {
      throw new TransportError(409, "Assign another active Admin before removing the last Admin.");
    }
    await client.query(`INSERT INTO fairride_staff_permissions(user_id,role,disabled,updated_by)
      VALUES ($1,$2,$3,$4) ON CONFLICT(user_id) DO UPDATE SET
      role=excluded.role,disabled=excluded.disabled,updated_by=excluded.updated_by,updated_at=now()`, [userId, role, disabled, changedBy]);
    await client.query("INSERT INTO fairride_staff_audit(user_id,role,disabled,changed_by) VALUES ($1,$2,$3,$4)", [userId, role, disabled, changedBy]);
    const result = await client.query('SELECT user_id AS "userId", role, disabled, updated_at AS "updatedAt" FROM fairride_staff_permissions WHERE user_id=$1', [userId]);
    await client.query("COMMIT");
    return { ...result.rows[0], updatedAt: result.rows[0].updatedAt.toISOString() };
  } catch (error) { await client.query("ROLLBACK"); throw error; }
  finally { client.release(); }
}