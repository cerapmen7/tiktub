# @tiktub/youtube-agent

Agent YouTube pour **TikTub** — authentification OAuth2, listing des chaînes et upload de vidéos vers YouTube (Shorts). Mode MOCK automatique si credentials Google manquants.

## Installation

```bash
npm install --workspace=@tiktub/youtube-agent
# ou depuis la racine:
npm install
```

Dépendances: `googleapis@^130`, `google-auth-library@^9`, `axios`.

## Variables d'environnement

```env
GOOGLE_CLIENT_ID=xxx.apps.googleusercontent.com
GOOGLE_CLIENT_SECRET=xxx
GOOGLE_REDIRECT_URI=http://localhost:3001/api/youtube/callback
YOUTUBE_SCOPES=https://www.googleapis.com/auth/youtube.upload https://www.googleapis.com/auth/youtube
# optionnel
YOUTUBE_TOKENS_PATH=./data/tokens.json
```

Si `GOOGLE_CLIENT_ID` est absent, vide ou vaut un placeholder (`your_google_client_id...`, `placeholder`, `dummy`), l'agent passe en **mode MOCK**: aucun appel réseau Google, uploads simulés, logs `warn`.

## Usage

```ts
import {
  getAuthUrl,
  getTokens,
  setTokens,
  loadTokens,
  saveTokens,
  getChannels,
  uploadVideo,
  isAuthenticated,
  normalizeMetadata,
} from "../../agents/youtube-agent/src/index.js";
// ou après build:
import { getAuthUrl, uploadVideo } from "@tiktub/youtube-agent";

// 1. Générer URL OAuth2
const url = getAuthUrl("state-random-123");
console.log(url); // redirect utilisateur vers Google

// 2. Callback: échanger code → tokens
const { access_token, refresh_token, expiry_date } = await getTokens(codeFromQuery);
await saveTokens(); // persiste vers data/tokens.json

// 3. Restaurer session au redémarrage
await loadTokens();
setTokens({ access_token, refresh_token, expiry_date });

// 4. Vérifier auth
if (!isAuthenticated()) console.log("Non authentifié");

// 5. Lister chaînes (mine=true)
const channels = await getChannels(); // YouTubeChannel[]

// 6. Upload vidéo
const result = await uploadVideo(
  "./data/downloads/video_123.mp4",
  {
    title: "POV : spot secret #travel #paris",
    description: "POV : spot secret #travel #paris",
    tags: ["travel", "paris", "fyp"],
    privacyStatus: "private", // public | private | unlisted
    madeForKids: false,
    selfDeclaredMadeForKids: false,
    handle: "travel_lover",
    addCredit: true,
  },
  (pct) => console.log(`Progression ${pct}%`)
);
console.log(result); // { videoId: "abc123", url: "https://www.youtube.com/watch?v=abc123" }
// En mode MOCK: { videoId: "mock_1714000000000", url: "https://www.youtube.com/watch?v=mock_..." }

// Helper normalisation
const norm = normalizeMetadata({
  title: "Recette #food",
  description: "Recette #food",
  tags: ["#Food", "#Recipe"],
  privacyStatus: "private",
  madeForKids: false,
  handle: "chef",
});
```

## API

### `getAuthUrl(state?: string): string`

Génère l'URL OAuth2 Google avec `access_type: offline` + `prompt: consent`. Scopes par défaut `youtube.upload` + `youtube` (surchargables via `YOUTUBE_SCOPES`). En MOCK retourne `http://localhost:3001/mock-youtube-auth?state=...`.

### `getTokens(code: string): Promise<{access_token, refresh_token, expiry_date}>`

Échange `code` contre tokens via `oauth2Client.getToken`. Appelle `setTokens` et persiste automatiquement. En MOCK retourne tokens fictifs.

### `setTokens(tokens: YouTubeTokens): void`

