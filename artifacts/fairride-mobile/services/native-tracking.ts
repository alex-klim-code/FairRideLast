import { PermissionsAndroid, Platform } from 'react-native';
import * as Location from 'expo-location';
import * as TaskManager from 'expo-task-manager';
import Constants from 'expo-constants';
import { getActiveRide, type GpsFix, type RideSelection } from '@workspace/fairride-core';
import { board, collect, pause, checkout, type RideState } from './ride-state';
import { updateState, loadState } from './ride-store';

export const LOCATION_TASK = 'fairride-native-ride-location-v1';
export const nativeBuild = Platform.OS !== 'web' && Constants.executionEnvironment !== 'storeClient';
export const fixFromLocation = (location: Location.LocationObject): GpsFix => ({
  lat: location.coords.latitude, lng: location.coords.longitude,
  accuracy: location.coords.accuracy ?? 1000000000, timestamp: location.timestamp,
});
// Registered at module scope before Router mounts, including headless task launch.
if (Platform.OS !== 'web' && !TaskManager.isTaskDefined(LOCATION_TASK)) {
  TaskManager.defineTask<{ locations: Location.LocationObject[] }>(LOCATION_TASK, async ({ data, error }) => {
    if (error) {
      await updateState(state => getActiveRide(state.account) ? pause(state, 'System przerwał GPS. Brakujące kilometry nie są naliczane.') : state);
      return;
    }
    if (data?.locations) {
      await updateState(state => collect(state, data.locations.map(fixFromLocation)));
    }
  });
}
export async function foregroundFix(): Promise<GpsFix> {
  if (Platform.OS === 'web') {
    return new Promise((resolve, reject) => {
      if (!navigator.geolocation) return reject(new Error('Brak lokalizacji w przeglądarce.'));
      navigator.geolocation.getCurrentPosition(
        p => resolve({ lat: p.coords.latitude, lng: p.coords.longitude, accuracy: p.coords.accuracy, timestamp: p.timestamp }),
        () => reject(new Error('Nie uzyskano GPS. Zezwól na lokalizację i spróbuj ponownie.')),
        { enableHighAccuracy: true, timeout: 15000, maximumAge: 0 },
      );
    });
  }
  const permission = await Location.requestForegroundPermissionsAsync();
  if (!permission.granted) throw new Error('Odmowa lokalizacji. Włącz dokładną lokalizację w ustawieniach telefonu.');
  if (!(await Location.hasServicesEnabledAsync())) throw new Error('Włącz lokalizację systemową.');
  return fixFromLocation(await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Highest }));
}
async function backgroundPermission() {
  if (!nativeBuild || !(await TaskManager.isAvailableAsync())) {
    throw new Error('GPS w tle wymaga natywnej kompilacji FairRide. Podgląd web i Expo Go nie mogą rozpocząć pomiaru.');
  }
  const foreground = await Location.requestForegroundPermissionsAsync();
  if (!foreground.granted) throw new Error('Zezwól na dokładną lokalizację, aby rozpocząć przejazd.');
  // Android may open Settings; disclosure and explicit action precede this call in UI.
  const background = await Location.requestBackgroundPermissionsAsync();
  if (!background.granted) throw new Error('Wymagana lokalizacja „Zawsze” / „Zezwalaj cały czas”. Nie rozpoczęto pomiaru.');
  if (Platform.OS === 'android') {
    const permission = await Location.getForegroundPermissionsAsync();
    if (permission.android?.accuracy !== 'fine') throw new Error('Włącz dokładną lokalizację, nie przybliżoną.');
    if (Number(Platform.Version) >= 33) {
      const notifications = await PermissionsAndroid.request(PermissionsAndroid.PERMISSIONS.POST_NOTIFICATIONS);
      if (notifications !== PermissionsAndroid.RESULTS.GRANTED) {
        throw new Error('Zezwól na powiadomienie aktywnego pomiaru w ustawieniach telefonu. Nie rozpoczęto GPS.');
      }
    }
  }
}
async function startUpdates() {
  await Location.startLocationUpdatesAsync(LOCATION_TASK, {
    accuracy: Location.Accuracy.BestForNavigation,
    timeInterval: 5000, distanceInterval: 5,
    deferredUpdatesInterval: 10000, deferredUpdatesDistance: 0,
    pausesUpdatesAutomatically: false,
    showsBackgroundLocationIndicator: true,
    activityType: Location.ActivityType.AutomotiveNavigation,
    foregroundService: {
      notificationTitle: 'FairRide — aktywny przejazd',
      notificationBody: 'Pomiar GPS działa w tle. Otwórz FairRide, aby zrobić check-out.',
      notificationColor: '#1e6854',
      killServiceOnDestroy: true,
    },
  });
}
async function stopUpdates() {
  if (nativeBuild && await Location.hasStartedLocationUpdatesAsync(LOCATION_TASK)) {
    await Location.stopLocationUpdatesAsync(LOCATION_TASK);
  }
}
let actionQueue: Promise<unknown> = Promise.resolve();
function serialize<T>(action: () => Promise<T>): Promise<T> {
  const result = actionQueue.then(action);
  actionQueue = result.catch(() => {});
  return result;
}
export function checkIn(selection: RideSelection): Promise<RideState> {
  return serialize(async () => {
    await backgroundPermission();
    const fix = await foregroundFix();
    const id = `FRM-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
    await updateState(state => board(state, selection, fix, id));
    try {
      await startUpdates();
      return await updateState(state => ({ ...state, tracking: 'running' }));
    } catch {
      await updateState(state => pause(state, 'Nie uruchomiono GPS w tle. Wznów pomiar lub zakończ przejazd.'));
      throw new Error('Przejazd został zapisany, ale pomiar nie ruszył. Wznów GPS lub zrób check-out.');
    }
  });
}
export function checkOut(rideId: string): Promise<RideState> {
  return serialize(async () => {
    const before = await loadState();
    if (getActiveRide(before.account) && getActiveRide(before.account)?.id !== rideId) return before;
    // Commit ended/unpaid/paid + purge samples before touching the OS.
    // A failed stop cannot reopen the ride, accrue distance, or repeat a debit.
    let saveError: unknown;
    try { await updateState(state => checkout(state, rideId)); }
    catch (error) { saveError = error; }
    try {
      await stopUpdates();
      if (saveError) throw saveError;
      return await updateState(state => ({ ...state, tracking: 'off', issue: '' }));
    } catch {
      if (saveError) throw new Error('Nie zapisano check-out. Zażądano wyłączenia GPS, ale nie potwierdzamy zakończenia ani rozliczenia. Ponów check-out; nie wznawiaj przejazdu.');
      return updateState(state => ({ ...state, tracking: 'stopping',
        issue: 'Przejazd zakończony. System nie potwierdził wyłączenia GPS; ponów wyłączenie.' }));
    }
  });
}
export function resumeTracking(): Promise<RideState> {
  return serialize(async () => {
    const state = await loadState();
    if (!getActiveRide(state.account)) throw new Error('Nie ma aktywnego przejazdu.');
    await backgroundPermission();
    await updateState(s => pause(s, 'Wznowiono pomiar. Dystans przerwy nie jest naliczany.'));
    await startUpdates();
    return updateState(s => ({ ...s, tracking: 'running', issue: '' }));
  });
}
export function reconcileTracking(): Promise<RideState> {
  return serialize(async () => {
    const state = await loadState();
    if (!nativeBuild) return state;
    if (!getActiveRide(state.account)) {
      try {
        await stopUpdates();
        return await updateState(s => ({ ...s, tracking: 'off', issue: '' }));
      } catch {
        return updateState(s => ({ ...s, tracking: 'stopping', issue: 'Ponów wyłączenie GPS.' }));
      }
    }
    const permission = await Location.getBackgroundPermissionsAsync();
    const enabled = await Location.hasServicesEnabledAsync();
    const running = await Location.hasStartedLocationUpdatesAsync(LOCATION_TASK);
    if (!permission.granted || !enabled || !running) {
      return updateState(s => pause(s, 'GPS jest wyłączony lub proces został zatrzymany. Wznów pomiar; brakujących kilometrów nie doliczamy.'));
    }
    return updateState(s => ({ ...s, tracking: 'running' }));
  });
}