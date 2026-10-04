import type { RoutePoint } from './routing';

export type RecentDestination = Pick<RoutePoint, 'name' | 'lat' | 'lng'>;
export const DESTINATION_HISTORY_KEY = 'metromate:recent-destinations:v1';
export const DESTINATION_HISTORY_LIMIT = 5;
export const HISTORY_STORAGE_ERROR = 'Recent destinations cannot be saved in this browser. Changes will last only for this visit.';

function cleanPoint(value: unknown): RecentDestination | null {
  if (!value || typeof value !== 'object') return null;
  const point = value as Record<string, unknown>;
  if (typeof point.name !== 'string' || !point.name.trim() || point.name.length > 500 ||
      typeof point.lat !== 'number' || !Number.isFinite(point.lat) || Math.abs(point.lat) > 90 ||
      typeof point.lng !== 'number' || !Number.isFinite(point.lng) || Math.abs(point.lng) > 180) return null;
  return { name: point.name.trim(), lat: point.lat, lng: point.lng };
}

export function sameDestination(a: RecentDestination, b: RecentDestination) {
  return a.name === b.name && a.lat === b.lat && a.lng === b.lng;
}

export function parseDestinationHistory(value: string | null): RecentDestination[] {
  if (!value) return [];
  const parsed: unknown = JSON.parse(value);
  if (!Array.isArray(parsed)) throw new Error('Invalid destination history.');
  const entries: RecentDestination[] = [];
  for (const candidate of parsed) {
    const point = cleanPoint(candidate);
    if (point && !entries.some(entry => sameDestination(entry, point))) entries.push(point);
    if (entries.length === DESTINATION_HISTORY_LIMIT) break;
  }
  return entries;
}

export function rememberDestination(entries: RecentDestination[], value: RoutePoint): RecentDestination[] {
  const point = cleanPoint(value);
  if (!point) return entries;
  return [point, ...entries.filter(entry => !sameDestination(entry, point))].slice(0, DESTINATION_HISTORY_LIMIT);
}

export function readDestinationHistory(storage: Pick<Storage, 'getItem'>) {
  return parseDestinationHistory(storage.getItem(DESTINATION_HISTORY_KEY));
}

export function saveDestinationHistory(storage: Pick<Storage, 'setItem' | 'removeItem'>, entries: RecentDestination[]) {
  // Sanitize even callers with extra fields; no provider IDs, queries or stop IDs are persisted.
  const clean = parseDestinationHistory(JSON.stringify(entries));
  if (clean.length) storage.setItem(DESTINATION_HISTORY_KEY, JSON.stringify(clean));
  else storage.removeItem(DESTINATION_HISTORY_KEY);
}