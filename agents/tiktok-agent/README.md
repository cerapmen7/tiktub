# @tiktub/tiktok-agent

Agent TikTok pour **TikTub** — validation de handle, récupération des vidéos populaires et téléchargement.

## Installation

```bash
npm install --workspace=@tiktub/tiktok-agent
# ou depuis la racine:
npm install
```

Dépendances: `axios` (+ `cheerio` optionnel pour scraping futur).

## Usage

```ts
import { validateHandle, fetchTopVideos, downloadVideo, extractHashtags } from "../../agents/tiktok-agent/src/index.js";
// ou après build:
import { validateHandle, fetchTopVideos } from "@tiktub/tiktok-agent";

// 1. Valider un handle (gère @ préfixe)
const profile = await validateHandle("@khaby.lame");
if (!profile.exists) console.log("Handle introuvable");

// 2. Récupérer top vidéos triées
const videos = await fetchTopVideos("khaby.lame", 10, "popular");
// sortBy: "popular" (playCount desc) | "most_liked" (likeCount desc) | "recent" (createTime desc)

// 3. Télécharger une vidéo
const filePath = await downloadVideo(videos[0], "./data/downloads");
console.log("Fichier:", filePath);

// Helper
const tags = extractHashtags("Ma vidéo #fyp #viral #travel");
```

## API

### `validateHandle(handle: string): Promise<TikTokProfile>`

- Nettoie le handle via `cleanHandle` (import depuis `shared/constants.ts`, gère `@`).
- Tente `POST https://www.tikwm.com/api/user/info` puis fallback `GET`, avec headers `User-Agent` + `Referer`.
- Si succès (`code: 0`), map `nickname`, `avatar`, `followers`, `verified`.
- Si échec réseau / API indisponible, retourne un profil **mock** plausible (ne crash pas).
- Logs en français (`[tiktok-agent] ...`).

### `fetchTopVideos(handle: string, limit: number, sortBy: SortBy): Promise<TikTokVideo[]>`

- Nettoie handle, clamp `limit` 1..50.
- Appelle `POST https://www.tikwm.com/api/user/posts?unique_id=handle&count=35` (body `{ unique_id, count, cursor }`) avec fallback `GET` et variante `POST` sans query.
- Timeout 10s, `validateStatus: () => true` pour gérer les codes non-200.
- Map chaque entrée brute vers `TikTokVideo`:
  - `id` ← `video_id | id | aweme_id`
  - `title/description` ← `desc | title`
  - `hashtags` ← regex `/#\w+/g` (sans `#`, lowercased)
  - `coverUrl`, `videoUrl` (`play|hdplay|downloadAddr`), `wmVideoUrl` (`wmplay`)
  - stats: `playCount`, `likeCount` (`diggCount`), `commentCount`, `shareCount`, `createTime`, `duration`, `musicTitle`
- Tri selon `sortBy` puis `slice(limit)`.
- Si échec ou 0 vidéo mappée, génère `max(limit, 5)` vidéos mock réalistes via `generateMockVideos` puis slice.

### `downloadVideo(video: TikTokVideo, destDir: string): Promise<string>`

- `destDir` créé récursivement (`fs.mkdir`).
- URL = `video.videoUrl || video.wmVideoUrl`.
- Si URL absente/invalide → crée immédiatement un fichier dummy.
- Sinon `axios.get(url, { responseType: "stream", timeout: 30s })` → pipe vers `${destDir}/${video.id}.mp4`.
- Vérifie `content-type` (rejette JSON) et taille (`<1Ko` → dummy).
- En cas d'erreur réseau, supprime fichier partiel et crée dummy.
- Retourne le chemin absolu/relatif du fichier.

### Helpers

- `extractHashtags(text: string): string[]` — regex `/#\w+/g`, sans `#`.
- `cleanHandle` — ré-exporté via fallback local + import `shared/constants.js`.

### `src/mock.ts`

- `generateMockVideos(handle, count)` — 10 descriptions réalistes avec hashtags, `playCount` 50k–5M, `likeCount` 8–15% vues, etc., `createTime` sur 30 jours.
- `generateMockProfile(handle)` — profil mock avec avatar `picsum.photos`.

## Limitations API

- **tikwm.com** est une API non-officielle, gratuite mais non garantie:
  - Rate-limit possible, downtime, changement de schéma.
  - Nécessite headers `Referer: https://www.tikwm.com/` et `User-Agent`.
  - Certains handles privés / inexistants renvoient `code: -1`.
- Le module **ne crash jamais**: tout échec réseau → fallback mock + dummy file pour permettre le dev hors-ligne et les tests backend sans clé.
- Watermark: `videoUrl` (no-watermark) préféré, `wmVideoUrl` fallback.
- `cheerio` listé en dépendance optionnelle pour futur scraping HTML si tikwm est down (non utilisé actuellement).

## Build

```bash
npm run build       # tsc -> dist/
npm run typecheck   # tsc --noEmit
```

Import ESM: backend utilise `import { validateHandle } from "../../agents/tiktok-agent/src/index.js"` (avec `.js` extension) — compatible `NodeNext` + `tsx`.

## Variables d'env

- `TIKWM_API_URL` (défaut `https://www.tikwm.com/api`) — surchargeable via `.env`.

## Logs

Tous les logs préfixés `[tiktok-agent]` en français pour cohérence avec les autres agents.
