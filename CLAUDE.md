# Datalia — Engineering Handoff

> **Source of truth:** [`README.md`](README.md) is canonical, with
> [`PROJECT_STATE.md`](PROJECT_STATE.md) as the current-state snapshot.
> This file is a deeper engineering reference; when they disagree, README
> wins and this file is stale.
> Last reconciled: 2026-06-12.

Multi-user marketing-automation platform. A team plans, generates,
schedules and publishes content across social accounts (Facebook Pages,
Instagram Business, TikTok, LinkedIn). Each member signs in and connects
**their own** accounts — OAuth tokens, posts and app state are scoped per
user (roles: first registered user is `admin`, additional members are
provisioned via Google sign-in). Running as a multi-tenant product (not a
single shared login) is also what TikTok's API review requires.

Stack: FastAPI + Pydantic backend, Next.js 16 (App Router, Turbopack)
frontend with Redux Toolkit, Docker Compose for local orchestration.

---

## Repo layout

```
AutoDatalia/
├── backend/                   FastAPI service
│   ├── Dockerfile
│   ├── requirements.txt
│   └── app/
│       ├── main.py            App init + CORS + tunnel boot + TikTok verify route
│       ├── routes.py          REST endpoints (/generate, /publish, /upload, …)
│       ├── oauth.py           OAuth flow for meta/tiktok/linkedin/google + token store
│       ├── publish.py         Per-platform publish handlers + spam guard
│       ├── images.py          Image center-crop to aspect ratio (Pillow)
│       ├── services.py        AI generation + image desc cache + posts CRUD
│       ├── models.py          Pydantic request/response models
│       ├── config.py          Env-loaded settings
│       ├── auth.py            Bearer-token dependency
│       └── tunnel.py          Cloudflare quick-tunnel helper (opt-in)
├── frontend/                  Next.js dashboard
│   └── app/
│       ├── layout.js          Root layout + theme no-flash script
│       ├── page.js            View router (dashboard / creation / calendar / …)
│       ├── components/
│       │   ├── layout/        Sidebar, Topbar (notifications), AppBootstrap
│       │   └── views/         DashboardView, CreationEditor, CalendarView,
│       │                      SettingsView, MediaLibraryView, CreditsView,
│       │                      AnalyticsView, PostEditorPopup, ScheduleModal,
│       │                      PublishConfirmModal
│       ├── lib/               Service layer (apiClient, oauthService,
│       │                      uploadService, aiService, publishHash, …)
│       └── store/             Redux slices + thunks
├── infra/
│   ├── docker-compose.yml     caption-api + mariadb (dev); n8n removed
│   └── .env                   Real credentials (NOT committed)
├── docs/                      Setup guides (TIKTOK_SETUP.md, …)
└── plans/                     Architecture + planning docs
```

---

## Backend

### Entrypoint
`backend/app/main.py` mounts:
- `routes.router`  → /health, /generate, /transform, /upload, /posts,
                     /publish, /messages, /search, /captions/generate,
                     /content-items, /content/{path} (delete), /tunnel-status
- `auth_router`    → /auth/register, /auth/login, /auth/me
- `oauth_router`   → /oauth/status, /oauth/{provider}/start,
                     /oauth/{provider}/callback, /oauth/connections,
                     /oauth/meta/accounts, /oauth/{provider} (DELETE)
- `media_generation_router` → /media/generate/image, /media/generate/video
- `telegram_validation_router` → /telegram/status, /telegram/webhook,
                                 /validation/submit
- `legal_router`   → /privacy, /terms (HTML pages required by Meta/TikTok/
                     LinkedIn dev portals)
- `app.get("/tiktok{token}.txt")` — domain-verification file served at root
  (TikTok asks for it as part of app onboarding; token comes from
  `TIKTOK_DOMAIN_VERIFY` env var)
- `app.mount("/content", StaticFiles)` — uploaded media served from disk

