import { useEffect, useRef, useState } from 'react';
import { Footprints, Route as RouteIcon } from 'lucide-react';
import { computeTransitRoutes, type TransitResults, type TransitRoute } from '@workspace/api-client-react';
import type { RoutePoint } from '../services/routing';
import { transitErrorMessage } from '../services/transit-error';
import { discountFor, quoteRoute, type DiscountId } from '../services/fare-policy';
import { moneyText } from '../services/passenger-account';
import { groupWalking } from '../services/trip-walking';
import { GoRouteCard } from './passenger/GoRouteCard';

const mins = (s: number | null | undefined) => s == null || !Number.isFinite(s) || s < 0 ? 'brak danych czasu' : s < 60 ? `${Math.round(s)} s` : `${Math.round(s / 60)} min`;
const dist = (m: number | null | undefined) => m == null || !Number.isFinite(m) || m < 0 ? 'brak danych odległości' : m >= 1000 ? `${(m / 1000).toFixed(1)} km` : `${Math.round(m)} m`;
const walkLabels = { access: 'Dojście do pierwszego transportu', transfer: 'Przesiadka piesza', egress: 'Dojście do celu', 'walking-only': 'Trasa piesza' };
const typeLabels: Record<string, string> = { BUS: 'Bus', TRAM: 'Tram', SUBWAY: 'Metro', METRO_RAIL: 'Metro', HEAVY_RAIL: 'Train', COMMUTER_TRAIN: 'Train', RAIL: 'Train' };
function routeQuote(route: TransitRoute, discountId: DiscountId) {
  try { return quoteRoute(route, discountId); } catch { return null; }
}
const clock = (iso?: string) => { if (!iso) return ''; const d = new Date(iso); return isNaN(d.getTime()) ? '' : d.toLocaleTimeString('pl-PL', { hour: '2-digit', minute: '2-digit' }); };

type Props = { origin: RoutePoint | null; destination: RoutePoint; selectedRouteId: string | null; onSelectRoute: (route: TransitRoute | null) => void; discountId?: DiscountId; autoPlanKey?: number; onConfirmRoute?: (route: TransitRoute) => void };

