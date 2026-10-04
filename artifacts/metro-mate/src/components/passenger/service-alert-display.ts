import type { TransitStopDepartures, PassengerServiceAlert } from '@workspace/api-client-react';
import { departureDisplay } from './departure-display';

const fresh = (value: string | null | undefined, now: number) => {
  const time = Date.parse(value ?? '');
  return Number.isFinite(time) && time > 0 && now - time <= 120000 && time <= now + 30000;
};
function active(alert: PassengerServiceAlert, at: number) {
  return !alert.periods.length || alert.periods.some(p =>
    (p.start === null || Date.parse(p.start) <= at) &&
    (p.end === null || at < Date.parse(p.end)));
}
export function serviceAlertDisplay(data: TransitStopDepartures, now: number) {
  const alerts = (data.alerts ?? []).filter(a => fresh(a.updatedAt, now) &&
    ((a.appliesToStop && active(a, now)) || data.departures.some(d => {
      if (!a.departureIds.includes(d.id)) return false;
      const view = departureDisplay(d, now), at = Date.parse(view.expected ?? view.planned);
      return at >= now && active(a, at);
    })));
  const status = fresh(data.alertsUpdatedAt, now) ? data.alertsStatus : 'UNAVAILABLE';
  return { alerts, status };
}