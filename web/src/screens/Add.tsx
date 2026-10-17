import { Camera, Check, FileImage, ImageUp, Keyboard, Loader2, Mic, ScanLine, Send, Sparkles } from 'lucide-react';
import { useRef, useState } from 'react';
import { DraftCards, Sheet } from '../components/ui';
import { OfflineError, parseText, resizeImage, scanBill } from '../lib/api';
import { inr } from '../lib/ledger';
import { drawSampleBill, sampleBillDrafts, SAMPLE_SUPPLIER } from '../lib/sampleBill';
import { useVoice } from '../lib/speech';
import { useStore } from '../lib/store';
import type { Draft, EntrySource } from '../lib/types';

const EXAMPLES = [
  '5 kg chawal becha 300 mein',
  'Ramesh ne 2 kg dal udhaar liya 240',
  'Sunita Devi ne 500 jama kiye',
  '20 kg atta kharida 700 mein',
  '2 packet maggi 28 aur 1 litre tel 165 becha',
  'bijli bill 1200 kharcha',
];

type Mode = 'speak' | 'bill';

export function AddSheet({ onClose }: { onClose: () => void }) {
  const store = useStore();
  const { t, settings, ledger, saveDrafts, toast } = store;
  const [mode, setMode] = useState<Mode>('speak');
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [drafts, setDrafts] = useState<Draft[] | null>(null);
  const [said, setSaid] = useState('');
  const [by, setBy] = useState<'gemini' | 'offline'>('gemini');
  const [source, setSource] = useState<EntrySource>('text');
  const [photo, setPhoto] = useState<string | null>(null);
  const [isSample, setIsSample] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);
  const camRef = useRef<HTMLInputElement>(null);

  const voice = useVoice(settings.voiceLang, (spoken) => understand(spoken, 'voice'));

  async function understand(input: string, src: EntrySource) {
    const q = input.trim();
    if (!q) return;
    setBusy(true);
    setError(null);
    setSaid(q);
    try {
      const r = await parseText(q, { items: ledger.stock.map((s) => s.name), customers: ledger.customers.map((c) => c.name), lang: settings.lang });
      if (!r.drafts.length) {
        setError(t.nothingFound);
      } else {
        setDrafts(r.drafts);
        setBy(r.by);
        setSource(src);
        setText('');
      }
    } catch {
      setError('Something went wrong. Please try again.');
    } finally {
      setBusy(false);
    }
  }

  async function pickPhoto(file?: File) {
    if (!file) return;
    setError(null);
    setIsSample(false);
    setPhoto(await resizeImage(file));
  }

  async function scan() {
    if (!photo) return;
    setBusy(true);
    setError(null);
    try {
      const r = await scanBill(photo);
      if (!r.drafts.length) setError("Couldn't read any items on this bill. Try a clearer, flatter photo.");
      else {
        setDrafts(r.drafts);
        setBy('gemini');
        setSaid(`Bill from ${r.supplier ?? 'supplier'}`);
        setSource('bill');
      }
    } catch (e) {
      if (e instanceof OfflineError && isSample) {
        setDrafts(sampleBillDrafts());
        setBy('offline');
        setSaid(`Bill from ${SAMPLE_SUPPLIER}`);
        setSource('bill');
      } else setError(e instanceof OfflineError ? 'Bill scanning needs the internet and Gemini. Check your connection and try again.' : 'Could not scan this bill. Please try again.');
    } finally {
      setBusy(false);
    }
  }

  function save() {
    if (!drafts?.length) return;
    const valid = drafts.filter((d) => d.amount > 0);
    saveDrafts(valid, source);
    toast(`${t.saved} · ${valid.length} entr${valid.length === 1 ? 'y' : 'ies'}`);
    onClose();
  }

  if (drafts) {
    const total = drafts.reduce((s, d) => s + (d.amount || 0), 0);
    return (
      <Sheet
        title={t.check}
        onClose={onClose}
        full
        foot={
          <>
            <button
              className="btn ghost"
              onClick={() => {
                setDrafts(null);
                setPhoto(null);
              }}
            >
              {t.discard}
            </button>
            <button className="btn primary" style={{ flex: 1 }} onClick={save} disabled={!drafts.length}>
              <Check size={18} /> {t.saveAll} · <span className="num">{inr(total)}</span>
            </button>
          </>
        }
      >
        <div className="confirm-head">
          <span className="ai">
            <Sparkles size={18} />
          </span>
          <div>
            <b>
              {drafts.length} entr{drafts.length === 1 ? 'y' : 'ies'} understood
            </b>
            <span>
              {t.checkSub} {by === 'offline' && '· offline parser'}
            </span>
          </div>
        </div>
        <div className="said">“{said}”</div>
        <DraftCards drafts={drafts} onChange={setDrafts} />
        {!drafts.length && <div className="empty">All cards removed. Discard and try again.</div>}
      </Sheet>
    );
  }

  return (
    <Sheet title={t.add} onClose={onClose} full>
      <div className="seg" role="tablist">
        <button role="tab" aria-selected={mode === 'speak'} className={mode === 'speak' ? 'on' : ''} onClick={() => setMode('speak')}>
          <Mic size={16} /> {t.speak} / {t.type}
        </button>
        <button role="tab" aria-selected={mode === 'bill'} className={mode === 'bill' ? 'on' : ''} onClick={() => setMode('bill')}>
          <ScanLine size={16} /> {t.bill}
        </button>
      </div>

      {mode === 'speak' ? (
        <>
          <div className="voice">
            <button className={`mic${voice.listening ? ' rec' : ''}`} onClick={voice.toggle} disabled={busy} aria-label={voice.listening ? 'Stop listening' : t.tapToSpeak}>
              {busy ? <Loader2 size={38} className="spin" /> : <Mic size={40} strokeWidth={2} />}
            </button>
            <div className="hint">{busy ? t.understanding : voice.listening ? t.listening : t.tapToSpeak}</div>
            <div className={`transcript${voice.transcript || said ? '' : ' dim'}`} aria-live="polite">
              {voice.transcript || (busy ? `“${said}”` : 'Hindi, Hinglish, English and 5 more languages')}
            </div>
          </div>
          {(voice.error || error) && <div className="err">{voice.error ?? error}</div>}

          <div className="label-sm">
            <Keyboard size={12} style={{ verticalAlign: -1 }} /> {t.typeHint}
          </div>
          <form
            className="composer"
            onSubmit={(e) => {
              e.preventDefault();
              understand(text, 'text');
            }}
          >
            <textarea
              rows={1}
              value={text}
              placeholder="e.g. 3 kg cheeni becha 144"
              onChange={(e) => setText(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && !e.shiftKey) {
                  e.preventDefault();
                  understand(text, 'text');
                }
              }}
              aria-label={t.typeHint}
            />
            <button className="send" type="submit" disabled={!text.trim() || busy} aria-label={t.understand}>
              <Send size={18} />
            </button>
          </form>

          <div className="label-sm">{t.tryThese}</div>
          <div className="chips wrap">
            {EXAMPLES.map((ex) => (
              <button key={ex} className="chip" onClick={() => understand(ex, 'text')} disabled={busy}>
                {ex}
              </button>
            ))}
          </div>
        </>
      ) : (
        <>
          <input ref={camRef} type="file" accept="image/*" capture="environment" hidden onChange={(e) => pickPhoto(e.target.files?.[0])} />
          <input ref={fileRef} type="file" accept="image/*" hidden onChange={(e) => pickPhoto(e.target.files?.[0])} />
          {!photo ? (
            <div className="bill-drop">
              <div className="ic">
                <FileImage size={28} />
              </div>
              <b style={{ display: 'block', fontSize: 15, marginBottom: 4 }}>Photograph a supplier bill</b>
              <p>Gemini reads every line item and adds it to your stock as a purchase.</p>
              <div className="bill-actions">
                <button className="btn primary" onClick={() => camRef.current?.click()}>
                  <Camera size={18} /> {t.takePhoto}
                </button>
                <button className="btn ghost" onClick={() => fileRef.current?.click()}>
                  <ImageUp size={18} /> {t.upload}
                </button>
              </div>
              <button
                className="btn ghost sm"
                style={{ marginTop: 14 }}
                onClick={() => {
                  setPhoto(drawSampleBill());
                  setIsSample(true);
                }}
              >
                {t.sampleBill}
              </button>
            </div>
          ) : (
            <>
              <div className="bill-preview">
                <img src={photo} alt="Bill to scan" />
                {busy && <div className="scanline" />}
              </div>
              {error && <div className="err">{error}</div>}
              <div className="row-inline" style={{ marginTop: 12 }}>
                <button className="btn ghost" onClick={() => setPhoto(null)} disabled={busy}>
                  {t.retake}
                </button>
                <button className="btn primary" style={{ flex: 1 }} onClick={scan} disabled={busy}>
                  {busy ? (
                    <>
                      <Loader2 size={18} className="spin" /> {t.scanning}
                    </>
                  ) : (
                    <>
                      <ScanLine size={18} /> {t.scanBill}
                    </>
                  )}
                </button>
              </div>
            </>
          )}
        </>
      )}
    </Sheet>
  );
}
