# DATALIA — Marketing Automation Platform

Internal tool used by the Datalia team to plan, generate, schedule and publish
content across Datalia's **own** social accounts (Facebook Pages, Instagram
Business, TikTok, LinkedIn). It is **not** SaaS-for-clients — there is exactly
one tenant (Datalia itself) and OAuth connections happen once at setup.

## Repository layout

| Path | Layer | Stack | Status |
|---|---|---|---|
| [`frontend/`](frontend/) | Dashboard UI | Next.js 16 (App Router), React 19, Redux Toolkit, Tailwind v4 | Active |
| [`backend/`](backend/) | API + AI + OAuth + publishing | Python, FastAPI, Pydantic, Docker | Active |
| [`infra/`](infra/) | Local orchestration | Docker Compose | Active |
| [`docs/`](docs/) | Handoff & progress docs | Markdown | — |
| [`plans/`](plans/) | Original architecture & day-by-day plans | Markdown | Historical |

## Architecture (current)

```
[Frontend (Next.js)] ──HTTP──▶ [Backend (FastAPI)] ──▶ AI provider (OpenRouter)
                                       │
                                       ├──▶ Meta Graph API   (Facebook + Instagram)
                                       ├──▶ TikTok API       (stub)
                                       └──▶ LinkedIn API     (stub)
```

The frontend never calls AI providers or social APIs directly — everything
flows through the FastAPI backend. There is no orchestration layer between
them; n8n was evaluated and removed.

OAuth tokens persist server-side in `content/oauth_tokens.json`. Posts and
calendar entries persist as JSON under the backend's content directory.

## Run it

### Backend (Docker)
```bash
docker compose -f infra/docker-compose.yml up -d --build caption-api
# caption-api → http://localhost:8000
```

Meta and TikTok require HTTPS OAuth callbacks, so for OAuth testing point a
public HTTPS host (e.g. `ngrok http --url=<reserved>.ngrok-free.dev 8000`)
at the backend and set `OAUTH_REDIRECT_BASE` in `infra/.env` to that URL.

### Frontend
```bash
cd frontend
npm install
cp .env.example .env.local        # set NEXT_PUBLIC_API_BASE_URL
npm run dev                       # http://localhost:3000
```

## Per-platform status

| Platform   | OAuth | Publish |
|------------|-------|---------|
| Facebook   | Yes   | Text + photo |
| Instagram  | Yes   | Image + video (via Meta legacy scopes) |
| TikTok     | Stub  | Stub — pending app review |
| LinkedIn   | Stub  | Stub — pending client secret |
| Google     | Partial (sign-in only) | n/a |

See [`backend/README.md`](backend/README.md) for the API surface and
[`docs/`](docs/) for setup guides and handoff notes.