### Settings (`config.py`)
Env vars consumed at boot:
- `AI_API_BASE_URL`, `AI_API_KEY`, `AI_MODEL`, `AI_MODEL_FAST`,
  `AI_MODEL_PREMIUM`, `AI_INCLUDE_IMAGES`, `AI_DAILY_LIMIT`
- `CORS_ALLOW_ORIGINS`
- `BACKEND_AUTH_TOKEN` (empty = open mode; otherwise required on mutating routes)
- `TUNNEL_ENABLED` (default off — Cloudflare quick-tunnel is unauthenticated)

Read directly from `os.environ` (not in Settings):
- `OAUTH_REDIRECT_BASE`   public host the callbacks land on
- `PUBLIC_BASE_URL`       overrides what /upload uses for media URLs
- `META_APP_ID`, `META_APP_SECRET`
- `INSTAGRAM_APP_ID`, `INSTAGRAM_APP_SECRET` (separate IG Login app — unused
  in current flow; IG goes through Meta with `instagram_basic` scopes)
- `TIKTOK_CLIENT_KEY`, `TIKTOK_CLIENT_SECRET`, `TIKTOK_DOMAIN_VERIFY`
- `LINKEDIN_CLIENT_ID`, `LINKEDIN_CLIENT_SECRET`
- `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`
- `CONTENT_DIR` (defaults to `/app/content` in the container)

### OAuth (`oauth.py`)

Provider registry (`PROVIDERS` dict): `meta`, `tiktok`, `linkedin`, `google`.
Each `ProviderSpec` declares scopes + authorize/token URLs + which env
vars hold its credentials.

Tokens persist in MariaDB as per-user scoped `oauth_tokens` blobs (legacy
`content/.oauth_tokens.json` / `.oauth_tokens_<user_id>.json` files are
migrated into the DB on startup by `migrate_legacy_state()`). Schema per
provider:
```json
{"meta": {"access_token": "...", "expires_at": 1234, "scope": "..."}}
```
Page-level access tokens are **not** stored — they're fetched on demand
from the user token via `/me/accounts` so they always reflect Meta's
current view of permissions.

Flow:
1. `GET /oauth/{provider}/start` → returns `{authorize_url}` (frontend
   pops it in a child window)
2. Provider redirects to `GET /oauth/{provider}/callback?code=...&state=...`
3. Backend exchanges code → access token, runs `_exchange_long_lived_meta`
   for Meta (short-lived → 60-day), persists to JSON
4. Callback returns an HTML page that `postMessage`s the result to
   `window.opener` and `window.close()`s itself

`GET /oauth/connections` is what the frontend reads to render Settings
and to build publish targets. Per-provider it returns `targets[]` —
each target is `{id, label, kind, ...}`:
- Meta: one `facebook_page` target per Page the user admins, plus one
  `instagram_business` target per Page-linked IG Business account
- TikTok: one `tiktok_account` target per connected creator (display
  name + avatar are persisted on callback)
- LinkedIn: one `linkedin_member` target per connected member

### Publishing (`publish.py` + `routes.py`)

`POST /publish` body:
```json
{
  "content": "string",
  "media_url": "https://.../content/foo.jpg",
  "link": null,
  "ratios": {"facebook": "1:1", "instagram": "4:5"},
  "targets": [{"platform": "facebook", "id": "<page_id>", "label": "…"}]
}
```

Pipeline:
1. **Validation**: reject empty content+media, target count > 20.
2. **Token resolution**: for each `facebook`/`instagram` target, look up
   the Page's access token (and the IG account's parent Page token)
   from `_fetch_meta_pages(user_token)`. TikTok/LinkedIn pull their
   token from the OAuth store directly.
3. **Per-target crop**: `crop_for_targets()` runs the original image
   through Pillow center-crop to `ratios[platform]` if set; cached on
   disk as `<name>_r1x1.jpg` etc. so subsequent publishes don't re-crop.
