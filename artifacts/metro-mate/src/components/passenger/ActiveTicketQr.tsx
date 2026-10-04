import { QRCodeSVG } from 'qrcode.react';
import type { PassengerRide } from '../../services/passenger-ride';
import { activeTicketPayload } from '../../services/passenger-ticket';

export function ActiveTicketQr({ ride }: { ride: PassengerRide }) {
  const payload = activeTicketPayload(ride);
  if (!payload) return null;
  return <figure className="pz-ticket-qr" data-testid="active-ticket-qr">
    <QRCodeSVG value={payload} size={208} level="M" marginSize={4}
      bgColor="#ffffff" fgColor="#10251d" role="img" title="Kod QR aktywnego biletu FairRide" />
    <figcaption>
      <strong>Kod biletu FairRide</strong>
      <span>Numer biletu</span>
      <span className="pz-ticket-id" data-testid="text-ticket-id">{ride.id}</span>
    </figcaption>
  </figure>;
}