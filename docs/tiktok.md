# TikTok — Submission Playbook

Action-oriented checklist for getting Datalia approved for TikTok's
**Content Posting API → `video.publish`**. Pair with
[`TIKTOK_SETUP.md`](TIKTOK_SETUP.md) which covers the broader sandbox /
audit overview; this doc is just what to do in order.

The 4-week wait is real and there's no clean shortcut for a single
internal account — see Stage 0 for the recommendation if you want to
ship before the audit completes.

---

## Stage 0 — Decide which path

| Path | Live? | Cost | Use when |
|---|---|---|---|
| **Telegram-tap** | This week | €0 + ~30s human tap per post | Default. Datalia does 95% (generation, scheduling, cropping, captioning), Telegram bot pushes the asset to the team chat, someone taps Publish in the TikTok app. |
| **Ayrshare** | This week | $149/mo (covers all platforms) | Volume justifies it (~200+ posts/month). They already cleared TikTok's audit on their side; we call their REST endpoint. |
| **First-party audit** | 2–6 weeks | €0 forever | We want our own dev app on TikTok's portal long-term. The rest of this doc is for this path. |

Skip the audit unless you specifically need first-party branding on
TikTok's developer page or expect to commercialise Datalia later.

---

## Stage 1 — Dev (you, locally)

Confirm the plumbing works against your own TikTok dev app + your own
TikTok test account before touching anything Datalia-branded.

### 1.1 Backend

- **`oauth.py`** — on TikTok callback, after the token exchange, hit
  `GET /v2/user/info/` and persist `display_name`, `avatar_url`,
  `open_id`, `union_id` into `.oauth_tokens.json` next to the access
  token. The frontend needs these for the compose-screen UX
  requirements below.
- **`publish.py`** — implement `publish_tiktok` for real:
  1. `POST /v2/post/publish/inbox/video/init/` (sandbox) **or**
     `/v2/post/publish/video/init/` (after audit clears) — returns
     `publish_id` + `upload_url`.
  2. Upload bytes to `upload_url`, **or** use `PULL_FROM_URL` mode with
     the cropped media URL produced by `crop_for_targets`. Note: pull
     mode requires the domain to be verified in TikTok's URL Properties
     before audit, byte upload doesn't.
  3. Poll `POST /v2/post/publish/status/fetch/` until `status` is
     `PUBLISH_COMPLETE`, then return `publicly_available_post_id` +
     `permalink_url`.
- **`/oauth/connections`** — surface the connected TikTok account as a
  target so Settings + `PublishConfirmModal` pick it up. Mirror the
  Meta target shape: `{id, label, kind: "tiktok_account", audience}`.

### 1.2 Frontend — 4 missing UX elements in the TikTok preview pane

TikTok auto-rejects on sight if any of these are missing. Build them in
[`CreationEditor.js`](../frontend/app/components/views/CreationEditor.js)'s
TikTok preview block:

| Element | Source / behaviour |
|---|---|
| **Creator avatar + @handle** | Pull from the TikTok OAuth state (`avatar_url`, `display_name`). Render above the caption. |
| **Visibility selector** | Dropdown: `Public` / `Mutual followers` / `Self only`. Default `Public`. Send the selected value as `privacy_level` in the publish call. |
| **"Disclose branded content" toggle** | Boolean. Send as `disclose_video_branded` flag. |
| **Music usage confirmation** | Checkbox: *"I confirm the music I've used does not violate any third-party rights."* **Publish button stays disabled until ticked.** |

### 1.3 End-to-end test

Use your own TikTok dev app + your own TikTok account (added as the
sandbox tester):

1. Connect TikTok in Settings → OAuth consent screen shows the four
   scopes you selected → returns to Datalia with the avatar/handle.
2. Editor: upload an MP4, AI-caption, the preview shows the 4 UX
   elements above. Music checkbox unblocks Publish.
