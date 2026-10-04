import { useEffect, useState } from 'react';
import type { FareTransport } from '../../services/fare-policy';

export interface BoardingSelection {
  transport: FareTransport; lineName: string; transportName: string; lineNumber: string;
  scheduledDepartureTime?: string; originName: string; destinationName: string;
  scheduleSource?: 'ZTP' | 'Google Maps';
}
const ok = (v: unknown): v is BoardingSelection => {
  const o = v as Record<string, unknown> | null;
  return !!o && ['BUS', 'TRAM', 'METRO', 'TRAIN', 'OTHER'].includes(String(o.transport)) &&
    ['lineName', 'transportName', 'lineNumber', 'originName', 'destinationName'].every(k => typeof o[k] === 'string' && (o[k] as string).trim() && (o[k] as string).length <= 160) &&
    (o.scheduledDepartureTime === undefined || (typeof o.scheduledDepartureTime === 'string' && !Number.isNaN(Date.parse(o.scheduledDepartureTime)))) &&
    (o.scheduleSource === undefined || ['ZTP', 'Google Maps'].includes(String(o.scheduleSource)));
};
export function useBoardingSelection(userId: string) {
  const key = `fairride:boarding:${userId}`;
  const read = (storageKey: string): BoardingSelection | null => {
    try { const v = JSON.parse(sessionStorage.getItem(storageKey) || 'null'); return ok(v) ? v : null; } catch { return null; }
  };
  const [state, setState] = useState(() => ({ key, value: read(key) }));
  const sel = state.key === key ? state.value : read(key);
  useEffect(() => { if (state.key !== key) setState({ key, value: read(key) }); }, [key, state.key]);
  const setSel = (value: BoardingSelection | null) => setState({ key, value });
  useEffect(() => {
    if (state.key !== key) return;
    try { if (state.value) sessionStorage.setItem(key, JSON.stringify(state.value)); else sessionStorage.removeItem(key); } catch { /* storage unavailable */ }
  }, [state, key]);
  return [sel, setSel] as const;
}
export const warsawTime = (iso?: string) => {
  if (!iso || Number.isNaN(Date.parse(iso))) return null;
  return new Intl.DateTimeFormat('pl-PL', { hour: '2-digit', minute: '2-digit', hourCycle: 'h23', timeZone: 'Europe/Warsaw' }).format(new Date(iso));
};
