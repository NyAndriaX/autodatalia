# Architecture & Plan Technique — DATALIA Marketing Automation

> ⚠️ **Document historique — roadmap d'origine, ne reflète plus l'état actuel.**
> Ce plan décrit l'architecture cible initialement prévue (n8n comme orchestrateur,
> Airtable comme base de données, validation Telegram, génération vidéo via ComfyUI).
> Plusieurs de ces choix ont évolué pendant l'implémentation :
> n8n a été retiré (appels backend directs), Airtable remplacé par stockage JSON,
> Telegram et ComfyUI non démarrés. Pour l'état réel du projet, voir le
> [`README.md`](../README.md) à la racine et les rapports de progression dans
> [`docs/`](../docs/).
>
> **Durée totale :** ~18 jours (144h)
> **Version :** v1.3 — Mai 2026
> **Statut d'origine :** 🚧 En cours — Jours 1-2 complétés (Dashboard UI complet, Backend IA fonctionnel, Infra Docker)

---

## 0. Avancement actuel (au 21 mai 2026)

| Jour | Date | Livraisons principales |
|---|---|---|
| **Jour 1** | 2026-05-18 | Squelette dashboard (Sidebar + Topbar), vue Création (éditeur + aperçu multi-plateformes), thème light/dark |
| **Jour 2** | 2026-05-20 | Vue Calendrier (mois/sem + drag-drop), branchement IA réelle (`/generate` + `/transform` + cache 98→0 tokens), Médiathèque, Paramètres, design mobile, jeton d'auth optionnel, stack Docker, CI (14 + 19 tests) |

**État global** : ~47h / 143.5h livrées (~33%). Frontend complet sur les vues Création, Calendrier, Médiathèque, Paramètres. Backend IA fonctionnel avec mise en cache. Reste à câbler la validation Telegram, les OAuth plateformes, la persistance Airtable et la génération vidéo IA.

**Légende des statuts dans les tableaux ci-dessous** :
- ✅ Terminé — livré et testé
- 🟡 Partiel — démarré, fonctionnel mais incomplet vs spec
- 🔴 Non débuté

---

## 1. Stack Technique

| Couche | Technologie | Rôle |
|---|---|---|
| **Orchestration** | n8n (Docker, self-hosted) | API gateway central, CRON, webhooks, workflows de publication & validation |
| **Logique métier & IA** | Python (FastAPI, Dockerized) | LLM Router, génération de contenu, reformulation, hashtags, resize images |
| **Base de données & Back-Office** | Airtable | Tables relationnelles (Posts, Users, Templates, Médias, Logs) |
| **Front-End Dashboard** | Next.js 16 (App Router) + React 19 + Redux Toolkit + Tailwind v4 | UI personnalisée (calendrier, éditeur, suivi KPIs) connectée à l'API/Airtable |
| **Validation humaine** | Bot Telegram (BotFather) | Validation/refus/modification via boutons inline, programmation |
| **Génération Vidéo IA** | ComfyUI (LTX 2.3) | Génération vidéo sur GPU cloud, soumission async & intégration Telegram |
| **Infra** | Docker Compose + Reverse Proxy | Déploiement n8n + FastAPI + Front-end, SSL, domaine |

### LLM Router — Stratégie de coûts

| Complexité | Modèle | Usage |
|---|---|---|
| Simple (hashtags, formatting) | Groq / Gemini Flash | Coût minimal, < 2s |
| Complexe (copywriting, variantes) | GPT-4o / Claude 3.5 | Qualité premium |
| Logging | Airtable `Token_Logs` | Chaque requête logge tokens/coût pour le dashboard analytics |

> ⚠ **Aujourd'hui** : un seul modèle est utilisé (configurable via `AI_MODEL`, par défaut `google/gemini-2.0-flash-lite-001` sur OpenRouter). Le routage multi-modèles est planifié (CR-T03). Une mise en cache transparente neutralise les appels identiques (vérifié : 98 → 0 tokens).

---

## 2. Plan de Réalisation — ~18 Jours (144h)

### ✍ Création de Contenu — 18h

