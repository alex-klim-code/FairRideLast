import { Platform } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { initialState, validateState, validateBeforeSave, type RideState } from './ride-state';

export interface AtomicStore {
  update(change: (state: RideState) => RideState): Promise<RideState>;
}
// No React/UI/auth dependency: the native background task uses this same store.
// A write lock BEFORE reading serializes foreground, headless, and checkout writes.
let nativeStore: Promise<AtomicStore> | undefined;
async function openNative(): Promise<AtomicStore> {
  const SQLite = await import('expo-sqlite');
  const db = await SQLite.openDatabaseAsync('fairride-mobile.db');
  await db.execAsync('PRAGMA journal_mode = WAL; PRAGMA busy_timeout = 5000; CREATE TABLE IF NOT EXISTS ride_state (id INTEGER PRIMARY KEY CHECK(id=1), payload TEXT NOT NULL);');
  return {
    async update(change) {
      let result!: RideState;
      await db.withExclusiveTransactionAsync(async tx => {
        await tx.execAsync('PRAGMA busy_timeout = 5000;');
        // Expo begins a deferred transaction. Acquire the writer lock before SELECT,
        // avoiding read-then-write snapshot races between headless and foreground.
        await tx.runAsync('INSERT OR IGNORE INTO ride_state(id,payload) VALUES(1,?)', JSON.stringify(initialState()));
        const row = await tx.getFirstAsync<{ payload: string }>('SELECT payload FROM ride_state WHERE id=1');
        const current = row ? validateState(row.payload) : initialState();
        result = change(current);
        validateBeforeSave(result);
        if (result !== current) {
          await tx.runAsync('INSERT INTO ride_state(id,payload) VALUES(1,?) ON CONFLICT(id) DO UPDATE SET payload=excluded.payload', JSON.stringify(result));
        }
      });
      return result;
    },
  };
}
// Web is a planning preview only, not a substitute for background GPS.
let webQueue: Promise<unknown> = Promise.resolve();
const webStore: AtomicStore = {
  update(change) {
    const result = webQueue.then(async () => {
      const raw = await AsyncStorage.getItem('fairride-mobile-preview-v1');
      const next = change(raw ? validateState(raw) : initialState());
      validateBeforeSave(next);
      await AsyncStorage.setItem('fairride-mobile-preview-v1', JSON.stringify(next));
      return next;
    });
    webQueue = result.catch(() => {});
    return result;
  },
};
let nativeQueue: Promise<unknown> = Promise.resolve();
export function updateState(change: (state: RideState) => RideState): Promise<RideState> {
  if (Platform.OS === 'web') return webStore.update(change);
  const result = nativeQueue.then(async () => {
    // Initialization errors are retryable, not a permanently rejected cached promise.
    try {
      const store = await (nativeStore ??= openNative());
      return await store.update(change);
    } catch (error) { nativeStore = undefined; throw error; }
  });
  nativeQueue = result.catch(() => {});
  return result;
}
export const loadState = () => updateState(state => state);