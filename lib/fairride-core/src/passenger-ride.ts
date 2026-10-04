import type { PassengerAccount } from './passenger-account';
import { discountFor, isDiscountId, type DiscountId, type FareTransport } from './fare-policy';
import { DEFAULT_RATE, START_FEE, rates } from './pricing';

export interface GpsFix { lat: number; lng: number; accuracy: number; timestamp: number }
export interface RideSelection {
  transport: FareTransport; lineName: string; originName: string; destinationName: string;
  transportName?: string; lineNumber?: string; scheduledDepartureTime?: string;
}
export interface PassengerRide extends RideSelection {
  id: string; status: 'active' | 'completed'; startedAt: string; endedAt?: string;
  distanceMeters: number; discountId: DiscountId; discountPercent: number;
  rateCentsPerKm: number; startFeeCents: number; baseCents: number; amountCents: number;
  settled: boolean; trackingWarning: string; lastFix: GpsFix | null; anchorFix: GpsFix | null;
  samples: number; gapCount: number;
}
export const getActiveRide = (account: PassengerAccount) => account.rides?.find(r => r.status === 'active') ?? null;
export const getUnpaidRide = (account: PassengerAccount) => account.rides?.find(r => r.status === 'completed' && !r.settled) ?? null;
export const validFix = (p: GpsFix | null | undefined): p is GpsFix => !!p &&
  [p.lat, p.lng, p.accuracy, p.timestamp].every(Number.isFinite) &&
  Math.abs(p.lat) <= 90 && Math.abs(p.lng) <= 180 && p.accuracy >= 0 && p.timestamp > 0;
export const isUsableFix = (p: GpsFix | null | undefined, now = Date.now()): boolean =>
  validFix(p) && p.accuracy <= 50 && now - p.timestamp <= 20000 && p.timestamp <= now + 1000;

