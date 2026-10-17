// Dukaan AI server: holds the Gemini credentials, exposes /api/*, and serves the built web app.
import { createReadStream, existsSync, statSync } from 'node:fs';
import { createServer } from 'node:http';
import { extname, join, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';
import { generate, generateJSON, mode, model } from './gemini.mjs';

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
    name: 'record_entry',
    description: 'Proposes ledger entries (sales, purchases, udhaar, payments, expenses) when the owner tells you about a transaction. They are shown to the owner as cards to confirm; nothing is saved until they tap save.',
    parameters: { type: 'OBJECT', properties: { entries: { type: 'ARRAY', items: ENTRY_SCHEMA } }, required: ['entries'] },
  },
];

function agentSystem(b) {
  return `You are "Ask Dukaan", the AI employee of ${b.shopName || 'a kirana shop'} in India, owned by ${b.ownerName || 'the owner'}. Today is ${b.today}.
You can read the shop's live ledger only through your tools. Never guess numbers: call a tool, then answer from its result.
Use several tools in one turn when the question has several parts. When asked to send, remind, order or promote, draft the messages with the draft_* tools (the owner sends them with one tap; you never send anything yourself).
Known items: ${(b.items || []).slice(0, 60).join(', ') || 'none yet'}. Known customers: ${(b.customers || []).slice(0, 40).join(', ') || 'none yet'}.
Answer in the owner's language: if they write Hinglish or Hindi, reply in simple Hinglish; otherwise in plain English. ${b.lang === 'hi' ? 'The app is set to Hinglish.' : ''}
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
    const out = await generateJSON({
      system: SCAN_SYSTEM,
      parts: [{ inlineData: { mimeType: b.mime || 'image/jpeg', data: b.image } }, { text: 'Extract the purchased items from this bill.' }],
      schema: {
        type: 'OBJECT',
        properties: {
          supplier: { type: 'STRING', nullable: true },
          entries: { type: 'ARRAY', items: { type: 'OBJECT', properties: { item: { type: 'STRING' }, qty: { type: 'NUMBER' }, unit: { type: 'STRING' }, amount: { type: 'NUMBER' } }, required: ['item', 'amount'] } },
        },
        required: ['entries'],
      },
    });
    return { supplier: out.supplier, entries: (out.entries || []).map((e) => ({ ...e, type: 'purchase' })) };
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
    const hi = b.lang === 'hi';
    return generateJSON({
      system: `You are a small-business advisor and credit analyst for Indian kirana shops. Use only the numbers given. Write ${hi ? 'in simple Hinglish (Roman script)' : 'in plain, warm English a shopkeeper understands'}. No jargon.`,
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

  async 'POST /api/briefing'(b) {
    const hi = b.lang === 'hi';
    return generateJSON({
      system: `You write a spoken 30-second morning briefing for a kirana shop owner, to be read aloud by text-to-speech. ${hi ? 'Write in simple Hinglish (Roman script).' : 'Write in warm, simple English.'} No lists, no symbols other than ₹, no markdown. 4–6 short sentences.`,
      parts: [{ text: `Data: ${JSON.stringify(b.summary)}\nGreet the owner by name, then: yesterday's sales and profit, what to reorder today, the biggest udhaar to collect, and one encouraging line.` }],
      schema: { type: 'OBJECT', properties: { script: { type: 'STRING' } }, required: ['script'] },
      temperature: 0.6,
    });
  },
};

const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg', '.ico': 'image/x-icon', '.json': 'application/json', '.webmanifest': 'application/manifest+json', '.mp4': 'video/mp4' };

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
