// Records the Dukaan AI demo video from the real running app.
// 1. Synthesises an English voiceover per scene (Google Cloud TTS if credentials exist, else macOS `say`).
// 2. Drives the app inside stage.html with Playwright, capturing frames over the Chrome DevTools screencast.
// 3. Muxes frames and voice into out/dukaan-ai-demo.mp4 with ffmpeg.
//
// Usage: node record.mjs   (the app must be running on http://localhost:8080)
import { execFileSync } from 'node:child_process';
import { createSign } from 'node:crypto';
import { mkdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import ffmpegPath from 'ffmpeg-static';
import { chromium } from 'playwright';

const HERE = fileURLToPath(new URL('.', import.meta.url));
const OUT = join(HERE, 'out');
const FRAMES = join(OUT, 'frames');
const VO = join(OUT, 'vo');
const APP = process.env.APP_URL || 'http://localhost:8080';
const GEMINI = await fetch(`${APP}/api/health`).then((r) => r.json()).then((h) => h.gemini).catch(() => false);
const VOICE = process.env.TTS_VOICE || 'en-US-Studio-O';
const SAY_VOICE = process.env.SAY_VOICE || 'Daniel';

const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const ff = (args) => execFileSync(ffmpegPath, ['-y', '-loglevel', 'error', ...args], { stdio: ['ignore', 'ignore', 'inherit'] });

/* ---------------- voice ---------------- */

async function googleToken() {
  const sa = JSON.parse(readFileSync(process.env.GOOGLE_APPLICATION_CREDENTIALS, 'utf8'));
  const now = Math.floor(Date.now() / 1000);
  const enc = (o) => Buffer.from(JSON.stringify(o)).toString('base64url');
  const unsigned = `${enc({ alg: 'RS256', typ: 'JWT' })}.${enc({ iss: sa.client_email, scope: 'https://www.googleapis.com/auth/cloud-platform', aud: 'https://oauth2.googleapis.com/token', iat: now, exp: now + 3600 })}`;
  const sig = createSign('RSA-SHA256').update(unsigned).sign(sa.private_key, 'base64url');
  const res = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer', assertion: `${unsigned}.${sig}` }),
  });
  if (!res.ok) throw new Error(`token: ${res.status} ${await res.text()}`);
  return { token: (await res.json()).access_token, project: sa.project_id };
}

let gcp = null;
async function synth(text, file) {
  const wav = `${file}.wav`;
  if (process.env.GOOGLE_APPLICATION_CREDENTIALS) {
    gcp ??= await googleToken();
    const res = await fetch('https://texttospeech.googleapis.com/v1/text:synthesize', {
      method: 'POST',
      headers: { Authorization: `Bearer ${gcp.token}`, 'x-goog-user-project': gcp.project, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        input: { text },
        voice: { languageCode: VOICE.slice(0, 5), name: VOICE },
        audioConfig: { audioEncoding: 'LINEAR16', sampleRateHertz: 48000, speakingRate: 1.0 },
      }),
    });
    if (!res.ok) throw new Error(`TTS: ${res.status} ${await res.text()}`);
    writeFileSync(`${file}.raw.wav`, Buffer.from((await res.json()).audioContent, 'base64'));
    ff(['-i', `${file}.raw.wav`, '-ar', '48000', '-ac', '1', wav]);
  } else {
    execFileSync('say', ['-v', SAY_VOICE, '-r', '172', '-o', `${file}.aiff`, text]);
    ff(['-i', `${file}.aiff`, '-ar', '48000', '-ac', '1', '-af', 'highpass=f=70,acompressor=threshold=-18dB:ratio=3:attack=5:release=60,loudnorm=I=-16:TP=-1.5', wav]);
  }
  const seconds = (statSync(wav).size - 44) / (48000 * 2);
  return { wav, seconds };
}

/* ---------------- scenes ---------------- */

