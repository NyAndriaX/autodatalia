# Workspaces + Custom RBAC — Implementation Handoff (Phase 1)

Branch: `workspaces-rbac`. This inverts the old per-user isolation into **shared
workspaces with custom roles/permissions**. The full design is in
`/home/joseph/.claude/plans/melodic-wandering-pebble.md` (also summarized below).

> ⚠️ **Do NOT deploy this branch until the remaining media/frontend items below
> are finished.** The backend scope cutover is now validated on a real Docker +
> MariaDB stack and the backend test suite is green, but Stage 6 media
> partitioning and Stage 7 frontend work are still outstanding.

---

## The model (how isolation now works)

- One funnel, `db._scope_key`, now keys all collaborative data on
  **`ws:{workspace_id}`** instead of `user:{id}`. Members of a workspace share
  posts, connected social accounts (OAuth tokens), automation, media, activity
  feed, AND the AI keys/cost.
- Every document carries `payload["workspace_id"]` (owning scope) + `user_id`
  (author). The `ws:` prefix is **fail-closed**: a stray user id resolves to a
  scope with no rows, never another user's old data.
- **Authorization** is one dependency: `authz.require_permission("posts.publish")`
  resolves caller → workspace → role → permission set **live every request**
  (no caching → revocations are instant) and 403s. The data-layer 404 isolation
  stays as defense-in-depth.
- Membership model (MVP): **one workspace per user**. Register → you own a
  workspace. Invite teammates by email → they join it. Inviting an email that
  already has a workspace is rejected (multi-workspace = Phase 2).

## New files
- `backend/app/workspaces.py` — control-plane data + **permission catalog**
  (`PERMISSION_GROUPS` / `ALL_PERMISSIONS`) + seeded roles (Owner/Admin/Editor/
  Viewer) + members/roles/invitations helpers + `migrate_to_workspaces()`.
- `backend/app/authz.py` — `WorkspaceContext`, `require_workspace`,
  `require_permission`.
- `backend/app/workspaces_routes.py` — `/workspace`, `/workspace/members[...]`,
  `/workspace/roles[...]`, `/workspace/invitations[...]`, `/workspace/permissions`.
- `backend/tests/test_workspaces_rbac.py` — isolation/roles/invite/gating tests.

## Changed files (backend)
- `db.py` — 5 new tables in `init_db` (workspaces, workspace_members, roles,
  role_permissions, workspace_invitations); `_scope_key` → `ws:`; back-fill +
  `list_scoped_blob_user_ids` → `ws:`.
- `auth.py` — `register()` creates the personal workspace + Owner; public
  `GET /auth/invite/{token}` + `POST /auth/accept-invite`.
- `routes.py` — `_scope_user_id(user_id)` now returns the caller's **workspace**
  id; every data route gated via `_perm("…")`; raw `user_id` scope feeds routed
  through the workspace; `create_post`/`create_automation_rule` stamp
  `workspace_id` + author.
- `oauth.py` — tokens load/save by workspace; `/start` stamps the workspace in
  pending-state; callback binds tokens to it; connect/read/disconnect gated.
- `runtime_config.py` — settings (AI keys) resolve by **active workspace**
  (`_ACTIVE_WORKSPACE_ID` ContextVar, set by `require_workspace`).
- `services.py` / `cost_tracking.py` / `video_jobs.py` — upserts persist+scope
  by `workspace_id`.
- `scheduler.py` / `automation_worker.py` / `telegram_validation.py` — resolve
  tokens/settings/writes from the post/rule **`workspace_id`**.
- `main.py` — mounts `workspaces_router`.

## Run the tests (against the real DB)
```bash
docker compose -f infra/docker-compose.yml up -d --build
docker compose -f infra/docker-compose.yml exec -T caption-api \
    python -m pytest tests/test_workspaces_rbac.py -q
```
`test_workspaces_rbac.py` covers: register→workspace; **two-workspace
isolation (A can't read/patch/delete B's posts → 404)**; seeded roles + perms;
invite→accept collaboration + single-use token; Viewer is read-only (403 on
create); live permission revocation.

## 2026-06-15 validation + follow-up work completed

- Backend validated on the real Dockerized stack (`infra/docker-compose.yml`)
  against MariaDB.
- Full backend suite now passes:
  ```bash
  docker compose -f infra/docker-compose.yml exec -T caption-api \
      python -m pytest tests -q
  # 80 passed
  ```
- Fixed test isolation in `db.reset_all_state_for_tests()` so workspace/RBAC
  tables are wiped between tests.
- Updated the old backend tests (`tests/test_routes.py`,
  `tests/test_scheduler.py`) to use real registered workspace clients instead
  of the old open-mode / fake-JWT assumptions.
- Fixed a real scope bug in `telegram_validation.py`: `/validation/submit`
  now stamps `workspace_id` on pending posts instead of dropping them into the
  global scope.
- Finished the backend part of the old “media_generation router” TODO:
  `/media/generate/image` and `/media/generate/video` are now permission-gated
  with `media.generate`, and video jobs are stored/read in workspace scope.
- Removed the runtime `curl` dependency from `backend/Dockerfile` and switched
  backend compose healthchecks to Python so local/prod health no longer depend
  on extra apt packages.

---

## ⚠️ REMAINING WORK (for the next agent to finish + verify)

1. **Stage 6 — media partitioning (NOT done).** `/upload`, `/search`,
   `/content-items`, `delete_media` are **gated** by permission but still read/
   write the FLAT `content_dir` (no per-workspace isolation — a pre-existing
   cross-tenant exposure). Implement `content_dir/ws/{workspace_id}/...` and pin
   the path guard in `services.save_upload` / `search_media` /
   `iter_content_items` / `delete_media`, threading the workspace id. NOTE: the
   `/content` StaticFiles mount stays publicly served (Meta/TikTok must fetch
   media); signed URLs are Phase 2 — document, don't silently "fix".

2. **Stage 7 — frontend (NOT started).** Build per the plan
   (`melodic-wandering-pebble.md` → Frontend section): `app/lib/permissions.js`
   (`hasPermission`/`usePermission`), gate the Sidebar "Équipe & Accès" section,
   add `app/components/views/MembersView.js` + `RolesView.js` (+ `adminUI.js`
   copy of SettingsView's `Section`/`Champ`), `app/invite/page.js` (clone
   `reset-password/page.js`), `membersService.js`/`rolesService.js`/`rolesSlice`,
   wire into `app/dashboard/page.js` switch + `store/index.js`, and add the
   `team`/`invite` i18n namespaces to **both** `messages/fr.json` and `en.json`.
   `/auth/me` already rides the new `workspace`/`permissions` fields through
   `authService.normalizeUser` (add `permissions: []` default there).

3. **Audit checklist to re-run before trusting it** (security gate):
   - `grep -rnE "post.get\(.user_id.\)|rule.get\(.user_id.\)" backend/app` —
     every remaining hit must be an AUTHOR stamp, never a scope feed.
   - Confirm `permissions_for` reads live (it does — no caching).
   - Confirm `migrate_to_workspaces` on a 1-user and a 2-user DB moves data to
     `ws:` and stamps `workspace_id` (write a migration test).
   - Owner-protection: can't remove/demote the sole Owner (helpers enforce it;
     add a test).

## Deploy notes (when ready, after tests pass)
- Stage 2 (migration) + Stage 3 (scope flip) ship **together** (same image) — the
  migration runs in `init_db` and the app reads `ws:` from the same build.
- Invitations email via the existing SMTP-or-log helper; set `PUBLIC_APP_URL` +
  `SMTP_*` for real emails (else the invite link is logged).
