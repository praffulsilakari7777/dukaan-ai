import { ArrowLeft, BadgeCheck, Banknote, Check, Clock, FileCheck2, Landmark, Lock, ShieldCheck, Sparkles, X } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { Sheet } from '../components/ui';
import { loanAdvice, OfflineError } from '../lib/api';
import { inr, uid } from '../lib/ledger';
import { avgDailyProfit, loanOffers, offlineAdvice, PURPOSES, quote, statusOf, type Advice, type LoanApplication, type LoanStatus, type Offer } from '../lib/lending';
import { useStore } from '../lib/store';
import { tf } from '../lib/i18n';

const STEPS: { id: LoanStatus; label: 'stepSent' | 'stepReview' | 'stepApproved' | 'stepPaid'; sub: string }[] = [
  { id: 'submitted', label: 'stepSent', sub: 'Account Aggregator' },
  { id: 'review', label: 'stepReview', sub: 'Dukaan records' },
  { id: 'approved', label: 'stepApproved', sub: '✓' },
  { id: 'disbursed', label: 'stepPaid', sub: 'UPI' },
];
const ORDER: LoanStatus[] = ['submitted', 'review', 'approved', 'disbursed'];

export function Loans({ back }: { back?: () => void }) {
  const { ledger, loans, t } = useStore();
  const offers = useMemo(() => loanOffers(ledger), [ledger]);
  const [pick, setPick] = useState<string>(() => offers.find((o) => o.eligible)?.p.id ?? offers[0].p.id);
  const offer = offers.find((o) => o.p.id === pick)!;
  const best = Math.max(...offers.filter((o) => o.eligible).map((o) => o.limit), 0);
  const { score } = ledger;
  const [, tick] = useState(0);
  const active = loans[0];
  const activeStatus = active ? statusOf(active) : null;

  useEffect(() => {
    if (!active || activeStatus === 'disbursed') return;
    const t = window.setInterval(() => tick((n) => n + 1), 1000);
    return () => window.clearInterval(t);
  }, [active, activeStatus]);

  const color = score.band === 'high' ? 'var(--good)' : score.band === 'mid' ? 'var(--warn)' : 'var(--bad)';

  return (
    <div className="screen">
      <header className="page-head">
        {back && (
          <button className="back only-narrow" onClick={back}>
            <ArrowLeft size={18} /> {t.insights}
          </button>
        )}
        <h1 className="only-narrow">{t.loans}</h1>
      </header>

      <div className="loans">
        <section className="loan-hero a-lhero">
          <div className="lh-score">
            <span>{t.score}</span>
            <b className="num" style={{ color }}>
              {score.value}
            </b>
            <small>{t.ofScore}</small>
          </div>
          <div className="lh-main">
            <span className="lh-k">{best ? t.preApproved : t.notEligible}</span>
            <b className="num">{best ? inr(best) : '—'}</b>
            <span className="lh-sub">{t.basedOn}</span>
          </div>
        </section>

        {active && (
          <section className="panel a-status">
            <div className="block-head">
              <h2>{t.yourApplication}</h2>
              <span className="num">
                {inr(active.amount)} · {active.lender}
              </span>
            </div>
            <ol className="timeline">
              {STEPS.map((s) => {
                const idx = ORDER.indexOf(s.id);
                const cur = ORDER.indexOf(activeStatus!);
                const state = idx < cur || activeStatus === 'disbursed' ? 'done' : idx === cur ? 'now' : 'todo';
                return (
                  <li key={s.id} className={state}>
                    <span className="dot">{state === 'done' ? <Check size={13} strokeWidth={3} /> : state === 'now' ? <Clock size={13} /> : null}</span>
                    <div>
                      <b>{t[s.label]}</b>
                      <span>{s.id === 'disbursed' && state === 'done' ? `${inr(active.amount)} credited · ${inr(active.daily)}/day from tomorrow` : s.sub}</span>
                    </div>
                  </li>
                );
              })}
            </ol>
          </section>
        )}

        <section className="a-offers">
          <div className="section-head" style={{ margin: '0 4px 10px' }}>
            <h2>{t.offersForYou}</h2>
            <span className="aside-txt">{t.demoPartners}</span>
          </div>
          <div className="lenders">
            {offers.map((o) => (
              <button key={o.p.id} className={`lender${o.p.id === pick ? ' on' : ''}${o.eligible ? '' : ' locked'}`} onClick={() => setPick(o.p.id)} aria-pressed={o.p.id === pick}>
                <div className="lender-top">
                  <span className="lender-ic">
                    <Landmark size={18} />
                  </span>
                  <div>
                    <b>{o.p.product}</b>
                    <span>{o.p.lender}</span>
                  </div>
                  {o.eligible ? (
                    <span className="pill good">
                      <BadgeCheck size={12} /> {t.eligible}
                    </span>
                  ) : (
                    <span className="pill neutral">
                      <Lock size={11} /> {o.p.minScore}+
                    </span>
                  )}
                </div>
                <dl className="lender-terms num">
                  <div>
                    <dt>{t.upTo}</dt>
                    <dd>{inr(o.limit)}</dd>
                  </div>
                  <div>
                    <dt>{t.interest}</dt>
                    <dd>{o.rate}% p.a.</dd>
                  </div>
                  <div>
                    <dt>{t.tenure}</dt>
                    <dd>
                      {o.p.tenures[0]}–{o.p.tenures[o.p.tenures.length - 1]} mo
                    </dd>
                  </div>
                </dl>
                <p className="lender-blurb">{o.eligible ? o.p.blurb : `${o.gap} points away. Collect more udhaar on time to unlock this.`}</p>
              </button>
            ))}
          </div>
        </section>

        <Calculator offer={offer} key={offer.p.id} />

        <p className="disclaimer a-disc">
          <ShieldCheck size={15} /> Prototype. The lenders above are fictional demo partners. No loan is created, no money moves and no data leaves this phone. In production, records are shared only with the owner’s consent through India’s Account Aggregator framework.
        </p>
      </div>
    </div>
  );
}

