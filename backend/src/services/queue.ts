/**
 * backend/src/services/queue.ts — Wrapper scheduler-agent & orchestrator-agent
 *
 * Centralise la queue en mémoire + persistance DB.
 * - Instancie Scheduler et Orchestrator (via import dynamique avec fallback)
 * - Expose API uniforme utilisée par routes jobs
 */

import * as fs from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";

// @ts-ignore — shared hors rootDir
import type { Job, JobConfig, JobItem } from "../../../shared/types.js";

import { db } from "./db.js";

// ---------------------------------------------------------------------------
// Chargement dynamique Scheduler / Orchestrator (tolérant)
// ---------------------------------------------------------------------------

let schedulerInstance: any | null = null;
let orchestratorInstance: any | null = null;
let initPromise: Promise<void> | null = null;

async function loadSchedulerClass(): Promise<any | null> {
  // 1. Relatif depuis backend/src/services/queue.ts -> agents/scheduler-agent
  const relCandidates = [
    "../../../agents/scheduler-agent/src/index.js",
    // au cas où backend/src/services est plus profond
    "../../../../agents/scheduler-agent/src/index.js",
  ];
  for (const spec of relCandidates) {
    try {
      const mod: any = await import(spec);
      if (mod?.Scheduler) {
        console.log(`[queue] Scheduler chargé via ${spec}`);
        return mod.Scheduler;
      }
      if (mod?.default?.Scheduler) return mod.default.Scheduler;
      if (mod?.default) return mod.default;
    } catch {}
  }
  // 2. Absolu via file path
  try {
    const __filename = fileURLToPath(import.meta.url);
    const __dirname = path.dirname(__filename);
    const root = path.resolve(__dirname, "../../../");
    const abs = path.join(root, "agents", "scheduler-agent", "src", "index.js");
    if (fs.existsSync(abs)) {
      const { pathToFileURL } = await import("node:url");
      const mod: any = await import(pathToFileURL(abs).href);
      if (mod?.Scheduler) {
        console.log(`[queue] Scheduler chargé via absolu ${abs}`);
        return mod.Scheduler;
      }
    }
  } catch {}
  console.warn("[queue] Scheduler non chargé — fallback interne");
  return null;
}

async function loadOrchestratorClass(): Promise<any | null> {
  const relCandidates = [
    "../../../agents/orchestrator-agent/src/index.js",
    "../../../../agents/orchestrator-agent/src/index.js",
  ];
  for (const spec of relCandidates) {
    try {
      const mod: any = await import(spec);
      if (mod?.Orchestrator) {
        console.log(`[queue] Orchestrator chargé via ${spec}`);
        return mod.Orchestrator;
      }
      if (mod?.default?.Orchestrator) return mod.default.Orchestrator;
      if (mod?.default) return mod.default;
    } catch {}
  }
  try {
    const __filename = fileURLToPath(import.meta.url);
    const __dirname = path.dirname(__filename);
    const root = path.resolve(__dirname, "../../../");
    const abs = path.join(root, "agents", "orchestrator-agent", "src", "index.js");
    if (fs.existsSync(abs)) {
      const { pathToFileURL } = await import("node:url");
      const mod: any = await import(pathToFileURL(abs).href);
      if (mod?.Orchestrator) {
        console.log(`[queue] Orchestrator chargé via absolu ${abs}`);
        return mod.Orchestrator;
      }
    }
  } catch {}
  console.warn("[queue] Orchestrator non chargé — fallback interne");
  return null;
}

