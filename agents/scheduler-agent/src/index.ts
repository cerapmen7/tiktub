/**
 * @tiktub/scheduler-agent — Scheduler en mémoire + node-cron
 * Gère la queue d'upload avec délais, cron, pause/resume, persistance JSON.
 *
 * Pas de Redis/BullMQ — simple Map + cron pour simplicité dev.
 * Persistance: JSON file si pas de DB backend (data/scheduler-state.json)
 */

import cron from "node-cron";
import * as fs from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";

// Shared types — hors rootDir, d'où @ts-ignore pour NodeNext
// @ts-ignore
import type { Job, JobItem, JobConfig } from "../../../shared/types.js";

// ---------------------------------------------------------------------------
// Types locaux fallback si import shared échoue à la compilation
// ---------------------------------------------------------------------------
// On garde les imports ci-dessus pour le runtime ; ces interfaces servent de fallback
// pour le typecheck local (skipLibCheck true les rend optionnelles).

export interface SchedulerStats {
  total: number;
  queued: number;
  downloading: number;
  downloaded: number;
  uploading: number;
  published: number;
  failed: number;
  skipped: number;
  done: number; // published + skipped
  remaining: number; // queued + downloading + uploading
  progress: { total: number; done: number; failed: number };
  nextRunAt?: string;
  status: string;
  delayMinutes: number;
}

export interface SchedulerOptions {
  persistPath?: string;
  tickIntervalMs?: number; // fallback si cron non utilisé (défaut 60_000)
  autoPersist?: boolean;
  onPersist?: (jobs: Job[]) => void | Promise<void>;
}

// ---------------------------------------------------------------------------
// Helpers persistance
// ---------------------------------------------------------------------------

function resolveDefaultPersistPath(): string {
  // 1) ENV var
  if (process.env.SCHEDULER_STATE_PATH?.trim()) {
    return path.resolve(process.env.SCHEDULER_STATE_PATH.trim());
  }
  // 2) cwd/data/scheduler-state.json
  const cwdCandidate = path.join(process.cwd(), "data", "scheduler-state.json");
  try {
    const dir = path.dirname(cwdCandidate);
    if (fs.existsSync(dir) || fs.existsSync(path.join(process.cwd(), "data"))) {
      return cwdCandidate;
    }
  } catch {
    // ignore
  }
  // 3) fallback relatif au fichier (../../../data/...)
  try {
    const __filename = fileURLToPath(import.meta.url);
    const __dirname = path.dirname(__filename);
    // src/index.ts => ../../.. => project root
    const rootCandidate = path.resolve(__dirname, "../../../data/scheduler-state.json");
    return rootCandidate;
  } catch {
    // ignore
  }
  return cwdCandidate;
}

function ensureDirForFile(filePath: string): void {
  try {
    const dir = path.dirname(filePath);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  } catch {
    // ignore
  }
}

// ---------------------------------------------------------------------------
// Scheduler
// ---------------------------------------------------------------------------

export class Scheduler {
  private jobs = new Map<string, Job>();
  private cronTasks = new Map<string, cron.ScheduledTask>();
  private intervals = new Map<string, NodeJS.Timeout>();
  private paused = new Set<string>();
  private persistPath: string;
  private autoPersist: boolean;
  private onPersist?: SchedulerOptions["onPersist"];
  private tickIntervalMs: number;

  constructor(opts?: SchedulerOptions) {
    this.persistPath = opts?.persistPath ? path.resolve(opts.persistPath) : resolveDefaultPersistPath();
    this.autoPersist = opts?.autoPersist ?? true;
    this.onPersist = opts?.onPersist;
    this.tickIntervalMs = opts?.tickIntervalMs ?? 60_000;
    console.log(`[scheduler] initialisé persistPath=${this.persistPath} tick=${this.tickIntervalMs}ms`);
    this.loadFromDisk();
  }

  // -------------------------------------------------------------------------
  // Persistence interne
  // -------------------------------------------------------------------------

