import { useEffect, useMemo, useRef, useState } from 'react';
import { Link } from 'wouter';
import { ChevronLeft, ListChecks, LogIn, Navigation, X } from 'lucide-react';
import { getGetNearbyTransitStopsQueryKey, getGetTransitStopDeparturesQueryKey, useGetNearbyTransitStops, useGetTransitStopDepartures, type TransitRoute, type PassengerDeparture } from '@workspace/api-client-react';
import { type BoardingSelection } from './boarding';
import { useDestinationHistory } from '../../hooks/use-destination-history';
import type { RoutePoint } from '../../services/routing';
import { quoteRoute, moneyText, transportLabels } from '../../services/fare-policy-exports';
import { fareTransport } from '../../services/fare-policy';
import { getActiveRide, getUnpaidRide, rideFare } from '../../services/passenger-ride';
import type { PassengerAccountController } from '../../hooks/use-passenger-account';
import { DestinationSearch } from '../DestinationSearch';
import { TransitDirections } from '../TransitDirections';
import { GoogleTransitMap } from '../GoogleTransitMap';
import { useRouteOrigin } from '../../hooks/use-route-origin';
import { DepartureRow } from './DepartureRow';
import { VehicleIcon } from './GoRouteCard';
import { departureDisplay } from './departure-display';
import { serviceAlertDisplay } from './service-alert-display';
import { StopServiceAlerts } from './StopServiceAlerts';
import { groupWalking } from '../../services/trip-walking';

type Geo = { lat: number; lng: number; accuracy: number; timestamp?: number } | null;
type Props = { controller: PassengerAccountController; geo: Geo; geoStatus: string; geoError: string | null; requestPosition: () => void; onBoard: (s: BoardingSelection) => void; visible?: boolean };

