import { useEffect, useState } from 'react';
import { GoogleTransitMap } from './GoogleTransitMap';
import './passenger/passenger.css';

type Coordinate = { lat: number; lng: number };
type MapState = {
  origin: (Coordinate & { accuracy: number }) | null;
  destination: (Coordinate & { name: string }) | null;
  route: { polyline: string | null; steps: { mode: string; polyline?: string; departureStop?: string; arrivalStop?: string }[] } | null;
  selectedStep: number | null;
  bottomInset: number;
};
declare global {
  interface Window {
    FairRideMapUpdate?: (data: unknown) => void;
    ReactNativeWebView?: { postMessage: (message: string) => void };
  }
}
const validCoordinate = (p: unknown): p is Coordinate => {
  if (!p || typeof p !== 'object') return false;
  const value = p as Coordinate;
  return Number.isFinite(value.lat) && Number.isFinite(value.lng) && Math.abs(value.lat) <= 90 && Math.abs(value.lng) <= 180;
};
// This isolated map has no account, auth, geolocation, payments or server-write
// capability. It receives only ephemeral display coordinates from its parent.
export function NativeMapPage() {
  const [map, setMap] = useState<MapState>({ origin: null, destination: null, route: null, selectedStep: null, bottomInset: 0 });
  useEffect(() => {
    const update = (raw: unknown) => {
      if (!raw || typeof raw !== 'object') return;
      const input = raw as Record<string, unknown>;
      if (input.type !== 'fairride-map-update') return;
      const origin = input.origin as MapState['origin'];
      const destination = input.destination as MapState['destination'];
      const route = input.route as MapState['route'];
      if (origin != null && (!validCoordinate(origin) || !Number.isFinite(origin.accuracy) || origin.accuracy < 0)) return;
      if (destination != null && (!validCoordinate(destination) || typeof destination.name !== 'string' || destination.name.length > 2000)) return;
      if (route != null && (typeof route !== 'object' || !Array.isArray(route.steps) || route.steps.length > 100 ||
        (route.polyline != null && (typeof route.polyline !== 'string' || route.polyline.length > 500000)) ||
        !route.steps.every(step => step && ['WALK', 'TRANSIT', 'OTHER'].includes(step.mode) &&
          (step.polyline == null || typeof step.polyline === 'string' && step.polyline.length <= 500000)))) return;
      const index = input.selectedStep;
      const inset = input.bottomInset ?? 0;
      if (typeof inset !== 'number' || !Number.isFinite(inset) || inset < 0 || inset > 3000) return;
      if (index != null && (!Number.isInteger(index) || Number(index) < 0 || !route || Number(index) >= route.steps.length)) return;
      setMap({
        origin: origin ? { lat: origin.lat, lng: origin.lng, accuracy: origin.accuracy } : null,
        destination: destination ? { lat: destination.lat, lng: destination.lng, name: destination.name } : null,
        route: route ? { polyline: route.polyline, steps: route.steps.map(step => ({
          mode: step.mode, polyline: step.polyline,
          departureStop: typeof step.departureStop === 'string' ? step.departureStop : undefined,
          arrivalStop: typeof step.arrivalStop === 'string' ? step.arrivalStop : undefined,
        })) } : null,
        selectedStep: index == null ? null : Number(index),
        bottomInset: inset,
      });
    };
    const message = (event: MessageEvent) => {
      if (event.source === window.parent && window.parent !== window) update(event.data);
    };
    window.FairRideMapUpdate = update;
    window.addEventListener('message', message);
    const ready = { type: 'fairride-map-ready' };
    window.ReactNativeWebView?.postMessage(JSON.stringify(ready));
    if (window.parent !== window) window.parent.postMessage(ready, '*'); // No coordinates or credentials in the handshake.
    return () => { window.removeEventListener('message', message); delete window.FairRideMapUpdate; };
  }, []);
  return <div className="map-frame" style={{ height: '100dvh', width: '100vw', border: 0, borderRadius: 0 }} data-testid="native-google-map">
    <GoogleTransitMap origin={map.origin} destination={map.destination} routePolyline={map.route?.polyline ?? null}
      steps={map.route?.steps} selectedStep={map.selectedStep} bottomInset={map.bottomInset} stops={[]} pickEnabled={false} onPick={() => {}} onStop={() => {}} />
  </div>;
}