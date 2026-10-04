import React, { useEffect, useState } from 'react';
import { ActivityIndicator, ScrollView, View } from 'react-native';
import { useNavigation } from 'expo-router';
import { reconcileTracking } from '@/services/native-tracking';
import { useRide } from '@/context/ride-context';
import { useColors } from '@/hooks/useColors';
import { Header } from '@/components/PassengerChrome';
import { Banner, Btn, Surface, H2 } from '@/components/ui';
import GoView from '@/components/GoView';
import TicketView from '@/components/TicketView';
import ProfileView from '@/components/ProfileView';

export { Action } from '@/components/ui';

export default function PassengerScreen({ section }: { section: 'go' | 'ticket' | 'profile' }) {
  const c = useColors();
  const nav = useNavigation();
  const { state, error, busy, run, refresh } = useRide();
  const [focused, setFocused] = useState(() => nav.isFocused());
  useEffect(() => {
    const a = nav.addListener('focus', () => setFocused(true)), b = nav.addListener('blur', () => setFocused(false));
    return () => { a(); b(); };
  }, [nav]);
  const account = state?.account;
  const name = account ? [account.profile.firstName, account.profile.lastName].filter(Boolean).join(' ') : '';
  const problem = error || state?.issue;
  const banner = problem ? <View style={{ gap: 8 }}><Banner kind="alert">{problem}</Banner><Btn testID="retry-state" variant="secondary" title="Sprawdź ponownie" disabled={busy} onPress={() => void run(reconcileTracking)} /></View> : null;
  const loading = !state ? <Surface style={{ alignItems: 'center', gap: 12 }}><H2>Loading wallet…</H2><ActivityIndicator color={c.primary} /><Btn testID="reload-state" title="Ponów odczyt" onPress={() => void refresh()} /></Surface> : null;
  return <View style={{ flex: 1, backgroundColor: c.background }}>
    <Header name={name} photo={account?.profile.photo ?? null} />
    {section === 'go' ? <View style={{ flex: 1 }}>{banner ? <View style={{ padding: 10 }}>{banner}</View> : null}{loading ? <View style={{ padding: 10 }}>{loading}</View> : <GoView focused={focused} />}</View> :
      <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={{ padding: 12, gap: 14, paddingBottom: 24 }}>
        {banner}{loading}
        {account && (section === 'ticket' ? <TicketView /> : <ProfileView />)}
      </ScrollView>}
  </View>;
}
