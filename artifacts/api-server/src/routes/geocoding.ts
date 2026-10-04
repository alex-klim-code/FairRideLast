import { Router } from "express";
import { SearchAddressesBody, ReverseAddressBody } from "@workspace/api-zod";
import { GeocodingError, searchAddresses, reverseAddress } from "../lib/geocoding";

const router = Router();
router.post("/geocoding/reverse", async (req, res) => {
  res.setHeader("Cache-Control", "no-store");
  const parsed = ReverseAddressBody.safeParse(req.body);
  if (!parsed.success || !Number.isFinite(parsed.data.lat) || !Number.isFinite(parsed.data.lng)) {
    res.status(400).json({ error: "Invalid device coordinates." });
    return;
  }
  try {
    res.json(await reverseAddress(parsed.data.lat, parsed.data.lng));
  } catch (error) {
    const safe = error instanceof GeocodingError ? error : new GeocodingError(503);
    if (safe.retryAfter) res.setHeader("Retry-After", String(safe.retryAfter));
    res.status(safe.status).json({ error: "Device address unavailable; route planning can still use GPS." });
  }
});
router.post("/geocoding/search", async (req, res) => {
  res.setHeader("Cache-Control", "no-store");
  const parsed = SearchAddressesBody.safeParse(req.body);
  const query = parsed.success ? parsed.data.query.normalize("NFC").trim().replace(/\s+/g, " ") : "";
  if (query.length < 3 || query.length > 200 || /[\u0000-\u001f\u007f]/.test(query)) {
    res.status(400).json({ error: "Enter between 3 and 200 characters to search for an address or place." });
    return;
  }
  try {
    res.json(await searchAddresses(query));
  } catch (error) {
    // Never log upstream exceptions: they can contain request URLs, keys or results.
    const safe = error instanceof GeocodingError ? error : new GeocodingError(503);
    if (safe.retryAfter) res.setHeader("Retry-After", String(safe.retryAfter));
    res.status(safe.status).json({ error: safe.message });
  }
});
export default router;