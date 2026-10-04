import { test } from "node:test";
import assert from "node:assert/strict";
import { build } from "esbuild";

const moduleFor = async file => {
  const result = await build({ entryPoints: [new URL(file, import.meta.url).pathname], bundle: true, write: false, platform: "node", format: "esm" });
  return import(`data:text/javascript;base64,${Buffer.from(result.outputFiles[0].text).toString("base64")}`);
};
const domain = await moduleFor("../src/lib/transport-domain.ts");
const { mockTransport, GtfsTransportDataProvider, GtfsRealtimeTransportDataProvider } = await moduleFor("../src/lib/transport-providers.ts");
const stateFor = () => ({ version: 1, vehicles: structuredClone(mockTransport.vehicles), inspections: [], checkIns: [], updatedAt: new Date(0).toISOString() });
const passengerA = { id: "test-a", role: "USER" }, passengerB = { id: "test-b", role: "USER" };
const staff = { id: "test-staff", role: "CONDUCTOR" }, admin = { id: "test-admin", role: "ADMIN" };
const v1 = "krakow-tram-14-0-TR-142", v2 = "krakow-tram-14-0-TR-186";

test("locking one physical tram leaves other vehicles on the same line available", () => {
  const state = stateFor();
  const a = domain.checkInVehicle(state, passengerA, v1, "checkin-a");
  const inspection = domain.startInspection(state, staff, v1, "inspect-1", mockTransport.lines);
  assert.equal(inspection.numberOfPassengersAlreadyCheckedIn, 1);
  assert.equal(a.checkIn.status, "ACTIVE");
  assert.ok(Date.parse(a.checkIn.checkInTime) < Date.parse(inspection.startedAt));
  assert.deepEqual(domain.checkInVehicle(state, passengerB, v1, "blocked-1"), { blocked: true });
  assert.equal(state.checkIns.length, 1);
  assert.equal(inspection.numberOfBlockedCheckInAttempts, 1);
  assert.equal(domain.checkInVehicle(state, passengerB, v2, "checkin-b").checkIn.vehicleId, v2);
});
test("check-out works during inspection and ending reopens immediately without rewriting old tickets", () => {
  const state = stateFor();
  const ticket = domain.checkInVehicle(state, passengerA, v1, "checkin-a").checkIn;
  const originalTime = ticket.checkInTime;
  const inspection = domain.startInspection(state, staff, v1, "inspect-1", mockTransport.lines);
  domain.checkOutVehicle(state, passengerA, ticket.id);
  assert.equal(ticket.status, "CHECKED_OUT");
  assert.equal(ticket.checkInTime, originalTime);
  domain.endInspection(state, staff, inspection.id);
  assert.equal(inspection.status, "FINISHED");
  assert.ok(inspection.endedAt);
  assert.equal(domain.checkInVehicle(state, passengerA, v1, "checkin-new").checkIn.status, "ACTIVE");
});
test("roles, ownership and server-derived identity protect mutations", () => {
  const state = stateFor();
  assert.throws(() => domain.startInspection(state, passengerA, v1, "no-role", mockTransport.lines), e => e.status === 403);
  const inspection = domain.startInspection(state, staff, v1, "inspect-1", mockTransport.lines);
  assert.throws(() => domain.endInspection(state, { id: "other-staff", role: "CONDUCTOR" }, inspection.id), e => e.status === 403);
  assert.throws(() => domain.endInspection(state, passengerA, inspection.id), e => e.status === 403);
  domain.endInspection(state, admin, inspection.id);
  const ticket = domain.checkInVehicle(state, passengerA, v1, "checkin-a").checkIn;
  assert.throws(() => domain.checkOutVehicle(state, passengerB, ticket.id), e => e.status === 403);
  assert.throws(() => domain.checkInVehicle(state, staff, v1, "staff-in"), e => e.status === 403);
  assert.equal(ticket.userId, passengerA.id);
});
test("idempotent successes do not duplicate check-ins, locks, history or end times", () => {
  const state = stateFor();
  const ticket = domain.checkInVehicle(state, passengerA, v1, "repeat-in").checkIn;
  assert.equal(domain.checkInVehicle(state, passengerA, v1, "repeat-in").checkIn.id, ticket.id);
  const inspection = domain.startInspection(state, staff, v1, "repeat-lock", mockTransport.lines);
  assert.equal(domain.startInspection(state, staff, v1, "repeat-lock", mockTransport.lines).id, inspection.id);
  assert.equal(state.inspections.length, 1);
  // A replay of a successful pre-inspection check-in isn't a new blocked check-in.
  assert.equal(domain.checkInVehicle(state, passengerA, v1, "repeat-in").checkIn.id, ticket.id);
  assert.equal(inspection.numberOfBlockedCheckInAttempts, 0);
  domain.endInspection(state, staff, inspection.id);
  const end = inspection.endedAt;
  domain.endInspection(state, staff, inspection.id);
  assert.equal(inspection.endedAt, end);
  assert.throws(() => domain.checkInVehicle(state, passengerA, v2, "repeat-in"), e => e.status === 409);
});
test("out-of-service and unknown vehicles fail without creating a journey or inspection", () => {
  const state = stateFor();
  state.vehicles.find(v => v.id === v1).status = "OUT_OF_SERVICE";
  assert.throws(() => domain.startInspection(state, staff, v1, "inspect-1", mockTransport.lines), e => e.status === 409);
  assert.throws(() => domain.checkInVehicle(state, passengerA, v1, "checkin-a"), e => e.status === 409);
  assert.throws(() => domain.checkInVehicle(state, passengerA, "unknown", "checkin-a"), e => e.status === 404);
  assert.equal(state.checkIns.length, 0);
  assert.equal(state.inspections.length, 0);
});
test("events in the same millisecond remain strictly ordered", () => {
  const state = stateFor();
  const checkIn = domain.checkInVehicle(state, passengerA, v1, "checkin-a", 1000).checkIn;
  const inspection = domain.startInspection(state, staff, v1, "inspect-1", mockTransport.lines, 1000);
  assert.ok(Date.parse(checkIn.checkInTime) < Date.parse(inspection.startedAt));
});
test("all configured cities expose only configured types, and line direction isn't a vehicle", async () => {
  assert.equal((await mockTransport.getTransportTypes("krakow")).includes("METRO"), false);
  assert.equal((await mockTransport.getTransportTypes("warszawa")).includes("METRO"), true);
  assert.equal((await mockTransport.getTransportTypes("gdynia")).includes("TROLLEYBUS"), true);
  const lines = await mockTransport.getLines("krakow", "TRAM");
  assert.deepEqual(lines.map(l => l.direction), ["Mistrzejowice", "Bronowice"]);
  assert.equal((await mockTransport.getVehicles(lines[0].id)).length, 3);
  assert.equal(await mockTransport.getVehiclePosition(v1), null);
});
test("GTFS and realtime adapters expose cached/demo fallback explicitly", async () => {
  const city = mockTransport.catalog().cities[0];
  let fail = false;
  const feed = { lines: mockTransport.lines, vehicles: mockTransport.vehicles, stops: [], trips: [], stopTimes: [] };
  const live = new GtfsTransportDataProvider(city, mockTransport, async () => { if (fail) throw Error(); return feed; });
  await live.getVehicles("krakow-tram-14-0"); assert.equal(live.source, "LIVE");
  fail = true;
  assert.equal((await live.getVehicles("krakow-tram-14-0")).length, 3);
  assert.equal(live.source, "CACHED");
  const unavailable = new GtfsTransportDataProvider(city, mockTransport, async () => { throw Error(); });
  assert.equal((await unavailable.getVehicles("krakow-tram-14-0")).length, 3);
  assert.equal(unavailable.source, "MOCK");
  let offline = false;
  const realtime = new GtfsRealtimeTransportDataProvider(async () => {
    if (offline) throw Error(); return { vehiclePositions: [], tripUpdates: [], serviceAlerts: [] };
  });
  await realtime.getFeed(); assert.equal(realtime.source, "LIVE");
  offline = true; await realtime.getFeed(); assert.equal(realtime.source, "CACHED");
});