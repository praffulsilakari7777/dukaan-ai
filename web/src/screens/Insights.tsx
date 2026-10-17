import { Lightbulb, PackagePlus, RefreshCw, Sparkles, Tag, TrendingUp } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { Sheet, WaCard } from '../components/ui';
import { TOOLS, type WaDraft } from '../lib/agent';
import { insights, OfflineError, type InsightResult } from '../lib/api';
import { fmtQty, inr, type Ledger } from '../lib/ledger';
import { useStore } from '../lib/store';
import type { Tab } from '../App';

function insightSummary(ledger: Ledger, shop: string) {
  const items = [...ledger.stock].filter((s) => s.sold7 > 0).sort((a, b) => b.profit7 - a.profit7);
  return {
    shop,
    dukaan_score: ledger.score.value,
    score_parts: ledger.score.parts.map((p) => ({ factor: p.label, weight: `${p.weight * 100}%`, achieved: `${Math.round(p.value * 100)}%` })),
    eligible_loan: ledger.score.loan,
    week_sales: Math.round(ledger.days.reduce((s, d) => s + d.sales, 0)),
    week_profit: Math.round(ledger.days.reduce((s, d) => s + d.profit, 0)),
    top_profit_items: items.slice(0, 4).map((s) => ({ item: s.name, profit_7d: Math.round(s.profit7), margin: s.sold7 ? `${Math.round((s.profit7 / s.sold7) * 100)}%` : '?' })),
    low_margin_items: [...items].sort((a, b) => a.profit7 / a.sold7 - b.profit7 / b.sold7).slice(0, 3).map((s) => ({ item: s.name, margin: `${Math.round((s.profit7 / s.sold7) * 100)}%` })),
    running_low: ledger.stock.filter((s) => s.low).map((s) => s.name),
    slow_movers: ledger.stock.filter((s) => s.qty > 0 && s.velocity < 0.6).map((s) => ({ item: s.name, qty: fmtQty(s.qty, s.unit) })),
    udhaar_total: ledger.totalDue,
    udhaar_customers: ledger.customers.filter((c) => c.due > 0).length,
  };
}

function offlineInsights(s: ReturnType<typeof insightSummary>): InsightResult {
  const weakest = [...(s.score_parts ?? [])].sort((a, b) => parseInt(a.achieved) - parseInt(b.achieved))[0];
  const top = s.top_profit_items[0];
  const low = s.low_margin_items.find((x) => x.item !== top?.item);
  return {
    profile: `${s.shop} records sales almost every day and earns about ${inr(s.week_profit)} a week on ${inr(s.week_sales)} of sales. ${s.udhaar_total > 0 ? `${inr(s.udhaar_total)} is out on udhaar with ${s.udhaar_customers} customers.` : 'There is no pending udhaar.'} With a score of ${s.dukaan_score}, the shop ${s.eligible_loan ? `can show a lender steady trade for a loan of around ${inr(s.eligible_loan)}.` : 'needs a few more weeks of records before applying for a loan.'}`,
    improve: weakest ? `Improve "${weakest.factor}" (now ${weakest.achieved}) for the biggest jump in your score.` : 'Keep recording every sale for 30 days.',
    tips: [
      top ? `${top.item} earns you the most (${inr(top.profit_7d)} this week). Keep it at eye level and never let it run out.` : 'Record a week of sales to see which items earn the most.',
      low ? `${low.item} has only ${low.margin} margin. Ask your supplier for a better rate, or raise the price by ₹2–3.` : 'Compare supplier rates once a month.',
      s.running_low.length ? `Order ${s.running_low.slice(0, 3).join(', ')} today. Running out loses the customer, not just the sale.` : 'Stock is healthy. Buy in bulk before festival weeks.',
      s.udhaar_total > 0 ? `Send WhatsApp reminders every Sunday. Collecting ${inr(Math.round(s.udhaar_total / 2))} would lift your Dukaan Score.` : 'Keep udhaar small and collect weekly to protect your score.',
    ],
  };
}

const CACHE = 'dukaan-ai:insights';

