import { useState } from 'react';
import { Link } from 'wouter';
import { LogOut, Receipt, Wallet } from 'lucide-react';
import { discountOptions, discountNotice, type DiscountId } from '../../services/fare-policy-exports';
import type { PassengerAccountController } from '../../hooks/use-passenger-account';
import { Avatar } from './Avatar';

const MAX_CHARS = 400000;
async function processImage(file: File): Promise<string> {
  if (!['image/jpeg', 'image/png', 'image/webp'].includes(file.type)) throw new Error('Use a JPG, PNG or WebP image.');
  if (file.size > 5 * 1024 * 1024) throw new Error('Image is larger than 5 MB.');
  const url = URL.createObjectURL(file);
  try {
    const img = await new Promise<HTMLImageElement>((ok, bad) => { const i = new Image(); i.onload = () => ok(i); i.onerror = () => bad(new Error('This image is corrupt or unreadable.')); i.src = url; });
    const size = 360, canvas = document.createElement('canvas'); canvas.width = size; canvas.height = size;
    const ctx = canvas.getContext('2d'); if (!ctx || !img.width || !img.height) throw new Error('This image cannot be processed.');
    const s = Math.min(img.width, img.height);
    ctx.drawImage(img, (img.width - s) / 2, (img.height - s) / 2, s, s, 0, 0, size, size);
    for (const q of [0.85, 0.7, 0.55, 0.4]) { const out = canvas.toDataURL('image/jpeg', q); if (out.length <= MAX_CHARS) return out; }
    throw new Error('Image is still too large after resizing.');
  } finally { URL.revokeObjectURL(url); }
}

export function ProfilePage({ controller, onSignOut }: { controller: PassengerAccountController; onSignOut: () => void }) {
  const saved = controller.account!.profile;
  const [form, setForm] = useState({ ...saved });
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const set = (k: string, v: string | null) => setForm(f => ({ ...f, [k]: v }));
  const upload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]; e.target.value = ''; if (!file) return;
    try { set('photo', await processImage(file)); setMsg(null); } catch (err) { setMsg({ ok: false, text: err instanceof Error ? err.message : 'Upload failed.' }); }
  };
  const save = async (e: React.FormEvent) => {
    e.preventDefault(); setMsg(null);
    try { await controller.saveProfile(form); setMsg({ ok: true, text: 'Profile saved on this device.' }); }
    catch (err) { setMsg({ ok: false, text: err instanceof Error ? err.message : 'Save failed.' }); }
  };
  const fields: [string, string][] = [['firstName', 'First name'], ['lastName', 'Last name'], ['email', 'Email'], ['phone', 'Phone']];
  return <>
    <section className="surface pz-profile-menu" aria-label="Profile options" data-testid="profile-options">
      <Link href="/user/bills" className="btn btn-secondary" data-testid="link-nav-bills"><Wallet size={20} /> Bills</Link>
      <Link href="/prices" className="btn btn-secondary" data-testid="link-nav-prices"><Receipt size={20} /> Prices</Link>
    </section>
    <form className="surface pad" aria-label="Passenger profile" onSubmit={save}>
      <div style={{ display: 'flex', gap: 16, alignItems: 'center', marginBottom: 18, flexWrap: 'wrap' }}>
        <Avatar profile={form} big />
        <label className="btn btn-secondary" style={{ cursor: 'pointer' }}>Upload photo<input type="file" accept="image/jpeg,image/png,image/webp" onChange={upload} hidden data-testid="input-profile-photo" /></label>
        {form.photo && <button type="button" className="btn btn-quiet" onClick={() => set('photo', null)}>Remove photo</button>}
      </div>
      <p className="tiny muted">Stored only in this browser. Photos are resized on your device and never uploaded.</p>
      <div className="form-grid">{fields.map(([k, l]) => <label className="field" key={k}>{l}<input value={(form as any)[k] ?? ''} onChange={e => set(k, e.target.value)} data-testid={`input-profile-${k}`} /></label>)}</div>
      <h2 style={{ marginTop: 24 }}>Eligibility category</h2>
      <div className="notice" style={{ marginBottom: 12 }}>{discountNotice}</div>
      <div className="grid" role="radiogroup" aria-label="Eligibility category">{discountOptions.map(o => <button type="button" role="radio" aria-checked={form.discountId === o.id} key={o.id} className={`pz-opt ${form.discountId === o.id ? 'on' : ''}`} style={{ textAlign: 'left' }} onClick={() => set('discountId', o.id as DiscountId)}>
        {o.label} · {o.percent}% off<br /><span style={{ fontWeight: 500, fontSize: 11 }}>{o.eligibility}</span></button>)}</div>
      {msg && <div className={msg.ok ? 'pz-ok' : 'pz-alert'} role={msg.ok ? 'status' : 'alert'} style={{ marginTop: 14 }}>{msg.text}</div>}
      <button className="btn" type="submit" disabled={controller.busy} style={{ marginTop: 16 }} data-testid="button-save-profile">Save profile</button>
    </form>
    <section className="surface pz-profile-settings" aria-label="Account options">
      <div className="pz-profile-legal"><Link href="/privacy">Privacy</Link><Link href="/terms">Terms</Link></div>
      <button type="button" className="btn btn-secondary" onClick={onSignOut} data-testid="button-sign-out"><LogOut size={17} /> Sign out</button>
    </section>
  </>;
}