4. **Spam guard** (`check_spam_guard`): per-target cooldown (5s) +
   duplicate-content window (5min). Failing this returns
   `cooldown_active: …` or `duplicate_post: …` per target without
   touching the platform.
5. **Fan-out**: `asyncio.gather` across all dispatchers.
6. **Record**: every successful publish goes into `_RECENT_POSTS` so
   the next call to `check_spam_guard` sees it.

Per-platform handlers:
- `publish_facebook_page`: posts to `/{page_id}/photos` (single image),
  `/{page_id}/videos` (video), or `/{page_id}/feed` (text-only / carousel).
  Multi-image carousels stage each photo with `published=false` then
  attach them via `attached_media` as a single JSON-encoded array
  (see AGENTS.md — passing it as `attached_media[0]=…` form-data drops
  every slide past the first). Returns `permalink_url =
  "https://www.facebook.com/{post_id}"`.
- `publish_instagram`: 2-step container create → `media_publish`. **Video**
  children must poll `status_code` until `FINISHED` before the parent
  container is built; **image** carousel children are **not** polled
  (Meta marks them attachable within seconds) — instead the parent
  container create retries up to 8× (~42s backoff) to ride out Meta's
  eventual consistency. Fetches permalink with `?fields=permalink`.
  Multi-slide carousels are confirmed working on a stable HTTPS domain
  (the old Meta 9004 / 100-subcode-33 was a dev-tunnel artifact).
- `publish_tiktok`: live. Photos go through `/v2/post/publish/content/init/`
  (PHOTO mode, carousel-by-default). Videos use `PULL_FROM_URL` against
  the public content host. Default photo ratio is 9:16 (native
  full-screen); 1:1 and 4:5 are accepted but letterboxed; 16:9 is
  rejected by TikTok for photos.
- `publish_linkedin`: live. Text-only posts via `/rest/posts`; single
  image via the upload + asset reference flow with polling. Video not
  yet supported.

Error surfacing: `_meta_error_message()` parses Meta's
`{"error":{"message":...,"code":...}}` payload so the notification
shows `Meta 100: Invalid parameter` instead of the generic
"upstream call failed".

### Image cropping (`images.py`)

`crop_media_to_ratio(media_url, "4:5")`:
1. Parse ratio (`"W:H"` or `"W/H"` → float `W/H`)
2. Map the public URL back to a local path under `content_dir`
   (path-traversal blocked)
3. Open with Pillow, center-crop to the target ratio
4. Save next to the original as `<stem>_r4x5<ext>` (cached — exists →
   skip)
5. Return the same public URL with the filename swapped

Falls back to the original URL on any error (unparseable ratio, video,
non-content URL, IO error) so a bad crop never blocks publish.

### AI (`services.py`)

Three-tier model routing (in `config.py`):
- `ai_model_fast` — simple stuff (hashtags, reformulations, image descs)
- `ai_model` — variant generation, transforms
- `ai_model_premium` — reserved; defaults to `ai_model` so it never
  silently escalates spend

`_describe_image()` caches image descriptions by SHA-256 of the image
bytes — same image → free hit, even across posts. This was the single
biggest token reduction.

`rate_guard` / `rate_tick` enforce `AI_DAILY_LIMIT` per client (key:
forwarded IP) so a runaway frontend can't drain the OpenRouter wallet.

---

## Frontend

### State (Redux Toolkit slices)

- `editorSlice.currentPost`: `{content, platforms, mode, template, tone,
  ratios, status, scheduledDate, hashtags, media}`. `media[]` items have
  `{id, name, kind, previewUrl, remoteUrl, status: "local|uploading|uploaded|error", filename}`.
- `editorSlice.aiGeneration`: in-flight + variants
- `calendarSlice.scheduledPosts`: server-hydrated calendar entries
- `uiSlice`: theme, notifications, aiUsage, **`publishCooldownUntil`**,
  **`recentPublishes`** (last 1h of `{hash, ts}` for duplicate detection)
