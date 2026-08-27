# TikTub 🚀 — TikTok → YouTube Automation

> **Application multi-agents qui récupère automatiquement les vidéos TikTok les plus populaires d'un ou plusieurs comptes (@handle) et les reposte sur YouTube avec titres, hashtags et descriptions identiques.**

Inspiré par `cerapmen7/tiktub` — réimplémentation complète avec architecture moderne et IA.

---

## ✨ Fonctionnalités

- **Setup wizard** : entre le(s) `@TikTok` à suivre → connexion YouTube OAuth2 obligatoire avant lancement
- **Multi-chaînes** : ajoute N comptes TikTok, l'IA gère tout en parallèle
- **Téléchargement intelligent** : récupère les vidéos les plus vues/likées (tri par popularité), sans watermark si possible
- **Repost fidèle** : même titre, mêmes `#hashtags`, même description → converti pour YouTube Shorts
- **Délai configurable** : définit le temps entre chaque publication (ex: 30min, 2h, 24h)
- **Architecture multi-agents** :
  - `tiktok-agent` — scrape & download
  - `youtube-agent` — OAuth & upload
  - `scheduler-agent` — queue + délai + cron
  - `orchestrator-agent` — coordination + persistance
  - `metadata-agent` — normalisation titres/hashtags pour YouTube (Shorts)

## 🏗️ Architecture

```
tiktub/
├── backend/               # Express + Prisma + SQLite
│   ├── src/routes/        # /api/tiktok, /api/youtube, /api/scheduler, /api/jobs
│   ├── src/services/      # DB, queue
│   └── prisma/schema.prisma
├── frontend/              # React + Vite + Tailwind
│   └── src/pages/         # SetupWizard, Dashboard, Settings
├── agents/
│   ├── tiktok-agent/      # scraper, validator, downloader
│   ├── youtube-agent/     # oauth, uploader, metadata
│   ├── scheduler-agent/   # queue, delay, cron
│   └── orchestrator-agent/# pipeline
└── shared/                # types & constants partagés
```

## 🚀 Quick Start

### 1. Prérequis
- Node.js 18+
- Compte Google Cloud avec YouTube Data API v3 activée
- OAuth2 credentials (Client ID / Secret)

### 2. Installation

```bash
git clone https://github.com/cerapmen7/tiktub.git
cd tiktub
npm run install:all
cp .env.example .env
# → remplis GOOGLE_CLIENT_ID / SECRET / REDIRECT_URI
```

### 3. Google OAuth Setup
1. https://console.cloud.google.com → Créer projet
2. Activer **YouTube Data API v3**
3. Créer **OAuth 2.0 Client ID** (type Web app)
4. Ajouter redirect URI: `http://localhost:3001/api/youtube/callback`
5. Copier ID/Secret dans `.env`

### 4. Lancer

```bash
npm run dev
# backend http://localhost:3001
# frontend http://localhost:5173
```

Ouvre http://localhost:5173 → wizard s'affiche.

## 🧙 Setup Wizard (Flux utilisateur)

1. **Bienvenue** → explication
2. **Connexion YouTube** → bouton "Se connecter avec Google" → OAuth → sélection chaîne YouTube (si plusieurs)
3. **Comptes TikTok** → input `@handle` (validation regex + vérif existence) → bouton "+ Ajouter une chaîne" → liste
4. **Configuration** →
   - `Nombre de vidéos` par compte (5-50)
   - `Tri` : plus vues / plus likées / récentes
   - `Délai entre posts` : slider 15min → 48h
5. **Aperçu** → liste vidéos détectées (thumbnail + titre + stats)
6. **Lancer** → jobs créés → Dashboard avec progression

## 📊 Dashboard

- Queue en temps réel (pending / downloading / uploading / done / failed)
- Logs par agent
- Contrôles: pause / resume / retry / supprimer
- Stats: vidéos traitées, vues estimées, chaînes actives

## 🔌 API

| Méthode | Route | Description |
|---------|-------|-------------|
| `POST` | `/api/tiktok/validate` | `{ handle }` → profil existe? |
| `POST` | `/api/tiktok/preview` | `{ handles, limit, sortBy }` → previews |
| `GET` | `/api/youtube/auth` | redirect OAuth |
| `GET` | `/api/youtube/callback` | callback OAuth |
| `GET` | `/api/youtube/channels` | chaînes dispo |
| `POST` | `/api/jobs` | créer pipeline `{ handles, delayMinutes, options }` |
| `GET` | `/api/jobs` | lister jobs |
| `GET` | `/api/jobs/:id` | détail + logs |
| `POST` | `/api/jobs/:id/pause` | pause |
| `POST` | `/api/jobs/:id/resume` | resume |
| `PATCH` | `/api/settings` | update delay global |

## ⚠️ Notes légales

- Respecte les ToS TikTok/YouTube. Ne reposte que du contenu dont tu as les droits ou avec autorisation du créateur (@ mention obligatoire).
- L'app ajoute automatiquement `Crédit: @handle sur TikTok` en description si demandé.
- Utilise watermark-free download uniquement à des fins de transformation (Shorts format).

## 🛠️ Stack

- **Backend**: Node 18+, Express 4, Prisma 5, SQLite, `googleapis`, `axios`, `node-cron`, `fluent-ffmpeg` (optionnel)
- **Frontend**: React 18, Vite 5, React Router, Tailwind, Zustand, Axios
- **Agents**: modules Node découplés, communication via events + DB queue

## 📦 Déploiement

```bash
npm run build
npm start  # prod
```

Docker: `docker-compose up --build`

---

Made with ❤️ by TikTub multi-agent system.
