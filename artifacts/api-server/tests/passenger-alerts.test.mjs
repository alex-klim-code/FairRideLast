import { test } from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { zipSync, strToU8 } from 'fflate';
import bindings from 'gtfs-realtime-bindings';

async function load(file) {
  const result = await build({ entryPoints: [new URL(file, import.meta.url).pathname], bundle: true, write: false,
    platform: 'node', format: 'esm',
    banner: { js: `import {createRequire as __alertsRequire} from 'node:module'; const require=__alertsRequire(${JSON.stringify(new URL('../package.json', import.meta.url).pathname)});` } });
  return import(`data:text/javascript;base64,${Buffer.from(result.outputFiles[0].text).toString('base64')}`);
}
const gtfs = await load('../src/lib/krakow-gtfs.ts');
const tt = await load('../src/lib/passenger-timetable.ts');
const alerts = await load('../src/lib/passenger-alerts.ts');
const files = {
  'agency.txt': 'agency_id,agency_name\nmpk,MPK\n',
  'routes.txt': 'route_id,route_type,route_short_name,agency_id\nr,3,124,mpk\n',
  'trips.txt': 'route_id,service_id,trip_id,trip_headsign,direction_id\nr,s,day,Dworzec,0\nr,s,night,Dworzec,1\n',
  'stops.txt': 'stop_id,stop_name,stop_lat,stop_lon\ns,Rondo,50.065,19.965\n',
  'stop_times.txt': 'trip_id,stop_id,stop_sequence,arrival_time,departure_time\nday,s,1,12:05:00,12:05:00\nnight,s,1,25:15:00,25:15:00\n',
  'calendar.txt': 'service_id,monday,tuesday,wednesday,thursday,friday,saturday,sunday,start_date,end_date\ns,1,1,1,1,1,0,0,20261001,20261031\n',
  'calendar_dates.txt': 'service_id,date,exception_type\ns,20261004,1\n',
};
const archive = zipSync(Object.fromEntries(Object.entries(files).map(([name, content]) => [name, strToU8(content)])));
const feed = await gtfs.loadFleetSchedule(archive, 'A', true);
const stop = [...tt.passengerStops([feed]).values()][0];
const now = Date.parse('2026-10-04T12:00:00+02:00');
function realtime(alert = {}, timestamp = now, extraEntities = []) {
  return gtfs.parseRealtime(bindings.transit_realtime.FeedMessage.encode({
    header: { gtfsRealtimeVersion: '2.0', timestamp: timestamp / 1000 },
    entity: [{ id: 'detour', alert: { headerText: { translation: [{ text: 'Objazd', language: 'pl' }] },
      descriptionText: { translation: [{ text: 'Zamknięty przystanek. Wsiądź przy ulicy obok.', language: 'pl' }] },
      effect: 4, ...alert } }, ...extraEntities],
  }).finish());
}
const read = (rt, at = now, station = stop, map = new Map([[feed, rt]])) =>
  alerts.passengerAlerts(station, tt.scheduledDepartures(station, at), at, map);