- `authSlice`: signed-in user

### Service layer (`lib/`)

- `apiClient.js`: `apiFetch`, `apiUpload`, `apiHealthCheck`. Adds
  `Authorization: Bearer` from `config.backendAuthToken` when set.
- `oauthService.js`: `fetchConnections`, `startConnect` (popup +
  postMessage listener), `disconnect`, `publishToTargets`.
- `uploadService.js`: blob-preview + upload to /upload, returns
  `{remoteUrl, status, filename, kind}`.
- `aiService.js`: generate / quick-actions with local memo cache.
- `publishHash.js`: stable `"content|mediaUrl"` key shared between
  the frontend duplicate warning and the backend cooldown.

### Publishing flow

1. User clicks **Publish** in `CreationEditor` → opens
   `PublishConfirmModal`.
2. Modal fetches `/oauth/connections`, shows the actual target accounts,
   warns "duplicate" if `publishHashKey(content, mediaUrl)` is in
   `uiSlice.recentPublishes`.
3. User clicks **Confirm Publish** → dispatches `publishNowThunk`.
4. Thunk:
   - Rejects if `Date.now() < publishCooldownUntil` (15s frontend cooldown)
   - Re-fetches connections, builds `targets`
   - Picks first `status: "uploaded"` media's `remoteUrl` as `media_url`
   - Calls `publishToTargets({content, mediaUrl, targets, ratios})`
5. Per-result notifications. Success ones carry `url: r.permalink_url`
   so the bell-menu shows an external-link icon; clicking opens the
   live post in a new tab.
6. On any success: `setPublishCooldownUntil(now + 15s)` +
   `recordPublishHash(hash)`.

### Aspect ratio picker

`RatioPicker` (in `CreationEditor.js`) lets the user choose a ratio
per platform from `RATIOS_BY_PLATFORM` (lib/platforms.js).
`setPlatformRatio({platform, ratio})` writes into
`currentPost.ratios[platform]`. The publish thunk passes that whole map
through to the backend, which crops the image accordingly. The ratio
picker is no longer "preview only" — it actually changes what gets
published.

### Hydration safety

Next.js 16 is strict about SSR/client mismatches. The codebase avoids
them by:
- Using `WEEKDAY_SHORT[date.getDay()]` instead of
  `toLocaleDateString(undefined, {weekday: "short"})` (the latter
  varies by server vs browser locale).
- A locale-independent `fmt()` number formatter in `DashboardView`.
- Putting locale-dependent dates inside `useEffect` so they render
  client-only after mount.
- `next/script` with `strategy="beforeInteractive"` for the no-flash
  theme script (raw `<script>` inside React triggers a warning in
  Next.js 16).
- `<img onError>` falls back from `remoteUrl` to the local blob
  `previewUrl` so a failed remote image doesn't break the editor
  (added because ngrok's free-tier browser interstitial breaks
  `<img>` loads on the first hit).

---

## Infrastructure

### docker-compose

Services: `caption-api` (FastAPI) + `mariadb` (and the Next.js `frontend`
in the full-stack compose; prod adds `caddy`). n8n was removed because the
team doesn't want any external orchestration in the loop — direct backend
calls only.

```
docker compose -f infra/docker-compose.yml up -d --build caption-api
docker compose -f infra/docker-compose.yml restart caption-api   # config-only change
docker compose -f infra/docker-compose.yml logs -f caption-api
```

**Rebuild required when:** code changes, requirements.txt changes,
Dockerfile changes. Code is COPY'd into the image — no volume mount.

**Restart suffices when:** only `.env` changed.

### Public HTTPS

Meta and TikTok require HTTPS callback URLs (no localhost). Use
**ngrok** with a reserved static domain (free tier gets 1):

```
ngrok http --url=<your-domain>.ngrok-free.dev 8000
```

Then in `infra/.env`:
```
OAUTH_REDIRECT_BASE=https://<your-domain>.ngrok-free.dev
```

