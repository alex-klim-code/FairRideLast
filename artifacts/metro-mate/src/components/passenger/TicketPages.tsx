import { useEffect, useRef, useState } from 'react';
import { Link } from 'wouter';
import { moneyText, transportLabels, discountFor } from '../../services/fare-policy-exports';
import { getActiveRide, getUnpaidRide, rideFare, type GpsFix, type PassengerRide } from '../../services/passenger-ride';
import type { PassengerAccountController } from '../../hooks/use-passenger-account';
import { ActiveTicketQr } from './ActiveTicketQr';

const fmt = (s: string | number) => new Date(s).toLocaleString('pl-PL', { timeZone: 'Europe/Warsaw' });
const km = (m: number) => `${(m / 1000).toFixed(2)} km`;
const useNow = () => { const [n, setN] = useState(Date.now()); useEffect(() => { const t = setInterval(() => setN(Date.now()), 5000); return () => clearInterval(t); }, []); return n; };
const oneShotFix = () => new Promise<GpsFix | undefined>(res => {
  if (!navigator.geolocation) return res(undefined);
  navigator.geolocation.getCurrentPosition(p => res({ lat: p.coords.latitude, lng: p.coords.longitude, accuracy: p.coords.accuracy, timestamp: p.timestamp }), () => res(undefined), { enableHighAccuracy: true, timeout: 6000, maximumAge: 0 });
});

function RideSummary({ r }: { r: PassengerRide }) {
  const f = rideFare(r);
  return <>
    <p>{transportLabels[r.transport]} {r.lineName} · {r.originName} → {r.destinationName}</p>
    <p>Dystans GPS {km(r.distanceMeters)} · {discountFor(r.discountId).label} {r.discountPercent}% off (ustalone przy wejściu)</p>
    <p>{r.status === 'active' ? 'Dotychczas' : 'Opłata'} <strong>{moneyText(f.amountCents)}</strong> (base {moneyText(f.baseCents)})</p>
    {r.trackingWarning && <div className="notice" data-testid="text-tracking-warning">{r.trackingWarning}</div>}
    {r.gapCount > 0 && <p className="tiny muted">Niepełny zapis GPS: {r.gapCount} luk, {r.samples} próbek.</p>}
  </>;
}

export function TicketPage({ controller }: { controller: PassengerAccountController }) {
  const now = useNow();
  const account = controller.account!;
  const ride = getActiveRide(account);
  const unpaid = getUnpaidRide(account);
  const [err, setErr] = useState('');
  const busyOut = useRef(false);
  const out = async () => {
    if (busyOut.current || !ride) return;
    busyOut.current = true; setErr(''); const id = ride.id;
    try { const fix = await Promise.race([oneShotFix(), new Promise<undefined>(r => setTimeout(() => r(undefined), 3000))]); await controller.checkOut(fix, id); }
    catch (e) { setErr(e instanceof Error ? e.message : 'Check-out nie powiódł się.'); }
    finally { busyOut.current = false; }
  };
  const receipt = [...account.rides].filter(r => r.status === 'completed' && r.settled).sort((a, b) => Date.parse(String(b.endedAt ?? 0)) - Date.parse(String(a.endedAt ?? 0)))[0];
  const settle = async (id: string) => { setErr(''); try { await controller.settleRide(id); } catch (e) { setErr(e instanceof Error ? e.message : 'Rozliczenie nie powiodło się.'); } };
  return <>
    {err && <div className="pz-alert" role="alert">{err}</div>}
    {ride ? <section className="pz-ticket" aria-label="Aktywny przejazd" data-testid="active-ride" style={{ marginBottom: 16 }}>
      <div className="eyebrow">Aktywny bilet · check-in {fmt(ride.startedAt)}</div><h2>{ride.lineName}</h2>
      <RideSummary r={ride} />
      <ActiveTicketQr ride={ride} />
      <p className="tiny muted" data-testid="text-last-fix">{ride.lastFix ? `Ostatni fix: ${Math.max(0, Math.round((now - ride.lastFix.timestamp) / 1000))} s temu, ±${Math.round(ride.lastFix.accuracy)} m.` : 'Brak fixu GPS.'} Trzymaj aplikację otwartą na pierwszym planie.</p>
      <button className="btn" onClick={out} disabled={controller.busy} data-testid="button-check-out" style={{ width: '100%' }}>Check-out</button>
    </section> : unpaid ? <section className="pz-ticket" data-testid="unpaid-ride" style={{ marginBottom: 16 }}>
      <div className="eyebrow">Przejazd do rozliczenia</div><RideSummary r={unpaid} />
      {account.balanceCents < unpaid.amountCents
        ? <div className="notice">Za mało środków. <Link href="/user/bills">Doładuj w Bills</Link>, potem rozlicz.</div> : null}
      <button className="btn" onClick={() => settle(unpaid.id)} disabled={controller.busy || account.balanceCents < unpaid.amountCents} data-testid="button-settle-ride">Rozlicz {moneyText(unpaid.amountCents)}</button>
    </section> : <section className="surface pad empty-state" data-testid="empty-ride" style={{ marginBottom: 16 }}>
      {receipt && <div data-testid="ride-receipt"><div className="eyebrow">Ostatni przejazd · rozliczony</div><RideSummary r={receipt} /></div>}<h2>Brak aktywnego przejazdu</h2><p>Wybierz cel w Go, wskaż linię i zrób check-in.</p>
      <Link href="/user/map" className="btn">Go</Link> <Link href="/user/tickets/history" className="btn btn-secondary">Historia</Link></section>}
  </>;
}

export function TicketHistoryPage({ controller }: { controller: PassengerAccountController }) {
  const rides = [...controller.account!.rides].sort((a, b) => Date.parse(b.startedAt) - Date.parse(a.startedAt));
  const tickets = controller.account!.tickets;
  return <>
    <section className="surface pad" aria-label="Ride history"><Link href="/user/ticket" className="btn btn-secondary">Back to Bilet</Link>
      {rides.length === 0 ? <div className="empty-state"><h2>Brak przejazdów</h2><p>Zakończone przejazdy pojawią się tutaj.</p><Link href="/user/map" className="btn">Go</Link></div> :
        rides.map(r => <article className="pz-hist" key={r.id} data-testid={`ride-${r.id}`}>
          <div style={{ display: 'flex', justifyContent: 'space-between' }}><strong>{r.destinationName}</strong><strong className="data">{moneyText(rideFare(r).amountCents)}</strong></div>
          <span className="muted">{fmt(r.startedAt)} · {transportLabels[r.transport]} {r.lineName} · {km(r.distanceMeters)}</span>
          <span className="muted">{discountFor(r.discountId).label} ({r.discountPercent}% off) · {r.status === 'active' ? 'Aktywny' : r.settled ? 'Rozliczony' : 'Do rozliczenia'}</span>
          {r.trackingWarning && <span className="tiny">{r.trackingWarning}</span>}
        </article>)}
    </section>
    {tickets.length > 0 && <section className="surface pad" style={{ marginTop: 16 }} aria-label="Legacy tickets archive" data-testid="section-legacy-tickets"><h2>Archiwum biletów (dawne)</h2>
      {tickets.map(t => <article className="pz-hist" key={t.id} data-testid={`ticket-${t.id}`}>
        <div style={{ display: 'flex', justifyContent: 'space-between' }}><strong>{t.destinationName}</strong><strong className="data">{moneyText(t.amountCents)}</strong></div>
        <span className="muted">{fmt(t.purchasedAt)} · {t.transports.map(x => transportLabels[x]).join(', ')}</span>
      </article>)}</section>}
  </>;
}
