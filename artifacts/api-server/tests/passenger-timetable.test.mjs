import { test } from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { zipSync, strToU8 } from 'fflate';
import bindings from 'gtfs-realtime-bindings';

async function moduleFor(file) {
  const result = await build({ entryPoints: [new URL(file, import.meta.url).pathname], bundle: true, write: false,
    platform: 'node', format: 'esm',
    banner: { js: `import {createRequire as __timetableRequire} from 'node:module'; const require = __timetableRequire(${JSON.stringify(new URL('../package.json', import.meta.url).pathname)});` } });
  return import(`data:text/javascript;base64,${Buffer.from(result.outputFiles[0].text).toString('base64')}`);
}
const gtfs = await moduleFor('../src/lib/krakow-gtfs.ts');
const timetable = await moduleFor('../src/lib/passenger-timetable.ts');
function archive(dataset = 'A', extra = {}) {
  const files = {
    'routes.txt': `route_id,route_type,route_short_name\nr,${dataset === 'T' ? 0 : 3},${dataset === 'T' ? 8 : 124}\n`,
    'trips.txt': 'route_id,service_id,trip_id,trip_headsign\nr,weekday,day,Dworzec\nr,weekday,night,Dworzec\nr,weekend,removed,Dworzec\nr,weekday,noPickup,Dworzec\n',
    'stops.txt': 'stop_id,stop_name,stop_lat,stop_lon\ns,Rondo,50.065,19.965\nend,Koniec,50.066,19.966\n',
    'stop_times.txt': 'trip_id,stop_id,stop_sequence,arrival_time,departure_time,pickup_type\nday,s,1,12:05:00,12:05:00,0\nnight,s,1,25:15:00,25:15:00,0\nremoved,s,1,12:10:00,12:10:00,0\nnoPickup,end,1,12:05:00,12:05:00,1\n',
    'calendar.txt': 'service_id,monday,tuesday,wednesday,thursday,friday,saturday,sunday,start_date,end_date\nweekday,1,1,1,1,1,0,0,20261001,20261031\nweekend,0,0,0,0,0,1,1,20261001,20261031\n',
    'calendar_dates.txt': 'service_id,date,exception_type\nweekday,20261004,1\nweekend,20261004,2\n',
    ...extra,
  };
  return zipSync(Object.fromEntries(Object.entries(files).map(([name, content]) => [name, strToU8(content)])));
}
const feed = await gtfs.loadFleetSchedule(archive(), 'A', true);
const registry = timetable.passengerStops([feed]), stop = [...registry.values()][0];