export function gpsDistance(a: GpsFix, b: GpsFix): number {
  const rad = Math.PI / 180;
  const h = Math.sin((b.lat - a.lat) * rad / 2) ** 2 +
    Math.cos(a.lat * rad) * Math.cos(b.lat * rad) * Math.sin((b.lng - a.lng) * rad / 2) ** 2;
  return 6371000 * 2 * Math.asin(Math.sqrt(Math.min(1, Math.max(0, h))));
}
export function rideFare(ride: PassengerRide) {
  const baseCents = Math.round(ride.startFeeCents + ride.distanceMeters / 1000 * ride.rateCentsPerKm);
  return { baseCents, amountCents: Math.round(baseCents * (100 - ride.discountPercent) / 100) };
}
function replaceRide(account: PassengerAccount, ride: PassengerRide): PassengerAccount {
  return { ...account, rides: account.rides.map(r => r.id === ride.id ? ride : r) };
}
export function startRide(account: PassengerAccount, selection: RideSelection, fix: GpsFix, operationId: string, now = new Date()): PassengerAccount {
  if (account.rides.some(r => r.id === operationId)) return account;
  if (getActiveRide(account)) throw new Error('Masz już rozpoczęty przejazd. Najpierw zrób check-out.');
  if (getUnpaidRide(account)) throw new Error('Najpierw rozlicz poprzedni przejazd w portfelu.');
  if (!operationId || operationId.length > 100 || !['BUS', 'TRAM', 'TRAIN', 'METRO', 'OTHER'].includes(selection.transport) ||
    ![selection.lineName, selection.originName, selection.destinationName].every(s => typeof s === 'string' && s.trim().length > 0 && s.length <= 160) ||
    !isDiscountId(account.profile.discountId) ||
    [selection.transportName, selection.lineNumber].some(s => s !== undefined && (typeof s !== 'string' || !s.trim() || s.length > 160)) ||
    selection.scheduledDepartureTime !== undefined && (typeof selection.scheduledDepartureTime !== 'string' || !Number.isFinite(Date.parse(selection.scheduledDepartureTime)))) throw new Error('Wybierz odcinek transportu.');
  if (!isUsableFix(fix, now.getTime())) throw new Error('Check-in wymaga świeżej lokalizacji GPS z dokładnością do 50 m. Odśwież lokalizację.');
  const discount = discountFor(account.profile.discountId);
  const ride: PassengerRide = {
    ...selection, id: operationId, status: 'active', startedAt: now.toISOString(), distanceMeters: 0,
    discountId: discount.id, discountPercent: discount.percent,
    rateCentsPerKm: Math.round((selection.transport === 'OTHER' ? DEFAULT_RATE : rates[selection.transport]) * 100),
    startFeeCents: Math.round(START_FEE * 100), baseCents: 0, amountCents: 0,
    settled: false, trackingWarning: '', lastFix: { ...fix },
    // An old but still usable fix proves permission, not distance at boarding.
    anchorFix: now.getTime() - fix.timestamp <= 2000 ? { ...fix } : null, samples: 1, gapCount: 0,
  };
  Object.assign(ride, rideFare(ride));
  return { ...account, rides: [ride, ...account.rides] };
}
export function interruptRide(account: PassengerAccount, reason = 'Przerwa w GPS. Nie doliczamy dystansu z odcinka bez wiarygodnego pomiaru.'): PassengerAccount {
  const ride = getActiveRide(account);
  if (!ride || (!ride.lastFix && ride.trackingWarning === reason)) return account;
  return replaceRide(account, { ...ride, lastFix: null, anchorFix: null,
    gapCount: ride.gapCount + (ride.lastFix ? 1 : 0), trackingWarning: reason });
}
export function recordRideFix(account: PassengerAccount, fix: GpsFix, now = Date.now()): PassengerAccount {
  const ride = getActiveRide(account);
  if (!ride) return account;
  if (!isUsableFix(fix, now)) return interruptRide(account, 'GPS jest niedokładny lub nieaktualny. Pomiar wstrzymany; brakujących kilometrów nie doliczamy.');
  if (fix.timestamp < Date.parse(ride.startedAt) || (ride.lastFix && fix.timestamp <= ride.lastFix.timestamp)) return account;
  if (!ride.lastFix || !ride.anchorFix || fix.timestamp - ride.lastFix.timestamp > 30000) {
    const gap = !!ride.lastFix && fix.timestamp - ride.lastFix.timestamp > 30000;
    return replaceRide(account, { ...ride, lastFix: { ...fix }, anchorFix: { ...fix }, samples: ride.samples + 1,
      gapCount: ride.gapCount + (gap ? 1 : 0),
      trackingWarning: gap ? 'Przerwa w pomiarze GPS. Dystans tej przerwy nie został naliczony.' : ride.trackingWarning });
  }
  const seconds = (fix.timestamp - ride.lastFix.timestamp) / 1000;
  const distance = gpsDistance(ride.anchorFix, fix);
  const latestMovement = gpsDistance(ride.lastFix, fix);
  const maxSpeed = ride.transport === 'TRAIN' ? 90 : 45;
  if (seconds <= 0 || latestMovement > Math.max(10, ride.lastFix.accuracy + fix.accuracy) && latestMovement / seconds > maxSpeed) {
    return interruptRide(account, 'Odrzucono skok lokalizacji GPS. Nie naliczamy niewiarygodnego dystansu.');
  }
  const noise = Math.max(10, ride.anchorFix.accuracy + fix.accuracy);
  const moved = distance > noise;
  const updated = { ...ride, distanceMeters: ride.distanceMeters + (moved ? distance : 0),
    lastFix: { ...fix }, anchorFix: moved ? { ...fix } : ride.anchorFix, samples: ride.samples + 1 };
  Object.assign(updated, rideFare(updated));
  return replaceRide(account, updated);
}
export function settleRide(account: PassengerAccount, rideId: string, now = new Date()): PassengerAccount {
  const ride = account.rides.find(r => r.id === rideId);
  if (!ride || ride.status !== 'completed') throw new Error('Nie ma zakończonego przejazdu do rozliczenia.');
  if (ride.settled) return account;
  if (account.balanceCents < ride.amountCents) throw new Error('Za mało środków. Doładuj portfel i rozlicz przejazd.');
  const next = replaceRide(account, { ...ride, settled: true });
  return { ...next, balanceCents: account.balanceCents - ride.amountCents,
    transactions: [{ id: `ride:${ride.id}`, kind: 'ride', rideId: ride.id,
      amountCents: ride.amountCents, createdAt: now.toISOString() }, ...account.transactions] };
}
export function finishRide(account: PassengerAccount, fix?: GpsFix, now = new Date(), expectedRideId?: string): PassengerAccount {
  if (expectedRideId && getActiveRide(account)?.id !== expectedRideId) return account;
  let next = fix ? recordRideFix(account, fix, now.getTime()) : account;
  const ride = getActiveRide(next);
  if (!ride) return next; // Repeated taps never debit again.
  if (!fix || !isUsableFix(fix, now.getTime())) {
    next = interruptRide(next, 'Check-out bez świeżego GPS. Rozliczono tylko zmierzony dystans; brakujących kilometrów nie doliczono.');
  }
  const current = getActiveRide(next)!;
  next = replaceRide(next, { ...current, ...rideFare(current), status: 'completed', endedAt: now.toISOString(),
    lastFix: null, anchorFix: null }); // Receipts do not retain raw GPS locations.
  return next.balanceCents >= current.amountCents ? settleRide(next, current.id, now) : next;
}