test('decoder retains translated headers, exact selectors and bounded/open periods', () => {
  const rt = realtime({
    headerText: { translation: [{ text: 'Detour', language: 'en' }, { text: 'Objazd PL', language: 'pl-PL' }] },
    activePeriod: [{ start: now / 1000, end: now / 1000 + 300 }],
    informedEntity: [{ agencyId: 'mpk', routeId: 'r', routeType: 3, stopId: 's',
      trip: { tripId: 'day', startDate: '20261004', startTime: '12:05:00' } }],
  });
  assert.equal(rt.serviceAlerts[0].title, 'Objazd PL');
  assert.equal(rt.serviceAlerts[0].selectors[0].trip.startDate, '20261004');
  assert.deepEqual(rt.serviceAlerts[0].periods, [{ start: now, end: now + 300000 }]);
});
test('fields within one selector are AND, multiple selectors OR; unknown identifiers do not broaden alerts', () => {
  for (const selector of [{ routeId: 'other' }, { stopId: 'other' }, { agencyId: 'other' }, { routeType: 0 },
    { routeId: 'r', stopId: 'other' }, { trip: { tripId: 'unknown' } }, { directionId: 1, trip: { tripId: 'day' } }]) {
    assert.equal(read(realtime({ informedEntity: [selector] })).alerts.length, 0, JSON.stringify(selector));
  }
  const matched = read(realtime({ informedEntity: [{ routeId: 'other' }, { routeId: 'r', stopId: 's', agencyId: 'mpk', routeType: 3, directionId: 0 }] }));
  assert.equal(matched.alerts.length, 1); assert.equal(matched.alerts[0].departureIds.length, 1);
});
test('general and stop-only alerts survive an empty departure list; never alter check-in or trip status', () => {
  for (const informedEntity of [[], [{}], [{ stopId: 's' }], [{ agencyId: 'mpk' }]]) {
    const rt = realtime({ informedEntity, effect: 1 });
    const result = alerts.passengerAlerts(stop, [], now, new Map([[feed, rt]]));
    assert.equal(result.alerts[0].appliesToStop, true);
    assert.deepEqual(result.alerts[0].departureIds, []);
  }
  const departures = tt.scheduledDepartures(stop, now);
  const original = JSON.stringify(departures);
  alerts.passengerAlerts(stop, departures, now, new Map([[feed, realtime({ effect: 1 })]]));
  assert.equal(JSON.stringify(departures), original);
  assert.equal(departures[0].status, 'SCHEDULED');
});
test('period starts inclusive, ends exclusive, OR ranges, and upcoming affected departure is labelled separately', () => {
  assert.equal(alerts.alertPeriodActive([{ start: now, end: now + 1 }], now), true);
  assert.equal(alerts.alertPeriodActive([{ start: null, end: now }], now), false);
  const result = read(realtime({ activePeriod: [{ start: now / 1000 + 240, end: now / 1000 + 360 }] }));
  assert.equal(result.alerts.length, 1); assert.equal(result.alerts[0].appliesToStop, false);
  assert.equal(result.alerts[0].departureIds.length, 1);
  for (const activePeriod of [[{ end: now / 1000 - 1 }], [{ start: now / 1000 + 8000 }], [{ start: now / 1000 + 1, end: now / 1000 }]]) {
    assert.equal(read(realtime({ activePeriod })).alerts.length, 0);
  }
  assert.equal(read(realtime({ activePeriod: [{ end: now / 1000 - 1 }, { start: now / 1000 - 1 }] })).alerts.length, 1);
});
test('stale or missing feeds cannot show fresh service alerts, even if the active period is long', () => {
  const old = read(realtime({ activePeriod: [{ start: now / 1000 - 1000, end: now / 1000 + 1000 }] }, now - 121000));
  assert.equal(old.alerts.length, 0); assert.equal(old.alertsStatus, 'UNAVAILABLE');
  assert.equal(old.alertsUpdatedAt, null);
  assert.equal(read(realtime(), now, stop, new Map()).alertsStatus, 'UNAVAILABLE');
  assert.equal(read(realtime()).alertsStatus, 'AVAILABLE');
});
test('trip selectors use active service date, including overnight and calendar exceptions', () => {
  assert.equal(read(realtime({ informedEntity: [{ trip: { tripId: 'day', startDate: '20261004' } }] })).alerts.length, 1);
  assert.equal(read(realtime({ informedEntity: [{ trip: { tripId: 'day', startDate: '20261005' } }] })).alerts.length, 0);
  const saturday = Date.parse('2026-10-03T12:00:00+02:00');
  assert.equal(read(realtime({ informedEntity: [{ trip: { tripId: 'day', startDate: '20261003' } }] }, saturday), saturday).alerts.length, 0);
  const night = Date.parse('2026-10-05T00:45:00+02:00');
  const current = date => realtime({ informedEntity: [{ trip: { tripId: 'night', startDate: date } }] }, night);
  assert.equal(read(current('20261004'), night).alerts.length, 1);
  assert.equal(read(current('20261005'), night).alerts.length, 0);
  for (const trip of [{ tripId: 'day', startTime: '13:00:00' }, { tripId: 'day', directionId: 1 }]) {
    assert.equal(read(realtime({ informedEntity: [{ trip }] })).alerts.length, 0);
  }
});
test('a single agency in agency.txt supplies optional route agency ID without inventing unknown agencies', async () => {
  const singleAgency = zipSync(Object.fromEntries(Object.entries({ ...files,
    'routes.txt': 'route_id,route_type,route_short_name\nr,3,124\n',
  }).map(([name, content]) => [name, strToU8(content)])));
  const agencyFeed = await gtfs.loadFleetSchedule(singleAgency, 'A', true);
  const station = [...tt.passengerStops([agencyFeed]).values()][0];
  const rt = realtime({ informedEntity: [{ agencyId: 'mpk' }] });
  assert.equal(read(rt, now, station, new Map([[agencyFeed, rt]])).alerts.length, 1);
  agencyFeed.routeDetails.get('r').agencyId = undefined;
  assert.equal(read(rt, now, station, new Map([[agencyFeed, rt]])).alerts.length, 0);
});
test('identical route/trip identifiers in another dataset stay isolated and feed health can be partial', async () => {
  const second = await gtfs.loadFleetSchedule(archive, 'M', true);
  const secondStop = [...tt.passengerStops([second]).values()][0];
  assert.equal(read(realtime(), now, secondStop).alerts.length, 0);
  const merged = [...tt.passengerStops([feed, second]).values()][0];
  const result = read(realtime({ informedEntity: [{ routeId: 'r' }] }), now, merged);
  assert.equal(result.alertsStatus, 'PARTIAL'); assert.equal(result.alerts[0].dataset, 'A');
});
test('deleted entities, blank text and malformed time bounds do not produce passenger notices', () => {
  const blank = read(realtime({ headerText: { translation: [] }, descriptionText: { translation: [] } }));
  assert.equal(blank.alerts.length, 0);
  const deleted = realtime({}, now, [{ id: 'deleted', isDeleted: true, alert: { headerText: { translation: [{ text: 'Old' }] } } }]);
  assert.equal(deleted.serviceAlerts.length, 1);
  const invalid = realtime();
  invalid.serviceAlerts[0].periods = [{ start: null, end: 1e30 }];
  assert.equal(read(invalid).alerts.length, 0);
});