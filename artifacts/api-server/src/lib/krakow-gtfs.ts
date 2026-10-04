import { unzipSync, strFromU8 } from "fflate";
import { parse } from "csv-parse/sync";
import { parse as parseStream } from "csv-parse";
import { Readable } from "node:stream";
import { setImmediate } from "node:timers/promises";
import GtfsRealtimeBindings from "gtfs-realtime-bindings";
import type { FleetVehicle, TransportKind, TransportLine } from "./transport-domain";
import type { NormalizedGtfsFeed, RealtimeFeed } from "./transport-providers";

export const KRAKOW_FEED_BASE = "https://gtfs.ztp.krakow.pl/";
export const KRAKOW_DATASETS = ["A", "M", "T"] as const;
export const ns = (dataset: string, id: string) => `krakow-ztp-${dataset}-${encodeURIComponent(id)}`;
export interface StaticFeed extends NormalizedGtfsFeed {
  tripLines: Map<string, string>;
  validThrough: number | null;
  publishedAt?: number | null;
  calendars: Row[];
  calendarDates: Row[];
  departuresByStop?: Map<string, Uint32Array>;
  maxDepartureSeconds?: number;
  tripStartTimes?: Map<string, string>;
  routeDetails?: Map<string, { agencyId?: string; routeType: number }>;
  tripDirections?: Map<string, number>;
}
export interface DecodedRealtime extends RealtimeFeed {
  timestamp: number;
  serviceAlerts: (RealtimeFeed["serviceAlerts"][number] & {
    title: string; effect: number; periods: { start: number | null; end: number | null }[];
    selectors: { agencyId?: string; routeId?: string; routeType?: number; stopId?: string; directionId?: number;
      trip?: { id?: string; startDate?: string; startTime?: string; directionId?: number } }[];
  })[];
  tripUpdates: (RealtimeFeed["tripUpdates"][number] & {
    startDate?: string; startTime?: string; timestamp: number;
    scheduleRelationship: number; tripDelay?: number;
    stops: { stopId: string; sequence?: number; relationship: number;
      departureTime?: number; departureDelay?: number; arrivalTime?: number; arrivalDelay?: number }[];
  })[];
  vehiclePositions: (RealtimeFeed["vehiclePositions"][number] & {
    vehicleNumber: string; timestamp: number; routeId: string; directionId: number | null;
  })[];
}

// Only the fixed official HTTPS host is used. Bound compressed downloads,
// decompressed ZIP size, and request time so a feed cannot exhaust the server.
export async function downloadFeed(url: string, maxBytes = 25 * 1024 * 1024,
  onMetadata?: (modifiedAt: number | null) => void): Promise<Uint8Array> {
  if (!url.startsWith(KRAKOW_FEED_BASE)) throw new Error("Untrusted feed URL");
  const response = await fetch(url, { signal: AbortSignal.timeout(15_000), redirect: "error" });
  if (!response.ok) throw new Error(`Feed HTTP ${response.status}`);
  const modifiedAt = Date.parse(response.headers.get("last-modified") ?? "");
  onMetadata?.(Number.isFinite(modifiedAt) ? modifiedAt : null);
  if (Number(response.headers.get("content-length") ?? 0) > maxBytes) throw new Error("Feed too large");
  if (!response.body) throw new Error("Empty feed");
  const reader = response.body.getReader(), chunks: Uint8Array[] = [];
  let size = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > maxBytes) throw new Error("Feed too large");
      chunks.push(value);
    }
  } finally { await reader.cancel(); }
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.length; }
  return bytes;
}

