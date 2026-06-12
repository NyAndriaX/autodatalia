# Hosting plan — moving Datalia off ngrok

Internal reference for the Datalia hosting migration. Captures the decision,
the architecture, and the migration steps so the rollout can be done by
anyone on the team without re-deriving the trade-offs.

---

## Why move off ngrok

ngrok was fine for first-week development but blocks the product in five
concrete ways right now:

| Today (ngrok) | After hosting |
|---|---|
| TikTok URL Properties verification keeps failing | Permanent host = one-time verification, unblocks `PULL_FROM_URL` photo posts |
| Meta dev app needs ngrok host re-added on every reserved-URL hiccup | One redirect URI, set once |
| `Missing code or state` race conditions from ngrok's free-tier interstitial | Gone |
| Free-tier interstitial breaks `<img>` loads on first hit | Gone |
| Scheduler only fires when laptop is open | Always-on — posts fire whether or not anyone is at a desk |

The last one is the real driver. Scheduled posts are the product's whole
point and they currently don't work if the dev machine sleeps.

## Constraints that rule out half the obvious options

The backend is **not serverless-friendly**:

- `scheduler.py` runs an in-process asyncio loop firing posts at their
  `scheduledDate + time`. Process must stay up.
- App state (posts, OAuth tokens, automation rules, messages, cost logs,
  video jobs) lives in **MariaDB**; uploaded media lives on the filesystem.
  Both the DB volume and the media volume must persist between restarts.
- `/upload` can take up to 90s when transcoding is needed
  (`_normalize_video_for_publishing` in `services.py`). Request handlers
  can't be subject to a 10s function timeout.
- Meta and TikTok fetch media from public URLs. The backend must be
  reachable on the open internet over HTTPS.

What's needed: one long-lived container with a mounted volume.

## Docker — yes, keep it

Decision: ship the backend as a Docker image. Three concrete reasons:

1. **`imageio-ffmpeg` bundling.** The ffmpeg binary path is identical
   between local dev and prod when both run in the same image — without
   Docker the path differs across hosts and the codec probe / transcode
   functions break.
2. **Compose already exists for both environments.** Use
   `infra/docker-compose.yml` locally and `infra/docker-compose.prod.yml` on the
   server with Caddy and a persistent named content volume.
3. **Atomic rollbacks via image tags.** `docker compose up -d` with a
   previous tag undoes a broken release in seconds. No "rebuild from
   git on the server" gymnastics.

## Deployment stack

```
┌─ datalia.com ──────────────────────────┐
│  Caddy (reverse proxy, Let's Encrypt)   │    Team's own server
│    ├─ caption-api container             │    Docker Compose stack
│    │    FastAPI + uvicorn               │
│    │    imageio-ffmpeg (bundled)        │
│    │    volume: /home/app/content       │
│    ├─ mariadb container                 │
│    │    volume: mariadb-data            │
│    └─ Next.js (frontend)                │
│         built & served via Caddy        │
└────────────────────────────────────────┘
```

Both backend and frontend run on the same server.

- **Backend:** Docker container as above.
- **Frontend:** `npm run build` then serve the `out/` or `.next` static
  export through Caddy (or run `next start` alongside the API). Caddy
  auto-provisions the Let's Encrypt SSL certificate on first request.
- **Domain:** Already owned and configured by the team. Point it at the
  server IP, set up Caddy to route traffic.

## Storage strategy

Structured state lives in **MariaDB**; only media stays on the filesystem.
The legacy JSON files are migrated into the DB once on startup
(`migrate_legacy_state()`), so back up **both** volumes:

| Path / store | Contents | Backed up |
|---|---|---|
| `mariadb-data` volume | users + doc table: posts, OAuth tokens, automation rules, messages, cost logs, video jobs | Yes (nightly `mariadb-dump`) |
| `/home/app/content/*.{png,jpg,mp4,...}` | Uploaded + cropped + AI-generated media | Yes (nightly) |

Backup target: daily cron — `mariadb-dump` for the DB plus a `tar` of the
content volume — to Backblaze B2 or equivalent off-site storage. Total
storage cost at 10 GB: negligible.

Already on MariaDB (PyMySQL); a managed MariaDB/MySQL host can be used in
prod by setting `DATABASE_URL`. Object storage (S3) for media is a later
option, not needed at single-team scale.

## Migration order

1. **Install Docker** on the server (`curl -fsSL get.docker.com | sh`)
2. **Copy `infra/docker-compose.prod.yml`, `infra/caddy/Caddyfile`,
   `backend/Dockerfile`, and `.env.production`** to the server
3. **Point DNS** — domain → server IP
4. **Set up Caddy** as reverse proxy with Let's Encrypt for both the
   API and frontend (or whichever reverse proxy the team prefers)
5. **`docker compose -f docker-compose.prod.yml --env-file .env.production up -d --build`**
6. **Build & deploy frontend** — `npm run build` on the server
   (or build in CI and copy the artifacts)
7. **Update dev portal redirect URIs** for Meta, TikTok, LinkedIn,
   Google to `https://<domain>/oauth/<provider>/callback`
8. **Verify TikTok URL Properties** for `https://<domain>/content/` if using
   `PULL_FROM_URL` — the path that's been failing on ngrok. Should succeed on
   a real domain; file-upload mode can avoid this requirement for video.
9. **Reconnect each provider** in Settings — OAuth tokens are bound to
   redirect URI; all four (Meta, TikTok, LinkedIn, Google) need re-auth
   once. After this step, scheduled posts start firing reliably.

## Operational basics (not day 1)

- **CI/CD**: GitHub Actions builds the image on merge to `main`,
  SSH-deploys to the server.
- **Backups**: daily cron to off-site storage (Backblaze B2 or similar).
- **Observability**: simple `/health` ping checks.
- **Logs**: `docker compose logs --tail=200 -f`.

## Notes

- Server specs should be sufficient for Docker + ffmpeg transcoding
  (4 GB RAM minimum recommended for video processing).
- Reverse proxy can be Caddy, Nginx, or whatever the team is comfortable
  with — Caddy is recommended for auto Let's Encrypt.
- This replaces the previous Hetzner + Vercel + Cloudflare plan — the
  team has their own server and domain, so no external hosting services
  are needed beyond the server itself.
