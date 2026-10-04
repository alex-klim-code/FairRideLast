import type { DecodedRealtime } from './krakow-gtfs';

type Update = DecodedRealtime['tripUpdates'][number];
export const realtimeFresh = (timestamp: number, now: number) =>
  Number.isFinite(timestamp) && timestamp > 0 && now - timestamp <= 120_000 && timestamp <= now + 30_000;

// Undated descriptors are used only when one active occurrence at this stop is
// within six hours of the source timestamp. Never attach a daily trip to every
// service date, or use another operator's identically named trip.
export function departurePrediction(updates: Update[], date: string, stopId: string, sequence: number,
  planned: number, now: number, occurrences: number[], startTime?: string, repeatedStop = false) {
  const update = updates.filter(u =>
    realtimeFresh(u.timestamp, now) &&
    (u.scheduleRelationship === 0 || u.scheduleRelationship === 3) &&
    (!u.startTime || u.startTime === startTime) &&
    (u.startDate ? u.startDate === date :
      Math.abs(planned - u.timestamp) <= 6 * 3600000 &&
      occurrences.filter(t => Math.abs(t - u.timestamp) <= 6 * 3600000).length === 1)
  ).sort((a, b) => b.timestamp - a.timestamp)[0];
  if (!update) return null;
  const at = new Date(update.timestamp).toISOString();
  if (update.cancelled) return { status: 'CANCELLED' as const, expectedDepartureTime: null, delaySeconds: null, realtimeUpdatedAt: at };
  const stop = update.stops.find(s =>
    (s.sequence === undefined || s.sequence === sequence) &&
    (!s.stopId || s.stopId === stopId) && (s.sequence !== undefined || (!!s.stopId && !repeatedStop)));
  if (stop?.relationship === 1) return { status: 'SKIPPED' as const, expectedDepartureTime: null, delaySeconds: null, realtimeUpdatedAt: at };
  if (stop && stop.relationship !== 0) return null; // NO_DATA explicitly ends predictions.
  let expected = stop?.departureTime;
  let delay = stop?.departureDelay ?? stop?.arrivalDelay;
  // Arrival time alone is not a departure prediction: dwell time is unknown.
  // Earlier stop delays may propagate, but a NO_DATA boundary clears them.
  if (expected === undefined && delay === undefined) {
    delay = update.tripDelay;
    for (const previous of [...update.stops].filter(s => s.sequence !== undefined && s.sequence < sequence)
      .sort((a, b) => a.sequence! - b.sequence!)) {
      if (previous.relationship === 2) delay = undefined;
      else if (previous.relationship === 0) delay = previous.departureDelay ?? previous.arrivalDelay ?? delay;
    }
  }
  if (expected === undefined && delay !== undefined && Number.isFinite(delay)) expected = planned + delay * 1000;
  if (expected === undefined || !Number.isFinite(expected) || expected <= 0 ||
    Math.abs(expected - planned) > 24 * 3600000) return null;
  return { status: 'UPDATED' as const, expectedDepartureTime: new Date(expected).toISOString(),
    delaySeconds: Math.round((expected - planned) / 1000), realtimeUpdatedAt: at };
}