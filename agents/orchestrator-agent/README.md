# @tiktub/orchestrator-agent

Agent Orchestrator pour **TikTub** — coordonne le pipeline complet TikTok → YouTube, multi-handles, mode mock, persistance JSON.

## Installation

```bash
npm install --workspace=@tiktub/orchestrator-agent
# ou depuis la racine:
npm install
```

Dépendances: `node-cron@^3`, `uuid@^9`.  
Dépendances dynamiques: `@tiktub/tiktok-agent`, `@tiktub/youtube-agent`, `@tiktub/scheduler-agent` (importés avec `try/catch`, mode mock si indisponibles).

## Rôle

- **Coordination** entre `tiktok-agent` (fetch/download), `youtube-agent` (upload) et `scheduler-agent` (délais/cron).
- **Multi-handles**: crée un `Job` unique contenant les vidéos de N chaînes TikTok, triées globalement.
- **Mode mock**: si `tiktok-agent`/`youtube-agent` indisponibles ou si upload/download échoue, le pipeline continue (fichier dummy + `mock_...` YouTube ID).
- **Persistance JSON** vers `data/orchestrator-state.json` + callback `onPersist(job)` pour sync Prisma/SQLite.
- **Daemon** qui poll les jobs `pending/running` chaque 30s + cron chaque minute.

## Usage

```ts
import { Orchestrator } from "../../agents/orchestrator-agent/src/index.js";
import { Scheduler } from "../../agents/scheduler-agent/src/index.js";

// 1. Créer l'orchestrator (restaure data/orchestrator-state.json)
const scheduler = new Scheduler(); // ou laisser l'orchestrator en créer un en interne
const orchestrator = new Orchestrator({
  scheduler,                          // optionnel (auto-créé si absent)
  persistPath: "./data/orchestrator-state.json",
  downloadDir: "./data/downloads",    // ou DOWNLOAD_DIR env
  maxAttempts: 3,                     // retry max
  autoStartScheduler: false,          // si true, schedule + start automatiquement
  onPersist: async (job) => {
    // Sync vers backend DB (ex: Prisma)
    await fetch("http://localhost:3001/api/jobs", { method: "POST", body: JSON.stringify(job) });
  },
});

// 2. Créer un pipeline complet (valide handles, fetch previews, schedule)
const job = await orchestrator.createJob({
  handles: ["@khaby.lame", "charli", " @Travel_Lover "], // gère @, casse, espaces, déduplication
  delayMinutes: 60,          // délai entre publications (clamp 1..10080)
  limitPerHandle: 5,         // 1..50 vidéos par handle
  sortBy: "popular",         // popular | most_liked | recent
  youtubeChannelId: "UCxxx", // optionnel
  makePublic: false,         // true=public, false=private
  addCredit: true,           // ajoute "Crédit: @handle sur TikTok" en description
  asShorts: true,            // toujours true pour port TikTok
});
console.log(`Job ${job.id} créé: ${job.items.length} vidéos, prochain run ${job.nextRunAt}`);
// -> valide chaque handle via tiktok-agent.validateHandle (try/catch)
// -> fetchTopVideos(handle, limit, sortBy) par handle (fallback mock si échec)
// -> trie globalement par sortBy si multi-handles
// -> crée Job + JobItems (uuid, queued, attempts=0)
// -> scheduler.scheduleJob(job) (item0 now+60min, item1 now+120min ...)
// -> persiste via onPersist + JSON

// 3. Traiter le prochain item dû manuellement
await orchestrator.processNext(job.id);
// -> scheduler.getNextDueItem(job) (queued && scheduledAt <= now)
// -> item.status downloading -> downloadVideo(video, downloadDir) (dummy si échec)
// -> item.status uploading  -> uploadVideo(filePath, meta) avec meta { title, tags, privacyStatus, handle, addCredit }
// -> si échec et attempts < 3: replanifie dans 5*attempts minutes, status queued
// -> si succès: status published, youtubeVideoId/url, publishedAt
// -> si attempts >=3: status failed
// -> met à jour job.progress, nextRunAt, status (completed/failed), persiste

// 4. Daemon automatique (poll pending jobs)
const stopDaemon = await orchestrator.runDaemon(30_000); // poll toutes les 30s + cron chaque minute
// Poll immédiat après 2s, puis toutes les 30s et chaque minute via node-cron
// Pour chaque job pending/running avec item dû, appelle processNext(job.id)

stopDaemon(); // ou orchestrator.stopDaemon()
orchestrator.shutdown(); // stop daemon + scheduler.stopAll + persistAll

// 5. Contrôles délégués au scheduler
orchestrator.pauseJob(job.id);
orchestrator.resumeJob(job.id);
orchestrator.cancelJob(job.id);       // queued -> skipped
orchestrator.updateDelay(job.id, 120); // recalcule scheduledAt pour queued restants
const stats = orchestrator.getStats(job.id);

// 6. Accès lecture
const j = orchestrator.getJob(job.id);
const all = orchestrator.listJobs();
```

