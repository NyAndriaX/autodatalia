# Architecture & Plan Technique — DATALIA Marketing Automation

> **Durée totale :** ~18 jours (144h)  
> **Version :** v1.2 — Mai 2026  
> **Statut :** 🚧 En cours — Jour 1 complété (Dashboard UI)

---

## 1. Stack Technique

| Couche | Technologie | Rôle |
|---|---|---|
| **Orchestration** | n8n (Docker, self-hosted) | API gateway central, CRON, webhooks, workflows de publication & validation |
| **Logique métier & IA** | Python (FastAPI, Dockerized) | LLM Router, génération de contenu, reformulation, hashtags, resize images |
| **Base de données & Back-Office** | Airtable | Tables relationnelles (Posts, Users, Templates, Médias, Logs) |
| **Front-End Dashboard** | React / Vue.js | UI personnalisée (calendrier, éditeur, suivi KPIs) connectée à l'API/Airtable |
| **Validation humaine** | Bot Telegram (BotFather) | Validation/refus/modification via boutons inline, programmation |
| **Génération Vidéo IA** | ComfyUI (LTX 2.3) | Génération vidéo sur GPU cloud, soumission async & intégration Telegram |
| **Infra** | Docker Compose + Reverse Proxy | Déploiement n8n + FastAPI + Front-end, SSL, domaine |

### LLM Router — Stratégie de coûts

| Complexité | Modèle | Usage |
|---|---|---|
| Simple (hashtags, formatting) | Groq / Gemini Flash | Coût minimal, < 2s |
| Complexe (copywriting, variantes) | GPT-4o / Claude 3.5 | Qualité premium |
| Logging | Airtable `Token_Logs` | Chaque requête logge tokens/coût pour le dashboard analytics |

---

## 2. Plan de Réalisation — ~18 Jours (144h)

### ✍ Création de Contenu — 18h

| ID | Tâche | Heures |
|---|---|---|
| CR-T01 | Modélisation Airtable : tables Posts, Drafts, Versions | 2h |
| CR-T02 | API Python : endpoint génération texte IA (prompt → LLM Router) | 4.5h |
| CR-T03 | Intégration multi-modèles (Groq/Gemini Flash + GPT-4o fallback) | 2.5h |
| CR-T04 | Logique adaptation multi-plateformes (limites car., format) | 2h |
| CR-T05 | Endpoint génération 3 variantes + reformulation IA | 2h |
| CR-T06 | Workflow n8n : création → brouillon → soumission validation | 2.5h |
| CR-T07 | Sauvegarde auto brouillons + versionning Airtable | 1.5h |
| CR-T08 | Vérificateur conformité (longueur, hashtags, dimensions) | 1.5h |

### 🎨 Templates & Brand Kit — 7h

| ID | Tâche | Heures |
|---|---|---|
| TP-T01 | Modélisation Airtable : tables Templates, BrandKit, Personas | 1.5h |
| TP-T02 | CRUD templates dans Airtable + variables dynamiques | 2h |
| TP-T03 | Brand Kit : stockage palette/polices/logos, application auto | 1.5h |
| TP-T04 | Personas/tons de voix : CRUD + injection dans prompts IA | 1h |
| TP-T05 | Catégorisation, recherche et filtrage des templates | 1h |

### 💬 Validation Telegram — 21h

| ID | Tâche | Heures |
|---|---|---|
| TG-T01 | Création et configuration du bot Telegram (BotFather) | 1h |
| TG-T02 | Workflow n8n : envoi auto du contenu à valider via bot | 3h |
| TG-T03 | Boutons inline (Valider / Refuser / Modifier / Programmer) | 3.5h |
| TG-T04 | Workflow Validé : maj statut Airtable + mise en file | 2h |
| TG-T05 | Workflow Refusé : notification créateur + commentaire | 1.5h |
| TG-T06 | Workflow Modification : boucle feedback → ré-génération IA | 3.5h |
| TG-T07 | Programmation date/heure depuis Telegram (/schedule) | 2h |
| TG-T08 | Notification publication réussie/échouée + sécurité bot | 2h |
| TG-T09 | Commandes utiles (/start, /pending, /next, /stats, /help) | 2h |

### 📅 Calendrier & Drag-Drop — 7h

| ID | Tâche | Heures |
|---|---|---|
| CL-T01 | Vue calendrier Airtable Interface (mensuelle + hebdo) | 3h |
| CL-T02 | Code couleur par plateforme + filtres multi-critères | 1.5h |
| CL-T03 | Logique de reprogrammation (drag-drop / édition) | 1.5h |
| CL-T04 | Création rapide depuis slot vide + annulation programmation | 1h |

### 🚀 Posting & Publication — 11h

| ID | Tâche | Heures |
|---|---|---|
| PO-T01 | Workflow n8n : publication immédiate vers APIs plateformes | 3h |
| PO-T02 | Workflow n8n : CRON programmation à date/heure précise | 3h |
| PO-T03 | File d'attente (queue) : vue Airtable + logique traitement | 1.5h |
| PO-T04 | Suivi temps réel statut + retry backoff exponentiel (×3) | 2h |
| PO-T05 | Logs publication Airtable + fallback échec + notification | 1.5h |

### 🔌 Plateformes Connectées — 17h

