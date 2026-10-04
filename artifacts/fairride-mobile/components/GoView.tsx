import React, { useEffect, useMemo, useRef, useState } from 'react';
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { Feather } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { searchAddresses, computeTransitRoutes, type TransitRoute, type TransitStep } from '@workspace/api-client-react';
import { discountFor, fareTransport, moneyText, getActiveRide, getUnpaidRide, quoteRoute, transportLabels, type RideSelection, type GpsFix } from '@workspace/fairride-core';
import { useRide } from '@/context/ride-context';
import { checkIn, foregroundFix, nativeBuild } from '@/services/native-tracking';
import { usePassengerLocation } from '@/hooks/use-passenger-location';
import NativePassengerMap from '@/components/NativePassengerMap';
import { RouteCard, VehicleIcon, clockOf, minText } from '@/components/RouteCard';
import { Banner, Btn, Eyebrow, F, Txt } from '@/components/ui';
import { useColors } from '@/hooks/useColors';

interface Address { name: string; lat: number; lng: number }
function toAddresses(features: Record<string, unknown>[]): Address[] {
  return features.flatMap(f => {
    const g = f.geometry as { coordinates?: unknown[] } | undefined, p = f.properties as { formatted?: unknown } | undefined;
    const [lng, lat] = g?.coordinates ?? [];
    if (typeof lng !== 'number' || typeof lat !== 'number' || Math.abs(lat) > 90 || Math.abs(lng) > 180 || typeof p?.formatted !== 'string') return [];
    return [{ name: p.formatted, lat, lng }];
  });
}
const usable = (f: GpsFix | null, now = Date.now()): boolean => !!f && f.accuracy <= 50 && now - f.timestamp <= 20000;

