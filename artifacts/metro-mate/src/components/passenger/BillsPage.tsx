import { useRef, useState } from 'react';
import { Navigation, X } from 'lucide-react';
import { moneyText } from '../../services/passenger-account';
import { parseRefillAmount, type RefillMethod } from '../../services/passenger-account';
import type { PassengerAccountController } from '../../hooks/use-passenger-account';

const presets = ['10', '20', '50', '100'];
const methods: { id: RefillMethod; label: string }[] = [{ id: 'blik', label: 'BLIK' }, { id: 'google_pay', label: 'Google Pay' }, { id: 'apple_pay', label: 'Apple Pay' }];
const methodName = (m?: string) => methods.find(x => x.id === m)?.label ?? '';

export function BillsPage({ controller }: { controller: PassengerAccountController }) {
  const account = controller.account!;
  const [amount, setAmount] = useState('20');
  const [method, setMethod] = useState<RefillMethod>('blik');
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const refillRef = useRef<HTMLButtonElement>(null);
  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (controller.busy) return;
    setMsg(null);
    try {
      const cents = parseRefillAmount(amount);
      await controller.refill(cents, method, crypto.randomUUID());
      setMsg({ ok: true, text: `Refill of ${moneyText(cents)} added to your wallet.` });
    } catch (err) { setMsg({ ok: false, text: err instanceof Error ? err.message : 'Refill failed.' }); }
  };
  return <>
    <div className="grid two-col">
      <div className="grid">
        <section className="pz-card" aria-label="FairRide card" data-testid="card-wallet">
          <div style={{ display: 'flex', justifyContent: 'space-between', position: 'relative', zIndex: 1 }}>
            <span className="brand" style={{ color: '#f7f2e8', fontSize: 17 }}><span className="brand-mark" style={{ background: '#e6b65e', color: '#1c5947', width: 28, height: 28 }}><Navigation size={15} /></span>FairRide</span>
            <span className="pz-chip" />
          </div>
          <div style={{ position: 'relative', zIndex: 1 }}><div className="eyebrow" style={{ color: '#a9cdb8' }}>Balance</div><div className="bal" data-testid="text-balance">{moneyText(account.balanceCents)}</div></div>
          <div className="tiny" style={{ color: '#b9d0c2', position: 'relative', zIndex: 1 }}>{account.profile.firstName} {account.profile.lastName}</div>
        </section>
        <form className="surface pad" aria-label="Wallet refill" onSubmit={submit}>
          <h2>Top up</h2>
          <div className="eyebrow" style={{ marginBottom: 8 }}>Amount (PLN)</div>
          <div className="pz-presets">{presets.map(p => <button type="button" key={p} className="pz-opt" aria-pressed={amount === p} onClick={() => setAmount(p)}>{p} zł</button>)}</div>
          <label className="field" style={{ margin: '14px 0' }}>Custom amount
            <input inputMode="decimal" value={amount} onChange={e => setAmount(e.target.value)} data-testid="input-refill-amount" />
          </label>
          <div className="eyebrow" style={{ marginBottom: 8 }}>Method</div>
          <div className="pz-methods" role="radiogroup" aria-label="Refill method">{methods.map(m => <button type="button" role="radio" aria-checked={method === m.id} key={m.id} className={`pz-opt ${method === m.id ? 'on' : ''}`} onClick={() => setMethod(m.id)}>{m.label}</button>)}</div>
          {msg && <div className={`${msg.ok ? 'pz-ok' : 'pz-alert'} pz-dismissible-message`} role={msg.ok ? 'status' : 'alert'} style={{ marginTop: 14 }}>
            <span>{msg.text}</span><button type="button" className="pz-dismiss" onClick={() => { setMsg(null); refillRef.current?.focus({ preventScroll: true }); }}
              aria-label="Zamknij komunikat doładowania portfela" data-testid="button-close-refill-message"><X size={17} aria-hidden="true" /></button>
          </div>}
          <button ref={refillRef} className="btn" type="submit" disabled={controller.busy} style={{ marginTop: 16 }} data-testid="button-refill">Refill My Wallet</button>
        </form>
      </div>
      <section className="surface pad"><h2>Ledger</h2>
        {account.transactions.length === 0 ? <p className="subheading">No transactions yet. Refills, ride charges and legacy ticket purchases appear here.</p> :
          <ul className="pz-ledger">{account.transactions.map(tx => <li key={tx.id}>
            <span>{tx.kind === 'refill' ? `Refill · ${methodName(tx.method)}` : (tx.ticketId ? `Legacy ticket ${tx.ticketId}` : 'Ride charge')}<br /><span className="tiny muted">{new Date(tx.createdAt).toLocaleString('en-GB')}</span></span>
            <strong className={`data ${tx.kind === 'refill' ? 'pos' : 'neg'}`}>{tx.kind === 'refill' ? '+' : '−'}{moneyText(tx.amountCents)}</strong></li>)}</ul>}
      </section>
    </div>
  </>;
}
