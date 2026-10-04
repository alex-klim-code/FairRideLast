import { Link } from "wouter";
import { useTransportWorkspace } from "../../hooks/use-transport-workspace";
import { Gate, InspectionRows, ProviderNotice } from "./shared";

export function InspectionHistoryPage() {
  const c = useTransportWorkspace("CONDUCTOR");
  return <>
    <div className="page-heading"><div><div className="eyebrow">CONDUCTOR TOOLS</div><h1>Recent inspections</h1></div><Link href="/conductor/vehicles" className="btn btn-secondary" data-testid="link-vehicles">Vehicles</Link></div>
    <Gate c={c}>{({ catalog, ws }) => <div className="tp-wrap"><ProviderNotice catalog={catalog} />
      <section className="surface pad"><InspectionRows catalog={catalog} vehicles={ws.vehicles} rows={ws.inspections.filter(i => i.conductorId === ws.actor.id).sort((a, b) => Date.parse(b.startedAt) - Date.parse(a.startedAt))} /></section></div>}</Gate></>;
}
