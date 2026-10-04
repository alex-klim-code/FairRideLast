import { useCallback, useEffect, useRef, useState } from 'react';
import { AppState, Platform } from 'react-native';
import * as Location from 'expo-location';
import { validFix, type GpsFix } from '@workspace/fairride-core';
import { fixFromLocation, foregroundFix } from '@/services/native-tracking';

// Foreground map positioning is separate from the billable background task.
// A visible map fix never updates the ledger or invents a fallback origin.
export function usePassengerLocation(enabled: boolean) {
  const [fix, setFix] = useState<GpsFix | null>(null);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const mounted = useRef(false);
  const pending = useRef(false);
  const accept = useCallback((position: GpsFix) => {
    if (!mounted.current || !validFix(position)) return;
    setFix(position); setError(''); setLoading(false);
  }, []);
  const request = useCallback(async () => {
    if (pending.current) return;
    pending.current = true;
    if (mounted.current) { setLoading(true); setError(''); }
    try { accept(await foregroundFix()); }
    catch (e) {
      if (mounted.current) {
        setError(e instanceof Error ? e.message : 'Nie uzyskano lokalizacji. Nie używamy pozycji zastępczej.');
        setLoading(false);
      }
    } finally { pending.current = false; }
  }, [accept]);
  useEffect(() => {
    mounted.current = true;
    if (!enabled) return () => { mounted.current = false; };
    let disposed = false;
    let nativeSubscription: Location.LocationSubscription | undefined;
    let browserWatch: number | undefined;
    const start = async () => {
      await request();
      if (disposed) return;
      if (Platform.OS === 'web') {
        if (!navigator.geolocation) return;
        browserWatch = navigator.geolocation.watchPosition(p => accept({
          lat: p.coords.latitude, lng: p.coords.longitude, accuracy: p.coords.accuracy, timestamp: p.timestamp,
        }), () => {
          if (!disposed) setError('Nie uzyskano świeżej lokalizacji. Odśwież GPS; nie używamy pozycji zastępczej.');
        }, { enableHighAccuracy: true, maximumAge: 0, timeout: 15000 });
      } else {
        const permission = await Location.getForegroundPermissionsAsync();
        if (!permission.granted || disposed) return;
        const subscription = await Location.watchPositionAsync({
          accuracy: Location.Accuracy.High, distanceInterval: 5, timeInterval: 5000,
        }, p => accept(fixFromLocation(p)));
        if (disposed) subscription.remove();
        else nativeSubscription = subscription;
      }
    };
    void start().catch(() => { if (!disposed) setError('Nie udało się obserwować GPS. Odśwież lokalizację.'); });
    const resume = AppState.addEventListener('change', value => {
      if (value === 'active') void request();
    });
    return () => {
      disposed = true; mounted.current = false; resume.remove(); nativeSubscription?.remove();
      if (browserWatch !== undefined) navigator.geolocation.clearWatch(browserWatch);
    };
  }, [enabled, request, accept]);
  return { fix, error, loading, request };
}