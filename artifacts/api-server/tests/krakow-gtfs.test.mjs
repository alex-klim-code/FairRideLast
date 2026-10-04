import { test } from "node:test";
import assert from "node:assert/strict";
import { build } from "esbuild";
import { zipSync, strToU8 } from "fflate";
import bindings from "gtfs-realtime-bindings";

const moduleFor = async file => {
  const path = new URL("../package.json", import.meta.url).pathname;
  const result = await build({ entryPoints: [new URL(file, import.meta.url).pathname], bundle: true, write: false,
    platform: "node", format: "esm", banner: { js: `import {createRequire as __testRequire} from 'node:module'; const require = __testRequire(${JSON.stringify(path)});` } });
  return import(`data:text/javascript;base64,${Buffer.from(result.outputFiles[0].text).toString("base64")}`);
};
const gtfs = await moduleFor("../src/lib/krakow-gtfs.ts");
const domain = await moduleFor("../src/lib/transport-domain.ts");
const service = await moduleFor("../src/lib/transport-feed-service.ts");
const now = Date.now();
const zip = (extra = {}) => zipSync(Object.fromEntries(Object.entries({
  "routes.txt": 'route_id,route_short_name,route_type\nr1,14,900\n',
  "trips.txt": 'trip_id,route_id,service_id,trip_headsign,direction_id\nt1,r1,s1,"Bronowice, pętla",0\nt2,r1,s1,Mistrzejowice,1\n',
  "stops.txt": 'stop_id,stop_name,stop_lat,stop_lon\ns1,"Rondo, Mogilskie",50.06,19.96\n',
  "stop_times.txt": 'trip_id,stop_id,stop_sequence,arrival_time,departure_time\nt1,s1,1,25:01:00,25:02:00\n',
  ...extra,
}).map(([key, value]) => [key, strToU8(value)])));
const protobuf = (options = {}) => {
  const { timestamp = now, tripId = "t1", vehicleId = "real-142", position = { latitude: 50.065, longitude: 19.965 },
    vehicleTime = timestamp, incrementality = 0 } = options;
  return bindings.transit_realtime.FeedMessage.encode({
    header: { gtfsRealtimeVersion: "2.0", timestamp: Math.floor(timestamp / 1000), incrementality },
    entity: [
      { id: "entity-changes-with-trip", vehicle: {
        vehicle: { id: vehicleId, label: "142", licensePlate: "RF142" }, trip: { tripId },
        position, timestamp: Math.floor(vehicleTime / 1000), stopId: "s1",
      } },
      { id: "update", tripUpdate: { trip: { tripId: "cancelled-trip", scheduleRelationship: 3 }, delay: 50 } },
      { id: "alert", alert: { informedEntity: [{ routeId: "r1" }],
        descriptionText: { translation: [{ text: "Zmiana trasy", language: "pl" }] } } },
    ],
  }).finish();
};
const schedule = gtfs.parseStaticZip(zip(), "T");

