import { BookUser, Check, MessageCircle } from 'lucide-react';
import { useState } from 'react';
import { initials, Sheet } from '../components/ui';
import { waLink } from '../lib/agent';
import { daysSince, inr, relTime } from '../lib/ledger';
import { useStore } from '../lib/store';
import { tf } from '../lib/i18n';
import { useWide } from '../lib/useWide';
import type { Customer } from '../lib/types';

export function Khata() {
  const { ledger, t } = useStore();
  const wide = useWide();
  const [open, setOpen] = useState<string | null>(null);
  const owing = ledger.customers.filter((c) => c.due > 0);
  const current = open ? ledger.customers.find((c) => c.key === open) : wide ? ledger.customers[0] : null;

  return (
    <div className="screen">
      <header className="page-head">
        <h1 className="only-narrow">{t.khata}</h1>
        <div className="lead">
          <span className="big num" style={{ color: ledger.totalDue ? 'var(--bad)' : undefined }}>
            {inr(ledger.totalDue)}
          </span>
          <span className="cap">
            {t.toCollect} · {owing.length} {t.customers}
          </span>
        </div>
      </header>

      <div className={`section${wide ? ' split' : ''}`} style={{ marginTop: 0 }}>
        <div className="card">
          {ledger.customers.length === 0 ? (
            <div className="empty">
              <div className="ic">
                <BookUser size={26} />
              </div>
              <b>{t.noCustomers}</b>
              {t.noCustomersHint}
            </div>
          ) : (
            <ul className="rows">
              {ledger.customers.map((c) => {
                const since = daysSince(c.lastPaymentTs || c.history[c.history.length - 1]?.ts || 0);
                return (
                  <li key={c.key}>
                    <button className={`row${wide && current?.key === c.key ? ' sel' : ''}`} onClick={() => setOpen(c.key)}>
                      <span className="avatar">{initials(c.name)}</span>
                      <div className="main">
                        <div className="t">{c.name}</div>
                        <div className="s">
                          {c.lastPaymentTs ? `${t.lastPaid} ${relTime(c.lastPaymentTs).toLowerCase()}` : c.due > 0 ? `${t.neverPaid} · ${since}` : t.clear}
                        </div>
                      </div>
                      <div style={{ textAlign: 'right' }}>
                        <div className={`amt num${c.due > 0 ? ' out' : ''}`}>{inr(Math.max(c.due, 0))}</div>
                        <div style={{ marginTop: 4 }}>
                          <span className={`pill ${c.due > 0 ? (since >= 30 ? 'bad' : 'warn') : 'good'}`}>{c.due > 0 ? (since >= 30 ? tf(t.overdueDays, { n: since }) : t.lenaHai) : t.clear}</span>
                        </div>
                      </div>
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
        </div>
        {wide && current && (
          <div className="card detail">
            <CustomerDetail c={current} />
          </div>
        )}
      </div>
      {!wide && current && <CustomerSheet c={current} onClose={() => setOpen(null)} />}
    </div>
  );
}

function CustomerSheet({ c, onClose }: { c: Customer; onClose: () => void }) {
  return (
    <Sheet title={c.name} onClose={onClose} full>
      <CustomerDetail c={c} />
    </Sheet>
  );
}

function CustomerDetail({ c }: { c: Customer }) {
  const { t, addEntry, setPhone, toast, settings } = useStore();
  const [amt, setAmt] = useState('');
  const [phone, setPhoneInput] = useState(c.phone ?? '');

  const jama = () => {
    const v = Number(amt);
    if (!(v > 0)) return;
    addEntry({ type: 'payment', amount: v, customer: c.name, source: 'manual' });
    toast(`${inr(v)} jama · ${c.name}`);
    setAmt('');
  };
  const reminder = {
    kind: 'reminder' as const,
    to: c.name,
    phone: phone.replace(/\D/g, '') ? (phone.replace(/\D/g, '').length === 10 ? '91' + phone.replace(/\D/g, '') : phone.replace(/\D/g, '')) : undefined,
    text: `Namaste ${c.name} ji, ${settings.shopName} mein aapka ${inr(c.due)} udhaar baaki hai. Jab suvidha ho, jama kar dijiye. Dhanyavaad!`,
  };

  return (
    <div key={c.key}>
      <div className="detail-head">
        <span className="avatar lg">{initials(c.name)}</span>
        <div>
          <h2>{c.name}</h2>
          <span>{t.history} · {c.history.length}</span>
        </div>
      </div>
      <div className="balance">
        <div className="k">{t.balance}</div>
        <div className={`v num ${c.due > 0 ? 'bad' : 'good'}`}>{inr(Math.max(c.due, 0))}</div>
        {c.due <= 0 && <span className="pill good">{t.clear}</span>}
      </div>

      <div className="card card-pad">
        <label className="field" style={{ marginBottom: 0 }}>
          <span>{t.recordPayment}</span>
          <form
            className="row-inline"
            onSubmit={(e) => {
              e.preventDefault();
              jama();
            }}
          >
            <input className="input num" inputMode="decimal" placeholder={`${t.amount} (₹)`} value={amt} onChange={(e) => setAmt(e.target.value.replace(/[^\d.]/g, ''))} />
            <button className="btn primary" type="submit" disabled={!(Number(amt) > 0)}>
              <Check size={18} /> {t.jama}
            </button>
          </form>
        </label>
        {c.due > 0 && (
          <div className="chips" style={{ marginTop: 10 }}>
            {[c.due, Math.round(c.due / 2), 100, 500].filter((v, i, a) => v > 0 && a.indexOf(v) === i).map((v) => (
              <button key={v} className="chip num" onClick={() => setAmt(String(v))}>
                {v === c.due ? `Full ${inr(v)}` : inr(v)}
              </button>
            ))}
          </div>
        )}
      </div>

      {c.due > 0 && (
        <div className="card card-pad" style={{ marginTop: 12 }}>
          <label className="field" style={{ marginBottom: 0 }}>
            <span>{t.phone}</span>
            <input className="input num" inputMode="tel" placeholder="98765 43210" value={phone} onChange={(e) => setPhoneInput(e.target.value)} onBlur={() => phone && setPhone(c.name, phone.replace(/\D/g, '').length === 10 ? '91' + phone.replace(/\D/g, '') : phone)} />
          </label>
        </div>
      )}

      <div className="label-sm">{t.history}</div>
      <div className="card">
        <ul className="rows">
          {c.history.map((h) => (
            <li key={h.id} className="row">
              <div className="main">
                <div className="t">{h.kind === 'payment' ? t.jama : h.label}</div>
                <div className="s">{new Date(h.ts).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' })}</div>
              </div>
              <div className={`amt num ${h.kind === 'payment' ? 'in' : 'out'}`}>
                {h.kind === 'payment' ? '−' : '+'}
                {inr(h.amount)}
              </div>
            </li>
          ))}
        </ul>
      </div>
      {c.due > 0 && (
        <a
          className="btn wa block"
          style={{ marginTop: 16 }}
          href={waLink(reminder)}
          target="_blank"
          rel="noreferrer"
          onClick={() => {
            if (reminder.phone && reminder.phone !== c.phone) setPhone(c.name, reminder.phone);
          }}
        >
          <MessageCircle size={18} /> {t.remind}
        </a>
      )}
    </div>
  );
}
