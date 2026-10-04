import { useState } from "react";
import { Link } from "wouter";
import { useTransportWorkspace } from "../../hooks/use-transport-workspace";
import { Gate, ProviderNotice, VehiclePicker, fmtDateTime, lineOf, typeLabel } from "./shared";

export function PassengerVehicleCheckInPage() {
  const c = useTransportWorkspace("USER");
  const [sel, setSel] = useState(""), [msg, setMsg] = useState("");
  return <>
    <div className="page-heading"><div><div className="eyebrow">CHECK-IN</div><h1>Vehicle check-in</h1><p className="subheading">Check in to your vehicle and view recent journeys.</p></div><Link href="/user/ticket" className="btn btn-secondary" data-testid="link-bilet">Bilet</Link></div>
    <Gate c={c}>{({ catalog, ws }) => { const own = ws.checkIns.find(k => k.status === "ACTIVE");
      const ownInsp = own ? ws.inspections.find(i => i.vehicleId === own.vehicleId && i.status === "ACTIVE") : undefined;
      const valid = !!own && !!ownInsp && Date.parse(own.checkInTime) < Date.parse(ownInsp.startedAt);
      const ownV = own && ws.vehicles.find(v => v.id === own.vehicleId);
      const v = ws.vehicles.find(x => x.id === sel);
      const locked = v?.status === "CHECK_IN_LOCKED";
      const past = ws.checkIns.filter(k => k.status === "CHECKED_OUT");
      return <div className="tp-wrap"><ProviderNotice catalog={catalog} />
        {own && <section className="tp-hero" data-testid="panel-active-checkin"><div className="eyebrow" style={{ color: "inherit" }}>Your active check-in</div><h2>{ownV?.vehicleNumber ?? own.vehicleId}</h2>
          <div style={{ fontSize: 13 }}>{(() => { const l = lineOf(catalog, own.lineId); return `${typeLabel[l?.transportType ?? ""] ?? ""} ${l?.number ?? ""} to ${l?.direction ?? ""}`; })()}</div>
          <div className="tp-grid"><div>Checked in<strong data-testid="text-checkin-time">{fmtDateTime(own.checkInTime)}</strong></div><div>Receipt<strong className="data">{own.id.slice(-8).toUpperCase()}</strong></div></div>
          {valid && <div className="tp-banner tp-ok" style={{ marginBottom: 12 }} data-testid="status-checkin-valid"><strong>VALID</strong> - your check-in was before the inspection started. Your existing check-in remains valid during inspection, and check-out is always allowed.</div>}
          <button type="button" className="btn tp-big tp-dark" disabled={c.busy} data-testid="button-checkout" onClick={async () => { try { await c.checkOut(own.id); setMsg("Checked out."); } catch { setMsg(""); } }}>Check out</button></section>}
        {msg && <div className="tp-banner tp-ok" role="status" data-testid="text-feedback">{msg}</div>}
        <div className="grid two-col"><section className="surface pad"><VehiclePicker catalog={catalog} vehicles={ws.vehicles} value={sel} onSelect={x => { setSel(x?.id ?? ""); setMsg(""); }} /></section>
          <section className="surface pad">{!v ? <div className="empty-state"><h2>Pick a vehicle</h2><p>Other vehicles stay available while one is locked.</p></div> : <div className="tp-wrap">
            <div><div className="tp-label">Selected</div><strong className="data">{v.vehicleNumber}</strong> <span className="muted">at {v.currentStopName}</span></div>
            <div className="tiny muted">{v.latitude !== null && v.longitude !== null
              ? `Feed coordinates: ${v.latitude.toFixed(5)}, ${v.longitude.toFixed(5)}`
              : "No fresh vehicle coordinates supplied."}</div>
            {v.status === "OUT_OF_SERVICE" && <div className="notice">No fresh active assignment is available for this vehicle. New check-ins are disabled.</div>}
            {locked && <div className="tp-banner tp-bad" data-testid="text-locked-notice"><strong>Ticket inspection in progress</strong><br />New check-ins temporarily unavailable</div>}
            {own ? <div className="notice">You already have an active check-in. Check out first.</div> :
              <button type="button" className="btn tp-big" disabled={c.busy || v.status === "OUT_OF_SERVICE"} data-testid="button-checkin" onClick={async () => { try { await c.checkIn(v.id); setMsg(`Checked in to ${v.vehicleNumber}.`); } catch { setMsg(""); } }}>{locked ? "Attempt check-in" : "Check in"}</button>}
            {locked && !own && <button type="button" className="btn btn-quiet" disabled={c.busy} data-testid="button-check-availability" onClick={() => { c.refresh().catch(() => undefined); }}>Check availability</button>}</div>}</section></div>
        <section className="surface pad"><div className="eyebrow">Check-out history</div>{past.length === 0 ? <div className="empty-state" data-testid="empty-checkouts">No completed check-ins.</div> :
          past.map(k => <div className="tp-hist" key={k.id} data-testid={`row-checkin-${k.id}`}><strong className="data">{ws.vehicles.find(x => x.id === k.vehicleId)?.vehicleNumber ?? k.vehicleId}</strong><span className="muted">In {fmtDateTime(k.checkInTime)} · Out {k.checkOutTime ? fmtDateTime(k.checkOutTime) : ""}</span></div>)}</section>
      </div>; }}</Gate></>;
}
