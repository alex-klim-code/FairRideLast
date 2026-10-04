import { useEffect, useRef, useState } from 'react';
import type { RoutePoint } from '../services/routing';
import { createOriginResolver, gpsOrigin, movedOrigin } from '../services/route-origin';

export function useRouteOrigin(geo: { lat: number; lng: number } | null): RoutePoint | null {
  const [origin, setOrigin] = useState<RoutePoint | null>(null);
  const settled = useRef<RoutePoint | null>(null);
  const resolver = useRef<ReturnType<typeof createOriginResolver> | null>(null);
  if (!resolver.current) resolver.current = createOriginResolver();
  useEffect(() => {
    if (!geo) {
      resolver.current!.cancel(); settled.current = null; setOrigin(null); return;
    }
    if (settled.current && !movedOrigin(settled.current, geo)) return;
    resolver.current!.cancel();
    const point = gpsOrigin({ lat: geo.lat, lng: geo.lng });
    settled.current = point; setOrigin(point);
  }, [geo?.lat, geo?.lng]);
  useEffect(() => {
    if (!settled.current) return;
    const point = settled.current;
    // Let the GPS settle and give a submitted destination search first use of capacity.
    const timer = setTimeout(() => { void resolver.current!.resolve(point, setOrigin); }, 1800);
    return () => { clearTimeout(timer); resolver.current!.cancel(); };
  }, [origin?.lat, origin?.lng]);
  return geo ? origin : null;
}