The same host is used by `/upload` to construct media URLs (so Meta
can fetch them).

ngrok's free tier shows a browser interstitial on first visit. To clear
it for `<img>` loads, open the ngrok URL root in your browser once and
click "Visit Site" — sets a 7-day cookie. Meta's image fetcher bypasses
the interstitial automatically (non-browser User-Agent).

### Cloudflare quick-tunnel

Built into `backend/app/tunnel.py`, opt-in via `TUNNEL_ENABLED=true`.
Free, public, no auth. Use it as a fallback if ngrok is down. Note:
DNS propagation has been slow in the past (~12 min), prefer ngrok.

---

## Environment file (`infra/.env`)

```
# AI
AI_API_BASE_URL=https://openrouter.ai/api/v1
AI_API_KEY=<openrouter key>
AI_MODEL=google/gemini-2.0-flash-lite-001
AI_INCLUDE_IMAGES=true

# Public host where OAuth callbacks land. Must be HTTPS for FB/IG/TikTok.
OAUTH_REDIRECT_BASE=https://<reserved-ngrok>.ngrok-free.dev

# Meta — Datalia prod
META_APP_ID=<prod>
META_APP_SECRET=<prod>

# Meta — testing alternative (dev app the contributor controls; last
# definition in the file wins, so the active one is whichever isn't
# commented out)
META_APP_ID=<dev>
META_APP_SECRET=<dev>

# Instagram (currently unused — IG is reached via Meta with the
# instagram_basic + instagram_content_publish scopes)
INSTAGRAM_APP_ID=
INSTAGRAM_APP_SECRET=

# TikTok
TIKTOK_CLIENT_KEY=<key>
TIKTOK_CLIENT_SECRET=<secret>
TIKTOK_DOMAIN_VERIFY=<token from the portal>

# LinkedIn
LINKEDIN_CLIENT_ID=
LINKEDIN_CLIENT_SECRET=

# Google (for team sign-in, not posting)
GOOGLE_CLIENT_ID=
GOOGLE_CLIENT_SECRET=
```

---

## Per-platform status

| Platform   | OAuth | Publish        | Notes |
|------------|-------|----------------|-------|
| Facebook   | ✅    | ✅ text + photo + video + multi-photo carousel | Confirmed working in May 24 testing. `attached_media` MUST be JSON-encoded array (see AGENTS.md). |
| Instagram  | ✅    | ✅ single image + video + multi-slide carousel | Reached through Meta with legacy scopes (`instagram_basic`, `instagram_content_publish`). Carousel confirmed on a stable HTTPS domain (image children unpolled; parent-create backoff for Meta eventual consistency). |
| TikTok     | ✅    | ✅ photo carousels + video | Default photo ratio 9:16. Inbox + direct post modes supported. |
| LinkedIn   | ✅    | ✅ text + single image | OAuth + member info + Posts API implemented. Video not yet supported. End-to-end smoke pending a connected token locally. |
| Google     | partial | n/a (sign-in only) | Awaiting `GOOGLE_CLIENT_SECRET`. |

---

## Security / guardrails

**Backend:**
- `/publish` rejects: empty content+media, more than 20 targets.
- Per-target spam guard: 5s cooldown, 5min duplicate-content window.
  Refusals come back as `cooldown_active: …` or `duplicate_post: …`
  per target.
- `BACKEND_AUTH_TOKEN` gates mutating routes (`/generate`, `/transform`,
  `/upload`, mutating `/posts`) when set.
- `AI_DAILY_LIMIT` caps real AI calls per client per day.
- Image crop helper blocks path-traversal — cropped output is always
  inside `content_dir`.

**Frontend:**
- Pre-publish confirmation modal — last chance to bail before fan-out.
- 15s post-publish cooldown locks the publish thunk.
- `recentPublishes` ring (1h) drives the modal's "duplicate" warning.
- Tokens never round-trip through the browser. The frontend only
  sees provider ids + target labels; access tokens stay backend-side.

