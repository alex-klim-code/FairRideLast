import React, { createContext, useContext, useEffect, useState, type ReactNode } from 'react';
import { AppState } from 'react-native';
import type { TransitRoute } from '@workspace/api-client-react';
import type { RideState } from '@/services/ride-state';
import { loadState } from '@/services/ride-store';
import { reconcileTracking } from '@/services/native-tracking';

interface RideContextValue {
  state: RideState | null; error: string; busy: boolean;
  run: (action: () => Promise<RideState>) => Promise<void>;
  refresh: () => Promise<void>;
  routes: TransitRoute[]; setRoutes: (routes: TransitRoute[]) => void;
  destination: string; setDestination: (name: string) => void;
}
const RideContext = createContext<RideContextValue | null>(null);
export function RideProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<RideState | null>(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [routes, setRoutes] = useState<TransitRoute[]>([]);
  const [destination, setDestination] = useState('');
  async function refresh() {
    try { setState(await loadState()); }
    catch { setError('Nie można odczytać zapisu przejazdu. Nie zmieniono portfela. Spróbuj ponownie.'); }
  }
  async function run(action: () => Promise<RideState>) {
    setBusy(true); setError('');
    try { setState(await action()); }
    catch (e) { setError(e instanceof Error ? e.message : 'Operacja nie powiodła się. Spróbuj ponownie.'); await refresh(); }
    finally { setBusy(false); }
  }
  useEffect(() => {
    let mounted = true;
    const recover = async () => {
      try { const value = await reconcileTracking(); if (mounted) setState(value); }
      catch { if (mounted) setError('Nie udało się sprawdzić GPS lub odczytać przejazdu. Ponów próbę.'); }
    };
    void recover();
    const subscription = AppState.addEventListener('change', value => { if (value === 'active') void recover(); });
    const timer = setInterval(() => {
      if (AppState.currentState === 'active' || AppState.currentState == null) {
        void loadState().then(value => { if (mounted) setState(value); })
          .catch(() => { if (mounted) setError('Nie udało się odczytać próbek GPS. Sprawdź zapis przejazdu.'); });
      }
    }, 3000);
    return () => { mounted = false; subscription.remove(); clearInterval(timer); };
  }, []);
  return <RideContext.Provider value={{ state, error, busy, run, refresh, routes, setRoutes, destination, setDestination }}>{children}</RideContext.Provider>;
}
export function useRide() {
  const context = useContext(RideContext);
  if (!context) throw new Error('Brak kontekstu przejazdu.');
  return context;
}