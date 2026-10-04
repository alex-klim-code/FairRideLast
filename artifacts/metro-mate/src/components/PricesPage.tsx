import { useEffect, useState } from 'react';
import { START_FEE, priceRows } from '../services/pricing';
import { discountOptions, discountFor, discountedCents, priceForDistance, moneyText, type DiscountId } from '../services/fare-policy-exports';

export function PricesPage({ defaultDiscountId = 'normal', embedded = false }: { defaultDiscountId?: DiscountId; embedded?: boolean }) {
  const [distance, setDistance] = useState('5');
  const [transport, setTransport] = useState('0');
  const [discountId, setDiscountId] = useState<DiscountId>(defaultDiscountId);
  useEffect(() => setDiscountId(defaultDiscountId), [defaultDiscountId]);
  const row = priceRows[Number(transport)]!;
  const kilometres = distance.trim() ? Number(distance) : NaN;
  const valid = Number.isFinite(kilometres) && kilometres >= 0 && kilometres <= 1000;
  const d = discountFor(discountId);
  const startCents = discountedCents(Math.round(START_FEE * 100), discountId);
  useEffect(() => {
    if (embedded) return undefined;
    const previous = document.title;
    document.title = 'Prices — FairRide';
    return () => { document.title = previous; };
  }, [embedded]);

  return <>
    <div className="grid two-col" aria-label="Cennik FairRide">
      <section className="surface pad" aria-label="Ceny przejazdów">
      <label className="field" style={{ marginBottom: 14 }}>Ulga w tabeli i kalkulatorze
        <select value={discountId} onChange={e => setDiscountId(e.target.value as DiscountId)} data-testid="select-price-discount">
          {discountOptions.map(o => <option key={o.id} value={o.id}>{o.label} ({o.percent}%)</option>)}
        </select>
      </label>
        <h2>Ceny przejazdów</h2>
        <p className="tiny muted">Własna taryfa FairRide, nie taryfa KMK: start + kilometry. Czas podróży nie wpływa na cenę.</p>
        <p className="subheading">Opłata startowa jest naliczana raz dla każdego odcinka transportem. Wybrana ulga: {d.label}, {d.percent}%.</p>
        <div className="table-wrap" style={{ marginTop: 16 }}>
          <table className="table prices-table" data-testid="table-prices">
            <thead><tr><th>Transport</th><th>Za start</th><th>Za kilometr</th></tr></thead>
            <tbody>{priceRows.map(item => <tr key={item.name}>
              <td>{item.name}</td><td>{moneyText(startCents)}</td><td>{moneyText(discountedCents(Math.round(item.rate * 100), discountId))} / km</td>
            </tr>)}</tbody>
          </table>
        </div>
        <div className="notice" style={{ marginTop: 19 }}>
          Przesiadka i nowy odcinek transportem oznaczają kolejną opłatę startową. Dojście pieszo jest bezpłatne.
        </div>
      </section>
      <section className="surface pad">
        <div className="eyebrow">OBLICZ KOSZT</div><h2 style={{ marginTop: 8 }}>Kalkulator przejazdu</h2>
        <div className="grid" style={{ marginTop: 20 }}>
          <label className="field">Środek transportu
            <select value={transport} onChange={event => setTransport(event.target.value)} data-testid="select-price-transport">
              {priceRows.map((item, index) => <option key={item.name} value={index}>{item.name}</option>)}
            </select>
          </label>
          <label className="field">Dystans (km)
            <input type="number" min="0" max="1000" step="0.1" inputMode="decimal" value={distance}
              onChange={event => setDistance(event.target.value)} data-testid="input-price-distance"/>
          </label>
        </div>
        <div className="stat-value" style={{ marginTop: 25 }} aria-live="polite" data-testid="text-price-total">
          {valid ? moneyText(priceForDistance(kilometres, row.rate, discountId)) : '—'}
        </div>
        <p className="tiny muted">{valid
          ? `${moneyText(startCents)} start + ${kilometres} km × ${moneyText(discountedCents(Math.round(row.rate * 100), discountId))} / km (ulga ${d.percent}%)`
          : 'Wpisz dystans od 0 do 1000 km.'}</p>
        <p className="tiny muted" style={{ lineHeight: 1.6, marginTop: 20 }}>
          Wybór ulgi tutaj nie zmienia Twojego profilu. To taryfa FairRide, nie oficjalny cennik MPK ani innych przewoźników.
        </p>
      </section>
    </div>
  </>;
}
