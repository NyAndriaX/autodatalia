# TikTok Integration — Setup Guide

End-to-end checklist for getting TikTok OAuth + publishing working in
Datalia. Two stages:

1. **Sandbox** — testable today, restricted (max 5 test users, posts
   forced to "self only" visibility). Used to verify the OAuth + API
   plumbing.
2. **Production audit** — submission to TikTok required before posting
   publicly. 2–4 week review.

---

## Prerequisites

- A TikTok account intended to act as the **test publisher** during dev
  (can be anyone's — yours, the CEO's, a throwaway pro account).
- A **stable HTTPS URL** pointing at our backend on port 8000. TikTok
  rejects `localhost` and any HTTP redirect URI. Pick one:
  - `ngrok` with a free static domain (recommended for dev)
  - Cloudflare named tunnel + a domain on Cloudflare
  - A real domain pointed at a VPS (when prod is ready)

---

## Stage 1 — Sandbox setup (one-shot, ~20 min)

### 1.1 Create the TikTok app

If not already done by the CEO:

1. Sign in at <https://developers.tiktok.com/>
2. **Manage apps → Connect** (or "Create app")
3. App info:
   - **App name**: Datalia
   - **Category**: Productivity / Social
   - **Description**: "Datalia is a social media scheduling tool that
     publishes user-authored content to their connected TikTok account."
4. Save. Note the **Client Key** and **Client Secret** — these go into
   `infra/.env` as `TIKTOK_CLIENT_KEY` and `TIKTOK_CLIENT_SECRET`.

### 1.2 Add the required products

Inside the app dashboard:

1. **Add products** section → add the two we need:
   - **Login Kit** — provides `user.info.basic` scope (instant)
   - **Content Posting API** — provides `video.upload` (sandbox-friendly)
     and `video.publish` (gated behind audit)

