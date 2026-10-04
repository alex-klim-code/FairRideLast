import { lines, stops, type Stop, type Vehicle } from './demo';

export type RoutePoint = { name: string; lat: number; lng: number; stopId?: string };

function distanceKm(a: Pick<RoutePoint, 'lat' | 'lng'>, b: Pick<RoutePoint, 'lat' | 'lng'>) {
  const radians = (degrees: number) => degrees * Math.PI / 180;
  const dLat = radians(b.lat - a.lat), dLng = radians(b.lng - a.lng);
  const value = Math.sin(dLat / 2) ** 2 +
    Math.cos(radians(a.lat)) * Math.cos(radians(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 6371 * 2 * Math.atan2(Math.sqrt(value), Math.sqrt(1 - value));
}

export function closestStopTo(point: Pick<RoutePoint, 'lat' | 'lng'>) {
  return stops.reduce((closest, stop) =>
    distanceKm(point, stop) < distanceKm(point, closest) ? stop : closest, stops[0]);
}

// Connections are estimates within the local demo network, not live schedules.
// Walking links affect travel time, but only the in-vehicle distance affects fare.
export function buildRouteOptions(origin: RoutePoint, destination: RoutePoint, vehicles: Vehicle[]) {
  return lines.flatMap((line, index) => {
    const routeStops = line.stopIds.map(id => stops.find(stop => stop.id === id))
      .filter((stop): stop is Stop => Boolean(stop));
    if (routeStops.length < 2) return [];
    const nearestIndex = (point: Pick<RoutePoint, 'lat' | 'lng'>) =>
      routeStops.reduce((best, stop, i) =>
        distanceKm(point, stop) < distanceKm(point, routeStops[best]!) ? i : best, 0);
    const boardIndex = nearestIndex(origin), alightIndex = nearestIndex(destination);
    if (boardIndex === alightIndex) return [];
    const segment = routeStops.slice(Math.min(boardIndex, alightIndex), Math.max(boardIndex, alightIndex) + 1);
    if (boardIndex > alightIndex) segment.reverse();
    const boardStop = routeStops[boardIndex]!, alightStop = routeStops[alightIndex]!;
    const transitKm = segment.slice(1).reduce((total, stop, i) => total + distanceKm(segment[i]!, stop), 0);
    const vehicle = vehicles.find(item => item.lineId === line.id && item.status.toLowerCase() === 'in service');
    if (!vehicle || transitKm < .15) return [];
    const walkFromKm = distanceKm(origin, boardStop), walkToKm = distanceKm(alightStop, destination);
    if (walkFromKm > 1.5 || walkToKm > 1.5) return [];
    const minutesEstimate = Math.max(5, Math.round(walkFromKm * 12 + transitKm * 3.5 + walkToKm * 12 + 3));
    const coordinates: Array<[number, number]> = [
      [origin.lat, origin.lng], [boardStop.lat, boardStop.lng],
      ...segment.map(stop => [stop.lat, stop.lng] as [number, number]),
      [alightStop.lat, alightStop.lng], [destination.lat, destination.lng],
    ];
    return [{
      line, vehicle, boardStop, alightStop, distanceEstimateKm: transitKm,
      minutesEstimate, coordinates,
      color: ['#27735b', '#d08a47', '#628e9b', '#ad6352', '#7f9254'][index % 5],
    }];
  }).sort((a, b) => a.minutesEstimate - b.minutesEstimate).slice(0, 4);
}