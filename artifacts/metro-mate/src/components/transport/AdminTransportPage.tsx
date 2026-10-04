import { useMemo, useState } from "react";
import { useTransportWorkspace } from "../../hooks/use-transport-workspace";
import { Gate, InspectionRows, ProviderNotice, Tag, VehicleOps, VehiclePicker, durationText, lineOf, typeLabel, warsawDay } from "./shared";

export function AdminTransportPage({ fleetOnly }: { fleetOnly?: boolean }) {
  const c = useTransportWorkspace("ADMIN");
  const [city, setCity] = useState(""), [type, setType] = useState(""), [line, setLine] = useState("");
  const [day, setDay] = useState(() => warsawDay(Date.now()));
  const [sel, setSel] = useState(() => new URLSearchParams(window.location.search).get("vehicle") ?? ""), [fb, setFb] = useState("");
  const data = useMemo(() => {
    if (!c.catalog || !c.workspace) return null;
    const { catalog, workspace: ws } = c;
    const lineOk = (id: string) => { const l = lineOf(catalog, id); return !!l && (!city || l.cityId === city) && (!type || l.transportType === type) && (!line || l.id === line); };
    const vehicles = ws.vehicles.filter(v => lineOk(v.lineId));
    const insp = ws.inspections.filter(i => lineOk(i.lineId) && (!day || warsawDay(i.startedAt) === day));
    const fin = insp.filter(i => i.status === "FINISHED" && i.endedAt);
    const avg = fin.length ? fin.reduce((s, i) => s + (Date.parse(i.endedAt!) - Date.parse(i.startedAt)), 0) / fin.length / 1000 : null;
    return { vehicles, insp, avg, cities: catalog.cities.filter(x => x.isActive && (!city || x.id === city)).length,
      active: vehicles.filter(v => v.status === "ACTIVE").length, locked: vehicles.filter(v => v.status === "CHECK_IN_LOCKED").length,
      blocked: insp.reduce((s, i) => s + i.numberOfBlockedCheckInAttempts, 0), pre: insp.reduce((s, i) => s + i.numberOfPassengersAlreadyCheckedIn, 0) };
  }, [c.catalog, c.workspace, city, type, line, day]);
  return <>
    <div className="page-heading"><div><div className="eyebrow">ADMIN</div><h1>{fleetOnly ? "Fleet" : "Transport overview"}</h1></div></div>
    <Gate c={c}>{({ catalog, ws }) => { const d = data!; const cityObj = catalog.cities.find(x => x.id === city);
      const v = ws.vehicles.find(x => x.id === sel);
      const lines = catalog.lines.filter(l => (!city || l.cityId === city) && (!type || l.transportType === type));
      return <div className="tp-wrap"><ProviderNotice catalog={catalog} />
        <section className="surface pad"><div className="tp-filters">
          <label className="field">City<select value={city} onChange={e => { setCity(e.target.value); setType(""); setLine(""); }} data-testid="filter-city"><option value="">All cities</option>{catalog.cities.filter(x => x.isActive).map(x => <option key={x.id} value={x.id}>{x.name}</option>)}</select></label>
          <label className="field">Transport type<select value={type} onChange={e => { setType(e.target.value); setLine(""); }} data-testid="filter-type"><option value="">All types</option>{(cityObj ? cityObj.availableTransportTypes : Object.keys(typeLabel)).map(t => <option key={t} value={t}>{typeLabel[t]}</option>)}</select></label>
          <label className="field">Line<select value={line} onChange={e => setLine(e.target.value)} data-testid="filter-line"><option value="">All lines</option>{lines.map(l => <option key={l.id} value={l.id}>{l.number} to {l.direction}</option>)}</select></label>
          <label className="field">Date (Europe/Warsaw)<input type="date" value={day} onChange={e => setDay(e.target.value)} data-testid="filter-date" /></label></div></section>
        {!fleetOnly && <div className="tp-stats" data-testid="admin-metrics">{([["Cities", d.cities], ["Active vehicles", d.active], ["Under inspection", d.locked], ["Inspections on day", d.insp.length], ["Average duration", d.avg === null ? "none finished" : (() => { const t = Math.round(d.avg); return `${Math.floor(t / 60)}m ${String(t % 60).padStart(2, "0")}s`; })()], ["Blocked attempts", d.blocked], ["Checked in before inspection", d.pre]] as [string, string | number][]).map(([k, val]) =>
          <div className="surface stat" key={k} data-testid={`metric-${k.toLowerCase().replace(/\W+/g, "-")}`}><div className="stat-label">{k}</div><div className="stat-value">{val}</div></div>)}</div>}
        <div className="grid two-col"><section className="surface pad"><div className="eyebrow">Fleet ({d.vehicles.length})</div>
          {d.vehicles.length === 0 ? <div className="empty-state" data-testid="empty-fleet">No vehicles match.</div> : d.vehicles.map(x => { const l = lineOf(catalog, x.lineId);
            return <button type="button" key={x.id} className="tp-row" style={{ marginTop: 8 }} aria-pressed={x.id === sel} onClick={() => { setSel(x.id); setFb(""); }} data-testid={`button-vehicle-${x.id}`}>
              <span className="tp-row-main"><strong className="data">{x.vehicleNumber}</strong><small>{typeLabel[l?.transportType ?? ""]} {l?.number} to {l?.direction} · {x.currentStopName}</small></span><Tag status={x.status} /></button>; })}</section>
          <div>{v ? <VehicleOps c={c} catalog={catalog} ws={ws} vehicle={v} feedback={fb} setFeedback={setFb} /> : <section className="surface pad"><div className="tp-label">Start by pointing to a vehicle</div><VehiclePicker catalog={catalog} vehicles={ws.vehicles} value={sel} onSelect={x => { setSel(x?.id ?? ""); setFb(""); }} /></section>}</div></div>
        {!fleetOnly && <section className="surface pad"><div className="eyebrow">Inspection history</div><InspectionRows linkBase="/admin/vehicles" catalog={catalog} vehicles={ws.vehicles} filterNote="Nothing matches these filters." rows={[...d.insp].sort((a, b) => Date.parse(b.startedAt) - Date.parse(a.startedAt))} />
          {d.insp.length > 0 && <div className="tiny muted">Latest duration: {durationText(d.insp[0].startedAt, d.insp[0].endedAt)}</div>}</section>}
      </div>; }}</Gate></>;
}
