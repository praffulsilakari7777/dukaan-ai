// Gemini access with no SDK: either an AI Studio API key, or Vertex AI with a
// service account (a key file via GOOGLE_APPLICATION_CREDENTIALS, or the Cloud Run identity).
import { createSign } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';

// Local secrets live in server/.env (git-ignored). Real environment variables win.
const ENV_FILE = new URL('./.env', import.meta.url);
if (existsSync(ENV_FILE)) {
  for (const line of readFileSync(ENV_FILE, 'utf8').split('\n')) {
    const m = line.match(/^\s*([A-Z_][A-Z0-9_]*)\s*=\s*(.*?)\s*$/);
    if (m && m[2] && !(m[1] in process.env)) process.env[m[1]] = m[2].replace(/^["']|["']$/g, '');
  }
}

const MODEL = process.env.GEMINI_MODEL || 'gemini-2.5-flash';
const API_KEY = process.env.GEMINI_API_KEY || '';
const LOCATION = process.env.VERTEX_LOCATION || 'us-central1';
const SA_PATH = process.env.GOOGLE_APPLICATION_CREDENTIALS || '';
const ON_CLOUD_RUN = !!process.env.K_SERVICE;

let sa = null;
if (SA_PATH) {
  try {
    sa = JSON.parse(readFileSync(SA_PATH, 'utf8'));
  } catch (e) {
    console.warn(`Could not read service account at ${SA_PATH}: ${e.message}`);
  }
}
const PROJECT = process.env.GOOGLE_CLOUD_PROJECT || sa?.project_id || '';

export const mode = API_KEY ? 'api-key' : sa || (ON_CLOUD_RUN && PROJECT) || process.env.USE_VERTEX ? 'vertex' : 'none';
export const model = MODEL;

let cached = { token: '', exp: 0 };
const b64url = (b) => Buffer.from(b).toString('base64url');

async function accessToken() {
  if (cached.token && Date.now() < cached.exp - 60_000) return cached.token;
  let res;
  if (sa) {
    const now = Math.floor(Date.now() / 1000);
    const head = b64url(JSON.stringify({ alg: 'RS256', typ: 'JWT' }));
    const claim = b64url(JSON.stringify({ iss: sa.client_email, scope: 'https://www.googleapis.com/auth/cloud-platform', aud: sa.token_uri || 'https://oauth2.googleapis.com/token', iat: now, exp: now + 3600 }));
    const sig = createSign('RSA-SHA256').update(`${head}.${claim}`).sign(sa.private_key, 'base64url');
    res = await fetch(sa.token_uri || 'https://oauth2.googleapis.com/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer', assertion: `${head}.${claim}.${sig}` }),
    });
  } else {
    res = await fetch('http://metadata.google.internal/computeMetadata/v1/instance/service-accounts/default/token', { headers: { 'Metadata-Flavor': 'Google' } });
  }
  if (!res.ok) throw new Error(`token request failed: ${res.status} ${await res.text()}`);
  const j = await res.json();
  cached = { token: j.access_token, exp: Date.now() + j.expires_in * 1000 };
  return cached.token;
}

export const imageModel = process.env.GEMINI_IMAGE_MODEL || 'gemini-2.5-flash-image';

export async function generate(body, { timeoutMs = 40_000, model: useModel = MODEL } = {}) {
  if (mode === 'none') throw Object.assign(new Error('Gemini is not configured'), { status: 503 });
  let url;
  const headers = { 'Content-Type': 'application/json' };
  if (mode === 'api-key') {
    url = `https://generativelanguage.googleapis.com/v1beta/models/${useModel}:generateContent`;
    headers['x-goog-api-key'] = API_KEY;
  } else {
    const host = LOCATION === 'global' ? 'aiplatform.googleapis.com' : `${LOCATION}-aiplatform.googleapis.com`;
    url = `https://${host}/v1/projects/${PROJECT}/locations/${LOCATION}/publishers/google/models/${useModel}:generateContent`;
    headers.Authorization = `Bearer ${await accessToken()}`;
  }
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(url, { method: 'POST', headers, body: JSON.stringify(body), signal: ctrl.signal });
    const text = await res.text();
    if (!res.ok) throw Object.assign(new Error(`Gemini ${res.status}: ${text.slice(0, 400)}`), { status: 502 });
    const json = JSON.parse(text);
    const content = json.candidates?.[0]?.content;
    if (!content?.parts?.length) throw Object.assign(new Error(`Gemini returned no content (${json.candidates?.[0]?.finishReason ?? 'unknown'})`), { status: 502 });
    return content;
  } finally {
    clearTimeout(timer);
  }
}

/** Calls Gemini in JSON mode and parses the reply. */
export async function generateJSON({ system, parts, schema, temperature = 0.2 }) {
  const content = await generate({
    systemInstruction: { parts: [{ text: system }] },
    contents: [{ role: 'user', parts }],
    generationConfig: { temperature, responseMimeType: 'application/json', responseSchema: schema, thinkingConfig: { thinkingBudget: 0 } },
  });
  const text = content.parts.map((p) => p.text ?? '').join('');
  return JSON.parse(text);
}
