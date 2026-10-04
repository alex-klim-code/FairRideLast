import type { CityConfig, FleetVehicle, TransportCatalog, TransportKind, TransportLine } from "./transport-domain";

export interface TransportStop { id: string; cityId: string; name: string; latitude: number; longitude: number }
export interface GtfsTrip { id: string; routeId: string; serviceId: string; headsign: string }
export interface GtfsStopTime { tripId: string; stopId: string; stopSequence: number; arrivalTime: string; departureTime: string }
export interface RealtimeFeed {
  vehiclePositions: { vehicleId: string; tripId: string; latitude: number; longitude: number; currentStopId: string }[];
  tripUpdates: { tripId: string; delaySeconds: number; cancelled: boolean }[];
  serviceAlerts: { id: string; routeIds: string[]; description: string }[];
}
export interface NormalizedGtfsFeed {
  lines: TransportLine[]; vehicles: FleetVehicle[]; stops: TransportStop[]; trips: GtfsTrip[]; stopTimes: GtfsStopTime[];
}
export interface TransportDataProvider {
  getCities(): Promise<CityConfig[]>;
  getTransportTypes(cityId: string): Promise<TransportKind[]>;
  getLines(cityId: string, type: TransportKind): Promise<TransportLine[]>;
  getVehicles(lineId: string): Promise<FleetVehicle[]>;
  getVehicle(id: string): Promise<FleetVehicle | undefined>;
  getVehiclePosition(id: string): Promise<{ latitude: number; longitude: number } | null>;
}
export const cities: CityConfig[] = [
  { id: "krakow", name: "Kraków", availableTransportTypes: ["TRAM", "BUS"] },
  { id: "warszawa", name: "Warszawa", availableTransportTypes: ["TRAM", "BUS", "TRAIN", "METRO"] },
  { id: "wroclaw", name: "Wrocław", availableTransportTypes: ["TRAM", "BUS", "TRAIN"] },
  { id: "gdansk", name: "Gdańsk", availableTransportTypes: ["TRAM", "BUS", "TRAIN"] },
  { id: "poznan", name: "Poznań", availableTransportTypes: ["TRAM", "BUS", "TRAIN"] },
  { id: "lodz", name: "Łódź", availableTransportTypes: ["TRAM", "BUS", "TRAIN"] },
  { id: "katowice", name: "Katowice", availableTransportTypes: ["TRAM", "BUS", "TRAIN"] },
  { id: "gdynia", name: "Gdynia", availableTransportTypes: ["BUS", "TROLLEYBUS", "TRAIN"] },
].map(city => ({ ...city, countryCode: "PL", dataProvider: "MOCK", gtfsUrl: null, gtfsRealtimeUrl: null, isActive: true }) as CityConfig);

export class MockTransportDataProvider implements TransportDataProvider {
  readonly lines: TransportLine[] = [];
  readonly vehicles: FleetVehicle[] = [];
  constructor() {
    for (const city of cities) for (const type of city.availableTransportTypes) {
      const number = city.id === "krakow" && type === "TRAM" ? "14"
        : type === "METRO" ? "M1" : type === "TRAIN" ? "S1" : type === "BUS" ? "152" : type === "TROLLEYBUS" ? "23" : "1";
      const directions = city.id === "krakow" && type === "TRAM" ? ["Mistrzejowice", "Bronowice"] : ["Centrum", "Dworzec Główny"];
      directions.forEach((direction, d) => {
        const line: TransportLine = { id: `${city.id}-${type.toLowerCase()}-${number}-${d}`, cityId: city.id, number, transportType: type, direction };
        this.lines.push(line);
        const prefix = ({ TRAM: "TR", BUS: "BU", TRAIN: "SK", METRO: "ME", TROLLEYBUS: "TB" })[type];
        const numbers = city.id === "krakow" && type === "TRAM" && d === 0 ? [142, 186, 204] : [301 + d * 3, 302 + d * 3, 303 + d * 3];
        numbers.forEach((n, i) => this.vehicles.push({
          id: `${line.id}-${prefix}-${n}`, cityId: city.id, lineId: line.id, vehicleNumber: `${prefix}-${n}`,
          status: "ACTIVE", latitude: null, longitude: null, currentStopId: `${line.id}-stop-${i}`,
          currentStopName: city.id === "krakow" ? ["Teatr Słowackiego", "Rondo Mogilskie", "Dworzec Główny"][i]! : ["Centrum", "Dworzec Główny", "Plac Miejski"][i]!,
        }));
      });
    }
  }
  async getCities() { return cities; }
  async getTransportTypes(id: string) { return cities.find(c => c.id === id)?.availableTransportTypes ?? []; }
  async getLines(id: string, type: TransportKind) { return this.lines.filter(l => l.cityId === id && l.transportType === type); }
  async getVehicles(id: string) { return structuredClone(this.vehicles.filter(v => v.lineId === id)); }
  async getVehicle(id: string) { return structuredClone(this.vehicles.find(v => v.id === id)); }
  async getVehiclePosition(_id: string) { return null; } // Never invent a live coordinate.
  catalog(): TransportCatalog { return { cities, lines: this.lines, source: "MOCK", sourceNotice: "Demo fleet and illustrative lines/stops. No live GTFS feed is connected; this does not replace real Google route search." }; }
}

