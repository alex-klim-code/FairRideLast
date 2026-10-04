import { randomUUID } from "node:crypto";

export type DemoRole = "USER" | "CONDUCTOR" | "ADMIN";
export type TransportKind = "TRAM" | "BUS" | "TRAIN" | "METRO" | "TROLLEYBUS";
export type FleetStatus = "ACTIVE" | "CHECK_IN_LOCKED" | "OUT_OF_SERVICE";
// Actors must be resolved at the request boundary. The domain never accepts
// identity or role from mutation bodies. Demo actors are sandbox-only.
export interface TransportActor { id: string; role: DemoRole }
export type DemoActor = TransportActor;
export interface CityConfig {
  id: string; name: string; countryCode: string; availableTransportTypes: TransportKind[];
  dataProvider: "MOCK" | "GTFS"; gtfsUrl: string | null; gtfsRealtimeUrl: string | null; isActive: boolean;
}
export interface TransportLine { id: string; cityId: string; number: string; transportType: TransportKind; direction: string }
export interface FleetVehicle {
  id: string; cityId: string; lineId: string; vehicleNumber: string; status: FleetStatus;
  latitude: number | null; longitude: number | null; currentStopId: string; currentStopName: string;
}
export interface InspectionSession {
  id: string; cityId: string; conductorId: string; vehicleId: string; lineId: string;
  transportType: TransportKind; startedAt: string; endedAt: string | null; status: "ACTIVE" | "FINISHED";
  numberOfPassengersAlreadyCheckedIn: number; numberOfBlockedCheckInAttempts: number; requestId: string;
}
export interface VehicleCheckIn {
  id: string; userId: string; vehicleId: string; cityId: string; lineId: string;
  checkInTime: string; checkOutTime: string | null; status: "ACTIVE" | "CHECKED_OUT"; requestId: string;
}
export interface TransportState {
  version: 1; vehicles: FleetVehicle[]; inspections: InspectionSession[]; checkIns: VehicleCheckIn[]; updatedAt: string;
  lines?: TransportLine[];
  feedSyncedAt?: number;
  upstreamStatuses?: Record<string, FleetStatus>;
}
export type FeedSource = "MOCK" | "LIVE" | "CACHED" | "UNAVAILABLE";
export interface FeedHealth {
  cityId: string; dataset: string; kind: "STATIC" | "VEHICLES" | "TRIPS" | "ALERTS";
  source: FeedSource; url: string | null; fetchedAt: string | null; feedTimestamp: string | null;
  notice: string;
}
export interface TransportCatalog {
  cities: CityConfig[]; lines: TransportLine[]; source: FeedSource; sourceNotice: string;
  feeds?: FeedHealth[];
}
// Called only inside the same row-locked transaction as check-in/inspection.
// Physical IDs do not contain trip/line IDs and are never deleted or reused.
export function syncTransportFleet(state: TransportState, vehicles: FleetVehicle[], lines: TransportLine[], generatedAt: number) {
  if ((state.feedSyncedAt ?? 0) > generatedAt) return;
  const incoming = new Map(vehicles.map(v => [v.id, v]));
  const locked = new Set(state.inspections.filter(i => i.status === "ACTIVE").map(i => i.vehicleId));
  for (const old of state.vehicles) {
    const next = incoming.get(old.id);
    if (next) Object.assign(old, next, { status: locked.has(old.id) || old.status === "CHECK_IN_LOCKED" ? "CHECK_IN_LOCKED" : next.status });
    else {
      old.status = locked.has(old.id) || old.status === "CHECK_IN_LOCKED" ? "CHECK_IN_LOCKED" : "OUT_OF_SERVICE";
      old.latitude = null; old.longitude = null;
    }
    incoming.delete(old.id);
  }
  for (const next of incoming.values()) state.vehicles.push({ ...next, status: locked.has(next.id) ? "CHECK_IN_LOCKED" : next.status });
  const archived = new Map((state.lines ?? []).map(l => [l.id, l]));
  for (const line of lines) archived.set(line.id, line);
  state.lines = [...archived.values()];
  state.upstreamStatuses = Object.fromEntries(vehicles.map(v => [v.id, v.status]));
  state.feedSyncedAt = generatedAt;
}
export class TransportError extends Error {
  constructor(public status: number, message: string) { super(message); }
}
const fail = (status: number, message: string): never => { throw new TransportError(status, message); };
const vehicleFor = (state: TransportState, id: string) =>
  state.vehicles.find(v => v.id === id) ?? fail(404, "Physical vehicle not found.");
