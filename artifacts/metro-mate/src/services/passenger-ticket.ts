import type { PassengerRide } from './passenger-ride';

// The QR identifies the persisted check-in, not a payment or proof of its
// current status. A future inspector must check that status independently.
// Do not encode personal details, GPS coordinates or a changing fare.
export function activeTicketPayload(ride: PassengerRide): string | null {
  if (ride.status !== 'active') return null;
  return JSON.stringify({
    type: 'fairride.check-in', version: 1,
    ticketId: ride.id, checkedInAt: ride.startedAt,
  });
}