test('passenger index retains compact times, omits no-pickup stops, and exposes real lines', () => {
  assert.equal(feed.stopTimes.length, 0);
  assert.ok(feed.departuresByStop.get(gtfs.ns('A', 's')) instanceof Uint32Array);
  assert.equal(registry.size, 1);
  assert.deepEqual(stop.stop.lines, ['124']);
  assert.deepEqual(stop.stop.transportTypes, ['BUS']);
});
test('calendar weekdays and explicit service exceptions determine departures', () => {
  const normal = timetable.scheduledDepartures(stop, Date.parse('2026-10-05T11:58:00+02:00'));
  assert.equal(normal.length, 1); assert.equal(normal[0].departureTime, '2026-10-05T10:05:00.000Z');
  const sunday = timetable.scheduledDepartures(stop, Date.parse('2026-10-04T11:58:00+02:00'));
  assert.equal(sunday.length, 1); assert.equal(sunday[0].lineNumber, '124');
  assert.ok(sunday[0].id.includes(':day:'));
  assert.equal(timetable.scheduledDepartures(stop, Date.parse('2026-10-03T11:58:00+02:00'))[0].id.includes(':removed:'), true);
});
test('25-hour times use previous service date after midnight, not today service', () => {
  const result = timetable.scheduledDepartures(stop, Date.parse('2026-10-05T00:45:00+02:00'));
  assert.equal(result.length, 1);
  assert.equal(result[0].departureTime, '2026-10-04T23:15:00.000Z');
  assert.ok(result[0].id.includes(':20261004:'));
});
test('upcoming window includes next service day across midnight and omits passed times', () => {
  assert.equal(timetable.scheduledDepartures(stop, Date.parse('2026-10-05T12:06:00+02:00')).length, 0);
  assert.equal(timetable.localServiceDate(Date.parse('2026-10-04T23:30:00Z')), '20261005');
});
test('shared A/M platform merges and duplicated scheduled departures are suppressed', async () => {
  const second = await gtfs.loadFleetSchedule(archive('M'), 'M', true);
  const both = timetable.passengerStops([feed, second]);
  assert.equal(both.size, 1);
  assert.equal(timetable.scheduledDepartures([...both.values()][0], Date.parse('2026-10-05T11:58:00+02:00')).length, 1);
});
test('bus and tram departures share platform while preserving actual transport type', async () => {
  const tram = await gtfs.loadFleetSchedule(archive('T'), 'T', true);
  const both = timetable.passengerStops([feed, tram]), station = [...both.values()][0];
  assert.deepEqual(station.stop.transportTypes.sort(), ['BUS', 'TRAM']);
  assert.deepEqual(timetable.scheduledDepartures(station, Date.parse('2026-10-05T11:58:00+02:00')).map(d => d.lineNumber).sort(), ['124', '8']);
});
test('service-day anchors respect Warsaw DST, not a hard-coded +02 offset', () => {
  assert.equal(new Date(timetable.serviceDayStart('20261025')).toISOString(), '2026-10-24T23:00:00.000Z');
  assert.equal(new Date(timetable.serviceDayStart('20260329')).toISOString(), '2026-03-28T22:00:00.000Z');
  assert.equal(new Date(timetable.serviceDayStart('20261201') + 12 * 3600000).toISOString(), '2026-12-01T11:00:00.000Z');
});
test('expiry permits the last service day overnight departure and geo filter uses metres', () => {
  const last = { ...feed, calendars: [], calendarDates: [{ service_id: 'weekday', date: '20261004', exception_type: '1' }] };
  assert.equal(new Date(timetable.passengerScheduleExpiry(last)).toISOString(), '2026-10-04T23:15:00.000Z');
  assert.equal(timetable.stopDistance(50.065, 19.965, stop.stop), 0);
  assert.ok(timetable.stopDistance(50.075, 19.965, stop.stop) > 1100);
});

const rtNow = Date.parse('2026-10-04T12:04:00+02:00');
function realtimeAt(now, update = {}, sourceTimestamp = now) {
  return gtfs.parseRealtime(bindings.transit_realtime.FeedMessage.encode({
    header: { gtfsRealtimeVersion: '2.0', timestamp: sourceTimestamp / 1000 },
    entity: [{ id: 'actual-update', tripUpdate: {
      trip: { tripId: 'day', startDate: '20261004' },
      stopTimeUpdate: [{ stopId: 's', stopSequence: 1, departure: { delay: 180 } }],
      ...update,
    } }],
  }).finish());
}
const predict = (rt, now = rtNow, station = stop, schedule = feed) =>
  timetable.scheduledDepartures(station, now, 120, new Map([[schedule, rt]]));

