import { ArrowLeft, CalendarClock, Download, ImageIcon, Loader2, PackageX, RefreshCw, Send, Sparkles, Tag, TimerOff, Wand2 } from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';
import { Sheet } from '../components/ui';
import { generateOffer, offerImage, OfflineError } from '../lib/api';
import { shareImage } from '../lib/share';
import { fmtQty, inr, uid } from '../lib/ledger';
import { drawPoster, fastMovers, offerCandidates, offlineOffer, type ActiveOffer, type OfferCandidate, type OfferPlan } from '../lib/offers';
import { useStore } from '../lib/store';
import { tf } from '../lib/i18n';

export function Offers({ back }: { back?: () => void }) {
  const { ledger, offers, endOffer, settings, t } = useStore();
  const candidates = useMemo(() => offerCandidates(ledger).filter((c) => !offers.some((o) => o.item === c.item && o.expiresTs > Date.now())), [ledger, offers]);
  const [open, setOpen] = useState<OfferCandidate | null>(null);
  const atRisk = candidates.reduce((s, c) => s + c.atRiskValue, 0);
  const live = offers.filter((o) => o.expiresTs > Date.now());

  return (
    <div className="screen">
      <header className="page-head">
        {back && (
          <button className="back only-narrow" onClick={back}>
            <ArrowLeft size={18} /> {t.stock}
          </button>
        )}
        <h1 className="only-narrow">{t.offers}</h1>
        <div className="lead">
          <span className="big num" style={{ color: atRisk ? 'var(--bad)' : undefined }}>
            {inr(atRisk)}
          </span>
          <span className="cap">
            {t.ofStockAtRisk} · {tf(t.needOffer, { n: candidates.length })}
          </span>
        </div>
        <p className="page-sub">{t.offersSub}</p>
      </header>

      <div className="section" style={{ marginTop: 0 }}>
        {candidates.length === 0 ? (
          <div className="card empty">
            <div className="ic">
              <Tag size={26} />
            </div>
            <b>{t.nothingAtRisk}</b>
            {t.nothingAtRiskSub}
          </div>
        ) : (
          <div className="cand-grid">
            {candidates.map((c) => (
              <article key={c.key} className="cand">
                <div className="cand-top">
                  <span className={`cand-ic ${c.reason}`}>{c.reason === 'expiring' ? <CalendarClock size={19} /> : <PackageX size={19} />}</span>
                  <div className="cand-main">
                    <b>{c.item}</b>
                    <span className={`pill ${c.reason === 'expiring' ? ((c.daysToExpiry ?? 9) <= 2 ? 'bad' : 'warn') : 'neutral'}`}>{c.reason === 'expiring' ? t.expiringTag : t.notSelling}</span>
                  </div>
                </div>
                <p className="cand-why">{c.why}</p>
                <dl className="cand-stats num">
                  <div>
                    <dt>{t.atRisk}</dt>
                    <dd>{inr(c.atRiskValue)}</dd>
                  </div>
                  <div>
                    <dt>{t.costSells}</dt>
                    <dd>
                      {inr(c.cost)} / {inr(c.price)}
                    </dd>
                  </div>
                  <div>
                    <dt>{t.margin}</dt>
                    <dd>{c.maxDiscount}%</dd>
                  </div>
                </dl>
                <button className="btn primary block" onClick={() => setOpen(c)}>
                  <Sparkles size={17} /> {t.createOffer}
                </button>
              </article>
            ))}
          </div>
        )}
      </div>

      {live.length > 0 && (
        <section className="section">
          <div className="section-head">
            <h2>{t.liveOffers}</h2>
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
                    <Send size={14} /> {t.share}
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
  const { ledger, settings, addOffer, toast, t } = useStore();
  const [plan, setPlan] = useState<(OfferPlan & { by: 'gemini' | 'offline' }) | null>(null);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState('');
  const [aiImg, setAiImg] = useState<string | null>(null);
  const [imgBusy, setImgBusy] = useState(false);
  const [imgErr, setImgErr] = useState<string | null>(null);
  const [view, setView] = useState<'design' | 'ai'>('design');
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
    setAiImg(null);
    setView('design');
    setBusy(false);
  }

  async function paint() {
    if (!plan) return;
    setImgBusy(true);
    setImgErr(null);
    setView('ai');
    try {
      const r = await offerImage({ offer: { ...plan, item: c.item, unit: c.unit }, shop, lang: settings.lang });
      setAiImg(`data:${r.mime};base64,${r.data}`);
    } catch (e) {
      if (!(e instanceof OfflineError)) console.error(e);
      setImgErr(t.imageNeedsGemini);
      setView('design');
    }
    setImgBusy(false);
  }

  const started = useRef(false);
  useEffect(() => {
    if (started.current) return;
    started.current = true;
    make();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const poster = useMemo(() => (plan ? drawPoster({ ...plan, item: c.item, unit: c.unit }, shop) : null), [plan, c.item, c.unit, shop]);
  const shown = view === 'ai' && aiImg ? aiImg : poster;
  const slug = c.item.toLowerCase().replace(/\s+/g, '-');

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
            <button className="btn wa" onClick={() => shown && shareImage(shown, msg, `${slug}-offer.png`)} disabled={!shown}>
              <Send size={16} /> {t.shareWa}
            </button>
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
              <Tag size={16} /> {t.startOffer}
            </button>
          </>
        ) : undefined
      }
    >
      {!plan ? (
        <div className="composer-loading">
          <Loader2 size={28} className="spin" />
          <b>{t.designing}</b>
          <span>
            Checking {fmtQty(c.atRiskQty, c.unit)} at risk, your {c.maxDiscount}% margin and what sells fastest
          </span>
        </div>
      ) : (
        <div className="composer-grid" style={{ opacity: busy ? 0.5 : 1 }}>
          <div className="poster-wrap">
            <div className="seg poster-seg">
              <button className={view === 'design' ? 'on' : ''} onClick={() => setView('design')}>
                <ImageIcon size={14} /> {t.posterDesign}
              </button>
              <button className={view === 'ai' ? 'on' : ''} onClick={() => (aiImg ? setView('ai') : paint())} disabled={imgBusy}>
                <Wand2 size={14} /> {t.posterAi}
              </button>
            </div>
            <div className="poster-frame">
              {view === 'ai' && imgBusy ? (
                <div className="poster-loading">
                  <Loader2 size={26} className="spin" />
                  <span>{t.genImageLoading}</span>
                </div>
              ) : (
                shown && <img src={shown} alt={`Poster: ${plan.headline}`} />
              )}
            </div>
            {imgErr && <p className="poster-err">{imgErr}</p>}
            <div className="poster-actions">
              {!aiImg && !imgBusy && (
                <button className="btn ghost sm" onClick={paint}>
                  <Wand2 size={14} /> {t.genImage}
                </button>
              )}
              {shown && (
                <a className="btn ghost sm" href={shown} download={`${slug}-offer.png`}>
                  <Download size={14} /> {t.downloadPoster}
                </a>
              )}
            </div>
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
              <span>{t.waMsg}</span>
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
