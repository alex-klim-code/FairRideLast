import { reverseAddress } from '@workspace/api-client-react';
import { parseGeocodingResults } from './geocoding';
import type { RoutePoint } from './routing';

export type Position = { lat: number; lng: number };
export function movedOrigin(a: Position, b: Position) {
  return Math.hypot((a.lat - b.lat) * 111320,
    (a.lng - b.lng) * 111320 * Math.cos(b.lat * Math.PI / 180)) >= 25;
}
export function gpsOrigin(position: Position): RoutePoint {
  return { ...position, name: `Your location · ${position.lat.toFixed(5)}, ${position.lng.toFixed(5)}` };
}

// Ephemeral and scoped to the mounted passenger view, never persisted.
export function createOriginResolver() {
  let version = 0;
  let controller: AbortController | null = null;
  const cancel = () => { version++; controller?.abort(); };
  return {
    cancel,
    async resolve(position: Position, update: (point: RoutePoint) => void) {
      cancel();
      const current = version;
      controller = new AbortController();
      try {
        const response = await reverseAddress(position, { signal: controller.signal });
        if (current !== version) return;
        const address = parseGeocodingResults(response)[0];
        // The address provider never replaces the GPS coordinates used for routing.
        update(address ? { ...position, name: address.label } : gpsOrigin(position));
      } catch {
        if (current === version) update(gpsOrigin(position));
      }
    },
  };
}