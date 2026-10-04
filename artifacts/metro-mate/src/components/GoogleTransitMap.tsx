import { useEffect, useRef, useState } from 'react';
import { loadGoogleMaps, MapLoadError, MAP_ERROR_EVENT } from '../services/google-maps-loader';
import { routeMapSegments, routeStroke } from '../services/route-map-segments';

type LL = { lat: number; lng: number };
export type MapStop = { id: string; name: string; lat: number; lng: number; lines?: string[]; transportTypes?: ('BUS' | 'TRAM')[] };
const KRAKOW: LL = { lat: 50.0616, lng: 19.9383 };

type Props = {
  origin: (LL & { accuracy: number }) | null;
  destination: (LL & { name: string }) | null;
  stops: MapStop[];
  pickEnabled: boolean;
  onPick: (p: LL) => void;
  onStop: (id: string) => void;
  routePolyline: string | null;
  steps?: { mode: string; polyline?: string; departureStop?: string; arrivalStop?: string }[];
  selectedStep?: number | null;
  bottomInset?: number;
  selectedStopId?: string | null;
  onViewport?: (c: LL & { radius?: number }) => void;
};

export function GoogleTransitMap(p: Props) {
  const el = useRef<HTMLDivElement>(null);
  const map = useRef<google.maps.Map | null>(null);
  const [attempt, setAttempt] = useState(0);
  const [status, setStatus] = useState<'loading' | 'ready' | 'error'>('loading');
  const [ready, setReady] = useState(false);
  const [configError, setConfigError] = useState('');
  const [errorCode, setErrorCode] = useState('');
  const pick = useRef(p.pickEnabled); pick.current = p.pickEnabled;
  const onPick = useRef(p.onPick); onPick.current = p.onPick;
  const onStop = useRef(p.onStop); onStop.current = p.onStop;
  const onViewport = useRef(p.onViewport); onViewport.current = p.onViewport;
  const idleTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const objs = useRef<{ stops: google.maps.marker.AdvancedMarkerElement[]; dest?: google.maps.marker.AdvancedMarkerElement; me?: google.maps.marker.AdvancedMarkerElement; circle?: google.maps.Circle; lines: google.maps.Polyline[]; ends: google.maps.marker.AdvancedMarkerElement[] }>({ stops: [], lines: [], ends: [] });

  useEffect(() => {
    const failed = (event: Event) => {
      const error = (event as CustomEvent).detail;
      setConfigError(error instanceof MapLoadError ? error.message : 'Google odrzucił dostęp do mapy.');
      setErrorCode('MAP_AUTH'); setStatus('error'); setReady(false);
    };
    window.addEventListener(MAP_ERROR_EVENT, failed);
    return () => window.removeEventListener(MAP_ERROR_EVENT, failed);
  }, []);

  useEffect(() => {
    let dead = false;
    setStatus('loading');
    setConfigError('');
    setErrorCode(''); setReady(false);
    loadGoogleMaps(attempt > 0).then(() => {
      if (dead || !el.current) return;
      if (!map.current || !el.current.firstChild) {
        map.current = new google.maps.Map(el.current, { center: KRAKOW, mapId: 'DEMO_MAP_ID', zoom: 14, disableDefaultUI: true, zoomControl: true, clickableIcons: false, gestureHandling: 'greedy' });
        map.current.addListener('click', (e: google.maps.MapMouseEvent) => { if (pick.current && e.latLng) onPick.current({ lat: e.latLng.lat(), lng: e.latLng.lng() }); });
        map.current.addListener('idle', () => {
          clearTimeout(idleTimer.current);
          idleTimer.current = setTimeout(() => {
            const c = map.current?.getCenter(), bounds = map.current?.getBounds();
            if (!c) return;
            const ne = bounds?.getNorthEast(), sw = bounds?.getSouthWest();
            const metres = ne && sw ? Math.hypot((ne.lat() - sw.lat()) * 111320 / 2,
              (ne.lng() - sw.lng()) * 111320 * Math.cos(c.lat() * Math.PI / 180) / 2) : 1500;
            onViewport.current?.({ lat: c.lat(), lng: c.lng(), radius: Math.min(3000, Math.max(800, Math.ceil(metres / 250) * 250)) });
          }, 700);
        });
        objs.current = { stops: [], lines: [], ends: [] };
      }
      setReady(true); setStatus('ready');
    }).catch(error => {
      if (!dead) {
        setConfigError(error instanceof MapLoadError ? error.message : 'Nie udało się uruchomić mapy. Ponów próbę.');
        setErrorCode(error instanceof MapLoadError ? error.code : 'MAP_INIT');
        setStatus('error'); setReady(false);
      }
    });
    return () => {
      dead = true; clearTimeout(idleTimer.current);
      objs.current.stops.forEach(marker => { marker.map = null; });
      if (objs.current.me) objs.current.me.map = null;
      if (objs.current.dest) objs.current.dest.map = null;
      objs.current.circle?.setMap(null); objs.current.lines.forEach(line => line.setMap(null)); objs.current.ends.forEach(m => { m.map = null; });
      if (map.current) google.maps.event.clearInstanceListeners(map.current);
      map.current = null;
      objs.current = { stops: [], lines: [], ends: [] };
    };
  }, [attempt]);

  useEffect(() => {
    if (!ready || !map.current) return;
    objs.current.stops.forEach(m => { m.map = null; });
    objs.current.stops = p.stops.map(s => {
      const content = document.createElement('div'); content.className = `stop-pin${s.transportTypes?.includes('TRAM') ? ' tram' : ''}${p.selectedStopId === s.id ? ' selected' : ''}`;
      const m = new google.maps.marker.AdvancedMarkerElement({ map: map.current!, position: s, title: `${s.name}${s.lines?.length ? ` · ${s.lines.slice(0, 6).join(', ')}` : ''}`, content });
      m.addListener('click', () => onStop.current(s.id));
      return m;
    });
  }, [ready, p.stops, p.selectedStopId]);

  const o = p.origin, d = p.destination;
  useEffect(() => {
    if (!ready || !map.current) return;
    const g = objs.current;
    if (g.me) g.me.map = null;
    if (g.dest) g.dest.map = null;
    g.circle?.setMap(null);
    g.me = g.circle = g.dest = undefined;
    if (o) {
      g.circle = new google.maps.Circle({ map: map.current, center: o, radius: o.accuracy, strokeColor: '#3378b9', strokeWeight: 1, fillColor: '#3378b9', fillOpacity: 0.1, clickable: false });
      const content = document.createElement('div'); content.className = 'map-pin current-pin'; content.textContent = 'ME';
      g.me = new google.maps.marker.AdvancedMarkerElement({ map: map.current, position: o, title: 'Your device location', content });
    }
    if (d) g.dest = new google.maps.marker.AdvancedMarkerElement({ map: map.current, position: d, title: d.name });
    if (p.routePolyline) return; // chosen route: camera is fitted once by the polyline effect
    if (o && d) { const b = new google.maps.LatLngBounds(); b.extend(o); b.extend(d); map.current.fitBounds(b, 56); }
    else if (d) { map.current.setCenter(d); map.current.setZoom(15); }
    else if (o) { map.current.setCenter(o); map.current.setZoom(14); }
    else { map.current.setCenter(KRAKOW); map.current.setZoom(14); }
  }, [ready, o?.lat, o?.lng, o?.accuracy, d?.lat, d?.lng, d?.name]);

  useEffect(() => {
    if (!ready || !map.current) return;
    objs.current.lines.forEach(line => line.setMap(null)); objs.current.lines = [];
    if (!p.routePolyline) return;
    const path = google.maps.geometry.encoding.decodePath(p.routePolyline);
    objs.current.lines = routeMapSegments(p.steps, p.routePolyline).map(segment => new google.maps.Polyline({
      map: map.current, path: google.maps.geometry.encoding.decodePath(segment.polyline!),
      ...routeStroke(segment.mode, google.maps.SymbolPath.CIRCLE),
    }));
    const b = new google.maps.LatLngBounds(); path.forEach(pt => b.extend(pt));
    const panel = el.current?.closest('.pz-go[data-phase="chosen"]')?.querySelector<HTMLElement>('.pz-drawer[data-open="true"]');
    const inset = p.bottomInset ?? (window.matchMedia('(max-width: 950px)').matches ? panel?.getBoundingClientRect().height ?? 0 : 0);
    // Fit in the visible map, not underneath the mobile bottom summary.
    map.current.fitBounds(b, { top: 36, left: 24, right: 24, bottom: inset + 24 });
  }, [ready, p.routePolyline, p.steps, p.bottomInset]);

  const steps = p.steps, sel = p.selectedStep;
  useEffect(() => {
    if (!ready || !map.current) return;
    objs.current.ends.forEach(m => { m.map = null; }); objs.current.ends = [];
    if (!steps) return;
    // Real coordinates only: the first/last vertex of a transit step's Google polyline.
    steps.forEach((s, i) => {
      if (s.mode !== 'TRANSIT' || !s.polyline || (sel != null && sel !== i)) return;
      const path = google.maps.geometry.encoding.decodePath(s.polyline);
      if (path.length < 2) return;
      const mk = (pt: google.maps.LatLng, cls: string, label: string, title: string) => {
        const content = document.createElement('div'); content.className = `map-pin ${cls}`; content.textContent = label;
        objs.current.ends.push(new google.maps.marker.AdvancedMarkerElement({ map: map.current!, position: pt, title, content }));
      };
      mk(path[0]!, 'board-pin', 'W', `Wsiadasz: ${s.departureStop || 'przystanek'}`);
      mk(path[path.length - 1]!, 'alight-pin', 'Z', `Wysiadasz: ${s.arrivalStop || 'przystanek'}`);
    });
  }, [ready, steps, sel]);

  return <div className="google-map-wrap" data-testid="map-google" style={{ position: 'absolute', inset: 0 }}>
    <div ref={el} style={{ position: 'absolute', inset: 0 }} data-testid="google-map-canvas" />
    {status === 'loading' && <div className="map-fallback" role="status" data-testid="status-google-loading"><strong>Ładowanie mapy Google…</strong></div>}
    {status === 'error' && <div className="map-fallback map-error" role="alert" data-testid="status-google-error"><strong>Problem z mapą — {errorCode}</strong><span>{configError}</span><span className="tiny">Możesz nadal wyszukać adres i przeczytać wskazówki poniżej mapy.</span><span className="tiny" data-testid="text-map-domain">Domena mapy: {window.location.origin}/*</span><button type="button" className="btn" onClick={() => setAttempt(a => a + 1)} data-testid="button-google-retry">Wczytaj mapę ponownie</button></div>}
  </div>;
}
