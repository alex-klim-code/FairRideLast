import { createHash } from 'node:crypto';
import type { StaticFeed, DecodedRealtime } from './krakow-gtfs';
import { departurePrediction, realtimeFresh } from './passenger-realtime';
import type { GetNearbyTransitStopsResponse, GetTransitStopDeparturesResponse } from '@workspace/api-zod';
type PassengerTransitStop = (typeof GetNearbyTransitStopsResponse)['_output']['stops'][number];
type PassengerDeparture = Omit<(typeof GetTransitStopDeparturesResponse)['_output']['departures'][number],
  'departureTime' | 'scheduledDepartureTime' | 'expectedDepartureTime' | 'realtimeUpdatedAt'> & {
  departureTime: string; scheduledDepartureTime: string; expectedDepartureTime: string | null; realtimeUpdatedAt: string | null };

const zone = 'Europe/Warsaw';
const dateFormatter = new Intl.DateTimeFormat('en-CA', { timeZone: zone, year: 'numeric', month: '2-digit', day: '2-digit' });
export function localServiceDate(now: number): string {
  const parts = dateFormatter.formatToParts(now);
  return ['year', 'month', 'day'].map(key => parts.find(p => p.type === key)!.value).join('');
}
export function shiftServiceDate(date: string, days: number): string {
  const d = new Date(Date.UTC(+date.slice(0, 4), +date.slice(4, 6) - 1, +date.slice(6, 8) + days));
  return d.toISOString().slice(0, 10).replaceAll('-', '');
}
// GTFS time is elapsed seconds from local service-day noon minus twelve hours,
// including the DST transition days and values such as 25:15:00.
export function serviceDayStart(date: string): number {
  const noonUtc = Date.UTC(+date.slice(0, 4), +date.slice(4, 6) - 1, +date.slice(6, 8), 12);
  const localHour = +new Intl.DateTimeFormat('en-GB', { timeZone: zone, hour: '2-digit', hourCycle: 'h23' }).format(noonUtc);
  return noonUtc - (localHour - 12) * 3600000 - 12 * 3600000;
}
export function activeServices(feed: Pick<StaticFeed, 'calendars' | 'calendarDates'>, date: string): Set<string> {
  const weekday = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'][
    new Date(Date.UTC(+date.slice(0, 4), +date.slice(4, 6) - 1, +date.slice(6, 8))).getUTCDay()]!;
  const services = new Set(feed.calendars.filter(c => c.start_date! <= date && c.end_date! >= date && c[weekday] === '1').map(c => c.service_id!));
  for (const exception of feed.calendarDates) {
    if (exception.date !== date) continue;
    if (exception.exception_type === '1') services.add(exception.service_id!);
    if (exception.exception_type === '2') services.delete(exception.service_id!);
  }
  return services;
}
export function passengerScheduleExpiry(feed: StaticFeed): number | null {
  const dates = [...feed.calendars.map(c => c.end_date), ...feed.calendarDates.filter(c => c.exception_type === '1').map(c => c.date)]
    .filter((d): d is string => !!d && /^\d{8}$/.test(d)).sort();
  const last = dates.at(-1);
  return last ? serviceDayStart(last) + Math.max(86400, feed.maxDepartureSeconds ?? 0) * 1000 : feed.validThrough;
}
type Member = { feed: StaticFeed; stopId: string };
export type IndexedPassengerStop = { stop: PassengerTransitStop; members: Member[] };
export function passengerStops(feeds: StaticFeed[]): Map<string, IndexedPassengerStop> {
  const result = new Map<string, IndexedPassengerStop>();
  for (const feed of feeds) {
    const lineMap = new Map(feed.lines.map(line => [line.id, line]));
    for (const s of feed.stops) {
      const entries = feed.departuresByStop?.get(s.id);
      if (!entries?.length) continue;
      // Shared platforms in the A/M/T feeds become one clickable marker.
      const rawId = s.id.replace(/^krakow-ztp-[AMT]-/, '');
      const id = createHash('sha256').update(`${rawId}|${s.latitude.toFixed(5)}|${s.longitude.toFixed(5)}`).digest('hex').slice(0, 24);
      const current = result.get(id) ?? { stop: { id, name: s.name, lat: s.latitude, lng: s.longitude, lines: [], transportTypes: [] }, members: [] };
      const numbers = new Set(current.stop.lines), types = new Set(current.stop.transportTypes);
      for (let i = 0; i < entries.length; i += 3) {
        const trip = feed.trips[entries[i]!]!;
        const line = lineMap.get(feed.tripLines.get(trip.id)!);
        if (!line || (line.transportType !== 'BUS' && line.transportType !== 'TRAM')) continue;
        numbers.add(line.number); types.add(line.transportType);
      }
      if (!numbers.size) continue;
      current.stop.lines = [...numbers].sort((a, b) => a.localeCompare(b, 'pl', { numeric: true }));
      current.stop.transportTypes = [...types];
      current.members.push({ feed, stopId: s.id }); result.set(id, current);
    }
  }
  return result;
}
export function scheduledDepartures(index: IndexedPassengerStop, now: number, horizonMinutes = 120,
  realtime = new Map<StaticFeed, DecodedRealtime>()): PassengerDeparture[] {
  const departures: PassengerDeparture[] = [], today = localServiceDate(now);
  for (const { feed, stopId } of index.members) {
    const lines = new Map(feed.lines.map(l => [l.id, l]));
    const entries = feed.departuresByStop?.get(stopId) ?? [];
    const stopVisits = new Map<number, number>();
    for (let i = 0; i < entries.length; i += 3) stopVisits.set(entries[i]!, (stopVisits.get(entries[i]!) ?? 0) + 1);
    const days = [-3, -2, -1, 0, 1].map(offset => {
      const date = shiftServiceDate(today, offset);
      return { date, services: activeServices(feed, date), start: serviceDayStart(date) };
    });
    const rt = realtime.get(feed);
    const updates = new Map<string, DecodedRealtime['tripUpdates']>();
    if (rt && realtimeFresh(rt.timestamp, now)) for (const u of rt.tripUpdates) {
      const values = updates.get(u.tripId) ?? [];
      values.push(u); updates.set(u.tripId, values);
    }
    const rawStopId = decodeURIComponent(stopId.replace(/^krakow-ztp-[AMT]-/, ''));
    for (const { date, services, start } of days) {
      for (let i = 0; i < entries.length; i += 3) {
        const trip = feed.trips[entries[i]!]!;
        if (!services.has(trip.serviceId)) continue;
        const timestamp = start + entries[i + 1]! * 1000;
        // Include a delayed departure whose planned time has already passed.
        if (timestamp < now - 24 * 3600000 || timestamp > now + horizonMinutes * 60000 + 24 * 3600000) continue;
        const line = lines.get(feed.tripLines.get(trip.id)!);
        if (!line || (line.transportType !== 'BUS' && line.transportType !== 'TRAM')) continue;
        const prediction = departurePrediction(updates.get(trip.id) ?? [], date, rawStopId, entries[i + 2]!,
          timestamp, now, days.filter(d => d.services.has(trip.serviceId)).map(d => d.start + entries[i + 1]! * 1000),
          feed.tripStartTimes?.get(trip.id), (stopVisits.get(entries[i]!) ?? 0) > 1);
        const effective = prediction?.expectedDepartureTime ? Date.parse(prediction.expectedDepartureTime) : timestamp;
        if (effective < now || effective > now + horizonMinutes * 60000) continue;
        const planned = new Date(timestamp).toISOString();
        departures.push({ id: `${stopId}:${trip.id}:${date}:${entries[i + 1]}:${entries[i + 2]}`, stopId: index.stop.id,
          tripId: `${stopId}:${trip.id}`, lineName: line.number, lineNumber: line.number,
          transportType: line.transportType, headsign: trip.headsign || line.direction,
          departureTime: planned, scheduledDepartureTime: planned, expectedDepartureTime: null,
          delaySeconds: null, status: 'SCHEDULED', realtimeUpdatedAt: null, ...prediction });
      }
    }
  }
  // Prefer an actual update over a duplicate scheduled row from a shared feed.
  const unique = new Map<string, PassengerDeparture>();
  for (const d of departures) {
    const key = `${d.transportType}|${d.lineNumber}|${d.headsign}|${d.scheduledDepartureTime}`;
    const previous = unique.get(key);
    if (!previous || (previous.status === 'SCHEDULED' && d.status !== 'SCHEDULED')) unique.set(key, d);
  }
  return [...unique.values()].sort((a, b) =>
    (a.expectedDepartureTime ?? a.scheduledDepartureTime).localeCompare(b.expectedDepartureTime ?? b.scheduledDepartureTime)).slice(0, 30);
}
export function stopDistance(lat: number, lng: number, stop: PassengerTransitStop): number {
  const rad = Math.PI / 180, dlat = (stop.lat - lat) * rad, dlng = (stop.lng - lng) * rad;
  const h = Math.sin(dlat / 2) ** 2 + Math.cos(lat * rad) * Math.cos(stop.lat * rad) * Math.sin(dlng / 2) ** 2;
  return 6371000 * 2 * Math.asin(Math.sqrt(Math.min(1, h)));
}