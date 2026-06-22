# TikTok Setup

This is the current practical setup guide for TikTok in Datalia.

## What Datalia supports

- direct TikTok OAuth
- TikTok publishing through the backend
- optional Zernio-based TikTok connection if the workspace uses Zernio

## What TikTok needs

- a real HTTPS callback URL
- a TikTok developer app
- `TIKTOK_CLIENT_KEY`
- `TIKTOK_CLIENT_SECRET`
- redirect URI:

```text
https://api.yourdomain.com/oauth/tiktok/callback
```

## Local testing

For local testing, `localhost` is not enough for TikTok OAuth.

Use a stable public HTTPS hostname pointing to the backend and set:

```env
OAUTH_REDIRECT_BASE=https://your-public-host
PUBLIC_BASE_URL=https://your-public-host
```

Then rebuild/restart the backend.

## Production

In production, use your real API domain:

```text
https://api.yourdomain.com/oauth/tiktok/callback
```

## Dokploy env

Required TikTok env values:

```env
TIKTOK_CLIENT_KEY=
TIKTOK_CLIENT_SECRET=
TIKTOK_DOMAIN_VERIFY=
```

## Notes

- TikTok connection is workspace-scoped in the current app model.
- In a shared workspace, teammates use the same connected workspace account set.
- If the workspace uses Zernio, TikTok may be connected through Zernio instead of direct provider OAuth.
- Media URLs must be publicly reachable when TikTok pulls media from the backend.

## Verify

1. Open Settings in the target workspace.
2. Connect TikTok.
3. Confirm the connection appears in the workspace.
4. Publish a test post.
5. Verify the notification result and the published outcome.
