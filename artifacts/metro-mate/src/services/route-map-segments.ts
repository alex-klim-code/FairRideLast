export type RouteSegment = { mode: string; polyline?: string };

export function routeMapSegments(steps: RouteSegment[] | undefined, fullPolyline: string): RouteSegment[] {
  const segments = steps?.filter(s => !!s.polyline) ?? [];
  if (segments.length) return segments;
  // An undivided mixed route cannot honestly be labelled as walking or transit.
  const modes = new Set(steps?.map(s => s.mode));
  return [{ mode: modes.size === 1 ? [...modes][0]! : 'OTHER', polyline: fullPolyline }];
}

export function routeStroke(mode: string, circle: google.maps.SymbolPath): google.maps.PolylineOptions {
  if (mode === 'WALK') return {
    strokeOpacity: 0,
    icons: [{
      icon: { path: circle, scale: 3, fillColor: '#1d6853', fillOpacity: 1, strokeOpacity: 0 },
      offset: '0', repeat: '14px',
    }],
  };
  return { strokeColor: mode === 'TRANSIT' ? '#1d6853' : '#758078', strokeWeight: 6, strokeOpacity: 0.9 };
}