function Calculator({ offer }: { offer: Offer }) {
  const { ledger, settings, applyLoan, toast, loans, t } = useStore();
  const min = 10_000;
  const [amount, setAmount] = useState(Math.min(Math.max(Math.round(offer.limit / 2 / 5000) * 5000, min), offer.limit));
  const [months, setMonths] = useState(offer.p.tenures[Math.min(1, offer.p.tenures.length - 1)]);
  const [purpose, setPurpose] = useState(PURPOSES[0]);
  const [advice, setAdvice] = useState<(Advice & { by: 'gemini' | 'offline' }) | null>(null);
  const [advising, setAdvising] = useState(false);
  const [consent, setConsent] = useState(false);
  const q = quote(offer, amount, months, ledger);
  const profit = avgDailyProfit(ledger);
  const burdenPct = Math.round(q.burden * 100);
  const tone = burdenPct <= 25 ? 'good' : burdenPct <= 40 ? 'warn' : 'bad';
  const pending = loans[0] && statusOf(loans[0]) !== 'disbursed';

  async function ask() {
    setAdvising(true);
    const fallback = offlineAdvice(ledger, amount, purpose, offer.p.id);
    try {
      const r = await loanAdvice({
        purpose,
        requested: amount,
        avg_daily_profit: Math.round(profit),
        avg_daily_sales: Math.round(ledger.days.slice(0, -1).reduce((s, d) => s + d.sales, 0) / 6),
        udhaar_outstanding: ledger.totalDue,
        stock_value: Math.round(ledger.stockValue),
        dukaan_score: ledger.score.value,
        offers: loanOffers(ledger).map((o) => ({ id: o.p.id, lender: o.p.lender, product: o.p.product, eligible: o.eligible, limit: o.limit, rate: o.rate, tenures: o.p.tenures, daily_repayment: o.p.daily })),
        selected_offer: offer.p.id,
        lang: settings.lang,
      });
      setAdvice({ ...fallback, ...r, by: 'gemini' });
    } catch (e) {
      if (!(e instanceof OfflineError)) console.error(e);
      setAdvice({ ...fallback, by: 'offline' });
    }
    setAdvising(false);
  }

  if (!offer.eligible) {
    return (
      <section className="panel a-calc">
        <div className="block-head">
          <h2>{offer.p.product}</h2>
        </div>
        <div className="locked-note">
          <Lock size={18} />
          <p>
            You need a Dukaan Score of <b>{offer.p.minScore}</b> for this loan. You are at <b>{ledger.score.value}</b>. Recording sales every day and collecting udhaar on time are the fastest ways up.
          </p>
        </div>
      </section>
    );
  }

  return (
    <section className="panel a-calc">
      <div className="block-head">
        <h2>{t.planLoan}</h2>
        <span>{offer.p.lender}</span>
      </div>

      <div className="calc-amount num">
        <span>{t.amount}</span>
        <b>{inr(amount)}</b>
      </div>
      <input type="range" className="range" min={min} max={offer.limit} step={5000} value={amount} onChange={(e) => setAmount(Number(e.target.value))} aria-label="Loan amount" style={{ ['--p' as string]: `${((amount - min) / Math.max(offer.limit - min, 1)) * 100}%` }} />
      <div className="range-ends num">
        <span>{inr(min)}</span>
        <span>{inr(offer.limit)}</span>
      </div>

      <div className="calc-row">
        <div className="field" style={{ margin: 0, flex: 1 }}>
          <span>{t.repayOver}</span>
          <div className="seg" style={{ margin: 0, gridTemplateColumns: `repeat(${offer.p.tenures.length}, 1fr)` }}>
            {offer.p.tenures.map((m) => (
              <button key={m} className={m === months ? 'on' : ''} onClick={() => setMonths(m)}>
                {m} mo
              </button>
            ))}
          </div>
        </div>
        <label className="field" style={{ margin: 0, flex: 1 }}>
          <span>{t.forPurpose}</span>
          <select className="input" value={purpose} onChange={(e) => setPurpose(e.target.value)}>
            {PURPOSES.map((p) => (
              <option key={p}>{p}</option>
            ))}
          </select>
        </label>
      </div>

      <dl className="calc-out num">
        <div className="hl">
          <dt>{offer.p.daily ? t.dailyRepay : t.monthlyEmi}</dt>
          <dd>{inr(offer.p.daily ? q.daily : q.emi)}</dd>
        </div>
        <div>
          <dt>{offer.p.daily ? t.monthly : t.perDay}</dt>
          <dd>{inr(offer.p.daily ? q.emi : q.daily)}</dd>
        </div>
        <div>
          <dt>{t.totalInterest}</dt>
          <dd>{inr(q.totalInterest)}</dd>
        </div>
        <div>
          <dt>{t.fee}</dt>
          <dd>{inr(q.fee)}</dd>
        </div>
      </dl>

      <div className={`afford ${tone}`}>
        <div className="afford-top">
          <span>{t.vsProfit}</span>
          <b className="num">{burdenPct}%</b>
        </div>
        <div className="meter">
          <i style={{ width: `${Math.min(burdenPct, 100)}%` }} />
        </div>
        <span className="afford-note num">
          {inr(q.daily)} a day out of about {inr(profit)} profit. {tone === 'good' ? 'Comfortable.' : tone === 'warn' ? 'Manageable, but tight in slow weeks.' : 'Too heavy. Try a smaller amount or longer tenure.'}
        </span>
      </div>

      <div className="advisor">
        {advice ? (
          <>
            <div className="advisor-head">
              <Sparkles size={15} /> {t.advisor} <small>{advice.by === 'gemini' ? 'Gemini' : 'offline'}</small>
            </div>
            <p>{advice.summary}</p>
            <p className="risk">{advice.risk}</p>
            {(advice.amount !== amount || advice.months !== months) && advice.productId === offer.p.id && (
              <button
                className="btn ghost sm"
                onClick={() => {
                  setAmount(Math.min(Math.max(advice.amount, min), offer.limit));
                  if (offer.p.tenures.includes(advice.months)) setMonths(advice.months);
                }}
              >
                Use {inr(advice.amount)} · {advice.months} mo
              </button>
            )}
          </>
        ) : (
          <button className="advisor-cta" onClick={ask} disabled={advising}>
            <Sparkles size={16} /> {advising ? '…' : t.askAdvisor}
          </button>
        )}
      </div>

      <button className="btn primary block" style={{ marginTop: 16 }} onClick={() => setConsent(true)} disabled={!!pending}>
        <Banknote size={18} /> {pending ? t.inProgress : tf(t.apply, { amt: inr(amount) })}
      </button>

      {consent && (
        <Sheet
          title={t.shareRecords}
          onClose={() => setConsent(false)}
          foot={
            <>
              <button className="btn ghost" onClick={() => setConsent(false)}>
                {t.cancel}
              </button>
              <button
                className="btn primary"
                style={{ flex: 1 }}
                onClick={() => {
                  const a: LoanApplication = { id: uid(), productId: offer.p.id, lender: offer.p.lender, product: offer.p.product, amount, months, rate: offer.rate, emi: q.emi, daily: q.daily, purpose, ts: Date.now(), score: ledger.score.value };
                  applyLoan(a);
                  setConsent(false);
                  toast('Application sent');
                  document.querySelector('.screen')?.scrollTo({ top: 0, behavior: 'smooth' });
                }}
              >
                <FileCheck2 size={17} /> {t.agreeApply}
              </button>
            </>
          }
        >
          <p style={{ margin: '0 0 14px', color: 'var(--ink-2)', fontSize: 14 }}>
            {offer.p.lender} will see a summary of your shop’s records for the last 90 days, to decide on {inr(amount)} for {purpose.toLowerCase()}.
          </p>
          <div className="consent">
            <b>Shared</b>
            {['Daily sales and profit totals', 'Udhaar given and collected', 'Stock value', `Dukaan Score (${ledger.score.value})`].map((x) => (
              <span key={x}>
                <Check size={15} className="ok" /> {x}
              </span>
            ))}
            <b style={{ marginTop: 10 }}>Never shared</b>
            {['Customer names and phone numbers', 'Individual bills', 'Your voice recordings'].map((x) => (
              <span key={x}>
                <X size={15} className="no" /> {x}
              </span>
            ))}
          </div>
          <p className="disclaimer" style={{ marginTop: 14 }}>
            <ShieldCheck size={15} /> Prototype: consent is simulated and nothing is sent.
          </p>
        </Sheet>
      )}
    </section>
  );
}
