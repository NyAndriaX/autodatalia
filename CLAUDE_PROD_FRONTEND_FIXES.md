# Claude Handoff: Frontend Prod Cleanup

This note documents the two frontend issues currently visible in the app, based on the code that is on this branch right now.

## 1. "Team & Access" exists in code, but does not appear in the sidebar

### What is already present

- `frontend/app/components/layout/Sidebar.js`
  - Adds a dedicated section for workspace RBAC:
    - `members` with perm `members.read`
    - `roles` with perm `roles.read`
- `frontend/app/dashboard/page.js`
  - Routes both views:
    - `case "members": return <MembersView />`
    - `case "roles": return <RolesView />`
- `frontend/app/components/views/MembersView.js`
  - Full members + invitations UI exists.
- `frontend/app/components/views/RolesView.js`
  - Full roles + permission-matrix UI exists.

### Why it can be missing

The sidebar intentionally filters these entries by permission:

- `Sidebar.js` calls `hasPermission(user, it.perm)`
- `frontend/app/lib/permissions.js`
  - `members.read`
  - `roles.read`

If the signed-in user's `permissions` array does not contain those strings, the section disappears entirely.

### Important finding

The frontend auth layer is **not** stripping permissions:

- `frontend/app/lib/authService.js`
  - `normalizeUser()` preserves `user.permissions`
  - it only defaults missing permissions to `[]`
- `frontend/app/store/authSlice.js`
  - stores the whole user object as-is

The backend is also supposed to return permissions:

- `backend/app/auth.py`
  - `_user_payload()` includes:
    - `permissions`
    - `workspace`
    - `workspace.role`
    - `workspace.is_owner`

### What Claude should verify/fix

If the current signed-in user is meant to be Owner/Admin and still cannot see the sidebar update:

1. Check `/auth/me` in the running app.
2. Confirm it returns a non-empty `permissions` array.
3. Confirm it includes `members.read` and `roles.read`.
4. Confirm the registered user was actually attached to a seeded workspace role.

If `/auth/me` is correct, the sidebar should render the section without further frontend work.

## 2. Telegram settings expose infra/debug state that should not be shown in prod

### Current production-unfriendly UI

In `frontend/app/components/views/SettingsView.js`:

- Telegram tab badge shows `"ok"` when `telegramStatus?.configured`
- Telegram tab renders three green/red infra status cards:
  - Bot token
  - Default chat
  - Webhook secret

This is being driven by:

- `fetchTelegramStatus()` from `frontend/app/lib/validationService.js`
- `telegramStatus` state in `SettingsView.js`

### Why this is wrong for prod

`TELEGRAM_BOT_TOKEN` and `TELEGRAM_WEBHOOK_SECRET` are server-side deployment secrets. They are useful for debugging, but they should not be presented as user-facing prod settings/health indicators.

For a production operator/user UI, the Telegram section should focus on only what the user can actually manage from the app, such as:

- pairing / saving the target Telegram chat id
- sending a test message

### What Claude should remove or change

In `frontend/app/components/views/SettingsView.js`:

1. Remove the Telegram tab `"ok"` badge.
2. Remove the three green/red status cards.
3. Keep only the user-actionable controls:
   - chat id field
   - pair/save action
   - test message action
4. Do not surface bot-token/webhook-secret health in the normal prod UI.

## 3. Topbar still has a misleading Telegram/backend status dot

In `frontend/app/components/layout/Topbar.js`:

- there is still a button with id `telegram-status`
- it is **not** real Telegram status
- it polls `apiHealthCheck()` and displays backend connectivity from `/health`

So the current UI is mislabeled:

- icon/button name says Telegram
- actual logic is backend health

### What Claude should do

Pick one:

1. Remove this control from the prod topbar entirely, or
2. Rename/reframe it as backend health, not Telegram status

But it should not remain as a Telegram-looking live status dot if it is only checking backend reachability.

## Short version

- The Team & Access frontend is already in the codebase.
- If it is not visible, the most likely issue is missing RBAC permissions in `/auth/me` or incorrect workspace-role bootstrap.
- The Telegram settings UI still exposes infra/debug health that should be removed for a cleaner prod UI.
- The topbar Telegram-status control is mislabeled and should be removed or renamed.
