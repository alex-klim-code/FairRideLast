import type { CityConfig, FeedHealth, FeedSource, FleetVehicle, TransportCatalog, TransportKind } from "./transport-domain";
import { mockTransport, type TransportDataProvider } from "./transport-providers";
import { downloadFeed, KRAKOW_DATASETS, KRAKOW_FEED_BASE, parseRealtime, loadFleetSchedule, vehiclesFromFeed,
  type DecodedRealtime, type StaticFeed } from "./krakow-gtfs";
import { passengerScheduleExpiry } from "./passenger-timetable";

const iso = (time: number | null) => time === null ? null : new Date(time).toISOString();
export class TimedFeed<T> {
  private value: T | null = null;
  private fetchedAt: number | null = null;
  private timestamp: number | null = null;
  private attemptedAt = -Infinity;
  private error = "";
  private pending: Promise<void> | null = null;
  constructor(readonly cityId: string, readonly dataset: string, readonly kind: FeedHealth["kind"],
    readonly url: string, private interval: number, private freshFor: number, private retainFor: number,
    private load: () => Promise<T>, private timeOf: (data: T, now: number) => number,
    private expires: (data: T) => number | null = () => null,
    private freshnessFromDownload = false) {}

  async refresh(now = Date.now()) {
    if (this.pending) return this.pending;
    if (now - this.attemptedAt < (this.error ? Math.min(this.interval, 30_000) : this.interval)) return;
    this.attemptedAt = now;
    this.pending = (async () => {
      try {
        const value = await this.load();
        const timestamp = this.timeOf(value, now);
        if (!Number.isFinite(timestamp) || timestamp > now + 30_000) throw new Error("Invalid feed timestamp");
        // Reject backwards snapshots, but allow a repeated timestamp and
        // classify it as stale using its age, not its new download time.
        if (this.timestamp !== null && timestamp < this.timestamp) throw new Error("Feed timestamp moved backwards");
        this.value = value; this.timestamp = timestamp; this.fetchedAt = now; this.error = "";
      } catch (e) {
        this.error = e instanceof Error ? e.message : "Feed download failed";
      }
    })().finally(() => { this.pending = null; });
    return this.pending;
  }
  read(now = Date.now()): { value: T | null; health: FeedHealth } {
    const freshnessTime = this.freshnessFromDownload ? this.fetchedAt : this.timestamp;
    const age = freshnessTime === null ? Infinity : now - freshnessTime;
    const expiry = this.value && this.expires(this.value);
    const usable = this.value !== null && age <= this.retainFor && (!expiry || now <= expiry);
    const source: FeedSource = !usable ? "UNAVAILABLE" : !this.error && age <= this.freshFor ? "LIVE" : "CACHED";
    return { value: usable ? this.value : null, health: {
      cityId: this.cityId, dataset: this.dataset, kind: this.kind, url: this.url, source,
      fetchedAt: iso(this.fetchedAt), feedTimestamp: iso(this.timestamp),
      notice: source === "LIVE" ? "Official ZTP feed." : source === "CACHED"
        ? `Last successful feed; not live. ${this.error || "Feed timestamp is stale."}`
        : `No usable feed. ${this.error || (this.pending ? "Loading official feed." : "Feed missing, expired or stale.")}`,
    } };
  }
}