| ID | Tâche | Heures | Statut |
|---|---|---|---|
| CR-T01 | Modélisation Airtable : tables Posts, Drafts, Versions | 2h | 🔴 (persistance locale JSON aujourd'hui) |
| CR-T02 | API Python : endpoint génération texte IA (prompt → LLM Router) | 4.5h | ✅ Jour 2 (`/generate`, `/captions/generate`, `/transform`) |
| CR-T03 | Intégration multi-modèles (Groq/Gemini Flash + GPT-4o fallback) | 2.5h | 🟡 (un modèle via OpenRouter, routage à faire) |
| CR-T04 | Logique adaptation multi-plateformes (limites car., format) | 2h | ✅ Jour 1 (compteurs par réseau côté UI) |
| CR-T05 | Endpoint génération 3 variantes + reformulation IA | 2h | 🟡 (reformulation OK via `/transform`, 3 variantes à faire) |
| CR-T06 | Workflow n8n : création → brouillon → soumission validation | 2.5h | 🔴 (template `webhook-template.json` fourni, pas câblé) |
| CR-T07 | Sauvegarde auto brouillons + versionning Airtable | 1.5h | 🟡 (persistance serveur basique, versionning Airtable à faire) |
| CR-T08 | Vérificateur conformité (longueur, hashtags, dimensions) | 1.5h | 🟡 (compteurs car./hashtags temps réel, contrôle dims à faire) |

### 🎨 Templates & Brand Kit — 7h

| ID | Tâche | Heures | Statut |
|---|---|---|---|
| TP-T01 | Modélisation Airtable : tables Templates, BrandKit, Personas | 1.5h | 🔴 |
| TP-T02 | CRUD templates dans Airtable + variables dynamiques | 2h | 🟡 (mode "From Template" UI, pas de CRUD Airtable) |
| TP-T03 | Brand Kit : stockage palette/polices/logos, application auto | 1.5h | 🟡 (Settings UI persistée, application auto à faire) |
| TP-T04 | Personas/tons de voix : CRUD + injection dans prompts IA | 1h | 🔴 |
| TP-T05 | Catégorisation, recherche et filtrage des templates | 1h | 🔴 |

### 💬 Validation Telegram — 21h

| ID | Tâche | Heures | Statut |
|---|---|---|---|
| TG-T01 | Création et configuration du bot Telegram (BotFather) | 1h | 🔴 (bloqué client INF-T07) |
| TG-T02 | Workflow n8n : envoi auto du contenu à valider via bot | 3h | 🔴 (recette HTTP Request documentée dans `n8n/README.md`) |
| TG-T03 | Boutons inline (Valider / Refuser / Modifier / Programmer) | 3.5h | 🔴 |
| TG-T04 | Workflow Validé : maj statut Airtable + mise en file | 2h | 🔴 |
| TG-T05 | Workflow Refusé : notification créateur + commentaire | 1.5h | 🔴 |
| TG-T06 | Workflow Modification : boucle feedback → ré-génération IA | 3.5h | 🔴 |
| TG-T07 | Programmation date/heure depuis Telegram (/schedule) | 2h | 🔴 |
| TG-T08 | Notification publication réussie/échouée + sécurité bot | 2h | 🟡 (indicateur de présence Topbar via `/health` 3 états) |
| TG-T09 | Commandes utiles (/start, /pending, /next, /stats, /help) | 2h | 🔴 |

### 📅 Calendrier & Drag-Drop — 7h

| ID | Tâche | Heures | Statut |
|---|---|---|---|
| CL-T01 | Vue calendrier (mensuelle + hebdo) | 3h | ✅ Jour 2 |
| CL-T02 | Code couleur par plateforme + filtres multi-critères | 1.5h | ✅ Jour 2 |
| CL-T03 | Logique de reprogrammation (drag-drop / édition) | 1.5h | ✅ Jour 2 |
| CL-T04 | Création rapide depuis slot vide + annulation programmation | 1h | ✅ Jour 2 (choix upload ou génération IA) |

### 🚀 Posting & Publication — 11h

| ID | Tâche | Heures | Statut |
|---|---|---|---|
| PO-T01 | Workflow n8n : publication immédiate vers APIs plateformes | 3h | 🟡 (recettes natives Graph API/LinkedIn/TikTok documentées, pas câblées) |
| PO-T02 | Workflow n8n : CRON programmation à date/heure précise | 3h | 🔴 |
| PO-T03 | File d'attente (queue) : vue Airtable + logique traitement | 1.5h | 🔴 |
| PO-T04 | Suivi temps réel statut + retry backoff exponentiel (×3) | 2h | 🔴 |
| PO-T05 | Logs publication Airtable + fallback échec + notification | 1.5h | 🔴 |

### 🔌 Plateformes Connectées — 17h

| ID | Tâche | Heures | Statut |
|---|---|---|---|
| PL-T01 | Intégration OAuth Facebook Pages (Meta API) | 3h | 🔴 (bloqué client INF-T06) |
| PL-T02 | Intégration OAuth Instagram Business (Meta API) | 3h | 🔴 (bloqué client INF-T06) |
| PL-T03 | Intégration OAuth TikTok Business API | 4h | 🔴 (bloqué client INF-T06) |
| PL-T04 | Intégration OAuth LinkedIn (Pages + Profils) | 3h | 🔴 (bloqué client INF-T06) |
| PL-T05 | Multi-comptes Airtable + refresh auto tokens (n8n) | 2h | 🔴 |
| PL-T06 | Limites/règles par plateforme + resize auto images | 2h | 🟡 (limites car. côté UI, resize images à faire) |

### 🖼 Médias & Hashtags — 6.5h

| ID | Tâche | Heures | Statut |
|---|---|---|---|
| ME-T01 | Modélisation Airtable : tables Médias, Hashtag Banks | 1h | 🔴 |
| ME-T02 | Upload multi-fichiers + compression auto (Python) | 2h | 🟡 (upload `/upload` + drag-drop OK, compression auto à faire) |
| ME-T03 | Endpoint génération image IA (DALL-E / Stable Diffusion) | 1.5h | 🔴 |
| HT-T01 | Suggestions hashtags IA contextuelles + banques réutilisables | 1.5h | 🔴 |
| HT-T02 | Compteur hashtags temps réel par plateforme | 0.5h | ✅ Jour 1 |

### 👥 Utilisateurs & Workflow — 7h

| ID | Tâche | Heures | Statut |
|---|---|---|---|
| US-T01 | Modélisation Airtable : tables Users, Rôles, Permissions | 1.5h | 🔴 |
| US-T02 | Invitation email + système de rôles (5 niveaux) | 2.5h | 🔴 |
| US-T03 | Workflow validation personnalisable (qui crée → qui valide) | 1.5h | 🔴 |
| US-T04 | Profil utilisateur + pairing Telegram + audit log | 1.5h | 🟡 (Settings UI pairing Chat ID, pairing réel à faire) |

### 📊 Analytics & Config — 6.5h

| ID | Tâche | Heures | Statut |
|---|---|---|---|
| AN-T01 | Dashboard : KPIs globaux 30j | 1.5h | 🔴 |
| AN-T02 | Token/Cost Analytics : logging usage LLM | 1.5h | 🟡 (compteur tokens visible vue Analytique, logging Airtable à faire) |
| CG-T01 | Config clés API IA + comptes sociaux OAuth + bot Telegram | 2h | 🟡 (UI Paramètres persistée, OAuth pas câblé) |
| CG-T02 | Auth utilisateur + 2FA (JWT sessions) | 1.5h | 🟡 (jeton d'auth optionnel sur endpoints sensibles, pas de 2FA) |

### 🎨 Front-End Dashboard — 21h

| ID | Tâche | Heures | Statut |
|---|---|---|---|
| FE-T01 | Maquette UI/UX dashboard (wireframes) | 3h | ✅ Jour 1 |
| FE-T02 | Interface création de post (éditeur + aperçu) | 4h | ✅ Jour 1 |
| FE-T03 | Interface calendrier (vue mois/semaine + drag) | 3.5h | ✅ Jour 2 |
| FE-T04 | Interface validation (miroir Telegram) | 2h | 🔴 |
| FE-T05 | Interface bibliothèque médias + upload | 2.5h | ✅ Jour 2 |
| FE-T06 | Interface analytics + graphiques KPIs | 2.5h | 🟡 (compteur tokens, charts Recharts à faire) |
| FE-T07 | Interface settings (comptes, API, brand kit) | 2h | ✅ Jour 2 |
| FE-T08 | Navigation, routing, responsive design | 2h | ✅ Jours 1-2 (drawer mobile + recherche plein écran Jour 2) |

### 🎬 Intégration Vidéo IA — 10h

| ID | Tâche | Heures | Statut |
|---|---|---|---|
| VD-T01 | Setup ComfyUI + LTX 2.3 sur GPU cloud | 3h | 🔴 |
| VD-T02 | API Python : endpoint génération vidéo (prompt → ComfyUI) | 3h | 🔴 |
| VD-T03 | Workflow n8n : soumission async + polling résultat | 2h | 🔴 |
| VD-T04 | Intégration résultat vidéo dans flux Telegram | 2h | 🔴 |

### 🛠 Infra, Déploiement & Accès Client — 11h + prérequis client

| ID | Tâche | Heures | Statut |
|---|---|---|---|
| INF-T01 | Docker Compose : n8n + Python API + reverse proxy | 2h | ✅ Jour 2 (n8n + caption-api ; reverse proxy à ajouter en prod) |
| INF-T02 | Configuration domaine + SSL (Let's Encrypt) | 1h | 🔴 |
| INF-T03 | Déploiement production serveur (VPS/Cloud) | 2h | 🔴 (bloqué client INF-T10) |
| INF-T04 | Tests intégration end-to-end (création → publication) | 4h | 🟡 (CI active, 14 backend + 19 frontend tests unitaires ; E2E publication à faire) |
| INF-T05 | Documentation technique & guide utilisateur | 2h | ✅ Jour 2 (READMEs racine/frontend/backend/infra/n8n + docs/) |
| **INF-T06** | **⚠ CLIENT : Fournir accès pages Facebook + comptes sociaux** | — | 🔴 |
| **INF-T07** | **⚠ CLIENT : Fournir token bot Telegram (BotFather)** | — | 🔴 |
| **INF-T08** | **⚠ CLIENT : Fournir clés API IA (OpenAI, etc.)** | — | 🔴 |
| **INF-T09** | **⚠ CLIENT : Valider charte graphique / brand kit** | — | 🔴 |
| **INF-T10** | **⚠ CLIENT : Accès au serveur / VPS de production** | — | 🔴 |

### 🆕 Livré hors plan initial (bonus Jours 1-2)

Éléments non prévus dans le plan v1.0 mais livrés pendant les Jours 1-2 :

| ID | Tâche | Heures | Statut |
|---|---|---|---|
| EX-T01 | Cache IA agressif : appel identique → 0 token (98→0 vérifié) | 1.5h | ✅ Jour 2 |
| EX-T02 | Pipeline CI : 33 tests automatisés exécutés à chaque commit | 2h | ✅ Jour 2 |
| EX-T03 | Tunnel Cloudflare on-demand (off par défaut, activable publication) | 1h | ✅ Jour 2 |
| EX-T04 | Aperçu multi-plateforme avec ratios spécifiques (1:1, 9:16…) | 1h | ✅ Jour 1 |

### Récapitulatif des heures

| Module | Heures planifiées | Livré (Jours 1-2) |
|---|---|---|
| Création de Contenu | 18h | ~7h ✅+🟡 |
| Templates & Brand Kit | 7h | ~1.5h 🟡 |
| Validation Telegram | 21h | ~1h 🟡 (indicateur seulement) |
| Calendrier & Drag-Drop | 7h | 7h ✅ |
| Posting & Publication | 11h | ~1h 🟡 (recettes documentées) |
| Plateformes Connectées | 17h | ~0.5h 🟡 (limites UI) |
| Médias & Hashtags | 6.5h | ~2h ✅+🟡 |
| Utilisateurs & Workflow | 7h | ~0.5h 🟡 |
| Analytics & Config | 6.5h | ~2h 🟡 |
| Front-End Dashboard | 21h | ~17h ✅ (sauf miroir Telegram + charts) |
| Intégration Vidéo IA | 10h | 0h 🔴 |
| Infra & Déploiement | 11h | ~6h ✅+🟡 |
| **Sous-total plan** | **143h** | **~46h (≈32%)** |
| Bonus hors plan | — | ~5.5h ✅ |
| **Total livré** | — | **~51.5h** |

---

## 3. Workflows Clés

### A. Création → Validation → Publication

```
[Utilisateur]          [n8n]              [Python API]         [Telegram]          [Plateforme]
     |                   |                     |                   |                    |
     |── Crée post ─────>|                     |                   |                    |
     |                   |── Prompt ──────────>|                   |                    |
     |                   |                     |── LLM Router ──>  |                    |
     |                   |                     |<── 3 variantes ── |                    |
     |                   |── Envoie draft ────────────────────────>|                    |
     |                   |                     |                   |── [✅ ❌ ✏️ 📅] ──>|
     |                   |<── Callback (approve/reject/edit) ─────|                    |
     |                   |                     |                   |                    |
     |              [Si ✅]── Publie ─────────────────────────────────────────────────>|
     |              [Si ✏️]── Feedback ───────>|── Régénère ──────>|                    |
     |              [Si ❌]── Notifie créateur  |                   |                    |
```

### B. LLM Router — Routage par complexité

```
                    ┌─────────────────┐
  Requête ────────> │  Python FastAPI  │
                    │   LLM Router     │
                    └────────┬────────┘
                             │
              ┌──────────────┼──────────────┐
              ▼              ▼              ▼
     ┌──────────────┐ ┌────────────┐ ┌────────────┐
     │ Groq / Gemini│ │  GPT-4o    │ │ DALL-E /   │
     │    Flash     │ │  Claude    │ │ Stability  │
     │  (simple)    │ │ (complexe) │ │  (images)  │
     └──────┬───────┘ └─────┬──────┘ └─────┬──────┘
            │               │              │
            └───────────────┼──────────────┘
                            ▼
                   Airtable Token_Logs
                   (tokens, coût, modèle)
```

### C. Publication automatisée & gestion d'erreurs

1. **CRON n8n** vérifie Airtable toutes les minutes pour les posts `Ready to Publish` dont l'heure est atteinte.
2. Envoi vers l'API de la plateforme cible (Meta, TikTok, LinkedIn).
3. **Retry** : en cas d'échec (rate limit, panne API), backoff exponentiel × 3 tentatives.
4. **Fallback** : si échec définitif → statut `Échec` dans Airtable + notification Telegram à l'équipe.
5. **Succès** : statut `Publié` + lien direct envoyé via Telegram.

---

## 4. Modèle de Données (Airtable)

| Table | Champs clés | Relations |
|---|---|---|
| `Posts` | id, contenu, plateforme, statut, date_programmée, créateur | → Templates, Médias, Users |
| `Drafts` | id, post_id, version, contenu, feedback | → Posts |
| `Templates` | id, nom, catégorie, variables, plateforme | → BrandKit |
| `BrandKit` | id, logo, palette, polices, voix_marque | — |
| `Personas` | id, nom, ton, vocabulaire, longueur_préférée | — |
| `Médias` | id, fichier, type, tags, collection | → Posts |
| `Hashtag_Banks` | id, nom, hashtags[], plateforme | — |
| `Users` | id, nom, email, rôle, telegram_chat_id | → Posts |
| `Token_Logs` | id, modèle, tokens_in, tokens_out, coût, date | → Posts |
| `Publish_Logs` | id, post_id, plateforme, statut, code_retour, date | → Posts |
| `Comptes_Sociaux` | id, plateforme, oauth_token, refresh_token, expiry | → Users |

> ⚠ **Aujourd'hui** : la persistance des posts planifiés se fait dans un fichier local côté serveur backend (avec repli local automatique côté frontend). La migration vers Airtable est planifiée (CR-T01, ME-T01, US-T01, etc.).

---

## 5. Infrastructure de Déploiement

```
┌─────────────────────────────────────────────┐
│              VPS / Cloud Server             │
│                                             │
│  ┌─────────────┐    ┌──────────────────┐   │
│  │    n8n       │    │  Python FastAPI   │   │
│  │  (port 5678) │◄──►│  (port 8000)     │   │
│  │  Workflows   │    │  LLM Router      │   │
│  │  CRON Jobs   │    │  Image Resize    │   │
│  └──────┬───────┘    └────────┬─────────┘   │
│         │                     │             │
│         ▼                     ▼             │
│  ┌──────────────────────────────────────┐   │
│  │           Front-End (React/Vue)      │   │
│  │         Reverse Proxy (Caddy/Nginx)  │   │
│  │         SSL (Let's Encrypt)          │   │
│  └──────────────────────────────────────┘   │
└─────────────────────┬───────────────────────┘
                      │
        ┌─────────────┼─────────────┐
        ▼             ▼             ▼
   ┌─────────┐  ┌──────────┐  ┌──────────┐
   │ Airtable│  │ Telegram │  │ APIs     │
   │  (DB)   │  │  Bot     │  │ Sociales │
   └─────────┘  └──────────┘  └──────────┘
```

> ✅ **Aujourd'hui** : `infra/docker-compose.yml` lance n8n (`:5678`) + caption-api (`:8000`) en une commande. Reverse proxy + SSL + déploiement VPS restent à faire (INF-T02, INF-T03).

---

## 6. Prérequis Client (Bloquants)

Ces éléments doivent être fournis **avant la suite** pour ne pas impacter le planning restant :

| # | Prérequis | Impact si absent | Statut |
|---|---|---|---|
| 1 | Accès aux pages Facebook + comptes sociaux (admin) | Bloque toute intégration plateforme (17h) | 🔴 |
| 2 | Création du bot Telegram via BotFather + token | Bloque le module validation (21h) | 🔴 |
| 3 | Clés API IA (OpenAI, Anthropic, ou alternatives) | Permet de basculer sur LLM Router multi-modèles | 🟡 (clé OpenRouter générique fournie pour les Jours 1-2) |
| 4 | Charte graphique validée (logo, couleurs, polices) | Bloque le Brand Kit (7h) | 🔴 |
| 5 | Accès au serveur / VPS de production | Bloque le déploiement final (11h) | 🔴 |
