import { useCallback, useEffect, useRef, useState } from "react";
import { getTransportCatalog, getTransportWorkspace, startVehicleInspection, endVehicleInspection,
  createVehicleCheckIn, checkOutVehicle, type TransportCatalog, type TransportWorkspace } from "@workspace/api-client-react";
import { ensureDemoTransportRole, demoRequestOptions, verifiedRequestOptions, transportError, type DemoRole } from "../services/transport-session";
import { useTransportMode } from "../services/transport-mode";

export function useTransportWorkspace(role: DemoRole) {
  const mode = useTransportMode();
  const options = mode === "demo" ? demoRequestOptions : verifiedRequestOptions;
  const [catalog, setCatalog] = useState<TransportCatalog | null>(null);
  const [workspace, setWorkspace] = useState<TransportWorkspace | null>(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const mounted = useRef(false), pending = useRef(false);
  const read = useCallback(async () => {
    const [state, data] = await Promise.all([getTransportWorkspace(options), getTransportCatalog(options)]);
    if (state.actor.role !== role) throw new Error("Demo session or account role changed. Reopen your view.");
    if (mounted.current) { setWorkspace(state); setCatalog(data); setError(""); }
    return state;
  }, [role, options]);
  const refresh = useCallback(async () => {
    try {
      // Explicit refresh also recovers a failed bootstrap/catalog/session.
      if (mode === "demo") await ensureDemoTransportRole(role);
      return await read();
    }
    catch (e) {
      if (mounted.current) { setWorkspace(null); setError(transportError(e)); }
      throw e;
    }
  }, [read, role, mode]);
  useEffect(() => {
    mounted.current = true;
    let disposed = false, polling = false;
    setWorkspace(null); setCatalog(null); setLoading(true);
    const boot = async () => {
      try {
        await refresh();
      } catch (e) { if (!disposed) setError(transportError(e)); }
      finally { if (!disposed) setLoading(false); }
    };
    void boot();
    const interval = setInterval(async () => {
      if (disposed || polling || pending.current) return;
      polling = true;
      try { await read(); }
      catch (e) { if (!disposed) { setWorkspace(null); setError(transportError(e)); } }
      finally { polling = false; }
    }, 3000);
    return () => { disposed = true; mounted.current = false; clearInterval(interval); };
  }, [role, refresh, read]);
  const mutate = async (operation: () => Promise<unknown>) => {
    if (pending.current) throw new Error("An operation is already in progress.");
    pending.current = true; setBusy(true); setError("");
    try { await operation(); await read(); }
    catch (e) {
      if (mounted.current) setError(transportError(e));
      // Rejections such as HTTP 423 still change shared blocked-attempt counters.
      try { await read(); } catch { if (mounted.current) setWorkspace(null); }
      if (mounted.current) setError(transportError(e));
      throw new Error(transportError(e));
    } finally { pending.current = false; if (mounted.current) setBusy(false); }
  };
  return { catalog, workspace, error, loading, busy, refresh,
    mode,
    start: (vehicleId: string) => mutate(() => startVehicleInspection(vehicleId, { requestId: crypto.randomUUID() }, options)),
    end: (inspectionId: string) => mutate(() => endVehicleInspection(inspectionId, options)),
    checkIn: (vehicleId: string) => mutate(() => createVehicleCheckIn({ vehicleId, requestId: crypto.randomUUID() }, options)),
    checkOut: (checkInId: string) => mutate(() => checkOutVehicle(checkInId, options)),
  };
}
export type TransportController = ReturnType<typeof useTransportWorkspace>;