export interface FleetSnapshot { catalog: TransportCatalog; vehicles: FleetVehicle[]; generatedAt: number }
export class KrakowTransportDataProvider implements TransportDataProvider {
  private groups = KRAKOW_DATASETS.map(dataset => {
    const staticUrl = `${KRAKOW_FEED_BASE}GTFS_KRK_${dataset}.zip`;
    const schedule = new TimedFeed<StaticFeed>("krakow", dataset, "STATIC", staticUrl,
      6 * 60 * 60_000, 24 * 60 * 60_000, 7 * 24 * 60 * 60_000,
      async () => {
        let publishedAt: number | null = null;
        const feed = await loadFleetSchedule(await downloadFeed(staticUrl, 25 * 1024 * 1024,
          time => { publishedAt = time; }), dataset, true);
        // Schedules are decoded/validated, but Go remains Google's planner.
        // The fleet boundary needs trip-line joins, not hundreds of thousands
        // of stop-time rows retained in memory for every operator.
        return { ...feed, stopTimes: [], publishedAt, validThrough: passengerScheduleExpiry(feed) };
      }, (data, now) => data.publishedAt ?? now,
      data => data.validThrough, true);
    const realtime = (kind: FeedHealth["kind"], filename: string) => {
      const url = `${KRAKOW_FEED_BASE}${filename}_${dataset}.pb`;
      return new TimedFeed<DecodedRealtime>("krakow", dataset, kind, url, 30_000, 120_000, 10 * 60_000,
        async () => parseRealtime(await downloadFeed(url, 5 * 1024 * 1024)), data => data.timestamp);
    };
    return { dataset, schedule, positions: realtime("VEHICLES", "VehiclePositions"),
      updates: realtime("TRIPS", "TripUpdates"), alerts: realtime("ALERTS", "ServiceAlerts") };
  });
  async refresh() {
    await Promise.all(this.groups.flatMap(g => [g.schedule.refresh(), g.positions.refresh(), g.updates.refresh(), g.alerts.refresh()]));
  }
  passengerSchedules(now = Date.now()) {
    void Promise.all(this.groups.flatMap(g => [g.schedule.refresh(), g.updates.refresh(), g.alerts.refresh()]));
    const snapshots = this.groups.map(g => g.schedule.read(now));
    const realtime = new Map<StaticFeed, DecodedRealtime>();
    const alertFeeds = new Map<StaticFeed, DecodedRealtime>();
    this.groups.forEach((g, i) => {
      const updates = g.updates.read(now), schedule = snapshots[i]!.value;
      if (schedule && updates.value && updates.health.source === "LIVE") realtime.set(schedule, updates.value);
      const alerts = g.alerts.read(now);
      if (schedule && alerts.value && alerts.health.source === "LIVE") alertFeeds.set(schedule, alerts.value);
    });
    return {
      schedules: snapshots.flatMap(s => s.value ? [s.value] : []),
      realtime,
      alertFeeds,
      cached: snapshots.some(s => s.health.source !== "LIVE"),
      partial: snapshots.some(s => !s.value),
    };
  }
  async snapshot(): Promise<FleetSnapshot> {
    // Serve immediately even on cold start and refresh in the background.
    // Every loader catches errors and reports them through feed health.
    void this.refresh();
    const generatedAt = Date.now(), feeds: FeedHealth[] = [], lines: TransportCatalog["lines"] = [], vehicles: FleetVehicle[] = [];
    for (const group of this.groups) {
      const schedule = group.schedule.read(generatedAt), positions = group.positions.read(generatedAt);
      const updates = group.updates.read(generatedAt), alerts = group.alerts.read(generatedAt);
      feeds.push(schedule.health, positions.health, updates.health, alerts.health);
      if (schedule.value) {
        lines.push(...schedule.value.lines);
        if (positions.value) vehicles.push(...vehiclesFromFeed(group.dataset, schedule.value,
          { ...positions.value, tripUpdates: updates.health.source === "LIVE" ? updates.value?.tripUpdates ?? [] : [] },
          generatedAt, positions.health.source === "LIVE"));
      }
    }
    const essential = feeds.filter(f => f.kind === "STATIC" || f.kind === "VEHICLES");
    const source: FeedSource = essential.every(f => f.source === "LIVE") ? "LIVE"
      : essential.some(f => f.source === "LIVE" || f.source === "CACHED") ? "CACHED" : "UNAVAILABLE";
    const city: CityConfig = { id: "krakow", name: "Kraków", countryCode: "PL", availableTransportTypes: ["TRAM", "BUS"],
      dataProvider: "GTFS", gtfsUrl: `${KRAKOW_FEED_BASE}GTFS_KRK_T.zip`,
      gtfsRealtimeUrl: `${KRAKOW_FEED_BASE}VehiclePositions_T.pb`, isActive: true };
    return { vehicles, generatedAt, catalog: { cities: [city], lines, source, feeds,
      sourceNotice: "Kraków: official ZTP data (A: MPK buses, M: Mobilis buses, T: trams). Partial or stale feeds are labelled below. Check-ins and inspections remain a FairRide demonstration, not operator tickets. Google Go route planning is unchanged." } };
  }
  async getCities() { return (await this.snapshot()).catalog.cities; }
  async getTransportTypes(id: string) { return id === "krakow" ? ["TRAM", "BUS"] as TransportKind[] : []; }
  async getLines(id: string, type: TransportKind) { return (await this.snapshot()).catalog.lines.filter(l => l.cityId === id && l.transportType === type); }
  async getVehicles(lineId: string) { return (await this.snapshot()).vehicles.filter(v => v.lineId === lineId); }
  async getVehicle(id: string) { return (await this.snapshot()).vehicles.find(v => v.id === id); }
  async getVehiclePosition(id: string) {
    const v = await this.getVehicle(id);
    return v?.latitude != null && v.longitude != null ? { latitude: v.latitude, longitude: v.longitude } : null;
  }
}