  private persist(): void {
    if (!this.autoPersist) return;
    try {
      ensureDirForFile(this.persistPath);
      const arr = Array.from(this.jobs.values());
      fs.writeFileSync(this.persistPath, JSON.stringify(arr, null, 2), "utf-8");
      // callback externe si fourni
      if (this.onPersist) {
        try {
          const maybe = this.onPersist(arr);
          if (maybe instanceof Promise) maybe.catch((e) => console.warn(`[scheduler] onPersist erreur: ${e}`));
        } catch (e) {
          console.warn(`[scheduler] onPersist throw: ${e}`);
        }
      }
    } catch (e) {
      console.warn(`[scheduler] échec persistance ${this.persistPath}: ${e}`);
    }
  }

  private loadFromDisk(): void {
    try {
      if (!fs.existsSync(this.persistPath)) return;
      const raw = fs.readFileSync(this.persistPath, "utf-8");
      const arr: Job[] = JSON.parse(raw);
      if (Array.isArray(arr)) {
        for (const j of arr) {
          if (j?.id) {
            this.jobs.set(j.id, j);
            if (j.status === "paused") this.paused.add(j.id);
          }
        }
        console.log(`[scheduler] ${arr.length} job(s) restauré(s) depuis ${this.persistPath}`);
      }
    } catch (e) {
      console.warn(`[scheduler] échec chargement persist ${this.persistPath}: ${e}`);
    }
  }

  /** Exporte l'état courant vers JSON (utile pour backend DB) */
  public dump(): Job[] {
    return Array.from(this.jobs.values());
  }

  /** Importe un tableau de jobs (restauration DB) */
  public restore(jobs: Job[]): void {
    for (const j of jobs) {
      if (j?.id) this.jobs.set(j.id, j);
    }
    this.persist();
  }

  /** Accès lecture à un job */
  public getJob(jobId: string): Job | undefined {
    return this.jobs.get(jobId);
  }

  /** Liste tous les jobs */
  public listJobs(): Job[] {
    return Array.from(this.jobs.values());
  }

  // -------------------------------------------------------------------------
  // scheduleJob
  // -------------------------------------------------------------------------

  /**
   * Calcule scheduledAt pour chaque item basé sur delayMinutes.
   * Formule: item0 = now + delay, item1 = now + 2*delay, etc.
   * Met status à "queued" pour les items non terminés.
   */
  public scheduleJob(job: Job): void {
    if (!job || !job.id) throw new Error("[scheduler] scheduleJob: job invalide (id manquant)");
    if (!Array.isArray(job.items)) job.items = [];

    const rawDelay = job.config?.delayMinutes ?? 60;
    const safeDelay = Math.max(1, Math.min(Number(rawDelay) || 60, 60 * 24 * 7)); // 1 min .. 7 jours
    const now = Date.now();

    let queueIndex = 0;
    for (let i = 0; i < job.items.length; i++) {
      const item = job.items[i];
      // On ne replanifie que les items non terminés
      if (item.status === "published" || item.status === "failed" || item.status === "skipped") continue;
      // queued, downloading etc -> on (re)met à queued avec nouveau schedule
      // Pour respecter l'ordre d'origine, on utilise queueIndex pour le calcul
      item.scheduledAt = new Date(now + safeDelay * 60 * 1000 * (queueIndex + 1)).toISOString();
      item.status = "queued";
      if (typeof item.attempts !== "number") item.attempts = 0;
      queueIndex++;
    }

    // Trier les items queued par scheduledAt reste implicite via l'ordre d'insertion,
    // mais on recalcule nextRunAt comme le plus tôt
    const queued = job.items
      .filter((it) => it.status === "queued" && it.scheduledAt)
      .sort((a, b) => new Date(a.scheduledAt!).getTime() - new Date(b.scheduledAt!).getTime());

    job.nextRunAt = queued[0]?.scheduledAt;
    // Si le job était cancelled, on ne le repasse pas en pending
    if (job.status !== "paused" && job.status !== "cancelled") {
      // S'il reste des items queued -> pending/running, sinon completed si tout published
      const hasQueued = queued.length > 0;
      const allDone = job.items.length > 0 && job.items.every((it) => it.status === "published" || it.status === "skipped");
      const hasFailed = job.items.some((it) => it.status === "failed");
      if (allDone) job.status = "completed";
      else if (hasQueued && job.status !== "running") job.status = "pending";
      else if (!hasQueued && hasFailed) job.status = "failed";
    }
    job.progress = this.computeProgress(job);
    job.updatedAt = new Date().toISOString();
    if (!job.createdAt) job.createdAt = job.updatedAt;

    this.jobs.set(job.id, job);
    this.persist();

    console.log(
      `[scheduler] scheduleJob job=${job.id} items=${job.items.length} queued=${queued.length} delay=${safeDelay}min prochain=${job.nextRunAt ?? "—"}`
    );
  }

