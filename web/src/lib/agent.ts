import { agentTurn, OfflineError, toDrafts, type GeminiContent, type GeminiPart } from './api';
import { daysSince, fmtQty, inr, keyOf, startOfDay, type Ledger } from './ledger';
import { offlineParse } from './parser';
import { avgDailyProfit, loanOffers, offlineAdvice } from './lending';
import { fastMovers, offerCandidates, offlineOffer, type OfferPlan } from './offers';
import type { Draft, Entry, Settings } from './types';

const DAY = 86_400_000;

export interface AgentStep {
  tool: string;
  args: Record<string, unknown>;
  summary: string;
}

export interface WaDraft {
  kind: 'reminder' | 'order' | 'promo';
  to: string;
  phone?: string;
  text: string;
}

export interface OfferDraft extends OfferPlan {
  item: string;
  unit: string;
}

export interface AgentReply {
  answer: string;
  steps: AgentStep[];
  drafts: WaDraft[];
  proposed: Draft[];
  offers: OfferDraft[];
  by: 'gemini' | 'offline';
}

interface Ctx {
  ledger: Ledger;
  entries: Entry[];
  settings: Settings;
  phones: Record<string, string>;
}

type ToolOut = { result: unknown; summary: string; drafts?: WaDraft[]; proposed?: Draft[]; offers?: OfferDraft[] };

const PERIODS: Record<string, number> = { today: 0, yesterday: 1, week: 6, month: 29 };

function periodRange(period: string) {
  const t0 = startOfDay();
  if (period === 'yesterday') return [t0 - DAY, t0];
  const back = PERIODS[period] ?? 6;
  return [t0 - back * DAY, Infinity];
}