async function initQueue(): Promise<void> {
  if (schedulerInstance && orchestratorInstance) return;
  if (initPromise) return initPromise;

  initPromise = (async () => {
    // Charger les jobs existants depuis DB (fallback JSON)
    let existingJobs: Job[] = [];
    try {
      existingJobs = await db.listJobs();
      console.log(`[queue] ${existingJobs.length} jobs chargés depuis db/fallback`);
    } catch (e) {
      console.warn(`[queue] échec chargement jobs init: ${e}`);
    }

    // Scheduler
    const SchedulerCls = await loadSchedulerClass();
    if (SchedulerCls) {
      try {
        schedulerInstance = new SchedulerCls({
          autoPersist: true,
          onPersist: async (_jobs: Job[]) => {
            // Scheduler persiste en array; on synchronise chaque job vers db (fire-and-forget)
            // Éviter boucle infinie: on ne persiste pas tout, l'orchestrator le fera
          },
        });
        // Restaurer jobs dans scheduler
        if (existingJobs.length && typeof schedulerInstance.restore === "function") {
          try {
            schedulerInstance.restore(existingJobs);
          } catch {}
        } else {
          for (const j of existingJobs) {
            try { schedulerInstance.jobs?.set?.(j.id, j); } catch {}
          }
        }
        console.log("[queue] Scheduler instancié");
      } catch (e) {
        console.warn(`[queue] échec instanciation Scheduler: ${e}`);
        schedulerInstance = createFallbackScheduler();
      }
    } else {
      schedulerInstance = createFallbackScheduler();
    }

    // Orchestrator
    const OrchestratorCls = await loadOrchestratorClass();
    if (OrchestratorCls) {
      try {
        orchestratorInstance = new OrchestratorCls({
          scheduler: schedulerInstance,
          downloadDir: process.env.DOWNLOAD_DIR || "./data/downloads",
          onPersist: async (job: Job) => {
            try {
              await db.persistJob(job);
            } catch (e) {
              console.warn(`[queue] onPersist db échec: ${e}`);
            }
          },
        });
        // Restaurer jobs dans orchestrator (si non déjà fait via restore interne)
        // L'orchestrator charge déjà depuis son propre fichier, mais on synchronise
        for (const j of existingJobs) {
          try {
            if (!orchestratorInstance.getJob(j.id)) {
              // @ts-ignore — accès privé mais on tente set
              orchestratorInstance.jobs?.set?.(j.id, j);
            }
          } catch {}
        }
        console.log("[queue] Orchestrator instancié");
      } catch (e) {
        console.warn(`[queue] échec instanciation Orchestrator: ${e}`);
        orchestratorInstance = createFallbackOrchestrator(schedulerInstance);
      }
    } else {
      orchestratorInstance = createFallbackOrchestrator(schedulerInstance);
    }
  })();

  await initPromise;
  initPromise = null;
}

// ---------------------------------------------------------------------------
// Fallbacks minimaux (si agents non disponibles)
// ---------------------------------------------------------------------------