  private computeProgress(job: Job): { total: number; done: number; failed: number } {
    const total = job.items.length;
    const done = job.items.filter((i) => i.status === "published" || i.status === "skipped").length;
    const failed = job.items.filter((i) => i.status === "failed").length;
    return { total, done, failed };
  }

  // -------------------------------------------------------------------------
  // getNextDueItem
  // -------------------------------------------------------------------------

  /**
   * Retourne le plus ancien item queued dont scheduledAt <= now.
   * Si job est un id string, lookup interne.
   */
  public getNextDueItem(job: Job | string): JobItem | null {
    const target: Job | undefined = typeof job === "string" ? this.jobs.get(job) : job;
    if (!target) {
      console.warn(`[scheduler] getNextDueItem: job introuvable ${typeof job === "string" ? job : (job as Job)?.id}`);
      return null;
    }
    if (this.paused.has(target.id) || target.status === "paused" || target.status === "cancelled") return null;

    const now = Date.now();
    const due = target.items
      .filter((it) => it.status === "queued" && it.scheduledAt && new Date(it.scheduledAt).getTime() <= now)
      .sort((a, b) => new Date(a.scheduledAt!).getTime() - new Date(b.scheduledAt!).getTime());

    return due[0] ?? null;
  }

  /**
   * Variante utile pour l'orchestrator: récupère le prochain dû parmi tous les jobs.
   */
  public getNextDueItemGlobal(): { job: Job; item: JobItem } | null {
    const now = Date.now();
    let best: { job: Job; item: JobItem; time: number } | null = null;
    for (const job of this.jobs.values()) {
      if (this.paused.has(job.id) || job.status === "paused" || job.status === "cancelled" || job.status === "completed") continue;
      const candidate = this.getNextDueItem(job);
      if (!candidate) continue;
      const t = new Date(candidate.scheduledAt!).getTime();
      if (t <= now && (!best || t < best.time)) best = { job, item: candidate, time: t };
    }
    return best ? { job: best.job, item: best.item } : null;
  }

  // -------------------------------------------------------------------------
  // start / pause / resume / cancel
  // -------------------------------------------------------------------------

  /**
   * Lance un intervalle (cron chaque minute) qui check les items dus et appelle processor(item).
   * Le processor est typiquement orchestrator.processNextItem.
   * - Utilise node-cron "* * * * *" + setInterval fallback
   * - Si déjà démarré pour ce jobId, redémarre
   */
  public start(jobId: string, processor: (item: JobItem) => Promise<void>): void {
    const job = this.jobs.get(jobId);
    if (!job) {
      console.warn(`[scheduler] start: job ${jobId} introuvable`);
      throw new Error(`[scheduler] job ${jobId} introuvable`);
    }
    this.stop(jobId); // nettoie ancien si existe

    console.log(`[scheduler] démarrage scheduler job=${jobId} (tick chaque minute)`);

    // Marquer running si pending
    if (job.status === "pending") {
      job.status = "running";
      job.updatedAt = new Date().toISOString();
      this.persist();
    }
    this.paused.delete(jobId);

    const tick = async () => {
      try {
        const current = this.jobs.get(jobId);
        if (!current) return;
        if (this.paused.has(jobId) || current.status === "paused" || current.status === "cancelled" || current.status === "completed") return;

        const due = this.getNextDueItem(current);
        if (!due) return;

        console.log(`[scheduler] tick dû job=${jobId} item=${due.id} handle=@${due.video.handle} scheduledAt=${due.scheduledAt}`);
        // Le processor gère status (downloading -> published/failed) et la persistance
        await processor(due);

        // Après traitement, recalculer nextRunAt et progress
        const updated = this.jobs.get(jobId);
        if (updated) {
          updated.progress = this.computeProgress(updated);
          const remainingQueued = updated.items.filter((it) => it.status === "queued" && it.scheduledAt).sort((a, b) => new Date(a.scheduledAt!).getTime() - new Date(b.scheduledAt!).getTime());
          updated.nextRunAt = remainingQueued[0]?.scheduledAt;
          updated.updatedAt = new Date().toISOString();

          // Complétion
          const allPublished = updated.items.length > 0 && updated.items.every((it) => it.status === "published" || it.status === "skipped");
          const hasFailedAll = updated.items.length > 0 && updated.items.every((it) => it.status === "failed" || it.status === "published" || it.status === "skipped") && updated.items.some((it) => it.status === "failed");
          if (allPublished) {
            updated.status = "completed";
            console.log(`[scheduler] job ${jobId} terminé (completed)`);
            this.stop(jobId);
          } else if (!remainingQueued.length && hasFailedAll) {
            updated.status = "failed";
            console.log(`[scheduler] job ${jobId} terminé avec erreurs (failed)`);
            this.stop(jobId);
          }
          this.persist();
        }
      } catch (e: any) {
        console.warn(`[scheduler] tick erreur job=${jobId}: ${e?.message || e}`);
        // ne pas crasher le scheduler
      }
    };

    // Cron chaque minute (production)
    try {
      const task = cron.schedule("* * * * *", () => {
        tick().catch((e) => console.warn(`[scheduler] cron tick erreur: ${e}`));
      });
      // node-cron démarre automatiquement
      this.cronTasks.set(jobId, task);
    } catch (e) {
      console.warn(`[scheduler] échec création cron pour ${jobId}: ${e} — fallback setInterval`);
    }

    // Fallback / complément interval NodeJS (assure exécution même si cron échoue + permet tests rapides)
    const interval = setInterval(() => {
      tick().catch(() => {});
    }, this.tickIntervalMs);

    this.intervals.set(jobId, interval);

    // Tick immédiat décalé de 2s pour dev (sans attendre 1 minute)
    setTimeout(() => tick().catch(() => {}), 2000);
  }

