import type { TransitStopDepartures } from '@workspace/api-client-react';
import { serviceAlertDisplay } from './service-alert-display';

export function StopServiceAlerts({ data, now }: { data: TransitStopDepartures; now: number }) {
  const { alerts, status } = serviceAlertDisplay(data, now);
  return <section className="pz-service-alerts" aria-label="Komunikaty ZTP" data-testid="section-service-alerts">
    <strong>Komunikaty ZTP</strong>
    {alerts.map(alert => <article key={alert.id} id={`alert-${alert.id}`} data-testid={`alert-${alert.id}`}>
      <b>{alert.effect === 4 ? 'Objazd · ' : alert.effect === 9 ? 'Zmiana przystanku · ' : ''}{alert.title}</b>
      {alert.description && <p>{alert.description}</p>}
      <small>{alert.appliesToStop ? 'Dotyczy tego przystanku lub obsługujących go linii.' : 'Dotyczy wskazanych odjazdów.'}</small>
    </article>)}
    <p className="pz-alert-availability" role="status">{status === 'UNAVAILABLE'
      ? 'Aktualne komunikaty ZTP są niedostępne lub nieaktualne.'
      : status === 'PARTIAL' ? 'Część komunikatów ZTP jest niedostępna.'
      : !alerts.length ? 'Brak aktualnych komunikatów dla tego przystanku.' : 'Oficjalne komunikaty ZTP.'}
      {' '}Brak komunikatu nie potwierdza normalnego kursowania.</p>
  </section>;
}