| ID | Tâche | Heures |
|---|---|---|
| PL-T01 | Intégration OAuth Facebook Pages (Meta API) | 3h |
| PL-T02 | Intégration OAuth Instagram Business (Meta API) | 3h |
| PL-T03 | Intégration OAuth TikTok Business API | 4h |
| PL-T04 | Intégration OAuth LinkedIn (Pages + Profils) | 3h |
| PL-T05 | Multi-comptes Airtable + refresh auto tokens (n8n) | 2h |
| PL-T06 | Limites/règles par plateforme + resize auto images | 2h |

### 🖼 Médias & Hashtags — 6.5h

| ID | Tâche | Heures |
|---|---|---|
| ME-T01 | Modélisation Airtable : tables Médias, Hashtag Banks | 1h |
| ME-T02 | Upload multi-fichiers + compression auto (Python) | 2h |
| ME-T03 | Endpoint génération image IA (DALL-E / Stable Diffusion) | 1.5h |
| HT-T01 | Suggestions hashtags IA contextuelles + banques réutilisables | 1.5h |
| HT-T02 | Compteur hashtags temps réel par plateforme | 0.5h |

### 👥 Utilisateurs & Workflow — 7h

| ID | Tâche | Heures |
|---|---|---|
| US-T01 | Modélisation Airtable : tables Users, Rôles, Permissions | 1.5h |
| US-T02 | Invitation email + système de rôles (5 niveaux) | 2.5h |
| US-T03 | Workflow validation personnalisable (qui crée → qui valide) | 1.5h |
| US-T04 | Profil utilisateur + pairing Telegram + audit log | 1.5h |

### 📊 Analytics & Config — 6.5h

| ID | Tâche | Heures |
|---|---|---|
| AN-T01 | Dashboard Airtable Interface : KPIs globaux 30j | 1.5h |
| AN-T02 | Token/Cost Analytics : logging usage LLM dans Airtable | 1.5h |
| CG-T01 | Config clés API IA + comptes sociaux OAuth + bot Telegram | 2h |
| CG-T02 | Auth utilisateur + 2FA (JWT sessions) | 1.5h |

### 🎨 Front-End Dashboard — 21h

| ID | Tâche | Heures |
|---|---|---|
| FE-T01 | Maquette UI/UX dashboard (wireframes) | 3h |
| FE-T02 | Interface création de post (éditeur + aperçu) | 4h |
| FE-T03 | Interface calendrier (vue mois/semaine + drag) | 3.5h |
| FE-T04 | Interface validation (miroir Telegram) | 2h |
| FE-T05 | Interface bibliothèque médias + upload | 2.5h |
| FE-T06 | Interface analytics + graphiques KPIs | 2.5h |
| FE-T07 | Interface settings (comptes, API, brand kit) | 2h |
| FE-T08 | Navigation, routing, responsive design | 2h |

### 🎬 Intégration Vidéo IA — 10h

| ID | Tâche | Heures |
|---|---|---|
| VD-T01 | Setup ComfyUI + LTX 2.3 sur GPU cloud | 3h |
| VD-T02 | API Python : endpoint génération vidéo (prompt → ComfyUI) | 3h |
| VD-T03 | Workflow n8n : soumission async + polling résultat | 2h |
| VD-T04 | Intégration résultat vidéo dans flux Telegram | 2h |

### 🛠 Infra, Déploiement & Accès Client — 11h + prérequis client

| ID | Tâche | Heures |
|---|---|---|
| INF-T01 | Docker Compose : n8n + Python API + reverse proxy | 2h |
| INF-T02 | Configuration domaine + SSL (Let's Encrypt) | 1h |
| INF-T03 | Déploiement production serveur (VPS/Cloud) | 2h |
| INF-T04 | Tests intégration end-to-end (création → publication) | 4h |
| INF-T05 | Documentation technique & guide utilisateur | 2h |
| **INF-T06** | **⚠ CLIENT : Fournir accès pages Facebook + comptes sociaux** | — |
| **INF-T07** | **⚠ CLIENT : Fournir token bot Telegram (BotFather)** | — |
| **INF-T08** | **⚠ CLIENT : Fournir clés API IA (OpenAI, etc.)** | — |
| **INF-T09** | **⚠ CLIENT : Valider charte graphique / brand kit** | — |
| **INF-T10** | **⚠ CLIENT : Accès au serveur / VPS de production** | — |

### Récapitulatif des heures

| Module | Heures |
|---|---|
| Création de Contenu | 18h |
| Templates & Brand Kit | 7h |
| Validation Telegram | 21h |
| Calendrier & Drag-Drop | 7h |
| Posting & Publication | 11h |
| Plateformes Connectées | 17h |
| Médias & Hashtags | 6.5h |
| Utilisateurs & Workflow | 7h |
| Analytics & Config | 6.5h |
| Front-End Dashboard | 21h |
| Intégration Vidéo IA | 10h |
| Infra & Déploiement | 11h |
| **Total** | **~144h** |

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

---

## 6. Prérequis Client (Bloquants)

Ces éléments doivent être fournis **avant le démarrage** pour ne pas impacter le planning de 18 jours :

| # | Prérequis | Impact si absent |
|---|---|---|
| 1 | Accès aux pages Facebook + comptes sociaux (admin) | Bloque toute intégration plateforme (17h) |
| 2 | Création du bot Telegram via BotFather + token | Bloque le module validation (21h) |
| 3 | Clés API IA (OpenAI, Anthropic, ou alternatives) | Bloque la génération de contenu (18h) |
| 4 | Charte graphique validée (logo, couleurs, polices) | Bloque le Brand Kit (7h) |
| 5 | Accès au serveur / VPS de production | Bloque le déploiement final (11h) |
