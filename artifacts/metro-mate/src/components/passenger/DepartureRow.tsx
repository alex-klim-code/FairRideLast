import type { PassengerDeparture, PassengerServiceAlert } from '@workspace/api-client-react';
import { transportLabels } from '../../services/fare-policy-exports';
import { VehicleIcon } from './GoRouteCard';
import { warsawTime } from './boarding';
import { departureDisplay } from './departure-display';

export function DepartureRow({ departure: d, now, onBoard, alerts = [] }: {
  departure: PassengerDeparture; now: number; onBoard: (d: PassengerDeparture) => void; alerts?: PassengerServiceAlert[];
}) {
  const view = departureDisplay(d, now);
  return <li className="pz-dep" data-status={view.status} data-testid={`row-departure-${d.id}`}>
    <span className={`pz-dep-ico ${d.transportType.toLowerCase()}`}><VehicleIcon type={d.transportType} /></span>
    <span className="pz-dep-main"><b>{transportLabels[d.transportType]} {d.lineNumber}</b>
      <span>{d.headsign}</span><span className="pz-dep-status" role="status">{view.label}</span>
      {alerts.filter(a => a.departureIds.includes(d.id)).map(a => <a className="pz-dep-alert-link" key={a.id}
        href={`#${encodeURIComponent(`alert-${a.id}`)}`}>Komunikat ZTP: {a.title}</a>)}</span>
    <span className="pz-dep-times">
      <time dateTime={view.expected ?? view.planned}>{warsawTime(view.expected ?? view.planned)}</time>
      <small>{view.expected ? `Plan ${warsawTime(view.planned)}` : 'Plan'}</small>
    </span>
    <button type="button" className="btn" disabled={view.blocked} onClick={() => onBoard(d)}
      data-testid={`button-board-${d.id}`}>Wybierz</button>
  </li>;
}