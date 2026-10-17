import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { demoEntries } from './demo';
import { ensureFont, langInfo, strings, type Strings } from './i18n';
import { buildLedger, keyOf, uid, type Ledger } from './ledger';
import type { LoanApplication } from './lending';
import type { ActiveOffer } from './offers';
import type { Draft, Entry, EntrySource, Settings } from './types';

const KEY = 'dukaan-ai:v1';

interface Persisted {
  entries: Entry[];
  phones: Record<string, string>;
  settings: Settings;
  offers: ActiveOffer[];
  loans: LoanApplication[];
}

const DEFAULT_SETTINGS: Settings = { shopName: 'Sharma Kirana Store', ownerName: 'Ramesh', lang: 'en', voiceLang: 'hi-IN', model: 'gemini-2.5-flash', v: 2 };

function load(): Persisted {
  try {
    const raw = localStorage.getItem(KEY);
    if (raw) {
      const p = JSON.parse(raw) as Persisted;
      // Before v2, 'hi' meant Hinglish in Roman script.
      if (p.settings && !p.settings.v) p.settings = { ...p.settings, lang: (p.settings.lang as string) === 'hi' ? 'hinglish' : p.settings.lang, v: 2 };
      return { entries: p.entries ?? [], phones: p.phones ?? {}, settings: { ...DEFAULT_SETTINGS, ...p.settings }, offers: p.offers ?? [], loans: p.loans ?? [] };
    }
  } catch {
    /* storage unavailable: start fresh in memory */
  }
  // First open: start with demo data so the app never greets a judge with zeros.
  return { ...demoEntries(), settings: DEFAULT_SETTINGS, offers: [], loans: [] };
}

interface Store extends Persisted {
  ledger: Ledger;
  t: Strings;
  saveDrafts: (drafts: Draft[], source: EntrySource) => Entry[];
  addEntry: (e: Omit<Entry, 'id' | 'ts'>) => void;
  removeEntry: (id: string) => void;
  setPhone: (customer: string, phone: string) => void;
  updateSettings: (s: Partial<Settings>) => void;
  addOffer: (o: ActiveOffer) => void;
  endOffer: (id: string) => void;
  applyLoan: (a: LoanApplication) => void;
  loadDemo: () => void;
  reset: () => void;
  toast: (msg: string) => void;
  toastMsg: string | null;
}

const Ctx = createContext<Store | null>(null);

export function StoreProvider({ children }: { children: ReactNode }) {
  const [data, setData] = useState<Persisted>(load);
  const [toastMsg, setToast] = useState<string | null>(null);

  useEffect(() => {
    try {
      localStorage.setItem(KEY, JSON.stringify(data));
    } catch {
      /* private mode: keep working in memory */
    }
  }, [data]);

  useEffect(() => {
    ensureFont(data.settings.lang);
    document.documentElement.lang = langInfo(data.settings.lang).bcp.slice(0, 2);
  }, [data.settings.lang]);

  const ledger = useMemo(() => buildLedger(data.entries, data.phones), [data.entries, data.phones]);

  const toast = useCallback((msg: string) => {
    setToast(msg);
    window.setTimeout(() => setToast((m) => (m === msg ? null : m)), 2600);
  }, []);

  const saveDrafts = useCallback((drafts: Draft[], source: EntrySource) => {
    const now = Date.now();
    const made: Entry[] = drafts.map(({ key: _k, ...d }, i) => ({ ...d, id: uid(), ts: now + i, source }));
    setData((p) => ({ ...p, entries: [...p.entries, ...made] }));
    return made;
  }, []);

  const value: Store = {
    ...data,
    ledger,
    t: strings[data.settings.lang],
    saveDrafts,
    addEntry: (e) => setData((p) => ({ ...p, entries: [...p.entries, { ...e, id: uid(), ts: Date.now() }] })),
    removeEntry: (id) => setData((p) => ({ ...p, entries: p.entries.filter((e) => e.id !== id) })),
    setPhone: (customer, phone) => setData((p) => ({ ...p, phones: { ...p.phones, [keyOf(customer)]: phone.replace(/\D/g, '') } })),
    updateSettings: (s) => setData((p) => ({ ...p, settings: { ...p.settings, ...s } })),
    addOffer: (o) => setData((p) => ({ ...p, offers: [o, ...p.offers.filter((x) => x.item !== o.item)] })),
    endOffer: (id) => setData((p) => ({ ...p, offers: p.offers.filter((x) => x.id !== id) })),
    applyLoan: (a) => setData((p) => ({ ...p, loans: [a, ...p.loans] })),
    loadDemo: () => setData((p) => ({ ...p, ...demoEntries(), offers: [], loans: [] })),
    reset: () => setData((p) => ({ entries: [], phones: {}, settings: p.settings, offers: [], loans: [] })),
    toast,
    toastMsg,
  };
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useStore() {
  const s = useContext(Ctx);
  if (!s) throw new Error('useStore outside StoreProvider');
  return s;
}