const SCENES = [
  {
    id: 'intro',
    vo: "India has more than thirteen million kirana stores. Most still keep their accounts in a paper notebook. Owners can't see their real profit, they lose track of credit, and without records, banks won't lend to them.",
    async run({ stage }) {
      await stage('card', { title: 'Dukaan AI', sub: 'An AI employee for India’s kirana stores', stats: [['13M+', 'kirana stores in India'], ['Paper', 'how most keep accounts'], ['No credit', 'without formal records']], foot: 'Built with <b>Gemini</b> on <b>Google Cloud Run</b>' });
    },
  },
  {
    id: 'home',
    vo: "Dukaan AI changes that. This is Ramesh's shop. His home screen shows today's real profit after costs, his sales and the credit customers owe, and a short list of what needs his attention.",
    async run({ stage }) {
      await stage('caption', { step: '01 · The shop at a glance', title: 'Every number,<br>always current.', body: 'Real profit, sales and udhaar, plus the actions that matter today.', tags: ['Profit after cost', 'Needs attention', 'One-tap actions'] });
      await stage('hideCard');
    },
  },
  {
    id: 'voice',
    vo: 'Recording a sale takes seconds. Ramesh simply says it, in Hinglish, the way he talks at the counter. Gemini turns his words into structured ledger entries and shows them as cards. Nothing is saved until he confirms.',
    async run({ stage, app }) {
      await stage('caption', { step: '02 · Speak, don’t type', title: 'Say it the way<br>you say it.', body: 'English and eleven Indian languages, from Hindi to Tamil. The AI proposes, the owner approves.', tags: ['<b>Gemini</b> understanding', 'Confirm before save'] });
      await wait(600);
      await app.getByRole('button', { name: 'Add', exact: true }).click();
      await wait(900);
      const box = app.locator('textarea');
      await box.click();
      await box.pressSequentially('Mohan Lal ne 2 kg dal udhaar liya 240', { delay: 55 });
      await wait(400);
      await app.locator('form.composer button[type=submit]').click();
      await app.getByText('Check before saving').waitFor();
      await wait(3200);
      await app.getByRole('button', { name: /Save all/ }).click();
      await wait(1200);
    },
  },
  {
    id: 'bill',
    vo: "When stock arrives, he photographs the supplier's bill. Gemini's vision model reads every line item, and with one tap the whole delivery is added to inventory, with costs tracked so profit is always accurate.",
    async run({ stage, app }) {
      await stage('caption', { step: '03 · Snap the bill', title: 'A photo becomes<br>your stock register.', body: 'Every line on a supplier bill becomes a purchase, with weighted average cost for true profit.', tags: ['<b>Gemini</b> multimodal vision', 'Auto inventory'] });
      await app.getByRole('button', { name: 'Add', exact: true }).click();
      await wait(800);
      await app.getByRole('tab', { name: /Bill photo/ }).click();
      await wait(700);
      await app.getByRole('button', { name: 'Use a sample bill' }).click();
      await wait(1600);
      await app.getByRole('button', { name: /Scan bill/ }).click();
      await app.getByText('Check before saving').waitFor({ timeout: 60_000 });
      await wait(1500);
      await app.locator('.sheet-body').evaluate((el) => el.scrollTo({ top: 400, behavior: 'smooth' }));
      await wait(1800);
      await app.getByRole('button', { name: /Save all/ }).click();
      await wait(900);
    },
  },
  {
    id: 'agent',
    vo: "Now the most powerful part: Ask Dukaan, an AI agent built on Gemini function calling. Ramesh asks who hasn't paid in thirty days, and what is running out. Gemini decides which tools to run on his own ledger, and every step is shown on screen.",
    async run({ stage, app }) {
      await stage('caption', { step: '04 · Ask Dukaan', title: 'An agent that<br>runs the books.', body: 'Gemini chooses tools, runs them on the shop’s own ledger, and answers with real numbers.', tags: ['<b>Gemini</b> function calling', 'Visible tool calls'] });
      await app.locator('.ask-field').click();
      await wait(1000);
      const box = app.locator('.sheet-foot textarea');
      await box.click();
      await box.pressSequentially("Who hasn't paid udhaar in 30 days, and what's running out?", { delay: 38 });
      await wait(300);
      await box.press('Enter');
      await app.locator('.answer').first().waitFor({ timeout: 60_000 });
      await wait(2500);
    },
  },
  {
    id: 'act',
    vo: 'Then it takes action. It drafts polite WhatsApp reminders for overdue customers, and a reorder for his supplier, ready to send with a single tap.',
    async run({ stage, app }) {
      await stage('caption', { step: '05 · From answer to action', title: 'Reminders and orders,<br>drafted for you.', body: 'Udhaar reminders and supplier orders go out on WhatsApp with one tap.', tags: ['WhatsApp drafts', 'Owner stays in control'] });
      const box = app.locator('.sheet-foot textarea');
      await box.click();
      await box.pressSequentially('Send them reminders and make a sugar order', { delay: 40 });
      await box.press('Enter');
      await app.locator('.answer').nth(1).waitFor({ timeout: 60_000 });
      await wait(1200);
      await app.locator('.sheet-body').evaluate((el) => el.scrollTo({ top: el.scrollHeight, behavior: 'smooth' }));
      await wait(2500);
    },
  },
  {
    id: 'offers',
    vo: 'Dukaan AI also watches every expiry date and how fast each item sells. When paneer is about to expire, Gemini designs an offer that clears the stock before it goes to waste, without giving away the margin. It creates the poster and the message, ready to share on WhatsApp in one tap.',
    async run({ stage, app }) {
      await stage('caption', { step: '06 · Smart offers', title: 'Clear stock before<br>it expires.', body: 'Expiring and slow-moving items are spotted automatically. Gemini designs the offer, the poster and the message.', tags: ['<b>Gemini</b> offer design', 'Margin guardrails', 'Shop poster'] });
      await app.getByRole('button', { name: 'Close' }).click();
      await wait(500);
      await app.locator('.nav').getByRole('button', { name: /Stock/ }).click();
      await wait(1400);
      await app.locator('.risk-banner').click();
      await wait(1800);
      await app.getByRole('button', { name: /Create offer with AI/ }).first().click();
      await app.locator('.poster-frame img').waitFor({ timeout: 60_000 });
      if (GEMINI) {
        // Start the Gemini image straight away so it renders while the narration runs.
        await wait(900);
        await app.locator('.poster-seg button').nth(1).click();
        await app.locator('.poster-frame img').waitFor({ timeout: 95_000 });
        await wait(4500);
        await app.locator('.sheet-body').evaluate((el) => el.scrollTo({ top: 300, behavior: 'smooth' }));
        await wait(2400);
      } else {
        await wait(2600);
        await app.locator('.sheet-body').evaluate((el) => el.scrollTo({ top: 420, behavior: 'smooth' }));
        await wait(2200);
      }
      await app.getByRole('button', { name: /Start offer/ }).click();
      await wait(1200);
    },
  },
  {
    id: 'loans',
    vo: 'And every entry builds his Dukaan Score. With a strong score, Ramesh is pre-approved for credit. He picks an amount, sees the daily repayment against his real profit, asks the AI advisor, and applies with one tap, sharing only what he consents to.',
    async run({ stage, app }) {
      await stage('caption', { step: '07 · Credit, unlocked', title: 'From notebook<br>to loan-ready.', body: 'The Dukaan Score opens micro-loans. Repayments are sized to the shop’s daily profit, and consent stays with the owner.', tags: ['<b>Gemini</b> loan advisor', 'Account Aggregator consent', 'Daily repayment'] });
      await app.locator('.nav').getByRole('button', { name: 'Insights' }).click();
      await wait(1600);
      await app.getByRole('button', { name: 'See loan offers' }).click();
      await wait(2200);
      await app.locator('.screen').evaluate((el) => el.scrollTo({ top: 640, behavior: 'smooth' }));
      await wait(1600);
      await app.getByRole('button', { name: /Ask the AI advisor/ }).click();
      await app.locator('.advisor p').first().waitFor({ timeout: 60_000 });
      await wait(2200);
      await app.getByRole('button', { name: /Apply for/ }).click();
      await wait(2200);
      await app.getByRole('button', { name: /Agree and apply/ }).click();
      await wait(5000);
    },
  },
  {
    id: 'whatsapp',
    vo: 'And because shop owners live on WhatsApp, Dukaan AI works there too. A voice note becomes a confirmed entry, and a photo of a bill becomes stock, with no app to install.',
    async run({ stage, app }) {
      await stage('caption', { step: '08 · On WhatsApp', title: 'No app to install.<br>Just send a voice note.', body: 'The same Gemini pipeline behind a chat: voice notes become entries, bill photos become stock, questions get answers.', tags: ['Voice notes', 'Bill photos', 'Confirm with one tap'] });
      await app.locator('.nav').getByRole('button', { name: 'Home' }).click();
      await wait(900);
      await app.locator('.wa-try').click();
      await wait(1400);
      await app.locator('.wa-chips button').nth(0).click();
      await app.locator('.wa-quick').first().waitFor({ timeout: 60_000 });
      await wait(1800);
      await app.locator('.wa-quick button').first().click();
      await wait(1400);
      await app.locator('.wa-chips button').nth(1).click();
      await app.locator('.wa-quick').first().waitFor({ timeout: 90_000 });
      await wait(2500);
    },
  },
  {
    id: 'lang',
    vo: "Dukaan AI speaks the owner's language. The whole app, voice input, and every Gemini answer switch between English and eleven Indian languages, from Hindi and Bengali to Tamil and Malayalam, with a single tap.",
    async run({ stage, app }) {
      await stage('caption', { step: '09 · Built for Bharat', title: 'Twelve languages,<br>one tap.', body: 'Hindi, Hinglish, Bengali, Telugu, Marathi, Tamil, Gujarati, Kannada, Malayalam, Punjabi, Odia and English.', tags: ['Native scripts', 'Voice in every language', '<b>Gemini</b> answers in kind'] });
      await app.locator('.nav').getByRole('button', { name: 'Home' }).click();
      await wait(1200);
      const pick = async (native) => {
        await app.locator('.m-actions .ghost-icon').first().click();
        await wait(1000);
        await app.locator('.lang-opt', { hasText: native }).click();
        await wait(2600);
      };
      await pick('हिन्दी');
      await pick('தமிழ்');
      await pick('বাংলা');
      await pick('English');
    },
  },
  {
    id: 'web',
    vo: "Dukaan AI works on any phone, and as a full web dashboard for family members who help run the business, with stock, offers and loans in one place. It's powered by Gemini and deployed on Google Cloud Run.",
    async run({ stage, desk, page }) {
      await page.evaluate(() => { const f = document.getElementById('deskapp'); f.src = f.src; });
      await desk.locator('.side').waitFor();
      await wait(800);
      await stage('desktop', true);
      await wait(2600);
      await desk.locator('.side').getByRole('button', { name: /Stock/ }).click();
      await wait(2400);
      await desk.locator('.side').getByRole('button', { name: /Smart offers/ }).click();
      await wait(2400);
      await desk.locator('.side').getByRole('button', { name: /Loans/ }).click();
      await wait(2200);
    },
  },
  {
    id: 'outro',
    vo: "Next come a WhatsApp bot, GST invoicing, and real lending partners. Dukaan AI. It listens, it keeps the books, and it helps India's small shops get credit.",
    async run({ stage }) {
      await stage('card', { title: 'Dukaan AI', sub: 'It listens. It keeps the books.<br>It helps India’s kirana stores get credit.', stats: [['Gemini', 'agent, vision & insights'], ['Cloud Run', 'deployed backend'], ['Next', 'WhatsApp bot · GST · NBFC partners']], foot: 'Try it: <b>dukaan-ai-633400982.asia-south1.run.app</b> · Code: <b>github.com/praffulsilakari7777/dukaan-ai</b>' });
    },
  },
];

