import { canonicalItem, canonicalUnit, uid } from './ledger';
import type { Draft, EntryType } from './types';

/**
 * Offline fallback for the common ways shopkeepers say an entry, in Hinglish or English.
 * Gemini handles everything else; this keeps the demo working with no network.
 */
const SALE = /\b(becha|bechi|beche|bech|bika|biki|sold|sell|sale|bikri|diya|di|de diya)\b/;
const CREDIT = /\b(udhaar|udhar|udhari|credit|khate|khata)\b/;
const PURCHASE = /\b(kharida|kharidi|kharide|khareeda|bought|purchase|purchased|mangaya|mangwaya|aaya|stock aaya)\b/;
const PAYMENT = /\b(jama|paid|pay|payment|chukaya|lautaya|wapas|de gaya|de gayi|diye|received)\b/;
const EXPENSE = /\b(kharcha|kharch|expense|kiraya|rent|bijli|electricity|salary|tankha|transport|bhada|chai pani)\b/;

const UNIT = '(kg|kilo|kgs|g|gm|gram|grams|l|ltr|litre|liter|litres|ml|packet|packets|pkt|pack|pc|pcs|piece|pieces|dozen|darjan|bottle|bottles|box|bag|bori)';
const QTY_ITEM = new RegExp(`(\\d+(?:\\.\\d+)?)\\s*${UNIT}?\\s+([a-z][a-z ]*?)(?=\\s+(?:${'becha|bechi|beche|bech|bika|sold|udhaar|udhar|kharida|kharide|bought|liya|liye|li|ka|ke|ki|for|at|mein|me|@|rs|rupees|₹|\\d'})|$)`);
const AMOUNT = /(?:₹|rs\.?|rupees?|rupaye|rupay)\s*(\d+(?:\.\d+)?)|(\d+(?:\.\d+)?)\s*(?:₹|rs\.?|rupees?|rupaye|rupay|ka|ke|ki|mein|me|mai|main)\b|(?:for|at|@|mein|me)\s*(\d+(?:\.\d+)?)/;
const NAME_NE = /^([a-z]+(?:\s[a-z]+)?)\s+(?:ne|ko|se)\b/;
const NAME_EN = /^([a-z]+)\s+(?:paid|took|bought|has)\b/;
const STOP = new Set(['maine', 'mai', 'main', 'hum', 'humne', 'aaj', 'i', 'we', 'today', 'kal']);

export function offlineParse(input: string): Draft[] {
  const parts = input
    .toLowerCase()
    .replace(/,(?=\s*\d)/g, ' ')
    .split(/\s+(?:aur|and|phir|then)\s+|[;,\n]+/)
    .map((s) => s.trim())
    .filter(Boolean);
  const out: Draft[] = [];
  let lastName: string | undefined;
  for (const p of parts) {
    const d = parseOne(p, lastName);
    if (d) {
      if (d.customer) lastName = d.customer;
      out.push(d);
    }
  }
  return out;
}

function parseOne(s: string, carryName?: string): Draft | null {
  const amountM = s.match(AMOUNT);
  const numbers = [...s.matchAll(/\d+(?:\.\d+)?/g)].map((m) => Number(m[0]));
  let amount = amountM ? Number(amountM[1] ?? amountM[2] ?? amountM[3]) : undefined;
  const qm = s.match(QTY_ITEM);
  let qty: number | undefined;
  let unit: string | undefined;
  let item: string | undefined;
  if (qm && (amount === undefined || numbers.length > 1 || Number(qm[1]) !== amount)) {
    qty = Number(qm[1]);
    unit = qm[2] ? canonicalUnit(qm[2]) : undefined;
    const rawItem = qm[3].replace(/\b(udhaar|udhar|ka|ke|ki|wala|wali)\b/g, '').trim();
    const isVerb = [SALE, CREDIT, PURCHASE, PAYMENT, EXPENSE].some((r) => r.test(rawItem)) || /^(rs|rupees?|rupaye|bill)\b/.test(rawItem);
    if (rawItem && !isVerb) item = canonicalItem(rawItem);
    else qty = unit = undefined;
  }
  if (amount === undefined && numbers.length) amount = numbers[numbers.length - 1];
  if (amount === undefined || !(amount > 0)) return null;
  if (qty !== undefined && amount === qty && numbers.length === 1) return null;

  const nameM = s.match(NAME_NE) ?? s.match(NAME_EN);
  let customer = nameM && !STOP.has(nameM[1].split(' ')[0]) ? titleName(nameM[1]) : undefined;

  let type: EntryType;
  let credit = false;
  if (EXPENSE.test(s) && !item) type = 'expense';
  else if (PURCHASE.test(s) && !CREDIT.test(s)) type = 'purchase';
  else if (CREDIT.test(s)) {
    type = 'sale';
    credit = true;
  } else if (PAYMENT.test(s) && !item) type = 'payment';
  else if (SALE.test(s) || item) type = 'sale';
  else return null;

  if ((type === 'payment' || credit) && !customer) customer = carryName;
  if (type === 'payment' && !customer) return null;
  if (type === 'purchase') customer = undefined;
  if (type === 'sale' && !credit) customer = undefined;

  const note = type === 'expense' ? expenseLabel(s) : undefined;
  return { key: uid(), type, amount, item, qty: item ? qty ?? 1 : undefined, unit: item ? unit ?? 'pc' : undefined, customer, credit, note };
}

const titleName = (s: string) => s.replace(/(^|\s)\S/g, (c) => c.toUpperCase());

function expenseLabel(s: string) {
  if (/bijli|electricity/.test(s)) return 'Electricity bill';
  if (/kiraya|rent/.test(s)) return 'Shop rent';
  if (/salary|tankha/.test(s)) return 'Staff salary';
  if (/transport|bhada/.test(s)) return 'Transport';
  if (/chai pani/.test(s)) return 'Tea & snacks';
  return 'Shop expense';
}
