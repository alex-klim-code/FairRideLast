import { useCallback, useEffect, useRef, useState } from 'react';

type DeviceLocation = { lat: number; lng: number; accuracy: number; timestamp: number };
type LocationStatus = 'idle' | 'loading' | 'ready' | 'error';

export function useDeviceLocation(enabled: boolean) {
  const [location, setLocation] = useState<DeviceLocation | null>(null);
  const [status, setStatus] = useState<LocationStatus>('idle');
  const [error, setError] = useState('');
  const watchId = useRef<number | null>(null);
  const generation = useRef(0);

  const stopWatching = useCallback(() => {
    generation.current += 1;
    if (watchId.current !== null) {
      navigator.geolocation?.clearWatch(watchId.current);
      watchId.current = null;
    }
  }, []);

  const requestLocation = useCallback(() => {
    stopWatching();
    setLocation(null);
    setError('');
    if (!window.isSecureContext || !navigator.geolocation) {
      setStatus('error');
      setError('GPS jest niedostępny. Otwórz aplikację przez HTTPS w przeglądarce obsługującej lokalizację.');
      return;
    }
    setStatus('loading');
    const request = generation.current;
    watchId.current = navigator.geolocation.watchPosition(
      position => {
        if (request !== generation.current) return;
        setLocation({
          lat: position.coords.latitude,
          lng: position.coords.longitude,
          accuracy: position.coords.accuracy,
          timestamp: position.timestamp,
        });
        setError('');
        setStatus('ready');
      },
      failure => {
        if (request !== generation.current) return;
        setLocation(null);
        setStatus('error');
        setError(failure.code === 1
          ? 'Brak zgody na lokalizację. Zezwól tej stronie na dostęp do GPS w ustawieniach przeglądarki i włącz lokalizację na urządzeniu. Otwórz aplikację w osobnej karcie, a następnie ponów próbę.'
          : failure.code === 3
            ? 'Urządzenie nie podało lokalizacji na czas. Sprawdź GPS i spróbuj ponownie.'
            : 'Nie udało się określić Twojej lokalizacji. Sprawdź GPS i spróbuj ponownie.');
      },
      { enableHighAccuracy: true, timeout: 15000, maximumAge: 0 },
    );
  }, [stopWatching]);

  useEffect(() => {
    if (enabled) requestLocation();
    else {
      stopWatching();
      setLocation(null);
      setStatus('idle');
      setError('');
    }
    return stopWatching;
  }, [enabled, requestLocation, stopWatching]);

  return { location, status, error, requestLocation };
}