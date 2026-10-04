import type { PassengerDeparture } from '@workspace/api-client-react';

export function departureDisplay(departure: PassengerDeparture, now: number) {
  const updated = Date.parse(departure.realtimeUpdatedAt ?? '');
  const fresh = Number.isFinite(updated) && updated > 0 && now - updated <= 120000 && updated <= now + 30000;
  const status = fresh ? departure.status : 'SCHEDULED';
  const blocked = status === 'CANCELLED' || status === 'SKIPPED';
  const expected = status === 'UPDATED' ? departure.expectedDepartureTime : null;
  const delay = departure.delaySeconds ?? 0;
  const amount = Math.abs(delay) < 60 ? `${Math.abs(delay)} s` : `${Math.round(Math.abs(delay) / 60)} min`;
  const label = status === 'CANCELLED' ? 'Odwołany' : status === 'SKIPPED' ? 'Nie zatrzyma się' :
    expected ? delay > 0 ? `Przewidywany · opóźnienie +${amount}` :
      delay < 0 ? `Przewidywany · ${amount} wcześniej` : 'Przewidywany · bez opóźnienia' :
      'Rozkład · brak świeżej prognozy';
  return { status, blocked, expected, label,
    planned: departure.scheduledDepartureTime ?? departure.departureTime };
}