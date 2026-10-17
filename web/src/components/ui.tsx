import { ArrowDownLeft, BookUser, Check, MessageCircle, Package, Receipt, Send, Wallet, X } from 'lucide-react';
import { useEffect, type ReactNode } from 'react';
import type { WaDraft } from '../lib/agent';
import { waLink } from '../lib/agent';
import { fmtQty, inr } from '../lib/ledger';
import { useStore } from '../lib/store';
import type { Draft, Entry } from '../lib/types';

export function Sheet({ title, onClose, children, foot, full, drawer }: { title: ReactNode; onClose: () => void; children: ReactNode; foot?: ReactNode; full?: boolean; drawer?: boolean }) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);
  return (
    <>
      <div className="scrim" onClick={onClose} />
      <section className={`sheet${full ? ' full' : ''}${drawer ? ' drawer' : ''}`} role="dialog" aria-modal="true" aria-label={typeof title === 'string' ? title : undefined}>
        <div className="sheet-grab" />
        <header className="sheet-head">
          <h2>{title}</h2>
          <button className="sheet-close" onClick={onClose} aria-label="Close">
            <X size={18} />
          </button>
        </header>
        <div className="sheet-body">{children}</div>
        {foot && <footer className="sheet-foot">{foot}</footer>}
      </section>
    </>
  );
}

type Kind = 'sale' | 'purchase' | 'payment' | 'expense' | 'credit';
export const kindOf = (e: Pick<Entry, 'type' | 'credit'>): Kind => (e.type === 'sale' && e.credit ? 'credit' : e.type);

export function KindIcon({ kind, size = 18 }: { kind: Kind; size?: number }) {
  const I = { sale: ArrowDownLeft, purchase: Package, payment: Wallet, expense: Receipt, credit: BookUser }[kind];
  return (
    <span className={`chip-ic ${kind}`}>
      <I size={size} strokeWidth={2.2} />
    </span>
  );
}

export function entryTitle(e: Pick<Entry, 'type' | 'item' | 'qty' | 'unit' | 'customer' | 'note' | 'supplier' | 'credit'>) {
  if (e.type === 'payment') return `${e.customer ?? 'Customer'} paid`;
  if (e.type === 'expense') return e.note ?? 'Expense';
  const what = e.item ? `${fmtQty(e.qty, e.unit)} ${e.item}` : e.note ?? (e.type === 'sale' ? 'Sale' : 'Purchase');
  return what;
}

/** Money in is green, money out is red. Udhaar is revenue but not cash, so it stays neutral. */
export function moneyClass(e: Pick<Entry, 'type' | 'credit'>) {
  if (e.type === 'payment' || (e.type === 'sale' && !e.credit)) return 'in';
  if (e.type === 'purchase' || e.type === 'expense') return 'out';
  return '';
}
export const moneyText = (e: Pick<Entry, 'type' | 'credit' | 'amount'>) => {
  const c = moneyClass(e);
  return (c === 'in' ? '+' : c === 'out' ? '−' : '') + inr(e.amount);
};

export function DraftCards({ drafts, onChange }: { drafts: Draft[]; onChange: (d: Draft[]) => void }) {
  const { t } = useStore();
  const label = (d: Draft) => (d.type === 'sale' && d.credit ? t.udhaarSale : t[d.type]);
  return (
    <div className="dcards">
      {drafts.map((d, i) => (
        <article key={d.key} className={`dcard ${kindOf(d)}`} style={{ animationDelay: `${i * 60}ms` }}>
          <div className="type">{label(d)}</div>
          <div className="what">{entryTitle(d)}</div>
          <div className="who">
            {d.type === 'sale' && d.credit && d.customer ? `${d.customer}'s khata` : d.supplier ? `from ${d.supplier}` : d.type === 'payment' ? 'Udhaar repaid' : d.type === 'sale' ? 'Cash / UPI' : ' '}
          </div>
          <div className="right">
            <label className="amt-in num">
              <span aria-hidden>₹</span>
              <input
                inputMode="decimal"
                aria-label={`Amount for ${entryTitle(d)}`}
                value={d.amount || ''}
                onChange={(e) => {
                  const v = Number(e.target.value.replace(/[^\d.]/g, ''));
                  onChange(drafts.map((x) => (x.key === d.key ? { ...x, amount: v } : x)));
                }}
              />
            </label>
            <button className="x" aria-label={`Remove ${entryTitle(d)}`} onClick={() => onChange(drafts.filter((x) => x.key !== d.key))}>
              <X size={16} />
            </button>
          </div>
        </article>
      ))}
    </div>
  );
}

export function WaCard({ d }: { d: WaDraft }) {
  const { toast } = useStore();
  const title = d.kind === 'reminder' ? `Reminder to ${d.to}` : d.kind === 'order' ? `Order to ${d.to}` : 'Offer for customers';
  return (
    <article className="wa-card">
      <div className="top">
        <MessageCircle size={15} color="#1f9d55" /> {title}
        {d.kind === 'reminder' && !d.phone && <span className="pill warn" style={{ marginLeft: 'auto' }}>No number saved</span>}
      </div>
      <div className="bubble">{d.text}</div>
      <div className="act">
        <button
          className="btn ghost sm"
          onClick={() => {
            navigator.clipboard?.writeText(d.text).then(() => toast('Message copied'), () => toast('Copy not allowed here'));
          }}
        >
          <Check size={15} /> Copy
        </button>
        <a className="btn wa sm" href={waLink(d)} target="_blank" rel="noreferrer">
          <Send size={15} /> WhatsApp
        </a>
      </div>
    </article>
  );
}

export const initials = (name: string) =>
  name
    .split(/\s+/)
    .slice(0, 2)
    .map((w) => w[0]?.toUpperCase() ?? '')
    .join('');