3. Click Publish → backend uploads via Inbox flow → tester's TikTok
   inbox notification → manual tap to publish (sandbox is `SELF_ONLY`,
   that's expected).
4. Bell feed gets a "Published to @tester (tiktok)" entry with the
   permalink. Calendar tile flips to `published`.

If any step fails, fix it before touching client assets.

---

## Stage 2 — Client (the company)

The CEO / business side gathers these. None of them require dev work;
they require time and paperwork.

### 2.1 Public web assets

- **Privacy Policy URL** — must explicitly mention TikTok data usage
  (token storage, what fields you keep, what you don't share). 2–3
  sentences in a dedicated section is enough.
- **Terms of Service URL** — required for any TikTok app created after
  Sept 2024.
- **`tiktok-verification.txt`** at the web root — TikTok generates the
  token, you upload the file. Same root as the Privacy Policy / ToS.

### 2.2 Brand assets

- **App icon** — 1024×1024 PNG, no transparency. Datalia's logo on a
  solid background.
- **Custom showcase PDF** — 5–10 pages of real Datalia screenshots
  walking through the user flow. Do **NOT** submit TikTok's example
  template; that's an instant reject.

### 2.3 Business + reviewer access

- **Real company info** — legal name, registered website, contact name.
  No Kbis required, but the website must be live.
- **Dedicated TikTok account for reviewers** — fresh account, kept
  clean. TikTok reviewers log in and post test content here during
  review. Don't use the brand's real TikTok account.

---

## Stage 3 — Deploy + record + submit

When Stage 1 is green and Stage 2 assets are in hand.

### 3.1 Deploy frontend

`localhost:3000` is unusable in the demo videos (TikTok matches the
domain in the video against the website URL you submit). Deploy:

```bash
cd frontend
vercel deploy --prod
# bind a real subdomain (app.datalia.com) in the Vercel dashboard
```

Or use Datalia's existing company domain if it has one — `app.datalia.<tld>`
via CNAME is the cleanest look for a TikTok reviewer.

### 3.2 Swap to the client's TikTok dev app

In `infra/.env`:

```env
TIKTOK_CLIENT_KEY=<client-app-key>
TIKTOK_CLIENT_SECRET=<client-app-secret>
TIKTOK_DOMAIN_VERIFY=<client-verification-token>
OAUTH_REDIRECT_BASE=https://<backend-tunnel>
```

In TikTok's dev portal for the client's app:

- **Products** tab → add **Login Kit** and **Content Posting API**.
- **Scopes**: `user.info.basic`, `video.publish`. Skip everything else
  — every unused scope you select needs to be demonstrated in the demo
  videos, or review gets delayed.
- **URL properties** → register the redirect URI:
  `https://<backend-tunnel>/oauth/tiktok/callback`. Same value as the
  one in `OAUTH_REDIRECT_BASE`.

Restart the backend so it picks up the new env, run the OAuth flow once
with the dedicated reviewer test account to confirm everything still
works after the credential swap.

### 3.3 Record 3 demo videos

Each ≤ 50 MB, mp4 or mov, recorded on the deployed Vercel URL (visible
in the address bar). Total of 3 keeps each video short enough to fit.

**V1 — Account linking (proves Login Kit + scope consent).**
1. Open Datalia at the deployed URL.
2. Settings → Connect TikTok.
3. TikTok's OAuth consent screen appears, scopes visible.
4. Approve.
5. Back on Datalia: "Connected as @tester" with avatar visible.

**V2 — Compose + publish (proves Content Posting API + `video.publish`).**
1. Open the editor, upload a vertical MP4.
2. AI caption generation (shows the captioning feature in use).
3. TikTok preview pane visible with: avatar + @handle, visibility
   selector dropdown, branded content toggle, music consent checkbox.
4. Tick the music checkbox, pick `Public`, click Publish.
5. Cut to tiktok.com showing the post live (will be `SELF_ONLY` in
   sandbox — that's fine, reviewers expect it).

**V3 — Sandbox proof.**
1. Datalia shows the publish succeeded (calendar tile flipped, bell
   notification has a permalink).
2. Open tiktok.com on the tester account → the post is there.

### 3.4 Submit

Upload to the review form:

- 3 demo videos
- Custom showcase PDF
- Privacy Policy URL
- Terms of Service URL
- App icon (1024×1024 PNG)
- Business info + dedicated reviewer test account credentials
- Use-case description (see template below)

**Use-case description template** (paste into the form):

> Datalia is a content creation tool for TikTok creators and brand
> managers. Users compose original video content within the app, refine
> TikTok-native captions and hashtags with AI assistance, preview the
> post in TikTok's vertical (9:16) format, and schedule publication
> directly to their connected TikTok account. The Content Posting API
> is required so creators can publish from their planning workflow
> without switching to the TikTok app to manually upload, which is the
> workflow most professional creators already use today via tools like
> Buffer and Hootsuite.

**Daily-active-user estimate**: `10–50 at launch, 100–500 within 6 months`.

**Stored fields** (list exactly what's in `.oauth_tokens.json` and the
publish response — nothing more):

```
access_token, refresh_token (encrypted server-side),
expires_at, scope, obtained_at,
publish_id, publicly_available_post_id, permalink_url
```

Will you resell access? **No.** Will tokens leave your servers? **No.**

### 3.5 Reject-on-sight final pass

Re-watch every demo video and tick:

- [ ] **Creator avatar + @handle visible** on the compose screen before
      Publish is clickable
- [ ] **Music consent checkbox** visible and blocking
- [ ] **Visibility selector** visible
- [ ] **Branded content toggle** visible
- [ ] No watermarks, logos, or promo text on the user's video
- [ ] Use-case description never uses the words `internal`,
      `cross-post`, `repurpose`, `multi-platform`
- [ ] Demo URL = submitted website URL
- [ ] PDF is custom, not TikTok's template

Submit. Stay off the dedicated tester account during the 2–6 week
review — TikTok reviewers will post live test content there.

---

## File pointers

- Backend OAuth router: [backend/app/oauth.py](../backend/app/oauth.py)
- Per-platform publish handlers: [backend/app/publish.py](../backend/app/publish.py)
  (search for `publish_tiktok` — currently a stub)
- Env file: [infra/.env](../infra/.env)
- Provider config: `PROVIDERS["tiktok"]` in `oauth.py`