export function GoPage({ controller, geo, geoStatus, geoError, requestPosition, onBoard, visible = true }: Props) {
  const history = useDestinationHistory();
  const [destination, setDestination] = useState<RoutePoint | null>(null);
  const [key, setKey] = useState(0);
  const [route, setRoute] = useState<TransitRoute | null>(null);
  const [chosen, setChosen] = useState(false);
  const [stepIdx, setStepIdx] = useState<number | null>(null);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const account = controller.account!;
  const origin: RoutePoint | null = useRouteOrigin(geo);
  const [planOrigin, setPlanOrigin] = useState<RoutePoint | null>(null);
  const [open, setOpen] = useState(true);
  const [viewport, setViewport] = useState<{ lat: number; lng: number; radius?: number } | null>(null);
  const [stopId, setStopId] = useState<string | null>(null);
  const [departureNow, setDepartureNow] = useState(Date.now);
  useEffect(() => {
    if (!visible || !stopId) return;
    setDepartureNow(Date.now());
    const timer = window.setInterval(() => setDepartureNow(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, [visible, stopId]);
  const q = (v: number) => Number((Math.round(v / 0.004) * 0.004).toFixed(3));
  const base = viewport ?? origin ?? destination;
  const center = base ? { lat: q(base.lat), lng: q(base.lng) } : null;
  const stopParams = { lat: center?.lat ?? 0, lng: center?.lng ?? 0, radius: viewport?.radius ?? 1500 };
  const stopsQ = useGetNearbyTransitStops(stopParams, { query: { enabled: visible && !!center, queryKey: getGetNearbyTransitStopsQueryKey(stopParams), staleTime: 300000, retry: 1, retryDelay: 15000 } });
  const depQ = useGetTransitStopDepartures(stopId ?? '', { query: { enabled: visible && !!stopId, queryKey: getGetTransitStopDeparturesQueryKey(stopId ?? ''), staleTime: 15000, refetchInterval: visible && stopId ? 30000 : false, retry: false } });
  const nearby = stopsQ.data?.stops ?? [];
  const shownAlerts = depQ.data ? serviceAlertDisplay(depQ.data, departureNow).alerts : [];
  const pickStop = (id: string) => { setStopId(id); if (destination) setOpen(false); };
  const boardFromDeparture = (d: PassengerDeparture) => {
    if (departureDisplay(d, Date.now()).blocked) return;
    onBoard({ transport: d.transportType, lineName: d.lineName || d.lineNumber, transportName: transportLabels[d.transportType], lineNumber: d.lineNumber,
      scheduledDepartureTime: d.scheduledDepartureTime, scheduleSource: 'ZTP', originName: depQ.data?.stop.name ?? 'Przystanek', destinationName: d.headsign || destination?.name || 'Kierunek' });
  };
  const boardFromStep = (selectedStep = step) => {
    if (!selectedStep || !destination) return;
    const t = fareTransport(selectedStep.vehicleType);
    const num = selectedStep.lineShortName || selectedStep.lineName || 'Linia';
    onBoard({ transport: t, lineName: num, transportName: transportLabels[t], lineNumber: num,
      scheduledDepartureTime: selectedStep.departureTime && !Number.isNaN(Date.parse(selectedStep.departureTime)) ? selectedStep.departureTime : undefined,
      scheduleSource: 'Google Maps',
      originName: selectedStep.departureStop || origin?.name || 'Start', destinationName: selectedStep.arrivalStop || destination.name });
  };
  const reopenRef = useRef<HTMLButtonElement>(null);
  const drawerRef = useRef<HTMLElement>(null);
  const backRef = useRef<HTMLButtonElement>(null);
  const closedByUser = useRef(false);
  useEffect(() => { if (!open && closedByUser.current) { closedByUser.current = false; reopenRef.current?.focus(); } }, [open]);
  useEffect(() => {
    if (!destination || !open) return;
    drawerRef.current?.scrollTo({ top: 0 });
    if (window.matchMedia('(max-width: 950px)').matches) backRef.current?.focus({ preventScroll: true });
  }, [key, open]);
  // Planning origin is frozen at deliberate destination selection; live geo keeps feeding map/tracking only.
  useEffect(() => { if (destination && !planOrigin && origin) setPlanOrigin(origin); }, [destination, planOrigin, origin]);
  const closeDrawer = () => { closedByUser.current = true; setOpen(false); };
  const choose = (point: RoutePoint) => {
    history.remember(point); setRoute(null); setChosen(false); setStepIdx(null); setMsg(null); setDestination(point); setPlanOrigin(origin); setOpen(true); setKey(k => k + 1);
  };
  const clear = () => { setRoute(null); setChosen(false); setStepIdx(null); setDestination(null); setPlanOrigin(null); setMsg(null); };
  const confirm = (r: TransitRoute) => {
    setRoute(r); setChosen(true); setMsg(null); setOpen(true);
    const t = r.steps.map((s, i) => s.mode === 'TRANSIT' ? i : -1).filter(i => i >= 0);
    setStepIdx(t.length === 1 ? t[0]! : null);
  };
  const quoted = useMemo(() => {
    if (!route) return null;
    try { return quoteRoute(route, account.profile.discountId); } catch { return null; }
  }, [route, account.profile.discountId]);
  const activeRide = getActiveRide(account);
  const unpaid = getUnpaidRide(account);
  const step = route && stepIdx != null ? route.steps[stepIdx] : null;
  const walkingOnly = !!route && !route.steps.some(s => s.mode === 'TRANSIT');
  const walks = route ? groupWalking(route.steps) : [];
  const walkingSeconds = walks.every(w => w.durationSeconds != null) ? walks.reduce((sum, w) => sum + w.durationSeconds!, 0) : null;
  const blocker = activeRide ? 'Masz aktywny przejazd.' : unpaid ? 'Poprzedni przejazd czeka na rozliczenie.' : null;
  return <div className="pz-go" data-drawer={destination && open ? 'open' : 'closed'} data-phase={chosen ? 'chosen' : 'alternatives'}>
    <div className="pz-search">
      <DestinationSearch destination={destination} onChoose={choose} onClear={clear} recentDestinations={history.entries}
        historyError={history.error} onRemoveRecent={history.remove} onClearHistory={history.clear} />
    </div>
    {!origin && <div className="notice pz-loc" role="status" data-testid="status-device-location">
      <span>{geoStatus === 'loading' ? 'Waiting for your device location.' : geoError || 'Your location has not been shared yet.'} No substitute position is used.</span>
      <button className="btn btn-secondary" onClick={requestPosition} disabled={geoStatus === 'loading'} data-testid="button-locate"><Navigation size={15} /> Locate me</button>
    </div>}
    <div className="pz-body">
      <div className="map-frame" data-testid="map-frame-google" role="region" aria-label="Map">
        <GoogleTransitMap origin={geo && origin ? { lat: origin.lat, lng: origin.lng, accuracy: geo.accuracy } : null} destination={destination} stops={nearby} selectedStopId={stopId} onViewport={setViewport}
          pickEnabled={false} onPick={() => {}} onStop={pickStop} routePolyline={chosen ? route?.polyline ?? null : null} steps={chosen ? route?.steps : undefined} selectedStep={stepIdx} />
        {origin && <button className="icon-btn pz-refresh-location" aria-label="Refresh my GPS location" onClick={requestPosition} disabled={geoStatus === 'loading'} data-testid="button-locate"><Navigation size={16} /></button>}
        {stopId && <section className="pz-stopsheet surface" aria-label="Odjazdy z przystanku" data-testid="section-stop-departures">
          <div className="pz-stop-head"><div><div className="eyebrow">Odjazdy ZTP{depQ.data?.cached ? ' · rozkład z pamięci' : ''}</div><strong data-testid="text-stop-name">{depQ.data?.stop.name ?? nearby.find(x => x.id === stopId)?.name ?? 'Przystanek'}</strong></div>
            <button type="button" className="icon-btn" style={{ width: 36, height: 36 }} aria-label="Zamknij odjazdy" onClick={() => setStopId(null)} data-testid="button-close-stop"><X size={15} /></button></div>
          {depQ.data && !depQ.isError && <StopServiceAlerts data={depQ.data} now={departureNow} />}
          {depQ.isLoading ? <div aria-busy="true"><div className="pz-skel" /><div className="pz-skel" /><div className="pz-skel" /></div>
            : depQ.isError ? <div className="pz-alert" role="alert" data-testid="status-departures-error">{(depQ.error as { status?: number } | null)?.status === 503 ? 'Rozkład ZTP chwilowo niedostępny.' : 'Nie udało się pobrać odjazdów.'} <button type="button" className="btn btn-quiet" style={{ minHeight: 30, padding: '4px 8px' }} onClick={() => depQ.refetch()} data-testid="button-retry-departures">Ponów</button></div>
            : !depQ.data?.departures.length ? <p className="pz-stop-note" data-testid="status-departures-empty">Brak najbliższych odjazdów z tego przystanku.</p>
            : <ul className="pz-dep-list">{depQ.data.departures.map(d =>
              <DepartureRow key={d.id} departure={d} now={departureNow} onBoard={boardFromDeparture}
                alerts={shownAlerts} />)}</ul>}
        </section>}
        {stopsQ.isError && <div className="pz-stops-status" role="status" data-testid="status-stops-error">{(stopsQ.error as { status?: number } | null)?.status === 503 ? 'Rozkład ZTP niedostępny' : 'Przystanki niedostępne'} · <button type="button" className="btn-quiet" style={{ border: 0, padding: 0, background: 'none', textDecoration: 'underline' }} onClick={() => stopsQ.refetch()}>Ponów</button></div>}
        {destination && !open && <button type="button" ref={reopenRef} className="btn pz-reopen" onClick={() => setOpen(true)} data-testid="button-reopen-results"><ListChecks size={15} /> Trasa</button>}
      </div>
      {destination && <aside ref={drawerRef} className="pz-drawer surface" id="pz-results" aria-label="Route" data-open={open} data-testid="text-selected-destination" onKeyDown={e => { if (e.key === 'Escape') closeDrawer(); }}>
        <div className="pz-drawer-head">
          <button type="button" ref={backRef} className="btn btn-secondary pz-back" onClick={closeDrawer} data-testid="button-back-to-map"><ChevronLeft size={13} /> Back to map</button>
        </div>
        <div className="pz-trip gr-head">
          <div className="gr-ep" data-testid="text-location-source"><span className="gr-dot from" aria-hidden="true" /><div><div className="eyebrow">From · Device location</div><strong>{origin ? (origin.name.startsWith('Your location ·') ? 'Twoja lokalizacja' : origin.name) : 'Waiting for location'}</strong>
          </div></div>
          <div className="gr-ep"><span className="gr-dot to" aria-hidden="true" /><div><div className="eyebrow">To</div><strong>{destination.name}</strong></div></div>
        </div>
        {chosen && route && <div data-testid="section-chosen-route">
          {activeRide && <div className="pz-route-sum" data-testid="status-live-ride" style={{ marginBottom: 8 }}>
            <strong>Jazda: {(activeRide.distanceMeters / 1000).toFixed(2)} km · {moneyText(rideFare(activeRide).amountCents)}</strong>
            <Link href="/user/ticket" className="btn" data-testid="link-go-checkout">Przejdź do check-out</Link>
          </div>}
          <button type="button" className="btn btn-quiet" style={{ minHeight: 30, fontSize: 11 }} onClick={() => { setChosen(false); setStepIdx(null); setMsg(null); }} data-testid="button-back-to-alternatives">Zmień trasę</button>
          <div className="pz-route-sum" data-testid="text-route-summary">
            <strong>{route.durationSeconds != null ? `${Math.round(route.durationSeconds / 60)} min` : 'brak czasu'} · {route.distanceMeters != null ? `${(route.distanceMeters / 1000).toFixed(1)} km` : 'brak dystansu'} · {route.transfers} przesiadek</strong>
            {walks.length > 0 && <span data-testid="text-walking-time">Pieszo: {walkingSeconds == null ? 'brak danych czasu' : `${Math.ceil(walkingSeconds / 60)} min`}</span>}
            <span>{quoted && quoted.legs.length ? `Szacunek: ${moneyText(quoted.totalCents)} — finalnie z GPS przy check-out` : 'Opłata liczona z GPS przy check-out'}</span>
          </div>
          {walkingOnly ? <p className="tiny" data-testid="text-walking-only">Trasa piesza — bez wsiadania, check-in niedostępny.</p> : <>
            <p className="tiny muted" style={{ margin: '8px 0 0' }}>Wybierz odcinek transportu, do którego wsiądziesz:</p>
            <ul className="pz-steps">{route.steps.map((s, i) => s.mode !== 'TRANSIT' ? null : <li key={i}>
              <button type="button" className="pz-step" aria-pressed={stepIdx === i} onClick={() => { setStepIdx(i); boardFromStep(s); }} data-testid={`button-step-${i}`}>
                <VehicleIcon type={s.vehicleType} /><span><strong>{s.lineShortName || s.lineName}</strong>{s.headsign ? ` → ${s.headsign}` : ''}<br />{s.departureStop} → {s.arrivalStop}</span></button></li>)}</ul>
            {blocker && <div className="notice" data-testid="status-checkin-blocked">{blocker} <Link href="/user/ticket">Otwórz przejazd</Link></div>}
            <button type="button" className="btn" style={{ width: '100%' }} onClick={() => boardFromStep()} disabled={!step} data-testid="button-open-boarding"><LogIn size={15} /> {step ? `Wsiadam: ${transportLabels[fareTransport(step.vehicleType)]} ${step.lineShortName || step.lineName || ''}` : 'Wybierz odcinek'}</button>
          </>}
          {msg && <div className={msg.ok ? 'pz-ok' : 'pz-alert'} role={msg.ok ? 'status' : 'alert'} style={{ marginTop: 8 }}>{msg.text} {msg.ok && <Link href="/user/ticket">Przejazd</Link>}</div>}
        </div>}
        <TransitDirections origin={planOrigin} destination={destination} selectedRouteId={route?.id ?? null}
          onSelectRoute={r => { setRoute(r); if (!r) { setChosen(false); setStepIdx(null); } }} onConfirmRoute={confirm} discountId={account.profile.discountId} autoPlanKey={key} />
        <p className="tiny muted pz-credit" data-testid="text-source-credit">Trasy: <span translate="no">Google Maps</span> · opłata: taryfa FairRide za kilometry GPS</p>
      </aside>}
    </div>
  </div>;
}
