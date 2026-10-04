import React, { type ReactNode } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { Feather, MaterialCommunityIcons } from '@expo/vector-icons';
import type { TransitStep } from '@workspace/api-client-react';
import { useColors } from '@/hooks/useColors';
import { F } from '@/components/ui';

type R = { durationSeconds: number | null; steps: TransitStep[] };
const validMs = (iso?: string) => { if (!iso) return null; const t = Date.parse(iso); return Number.isFinite(t) ? t : null; };
export const clockOf = (ms: number | null) => ms == null ? '' : new Date(ms).toLocaleTimeString('pl-PL', { hour: '2-digit', minute: '2-digit' });
export const minText = (v: number | null | undefined) => v == null || !Number.isFinite(v) || v < 0 ? null : `${Math.max(v > 0 ? 1 : 0, Math.round(v / 60))} min`;
export function VehicleIcon({ type, color }: { type?: string; color?: string }) {
  const t = (type || '').toUpperCase();
  const n = t.includes('BUS') ? 'bus' : t === 'TRAM' || t === 'LIGHT_RAIL' ? 'tram' : 'train';
  return <MaterialCommunityIcons name={n} size={16} color={color ?? '#f2f2f0'} />;
}
function countdown(dep: string | undefined, now: number) {
  const t = validMs(dep); if (t == null) return { kind: 'missing' as const };
  const d = t - now;
  if (d < 0) return { kind: 'gone' as const, clock: clockOf(t) };
  if (d >= 3600000) return { kind: 'at' as const, clock: clockOf(t) };
  return { kind: 'in' as const, minutes: Math.max(0, Math.ceil(d / 60000)) };
}
type P = { route: R; index: number; active: boolean; expanded: boolean; now: number; onSelect: () => void; onToggle: () => void; fareLine: string; children?: ReactNode };
export function RouteCard({ route, index, active, expanded, now, onSelect, onToggle, fareLine, children }: P) {
  const c = useColors();
  const transit = route.steps.filter(x => x.mode === 'TRANSIT');
  const walkingOnly = transit.length === 0 && route.steps.length > 0 && route.steps.every(x => x.mode === 'WALK');
  const first = transit[0], last = transit[transit.length - 1];
  const fi = first ? route.steps.indexOf(first) : -1;
  const pre = route.steps.slice(0, Math.max(fi, 0)).filter(x => x.mode === 'WALK');
  const access = first && pre.length && pre.every(x => x.durationSeconds != null) ? pre.reduce((a, x) => a + (x.durationSeconds as number), 0) : null;
  const cd = countdown(first?.departureTime, now);
  const dep = clockOf(validMs(first?.departureTime)), arr = clockOf(validMs(last?.arrivalTime));
  const total = minText(route.durationSeconds);
  const d0 = validMs(first?.departureTime), a0 = validMs(last?.arrivalTime);
  const ride = d0 != null && a0 != null && a0 >= d0 ? minText((a0 - d0) / 1000) : null;
  let label = 'Planowy odjazd:', big: string | null = 'brak godziny', small = true, dim = true, unit = false;
  if (walkingOnly) { label = 'Trasa piesza'; big = total ?? 'brak czasu'; dim = false; }
  else if (cd.kind === 'in') { label = 'Odjazd za:'; big = String(cd.minutes).padStart(2, '0'); small = false; dim = false; unit = true; }
  else if (cd.kind === 'at') { label = 'Odjazd o:'; big = cd.clock; dim = false; }
  else if (cd.kind === 'gone') { label = 'Planowy odjazd minął'; big = cd.clock; }
  return <View testID={`real-route-${index}`} style={[s.card, { backgroundColor: c.grCard, borderColor: active ? c.activeGreen : 'transparent' }]}>
    <Pressable testID={`button-real-route-${index}`} onPress={onSelect} accessibilityState={{ selected: active }} style={s.main}>
      <View style={s.row}>
        <View style={s.left}>
          <Text style={{ color: c.grSoft, fontFamily: F.r, fontSize: 12 }}>{label}</Text>
          <Text style={{ color: dim ? c.grDim : c.grText, fontFamily: F.b, fontSize: dim ? 17 : small ? 20 : 32, marginTop: small ? 4 : 0, letterSpacing: -1 }}>
            {big}{unit && <Text style={{ fontSize: 13, letterSpacing: 0, fontFamily: F.s }}> min</Text>}</Text>
        </View>
        <View style={s.mid}>
          <View style={[s.wrap, { paddingRight: 52 }]}>
            {transit.length === 0 && <Text style={[s.note, { color: c.grDim }]}>{walkingOnly ? 'Tylko pieszo' : 'Brak danych o transporcie'}</Text>}
            {transit.map((x, k) => <View key={k} style={s.line}><VehicleIcon type={x.vehicleType} />
              <Text numberOfLines={1} style={[s.badge, { color: c.grText, borderColor: '#8c8c88' }]}>{x.lineShortName || x.lineName || '?'}</Text></View>)}
          </View>
          {transit.length > 0 && <View style={s.wrap}>
            <Feather name="user" size={13} color={c.grSoft} /><Text style={[s.tm, { color: c.grSoft }]}>{minText(access) ?? '–'}</Text>
            {dep ? <Text style={[s.chip, { backgroundColor: c.depGreen }]}>{dep}</Text> : <Text style={[s.note, { color: c.grDim }]}>brak godz.</Text>}
            <Text style={[s.tm, { color: c.grSoft }]}>{ride ?? 'brak czasu jazdy'}</Text>
            {arr ? <Text style={[s.chip, { backgroundColor: c.arrBlue }]}>{arr}</Text> : <Text style={[s.note, { color: c.grDim }]}>brak godz.</Text>}
          </View>}
        </View>
        <Text style={[s.total, { color: '#cfcfcb' }]}>{total ?? 'brak czasu'}</Text>
      </View>
      <Text testID={`text-route-fare-${index}`} style={[s.fare, { color: '#b9b9b4', borderColor: c.grLine }]}>{fareLine}</Text>
    </Pressable>
    <Pressable testID={`button-route-details-${index}`} onPress={onToggle} accessibilityState={{ expanded }} style={[s.toggle, { backgroundColor: c.grToggle }]}>
      <Text style={{ color: c.grSoft, fontFamily: F.r, fontSize: 12 }}>{expanded ? 'Ukryj szczegóły' : 'Pokaż szczegóły'}</Text>
      <Feather name={expanded ? 'chevron-up' : 'chevron-down'} size={14} color={c.grSoft} />
    </Pressable>
    {expanded && <View style={[s.details, { backgroundColor: c.grToggle }]}>{children}</View>}
  </View>;
}
const s = StyleSheet.create({
  card: { borderRadius: 14, borderWidth: 2, overflow: 'hidden' },
  main: { paddingHorizontal: 10, paddingTop: 10, paddingBottom: 6, gap: 6 },
  row: { flexDirection: 'row', gap: 10 }, left: { width: 82 }, mid: { flex: 1, minWidth: 0, gap: 6, justifyContent: 'center' },
  wrap: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: 5 }, line: { flexDirection: 'row', alignItems: 'center', gap: 5 },
  badge: { borderWidth: 1, borderRadius: 6, paddingHorizontal: 6, paddingVertical: 1, fontSize: 14, fontFamily: F.s, maxWidth: 90 },
  note: { fontSize: 11, fontFamily: F.r }, tm: { fontSize: 11, fontFamily: F.r },
  chip: { borderRadius: 10, paddingHorizontal: 6, paddingVertical: 1, fontFamily: F.b, fontSize: 12, color: '#fff', overflow: 'hidden' },
  total: { position: 'absolute', top: 4, right: 0, fontSize: 12, maxWidth: 70, textAlign: 'right', fontFamily: F.r },
  fare: { fontSize: 11, fontFamily: F.r, borderTopWidth: 1, paddingTop: 6 },
  toggle: { minHeight: 44, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 4 },
  details: { paddingHorizontal: 14, paddingBottom: 12, paddingTop: 4, gap: 8 },
});