/** Every tool runs on the owner's own ledger, on the device. Gemini only decides which to call. */
export const TOOLS: Record<string, (args: any, ctx: Ctx) => ToolOut> = {
  get_sales({ period = 'week' }: { period?: string }, { entries, ledger }) {
    const [from, to] = periodRange(period);
    const sales = entries.filter((e) => e.type === 'sale' && e.ts >= from && e.ts < to);
    const expenses = entries.filter((e) => e.type === 'expense' && e.ts >= from && e.ts < to).reduce((s, e) => s + e.amount, 0);
    const byItem = new Map<string, { item: string; sales: number; profit: number; qty: number; unit: string }>();
    let total = 0;
    let profit = 0;
    for (const e of sales) {
      const p = ledger.saleProfit[e.id] ?? 0;
      total += e.amount;
      profit += p;
      const k = e.item ?? 'Other';
      const r = byItem.get(k) ?? { item: k, sales: 0, profit: 0, qty: 0, unit: e.unit ?? '' };
      r.sales += e.amount;
      r.profit += p;
      r.qty += e.qty ?? 0;
      byItem.set(k, r);
    }
    const items = [...byItem.values()].sort((a, b) => b.profit - a.profit).map((r) => ({ ...r, sales: Math.round(r.sales), profit: Math.round(r.profit) }));
    const top = items[0];
    return {
      result: { period, total_sales: Math.round(total), gross_profit: Math.round(profit), expenses: Math.round(expenses), net_profit: Math.round(profit - expenses), bills: sales.length, items_by_profit: items.slice(0, 8) },
      summary: `${inr(total)} sales, ${inr(profit - expenses)} profit${top ? ` · top: ${top.item}` : ''}`,
    };
  },

  find_overdue_customers({ days = 30 }: { days?: number }, { ledger }) {
    const list = ledger.customers
      .filter((c) => c.due > 0)
      .map((c) => ({ name: c.name, due: c.due, days_since_last_payment: Math.min(daysSince(c.lastPaymentTs || c.history[c.history.length - 1]?.ts || 0), 999), has_whatsapp: !!c.phone }))
      .filter((c) => c.days_since_last_payment >= days)
      .sort((a, b) => b.due - a.due);
    return {
      result: { min_days: days, customers: list, total_due: list.reduce((s, c) => s + c.due, 0) },
      summary: list.length ? `${list.length} customer${list.length > 1 ? 's' : ''}, ${inr(list.reduce((s, c) => s + c.due, 0))} due` : 'nobody overdue',
    };
  },

  check_stock({ item }: { item?: string }, { ledger }) {
    const pick = item ? ledger.stock.filter((s) => s.key.includes(keyOf(item)) || keyOf(item).includes(s.key)) : ledger.stock.filter((s) => s.low);
    const rows = pick.map((s) => ({
      item: s.name,
      in_stock: `${fmtQty(Math.max(s.qty, 0), s.unit)}`,
      days_left: Number.isFinite(s.daysLeft) ? Math.round(s.daysLeft * 10) / 10 : null,
      sells_per_day: Math.round(s.velocity * 10) / 10,
      suggested_reorder: Math.max(Math.ceil(s.velocity * 10 - Math.max(s.qty, 0)), 0),
      unit: s.unit,
      avg_cost: Math.round(s.avgCost),
    }));
    return {
      result: { scope: item ?? 'running low', items: rows },
      summary: item ? rows.map((r) => `${r.item}: ${r.in_stock}`).join(', ') || `no ${item} in stock` : `${rows.length} item${rows.length === 1 ? '' : 's'} running low`,
    };
  },

  draft_supplier_order({ supplier = 'Supplier', items = [], message }: { supplier?: string; items?: { item: string; qty: number; unit?: string }[]; message?: string }, { settings, ledger }) {
    let lines = items;
    if (!lines.length) lines = ledger.stock.filter((s) => s.low).map((s) => ({ item: s.name, qty: Math.max(Math.ceil(s.velocity * 10 - Math.max(s.qty, 0)), 5), unit: s.unit }));
    const text = message?.trim() || `Namaste ${supplier} ji, ${settings.shopName} se order:\n${lines.map((l) => `• ${l.item} – ${fmtQty(l.qty, l.unit)}`).join('\n')}\nKripya kal tak bhej dijiye. Dhanyavaad!`;
    return { result: { drafted: true, supplier, lines: lines.length }, summary: `order for ${lines.length} item${lines.length === 1 ? '' : 's'}`, drafts: [{ kind: 'order', to: supplier, text }] };
  },

  draft_reminders({ reminders = [] }: { reminders?: { customer: string; message?: string }[] }, { ledger, settings }) {
    const drafts: WaDraft[] = reminders.map((r) => {
      const c = ledger.customers.find((x) => x.key === keyOf(r.customer));
      const due = c?.due ?? 0;
      const text = r.message?.trim() || `Namaste ${c?.name ?? r.customer} ji, ${settings.shopName} mein aapka ${inr(due)} udhaar baaki hai. Jab suvidha ho, jama kar dijiye. Dhanyavaad!`;
      return { kind: 'reminder', to: c?.name ?? r.customer, phone: c?.phone, text };
    });
    return { result: { drafted: drafts.length }, summary: `${drafts.length} reminder${drafts.length === 1 ? '' : 's'} ready`, drafts };
  },

  draft_promo({ item, message }: { item: string; message?: string }, { settings }) {
    const text = message?.trim() || `🛒 ${settings.shopName} mein aaj ka offer: ${item} par special daam! Stock seemit hai, jaldi aaiye.`;
    return { result: { drafted: true, item }, summary: `offer for ${item}`, drafts: [{ kind: 'promo', to: 'Customers', text }] };
  },

  find_offer_candidates(_: unknown, { ledger }) {
    const c = offerCandidates(ledger);
    return {
      result: { items: c.map(({ urgency: _u, key: _k, ...r }) => r), fast_sellers: fastMovers(ledger, '') },
      summary: c.length ? `${c.length} at risk, ${inr(c.reduce((s, x) => s + x.atRiskValue, 0))}` : 'nothing at risk',
    };
  },

  create_offer(args: Partial<OfferPlan> & { item: string }, { ledger, settings }) {
    const cand = offerCandidates(ledger).find((c) => keyOf(c.item) === keyOf(args.item));
    const stock = ledger.stock.find((s) => keyOf(s.name) === keyOf(args.item));
    const base = cand ? offlineOffer(cand, settings.shopName, fastMovers(ledger, cand.item)) : null;
    const plan: OfferDraft = {
      ...(base ?? { headline: `Offer on ${args.item}`, offer_type: 'discount', discount_pct: 10, bundle_with: null, offer_price: Math.round((stock?.lastPrice ?? 0) * 0.9), valid_days: 3, whatsapp_message: '', poster_tagline: 'Special price this week.', reasoning: '' }),
      ...Object.fromEntries(Object.entries(args).filter(([, v]) => v != null && v !== '')),
      item: stock?.name ?? args.item,
      unit: stock?.unit ?? cand?.unit ?? 'pc',
    } as OfferDraft;
    return { result: { shown_to_owner: true, headline: plan.headline }, summary: plan.headline, offers: [plan] };
  },

  check_loan_eligibility({ amount }: { amount?: number }, { ledger }) {
    const offers = loanOffers(ledger);
    const advice = offlineAdvice(ledger, amount ?? Math.max(...offers.map((o) => o.limit)), 'Festival stock');
    return {
      result: {
        dukaan_score: ledger.score.value,
        avg_daily_profit: Math.round(avgDailyProfit(ledger)),
        udhaar_outstanding: ledger.totalDue,
        offers: offers.map((o) => ({ lender: o.p.lender, product: o.p.product, eligible: o.eligible, limit: o.limit, interest_pct: o.rate, tenure_months: o.p.tenures, min_score: o.p.minScore })),
        affordable_suggestion: { amount: advice.amount, months: advice.months, lender: offers.find((o) => o.p.id === advice.productId)?.p.lender },
      },
      summary: `score ${ledger.score.value}, ${offers.filter((o) => o.eligible).length} of ${offers.length} offers open`,
    };
  },

  record_entry({ entries = [] }: { entries?: any[] }) {
    const proposed = toDrafts(entries);
    return {
      result: { status: 'shown to owner for confirmation; not saved yet', count: proposed.length },
      summary: `${proposed.length} entr${proposed.length === 1 ? 'y' : 'ies'} for you to confirm`,
      proposed,
    };
  },
};

