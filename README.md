# DATALIA — Marketing Automation Platform

AI-assisted social-media content platform: create posts with AI, get human approval
via a Telegram bot, and auto-publish to Facebook, Instagram, TikTok and LinkedIn.

This is a monorepo with one folder per architectural layer (see
[`plans/architecture_plan.md`](plans/architecture_plan.md) for the full technical plan).

## Repository layout

| Path | Layer | Stack | Status |
|---|---|---|---|
| [`frontend/`](frontend/) | Dashboard UI | Next.js 16 (App Router), React 19, Redux Toolkit, Tailwind v4 | Active |
| [`backend/`](backend/) | Business logic & AI (LLM Router) | Python, FastAPI, Docker | Prototype (caption API) |
| [`infra/`](infra/) | Orchestration & deployment | n8n, Docker Compose | Prototype |
| [`docs/`](docs/) | Handoff & status docs | Markdown | — |
| [`plans/`](plans/) | Architecture & day-by-day plans | Markdown | — |

> Previously everything lived under a single misleadingly-named `front/` folder.
> It has been split into the layers above. Handoff docs that were inside the app
> (`PassFront.md`, `CompteRendu_Day1.md`) now live in [`docs/`](docs/).

## Architecture (summary)

```
[Frontend] ──HTTP──▶ [n8n orchestration] ──▶ [Backend FastAPI / LLM Router] ──▶ AI providers
     │                      │                          │
     │                      └──▶ Telegram bot (human validation)
     └──────────────────────────▶ Airtable (database / back-office)
```

The frontend **never calls AI providers directly** — it goes through the backend
API and n8n webhooks. n8n and the Telegram bot are **not built yet**; the frontend
degrades gracefully (env-gated, with a local mock) until they exist.

## Run it

### Frontend (works standalone today)
```bash
cd frontend
npm install
cp .env.example .env.local   # optional; mock works with no config
npm run dev                   # http://localhost:3000
```

### Backend + n8n (Docker)
```bash
cd infra
cp .env.example .env          # add your OpenRouter / AI key
docker compose up --build
# n8n         → http://localhost:5678
# caption-api → http://localhost:8000
```

See each folder's `README.md` for details.