function createFallbackScheduler(): any {
  console.warn("[queue] utilisation fallback scheduler in-memory");
  const jobs = new Map<string, Job>();
  return {
    jobs,
    scheduleJob(job: Job) {
      const delay = job.config?.delayMinutes ?? 60;
      const safe = Math.max(1, Math.min(Number(delay) || 60, 60 * 24 * 7));
      const now = Date.now();
      let qi = 0;
      for (const it of job.items) {
        if (it.status === "published" || it.status === "failed" || it.status === "skipped") continue;
        it.scheduledAt = new Date(now + safe * 60 * 1000 * (qi + 1)).toISOString();
        it.status = "queued";
        if (typeof it.attempts !== "number") it.attempts = 0;
        qi++;
      }
      const queued = job.items.filter((i) => i.status === "queued" && i.scheduledAt).sort((a: any, b: any) => new Date(a.scheduledAt!).getTime() - new Date(b.scheduledAt!).getTime());
      job.nextRunAt = queued[0]?.scheduledAt;
      if (job.status !== "paused" && job.status !== "cancelled") job.status = "pending";
      job.progress = { total: job.items.length, done: job.items.filter((i) => i.status === "published").length, failed: job.items.filter((i) => i.status === "failed").length };
      job.updatedAt = new Date().toISOString();
      jobs.set(job.id, job);
    },
    getNextDueItem(job: Job | string) {
      const j: Job | undefined = typeof job === "string" ? jobs.get(job) : (job as Job);
      if (!j) return null;
      if (j.status === "paused" || j.status === "cancelled") return null;
      const now = Date.now();
      const due = j.items.filter((it) => it.status === "queued" && it.scheduledAt && new Date(it.scheduledAt).getTime() <= now).sort((a, b) => new Date(a.scheduledAt!).getTime() - new Date(b.scheduledAt!).getTime());
      return due[0] ?? null;
    },
    getStats(job: Job | string) {
      const j: Job | undefined = typeof job === "string" ? jobs.get(job) : (job as Job);
      if (!j) throw new Error("job introuvable");
      return { total: j.items.length, queued: j.items.filter((i) => i.status === "queued").length, published: j.items.filter((i) => i.status === "published").length, failed: j.items.filter((i) => i.status === "failed").length, done: j.items.filter((i) => i.status === "published").length, remaining: j.items.filter((i) => i.status === "queued").length, progress: j.progress, nextRunAt: j.nextRunAt, status: j.status, delayMinutes: j.config.delayMinutes };
    },
    restore(jobsArr: Job[]) { for (const j of jobsArr) jobs.set(j.id, j); },
    start() {},
    pause(id: string) { const j = jobs.get(id); if (j) j.status = "paused"; },
    resume(id: string) { const j = jobs.get(id); if (j && j.status === "paused") j.status = "pending"; },
    cancel(id: string) { const j = jobs.get(id); if (j) { j.status = "cancelled"; for (const it of j.items) if (it.status === "queued") { it.status = "skipped"; it.error = "Job annulé"; } } },
    updateDelay(id: string, newDelay: number) {
      const j = jobs.get(id); if (!j) throw new Error("job introuvable");
      const safe = Math.max(1, Math.min(Number(newDelay) || 60, 60 * 24 * 7));
      j.config.delayMinutes = safe;
      const queued = j.items.filter((it) => it.status === "queued").sort((a, b) => new Date(a.scheduledAt ?? 0).getTime() - new Date(b.scheduledAt ?? 0).getTime());
      const now = Date.now();
      queued.forEach((it, idx) => { it.scheduledAt = new Date(now + safe * 60 * 1000 * (idx + 1)).toISOString(); });
      queued.sort((a, b) => new Date(a.scheduledAt!).getTime() - new Date(b.scheduledAt!).getTime());
      j.nextRunAt = queued[0]?.scheduledAt; j.updatedAt = new Date().toISOString();
    },
    listJobs() { return Array.from(jobs.values()); },
    getJob(id: string) { return jobs.get(id); },
    stop() {}, stopAll() {},
  };
}