function run(name: string, args: Record<string, unknown>, ctx: Ctx, acc: AgentReply) {
  const fn = TOOLS[name];
  if (!fn) return { error: `unknown tool ${name}` };
  const out = fn(args, ctx);
  acc.steps.push({ tool: name, args, summary: out.summary });
  if (out.drafts) acc.drafts.push(...out.drafts);
  if (out.proposed) acc.proposed.push(...out.proposed);
  if (out.offers) acc.offers.push(...out.offers);
  return out.result;
}

/** The Gemini function-calling loop: ask, run whatever tools Gemini picks, send results back, repeat. */
export async function askDukaan(
  question: string,
  history: GeminiContent[],
  ctx: Ctx,
  onStep: (s: AgentStep) => void,
): Promise<{ reply: AgentReply; history: GeminiContent[] }> {
  const acc: AgentReply = { answer: '', steps: [], drafts: [], proposed: [], offers: [], by: 'gemini' };
  const contents: GeminiContent[] = [...history, { role: 'user', parts: [{ text: question }] }];
  const meta = {
    shopName: ctx.settings.shopName,
    ownerName: ctx.settings.ownerName,
    lang: ctx.settings.lang,
    today: new Date().toLocaleDateString('en-IN', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' }),
    items: ctx.ledger.stock.map((s) => s.name),
    customers: ctx.ledger.customers.map((c) => c.name),
  };
  try {
    for (let i = 0; i < 6; i++) {
      const { content } = await agentTurn(contents, meta);
      contents.push(content);
      const calls = content.parts.filter((p) => p.functionCall);
      if (!calls.length) {
        acc.answer = content.parts.map((p) => p.text ?? '').join('').trim();
        break;
      }
      const responses: GeminiPart[] = calls.map((p) => {
        const { name, args = {} } = p.functionCall!;
        const before = acc.steps.length;
        const result = run(name, args, ctx, acc);
        if (acc.steps.length > before) onStep(acc.steps[acc.steps.length - 1]);
        return { functionResponse: { name, response: { result } } };
      });
      contents.push({ role: 'user', parts: responses });
    }
    if (!acc.answer) acc.answer = acc.steps.length ? 'Done. Here is what I prepared.' : 'Sorry, I could not work that out.';
    return { reply: acc, history: contents };
  } catch (e) {
    if (!(e instanceof OfflineError)) throw e;
    return { reply: offlineAgent(question, ctx, onStep), history };
  }
}

/** Keyword agent for when Gemini can't be reached. Same tools, templated answers. */
function offlineAgent(q: string, ctx: Ctx, onStep: (s: AgentStep) => void): AgentReply {
  const acc: AgentReply = { answer: '', steps: [], drafts: [], proposed: [], offers: [], by: 'offline' };
  const s = q.toLowerCase();
  const say: string[] = [];
  const call = (name: string, args: Record<string, unknown>) => {
    const r = run(name, args, ctx, acc) as any;
    onStep(acc.steps[acc.steps.length - 1]);
    return r;
  };
  const period = /today|aaj/.test(s) ? 'today' : /yesterday|kal/.test(s) ? 'yesterday' : /month|mahine/.test(s) ? 'month' : 'week';

  if (/(remind|reminder|yaad|message|bhejo|send)/.test(s) && /(udhaar|udhar|paid|pay|customer|unhe|them|sab)/.test(s)) {
    const r = call('find_overdue_customers', { days: 7 });
    if (r.customers.length) {
      call('draft_reminders', { reminders: r.customers.map((c: any) => ({ customer: c.name })) });
      say.push(`I've drafted ${r.customers.length} WhatsApp reminder${r.customers.length > 1 ? 's' : ''}. Tap a card to send.`);
    } else say.push('Nobody has udhaar pending right now.');
  } else if (/(overdue|udhaar|udhar|paid|pay|owe|baaki|due)/.test(s)) {
    const days = Number(s.match(/(\d+)\s*(din|day)/)?.[1] ?? 30);
    const r = call('find_overdue_customers', { days });
    say.push(
      r.customers.length
        ? `${r.customers.length} customer${r.customers.length > 1 ? 's haven\'t' : ' hasn\'t'} paid in ${days}+ days: ${r.customers.map((c: any) => `${c.name} (${inr(c.due)})`).join(', ')}. Total ${inr(r.total_due)}.`
        : `Everyone has paid something in the last ${days} days.`,
    );
  }
  if (/(order|mangwa|mangao|supplier)/.test(s)) {
    const item = ctx.ledger.stock.find((x) => s.includes(x.key) || s.includes(keyOf(x.name).split(' ')[0]));
    const stock = call('check_stock', item ? { item: item.name } : {});
    const lines = stock.items.map((r: any) => ({ item: r.item, qty: Math.max(r.suggested_reorder, 5), unit: r.unit }));
    call('draft_supplier_order', { supplier: 'Agarwal Traders', items: lines });
    say.push(`Order drafted for ${lines.map((l: any) => `${fmtQty(l.qty, l.unit)} ${l.item}`).join(', ')}.`);
  } else if (/(stock|running out|khatam|low|kam|shelf)/.test(s)) {
    const r = call('check_stock', {});
    say.push(
      r.items.length
        ? `Running low: ${r.items.map((i: any) => `${i.item} (${i.in_stock}${i.days_left != null ? `, ~${Math.max(Math.round(i.days_left), 0)} days` : ''})`).join(', ')}.`
        : 'Stock looks healthy. Nothing is about to run out.',
    );
  }
  if (/(offer|promo|discount|slow|expir|not selling|nahi bik|kharab)/.test(s)) {
    const r = call('find_offer_candidates', {});
    const top = r.items[0];
    if (top) {
      const plan = offlineOffer(top, ctx.settings.shopName, r.fast_sellers.filter((x: string) => x !== top.item));
      call('create_offer', { item: top.item, ...plan });
      say.push(`${r.items.length} item${r.items.length > 1 ? 's are' : ' is'} at risk, worth ${inr(r.items.reduce((a: number, x: any) => a + x.atRiskValue, 0))}. ${top.item} is the most urgent (${top.why.toLowerCase()}), so I made an offer for it: ${plan.headline}.`);
    } else say.push('Nothing is at risk. Everything is selling before it expires.');
  }
  if (/(loan|credit|borrow|karz|karza|lend|finance)/.test(s)) {
    const want = Number(s.match(/(\d[\d,]{3,})/)?.[1]?.replace(/,/g, '')) || undefined;
    const r = call('check_loan_eligibility', want ? { amount: want } : {});
    const open = r.offers.filter((o: any) => o.eligible);
    const sug = r.affordable_suggestion;
    say.push(open.length ? `With a Dukaan Score of ${r.dukaan_score}, you qualify for ${open.length} offer${open.length > 1 ? 's' : ''}, up to ${inr(Math.max(...open.map((o: any) => o.limit)))}. Comfortable for your profit: ${inr(sug.amount)} over ${sug.months} months from ${sug.lender}. Open Loans to apply.` : `Your Dukaan Score is ${r.dukaan_score}. A few more weeks of steady records will unlock loan offers.`);
  }
  if (/(profit|munafa|sales|bikri|top|best|most|kamai|earn)/.test(s)) {
    const r = call('get_sales', { period });
    const top = r.items_by_profit[0];
    say.push(`${period === 'today' ? 'Today' : period === 'yesterday' ? 'Yesterday' : period === 'month' ? 'This month' : 'This week'}: ${inr(r.total_sales)} sales and ${inr(r.net_profit)} profit.${top ? ` ${top.item} earned the most, ${inr(top.profit)}.` : ''}`);
  }
  if (!acc.steps.length) {
    const drafts = offlineParse(q);
    if (drafts.length) {
      call('record_entry', { entries: drafts });
      say.push('I understood this as an entry. Check it below and save.');
    } else say.push('I can answer questions about sales, profit, udhaar and stock, or draft orders and reminders. Try "Who hasn\'t paid in 30 days?"');
  }
  acc.answer = say.join(' ');
  return acc;
}

export const waLink = (d: WaDraft) => `https://wa.me/${d.phone ?? ''}?text=${encodeURIComponent(d.text)}`;
