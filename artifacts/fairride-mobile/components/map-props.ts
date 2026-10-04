import type { GpsFix } from '@workspace/fairride-core';
import type { TransitRoute } from '@workspace/api-client-react';

export interface PassengerMapProps {
  origin: GpsFix | null;
  destination: { name: string; lat: number; lng: number } | null;
  route: TransitRoute | null;
  selectedStep: number | null;
  bottomInset?: number;
}
export const mapOrigin = process.env.EXPO_PUBLIC_DOMAIN ? `https://${process.env.EXPO_PUBLIC_DOMAIN}` : null;
export const mapPage = mapOrigin ? `${mapOrigin}/native-map` : null;
export function mapPayload(props: PassengerMapProps) {
  return {
    type: 'fairride-map-update',
    origin: props.origin,
    destination: props.destination,
    route: props.route ? {
      polyline: props.route.polyline,
      steps: props.route.steps.map(step => ({
        mode: step.mode, polyline: step.polyline, departureStop: step.departureStop, arrivalStop: step.arrivalStop,
      })),
    } : null,
    selectedStep: props.selectedStep,
    bottomInset: props.bottomInset ?? 0,
  };
}