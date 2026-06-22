# TikTok Notes

This file is a short reference for TikTok in the current branch.

## Current state

- TikTok is part of the supported social targets.
- Direct TikTok OAuth exists in the backend.
- Publishing can run through direct provider support or through Zernio when configured for the workspace.
- The active workspace determines which TikTok connection is used.

## Requirements

- TikTok app credentials in env for direct mode
- real HTTPS callback host
- publicly reachable media URLs for publish flows that require remote fetch

## URLs

- callback:

```text
https://api.yourdomain.com/oauth/tiktok/callback
```

- terms:

```text
https://api.yourdomain.com/terms
```

- privacy:

```text
https://api.yourdomain.com/privacy
```

## Operator reminder

If TikTok is being used through Zernio, the workspace's Zernio configuration is what matters, not only the direct TikTok env keys.

For full deploy/setup context, use:

- [../DEPLOY.md](../DEPLOY.md)
- [TIKTOK_SETUP.md](TIKTOK_SETUP.md)
