import { Platform, ScrollView, Text, View } from 'react-native';
import { useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Feather } from '@expo/vector-icons';
import { useColors } from '@/hooks/useColors';
import { Btn, Eyebrow, F, Surface, Txt } from '@/components/ui';

export default function Welcome() {
  const c = useColors(), router = useRouter(), insets = useSafeAreaInsets();
  const top = Platform.OS === 'web' ? 0 : insets.top, bottom = Platform.OS === 'web' ? 0 : insets.bottom;
  return <View style={{ flex: 1, backgroundColor: c.background }}>
    <View style={{ height: 64 + top, paddingTop: top, paddingHorizontal: 16, flexDirection: 'row', alignItems: 'center', gap: 11, backgroundColor: '#fbfaf6', borderBottomWidth: 1, borderColor: c.border }}>
      <View style={{ width: 35, height: 35, borderRadius: 12, backgroundColor: '#1e6854', alignItems: 'center', justifyContent: 'center' }}><Feather name="navigation" size={19} color="#f8f3e8" /></View>
      <Text style={{ color: '#174f40', fontFamily: F.h, fontSize: 20, letterSpacing: -.6 }}>FairRide</Text>
    </View>
    <ScrollView contentContainerStyle={{ padding: 16, gap: 14, paddingBottom: bottom + 24 }}>
      <Eyebrow>Kraków · wersja pasażerska</Eyebrow>
      <Text style={{ color: c.foreground, fontFamily: F.h, fontSize: 28, letterSpacing: -1 }}>Wybierz widok</Text>
      <Surface style={{ gap: 6 }}>
        <Text style={{ color: c.foreground, fontFamily: F.b, fontSize: 15 }}>Pasażer</Text>
        <Txt style={{ color: c.mutedForeground }}>Wybierz cel, porównaj trasy i płać tylko za zmierzony dystans GPS.</Txt>
        <Btn testID="open-passenger" title="Otwórz widok pasażera" onPress={() => router.replace('/go')} style={{ marginTop: 8 }} />
      </Surface>
      <Surface style={{ gap: 8, backgroundColor: c.noticeBg, borderColor: c.noticeBg }}>
        <Txt style={{ color: c.noticeFg, fontFamily: F.b }}>Lokalna symulacja</Txt>
        <Txt style={{ color: c.noticeFg, fontSize: 12 }}>Portfel i doładowania nie używają prawdziwych pieniędzy. Potwierdzenia nie są biletami przewoźnika. Saldo i historia tego telefonu są osobne od weba; nie synchronizujemy konta Clerk ani portfela.</Txt>
        <Txt style={{ color: c.noticeFg, fontSize: 12 }}>GPS w tle wymaga natywnej kompilacji i zgody. Expo Go oraz podgląd w przeglądarce służą do sprawdzania interfejsu i planowania trasy.</Txt>
      </Surface>
    </ScrollView>
  </View>;
}
