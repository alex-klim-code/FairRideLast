import type { TransitAgency, TransitResults, TransitRoute, TransitStep, TransitInput } from "@workspace/api-zod";

export class TransitError extends Error {
  constructor(public status: number, message: string) { super(message); }
}

export function normalizeBrowserMapKey(value: string | undefined): string {
  let key = value?.trim() ?? "";
  if (!key) throw new TransitError(503, "Brak klucza przeglądarkowego Google Maps w FAIRRIDE_MAPS_BROWSER_API_KEY.");
  if ((key.startsWith('"') && key.endsWith('"')) || (key.startsWith("'") && key.endsWith("'"))) {
    key = key.slice(1, -1).trim();
  }
  if (!/^AIza[A-Za-z0-9_-]{35}$/.test(key)) {
    throw new TransitError(503, "Sekret FAIRRIDE_MAPS_BROWSER_API_KEY ma nieprawidłowy format. Wklej samą pełną wartość klucza API z Google Cloud, bez nazwy klucza, adresu URL ani prefiksu apiKey=.");
  }
  return key;
}

type RecordValue = Record<string, any>;
const text = (value: unknown, limit = 1000) => typeof value === "string" ? value.slice(0, limit) : "";
const number = (value: unknown) => typeof value === "number" && Number.isFinite(value) ? Math.max(0, value) : 0;
const measure = (value: unknown) => typeof value === "number" && Number.isFinite(value) && value >= 0 ? value : null;
export const durationSeconds = (value: unknown) => {
  const match = typeof value === "string" ? /^(\d+(?:\.\d+)?)s$/.exec(value) : null;
  return match && Number.isFinite(Number(match[1])) ? Number(match[1]) : null;
};
const uri = (value: unknown) => {
  try { const url = new URL(text(value)); return ["https:", "http:"].includes(url.protocol) ? url.href : ""; }
  catch { return ""; }
};

export function normalizeTransit(payload: unknown): TransitResults {
  if (!payload || typeof payload !== "object") throw new TransitError(503, "Google zwrócił nieprawidłową odpowiedź.");
  const raw = payload as RecordValue;
  if (raw.routes !== undefined && !Array.isArray(raw.routes)) throw new TransitError(503, "Google zwrócił nieprawidłową odpowiedź.");
  const routes: TransitRoute[] = (raw.routes || []).map((route: RecordValue, index: number) => {
    if (!route || !Array.isArray(route.legs)) throw new TransitError(503, "Niepełna odpowiedź Google Routes.");
    const steps: TransitStep[] = route.legs.flatMap((leg: RecordValue) => Array.isArray(leg?.steps) ? leg.steps : [])
      .slice(0, 400).map((step: RecordValue): TransitStep => {
        const transit = step?.transitDetails || {};
        const line = transit.transitLine || {};
        const stops = transit.stopDetails || {};
        const agencies: TransitAgency[] = (Array.isArray(line.agencies) ? line.agencies : []).slice(0, 10)
          .map((agency: RecordValue) => ({ name: text(agency?.name), ...(uri(agency?.uri) ? { uri: uri(agency.uri) } : {}) }));
        return {
          mode: step.travelMode === "TRANSIT" ? "TRANSIT" : step.travelMode === "WALK" ? "WALK" : "OTHER",
          instruction: text(step.navigationInstruction?.instructions).replace(/<[^>]*>/g, ""),
          distanceMeters: measure(step.distanceMeters),
          durationSeconds: durationSeconds(step.staticDuration || step.duration),
          polyline: text(step.polyline?.encodedPolyline, 200_000),
          lineName: text(line.name), lineShortName: text(line.nameShort),
          lineColor: /^#[\da-f]{6}$/i.test(text(line.color)) ? line.color : "",
          vehicleType: text(line.vehicle?.type), headsign: text(transit.headsign),
          departureStop: text(stops.departureStop?.name), arrivalStop: text(stops.arrivalStop?.name),
          departureTime: text(stops.departureTime), arrivalTime: text(stops.arrivalTime),
          stopCount: Math.floor(number(transit.stopCount)), agencies,
        };
      });
    return {
      id: `google-route-${index}`, distanceMeters: measure(route.distanceMeters),
      durationSeconds: durationSeconds(route.duration),
      polyline: text(route.polyline?.encodedPolyline, 200_000),
      transfers: Math.max(0, steps.filter(step => step.mode === "TRANSIT").length - 1),
      fareText: text(route.localizedValues?.transitFare?.text),
      steps,
    };
  });
  return { provider: "google", requestedAt: new Date().toISOString(), routes };
}

export async function computeGoogleTransit(input: TransitInput, signal?: AbortSignal): Promise<TransitResults> {
  const key = process.env.GOOGLE_API_KEY;
  if (!key) throw new TransitError(503, "Brak klucza Google Routes API w sekrecie GOOGLE_API_KEY.");
  const toWaypoint = (point: TransitInput["origin"]) => ({
    location: { latLng: { latitude: point.lat, longitude: point.lng } },
  });
  let response: Response;
  try {
    response = await fetch("https://routes.googleapis.com/directions/v2:computeRoutes", {
      method: "POST", redirect: "error",
      signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(12_000)]) : AbortSignal.timeout(12_000),
      headers: {
        "Content-Type": "application/json", "X-Goog-Api-Key": key,
        "X-Goog-FieldMask": "routes.duration,routes.distanceMeters,routes.polyline.encodedPolyline,routes.legs.steps,routes.localizedValues.transitFare",
      },
      body: JSON.stringify({
        origin: toWaypoint(input.origin), destination: toWaypoint(input.destination),
        travelMode: "TRANSIT", computeAlternativeRoutes: true, languageCode: "pl", units: "METRIC",
      }),
    });
  } catch {
    throw new TransitError(503, "Nie udało się połączyć z Google Routes. Spróbuj ponownie.");
  }
  if (!response.ok) {
    if (response.status === 400) {
      const failure = await response.json().catch(() => null) as RecordValue | null;
      const invalidKey = Array.isArray(failure?.error?.details)
        && failure.error.details.some((detail: RecordValue) => detail?.reason === "API_KEY_INVALID");
      throw new TransitError(503, invalidKey
        ? "Google nie rozpoznaje klucza zapisanego jako GOOGLE_API_KEY. Zapisz prawidłowy klucz Routes API w Secrets."
        : "Google Routes odrzucił zapytanie (400). Sprawdź konfigurację klucza GOOGLE_API_KEY.");
    }
    // Never forward upstream errors, headers, URLs or credentials.
    throw new TransitError(response.status === 429 ? 429 : 503,
      response.status === 403 || response.status === 401
        ? "Google odrzucił dostęp do Routes API. Sprawdź włączenie Routes API, rozliczanie oraz ograniczenia klucza serwerowego."
        : response.status === 429 ? "Limit Google Routes został osiągnięty. Spróbuj później."
        : "Google Routes jest chwilowo niedostępne. Spróbuj ponownie.");
  }
  try {
    const body = await response.text();
    if (body.length > 2_000_000) throw new Error("Oversized response");
    return normalizeTransit(JSON.parse(body));
  } catch (error) {
    if (error instanceof TransitError) throw error;
    throw new TransitError(503, "Google zwrócił nieprawidłową odpowiedź trasy.");
  }
}