const staffOnly = (actor: DemoActor) => {
  if (actor.role !== "CONDUCTOR" && actor.role !== "ADMIN") fail(403, "Only Conductor and Admin may change inspections.");
};
// Serialized events have strictly ordered server times, even within one millisecond.
export function eventTime(state: TransportState, now = Date.now()) {
  return new Date(Math.max(now, Date.parse(state.updatedAt) + 1)).toISOString();
}
export function startInspection(state: TransportState, actor: DemoActor, vehicleId: string, requestId: string, lines: TransportLine[], now?: number) {
  staffOnly(actor);
  const replay = state.inspections.find(i => i.conductorId === actor.id && i.requestId === requestId);
  if (replay) {
    if (replay.vehicleId !== vehicleId) fail(409, "This request was already used for another vehicle.");
    return replay;
  }
  const vehicle = vehicleFor(state, vehicleId);
  if (vehicle.status !== "ACTIVE") fail(409, vehicle.status === "OUT_OF_SERVICE" ? "Vehicle is out of service." : "This vehicle is already under inspection.");
  const line = lines.find(l => l.id === vehicle.lineId) ?? fail(503, "Line configuration is unavailable.");
  const startedAt = eventTime(state, now);
  const inspection: InspectionSession = {
    id: randomUUID(), conductorId: actor.id, cityId: vehicle.cityId, vehicleId, lineId: vehicle.lineId,
    transportType: line.transportType, startedAt, endedAt: null, status: "ACTIVE", requestId,
    numberOfPassengersAlreadyCheckedIn: state.checkIns.filter(j => j.vehicleId === vehicleId && j.status === "ACTIVE").length,
    numberOfBlockedCheckInAttempts: 0,
  };
  vehicle.status = "CHECK_IN_LOCKED"; state.inspections.unshift(inspection); state.updatedAt = startedAt;
  return inspection;
}
export function endInspection(state: TransportState, actor: DemoActor, id: string, now?: number) {
  staffOnly(actor);
  const inspection = state.inspections.find(i => i.id === id) ?? fail(404, "Inspection not found.");
  if (inspection.conductorId !== actor.id && actor.role !== "ADMIN") fail(403, "Only the inspecting conductor or Admin may end this inspection.");
  if (inspection.status === "FINISHED") return inspection;
  inspection.endedAt = eventTime(state, now); inspection.status = "FINISHED";
  vehicleFor(state, inspection.vehicleId).status = state.upstreamStatuses
    ? state.upstreamStatuses[inspection.vehicleId] ?? "OUT_OF_SERVICE" : "ACTIVE";
  state.updatedAt = inspection.endedAt;
  return inspection;
}
export function checkInVehicle(state: TransportState, actor: DemoActor, vehicleId: string, requestId: string, now?: number):
  { checkIn: VehicleCheckIn; blocked?: never } | { blocked: true; checkIn?: never } {
  if (actor.role !== "USER") fail(403, "Only Passengers may check in.");
  const replay = state.checkIns.find(j => j.userId === actor.id && j.requestId === requestId);
  if (replay) {
    if (replay.vehicleId !== vehicleId) fail(409, "This request was already used for another vehicle.");
    return { checkIn: replay };
  }
  const vehicle = vehicleFor(state, vehicleId);
  if (vehicle.status === "CHECK_IN_LOCKED") {
    const inspection = state.inspections.find(i => i.vehicleId === vehicleId && i.status === "ACTIVE") ?? fail(503, "Inspection state is unavailable. Check-in remains blocked.");
    inspection.numberOfBlockedCheckInAttempts++; state.updatedAt = eventTime(state, now);
    return { blocked: true }; // Commit the counter before returning HTTP 423.
  }
  if (vehicle.status === "OUT_OF_SERVICE") fail(409, "Vehicle is out of service.");
  if (state.checkIns.some(j => j.userId === actor.id && j.status === "ACTIVE")) fail(409, "Check out of your active vehicle first.");
  const checkIn: VehicleCheckIn = {
    id: randomUUID(), userId: actor.id, vehicleId, cityId: vehicle.cityId, lineId: vehicle.lineId,
    checkInTime: eventTime(state, now), checkOutTime: null, status: "ACTIVE", requestId,
  };
  state.checkIns.unshift(checkIn); state.updatedAt = checkIn.checkInTime;
  return { checkIn };
}
export function checkOutVehicle(state: TransportState, actor: DemoActor, id: string, now?: number) {
  if (actor.role !== "USER") fail(403, "Only Passengers may check out.");
  const checkIn = state.checkIns.find(j => j.id === id) ?? fail(404, "Check-in not found.");
  if (checkIn.userId !== actor.id) fail(403, "This check-in belongs to another passenger.");
  if (checkIn.status === "CHECKED_OUT") return checkIn;
  // Deliberately no vehicle-lock check: existing passengers can ALWAYS exit.
  checkIn.status = "CHECKED_OUT"; checkIn.checkOutTime = eventTime(state, now); state.updatedAt = checkIn.checkOutTime;
  return checkIn;
}