export default function GoView({ focused }: { focused: boolean }) {
  const c = useColors(), router = useRouter();
  const { state, busy, run, routes, setRoutes, setDestination } = useRide();
  const account = state?.account;
  const active = account ? getActiveRide(account) : null;
  const unpaid = account ? getUnpaidRide(account) : null;
  const loc = usePassengerLocation(focused || !!active);
  const fix = loc.fix;
  const asked = useRef(false);
  const requestRef = useRef(loc.request); requestRef.current = loc.request;
  useEffect(() => { if ((focused || active) && !asked.current) { asked.current = true; void requestRef.current(); } }, [focused, active]);

  const [query, setQuery] = useState('');
  const [sugs, setSugs] = useState<Address[]>([]);
  const [sugState, setSugState] = useState<'idle' | 'loading' | 'empty' | 'error'>('idle');
  const [dest, setDest] = useState<Address | null>(null);
  const [planning, setPlanning] = useState(false);
  const [planError, setPlanError] = useState('');
  const [route, setRoute] = useState<TransitRoute | null>(null);
  const [chosen, setChosen] = useState(false);
  const [stepIdx, setStepIdx] = useState<number | null>(null);
  const [open, setOpen] = useState(true);
  const [drawerHeight, setDrawerHeight] = useState(0);
  const [expanded, setExpanded] = useState<number | null>(0);
  const [consent, setConsent] = useState(false);
  const [msg, setMsg] = useState('');
  const [now, setNow] = useState(() => Date.now());
  const skip = useRef(false);
  const planSeq = useRef(0);
  useEffect(() => { const t = setInterval(() => setNow(Date.now()), 5000); return () => clearInterval(t); }, []);

  // Automatic suggestions: debounced, previous in-flight request aborted.
  useEffect(() => {
    if (skip.current) { skip.current = false; return; }
    const q = query.trim();
    if (q.length < 3) { setSugs([]); setSugState('idle'); return; }
    const ctl = new AbortController();
    const t = setTimeout(async () => {
      setSugState('loading');
      try {
        const r = await searchAddresses({ query: q }, { signal: ctl.signal });
        if (ctl.signal.aborted) return;
        const found = toAddresses(r.features);
        setSugs(found); setSugState(found.length ? 'idle' : 'empty');
      } catch { if (!ctl.signal.aborted) { setSugs([]); setSugState('error'); } }
    }, 350);
    return () => { clearTimeout(t); ctl.abort(); };
  }, [query]);

  async function plan(a: Address) {
    const seq = ++planSeq.current;
    skip.current = true; setQuery(a.name); setSugs([]); setSugState('idle');
    setDest(a); setDestination(a.name); setRoutes([]); setRoute(null); setChosen(false); setStepIdx(null); setConsent(false); setMsg('');
    setPlanError(''); setOpen(true); setExpanded(0); setPlanning(true);
    try {
      // Origin is frozen at deliberate destination selection; live GPS only feeds the map.
      const origin = fix && usable(fix) ? fix : await foregroundFix();
      if (!usable(origin)) throw new Error('Lokalizacja jest niedokładna. Spróbuj poza budynkiem.');
      const res = await computeTransitRoutes({ origin: { lat: origin.lat, lng: origin.lng }, destination: { lat: a.lat, lng: a.lng } });
      if (seq !== planSeq.current) return;
      setRoutes(res.routes);
      if (!res.routes.length) setPlanError('Brak dostępnych tras dla tego celu.');
    } catch (e) { if (seq === planSeq.current) setPlanError(e instanceof Error ? e.message : 'Nie udało się wyznaczyć trasy.'); }
    finally { if (seq === planSeq.current) setPlanning(false); }
  }
  function clear() {
    planSeq.current++; skip.current = true; setQuery(''); setSugs([]); setSugState('idle'); setDest(null); setDestination(''); setRoutes([]);
    setRoute(null); setChosen(false); setStepIdx(null); setPlanError(''); setPlanning(false); setMsg('');
  }
  function choose(r: TransitRoute, step: number | null) {
    setRoute(r); setChosen(true); setConsent(false); setMsg('');
    const t = r.steps.map((s, i) => s.mode === 'TRANSIT' ? i : -1).filter(i => i >= 0);
    setStepIdx(step ?? (t.length === 1 ? t[0]! : null));
  }
  const fareLine = (r: TransitRoute) => {
    try { const q = quoteRoute(r, account!.profile.discountId); return q.legs.length ? `Szacunek: ${moneyText(q.totalCents)} — finalnie z GPS przy check-out` : 'Opłata liczona z GPS przy check-out'; }
    catch { return 'Opłata liczona z GPS przy check-out'; }
  };
  const step: TransitStep | null = route && stepIdx != null ? route.steps[stepIdx] ?? null : null;
  const selection: RideSelection | null = step?.mode === 'TRANSIT' ? {
    transport: fareTransport(step.vehicleType), lineName: (step.lineShortName || step.lineName || step.vehicleType || 'Transport').slice(0, 160),
    originName: (step.departureStop || 'Punkt wejścia').slice(0, 160), destinationName: (step.arrivalStop || dest?.name || '').slice(0, 160) } : null;
  const walkingOnly = !!route && !route.steps.some(s => s.mode === 'TRANSIT');
  const quoted = useMemo(() => { try { return route ? quoteRoute(route, account!.profile.discountId) : null; } catch { return null; } }, [route, account]);
  const age = fix ? Math.max(0, Math.round((now - fix.timestamp) / 1000)) : null;
  const blocker = active ? 'Masz aktywny przejazd.' : unpaid ? 'Poprzedni przejazd czeka na rozliczenie w zakładce Bilet.' : null;
  const drawerOpen = !!dest && open;
  const showSug = sugs.length > 0 || sugState === 'loading' || sugState === 'empty' || sugState === 'error';
  const ownDest = dest && (dest.name === query);

  return <View style={s.go}>
    <View style={s.searchWrap}>
      <View style={[s.search, { backgroundColor: c.inputBg, borderColor: c.quietBorder }]}>
        <Pressable testID="search-address" accessibilityLabel="Szukaj adresu" onPress={() => setQuery(q => q + '')} style={s.searchIcon}><Feather name="search" size={18} color="#315444" /></Pressable>
        <TextInput testID="destination-input" accessibilityLabel="Adres docelowy" value={query} onChangeText={t => { if (dest) { setDest(null); setRoutes([]); setRoute(null); setChosen(false); } setQuery(t); }}
          placeholder="Dokąd jedziemy? Ulica lub miejsce" placeholderTextColor={c.mutedForeground} autoCorrect={false}
          style={[s.input, { color: c.foreground, fontFamily: F.r }]} />
        {(query.length > 0 || dest) && <Pressable testID="destination-clear" accessibilityLabel="Wyczyść cel" onPress={clear} style={[s.clear, { backgroundColor: '#f0f2eb' }]}><Feather name="x" size={16} color="#52695b" /></Pressable>}
      </View>
      {showSug && !ownDest && <View style={[s.sugs, { backgroundColor: c.inputBg, borderColor: c.quietBorder }]}>
        {sugState === 'loading' && <Txt style={s.sugNote}>Szukam adresów…</Txt>}
        {sugState === 'empty' && <Txt style={s.sugNote}>Nie znaleziono adresu. Podaj ulicę i miasto.</Txt>}
        {sugState === 'error' && <Txt style={s.sugNote}>Wyszukiwanie jest niedostępne lub przekroczono limit. Spróbuj później.</Txt>}
        <ScrollView keyboardShouldPersistTaps="handled" style={{ maxHeight: 300 }}>
          {sugs.map((a, i) => <Pressable key={`${a.name}-${i}`} testID={`address-${i}`} onPress={() => void plan(a)} style={s.sug}>
            <Feather name="map-pin" size={16} color="#32715a" /><Txt style={{ flex: 1, fontFamily: F.s, fontSize: 12, color: '#315444' }}>{a.name}</Txt></Pressable>)}
        </ScrollView>
        <Txt style={[s.sugNote, { fontSize: 10, textAlign: 'right' }]}>Adresy: Geoapify</Txt>
      </View>}
    </View>
    {active && <Pressable testID="status-live-ride" onPress={() => router.navigate('/ticket')} style={[s.liveBar, { backgroundColor: c.rideCard }]}>
      <Txt style={{ color: '#f7f2e8', fontFamily: F.b, fontSize: 13, flex: 1 }}>Jazda: {(active.distanceMeters / 1000).toFixed(2)} km · {moneyText(active.amountCents)}</Txt>
      <Txt style={{ color: c.amber, fontFamily: F.b, fontSize: 12 }}>Bilet</Txt></Pressable>}
    {!fix && <View testID="status-device-location" style={[s.loc, { backgroundColor: c.noticeBg }]}>
      <Txt style={{ flex: 1, fontSize: 12, color: c.noticeFg }}>{loc.loading ? 'Waiting for your device location.' : loc.error || 'Your location has not been shared yet.'} No substitute position is used.</Txt>
      <Btn small variant="secondary" title="Locate me" testID="button-locate" disabled={loc.loading} onPress={() => void loc.request()} />
    </View>}
    <View style={[s.map, { borderColor: '#deded4', backgroundColor: '#e7e9df' }]} testID="map-frame-google">
      <NativePassengerMap origin={fix} destination={dest ? { name: dest.name, lat: dest.lat, lng: dest.lng } : null} route={route} selectedStep={chosen ? stepIdx : null} bottomInset={chosen && open ? drawerHeight : 0} />
      {fix && <Pressable testID="button-locate-refresh" accessibilityLabel="Refresh my GPS location" disabled={loc.loading} onPress={() => void loc.request()}
        style={[s.fab, { bottom: dest && !open ? 70 : 14, backgroundColor: '#fbfaf6', borderColor: '#e6e2d9' }]}><Feather name="navigation" size={16} color="#40574d" /></Pressable>}
      {dest && !open && <Btn testID="button-reopen-results" title="Trasa" icon={<Feather name="list" size={15} color={c.primaryForeground} />} onPress={() => setOpen(true)} style={s.reopen} />}
      {drawerOpen && <View testID="text-selected-destination" onLayout={e => setDrawerHeight(e.nativeEvent.layout.height)} style={[s.drawer, chosen ? { bottom: 0, maxHeight: '52%' } : { top: 0, bottom: 30 }, { backgroundColor: c.card, borderColor: c.border }]}>
        <View style={[s.drawerHead, { borderColor: '#efede5' }]}>
          <Btn small variant="secondary" testID="button-back-to-map" title="Back to map" icon={<Feather name="chevron-left" size={13} color={c.btnSecondaryFg} />} onPress={() => setOpen(false)} />
        </View>
        <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={{ padding: 14, gap: 10 }} nestedScrollEnabled>
          {!chosen && <View style={[s.trip, { backgroundColor: c.grHead }]}>
            <View style={s.ep} testID="text-location-source"><View style={[s.dot, { borderColor: c.depGreen, backgroundColor: c.grHead }]} /><View style={{ flex: 1 }}><Text style={s.epEy}>From · Device location</Text><Text style={s.epName}>{fix ? 'Twoja lokalizacja' : 'Waiting for location'}</Text></View></View>
            <View style={s.ep}><View style={[s.dot, { borderColor: c.arrBlue, backgroundColor: c.grHead }]} /><View style={{ flex: 1 }}><Text style={s.epEy}>To</Text><Text style={s.epName}>{dest!.name}</Text></View></View>
          </View>}
          {planning && <View style={{ gap: 8 }} accessibilityLabel="Ładowanie tras">{[0, 1].map(i => <View key={i} style={{ height: 110, borderRadius: 14, backgroundColor: c.grCard, opacity: .55 }} />)}<ActivityIndicator color={c.primary} /></View>}
          {!!planError && <Banner kind="alert">{planError}</Banner>}
          {!planning && <Btn small variant="secondary" testID="button-refresh-routes" title="Odśwież trasę" disabled={busy} onPress={() => void plan(dest!)} />}
          {chosen && route ? <View testID="section-chosen-route" style={{ gap: 8 }}>
            <Btn small variant="quiet" testID="button-back-to-alternatives" title="Zmień trasę" onPress={() => { setChosen(false); setStepIdx(null); setMsg(''); }} />
            <View testID="text-route-summary" style={[s.sum, { backgroundColor: c.rideCard }]}>
              <Text style={{ color: '#f7f2e8', fontFamily: F.b, fontSize: 14 }}>{route.durationSeconds != null ? `${Math.round(route.durationSeconds / 60)} min` : 'brak czasu'} · {route.distanceMeters != null ? `${(route.distanceMeters / 1000).toFixed(1)} km` : 'brak dystansu'} · {route.transfers} przesiadek</Text>
              <Text style={{ color: '#f7f2e8', fontFamily: F.r, fontSize: 12 }}>{quoted && quoted.legs.length ? `Szacunek: ${moneyText(quoted.totalCents)} — finalnie z GPS przy check-out` : 'Opłata liczona z GPS przy check-out'}</Text>
            </View>
            {walkingOnly ? <Txt testID="text-walking-only" style={{ fontSize: 11 }}>Trasa piesza — bez wsiadania, check-in niedostępny.</Txt> : <>
              <Txt style={{ fontSize: 11, color: c.mutedForeground }}>Wybierz odcinek transportu, do którego wsiądziesz:</Txt>
              {route.steps.map((st, i) => st.mode !== 'TRANSIT' ? null : <Pressable key={i} testID={`button-step-${i}`} onPress={() => setStepIdx(i)} accessibilityState={{ selected: stepIdx === i }}
                style={[s.step, { borderColor: stepIdx === i ? '#1d6853' : c.quietBorder, backgroundColor: c.inputBg }]}>
                <VehicleIcon type={st.vehicleType} color="#315444" />
                <Txt style={{ flex: 1, fontSize: 12 }}><Txt style={{ fontFamily: F.b, fontSize: 12 }}>{st.lineShortName || st.lineName}</Txt>{st.headsign ? ` → ${st.headsign}` : ''}{'\n'}{st.departureStop} → {st.arrivalStop}</Txt></Pressable>)}
              <Txt testID="status-gps-fix" style={{ fontSize: 11 }}>{usable(fix, now) && fix ? `Świeży fix GPS (${age} s, ±${Math.round(fix.accuracy)} m).` : fix ? `Fix GPS nieaktualny lub zbyt niedokładny (${age} s, ±${Math.round(fix.accuracy)} m).` : 'Brak fixu GPS z czasem pomiaru.'} Godziny tras to czasy planowane, nie pozycje pojazdów.</Txt>
              {!!loc.error && <Txt style={{ fontSize: 11, color: c.destructive }}>{loc.error}</Txt>}
              {selection && <View style={{ gap: 8 }}>
                <Txt style={{ fontFamily: F.b }}>Check-in · {selection.lineName} ({transportLabels[selection.transport]})</Txt>
                <Txt>{selection.originName} → {selection.destinationName}</Txt>
                <Txt style={{ fontSize: 12, color: c.mutedForeground }}>Ulga przy wejściu: {discountFor(account!.profile.discountId).label}. Nie łączymy linii Google z pojazdem demonstracyjnym.</Txt>
                <Txt>Pomiar korzysta z dokładnej lokalizacji także przy zablokowanym ekranie. Zgoda „Zawsze” jest wymagana; Android może otworzyć ustawienia i pokaże powiadomienie aktywnego pomiaru.</Txt>
                <Txt style={{ fontSize: 12, color: c.mutedForeground }}>System, oszczędzanie baterii lub zakończenie procesu mogą przerwać GPS. Nie odtwarzamy brakujących kilometrów.</Txt>
                {!nativeBuild && <Banner kind="alert">Podgląd web / Expo Go: check-in w tle jest niedostępny. Wymagana natywna kompilacja.</Banner>}
                <Pressable testID="background-consent" accessibilityRole="checkbox" accessibilityState={{ checked: consent }} onPress={() => setConsent(!consent)} style={s.consent}>
                  <Feather name={consent ? 'check-square' : 'square'} size={24} color={c.primary} /><Txt style={{ flex: 1 }}>Rozumiem i chcę udzielić zgody na GPS w tle.</Txt></Pressable>
              </View>}
              {blocker && <Banner testID="status-checkin-blocked" kind="notice">{blocker}</Banner>}
              <Btn testID="checkin" title={selection ? 'Zezwól i zrób check-in' : 'Wybierz odcinek'} icon={<Feather name="log-in" size={15} color={c.primaryForeground} />}
                disabled={!selection || !consent || busy || !nativeBuild || !!blocker}
                onPress={() => void run(async () => { const r = await checkIn(selection!); setMsg('Zameldowano. Jazda jest aktywna.'); return r; })} />
            </>}
            {!!msg && <Banner kind="ok">{msg}</Banner>}
          </View> : !planning && <View style={{ gap: 10 }}>
            {routes.map((r, i) => <RouteCard key={r.id} route={r} index={i} active={route?.id === r.id} expanded={expanded === i} now={now} fareLine={fareLine(r)}
              onSelect={() => setRoute(r)} onToggle={() => setExpanded(expanded === i ? null : i)}>
              {r.steps.map((st, si) => st.mode === 'TRANSIT'
                ? <Pressable key={si} testID={`route-${i}-step-${si}`} onPress={() => choose(r, si)} style={s.dStep}>
                    <VehicleIcon type={st.vehicleType} />
                    <Text style={{ flex: 1, color: c.grText, fontFamily: F.r, fontSize: 12 }}><Text style={{ fontFamily: F.b }}>{st.lineShortName || st.lineName || st.vehicleType}</Text>{st.headsign ? ` → ${st.headsign}` : ''}{'\n'}{st.departureStop} → {st.arrivalStop}{'\n'}{clockOf(st.departureTime ? Date.parse(st.departureTime) : null) || '—'} → {clockOf(st.arrivalTime ? Date.parse(st.arrivalTime) : null) || '—'} (planowo)</Text>
                    <Text style={{ color: c.link, fontFamily: F.s, fontSize: 11 }}>Wybierz</Text></Pressable>
                : <View key={si} style={s.dStep}><Feather name="user" size={14} color={c.grSoft} />
                    <Text style={{ flex: 1, color: c.grSoft, fontFamily: F.r, fontSize: 12 }}>{st.instruction || 'Odcinek pieszy'}{st.durationSeconds != null ? ` · ${minText(st.durationSeconds)}` : ''}{st.distanceMeters != null ? ` · ${Math.round(st.distanceMeters)} m pieszo` : ''}</Text></View>)}
              <Btn testID={`button-confirm-route-${i}`} variant="yellow" title="Wybierz trasę" onPress={() => choose(r, null)} />
            </RouteCard>)}
          </View>}
          <Txt testID="text-source-credit" style={{ fontSize: 10, color: c.mutedForeground }}>Trasy: Google Maps · opłata: taryfa FairRide za kilometry GPS</Txt>
        </ScrollView>
      </View>}
    </View>
  </View>;
}
const s = StyleSheet.create({
  go: { flex: 1, gap: 8, padding: 10, paddingBottom: 10 },
  searchWrap: { zIndex: 50 },
  search: { flexDirection: 'row', alignItems: 'center', borderWidth: 1, borderRadius: 11, minHeight: 48 },
  searchIcon: { width: 44, height: 44, alignItems: 'center', justifyContent: 'center' },
  input: { flex: 1, fontSize: 16, paddingVertical: 10, paddingRight: 8, minWidth: 0 },
  clear: { width: 32, height: 32, borderRadius: 8, alignItems: 'center', justifyContent: 'center', marginRight: 8 },
  sugs: { position: 'absolute', top: 55, left: 0, right: 0, borderWidth: 1, borderRadius: 12, overflow: 'hidden', zIndex: 60, elevation: 8 },
  sug: { flexDirection: 'row', alignItems: 'center', gap: 10, padding: 12, minHeight: 44 }, sugNote: { padding: 12, fontSize: 12, color: '#758078' },
  liveBar: { flexDirection: 'row', alignItems: 'center', padding: 10, borderRadius: 12, gap: 8 },
  loc: { flexDirection: 'row', alignItems: 'center', gap: 8, padding: 8, paddingHorizontal: 10, borderRadius: 12 },
  map: { flex: 1, minHeight: 140, borderRadius: 20, borderWidth: 1, overflow: 'hidden' },
  fab: { position: 'absolute', left: 10, width: 40, height: 40, borderRadius: 12, borderWidth: 1, alignItems: 'center', justifyContent: 'center', zIndex: 5 },
  reopen: { position: 'absolute', left: 10, bottom: 14, zIndex: 6 },
  drawer: { position: 'absolute', left: 0, right: 0, zIndex: 10, borderRadius: 14, borderWidth: 1, overflow: 'hidden', elevation: 10 },
  drawerHead: { paddingHorizontal: 14, paddingVertical: 6, borderBottomWidth: 1, alignItems: 'flex-start', backgroundColor: '#fffefa' },
  trip: { borderRadius: 14, padding: 12, gap: 7 }, ep: { flexDirection: 'row', gap: 10, alignItems: 'flex-start' },
  dot: { width: 16, height: 16, borderRadius: 8, borderWidth: 4, marginTop: 2 },
  epEy: { color: '#b4b4af', fontFamily: F.b, fontSize: 10, letterSpacing: 1.2, textTransform: 'uppercase' }, epName: { color: '#f2f2f0', fontFamily: F.b, fontSize: 13 },
  sum: { borderRadius: 12, padding: 10, gap: 6 },
  step: { flexDirection: 'row', alignItems: 'center', gap: 8, padding: 8, borderWidth: 1, borderRadius: 10, minHeight: 44 },
  consent: { flexDirection: 'row', alignItems: 'center', gap: 12, minHeight: 44 },
  dStep: { flexDirection: 'row', alignItems: 'center', gap: 8, minHeight: 40 },
});
