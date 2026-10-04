import { useMemo, useState } from "react";
import type { ReactNode } from "react";
import { Link } from "wouter";
import { Bus, TrainFront, TrainFrontTunnel, TramFront, Zap } from "lucide-react";
import type { CityConfig, InspectionSession, TransportCatalog, TransportLine, TransportVehicle, TransportWorkspace } from "@workspace/api-client-react";
import type { TransportController } from "../../hooks/use-transport-workspace";
import "./transport.css";

export const typeLabel: Record<string, string> = { TRAM: "Tram", BUS: "Bus", TRAIN: "Train", METRO: "Metro", TROLLEYBUS: "Trolleybus" };
export const statusLabel: Record<string, string> = { ACTIVE: "ACTIVE", CHECK_IN_LOCKED: "CHECK_IN_LOCKED", OUT_OF_SERVICE: "OUT_OF_SERVICE" };
export const fmtTime = (s: string) => new Date(s).toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit", second: "2-digit", timeZone: "Europe/Warsaw" });
export const fmtDateTime = (s: string) => new Date(s).toLocaleString("en-GB", { timeZone: "Europe/Warsaw" });
export const warsawDay = (s: string | number | Date) => new Date(s).toLocaleDateString("en-CA", { timeZone: "Europe/Warsaw" });
export const durationText = (a: string, b: string | null) => {
  if (!b) return "in progress";
  const sec = Math.max(0, Math.round((Date.parse(b) - Date.parse(a)) / 1000));
  return `${Math.floor(sec / 60)}m ${String(sec % 60).padStart(2, "0")}s`;
};
export const typeIcon = (t: string, size = 26) => t === "TRAM" ? <TramFront size={size} /> : t === "BUS" ? <Bus size={size} /> : t === "TRAIN" ? <TrainFront size={size} /> : t === "METRO" ? <TrainFrontTunnel size={size} /> : <Zap size={size} />;
export const tagFor = (st: string) => st === "ACTIVE" ? "tag" : st === "CHECK_IN_LOCKED" ? "tag tag-red" : "tag tag-neutral";

export function Tag({ status }: { status: string }) { return <span className={tagFor(status)} data-testid={`status-${status}`}>{statusLabel[status] ?? status}</span>; }

export function Gate({ c, children }: { c: TransportController; children: (d: { catalog: TransportCatalog; ws: TransportWorkspace }) => ReactNode }) {
  if (c.loading) return <div className="tp-steps" data-testid="transport-loading"><div className="tp-skel" /><div className="tp-skel" /><div className="tp-skel" /></div>;
  if (!c.catalog || !c.workspace) return <section className="surface pad empty-state" data-testid="transport-error"><h2>Transport data unavailable</h2><div className="pz-alert notice" role="alert">{c.error || "No data received."}</div><button className="btn" style={{ marginTop: 12 }} onClick={() => { c.refresh().catch(() => undefined); }} data-testid="button-retry">Retry</button></section>;
  return <>{c.error && <div className="tp-banner tp-bad" role="alert" data-testid="transport-alert" style={{ marginBottom: 12 }}>{c.error}</div>}{children({ catalog: c.catalog, ws: c.workspace })}</>;
}

export function ProviderNotice({ catalog }: { catalog: TransportCatalog }) {
  if (catalog.source === 'MOCK') return null;
  return <div className="notice" data-testid="text-provider-notice">
    <strong>Kraków: {catalog.source}.</strong>
    <p>Source: <a href="https://gtfs.ztp.krakow.pl/" target="_blank" rel="noreferrer">Zarząd Transportu Publicznego w Krakowie</a>. Data normalized by FairRide.</p>
    <details><summary>Feed freshness and availability</summary>
      {(catalog.feeds ?? []).filter(f => f.source !== 'MOCK').map(f => <div key={`${f.cityId}-${f.dataset}-${f.kind}`} style={{ marginTop: 8 }}>
        <strong>{catalog.cities.find(c => c.id === f.cityId)?.name} · {f.dataset} · {f.kind}: {f.source}</strong>
        <div>{f.feedTimestamp ? `Feed time: ${fmtDateTime(f.feedTimestamp)}. ` : ""}{f.fetchedAt ? `Downloaded: ${fmtDateTime(f.fetchedAt)}. ` : ""}{f.notice}</div>
      </div>)}
    </details>
  </div>;
}

