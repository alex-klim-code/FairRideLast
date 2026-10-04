import { createHmac } from "node:crypto";
import { isIP } from "node:net";
import { TransitBudgetError } from "./transit-budget";

// Use ONLY the transport peer, never req.ip or forwarding headers. Normalize
// IPv6 and IPv4-mapped IPv6 so alternate spellings cannot create fresh budgets.
export function transitPassengerId(address: string | undefined, secret = process.env.SESSION_SECRET): string {
  if (!secret || !address || !isIP(address)) {
    throw new TransitBudgetError(503,
      "Ochrona limitu zapytań jest chwilowo niedostępna. Nie wysłano zapytania do Google. Spróbuj później.", 60);
  }
  let normalized = address;
  if (isIP(address) === 6) {
    normalized = new URL(`http://[${address}]/`).hostname.slice(1, -1);
    const mapped = /^::ffff:([0-9a-f]+):([0-9a-f]+)$/.exec(normalized);
    if (mapped) {
      const high = parseInt(mapped[1], 16);
      const low = parseInt(mapped[2], 16);
      normalized = [high >> 8, high & 255, low >> 8, low & 255].join(".");
    }
  }
  // Domain separation prevents reusing the session secret's hashes elsewhere.
  // Only this pseudonym enters PostgreSQL; IP and secret must never be logged.
  return createHmac("sha256", secret).update(`metro-mate:routes:peer:v1:${normalized}`).digest("hex");
}