function createFallbackOrchestrator(scheduler: any): any {
  console.warn("[queue] utilisation fallback orchestrator in-memory");
  const jobs = scheduler?.jobs ?? new Map<string, Job>();
  // Si scheduler a une map partagée, on la réutilise
  return {
    jobs,
    scheduler,
    async createJob(config: JobConfig): Promise<Job> {
      // Version simplifiée: crée jobs avec mocks si agents indisponibles
      const { v4: uuidv4 } = await import("uuid");
      // @ts-ignore
      const { generateMockVideos } = await import("../../../agents/tiktok-agent/src/mock.js").catch(async () => {
        // fallback local mock
        return {
          generateMockVideos: (handle: string, count: number) => {
            const clean = handle.replace(/^@/, "").toLowerCase();
            return Array.from({ length: count }, (_, i) => ({
              id: `${clean}_${Date.now()}_${i}`,
              handle: clean,
              title: `Vidéo mock @${clean} #${i} #fyp #viral`,
              description: `Vidéo mock @${clean} #${i}`,
              hashtags: ["fyp", "viral"],
              playCount: 10000 + i * 1000,
              likeCount: 1000 + i * 100,
              createTime: Math.floor(Date.now() / 1000) - i * 86400,
            }));
          },
        };
      });

      const handles = config.handles.map((h: string) => h.replace(/^@/, "").toLowerCase());
      const allVideos: any[] = [];
      for (const h of handles) {
        const vids = generateMockVideos(h, config.limitPerHandle);
        // tri
        if (config.sortBy === "most_liked") vids.sort((a: any, b: any) => (b.likeCount || 0) - (a.likeCount || 0));
        else if (config.sortBy === "recent") vids.sort((a: any, b: any) => (b.createTime || 0) - (a.createTime || 0));
        else vids.sort((a: any, b: any) => (b.playCount || 0) - (a.playCount || 0));
        allVideos.push(...vids.slice(0, config.limitPerHandle));
      }
      const jobId = uuidv4();
      const nowIso = new Date().toISOString();
      const items: JobItem[] = allVideos.map((video: any) => ({
        id: uuidv4(),
        jobId,
        video,
        status: "queued" as const,
        attempts: 0,
      }));
      const job: Job = {
        id: jobId,
        config,
        status: "pending",
        items,
        createdAt: nowIso,
        updatedAt: nowIso,
        progress: { total: items.length, done: 0, failed: 0 },
      };
      // schedule
      const delay = config.delayMinutes ?? 60;
      const safe = Math.max(1, Math.min(Number(delay) || 60, 60 * 24 * 7));
      const now = Date.now();
      items.forEach((it, idx) => { it.scheduledAt = new Date(now + safe * 60 * 1000 * (idx + 1)).toISOString(); });
      job.nextRunAt = items[0]?.scheduledAt;
      jobs.set(jobId, job);
      try { scheduler?.jobs?.set?.(jobId, job); } catch {}
      try { await db.persistJob(job); } catch {}
      return job;
    },
    getJob(id: string) { return jobs.get(id) || scheduler?.getJob?.(id); },
    listJobs() { return Array.from(jobs.values()); },
    async processNext(id: string) { console.log(`[queue][fallback] processNext ${id} noop (mock)`); },
    async runDaemon() { console.log("[queue][fallback] runDaemon noop"); return () => {}; },
    stopDaemon() {},
    pauseJob(id: string) { const j = jobs.get(id); if (j) j.status = "paused"; scheduler?.pause?.(id); },
    resumeJob(id: string) { const j = jobs.get(id); if (j && j.status === "paused") j.status = "pending"; scheduler?.resume?.(id); },
    cancelJob(id: string) { const j = jobs.get(id); if (j) { j.status = "cancelled"; for (const it of j.items) if (it.status === "queued") { it.status = "skipped"; it.error = "Job annulé"; } } scheduler?.cancel?.(id); },
    updateDelay(id: string, newDelay: number) { scheduler?.updateDelay?.(id, newDelay); const j = jobs.get(id); if (j) { const updated = scheduler?.getJob?.(id); if (updated) { j.config.delayMinutes = updated.config.delayMinutes; j.items = updated.items; j.nextRunAt = updated.nextRunAt; } } },
    getStats(id: string) { return scheduler?.getStats?.(id); },
  };
}

// ---------------------------------------------------------------------------
// API publique du queue service (singleton lazy)
// ---------------------------------------------------------------------------

export async function getScheduler(): Promise<any> {
  await initQueue();
  return schedulerInstance;
}

export async function getOrchestrator(): Promise<any> {
  await initQueue();
  return orchestratorInstance;
}

export async function queueCreateJob(config: JobConfig): Promise<Job> {
  await initQueue();
  if (!orchestratorInstance) throw new Error("Orchestrator non initialisé");
  const job: Job = await orchestratorInstance.createJob(config);
  // Persistance déjà faite via onPersist, mais on assure db
  try { await db.persistJob(job); } catch (e) { console.warn(`[queue] persist after createJob échec: ${e}`); }
  return job;
}

