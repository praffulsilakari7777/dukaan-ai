import { Package, Search } from 'lucide-react';
import { useState } from 'react';
import { fmtQty, inr } from '../lib/ledger';
import { useStore } from '../lib/store';

export function Stock({ openAdd }: { openAdd: () => void }) {
  const { ledger, t } = useStore();
  const [q, setQ] = useState('');
  const list = ledger.stock.filter((s) => s.name.toLowerCase().includes(q.trim().toLowerCase()));

  return (
    <div className="screen">
      <header className="page-head">
        <h1>{t.stock}</h1>
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

      {ledger.stock.length > 6 && (
        <label className="search">
          <Search size={18} />
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search items" aria-label="Search items" />
        </label>
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
                          {out ? t.out : s.low ? `${t.low} · ${Math.max(Math.round(s.daysLeft), 0)}d` : s.daily ? 'Daily' : Number.isFinite(s.daysLeft) ? `${Math.round(s.daysLeft)} ${t.daysLeft}` : t.ok}
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