type Row = Record<string, string>;
function kindFor(value: string): TransportKind | null {
  const n = Number(value);
  if (n === 0 || (n >= 900 && n <= 906)) return "TRAM";
  if (n === 3 || (n >= 700 && n <= 716)) return "BUS";
  if (n === 800) return "TROLLEYBUS";
  if (n === 1 || n === 400) return "METRO";
  if (n === 2 || (n >= 100 && n <= 117)) return "TRAIN";
  return null;
}
function extractZip(bytes: Uint8Array) {
  let total = 0;
  const names = new Set(["agency.txt", "routes.txt", "trips.txt", "stops.txt", "stop_times.txt", "calendar.txt", "calendar_dates.txt", "feed_info.txt"]);
  return unzipSync(bytes, { filter: file => {
    if (!names.has(file.name)) return false;
    total += file.originalSize;
    if (total > 150 * 1024 * 1024) throw new Error("Uncompressed GTFS too large");
    return true;
  } });
}
export function parseStaticZip(bytes: Uint8Array, dataset: string): StaticFeed {
  return parseStaticFiles(extractZip(bytes), dataset);
}
function parseStaticFiles(files: Record<string, Uint8Array>, dataset: string,
  decodedStopTimes?: NormalizedGtfsFeed["stopTimes"], stopTimeCount?: number): StaticFeed {
  function rows(name: string, required: string[] = []): Row[] {
    const file = files[name];
    if (!file) { if (required.length) throw new Error(`Missing ${name}`); return []; }
    const text = strFromU8(file);
    const header = parse(text.slice(0, text.indexOf("\n") + 1), { bom: true })[0] as string[] | undefined;
    if (!header || required.some(key => !header.includes(key))) throw new Error(`Invalid ${name} columns`);
    return parse(text, { columns: true, bom: true, skip_empty_lines: true });
  }
  const routes = new Map(rows("routes.txt", ["route_id", "route_type", "route_short_name"]).map(r => [r.route_id!, r]));
  const agencies = rows("agency.txt");
  const routeDetails = new Map([...routes].map(([id, r]) => [id, {
    agencyId: r.agency_id || (agencies.length === 1 ? agencies[0]!.agency_id : undefined), routeType: Number(r.route_type),
  }]));
  const rawTrips = rows("trips.txt", ["trip_id", "route_id", "service_id"]);
  const lines = new Map<string, TransportLine>(), tripLines = new Map<string, string>();
  for (const trip of rawTrips) {
    const route = routes.get(trip.route_id!);
    const type = route && kindFor(route.route_type!);
    if (!route || !type) continue;
    // Headsign is part of the direction identity: short turns are not merged
    // with trips that have the same direction_id but a different terminus.
    const direction = trip.trip_headsign || route.route_long_name || "Direction not supplied";
    const id = ns(dataset, `line:${trip.route_id}:${trip.direction_id ?? ""}:${direction}`);
    lines.set(id, { id, cityId: "krakow", number: route.route_short_name!, transportType: type, direction });
    tripLines.set(trip.trip_id!, id);
  }
  const stops = rows("stops.txt", ["stop_id", "stop_name", "stop_lat", "stop_lon"]).map(s => ({
    id: ns(dataset, s.stop_id!), cityId: "krakow", name: s.stop_name!,
    latitude: Number(s.stop_lat), longitude: Number(s.stop_lon),
  })).filter(s => validPosition(s.latitude, s.longitude));
  const stopTimes = decodedStopTimes ?? rows("stop_times.txt", ["trip_id", "stop_id", "stop_sequence", "arrival_time", "departure_time"]).map(s => ({
    tripId: s.trip_id!, stopId: ns(dataset, s.stop_id!), stopSequence: Number(s.stop_sequence),
    arrivalTime: s.arrival_time!, departureTime: s.departure_time!,
  }));
  const calendars = rows("calendar.txt"), calendarDates = rows("calendar_dates.txt");
  const dates = [
    ...calendars.map(s => s.end_date),
    ...calendarDates.filter(s => s.exception_type === "1").map(s => s.date),
    ...rows("feed_info.txt").map(s => s.feed_end_date),
  ].filter((s): s is string => !!s && /^\d{8}$/.test(s)).sort();
  const last = dates.at(-1);
  const validThrough = last ? Date.parse(`${last.slice(0,4)}-${last.slice(4,6)}-${last.slice(6,8)}T23:59:59+02:00`) : null;
  if (!lines.size || !rawTrips.length || !stops.length || !(stopTimeCount ?? stopTimes.length)) throw new Error("Empty static GTFS");
  return { lines: [...lines.values()], vehicles: [], stops, stopTimes, tripLines, validThrough, calendars, calendarDates, routeDetails,
    tripDirections: new Map(rawTrips.filter(t => t.direction_id === "0" || t.direction_id === "1").map(t => [t.trip_id!, Number(t.direction_id)])),
    trips: rawTrips.map(t => ({ id: t.trip_id!, routeId: t.route_id!, serviceId: t.service_id!, headsign: t.trip_headsign ?? "" })) };
}
// Fleet runtime decodes the entire large CSV without retaining stop times
// or blocking unrelated API traffic for the duration of a timetable refresh.
export async function loadFleetSchedule(bytes: Uint8Array, dataset: string, retainPassengerIndex = false): Promise<StaticFeed> {
  const files = extractZip(bytes), file = files["stop_times.txt"];
  if (!file) throw new Error("Missing stop_times.txt");
  const feed = parseStaticFiles(files, dataset, [], 1);
  const tripIndexes = new Map(feed.trips.map((trip, i) => [trip.id, i]));
  const departures = new Map<string, number[]>();
  const firstStops = new Map<string, { sequence: number; time: string }>();
  let maxDepartureSeconds = 0;
  const required = ["trip_id", "stop_id", "stop_sequence", "arrival_time", "departure_time"];
  const input = Readable.from((async function* () {
    for (let offset = 0; offset < file.length; offset += 64 * 1024) {
      await setImmediate();
      yield file.subarray(offset, offset + 64 * 1024);
    }
  })());
  const parser = input.pipe(parseStream({ bom: true, skip_empty_lines: true, columns: (header: string[]) => {
    if (required.some(key => !header.includes(key))) throw new Error("Invalid stop_times.txt columns");
    return header;
  } }));
  let count = 0;
  try {
    for await (const row of parser) {
      if (!row.trip_id || !row.stop_id || !Number.isFinite(Number(row.stop_sequence))) throw new Error("Invalid stop time");
      count++;
      const first = firstStops.get(row.trip_id);
      if (!first || Number(row.stop_sequence) < first.sequence) {
        firstStops.set(row.trip_id, { sequence: Number(row.stop_sequence), time: row.departure_time });
      }
      if (retainPassengerIndex && row.pickup_type !== "1") {
        const match = /^(\d{1,2}):([0-5]\d):([0-5]\d)$/.exec(row.departure_time);
        const index = tripIndexes.get(row.trip_id);
        if (!match || Number(match[1]) > 71 || index === undefined) continue;
        const seconds = Number(match[1]) * 3600 + Number(match[2]) * 60 + Number(match[3]);
        maxDepartureSeconds = Math.max(maxDepartureSeconds, seconds);
        const key = ns(dataset, row.stop_id);
        const entries = departures.get(key) ?? [];
        entries.push(index, seconds, Number(row.stop_sequence)); departures.set(key, entries);
      }
    }
  } finally { input.destroy(); parser.destroy(); }
  if (!count) throw new Error("Empty stop_times.txt");
  if (retainPassengerIndex) {
    feed.departuresByStop = new Map([...departures].map(([id, entries]) => [id, Uint32Array.from(entries)]));
    feed.maxDepartureSeconds = maxDepartureSeconds;
    feed.tripStartTimes = new Map([...firstStops].map(([id, first]) => [id, first.time]));
  }
  return feed;
}
export const validPosition = (lat: number, lon: number) =>
  Number.isFinite(lat) && Number.isFinite(lon) && Math.abs(lat) <= 90 && Math.abs(lon) <= 180 && !(lat === 0 && lon === 0);

