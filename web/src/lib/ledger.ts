import type { Customer, DaySummary, Entry, Score, StockItem } from './types';

const DAY = 86_400_000;

const ALIASES: Record<string, string> = {
  chawal: 'Rice', chaawal: 'Rice', rice: 'Rice', basmati: 'Basmati Rice',
  dal: 'Dal', daal: 'Dal', 'toor dal': 'Toor Dal', 'moong dal': 'Moong Dal', 'chana dal': 'Chana Dal',
  cheeni: 'Sugar', chini: 'Sugar', shakkar: 'Sugar', sugar: 'Sugar',
  aata: 'Atta', atta: 'Atta', ata: 'Atta', maida: 'Maida', besan: 'Besan', sooji: 'Sooji', suji: 'Sooji',
  tel: 'Oil', oil: 'Oil', 'sarson tel': 'Mustard Oil', 'mustard oil': 'Mustard Oil',
  namak: 'Salt', salt: 'Salt', doodh: 'Milk', dudh: 'Milk', milk: 'Milk',
  sabun: 'Soap', soap: 'Soap', chai: 'Tea', 'chai patti': 'Tea', tea: 'Tea',
  biscuit: 'Biscuits', biscuits: 'Biscuits', maggi: 'Maggi', anda: 'Eggs', ande: 'Eggs', eggs: 'Eggs', egg: 'Eggs',
  ghee: 'Ghee', haldi: 'Haldi', mirch: 'Chilli Powder', masala: 'Masala', poha: 'Poha', bread: 'Bread',
  paneer: 'Paneer', dahi: 'Curd', makhan: 'Butter', butter: 'Butter', surf: 'Detergent', detergent: 'Detergent',
};

const UNIT_ALIASES: Record<string, string> = {
  kg: 'kg', kilo: 'kg', kgs: 'kg', g: 'g', gm: 'g', gram: 'g', grams: 'g',
  l: 'L', ltr: 'L', litre: 'L', liter: 'L', litres: 'L', ml: 'ml',
  packet: 'pkt', packets: 'pkt', pkt: 'pkt', pack: 'pkt', pc: 'pc', pcs: 'pc', piece: 'pc', pieces: 'pc',
  dozen: 'dozen', darjan: 'dozen', bottle: 'bottle', bottles: 'bottle', box: 'box', bag: 'bag', bori: 'bag',
};

export const titleCase = (s: string) =>
  s.trim().replace(/\s+/g, ' ').toLowerCase().replace(/(^|\s)\S/g, (c) => c.toUpperCase());

export function canonicalItem(raw: string): string {
  const k = raw.trim().toLowerCase().replace(/\s+/g, ' ');
  return ALIASES[k] ?? titleCase(k);
}

export function canonicalUnit(raw?: string): string {
  if (!raw) return 'pc';
  return UNIT_ALIASES[raw.trim().toLowerCase()] ?? raw.trim().toLowerCase();
}

export const keyOf = (s: string) => s.trim().toLowerCase().replace(/\s+/g, ' ');

export const dayKey = (ts: number) => {
  const d = new Date(ts);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};

export const startOfDay = (ts = Date.now()) => {
  const d = new Date(ts);
  d.setHours(0, 0, 0, 0);
  return d.getTime();
};

export interface Ledger {
  stock: StockItem[];
  customers: Customer[];
  days: DaySummary[];
  /** Profit recognised on each sale, by entry id. */
  saleProfit: Record<string, number>;
  today: { sales: number; profit: number; expenses: number; purchases: number; received: number; count: number };
  totalDue: number;
  lowCount: number;
  stockValue: number;
  score: Score;
}

