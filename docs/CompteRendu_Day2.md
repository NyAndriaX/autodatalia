# Compte Rendu d'Avancement - Jour 2

**Projet:** Datalia (Dashboard Marketing Automation)
**Date:** 20 Mai 2026

## Objectif du travail réalisé

Après la mise en place de la coquille du dashboard en Jour 1, l'objectif du Jour 2 était triple :

1. Livrer la vue **Calendrier & Planification** complète (drag-drop, filtres, création rapide).
2. **Connecter** l'interface au moteur IA via le backend Python (génération + actions rapides).
3. **Durcir l'infrastructure** (Docker healthchecks, CI/CD GitHub Actions, conservation agressive des tokens IA) pour préparer la mise en production.

## Travaux réalisés aujourd'hui

### Fonctionnalités terminées

**1. Vue Calendrier & Planification (FE-T03 + CL-T01 → CL-T04)**
* Vues mensuelle et hebdomadaire avec toggle, navigation ‹ / › et bouton "Today".
* Drag-and-drop natif (HTML5, sans librairie tierce) pour reprogrammer un post d'un jour à l'autre.
* Création rapide depuis un slot vide avec choix de la source média (upload image / vidéo, génération IA image / vidéo).
* Annulation de programmation au survol d'un post (icône ✕).
* Filtres par plateforme et par statut (chips activables).
* Code couleur Facebook / Instagram / TikTok / LinkedIn et badges de statut (Brouillon / En attente / Approuvé / Publié / Erreur).
* Persistance locale (localStorage) avec graine de démonstration pour démo hors-ligne.

**2. Connexion frontend ↔ backend IA**
* Le bouton "Générer via IA" appelle désormais `POST /generate` (FastAPI + LLM Router OpenRouter).
* Actions rapides (Raccourcir, Développer, Ton casual, Ton professionnel) appellent `POST /transform`.
* Suggestions de hashtags contextuels et compteurs temps réel par plateforme.