test("ZIP/CSV decodes quoted Polish headsigns, extended route types, stops and times after midnight", () => {
  assert.equal(schedule.lines.length, 2);
  assert.equal(schedule.lines[0].transportType, "TRAM");
  assert.equal(schedule.lines[0].direction, "Bronowice, pętla");
  assert.equal(schedule.stopTimes[0].arrivalTime, "25:01:00");
  assert.equal(schedule.stops[0].name, "Rondo, Mogilskie");
  assert.equal(schedule.vehicles.length, 0); // A timetable never invents a physical vehicle.
  assert.throws(() => gtfs.parseStaticZip(zip({ "routes.txt": "wrong\n1\n" }), "T"), /columns/);
  assert.throws(() => gtfs.parseStaticZip(new Uint8Array([1, 2]), "T"));
});
test("runtime schedule loader validates all stop-time rows without keeping a planner in memory", async () => {
  const feed = await gtfs.loadFleetSchedule(zip(), "T");
  assert.deepEqual(feed.lines, schedule.lines);
  assert.equal(feed.stopTimes.length, 0);
  await assert.rejects(() => gtfs.loadFleetSchedule(zip({ "stop_times.txt": "wrong\n1\n" }), "T"), /columns/);
});
test("protobuf maps actual vehicles, stop names, delays and Polish service alerts", () => {
  const rt = gtfs.parseRealtime(protobuf());
  const [v] = gtfs.vehiclesFromFeed("T", schedule, rt, now, true);
  assert.equal(v.vehicleNumber, "RF142");
  assert.equal(v.currentStopName, "Rondo, Mogilskie");
  assert.equal(v.status, "ACTIVE");
  assert.ok(Math.abs(v.latitude - 50.065) < 0.00001);
  assert.equal(rt.tripUpdates[0].delaySeconds, 50);
  assert.equal(rt.tripUpdates[0].cancelled, true);
  assert.equal(rt.serviceAlerts[0].description, "Zmiana trasy");
  assert.throws(() => gtfs.parseRealtime(protobuf({ incrementality: 1 })), /Unsupported/);
});
test("physical IDs stay stable across lines and distinct across operator datasets", () => {
  const v1 = gtfs.vehiclesFromFeed("T", schedule, gtfs.parseRealtime(protobuf()), now, true)[0];
  const v2 = gtfs.vehiclesFromFeed("T", schedule, gtfs.parseRealtime(protobuf({ tripId: "t2" })), now, true)[0];
  assert.equal(v1.id, v2.id);
  assert.notEqual(v1.lineId, v2.lineId);
  assert.notEqual(gtfs.ns("A", "vehicle:real-142"), v1.id);
  assert.equal(gtfs.vehiclesFromFeed("T", schedule, gtfs.parseRealtime(protobuf({ tripId: "unknown" })), now, true).length, 0);
});
test("missing/invalid/stale coordinates never become demo or stop coordinates", () => {
  for (const position of [null, { latitude: 91, longitude: 20 }, { latitude: 50 }, { latitude: 0, longitude: 0 }]) {
    const v = gtfs.vehiclesFromFeed("T", schedule, gtfs.parseRealtime(protobuf({ position })), now, true)[0];
    assert.equal(v.latitude, null); assert.equal(v.longitude, null);
  }
  const stale = gtfs.vehiclesFromFeed("T", schedule, gtfs.parseRealtime(protobuf({ vehicleTime: now - 180_000 })), now, true)[0];
  assert.equal(stale.latitude, null); assert.equal(stale.status, "OUT_OF_SERVICE");
  const cached = gtfs.vehiclesFromFeed("T", schedule, gtfs.parseRealtime(protobuf()), now, false)[0];
  assert.equal(cached.latitude, null); assert.equal(cached.status, "OUT_OF_SERVICE");
});
test("feed failure transitions LIVE → CACHED → UNAVAILABLE without relabelling an old timestamp", async () => {
  let fail = false, count = 0;
  const feed = new service.TimedFeed("krakow", "T", "VEHICLES", "official", 30_000, 120_000, 600_000,
    async () => { count++; if (fail) throw new Error("offline"); return { timestamp: now }; }, value => value.timestamp);
  await Promise.all([feed.refresh(now), feed.refresh(now)]);
  assert.equal(count, 1);
  assert.equal(feed.read(now).health.source, "LIVE");
  fail = true; await feed.refresh(now + 31_000);
  assert.equal(feed.read(now + 31_000).health.source, "CACHED");
  assert.equal(feed.read(now + 31_000).health.feedTimestamp, new Date(now).toISOString());
  assert.equal(feed.read(now + 601_000).health.source, "UNAVAILABLE");
  assert.equal(feed.read(now + 601_000).value, null);
  const cold = new service.TimedFeed("krakow", "A", "STATIC", "official", 21_600_000, 86_400_000, 604_800_000,
    async () => { throw new Error("offline"); }, () => now);
  await cold.refresh(now); assert.equal(cold.read(now).health.source, "UNAVAILABLE");
});
test("stale successful downloads, future timestamps and expired schedules are not LIVE", async () => {
  const stale = new service.TimedFeed("krakow", "T", "TRIPS", "official", 1, 120_000, 600_000,
    async () => ({ time: now - 180_000 }), v => v.time);
  await stale.refresh(now);
  assert.equal(stale.read(now).health.source, "CACHED");
  const future = new service.TimedFeed("krakow", "T", "TRIPS", "official", 1, 120_000, 600_000,
    async () => ({ time: now + 60_000 }), v => v.time);
  await future.refresh(now); assert.equal(future.read(now).health.source, "UNAVAILABLE");
  const expired = new service.TimedFeed("krakow", "T", "STATIC", "official", 1, 120_000, 600_000,
    async () => ({ end: now - 1 }), () => now, v => v.end);
  await expired.refresh(now); assert.equal(expired.read(now).health.source, "UNAVAILABLE");
});
test("sync preserves active locks, historical line identities and physical IDs on disappearance and return", () => {
  const [v] = gtfs.vehiclesFromFeed("T", schedule, gtfs.parseRealtime(protobuf()), now, true);
  const state = { version: 1, vehicles: [], lines: [], inspections: [], checkIns: [], updatedAt: new Date(0).toISOString() };
  domain.syncTransportFleet(state, [v], schedule.lines, now);
  const actor = { id: "staff", role: "CONDUCTOR" };
  const passenger = { id: "passenger", role: "USER" };
  const checkIn = domain.checkInVehicle(state, passenger, v.id, "checkin-1").checkIn;
  const inspection = domain.startInspection(state, actor, v.id, "inspection-1", schedule.lines);
  const oldLine = inspection.lineId;
  const [moved] = gtfs.vehiclesFromFeed("T", schedule, gtfs.parseRealtime(protobuf({ tripId: "t2" })), now, true);
  domain.syncTransportFleet(state, [moved], schedule.lines, now + 1);
  assert.equal(state.vehicles[0].status, "CHECK_IN_LOCKED");
  assert.equal(inspection.lineId, oldLine);
  assert.equal(checkIn.lineId, oldLine);
  domain.syncTransportFleet(state, [], [], now + 2);
  assert.equal(state.vehicles[0].status, "CHECK_IN_LOCKED");
  assert.equal(state.lines.length, 2);
  domain.checkOutVehicle(state, passenger, checkIn.id);
  domain.endInspection(state, actor, inspection.id);
  assert.equal(state.vehicles[0].status, "OUT_OF_SERVICE");
  domain.syncTransportFleet(state, [moved], schedule.lines, now + 3);
  assert.equal(state.vehicles.length, 1);
  assert.equal(state.vehicles[0].status, "ACTIVE");
  domain.syncTransportFleet(state, [], [], now + 2); // Older concurrent snapshot is ignored.
  assert.equal(state.vehicles[0].status, "ACTIVE");
});
test("all three official dataset providers use ZIP/protobuf and partial failures never inject demo vehicles", async () => {
  const fetchBefore = globalThis.fetch;
  globalThis.fetch = async url => {
    assert.ok(String(url).startsWith(gtfs.KRAKOW_FEED_BASE));
    if (String(url).includes("_M.")) return new Response(null, { status: 503 });
    return new Response(String(url).endsWith(".zip") ? zip() : protobuf());
  };
  try {
    const provider = new service.KrakowTransportDataProvider();
    await provider.refresh();
    const snapshot = await provider.snapshot();
    assert.equal(snapshot.catalog.feeds.length, 12);
    assert.equal(snapshot.catalog.source, "CACHED");
    assert.equal(snapshot.vehicles.length, 2);
    assert.ok(snapshot.vehicles.every(v => v.id.startsWith("krakow-ztp-")));
    assert.equal(snapshot.catalog.feeds.find(f => f.dataset === "M").source, "UNAVAILABLE");
    assert.equal(snapshot.catalog.feeds.find(f => f.dataset === "T").source, "LIVE");
    await service.cityProviders.get("krakow").refresh();
    const registry = await service.transportSnapshot();
    assert.ok(registry.catalog.cities.some(c => c.id === "krakow-demo" && c.dataProvider === "MOCK"));
    assert.ok(registry.vehicles.some(v => v.cityId === "krakow-demo"));
    assert.ok(registry.vehicles.filter(v => v.cityId === "krakow").every(v => v.id.startsWith("krakow-ztp-")));
    const demo = service.cityProviders.get("krakow-demo");
    assert.ok((await demo.getLines("krakow-demo", "TRAM")).every(l => l.cityId === "krakow-demo"));
    assert.equal(await demo.getVehiclePosition("krakow-tram-14-0-TR-142"), null);
  } finally { globalThis.fetch = fetchBefore; }
});
test("a cold outage leaves real Kraków unavailable and never relabels the demo as live", async () => {
  const before = globalThis.fetch;
  globalThis.fetch = async () => { throw new Error("offline"); };
  try {
    const provider = new service.KrakowTransportDataProvider();
    await provider.refresh();
    const snapshot = await provider.snapshot();
    assert.equal(snapshot.catalog.source, "UNAVAILABLE");
    assert.equal(snapshot.vehicles.length, 0);
    assert.ok(snapshot.catalog.feeds.every(f => f.source === "UNAVAILABLE"));
  } finally { globalThis.fetch = before; }
});
test("download bounds and fixed-host validation reject malformed or untrusted sources", async () => {
  await assert.rejects(() => gtfs.downloadFeed("https://example.com/feed"), /Untrusted/);
  const before = globalThis.fetch;
  globalThis.fetch = async () => new Response(new Uint8Array(100));
  try { await assert.rejects(() => gtfs.downloadFeed(`${gtfs.KRAKOW_FEED_BASE}test`, 20), /too large/); }
  finally { globalThis.fetch = before; }
});