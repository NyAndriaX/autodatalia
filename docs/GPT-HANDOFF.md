# Handoff to GPT — `workspaces-rbac` test & verify guide

This branch got a large batch of work from Claude (on the VM). Claude can only
do **light checks** on the VM (Python compile, JSON validity, brace/ref
balance) — it **cannot run a Next.js build or the live app**. That's your job
on the PC. This guide is the test plan.

> **CEO-list status** — what's done vs what's left/subjective, with the CEO's
> requests quoted verbatim: see [`CEO-CHECKLIST.md`](CEO-CHECKLIST.md).

## Round 2 — fixes batch (test these)

A second batch of CEO/user fixes landed (commits `5afbb22`..`26cd97e`). Build the
frontend + run the backend suite, then click-test:

1. **Zernio connect list** (`5afbb22`) — Settings → Platforms → Zernio "Connect a
   network" now shows only Facebook / Instagram / TikTok / LinkedIn (not 15).
2. **Zernio /start 500** (`a6a46a3`) — contract matches the docs, so this was
   environmental. Now: the server logs the exact upstream failure (`[zernio] GET
   /connect/... -> 500: <body>`), the UI notification shows Zernio's real
   message (not "API 500"), and `start_connect` self-heals a stale cached
   profile (usual cause — the key was rotated, so the old profile_id no longer
   belongs to the account) by recreating it once. **Reconnect Zernio and watch
   the logs** — they now name the real reason if it still fails.
3. **All notifications i18n** (`26cd97e`) — thunk notifications (sign-in,
   scheduled, published, draft saved, etc.) are translated per language now. Flip
   FR/EN and confirm the bell feed switches. (Components already used t().)
4. **Auth header** (`5afbb22`) — Create Account tab no longer clips its header
   (`safe center`); both tabs show the title.
5. **AI-media picker** (`6e42f3d`) — Create → Media → "Image IA"/"Vidéo IA" open
   a picker of what you generated in those studios (client-side, per-workspace).
   Generate in Image IA / Vidéo IA first, then pick in Create.
6. **Scheduled post edit** (`b51e577`) — a calendar post's pencil loads it into
   Create (no popup); a day "+" opens Create pre-set to that date so scheduling
   needs no re-pick; editing then scheduling updates in place (no duplicate).
7. **Image IA options** (`f425cb2`) — optional Style / Colors / Lighting / accent
   chips that augment the prompt.
8. **Singular media delete** (`5afbb22`) — per-tile trash in the Library now
   removes the item (mirrors bulk delete).
9. **500 MB media limit** (`5afbb22`) — frontend + backend. **A prod proxy
   (Caddy) may need a matching request-body limit for 500 MB uploads.**
10. **Draft edit in place** (`6e76783`) — editing a draft updates it instead of
    creating a new one; "New post" resets the editor.

## Round 4b — account-deletion media cleanup + clean re-registration (backend)

Follow-up on Round 4 (which you committed + verified at `4cb1356`, 104 passing).
Three items, all in `backend/app/workspaces.py` + two new tests:

1. **`delete_user` now cleans up media** for any workspace it fully deletes (the
   no-heir branch). The Round 4 refactor dropped this: account deletion removed
   the DB rows but left `content/ws/{id}/` files orphaned on disk. Now, mirroring
   `delete_workspace`, it collects the deleted workspace ids and calls
   `_delete_workspace_media` AFTER the transaction commits (FS error can't roll
   back / block the DB delete). Low severity (disk leak, no exposure) but it's the
   difference between a re-registered email truly starting clean vs. leaving junk.

