import type { ReactNode } from 'react';
import { BusFront, ChevronDown, Footprints, TrainFront, TramFront } from 'lucide-react';
import './go-routes.css';

export type CardStep = {
  mode: string; durationSeconds: number | null; vehicleType?: string; lineShortName?: string; lineName?: string;
  departureTime?: string; arrivalTime?: string;
};
export type CardRoute = { durationSeconds: number | null; steps: CardStep[] };

const validMs = (iso?: string) => { if (!iso) return null; const t = Date.parse(iso); return Number.isFinite(t) ? t : null; };
const clockOf = (ms: number | null) => ms == null ? '' : new Date(ms).toLocaleTimeString('pl-PL', { hour: '2-digit', minute: '2-digit' });
const minText = (s: number | null | undefined) => s == null || !Number.isFinite(s) || s < 0 ? null : `${Math.max(s > 0 ? 1 : 0, Math.round(s / 60))} min`;

export function VehicleIcon({ type }: { type?: string }) {
  const t = (type || '').toUpperCase();
  if (t.includes('BUS')) return <BusFront size={16} aria-hidden="true" />;
  if (t === 'TRAM' || t === 'LIGHT_RAIL') return <TramFront size={16} aria-hidden="true" />;
  return <TrainFront size={16} aria-hidden="true" />;
}

/** Countdown derived only from the API departure time; recomputed locally from `now`. */
export function countdown(departureTime: string | undefined, now: number) {
  const t = validMs(departureTime);
  if (t == null) return { kind: 'missing' as const };
  const diff = t - now;
  if (diff < 0) return { kind: 'gone' as const, clock: clockOf(t) };
  if (diff >= 60 * 60000) return { kind: 'at' as const, clock: clockOf(t) };
  return { kind: 'in' as const, minutes: Math.max(0, Math.ceil(diff / 60000)) };
}

type Props = {
  route: CardRoute; index: number; active: boolean; expanded: boolean; now: number;
  onSelect: () => void; onToggle: () => void; fareLine: string; children?: ReactNode;
};

export function GoRouteCard({ route, index, active, expanded, now, onSelect, onToggle, fareLine, children }: Props) {
  const transit = route.steps.filter(s => s.mode === 'TRANSIT');
  const walkingOnly = transit.length === 0 && route.steps.length > 0 && route.steps.every(s => s.mode === 'WALK');
  const first = transit[0]; const last = transit[transit.length - 1];
  const fi = route.steps.indexOf(first);
  const sum = (steps: CardStep[]) => steps.length && steps.every(s => s.durationSeconds != null && Number.isFinite(s.durationSeconds) && s.durationSeconds >= 0) ? steps.reduce((a, s) => a + (s.durationSeconds as number), 0) : null;
  const access = first ? sum(route.steps.slice(0, fi).filter(s => s.mode === 'WALK')) : null;
  const cd = countdown(first?.departureTime, now);
  const dep = clockOf(validMs(first?.departureTime)); const arr = clockOf(validMs(last?.arrivalTime));
  const total = minText(route.durationSeconds);
  const depMs = validMs(first?.departureTime); const arrMs = validMs(last?.arrivalTime);
  const ride = depMs != null && arrMs != null && arrMs >= depMs ? minText((arrMs - depMs) / 1000) : null;

  let head: ReactNode;
  if (walkingOnly) head = <><span className="gr-label">Trasa piesza</span><span className="gr-big gr-big-sm">{total ?? 'brak czasu'}</span></>;
  else if (cd.kind === 'in') head = <><span className="gr-label">Odjazd za:</span><span className="gr-big">{String(cd.minutes).padStart(2, '0')}<small>min</small></span></>;
  else if (cd.kind === 'at') head = <><span className="gr-label">Odjazd o:</span><span className="gr-big gr-big-sm">{cd.clock}</span></>;
  else if (cd.kind === 'gone') head = <><span className="gr-label">Planowy odjazd minął</span><span className="gr-big gr-big-sm gr-dim">{cd.clock}</span></>;
  else head = <><span className="gr-label">Planowy odjazd:</span><span className="gr-big gr-big-sm gr-dim">brak godziny</span></>;

  return <div className={`gr-card ${active ? 'active' : ''}`} data-testid={`real-route-${index}`}>
    <button type="button" className="gr-main" onClick={onSelect} aria-pressed={active} data-testid={`button-real-route-${index}`}>
      <span className="gr-left">{head}</span>
      <span className="gr-mid">
        <span className="gr-lines">
          {transit.length === 0 && <span className="gr-note">{walkingOnly ? 'Tylko pieszo' : 'Brak danych o transporcie'}</span>}
          {transit.map((s, k) => <span className="gr-line" key={k}><VehicleIcon type={s.vehicleType} /><b>{s.lineShortName || s.lineName || '?'}</b></span>)}
        </span>
        {transit.length > 0 && <span className="gr-times">
          <Footprints size={13} aria-hidden="true" /><span aria-label={`Dojście pieszo: ${minText(access) ?? 'brak danych'}`}>{minText(access) ?? '–'}</span>
          {dep ? <span className="gr-chip gr-dep" aria-label={`Planowy odjazd: ${dep}`}>{dep}</span> : <span className="gr-note">brak godz.</span>}
          <span aria-label={`Czas jazdy z przesiadkami: ${ride ?? 'brak danych'}`}>{ride ?? 'brak czasu jazdy'}</span>
          {arr ? <span className="gr-chip gr-arr" aria-label={`Planowy przyjazd: ${arr}`}>{arr}</span> : <span className="gr-note">brak godz.</span>}
        </span>}
      </span>
      <span className="gr-total">{total ?? 'brak czasu'}</span>
      <span className="gr-fare" data-testid={`text-route-fare-${index}`}>{fareLine}</span>
    </button>
    <button type="button" className="gr-toggle" onClick={onToggle} aria-expanded={expanded} data-testid={`button-route-details-${index}`}>
      {expanded ? 'Ukryj szczegóły' : 'Pokaż szczegóły'}<ChevronDown size={14} aria-hidden="true" />
    </button>
    {expanded && <div className="gr-details">{children}</div>}
  </div>;
}
