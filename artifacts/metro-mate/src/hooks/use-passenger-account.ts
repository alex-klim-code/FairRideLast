import { useCallback, useEffect, useRef, useState } from 'react';
import { accountKey, endTicket, purchaseTicket, readAccount, refillAccount, saveAccount, validateProfile,
  type PassengerAccount, type PassengerProfile, type RefillMethod } from '../services/passenger-account';
import type { FareQuote } from '../services/fare-policy';
import type { User } from '../services/demo';
import { startRide, recordRideFix, interruptRide, finishRide, settleRide, type GpsFix, type RideSelection } from '../services/passenger-ride';

// Mount the passenger experience with key={user.id}. One persisted snapshot
// contains the balance, ledger and ticket: a failed write cannot partially debit.
export function usePassengerAccount(user: User) {
  const [account, setAccount] = useState<PassengerAccount | null>(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const pending = useRef(false);
  const checkoutPending = useRef(0);
  const reload = useCallback(() => {
    try { setAccount(readAccount(window.localStorage, user)); setError(''); }
    catch (failure) { setAccount(null); setError(failure instanceof Error ? failure.message : 'Nie można odczytać portfela.'); }
  }, [user.id]);
  useEffect(() => {
    reload();
    const changed = (event: StorageEvent) => { if (event.key === accountKey(user.id)) reload(); };
    window.addEventListener('storage', changed);
    return () => window.removeEventListener('storage', changed);
  }, [reload, user.id]);
  const commit = useCallback(async (change: (latest: PassengerAccount) => PassengerAccount) => {
    if (pending.current) throw new Error('Operacja jest już w toku.');
    pending.current = true; setBusy(true); setError('');
    const apply = () => {
      const latest = readAccount(window.localStorage, user);
      const next = change(latest);
      if (next === latest) return latest;
      saveAccount(window.localStorage, next);
      setAccount(next);
      return next;
    };
    try {
      // Web Locks serialize fake-wallet operations across tabs when available.
      return navigator.locks ? await navigator.locks.request(accountKey(user.id), apply) : apply();
    } catch (failure) {
      const message = failure instanceof Error ? failure.message : 'Nie udało się zapisać operacji.';
      setError(message); throw new Error(message);
    } finally { pending.current = false; setBusy(false); }
  }, [user.id]);
  const checkOut = useCallback(async (fix?: GpsFix, rideId?: string) => {
    checkoutPending.current++;
    try {
      // A GPS write may have started during the final position read. Let it finish,
      // then stop metering and close exactly the ride the user chose.
      while (pending.current) await new Promise(resolve => setTimeout(resolve, 10));
      return await commit(latest => finishRide(latest, fix, new Date(), rideId));
    } finally { checkoutPending.current--; }
  }, [commit]);
  return {
    account, error, busy, reload,
    saveProfile: (profile: PassengerProfile) => commit(latest => ({ ...latest, profile: validateProfile(profile) })),
    refill: (amountCents: number, method: RefillMethod, operationId: string) => commit(latest => refillAccount(latest, amountCents, method, operationId)),
    purchase: (quote: FareQuote, originName: string, destinationName: string, operationId: string) =>
      commit(latest => purchaseTicket(latest, quote, originName, destinationName, operationId)),
    endTicket: (ticketId: string) => commit(latest => endTicket(latest, ticketId)),
    checkIn: (selection: RideSelection, fix: GpsFix, operationId: string) => commit(latest => startRide(latest, selection, fix, operationId)),
    checkOut,
    settleRide: (rideId: string) => commit(latest => settleRide(latest, rideId)),
    recordFix: useCallback((fix: GpsFix) => pending.current || checkoutPending.current ? Promise.resolve(null) : commit(latest => recordRideFix(latest, fix)), [commit]),
    interrupt: useCallback((reason?: string) => pending.current || checkoutPending.current ? Promise.resolve(null) : commit(latest => interruptRide(latest, reason)), [commit]),
  };
}
export type PassengerAccountController = ReturnType<typeof usePassengerAccount>;