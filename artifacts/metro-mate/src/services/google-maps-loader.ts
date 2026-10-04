import { getGoogleMapsConfig } from '@workspace/api-client-react';

export const MAP_ERROR_EVENT = 'fairride:maps-error';
type MapErrorCode = 'MAP_CONFIG' | 'MAP_AUTH' | 'MAP_CONNECTION' | 'MAP_TIMEOUT' | 'MAP_INIT';
export class MapLoadError extends Error {
  constructor(public code: MapErrorCode, message: string) { super(message); }
}
let loader: Promise<void> | null = null;
let generation = 0;
let authorizationFailed = false;
let cancelPending: (() => void) | null = null;
const sdkScripts = () => document.querySelectorAll('script[src*="maps.googleapis.com/maps/api/js"]');
const hasLibraries = () => Boolean(window.google?.maps?.geometry && window.google.maps.marker?.AdvancedMarkerElement);

// Called only after the previous component/map has been cleaned up.
export function resetGoogleMaps() {
  generation++;
  cancelPending?.();
  cancelPending = null;
  loader = null;
  authorizationFailed = false;
  sdkScripts().forEach(script => script.remove());
  const w = window as any;
  delete w.google;
  delete w.__fairRideMapsReady;
  delete w.gm_authFailure;
}

export function loadGoogleMaps(force = false): Promise<void> {
  if (force || authorizationFailed) resetGoogleMaps();
  if (loader) return loader;
  const current = ++generation;
  loader = (async () => {
    if (!authorizationFailed && hasLibraries()) return;
    let cfg;
    try {
      cfg = await getGoogleMapsConfig({ cache: 'no-store', signal: AbortSignal.timeout(10000) });
    } catch (error) {
      const message = (error as { data?: { error?: unknown } } | null)?.data?.error;
      throw new MapLoadError('MAP_CONFIG', typeof message === 'string'
        ? message.slice(0, 500) : 'Nie udało się pobrać konfiguracji mapy. Sprawdź połączenie i ponów próbę.');
    }
    if (current !== generation) throw new MapLoadError('MAP_INIT', 'Ładowanie mapy zostało przerwane.');
    if (!cfg?.apiKey) throw new MapLoadError('MAP_CONFIG', 'Brakuje konfiguracji klucza mapy.');
    await new Promise<void>((resolve, reject) => {
      const w = window as any;
      const timer = window.setTimeout(() => fail(new MapLoadError('MAP_TIMEOUT',
        'Google Maps nie odpowiedziało w ciągu 15 sekund. Sprawdź połączenie lub blokowanie skryptów.')), 15000);
      const finish = () => { window.clearTimeout(timer); cancelPending = null; };
      const fail = (error: MapLoadError) => { finish(); reject(error); };
      cancelPending = () => fail(new MapLoadError('MAP_INIT', 'Ładowanie mapy zostało przerwane.'));
      w.__fairRideMapsReady = () => {
        if (current !== generation) return;
        if (authorizationFailed) { fail(new MapLoadError('MAP_AUTH', 'Google odrzucił dostęp do mapy.')); return; }
        if (!hasLibraries()) { fail(new MapLoadError('MAP_INIT', 'Biblioteka Google Maps jest niekompletna. Ponów ładowanie mapy.')); return; }
        finish(); resolve();
      };
      w.gm_authFailure = () => {
        if (current !== generation) return;
        authorizationFailed = true;
        loader = null;
        const error = new MapLoadError('MAP_AUTH',
          'Google odrzucił dostęp do mapy. Sprawdź klucz Maps JavaScript API, rozliczanie i dozwoloną domenę. Wyszukiwanie adresów i wskazówki trasy działają niezależnie od mapy.');
        window.dispatchEvent(new CustomEvent(MAP_ERROR_EVENT, { detail: error }));
        fail(error);
      };
      const script = document.createElement('script');
      script.async = true;
      script.src = `https://maps.googleapis.com/maps/api/js?key=${encodeURIComponent(cfg.apiKey)}&v=weekly&libraries=geometry,marker&callback=__fairRideMapsReady`;
      script.onerror = () => {
        if (current === generation) fail(new MapLoadError('MAP_CONNECTION',
          'Nie udało się pobrać Google Maps. Sprawdź internet, VPN lub blokowanie skryptów.'));
      };
      document.head.appendChild(script);
    });
  })().catch(error => {
    if (current === generation) {
      loader = null;
      sdkScripts().forEach(script => script.remove());
    }
    throw error;
  });
  return loader;
}