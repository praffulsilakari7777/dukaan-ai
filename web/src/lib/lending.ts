import { inr, type Ledger } from './ledger';

/**
 * Prototype lending marketplace. Lenders are fictional demo partners; nothing here
 * contacts a real lender or moves money. It shows how the Dukaan Score would plug
 * into NBFC lending through the Account Aggregator framework.
 */
export interface LoanProduct {
  id: string;
  lender: string;
  product: string;
  blurb: string;
  minScore: number;
  baseRate: number;
  /** Multiple of the shop's score-based limit this lender will go to. */
  limitFactor: number;
  cap: number;
  tenures: number[];
  feePct: number;
  daily: boolean;
}

export const PRODUCTS: LoanProduct[] = [
  { id: 'stock', lender: 'Saral Micro Finance', product: 'Stock loan', blurb: 'Buy festival stock now, repay a little every day from sales.', minScore: 600, baseRate: 22, limitFactor: 1, cap: 75_000, tenures: [3, 6, 9], feePct: 1.5, daily: true },
  { id: 'wc', lender: 'Kirana Capital', product: 'Working capital line', blurb: 'A reusable credit line for supplier bills. Pay interest only on what you use.', minScore: 700, baseRate: 18, limitFactor: 1.5, cap: 2_00_000, tenures: [6, 12], feePct: 1, daily: false },
  { id: 'term', lender: 'Gramin Udyam Bank', product: 'Shop upgrade loan', blurb: 'Lower rate for a fridge, shelving or a second counter.', minScore: 780, baseRate: 13.5, limitFactor: 2, cap: 3_00_000, tenures: [12, 24], feePct: 0.5, daily: false },
];

export const PURPOSES = ['Festival stock', 'Supplier bill', 'Fridge or freezer', 'Shop renovation', 'Second counter'];

export interface Offer {
  p: LoanProduct;
  eligible: boolean;
  limit: number;
  rate: number;
  gap: number;
}

export function avgDailyProfit(ledger: Ledger) {
  const days = ledger.days.slice(0, -1);
  return Math.max(days.reduce((s, d) => s + d.profit, 0) / Math.max(days.length, 1), 0);
}

export function loanOffers(ledger: Ledger): Offer[] {
  const score = ledger.score.value;
  const baseLimit = Math.max(ledger.score.loan, 10_000);
  return PRODUCTS.map((p) => {
    const eligible = score >= p.minScore;
    const rate = Math.max(p.baseRate - Math.max(score - p.minScore, 0) / 50 * 0.75, p.baseRate - 4);
    const limit = Math.min(Math.round((baseLimit * p.limitFactor) / 5000) * 5000, p.cap);
    return { p, eligible, limit, rate: Math.round(rate * 10) / 10, gap: Math.max(p.minScore - score, 0) };
  });
}

export function emi(principal: number, annualRate: number, months: number) {
  const r = annualRate / 12 / 100;
  if (r === 0) return principal / months;
  const f = Math.pow(1 + r, months);
  return (principal * r * f) / (f - 1);
}

export interface Quote {
  emi: number;
  daily: number;
  totalInterest: number;
  fee: number;
  /** Daily repayment as a share of average daily profit. */
  burden: number;
}

export function quote(o: Offer, amount: number, months: number, ledger: Ledger): Quote {
  const m = emi(amount, o.rate, months);
  const daily = (m * 12) / 312; // ~26 trading days a month
  const profit = avgDailyProfit(ledger);
  return { emi: m, daily, totalInterest: m * months - amount, fee: (amount * o.p.feePct) / 100, burden: profit > 0 ? daily / profit : 1 };
}

export interface Advice {
  amount: number;
  months: number;
  productId: string;
  summary: string;
  risk: string;
}

/** Keeps the daily repayment under a quarter of average daily profit. */
export function offlineAdvice(ledger: Ledger, want: number, purpose: string, preferId?: string): Advice {
  const offers = loanOffers(ledger).filter((o) => o.eligible);
  const profit = avgDailyProfit(ledger);
  const best = offers.find((o) => o.p.id === preferId) ?? offers.sort((a, b) => a.rate - b.rate)[0] ?? loanOffers(ledger)[0];
  let pick = { amount: Math.min(want, best.limit), months: best.p.tenures[0] };
  for (const months of best.p.tenures) {
    const q = quote(best, pick.amount, months, ledger);
    pick.months = months;
    if (q.burden <= 0.25) break;
  }
  let q = quote(best, pick.amount, pick.months, ledger);
  while (q.burden > 0.25 && pick.amount > 10_000) {
    pick.amount -= 5000;
    q = quote(best, pick.amount, pick.months, ledger);
  }
  return {
    amount: pick.amount,
    months: pick.months,
    productId: best.p.id,
    summary: `For ${purpose.toLowerCase()}, take ${inr(pick.amount)} from ${best.p.lender} over ${pick.months} months. That is about ${inr(q.daily)} a day, ${Math.round(q.burden * 100)}% of your average daily profit of ${inr(profit)}.`,
    risk: q.burden > 0.3 ? 'Repayments would take a large share of profit. Consider a smaller amount.' : ledger.totalDue > profit * 5 ? `You have ${inr(ledger.totalDue)} out on udhaar. Collecting some of it first lowers what you need to borrow.` : 'Comfortable: repayments leave most of your daily profit free.',
  };
}

export type LoanStatus = 'submitted' | 'review' | 'approved' | 'disbursed';

export interface LoanApplication {
  id: string;
  productId: string;
  lender: string;
  product: string;
  amount: number;
  months: number;
  rate: number;
  emi: number;
  daily: number;
  purpose: string;
  ts: number;
  score: number;
}

/** The prototype advances an application on a fixed timeline, so a demo can watch it move. */
export function statusOf(a: LoanApplication, now = Date.now()): LoanStatus {
  const s = (now - a.ts) / 1000;
  return s < 4 ? 'submitted' : s < 10 ? 'review' : s < 18 ? 'approved' : 'disbursed';
}