**3. Conservation des tokens IA (priorité maximale)**
* Cache de génération avec **signature** (prompt + plateformes + template + nombre de variantes), persisté sur disque côté backend (TTL 24h) et en `localStorage` côté frontend.
* Garde anti-spam : un appel IA en cours bloque les déclencheurs en double-clic.
* Bornage des coûts (`max_tokens` plafonnés selon le type d'appel).
* Routage modèle rapide (`google/gemini-2.0-flash-lite-001`) sur les actions courtes ; modèle premium réservé à la génération multi-variantes.
* Compteur de consommation visible dans la vue Analytique (tokens et appels réels).
* **Preuve end-to-end :** un premier `POST /transform` a consommé **98 tokens** ; le même appel répété immédiatement renvoie le résultat avec **0 token** (cache hit).

**4. Nouveaux endpoints backend**
* `POST /generate` — génération de contenu multi-plateformes (1 à 5 variantes, par défaut 1).
* `POST /transform` — actions rapides sur un contenu existant.
* `POST /upload` — upload d'image / vidéo (nom de fichier assaini, anti-collision).
* `GET /search` — recherche dans la médiathèque locale.
* Rate-guard quotidien par client (200 tokens / jour par défaut, configurable).

**5. Responsive design**
* Sidebar transformée en tiroir coulissant avec hamburger sur mobile.
* Barre de recherche en overlay plein écran sur petit écran (icône → résultats cliquables qui naviguent vers la bonne vue).
* Curseur "pointer" rétabli globalement sur boutons et éléments interactifs (Tailwind v4 supprime le preflight par défaut).

**6. Squelettes des vues suivantes**
* **Médiathèque** : onglets Uploads / IA / Brand Kit, tuiles, prête à recevoir l'API `/upload`.
* **Analytique** : KPIs, graphique CSS et **compteur de tokens en direct**.
* **Paramètres** : boutons OAuth, champs clés API, pairing Telegram.

**7. Infrastructure & CI/CD**
* `docker-compose` durci : healthcheck sur le backend, `depends_on: service_healthy` pour n8n.
* `Dockerfile` backend : healthcheck intégré + cloudflared embarqué (tunnel public pour images Instagram).
* Pipeline GitHub Actions : lint + build frontend, byte-compile + import smoke backend, build de l'image Docker.
* Modèle n8n natif (sans nœud Instagram tiers) + README d'intégration (`infra/n8n/`).
* CORS configurable via variable d'environnement.

### Vérifications techniques effectuées (live)

| Cible | Résultat |
|---|---|
| `docker compose ps` | `caption-api` healthy, `n8n` running |
| `GET /health` | `{"status":"ok"}` |
| `GET /openapi.json` | 8 routes exposées : `/captions/generate`, `/generate`, `/transform`, `/upload`, `/search`, `/health`, `/tunnel-status`, `/content-items` |
| Frontend `http://localhost:3000` | HTTP 200, titre `DATALIA — Marketing Automation Dashboard` |
| n8n `http://localhost:5678` | HTTP 200 |
| Tunnel Cloudflare | actif, URL publique exposée par `/tunnel-status` |
| Cache token (preuve) | Appel 1 = 98 tokens · Appel 2 identique = 0 token |

## Difficultés rencontrées

* **Token spam** — les essais multiples de génération consommaient à chaque clic. Résolu par cache à signature + verrou d'appel en cours.
* **Confusion de containers Docker** — un projet n8n antérieur tournait en parallèle sur le même port. La stack a été repointée vers le compose de ce dépôt sans perte du volume n8n.
* **Layout de la prévisualisation** — la version Jour 1 imposait un `maxHeight` qui écrasait le ratio 9:16 de TikTok. Largeur par plateforme désormais utilisée, ratio plein respecté.
* **Lignes de calendrier irrégulières** — les jours avec posts s'agrandissaient. Corrigé par `gridTemplateRows: repeat(6, 1fr)` + scroll interne dans chaque case.
* **Recherche cassée sur mobile** — la barre disparaissait sous le breakpoint. Remplacée par une icône → overlay plein écran ; les résultats redirigent vers la vue correspondante.

## Résultat actuel

Le dashboard a atteint un niveau de complétude permettant une démonstration de bout en bout :

* Création → IA → prévisualisation multi-plateformes → planification calendrier → cache des appels IA.
* Stack Docker complète (n8n + backend FastAPI) démarrable en une commande.
* Pipeline CI vert (lint, build, byte-compile, import smoke, image).
* **Aucune nouvelle dépendance frontend** (7 packages au total, identique au Jour 1).
* **41 fichiers modifiés**, **+2 985 / -394 lignes**, **14 nouveaux fichiers**, **2 supprimés** (placeholder + image de test).

## Points d'attention / améliorations à prévoir

| # | Point | Impact | Priorité |
|---|---|---|---|
| 1 | Tunnel Cloudflare anonyme exposé à chaque démarrage du backend → `/upload`, `/generate`, `/transform` accessibles publiquement sans authentification | Sécurité | **Haute** |
| 2 | `/transform` accepte des actions invalides en silence (renvoie l'input avec 0 token consommé au lieu de répondre 422) | UX / API | Moyenne |
| 3 | Pas encore de tests automatisés (CI ne fait que lint + byte-compile + import smoke) | Qualité | Moyenne |
| 4 | Médiathèque, Analytique et Paramètres sont des squelettes (UI sans persistance backend) | Fonctionnel | Moyenne |
| 5 | Calendrier persiste en `localStorage` ; pas encore d'API `/posts` côté backend | Fonctionnel | Moyenne |
| 6 | Pas encore d'intégration Airtable, ni Telegram, ni OAuth FB / IG / TikTok / LinkedIn | Fonctionnel | Selon planning client |
| 7 | Cache token = mémoire + JSON disque (mono-worker) ; nécessitera Redis si on scale horizontalement | Scalabilité | Basse |
| 8 | CORS permissif si la variable d'environnement n'est pas configurée en production | Sécurité | Moyenne |

## Prochaines étapes (Jour 3)

1. **Sécuriser le tunnel public** : middleware token-auth sur les routes sensibles (`/upload`, `/generate`, `/transform`), ou désactiver le tunnel par défaut (activé uniquement pour la publication Instagram).
2. **Connecter la Médiathèque** au backend : `/upload` pour l'upload réel, `/search` pour le listing / recherche.
3. **Wirer la barre de recherche globale** au backend (`GET /search`) plutôt qu'à des données mockées.
4. **Persistance calendrier côté backend** : remplacer `localStorage` par une API `/posts` (CRUD).
5. **Tests automatisés** :
   * Pytest pour `/generate`, `/transform`, `/search`, le cache et le rate guard.
   * Vitest pour les reducers Redux et la signature de cache frontend.
6. **Valider les actions `/transform`** : renvoyer 422 sur action inconnue.
7. **Démarrer l'intégration Telegram** (TG-T01 → TG-T03) : bot + boutons inline de validation.
8. **OAuth Meta** (PL-T01 / PL-T02) dès que les accès clients (pages FB / IG admin) sont fournis.

## Conclusion

Le Jour 2 a livré la vue Calendrier complète, branché le moteur IA via le backend Python et durci l'infrastructure pour la production (healthchecks, CI/CD, conservation tokens). La conservation des tokens est prouvée end-to-end (98 → 0 sur un appel répété). Les bases sont solides pour attaquer les couches métier (Telegram, OAuth plateformes sociales, Airtable) lors des prochains jours.