/** Replays every entry in time order and derives the whole shop from it. */
export function buildLedger(entries: Entry[], phones: Record<string, string>, now = Date.now()): Ledger {
  const sorted = [...entries].sort((a, b) => a.ts - b.ts);
  const items = new Map<string, StockItem>();
  const customers = new Map<string, Customer>();
  const saleProfit: Record<string, number> = {};
  const byDay = new Map<string, { sales: number; profit: number }>();
  const t0 = startOfDay(now);
  const today = { sales: 0, profit: 0, expenses: 0, purchases: 0, received: 0, count: 0 };
  const soldWindow = new Map<string, number>();
  const restocks = new Map<string, number>();
  // Stock is sold oldest batch first, so we know what is left and when it expires.
  const batches = new Map<string, { qty: number; ts: number; expiry?: number }[]>();

  const item = (name: string, unit?: string) => {
    const key = keyOf(name);
    let it = items.get(key);
    if (!it) {
      it = { key, name, unit: unit ?? 'pc', qty: 0, avgCost: 0, lastPrice: 0, velocity: 0, daysLeft: Infinity, low: false, daily: false, value: 0, profit7: 0, sold7: 0, lastSoldTs: 0, expiringQty: 0, oldestBatchTs: 0 };
      items.set(key, it);
    }
    if (unit && it.unit === 'pc' && unit !== 'pc') it.unit = unit;
    return it;
  };
  const customer = (name: string) => {
    const key = keyOf(name);
    let c = customers.get(key);
    if (!c) {
      c = { key, name: titleCase(name).replace(/ Ji$/, ' ji'), due: 0, phone: phones[key], lastCreditTs: 0, lastPaymentTs: 0, history: [] };
      customers.set(key, c);
    }
    return c;
  };

  for (const e of sorted) {
    const isToday = e.ts >= t0;
    if (isToday) today.count++;
    if (e.type === 'purchase') {
      if (isToday) today.purchases += e.amount;
      if (e.item && e.qty) {
        const it = item(e.item, e.unit);
        const base = Math.max(it.qty, 0);
        const newQty = base + e.qty;
        it.avgCost = newQty > 0 ? (base * it.avgCost + e.amount) / newQty : it.avgCost;
        it.qty = it.qty + e.qty;
        const b = batches.get(it.key) ?? [];
        b.push({ qty: e.qty, ts: e.ts, expiry: e.expiry });
        batches.set(it.key, b);
        if (now - e.ts <= 14 * DAY) restocks.set(it.key, (restocks.get(it.key) ?? 0) + 1);
      }
    } else if (e.type === 'sale') {
      let cost = e.amount * 0.85; // unknown cost: assume a typical 15% kirana margin
      if (e.item) {
        const it = item(e.item, e.unit);
        const q = e.qty ?? 1;
        if (it.avgCost > 0) cost = q * it.avgCost;
        it.qty -= q;
        let left = q;
        for (const b of batches.get(it.key) ?? []) {
          if (left <= 0) break;
          const take = Math.min(b.qty, left);
          b.qty -= take;
          left -= take;
        }
        it.lastPrice = e.amount / q;
        it.lastSoldTs = e.ts;
        if (now - e.ts <= 14 * DAY) soldWindow.set(it.key, (soldWindow.get(it.key) ?? 0) + q);
        if (now - e.ts <= 7 * DAY) {
          it.profit7 += e.amount - cost;
          it.sold7 += e.amount;
        }
      }
      const profit = e.amount - cost;
      saleProfit[e.id] = profit;
      const d = byDay.get(dayKey(e.ts)) ?? { sales: 0, profit: 0 };
      d.sales += e.amount;
      d.profit += profit;
      byDay.set(dayKey(e.ts), d);
      if (isToday) {
        today.sales += e.amount;
        today.profit += profit;
        if (!e.credit) today.received += e.amount;
      }
      if (e.credit && e.customer) {
        const c = customer(e.customer);
        c.due += e.amount;
        c.lastCreditTs = e.ts;
        c.history.push({ id: e.id, ts: e.ts, kind: 'credit', amount: e.amount, label: e.item ? `${fmtQty(e.qty, e.unit)} ${e.item}` : 'Udhaar' });
      }
    } else if (e.type === 'payment') {
      if (isToday) today.received += e.amount;
      if (e.customer) {
        const c = customer(e.customer);
        c.due -= e.amount;
        c.lastPaymentTs = e.ts;
        c.history.push({ id: e.id, ts: e.ts, kind: 'payment', amount: e.amount, label: 'Jama' });
      }
    } else if (e.type === 'expense') {
      if (isToday) today.expenses += e.amount;
      const d = byDay.get(dayKey(e.ts)) ?? { sales: 0, profit: 0 };
      d.profit -= e.amount;
      byDay.set(dayKey(e.ts), d);
    }
  }
  today.profit -= today.expenses;

  for (const it of items.values()) {
    const onShelf = (batches.get(it.key) ?? []).filter((b) => b.qty > 0.0001);
    it.oldestBatchTs = onShelf[0]?.ts ?? 0;
    const exp = onShelf.filter((b) => b.expiry).sort((a, b) => a.expiry! - b.expiry!);
    it.nextExpiry = exp[0]?.expiry;
    it.expiringQty = exp.filter((b) => b.expiry! - now <= 7 * DAY).reduce((s, b) => s + b.qty, 0);
    it.velocity = (soldWindow.get(it.key) ?? 0) / 14;
    it.daysLeft = it.velocity > 0 ? Math.max(it.qty, 0) / it.velocity : Infinity;
    // Milk and bread arrive every morning; only flag them when the shelf is actually bare.
    const daily = (it.daily = (restocks.get(it.key) ?? 0) >= 7);
    it.low = it.qty <= 0 || (daily ? it.qty < it.velocity * 0.5 : it.velocity > 0 ? it.daysLeft < 4 : it.qty <= 2);
    it.value = Math.max(it.qty, 0) * it.avgCost;
  }

  const days: DaySummary[] = [];
  for (let i = 6; i >= 0; i--) {
    const ts = t0 - i * DAY;
    const d = byDay.get(dayKey(ts)) ?? { sales: 0, profit: 0 };
    days.push({ day: dayKey(ts), label: new Date(ts).toLocaleDateString('en-IN', { weekday: 'short' }), ...d });
  }

  const stock = [...items.values()].sort((a, b) => Number(b.low) - Number(a.low) || Number(a.daily) - Number(b.daily) || a.daysLeft - b.daysLeft || a.name.localeCompare(b.name));
  const custList = [...customers.values()]
    .map((c) => ({ ...c, due: Math.round(c.due), history: c.history.sort((a, b) => b.ts - a.ts) }))
    .sort((a, b) => b.due - a.due);

  return {
    stock,
    customers: custList,
    days,
    saleProfit,
    today,
    totalDue: custList.reduce((s, c) => s + Math.max(c.due, 0), 0),
    lowCount: stock.filter((s) => s.low).length,
    stockValue: stock.reduce((s, i) => s + i.value, 0),
    score: computeScore(sorted, byDay, now),
  };
}