function stopEvent(event: { time?: unknown; delay?: number | null } | null | undefined) {
  // ZTP A sends an empty departure event as {time: 0, delay: 0} while
  // providing a real arrival event. It is not an epoch departure or on-time
  // prediction. A delay-only event (including zero) remains valid GTFS-RT.
  const hasTime = !!event && Object.hasOwn(event, "time");
  const time = hasTime ? Number(event!.time) * 1000 : undefined;
  const placeholder = hasTime && time === 0 && (event?.delay ?? 0) === 0;
  return { time: time && time > 0 ? time : undefined,
    delay: event && !placeholder && Object.hasOwn(event, "delay") ? event.delay ?? undefined : undefined };
}

export function parseRealtime(bytes: Uint8Array): DecodedRealtime {
  const feed = GtfsRealtimeBindings.transit_realtime.FeedMessage.decode(bytes);
  const timestamp = Number(feed.header.timestamp) * 1000;
  if (!Number.isFinite(timestamp) || timestamp <= 0 || feed.header.incrementality === 1) throw new Error("Unsupported or undated realtime feed");
  const result: DecodedRealtime = { timestamp, vehiclePositions: [], tripUpdates: [], serviceAlerts: [] };
  for (const entity of feed.entity) {
    if (entity.isDeleted) continue;
    const v = entity.vehicle;
    // Descriptor ID, not entity/trip/route ID, is the physical identity.
    if (v?.vehicle?.id) result.vehiclePositions.push({
      vehicleId: v.vehicle.id, vehicleNumber: v.vehicle.licensePlate || v.vehicle.label || v.vehicle.id,
      tripId: v.trip?.tripId ?? "", routeId: v.trip?.routeId ?? "", directionId: v.trip?.directionId ?? null,
      latitude: v.position && Object.hasOwn(v.position, "latitude") ? v.position.latitude : NaN,
      longitude: v.position && Object.hasOwn(v.position, "longitude") ? v.position.longitude : NaN,
      currentStopId: v.stopId ?? "", timestamp: v.timestamp ? Number(v.timestamp) * 1000 : timestamp,
    });
    const u = entity.tripUpdate;
    if (u?.trip?.tripId) result.tripUpdates.push({
      tripId: u.trip.tripId, delaySeconds: u.delay ?? u.stopTimeUpdate?.find(s => s.arrival?.delay != null)?.arrival?.delay ?? 0,
      cancelled: u.trip.scheduleRelationship === 3,
      startDate: u.trip.startDate || undefined, startTime: u.trip.startTime || undefined,
      timestamp: Object.hasOwn(u, "timestamp") ? Number(u.timestamp) * 1000 : timestamp,
      scheduleRelationship: u.trip.scheduleRelationship ?? 0,
      tripDelay: Object.hasOwn(u, "delay") ? u.delay ?? undefined : undefined,
      stops: (u.stopTimeUpdate ?? []).map(s => {
        const departure = stopEvent(s.departure), arrival = stopEvent(s.arrival);
        return {
        stopId: s.stopId || "", sequence: Object.hasOwn(s, "stopSequence") ? s.stopSequence ?? undefined : undefined,
        relationship: s.scheduleRelationship ?? 0,
        departureTime: departure.time, departureDelay: departure.delay,
        arrivalTime: arrival.time, arrivalDelay: arrival.delay,
      }; }),
    });
    const text = (value: { translation?: { language?: string | null; text?: string | null }[] | null } | null | undefined) =>
      value?.translation?.find(t => t.language === "pl" || t.language?.startsWith("pl-"))?.text ??
      value?.translation?.[0]?.text ?? "";
    if (entity.alert) result.serviceAlerts.push({
      id: entity.id, routeIds: entity.alert.informedEntity?.flatMap(i => i.routeId ? [i.routeId] : []) ?? [],
      description: text(entity.alert.descriptionText), title: text(entity.alert.headerText), effect: entity.alert.effect ?? 8,
      periods: (entity.alert.activePeriod ?? []).map(p => ({
        start: Object.hasOwn(p, "start") ? Number(p.start) * 1000 : null,
        end: Object.hasOwn(p, "end") ? Number(p.end) * 1000 : null,
      })),
      selectors: (entity.alert.informedEntity ?? []).map(i => ({
        agencyId: i.agencyId || undefined, routeId: i.routeId || i.trip?.routeId || undefined, stopId: i.stopId || undefined,
        routeType: Object.hasOwn(i, "routeType") ? i.routeType ?? undefined : undefined,
        directionId: Object.hasOwn(i, "directionId") ? i.directionId ?? undefined : undefined,
        trip: i.trip ? { id: i.trip.tripId || undefined, startDate: i.trip.startDate || undefined,
          startTime: i.trip.startTime || undefined,
          directionId: Object.hasOwn(i.trip, "directionId") ? i.trip.directionId ?? undefined : undefined } : undefined,
      })),
    });
  }
  return result;
}

