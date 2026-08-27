# @tiktub/scheduler-agent

Agent Scheduler pour **TikTub** — gestion de la queue d'upload avec délais configurables, cron et persistance JSON (sans Redis/BullMQ).

## Installation

```bash
npm install --workspace=@tiktub/scheduler-agent
# ou depuis la racine:
npm install
```

Dépendances: `node-cron@^3`, `uuid@^9`.

## Philosophie

- **In-memory** via `Map<string, Job>` — pas de Redis/BullMQ lourd, idéal pour dev local.
- **node-cron** pour le tick chaque minute (`* * * * *`) + `setInterval` fallback.
- **Persistance JSON** vers `data/scheduler-state.json` (restaurée au démarrage) si pas de DB backend.
- Gère **multi-handles** naturellement : un `Job` contient les `JobItems` de N handles triés globalement.

## Usage

```ts
import { Scheduler } from "../../agents/scheduler-agent/src/index.js";
// ou après build:
import { Scheduler } from "@tiktub/scheduler-agent";

// 1. Créer le scheduler (restaure automatiquement data/scheduler-state.json)
const scheduler = new Scheduler({
  persistPath: "./data/scheduler-state.json", // optionnel
  tickIntervalMs: 60_000, // optionnel, fallback interval
  onPersist: async (jobs) => { /* sync vers DB backend */ }
});

// 2. Créer un Job (ex: depuis orchestrator)
const job: Job = {
  id: "job_123",
  config: { handles: ["khaby.lame", "charli"], delayMinutes: 30, limitPerHandle: 5, sortBy: "popular", makePublic: false, addCredit: true, asShorts: true },
  status: "pending",
  items: [ /* JobItem[] avec video */ ],
  createdAt: new Date().toISOString(),
  updatedAt: new Date().toISOString(),
  progress: { total: 10, done: 0, failed: 0 }
};

// 3. Scheduler le job — calcule scheduledAt pour chaque item
scheduler.scheduleJob(job);
// item0 -> now + 30min, item1 -> now + 60min, item2 -> now + 90min ...
// Met status "queued" pour les items non terminés, calcule nextRunAt

// 4. Démarrer le tick pour ce job
scheduler.start(job.id, async (item) => {
  console.log("Traitement dû:", item.id, item.video.title);
  // Ici: download + upload via orchestrator
  item.status = "published";
  item.publishedAt = new Date().toISOString();
});

// 5. Contrôles
scheduler.pause(job.id);   // stoppe cron/intervals, status -> paused
scheduler.resume(job.id);  // repasse à pending/running, relance cron (caller doit refaire start si besoin)
scheduler.cancel(job.id);  // status -> cancelled, queued -> skipped

// 6. Modifier le délai à chaud (replanifie les queued restants)
scheduler.updateDelay(job.id, 60); // 60 minutes

// 7. Stats
const stats = scheduler.getStats(job);
console.log(stats);
// { total: 10, queued: 8, published: 2, failed: 0, done: 2, remaining: 8, nextRunAt: "2026-05-13T...", status: "running" }

// 8. Helpers persistance
const due = scheduler.getNextDueItem(job); // JobItem | null si rien dû
const globalDue = scheduler.getNextDueItemGlobal(); // { job, item } | null

scheduler.stop(job.id);    // stoppe un job
scheduler.stopAll();       // stoppe tout
scheduler.shutdown();      // alias stopAll
```

## API

### `new Scheduler(opts?: SchedulerOptions)`

```ts
interface SchedulerOptions {
  persistPath?: string;      // défaut: data/scheduler-state.json (résolu via cwd ou ../../../data)
  tickIntervalMs?: number;   // défaut 60_000 (1 min) — interval NodeJS complémentaire au cron
  autoPersist?: boolean;     // défaut true
  onPersist?: (jobs: Job[]) => void | Promise<void>; // callback sync DB
}
```

- Restaure automatiquement les jobs depuis `persistPath` s'il existe.
- Logs préfixés `[scheduler]` en français.

### `scheduleJob(job: Job): void`

