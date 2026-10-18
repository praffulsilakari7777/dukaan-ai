import { ArrowLeft, Check, CheckCheck, Image as ImageIcon, Mic, Paperclip, Send, Square } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { Logo } from '../App';
import { entryTitle } from '../components/ui';
import { askDukaan, waLink, type WaDraft } from '../lib/agent';
import { OfflineError, parseText, resizeImage, scanBill, type GeminiContent } from '../lib/api';
import { inr } from '../lib/ledger';
import { drawSampleBill, sampleBillDrafts } from '../lib/sampleBill';
import { useVoice } from '../lib/speech';
import { useStore } from '../lib/store';
import type { Draft } from '../lib/types';

type Msg =
  | { id: number; from: 'me'; kind: 'text'; text: string; ts: number }
  | { id: number; from: 'me'; kind: 'voice'; text: string; secs: number; ts: number }
  | { id: number; from: 'me'; kind: 'image'; src: string; ts: number }
  | { id: number; from: 'bot'; text: string; ts: number; drafts?: Draft[]; state?: 'pending' | 'saved' | 'cancelled'; forwards?: WaDraft[] };

type DistOmit<T> = T extends unknown ? Omit<T, 'id' | 'ts'> & { ts?: number } : never;

const SAMPLE_VOICE = 'Mohan ne 2 kilo dal udhaar liya 240';
const clock = (ts: number) => new Date(ts).toLocaleTimeString('en-IN', { hour: 'numeric', minute: '2-digit' });
const kindLabel = (d: Draft) => (d.type === 'sale' ? (d.credit ? 'Udhaar sale' : 'Sale') : d.type === 'purchase' ? 'Purchase' : d.type === 'payment' ? 'Payment in' : 'Expense');

/**
 * A working preview of Dukaan AI as a WhatsApp bot: the same Gemini pipeline,
 * in the chat the owner already uses all day. Production would run on the WhatsApp Business API.
 */
