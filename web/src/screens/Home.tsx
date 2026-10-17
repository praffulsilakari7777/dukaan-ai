import { ArrowRight, BellRing, CalendarClock, ChevronRight, Languages, Mic, Package, Pause, Play, Settings as Cog, Sparkles, Wallet } from 'lucide-react';
import { useState } from 'react';
import { briefing, OfflineError } from '../lib/api';
import { daysSince, fmtQty, inr, relTime, startOfDay } from '../lib/ledger';
import { offerCandidates } from '../lib/offers';
import { langInfo, tf } from '../lib/i18n';
import { useSpeaker } from '../lib/speech';
import { useStore } from '../lib/store';
import type { Entry } from '../lib/types';
import { entryTitle, KindIcon, kindOf, moneyClass, moneyText, Sheet } from '../components/ui';
import type { Tab } from '../App';

export function briefingSummary(store: ReturnType<typeof useStore>) {
  const { ledger } = store;
  const y = ledger.days[ledger.days.length - 2];
  const week = ledger.days.reduce((s, d) => s + d.sales, 0);
  return {
    owner: store.settings.ownerName,
    shop: store.settings.shopName,
    yesterday: { sales: Math.round(y?.sales ?? 0), profit: Math.round(y?.profit ?? 0) },
    today_so_far: { sales: Math.round(ledger.today.sales), profit: Math.round(ledger.today.profit) },
    week_sales: Math.round(week),
    running_low: ledger.stock.filter((s) => s.low).slice(0, 4).map((s) => ({ item: s.name, left: fmtQty(Math.max(s.qty, 0), s.unit), days_left: Number.isFinite(s.daysLeft) ? Math.round(s.daysLeft) : null })),
    top_udhaar: ledger.customers.filter((c) => c.due > 0).slice(0, 3).map((c) => ({ name: c.name, due: c.due })),
    total_udhaar: ledger.totalDue,
    dukaan_score: ledger.score.value,
  };
}

function offlineBriefing(s: ReturnType<typeof briefingSummary>, lang: string) {
  const low = s.running_low.map((r) => r.item).join(' and ');
  const due = s.top_udhaar[0];
  if (lang === 'hi')
    return `Namaste ${s.owner} ji. Kal aapki bikri ${inr(s.yesterday.sales)} rahi, aur munafa ${inr(s.yesterday.profit)}. ${low ? `${low} jaldi khatam hone wale hain, aaj order kar dijiye.` : 'Stock theek hai.'} ${due ? `Sabse zyada udhaar ${due.name} ka hai, ${inr(due.due)}.` : ''} Aapka Dukaan Score ${s.dukaan_score} hai. Aaj ka din shubh ho!`;
  return `Good morning ${s.owner}. Yesterday you sold ${inr(s.yesterday.sales)} and made ${inr(s.yesterday.profit)} profit. ${low ? `${low} will run out soon, so place an order today.` : 'Your stock looks healthy.'} ${due ? `The biggest udhaar is ${due.name}, at ${inr(due.due)}.` : ''} Your Dukaan Score is ${s.dukaan_score}. Have a good day!`;
}


type OpenAsk = (voice?: boolean, q?: string) => void;

