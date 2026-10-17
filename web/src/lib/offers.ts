import { fmtQty, inr, type Ledger } from './ledger';
import type { StockItem } from './types';

const DAY = 86_400_000;

export type OfferReason = 'expiring' | 'slow';

export interface OfferCandidate {
  key: string;
  item: string;
  unit: string;
  reason: OfferReason;
  /** Plain-language why, e.g. "4.5 kg expires in 2 days". */
  why: string;
  /** Units that will not sell in time at the current pace. */
  atRiskQty: number;
  atRiskValue: number;
  daysToExpiry: number | null;
  daysSinceSale: number;
  cost: number;
  price: number;
  /** Deepest discount that still recovers cost. */
  maxDiscount: number;
  urgency: number;
}

export type OfferType = 'discount' | 'bundle' | 'bogo' | 'combo';

export interface OfferPlan {
  headline: string;
  offer_type: OfferType;
  discount_pct: number;
  bundle_with: string | null;
  offer_price: number;
  valid_days: number;
  whatsapp_message: string;
  poster_tagline: string;
  reasoning: string;
}

export interface ActiveOffer extends OfferPlan {
  id: string;
  item: string;
  unit: string;
  createdTs: number;
  expiresTs: number;
  by: 'gemini' | 'offline';
}

/** Items that will expire before they sell, and items that stopped selling. Daily staples are left out. */
export function offerCandidates(ledger: Ledger, now = Date.now()): OfferCandidate[] {
  const out: OfferCandidate[] = [];
  for (const s of ledger.stock) {
    if (s.qty <= 0 || s.daily) continue;
    const cost = s.avgCost || s.lastPrice * 0.85;
    const price = s.lastPrice || cost * 1.18;
    const maxDiscount = price > 0 ? Math.max(Math.floor(((price - cost) / price) * 100), 0) : 0;
    const daysSinceSale = s.lastSoldTs ? Math.floor((now - s.lastSoldTs) / DAY) : Math.floor((now - (s.oldestBatchTs || now)) / DAY);
    const daysToExpiry = s.nextExpiry ? Math.max((s.nextExpiry - now) / DAY, 0) : null;

    if (daysToExpiry != null && daysToExpiry <= 7) {
      const sellable = s.velocity * daysToExpiry;
      const atRisk = roundQty(Math.min(s.expiringQty, Math.max(s.qty - sellable, 0)), s.unit);
      if (atRisk >= 1 || (atRisk > 0 && atRisk * cost > 100)) {
        const d = Math.round(daysToExpiry);
        out.push(base(s, 'expiring', `${fmtQty(atRisk, s.unit)} expires ${d <= 0 ? 'today' : d === 1 ? 'tomorrow' : `in ${d} days`}`, atRisk, daysToExpiry, daysSinceSale, cost, price, maxDiscount, 100 - daysToExpiry * 10 + (atRisk * cost) / 100));
        continue;
      }
    }
    const cover = s.velocity > 0 ? s.qty / s.velocity : Infinity;
    if ((daysSinceSale >= 10 || cover > 45) && s.value > 200) {
      out.push(base(s, 'slow', daysSinceSale >= 10 ? `No sale in ${daysSinceSale} days` : `${Math.round(cover)} days of stock at today’s pace`, s.qty, daysToExpiry, daysSinceSale, cost, price, maxDiscount, 30 + daysSinceSale + s.value / 200));
    }
  }
  return out.sort((a, b) => b.urgency - a.urgency);
}

const round1 = (n: number) => Math.round(n * 10) / 10;
const COUNTED = new Set(['pkt', 'pc', 'bottle', 'dozen', 'box', 'bag']);
const roundQty = (n: number, unit: string) => (COUNTED.has(unit) ? Math.round(n) : round1(n));

function base(s: StockItem, reason: OfferReason, why: string, atRiskQty: number, daysToExpiry: number | null, daysSinceSale: number, cost: number, price: number, maxDiscount: number, urgency: number): OfferCandidate {
  return { key: s.key, item: s.name, unit: s.unit, reason, why, atRiskQty: round1(atRiskQty), atRiskValue: Math.round(atRiskQty * cost), daysToExpiry: daysToExpiry != null ? round1(daysToExpiry) : null, daysSinceSale, cost: Math.round(cost * 100) / 100, price: Math.round(price * 100) / 100, maxDiscount, urgency };
}

/** Fast sellers to pair a slow item with in a combo. */
export function fastMovers(ledger: Ledger, exclude: string) {
  return [...ledger.stock].filter((s) => s.name !== exclude && s.velocity > 1 && s.qty > 0).sort((a, b) => b.velocity - a.velocity).slice(0, 5).map((s) => s.name);
}

