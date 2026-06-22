# LinkedIn Setup

LinkedIn is supported in the current branch.

## Direct LinkedIn mode

Required env:

```env
LINKEDIN_CLIENT_ID=
LINKEDIN_CLIENT_SECRET=
```

Redirect URI:

```text
https://api.yourdomain.com/oauth/linkedin/callback
```

## Current app model

- LinkedIn connections are workspace-scoped.
- In a shared workspace, the workspace shares the connected account set.
- LinkedIn can also be reached through Zernio if that workspace uses Zernio instead of direct provider OAuth.

## Verify

1. Open the target workspace.
2. Go to Settings.
3. Connect LinkedIn.
4. Confirm the connection appears in the workspace.
5. Publish a test post from that workspace.