## API

### `new Orchestrator(opts?: OrchestratorOptions)`

```ts
interface OrchestratorOptions {
  scheduler?: Scheduler;              // injection, sinon import dynamique de scheduler-agent
  onPersist?: (job: Job) => void | Promise<void>; // callback sync DB (ex: Prisma)
  persistPath?: string;               // défaut data/orchestrator-state.json
  downloadDir?: string;               // défaut DOWNLOAD_DIR env ou ./data/downloads
  maxAttempts?: number;               // défaut 3 (1..10)
  autoStartScheduler?: boolean;       // défaut false
}
```

- Restaure `data/orchestrator-state.json` au démarrage.
- `ensureDir` crée `downloadDir` automatiquement.
- Init `Scheduler` de façon asynchrone (import dynamique avec fallback stub in-memory si `scheduler-agent` indisponible).

### `createJob(config: JobConfig): Promise<Job>`

```ts
interface JobConfig {
  handles: string[];        // nettoyés via cleanHandle (gère @, regex, lowerCase, déduplication)
  delayMinutes: number;     // 1..10080 (7j), défaut 60
  limitPerHandle: number;   // 1..50, défaut 10
  sortBy: SortBy;           // popular | most_liked | recent
  youtubeChannelId?: string;
  makePublic: boolean;      // false -> private
  addCredit: boolean;       // défaut true
  asShorts: boolean;        // défaut true
}
```

**Flux détaillé:**

1. **Validation handles**: `cleanHandle` (import `shared/constants.ts` avec fallback regex). Ignore invalides, déduplique, throw si aucun valide.
2. **Fetch** par handle (séquentiel, `try/catch` par handle):
   ```ts
   // import dynamique avec fallback mock
   const tiktok = await import("../../tiktok-agent/src/index.js").catch(() => null);
   if (tiktok) {
     await tiktok.validateHandle(handle); // log warn si inexistant, ne bloque pas
     videos = await tiktok.fetchTopVideos(handle, limitPerHandle, sortBy);
   }
   if (!videos?.length) videos = generateMockVideosFallback(handle, limitPerHandle);
   ```
   Mock local: titres réalistes, `playCount` 50k-5M, hashtags extraits, `createTime` sur 30j, tri selon `sortBy`.
3. **Tri global** si multi-handles: re-tri `allVideos` par `sortBy` (sinon ordre groupé par handle).
4. **Création Job**: `id=uuidv4()`, `items` = `allVideos.map(video => ({ id: uuidv4(), jobId, video, status:"queued", attempts:0 }))`, `progress`.
5. **Schedule**: `scheduler.scheduleJob(job)` (calcule `scheduledAt = now + delay*(i+1)` pour chaque queued, `nextRunAt`, `status=pending`, `progress`).
6. **Persistance**: sauvegarde JSON + `onPersist(job)` (fire-and-forget, log warn si échec).
7. **Auto-start** si `autoStartScheduler`: `scheduler.start(job.id, item => processItem(job.id, item.id))`.

Retourne le `Job` complet (avec `items` et `nextRunAt`).

### `processNext(jobId: string): Promise<void>`

Traite **un seul** prochain item dû pour le job.

1. Lookup `job` dans `Map` (throw si introuvable).
2. `due = scheduler.getNextDueItem(job)` (fallback manuel si scheduler échoue: filtre `queued && scheduledAt <= now`).
3. Si `null` → log `aucun item dû` et return.
4. Délègue à `processItem(jobId, itemId)`:
   - `item.status = downloading`, `attempts++`, `job.status = running`, persiste.
   - **Download**: `tiktokAgent = await loadTikTokAgent()` (import dynamique, candidates `../../tiktok-agent/...`). Si `downloadVideo` existe, `await downloadVideo(video, downloadDir)` avec vérif taille `>0` sinon `createDummyFile(destPath, video)`. Si agent indisponible ou throw, crée dummy directement. Mode mock: continue pipeline (ne throw pas).
   - `item.status = downloaded` puis `uploading`.
   - **Upload**: `youtubeAgent = await loadYouTubeAgent()`. Construit `meta`:
     ```ts
     const meta = {
       title: video.title, description: video.description, tags: video.hashtags,
       privacyStatus: job.config.makePublic ? "public" : "private",
       madeForKids: false, handle: video.handle, addCredit: job.config.addCredit
     };
     ```
     Si `uploadVideo` existe, `await uploadVideo(filePath, meta, pct=>log)`. Si throw, tente `mockUploadVideo` ou simulation locale `mock_${Date.now()}`. Si agent indisponible, simulation 800ms + mock ID. Upload normalise déjà via `shared/constants.ts` (`tiktokToYouTubeTitle` etc.).
   - **Succès**: `youtubeVideoId`, `youtubeUrl`, `publishedAt`, `status=published`.
   - **Échec**: `handleItemFailure(job, item, msg)`:
     - `item.error = msg`
     - Si `attempts >= maxAttempts` → `status=failed`
     - Sinon `status=queued`, `scheduledAt = now + 5*attempts minutes` (backoff 5,10,15), `warn` + replanifie.
   - Recalcule `job.progress`, `nextRunAt` (plus tôt queued), `updatedAt`. Si plus de queued et tout terminal → `completed`/`failed`.
   - Persiste via `persistJob`.