export async function queueListJobs(): Promise<Job[]> {
  await initQueue();
  // Source de vérité: DB fallback (contient tout)
  try {
    const fromDb = await db.listJobs();
    if (fromDb.length) return fromDb;
  } catch {}
  // Sinon orchestrator
  try { return orchestratorInstance?.listJobs?.() ?? []; } catch { return []; }
}

export async function queueGetJob(id: string): Promise<Job | null> {
  await initQueue();
  // DB d'abord
  try {
    const fromDb = await db.getJob(id);
    if (fromDb) return fromDb;
  } catch {}
  try { return orchestratorInstance?.getJob?.(id) ?? schedulerInstance?.getJob?.(id) ?? null; } catch { return null; }
}

export async function queuePauseJob(id: string): Promise<Job | null> {
  await initQueue();
  try { orchestratorInstance?.pauseJob?.(id); } catch {}
  try { schedulerInstance?.pause?.(id); } catch {}
  // Synchronise DB
  const job = await db.getJob(id);
  if (job) {
    job.status = "paused";
    job.updatedAt = new Date().toISOString();
    await db.updateJob(job);
    return job;
  }
  return orchestratorInstance?.getJob?.(id) ?? null;
}

export async function queueResumeJob(id: string): Promise<Job | null> {
  await initQueue();
  try { orchestratorInstance?.resumeJob?.(id); } catch {}
  try { schedulerInstance?.resume?.(id); } catch {}
  // Re-start scheduler si nécessaire (orchestrator auto)
  try {
    const orchJob = orchestratorInstance?.getJob?.(id) as Job | undefined;
    if (orchJob && schedulerInstance && typeof schedulerInstance.start === "function") {
      // Le scheduler.start attend processor; on laisse orchestrator daemon gérer
      // On tente de relancer si pending
    }
  } catch {}
  const job = await db.getJob(id);
  if (job) {
    if (job.status === "paused") {
      job.status = job.items.some((it) => it.status === "queued") ? "pending" : "running";
      job.updatedAt = new Date().toISOString();
      await db.updateJob(job);
    }
    return job;
  }
  return orchestratorInstance?.getJob?.(id) ?? null;
}

export async function queueCancelJob(id: string): Promise<Job | null> {
  await initQueue();
  try { orchestratorInstance?.cancelJob?.(id); } catch {}
  try { schedulerInstance?.cancel?.(id); } catch {}
  const job = await db.getJob(id);
  if (job) {
    // Orchestrator a déjà marqué skipped, mais on force
    if (job.status !== "cancelled") {
      job.status = "cancelled";
      for (const it of job.items) if (it.status === "queued") { it.status = "skipped"; it.error = "Job annulé"; }
      job.nextRunAt = undefined;
      job.updatedAt = new Date().toISOString();
      await db.updateJob(job);
    }
    return job;
  }
  return orchestratorInstance?.getJob?.(id) ?? null;
}

export async function queueRetryJob(id: string): Promise<Job | null> {
  await initQueue();
  const job = await db.getJob(id);
  if (!job) throw new Error(`Job ${id} introuvable`);
  let hasFailed = false;
  for (const it of job.items) {
    if (it.status === "failed") {
      const attempts = it.attempts ?? 0;
      if (attempts >= 3) {
        // Reset attempts pour permettre retry manuel
        it.attempts = 0;
      }
      it.status = "queued";
      it.error = undefined;
      // Re-schedule: sera recalculé
      hasFailed = true;
    }
  }
  if (!hasFailed) throw new Error("Aucun item en échec à relancer");
  // Recalcul planning via scheduler si dispo
  try {
    if (schedulerInstance?.scheduleJob) {
      schedulerInstance.scheduleJob(job);
      // scheduleJob met à jour job.nextRunAt etc. On resync depuis scheduler
      const updated = schedulerInstance.getJob?.(id) as Job | undefined;
      if (updated) {
        job.items = updated.items;
        job.nextRunAt = updated.nextRunAt;
        job.status = updated.status;
        job.progress = updated.progress;
      }
    } else {
      // fallback manuel
      const delay = job.config.delayMinutes ?? 60;
      const safe = Math.max(1, Math.min(Number(delay) || 60, 60 * 24 * 7));
      const now = Date.now();
      const queued = job.items.filter((it) => it.status === "queued").sort((a, b) => new Date(a.scheduledAt ?? 0).getTime() - new Date(b.scheduledAt ?? 0).getTime());
      queued.forEach((it, idx) => { it.scheduledAt = new Date(now + safe * 60 * 1000 * (idx + 1)).toISOString(); });
      job.nextRunAt = queued[0]?.scheduledAt;
      job.status = "pending";
    }
  } catch (e) {
    console.warn(`[queue] retry schedule échec: ${e}`);
  }
  job.updatedAt = new Date().toISOString();
  await db.updateJob(job);
  // Synchronise orchestrator/scheduler maps
  try { orchestratorInstance?.jobs?.set?.(id, job); } catch {}
  try { schedulerInstance?.jobs?.set?.(id, job); } catch {}
  return job;
}

