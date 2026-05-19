# DATALIA n8n — native-only workflows

These workflows use **only built-in n8n nodes** — no community / 3rd-party
"upload" nodes (no Instagram node, no Airtable node required). Everything that
talks to an external service is a plain **HTTP Request** node, so there is
nothing extra to install and credentials stay under your control.

> Why: the old setup used the **Instagram node** to upload. We replace it with
> a 2-step **HTTP Request** call to the Instagram Graph API (below).

## Import the template

`webhook-template.json` is a clean starter: **Webhook → Code → Respond to
Webhook**. In n8n: *Workflows → Import from File → pick the JSON*. Duplicate it
once per endpoint and change the Webhook **path**:

| Workflow | Webhook path | Frontend env var |
|---|---|---|
| Save draft | `save-draft` | `NEXT_PUBLIC_N8N_SAVE_DRAFT_URL` |
| Submit for validation | `submit-validation` | `NEXT_PUBLIC_N8N_SUBMIT_VALIDATION_URL` |
| Publish now | `publish` | `NEXT_PUBLIC_N8N_PUBLISH_URL` |
| Schedule | `schedule` | `NEXT_PUBLIC_N8N_SCHEDULE_URL` |

Set each var in `frontend/.env.local` to the **Production URL** n8n shows on
the Webhook node, e.g. `http://localhost:5678/webhook/publish`. The dashboard
already POSTs the post JSON there (`webhookService.js`); until set it just
updates status locally — no breakage.

The incoming post arrives as `{{ $json.body }}` (content, platforms, status,
scheduledDate, time, media[]).

## Native Instagram publish (replaces the Instagram node)

Instagram content publishing is **two HTTP Request nodes** against the Graph
API — no community node:

**1. Create media container** — HTTP Request node
- Method: `POST`
- URL: `https://graph.facebook.com/v21.0/{{$json.body.igUserId}}/media`
- Send Body → Form-URLEncoded:
  - `image_url` = `={{ $json.body.media[0].url }}` (public URL from the
    backend `/upload` response — that's why upload goes through our API, not a
    node)
  - `caption` = `={{ $json.body.content }}`
  - `access_token` = `={{ $env.IG_ACCESS_TOKEN }}`

**2. Publish the container** — HTTP Request node
- Method: `POST`
- URL: `https://graph.facebook.com/v21.0/{{$json.body.igUserId}}/media_publish`
- Send Body → Form-URLEncoded:
  - `creation_id` = `={{ $json.id }}` (from step 1's response)
  - `access_token` = `={{ $env.IG_ACCESS_TOKEN }}`

For **video/Reels** use `media_type=REELS` + `video_url` in step 1, then poll
`GET /{container-id}?fields=status_code` until `FINISHED` before step 2.

Other platforms, all native HTTP Request:
- **Facebook Page**: `POST /v21.0/{page-id}/photos` (or `/feed`).
- **LinkedIn**: `POST https://api.linkedin.com/v2/ugcPosts`.
- **TikTok**: Content Posting API `POST /v2/post/publish/video/init/`.

## Native Telegram validation (Submit-for-Validation workflow)

No Telegram node needed — HTTP Request to the Bot API:
- URL: `https://api.telegram.org/bot{{$env.TG_BOT_TOKEN}}/sendMessage`
- Body (JSON): `chat_id` = `={{ $env.TG_CHAT_ID }}`, `text` = the post,
  `reply_markup` = inline keyboard with `✅ Approve / ❌ Reject / ✏️ Edit`
  callback buttons. A second Webhook workflow receives Telegram's callback.

## Env (set in n8n → Settings → Variables, or container env)

| Var | Used by |
|---|---|
| `IG_ACCESS_TOKEN` / `IG_USER_ID` | Instagram publish |
| `FB_PAGE_TOKEN` / `FB_PAGE_ID` | Facebook publish |
| `TG_BOT_TOKEN` / `TG_CHAT_ID` | Telegram validation |

Media is uploaded via the backend `POST /upload` (returns a public URL); n8n
never needs an upload node — it just forwards that URL to the platform APIs.