  public pause(jobId: string): void {
    const job = this.jobs.get(jobId);
    if (!job) {
      console.warn(`[scheduler] pause: job ${jobId} introuvable`);
      return;
    }
    console.log(`[scheduler] pause job=${jobId}`);
    this.paused.add(jobId);
    job.status = "paused";
    job.updatedAt = new Date().toISOString();
    // Stop cron/intervals mais on garde le job en mémoire pour resume
    const task = this.cronTasks.get(jobId);
    if (task) {
      try {
        task.stop();
      } catch {}
    }
    const iv = this.intervals.get(jobId);
    if (iv) clearInterval(iv);
    // on ne supprime pas les maps pour pouvoir resume -> on laisse task stopped
    this.persist();
  }

  public resume(jobId: string): void {
    const job = this.jobs.get(jobId);
    if (!job) {
      console.warn(`[scheduler] resume: job ${jobId} introuvable`);
      return;
    }
    if (!this.paused.has(jobId) && job.status !== "paused") {
      console.log(`[scheduler] resume: job ${jobId} n'était pas en pause`);
      return;
    }
    console.log(`[scheduler] resume job=${jobId}`);
    this.paused.delete(jobId);
    job.status = job.items.some((it) => it.status === "queued") ? "running" : job.status === "paused" ? "pending" : job.status;
    job.updatedAt = new Date().toISOString();
    this.persist();
    // Note: le caller doit rappeler start(jobId, processor) pour relancer le tick.
    // On relance automatiquement si une tâche cron était stoppée
    const task = this.cronTasks.get(jobId);
    if (task) {
      try {
        task.start();
        console.log(`[scheduler] cron relancé pour job=${jobId}`);
      } catch {}
    }
    // Si pas de tâche, l'appelant doit faire start(); on log l'info
    if (!this.cronTasks.has(jobId) && !this.intervals.has(jobId)) {
      console.log(`[scheduler] resume: appelez start(jobId, processor) pour relancer le tick`);
    }
  }

  public cancel(jobId: string): void {
    const job = this.jobs.get(jobId);
    if (!job) {
      console.warn(`[scheduler] cancel: job ${jobId} introuvable`);
      return;
    }
    console.log(`[scheduler] cancel job=${jobId}`);
    job.status = "cancelled";
    // Marquer les queued restants comme skipped pour historique
    for (const it of job.items) {
      if (it.status === "queued") {
        it.status = "skipped";
        it.error = "Job annulé";
      }
    }
    job.nextRunAt = undefined;
    job.updatedAt = new Date().toISOString();
    job.progress = this.computeProgress(job);
    this.paused.delete(jobId);
    this.stop(jobId);
    this.persist();
  }

