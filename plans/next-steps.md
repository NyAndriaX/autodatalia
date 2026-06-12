# Next Steps — Datalia Priority Plan

> Built from the current state as of May 24, 2026. This document ranks the
> remaining work by impact vs. effort, accounting for what's blocked and what
> isn't. Pair with [`architecture_plan.md`](architecture_plan.md) for the
> original roadmap and [`hosting.md`](hosting.md) for deployment specifics.

---

## Current state (baseline)

| Platform | OAuth | Single post | Carousel/multi | Video |
|---|---|---|---|---|
| TikTok | ✅ | ✅ | ✅ photos | ✅ videos |
| Facebook | ✅ | ✅ | ✅ photos | ✅ |
| Instagram | ✅ | ✅ | ✅ carousel (on stable domain) | ✅ |
| LinkedIn | ✅ code path | ✅ code path | 🔴 stub | 🔴 stub |

- **AI**: connected to OpenRouter, disk cache (98→0 tokens on repeats), token counter visible. Three-tier env routing exists (`AI_MODEL_FAST`, `AI_MODEL`, `AI_MODEL_PREMIUM`) but not used deliberately yet — all calls currently go through `AI_MODEL`.
- **Scheduler**: works locally, dies when laptop sleeps. No deployed always-on backend.
- **Persistence**: MariaDB (PyMySQL) — `users` table + a per-user scoped doc store for posts, OAuth tokens, automation rules, messages, cost logs, and video jobs. The earlier file-based-JSON / Airtable-migration plan was superseded by MariaDB.
- **Telegram validation**: code built (`telegram_validation.py`, webhook, inline buttons, approve/reject/edit/schedule), not live-tested. Blocked on `TELEGRAM_BOT_TOKEN` + `TELEGRAM_DEFAULT_CHAT_ID` not set in env.
- **Media generation**: `POST /media/generate/image` and `POST /media/generate/video` work with a local fallback poster renderer + motion clip. External AI image/video provider available if `AI_IMAGE_MODEL` env is set.
- **Video generation (ComfyUI)**: not started.

---

## Priority 1: Deploy to the production server

**Why first:** Scheduled posts are the product's core value prop, and they don't
work when the dev machine sleeps. Deployment also eliminates all ngrok friction
(interstitial race conditions, URL re-verification) and unblocks TikTok
`PULL_FROM_URL` photo posts via real domain verification.

### Tasks

| # | Task | Detail |
|---|---|---|
| 1.1 | Install Docker on server | `curl -fsSL get.docker.com \| sh` |
| 1.2 | Copy production infra files to server | `infra/docker-compose.prod.yml`, `infra/caddy/Caddyfile`, `backend/Dockerfile`, `infra/.env.production` |
| 1.3 | Point DNS | Domain → server IP (team handles this) |
| 1.4 | Set up Caddy reverse proxy | SSL via Let's Encrypt, route API + frontend |
| 1.5 | Launch backend | `docker compose -f docker-compose.prod.yml --env-file .env.production up -d --build` |
| 1.6 | Build & serve frontend | `npm run build`, serve via Caddy or `next start` |
| 1.7 | Update OAuth redirect URIs | Meta, TikTok, LinkedIn, Google → `https://<domain>/oauth/<provider>/callback` |
| 1.8 | Verify TikTok URL Properties if using pull mode | `https://<domain>/content/` — direct file upload mode can avoid this for video |
| 1.9 | Reconnect each provider | Re-auth in Settings after redirect URI change |
| 1.10 | Smoke test full flow | Create → AI → schedule → confirm it fires on time |

### Follow-up (not day 1)

- CI/CD: GitHub Actions builds image on merge to `main`, SSH-deploys to server.
- Backups: daily cron to off-site storage (Backblaze B2 or similar).
- Observability: simple `/health` ping checks.

---

## Priority 2: Telegram validation bot

**Why second:** Closes the create → validate → publish loop with a human
approval step. The team gets approve/reject/edit on mobile without opening the
dashboard. All the upstream pieces (editor, AI pipeline, scheduler) already work.

### Tasks

| # | Task | Status |
|---|---|---|
| 2.1 | Create bot via BotFather, store token in env | 🔴 blocked (team prerequisite) |
| 2.2 | Backend: webhook receiver for Telegram updates | ✅ `telegram_validation.py` + `POST /telegram/webhook` |
| 2.3 | Inline buttons (Approve / Reject / Edit / Schedule) | ✅ implemented in code |
| 2.4 | Workflow: Approve → mark ready, queue for publish | ✅ implemented in code |
| 2.5 | Workflow: Reject → notify creator with comment | ✅ implemented in code |
| 2.6 | Workflow: Edit → feedback loop → re-generate via AI | ✅ implemented in code |
| 2.7 | Schedule date/time from Telegram (`/schedule`) | ✅ implemented in code |
| 2.8 | Publish success/failure notifications + bot security | ✅ implemented in code |
| 2.9 | Commands: `/start`, `/pending`, `/next`, `/stats`, `/help` | ✅ implemented in code |
| 2.10 | Wire Topbar Telegram status indicator to real state | ✅ `SettingsView.js` checks `GET /telegram/status` |
| 2.11 | End-to-end test: create → approve in Telegram → post fires | 🔴 blocked (`TELEGRAM_BOT_TOKEN` not set) |

### Blockers