export function lineOf(catalog: TransportCatalog, id: string) { return catalog.lines.find(l => l.id === id); }
export const lineTitle = (l?: TransportLine) => l ? `${typeLabel[l.transportType] ?? l.transportType} ${l.number} to ${l.direction}` : "Unknown line";

export function VehiclePicker({ catalog, vehicles, value, onSelect }: { catalog: TransportCatalog; vehicles: TransportVehicle[]; value: string; onSelect: (v: TransportVehicle | null) => void }) {
  const sel = vehicles.find(v => v.id === value);
  const selLine = sel && lineOf(catalog, sel.lineId);
  const cities = catalog.cities.filter(c => c.isActive);
  const [cityId, setCity] = useState(sel?.cityId ?? "");
  const [type, setType] = useState(selLine?.transportType ?? "");
  const [lineId, setLine] = useState(sel?.lineId ?? "");
  const [q, setQ] = useState("");
  const city: CityConfig | undefined = cities.find(c => c.id === cityId);
  const types = city ? city.availableTransportTypes : [];
  const lines = useMemo(() => catalog.lines.filter(l => l.cityId === cityId && l.transportType === type &&
    (!q.trim() || `${l.number} ${l.direction}`.toLowerCase().includes(q.trim().toLowerCase()))), [catalog, cityId, type, q]);
  const vs = vehicles.filter(v => v.lineId === lineId);
  const pickCity = (id: string) => { setCity(id); setType(""); setLine(""); setQ(""); onSelect(null); };
  const pickType = (t: string) => { setType(t); setLine(""); setQ(""); onSelect(null); };
  const pickLine = (id: string) => { setLine(id); onSelect(null); };
  return <div className="tp-steps" data-testid="vehicle-picker">
    <div><div className="tp-label">1. Select city</div><div className="tp-chips" role="group" aria-label="City">
      {cities.map(c => <button key={c.id} type="button" className="tp-chip" aria-pressed={c.id === cityId} onClick={() => pickCity(c.id)} data-testid={`button-city-${c.id}`}>{c.name.replace(/\s*[—-]\s*DEMO\b/gi, '')}</button>)}</div></div>
    {city && <div className="fade-in"><div className="tp-label">2. Select transport type</div><div className="tp-cards" role="group" aria-label="Transport type">
      {types.map(t => <button key={t} type="button" className="tp-card" aria-pressed={t === type} onClick={() => pickType(t)} data-testid={`button-type-${t}`}>{typeIcon(t)}<span>{typeLabel[t] ?? t}</span></button>)}</div></div>}
    {city && type && <div className="fade-in"><div className="tp-label">3. Find your line</div>
      <label className="field"><span>Search by number or direction</span><input type="search" value={q} onChange={e => setQ(e.target.value)} placeholder="14 or Mistrzejowice" data-testid="input-line-search" /></label>
      <div className="tp-list" style={{ marginTop: 8 }}>{lines.length === 0 ? <div className="notice" data-testid="empty-lines">No lines match.</div> :
        lines.map(l => <button key={l.id} type="button" className="tp-row" aria-pressed={l.id === lineId} onClick={() => pickLine(l.id)} data-testid={`button-line-${l.id}`}>
          <span className="line-badge">{l.number}</span><span className="tp-row-main"><strong>{typeLabel[l.transportType]} {l.number}</strong><small>Direction: {l.direction}</small></span></button>)}</div></div>}
    {lineId && <div className="fade-in"><div className="tp-label">4. Select physical vehicle</div><div className="tp-list">
      {vs.length === 0 ? <div className="notice" data-testid="empty-vehicles">No vehicles on this line.</div> : vs.map(v =>
        <button key={v.id} type="button" className="tp-row" aria-pressed={v.id === value} onClick={() => onSelect(v)} data-testid={`button-vehicle-${v.id}`}>
          <span className="tp-row-main"><strong className="data">{v.vehicleNumber}</strong><small>Current stop: {v.currentStopName}</small></span><Tag status={v.status} /></button>)}</div></div>}
  </div>;
}