---

## Known issues / open threads

- **Production hosting** — scheduler runs in-process, so scheduled posts
  only fire while the backend is up; a stable always-on host (Caddy +
  `docker-compose.prod.yml`) is the prod target.
  See [`plans/hosting.md`](plans/hosting.md) for the migration plan.
- **LinkedIn end-to-end smoke** — code path is complete but no
  LinkedIn token has been connected against the local backend yet.
- **Google secret** — waiting on the CEO; sign-in only when it lands.
- **Facebook Pages limited to dev-app testers** — the user's personal
  dev app (`962030513394830`) is being used for end-to-end. Switching
  back to Datalia's prod credentials (`980592034520375`) is a single
  env-var swap once the prod app is unblocked.
- **Instagram Business verification** — required Meta Business Portfolio
  verification (Kbis-equivalent docs) blocked the modern Instagram-Login
  flow; that's why we're on the legacy Meta scopes.
- **Instagram multi-image carousels** — ✅ resolved. The old Meta 9004
  ("image URL not fetchable") was a dev-tunnel artifact; carousels publish
  on a stable HTTPS domain. Image children are no longer polled; the
  parent container create uses an 8-attempt backoff for eventual consistency.
- **Telegram bot** — backend wired (`telegram_validation.py`,
  `/telegram/webhook`, inline approve/reject/edit/schedule). Live test
  blocked on `TELEGRAM_BOT_TOKEN` + `TELEGRAM_DEFAULT_CHAT_ID` env vars.

---

## Recent decisions (with rationale)

- **n8n removed entirely**, including from the docker-compose. Direct
  backend calls only. Original use was draft/validate/publish webhooks;
  all three are now thunks that hit the backend (or update state
  locally for draft/validate).
- **Image description cache by content hash** — same image
  → free hit. Single biggest token saver.
- **Three-tier model routing** — fast/default/premium. Premium defaults
  to default so unset env never silently escalates spend.
- **Server-side Page-token resolution** — `/publish` re-fetches via
  `/me/accounts` instead of storing Page tokens. Always reflects the
  user's current admin permissions.
- **Aspect ratio actually crops** — the picker was "preview frame
  only" until now. Backend now uses Pillow center-crop per platform.
- **Publishing confirmation modal** — defense-in-depth alongside the
  backend cooldown. Stops accidental double-clicks without a HTTP
  round-trip.

---

## How to extend

### Adding a new social platform
1. Add a `ProviderSpec` in `oauth.py` with its scopes + URLs.
2. Add `<X>_CLIENT_ID` / `<X>_CLIENT_SECRET` env passthrough in
   `infra/docker-compose.yml`.
3. Add a `publish_<x>()` async function in `publish.py` and wire it
   into the `_dispatch` branch in `publish_to_targets`.
4. Surface its targets in `/oauth/connections` (the `meta` branch
   shows the pattern — fetch the list of postable destinations,
   tag each with a `kind`).
5. Frontend: add a picker function in `TARGETS_FOR_PLATFORM`
   (editorThunks.js) and a row in `PLATFORM_TO_PROVIDER` /
   `PLATFORM_TARGET_KIND` (PublishConfirmModal.js).

### Adding a new editor field
- Schema change → `editorSlice.initialState.currentPost` + a reducer
- Wire UI in `CreationEditor.js`
- If it should reach the backend, add it to `PublishRequest` in
  `models.py` and propagate through `routes.py /publish` to the
  per-platform handler

### Local dev quickstart
```
# Backend
docker compose -f infra/docker-compose.yml up -d --build caption-api
ngrok http --url=<your-reserved-domain>.ngrok-free.dev 8000

# Frontend
cd frontend
npm install
npm run dev    # http://localhost:3000
```

The frontend reads `NEXT_PUBLIC_API_BASE_URL` (set it to your ngrok URL
when testing OAuth, or `http://localhost:8000` for purely-local work).
