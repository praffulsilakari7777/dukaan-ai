import { ArrowUp, Check, Clock, MessageCircle, Mic, PackageSearch, Sparkles, TrendingUp, Wand2 } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { DraftCards, Sheet, WaCard } from '../components/ui';
import { askDukaan, type AgentReply, type AgentStep } from '../lib/agent';
import type { GeminiContent } from '../lib/api';
import { useVoice } from '../lib/speech';
import { useStore } from '../lib/store';
import type { Draft } from '../lib/types';

const SUGGESTIONS = [
  { icon: Clock, q: "Who hasn't paid udhaar in 30 days, and what's running out?" },
  { icon: TrendingUp, q: 'Which item made the most profit this week?' },
  { icon: MessageCircle, q: 'Send reminders to everyone who owes me money' },
  { icon: PackageSearch, q: 'Make a sugar and dal order for my supplier' },
  { icon: Wand2, q: 'Write a WhatsApp offer for my slowest item' },
];

interface Turn {
  id: number;
  q: string;
  steps: AgentStep[];
  reply?: AgentReply;
  pending: Draft[];
  saved?: boolean;
  error?: string;
}

const fmtArgs = (a: Record<string, unknown>) =>
  Object.entries(a)
    .filter(([k]) => k !== 'message')
    .map(([k, v]) => `${k}: ${typeof v === 'object' ? (Array.isArray(v) ? `[${v.length}]` : '{…}') : JSON.stringify(v)}`)
    .join(', ');

export function AskSheet({ onClose, startVoice, initial }: { onClose: () => void; startVoice?: boolean; initial?: string }) {
  const store = useStore();
  const { t, settings, ledger, entries, phones, saveDrafts, toast } = store;
  const [turns, setTurns] = useState<Turn[]>([]);
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const history = useRef<GeminiContent[]>([]);
  const end = useRef<HTMLDivElement>(null);
  const voice = useVoice(settings.voiceLang, (s) => ask(s));

  useEffect(() => {
    if (initial) ask(initial);
    else if (startVoice) voice.start();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  useEffect(() => {
    end.current?.scrollIntoView({ behavior: 'smooth', block: 'end' });
  }, [turns, busy]);

  async function ask(q: string) {
    const question = q.trim();
    if (!question || busy) return;
    setText('');
    setBusy(true);
    const id = Date.now();
    setTurns((ts) => [...ts, { id, q: question, steps: [], pending: [] }]);
    const patch = (fn: (t: Turn) => Turn) => setTurns((ts) => ts.map((x) => (x.id === id ? fn(x) : x)));
    try {
      const { reply, history: h } = await askDukaan(question, history.current, { ledger, entries, settings, phones }, (s) => patch((x) => ({ ...x, steps: [...x.steps, s] })));
      history.current = h.slice(-16);
      patch((x) => ({ ...x, steps: reply.steps, reply, pending: reply.proposed }));
    } catch (e) {
      patch((x) => ({ ...x, error: 'Something went wrong. Please ask again.' }));
      console.error(e);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Sheet
      title={
        <span style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <Sparkles size={18} color="var(--brand)" /> {t.askTitle}
        </span>
      }
      onClose={onClose}
      full
      drawer
      foot={
        <form
          className="composer"
          style={{ flex: 1 }}
          onSubmit={(e) => {
            e.preventDefault();
            ask(text);
          }}
        >
          <textarea
            rows={1}
            value={voice.listening ? voice.transcript : text}
            placeholder={voice.listening ? t.listening : t.askPlaceholder}
            onChange={(e) => setText(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                ask(text);
              }
            }}
            aria-label={t.askPlaceholder}
          />
          <button type="button" className="send" style={{ background: voice.listening ? 'var(--bad)' : 'var(--brand-50)', color: voice.listening ? '#fff' : 'var(--brand)' }} onClick={voice.toggle} aria-label="Ask by voice" disabled={busy}>
            <Mic size={18} />
          </button>
          <button className="send" type="submit" disabled={!text.trim() || busy} aria-label="Ask">
            <ArrowUp size={19} />
          </button>
        </form>
      }
    >
      {turns.length === 0 && (
        <>
          <div className="ask-intro">
            <div className="orb">
              <Sparkles size={28} />
            </div>
            <b>Your shop, answered.</b>
            <p>Ask in any language. Dukaan checks your own ledger, then answers or drafts the message.</p>
          </div>
          <div className="suggest">
            {SUGGESTIONS.map(({ icon: I, q }) => (
              <button key={q} onClick={() => ask(q)}>
                <I size={18} /> {q}
              </button>
            ))}
          </div>
          {voice.error && <div className="err">{voice.error}</div>}
        </>
      )}

      <div className="chat">
        {turns.map((turn) => (
          <div key={turn.id} style={{ display: 'grid', gap: 10 }}>
            <div className="msg-u">{turn.q}</div>
            <div className="msg-a">
              {turn.steps.length > 0 && (
                <div className="steps" aria-label="Tools the agent used">
                  {turn.steps.map((s, i) => (
                    <div className="step" key={i} style={{ animationDelay: `${i * 80}ms` }}>
                      <span className="tick">
                        <Check size={12} strokeWidth={3} />
                      </span>
                      <code>
                        {s.tool}
                        <i>({fmtArgs(s.args)})</i>
                      </code>
                      <span className="res">→ {s.summary}</span>
                    </div>
                  ))}
                </div>
              )}
              {!turn.reply && !turn.error && (
                <div className="thinking" aria-label="Thinking">
                  <i />
                  <i />
                  <i />
                </div>
              )}
              {turn.error && <div className="err">{turn.error}</div>}
              {turn.reply && (
                <>
                  <div className="answer">{turn.reply.answer}</div>
                  {turn.reply.drafts.map((d, i) => (
                    <WaCard key={i} d={d} />
                  ))}
                  {turn.pending.length > 0 && !turn.saved && (
                    <div className="card card-pad" style={{ display: 'grid', gap: 10 }}>
                      <DraftCards drafts={turn.pending} onChange={(p) => setTurns((ts) => ts.map((x) => (x.id === turn.id ? { ...x, pending: p } : x)))} />
                      <button
                        className="btn primary block"
                        onClick={() => {
                          saveDrafts(turn.pending, 'agent');
                          toast(t.saved);
                          setTurns((ts) => ts.map((x) => (x.id === turn.id ? { ...x, saved: true } : x)));
                        }}
                      >
                        <Check size={18} /> {t.saveAll}
                      </button>
                    </div>
                  )}
                  {turn.saved && <span className="pill good" style={{ width: 'fit-content' }}>✓ {t.saved}</span>}
                  <div className="by">
                    <Sparkles size={11} /> {turn.reply.by === 'gemini' ? `Gemini · ${turn.reply.steps.length} tool call${turn.reply.steps.length === 1 ? '' : 's'}` : 'Offline agent'}
                  </div>
                </>
              )}
            </div>
          </div>
        ))}
        <div ref={end} />
      </div>
    </Sheet>
  );
}
