import { ChevronRight, Package, Search, Tag } from 'lucide-react';
import type { Tab } from '../App';
import { offerCandidates } from '../lib/offers';
import { tf } from '../lib/i18n';
import { useState } from 'react';
import { fmtQty, inr } from '../lib/ledger';
import { useStore } from '../lib/store';
import { useWide } from '../lib/useWide';

export function Stock({ openAdd, go }: { openAdd: () => void; go: (t: Tab) => void }) {
  const { ledger, t } = useStore();
  const wide = useWide();
  const [q, setQ] = useState('');
  const risk = offerCandidates(ledger);
  const riskValue = risk.reduce((s, c) => s + c.atRiskValue, 0);
  const list = ledger.stock.filter((s) => s.name.toLowerCase().includes(q.trim().toLowerCase()));

  return (
    <div className="screen">
      <header className="page-head">
        <h1 className="only-narrow">{t.stock}</h1>
        <div className="lead">
          <span className="big num">{inr(ledger.stockValue)}</span>
          <span className="cap">
            {t.stockValue} · {ledger.stock.length} {t.items}
            {ledger.lowCount > 0 && (
              <>
                {' · '}
                <b style={{ color: 'var(--bad)' }}>
                  {ledger.lowCount} {t.low.toLowerCase()}
                </b>
              </>
            )}
          </span>
        </div>
      </header>

      {risk.length > 0 && (
        <div className="constrain">
          <button className="risk-banner" onClick={() => go('offers')}>
            <span className="risk-ic">
              <Tag size={18} />
            </span>
            <span className="risk-txt">
              <b className="num">{tf(t.stockAtRisk, { amt: inr(riskValue) })}</b>
              <span>
                {risk
                  .slice(0, 3)
                  .map((c) => c.item)
                  .join(', ')}
                {risk.length > 3 ? ` +${risk.length - 3}` : ''} · {t.riskSub}
              </span>
            </span>
            <ChevronRight size={18} />
          </button>
        </div>
      )}

      {ledger.stock.length > 6 && (
        <div className="constrain">
        <label className="search">
          <Search size={18} />
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder={t.searchItems} aria-label={t.searchItems} />
        </label>
        </div>
      )}

      <div className="section" style={{ marginTop: 0 }}>
        <div className="card">
          {ledger.stock.length === 0 ? (
            <div className="empty">
              <div className="ic">
                <Package size={26} />
              </div>
              <b>{t.noStock}</b>
              {t.noStockHint}
              <div style={{ marginTop: 14 }}>
                <button className="btn primary" onClick={openAdd}>
                  {t.scanBill}
                </button>
              </div>
            </div>
          ) : list.length === 0 ? (
            <div className="empty">No item matches “{q}”.</div>
          ) : wide ? (
            <table className="table">
              <thead>
                <tr>
                  <th>Item</th>
                  <th className="r">{t.stock}</th>
                  <th>Cover</th>
                  <th className="r">{t.avgCost}</th>
                  <th className="r">{t.sells}</th>
                  <th className="r">{t.margin}</th>
                  <th className="r">{t.stockValue}</th>
                  <th className="r">Status</th>
                </tr>
              </thead>
              <tbody>
                {list.map((s) => {
                  const out = s.qty <= 0;
                  const days = s.daily || !Number.isFinite(s.daysLeft) ? 14 : s.daysLeft;
                  const margin = s.lastPrice > 0 && s.avgCost > 0 ? ((s.lastPrice - s.avgCost) / s.lastPrice) * 100 : null;
                  return (
                    <tr key={s.key}>
                      <td>
                        <b>{s.name}</b>
                      </td>
                      <td className="r num" style={{ color: s.low ? 'var(--bad)' : undefined, fontWeight: 700 }}>
                        {fmtQty(Math.max(s.qty, 0), s.unit)}
                      </td>
                      <td style={{ width: 150 }}>
                        <div className="meter" style={{ marginTop: 0 }} aria-hidden>
                          <i className={s.low ? 'low' : days < 7 ? 'mid' : ''} style={{ width: `${Math.max(Math.min(days / 14, 1) * 100, out ? 0 : 4)}%` }} />
                        </div>
                      </td>
                      <td className="r num">{s.avgCost > 0 ? `${inr(s.avgCost)}/${s.unit}` : '—'}</td>
                      <td className="r num">{s.lastPrice > 0 ? inr(s.lastPrice) : '—'}</td>
                      <td className="r num">{margin != null ? `${Math.round(margin)}%` : '—'}</td>
                      <td className="r num">{inr(s.value)}</td>
                      <td className="r">
                        <span className={`pill ${out || s.low ? 'bad' : 'good'}`}>
                          {out ? t.out : s.low ? `${t.low} · ${Math.max(Math.round(s.daysLeft), 0)}d` : s.daily ? t.daily : Number.isFinite(s.daysLeft) ? `${Math.round(s.daysLeft)} ${t.daysLeft}` : t.ok}
                        </span>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          ) : (
            <ul className="rows">
              {list.map((s) => {
                const out = s.qty <= 0;
                const days = s.daily || !Number.isFinite(s.daysLeft) ? 14 : s.daysLeft;
                const pct = Math.min(days / 14, 1) * 100;
                return (
                  <li key={s.key} className="row" style={{ alignItems: 'flex-start' }}>
                    <div className="main">
                      <div className="t">{s.name}</div>
                      <div className="s num">
                        {s.avgCost > 0 ? `${t.avgCost} ${inr(s.avgCost)}/${s.unit}` : 'cost unknown'}
                        {s.lastPrice > 0 && ` · ${t.sells} ${inr(s.lastPrice)}`}
                      </div>
                      <div className="meter" aria-hidden>
                        <i className={s.low ? 'low' : days < 7 ? 'mid' : ''} style={{ width: `${Math.max(pct, out ? 0 : 4)}%` }} />
                      </div>
                    </div>
                    <div style={{ textAlign: 'right', flex: 'none' }}>
                      <div className="amt num" style={{ color: s.low ? 'var(--bad)' : undefined }}>
                        {fmtQty(Math.max(s.qty, 0), s.unit)}
                      </div>
                      <div style={{ marginTop: 4 }}>
                        <span className={`pill ${out ? 'bad' : s.low ? 'bad' : 'good'}`}>
                          {out ? t.out : s.low ? `${t.low} · ${Math.max(Math.round(s.daysLeft), 0)}d` : s.daily ? t.daily : Number.isFinite(s.daysLeft) ? `${Math.round(s.daysLeft)} ${t.daysLeft}` : t.ok}
                        </span>
                      </div>
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      </div>
    </div>
  );
}