/** Dukaan Score, 300–900: active days 35%, sales volume 25%, udhaar collected 25%, profitability 15%. */
function computeScore(entries: Entry[], byDay: Map<string, { sales: number; profit: number }>, now: number): Score {
  const since = now - 30 * DAY;
  const recent = entries.filter((e) => e.ts >= since);
  const activeDays = new Set(recent.map((e) => dayKey(e.ts))).size;
  const sales = recent.filter((e) => e.type === 'sale').reduce((s, e) => s + e.amount, 0);
  const creditGiven = recent.filter((e) => e.type === 'sale' && e.credit).reduce((s, e) => s + e.amount, 0);
  const collected = recent.filter((e) => e.type === 'payment').reduce((s, e) => s + e.amount, 0);
  let profit = 0;
  for (const [k, v] of byDay) if (k >= dayKey(since)) profit += v.profit;

  const avgDaily = sales / 30;
  const parts = [
    { label: 'Active days', weight: 0.35, value: Math.min(activeDays / 26, 1) },
    { label: 'Sales volume', weight: 0.25, value: Math.min(avgDaily / 5000, 1) },
    { label: 'Udhaar collected', weight: 0.25, value: creditGiven > 0 ? Math.min(collected / creditGiven, 1) : recent.length ? 1 : 0 },
    { label: 'Profitability', weight: 0.15, value: sales > 0 ? Math.max(0, Math.min(profit / sales / 0.18, 1)) : 0 },
  ];
  const raw = parts.reduce((s, p) => s + p.weight * p.value, 0);
  const value = recent.length ? Math.round(300 + 600 * raw) : 300;
  const band = value >= 700 ? 'high' : value >= 550 ? 'mid' : 'low';
  const loan = value < 550 ? 0 : Math.round((avgDaily * 30 * 0.6 * ((value - 500) / 400)) / 5000) * 5000;
  return { value, band, loan: Math.max(loan, value >= 550 ? 10000 : 0), parts };
}

export const inr = (n: number, opts: { sign?: boolean } = {}) => {
  const v = Math.round(n);
  const s = '₹' + Math.abs(v).toLocaleString('en-IN');
  if (v < 0) return '−' + s;
  return opts.sign && v > 0 ? '+' + s : s;
};

export const fmtQty = (qty?: number, unit?: string) => {
  if (qty == null) return '';
  const q = Number.isInteger(qty) ? String(qty) : qty.toFixed(1).replace(/\.0$/, '');
  return `${q} ${unit ?? ''}`.trim();
};

export const relTime = (ts: number, now = Date.now()) => {
  const diff = now - ts;
  if (diff < 60_000) return 'just now';
  if (diff < 3_600_000) return `${Math.floor(diff / 60_000)} min ago`;
  if (ts >= startOfDay(now)) return new Date(ts).toLocaleTimeString('en-IN', { hour: 'numeric', minute: '2-digit' });
  if (ts >= startOfDay(now) - DAY) return 'Yesterday';
  return new Date(ts).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' });
};

export const daysSince = (ts: number, now = Date.now()) => (ts ? Math.floor((now - ts) / DAY) : Infinity);

export const uid = () => Math.random().toString(36).slice(2, 10) + Date.now().toString(36).slice(-4);