> ⚠️ `video.publish` (TikTok's "Direct Post" scope) is **not available
> in sandbox**. It only unlocks after the audit clears. For sandbox
> testing we use `video.upload` (the "Inbox" flow — videos go to the
> user's TikTok drafts, they tap publish manually).

### 1.3 Configure the OAuth redirect URI

Set up the stable HTTPS tunnel **before** this step so you have the URL
ready. ngrok recipe:

```powershell
# Sign up at ngrok.com → Domains → claim your auto-assigned static domain
winget install Ngrok.Ngrok
ngrok config add-authtoken YOUR_TOKEN_FROM_DASHBOARD
ngrok http --url=<your-static-domain>.ngrok-free.app 8000
# Leave the terminal running.
```

Then in the TikTok dashboard:

1. **App info → URL properties** (or similar — naming varies)
2. **Redirect URI**: add
   `https://<your-static-domain>.ngrok-free.app/oauth/tiktok/callback`
3. **Web/Desktop**: paste the same URL (some app types ask twice)
4. Save

In `infra/.env`:

```env
OAUTH_REDIRECT_BASE=https://<your-static-domain>.ngrok-free.app
```

Then restart the backend:

```bash
cd infra && docker compose up -d --build caption-api
```

### 1.4 Add sandbox test users

While the app is unaudited, only **registered test users** can complete
OAuth.

1. App dashboard → **Sandbox** (sometimes "Configuration → Sandbox" or
   under the app's settings dropdown)
2. **Add tester** → enter the TikTok `@handle` (not email)
3. The added user gets a notification inside the TikTok mobile app —
   they must **accept** it. Until accepted, OAuth will fail with
   "Insufficient developer role".

Sandbox limits to be aware of:

- Max **5 test users / 24h**
- Test user account **must be private**
- Published content forced to **`SELF_ONLY` visibility**
- Useless for actual marketing reach — only verifies the API plumbing.

### 1.5 Run the OAuth flow

1. With backend rebuilt and `OAUTH_REDIRECT_BASE` pointing at the tunnel,
   get the start URL:

   ```bash
   curl -s http://localhost:8000/oauth/tiktok/start
   ```

   Copy the `authorize_url` from the response.

2. Open that URL in a browser, logged into TikTok as the **accepted test
   user**.
3. Approve the scopes.
4. You'll be redirected to `https://<your-domain>/oauth/tiktok/callback`
   which exchanges the code, stores the token, and shows a small
   "Connected" page that auto-closes the popup.
5. Confirm with:

   ```bash
   curl -s http://localhost:8000/oauth/status | jq '.providers[] | select(.id=="tiktok")'
   # should show "connected": true
   ```

### 1.6 Test posting via `video.upload`

(Once we wire the publish pipeline — placeholder for the CEO to know
what'll happen.)

The video gets uploaded to the user's TikTok inbox. They open TikTok →
notification → review → tap Publish. Manual final step in sandbox.

---

## Stage 2 — Production audit submission

When sandbox testing confirms the flow works and you're ready to publish
to real (public) accounts, submit for audit.

### 2.1 Required artifacts

| Artifact | Spec |
|---|---|
| **Privacy Policy URL** | Public, reachable instantly. Must mention TikTok data usage. Verified by uploading a `tiktok-verification.txt` file to the web root. |
| **Terms of Service URL** | Required for apps created after Sept 9, 2024. |
| **App icon** | 1024×1024 px, PNG or JPEG, ≤ 5 MB |
| **Demo videos** | Up to 5 files, each ≤ 50 MB. Must show end-to-end flow including: account linking, consent screen, creator-info display (avatar + username) **before posting**, all UX toggles (visibility selector, disclose-content, branded-content, music-usage confirmation), and the post appearing live on tiktok.com. |
| **PDF mockup / showcase** | Required, custom — do NOT submit TikTok's example template. Show screens of the app, the user flow, and how creator info is displayed. |
| **Use-case description** | Plain text: app purpose, daily-active-user estimate, why direct-post is needed, list of API response fields stored (e.g. `publish_id`, `publicly_available_post_id`). |
| **Test account credentials** | A real TikTok account for TikTok reviewers to log in with and test publishing live. |
| **Business info** | Organization name, website, contact full name. No Kbis required; TikTok verifies org legitimacy via the info you provide. |

### 2.2 Reject-on-sight gotchas

From TikTok's content sharing guidelines + community reports:

- ❌ App UI doesn't show **creator avatar + username** on the post-compose
  screen — TikTok actively verifies this
- ❌ Watermarks, logos, or promo text added to user videos
- ❌ App framed as "cross-posting from other platforms" (TikTok wants
  original creator workflows, not auto-reposters)
- ❌ App labeled "for internal use only" — must serve a public audience
- ❌ Missing "By posting, you agree to TikTok's Music Usage Confirmation"
  consent in the UI
- ❌ Submitting TikTok's own example PDF instead of yours

### 2.3 Domain verification (for URL-pull uploads)

If we use the `PULL_FROM_URL` upload mode (uploading videos by URL
rather than direct bytes), each URL prefix must be verified:

1. TikTok dashboard → **URL Properties → Add prefix**, e.g.
   `https://cdn.datalia.app/uploads/`
2. TikTok gives you a verification file → upload to the web root at
   that prefix → click "Verify"
3. Prefix is exact-match — `https://cdn.datalia.app/uploads/` verifies
   only that prefix, not arbitrary other paths on the same domain.

For sandbox we use direct-byte upload (`FILE_UPLOAD` mode) which doesn't
need URL verification.

### 2.4 Review timeline

- 2 to 4 weeks typical, multiple feedback rounds common
- TikTok reviewers post live test content on the provided test account
  during review — keep that account clean

---

## Current state

| Item | Status |
|---|---|
| TikTok dev app created | ✅ (CEO) |
| Client Key + Secret in `.env` | ✅ |
| Login Kit product | ❓ to verify |
| Content Posting API product | ❓ to verify |
| Stable HTTPS redirect URI | ❌ blocking — needs ngrok or domain |
| Sandbox test user added + accepted | 🟡 added, awaiting acceptance |
| OAUTH_REDIRECT_BASE set to HTTPS URL | ❌ still localhost |
| Backend OAuth code | ✅ wired (`oauth.py`, `meta_accounts` route) |
| Frontend "Connect TikTok" button | ❌ not built yet (waiting on OAuth to succeed) |
| Audit submission | ❌ Stage 2 — start once sandbox proves the flow |

---

## File pointers

- Backend OAuth router: [backend/app/oauth.py](../backend/app/oauth.py)
- Provider config: `PROVIDERS["tiktok"]` in `oauth.py`
- Env file: [infra/.env](../infra/.env)
- Docker env passthrough: [infra/docker-compose.yml](../infra/docker-compose.yml)