// Registry selection is city-specific. Real and illustrative fleets never
// share a city option, and an outage never silently substitutes demo vehicles.
const demoKrakowProvider: TransportDataProvider = {
  async getCities() {
    return [{ ...mockTransport.catalog().cities.find(c => c.id === "krakow")!, id: "krakow-demo", name: "Kraków — DEMO" }];
  },
  async getTransportTypes(id) { return id === "krakow-demo" ? mockTransport.getTransportTypes("krakow") : []; },
  async getLines(id, type) {
    return id === "krakow-demo" ? (await mockTransport.getLines("krakow", type)).map(l => ({ ...l, cityId: "krakow-demo" })) : [];
  },
  async getVehicles(id) {
    return (await mockTransport.getVehicles(id)).filter(v => v.cityId === "krakow").map(v => ({ ...v, cityId: "krakow-demo" }));
  },
  async getVehicle(id) {
    const vehicle = await mockTransport.getVehicle(id);
    return vehicle?.cityId === "krakow" ? { ...vehicle, cityId: "krakow-demo" } : undefined;
  },
  async getVehiclePosition() { return null; },
};
export const cityProviders = new Map<string, TransportDataProvider>([
  ...mockTransport.catalog().cities.filter(c => c.id !== "krakow").map(c => [c.id, mockTransport] as const),
  ["krakow", new KrakowTransportDataProvider()],
  ["krakow-demo", demoKrakowProvider],
]);
export const passengerSchedules = () => (cityProviders.get("krakow") as KrakowTransportDataProvider).passengerSchedules();
export async function transportSnapshot(): Promise<FleetSnapshot> {
  const real = await (cityProviders.get("krakow") as KrakowTransportDataProvider).snapshot();
  const mock = mockTransport.catalog();
  const demoCity = { ...mock.cities.find(c => c.id === "krakow")!, id: "krakow-demo", name: "Kraków — DEMO" };
  const demoLines = mock.lines.map(l => l.cityId === "krakow" ? { ...l, cityId: "krakow-demo" } : l);
  const demoVehicles = mockTransport.vehicles.map(v => v.cityId === "krakow" ? { ...v, cityId: "krakow-demo" } : v);
  const demoCities = [demoCity, ...mock.cities.filter(c => c.id !== "krakow")];
  return { ...real, vehicles: [...real.vehicles, ...demoVehicles], catalog: {
    ...real.catalog, cities: [...real.catalog.cities, ...demoCities], lines: [...real.catalog.lines, ...demoLines],
    feeds: [...real.catalog.feeds!, ...demoCities.map(c => ({
      cityId: c.id, dataset: "Illustrative fleet", kind: "STATIC" as const, source: "MOCK" as const,
      url: null, fetchedAt: null, feedTimestamp: null, notice: "Demo lines and vehicles; no external feed or positions.",
    }))],
  } };
}