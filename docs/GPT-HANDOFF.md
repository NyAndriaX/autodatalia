# Handoff to GPT — `workspaces-rbac` test & verify guide

This branch got a large batch of work from Claude (on the VM). Claude can only
do **light checks** on the VM (Python compile, JSON validity, brace/ref
balance) — it **cannot run a Next.js build or the live app**. That's your job
on the PC. This guide is the test plan.

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
