import React, { type ReactNode } from 'react';
import { Pressable, StyleSheet, Text, View, type StyleProp, type ViewStyle } from 'react-native';
import { useColors } from '@/hooks/useColors';

export const F = { r: 'DMSans_400Regular', m: 'DMSans_500Medium', s: 'DMSans_600SemiBold', b: 'DMSans_700Bold', h: 'Manrope_700Bold' } as const;
type Variant = 'primary' | 'secondary' | 'quiet' | 'yellow';
export function Btn({ title, onPress, disabled = false, testID, variant = 'primary', icon, style, small }:
  { title: string; onPress: () => void; disabled?: boolean; testID: string; variant?: Variant; icon?: ReactNode; style?: StyleProp<ViewStyle>; small?: boolean }) {
  const c = useColors();
  const bg = variant === 'primary' ? c.primary : variant === 'secondary' ? c.btnSecondary : variant === 'yellow' ? c.yellow : 'transparent';
  const fg = variant === 'primary' ? c.primaryForeground : variant === 'secondary' ? c.btnSecondaryFg : variant === 'yellow' ? '#222' : '#40534b';
  return <Pressable testID={testID} accessibilityRole="button" accessibilityLabel={title} disabled={disabled} onPress={onPress}
    style={({ pressed }) => [s.btn, small && { minHeight: 32, paddingVertical: 4, paddingHorizontal: 8 }, { backgroundColor: bg, opacity: disabled ? .45 : pressed ? .8 : 1 },
      variant === 'quiet' && { borderWidth: 1, borderColor: c.quietBorder }, style]}>
    {icon}<Text style={{ color: fg, fontFamily: F.b, fontSize: small ? 11 : 12 }}>{title}</Text>
  </Pressable>;
}
export const Action = ({ title, onPress, disabled = false, testID }: { title: string; onPress: () => void; disabled?: boolean; testID: string }) =>
  <Btn title={title} onPress={onPress} disabled={disabled} testID={testID} />;
export function Surface({ children, style, testID }: { children: ReactNode; style?: StyleProp<ViewStyle>; testID?: string }) {
  const c = useColors();
  return <View testID={testID} style={[{ backgroundColor: c.card, borderColor: c.border, borderWidth: 1, borderRadius: 19, padding: 12 }, style]}>{children}</View>;
}
export function Txt({ children, style, testID, numberOfLines }: { children: ReactNode; style?: StyleProp<import('react-native').TextStyle>; testID?: string; numberOfLines?: number }) {
  const c = useColors();
  return <Text testID={testID} numberOfLines={numberOfLines} style={[{ color: c.foreground, fontFamily: F.r, fontSize: 13, lineHeight: 19 }, style]}>{children}</Text>;
}
export const Eyebrow = ({ children, style }: { children: ReactNode; style?: StyleProp<import('react-native').TextStyle> }) => {
  const c = useColors();
  return <Text style={[{ color: c.eyebrow, fontFamily: F.b, fontSize: 11, letterSpacing: 1.4, textTransform: 'uppercase' }, style]}>{children}</Text>;
};
export const H2 = ({ children }: { children: ReactNode }) => <Txt style={{ fontFamily: F.h, fontSize: 18, letterSpacing: -.6, lineHeight: 24, marginBottom: 8 }}>{children}</Txt>;
export function Banner({ kind, children, testID }: { kind: 'ok' | 'alert' | 'notice'; children: ReactNode; testID?: string }) {
  const c = useColors();
  const bg = kind === 'ok' ? c.okBg : kind === 'alert' ? c.alertBg : c.noticeBg;
  const fg = kind === 'ok' ? c.okFg : kind === 'alert' ? c.alertFg : c.noticeFg;
  return <View testID={testID} accessibilityRole={kind === 'alert' ? 'alert' : undefined} style={{ backgroundColor: bg, borderRadius: 12, paddingVertical: 9, paddingHorizontal: 11 }}>
    <Text style={{ color: fg, fontFamily: F.r, fontSize: 12, lineHeight: 18 }}>{children}</Text></View>;
}
const s = StyleSheet.create({ btn: { borderRadius: 12, paddingVertical: 8, paddingHorizontal: 12, minHeight: 44, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 9 } });
