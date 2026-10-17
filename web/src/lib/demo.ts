import { startOfDay, uid } from './ledger';
import type { Entry } from './types';

const DAY = 86_400_000;

/** Three weeks of believable kirana activity, ending today, so charts and the score look lived-in. */
export function demoEntries(now = Date.now()): { entries: Entry[]; phones: Record<string, string> } {
  const entries: Entry[] = [];
  const t0 = startOfDay(now);
  const at = (daysAgo: number, hour: number, min = 0) => t0 - daysAgo * DAY + hour * 3_600_000 + min * 60_000;
  const add = (e: Omit<Entry, 'id' | 'source'>) => entries.push({ ...e, id: uid(), source: 'demo' });

  // Opening stock, bought 21 days ago from the wholesaler.
  const opening: [string, number, string, number][] = [
    ['Rice', 150, 'kg', 6600], ['Atta', 100, 'kg', 3300], ['Sugar', 100, 'kg', 4200], ['Toor Dal', 40, 'kg', 4800],
    ['Mustard Oil', 40, 'L', 5600], ['Tea', 24, 'kg', 8640], ['Salt', 50, 'kg', 1000], ['Maggi', 150, 'pkt', 1800],
    ['Biscuits', 250, 'pkt', 2500], ['Soap', 80, 'pc', 2400], ['Detergent', 25, 'kg', 2250], ['Eggs', 30, 'dozen', 1650],
    ['Ghee', 8, 'L', 4400],
  ];
  for (const [item, qty, unit, amount] of opening) add({ type: 'purchase', ts: at(21, 9), item, qty, unit, amount, supplier: 'Agarwal Traders' });
  // A restock in the middle, so weighted average cost moves.
  const restock: [string, number, string, number][] = [
    ['Rice', 100, 'kg', 4600], ['Atta', 80, 'kg', 2720], ['Toor Dal', 20, 'kg', 2440], ['Mustard Oil', 24, 'L', 3360], ['Maggi', 100, 'pkt', 1200], ['Eggs', 30, 'dozen', 1680],
  ];
  for (const [item, qty, unit, amount] of restock) add({ type: 'purchase', ts: at(10, 9, 30), item, qty, unit, amount, supplier: 'Agarwal Traders' });

  // Daily selling pattern: [item, unit, qty range, price per unit].
  const sells: [string, string, [number, number], number][] = [
    ['Rice', 'kg', [6, 12], 60], ['Atta', 'kg', [4, 9], 42], ['Sugar', 'kg', [3, 6], 48], ['Toor Dal', 'kg', [1, 3], 140],
    ['Mustard Oil', 'L', [1, 3], 165], ['Tea', 'kg', [0, 2], 440], ['Maggi', 'pkt', [6, 14], 14], ['Biscuits', 'pkt', [5, 12], 12],
    ['Soap', 'pc', [1, 4], 38], ['Eggs', 'dozen', [1, 3], 78], ['Salt', 'kg', [0, 3], 25], ['Detergent', 'kg', [0, 1], 110],
    ['Milk', 'L', [20, 34], 56], ['Bread', 'pkt', [8, 16], 45],
  ];
  let seed = 7;
  const rnd = () => ((seed = (seed * 9301 + 49297) % 233280) / 233280);
  const pick = (lo: number, hi: number) => lo + Math.floor(rnd() * (hi - lo + 1));

  for (let d = 20; d >= 0; d--) {
    if (d === 13) continue; // shop shut one Sunday
    const busy = d % 7 === 1 ? 1.4 : 1;
    const hoursSoFar = d === 0 ? Math.max(9, new Date(now).getHours()) : 21;
    for (const [item, unit, [lo, hi], price] of sells) {
      const q = Math.round(pick(lo, hi) * busy);
      if (!q) continue;
      const hour = 8 + Math.floor(rnd() * Math.max(1, hoursSoFar - 8));
      if (d === 0 && hour >= new Date(now).getHours() && new Date(now).getHours() > 8) continue;
      add({ type: 'sale', ts: at(d, hour, pick(0, 59)), item, qty: q, unit, amount: q * price });
    }
    add({ type: 'purchase', ts: at(d, 6, 30), item: 'Milk', qty: 30, unit: 'L', amount: 1500, supplier: 'Dairy' });
    add({ type: 'purchase', ts: at(d, 6, 40), item: 'Bread', qty: 14, unit: 'pkt', amount: 532, supplier: 'Bakery' });
    if (d % 7 === 3) add({ type: 'expense', ts: at(d, 19), amount: 450, note: 'Transport' });
  }
  add({ type: 'expense', ts: at(15, 11), amount: 1800, note: 'Electricity bill' });

  // Udhaar customers: one good payer, one slipping, one long overdue.
  const credit = (daysAgo: number, customer: string, item: string, qty: number, unit: string, amount: number) =>
    add({ type: 'sale', ts: at(daysAgo, 18, pick(0, 50)), item, qty, unit, amount, customer, credit: true });
  const pay = (daysAgo: number, customer: string, amount: number) => add({ type: 'payment', ts: at(daysAgo, 10, pick(0, 50)), amount, customer });

  credit(19, 'Sunita Devi', 'Atta', 10, 'kg', 420); credit(12, 'Sunita Devi', 'Mustard Oil', 2, 'L', 330);
  pay(9, 'Sunita Devi', 750); credit(2, 'Sunita Devi', 'Sugar', 3, 'kg', 144);

  credit(17, 'Mohan Lal', 'Rice', 10, 'kg', 600); credit(8, 'Mohan Lal', 'Toor Dal', 3, 'kg', 420);
  pay(6, 'Mohan Lal', 300); pay(3, 'Mohan Lal', 400); credit(1, 'Mohan Lal', 'Eggs', 2, 'dozen', 156);

  credit(34, 'Gupta ji', 'Ghee', 2, 'L', 1240); credit(33, 'Gupta ji', 'Tea', 1, 'kg', 440); credit(31, 'Gupta ji', 'Rice', 5, 'kg', 300);

  credit(4, 'Raju Chaiwala', 'Sugar', 5, 'kg', 240); credit(4, 'Raju Chaiwala', 'Tea', 1, 'kg', 440); pay(0, 'Raju Chaiwala', 200);

  return {
    entries,
    phones: { 'sunita devi': '919876500011', 'mohan lal': '919876500022', 'gupta ji': '919876500033', 'raju chaiwala': '919876500044' },
  };
}