export async function queueUpdateDelay(id: string, newDelayMinutes: number): Promise<Job | null> {
  await initQueue();
  const safe = Math.max(1, Math.min(Number(newDelayMinutes) || 60, 60 * 24 * 7));
  try { orchestratorInstance?.updateDelay?.(id, safe); } catch {}
  try { schedulerInstance?.updateDelay?.(id, safe); } catch {}
  // DB sync
  const job = await db.getJob(id);
  if (job) {
    // Si orchestrator a déjà mis à jour, re-fetch
    const orchJob = orchestratorInstance?.getJob?.(id) as Job | undefined;
    const schedJob = schedulerInstance?.getJob?.(id) as Job | undefined;
    const src = orchJob || schedJob;
    if (src) {
      job.config.delayMinutes = src.config.delayMinutes;
      job.items = src.items;
      job.nextRunAt = src.nextRunAt;
      job.updatedAt = src.updatedAt;
    } else {
      job.config.delayMinutes = safe;
      const queued = job.items.filter((it) => it.status === "queued").sort((a, b) => new Date(a.scheduledAt ?? 0).getTime() - new Date(b.scheduledAt ?? 0).getTime());
      const now = Date.now();
      queued.forEach((it, idx) => { it.scheduledAt = new Date(now + safe * 60 * 1000 * (idx + 1)).toISOString(); });
      job.nextRunAt = queued[0]?.scheduledAt;
      job.updatedAt = new Date().toISOString();
    }
    await db.updateJob(job);
    return job;
  }
  return orchestratorInstance?.getJob?.(id) ?? schedulerInstance?.getJob?.(id) ?? null;
}

export async function startOrchestratorDaemon(): Promise<(() => void) | null> {
  await initQueue();
  if (!orchestratorInstance) {
    console.warn("[queue] orchestrator indisponible — daemon non démarré");
    return null;
  }
  try {
    if (typeof orchestratorInstance.runDaemon === "function") {
      const stopFn = await orchestratorInstance.runDaemon(30_000);
      console.log("[queue] Orchestrator daemon démarré (poll 30s + cron 1min)");
      // Persist orchestrator jobs periodically? orchestrator gère déjà via onPersist
      return stopFn;
    } else {
      console.warn("[queue] orchestrator.runDaemon non trouvé");
      return null;
    }
  } catch (e) {
    console.warn(`[queue] échec démarrage daemon: ${e}`);
    return null;
  }
}

export const queue = {
  init: initQueue,
  getScheduler,
  getOrchestrator,
  createJob: queueCreateJob,
  listJobs: queueListJobs,
  getJob: queueGetJob,
  pauseJob: queuePauseJob,
  resumeJob: queueResumeJob,
  cancelJob: queueCancelJob,
  retryJob: queueRetryJob,
  updateDelay: queueUpdateDelay,
  startDaemon: startOrchestratorDaemon,
};

export default queue;
