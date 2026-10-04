import { DEFAULT_RATE, START_FEE, fare, rates } from './pricing';
import type { TransitRoute } from '@workspace/api-client-react';

export const discountOptions = [
  { id: 'normal', label: 'Normalny', percent: 0, eligibility: 'Bez ulgi.' },
  { id: 'student', label: 'Student', percent: 50, eligibility: 'Ważna legitymacja studencka.' },
  { id: 'pupil', label: 'Uczeń', percent: 50, eligibility: 'Ważna legitymacja szkolna.' },
  { id: 'pensioner', label: 'Emeryt / rencista', percent: 50, eligibility: 'Dokument potwierdzający uprawnienie.' },
  { id: 'senior', label: 'Senior 70+', percent: 100, eligibility: 'Ukończone 70 lat.' },
  { id: 'child', label: 'Dziecko do 7 lat', percent: 100, eligibility: 'Dziecko przed siódmymi urodzinami.' },
  { id: 'disabled', label: 'Osoba z niepełnosprawnością', percent: 50, eligibility: 'Dokument potwierdzający uprawnienie.' },
] as const;
export type DiscountId = typeof discountOptions[number]['id'];
export type FareTransport = 'BUS' | 'TRAM' | 'TRAIN' | 'METRO' | 'OTHER';
export const transportLabels: Record<FareTransport, string> = {
  BUS: 'Autobus', TRAM: 'Tramwaj', TRAIN: 'Pociąg', METRO: 'Metro', OTHER: 'Inny transport',
};
export const discountNotice = 'Ulgi FairRide dla własnej taryfy kilometrowej — kategorie spotykane w polskiej komunikacji. Nie są to ustawowe ulgi wszystkich przewoźników ani taryfa KMK. W tej wersji deklarujemy uprawnienie, bez weryfikacji dokumentów.';
export const isDiscountId = (value: unknown): value is DiscountId =>
  discountOptions.some(option => option.id === value);
export const discountFor = (id: DiscountId) => {
  const discount = discountOptions.find(option => option.id === id);
  if (!discount) throw new Error('Wybierz poprawną ulgę.');
  return discount;
};
export const discountedCents = (amountCents: number, id: DiscountId) => {
  if (!Number.isSafeInteger(amountCents) || amountCents < 0) throw new Error('Niepoprawna cena.');
  return Math.round(amountCents * (100 - discountFor(id).percent) / 100);
};
export const priceForDistance = (distanceKm: number, rate: number, id: DiscountId) =>
  discountedCents(Math.round(fare(distanceKm, rate) * 100), id);

export function fareTransport(vehicle?: string): FareTransport {
  const type = (vehicle || '').toUpperCase();
  if (type.includes('BUS') || type === 'TROLLEYBUS') return 'BUS';
  if (type === 'TRAM' || type === 'LIGHT_RAIL') return 'TRAM';
  if (type === 'SUBWAY' || type === 'METRO_RAIL') return 'METRO';
  if (/TRAIN|RAIL|MONORAIL|FUNICULAR/.test(type)) return 'TRAIN';
  return 'OTHER';
}
export interface FareLeg {
  transport: FareTransport; distanceKm: number; baseCents: number; amountCents: number;
}
export interface FareQuote {
  legs: FareLeg[]; walkingKm: number; totalKm: number; baseCents: number;
  totalCents: number; discountId: DiscountId; discountPercent: number; startFeesCents: number;
}
export function quoteRoute(route: TransitRoute, discountId: DiscountId): FareQuote {
  const discount = discountFor(discountId);
  if (!route.steps.length || route.steps.some(step => step.mode === 'OTHER')) {
    throw new Error('Brakuje danych o odcinkach transportu. Nie można bezpiecznie oszacować biletu.');
  }
  const validDistance = (metres: number | null) => {
    if (metres == null || !Number.isFinite(metres) || metres < 0) throw new Error('Brakuje poprawnego dystansu trasy.');
    return metres / 1000;
  };
  const legs = route.steps.filter(step => step.mode === 'TRANSIT').map(step => {
    const transport = fareTransport(step.vehicleType);
    const distanceKm = validDistance(step.distanceMeters);
    const rate = transport === 'OTHER' ? DEFAULT_RATE : rates[transport];
    const baseCents = Math.round(fare(distanceKm, rate) * 100);
    return { transport, distanceKm, baseCents, amountCents: discountedCents(baseCents, discountId) };
  });
  return {
    legs, walkingKm: route.steps.filter(step => step.mode === 'WALK').reduce((sum, step) => sum + validDistance(step.distanceMeters), 0),
    totalKm: validDistance(route.distanceMeters), baseCents: legs.reduce((sum, leg) => sum + leg.baseCents, 0),
    totalCents: legs.reduce((sum, leg) => sum + leg.amountCents, 0),
    discountId, discountPercent: discount.percent, startFeesCents: Math.round(START_FEE * 100) * legs.length,
  };
}