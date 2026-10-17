import { AlertTriangle, BookUser, Mic, Pause, Play, Settings as Cog, Sparkles, TrendingUp } from 'lucide-react';
import { useState } from 'react';
import { briefing, OfflineError } from '../lib/api';
import { fmtQty, inr, relTime } from '../lib/ledger';
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
  const low = s.running_low.map((r) => r.item).join(', ');
  const due = s.top_udhaar[0];
  if (lang === 'hi')
    return `Namaste ${s.owner} ji. Kal aapki bikri ${inr(s.yesterday.sales)} rahi, aur munafa ${inr(s.yesterday.profit)}. ${low ? `${low} jaldi khatam hone wale hain, aaj order kar dijiye.` : 'Stock theek hai.'} ${due ? `Sabse zyada udhaar ${due.name} ka hai, ${inr(due.due)}.` : ''} Aapka Dukaan Score ${s.dukaan_score} hai. Aaj ka din shubh ho!`;
  return `Good morning ${s.owner}. Yesterday you sold ${inr(s.yesterday.sales)} and made ${inr(s.yesterday.profit)} profit. ${low ? `${low} will run out soon, so place an order today.` : 'Your stock looks healthy.'} ${due ? `The biggest udhaar is ${due.name}, at ${inr(due.due)}.` : ''} Your Dukaan Score is ${s.dukaan_score}. Have a good day!`;
}