Définit les credentials sur le client OAuth2 et en cache mémoire (merge `refresh_token` si absent). Log `[youtube-agent] tokens définis`.

### `loadTokens(customPath?: string): Promise<YouTubeTokens | null>` / `saveTokens(customPath?: string): Promise<void>`

Persistance JSON. Chemin par défaut résolu via `data/tokens.json` (recherche récursive du dossier `data` depuis `cwd`), fallback `tokens.json` ou `YOUTUBE_TOKENS_PATH`. Dossier créé automatiquement.

Implémentés dans `src/tokens.ts` (exportés aussi depuis `index.ts`).

### `isAuthenticated(): boolean`

`true` si `access_token` présent et non expiré (ou si `refresh_token` disponible). En MOCK toujours `true` (simulation) avec `warn`.

### `getChannels(): Promise<YouTubeChannel[]>`

Appelle `youtube.channels.list({ mine: true, part: ["snippet","contentDetails"] })`. Map vers `{ id, title, thumbnail }`. En MOCK retourne 2 chaînes fictives.

### `uploadVideo(filePath, meta, onProgress?): Promise<{videoId, url}>`

- Normalise `title` via `tiktokToYouTubeTitle`, `description` via `tiktokToYouTubeDescription`, `tags` via `normalizeHashtags` (import depuis `shared/constants.ts` avec fallback local).
- `meta`: `{ title, description, tags, privacyStatus, madeForKids, handle, selfDeclaredMadeForKids?, addCredit? }`.
- Vérifie existence fichier, taille >0.
- Crée `google.youtube({ version: "v3", auth: oauth2Client })` et appelle `videos.insert` avec `part: ["snippet","status"]`, `requestBody` (`snippet.title/description/tags/categoryId=22`, `status.privacyStatus/madeForKids/selfDeclaredMadeForKids`), `media.body = fs.createReadStream(filePath)`.
- Gère `onUploadProgress` → `onProgress(pct)` (0..100).
- Persiste automatiquement les tokens rafraîchis via `oauth2Client.on("tokens")`.
- Gestion erreurs: quota 403, auth 401 avec messages explicites.
- En MOCK: simulation par paliers 10→100% avec délais, retour `mock_${Date.now()}` sans appel API, `warn` log.

### Helpers

- `normalizeTitle(raw, handle, addCredit?)`, `normalizeDescription(video, addCredit?)`, `normalizeTags(tags)`, `normalizeMetadata(meta)` — wrappers autour des helpers shared avec fallback local.
- `isMockMode(): boolean` — détecte si credentials manquants/placeholder.
- `resolveTokenPath(path?)` / `getTokenPath` — utilitaire chemin tokens.

### `src/tokens.ts`

Gestion fichier JSON + cache mémoire (`getCachedTokens`, `setCachedTokens`, `clearCachedTokens`, `loadTokens`, `saveTokens`, `saveTokensToPath`).

### `src/mock.ts`

Simulation upload/chaînes/auth pour dev: `mockUploadVideo`, `mockGetChannels`, `mockGetAuthUrl`, `mockGetTokens`, `MOCK_CHANNELS`.

## Build

```bash
npm run build      # tsc -> dist/
npm run typecheck  # tsc --noEmit
```

Import ESM backend: `import { uploadVideo } from "../../agents/youtube-agent/src/index.js"` (extension `.js` obligatoire avec `NodeNext`).

## Logs

Tous les logs préfixés `[youtube-agent]` en français, `warn` en mode MOCK pour transparence.

## Notes Google

- `googleapis@^130` — API `youtube@v3` et `google.auth.OAuth2`.
- Refresh auto géré par `google-auth-library`; l'agent écoute l'événement `tokens` pour persister.
- `videos.insert` est une requête *resumable* avec stream; `onUploadProgress` fournit `bytesRead`.
- Catégorie `22` (People & Blogs) par défaut, adaptée aux Shorts TikTok.

