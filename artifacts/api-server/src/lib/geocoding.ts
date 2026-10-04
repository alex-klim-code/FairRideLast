import { createHmac } from "node:crypto";
import { pool } from "@workspace/db";

const LOCK_ID = 731904201;
const TTL_MS = 15 * 60 * 1000;
const MAX_CACHE = 1000;
const MAX_RESPONSE_BYTES = 128 * 1024;

export class GeocodingError extends Error {
  constructor(public status: number, public retryAfter?: number) {
    super(status === 429 ? "Address search is busy. Please try again later."
      : "Address search is temporarily unavailable. Please try again or choose a map point.");
  }
}

export function providerConfig(env: NodeJS.ProcessEnv = process.env) {
  if (env.GEOCODING_CAPACITY_CONFIRMED !== "true" || !env.SESSION_SECRET) throw new GeocodingError(503);
  try {
    const interval = Number(env.GEOCODING_INTERVAL_MS ?? "1500");
    const dailyLimit = Number(env.GEOCODING_DAILY_LIMIT ?? "2700");
    if (!env.GEOAPIFY_API_KEY || !Number.isInteger(interval) || interval < 250 || interval > 60000 ||
        !Number.isInteger(dailyLimit) || dailyLimit < 1 || dailyLimit > 2700) throw new Error();
    // Fixed host, no configurable URL or browser-supplied upstream endpoint.
    return { url: new URL("https://api.geoapify.com/v1/geocode/search"),
      interval, dailyLimit, secret: env.SESSION_SECRET, apiKey: env.GEOAPIFY_API_KEY };
  } catch {
    throw new GeocodingError(503);
  }
}

// Only the display fields used by MetroMate are retained, never arbitrary upstream metadata.
export function sanitizeGeocoding(payload: unknown) {
  if (!payload || typeof payload !== "object" || !("features" in payload) || !Array.isArray(payload.features)) {
    throw new GeocodingError(503);
  }
  const features = payload.features.slice(0, 8).flatMap(feature => {
    const point = feature?.geometry?.coordinates;
    const p = feature?.properties;
    if (feature?.geometry?.type !== "Point" || !Array.isArray(point) || point.length < 2 ||
        !point.slice(0, 2).every(Number.isFinite) || Math.abs(point[0]) > 180 || Math.abs(point[1]) > 90 ||
        !p || typeof p !== "object") return [];
    const properties: Record<string, string> = {};
    for (const field of ["name", "street", "housenumber", "postcode", "city", "district", "state", "country",
      "formatted", "address_line1", "place_id"]) {
      if (typeof p[field] === "string" || typeof p[field] === "number") {
        properties[field] = String(p[field]).slice(0, 300);
      }
    }
    return [{ type: "Feature", geometry: { type: "Point", coordinates: point.slice(0, 2) }, properties }];
  });
  return { type: "FeatureCollection", provider: "geoapify", features };
}

async function fetchGeocoding(config: ReturnType<typeof providerConfig>, query: string) {
  const url = new URL(config.url);
  const reverse = url.pathname.endsWith("/reverse");
  const [lat, lon] = query.split(",");
  url.search = new URLSearchParams(reverse
    ? { lat, lon, limit: "1", format: "geojson", apiKey: config.apiKey }
    : { text: query, limit: "8", format: "geojson",
      bias: "proximity:19.9383,50.0616|countrycode:none", apiKey: config.apiKey }).toString();
  const response = await fetch(url, {
    signal: AbortSignal.timeout(8000), redirect: "error",
    headers: { Accept: "application/json" },
  });
  if (!response.ok) {
    await response.body?.cancel();
    if (response.status === 429) {
      const value = response.headers.get("retry-after");
      const seconds = value && /^\d+$/.test(value) ? Number(value)
        : value ? (Date.parse(value) - Date.now()) / 1000 : 60;
      throw new GeocodingError(429, Number.isFinite(seconds) ? Math.max(60, Math.ceil(seconds)) : 60);
    }
    throw new GeocodingError(503);
  }
  const reader = response.body?.getReader();
  if (!reader) throw new GeocodingError(503);
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      size += value.length;
      if (size > MAX_RESPONSE_BYTES) throw new GeocodingError(503);
      chunks.push(value);
    }
    return sanitizeGeocoding(JSON.parse(Buffer.concat(chunks).toString("utf8")));
  } finally {
    await reader.cancel();
  }
}

