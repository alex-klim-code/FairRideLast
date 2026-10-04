import { useEffect, useRef, useState } from 'react';
import { Link } from 'wouter';
import { LogIn } from 'lucide-react';
import type { PassengerAccountController } from '../../hooks/use-passenger-account';
import { discountFor, transportLabels } from '../../services/fare-policy-exports';
import { DEFAULT_RATE, START_FEE, rates } from '../../services/pricing';
import { getActiveRide, getUnpaidRide, isUsableFix, type GpsFix, type RideSelection } from '../../services/passenger-ride';
import { VehicleIcon } from './GoRouteCard';
import { TicketPage } from './TicketPages';
import { warsawTime, type BoardingSelection } from './boarding';

const pln = (v: number) => `${v.toFixed(2).replace('.', ',')} PLN`;
const freshFix = () => new Promise<GpsFix | null>(res => {
  if (!navigator.geolocation) return res(null);
  const timer = setTimeout(() => res(null), 9000);
  navigator.geolocation.getCurrentPosition(p => { clearTimeout(timer); res({ lat: p.coords.latitude, lng: p.coords.longitude, accuracy: p.coords.accuracy, timestamp: p.timestamp }); },
    () => { clearTimeout(timer); res(null); }, { enableHighAccuracy: true, timeout: 8000, maximumAge: 0 });
});

type Props = { controller: PassengerAccountController; selection: BoardingSelection | null; onClear: () => void };

export function BoardingPage({ controller, selection, onClear }: Props) {
  const account = controller.account!;
  const ride = getActiveRide(account);
  const unpaid = getUnpaidRide(account);
  const [err, setErr] = useState('');
  const [pending, setPending] = useState(false);
  const guard = useRef(false);
  const clearRef = useRef(onClear); clearRef.current = onClear;
  useEffect(() => { if (ride) clearRef.current(); }, [ride]);

  if (ride) return <div data-testid="page-boarding-active">
    <section className="pz-frozen" data-testid="section-frozen-rate">
      <div className="eyebrow">Check-in potwierdzony</div>
      <div className="pz-board-head">
        <span className={`pz-board-icon ${ride.transport.toLowerCase()}`}><VehicleIcon type={ride.transport} /></span>
        <div><strong>{ride.transportName || transportLabels[ride.transport]}</strong><h1>{ride.lineNumber || ride.lineName}</h1></div>
      </div>
      <dl>
        <div><dt>Start</dt><dd data-testid="text-started-at">{new Date(ride.startedAt).toLocaleString('pl-PL', { timeZone: 'Europe/Warsaw' })}</dd></div>
        <div><dt>Twoja taryfa</dt><dd data-testid="text-frozen-rate">{pln(ride.rateCentsPerKm / 100 * (100 - ride.discountPercent) / 100)} / km</dd></div>
        <div><dt>Opłata startowa</dt><dd>{pln(ride.startFeeCents / 100 * (100 - ride.discountPercent) / 100)}</dd></div>
        <div><dt>Ulga</dt><dd>{discountFor(ride.discountId).label}, {ride.discountPercent}%</dd></div>
      </dl>
    </section>
    <TicketPage controller={controller} />
  </div>;

  if (!selection) return <div data-testid="page-boarding-empty"><TicketPage controller={controller} />
    <div className="pz-boarding-links"><Link href="/user/map" className="btn" data-testid="link-boarding-go">Wybierz odjazd w Go</Link><Link href="/user/tickets/history" className="btn btn-secondary" data-testid="link-boarding-history">Historia</Link></div></div>;

  const discount = discountFor(account.profile.discountId);
  const base = selection.transport === 'BUS' || selection.transport === 'TRAM' ? rates[selection.transport] : DEFAULT_RATE;
  const mult = (100 - discount.percent) / 100;
  const time = warsawTime(selection.scheduledDepartureTime);
  const blocker = unpaid ? 'Poprzedni przejazd czeka na rozliczenie.' : null;

  const confirm = async () => {
    if (guard.current || blocker) return;
    guard.current = true; setPending(true); setErr('');
    try {
      const fix = await freshFix();
      if (!fix || !isUsableFix(fix)) { setErr('Brak świeżej, dokładnej lokalizacji GPS (do 50 m). Check-in nie został rozpoczęty. Sprawdź uprawnienia i spróbuj ponownie.'); return; }
      const sel: RideSelection & Partial<BoardingSelection> = { transport: selection.transport, lineName: selection.lineName, originName: selection.originName,
        destinationName: selection.destinationName, transportName: selection.transportName, lineNumber: selection.lineNumber, scheduledDepartureTime: selection.scheduledDepartureTime };
      await controller.checkIn(sel, fix, crypto.randomUUID());
    } catch (e) { setErr(e instanceof Error ? e.message : 'Check-in nie powiódł się.'); }
    finally { guard.current = false; setPending(false); }
  };

  return <section className="pz-boarding surface" aria-label="Wsiadanie" data-testid="page-boarding">
    <div className="eyebrow">Podgląd przed check-in</div>
    <div className="pz-board-head">
      <span className={`pz-board-icon ${selection.transport.toLowerCase()}`}><VehicleIcon type={selection.transport} /></span>
      <div><strong data-testid="text-transport-name">{selection.transportName}</strong>
        <h1 data-testid="text-line-number">{selection.lineNumber}</h1></div>
    </div>
    <p className="pz-board-route" data-testid="text-boarding-route">{selection.originName} → {selection.destinationName}</p>
    {time && <p className="tiny muted" data-testid="text-scheduled">Planowy odjazd {time}{selection.scheduleSource ? ` · ${selection.scheduleSource}` : ''}</p>}
    <dl className="pz-rate" data-testid="section-rate-preview">
      <div><dt>Twoja taryfa</dt><dd><strong data-testid="text-rate">{pln(base * mult)} / km</strong></dd></div>
      <div><dt>Ulga</dt><dd data-testid="text-discount">{discount.label}{discount.percent ? `, ${discount.percent}%` : ''}</dd></div>
      <div><dt>Stawka bazowa</dt><dd>{pln(base)} / km</dd></div>
      <div><dt>Opłata startowa</dt><dd>{pln(START_FEE * mult)}{discount.percent ? ` (z ${pln(START_FEE)})` : ''}</dd></div>
      <div><dt>Check-in</dt><dd data-testid="text-checkin-state">nie rozpoczęto</dd></div>
    </dl>
    <p className="tiny muted">{transportLabels[selection.transport]} · GPS ruszy dopiero po potwierdzeniu. Podgląd nic nie kosztuje.</p>
    {blocker && <div className="notice" data-testid="status-checkin-blocked">{blocker} <Link href="/user/ticket">Otwórz przejazd</Link></div>}
    {err && <div className="pz-alert" role="alert" data-testid="text-checkin-error">{err}</div>}
    <button type="button" className="btn pz-confirm" onClick={confirm} disabled={pending || controller.busy || !!blocker} data-testid="button-confirm-check-in">
      <LogIn size={16} /> {pending ? 'Ustalanie lokalizacji…' : 'Check-in'}</button>
    <button type="button" className="btn btn-quiet pz-confirm" onClick={onClear} data-testid="button-cancel-boarding">Anuluj</button>
  </section>;
}
