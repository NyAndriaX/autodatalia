# Datalia — Marketing Automation Platform

Internal tool used by the Datalia team to plan, generate, schedule, validate
and publish content across Datalia's **own** social accounts (Facebook
Pages, Instagram Business, TikTok, LinkedIn). Not SaaS-for-clients —
exactly one tenant (Datalia itself), OAuth connections happen once at setup.

> ## ▶ Deploying this to production?
> **Read [`DEPLOY.md`](DEPLOY.md).** It's a top-to-bottom checklist —
> server setup, secrets, Telegram bot, social-portal config, smoke test.
> Follow it once and the app is live on your domain.

---

## What's in the box

| Module | Status |
|---|---|
| Manual post creation + AI caption generation + image/video uploads | Done |
| Calendar + scheduling + auto-publish | Done |
| OAuth for Facebook Pages, Instagram Business, TikTok, LinkedIn | Done |
| Image cropping per platform ratio + spam guards | Done |
| **AI image generation** — Nano Banana (Gemini 2.5 Flash Image) via OpenRouter | Done |
| **AI video generation** — LTX-2 (Lightricks official) → fal.ai → ffmpeg Ken Burns fallback, auto-fallback on provider failure | Done |
| **Cost dashboard** — per-call / per-workflow / per-tier / per-model spend in Postgres-backed log | Done |
| **3-tier LLM routing** — Fast (hashtags/transforms), Standard (variants), Premium (n≥3 variants) | Done |
| **Automation module** — auto-generate posts on a recurring schedule | Done (Phase 1–3) |
| **Telegram validation gate** — every auto-generated post requires explicit user approval before publish, manual approvals publish immediately | Done |
| **Timeout follow-up** — bot prompts resend/regenerate/cancel if no answer by publish time | Done |
| **i18n** — English + French, language switcher in Topbar + Settings | Done (Sidebar, Topbar, Dashboard, Credits, Video, Settings) |

For per-platform publish state see [`PROJECT_STATE.md`](PROJECT_STATE.md).

---

## Repository layout

| Path | Layer | Stack |
|---|---|---|
| [`frontend/`](frontend/) | Dashboard UI | Next.js 16 (App Router), React 19, Redux Toolkit, Tailwind v4 |
| [`backend/`](backend/) | API + AI + OAuth + publishing + automation worker | Python, FastAPI, Pydantic, Docker |
| [`infra/`](infra/) | Docker Compose orchestration + Caddy reverse-proxy config | YAML |
| [`docs/`](docs/) | Per-platform setup notes (TikTok, etc.) | Markdown |
| [`DEPLOY.md`](DEPLOY.md) | **Production deploy checklist** | Markdown |

---

## Architecture (current)

```
[Frontend (Next.js)] ──HTTP──▶ [Backend (FastAPI)] ──▶ OpenRouter (text + Nano Banana)
                                       │              ──▶ LTX-2 / fal.ai (video)
                                       │
                                       ├──▶ Meta Graph API   (Facebook + Instagram)
                                       ├──▶ TikTok API
                                       ├──▶ LinkedIn API
                                       ├──▶ Telegram Bot API (validation gate)
                                       └──▶ Postgres (users + auth only)
```

Three background loops inside the backend process:
- **scheduler** — fires posts whose `status == "scheduled"` and whose
  `scheduledDate + time` is now in the past.
- **automation worker** — scans active automation rules, generates
  candidate posts AI-side, submits them to Telegram for approval.
  Approved candidates flip to `status="scheduled"` and the scheduler
  picks them up like any other scheduled post.
- **video jobs worker** — polls the queued LTX / fal jobs, downloads
  finished MP4s, auto-falls-back to ffmpeg Ken Burns if the external
  provider raises so the user always gets *a* video.

Storage is split: posts, automation rules, OAuth tokens, cost logs,
video jobs and the activity feed live as JSON in a Docker named volume;
**users + auth** live in Postgres (a `postgres:16-alpine` container
ships in the dev compose; prod can swap to managed Postgres via
`DATABASE_URL`). No other external database needed.

---

## Run it locally

### Backend (Docker)
```bash
docker compose -f infra/docker-compose.yml up -d --build caption-api
# caption-api → http://localhost:8000
```

Meta and TikTok require HTTPS OAuth callbacks, so for OAuth testing point
a public HTTPS host at the backend and set `OAUTH_REDIRECT_BASE` +
`PUBLIC_BASE_URL` in `infra/.env` to that URL. Any tunneling service
that gives a stable HTTPS hostname works (Cloudflare Tunnel, Tailscale
Funnel, etc.). For production deployment see [`DEPLOY.md`](DEPLOY.md).

### Frontend
```bash
cd frontend
npm install
cp .env.example .env.local        # set NEXT_PUBLIC_API_BASE_URL
npm run dev                       # http://localhost:3000
```

### Backend tests
```bash
docker compose -f infra/docker-compose.yml exec -T caption-api \
  python -m pytest tests/ -q
```

---

## Per-platform status

| Platform   | OAuth | Publish |
|------------|-------|---------|
| Facebook   | Yes   | Text + photo + video + multi-photo carousel — confirmed |
| Instagram  | Yes   | Image + video — single confirmed; carousel hardened (drops per-child polling, longer parent-create backoff) |
| TikTok     | Yes   | Photo carousels + video, direct mode default with automatic scope-aware downgrade to inbox |
| LinkedIn   | Yes   | Text + single image — implemented, end-to-end pending a connected token |
| Google     | Sign-in only | n/a |

When the scheduler fires a post, every requested platform produces a
result row — no more silent drops. Platforms that aren't connected get
an explicit `meta_not_connected` / `tiktok_not_connected` /
`no_instagram_business_linked_to_page` error in the bell feed.

---

## Useful docs

- [`DEPLOY.md`](DEPLOY.md) — **production deploy checklist**
- [`PROJECT_STATE.md`](PROJECT_STATE.md) — current source-verified state
- [`backend/README.md`](backend/README.md) — API surface
- [`docs/tiktok.md`](docs/tiktok.md) — TikTok-specific setup notes
