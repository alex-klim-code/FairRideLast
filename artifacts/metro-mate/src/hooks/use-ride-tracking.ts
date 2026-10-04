import { useEffect } from 'react';
import type { PassengerAccountController } from './use-passenger-account';
import { getActiveRide, type GpsFix } from '../services/passenger-ride';

// Lives above the tabs: changing pages must neither stop metering nor lose a ride.
export function useRideTracking(c: PassengerAccountController, geo: GpsFix | null, status: string) {
  const rideId = c.account ? getActiveRide(c.account)?.id : null;
  const { recordFix, interrupt } = c;
  useEffect(() => {
    if (!rideId) return;
    const action = geo ? recordFix(geo) : status === 'error' ? interrupt() : null;
    action?.catch(() => { /* The controller exposes the storage failure visibly. */ });
  }, [rideId, geo?.lat, geo?.lng, geo?.accuracy, geo?.timestamp, status, recordFix, interrupt]);
  useEffect(() => {
    if (!rideId) return;
    const checkGap = () => {
      if (document.hidden || (!geo && status === 'error') || (geo && Date.now() - geo.timestamp > 30000)) {
        interrupt('Niepełny pomiar GPS. Brakujących kilometrów nie doliczamy. Trzymaj aplikację na pierwszym planie.')
          .catch(() => {});
      }
    };
    const timer = setInterval(checkGap, 5000);
    document.addEventListener('visibilitychange', checkGap);
    window.addEventListener('pagehide', checkGap);
    checkGap();
    return () => {
      clearInterval(timer);
      document.removeEventListener('visibilitychange', checkGap);
      window.removeEventListener('pagehide', checkGap);
    };
  }, [rideId, geo?.timestamp, status, interrupt]);
}