/** Rule-based offer for when Gemini is unreachable. Expiring stock is cleared at or near cost; slow stock gets a combo. */
export function offlineOffer(c: OfferCandidate, shop: string, pairs: string[]): OfferPlan {
  const unitWord = c.unit === 'pc' ? 'piece' : c.unit;
  if (c.reason === 'expiring') {
    const urgent = (c.daysToExpiry ?? 9) <= 1;
    const pct = Math.min(Math.max(c.maxDiscount + (urgent ? 10 : 0), 10), urgent ? 40 : 30);
    const priceAfter = Math.round(c.price * (1 - pct / 100));
    return {
      headline: `${pct}% off ${c.item}`,
      offer_type: 'discount',
      discount_pct: pct,
      bundle_with: null,
      offer_price: priceAfter,
      valid_days: Math.max(Math.floor(c.daysToExpiry ?? 1), 1),
      whatsapp_message: `🛒 ${shop} special! Fresh ${c.item} at just ${inr(priceAfter)}/${unitWord} (${pct}% off) — ${urgent ? 'today only' : 'till stocks last'}. Come early!`,
      poster_tagline: urgent ? 'Today only. While stocks last.' : 'Fresh stock, special price.',
      reasoning: `${c.why}. Without an offer, about ${inr(c.atRiskValue)} of stock goes to waste. At ${inr(priceAfter)} it ${pct > c.maxDiscount ? 'sells just under cost but' : 'still covers cost and'} brings in about ${inr(c.atRiskQty * priceAfter)}.`,
    };
  }
  const partner = pairs[0] ?? 'Biscuits';
  const pct = Math.min(Math.max(Math.round(c.maxDiscount * 0.6), 5), 15);
  return {
    headline: `${c.item} + ${partner} combo`,
    offer_type: 'combo',
    discount_pct: pct,
    bundle_with: partner,
    offer_price: Math.round(c.price * (1 - pct / 100)),
    valid_days: 7,
    whatsapp_message: `🎉 ${shop} combo offer: buy ${partner} and get ${c.item} at ${pct}% off! This week only.`,
    poster_tagline: `Pair it with ${partner} and save.`,
    reasoning: `${c.why}, with ${inr(c.atRiskValue)} stuck on the shelf. ${partner} is one of your fastest sellers, so pairing them moves ${c.item} without cutting the price for everyone.`,
  };
}

/** A shop poster for the offer, drawn on a canvas and returned as a PNG data URL. */
export function drawPoster(o: { headline: string; poster_tagline: string; item: string; offer_price: number; unit: string; discount_pct: number; valid_days: number }, shop: string): string {
  const W = 1080;
  const H = 1350;
  const c = document.createElement('canvas');
  c.width = W;
  c.height = H;
  const g = c.getContext('2d')!;
  const grad = g.createLinearGradient(0, 0, W, H);
  grad.addColorStop(0, '#11817a');
  grad.addColorStop(1, '#06302d');
  g.fillStyle = grad;
  g.fillRect(0, 0, W, H);
  g.strokeStyle = 'rgba(255,255,255,0.06)';
  for (let y = 60; y < H; y += 48) {
    g.beginPath();
    g.moveTo(0, y);
    g.lineTo(W, y);
    g.stroke();
  }
  const font = (w: number, px: number) => `${w} ${px}px Inter, system-ui, sans-serif`;
  g.fillStyle = '#ffffff';
  g.textAlign = 'center';
  g.font = font(600, 40);
  g.globalAlpha = 0.8;
  g.fillText(shop.toUpperCase(), W / 2, 150);
  g.globalAlpha = 1;

  // Discount badge
  g.fillStyle = '#facc15';
  g.beginPath();
  g.arc(W / 2, 420, 190, 0, Math.PI * 2);
  g.fill();
  g.fillStyle = '#06302d';
  g.font = font(800, o.discount_pct ? 150 : 90);
  g.fillText(o.discount_pct ? `${o.discount_pct}%` : 'COMBO', W / 2, o.discount_pct ? 445 : 450);
  if (o.discount_pct) {
    g.font = font(800, 54);
    g.fillText('OFF', W / 2, 520);
  }

  g.fillStyle = '#ffffff';
  g.font = font(800, 96);
  wrap(g, o.item, W / 2, 760, W - 160, 100);
  g.font = font(500, 46);
  g.globalAlpha = 0.85;
  wrap(g, o.poster_tagline, W / 2, 870, W - 200, 58);
  g.globalAlpha = 1;

  g.fillStyle = 'rgba(255,255,255,0.12)';
  roundRect(g, 200, 1000, W - 400, 150, 32);
  g.fill();
  g.fillStyle = '#ffffff';
  g.font = font(800, 84);
  g.fillText(`₹${o.offer_price.toLocaleString('en-IN')}`, W / 2, 1100);
  g.font = font(500, 34);
  g.globalAlpha = 0.75;
  g.fillText(`per ${o.unit === 'pc' ? 'piece' : o.unit} · ${o.valid_days <= 1 ? 'today only' : `valid ${o.valid_days} days`}`, W / 2, 1230);
  g.globalAlpha = 1;
  return c.toDataURL('image/png');
}

function wrap(g: CanvasRenderingContext2D, text: string, x: number, y: number, max: number, lh: number) {
  const words = text.split(' ');
  let line = '';
  const lines: string[] = [];
  for (const w of words) {
    const t = line ? `${line} ${w}` : w;
    if (g.measureText(t).width > max && line) {
      lines.push(line);
      line = w;
    } else line = t;
  }
  lines.push(line);
  lines.slice(0, 2).forEach((l, i) => g.fillText(l, x, y + i * lh));
}

function roundRect(g: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  g.beginPath();
  g.moveTo(x + r, y);
  g.arcTo(x + w, y, x + w, y + h, r);
  g.arcTo(x + w, y + h, x, y + h, r);
  g.arcTo(x, y + h, x, y, r);
  g.arcTo(x, y, x + w, y, r);
  g.closePath();
}
