import type { RoutePoint } from './routing';

export type GeocodingResult = RoutePoint & { id: string; label: string; source: 'geoapify' };
export interface GeocodingProvider {
  search(query: string, signal?: AbortSignal): Promise<GeocodingResult[]>;
}

// Shared capacity control lives on the API server; suggestions also respect
// the existing client interval instead of sending a request per keystroke.
const cache = new Map<string, { expires: number; results: GeocodingResult[] }>();
let lastRequest = 0;
let busy = false;
class SearchCapacityError extends Error {
  constructor(message: string, public retryMs: number) { super(message); }
}
const endpoint = `${import.meta.env.BASE_URL.replace(/\/$/, '')}/api/geocoding/search`;

export function parseGeocodingResults(payload: unknown): GeocodingResult[] {
  if (!payload || typeof payload !== 'object' || !('features' in payload) || !Array.isArray(payload.features) ||
      !('provider' in payload) || payload.provider !== 'geoapify') {
    throw new Error('The search provider returned an invalid response. Please try again.');
  }
  const results: GeocodingResult[] = [];
  const seen = new Set<string>();
  for (const feature of payload.features) {
    const coordinates = feature?.geometry?.coordinates;
    const properties = feature?.properties;
    if (feature?.geometry?.type !== 'Point' || !Array.isArray(coordinates) || !properties) continue;
    const [lng, lat] = coordinates;
    if (typeof lat !== 'number' || typeof lng !== 'number' || !Number.isFinite(lat) ||
        !Number.isFinite(lng) || Math.abs(lat) > 90 || Math.abs(lng) > 180) continue;
    const text = (key: string) => typeof properties[key] === 'string' ? properties[key].trim() : '';
    const street = [text('street'), text('housenumber')].filter(Boolean).join(' ');
    const name = text('name') || text('address_line1') || street || text('city') || text('district');
    if (!name) continue;
    const label = text('formatted') || [...new Set([name, street, text('postcode'), text('city'), text('state'), text('country')].filter(Boolean))].join(', ');
    const id = text('place_id') || `${name}-${lat}-${lng}`;
    const duplicateKey = `${label}-${lat}-${lng}`;
    if (seen.has(duplicateKey)) continue;
    seen.add(duplicateKey);
    results.push({ id, name, label, lat, lng, source: 'geoapify' });
  }
  return results;
}

export const serverGeocodingProvider: GeocodingProvider = {
  async search(query, signal) {
    const normalized = query.trim().replace(/\s+/g, ' ');
    if (normalized.length < 3 || normalized.length > 200) {
      throw new Error('Wpisz od 3 do 200 znaków adresu lub nazwy miejsca.');
    }
    signal?.throwIfAborted();
    const key = normalized.toLocaleLowerCase('pl');
    const cached = cache.get(key);
    if (cached && cached.expires > Date.now()) return cached.results;
    if (busy || Date.now() - lastRequest < 1500) {
      throw new Error('Odczekaj chwilę przed kolejnym wyszukiwaniem.');
    }
    busy = true;
    lastRequest = Date.now();
    const controller = new AbortController();
    const abort = () => controller.abort(signal?.reason);
    signal?.addEventListener('abort', abort, { once: true });
    const timeout = setTimeout(() => controller.abort(), 10000);
    try {
      const response = await fetch(endpoint, {
        method: 'POST', body: JSON.stringify({ query: normalized }),
        signal: controller.signal, cache: 'no-store',
        headers: { Accept: 'application/json', 'Content-Type': 'application/json' },
      });
      if (!response.ok) {
        if (response.status === 429) {
          const seconds = Number(response.headers?.get('Retry-After') ?? 0);
          throw new SearchCapacityError(
            'Wyszukiwanie adresów osiągnęło limit zapytań. Odczekaj i spróbuj ponownie.',
            Number.isFinite(seconds) && seconds > 0 ? Math.ceil(seconds * 1000) : 0,
          );
        }
        throw new Error(response.status === 429
          ? 'Wyszukiwanie adresów osiągnęło limit zapytań. Odczekaj i spróbuj ponownie.'
          : 'Wyszukiwanie adresów jest chwilowo niedostępne. To błąd wyszukiwarki, nie mapy Google. Spróbuj ponownie.');
      }
      const results = parseGeocodingResults(await response.json());
      if (cache.size >= 100) cache.delete(cache.keys().next().value!);
      cache.set(key, { expires: Date.now() + 15 * 60 * 1000, results });
      return results;
    } catch (error) {
      if (signal?.aborted) throw error;
      if (controller.signal.aborted) throw new Error('Wyszukiwanie adresu trwało zbyt długo. Spróbuj ponownie.');
      if (error instanceof TypeError) throw new Error('Brak połączenia z wyszukiwarką adresów. Sprawdź internet i spróbuj ponownie.');
      throw error;
    } finally {
      clearTimeout(timeout);
      signal?.removeEventListener('abort', abort);
      busy = false;
    }
  },
};

export const searchDestinations = (query: string, signal?: AbortSignal) => serverGeocodingProvider.search(query, signal);

function pause(ms: number, signal: AbortSignal): Promise<void> {
  signal.throwIfAborted();
  return new Promise((resolve, reject) => {
    const abort = () => { clearTimeout(timer); signal.removeEventListener('abort', abort); reject(signal.reason); };
    const timer = setTimeout(() => { signal.removeEventListener('abort', abort); resolve(); }, ms);
    signal.addEventListener('abort', abort, { once: true });
  });
}

export async function searchDestinationSuggestions(query: string, signal: AbortSignal) {
  const key = query.trim().replace(/\s+/g, ' ').toLocaleLowerCase('pl');
  for (let retry = 0; ; retry++) {
    signal.throwIfAborted();
    const cached = cache.get(key);
    if (cached && cached.expires > Date.now()) return cached.results;
    while (busy || Date.now() - lastRequest < 1500) {
      await pause(busy ? 100 : Math.max(1, 1500 - (Date.now() - lastRequest)), signal);
    }
    try { return await searchDestinations(query, signal); }
    catch (error) {
      // Only short capacity contention is retried; daily/provider limits and
      // network errors stay visible. Editing cancels both waits and retries.
      if (!(error instanceof SearchCapacityError) || !error.retryMs || error.retryMs > 8000 || retry >= 2) throw error;
      await pause(error.retryMs, signal);
    }
  }
}