test('fresh stop prediction exposes planned and expected times and actual delay separately', () => {
  const [d] = predict(realtimeAt(rtNow));
  assert.equal(d.status, 'UPDATED');
  assert.equal(d.scheduledDepartureTime, '2026-10-04T10:05:00.000Z');
  assert.equal(d.departureTime, d.scheduledDepartureTime);
  assert.equal(d.expectedDepartureTime, '2026-10-04T10:08:00.000Z');
  assert.equal(d.delaySeconds, 180);
  assert.equal(d.realtimeUpdatedAt, new Date(rtNow).toISOString());
});
test('absolute departure overrides delay; negative and explicit zero delays are supported', () => {
  const absolute = realtimeAt(rtNow, { stopTimeUpdate: [{ stopId: 's', departure: { time: (rtNow + 180000) / 1000, delay: 900 } }] });
  assert.equal(predict(absolute)[0].delaySeconds, 120);
  for (const delay of [0, -30]) {
    const d = predict(realtimeAt(rtNow, { stopTimeUpdate: [{ stopSequence: 1, departure: { delay } }] }))[0];
    assert.equal(d.status, 'UPDATED'); assert.equal(d.delaySeconds, delay);
  }
});
test('ZTP A zero-time departure placeholder does not mask its real arrival delay', () => {
  const rt = realtimeAt(rtNow, { stopTimeUpdate: [{
    stopId: 's', stopSequence: 1, departure: { time: 0, delay: 0 },
    arrival: { time: (rtNow + 321000) / 1000, delay: 261 },
  }] });
  assert.equal(rt.tripUpdates[0].stops[0].departureTime, undefined);
  assert.equal(rt.tripUpdates[0].stops[0].departureDelay, undefined);
  assert.equal(predict(rt)[0].delaySeconds, 261);
  const nonzero = realtimeAt(rtNow, { stopTimeUpdate: [{
    stopId: 's', departure: { time: 0, delay: 90 },
  }] });
  assert.equal(predict(nonzero)[0].delaySeconds, 90);
});
test('fresh trip cancellation and skipped stop are distinct; NO_DATA suppresses a trip delay', () => {
  const cancelled = predict(realtimeAt(rtNow, { trip: { tripId: 'day', startDate: '20261004', scheduleRelationship: 3 }, stopTimeUpdate: [] }))[0];
  assert.equal(cancelled.status, 'CANCELLED'); assert.equal(cancelled.expectedDepartureTime, null);
  const skipped = predict(realtimeAt(rtNow, { stopTimeUpdate: [{ stopId: 's', scheduleRelationship: 1 }] }))[0];
  assert.equal(skipped.status, 'SKIPPED');
  const noData = predict(realtimeAt(rtNow, { delay: 500, stopTimeUpdate: [{ stopId: 's', scheduleRelationship: 2 }] }))[0];
  assert.equal(noData.status, 'SCHEDULED'); assert.equal(noData.realtimeUpdatedAt, null);
});
test('expired header, expired individual update, future timestamp and missing prediction are not live', () => {
  for (const rt of [
    realtimeAt(rtNow, {}, rtNow - 121000),
    realtimeAt(rtNow, { timestamp: (rtNow - 121000) / 1000 }),
    realtimeAt(rtNow, {}, rtNow + 31000),
    realtimeAt(rtNow, { stopTimeUpdate: [] }),
    realtimeAt(rtNow, { stopTimeUpdate: [{ stopId: 's', arrival: { time: (rtNow + 180000) / 1000 } }] }),
  ]) {
    const d = predict(rt)[0];
    assert.equal(d.status, 'SCHEDULED'); assert.equal(d.expectedDepartureTime, null);
    assert.equal(d.delaySeconds, null); assert.equal(d.realtimeUpdatedAt, null);
  }
  assert.equal(timetable.scheduledDepartures(stop, rtNow)[0].status, 'SCHEDULED');
});
test('descriptor date, trip, start time and stop identity must match; unsupported added trips stay scheduled', () => {
  for (const trip of [
    { tripId: 'day', startDate: '20261005' }, { tripId: 'unknown', startDate: '20261004' },
    { tripId: 'day', startDate: '20261004', startTime: '13:00:00' },
    { tripId: 'day', startDate: '20261004', scheduleRelationship: 1 },
  ]) assert.equal(predict(realtimeAt(rtNow, { trip }))[0].status, 'SCHEDULED');
  for (const stopTimeUpdate of [
    [{ stopId: 'other', departure: { delay: 180 } }],
    [{ stopId: 's', stopSequence: 99, departure: { delay: 180 } }],
  ]) assert.equal(predict(realtimeAt(rtNow, { stopTimeUpdate }))[0].status, 'SCHEDULED');
  assert.equal(predict(realtimeAt(rtNow, { trip: { tripId: 'day', startDate: '20261004', startTime: '12:05:00' } }))[0].status, 'UPDATED');
});
test('overnight prediction joins the previous service date and its calendar exception', () => {
  const now = Date.parse('2026-10-05T00:45:00+02:00');
  const rt = realtimeAt(now, { trip: { tripId: 'night', startDate: '20261004' } });
  const [night] = predict(rt, now);
  assert.equal(night.status, 'UPDATED'); assert.equal(night.expectedDepartureTime, '2026-10-04T23:18:00.000Z');
  assert.equal(predict(realtimeAt(now, { trip: { tripId: 'night', startDate: '20261005' } }), now)[0].status, 'SCHEDULED');
  assert.equal(predict(realtimeAt(now, { trip: { tripId: 'night' } }), now)[0].status, 'UPDATED');
  const saturday = Date.parse('2026-10-03T12:04:00+02:00');
  const d = predict(realtimeAt(saturday, { trip: { tripId: 'day', startDate: '20261003', scheduleRelationship: 3 } }), saturday)[0];
  assert.equal(d.status, 'SCHEDULED'); assert.ok(d.id.includes(':removed:'));
});
test('late departures remain visible after planned time, disappear after predicted time, and sort by expected time', () => {
  const now = rtNow + 120000;
  assert.equal(predict(realtimeAt(now), now)[0].status, 'UPDATED');
  assert.equal(predict(realtimeAt(now + 240000), now + 240000).length, 0);
});
test('identical trip IDs in another dataset cannot borrow its realtime update', async () => {
  const other = await gtfs.loadFleetSchedule(archive('M'), 'M', true);
  assert.equal(predict(realtimeAt(rtNow), rtNow, stop, other)[0].status, 'SCHEDULED');
  const merged = [...timetable.passengerStops([other, feed]).values()][0];
  assert.equal(predict(realtimeAt(rtNow), rtNow, merged)[0].status, 'UPDATED');
});
test('repeated stop is joined by sequence, not ambiguously by stop ID', async () => {
  const loop = await gtfs.loadFleetSchedule(archive('A', {
    'stop_times.txt': 'trip_id,stop_id,stop_sequence,arrival_time,departure_time\nday,s,1,12:05:00,12:05:00\nday,s,5,12:20:00,12:20:00\n',
  }), 'A', true);
  const loopStop = [...timetable.passengerStops([loop]).values()][0];
  const sequence = realtimeAt(rtNow, { stopTimeUpdate: [{ stopId: 's', stopSequence: 5, departure: { delay: 180 } }] });
  const results = predict(sequence, rtNow, loopStop, loop);
  assert.deepEqual(results.map(d => d.status), ['SCHEDULED', 'UPDATED']);
  const ambiguous = realtimeAt(rtNow, { stopTimeUpdate: [{ stopId: 's', departure: { delay: 180 } }] });
  assert.deepEqual(predict(ambiguous, rtNow, loopStop, loop).map(d => d.status), ['SCHEDULED', 'SCHEDULED']);
});
test('upstream delay propagates by sequence but stops at NO_DATA', async () => {
  const downstream = await gtfs.loadFleetSchedule(archive('A', {
    'stop_times.txt': 'trip_id,stop_id,stop_sequence,arrival_time,departure_time\nday,s,3,12:05:00,12:05:00\n',
  }), 'A', true);
  const station = [...timetable.passengerStops([downstream]).values()][0];
  const rt = stops => realtimeAt(rtNow, { stopTimeUpdate: stops });
  const prior = { stopId: 'earlier', stopSequence: 1, departure: { delay: 90 } };
  assert.equal(predict(rt([prior]), rtNow, station, downstream)[0].delaySeconds, 90);
  assert.equal(predict(rt([prior, { stopSequence: 2, scheduleRelationship: 2 }]), rtNow, station, downstream)[0].status, 'SCHEDULED');
});