export function vehiclesFromFeed(dataset: string, schedule: StaticFeed, realtime: DecodedRealtime, now: number, fresh: boolean): FleetVehicle[] {
  const stops = new Map(schedule.stops.map(s => [s.id, s]));
  const cancelled = new Set(realtime.tripUpdates.filter(t => t.cancelled).map(t => t.tripId));
  return realtime.vehiclePositions.flatMap(v => {
    const lineId = schedule.tripLines.get(v.tripId);
    // Unknown trip cannot be confidently attached to a line/direction.
    if (!lineId) return [];
    const stopId = v.currentStopId ? ns(dataset, v.currentStopId) : "";
    const positionFresh = fresh && now - v.timestamp <= 120_000 && v.timestamp <= now + 30_000;
    const coordinates = positionFresh && validPosition(v.latitude, v.longitude);
    return [{ id: ns(dataset, `vehicle:${v.vehicleId}`), cityId: "krakow", lineId,
      vehicleNumber: v.vehicleNumber, status: positionFresh && !cancelled.has(v.tripId) ? "ACTIVE" : "OUT_OF_SERVICE",
      latitude: coordinates ? v.latitude : null, longitude: coordinates ? v.longitude : null,
      currentStopId: stopId, currentStopName: stops.get(stopId)?.name ?? "Not supplied by feed" }];
  });
}