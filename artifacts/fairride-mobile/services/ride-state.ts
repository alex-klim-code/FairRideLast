import {
  createAccount, readAccount, saveAccount, getActiveRide, startRide,
  recordRideFix, interruptRide, finishRide, settleRide, refillAccount,
  validFix, validateProfile, type PassengerProfile, type RefillMethod,
  type PassengerAccount, type GpsFix, type RideSelection, type DiscountId,
} from '@workspace/fairride-core';

export const LOCAL_USER = { id: 'mobile-local-passenger', firstName: 'Pasażer', lastName: 'FairRide', email: '', phone: '' };
export interface RideState {
  version: 1;
  account: PassengerAccount;
  samples: GpsFix[];
  highWater: number;
  tracking: 'off' | 'starting' | 'running' | 'interrupted' | 'stopping';
  issue: string;
}
export const initialState = (): RideState => ({
  version: 1, account: createAccount(LOCAL_USER), samples: [], highWater: 0, tracking: 'off', issue: '',
});
export function validateState(raw: string): RideState {
  const value = JSON.parse(raw) as RideState;
  if (value.version !== 1 || !Array.isArray(value.samples) ||
      !Number.isFinite(value.highWater) || typeof value.issue !== 'string' ||
      !['off', 'starting', 'running', 'interrupted', 'stopping'].includes(value.tracking)) {
    throw new Error('Uszkodzony zapis przejazdu. Nie nadpisaliśmy danych.');
  }
  value.account = readAccount({ getItem: () => JSON.stringify(value.account), setItem: () => {} }, LOCAL_USER);
  if (!value.samples.every(validFix)) throw new Error('Uszkodzony zapis próbek GPS.');
  if (!getActiveRide(value.account) && value.samples.length) throw new Error('Niepoprawny zapis próbek.');
  return value;
}
export function validateBeforeSave(state: RideState) {
  saveAccount({ getItem: () => null, setItem: () => {} }, state.account);
  validateState(JSON.stringify(state));
}
export function board(state: RideState, selection: RideSelection, fix: GpsFix, id: string, now = new Date()): RideState {
  const account = startRide(state.account, selection, fix, id, now);
  if (account === state.account) return state;
  return { ...state, account, samples: [fix], highWater: fix.timestamp, tracking: 'starting', issue: '' };
}
// Native OS batches may arrive late. Judge freshness at the sampling time, not delivery time.
// The separate watermark survives rejected fixes and interruptions; replays never accrue distance.
export function collect(state: RideState, batch: GpsFix[], receivedAt = Date.now()): RideState {
  const active = getActiveRide(state.account);
  if (!active || state.tracking === 'stopping') return state;
  let next = state;
  for (const fix of [...batch].sort((a, b) => a.timestamp - b.timestamp)) {
    if (!validFix(fix)) {
      next = pause(next, 'Odrzucono niepoprawną próbkę GPS. Brakujących kilometrów nie doliczamy.');
      continue;
    }
    if (!Number.isFinite(fix.timestamp) || fix.timestamp <= next.highWater ||
        fix.timestamp < Date.parse(active.startedAt) || fix.timestamp > receivedAt + 1000) continue;
    next = { ...next, highWater: fix.timestamp,
      account: recordRideFix(next.account, fix, fix.timestamp),
      samples: [...next.samples, fix] };
  }
  return next;
}
export function pause(state: RideState, reason: string): RideState {
  return { ...state, account: interruptRide(state.account, reason), tracking: 'interrupted', issue: reason };
}
export function checkout(state: RideState, rideId: string, now = new Date()): RideState {
  if (getActiveRide(state.account)?.id !== rideId) return state;
  return { ...state, account: finishRide(state.account, undefined, now, rideId),
    // Remove raw evidence atomically with completion, never include it in receipts.
    samples: [], highWater: 0, tracking: 'stopping', issue: '' };
}
export function pay(state: RideState, id: string): RideState {
  return { ...state, account: settleRide(state.account, id) };
}
export function topUp(state: RideState, cents: number, id: string, method: RefillMethod = 'blik'): RideState {
  return { ...state, account: refillAccount(state.account, cents, method, id) };
}
export function setProfile(state: RideState, profile: PassengerProfile): RideState {
  return { ...state, account: { ...state.account, profile: validateProfile(profile) } };
}
export function setDiscount(state: RideState, id: DiscountId): RideState {
  return { ...state, account: { ...state.account, profile: { ...state.account.profile, discountId: id } } };
}