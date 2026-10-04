import { createHmac, randomUUID, timingSafeEqual } from "node:crypto";
import type { Request, Response } from "express";
import { clerkClient, getAuth } from "@clerk/express";
import { TransportError, type DemoActor, type DemoRole } from "./transport-domain";
import { assertVerifiedUser, currentPermissionActor } from "./staff-permissions";

const cookieName = "fairride_demo_role";
interface Envelope { browserId: string; role: DemoRole | null; expires: number }
const secret = () => {
  if (!process.env.SESSION_SECRET) throw new TransportError(503, "Demo session service is unavailable.");
  return process.env.SESSION_SECRET;
};
const signature = (text: string) => createHmac("sha256", secret()).update(`fairride-transport-demo:${text}`).digest("base64url");
export function readDemoEnvelope(req: Request): Envelope | null {
  const value = req.headers.cookie?.split(";").map(c => c.trim()).find(c => c.startsWith(`${cookieName}=`))?.slice(cookieName.length + 1);
  if (!value || value.length > 1500) return null;
  const [text, sig, extra] = value.split(".");
  if (!text || !sig || extra) return null;
  const expected = Buffer.from(signature(text)), received = Buffer.from(sig);
  if (expected.length !== received.length || !timingSafeEqual(expected, received)) return null;
  try {
    const envelope = JSON.parse(Buffer.from(text, "base64url").toString()) as Envelope;
    if (!/^[a-f0-9-]{36}$/.test(envelope.browserId) || !Number.isFinite(envelope.expires) || envelope.expires < Date.now() ||
      (envelope.role !== null && !["USER", "CONDUCTOR", "ADMIN"].includes(envelope.role))) return null;
    return envelope;
  } catch { return null; }
}
export function transportMode(req: Request): "demo" | "verified" {
  const mode = req.get("X-FairRide-Mode");
  if (mode && mode !== "demo" && mode !== "verified") throw new TransportError(400, "Unknown transport mode.");
  return mode === "demo" ? "demo" : "verified";
}
export async function verifiedActorFor(req: Request): Promise<DemoActor> {
  const { userId, sessionId } = getAuth(req);
  if (!userId || !sessionId) throw new TransportError(401, "Sign in with a verified account to use live transport.");
  // Do not trust long-lived JWT role claims or a still-valid token after revocation.
  const session = await clerkClient.sessions.getSession(sessionId);
  if (session.status !== "active" || session.userId !== userId) throw new TransportError(401, "This sign-in session is no longer active.");
  await assertVerifiedUser(userId);
  return currentPermissionActor(userId);
}
export async function actorFor(req: Request): Promise<DemoActor> {
  if (transportMode(req) === "verified") return verifiedActorFor(req);
  return demoActorFor(req);
}
export function demoActorFor(req: Request): DemoActor {
  const envelope = readDemoEnvelope(req);
  if (!envelope?.role) throw new TransportError(401, "Select a demo role first.");
  return { id: `demo-${envelope.role.toLowerCase()}-${envelope.browserId}`, role: envelope.role };
}
export function setDemoRole(req: Request, res: Response, role: DemoRole | null): DemoActor | null {
  if (transportMode(req) !== "demo") throw new TransportError(403, "Public roles are available only in the isolated demo.");
  const envelope: Envelope = { browserId: readDemoEnvelope(req)?.browserId ?? randomUUID(), role, expires: Date.now() + 30 * 86400000 };
  const text = Buffer.from(JSON.stringify(envelope)).toString("base64url");
  // Remove the older unpartitioned cookie to avoid duplicate-name role values.
  res.clearCookie(cookieName, { secure: true, sameSite: "none", path: "/api/transport" });
  res.cookie(cookieName, `${text}.${signature(text)}`, {
    // For cross-site embedding, CHIPS keeps the demo identity scoped
    // to the embedding site without exposing it to other top-level sites.
    httpOnly: true, secure: true, sameSite: "none", partitioned: true,
    path: "/api/transport", maxAge: 30 * 86400000,
  });
  return role ? { id: `demo-${role.toLowerCase()}-${envelope.browserId}`, role } : null;
}