/* ---------------- main ---------------- */

rmSync(OUT, { recursive: true, force: true });
mkdirSync(FRAMES, { recursive: true });
mkdirSync(VO, { recursive: true });

console.log(`Voice: ${process.env.GOOGLE_APPLICATION_CREDENTIALS ? `Google TTS ${VOICE}` : `macOS ${SAY_VOICE}`}`);
for (const s of SCENES) {
  Object.assign(s, await synth(s.vo, join(VO, s.id)));
  console.log(`  ${s.id.padEnd(7)} ${s.seconds.toFixed(1)}s`);
}

const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 1920, height: 1080 }, deviceScaleFactor: 1 });
// The first-run tour is for real visitors; the film starts inside the app.
await ctx.addInitScript(() => { try { localStorage.setItem('dukaan-ai:tour', 'done'); } catch {} });
const page = await ctx.newPage();
await page.goto(`file://${join(HERE, 'stage.html')}`);
await page.evaluate((url) => {
  document.getElementById('app').src = url;
  document.getElementById('deskapp').src = url;
}, APP);
const app = page.frameLocator('#app');
const desk = page.frameLocator('#deskapp');
await app.locator('.summary').waitFor();
await page.evaluate(() => document.fonts.ready);
await wait(1500);

const stage = (fn, arg) => page.evaluate(([f, a]) => window.stage[f](a), [fn, arg]);