// Adapters accept normalized GTFS input (routes, trips, stops, stop_times).
// Provider-specific ZIP/protobuf fetching belongs in injected loaders, never UI.
export class GtfsTransportDataProvider implements TransportDataProvider {
  private cache: NormalizedGtfsFeed | null = null;
  public source: "LIVE" | "CACHED" | "MOCK" = "MOCK";
  public notice = "Live feed not configured.";
  constructor(private city: CityConfig, private fallback: TransportDataProvider,
    private load: (() => Promise<NormalizedGtfsFeed>) | null) {}
  async feed() {
    if (!this.load) { this.source = this.cache ? "CACHED" : "MOCK"; return this.cache; }
    try {
      const feed = await this.load();
      if (!Array.isArray(feed.lines) || !Array.isArray(feed.vehicles) || !Array.isArray(feed.stops) ||
        !Array.isArray(feed.trips) || !Array.isArray(feed.stopTimes)) throw new Error("Invalid feed");
      this.cache = feed; this.source = "LIVE"; this.notice = "Live GTFS data"; return feed;
    } catch {
      this.source = this.cache ? "CACHED" : "MOCK"; this.notice = this.cache ? "Live feed unavailable; cached GTFS data." : "Live feed unavailable; demo data.";
      return this.cache;
    }
  }
  async getCities() { return this.fallback.getCities(); }
  async getTransportTypes(id: string) { return this.fallback.getTransportTypes(id); }
  async getLines(id: string, type: TransportKind) { return (await this.feed())?.lines.filter(l => l.cityId === id && l.transportType === type) ?? this.fallback.getLines(id, type); }
  async getVehicles(id: string) { return (await this.feed())?.vehicles.filter(v => v.lineId === id) ?? this.fallback.getVehicles(id); }
  async getVehicle(id: string) { return (await this.feed())?.vehicles.find(v => v.id === id) ?? this.fallback.getVehicle(id); }
  async getVehiclePosition(id: string) {
    const v = await this.getVehicle(id);
    return v && v.latitude !== null && v.longitude !== null ? { latitude: v.latitude, longitude: v.longitude } : null;
  }
  getCity() { return this.city; }
}
export class GtfsRealtimeTransportDataProvider {
  private cache: RealtimeFeed | null = null;
  public source: "LIVE" | "CACHED" | "UNAVAILABLE" = "UNAVAILABLE";
  constructor(private load: () => Promise<RealtimeFeed>) {}
  async getFeed() {
    try {
      const feed = await this.load();
      if (!Array.isArray(feed.vehiclePositions) || !Array.isArray(feed.tripUpdates) || !Array.isArray(feed.serviceAlerts)) throw new Error("Invalid realtime feed");
      this.cache = feed; this.source = "LIVE";
    } catch { this.source = this.cache ? "CACHED" : "UNAVAILABLE"; }
    return this.cache;
  }
}
export const mockTransport = new MockTransportDataProvider();