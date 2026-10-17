import { ArrowLeft, CalendarClock, Download, Loader2, PackageX, RefreshCw, Send, Sparkles, Tag, TimerOff } from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';
import { Sheet } from '../components/ui';
import { generateOffer, OfflineError } from '../lib/api';
import { fmtQty, inr, uid } from '../lib/ledger';
import { drawPoster, fastMovers, offerCandidates, offlineOffer, type ActiveOffer, type OfferCandidate, type OfferPlan } from '../lib/offers';
import { useStore } from '../lib/store';

export function Offers({ back }: { back?: () => void }) {
  const { ledger, offers, endOffer, settings } = useStore();
  const candidates = useMemo(() => offerCandidates(ledger).filter((c) => !offers.some((o) => o.item === c.item && o.expiresTs > Date.now())), [ledger, offers]);
  const [open, setOpen] = useState<OfferCandidate | null>(null);
  const atRisk = candidates.reduce((s, c) => s + c.atRiskValue, 0);
  const live = offers.filter((o) => o.expiresTs > Date.now());

  return (
    <div className="screen">
      <header className="page-head">
        {back && (
          <button className="back only-narrow" onClick={back}>
            <ArrowLeft size={18} /> Stock
          </button>
        )}
        <h1 className="only-narrow">Smart offers</h1>
        <div className="lead">
          <span className="big num" style={{ color: atRisk ? 'var(--bad)' : undefined }}>
            {inr(atRisk)}
          </span>
          <span className="cap">
            of stock at risk · {candidates.length} item{candidates.length === 1 ? '' : 's'} need an offer
          </span>
        </div>
        <p className="page-sub">Dukaan AI watches expiry dates and how fast each item sells. Gemini designs an offer that clears the stock without giving away your margin.</p>
      </header>

      <div className="section" style={{ marginTop: 0 }}>
        {candidates.length === 0 ? (
          <div className="card empty">
            <div className="ic">
              <Tag size={26} />
            </div>
            <b>Nothing at risk</b>
            Every item is selling before it expires.
          </div>
        ) : (
          <div className="cand-grid">
            {candidates.map((c) => (
              <article key={c.key} className="cand">
                <div className="cand-top">
                  <span className={`cand-ic ${c.reason}`}>{c.reason === 'expiring' ? <CalendarClock size={19} /> : <PackageX size={19} />}</span>
                  <div className="cand-main">
                    <b>{c.item}</b>
                    <span className={`pill ${c.reason === 'expiring' ? ((c.daysToExpiry ?? 9) <= 2 ? 'bad' : 'warn') : 'neutral'}`}>{c.reason === 'expiring' ? 'Expiring' : 'Not selling'}</span>
                  </div>
                </div>
                <p className="cand-why">{c.why}</p>
                <dl className="cand-stats num">
                  <div>
                    <dt>At risk</dt>
                    <dd>{inr(c.atRiskValue)}</dd>
                  </div>
                  <div>
                    <dt>Cost / sells at</dt>
                    <dd>
                      {inr(c.cost)} / {inr(c.price)}
                    </dd>
                  </div>
                  <div>
                    <dt>Margin</dt>
                    <dd>{c.maxDiscount}%</dd>
                  </div>
                </dl>
                <button className="btn primary block" onClick={() => setOpen(c)}>
                  <Sparkles size={17} /> Create offer with AI
                </button>
              </article>
            ))}
          </div>
        )}
      </div>

      {live.length > 0 && (
        <section className="section">
          <div className="section-head">
            <h2>Live offers</h2>
            <span className="aside-txt">{live.length} running</span>
          </div>
          <div className="card">
            <ul className="rows">
              {live.map((o) => (
                <li key={o.id} className="row">
                  <span className="chip-ic credit">
                    <Tag size={18} />
                  </span>
                  <div className="main">
                    <div className="t">{o.headline}</div>
                    <div className="s num">
                      {inr(o.offer_price)}/{o.unit} · ends {new Date(o.expiresTs).toLocaleDateString('en-IN', { weekday: 'short', day: 'numeric', month: 'short' })}
                    </div>
                  </div>
                  <a className="btn ghost sm" href={`https://wa.me/?text=${encodeURIComponent(o.whatsapp_message)}`} target="_blank" rel="noreferrer">
                    <Send size={14} /> Share
                  </a>
                  <button className="btn ghost sm" onClick={() => endOffer(o.id)} aria-label={`End ${o.headline}`}>
                    <TimerOff size={14} />
                  </button>
                </li>
              ))}
            </ul>
          </div>
        </section>
      )}
      {open && <OfferComposer c={open} shop={settings.shopName} onClose={() => setOpen(null)} />}
    </div>
  );
}

