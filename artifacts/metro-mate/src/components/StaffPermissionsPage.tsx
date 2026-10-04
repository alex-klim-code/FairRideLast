import { useEffect, useState } from "react";
import { getTransportStaff, setTransportStaff, type StaffPermission } from "@workspace/api-client-react";
import { transportError, verifiedRequestOptions } from "../services/transport-session";

export function StaffPermissionsPage() {
  const [rows, setRows] = useState<StaffPermission[]>([]);
  const [userId, setUserId] = useState("");
  const [role, setRole] = useState<StaffPermission["role"]>("CONDUCTOR");
  const [disabled, setDisabled] = useState(false), [busy, setBusy] = useState(false);
  const [error, setError] = useState(""), [notice, setNotice] = useState("");
  const load = async () => setRows(await getTransportStaff(verifiedRequestOptions));
  useEffect(() => { let disposed = false;
    const read = async () => { try { const r = await getTransportStaff(verifiedRequestOptions); if (!disposed) { setRows(r); setError(""); } }
      catch (e) { if (!disposed) { setRows([]); setError(transportError(e)); } } };
    void read(); const timer = setInterval(read, 5000);
    return () => { disposed = true; clearInterval(timer); };
  }, []);
  return <section className="surface pad">
    <div className="eyebrow">VERIFIED ADMIN ONLY</div><h1>Staff permissions</h1>
    <p>Accounts start as Passenger. Assign staff access only after checking employment. Use the exact Clerk user ID, not an email or display name.</p>
    {error && <div className="notice" role="alert">{error}</div>}{notice && <div className="notice" role="status">{notice}</div>}
    <form onSubmit={async e => { e.preventDefault(); if (busy) return; setBusy(true); setError(""); setNotice("");
      try { await setTransportStaff(userId.trim(), { role, disabled }, verifiedRequestOptions); await load(); setNotice("Permission saved. It applies to the next server request."); }
      catch (e) { setError(transportError(e)); } finally { setBusy(false); } }}>
      <label className="field">Clerk user ID<input required pattern="user_[A-Za-z0-9]+" value={userId} onChange={e => setUserId(e.target.value)} data-testid="input-staff-id" /></label>
      <label className="field">Permission<select value={role} onChange={e => setRole(e.target.value as StaffPermission["role"])} data-testid="select-staff-role">
        <option value="USER">Passenger (revoke staff role)</option><option value="CONDUCTOR">Conductor</option><option value="ADMIN">Admin</option>
      </select></label>
      <label><input type="checkbox" checked={disabled} onChange={e => setDisabled(e.target.checked)} data-testid="checkbox-staff-disabled" /> Suspend all transport access</label>
      <p><button className="btn" disabled={busy} data-testid="button-save-staff">Save permission</button></p>
    </form>
    <div className="table-wrap"><table className="table"><thead><tr><th>Account</th><th>Permission</th><th>Status</th><th /></tr></thead>
      <tbody>{rows.map(row => <tr key={row.userId}><td>{row.userId}</td><td>{row.role}</td><td>{row.disabled ? "Suspended" : "Active"}</td><td>
        <button className="btn btn-secondary" onClick={() => { setUserId(row.userId); setRole(row.role); setDisabled(row.disabled); }}>Edit</button>
      </td></tr>)}</tbody></table></div>
    <p className="tiny muted">Role changes do not change ownership of existing history. Admins can end inspections left active by a revoked conductor. The last active Admin cannot be removed.</p>
  </section>;
}