// Frames arrive only when pixels change; each frame is held until the next one.
const cdp = await ctx.newCDPSession(page);
const frames = [];
cdp.on('Page.screencastFrame', async ({ data, metadata, sessionId }) => {
  frames.push({ data, t: metadata.timestamp });
  cdp.send('Page.screencastFrameAck', { sessionId }).catch(() => {});
});
await stage('card', { title: 'Dukaan AI', sub: 'An AI employee for India’s kirana stores' });
await wait(300);
await cdp.send('Page.startScreencast', { format: 'jpeg', quality: 92, maxWidth: 1920, maxHeight: 1080, everyNthFrame: 1 });

await wait(500);
const t0 = Date.now() / 1000;
const marks = [];
for (const s of SCENES) {
  const start = Date.now() / 1000 - t0;
  marks.push({ id: s.id, start, wav: s.wav });
  const minEnd = Date.now() + s.seconds * 1000 + 700;
  await s.run({ stage, app, desk, page });
  const left = minEnd - Date.now();
  if (left > 0) await wait(left);
  console.log(`  recorded ${s.id} at ${start.toFixed(1)}s`);
}
await wait(1500);
const tEnd = Date.now() / 1000;
await cdp.send('Page.stopScreencast');
await browser.close();

// Frames → constant 30fps video.
const startT = frames.find((f) => f.t >= t0)?.t ?? frames[0].t;
const used = frames.filter((f) => f.t >= startT - 0.001);
const end = Math.max(used[used.length - 1].t + 0.5, tEnd);
let list = '';
used.forEach((f, i) => {
  const name = `f${String(i).padStart(6, '0')}.jpg`;
  writeFileSync(join(FRAMES, name), Buffer.from(f.data, 'base64'));
  const next = i + 1 < used.length ? used[i + 1].t : end;
  list += `file '${name}'\nduration ${Math.max(next - f.t, 0.001).toFixed(4)}\n`;
});
list += `file 'f${String(used.length - 1).padStart(6, '0')}.jpg'\n`;
writeFileSync(join(FRAMES, 'list.txt'), list);
const silent = join(OUT, 'silent.mp4');
ff(['-f', 'concat', '-safe', '0', '-i', join(FRAMES, 'list.txt'), '-vf', 'fps=30,format=yuv420p', '-c:v', 'libx264', '-preset', 'slow', '-crf', '18', silent]);

// Voice clips placed at each scene's start.
const offset = startT - t0;
const inputs = marks.flatMap((m) => ['-i', m.wav]);
const delays = marks.map((m, i) => `[${i}:a]adelay=${Math.max(Math.round((m.start - offset + 0.35) * 1000), 0)}|${Math.max(Math.round((m.start - offset + 0.35) * 1000), 0)}[a${i}]`).join(';');
const mix = `${delays};${marks.map((_, i) => `[a${i}]`).join('')}amix=inputs=${marks.length}:normalize=0,apad[aout]`;
const voice = join(OUT, 'voice.wav');
ff([...inputs, '-filter_complex', mix, '-map', '[aout]', '-t', String(end - startT), '-ar', '48000', voice]);

const final = join(OUT, 'dukaan-ai-demo.mp4');
ff(['-i', silent, '-i', voice, '-c:v', 'copy', '-c:a', 'aac', '-b:a', '192k', '-shortest', '-movflags', '+faststart', final]);
rmSync(FRAMES, { recursive: true, force: true });
console.log(`\nDone: ${final} (${(end - startT).toFixed(1)}s, ${used.length} frames)`);