export function WhatsAppBot({ back }: { back?: () => void }) {
  const { t, settings, ledger, entries, phones, saveDrafts } = useStore();
  const [msgs, setMsgs] = useState<Msg[]>(() => [
    {
      id: 1,
      from: 'bot',
      ts: Date.now(),
      text: `Namaste ${settings.ownerName} ji! 👋 Main Dukaan AI hoon.\n\nSend me a voice note or a message like “5 kg chawal becha 300”, or a photo of a supplier bill. You can also ask anything about your shop.`,
    },
  ]);
  const [text, setText] = useState('');
  const [typing, setTyping] = useState(false);
  const history = useRef<GeminiContent[]>([]);
  const body = useRef<HTMLDivElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const recStart = useRef(0);
  const nextId = useRef(2);
  const voice = useVoice(settings.voiceLang, (spoken) => sendVoice(spoken, Math.max(1, Math.round((Date.now() - recStart.current) / 1000))));

  useEffect(() => {
    body.current?.scrollTo({ top: body.current.scrollHeight, behavior: 'smooth' });
  }, [msgs, typing]);

  const push = (m: DistOmit<Msg>) => {
    const id = nextId.current++;
    setMsgs((x) => [...x, { ...m, id, ts: m.ts ?? Date.now() } as Msg]);
    return id;
  };
  const patch = (id: number, p: Partial<Msg>) => setMsgs((x) => x.map((m) => (m.id === id ? ({ ...m, ...p } as Msg) : m)));

  const confirmText = (drafts: Draft[], intro: string) =>
    `${intro}\n\n${drafts.map((d) => `• ${kindLabel(d)} · ${entryTitle(d)}${d.customer && (d.credit || d.type === 'payment') ? ` · ${d.customer}` : ''} · ${inr(d.amount)}`).join('\n')}\n\nSave to your khata?`;

  async function handle(input: string) {
    setTyping(true);
    try {
      const r = await parseText(input, { items: ledger.stock.map((s) => s.name), customers: ledger.customers.map((c) => c.name), lang: settings.lang });
      if (r.drafts.length) {
        push({ from: 'bot', text: confirmText(r.drafts, '✅ Samajh gaya. I understood:'), drafts: r.drafts, state: 'pending' });
        return;
      }
      const { reply, history: h } = await askDukaan(input, history.current, { ledger, entries, settings, phones }, () => {});
      history.current = h.slice(-16);
      push({ from: 'bot', text: reply.answer, forwards: reply.drafts, drafts: reply.proposed.length ? reply.proposed : undefined, state: reply.proposed.length ? 'pending' : undefined });
    } catch {
      push({ from: 'bot', text: 'Sorry, something went wrong. Please send that again.' });
    } finally {
      setTyping(false);
    }
  }

  function sendText() {
    const q = text.trim();
    if (!q) return;
    setText('');
    push({ from: 'me', kind: 'text', text: q });
    handle(q);
  }

  function sendVoice(spoken: string, secs: number) {
    push({ from: 'me', kind: 'voice', text: spoken, secs });
    handle(spoken);
  }

  async function sendBill(src: string, sample: boolean) {
    push({ from: 'me', kind: 'image', src });
    setTyping(true);
    try {
      const r = await scanBill(src, ledger.stock.map((s) => s.name));
      if (!r.drafts.length) push({ from: 'bot', text: "I couldn't read items on that bill. Please send a clearer, flatter photo." });
      else push({ from: 'bot', text: confirmText(r.drafts, `🧾 Bill from ${r.supplier ?? 'your supplier'}. ${r.drafts.length} items, ${inr(r.drafts.reduce((s, d) => s + d.amount, 0))}:`), drafts: r.drafts, state: 'pending' });
    } catch (e) {
      if (e instanceof OfflineError && sample) {
        const d = sampleBillDrafts();
        push({ from: 'bot', text: confirmText(d, `🧾 Bill from Agarwal Traders. ${d.length} items:`), drafts: d, state: 'pending' });
      } else push({ from: 'bot', text: 'Bill reading needs the internet. Please try again in a moment.' });
    } finally {
      setTyping(false);
    }
  }

  function decide(m: Extract<Msg, { from: 'bot' }>, save: boolean) {
    if (!m.drafts) return;
    if (save) {
      saveDrafts(m.drafts, 'whatsapp');
      patch(m.id, { state: 'saved' });
      const total = m.drafts.reduce((s, d) => s + d.amount, 0);
      push({ from: 'bot', text: `Saved ✅ ${m.drafts.length} entr${m.drafts.length === 1 ? 'y' : 'ies'} (${inr(total)}) added. Your stock, khata and profit are updated in the app.` });
    } else {
      patch(m.id, { state: 'cancelled' });
      push({ from: 'bot', text: 'Cancelled. Nothing was saved.' });
    }
  }

  return (
    <div className="screen wa-screen">
      <header className="page-head only-narrow">
        {back && (
          <button className="back" onClick={back}>
            <ArrowLeft size={18} /> {t.home}
          </button>
        )}
        <h1>{t.waTitle}</h1>
      </header>
      <div className="wa-layout">
        <p className="wa-note">{t.waPreview}</p>
        <div className="wa-chat">
          <header className="wa-head">
            <Logo size={38} />
            <div>
              <b>Dukaan AI</b>
              <span>{typing ? 'typing…' : 'bot · replies instantly'}</span>
            </div>
          </header>
          <div className="wa-body" ref={body}>
            <div className="wa-day">Today</div>
            {msgs.map((m) =>
              m.from === 'me' ? (
                <div key={m.id} className="wa-msg me">
                  {m.kind === 'text' && <p>{m.text}</p>}
                  {m.kind === 'voice' && (
                    <>
                      <div className="wa-voice">
                        <span className="wa-play">▶</span>
                        <span className="wa-wave" aria-hidden>
                          {Array.from({ length: 22 }, (_, i) => (
                            <i key={i} style={{ height: `${6 + ((i * 37) % 17)}px` }} />
                          ))}
                        </span>
                        <span className="wa-dur num">0:{String(m.secs).padStart(2, '0')}</span>
                      </div>
                      <p className="wa-transcript">“{m.text}”</p>
                    </>
                  )}
                  {m.kind === 'image' && <img src={m.src} alt="Supplier bill photo" />}
                  <span className="wa-meta">
                    {clock(m.ts)} <CheckCheck size={14} className="wa-ticks" />
                  </span>
                </div>
              ) : (
                <div key={m.id} className="wa-msg bot">
                  <p>{m.text}</p>
                  {m.forwards?.map((f, i) => (
                    <div key={i} className="wa-fwd">
                      <span>↪ {f.kind === 'reminder' ? `Reminder for ${f.to}` : f.kind === 'order' ? `Order for ${f.to}` : 'Offer for customers'}</span>
                      <p>{f.text}</p>
                      <a href={waLink(f)} target="_blank" rel="noreferrer">
                        Forward on WhatsApp
                      </a>
                    </div>
                  ))}
                  <span className="wa-meta">{clock(m.ts)}</span>
                  {m.drafts && m.state === 'pending' && (
                    <div className="wa-quick">
                      <button onClick={() => decide(m, true)}>
                        <Check size={15} /> Save
                      </button>
                      <button onClick={() => decide(m, false)}>Cancel</button>
                    </div>
                  )}
                  {m.state === 'saved' && <span className="wa-state">✓ Saved</span>}
                  {m.state === 'cancelled' && <span className="wa-state">Cancelled</span>}
                </div>
              ),
            )}
            {typing && (
              <div className="wa-msg bot wa-typing" aria-label="Dukaan AI is typing">
                <i />
                <i />
                <i />
              </div>
            )}
          </div>
          <div className="wa-chips">
            <button onClick={() => sendVoice(SAMPLE_VOICE, 4)} disabled={typing}>
              🎙 Sample voice note
            </button>
            <button onClick={() => sendBill(drawSampleBill(), true)} disabled={typing}>
              🧾 Sample bill photo
            </button>
            <button
              onClick={() => {
                push({ from: 'me', kind: 'text', text: 'Aaj ka munafa kitna hua?' });
                handle('Aaj ka munafa kitna hua?');
              }}
              disabled={typing}
            >
              💬 Aaj ka munafa?
            </button>
          </div>
          <form
            className="wa-compose"
            onSubmit={(e) => {
              e.preventDefault();
              sendText();
            }}
          >
            <input ref={fileRef} type="file" accept="image/*" hidden onChange={async (e) => e.target.files?.[0] && sendBill(await resizeImage(e.target.files[0]), false)} />
            <button type="button" className="wa-icon" onClick={() => fileRef.current?.click()} aria-label="Send a bill photo">
              <Paperclip size={20} />
            </button>
            <input className="wa-input" value={voice.listening ? voice.transcript || 'Listening…' : text} onChange={(e) => setText(e.target.value)} placeholder="Message" aria-label="Message" readOnly={voice.listening} />
            {text.trim() ? (
              <button type="submit" className="wa-send" aria-label="Send">
                <Send size={19} />
              </button>
            ) : (
              <button
                type="button"
                className={`wa-send${voice.listening ? ' rec' : ''}`}
                aria-label={voice.listening ? 'Stop and send voice note' : 'Record a voice note'}
                onClick={() => {
                  if (!voice.listening) recStart.current = Date.now();
                  voice.toggle();
                }}
              >
                {voice.listening ? <Square size={16} /> : <Mic size={20} />}
              </button>
            )}
          </form>
          {voice.error && <p className="wa-err">{voice.error}</p>}
        </div>
        <div className="wa-side only-wide">
          <h3>Why WhatsApp</h3>
          <p>Shop owners already live in WhatsApp. No app to install, no new screen to learn: a voice note or a bill photo is enough.</p>
          <h3>What runs behind it</h3>
          <p>The same Gemini pipeline as the app: entries from speech and text, bill reading with vision, and the Ask Dukaan agent for questions. Nothing is saved until the owner taps Save.</p>
          <h3>In production</h3>
          <p>WhatsApp Business Platform webhooks into the same Cloud Run service. <ImageIcon size={13} style={{ verticalAlign: -2 }} /> Bill photos and voice notes arrive as media.</p>
        </div>
      </div>
    </div>
  );
}
