// Dukaan AI server: holds the Gemini credentials, exposes /api/*, and serves the built web app.
import { createReadStream, existsSync, statSync } from 'node:fs';
import { createServer } from 'node:http';
import { extname, join, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';
import { generate, generateJSON, imageModel, mode, model } from './gemini.mjs';

// How Gemini is told to write for each app language.
const LANG_AI = {
  en: 'simple Indian English', hi: 'simple Hindi in Devanagari script', hinglish: 'simple Hinglish (Hindi written in Roman script)',
  bn: 'simple Bengali in Bengali script', te: 'simple Telugu in Telugu script', mr: 'simple Marathi in Devanagari script',
  ta: 'simple Tamil in Tamil script', gu: 'simple Gujarati in Gujarati script', kn: 'simple Kannada in Kannada script',
  ml: 'simple Malayalam in Malayalam script', pa: 'simple Punjabi in Gurmukhi script', or: 'simple Odia in Odia script',
};
const langName = (code) => LANG_AI[code] || LANG_AI.en;

const PORT = Number(process.env.PORT || 8080);
const ROOT = fileURLToPath(new URL('.', import.meta.url));
const STATIC = [join(ROOT, 'public'), join(ROOT, '../web/dist')].find((d) => existsSync(d));

const ENTRY_SCHEMA = {
  type: 'OBJECT',
  properties: {
    type: { type: 'STRING', enum: ['sale', 'purchase', 'payment', 'expense'] },
    item: { type: 'STRING', nullable: true, description: 'Canonical English item name, Title Case, e.g. Rice, Toor Dal, Mustard Oil' },
    qty: { type: 'NUMBER', nullable: true },
    unit: { type: 'STRING', nullable: true, description: 'kg, g, L, ml, pkt, pc, dozen, bottle, box, bag' },
    amount: { type: 'NUMBER', description: 'Total rupees for this line, not the per-unit rate' },
    customer: { type: 'STRING', nullable: true, description: 'Person who took udhaar or paid it back' },
    credit: { type: 'BOOLEAN', nullable: true, description: 'true when a sale is on udhaar (credit)' },
    note: { type: 'STRING', nullable: true, description: 'Short English label for expenses, e.g. Electricity bill' },
  },
  required: ['type', 'amount'],
};

const PARSE_SYSTEM = `You are the bookkeeper inside Dukaan AI, an app for Indian kirana (grocery) shop owners.
Turn what the owner said or typed (Hindi, Hinglish, English, Telugu, Tamil, Marathi, Bengali or Gujarati, often from speech recognition with errors) into ledger entries.
Types:
- sale: the shop sold goods. If it was on udhaar/credit/khata, set credit=true and customer.
- purchase: the shop bought stock from a supplier.
- payment: a customer paid back udhaar (jama, de gaya, paid). Needs customer. No item.
- expense: money spent running the shop (rent/kiraya, bijli, salary, transport, chai-pani). Use note.
Rules: amount is the TOTAL for the line in rupees. If only a per-unit rate is given ("chawal 60 rupaye kilo, 5 kilo"), multiply. Translate item names to English (chawal→Rice, cheeni→Sugar, aata→Atta, tel→Oil, dal→Dal, doodh→Milk). Prefer an existing item name when one matches. One sentence can hold several entries. Never invent amounts; skip a line if no amount is said. Return {"entries": []} if nothing is an entry.`;

const SCAN_SYSTEM = `You read photos of Indian supplier bills and invoices (printed or handwritten, English or Hindi) for a kirana shop.
Extract every purchased line item with quantity, unit and the line's TOTAL amount in rupees (not the rate). Use clean English item names in Title Case, removing brand noise unless it identifies the product (e.g. "Maggi"). Ignore taxes, totals, discounts and round-off lines. Also return the supplier's name if visible.`;

const TOOL_DECLS = [
  {
    name: 'get_sales',
    description: 'Sales, gross profit, expenses and net profit for a period, with items ranked by profit. Use for questions about sales, profit, best or worst items.',
    parameters: { type: 'OBJECT', properties: { period: { type: 'STRING', enum: ['today', 'yesterday', 'week', 'month'] } }, required: ['period'] },
  },
  {
    name: 'find_overdue_customers',
    description: 'Customers with udhaar (credit) still due who have not paid anything in at least `days` days. Use days=0 to list everyone who owes money.',
    parameters: { type: 'OBJECT', properties: { days: { type: 'INTEGER' } }, required: ['days'] },
  },
  {
    name: 'check_stock',
    description: 'Stock on hand. With no item, returns only items running low, with days left and a suggested reorder quantity. With an item, returns that item.',
    parameters: { type: 'OBJECT', properties: { item: { type: 'STRING' } } },
  },
  {
    name: 'draft_supplier_order',
    description: 'Shows the owner a WhatsApp order message for the supplier, ready to send. Call check_stock first to choose quantities. Write the message yourself: short, polite, in Hinglish, with one line per item.',
    parameters: {
      type: 'OBJECT',
      properties: {
        supplier: { type: 'STRING' },
        items: { type: 'ARRAY', items: { type: 'OBJECT', properties: { item: { type: 'STRING' }, qty: { type: 'NUMBER' }, unit: { type: 'STRING' } }, required: ['item', 'qty'] } },
        message: { type: 'STRING' },
      },
      required: ['items', 'message'],
    },
  },
  {
    name: 'draft_reminders',
    description: 'Shows the owner one WhatsApp udhaar reminder per customer, ready to send. Call find_overdue_customers first. Write each message yourself: warm, respectful (use "ji"), Hinglish, mention the exact amount and the shop name.',
    parameters: {
      type: 'OBJECT',
      properties: { reminders: { type: 'ARRAY', items: { type: 'OBJECT', properties: { customer: { type: 'STRING' }, message: { type: 'STRING' } }, required: ['customer', 'message'] } } },
      required: ['reminders'],
    },
  },
  {
    name: 'draft_promo',
    description: 'Shows the owner a WhatsApp offer to send customers, to clear slow-moving stock. Write a short, catchy Hinglish message with one emoji.',
    parameters: { type: 'OBJECT', properties: { item: { type: 'STRING' }, message: { type: 'STRING' } }, required: ['item', 'message'] },
  },
  {
    name: 'find_offer_candidates',
    description: 'Stock at risk: items that will expire before they sell at the current pace, and items that have stopped selling. Returns quantity and value at risk, cost, price and the deepest discount that still covers cost.',
    parameters: { type: 'OBJECT', properties: {} },
  },
  {
    name: 'create_offer',
    description: 'Shows the owner a ready offer for one at-risk item: a poster and a WhatsApp message. Call find_offer_candidates first. Keep the price at or above cost unless the stock expires within 2 days. Prefer a combo with a fast seller for slow, non-perishable stock.',
    parameters: {
      type: 'OBJECT',
      properties: {
        item: { type: 'STRING' },
        offer_type: { type: 'STRING', enum: ['discount', 'bundle', 'bogo', 'combo'] },
        discount_pct: { type: 'NUMBER' },
        bundle_with: { type: 'STRING' },
        offer_price: { type: 'NUMBER', description: 'Price per unit after the offer, in rupees' },
        valid_days: { type: 'INTEGER' },
        headline: { type: 'STRING', description: 'Max 6 words, e.g. "25% off fresh Paneer"' },
        whatsapp_message: { type: 'STRING', description: 'Short Hinglish message to customers with one emoji and the shop name' },
        poster_tagline: { type: 'STRING', description: 'Max 7 words' },
        reasoning: { type: 'STRING', description: 'One sentence for the owner: why this offer, in rupees' },
      },
      required: ['item', 'offer_type', 'discount_pct', 'offer_price', 'valid_days', 'headline', 'whatsapp_message', 'poster_tagline', 'reasoning'],
    },
  },
  {
    name: 'check_loan_eligibility',
    description: 'The shop\'s Dukaan Score, average daily profit, and the loan offers it qualifies for from partner lenders, with limits and interest rates. Use for any question about loans, credit or borrowing.',
    parameters: { type: 'OBJECT', properties: { amount: { type: 'NUMBER', description: 'Amount the owner wants, if they said one' } } },
  },
  {
    name: 'record_entry',
    description: 'Proposes ledger entries (sales, purchases, udhaar, payments, expenses) when the owner tells you about a transaction. They are shown to the owner as cards to confirm; nothing is saved until they tap save.',
    parameters: { type: 'OBJECT', properties: { entries: { type: 'ARRAY', items: ENTRY_SCHEMA } }, required: ['entries'] },
  },
];

function agentSystem(b) {
  return `You are "Ask Dukaan", the AI employee of ${b.shopName || 'a kirana shop'} in India, owned by ${b.ownerName || 'the owner'}. Today is ${b.today}.
You can read the shop's live ledger only through your tools. Never guess numbers: call a tool, then answer from its result.
Use several tools in one turn when the question has several parts. When asked to order something, call check_stock and then draft_supplier_order using each item's suggested_reorder as the quantity (it already covers about 10 days of sales); quote that same quantity in your answer, and do not ask the owner for quantities. When asked to send, remind, order or promote, draft the messages with the draft_* tools (the owner sends them with one tap; you never send anything yourself).
Known items: ${(b.items || []).slice(0, 60).join(', ') || 'none yet'}. Known customers: ${(b.customers || []).slice(0, 40).join(', ') || 'none yet'}.
The app is set to ${langName(b.lang)}: answer in that language, unless the owner clearly writes in another language, then match them. Keep item names, numbers and ₹ amounts as digits. WhatsApp drafts for customers may stay in Hinglish if the app is in English.
Be brief: 1–3 short sentences, numbers first, rupees as ₹ with Indian grouping (₹1,25,000). No markdown headings or tables.`;
}

const routes = {
  async 'GET /api/health'() {
    return { gemini: mode !== 'none', mode, model };
  },

  async 'POST /api/parse'(b) {
    const text = String(b.text || '').slice(0, 1000);
    const ctx = `Existing items: ${(b.items || []).slice(0, 80).join(', ') || 'none'}.\nExisting udhaar customers: ${(b.customers || []).slice(0, 50).join(', ') || 'none'}.`;
    return generateJSON({
      system: PARSE_SYSTEM,
      parts: [{ text: `${ctx}\n\nOwner said: """${text}"""` }],
      schema: { type: 'OBJECT', properties: { entries: { type: 'ARRAY', items: ENTRY_SCHEMA } }, required: ['entries'] },
    });
  },

  async 'POST /api/scan'(b) {
    if (!b.image) throw Object.assign(new Error('image required'), { status: 400 });
    const known = (b.items || []).slice(0, 80).join(', ');
    const out = await generateJSON({
      system: SCAN_SYSTEM,
      parts: [
        { inlineData: { mimeType: b.mime || 'image/jpeg', data: b.image } },
        { text: `Extract the purchased items from this bill.${known ? ` The shop already stocks: ${known}. When a line is one of these, use exactly that name (e.g. "Maggi Noodles" → "Maggi").` : ''} For each line also read the per-unit rate, and check that quantity × rate equals the line amount.` },
      ],
      schema: {
        type: 'OBJECT',
        properties: {
          supplier: { type: 'STRING', nullable: true },
          entries: {
            type: 'ARRAY',
            items: { type: 'OBJECT', properties: { item: { type: 'STRING' }, qty: { type: 'NUMBER' }, unit: { type: 'STRING' }, rate: { type: 'NUMBER', nullable: true, description: 'Price per unit' }, amount: { type: 'NUMBER', description: 'Line total' } }, required: ['item', 'amount'] },
          },
        },
        required: ['entries'],
      },
      // Reading small printed digits benefits from full resolution and a moment to check the sums.
      temperature: 0,
      thinkingBudget: 2048,
      extra: { mediaResolution: 'MEDIA_RESOLUTION_HIGH' },
    });
    // Digits on photos get misread; when the rate and quantity agree with each other, trust them over the total.
    const entries = (out.entries || []).map(({ rate, ...e }) => {
      if (rate && e.qty && Math.abs(rate * e.qty - e.amount) > Math.max(2, e.amount * 0.02)) return { ...e, amount: Math.round(rate * e.qty * 100) / 100, type: 'purchase' };
      return { ...e, type: 'purchase' };
    });
    return { supplier: out.supplier, entries };
  },

  async 'POST /api/agent'(b) {
    const contents = Array.isArray(b.contents) ? b.contents.slice(-24) : [];
    const content = await generate({
      systemInstruction: { parts: [{ text: agentSystem(b) }] },
      contents,
      tools: [{ functionDeclarations: TOOL_DECLS }],
      toolConfig: { functionCallingConfig: { mode: 'AUTO' } },
      generationConfig: { temperature: 0.3, thinkingConfig: { thinkingBudget: 512 } },
    });
    return { content: { role: 'model', parts: content.parts } };
  },

  async 'POST /api/insights'(b) {
    return generateJSON({
      system: `You are a small-business advisor and credit analyst for Indian kirana shops. Use only the numbers given. Write in ${langName(b.lang)} that a shopkeeper understands. No jargon. Write money as ₹ with Indian digit grouping (₹3,080, ₹40,000), never as "rupees".`,
      parts: [
        {
          text: `Shop data (JSON): ${JSON.stringify(b.summary)}
Return:
- profile: a 2–3 sentence credit profile a lender could read, explaining the Dukaan Score (300–900) from the factors, and the loan it supports.
- improve: the single most effective step to raise the score this month, one sentence, specific.
- tips: exactly 4 practical business tips, each one sentence, each tied to a specific item, customer group or number in the data.`,
        },
      ],
      schema: { type: 'OBJECT', properties: { profile: { type: 'STRING' }, improve: { type: 'STRING' }, tips: { type: 'ARRAY', items: { type: 'STRING' } } }, required: ['profile', 'improve', 'tips'] },
      temperature: 0.5,
    });
  },

  async 'POST /api/offer'(b) {
    const c = b.candidate || {};
    // Hard floor: never below cost unless the stock is about to spoil.
    const days = c.daysToExpiry ?? 99;
    const floor = c.cost ? Math.ceil(c.cost * (days <= 1 ? 0.6 : days <= 2 ? 0.8 : 1)) : 0;
    const plan = await generateJSON({
      system: `You are a retail merchandising expert for Indian kirana shops. You design one offer to clear at-risk stock while protecting the shop's money.
Rules: expiring stock should be cleared before the date, so price it to sell in time; only go below cost if it expires within 2 days, and say so. For slow, non-perishable stock prefer a combo with a fast-selling item over a deep discount. Round prices to whole rupees. Write the headline, tagline and reasoning in ${langName(b.lang)}. Write the WhatsApp message in ${b.lang === 'en' ? 'friendly Hinglish (Roman script) that customers in a small Indian town read easily' : langName(b.lang)}.`,
      parts: [{ text: `Shop: ${b.shop}\nAt-risk item (JSON): ${JSON.stringify(b.candidate)}\nFast-selling items to pair with: ${(b.fast_movers || []).join(', ') || 'none'}\nThe offer price must be at least ₹${floor} per unit.\nDesign the offer.` }],
      schema: {
        type: 'OBJECT',
        properties: {
          headline: { type: 'STRING', description: 'Max 6 words' },
          offer_type: { type: 'STRING', enum: ['discount', 'bundle', 'bogo', 'combo'] },
          discount_pct: { type: 'NUMBER' },
          bundle_with: { type: 'STRING', nullable: true },
          offer_price: { type: 'NUMBER', description: 'Price per unit after the offer' },
          valid_days: { type: 'INTEGER' },
          whatsapp_message: { type: 'STRING', description: 'Under 280 characters, one emoji, mentions the shop' },
          poster_tagline: { type: 'STRING', description: 'Max 7 words' },
          reasoning: { type: 'STRING', description: '1–2 sentences for the owner, with rupee amounts: money recovered vs lost' },
        },
        required: ['headline', 'offer_type', 'discount_pct', 'offer_price', 'valid_days', 'whatsapp_message', 'poster_tagline', 'reasoning'],
      },
      temperature: 0.7,
    });
    if (floor && plan.offer_price < floor) {
      const oldPrice = plan.offer_price;
      const oldPct = plan.discount_pct;
      plan.offer_price = floor;
      plan.discount_pct = c.price ? Math.max(Math.round(((c.price - floor) / c.price) * 100), 0) : plan.discount_pct;
      // Words like "half price" or "50%" no longer match the clamped price, so restate them.
      const vague = /half[\s-]*price|aadhe[\s-]*daam|aadha|buy one get one|bogo|free/i;
      const fix = (t) => t && t.replaceAll(`₹${oldPrice}`, `₹${floor}`).replaceAll(`${oldPct}%`, `${plan.discount_pct}%`).replace(vague, `${plan.discount_pct}% off`);
      for (const k of ['whatsapp_message', 'poster_tagline', 'reasoning']) plan[k] = fix(plan[k]);
      plan.headline = `${plan.discount_pct}% off ${c.item}`;
      plan.offer_type = 'discount';
    }
    return plan;
  },

  async 'POST /api/offer-image'(b) {
    const o = b.offer || {};
    const lang = langName(b.lang);
    const prompt = `Create a square 1:1 promotional poster that an Indian kirana (neighbourhood grocery) shop will share on WhatsApp.
Product: ${o.item}. Offer: ${o.headline}. Offer price: ₹${o.offer_price} per ${o.unit}${o.bundle_with ? `, combined with ${o.bundle_with}` : ''}. Valid: ${o.valid_days <= 1 ? 'today only' : `${o.valid_days} days`}.
Shop name: ${b.shop}.
Style: bright, clean and appetising, a realistic photo of fresh ${o.item} as the hero, warm Indian market feel, deep teal and marigold accent colours, plenty of space around the text.
Text on the poster, large and perfectly spelled, and nothing else: the shop name at the top; the offer headline "${o.headline}"; the price "₹${o.offer_price}"; ${o.discount_pct ? `a round badge "${o.discount_pct}% OFF"` : 'a badge "COMBO"'}. ${b.lang && b.lang !== 'en' && b.lang !== 'hinglish' ? `Add one short line in ${lang} under the headline.` : ''}
No logos, no QR codes, no phone numbers, no extra words.`;
    const content = await generate(
      { contents: [{ role: 'user', parts: [{ text: prompt }] }], generationConfig: { responseModalities: ['TEXT', 'IMAGE'], imageConfig: { aspectRatio: '1:1' } } },
      { model: imageModel, timeoutMs: 90_000 },
    );
    const img = content.parts.find((p) => p.inlineData?.data);
    if (!img) throw Object.assign(new Error('Gemini returned no image'), { status: 502 });
    return { mime: img.inlineData.mimeType || 'image/png', data: img.inlineData.data, model: imageModel };
  },

  async 'POST /api/loan-advice'(b) {
    return generateJSON({
      system: `You are a responsible micro-lending advisor for an Indian kirana shop owner. Recommend the loan that fits the shop's cash flow: daily repayment should stay under about 25% of average daily profit. Mention udhaar if collecting it would reduce borrowing. Only recommend offers marked eligible, preferring the one in selected_offer when it fits. Write in ${langName(b.lang)}; rupees as ₹ with Indian grouping.`,
      parts: [{ text: `Shop data (JSON): ${JSON.stringify(b)}` }],
      schema: {
        type: 'OBJECT',
        properties: {
          productId: { type: 'STRING' },
          amount: { type: 'NUMBER', description: 'Multiple of 5000' },
          months: { type: 'INTEGER', description: 'One of the chosen offer tenures' },
          summary: { type: 'STRING', description: '2 sentences: what to take, from whom, and the daily repayment vs profit' },
          risk: { type: 'STRING', description: 'One sentence on the main risk or a way to borrow less' },
        },
        required: ['productId', 'amount', 'months', 'summary', 'risk'],
      },
      temperature: 0.4,
    });
  },

  async 'POST /api/briefing'(b) {
    return generateJSON({
      system: `You write a spoken 30-second morning briefing for a kirana shop owner, to be read aloud by text-to-speech. Write in warm, ${langName(b.lang)}. No lists, no symbols other than ₹, no markdown. 4–6 short sentences.`,
      parts: [{ text: `Data: ${JSON.stringify(b.summary)}\nGreet the owner by name, then: yesterday's sales and profit, what to reorder today, the biggest udhaar to collect, and one encouraging line.` }],
      schema: { type: 'OBJECT', properties: { script: { type: 'STRING' } }, required: ['script'] },
      temperature: 0.6,
    });
  },
};

const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg', '.ico': 'image/x-icon', '.json': 'application/json', '.webmanifest': 'application/manifest+json', '.mp4': 'video/mp4' };

// Per-visitor limits so a public link can't run up the Vertex AI bill.
const LIMITS = { '/api/offer-image': [12, 3600_000], default: [120, 600_000] };
const hits = new Map();
function limited(req, path) {
  const ip = (req.headers['x-forwarded-for'] || '').split(',')[0].trim() || req.socket.remoteAddress || 'unknown';
  const [max, windowMs] = LIMITS[path] || LIMITS.default;
  const key = `${ip}|${LIMITS[path] ? path : '*'}`;
  const now = Date.now();
  const recent = (hits.get(key) || []).filter((t) => now - t < windowMs);
  recent.push(now);
  hits.set(key, recent);
  if (hits.size > 5000) for (const [k, v] of hits) if (!v.some((t) => now - t < 3600_000)) hits.delete(k);
  return recent.length > max;
}

function send(res, status, body) {
  res.writeHead(status, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
  res.end(JSON.stringify(body));
}

function serveStatic(req, res) {
  if (!STATIC) return send(res, 404, { error: 'web app not built; run npm run build in web/' });
  const path = decodeURIComponent(new URL(req.url, 'http://x').pathname);
  let file = normalize(join(STATIC, path));
  if (!file.startsWith(STATIC)) return send(res, 403, { error: 'forbidden' });
  if (!existsSync(file) || statSync(file).isDirectory()) file = join(STATIC, 'index.html');
  const ext = extname(file);
  res.writeHead(200, {
    'Content-Type': MIME[ext] || 'application/octet-stream',
    'Cache-Control': file.includes(`${'/'}assets${'/'}`) ? 'public, max-age=31536000, immutable' : 'no-cache',
  });
  createReadStream(file).pipe(res);
}

createServer(async (req, res) => {
  const route = routes[`${req.method} ${req.url.split('?')[0]}`];
  if (!route) {
    if (req.url.startsWith('/api/')) return send(res, 404, { error: 'not found' });
    return serveStatic(req, res);
  }
  const path = req.url.split('?')[0];
  if (req.method === 'POST' && limited(req, path)) return send(res, 429, { error: 'Too many requests. Please wait a few minutes.' });
  try {
    let body = {};
    if (req.method === 'POST') {
      const chunks = [];
      let size = 0;
      for await (const c of req) {
        size += c.length;
        if (size > 12_000_000) return send(res, 413, { error: 'too large' });
        chunks.push(c);
      }
      body = JSON.parse(Buffer.concat(chunks).toString() || '{}');
    }
    send(res, 200, await route(body));
  } catch (e) {
    console.error(req.url, e.message);
    send(res, e.status || 500, { error: e.message });
  }
}).listen(PORT, () => console.log(`Dukaan AI on :${PORT} · Gemini ${mode} (${model}) · static ${STATIC ?? 'none'}`));