- Calcule `scheduledAt` pour chaque `JobItem` non terminal (`published|failed|skipped` ignorés).
- Formule: `now + delayMinutes * (index+1)` où `index` est l'ordre des queued restants (triés par ancien `scheduledAt`).
- Met `item.status = "queued"` et `attempts = 0` si absent.
- Calcule `job.nextRunAt` = plus tôt `scheduledAt` parmi les queued.
- Met `job.status` à `pending` (ou `completed` si tout déjà publié), `progress` et `updatedAt`.
- Persiste immédiatement (fichier + `onPersist`).

### `getNextDueItem(job: Job | string): JobItem | null`

- Retourne le plus ancien `queued` dont `scheduledAt <= now`.
- Si `job` est un `string`, lookup interne via `Map`.
- Retourne `null` si job `paused/cancelled` ou rien dû.
- Tri par `scheduledAt` ascendant.

### `getNextDueItemGlobal(): { job: Job; item: JobItem } | null`

- Parcourt tous les jobs et retourne le plus ancien due global (utile pour daemon unique).

### `start(jobId: string, processor: (item: JobItem) => Promise<void>): void`

- Lance un `cron.schedule("* * * * *")` + `setInterval(tickIntervalMs)` qui chaque minute appelle `getNextDueItem` puis `await processor(item)`.
- Si déjà démarré pour ce `jobId`, stoppe l'ancien avant de relancer.
- Passe `job.status` de `pending` à `running` si besoin.
- Après chaque `processor`, recalcule `nextRunAt`, `progress`, et détecte `completed/failed` (tous les items en état terminal → stop).
- Tick immédiat décalé de 2s pour dev (pas besoin d'attendre 1 min).
- Log `[scheduler] tick dû job=... item=...`.

### `pause(jobId: string): void`

- Ajoute à `paused` Set, `job.status = "paused"`.
- `task.stop()` + `clearInterval` (garde la tâche en mémoire pour `resume`).
- Persiste.

### `resume(jobId: string): void`

- Retire du `paused` Set, `job.status` → `running`/`pending`.
- Relance `task.start()` si une tâche cron existait, sinon log invite à rappeler `start(jobId, processor)`.

### `cancel(jobId: string): void`

- `job.status = "cancelled"`, tous les `queued` → `skipped` avec `error="Job annulé"`, `nextRunAt = undefined`.
- Stoppe timers, persiste.

### `updateDelay(jobId: string, newDelayMinutes: number): void`

- Clamp `1 .. 7 jours`.
- Met `job.config.delayMinutes = newDelay`.
- Recalcule `scheduledAt` pour les `queued` restants triés par ancien `scheduledAt`: `now + newDelay*(i+1)`.
- Recalcule `nextRunAt`, `updatedAt`, persiste.

### `getStats(job: Job | string): SchedulerStats`

```ts
interface SchedulerStats {
  total, queued, downloading, downloaded, uploading, published, failed, skipped, done, remaining,
  progress: { total, done, failed },
  nextRunAt?, status, delayMinutes
}
```

- Compte chaque statut, `done = published + skipped`, `remaining = queued + downloading + downloaded + uploading`.

### Autres

- `getJob(jobId)`, `listJobs()`, `dump()`, `restore(jobs)`, `stop(jobId)`, `stopAll()/shutdown()`.

## Persistance

- Fichier par défaut: `data/scheduler-state.json` (recherche: `SCHEDULER_STATE_PATH` env → `cwd/data` → `../../../data`).
- Dossier créé automatiquement.
- `onPersist` permet de synchroniser vers Prisma/SQLite backend (ex: `onPersist: (jobs) => prisma.job.updateMany(...)`).

## Tests rapides

```bash
npm run typecheck   # tsc --noEmit
npm run build       # tsc -> dist/
```

Import ESM backend: `import { Scheduler } from "../../agents/scheduler-agent/src/index.js"` (extension `.js` obligatoire avec `NodeNext`).

## Logs

Tous les logs préfixés `[scheduler]` en français, `warn` pour erreurs non bloquantes.

## Notes

- Pas de BullMQ/Redis — volontairement simple pour dev. En prod, remplacer `persist` par DB + éventuellement `pg-boss` ou `BullMQ`.
- Le scheduler ne télécharge/uploade pas lui-même ; il orchestre le timing et appelle le `processor` fourni par `orchestrator-agent`.
- Multi-handles: `scheduleJob` entrelace les items dans l'ordre fourni (l'orchestrator trie déjà globalement par `playCount` si `popular`).