export function ConfirmButton({ label, confirmLabel, testId, confirmId, disabled, onConfirm, danger, text }: { label: string; confirmLabel: string; testId: string; confirmId: string; disabled: boolean; onConfirm: () => Promise<void>; danger?: boolean; text: string }) {
  const [open, setOpen] = useState(false);
  if (!open) return <button type="button" className={`btn tp-big ${danger ? "btn-danger" : ""}`} disabled={disabled} onClick={() => setOpen(true)} data-testid={testId}>{label}</button>;
  return <div className="notice" role="alertdialog" aria-label={label} data-testid={`${testId}-confirm`}><p style={{ margin: "0 0 10px" }}>{text}</p>
    <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
      <button type="button" className={`btn ${danger ? "btn-danger" : ""}`} disabled={disabled} data-testid={confirmId} onClick={async () => { try { await onConfirm(); } catch { /* error shown by controller */ } setOpen(false); }}>{confirmLabel}</button>
      <button type="button" className="btn btn-quiet" onClick={() => setOpen(false)} data-testid={`${testId}-cancel`}>Cancel</button></div></div>;
}

export function activeInspection(ws: TransportWorkspace, vehicleId: string) { return ws.inspections.find(i => i.vehicleId === vehicleId && i.status === "ACTIVE"); }

