# CEO checklist — status (branch `workspaces-rbac`)

The CEO's request list, **quoted verbatim**, with: possible interpretations →
what shipped (commit) → what's left (subjective). Pair with
[`GPT-HANDOFF.md`](GPT-HANDOFF.md) (how to build/test) and
[`TEST_REPORT.md`](TEST_REPORT.md) (GPT's results: frontend build clean, backend
98 passed).

Legend: ✅ done · 🟡 partial / subjective remainder · ⬜ not built (subjective).

---

### ✅ 1. "Icone reels pour les reseaux sociaux."
- **Done** (`61d0bd6`): Reels (film) icon on the **9:16** option in the ratio
  picker (the Reels/Stories/Shorts format) across all platforms.
- **Subjective:** placement — could instead be a dedicated "Reels" post-type
  toggle or a badge on the platform cards.

### ✅ 2. "retirer NEW de automatisation."
- **Done** (`b153603`): removed the "NEW" badge from Automation (and Videos).

### ✅ 3. "dans les parametre > plateformes bien differencier connexion zernio/autres du reste et indique le process via un icone \"?\" pour changer clé etc."
- **Done** (`ebd0e2a`): Settings → Platforms split into **"Direct connections"**
  vs a distinct **"Zernio — unified"** card with a masked key field, per-network
  connect, and a **"?" popover** explaining the flow + key rotation.
- **Subjective:** styling of the differentiation / help-copy depth.

### 🟡 4. "parametre > clé API mieux organiser par onglets et thèmes."
- **Largely already in place:** Settings has tabs (Platforms / Timezone / AI keys
  / Telegram / Brand kit / Danger) and the AI-keys tab is grouped by theme
  (LLM / Image / Video / Telegram).
- **Left (subjective):** the **one item with no new code** — restructuring the
  API-keys tab into sub-tabs/sections that mirror the CRM screenshot exactly.

### ✅ 5. "parametre > telegram explication avec process pour se connecter."
- **Done** (`480ceb0`): a 3-step "how to connect" panel (start the bot + /start,
  get your chat id, paste + Pair).

### 🟡 6. "Sur la barre latéarale en dessous de \"creer un post\" : tu vas un onglet VIDEOS IA, et un onglet IMAGE IA et cela permettra de creer du contenu qui sera enrigistrer dans la bibliotheque de contenu."
- **Done** (`ee58e31`): new **Image IA** studio + **AI Video** moved up under
  Creation; generated media writes to the content dir → shows in the Library.
- **Left (subjective):** the Vidéo IA view is the existing job-queue view
  (functional, not re-skinned as a polished studio); "saved to Library" wired
  but not yet live-clicked.

### ✅ 7. "Dans le process de creation de post : pouvoir soit téléverser soit chercher directement depuis ma bibliothèque via une popup."
- **Done** (`cbe51e3`): media step has a **"Pick from library"** button →
  multi-select picker modal, alongside upload.

### 🟡 8. "Dans la creation du post > la derniere de planification doit uniquement avoir un calendrier."
- **Done** (`cbe51e3` → `0045e8c`): schedule dialog is now **calendar + time
  only** (ScheduleModal 580→105 lines; old re-editor removed).
- **Left (subjective):** "uniquement un calendrier" could mean **date only** —
  the time picker was kept (scheduling needs a fire time).

### 🟡 9. "Creer une section \"brouillons\" dans la bibliotheque de contenu."
- **Done** (`480ceb0`): Save-draft now **persists** (it didn't before); Library
  has a **Drafts** tab with Edit/Delete.
- **Left (subjective):** editing a draft then re-saving creates a *new* draft
  (no in-place update yet).

### ✅ 10. "Dans calendrier il faut changer design pour PLATEFORME et STATUT et plutot faire des filtres déroulants // quand on clique sur ajouter un post on arrive sur \"creer un post\"."
- **Done:** chips → **dropdown multi-select filters** (`c2ff24b`); the day "+"
  now **opens Create** (`b153603`).

### ✅ 11. "Mediatheque changer en Bibliotheque."
- **Done** (`b153603`): "Médiathèque" → **"Bibliothèque"** (fr) / "Media Library"
  → "Library" (en) everywhere.

### ✅ 12. "Dans bibliothèque > retirer charte graphique."
- **Done** (`b153603`): removed the **Brand Kit** tab from the Library (it still
  lives in Settings).

### 🟡 13. "Eviter icone inutile pour etre plus clean et moins lourd dans le design."
- **Done** (`0045e8c`, `d5fbfa6`): clean-design pass on the **scheduled-post
  editors** — ScheduleModal slimmed; PostEditorPopup's redundant AI-media-gen
  block removed.
- **Left (subjective — the big open one):** a broad "remove useless icons /
  lighter design" sweep across the *other* views (dashboard, sidebar, cards…) is
  a visual-judgment pass — best for the teammate, or point at specific screens.

### ✅ 14. "parametre il faut checker quoi ajouter (suppress account, suppress user etc) et la section et acces à mettre dans les paramètres."
- **Done** (`f8da295` backend + `2995b91`/`f79ad51` UI): all four — Settings
  **"Danger zone"** (delete account / delete workspace / leave) + Members
  **"delete account"** for admins, with ownership-transfer + 5 tests.
- **Subjective:** exact placement/labels; finer-grained access controls.

---

## Also delivered (beyond the bullet list)
- **Zernio** unified-API integration — backend, Settings UI, manual publish, and
  scheduler/automation fallback (`0c9d06a`, `ebd0e2a`, `3cf9d71`, `0d38503`;
  hardened by GPT in `77eb2a3`).
- **OAuth connections workspace-isolation fix** (`0e94ebf`).

## Subjective "could-do, not done" roundup
1. **#13** broad icon/clutter cleanup across the other views (main open pass).
2. **#4** restructure API-keys tab to mirror the CRM screenshot.
3. **#6** re-skin Vidéo IA as a polished studio.
4. **#8** date-only vs calendar+time.
5. **#9** in-place draft update.
6. **#1** confirm reels-icon placement matches intent.

## Only closable on the PC / GPT side
- Frontend **visual click-test** (build is green; in-app clickthrough pending).
- A **live publish through Zernio** (needs a connected Zernio account).