Gère **max 3 attempts** avec backoff, **continue pipeline** en mode mock si download/upload fail (dummy + mock URL).

### `runDaemon(intervalMs = 30_000): Promise<() => void>`

Lance le daemon qui poll les jobs `pending/running`.

- `cron.schedule("* * * * *", poll)` + `setInterval(poll, intervalMs)` (défaut 30s, min 5s).
- `poll`:
  ```ts
  for (const job of jobsEnAttenteTriésParNextRunAt) {
    if (scheduler.getNextDueItem(job)) await processNext(job.id);
    await sleep(500);
  }
  ```
- Poll immédiat après 2s.
- Retourne `stop()` qui `cron.stop()` + `clearInterval`.

### Contrôles

- `pauseJob(jobId)` / `resumeJob(jobId)` / `cancelJob(jobId)` — délègue à `scheduler` et synchronise la `Map` orchestrator (cancel: queued→skipped).
- `updateDelay(jobId, newDelayMinutes)` — délègue `scheduler.updateDelay` puis resync `job.config`/`items`/`nextRunAt`.
- `getStats(jobId)` — délègue `scheduler.getStats` ou fallback local.
- `getJob(jobId)`, `listJobs()`, `stopDaemon()`, `shutdown()` (stop daemon + `scheduler.stopAll` + `persistAll`).

## Persistance

- **Fichier**: `data/orchestrator-state.json` (résolu via `ORCHESTRATOR_STATE_PATH` env → `cwd/data` → `../../../data`).
- **Download**: `data/downloads/` (résolu via `DOWNLOAD_DIR` env → `cwd/data/downloads` → `../../../data/downloads`), créé automatiquement.
- **JSON** = `Job[]` complet (avec `items` et `video`). Restauré au `constructor`.
- **onPersist**: callback pour sync DB réelle (ex: `prisma.job.upsert`). Appelé à chaque `persistJob` (create, process, pause, etc.) sans bloquer le pipeline (catch log warn).

## Mode Mock

- **tiktok-agent** manquant → `generateMockVideosFallback` (8 titres variés, hashtags, stats cohérentes, cover `picsum.photos`).
- **youtube-agent** manquant → simulation locale `mock_${Date.now()}` + URL `https://www.youtube.com/watch?v=mock_...`.
- **download fail** → `createDummyFile(destPath, video)` (texte placeholder, ne bloque pas).
- **upload fail** → tente `mockUploadVideo` puis simulation locale, continue le pipeline (item passe `published` en mock).
- Tous les mocks log `warn` préfixé `[orchestrator]`.

## Logs

- Préfixe `[orchestrator]` en français, `warn` pour fallback mock.
- Scheduler logs `[scheduler]` séparés.

## Build & Tests

```bash
npm run typecheck   # tsc --noEmit
npm run build       # tsc -> dist/
```

Imports ESM backend:

```ts
import { Orchestrator } from "../../agents/orchestrator-agent/src/index.js";
import { Scheduler } from "../../agents/scheduler-agent/src/index.js";
```

## Notes Architecture

- Pas de Redis/BullMQ — `node-cron` + `setInterval` suffisent pour dev. En prod, on peut remplacer le daemon par `BullMQ` ou `pg-boss` sans changer l'API `createJob/processNext`.
- Multi-handles natif: `createJob` entrelace le tri global par `sortBy` (popular = `playCount` desc). Le `Scheduler` planifie ensuite séquentiellement (`now+delay`, `now+2*delay`, ...).
- Le daemon est **non-bloquant**: `processNext` traite un seul item par job par tick, avec `sleep(500)` entre jobs pour éviter burst YouTube quota.
- Nettoyage: les fichiers dummy restent dans `data/downloads` pour debug ; en prod, supprimer après upload réussi via `fs.unlink(filePath)`.

## Exemple multi-handles complet

```ts
const job = await orchestrator.createJob({
  handles: ["@khaby.lame", "charli", "addisonre"],
  delayMinutes: 120, limitPerHandle: 3, sortBy: "most_liked",
  makePublic: true, addCredit: true, asShorts: true
});
// 9 vidéos (3 par handle) triées par likeCount, scheduled: now+120, now+240 ... now+1080

await orchestrator.runDaemon(20_000);
// Traite automatiquement la prochaine due chaque 20s + chaque minute via cron
```