2. **Clean re-registration is guaranteed + tested.** Confirmed at the data layer
   (no code change needed beyond #1): `create_user` is a plain `INSERT` → a fresh
   auto-increment **user id**, and registration creates a fresh personal workspace
   → fresh `ws:{id}` **scope**, so a re-registered email gets a NEW index and NONE
   of the old account's posts / uploaded media / OAuth tokens / runtime settings.
   `delete_user` frees the email (drops the `users` row) and destroys the old
   workspace's scope + media. The "Email already registered" guard only trips for a
   *live* email; a deleted one passes (subject to the normal open-registration
   switch — this is NOT a special bypass of that policy).
   - **New test:** `test_reregister_deleted_email_is_a_fresh_account` — seeds a
     post + upload + OAuth-token blob, deletes the account, re-registers the same
     email, and asserts a different user id + workspace id, owner of a fresh
     personal workspace, and empty posts / media / oauth tokens.

3. **`delete_user` now purges pending invitations addressed to the email.**
   Previously a pending `workspace_invitations` row sent to `x@y.com` survived
   deletion of the `x@y.com` account, so a re-registration inherited an inbox of
   invites sent to the *previous* account. Now `delete_user` captures the email
   inside the transaction and `DELETE`s `workspace_invitations WHERE email = ?`
   before commit. Invites the user *sent* for workspaces that survive (heir
   transfer) are untouched — only the addressee's inbox is cleared. This completes
   the clean-slate guarantee.
   - **New test:** `test_delete_account_purges_pending_invitations` — a second
     owner invites the user's email, the user deletes their account, and the test
     asserts `list_invitations_for_email` is empty, the host workspace still
     exists, and a re-registration of the same email starts with an empty inbox.

**Run it** (DB-backed; expect 106 now — Round 4's 104 + these 2 new tests):

```bash
docker compose -f infra/docker-compose.yml exec -T caption-api \
    python -m pytest tests/test_workspaces_rbac.py -q     # expect 20 passed
docker compose -f infra/docker-compose.yml exec -T caption-api \
    python -m pytest tests/ -q                            # expect 106 passed
```

**Claude verified (VM):** `py_compile` of both files, media-cleanup wiring
(`deleted_media_wids` collected in the no-heir branch, drained after commit),
invitation-purge wiring (email captured pre-delete, `workspace_invitations`
dropped by email before commit), `settings.allow_open_registration` exists.
**NOT verified (your job):** the pytest run against MariaDB.

## Round 4 — workspace/deletion hardening (backend, test this)

Two real issues found in a read-only review of the Zernio / workspaces / deletion
logic. Both fixed in `backend/app/workspaces.py`; one new test added. **Run the
backend suite** (these touch destructive paths):

```bash
docker compose -f infra/docker-compose.yml exec -T caption-api \
    python -m pytest tests/test_workspaces_rbac.py -q
docker compose -f infra/docker-compose.yml exec -T caption-api \
    python -m pytest tests/ -q          # full regression
```

1. **Atomic destructive deletes.** `db._connect()` uses `autocommit=True`, so the
   cascade deletes ran as separate auto-committed statements — a mid-cascade
   failure could leave a half-deleted workspace (orphaned roles/docs, or a
   workspace row whose children are gone) or, in `delete_user`, a workspace owned
   by an already-deleted user. Now each runs in ONE transaction
   (`conn.begin()` / `commit` / `rollback`):
   - New cursor-aware helpers `_delete_workspace_rows(cur, wid)` and
     `_transfer_ownership_rows(cur, wid, nid)` do the SQL on a caller-owned cursor.
   - `delete_workspace`, `transfer_ownership`, and `delete_user` wrap them in a
     transaction. `delete_user` now does the whole transfer/delete/cleanup loop on
     a single connection, so it's all-or-nothing.
   - Filesystem media cleanup (`_delete_workspace_media`) runs only AFTER the DB
     commit, so an FS error never rolls back (or blocks) the DB delete.
   - **Behavior is unchanged on the happy path** — existing deletion tests
     (`test_owner_deletes_workspace`, `test_delete_own_account`,
     `test_delete_owner_transfers_ownership`, `test_admin_deletes_member_account`,
     `test_member_leaves_workspace`, the personal-workspace guard) should all stay
     green. They're the regression check for this change.

2. **Owner-role escalation blocked.** `change_member_role` only blocked *demoting*
   the owner — it let anyone with `members.manage` (e.g. an Admin) assign the
   system **Owner** role to another member, minting a second member holding
   `workspace.manage` (which the Admin doesn't have). Now `change_member_role`
   rejects assigning the Owner role to a non-owner; ownership moves ONLY via
   `transfer_ownership`. **New test:** `test_owner_role_cannot_be_assigned_via_role_change`
   (both owner and admin attempts → 400; ownership + member role unchanged).

**Claude verified (VM):** `py_compile` of `workspaces.py` + the test file, helper
wiring (begin/rollback present on all three paths). **NOT verified (your job):**
the pytest run against MariaDB — these are DB-transaction changes, so the suite is
the real check. Confirm no deletion test regressed and the new test passes.

> Note: the one-time migration helper `_rescope_user_data` is still non-atomic,
> but it only runs when zero workspaces exist (fresh migration) and is
> idempotent-ish, so it was left as-is. Flag if you want it wrapped too.

## Round 3 — real platform logos (test this)

**Real brand logos for Facebook / Instagram / TikTok / LinkedIn.** Before, the
platform marks came from `lucide-react`, which ships only generic outline icons
and **has no TikTok icon at all** — TikTok fell back to a generic `Video` play
icon, and FB/IG/LI were outline glyphs, not the real logos. Several surfaces
(Settings cards, publish modal, calendar chips) showed no logo at all (letter
avatars / colored dots).

- **New dependency:** `react-icons` (Simple Icons set) in `frontend/package.json`.
  **You must `npm install` first** — `react-icons` is not in `node_modules` yet,
  so the build fails until you do, and `package-lock.json` needs reconciling
  (commit the updated lock).
- **Central swap:** `app/lib/platforms.js` now maps each platform to
  `SiFacebook / SiInstagram / SiTiktok / SiLinkedin`. This propagates real logos
  to every consumer of `PLATFORMS`/`PLATFORM_MAP` (CreationEditor toggles + pills
  + preview tabs + header, PostEditorPopup, AutomationView).
- **No-logo surfaces now show the real logo:**
  - `SettingsView.js` (CartePlateforme) — the F/I/T/L letter avatar is now the
    brand logo on the colored tile.
  - `PublishConfirmModal.js` — the colored dot per target is now the brand logo.
  - `CalendarView.js` (PostChip) — the chip now shows the primary platform's logo
    next to the status dot.
- **Claude verified (VM):** edits balanced, no leftover lucide brand imports,
  dependency added. **NOT verified:** `npm install` / `npm run build` / render —
  your job. Check TikTok especially (the one that had no real logo before).

## 0. Pull + bring up

```bash
git checkout workspaces-rbac && git pull
docker compose -f infra/docker-compose.yml up -d --build caption-api   # picks up backend + env
cd frontend && npm install && npm run build      # THE check Claude can't do
npm run dev                                       # or run the full stack
```

`infra/.env` already has `ZERNIO_API_KEY` (sk_… 67 chars) + `ZERNIO_API_BASE_URL`.
Recreate the container (`up -d`) so it's loaded — confirmed live earlier
(`zernio_key_present: True`).

## 1. Backend test suite (should be ~97 passing)

```bash
docker compose -f infra/docker-compose.yml exec -T caption-api python -m pytest tests/ -q
```
Previously 92. New: **5 deletion tests** in `tests/test_workspaces_rbac.py`
(`test_owner_deletes_workspace`, `test_member_leaves_workspace`,
`test_delete_own_account`, `test_delete_owner_transfers_ownership`,
`test_admin_deletes_member_account`) + the 9 Zernio unit tests
(`tests/test_zernio.py`). Expect ≈97 + 9 = passing; if a deletion test fails it
points at real logic to fix.

## 2. What shipped, and how to test each

### A. OAuth connections workspace-isolation fix — `0e94ebf`  (was the "holy" bug)
The connections cache was global; switching workspaces showed the previous
one's connected accounts. **Test:** be a member of two workspaces, connect a
social account in WS-A, switch to WS-B → WS-B must NOT show WS-A's accounts in
Settings/compose. Switch back → WS-A's reappear. (Backend was always safe; this
was a frontend cache key fix.)

### B. Zernio integration — `0c9d06a` (backend) · `ebd0e2a` (settings UI) · `3cf9d71` (publish)
Unified social API as an **optional, per-workspace** provider alongside the
direct OAuth/publish.
- **Settings → Platforms**: a distinct "Zernio — unified" card (vs "Direct
  connections"), masked key field, "?" help, per-network connect buttons.
- **Connect**: click a network → Zernio's hosted authorize popup. Its callback
  is on Zernio's domain (no postMessage back), so on popup-close the UI
  refetches `/oauth/connections` to surface the linked account. **Verified
  live:** `GET /oauth/zernio/instagram/start` returns a real authorize_url.
- **NOT yet verified:** an actual publish through Zernio — needs you to finish
  the external connect so a Zernio account target exists, then publish a post
  with that target. Backend route: `provider:"zernio"` targets → `POST /posts`
  on Zernio (one call per distinct media set, presign+upload for media).
- **Test:** set key (env already done, or per-workspace in the card) → connect
  a network via the card → it appears under "Connected accounts" → compose a
  post, pick that account, publish → confirm it lands on the network.

### C. CEO quick wins — `b153603`
- Sidebar: "NEW" badges removed from Automation + Videos.
- "Media Library" → **"Library"** (en) / "Médiathèque" → **"Bibliothèque"** (fr) everywhere.
- Library: **Brand Kit (charte graphique) tab removed** (it stays in Settings).
- Calendar: the day **"+" now opens Create** (not the old inline quick-create).

### D. Create wizard — `cbe51e3`  (CEO #7, #8)
- **Media step**: "Pick from library" button → picker modal (multi-select from
  existing media) in addition to upload. **Test:** open Create → Media → Pick
  from library → select items → they're added as ready media.
- **Scheduling step = calendar only**: the "Schedule…" modal now shows just the
  calendar + time (no redundant content/media/platform re-editor).

### E. Deletion — `f8da295` (backend) · `2995b91` + `f79ad51` (UI)  (CEO #14)
All four, RBAC-gated:
- **Settings → Danger zone**: Leave workspace (non-owner), Delete workspace
  (owner), Delete my account (everyone). Each `confirm()`s.
- **Members view**: per-row "delete account" (UserDelete icon) for admins
  (members.manage), blocked for self + the owner.
- Ownership transfer: deleting an owner with co-members hands the workspace to
  the earliest other member (covered by `test_delete_owner_transfers_ownership`).
- **Test carefully (destructive):** use throwaway accounts. Verify leave →
  no longer in members; delete workspace → data gone, owner bounced to
  no-workspace; delete account → logged out; admin-delete-member → account gone.

### F. Calendar filters — `c2ff24b`  (CEO #10a)
Platform + Status **chips → dropdown multi-selects**. **Test:** select/clear
platforms + statuses in the two dropdowns; the calendar grid filters live.

### G. Telegram guide — `480ceb0`  (CEO #5)
Settings → Telegram leads with a 3-step connect explanation.

### H. Drafts — `480ceb0`  (CEO #9)
- **Save draft** now persists (POST /posts status=draft) — not just a local flag.
- **Library → Drafts tab** lists draft posts with **Edit** (loads it back into
  the editor) and **Delete**. **Test:** Create a post → Save draft → Library →
  Drafts → it's there → Edit reopens it in Create; Delete removes it.
  *v1 limit:* editing a draft + re-saving makes a NEW draft (no in-place update).

### I. (from earlier) AI error surfacing — `4dd31ff` (your commit, merged)
`upstream_error` now flows to the UI on AI failures (e.g. OpenRouter 402).

## 3. CEO list status
Done: #2, #3, #5, **#6**, #7, #8, #9, #10a, #10b, #11, #12, #14.
**#4** (API keys "by tabs/themes") — **largely already in place**: Settings has
tabs (Platforms / Timezone / AI keys / Telegram / Brand kit / Danger) and the AI
keys are grouped by theme (LLM / Image / Video / Telegram). Optional polish only.

**#6 AI Image/Vidéo views — DONE** (`ee58e31`): new **Image IA** studio view +
the **AI Video** view moved up so both sit under Creation in the sidebar (Video
component unchanged). Test: sidebar → Image IA → prompt + ratio → Generate →
image appears, "saved to Library", "Use in a post" drops it into the editor.

**Phase 3 — Zernio in the scheduler/automation — IMPLEMENTED as a FALLBACK:**
`build_targets_from_post` now adds a Zernio target for any
enabled platform that has NO direct connection (so no double-posting), and
`publish_to_targets` routes `provider:"zernio"` targets through `zernio.publish`.
The direct path is untouched; the branch is additive + guarded (a Zernio error
can't break direct resolution). **NEEDS A LIVE TEST not runnable on the VM:**
in a workspace whose platform is connected ONLY via Zernio, schedule a post →
confirm the scheduler fires it through Zernio. The direct scheduler path is
covered by existing tests (unchanged); the Zernio fallback has no automated test.

**#1 reels icon — DONE** (`61d0bd6`): the ratio picker shows a Reels (film) icon
on the 9:16 vertical option (the Reels/Stories/Shorts format) across all
platforms.
**#13 (clean design) — IN PROGRESS.** Clean-design pass on the scheduled-post
editors:
- `0045e8c` — ScheduleModal slimmed to a calendar + time dialog (580→105 lines;
  the old re-editor branch was dead code). Test: Create → "Schedule…" shows just
  a calendar + time.
- `d5fbfa6` — PostEditorPopup (click a calendar post) dropped its redundant
  "AI Image / AI Video" generation block (-100 lines; generation lives in the
  dedicated Image IA / Vidéo IA views). Test: the edit popup is lean — content,
  media upload/swap, platforms, ratios, schedule, status, preview; no AI-gen
  buttons. Core editing unchanged.
Broad cosmetic icon cleanup across the other views remains the teammate's visual
pass. No functional work outstanding.

## 4. What Claude verified on the VM (and what it did NOT)
Verified: backend `compileall`, `test_zernio.py` smoke logic, every edited
file's JSON validity + brace/bracket/fragment balance + import/export
consistency, no orphaned refs. **Not** verified: any `npm run build`, any
render-time behaviour, the live Zernio publish, the DB-backed deletion tests
(need MariaDB — run them on the PC/CI).

## 5. Reporting back
For each item: ✅ works / ⚠️ works with notes / ❌ broken + the error. Send
broken ones back to Claude with the build/console output and it'll fix, then
the teammate takes the visual polish pass.
