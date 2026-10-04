import React from 'react';
import { Image, Platform, Pressable, StyleSheet, Text, View } from 'react-native';
import { Feather, MaterialCommunityIcons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import type { ComponentProps } from 'react';
import type { Tabs } from 'expo-router';
import { useColors } from '@/hooks/useColors';
import { F } from '@/components/ui';

type TabBar = NonNullable<ComponentProps<typeof Tabs>['tabBar']>;
type BottomTabBarProps = Parameters<TabBar>[0];
export function Header({ name, photo }: { name: string; photo?: string | null }) {
  const c = useColors(), insets = useSafeAreaInsets();
  const top = Platform.OS === 'web' ? 0 : insets.top;
  const initials = name.split(' ').filter(Boolean).slice(0, 2).map(p => p[0]!.toUpperCase()).join('') || 'FR';
  return <View testID="passenger-header" style={[s.top, { height: 56 + top, paddingTop: top, backgroundColor: '#fbfaf6', borderColor: c.border }]}>
    <View style={s.brand} accessibilityLabel="FairRide home" testID="link-brand">
      <View style={[s.mark, { backgroundColor: '#1e6854' }]}><Feather name="navigation" size={19} color="#f8f3e8" /></View>
      <Text style={{ color: '#174f40', fontFamily: F.h, fontSize: 18, letterSpacing: -.6 }}>FairRide</Text>
    </View>
    <View style={s.who}>
      <View style={s.avatar}>{photo ? <Image source={{ uri: photo }} style={{ width: 34, height: 34 }} /> : <Text style={{ color: '#1c5947', fontFamily: F.b, fontSize: 12 }}>{initials}</Text>}</View>
      <Text testID="header-passenger-name" numberOfLines={1} style={{ color: '#40574d', fontFamily: F.s, fontSize: 12, maxWidth: 150 }}>{name}</Text>
    </View>
  </View>;
}
const labels: Record<string, string> = { ticket: 'Bilet', go: 'Go', profile: 'Profile' };
export function Footer({ state, navigation }: BottomTabBarProps) {
  const c = useColors(), insets = useSafeAreaInsets();
  const bottom = Platform.OS === 'web' ? 0 : insets.bottom;
  return <View testID="passenger-footer" style={[s.foot, { paddingBottom: 6 + bottom, backgroundColor: '#fbfaf6', borderColor: c.border }]}>
    {state.routes.map((r, i) => {
      const on = state.index === i, col = on ? '#1d634f' : '#65736b', label = labels[r.name] ?? r.name;
      return <Pressable key={r.key} testID={`link-nav-${label.toLowerCase()}`} accessibilityRole="button" accessibilityState={{ selected: on }}
        onPress={() => navigation.navigate(r.name)} style={[s.tab, on && { backgroundColor: '#e8efe8' }]}>
        {r.name === 'ticket' ? <MaterialCommunityIcons name="ticket-outline" size={22} color={col} /> : <Feather name={r.name === 'go' ? 'map-pin' : 'user'} size={22} color={col} />}
        <Text style={{ color: col, fontFamily: F.s, fontSize: 12 }}>{label}</Text>
      </Pressable>;
    })}
  </View>;
}
const s = StyleSheet.create({
  top: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 12, borderBottomWidth: 1, zIndex: 20 },
  brand: { flexDirection: 'row', alignItems: 'center', gap: 7 },
  mark: { width: 31, height: 31, borderRadius: 10, alignItems: 'center', justifyContent: 'center' },
  who: { flexDirection: 'row', alignItems: 'center', gap: 7, flexShrink: 1 },
  avatar: { overflow: 'hidden', width: 34, height: 34, borderRadius: 17, backgroundColor: '#e6b65e', alignItems: 'center', justifyContent: 'center' },
  foot: { flexDirection: 'row', gap: 8, paddingTop: 6, paddingHorizontal: 10, borderTopWidth: 1 },
  tab: { flex: 1, minHeight: 52, borderRadius: 10, alignItems: 'center', justifyContent: 'center', gap: 4, padding: 5 },
});
