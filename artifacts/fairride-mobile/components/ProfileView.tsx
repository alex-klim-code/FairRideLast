import React, { useState } from 'react';
import { Image, Linking, Platform, Pressable, TextInput, View } from 'react-native';
import * as ImagePicker from 'expo-image-picker';
import { Feather } from '@expo/vector-icons';
import { discountOptions, discountNotice, moneyText, START_FEE, priceRows, type DiscountId, type PassengerProfile, type RefillMethod } from '@workspace/fairride-core';
import { updateState } from '@/services/ride-store';
import { topUp, setProfile } from '@/services/ride-state';
import { useRide } from '@/context/ride-context';
import { useColors } from '@/hooks/useColors';
import { Banner, Btn, Eyebrow, F, H2, Surface, Txt } from '@/components/ui';
import { Text } from 'react-native';

const presets = ['10', '20', '50', '100'];
const opid = () => `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
type View_ = 'menu' | 'bills' | 'prices' | 'privacy' | 'terms';
const MAX_CHARS = 400000;
const methods: { id: RefillMethod; label: string }[] = [{ id: 'blik', label: 'BLIK' }, { id: 'google_pay', label: 'Google Pay' }, { id: 'apple_pay', label: 'Apple Pay' }];
const methodName = (m?: string) => methods.find(x => x.id === m)?.label ?? 'BLIK';
const ALLOWED = ['image/jpeg', 'image/png', 'image/webp'];

function Back({ onPress }: { onPress: () => void }) {
  return <Btn variant="secondary" testID="profile-back" title="Back to Profile" onPress={onPress} style={{ alignSelf: 'flex-start' }} icon={<Feather name="chevron-left" size={15} color="#245d4c" />} />;
}
function Opt({ on, label, onPress, testID, sub, disabled }: { on: boolean; label: string; onPress: () => void; testID?: string; sub?: string; disabled?: boolean }) {
  return <Pressable testID={testID} disabled={disabled} accessibilityRole="radio" accessibilityState={{ checked: on, disabled }} onPress={onPress}
    style={{ borderWidth: 1, borderRadius: 11, paddingVertical: 10, paddingHorizontal: 14, borderColor: on ? '#1d6853' : '#dedfd5', backgroundColor: on ? '#1d6853' : '#fffefa', opacity: disabled ? .5 : 1 }}>
    <Text style={{ fontFamily: F.b, fontSize: 13, color: on ? '#fbf8ef' : '#315444' }}>{label}</Text>
    {sub ? <Text style={{ fontFamily: F.r, fontSize: 11, color: on ? '#fbf8ef' : '#315444' }}>{sub}</Text> : null}
  </Pressable>;
}
export default function ProfileView() {
  const c = useColors();
  const { state, busy, run } = useRide();
  const [view, setView] = useState<View_>('menu');
  const [amount, setAmount] = useState('20');
  const [method, setMethod] = useState<RefillMethod>('blik');
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [pmsg, setPmsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [draft, setDraft] = useState<PassengerProfile | null>(null);
  const account = state?.account;
  if (!account) return null;
  const saved = account.profile;
  const p: PassengerProfile = draft ?? saved;
  const edit = (k: keyof PassengerProfile, v: string | null) => setDraft({ ...p, [k]: v } as PassengerProfile);
  const pickPhoto = async () => {
    setPmsg(null);
    try {
      if (Platform.OS !== 'web') {
        const perm = await ImagePicker.requestMediaLibraryPermissionsAsync();
        if (!perm.granted) { setPmsg({ ok: false, text: 'Brak zgody na dostęp do zdjęć. Możesz ją nadać w ustawieniach telefonu.' }); return; }
      }
      const r = await ImagePicker.launchImageLibraryAsync({ mediaTypes: ['images'], allowsEditing: true, aspect: [1, 1], quality: .4, base64: true });
      if (r.canceled) return;
      const a = r.assets[0];
      if (!a) return;
      const mime = a.mimeType ?? (a.uri.startsWith('data:') ? a.uri.slice(5, a.uri.indexOf(';')) : '');
      if (mime && !ALLOWED.includes(mime)) throw new Error('Use a JPG, PNG or WebP image.');
      if (!a.base64) throw new Error('This image cannot be processed.');
      const url = `data:${mime || 'image/jpeg'};base64,${a.base64}`;
      if (url.length > MAX_CHARS) throw new Error('Image is still too large after resizing.');
      setDraft({ ...p, photo: url });
    } catch (e) { setPmsg({ ok: false, text: e instanceof Error ? e.message : 'Upload failed.' }); }
  };
  const saveProfile = () => void run(async () => {
    setPmsg(null);
    try {
      const next = await updateState(st => setProfile(st, p));
      setDraft(null); setPmsg({ ok: true, text: 'Profile saved on this device.' });
      return next;
    } catch (e) { setPmsg({ ok: false, text: e instanceof Error ? e.message : 'Save failed.' }); throw e; }
  });
  const field = (label: string, v: string, id: string) => <View key={id} style={{ gap: 7 }}>
    <Text style={{ fontFamily: F.b, fontSize: 12, color: '#45584f' }}>{label}</Text>
    <TextInput testID={`input-profile-${id}`} value={v} onChangeText={t => edit(id as keyof PassengerProfile, t)} autoCorrect={false} style={{ borderWidth: 1, borderColor: '#dedfd5', borderRadius: 11, backgroundColor: '#fffefa', paddingVertical: 8, paddingHorizontal: 10, minHeight: 44, fontSize: 16, color: '#203e32', fontFamily: F.r }} /></View>;

  if (view === 'bills') {
    const refill = () => void run(async () => {
      setMsg(null);
      if (!/^\d{1,4}([.,]\d{1,2})?$/.test(amount.trim())) throw new Error('Podaj kwotę od 1 do 2000 zł, do dwóch miejsc po przecinku.');
      const cents = Math.round(Number(amount.replace(',', '.')) * 100);
      const next = await updateState(s => topUp(s, cents, opid(), method));
      setMsg({ ok: true, text: `Doładowanie ${moneyText(cents)} (${methodName(method)}, symulacja) dodane do symulowanego portfela.` });
      return next;
    });
    return <View style={{ gap: 12 }}>
      <Back onPress={() => setView('menu')} />
      <View testID="card-wallet" style={{ backgroundColor: c.walletA, borderRadius: 16, padding: 16, minHeight: 150, justifyContent: 'space-between' }}>
        <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}><View style={{ width: 28, height: 28, borderRadius: 10, backgroundColor: c.amber, alignItems: 'center', justifyContent: 'center' }}><Feather name="navigation" size={15} color={c.walletA} /></View>
            <Text style={{ color: '#f7f2e8', fontFamily: F.h, fontSize: 17 }}>FairRide</Text></View>
          <View style={{ width: 38, height: 28, borderRadius: 7, backgroundColor: c.amber }} /></View>
        <View><Eyebrow style={{ color: '#a9cdb8' }}>Balance</Eyebrow><Text testID="text-balance" style={{ color: '#f7f2e8', fontFamily: F.h, fontSize: 34, letterSpacing: -1.5 }}>{moneyText(account.balanceCents)}</Text></View>
        <Text style={{ color: '#b9d0c2', fontFamily: F.r, fontSize: 11 }}>{saved.firstName} {saved.lastName} · symulowany portfel lokalny</Text>
      </View>
      <Surface style={{ gap: 12 }}>
        <H2>Top up</H2>
        <Eyebrow>Amount (PLN)</Eyebrow>
        <View style={{ flexDirection: 'row', gap: 8, flexWrap: 'wrap' }}>{presets.map(v => <Opt key={v} on={amount === v} label={`${v} zł`} onPress={() => setAmount(v)} />)}</View>
        <Text style={{ fontFamily: F.b, fontSize: 12, color: '#45584f' }}>Custom amount</Text>
        <TextInput testID="topup-amount" value={amount} onChangeText={setAmount} keyboardType="decimal-pad" accessibilityLabel="Kwota doładowania w złotych"
          style={{ borderWidth: 1, borderColor: '#dedfd5', borderRadius: 11, backgroundColor: '#fffefa', padding: 12, fontSize: 16, color: '#203e32', fontFamily: F.r }} />
        <Eyebrow>Method</Eyebrow>
        <View style={{ flexDirection: 'row', gap: 8, flexWrap: 'wrap' }} accessibilityRole="radiogroup">
          {methods.map(m => <Opt key={m.id} testID={`method-${m.id}`} on={method === m.id} label={m.label} onPress={() => setMethod(m.id)} />)}</View>
        <Txt style={{ fontSize: 11, color: c.mutedForeground }}>Symulowane doładowanie lokalnego portfela. Nie są pobierane prawdziwe pieniądze ani otwierane płatności systemowe.</Txt>
        {msg && <View style={{ flexDirection: 'row' }}><View style={{ flex: 1 }}><Banner kind={msg.ok ? 'ok' : 'alert'}>{msg.text}</Banner></View></View>}
        <Btn testID="topup" title="Refill My Wallet" disabled={busy} onPress={refill} />
      </Surface>
      <Surface><H2>Ledger</H2>
        {account.transactions.length === 0 ? <Txt style={{ color: c.mutedForeground }}>No transactions yet. Refills, ride charges and legacy ticket purchases appear here.</Txt> :
          account.transactions.map(tx => <View key={tx.id} style={{ flexDirection: 'row', justifyContent: 'space-between', gap: 10, paddingVertical: 12, borderBottomWidth: 1, borderColor: '#efede5' }}>
            <View style={{ flex: 1 }}><Txt>{tx.kind === 'refill' ? `Refill · ${methodName(tx.method)} (symulacja)` : tx.ticketId ? `Legacy ticket ${tx.ticketId}` : 'Ride charge'}</Txt>
              <Txt style={{ fontSize: 11, color: c.mutedForeground }}>{new Date(tx.createdAt).toLocaleString('en-GB')}</Txt></View>
            <Text style={{ fontFamily: F.b, fontSize: 13, color: tx.kind === 'refill' ? c.pos : c.neg }}>{tx.kind === 'refill' ? '+' : '−'}{moneyText(tx.amountCents)}</Text></View>)}
      </Surface>
    </View>;
  }
  if (view === 'prices') return <View style={{ gap: 12 }}><Back onPress={() => setView('menu')} />
    <Surface><H2>Prices</H2>
      <Txt style={{ color: c.mutedForeground, marginBottom: 8 }}>Opłata = opłata startowa {START_FEE.toFixed(2)} zł + zmierzone kilometry GPS × stawka, po uldze z profilu ({saved.discountId}).</Txt>
      {priceRows.map(r => <View key={r.name} style={{ flexDirection: 'row', justifyContent: 'space-between', paddingVertical: 14, borderBottomWidth: 1, borderColor: '#efede5' }}>
        <Txt style={{ fontFamily: F.s }}>{r.name}</Txt><Txt style={{ fontFamily: F.b }}>{r.rate.toFixed(2)} zł / km</Txt></View>)}
      <Txt style={{ fontSize: 11, color: c.mutedForeground, marginTop: 8 }}>Stawki dotyczą symulowanego portfela tej wersji.</Txt></Surface></View>;
  if (view === 'privacy') return <View style={{ gap: 12 }}><Back onPress={() => setView('menu')} />
    <Surface style={{ gap: 10 }}><H2>Lokalizacja i prywatność</H2>
      <Txt>GPS zbieramy tylko w aktywnym przejeździe. Próbki są zapisane na tym telefonie i usuwane przy check-out. Potwierdzenia nie zawierają surowych współrzędnych.</Txt>
      <Txt style={{ color: c.mutedForeground }}>Po wymuszonym zakończeniu aplikacji otwórz ją i wznów GPS. Android i iOS mogą zatrzymać pomiar. Bez sygnału, zgody lub działającego procesu nie naliczamy brakującego dystansu.</Txt>
      <Txt style={{ color: c.mutedForeground }}>Nie odinstalowuj aplikacji ani nie usuwaj jej danych podczas przejazdu — lokalny zapis zostanie utracony.</Txt>
      {Platform.OS !== 'web' && <Btn testID="open-settings" title="Ustawienia lokalizacji telefonu" onPress={() => void Linking.openSettings()} />}</Surface></View>;

  if (view === 'terms') return <View style={{ gap: 12 }}><Back onPress={() => setView('menu')} />
    <Surface style={{ gap: 10 }}><Eyebrow>FairRide · informacje</Eyebrow><H2>Warunki korzystania</H2>
      <Txt>Planowanie tras w FairRide korzysta z danych Google. Szacowany koszt przejazdu obliczamy według taryfy FairRide.</Txt>
      <Txt>Rzeczywiste wskazówki transportu publicznego pochodzą z Google Maps. Dostępność, rozkłady, czasy i ceny zależą od danych dostawcy oraz przewoźników i mogą się zmieniać. Sprawdź aktualny rozkład i wymagany bilet u przewoźnika przed podróżą.</Txt>
      <Txt>Korzystanie z usług Google w FairRide podlega również warunkom Google. Niniejsze informacje nie zastępują regulaminu operatora transportu.</Txt>
      <Txt>Portfel i doładowania w tej wersji są lokalną symulacją na tym telefonie; potwierdzenia nie są biletami przewoźnika.</Txt>
      <Pressable onPress={() => void Linking.openURL('https://maps.google.com/help/terms_maps/')} style={{ minHeight: 44, justifyContent: 'center' }}><Text style={{ color: c.primary, fontFamily: F.s, fontSize: 13 }}>Warunki Google Maps</Text></Pressable>
      <Pressable onPress={() => void Linking.openURL('https://policies.google.com/privacy')} style={{ minHeight: 44, justifyContent: 'center' }}><Text style={{ color: c.primary, fontFamily: F.s, fontSize: 13 }}>Polityka prywatności Google</Text></Pressable></Surface></View>;

  return <View style={{ gap: 12 }}>
    <Surface style={{ flexDirection: 'row', gap: 8, padding: 10 }}>
      <Btn testID="link-nav-bills" variant="secondary" title="Bills" style={{ flex: 1, minHeight: 52 }} icon={<Feather name="credit-card" size={20} color="#245d4c" />} onPress={() => setView('bills')} />
      <Btn testID="link-nav-prices" variant="secondary" title="Prices" style={{ flex: 1, minHeight: 52 }} icon={<Feather name="file-text" size={20} color="#245d4c" />} onPress={() => setView('prices')} />
    </Surface>
    <Surface style={{ gap: 14 }}>
      <View style={{ flexDirection: 'row', gap: 12, alignItems: 'center', flexWrap: 'wrap' }}>
        <View style={{ width: 56, height: 56, borderRadius: 28, backgroundColor: c.amber, overflow: 'hidden', alignItems: 'center', justifyContent: 'center' }}>
          {p.photo ? <Image source={{ uri: p.photo }} style={{ width: 56, height: 56 }} accessibilityLabel="Zdjęcie profilu" /> :
            <Text style={{ color: c.walletA, fontFamily: F.b, fontSize: 20 }}>{[p.firstName, p.lastName].filter(Boolean).map(x => x[0]!.toUpperCase()).join('').slice(0, 2) || 'FR'}</Text>}</View>
        <Btn testID="input-profile-photo" variant="secondary" title="Upload photo" onPress={() => void pickPhoto()} />
        {p.photo ? <Btn testID="remove-profile-photo" variant="quiet" title="Remove photo" onPress={() => edit('photo', null)} /> : null}
      </View>
      <Txt style={{ fontSize: 11, color: c.mutedForeground }}>Stored only on this phone, separate from the web version. Photos are cropped and compressed on your device and never uploaded.</Txt>
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 10 }}>{[['First name', p.firstName, 'firstName'], ['Last name', p.lastName, 'lastName'], ['Email', p.email, 'email'], ['Phone', p.phone, 'phone']].map(([l, v, id]) => <View key={id} style={{ width: '48%', flexGrow: 1 }}>{field(l!, v!, id!)}</View>)}</View>
      <H2>Eligibility category</H2>
      <Banner kind="notice">{discountNotice}</Banner>
      <Txt style={{ fontSize: 11, color: c.mutedForeground }}>Zmiana dotyczy kolejnego check-in, nie aktywnego przejazdu; zapisz profil, aby ją zastosować.</Txt>
      <View style={{ gap: 8 }} accessibilityRole="radiogroup">{discountOptions.map(d => <Opt key={d.id} testID={`discount-${d.id}`} on={p.discountId === d.id} disabled={busy}
        label={`${d.label} · ${d.percent}% off`} sub={d.eligibility} onPress={() => edit('discountId', d.id as DiscountId)} />)}</View>
      {pmsg && <Banner kind={pmsg.ok ? 'ok' : 'alert'}>{pmsg.text}</Banner>}
      <Btn testID="button-save-profile" title="Save profile" disabled={busy || !draft} onPress={saveProfile} />
    </Surface>
    <Surface style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', padding: 10 }}>
      <Pressable testID="link-privacy" onPress={() => setView('privacy')} style={{ minHeight: 44, justifyContent: 'center' }}><Text style={{ color: c.primary, fontFamily: F.s, fontSize: 13 }}>Privacy</Text></Pressable>
      <Pressable testID="link-terms" onPress={() => setView('terms')} style={{ minHeight: 44, justifyContent: 'center' }}><Text style={{ color: c.primary, fontFamily: F.s, fontSize: 13 }}>Terms</Text></Pressable>
    </Surface>
  </View>;
}
