# Workspaces + Custom RBAC

Datalia is now a **shared-workspace** product with **custom roles & permissions**,
instead of one isolated island per user. An admin owns a workspace, invites
teammates by email, and they collaborate on the same connected accounts, posts,
automation, media and AI budget — with each member's capabilities decided by
their role.

Branch: `workspaces-rbac`.

---

## The model

- **One scope, keyed per workspace.** Every collaborative row lives under
  `ws:{workspace_id}` (the single isolation funnel, `db._scope_key`). A document
  carries `workspace_id` (the owning scope) + `user_id` (the author). The `ws:`
  prefix is fail-closed: a stray non-workspace id resolves to an empty scope, it
  never bleeds into another workspace.
- **One authorization point.** `authz.require_permission("posts.publish")` gates
  each route — it resolves caller → workspace → role → permission set, read live
  from the DB on every request (so a role change takes effect on the next call).
  The data-layer 404 isolation stays underneath as defense in depth.
- **One workspace per user (MVP).** Register → you own a workspace (role: Owner).
  Invite an email → they join yours. Inviting someone who already has a workspace
  is rejected (multi-workspace + a switcher is a later phase).
- **Roles.** Four seeded system roles per workspace — Owner (everything, incl.
  `workspace.manage`), Admin (everything except `workspace.manage`), Editor
  (content/AI/media/automation + read connections & settings), Viewer (read-only).
  Admins can also create custom roles from the permission catalog. System roles
  are not editable; the Owner role is immutable.
- **AI keys & cost are workspace-level.** There is one set of provider keys per
  workspace, editable only with `settings.manage`. The automation worker bills
  the workspace, and the cost view reports the workspace's spend.

## Permission catalog
`posts.read/create/update/delete/publish`, `ai.generate`, `media.generate`,
`media.read/upload/delete`, `automation.read/write/validate`,
`connections.read/manage`, `settings.read/manage`,
`members.read/invite/manage`, `roles.read/manage`, `workspace.manage`.

---

## What's implemented

**Backend**
- Control plane (real tables): `workspaces`, `workspace_members`, `roles`,
  `role_permissions`, `workspace_invitations`, created in `db.init_db`.
  `backend/app/workspaces.py` holds the catalog, role seeding, and all member/
  role/invitation helpers.
- `authz.py` — `require_workspace` / `require_permission` (+ `WorkspaceContext`).
- Registration creates the user's workspace + Owner membership. A one-time,
  idempotent backfill moves any pre-existing user's data into `ws:` scope on boot.
- Scope cutover applied across `routes.py`, `oauth.py` (tokens save to the
  workspace; the connect callback binds to the workspace stamped at `/start`),
  `runtime_config.py` (settings resolve by active workspace), `services.py`,
  `cost_tracking.py`, `video_jobs.py`, and the background workers
  (`scheduler.py`, `automation_worker.py`, `telegram_validation.py`).
- **Media is workspace-partitioned** under `content_dir/ws/{id}/…`
  (`save_upload` / `search_media` / `iter_content_items` / `delete_media`).
  Delete's path guard is pinned to the caller's own media root, so a crafted
  `ws/<other>/…` path is rejected.
- Endpoints: `GET /workspace`, `…/members` (+ `invite`, role change, remove),
  `…/roles` (CRUD), `…/invitations` (list/revoke), `…/permissions`, and the
  public `GET /auth/invite/{token}` + `POST /auth/accept-invite`.
- `/auth/me` (and login/register/accept) return `permissions` + `workspace`
  `{id, name, role, is_owner}`.

**Frontend**
- `app/lib/permissions.js` (`hasPermission` / `usePermission` + the catalog),
  `app/lib/workspaceService.js`, and `authService.lookupInvite/acceptInvite`.
- `MembersView` (invite form + members table with per-row role select + pending
  invitations) and `RolesView` (role list + grouped permission-matrix editor;
  system roles read-only). Wired into the dashboard view switch.
- The Sidebar gains a permission-gated **"Équipe & Accès"** section (it hides
  items the role doesn't grant and drops empty sections).
- `app/invite/page.js` — the logged-out accept page.

---

## Verify before rollout
- Bring up the stack (`infra/docker-compose.yml`) and exercise the backend suite.
- `cd frontend && npm run build` — the new views/Sidebar/invite page only use
  existing Ant Design + Redux primitives, but this is the compile check.
- Smoke: register (Owner) → set the workspace AI key as admin → invite a second
  email → accept in another browser → confirm the invitee shares the same posts/
  accounts/media, and that changing their role gates the UI immediately.

## Known follow-ups (intentional, not blockers)
- AI-generated media output (`media_generation`'s generated dir) is not yet
  partitioned per workspace — only the job records are workspace-scoped. The
  upload/library/search media path **is** partitioned.
- The new admin views + Sidebar team section use literal French strings (no i18n
  keys yet), to keep them decoupled from the message bundles.
- Multi-workspace membership + a workspace switcher, and signed/expiring media
  URLs, are later phases. The `/content` mount stays publicly served because
  Meta/TikTok must fetch media to ingest it.

## Deploy notes
- The registration/migration changes and the `ws:` scope cutover are one release
  (the migration runs in `init_db` and the app reads `ws:` from the same build).
- Set `PUBLIC_APP_URL` + SMTP for real invitation emails; without SMTP the invite
  link is logged instead.
