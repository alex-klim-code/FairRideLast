import type { DecodedRealtime, StaticFeed } from './krakow-gtfs';
import type { IndexedPassengerStop, scheduledDepartures } from './passenger-timetable';
import { realtimeFresh } from './passenger-realtime';
import type { GetTransitStopDeparturesResponse } from '@workspace/api-zod';

type Departure = ReturnType<typeof scheduledDepartures>[number];
type Selector = DecodedRealtime['serviceAlerts'][number]['selectors'][number];
type Period = { start: number | null; end: number | null };
type ApiAlert = (typeof GetTransitStopDeparturesResponse)['_output']['alerts'][number];
type Alert = Omit<ApiAlert, 'updatedAt' | 'periods'> & {
  updatedAt: string; periods: { start: string | null; end: string | null }[] };
export function alertPeriodActive(periods: Period[], at: number): boolean {
  return !periods.length || periods.some(p =>
    (p.start === null || (Number.isFinite(p.start) && p.start >= 0 && p.start <= at)) &&
    (p.end === null || (Number.isFinite(p.end) && p.end >= 0 && at < p.end)) &&
    (p.start === null || p.end === null || p.start < p.end));
}
function matches(selector: Selector, feed: StaticFeed, stopId: string,
  trip: StaticFeed['trips'][number] | undefined, departure?: Departure) {
  if (selector.stopId && selector.stopId !== stopId) return false;
  if (selector.routeId && selector.routeId !== trip?.routeId) return false;
  const route = trip && feed.routeDetails?.get(trip.routeId);
  if (selector.agencyId && selector.agencyId !== route?.agencyId) return false;
  if (selector.routeType !== undefined && selector.routeType !== route?.routeType) return false;
  if (selector.directionId !== undefined && selector.directionId !== (trip && feed.tripDirections?.get(trip.id))) return false;
  if (selector.trip) {
    if (!trip || !departure) return false;
    if (selector.trip.id && selector.trip.id !== trip.id) return false;
    if (selector.trip.startDate && selector.trip.startDate !== departure.id.split(':').at(-3)) return false;
    if (selector.trip.startTime && selector.trip.startTime !== feed.tripStartTimes?.get(trip.id)) return false;
    if (selector.trip.directionId !== undefined && selector.trip.directionId !== feed.tripDirections?.get(trip.id)) return false;
  }
  return true;
}

export function passengerAlerts(index: IndexedPassengerStop, departures: Departure[], now: number,
  feeds: Map<StaticFeed, DecodedRealtime>) {
  const alerts: Alert[] = [];
  let available = 0;
  const timestamps: number[] = [];
  const seen = new Set<string>();
  for (const { feed, stopId } of index.members) {
    const rt = feeds.get(feed);
    if (!rt || !realtimeFresh(rt.timestamp, now)) continue;
    available++; timestamps.push(rt.timestamp);
    const dataset = /^krakow-ztp-([AMT])-/.exec(stopId)?.[1] as 'A' | 'M' | 'T' | undefined;
    if (!dataset) continue;
    const rawStop = decodeURIComponent(stopId.replace(/^krakow-ztp-[AMT]-/, ''));
    const entries = feed.departuresByStop?.get(stopId) ?? [];
    const trips = new Map<string, StaticFeed['trips'][number]>();
    for (let i = 0; i < entries.length; i += 3) {
      const trip = feed.trips[entries[i]!]!;
      trips.set(trip.id, trip);
    }
    const relevant = departures.filter(d => d.tripId.startsWith(`${stopId}:`));
    for (const alert of rt.serviceAlerts) {
      if (!alert.title.trim() && !alert.description.trim()) continue;
      if (alert.periods.some(p => [p.start, p.end].some(t =>
        t !== null && (!Number.isFinite(t) || t < 0 || t > 8640000000000000)))) continue;
      const selectors = alert.selectors.length ? alert.selectors : [{}];
      // Fields inside a selector are ANDed; selectors are ORed. A trip alert
      // needs a real departure (with its active service date), not just a line.
      const appliesToStop = alertPeriodActive(alert.periods, now) && selectors.some(s =>
        !s.trip && ([...trips.values()].some(t => matches(s, feed, rawStop, t)) ||
          matches(s, feed, rawStop, undefined)));
      const departureIds = relevant.filter(d => {
        const trip = trips.get(d.tripId.slice(stopId.length + 1));
        const at = Date.parse(d.expectedDepartureTime ?? d.scheduledDepartureTime);
        return alertPeriodActive(alert.periods, at) && selectors.some(s => matches(s, feed, rawStop, trip, d));
      }).map(d => d.id);
      if (!appliesToStop && !departureIds.length) continue;
      const id = `ztp-${dataset}-${encodeURIComponent(alert.id)}`;
      if (seen.has(id)) continue;
      seen.add(id);
      alerts.push({ id, title: alert.title.trim() || 'Komunikat ZTP', description: alert.description.trim(),
        effect: alert.effect, dataset, updatedAt: new Date(rt.timestamp).toISOString(),
        periods: alert.periods.map(p => ({ start: p.start === null ? null : new Date(p.start).toISOString(),
          end: p.end === null ? null : new Date(p.end).toISOString() })), appliesToStop, departureIds });
    }
  }
  return { alerts,
    alertsStatus: available === index.members.length ? 'AVAILABLE' as const : available ? 'PARTIAL' as const : 'UNAVAILABLE' as const,
    alertsUpdatedAt: timestamps.length ? new Date(Math.min(...timestamps)).toISOString() : null };
}