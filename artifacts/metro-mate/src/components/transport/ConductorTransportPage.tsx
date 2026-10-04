import { useState } from "react";
import { Link, useSearch } from "wouter";
import { useTransportWorkspace } from "../../hooks/use-transport-workspace";
import { Gate, InspectionRows, ProviderNotice, VehicleOps, VehiclePicker } from "./shared";

export function ConductorTransportPage() {
  const c = useTransportWorkspace("CONDUCTOR");
  const param = new URLSearchParams(useSearch()).get("vehicle") ?? "";
  const [picked, setPicked] = useState({ param, id: param });
  const [feedback, setFeedback] = useState("");
  // A deep link initializes selection, but must not restore an old vehicle
  // when the user deliberately resets a parent city/type/line selection.
  const id = picked.param === param ? picked.id : param;
  return <>
    <div className="page-heading"><div><div className="eyebrow">CONDUCTOR TOOLS</div><h1>Vehicle check-in</h1><p className="subheading">Find your physical vehicle and pause new check-ins. Existing journeys stay valid.</p></div>
      <Link href="/conductor/inspection" className="btn btn-secondary" data-testid="link-history">Inspection history</Link></div>
    <Gate c={c}>{({ catalog, ws }) => { const v = ws.vehicles.find(x => x.id === id);
      const active = ws.inspections.filter(i => i.status === "ACTIVE");
      return <div className="tp-wrap">
        <ProviderNotice catalog={catalog} />
        {active.length > 0 && <section className="surface pad"><div className="eyebrow">Active inspections</div><InspectionRows catalog={catalog} rows={active} vehicles={ws.vehicles} /></section>}
        <div className="grid two-col"><section className="surface pad"><VehiclePicker key={param} catalog={catalog} vehicles={ws.vehicles} value={id} onSelect={x => { setPicked({ param, id: x?.id ?? "" }); setFeedback(""); }} /></section>
          <div>{v ? <VehicleOps c={c} catalog={catalog} ws={ws} vehicle={v} feedback={feedback} setFeedback={setFeedback} /> : <section className="surface pad empty-state" data-testid="empty-selection"><h2>No vehicle selected</h2><p>Choose city, type, line, then the vehicle.</p></section>}</div></div>
      </div>; }}</Gate></>;
}