export async function searchAddresses(query: string, config = providerConfig()) {
  // Reverse GPS lookups share the gate/quota but never persist a rider's address.
  const reverse = config.url.pathname.endsWith("/reverse");
  // Includes configuration/version in the namespace so changing providers cannot serve old results.
  const key = createHmac("sha256", config.secret)
    .update(`geoapify-v1:${config.url.href}:${query.toLocaleLowerCase("pl")}`).digest("hex");
  const cached = await pool.query("SELECT payload FROM geocoding_cache WHERE key=$1 AND expires_at>clock_timestamp()", [key]);
  if (!reverse && cached.rows[0]) return cached.rows[0].payload;
  const client = await pool.connect();
  let locked = false;
  let broken = false;
  try {
    // Nonblocking: no unbounded queue, one upstream call across ALL API replicas.
    locked = (await client.query("SELECT pg_try_advisory_lock($1) AS locked", [LOCK_ID])).rows[0].locked;
    if (!locked) throw new GeocodingError(429, Math.ceil(config.interval / 1000));
    const hit = await client.query("SELECT payload FROM geocoding_cache WHERE key=$1 AND expires_at>clock_timestamp()", [key]);
    if (!reverse && hit.rows[0]) return hit.rows[0].payload;
    // Autocommitted before fetching: a crashed process still consumes its slot.
    await client.query("INSERT INTO geocoding_gate(id,next_at) VALUES(1,'epoch') ON CONFLICT DO NOTHING");
    const gate = await client.query("SELECT EXTRACT(EPOCH FROM (next_at-clock_timestamp())) AS wait FROM geocoding_gate WHERE id=1");
    if (Number(gate.rows[0].wait) > 0) throw new GeocodingError(429, Math.ceil(Number(gate.rows[0].wait)));
    // Sliding 24-hour quota, not a midnight reset that could allow two daily bursts.
    // Only timestamps are stored, never addresses, responses or user identifiers.
    await client.query("DELETE FROM geocoding_usage WHERE requested_at<=clock_timestamp()-interval '24 hours'");
    const usage = await client.query("SELECT count(*) AS count, EXTRACT(EPOCH FROM (min(requested_at)+interval '24 hours'-clock_timestamp())) AS wait FROM geocoding_usage");
    if (Number(usage.rows[0].count) >= config.dailyLimit) {
      throw new GeocodingError(429, Math.max(1, Math.ceil(Number(usage.rows[0].wait))));
    }
    // Charge attempts before fetching, including failures and process crashes.
    await client.query("INSERT INTO geocoding_usage(requested_at) VALUES(clock_timestamp())");
    await client.query("UPDATE geocoding_gate SET next_at=clock_timestamp()+($1 * interval '1 millisecond') WHERE id=1", [Math.max(config.interval, 8000)]);
    let payload;
    try {
      payload = await fetchGeocoding(config, query);
    } catch (error) {
      // Shared failure cooldown also prevents a provider outage becoming a retry storm.
      const cooldown = error instanceof GeocodingError && error.retryAfter ? error.retryAfter * 1000 : 30000;
      await client.query("UPDATE geocoding_gate SET next_at=GREATEST(next_at,clock_timestamp()+($1 * interval '1 millisecond')) WHERE id=1", [cooldown]);
      throw error;
    }
    await client.query("DELETE FROM geocoding_cache WHERE expires_at<=clock_timestamp()");
    await client.query("DELETE FROM geocoding_cache WHERE key IN (SELECT key FROM geocoding_cache ORDER BY expires_at DESC OFFSET $1)", [MAX_CACHE - 1]);
    if (!reverse) await client.query("INSERT INTO geocoding_cache(key,payload,expires_at) VALUES($1,$2,clock_timestamp()+($3 * interval '1 millisecond')) ON CONFLICT(key) DO UPDATE SET payload=EXCLUDED.payload,expires_at=EXCLUDED.expires_at", [key, JSON.stringify(payload), TTL_MS]);
    await client.query("UPDATE geocoding_gate SET next_at=clock_timestamp()+($1 * interval '1 millisecond') WHERE id=1", [config.interval]);
    return payload;
  } finally {
    if (locked) {
      try { await client.query("SELECT pg_advisory_unlock($1)", [LOCK_ID]); }
      catch { broken = true; }
    }
    client.release(broken);
  }
}

export function reverseAddress(lat: number, lng: number, config = providerConfig()) {
  if (!Number.isFinite(lat) || !Number.isFinite(lng) || Math.abs(lat) > 90 || Math.abs(lng) > 180) {
    throw new GeocodingError(400);
  }
  return searchAddresses(`${lat},${lng}`, {
    ...config, url: new URL("https://api.geoapify.com/v1/geocode/reverse"),
  });
}

export async function purgeExpiredGeocodingCache() {
  await pool.query("DELETE FROM geocoding_cache WHERE expires_at<=clock_timestamp()");
  await pool.query("DELETE FROM geocoding_usage WHERE requested_at<=clock_timestamp()-interval '24 hours'");
}