export function VehicleOps({ c, catalog, ws, vehicle, feedback, setFeedback }: { c: TransportController; catalog: TransportCatalog; ws: TransportWorkspace; vehicle: TransportVehicle; feedback: string; setFeedback: (s: string) => void }) {
  const line = lineOf(catalog, vehicle.lineId), city = catalog.cities.find(x => x.id === vehicle.cityId);
  const insp = activeInspection(ws, vehicle.id);
  const locked = vehicle.status === "CHECK_IN_LOCKED";
  const mine = insp && (ws.actor.role === "ADMIN" || insp.conductorId === ws.actor.id);
  const oos = vehicle.status === "OUT_OF_SERVICE";
  const pre = insp ? ws.checkIns.filter(k => k.vehicleId === vehicle.id && Date.parse(k.checkInTime) <= Date.parse(insp.startedAt)) : [];
  return <section className="tp-wrap fade-in" data-testid={`panel-vehicle-${vehicle.id}`}>
    <div className={`tp-hero ${locked ? "locked" : ""}`}>
      <div className="eyebrow" style={{ color: "inherit", opacity: .8 }}>Inspection</div>
      <h2 data-testid="text-inspection-status">{locked ? "TICKET INSPECTION IN PROGRESS" : oos ? "OUT OF SERVICE" : "CHECK-INS AVAILABLE"}</h2>
      <div style={{ fontSize: 13 }}>{locked ? "New check-ins for this vehicle are temporarily unavailable." : "Passengers can check in to this vehicle."}</div>
      <div className="tp-grid">
        <div>City<strong>{city?.name}</strong></div><div>Transport<strong>{line ? typeLabel[line.transportType] : ""}</strong></div>
        <div>Line<strong>{line?.number}</strong></div><div>Direction<strong>{line?.direction}</strong></div>
        <div>Vehicle<strong className="data">{vehicle.vehicleNumber}</strong></div><div>Current stop<strong>{vehicle.currentStopName}</strong></div>
        <div>Status<strong>{vehicle.status}</strong></div></div>
      <div style={{ fontSize: 12 }}>{vehicle.latitude !== null && vehicle.longitude !== null
        ? `Feed coordinates: ${vehicle.latitude.toFixed(5)}, ${vehicle.longitude.toFixed(5)}`
        : "No fresh vehicle coordinates supplied."}</div>
      {insp && <div style={{ fontSize: 12 }}>Started {fmtTime(insp.startedAt)} · {insp.numberOfPassengersAlreadyCheckedIn} already checked in · {insp.numberOfBlockedCheckInAttempts} blocked</div>}
    </div>
    {feedback && <div className="tp-banner tp-ok" role="status" data-testid="text-feedback">{feedback}</div>}
    {oos ? <div className="notice">This vehicle is out of service. Operations are unavailable.</div> :
      !insp && !locked ? <ConfirmButton label="Start ticket inspection" confirmLabel="Confirm start" testId="button-start-inspection" confirmId="button-confirm-start" disabled={c.busy} text={`Lock new check-ins on ${vehicle.vehicleNumber} only? Existing passengers stay valid.`}
        onConfirm={async () => { await c.start(vehicle.id); setFeedback(`Inspection started on ${vehicle.vehicleNumber}. New check-ins are locked.`); }} /> :
      insp && mine ? <ConfirmButton danger label="End ticket inspection" confirmLabel="Confirm end" testId="button-end-inspection" confirmId="button-confirm-end" disabled={c.busy} text="Reopen check-ins for this vehicle now?"
        onConfirm={async () => { await c.end(insp.id); setFeedback(`Inspection ended on ${vehicle.vehicleNumber}. Check-ins are available.`); }} /> :
      <div className="tp-banner tp-bad" data-testid="text-owner-lock">Locked by another conductor. Only the owner or an Admin can end this inspection.</div>}
    {c.busy && <div className="tiny muted">Working...</div>}
    {insp && ws.actor.role !== "USER" && <div className="surface pad" data-testid="list-preinspection"><div className="tp-label">Checked in before inspection (anonymous)</div>
      {pre.length === 0 ? <div className="muted tiny">None.</div> : pre.map(k => <div className="tp-hist" key={k.id}><span className="data">Ref {k.id.slice(-6).toUpperCase()}</span><span className="muted">Checked in {fmtTime(k.checkInTime)} · <strong>VALID</strong></span></div>)}</div>}
  </section>;
}

export function InspectionRows({ catalog, rows, filterNote, linkBase = "/conductor/vehicles" }: { linkBase?: string; catalog: TransportCatalog; rows: InspectionSession[]; vehicles: TransportVehicle[]; filterNote?: string }) {
  return <div data-testid="list-history">{rows.length === 0 ? <div className="empty-state" data-testid="empty-history"><h2>No inspections</h2><p>{filterNote ?? "Inspections will appear here."}</p></div> :
    rows.map(i => { const l = lineOf(catalog, i.lineId), city = catalog.cities.find(x => x.id === i.cityId);
      return <article className="tp-hist" key={i.id} data-testid={`row-inspection-${i.id}`}>
        <div style={{ display: "flex", justifyContent: "space-between", gap: 8 }}><strong>{typeLabel[i.transportType]} {l?.number} to {l?.direction}</strong><span className={i.status === "ACTIVE" ? "tag tag-red" : "tag"}>{i.status}</span></div>
        <span className="muted">{city?.name} · Vehicle <span className="data">{i.vehicleId}</span></span>
        <span className="muted">{fmtTime(i.startedAt)} – {i.endedAt ? fmtTime(i.endedAt) : "now"} · {durationText(i.startedAt, i.endedAt)}</span>
        <span className="muted">{i.numberOfPassengersAlreadyCheckedIn} passengers before inspection · {i.numberOfBlockedCheckInAttempts} blocked attempts</span>
        {i.status === "ACTIVE" && <Link href={`${linkBase}?vehicle=${encodeURIComponent(i.vehicleId)}`} className="btn btn-secondary" style={{ justifySelf: "start" }} data-testid={`link-active-${i.id}`}>Open vehicle</Link>}
      </article>; })}</div>;
}
