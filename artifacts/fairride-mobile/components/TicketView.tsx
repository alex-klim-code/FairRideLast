import React, { useEffect, useState } from 'react';
import { View } from 'react-native';
import { useRouter } from 'expo-router';
import { discountFor, getActiveRide, getUnpaidRide, moneyText, rideFare, transportLabels, type PassengerRide } from '@workspace/fairride-core';
import { updateState } from '@/services/ride-store';
import { pay } from '@/services/ride-state';
import { checkOut, resumeTracking } from '@/services/native-tracking';
import { useRide } from '@/context/ride-context';
import { useColors } from '@/hooks/useColors';
import { Banner, Btn, Eyebrow, F, H2, Surface, Txt } from '@/components/ui';

const fmt = (v: string | number) => new Date(v).toLocaleString('en-GB');
const km = (m: number) => `${(m / 1000).toFixed(2)} km`;
function Summary({ r }: { r: PassengerRide }) {
  const c = useColors(), f = rideFare(r);
  return <View style={{ gap: 4 }}>
    <Txt>{transportLabels[r.transport]} {r.lineName} · {r.originName} → {r.destinationName}</Txt>
    <Txt>Dystans GPS {km(r.distanceMeters)} · {discountFor(r.discountId).label} {r.discountPercent}% off (ustalone przy wejściu)</Txt>
    <Txt>{r.status === 'active' ? 'Dotychczas' : 'Opłata'} <Txt style={{ fontFamily: F.b }}>{moneyText(f.amountCents)}</Txt> (base {moneyText(f.baseCents)})</Txt>
    {r.trackingWarning ? <Banner testID="text-tracking-warning" kind="notice">{r.trackingWarning}</Banner> : null}
    {r.gapCount > 0 && <Txt style={{ fontSize: 11, color: c.mutedForeground }}>Niepełny zapis GPS: {r.gapCount} luk, {r.samples} próbek.</Txt>}
  </View>;
}
export default function TicketView() {
  const c = useColors(), router = useRouter();
  const { state, busy, run } = useRide();
  const [history, setHistory] = useState(false);
  const [now, setNow] = useState(Date.now());
  useEffect(() => { const t = setInterval(() => setNow(Date.now()), 5000); return () => clearInterval(t); }, []);
  const account = state?.account;
  if (!account) return null;
  const ride = getActiveRide(account), unpaid = getUnpaidRide(account);
  const receipt = [...account.rides].filter(r => r.status === 'completed' && r.settled).sort((a, b) => Date.parse(String(b.endedAt ?? 0)) - Date.parse(String(a.endedAt ?? 0)))[0];
  if (history) {
    const rides = [...account.rides].sort((a, b) => Date.parse(b.startedAt) - Date.parse(a.startedAt));
    return <View style={{ gap: 12 }}>
      <Surface style={{ gap: 4 }}>
        <Btn variant="secondary" testID="history-back" title="Back to Bilet" onPress={() => setHistory(false)} style={{ alignSelf: 'flex-start', marginBottom: 6 }} />
        {rides.length === 0 ? <View style={{ alignItems: 'center', padding: 24, gap: 8 }}><H2>Brak przejazdów</H2><Txt style={{ color: c.mutedForeground }}>Zakończone przejazdy pojawią się tutaj.</Txt>
          <Btn testID="history-go" title="Go" onPress={() => router.navigate('/go')} /></View> :
          rides.map(r => <View key={r.id} testID={r.status === 'completed' ? `receipt-${r.id}` : `ride-${r.id}`} style={{ paddingVertical: 14, borderBottomWidth: 1, borderColor: '#efede5', gap: 4 }}>
            <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}><Txt style={{ fontFamily: F.b, flex: 1 }}>{r.destinationName}</Txt><Txt style={{ fontFamily: F.b }}>{moneyText(rideFare(r).amountCents)}</Txt></View>
            <Txt style={{ color: c.mutedForeground }}>{fmt(r.startedAt)} · {transportLabels[r.transport]} {r.lineName} · {km(r.distanceMeters)}</Txt>
            <Txt style={{ color: c.mutedForeground }}>{discountFor(r.discountId).label} ({r.discountPercent}% off) · {r.status === 'active' ? 'Aktywny' : r.settled ? 'Rozliczony' : 'Do rozliczenia'}</Txt>
            <Txt style={{ fontSize: 11, color: c.mutedForeground }}>Przerwy GPS: {r.gapCount}. Potwierdzenie nie zawiera surowych współrzędnych.</Txt>
            {r.trackingWarning ? <Txt style={{ fontSize: 11 }}>{r.trackingWarning}</Txt> : null}
          </View>)}
      </Surface>
      {account.tickets.length > 0 && <Surface><H2>Archiwum biletów (dawne)</H2>
        {account.tickets.map(t => <View key={t.id} testID={`ticket-${t.id}`} style={{ paddingVertical: 12, borderBottomWidth: 1, borderColor: '#efede5' }}>
          <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}><Txt style={{ fontFamily: F.b }}>{t.destinationName}</Txt><Txt style={{ fontFamily: F.b }}>{moneyText(t.amountCents)}</Txt></View>
          <Txt style={{ color: c.mutedForeground }}>{fmt(t.purchasedAt)}</Txt></View>)}</Surface>}
    </View>;
  }
  const ticketBox = { borderWidth: 2, borderStyle: 'dashed' as const, borderColor: c.ticketBorder, backgroundColor: c.ticketBg, borderRadius: 18, padding: 14, gap: 10 };
  return <View style={{ gap: 12 }}>
    {ride ? <View testID="active-ride" style={ticketBox}>
      <Eyebrow>Aktywny przejazd · od {fmt(ride.startedAt)}</Eyebrow><H2>{ride.lineName}</H2>
      <Summary r={ride} />
      <Txt testID="text-last-fix" style={{ fontSize: 11, color: c.mutedForeground }}>{ride.lastFix ? `Ostatni fix: ${Math.max(0, Math.round((now - ride.lastFix.timestamp) / 1000))} s temu, ±${Math.round(ride.lastFix.accuracy)} m.` : 'Brak świeżego GPS. Nie naliczamy dystansu przerwy.'} Trzymaj aplikację otwartą lub zezwól na pomiar w tle.</Txt>
      <Txt style={{ fontSize: 11, color: c.mutedForeground }}>Taryfa przy wejściu: {moneyText(ride.startFeeCents)} + {moneyText(ride.rateCentsPerKm)}/km. Saldo nie zostało obciążone przy check-in.</Txt>
      {state?.tracking !== 'running' && <Btn variant="secondary" testID="resume-tracking" title="Wznów GPS w tle" disabled={busy} onPress={() => void run(resumeTracking)} />}
      <Btn testID="checkout" title="Check-out" disabled={busy} onPress={() => void run(() => checkOut(ride.id))} />
    </View> : unpaid ? <View testID="unpaid-ride" style={ticketBox}>
      <Eyebrow>Przejazd do rozliczenia</Eyebrow><Summary r={unpaid} />
      {account.balanceCents < unpaid.amountCents && <Banner kind="notice">Za mało środków. Doładuj w Profile › Bills (symulowany portfel), potem rozlicz.</Banner>}
      {account.balanceCents < unpaid.amountCents && <Btn variant="secondary" testID="to-bills" title="Otwórz Profile" onPress={() => router.navigate('/profile')} />}
      <Btn testID="settle-ride" title={`Rozlicz ${moneyText(unpaid.amountCents)}`} disabled={busy || account.balanceCents < unpaid.amountCents} onPress={() => void run(() => updateState(s => pay(s, unpaid.id)))} />
    </View> : <Surface testID="empty-ride" style={{ alignItems: 'center', paddingVertical: 28, gap: 10 }}>
      {receipt && <View testID="ride-receipt" style={{ alignSelf: 'stretch', gap: 4 }}><Eyebrow>Ostatni przejazd · rozliczony</Eyebrow><Summary r={receipt} /></View>}
      <H2>Brak aktywnego przejazdu</H2><Txt style={{ color: c.mutedForeground, textAlign: 'center' }}>Wybierz cel w Go, wskaż linię i zrób check-in.</Txt>
      <View style={{ flexDirection: 'row', gap: 8 }}>
        <Btn testID="ticket-go" title="Go" onPress={() => router.navigate('/go')} />
        <Btn testID="ticket-history" variant="secondary" title="Historia" onPress={() => setHistory(true)} /></View>
    </Surface>}
    {(ride || unpaid) && <Btn testID="ticket-history" variant="secondary" title="Historia" onPress={() => setHistory(true)} />}
  </View>;
}
