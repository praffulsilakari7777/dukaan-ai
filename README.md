# Dukaan AI

**An AI employee for India's kirana stores: it listens, keeps the books, and helps them get credit.**

A shop owner speaks a sale in Hinglish ("Ramesh ne 2 kg dal udhaar liya 240") or photographs a supplier bill. Gemini turns it into ledger entries, the owner confirms, and stock, khata (udhaar), profit and a loan-readiness **Dukaan Score** update on their own. **Ask Dukaan** is a Gemini function-calling agent that answers questions about the shop and drafts WhatsApp reminders, supplier orders and offers.

Built for the Google Cloud AI Builder Cup 2026, Theme 2 (Retail & Commerce), with a link to Theme 1 (BFSI) through the Dukaan Score.

## Features

| # | Feature | Google tech |
|---|---|---|
| 1 | Voice entry in Hindi, Hinglish, English, Telugu, Tamil, Marathi, Bengali, Gujarati | Chrome Web Speech (Google speech recognition), Gemini |
| 2 | Text entry with one-tap examples | Gemini |
| 3 | Bill photo scan: every line item becomes a purchase and goes into stock | Gemini multimodal |
| 4 | Confirm before save: AI proposes cards, the owner removes or edits, then saves | — |
| 5 | Inventory with weighted average cost, days of stock left, low-stock flags | — |
| 6 | Khata: udhaar per customer, Jama, one-tap WhatsApp reminder | WhatsApp click-to-chat |
| 7 | Profit dashboard: today's profit and sales, udhaar due, 7-day chart | — |
| 8 | Insights: Dukaan Score 300–900, reorder list, slow movers, AI tips | Gemini |
| 9 | **Ask Dukaan agent**: Gemini picks tools (`get_sales`, `find_overdue_customers`, `check_stock`, `draft_supplier_order`, `draft_reminders`, `draft_promo`, `find_offer_candidates`, `create_offer`, `check_loan_eligibility`, `record_entry`), the app runs them on the local ledger, and every tool call is shown on screen | Gemini function calling |
| 10 | Cloud Run backend that holds the Gemini credentials | Cloud Run, Vertex AI |
| 11 | Spoken morning briefing | Gemini, speech synthesis |
| 12 | Promo and supplier-order drafts | Gemini |
| 13 | Dukaan Score explained as a credit profile with one step to improve | Gemini |
| 14 | 12 languages: English, हिन्दी, Hinglish, বাংলা, తెలుగు, मराठी, தமிழ், ગુજરાતી, ಕನ್ನಡ, മലയാളം, ਪੰਜਾਬੀ, ଓଡ଼ିଆ. UI, voice input, spoken briefing and every Gemini answer follow the chosen language | Gemini, Web Speech |
| 15 | **Smart offers**: finds stock that will expire before it sells (FIFO batches with best-before dates) or has stopped selling; Gemini designs a margin-safe discount or combo, a WhatsApp message and a poster | Gemini |
| 16 | **Gemini poster images**: one tap turns the offer into a photo-quality poster, shared to WhatsApp as an image | Gemini 2.5 Flash Image |
| 17 | **Credit lending prototype**: Dukaan Score → loan offers from demo partner lenders, EMI and daily-repayment calculator, affordability vs real daily profit, Gemini loan advisor, consent screen (Account Aggregator style) and application tracking | Gemini |

If Gemini is unreachable, a built-in parser and keyword agent keep voice, text, the sample bill and Ask Dukaan working, so a demo never breaks.

## Run locally

```bash
cd web && npm install && npm run build
cd ../server && GEMINI_API_KEY=your-key node index.mjs
# open http://localhost:8080
```

For hot reload, run the server as above and `npm run dev` in `web/` (Vite proxies `/api` to port 8080).

Gemini credentials, in order of preference:

- `GEMINI_API_KEY`: an AI Studio key.
- `GOOGLE_APPLICATION_CREDENTIALS=/path/to/service-account.json`: Vertex AI with a service account (needs the Vertex AI User role). `GOOGLE_CLOUD_PROJECT` and `VERTEX_LOCATION` are optional.
- On Cloud Run with neither set, the service's own identity calls Vertex AI.

`GEMINI_MODEL` defaults to `gemini-2.5-flash`; `GEMINI_IMAGE_MODEL` (offer posters) defaults to `gemini-2.5-flash-image`. With no credentials the server still runs and the app uses its offline fallbacks.

## Deploy to Cloud Run

```bash
gcloud run deploy dukaan-ai --source . --region asia-south1 --allow-unauthenticated \
  --set-env-vars GOOGLE_CLOUD_PROJECT=$(gcloud config get-value project),VERTEX_LOCATION=us-central1
```

Give the Cloud Run service account the **Vertex AI User** role, or pass `--set-secrets GEMINI_API_KEY=gemini-key:latest` to use an API key from Secret Manager.

## Architecture

- `web/`: React + Vite app. The ledger lives on the phone (localStorage). `src/lib/ledger.ts` replays every entry to derive stock (weighted average cost), khata, daily profit and the Dukaan Score (active days 35%, sales volume 25%, udhaar collected 25%, profitability 15%).
- `server/`: a zero-dependency Node server. `POST /api/parse`, `/api/scan`, `/api/agent`, `/api/insights`, `/api/briefing`, `/api/offer`, `/api/offer-image`, `/api/loan-advice` call Gemini in strict JSON mode or with function declarations. It also serves the built app.
- The agent loop: the app sends the question to `/api/agent` → Gemini returns function calls → the app runs them on the local ledger → sends results back → repeats until Gemini answers. Write actions (`record_entry`) are only proposed; the owner confirms them.

The lending screens are a prototype: lenders are fictional demo partners, consent is simulated, and no data leaves the phone.

## Demo video

`video/record.mjs` films the running app scene by scene and narrates it: `cd video && npm install && node record.mjs` (with the server on port 8080). Set `GOOGLE_APPLICATION_CREDENTIALS` to narrate with Google Cloud Text-to-Speech instead of the macOS voice.
