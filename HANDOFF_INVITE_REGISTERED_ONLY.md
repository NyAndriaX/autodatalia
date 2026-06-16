# Handoff: Invitations restricted to already-registered accounts

Branch: `workspaces-rbac`. Authored on a small VM where the Docker stack +
test suite were **not** run — that's your job on the PC (commands below).

## What changed & why

Previously you could invite **any** email into a workspace, and the invitee
created their account *through* the invite link (`/auth/accept-invite` made the
user on the fly). The requirement is now: **you can only invite people who
already have a Datalia account.** New teammates self-register first, then get
invited.

Two backend enforcement points (defense in depth):

1. **Invite creation** — `backend/app/workspaces_routes.py`, `members_invite`
   (`POST /workspace/members/invite`). Rejects an email with no account:
   `400 — "No Datalia account exists for that email. Ask them to register first."`
   The existing "already a member of this workspace" check still applies after it.

2. **Invite acceptance** — `backend/app/auth.py`, `accept_invite`
   (`POST /auth/accept-invite`). Removed the "create the account if missing"
   branch. If the invited email has no account → `400`. This also closes the path
   for any **stale invitation** issued before rule #1 (so an invite can never
   create an account). For an existing account it behaves as before: joins them to
   the workspace with the invited role and signs them in.

No frontend code change was needed:
- The admin's invite form (`MembersView.js`) already shows the backend error
  message in an antd toast (`err?.message`).
- The accept page (`frontend/app/invite/page.js`) branches on
  `preview.needs_account`. Since invites now only target registered users, that's
  always `false`, so the page shows the existing "you already have an account →
  sign in" alert. The invitee then accepts from their in-app invitations inbox
  (`GET /invitations/mine` → `POST /invitations/{id}/accept`, already implemented).

## Resulting flow

Admin invites a **registered** email → invitee signs in → accepts the pending
invite from their inbox. Inviting an unregistered email is blocked at creation.

## Files touched

- `backend/app/workspaces_routes.py` — registered-only guard in `members_invite`.
- `backend/app/auth.py` — `accept_invite` no longer creates accounts.
- `backend/tests/test_workspaces_rbac.py` — updated 3 existing invite tests to
  register the invitee first; added 2 new tests for the rule.

## Tests to run (on the PC)

Bring up the stack, then run the RBAC suite (it needs the app's MariaDB):

```bash
docker compose -f infra/docker-compose.yml up -d --build caption-api
docker compose -f infra/docker-compose.yml exec -T caption-api \
    python -m pytest tests/test_workspaces_rbac.py -q
```

Then the full backend suite to confirm no wider regression:

```bash
docker compose -f infra/docker-compose.yml exec -T caption-api \
    python -m pytest tests/ -q
```

### What the tests cover (in `test_workspaces_rbac.py`)

- **Updated** `test_invite_accept_collaboration`, `test_viewer_role_is_read_only`,
  `test_permission_change_is_live` — the invitee now `_register(...)`s before the
  invitation is created/accepted (they used to be created at accept time).
- **New** `test_invite_requires_registered_account` — `POST
  /workspace/members/invite` for an unregistered email → 400 and no invitation
  row; after the email registers, the same invite returns 200.
- **New** `test_accept_invite_rejects_unknown_account` — a simulated legacy
  invitation to an email with no account → `/auth/accept-invite` returns 400 and
  no user is created.

## Manual smoke (optional, full stack)

1. Register account A (Owner) and, separately, account B.
2. As A, invite `B`'s email → success. Invite a random unregistered email →
   toast: "No Datalia account exists for that email…".
3. As B, sign in → accept the pending invite from the invitations inbox →
   confirm B now shares A's workspace (posts/accounts/media) with the invited role.

## Notes

- This removes the "register via invite link" onboarding path by design. If the
  product later wants admins to invite anyone and onboard through the link, that's
  the opposite of this change — revert both guards.
- Push target is **GitHub** (`github` remote), not GitLab.
