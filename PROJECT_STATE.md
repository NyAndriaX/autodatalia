# AutoDatalia Project State

Last updated: 2026-05-26 (post-testing session — May 24 fixes still current)

This file is the current state handoff for the repository.

## Source Of Truth

- Current architecture and run commands: `README.md`, `backend/README.md`,
  `frontend/README.md`, `infra/README.md`, and this file.
- Production deploy checklist: `DEPLOY.md`.

When these disagree, verify against source before changing behavior.

## Active Architecture

- `frontend/`: Next.js 16 dashboard, React 19, Redux Toolkit, Tailwind v4.
- `backend/`: FastAPI service for AI generation, uploads, JSON persistence,
  OAuth, scheduled publishing, media handling, and social publish calls.
- `infra/docker-compose.yml`: local dev compose for `caption-api` only.
- `infra/docker-compose.prod.yml`: production backend compose with Caddy in
  front of `caption-api`.

n8n is not part of the active runtime anymore. The old n8n/webhook references
are historical unless a future task explicitly reintroduces it.

## Current Capabilities

### Backend

- Health: `GET /health`.
- AI: `POST /generate`, `POST /transform`, `POST /captions/generate`.
- Upload and static media: `POST /upload`, `GET /content/*`.
- Calendar persistence: `GET/POST/PATCH/DELETE /posts`.
- Publishing: `POST /publish`.
- OAuth: `GET /oauth/{provider}/start`, `GET /oauth/{provider}/callback`,
  `GET /oauth/connections`, `GET /oauth/status`.
- Messages/feed: backend message endpoints exist for notification state.
- Scheduler: in-process loop publishes due posts with `status == "scheduled"`.

### AI Routing

- `AI_MODEL_FAST`: cheap/fast tasks such as image descriptions and transforms.
- `AI_MODEL`: default generation path.
- `AI_MODEL_PREMIUM`: configured but reserved; defaults to `AI_MODEL` if unset.
- `AI_INCLUDE_IMAGES` is off by default in local dev.
- Disk cache avoids repeat billing for identical generation/image-description
  requests.
- `AI_DAILY_LIMIT` caps non-cached AI calls per client.

### Publishing

| Platform | Current source state | Runtime dependency |
|---|---|---|
| Facebook | **✅ Working.** OAuth, page publishing, text, photo, video, and multi-photo carousel all confirmed working in tests. `attached_media` is sent as a JSON-encoded array. | Meta app credentials, page access, and valid public media URLs. |
| Instagram | **✅ Working on stable hosting.** OAuth, single-image/video, and multi-image carousel publishing all implemented. Carousel parent-create uses linear backoff to handle Meta's eventual-consistency window. | Meta app credentials, IG Business account linked to a Page, stable HTTPS domain. |
| TikTok | **✅ Working.** Photo carousels, video publishing, inbox/direct modes, audit UI flags. Default ratio for photos set to 9:16 (native full-screen). 1:1 and 4:5 accepted but letterboxed. 16:9 rejected for photos. | TikTok app credentials, accepted scopes, sandbox/audit status. |
| LinkedIn | **✅ Implemented.** OAuth, member post creation, image upload with polling. Video not yet supported. | LinkedIn client credentials (`LINKEDIN_CLIENT_ID`, `LINKEDIN_CLIENT_SECRET`). |
| Google | Partial sign-in provider only. | Google credentials if sign-in is used. |

### Persistence

The app is still file-backed:

- Uploaded and processed media live under `backend/content/`.
- OAuth tokens live server-side in `backend/content/.oauth_tokens.json` or the
  configured content directory equivalent.
- Posts, messages, AI caches, and generated/cropped media are local JSON/files.
- User auth state is stored in `backend/content/users.db` when auth routes are
  used.

No Airtable or database migration is active in the current source.

## Active Blockers

- **Production hosting** is the prerequisite for reliable scheduling, stable
  OAuth callbacks, and Instagram carousel publishing (Meta needs a stable
  HTTPS domain it can fetch images from). See `DEPLOY.md`.
- `BACKEND_AUTH_TOKEN` should be set before exposing the backend publicly.
- TikTok public/direct posting depends on the app's scopes, audit status, and
  URL/file-upload requirements.
- Full persistent analytics and per-model cost accounting are not complete.

## Known Issues Fixed (May 24 Testing)

- **API 500 on publish:** `asyncio.gather(return_exceptions=False)` in
  `publish_to_targets()` meant one platform's exception killed the entire
  response. Fixed to `return_exceptions=True` with exception-to-PublishResult
  conversion.
- **TikTok photo ratio:** Default was unset, causing inconsistent letterboxing.
  Now auto-defaults to 9:16 (native format) in both frontend and backend.
- **TimePicker broken minutes:** `scrollSnapType: "y mandatory"` fought
  click events. Fixed with `onPointerDown` and snap-disable during scroll.
- **PostEditorPopup can't scroll:** `overflow-hidden` on the grid container
  clipped the left pane. Fixed to allow independent per-column scroll.
- **CreationEditor missing AI media:** "AI image" and "AI video" buttons
  were only in PostEditorPopup and ScheduleModal. Now added to the main
  editor surface too.

## AI Generation Capabilities

| Feature | Backend | CreationEditor | PostEditorPopup | ScheduleModal |
|---|---|---|---|---|
| Text generation | ✅ `/generate` | ✅ Redux thunks | ✅ Local state | ✅ Local state |
| Text variants | ✅ `variants` param | ✅ Multiple | ❌ Single | ❌ Single |
| Tone / shorten / expand | ✅ `/transform` | ✅ | ❌ | ❌ |
| AI Image generation | ✅ `/media/generate/image` | ✅ | ✅ | ✅ |
| AI Video generation | ✅ `/media/generate/video` | ✅ | ✅ | ✅ |
| Image gen requires | `AI_IMAGE_API_KEY` + `AI_IMAGE_API_BASE_URL` (falls back to Pillow placeholder) | — | — | — |
| Video gen requires | ffmpeg via imageio-ffmpeg (Ken Burns effect from generated image) | — | — | — |

## Documentation Drift Notes

- `docs/PassFront.md` describes the Day 1 frontend state and is stale in places:
  many views and API integrations now exist.
- `docs/CompteRendu_Day1.md` and `docs/CompteRendu_Day2.md` are progress
  reports, not current-state references.

## Recommended Next Work

1. Deploy the backend behind a stable HTTPS domain using
   `infra/docker-compose.prod.yml` and Caddy — this unblocks Instagram carousels.
2. Reconnect OAuth providers against the production callback domain.
3. Smoke test create → upload → AI → schedule → publish against real
   provider targets on the production domain.
4. Complete Telegram validation bot integration (backend endpoints exist,
   bot logic needs wiring).
5. Configure `AI_IMAGE_API_KEY` for real image generation (currently falls
   back to placeholder).