export function TransitDirections({ origin, destination, selectedRouteId, onSelectRoute, discountId = 'normal', autoPlanKey = 0, onConfirmRoute }: Props) {
  const [state, setState] = useState<'idle' | 'loading' | 'error' | 'done'>('idle');
  const [results, setResults] = useState<TransitResults | null>(null);
  const [errorMessage, setErrorMessage] = useState('');
  const version = useRef(0);
  const ctrl = useRef<AbortController | null>(null);
  const cb = useRef(onSelectRoute); cb.current = onSelectRoute;
  const confirmCb = useRef(onConfirmRoute); confirmCb.current = onConfirmRoute;
  const consumedKey = useRef(0);
  const plannedOrigin = useRef<RoutePoint | null>(null);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => { const t = window.setInterval(() => setNow(Date.now()), 15000); return () => window.clearInterval(t); }, []);

  useEffect(() => {
    // Accuracy noise is not a new starting point. Significant movement clears
    // a stale itinerary, but never silently triggers another paid request.
    const previous = plannedOrigin.current;
    // A watch can briefly lose its fix. Keep the old itinerary for viewing,
    // without presenting it as a current GPS position or enabling a purchase.
    if (!origin) {
      if (previous) {
        version.current++; ctrl.current?.abort();
        setState(results ? 'done' : 'idle');
      }
      return;
    }
    if (previous) {
      const lat = (origin.lat - previous.lat) * 111320;
      const lng = (origin.lng - previous.lng) * 111320 * Math.cos(origin.lat * Math.PI / 180);
      if (Math.hypot(lat, lng) < 25) return;
    }
    plannedOrigin.current = origin;
    version.current++; ctrl.current?.abort();
    setState('idle'); setResults(null); cb.current(null);
  }, [origin?.lat, origin?.lng]);
  useEffect(() => {
    version.current++; ctrl.current?.abort();
    setState('idle'); setResults(null); cb.current(null);
  }, [destination.lat, destination.lng, destination.name, destination.stopId, autoPlanKey]);
  useEffect(() => () => { ctrl.current?.abort(); version.current++; cb.current(null); }, []);

  const run = async () => {
    if (!origin) return;
    plannedOrigin.current = origin;
    ctrl.current?.abort();
    const c = new AbortController(); ctrl.current = c;
    const v = ++version.current;
    setState('loading'); setResults(null); setErrorMessage(''); cb.current(null);
    try {
      const r = await computeTransitRoutes({ origin: { lat: origin.lat, lng: origin.lng }, destination: { lat: destination.lat, lng: destination.lng } }, { signal: c.signal });
      if (v !== version.current) return;
      setResults(r); setState('done');
      if (r.routes[0]) cb.current(r.routes[0]);
    } catch (error) {
      if (v !== version.current) return;
      setErrorMessage(transitErrorMessage(error));
      setState('error');
    }
  };
  useEffect(() => {
    if (origin && autoPlanKey > 0 && consumedKey.current !== autoPlanKey) {
      consumedKey.current = autoPlanKey;
      void run();
    }
  }, [autoPlanKey, origin?.lat, origin?.lng]);

  const routes = results?.routes ?? [];
  return <section className="transit-directions" data-testid="real-transit-directions">
    <h3 className="sr-only">Połączenia transportu publicznego</h3>
    {!origin && <div className="notice" data-testid="status-transit-needs-location">Do wyznaczenia trasy potrzebujemy Twojej rzeczywistej lokalizacji. Użyj przycisku lokalizacji nad mapą i zezwól na GPS. Wyszukiwanie adresów nie wymaga tej zgody.{routes.length > 0 && ' Poniżej poprzednio wyznaczona trasa, nie potwierdzenie aktualnej pozycji.'}</div>}
    {origin && <button type="button" className="btn" style={{ width: '100%' }} onClick={run} disabled={state === 'loading'} data-testid="button-plan-real-route"><RouteIcon size={16} />{state === 'loading' ? 'Szukamy połączeń…' : routes.length ? 'Odśwież połączenia' : 'Wyznacz trasę'}</button>}
    {state === 'loading' && <div className="notice" style={{ marginTop: 10 }} role="status" data-testid="status-transit-loading">Pobieramy rzeczywiste połączenia z Google…</div>}
    {state === 'error' && <div className="notice" style={{ marginTop: 10 }} role="alert" data-testid="status-transit-error">{errorMessage} <button type="button" className="btn-quiet" onClick={run} data-testid="button-transit-retry">Spróbuj ponownie</button></div>}
    {state === 'done' && routes.length === 0 && <div className="notice" style={{ marginTop: 10 }} data-testid="status-transit-empty">Google nie znalazł połączenia transportem publicznym dla tej trasy.</div>}
    {routes.length > 0 && <div className="gr-list" style={{ marginTop: 12 }} data-testid="list-real-routes">
      {routes.map((r, i) => {
        const active = r.id === selectedRouteId;
        const quote = routeQuote(r, discountId);
        const walks = groupWalking(r.steps);
        const walkingSeconds = walks.every(w => w.durationSeconds != null) ? walks.reduce((sum, w) => sum + w.durationSeconds!, 0) : null;
        const transit = r.steps.filter(s => s.mode === 'TRANSIT');
        const lineText = transit.length ? transit.map(s => [typeLabels[s.vehicleType || ''] || s.vehicleType || 'Transport', s.lineShortName || s.lineName].filter(Boolean).join(' ')).join(' → ') : r.steps.length && r.steps.every(s => s.mode === 'WALK') ? 'Pieszo' : 'Brak danych rodzaju transportu';
        return <GoRouteCard key={r.id} route={r} index={i} active={active} expanded={expandedId === r.id} now={now}
          onSelect={() => { cb.current(r); confirmCb.current?.(r); }} onToggle={() => setExpandedId(expandedId === r.id ? null : r.id)}
          fareLine={`${quote ? moneyText(quote.totalCents) : 'Koszt niedostępny'} · FairRide · ${discountFor(discountId).label}`}>
          <p style={{ margin: '0 0 10px' }}>{lineText} · {r.transfers} przesiadek</p>
          <div className="walking-summary" aria-label="Dojścia piesze" data-testid={active ? 'walking-summary' : undefined}>
            {walks.map((w, index) => <div key={index}><strong>{w.kind === 'walking-only' && r.steps.some(s => s.mode === 'OTHER') ? 'Odcinek pieszy (inne odcinki nieznane)' : walkLabels[w.kind]}</strong>: {mins(w.durationSeconds)}</div>)}
            {transit.length > 0 && !walks.some(w => w.kind === 'access') && <div>Dojście do pierwszego transportu: nie podano odcinka pieszego.</div>}
            {transit.length > 0 && !walks.some(w => w.kind === 'egress') && <div>Dojście do celu: nie podano odcinka pieszego.</div>}
            {transit.length === 0 && walks.length === 0 && <div>Brak danych odcinków pieszych.</div>}
            {walks.length > 0 && <div>Pieszo łącznie {mins(walkingSeconds)} — bezpłatnie</div>}
          </div>
          <ol style={{ margin: '10px 0 0', padding: 0, listStyle: 'none', display: 'grid', gap: 8 }} data-testid={active ? 'list-real-steps' : undefined}>
            {r.steps.map((s, j) => s.mode === 'WALK' ? null : <li key={j} className="tiny" style={{ display: 'flex', gap: 8 }}>
              {s.mode === 'TRANSIT'
                ? <span className="line-badge" style={{ background: s.lineColor || '#1e6854', flexShrink: 0 }}>{s.lineShortName || s.lineName || s.vehicleType || 'Line'}</span>
                : <Footprints size={15} style={{ flexShrink: 0 }} />}
              <span>{s.mode === 'TRANSIT'
                ? <><strong>{s.lineName || s.lineShortName || s.vehicleType}</strong>{s.headsign ? ` → ${s.headsign}` : ''}<br />Wsiądź: {s.departureStop} {clock(s.departureTime)} · wysiądź: {s.arrivalStop} {clock(s.arrivalTime)}{s.stopCount ? ` · ${s.stopCount} przystanków` : ''}<br /><span className="muted">{dist(s.distanceMeters)} · {mins(s.durationSeconds)}{quote?.legs[r.steps.slice(0, j + 1).filter(step => step.mode === 'TRANSIT').length - 1] && ` · ${moneyText(quote.legs[r.steps.slice(0, j + 1).filter(step => step.mode === 'TRANSIT').length - 1]!.amountCents)}`}</span></>
                : <>{s.instruction} <span className="muted">({dist(s.distanceMeters)}, {mins(s.durationSeconds)})</span></>}</span>
            </li>)}
          </ol>
        </GoRouteCard>;
      })}
       <p className="tiny muted" style={{ margin: 0, fontSize: 12 }} data-testid="text-google-attribution">Trasy: <span translate="no" style={{ fontWeight: 400, whiteSpace: 'nowrap' }}>Google Maps</span>. Ceny: taryfa FairRide, nie bilety przewoźników. Start naliczamy za każde wejście do transportu; dojście pieszo jest bezpłatne.</p>
       <p className="tiny muted" style={{ margin: 0, fontSize: 12 }}>{Array.from(new Map(routes.flatMap(r => r.steps.flatMap(s => s.agencies || [])).map(a => [a.name, a])).values()).map((a, i) => <span key={a.name}>{i > 0 && ' · '}{a.uri ? <a href={a.uri} target="_blank" rel="noopener noreferrer">{a.name}</a> : a.name}</span>)}</p>
    </div>}
    <p className="tiny muted" style={{ marginTop: 12 }}>Wybór celu lub przycisk wyznaczenia trasy wysyła współrzędne startu i celu do Google Routes. Samo wyszukiwanie adresu nie wyznacza trasy.</p>
  </section>;
}