export function Home({ go, openAdd, openAsk, openSettings }: { go: (t: Tab) => void; openAdd: () => void; openAsk: (voice?: boolean) => void; openSettings: () => void }) {
  const store = useStore();
  const { ledger, t, settings, entries, updateSettings } = store;
  const [entry, setEntry] = useState<Entry | null>(null);
  const [script, setScript] = useState<string | null>(null);
  const [loadingBrief, setLoadingBrief] = useState(false);
  const speaker = useSpeaker();

  const hour = new Date().getHours();
  const greet = hour < 12 ? t.goodMorning : hour < 17 ? t.goodAfternoon : t.goodEvening;
  const max = Math.max(...ledger.days.map((d) => d.sales), 1);
  const recent = [...entries].sort((a, b) => b.ts - a.ts).slice(0, 10);
  const today = ledger.today;

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
      <div className="a-hero">
      <header className="hero">
        <div className="hero-top">
          <div className="hero-shop">
            <div className="greet">
              {greet}, {settings.ownerName}
            </div>
            <div className="name">{settings.shopName}</div>
          </div>
          <div className="hero-actions">
            <button className="icon-btn lang-btn" onClick={() => updateSettings({ lang: settings.lang === 'en' ? 'hi' : 'en' })} aria-label="Switch language">
              {settings.lang === 'en' ? 'हिं' : 'EN'}
            </button>
            <button className="icon-btn" onClick={openSettings} aria-label={t.settings}>
              <Cog size={19} />
            </button>
          </div>
        </div>
        <div className="hero-figure">
          <div className="label">{t.todayProfit}</div>
          <div className={`value num${today.profit < 0 ? ' neg' : ''}`}>{inr(today.profit)}</div>
          <div className="hero-sub num">
            <span>
              Cash in <b>{inr(today.received)}</b>
            </span>
            <span>
              <b>{today.count}</b> {today.count === 1 ? 'entry' : 'entries'}
            </span>
          </div>
        </div>
      </header>

      <div className="ask-bar">
        <button className="ask-main" onClick={() => openAsk()}>
          <Sparkles className="spark" size={22} />
          <span className="ph">
            <b>{t.askTitle}</b>
            <span>“Who hasn’t paid in 30 days?”</span>
          </span>
        </button>
        <button className="mic-sm" aria-label="Ask by voice" onClick={() => openAsk(true)}>
          <Mic size={20} />
        </button>
      </div>
      </div>

      <div className="stats a-stats">
        <button className="stat" onClick={() => go('home')}>
          <div className="k">
            <TrendingUp size={13} /> {t.todaySales}
          </div>
          <div className="v num">{inr(today.sales)}</div>
        </button>
        <button className="stat" onClick={() => go('khata')}>
          <div className="k">
            <BookUser size={13} /> {t.udhaarDue}
          </div>
          <div className={`v num${ledger.totalDue > 0 ? ' bad' : ''}`}>{inr(ledger.totalDue)}</div>
        </button>
        <button className="stat" onClick={() => go('stock')}>
          <div className="k">
            <AlertTriangle size={13} /> {t.lowStock}
          </div>
          <div className={`v num${ledger.lowCount ? ' bad' : ' good'}`}>{ledger.lowCount}</div>
        </button>
      </div>

      <section className="section a-brief">
        <div className="card">
          <div className="brief">
            <button className={`play${speaker.speaking ? ' on' : ''}`} onClick={playBriefing} aria-label={speaker.speaking ? t.stop : t.play} disabled={loadingBrief}>
              {speaker.speaking ? <Pause size={20} /> : <Play size={20} style={{ marginLeft: 2 }} />}
            </button>
            <div className="txt">
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
              <span>{loadingBrief ? 'Gemini is preparing your summary…' : 'Yesterday, stock running out, udhaar due. 30 seconds.'}</span>
            </div>
          </div>
          {script && <p className="brief-script" style={{ margin: 0 }}>{script}</p>}
        </div>
      </section>

      <section className="section a-chart">
        <div className="section-head">
          <h2>{t.last7}</h2>
          <span className="aside-txt num">{inr(ledger.days.reduce((s, d) => s + d.sales, 0))}</span>
        </div>
        <div className="card">
          <div className="bars" role="img" aria-label={`Sales for the last 7 days: ${ledger.days.map((d) => `${d.label} ${inr(d.sales)}`).join(', ')}`}>
            {ledger.days.map((d, i) => {
              const isToday = i === ledger.days.length - 1;
              const isMax = d.sales === max && !isToday;
              return (
                <div className="bar-col" key={d.day}>
                  <div className="bar-track">
                    {(isToday || isMax) && <span className="bar-val num">{d.sales >= 1000 ? `${(d.sales / 1000).toFixed(1)}k` : Math.round(d.sales)}</span>}
                    <div className={`bar${isToday ? ' today' : ''}`} style={{ height: `${Math.max((d.sales / max) * 82, 2)}%`, animationDelay: `${i * 40}ms` }} />
                  </div>
                  <span className={`bar-lbl${isToday ? ' today' : ''}`}>{isToday ? 'Today' : d.label}</span>
                </div>
              );
            })}
          </div>
        </div>
      </section>

      <section className="section a-recent">
        <div className="section-head">
          <h2>{t.recent}</h2>
        </div>
        <div className="card">
          {recent.length === 0 ? (
            <div className="empty">
              <div className="ic">
                <Mic size={26} />
              </div>
              <b>{t.noEntries}</b>
              {t.noEntriesHint}
              <div style={{ marginTop: 14 }}>
                <button className="btn primary" onClick={openAdd}>
                  {t.add}
                </button>
              </div>
            </div>
          ) : (
            <ul className="rows">
              {recent.map((e) => (
                <li key={e.id}>
                  <button className="row" onClick={() => setEntry(e)}>
                    <KindIcon kind={kindOf(e)} />
                    <div className="main">
                      <div className="t">{entryTitle(e)}</div>
                      <div className="s">
                        {relTime(e.ts)}
                        {e.type === 'sale' && e.credit ? ` · udhaar · ${e.customer}` : e.supplier ? ` · ${e.supplier}` : ''}
                        {e.source === 'voice' ? ' · 🎙' : e.source === 'bill' ? ' · bill' : e.source === 'agent' ? ' · Ask Dukaan' : ''}
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
          )}
        </div>
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