export function Home({ go, openAdd, openAsk, openSettings, openLang }: { go: (t: Tab) => void; openAdd: () => void; openAsk: OpenAsk; openSettings: () => void; openLang: () => void }) {
  const store = useStore();
  const { ledger, t, settings, entries } = store;
  const SUGGESTED = [t.sugg1, t.sugg2, t.sugg3];
  const [entry, setEntry] = useState<Entry | null>(null);
  const [script, setScript] = useState<string | null>(null);
  const [loadingBrief, setLoadingBrief] = useState(false);
  const [sel, setSel] = useState(ledger.days.length - 1);
  const speaker = useSpeaker();

  const now = new Date();
  const hour = now.getHours();
  const greet = hour < 12 ? t.goodMorning : hour < 17 ? t.goodAfternoon : t.goodEvening;
  const max = Math.max(...ledger.days.map((d) => d.sales), 1);
  const today = ledger.today;
  const day = ledger.days[sel] ?? ledger.days[ledger.days.length - 1];
  const weekSales = ledger.days.reduce((s, d) => s + d.sales, 0);

  const low = ledger.stock.filter((s) => s.low);
  const expiring = offerCandidates(ledger).filter((c) => c.reason === 'expiring');
  const overdue = ledger.customers.filter((c) => c.due > 0 && daysSince(c.lastPaymentTs || c.history[c.history.length - 1]?.ts || 0) >= 30);

  const recent = [...entries].sort((a, b) => b.ts - a.ts).slice(0, 12);
  const t0 = startOfDay();
  const groups: { label: string; items: Entry[] }[] = [];
  for (const e of recent) {
    const label = e.ts >= t0 ? t.today : e.ts >= t0 - 86_400_000 ? t.yesterday : new Date(e.ts).toLocaleDateString(langInfo(settings.lang).bcp, { day: 'numeric', month: 'short' });
    const g = groups[groups.length - 1];
    if (g?.label === label) g.items.push(e);
    else groups.push({ label, items: [e] });
  }

  async function playBriefing() {
    if (speaker.speaking) return speaker.stop();
    let text = script;
    if (!text) {
      setLoadingBrief(true);
      const summary = briefingSummary(store);
      try {
        text = (await briefing(summary, settings.lang)).script;
      } catch (e) {
        if (!(e instanceof OfflineError)) console.error(e);
        text = offlineBriefing(summary, settings.lang);
      }
      setScript(text);
      setLoadingBrief(false);
    }
    speaker.speak(text, settings.lang);
  }

  return (
    <div className="screen">
      <div className="home">
        <header className="m-head only-narrow">
          <div>
            <span className="m-greet">
              {greet}, {settings.ownerName}
            </span>
            <b className="m-shop">{settings.shopName}</b>
          </div>
          <div className="m-actions">
            <button className="ghost-icon" onClick={openLang} aria-label={t.chooseLanguage}>
              <Languages size={19} />
            </button>
            <button className="ghost-icon" onClick={openSettings} aria-label={t.settings}>
              <Cog size={19} />
            </button>
          </div>
        </header>

        <section className="a-hero">
          <div className="summary">
            <div className="sum-label">
              <span>{t.todayProfit}</span>
              <span className="sum-live">
                <i /> {now.toLocaleDateString(langInfo(settings.lang).bcp, { weekday: 'short', day: 'numeric', month: 'short' })}
              </span>
            </div>
            <div className={`sum-value num${today.profit < 0 ? ' neg' : ''}`}>{inr(today.profit)}</div>
            <div className="sum-note">
              {tf(t.profitNote, { n: today.count })}
            </div>
            <dl className="sum-metrics">
              <div>
                <dt>{t.todaySales}</dt>
                <dd className="num">{inr(today.sales)}</dd>
              </div>
              <div>
                <dt>{t.cashIn}</dt>
                <dd className="num">{inr(today.received)}</dd>
              </div>
              <div className="sum-link" role="button" tabIndex={0} onClick={() => go('khata')} onKeyDown={(e) => e.key === 'Enter' && go('khata')}>
                <dt>{t.udhaarDue}</dt>
                <dd className="num">
                  {inr(ledger.totalDue)} <ChevronRight size={15} />
                </dd>
              </div>
            </dl>
          </div>
        </section>

        <section className="a-ask">
          <div className="ask-card">
            <div className="ask-head">
              <span className="ask-orb">
                <Sparkles size={18} />
              </span>
              <div>
                <b>{t.askTitle}</b>
                <span>{t.askSub}</span>
              </div>
            </div>
            <div className="ask-input">
              <button className="ask-field" onClick={() => openAsk()}>
                {t.askPlaceholder}
              </button>
              <button className="ask-mic" onClick={() => openAsk(true)} aria-label="Ask by voice">
                <Mic size={19} />
              </button>
            </div>
            <div className="ask-suggest">
              {SUGGESTED.map((q) => (
                <button key={q} onClick={() => openAsk(false, q)}>
                  <span>{q}</span>
                  <ArrowRight size={14} />
                </button>
              ))}
            </div>
          </div>
        </section>

        <section className="a-attn panel">
          <div className="block-head">
            <h2>{t.needsAttention}</h2>
            <span>{low.length + overdue.length + expiring.length ? tf(t.toActOn, { n: (low.length ? 1 : 0) + overdue.length + (expiring.length ? 1 : 0) }) : t.allClear}</span>
          </div>
          <ul className="attn">
            {low.length > 0 && (
              <li>
                <span className="attn-ic warn">
                  <Package size={18} />
                </span>
                <div className="attn-main">
                  <b>{tf(t.runningLow, { items: low.slice(0, 2).map((s) => s.name).join(', ') + (low.length > 2 ? ` +${low.length - 2}` : '') })}</b>
                  <span>{tf(t.daysStockLeft, { n: Math.max(Math.round(Math.min(...low.map((s) => (Number.isFinite(s.daysLeft) ? s.daysLeft : 0)))), 0) })}</span>
                </div>
                <button className="attn-act" onClick={() => openAsk(false, 'Make a supplier order for the items running low')}>
                  {t.order}
                </button>
              </li>
            )}
            {expiring.length > 0 && (
              <li>
                <span className="attn-ic bad">
                  <CalendarClock size={18} />
                </span>
                <div className="attn-main">
                  <b>{tf(t.expiringSoon, { items: expiring.slice(0, 2).map((c) => c.item).join(', ') + (expiring.length > 2 ? ` +${expiring.length - 2}` : '') })}</b>
                  <span className="num">{tf(t.stockAtRisk, { amt: inr(expiring.reduce((s, c) => s + c.atRiskValue, 0)) })}</span>
                </div>
                <button className="attn-act" onClick={() => go('offers')}>
                  {t.offer}
                </button>
              </li>
            )}
            {overdue.slice(0, 1).map((c) => (
              <li key={c.key}>
                <span className="attn-ic bad">
                  <Wallet size={18} />
                </span>
                <div className="attn-main">
                  <b>{tf(t.notPaidIn, { name: c.name, n: Math.min(daysSince(c.lastPaymentTs || c.history[c.history.length - 1]?.ts || 0), 999) })}</b>
                  <span className="num">{tf(t.udhaarDueAmt, { amt: inr(c.due) })}</span>
                </div>
                <button className="attn-act" onClick={() => openAsk(false, `Send ${c.name} a WhatsApp reminder for their udhaar`)}>
                  {t.remind}
                </button>
              </li>
            ))}
            <li>
              <span className="attn-ic brand">
                <BellRing size={18} />
              </span>
              <div className="attn-main">
                <b>
                  {t.morning}
                  {speaker.speaking && (
                    <span className="wave" aria-hidden>
                      <i />
                      <i />
                      <i />
                      <i />
                    </span>
                  )}
                </b>
                <span>{loadingBrief ? t.briefLoading : t.briefSub}</span>
              </div>
              <button className="attn-act icon" onClick={playBriefing} disabled={loadingBrief} aria-label={speaker.speaking ? t.stop : t.play}>
                {speaker.speaking ? <Pause size={16} /> : <Play size={16} />}
              </button>
            </li>
          </ul>
          {script && <p className="brief-script">{script}</p>}
        </section>

        <section className="a-chart panel">
          <div className="block-head">
            <h2>{t.sales7}</h2>
            <span className="num">{inr(weekSales)}</span>
          </div>
          <div className="chart-sel num" aria-live="polite">
            <b>{inr(day.sales)}</b>
            <span>
              {sel === ledger.days.length - 1 ? t.todaySoFar : new Date(day.day).toLocaleDateString(langInfo(settings.lang).bcp, { weekday: 'long' })} · {inr(day.profit)} {t.profitWord}
            </span>
          </div>
          <div className="bars" role="group" aria-label="Daily sales">
            {ledger.days.map((d, i) => {
              const isToday = i === ledger.days.length - 1;
              return (
                <button className={`bar-col${i === sel ? ' sel' : ''}`} key={d.day} onClick={() => setSel(i)} aria-label={`${d.label}: ${inr(d.sales)}`} aria-pressed={i === sel}>
                  <div className="bar-track">
                    <div className={`bar${isToday ? ' today' : ''}`} style={{ height: `${Math.max((d.sales / max) * 100, 2)}%`, animationDelay: `${i * 40}ms` }} />
                  </div>
                  <span className="bar-lbl">{isToday ? t.today : new Date(d.day).toLocaleDateString(langInfo(settings.lang).bcp, { weekday: 'short' })}</span>
                </button>
              );
            })}
          </div>
        </section>

        <section className="a-recent panel">
          <div className="block-head">
            <h2>{t.recent}</h2>
            <button className="link" onClick={openAdd}>
              + {t.add}
            </button>
          </div>
          {recent.length === 0 ? (
            <div className="empty">
              <div className="ic">
                <Mic size={26} />
              </div>
              <b>{t.noEntries}</b>
              {t.noEntriesHint}
            </div>
          ) : (
            groups.map((g) => (
              <div key={g.label} className="group">
                <div className="group-label">{g.label}</div>
                <ul className="rows">
                  {g.items.map((e) => (
                    <li key={e.id}>
                      <button className="row" onClick={() => setEntry(e)}>
                        <KindIcon kind={kindOf(e)} />
                        <div className="main">
                          <div className="t">{entryTitle(e)}</div>
                          <div className="s">
                            {relTime(e.ts)}
                            {e.type === 'sale' && e.credit ? ` · udhaar · ${e.customer}` : e.supplier ? ` · ${e.supplier}` : ''}
                            {e.source === 'voice' ? ' · voice' : e.source === 'bill' ? ' · bill scan' : e.source === 'agent' ? ' · Ask Dukaan' : ''}
                          </div>
                        </div>
                        <div>
                          <div className={`amt num ${moneyClass(e)}`}>{moneyText(e)}</div>
                          {e.type === 'sale' && ledger.saleProfit[e.id] != null && <div className="amt-sub num">{inr(ledger.saleProfit[e.id])} profit</div>}
                        </div>
                      </button>
                    </li>
                  ))}
                </ul>
              </div>
            ))
          )}
        </section>
      </div>
      {entry && <EntrySheet entry={entry} onClose={() => setEntry(null)} />}
    </div>
  );
}

function EntrySheet({ entry, onClose }: { entry: Entry; onClose: () => void }) {
  const { removeEntry, toast, ledger } = useStore();
  return (
    <Sheet
      title={entryTitle(entry)}
      onClose={onClose}
      foot={
        <button
          className="btn danger block"
          onClick={() => {
            removeEntry(entry.id);
            toast('Entry deleted');
            onClose();
          }}
        >
          Delete entry
        </button>
      }
    >
      <div className="balance">
        <div className="k">{new Date(entry.ts).toLocaleString('en-IN', { dateStyle: 'medium', timeStyle: 'short' })}</div>
        <div className={`v num ${moneyClass(entry) === 'in' ? 'good' : moneyClass(entry) === 'out' ? 'bad' : ''}`}>{moneyText(entry)}</div>
        {entry.type === 'sale' && ledger.saleProfit[entry.id] != null && <div className="k num">Profit on this sale: {inr(ledger.saleProfit[entry.id])}</div>}
        {entry.customer && <div className="k">Customer: {entry.customer}</div>}
        {entry.supplier && <div className="k">Supplier: {entry.supplier}</div>}
      </div>
    </Sheet>
  );
}
