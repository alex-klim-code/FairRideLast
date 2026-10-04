import { Router } from "express";
import { ComputeTransitRoutesBody } from "@workspace/api-zod";
import { computeGoogleTransit, normalizeBrowserMapKey, TransitError } from "../lib/google-transit";
import { transitBudgetGate, TransitBudgetError } from "../lib/transit-budget";
import { transitPassengerId } from "../lib/transit-identity";

export function createTransitRouter(gate = transitBudgetGate, compute = computeGoogleTransit) {
const router = Router();

router.get("/maps/config", (_req, res) => {
  res.setHeader("Cache-Control", "no-store");
  try {
    const apiKey = normalizeBrowserMapKey(process.env.FAIRRIDE_MAPS_BROWSER_API_KEY);
    // Intentionally public: this is the domain-restricted browser key, NEVER the Routes key.
    res.json({ apiKey });
  } catch {
    res.status(503).json({ error: "Sekret FAIRRIDE_MAPS_BROWSER_API_KEY nie zawiera pełnego klucza Google API. Wklej samą wartość z pola API key w Google Cloud, bez nazwy klucza, adresu URL ani prefiksu apiKey=." });
  }
});

router.post("/transit/routes", async (req, res): Promise<void> => {
  res.setHeader("Cache-Control", "no-store");
  const parsed = ComputeTransitRoutesBody.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: "Nieprawidłowe współrzędne startu lub celu." }); return; }
  const abort = new AbortController();
  const disconnected = () => { if (!res.writableEnded) abort.abort(); };
  res.on("close", disconnected);
  let reservation: Awaited<ReturnType<typeof gate.reserve>> | undefined;
  try {
    reservation = await gate.reserve(transitPassengerId(req.socket.remoteAddress));
    if (abort.signal.aborted || res.destroyed) return;
    if (!reservation.usable()) throw new TransitBudgetError(503,
      "Rezerwacja limitu wygasła. Nie wysłano zapytania do Google. Spróbuj ponownie.", 60);
    const result = await compute(parsed.data, abort.signal);
    if (!res.destroyed) res.json(result);
  } catch (error) {
    const safe = error instanceof TransitError ? error : new TransitError(503, "Wyznaczenie trasy nie powiodło się.");
    if (safe instanceof TransitBudgetError) res.setHeader("Retry-After", String(safe.retryAfter));
    else if (safe.status === 429) res.setHeader("Retry-After", "60");
    if (!res.destroyed) res.status(safe.status).json({ error: safe.message });
  } finally {
    if (reservation) {
      try { await gate.release(reservation.token); }
      catch { req.log?.warn("Nie udało się zwolnić rezerwacji Routes; slot wygaśnie automatycznie."); }
    }
    res.off("close", disconnected);
  }
});
return router;
}
export default createTransitRouter();