import { Router } from 'express';
import { GetNearbyTransitStopsQueryParams, GetNearbyTransitStopsResponse, GetTransitStopDeparturesResponse } from '@workspace/api-zod';
import { passengerSchedules } from '../lib/transport-feed-service';
import { passengerStops, scheduledDepartures, stopDistance, type IndexedPassengerStop } from '../lib/passenger-timetable';
import type { StaticFeed } from '../lib/krakow-gtfs';
import { passengerAlerts } from '../lib/passenger-alerts';

const router = Router();
let lastFeeds: StaticFeed[] = [], registry = new Map<string, IndexedPassengerStop>();
function readTimetables(res: import('express').Response) {
  const state = passengerSchedules();
  if (!state.schedules.length) {
    res.setHeader('Retry-After', '15');
    res.status(503).json({ error: 'Rozkład ZTP jest ładowany lub niedostępny. Spróbuj ponownie za chwilę.' });
    return null;
  }
  if (state.schedules.length !== lastFeeds.length || state.schedules.some((feed, i) => feed !== lastFeeds[i])) {
    registry = passengerStops(state.schedules); lastFeeds = state.schedules;
  }
  return { realtime: state.realtime, alertFeeds: state.alertFeeds, generatedAt: new Date().toISOString(), cached: state.cached,
    attribution: state.partial ? 'ZTP Kraków · część rozkładu niedostępna' : 'ZTP Kraków' };
}
router.get('/transit/stops', (req, res) => {
  const parsed = GetNearbyTransitStopsQueryParams.safeParse(req.query);
  if (!parsed.success) { res.status(400).json({ error: 'Niepoprawna pozycja mapy.' }); return; }
  const { lat, lng, radius = 1500 } = parsed.data;
  // The generated contract can coerce absent numeric fields; require them explicitly.
  if (req.query.lat === undefined || req.query.lng === undefined || !Number.isFinite(lat) || !Number.isFinite(lng)) {
    res.status(400).json({ error: 'Podaj pozycję mapy.' }); return;
  }
  const state = readTimetables(res); if (!state) return;
  const stops = [...registry.values()].map(entry => ({ stop: entry.stop, distance: stopDistance(lat, lng, entry.stop) }))
    .filter(entry => entry.distance <= radius).sort((a, b) => a.distance - b.distance).slice(0, 50).map(entry => entry.stop);
  res.setHeader('Cache-Control', 'private, max-age=30');
  res.json(GetNearbyTransitStopsResponse.parse({ ...state, stops }));
});
router.get('/transit/stops/:stopId/departures', (req, res) => {
  const state = readTimetables(res); if (!state) return;
  const stop = registry.get(String(req.params.stopId));
  if (!stop) { res.status(404).json({ error: 'Nie ma tego przystanku w aktualnym rozkładzie.' }); return; }
  res.setHeader('Cache-Control', 'private, max-age=15');
  const { realtime, alertFeeds, ...responseState } = state;
  const now = Date.now(), departures = scheduledDepartures(stop, now, 120, realtime);
  res.json(GetTransitStopDeparturesResponse.parse({ ...responseState, stop: stop.stop, departures,
    ...passengerAlerts(stop, departures, now, alertFeeds) }));
});
export default router;