function OfferComposer({ c, shop, onClose }: { c: OfferCandidate; shop: string; onClose: () => void }) {
  const { ledger, settings, addOffer, toast } = useStore();
  const [plan, setPlan] = useState<(OfferPlan & { by: 'gemini' | 'offline' }) | null>(null);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState('');
  const pairs = fastMovers(ledger, c.item);

  async function make() {
    setBusy(true);
    let p: OfferPlan & { by: 'gemini' | 'offline' };
    try {
      p = { ...(await generateOffer({ candidate: c, shop, fast_movers: pairs, lang: settings.lang })), by: 'gemini' };
    } catch (e) {
      if (!(e instanceof OfflineError)) console.error(e);
      p = { ...offlineOffer(c, shop, pairs), by: 'offline' };
    }
    setPlan(p);
    setMsg(p.whatsapp_message);
    setBusy(false);
  }

  const started = useRef(false);
  useEffect(() => {
    if (started.current) return;
    started.current = true;
    make();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const poster = useMemo(() => (plan ? drawPoster({ ...plan, item: c.item, unit: c.unit }, shop) : null), [plan, c.item, c.unit, shop]);

  return (
    <Sheet
      title={`Offer for ${c.item}`}
      onClose={onClose}
      full
      foot={
        plan ? (
          <>
            <button className="btn ghost" onClick={make} disabled={busy} aria-label="Generate another offer">
              <RefreshCw size={16} className={busy ? 'spin' : ''} />
            </button>
            <a className="btn wa" href={`https://wa.me/?text=${encodeURIComponent(msg)}`} target="_blank" rel="noreferrer">
              <Send size={16} /> WhatsApp
            </a>
            <button
              className="btn primary"
              style={{ flex: 1 }}
              onClick={() => {
                const o: ActiveOffer = { ...plan, whatsapp_message: msg, id: uid(), item: c.item, unit: c.unit, createdTs: Date.now(), expiresTs: Date.now() + Math.max(plan.valid_days, 1) * 86_400_000, by: plan.by };
                addOffer(o);
                toast(`Offer live · ${plan.headline}`);
                onClose();
              }}
            >
              <Tag size={16} /> Start offer
            </button>
          </>
        ) : undefined
      }
    >
      {!plan ? (
        <div className="composer-loading">
          <Loader2 size={28} className="spin" />
          <b>Gemini is designing an offer…</b>
          <span>
            Checking {fmtQty(c.atRiskQty, c.unit)} at risk, your {c.maxDiscount}% margin and what sells fastest
          </span>
        </div>
      ) : (
        <div className="composer-grid" style={{ opacity: busy ? 0.5 : 1 }}>
          <div className="poster-wrap">
            {poster && <img src={poster} alt={`Poster: ${plan.headline}`} />}
            {poster && (
              <a className="btn ghost sm" href={poster} download={`${c.item.toLowerCase().replace(/\s+/g, '-')}-offer.png`}>
                <Download size={14} /> Download poster
              </a>
            )}
          </div>
          <div className="plan">
            <span className="pill brand">{plan.offer_type === 'discount' ? 'Discount' : plan.offer_type === 'bogo' ? 'Buy one, get one' : plan.offer_type === 'bundle' ? 'Bundle' : 'Combo'}</span>
            <h3>{plan.headline}</h3>
            <div className="plan-price num">
              <s>{inr(c.price)}</s>
              <b>{inr(plan.offer_price)}</b>
              <span>/{c.unit} · {plan.valid_days <= 1 ? 'today only' : `${plan.valid_days} days`}</span>
            </div>
            <div className="why">
              <Sparkles size={15} />
              <p>{plan.reasoning}</p>
            </div>
            <label className="field" style={{ marginTop: 14 }}>
              <span>WhatsApp message to customers</span>
              <textarea className="input area" rows={4} value={msg} onChange={(e) => setMsg(e.target.value)} />
            </label>
            <div className="by" style={{ fontSize: 11.5, color: 'var(--ink-3)', display: 'flex', gap: 5, alignItems: 'center' }}>
              <Sparkles size={11} /> {plan.by === 'gemini' ? 'Designed by Gemini' : 'Offline rules (Gemini unavailable)'}
            </div>
          </div>
        </div>
      )}
    </Sheet>
  );
}