- Requires `TELEGRAM_BOT_TOKEN` + `TELEGRAM_DEFAULT_CHAT_ID` in `infra/.env`.
- Backend must be publicly reachable for Telegram webhooks (resolved once Priority 1 is done).

---

## Priority 3: LinkedIn pipeline (prep for client secret)

**Why third:** The OAuth + publish plumbing is built. When the client secret
arrives, it's a 5-minute env swap instead of a multi-day build. Makes the
platform coverage look complete on paper.

### Tasks

| # | Task | Status |
|---|---|---|
| 3.1 | Create a LinkedIn dev app (dev side) | 🔴 skipped (code built against API spec) |
| 3.2 | Backend: LinkedIn OAuth flow (`oauth.py`) | ✅ stores member info, exposes `linkedin_member` in `/oauth/connections` |
| 3.3 | Backend: LinkedIn publish handler (`publish.py`) | ✅ text posts + single-image via REST Posts API |
| 3.4 | Frontend: LinkedIn target in editor + settings | ✅ picks up from connections |
| 3.5 | Surface in `/oauth/connections` and `PublishConfirmModal` | ✅ surfaced |
| 3.6 | End-to-end smoke test with dev app | 🔴 blocked (no connected LinkedIn token locally) |
| 3.7 | Swap env to client secret when provided | 🔴 waiting for client secret |

### Blockers

- Client secret from the team (INF-T06 in original plan). Code is ready to swap.

---

## Priority 4: Polish the publish experience

**Why fourth:** TikTok and Meta publish paths exist, but error handling, retry
UX, and edge cases are basic. This is a quality pass — not flashy, but it's
what users feel when something goes wrong.

### Tasks

| # | Task |
|---|
| 4.1 | Better failure reasons in bell feed (subcode, platform message) |
| 4.2 | Progress indicators during long uploads (transcoding feedback) |
| 4.3 | Confirmation dialog before leaving unsaved editor changes |
| 4.4 | Auto-retry on transient failures with exponential backoff |
| 4.5 | Post-publish calendar tile animation + permalink in card |
| 4.6 | Publish queue UI — show pending posts, reorder, cancel |
| 4.7 | Daily rate-limit UX (warning at 80%, block at 100%) |

---

## Priority 5: Finish AI routing and cost analytics

**Why fifth:** The env-level fast/default/premium split is wired in `config.py`,
`models.py`, `main.py`, `infra/.env.example`, and `infra/.env.production.example`.
The remaining work is using it deliberately, showing the selected model in
analytics, and adding premium fallback behavior without silently raising spend.

### Tasks

| # | Task | Status |
|---|---|---|
| 5.1 | Audit current model usage — document which tasks use fast/default/premium | 🔴 |
| 5.2 | Route only explicit high-quality jobs to premium | 🔴 (all calls currently go through `AI_MODEL`) |
| 5.3 | Log model used + estimated cost in token counter for analytics | 🔴 |
| 5.4 | Fallback: if premium model fails, retry with default | 🔴 |

---

## New additions (implementation slice — May 2026)

Items built in this round that weren't covered by the original priority plan:

| Area | What was added |
|---|---|
| Media generation | `media_generation.py` — `POST /media/generate/image` + `POST /media/generate/video`. Works immediately with local fallback poster renderer + motion clip; switches to external AI provider when `AI_IMAGE_MODEL` env is set. |
| Telegram validation | Full backend (`telegram_validation.py`): `GET /telegram/status`, `POST /validation/submit`, `POST /telegram/webhook` with inline buttons. Frontend: `editorThunks.js` calls backend for "Submit for validation", `validationService.js`, `SettingsView.js` checks `GET /telegram/status`. |
| LinkedIn OAuth + publish | `oauth.py` stores member info + exposes `linkedin_member` in `/oauth/connections`. `publish.py` handles text posts + single-image via REST Posts API. Frontend picks it up automatically. |
| Config/env maturity | `config.py`, `models.py`, `main.py` updated. `infra/.env.example` + `infra/.env.production.example` added. |
| Frontend AI actions | `mediaGenerationService.js` client helper. `ScheduleModal.js` and `PostEditorPopup.js` now have real backend-driven AI image/video actions. |

### What's still blocked for live exercise

- Telegram E2E: needs `TELEGRAM_BOT_TOKEN` + `TELEGRAM_DEFAULT_CHAT_ID` in `infra/.env`
- LinkedIn publish smoke: needs a connected LinkedIn token in local backend state
- Next useful move: set those env vars, reconnect LinkedIn, then run real E2E smokes

---

## Not prioritized (blocked or low urgency)

| Item | Reason |
|---|---|
| Instagram carousel multi-slide | ✅ Resolved — works on a stable HTTPS domain (the failure was a dev-tunnel/Meta-9004 artifact, not a hard Meta block) |
| ComfyUI video generation | 🔴 No immediate demand signal; local fallback poster renderer + motion clip covers basic video generation |
| Airtable migration | ✅ N/A — the app moved to MariaDB instead of Airtable |
| AI image generation (DALL-E) | 🔴 Low priority vs. publishing pipeline |
| Brand Kit auto-apply | 🟡 Settings UI exists, auto-apply can wait |
| 3 AI variants per generation | 🟡 Single variant works, 3 is nice-to-have |
| KPI analytics dashboard / Recharts | 🟡 Token counter exists, full charts can wait |