  /** Arrête les timers pour un job (interne) */
  public stop(jobId: string): void {
    const task = this.cronTasks.get(jobId);
    if (task) {
      try {
        task.stop();
        // node-cron >=3 propose .destroy? on tente
        (task as any).destroy?.();
      } catch {}
      this.cronTasks.delete(jobId);
    }
    const iv = this.intervals.get(jobId);
    if (iv) {
      clearInterval(iv);
      this.intervals.delete(jobId);
    }
  }

  /** Arrête tous les schedulers */
  public stopAll(): void {
    for (const id of Array.from(this.cronTasks.keys())) this.stop(id);
    for (const id of Array.from(this.intervals.keys())) {
      const iv = this.intervals.get(id);
      if (iv) clearInterval(iv);
    }
    this.intervals.clear();
    console.log("[scheduler] tous les schedulers arrêtés");
  }

  /** Alias pour compatibilité */
  public shutdown(): void {
    this.stopAll();
  }

  // -------------------------------------------------------------------------
  // updateDelay
  // -------------------------------------------------------------------------

  /**
   * Recalcule scheduledAt pour les items queued restants avec le nouveau délai.
   * Formule: now + newDelay*(i+1) pour i dans [0..queued.length-1] trié par ancien scheduledAt.
   */
  public updateDelay(jobId: string, newDelayMinutes: number): void {
    const job = this.jobs.get(jobId);
    if (!job) {
      console.warn(`[scheduler] updateDelay: job ${jobId} introuvable`);
      throw new Error(`[scheduler] job ${jobId} introuvable`);
    }
    const safeDelay = Math.max(1, Math.min(Number(newDelayMinutes) || 60, 60 * 24 * 7));
    console.log(`[scheduler] updateDelay job=${jobId} ${job.config.delayMinutes} -> ${safeDelay}min`);

    job.config.delayMinutes = safeDelay;

    const queued = job.items
      .filter((it) => it.status === "queued")
      .sort((a, b) => new Date(a.scheduledAt ?? 0).getTime() - new Date(b.scheduledAt ?? 0).getTime());

    const now = Date.now();
    queued.forEach((item, idx) => {
      item.scheduledAt = new Date(now + safeDelay * 60 * 1000 * (idx + 1)).toISOString();
    });

    // Mettre à jour nextRunAt et persister
    const sorted = queued.sort((a, b) => new Date(a.scheduledAt!).getTime() - new Date(b.scheduledAt!).getTime());
    job.nextRunAt = sorted[0]?.scheduledAt;
    job.updatedAt = new Date().toISOString();
    job.progress = this.computeProgress(job);
    this.persist();

    console.log(`[scheduler] nouveau planning job=${jobId}: ${queued.length} items replanifiés, prochain=${job.nextRunAt ?? "—"}`);
  }

  // -------------------------------------------------------------------------
  // getStats
  // -------------------------------------------------------------------------

  public getStats(job: Job | string): SchedulerStats {
    const target: Job | undefined = typeof job === "string" ? this.jobs.get(job) : job;
    if (!target) throw new Error(`[scheduler] getStats: job introuvable ${typeof job === "string" ? job : (job as any)?.id}`);

    const total = target.items.length;
    const queued = target.items.filter((i) => i.status === "queued").length;
    const downloading = target.items.filter((i) => i.status === "downloading").length;
    const downloaded = target.items.filter((i) => i.status === "downloaded").length;
    const uploading = target.items.filter((i) => i.status === "uploading").length;
    const published = target.items.filter((i) => i.status === "published").length;
    const failed = target.items.filter((i) => i.status === "failed").length;
    const skipped = target.items.filter((i) => i.status === "skipped").length;
    const done = published + skipped;
    const remaining = queued + downloading + downloaded + uploading;

    const progress = target.progress ?? this.computeProgress(target);

    return {
      total,
      queued,
      downloading,
      downloaded,
      uploading,
      published,
      failed,
      skipped,
      done,
      remaining,
      progress,
      nextRunAt: target.nextRunAt,
      status: target.status,
      delayMinutes: target.config.delayMinutes,
    };
  }
}

// Export par défaut pour import dynamique commode
export default Scheduler;