export function Insights({ go }: { go: (t: Tab) => void }) {
  const { ledger, t, settings } = useStore();
  const { score } = ledger;
  const [ai, setAi] = useState<(InsightResult & { by: 'gemini' | 'offline'; sig: string }) | null>(() => {
    try {
      return JSON.parse(sessionStorage.getItem(CACHE) ?? 'null');
    } catch {
      return null;
    }
  });
  const [loading, setLoading] = useState(false);
  const [draft, setDraft] = useState<WaDraft | null>(null);

  const summary = useMemo(() => insightSummary(ledger, settings.shopName), [ledger, settings.shopName]);
  const sig = `${score.value}-${summary.week_sales}-${settings.lang}`;

  async function refresh() {
    setLoading(true);
    let r: InsightResult & { by: 'gemini' | 'offline'; sig: string };
    try {
      r = { ...(await insights(summary, settings.lang)), by: 'gemini', sig };
    } catch (e) {
      if (!(e instanceof OfflineError)) console.error(e);
      r = { ...offlineInsights(summary), by: 'offline', sig };
    }
    setAi(r);
    try {
      sessionStorage.setItem(CACHE, JSON.stringify(r));
    } catch {
      /* fine */
    }
    setLoading(false);
  }

  useEffect(() => {
    if (!ai || ai.sig !== sig) refresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sig]);

  const ctx = { ledger, entries: [], settings, phones: {} };
  const reorder = ledger.stock.filter((s) => s.low || (!s.daily && Number.isFinite(s.daysLeft) && s.daysLeft < 7)).slice(0, 6);
  const slow = ledger.stock.filter((s) => s.qty > 0 && s.velocity < 0.6).slice(0, 3);

  const R = 56;
  const C = 2 * Math.PI * R;
  const arc = C * 0.75;
  const frac = (score.value - 300) / 600;
  const color = score.band === 'high' ? 'var(--good)' : score.band === 'mid' ? 'var(--warn)' : 'var(--bad)';

  return (
    <div className="screen">
      <header className="page-head only-narrow">
        <h1>{t.insights}</h1>
      </header>
     <div className="ins-grid">
      <section className="section a-score" style={{ marginTop: 0 }}>
        <div className="card">
          <div className="score-card">
            <div className="ring" role="img" aria-label={`Dukaan Score ${score.value} out of 900`}>
              <svg viewBox="0 0 132 132">
                <circle cx="66" cy="66" r={R} fill="none" stroke="var(--line-2)" strokeWidth="11" strokeLinecap="round" strokeDasharray={`${arc} ${C}`} />
                <circle className="fg" cx="66" cy="66" r={R} fill="none" stroke={color} strokeWidth="11" strokeLinecap="round" strokeDasharray={`${arc} ${C}`} strokeDashoffset={arc * (1 - frac)} />
              </svg>
              <div className="c">
                <b className="num" style={{ color }}>
                  {score.value}
                </b>
                <span>of 900</span>
              </div>
            </div>
            <div className="loan">
              <div className="k">{t.score}</div>
              <div style={{ margin: '4px 0 12px' }}>
                <span className={`pill ${score.band === 'high' ? 'good' : score.band === 'mid' ? 'warn' : 'bad'}`}>{score.band === 'high' ? 'Loan ready' : score.band === 'mid' ? 'Building' : 'Needs records'}</span>
              </div>
              <div className="k">{score.loan ? t.loanReady : t.notYet}</div>
              <div className="v num">{score.loan ? `up to ${inr(score.loan)}` : '—'}</div>
              <button className="btn primary sm" style={{ marginTop: 12 }} onClick={() => go('loans')}>
                See loan offers
              </button>
            </div>
          </div>
          <div className="parts">
            {score.parts.map((p) => (
              <div className="part" key={p.label}>
                <span>
                  {p.label} <span style={{ color: 'var(--ink-3)' }}>· {p.weight * 100}%</span>
                </span>
                <span className="num">{Math.round(p.value * 100)}%</span>
                <div className="meter">
                  <i style={{ width: `${p.value * 100}%` }} />
                </div>
              </div>
            ))}
          </div>
          <div className="profile">
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 6 }}>
              <b style={{ fontSize: 13.5, display: 'flex', gap: 6, alignItems: 'center' }}>
                <Sparkles size={15} color="var(--brand)" /> {t.explain}
              </b>
              <button className="btn ghost sm" onClick={refresh} disabled={loading} aria-label="Refresh AI insights">
                <RefreshCw size={14} className={loading ? 'spin' : ''} />
              </button>
            </div>
            {loading && !ai ? (
              <div style={{ display: 'grid', gap: 8 }}>
                <div className="skel" />
                <div className="skel" style={{ width: '85%' }} />
                <div className="skel" style={{ width: '60%' }} />
              </div>
            ) : (
              ai && (
                <>
                  <div style={{ opacity: loading ? 0.5 : 1 }}>{ai.profile}</div>
                  <div className="improve">
                    <TrendingUp size={16} />
                    <span>{ai.improve}</span>
                  </div>
                </>
              )
            )}
          </div>
        </div>
      </section>

      {reorder.length > 0 && (
        <section className="section a-reorder">
          <div className="section-head">
            <h2>{t.reorder}</h2>
            <button
              className="btn primary sm"
              onClick={() => setDraft(TOOLS.draft_supplier_order({ supplier: 'Agarwal Traders', items: reorder.map((s) => ({ item: s.name, qty: Math.max(Math.ceil(s.velocity * 10 - Math.max(s.qty, 0)), 5), unit: s.unit })) }, ctx).drafts![0])}
            >
              <PackagePlus size={15} /> {t.draftOrder}
            </button>
          </div>
          <div className="card">
            <ul className="rows">
              {reorder.map((s) => (
                <li key={s.key} className="row">
                  <div className="main">
                    <div className="t">{s.name}</div>
                    <div className="s num">
                      {fmtQty(Math.max(s.qty, 0), s.unit)} left · sells {fmtQty(Math.round(s.velocity * 10) / 10, s.unit)}/day
                    </div>
                  </div>
                  <div style={{ textAlign: 'right' }}>
                    <span className={`pill ${s.low ? 'bad' : 'warn'}`}>{s.qty <= 0 ? t.out : `${Math.max(Math.round(s.daysLeft), 0)} ${t.daysLeft}`}</span>
                    <div className="amt-sub num" style={{ marginTop: 4 }}>
                      order {fmtQty(Math.max(Math.ceil(s.velocity * 10 - Math.max(s.qty, 0)), 5), s.unit)}
                    </div>
                  </div>
                </li>
              ))}
            </ul>
          </div>
        </section>
      )}

      {slow.length > 0 && (
        <section className="section a-slow">
          <div className="section-head">
            <h2>{t.slow}</h2>
          </div>
          <div className="card">
            <ul className="rows">
              {slow.map((s) => (
                <li key={s.key} className="row">
                  <div className="main">
                    <div className="t">{s.name}</div>
                    <div className="s num">
                      {fmtQty(s.qty, s.unit)} on shelf · {inr(s.value)} stuck
                    </div>
                  </div>
                  <button className="btn ghost sm" onClick={() => go('offers')}>
                    <Tag size={14} /> {t.makePromo}
                  </button>
                </li>
              ))}
            </ul>
          </div>
        </section>
      )}

      <section className="section a-tips">
        <div className="section-head">
          <h2>{t.aiTips}</h2>
          {ai && <span className="aside-txt">{ai.by === 'gemini' ? 'by Gemini' : 'offline'}</span>}
        </div>
        <ol className="tips">
          {(ai?.tips ?? [0, 1, 2, 3].map(() => '')).map((tip, i) => (
            <li className="tip" key={i}>
              <span className="n">{i + 1}</span>
              {tip ? <span>{tip}</span> : <div className="skel" style={{ flex: 1, marginTop: 6 }} />}
            </li>
          ))}
        </ol>
        <p style={{ fontSize: 12, color: 'var(--ink-3)', margin: '12px 4px 0', display: 'flex', gap: 6 }}>
          <Lightbulb size={14} style={{ flex: 'none' }} /> The Dukaan Score is a guide to loan readiness built from your own records, not a credit bureau score.
        </p>
      </section>
     </div>

      {draft && (
        <Sheet title={draft.kind === 'order' ? 'Supplier order' : 'WhatsApp offer'} onClose={() => setDraft(null)}>
          <WaCard d={draft} />
          <p style={{ fontSize: 12.5, color: 'var(--ink-3)', margin: '12px 4px' }}>Ask Dukaan can write this for you in your own words. Try “Make a sugar order” there.</p>
        </Sheet>
      )}
    </div>
  );
}
