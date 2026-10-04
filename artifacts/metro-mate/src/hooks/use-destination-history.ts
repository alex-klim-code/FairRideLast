import { useRef, useState } from 'react';
import type { RoutePoint } from '../services/routing';
import {
  HISTORY_STORAGE_ERROR, readDestinationHistory, rememberDestination, sameDestination,
  saveDestinationHistory, type RecentDestination,
} from '../services/destination-history';

export function useDestinationHistory() {
  const [initial] = useState(() => {
    try { return { entries: readDestinationHistory(window.localStorage), error: '' }; }
    catch { return { entries: [] as RecentDestination[], error: HISTORY_STORAGE_ERROR }; }
  });
  const [entries, setEntries] = useState(initial.entries);
  const [error, setError] = useState(initial.error);
  const current = useRef(entries);
  const commit = (next: RecentDestination[]) => {
    current.current = next;
    setEntries(next);
    try { saveDestinationHistory(window.localStorage, next); setError(''); }
    catch { setError(HISTORY_STORAGE_ERROR); }
  };
  return {
    entries, error,
    remember: (point: RoutePoint) => commit(rememberDestination(current.current, point)),
    remove: (point: RecentDestination) => commit(current.current.filter(entry => !sameDestination(entry, point))),
    clear: () => commit([]),
  };
}