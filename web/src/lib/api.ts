import { canonicalItem, canonicalUnit, uid } from './ledger';
import { offlineParse } from './parser';
import type { Draft, EntryType } from './types';

export class OfflineError extends Error {}

async function post<T>(path: string, body: unknown, timeoutMs = 25_000): Promise<T> {
  const ctrl = new AbortController();
  const timer = window.setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(`/api/${path}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal: ctrl.signal,
    });
    if (res.status === 503) throw new OfflineError('Gemini is not configured');
    if (!res.ok) throw new Error(`${path} failed (${res.status})`);
    return (await res.json()) as T;
  } catch (e) {
    if (e instanceof OfflineError) throw e;
    throw new OfflineError(e instanceof Error ? e.message : String(e));
  } finally {
    window.clearTimeout(timer);
  }
}

export async function health(): Promise<{ gemini: boolean; model?: string }> {
  try {
    const res = await fetch('/api/health');
    if (!res.ok) return { gemini: false };
    return await res.json();
  } catch {
    return { gemini: false };
  }
}

interface RawEntry {
  type: EntryType;
  item?: string | null;
  qty?: number | null;
  unit?: string | null;
  amount: number;
  customer?: string | null;
  credit?: boolean | null;
  supplier?: string | null;
  note?: string | null;
}

export function toDrafts(raw: RawEntry[]): Draft[] {
  return raw
    .filter((r) => r && r.amount > 0 && ['sale', 'purchase', 'payment', 'expense'].includes(r.type))
    .map((r) => ({
      key: uid(),
      type: r.type,
      amount: Math.round(r.amount * 100) / 100,
      item: r.item ? canonicalItem(r.item) : undefined,
      qty: r.item ? r.qty ?? 1 : undefined,
      unit: r.item ? canonicalUnit(r.unit ?? undefined) : undefined,
      customer: r.customer || undefined,
      credit: r.type === 'sale' ? !!r.credit : undefined,
      supplier: r.supplier || undefined,
      note: r.note || undefined,
    }));
}

export async function parseText(text: string, ctx: { items: string[]; customers: string[]; lang: string }) {
  try {
    const r = await post<{ entries: RawEntry[] }>('parse', { text, ...ctx });
    return { drafts: toDrafts(r.entries), by: 'gemini' as const };
  } catch (e) {
    if (!(e instanceof OfflineError)) throw e;
    return { drafts: offlineParse(text).map((d) => (d.item ? { ...d, item: matchItem(d.item, ctx.items) } : d)), by: 'offline' as const };
  }
}

/** "Dal" said at the counter means the shop's only dal, "Toor Dal". */
function matchItem(name: string, items: string[]) {
  const n = name.toLowerCase();
  if (items.some((i) => i.toLowerCase() === n)) return name;
  const hits = items.filter((i) => i.toLowerCase().split(' ').includes(n));
  return hits.length === 1 ? hits[0] : name;
}

export async function scanBill(dataUrl: string) {
  const [meta, image] = dataUrl.split(',');
  const mime = meta.match(/data:(.*?);/)?.[1] ?? 'image/jpeg';
  const r = await post<{ supplier?: string; entries: RawEntry[] }>('scan', { image, mime }, 45_000);
  return { supplier: r.supplier, drafts: toDrafts(r.entries.map((e) => ({ ...e, type: 'purchase' as const, supplier: r.supplier }))) };
}

export interface InsightResult {
  tips: string[];
  profile: string;
  improve: string;
}

export const insights = (summary: unknown, lang: string) => post<InsightResult>('insights', { summary, lang });
export const briefing = (summary: unknown, lang: string) => post<{ script: string }>('briefing', { summary, lang });

export interface GeminiPart {
  text?: string;
  functionCall?: { name: string; args?: Record<string, unknown> };
  functionResponse?: { name: string; response: unknown };
  thoughtSignature?: string;
}
export interface GeminiContent {
  role: 'user' | 'model';
  parts: GeminiPart[];
}

export const agentTurn = (contents: GeminiContent[], ctx: Record<string, unknown>) =>
  post<{ content: GeminiContent }>('agent', { contents, ...ctx }, 40_000);

/** Shrinks a photo to 1400px on its long edge before upload, as JPEG. */
export async function resizeImage(file: Blob, max = 1400): Promise<string> {
  const bmp = await createImageBitmap(file);
  const scale = Math.min(1, max / Math.max(bmp.width, bmp.height));
  const c = document.createElement('canvas');
  c.width = Math.round(bmp.width * scale);
  c.height = Math.round(bmp.height * scale);
  c.getContext('2d')!.drawImage(bmp, 0, 0, c.width, c.height);
  return c.toDataURL('image/jpeg', 0.85);
}

export const generateOffer = (body: unknown) => post<import('./offers').OfferPlan>('offer', body);
export const loanAdvice = (body: unknown) => post<{ amount: number; months: number; productId: string; summary: string; risk: string }>('loan-advice', body);
export const offerImage = (body: unknown) => post<{ mime: string; data: string; model: string }>('offer-image', body, 95_000);
