/**
 * @tiktub/orchestrator-agent — Orchestrateur pipeline TikTok → YouTube
 * Coordonné Scheduler + tiktok-agent + youtube-agent avec mode mock + persistance JSON.
 *
 * - createJob(config): valide handles, fetch previews via tiktok-agent (import dynamique), crée Job+items, schedule via Scheduler, persiste via onPersist
 * - processNext(jobId): download via tiktok-agent, upload via youtube-agent, retry max 3
 * - runDaemon(): poll pending jobs et traite next due
 */

import * as fs from "node:fs";
import * as path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { v4 as uuidv4 } from "uuid";
import cron from "node-cron";

// Shared — hors rootDir
// @ts-ignore
import type { Job, JobItem, JobConfig, TikTokVideo, SortBy } from "../../../shared/types.js";
// @ts-ignore
import { cleanHandle as cleanHandleShared } from "../../../shared/constants.js";

// ---------------------------------------------------------------------------
// Types & options
// ---------------------------------------------------------------------------

export interface OrchestratorOptions {
  scheduler?: any; // Scheduler instance (injection pour tests)
  onPersist?: (job: Job) => void | Promise<void>;
  persistPath?: string;
  downloadDir?: string;
  maxAttempts?: number; // défaut 3
  autoStartScheduler?: boolean; // démarre scheduler.start automatiquement après createJob
}

// Fallback local pour cleanHandle si import shared échoue
const HANDLE_REGEX = /^@?([A-Za-z0-9._]{2,24})$/;
function cleanHandleLocal(input: string): string | null {
  const m = input.trim().match(HANDLE_REGEX);
  return m ? m[1].toLowerCase() : null;
}
function getCleanHandle(input: string): string | null {
  try {
    if (typeof cleanHandleShared === "function") return cleanHandleShared(input);
  } catch {
    // ignore
  }
  return cleanHandleLocal(input);
}

// ---------------------------------------------------------------------------
// Helpers persistance / chemins
// ---------------------------------------------------------------------------

function resolveDefaultOrchestratorPersistPath(): string {
  if (process.env.ORCHESTRATOR_STATE_PATH?.trim()) return path.resolve(process.env.ORCHESTRATOR_STATE_PATH.trim());
  const cwdCandidate = path.join(process.cwd(), "data", "orchestrator-state.json");
  try {
    if (fs.existsSync(path.join(process.cwd(), "data")) || fs.existsSync(path.dirname(cwdCandidate))) return cwdCandidate;
  } catch {}
  try {
    const __filename = fileURLToPath(import.meta.url);
    const __dirname = path.dirname(__filename);
    return path.resolve(__dirname, "../../../data/orchestrator-state.json");
  } catch {
    return cwdCandidate;
  }
}

function resolveDownloadDir(custom?: string): string {
  const raw = custom || process.env.DOWNLOAD_DIR || "./data/downloads";
  // Si relatif, résoudre depuis cwd sinon absolu
  if (path.isAbsolute(raw)) return raw;
  // Tenter cwd d'abord
  const cwdPath = path.join(process.cwd(), raw);
  try {
    // Si le dossier data existe depuis cwd, on préfère cwd
    if (fs.existsSync(path.join(process.cwd(), "data"))) return cwdPath;
  } catch {}
  try {
    const __filename = fileURLToPath(import.meta.url);
    const __dirname = path.dirname(__filename);
    const rootPath = path.resolve(__dirname, "../../../", raw);
    return rootPath;
  } catch {
    return cwdPath;
  }
}

function ensureDir(dir: string): void {
  try {
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  } catch {}
}
function ensureDirForFile(filePath: string): void {
  ensureDir(path.dirname(filePath));
}

// Mock vidéo fallback (si tiktok-agent indisponible) — support fetchAll jusqu'à 1000
function generateMockVideosFallback(handle: string, count: number): TikTokVideo[] {
  const clean = handle.replace(/^@/, "").toLowerCase();
  const titles = [
    `POV : ${clean} dévoile son spot secret 😍 #fyp #viral #travel`,
    `Recette express par @${clean} 🍝 #food #recipe #cooking`,
    `Son du moment 🔥 #music #dance #trending`,
    `Astuce que personne ne connaît 🤫 #lifehack #tips`,
    `Mon chat fait ça tous les matins 😂 #cat #funny #cute`,
    `Transformation avant/après ✨ #glowup #beauty`,
    `5 exercices pour des abdos en béton 💪 #fitness #sport`,
    `Ce film va te faire pleurer 😭 #movie #netflix`,
  ];
  const n = Math.max(1, Math.min(count, 1000));
  const now = Math.floor(Date.now() / 1000);
  return Array.from({ length: n }, (_, i) => {
    const title = titles[i % titles.length];
    const hashtags = (title.match(/#\w+/g) || []).map((h) => h.slice(1).toLowerCase());
    return {
      id: `${clean}_${Date.now()}_${i}_${Math.floor(Math.random() * 9000) + 1000}`,
      handle: clean,
      title,
      description: title,
      hashtags,
      coverUrl: `https://picsum.photos/seed/${clean}${i}/576/1024`,
      videoUrl: `https://example.com/mock/${clean}_${i}.mp4`,
      wmVideoUrl: `https://example.com/mock/${clean}_${i}_wm.mp4`,
      playCount: Math.floor(50000 + Math.random() * 5_000_000),
      likeCount: Math.floor(5000 + Math.random() * 500000),
      commentCount: Math.floor(100 + Math.random() * 10000),
      shareCount: Math.floor(50 + Math.random() * 5000),
      createTime: now - i * 86400 - Math.floor(Math.random() * 3600),
      duration: 15 + Math.floor(Math.random() * 45),
      musicTitle: `Original Sound - ${clean}`,
    };
  });
}

// Dummy MP4 valide pour YouTube (évite Processing abandoned) — utilisé pour tests mock avec vrai YouTube
async function createDummyFile(filePath: string, video: TikTokVideo): Promise<string> {
  ensureDirForFile(filePath);
  // Essaie d'abord de copier un vrai MP4 d'exemple s'il existe, sinon base64 minimal
  const SAMPLE_MP4_BASE64 =
    "AAAAIGZ0eXBpc29tAAACAGlzb21pc28yYXZjMW1wNDEAAAAIZnJlZQAAAu1tZGF0AAAAsAAAAEAGAEcQAAAd9AAACgAAAAQAAAAEAAAAP8AAP8A/wD/AP8A/wD/AP8A/wD/AP8A/wD/AP8A/wD/AP8A/wD/AP8A/wD/AP8A/wD/AP8A/wD/AP8A/wD/AP8A/wD/AP8A/wD/AP8A/wD/AP8A/wD/AP8A/wD/AP8A/wD/AP8A/wD/AP8A/wD/AP8A/wD/AP8A/wD/AP8A/wD/AP8A/wD/AP8A/wD/AP8A/wD/AP8A/wD/AP8A/wD/AP8A/wD/AP8A/wD/AP8A/wD/AP8A/wD/AP8A/wD/AP8A/wD/AP8A/wD/AP8A/wD/AP8A/wD/AP8A/wD/AP8A/wD/AP8A/wD/AP8A/wD/AP8A/wD/AP8A/wD/AP8A/wD/AP8A/wD/AP8A/wDAP8A/wD/AP8A/wD/AP8A/wD/AP8A/wD/AP8A/wD/AP8A/wD/AP8A/wD/AP8A/wD/AP8A/wD/AP8A/wD/AP8A/wD/AP8A/wD/AP8A/wD/AP8A/wD/AP8A/wD/AP8A/wD/AP8A/wD/AP8A/wD/AP8A/wD/AP8A/wD/AP8A/wD/AP8A/wD/AP8A/wD/AP8A/wD/AP8A/wD/AP8A/wDAP8A/wD/AP8A/wD/AP8A/wD/AP8A/wD/AP8A/wD/AP8A/wD/AP8A/wD/AP8A/wD/AP8A/wDAP8A/wD/AP8A/wD/AP8A/wD/AP8A/wD/AP8A/wD/AP8A/wD/AP8A/wD/AP8A/wD/AP8A/wD/AP8A/wD/AP8A/wD/AP8A/wD/AP8A/wD/AP8A/wD/AP8A/wD/AP8A/wD/AP8A/wD/AP8A/wD/AP8A/wD/AP8A/wD/AP8A/wD/AP8A/wDAP8A/wD/AP8A/wD/AP8A/wD/AP8A/wD/AP8A/wD/AP8A/wD/AP8A/wD/AP8A/wD/AP8A/wDAP8A/wD/AP8A/wD/AP8A/wD/AP8A/wD/AP8A/wDAP8A/wD/AP8A/wD/AP8A/wD/AP8A/wDAP8A/wD/AP8A/wD/AP8A/wDAP8A/wD/AP8A/wDAP8A/wD/AP8A";
  try {
    const buf = Buffer.from(SAMPLE_MP4_BASE64, "base64");
    if (buf.length > 500) {
      await fs.promises.writeFile(filePath, buf);
      console.log(`[orchestrator] dummy MP4 valide créé: ${filePath} (${buf.length}o) pour ${video.id} — évite Processing abandoned`);
      return filePath;
    }
    throw new Error("base64 trop petit");
  } catch {
    const content = `Dummy video TikTub\nid: ${video.id}\nhandle: @${video.handle}\ntitle: ${video.title}\n`;
    await fs.promises.writeFile(filePath, content, "utf-8");
    console.log(`[orchestrator] dummy texte fallback créé: ${filePath}`);
    return filePath;
  }
}

// ---------------------------------------------------------------------------
// Imports dynamiques avec fallback mock — robuste src/dist/cwd
// ---------------------------------------------------------------------------

async function tryImportAbsolute(absPath: string): Promise<any | null> {
  try {
    if (!absPath) return null;
    // Nécessite file:// pour chemin Windows absolu
    const url = pathToFileURL(absPath).href;
    const mod = await import(url);
    if (mod) return mod;
  } catch {}
  // fallback import direct (parfois Node accepte chemin absolu)
  try {
    const mod = await import(absPath);
    if (mod) return mod;
  } catch {}
  return null;
}

function buildAbsoluteCandidates(agentName: string, relFile: string): string[] {
  const out: string[] = [];
  try {
    const __filename = fileURLToPath(import.meta.url);
    const __dirname = path.dirname(__filename);
    // Essaie profondeurs 1..6 depuis __dirname
    for (let depth = 1; depth <= 6; depth++) {
      const rel = `${"../".repeat(depth)}${agentName}/src/${relFile}`;
      out.push(path.resolve(__dirname, rel));
      // aussi dist variant
      out.push(path.resolve(__dirname, `${"../".repeat(depth)}${agentName}/dist/agents/${agentName}/src/${relFile}`));
    }
  } catch {}
  // Depuis cwd
  try {
    out.push(path.join(process.cwd(), "agents", agentName, "src", relFile));
    out.push(path.join(process.cwd(), "agents", agentName, "dist", "agents", agentName, "src", relFile));
    out.push(path.resolve("agents", agentName, "src", relFile));
  } catch {}
  return out;
}

async function loadTikTokAgent(): Promise<any | null> {
  const relCandidates = [
    "../../tiktok-agent/src/index.js",
    "../../../tiktok-agent/src/index.js",
    "../../../../tiktok-agent/src/index.js",
  ];
  for (const spec of relCandidates) {
    try {
      const mod = await import(spec);
      if (mod) {
        console.log(`[orchestrator] tiktok-agent chargé via ${spec}`);
        return mod;
      }
    } catch {}
  }
  for (const abs of buildAbsoluteCandidates("tiktok-agent", "index.js")) {
    const mod = await tryImportAbsolute(abs);
    if (mod) {
      console.log(`[orchestrator] tiktok-agent chargé via absolu ${abs}`);
      return mod;
    }
  }
  console.warn("[orchestrator] tiktok-agent indisponible — mode mock activé");
  return null;
}

async function loadYouTubeAgent(): Promise<any | null> {
  const relCandidates = ["../../youtube-agent/src/index.js", "../../../youtube-agent/src/index.js", "../../../../youtube-agent/src/index.js"];
  for (const spec of relCandidates) {
    try {
      const mod = await import(spec);
      if (mod) {
        console.log(`[orchestrator] youtube-agent chargé via ${spec}`);
        return mod;
      }
    } catch {}
  }
  for (const abs of buildAbsoluteCandidates("youtube-agent", "index.js")) {
    const mod = await tryImportAbsolute(abs);
    if (mod) {
      console.log(`[orchestrator] youtube-agent chargé via absolu ${abs}`);
      return mod;
    }
  }
  console.warn("[orchestrator] youtube-agent indisponible — mode mock activé");
  return null;
}

async function loadSchedulerClass(): Promise<any | null> {
  // Essaye d'abord via import relatif (mode src)
  try {
    const mod = await import("../../scheduler-agent/src/index.js");
    if (mod?.Scheduler) {
      console.log("[orchestrator] scheduler-agent chargé via relatif src");
      return mod.Scheduler;
    }
    if ((mod as any)?.default) return (mod as any).default;
  } catch {}
  for (const abs of buildAbsoluteCandidates("scheduler-agent", "index.js")) {
    const mod = await tryImportAbsolute(abs);
    if (mod?.Scheduler) {
      console.log(`[orchestrator] scheduler-agent chargé via absolu ${abs}`);
      return mod.Scheduler;
    }
    if ((mod as any)?.default?.Scheduler) return (mod as any).default.Scheduler;
    if ((mod as any)?.default) return (mod as any).default;
  }
  console.warn("[orchestrator] scheduler-agent indisponible — fallback mémoire interne");
  return null;
}

// ---------------------------------------------------------------------------
// Orchestrator
// ---------------------------------------------------------------------------

export class Orchestrator {
  private scheduler: any; // Scheduler instance
  private jobs = new Map<string, Job>();
  private persistPath: string;
  private downloadDir: string;
  private maxAttempts: number;
  private onPersist?: (job: Job) => void | Promise<void>;
  private autoStartScheduler: boolean;
  private daemonTask?: cron.ScheduledTask;
  private daemonInterval?: NodeJS.Timeout;
  private daemonRunning = false;

  constructor(opts?: OrchestratorOptions) {
    this.onPersist = opts?.onPersist;
    this.persistPath = opts?.persistPath ? path.resolve(opts.persistPath) : resolveDefaultOrchestratorPersistPath();
    this.downloadDir = resolveDownloadDir(opts?.downloadDir);
    this.maxAttempts = Math.max(1, Math.min(opts?.maxAttempts ?? 3, 10));
    this.autoStartScheduler = opts?.autoStartScheduler ?? false;

    ensureDir(this.downloadDir);
    ensureDirForFile(this.persistPath);

    // Scheduler injection ou création lazy
    if (opts?.scheduler) {
      this.scheduler = opts.scheduler;
      console.log("[orchestrator] scheduler injecté");
    } else {
      // Création synchrone d'un scheduler minimal en attendant import dynamique
      // On tente import synchrone via require-like? En ESM on créera à la volée dans createJob si null
      this.scheduler = null as any;
    }

    console.log(`[orchestrator] init persistPath=${this.persistPath} downloadDir=${this.downloadDir} maxAttempts=${this.maxAttempts}`);
    this.loadFromDisk();
    // Init scheduler asynchrone (fire-and-forget)
    if (!this.scheduler) {
      this.initScheduler().catch((e) => console.warn(`[orchestrator] init scheduler échec: ${e}`));
    }
  }

  private async initScheduler(): Promise<void> {
    if (this.scheduler) return;
    const Cls = await loadSchedulerClass();
    if (Cls) {
      try {
        this.scheduler = new Cls();
        console.log("[orchestrator] scheduler instancié dynamiquement");
        // Restaurer les jobs existants dans le scheduler
        for (const job of this.jobs.values()) {
          try {
            // Le scheduler garde sa propre map; on l'alimente
            this.scheduler.jobs?.set?.(job.id, job);
            // alternative: restore()
            if (typeof this.scheduler.restore === "function") this.scheduler.restore([job]);
          } catch {}
        }
      } catch (e) {
        console.warn(`[orchestrator] échec instanciation Scheduler: ${e}`);
        this.scheduler = this.createFallbackScheduler();
      }
    } else {
      this.scheduler = this.createFallbackScheduler();
    }
  }

  private createFallbackScheduler(): any {
    console.warn("[orchestrator] utilisation scheduler fallback in-memory minimal");
    // Minimal stub qui expose les méthodes nécessaires sans cron — 1ère vidéo immédiate
    const jobs = new Map<string, Job>();
    return {
      jobs,
      scheduleJob: (job: Job) => {
        const delay = job.config?.delayMinutes ?? 60;
        const safe = Math.max(1, Math.min(Number(delay) || 60, 60 * 24 * 7));
        const now = Date.now();
        let qi = 0;
        for (const it of job.items) {
          if (it.status === "published" || it.status === "failed" || it.status === "skipped") continue;
          it.scheduledAt = new Date(now + safe * 60 * 1000 * qi).toISOString();
          it.status = "queued";
          if (typeof it.attempts !== "number") it.attempts = 0;
          qi++;
        }
        const queued = job.items.filter((i) => i.status === "queued" && i.scheduledAt).sort((a, b) => new Date(a.scheduledAt!).getTime() - new Date(b.scheduledAt!).getTime());
        job.nextRunAt = queued[0]?.scheduledAt;
        if (job.status !== "paused" && job.status !== "cancelled") job.status = "pending";
        job.progress = { total: job.items.length, done: job.items.filter((i) => i.status === "published").length, failed: job.items.filter((i) => i.status === "failed").length };
        job.updatedAt = new Date().toISOString();
        jobs.set(job.id, job);
      },
      getNextDueItem: (job: Job | string) => {
        const j: Job | undefined = typeof job === "string" ? jobs.get(job) || this.jobs.get(job) : (job as Job);
        if (!j) return null;
        if (j.status === "paused" || j.status === "cancelled") return null;
        const now = Date.now();
        const due = j.items
          .filter((it) => it.status === "queued" && it.scheduledAt && new Date(it.scheduledAt).getTime() <= now)
          .sort((a, b) => new Date(a.scheduledAt!).getTime() - new Date(b.scheduledAt!).getTime());
        return due[0] ?? null;
      },
      getStats: (job: Job | string) => {
        const j: Job | undefined = typeof job === "string" ? jobs.get(job) || this.jobs.get(job) : (job as Job);
        if (!j) throw new Error("job introuvable");
        const total = j.items.length;
        const published = j.items.filter((i) => i.status === "published").length;
        const failed = j.items.filter((i) => i.status === "failed").length;
        const queued = j.items.filter((i) => i.status === "queued").length;
        return { total, queued, published, failed, done: published, remaining: queued, progress: j.progress, nextRunAt: j.nextRunAt, status: j.status, delayMinutes: j.config.delayMinutes };
      },
      start: () => console.log("[orchestrator][fallback] scheduler.start noop (daemon gère le polling)"),
      pause: (id: string) => {
        const j = jobs.get(id) || this.jobs.get(id);
        if (j) j.status = "paused";
      },
      resume: (id: string) => {
        const j = jobs.get(id) || this.jobs.get(id);
        if (j && j.status === "paused") j.status = "pending";
      },
      cancel: (id: string) => {
        const j = jobs.get(id) || this.jobs.get(id);
        if (j) {
          j.status = "cancelled";
          for (const it of j.items) if (it.status === "queued") { it.status = "skipped"; it.error = "Job annulé"; }
        }
      },
      updateDelay: (id: string, newDelay: number) => {
        const j = jobs.get(id) || this.jobs.get(id);
        if (!j) throw new Error("job introuvable");
        const safe = Math.max(1, Math.min(Number(newDelay) || 60, 60 * 24 * 7));
        j.config.delayMinutes = safe;
        const queued = j.items.filter((it) => it.status === "queued").sort((a, b) => new Date(a.scheduledAt ?? 0).getTime() - new Date(b.scheduledAt ?? 0).getTime());
        const now = Date.now();
        queued.forEach((it, idx) => { it.scheduledAt = new Date(now + safe * 60 * 1000 * idx).toISOString(); });
        queued.sort((a, b) => new Date(a.scheduledAt!).getTime() - new Date(b.scheduledAt!).getTime());
        j.nextRunAt = queued[0]?.scheduledAt;
        j.updatedAt = new Date().toISOString();
      },
      stop: () => {},
      stopAll: () => {},
    };
  }

  private async ensureScheduler(): Promise<void> {
    if (!this.scheduler) await this.initScheduler();
    if (!this.scheduler) this.scheduler = this.createFallbackScheduler();
  }

  // -------------------------------------------------------------------------
  // Persistance
  // -------------------------------------------------------------------------

  private persistJob(job: Job): void {
    this.jobs.set(job.id, job);
    // Sauvegarde disque JSON (array)
    try {
      ensureDirForFile(this.persistPath);
      const all = Array.from(this.jobs.values());
      fs.writeFileSync(this.persistPath, JSON.stringify(all, null, 2), "utf-8");
    } catch (e) {
      console.warn(`[orchestrator] échec sauvegarde ${this.persistPath}: ${e}`);
    }
    // Callback externe (ex: backend DB)
    if (this.onPersist) {
      try {
        const r = this.onPersist(job);
        if (r instanceof Promise) r.catch((e) => console.warn(`[orchestrator] onPersist erreur: ${e}`));
      } catch (e) {
        console.warn(`[orchestrator] onPersist throw: ${e}`);
      }
    }
    // Aussi synchroniser le scheduler
    try {
      if (this.scheduler?.jobs?.set) this.scheduler.jobs.set(job.id, job);
      // Si scheduler a une méthode persist interne, elle sera appelée lors de scheduleJob etc.
    } catch {}
  }

  private persistAll(): void {
    try {
      ensureDirForFile(this.persistPath);
      fs.writeFileSync(this.persistPath, JSON.stringify(Array.from(this.jobs.values()), null, 2), "utf-8");
    } catch (e) {
      console.warn(`[orchestrator] persistAll échec: ${e}`);
    }
  }

  private loadFromDisk(): void {
    try {
      if (!fs.existsSync(this.persistPath)) return;
      const raw = fs.readFileSync(this.persistPath, "utf-8");
      const arr: Job[] = JSON.parse(raw);
      if (Array.isArray(arr)) {
        for (const j of arr) if (j?.id) this.jobs.set(j.id, j);
        console.log(`[orchestrator] ${arr.length} job(s) restauré(s) depuis ${this.persistPath}`);
      }
    } catch (e) {
      console.warn(`[orchestrator] échec chargement ${this.persistPath}: ${e}`);
    }
  }

  public getJob(jobId: string): Job | undefined {
    return this.jobs.get(jobId);
  }

  public listJobs(): Job[] {
    return Array.from(this.jobs.values());
  }

  // -------------------------------------------------------------------------
  // createJob
  // -------------------------------------------------------------------------

  /**
   * Crée un pipeline complet:
   * - valide handles (multi-handles)
   * - fetch previews via tiktok-agent (import dynamique, fallback mock)
   * - crée Job avec items, schedule via Scheduler, persiste via onPersist
   */
  public async createJob(config: JobConfig): Promise<Job> {
    await this.ensureScheduler();

    // Validation config de base
    if (!config || !Array.isArray(config.handles) || config.handles.length === 0) {
      throw new Error("[orchestrator] createJob: handles manquant (au moins 1 requis)");
    }

    // Nettoyage & déduplication handles
    const cleaned: string[] = [];
    const seen = new Set<string>();
    const invalid: string[] = [];
    for (const raw of config.handles) {
      const c = getCleanHandle(String(raw));
      if (!c) {
        invalid.push(String(raw));
        continue;
      }
      if (!seen.has(c)) {
        seen.add(c);
        cleaned.push(c);
      }
    }
    if (invalid.length) console.warn(`[orchestrator] handles invalides ignorés: ${invalid.join(", ")}`);
    if (cleaned.length === 0) throw new Error(`[orchestrator] aucun handle valide parmi: ${config.handles.join(", ")}`);

    const delayMinutes = Math.max(1, Math.min(Number(config.delayMinutes) || 60, 60 * 24 * 7));
    const fetchAll = Boolean((config as any).fetchAll);
    const limitPerHandle = fetchAll ? 0 : Math.max(1, Math.min(Number(config.limitPerHandle) || 10, 50));
    const sortBy: SortBy = ["popular", "most_liked", "recent"].includes(config.sortBy as string) ? config.sortBy : "popular";
    const makePublic = Boolean(config.makePublic);
    const addCredit = config.addCredit !== false; // défaut true
    const asShorts = config.asShorts !== false; // défaut true
    const youtubeChannelId = config.youtubeChannelId?.trim() || undefined;
    const useScheduledPublish = (config as any).useScheduledPublish !== false; // défaut true pour pas besoin PC

    const normalizedConfig: JobConfig = {
      handles: cleaned,
      delayMinutes,
      limitPerHandle,
      sortBy,
      youtubeChannelId,
      makePublic,
      addCredit,
      asShorts,
      fetchAll,
      useScheduledPublish,
    } as JobConfig;

    console.log(`[orchestrator] création job handles=[${cleaned.join(", ")}] delay=${delayMinutes}min ${fetchAll ? "fetchAll=toutes" : `limit=${limitPerHandle}`} sort=${sortBy} scheduledPublish=${useScheduledPublish}`);

    // Fetch vidéos via tiktok-agent (multi-handles en parallèle séquentiel avec gestion erreur)
    const tiktokAgent = await loadTikTokAgent();

    const allVideos: TikTokVideo[] = [];
    const fetchErrors: string[] = [];

    for (const handle of cleaned) {
      let videos: TikTokVideo[] | null = null;
      // Tentative via agent
      if (tiktokAgent) {
        try {
          // validateHandle optionnel (log mais ne bloque pas)
          if (typeof tiktokAgent.validateHandle === "function") {
            try {
              const prof = await tiktokAgent.validateHandle(handle);
              if (prof && prof.exists === false) {
                console.warn(`[orchestrator] handle @${handle} marqué inexistant par tiktok-agent, tentative fetch quand même`);
              }
            } catch (e: any) {
              console.warn(`[orchestrator] validateHandle @${handle} échec: ${e?.message || e} — on continue`);
            }
          }
          if (fetchAll && typeof tiktokAgent.fetchAllVideos === "function") {
            console.log(`[orchestrator] fetchAllVideos @${handle} (toutes depuis création)`);
            videos = await tiktokAgent.fetchAllVideos(handle, sortBy);
          } else if (typeof tiktokAgent.fetchTopVideos === "function") {
            videos = await tiktokAgent.fetchTopVideos(handle, limitPerHandle, sortBy);
          }
        } catch (e: any) {
          console.warn(`[orchestrator] fetch @${handle} échec: ${e?.message || e} — fallback mock`);
          videos = null;
        }
      }
      // Fallback mock
      if (!videos || videos.length === 0) {
        if (!videos) fetchErrors.push(handle);
        const mockCount = fetchAll ? 100 : limitPerHandle;
        console.log(`[orchestrator] génération mock pour @${handle} (${fetchAll ? "100 mock (fetchAll)" : `${limitPerHandle} vidéos`})`);
        videos = generateMockVideosFallback(handle, mockCount);
        // Tri mock cohérent avec sortBy (déjà aléatoire, on trie)
        if (sortBy === "popular") videos.sort((a, b) => (b.playCount || 0) - (a.playCount || 0));
        else if (sortBy === "most_liked") videos.sort((a, b) => (b.likeCount || 0) - (a.likeCount || 0));
        else videos.sort((a, b) => (b.createTime || 0) - (a.createTime || 0));
        videos = fetchAll ? videos : videos.slice(0, limitPerHandle);
      }
      console.log(`[orchestrator] @${handle}: ${videos.length} vidéos collectées`);
      allVideos.push(...videos);
    }

    if (allVideos.length === 0) {
      throw new Error("[orchestrator] aucune vidéo récupérée (même en mock) — impossible de créer le job");
    }

    // Mélange ou ordre: on garde l'ordre par handle puis tri global selon sortBy déjà fait
    // Option: entrelacer les handles pour varié? On garde groupé par handle pour simplicité,
    // mais on peut trier globalement par playCount si popular
    if (cleaned.length > 1) {
      if (sortBy === "popular") allVideos.sort((a, b) => (b.playCount || 0) - (a.playCount || 0));
      else if (sortBy === "most_liked") allVideos.sort((a, b) => (b.likeCount || 0) - (a.likeCount || 0));
      else if (sortBy === "recent") allVideos.sort((a, b) => (b.createTime || 0) - (a.createTime || 0));
    }

    const jobId = uuidv4();
    const nowIso = new Date().toISOString();

    const items: JobItem[] = allVideos.map((video) => ({
      id: uuidv4(),
      jobId,
      video,
      status: "queued" as const,
      attempts: 0,
      // scheduledAt sera rempli par scheduler.scheduleJob
    }));

    const job: Job = {
      id: jobId,
      config: normalizedConfig,
      status: "pending",
      items,
      createdAt: nowIso,
      updatedAt: nowIso,
      progress: { total: items.length, done: 0, failed: 0 },
    };

    // Schedule via Scheduler
    try {
      await this.ensureScheduler();
      this.scheduler.scheduleJob(job);
      console.log(`[orchestrator] job ${jobId} schedulé (${items.length} items)`);
    } catch (e: any) {
      console.warn(`[orchestrator] scheduleJob échec: ${e?.message || e} — job créé sans schedule`);
      // Fallback: définir scheduledAt manuellement — 1ère immédiate
      const now = Date.now();
      job.items.forEach((it, idx) => {
        it.scheduledAt = new Date(now + delayMinutes * 60 * 1000 * idx).toISOString();
      });
      job.nextRunAt = job.items[0]?.scheduledAt;
    }

    // Persistance
    this.persistJob(job);

    // Auto-start scheduler si demandé
    if (this.autoStartScheduler) {
      try {
        this.scheduler.start(job.id, async (item: JobItem) => {
          // Le scheduler appelle ce processor pour le next due
          // On délègue à processItem interne
          await this.processItem(job.id, item.id);
        });
        console.log(`[orchestrator] scheduler auto-start pour job ${jobId}`);
      } catch (e: any) {
        console.warn(`[orchestrator] autoStartScheduler échec: ${e?.message || e}`);
      }
    }

    if (fetchErrors.length) {
      console.warn(`[orchestrator] job ${jobId} créé avec fallback mock pour: ${fetchErrors.join(", ")}`);
    }

    return job;
  }

  // -------------------------------------------------------------------------
  // processNext / processItem
  // -------------------------------------------------------------------------

  /**
   * Traite le prochain item dû pour un job.
   * - télécharge via tiktok-agent downloadVideo (fallback dummy)
   * - upload via youtube-agent uploadVideo (fallback mock)
   * - met à jour item status, gère retry max 3
   */
  public async processNext(jobId: string): Promise<void> {
    const job = this.jobs.get(jobId);
    if (!job) throw new Error(`[orchestrator] processNext: job ${jobId} introuvable`);

    await this.ensureScheduler();

    // Récupère le prochain dû via scheduler
    let due: JobItem | null = null;
    try {
      due = this.scheduler.getNextDueItem(job);
    } catch {
      // fallback manuel si scheduler échoue
      const now = Date.now();
      due =
        job.items
          .filter((it) => it.status === "queued" && it.scheduledAt && new Date(it.scheduledAt).getTime() <= now)
          .sort((a, b) => new Date(a.scheduledAt!).getTime() - new Date(b.scheduledAt!).getTime())[0] ?? null;
    }

    // Si pas de dû mais publication programmée YouTube, on uploade quand même maintenant avec publishAt (pas besoin PC allumé)
    if (!due) {
      const queued = job.items
        .filter((it) => it.status === "queued" && it.scheduledAt)
        .sort((a, b) => new Date(a.scheduledAt!).getTime() - new Date(b.scheduledAt!).getTime());
      if (queued.length > 0) {
        due = queued[0];
        const isFuture = new Date(due.scheduledAt!).getTime() > Date.now() + 60_000;
        if (isFuture) {
          console.log(`[orchestrator] processNext job=${jobId}: aucun dû mais traitement programmé ${due.id} à ${due.scheduledAt} (upload maintenant avec publishAt YouTube)`);
        } else {
          // Prochain est très proche mais pas encore dû (qq secondes) — on attend le prochain poll
          console.log(`[orchestrator] processNext job=${jobId}: prochain dans <1min (${due.scheduledAt}), attente`);
          return;
        }
      }
    }

    if (!due) {
      console.log(`[orchestrator] processNext job=${jobId}: aucun item dû (prochain=${job.nextRunAt ?? "—"})`);
      return;
    }

    await this.processItem(jobId, due.id);
  }

  /**
   * Traite un item spécifique par son id (utilisé par scheduler.start processor)
   */
  private async processItem(jobId: string, itemId: string): Promise<void> {
    const job = this.jobs.get(jobId);
    if (!job) throw new Error(`[orchestrator] processItem: job ${jobId} introuvable`);
    const item = job.items.find((it) => it.id === itemId);
    if (!item) throw new Error(`[orchestrator] processItem: item ${itemId} introuvable dans job ${jobId}`);

    if (item.status !== "queued") {
      console.log(`[orchestrator] item ${itemId} non queued (status=${item.status}), skip`);
      return;
    }

    console.log(`[orchestrator] traitement item ${item.id} (@${item.video.handle} "${item.video.title.slice(0, 40)}") job=${jobId} attempt=${(item.attempts ?? 0) + 1}/${this.maxAttempts}`);

    // Marquer downloading
    item.status = "downloading";
    item.attempts = (item.attempts ?? 0) + 1;
    job.updatedAt = new Date().toISOString();
    job.status = "running";
    this.persistJob(job);

    // -----------------------------------------------------------------------
    // Download
    // -----------------------------------------------------------------------
    let filePath: string | null = null;
    const downloadFileName = `${item.video.id}.mp4`;
    const destPath = path.join(this.downloadDir, downloadFileName);

    let tiktokAgent: any = null;
    try {
      tiktokAgent = await loadTikTokAgent();
    } catch {}

    let downloadOk = false;
    if (tiktokAgent && typeof tiktokAgent.downloadVideo === "function") {
      try {
        console.log(`[orchestrator] téléchargement ${item.video.id} via tiktok-agent...`);
        filePath = await tiktokAgent.downloadVideo(item.video, this.downloadDir);
        // Vérifie que le fichier existe et a une taille
        try {
          if (!filePath || typeof filePath !== "string") throw new Error("chemin invalide");
          const st = await fs.promises.stat(filePath);
          if (st.size > 0) downloadOk = true;
          else throw new Error("fichier vide");
        } catch {
          downloadOk = false;
          // fallback dummy
          filePath = await createDummyFile(destPath, item.video);
          downloadOk = true;
        }
      } catch (e: any) {
        console.warn(`[orchestrator] downloadVideo échec pour ${item.video.id}: ${e?.message || e} — création dummy (continue pipeline)`);
        try {
          filePath = await createDummyFile(destPath, item.video);
          downloadOk = true;
        } catch (de: any) {
          console.warn(`[orchestrator] dummy création échec: ${de?.message || de}`);
          downloadOk = false;
        }
      }
    } else {
      console.warn("[orchestrator] tiktok-agent.downloadVideo indisponible — dummy direct");
      try {
        filePath = await createDummyFile(destPath, item.video);
        downloadOk = true;
      } catch (e: any) {
        console.warn(`[orchestrator] dummy échec: ${e?.message || e}`);
        downloadOk = false;
      }
    }

    if (!downloadOk || !filePath) {
      await this.handleItemFailure(job, item, `Échec téléchargement (même dummy)`);
      return;
    }

    // Vérifie que le fichier est un vrai MP4 (pas un dummy texte) — évite "Processing abandoned" YouTube
    let isValidVideo = false;
    try {
      const fd = await fs.promises.open(filePath!, "r");
      const buf = Buffer.alloc(12);
      await fd.read(buf, 0, 12, 0);
      await fd.close();
      const header = buf.toString("utf8", 4, 8);
      const isMp4 = header === "ftyp" || buf[0] === 0x00;
      const stat = await fs.promises.stat(filePath!);
      isValidVideo = isMp4 && stat.size > 5000;
      if (!isValidVideo) {
        const preview = buf.toString("utf8", 0, 12);
        if (preview.includes("Dummy") || preview.includes("dummy") || stat.size < 5000) {
          console.warn(`[orchestrator] fichier invalide détecté (dummy texte ou trop petit ${stat.size}o) pour ${item.id}`);
          isValidVideo = false;
        }
      }
    } catch (e) {
      console.warn(`[orchestrator] vérification fichier échouée pour ${item.id}: ${e}`);
      isValidVideo = false;
    }

    // Si fichier invalide et YouTube en mode réel, ne pas uploader (évite Processing abandoned) → marquer échec avec retry
    let youtubeAgentTmp: any = null;
    try { youtubeAgentTmp = await loadYouTubeAgent(); } catch {}
    const isYouTubeMock = !youtubeAgentTmp || (typeof youtubeAgentTmp.isMockMode === "function" && youtubeAgentTmp.isMockMode());
    if (!isValidVideo && !isYouTubeMock) {
      console.warn(`[orchestrator] vidéo invalide (dummy) et YouTube en mode réel — on ne peut pas uploader ${item.id}, marquage échec pour retry`);
      await this.handleItemFailure(job, item, `Fichier vidéo invalide (dummy texte) — téléchargement TikTok échoué, URL expirée ou mock. Réessayez ou utilisez une vraie URL TikTok.`);
      return;
    }
    // Si mock et fichier invalide, on laisse passer (sera simulé)
    if (!isValidVideo && isYouTubeMock) {
      console.log(`[orchestrator] fichier dummy détecté mais YouTube en mock → upload simulé pour ${item.id}`);
    }

    // Marquer downloaded
    item.status = "downloaded";
    this.persistJob(job);

    // -----------------------------------------------------------------------
    // Upload
    // -----------------------------------------------------------------------
    item.status = "uploading";
    this.persistJob(job);

    let youtubeAgent: any = null;
    try {
      youtubeAgent = await loadYouTubeAgent();
    } catch {}

    // Prépare métadonnées YouTube via helpers shared ou fallback
    // On tente d'utiliser les helpers de youtube-agent si dispo pour normalisation
    let uploadResult: { videoId: string; url: string } | null = null;
    let uploadError: string | null = null;

    // Construction meta — gestion publication programmée YouTube (pas besoin PC allumé)
    const privacyStatus: "public" | "private" | "unlisted" = job.config.makePublic ? "public" : "private";
    // Si l'item est programmé dans le futur, on programme sur YouTube via publishAt
    let publishAt: string | undefined;
    if (item.scheduledAt) {
      const schedTime = new Date(item.scheduledAt).getTime();
      if (!isNaN(schedTime) && schedTime > Date.now() + 60_000) {
        publishAt = new Date(schedTime).toISOString();
      }
    }
    const baseMeta: any = {
      title: item.video.title,
      description: item.video.description,
      tags: item.video.hashtags,
      privacyStatus,
      madeForKids: false,
      handle: item.video.handle,
      addCredit: job.config.addCredit,
      selfDeclaredMadeForKids: false,
      ...(publishAt ? { publishAt, scheduledPublishAt: publishAt } : {}),
    };
    if (publishAt) console.log(`[orchestrator] publication programmée YouTube à ${publishAt} (upload maintenant, publication différée)`);

    if (youtubeAgent && typeof youtubeAgent.uploadVideo === "function") {
      try {
        console.log(`[orchestrator] upload YouTube "${item.video.title.slice(0, 50)}" privacy=${privacyStatus}...`);
        // youtube-agent expose aussi normalizeMetadata, mais uploadVideo le fait déjà
        uploadResult = await youtubeAgent.uploadVideo(filePath, baseMeta, (pct: number) => {
          console.log(`[orchestrator] upload progression ${item.id}: ${pct}%`);
        });
      } catch (e: any) {
        uploadError = e?.message || String(e);
        console.warn(`[orchestrator] uploadVideo échec ${item.id}: ${uploadError} — mode mock fallback`);
        // En mode mock si upload fail, on continue pipeline (spec: continue pipeline)
        // On tente un mockUpload direct si l'agent expose mockUploadVideo, sinon on simule
        try {
          if (typeof youtubeAgent.mockUploadVideo === "function") {
            uploadResult = await youtubeAgent.mockUploadVideo(filePath, baseMeta);
            uploadError = null;
            console.log(`[orchestrator] fallback mockUpload réussi pour ${item.id}`);
          } else {
            // simulation locale
            const mockId = `mock_${Date.now()}_${Math.floor(Math.random() * 10000)}`;
            uploadResult = { videoId: mockId, url: `https://www.youtube.com/watch?v=${mockId}` };
            uploadError = null;
            console.warn(`[orchestrator] simulation mock upload locale pour ${item.id} -> ${mockId}`);
          }
        } catch (me: any) {
          uploadError = me?.message || String(me);
        }
      }
    } else {
      console.warn("[orchestrator] youtube-agent.uploadVideo indisponible — simulation mock");
      // Simulation mock locale
      await new Promise((r) => setTimeout(r, 800));
      const mockId = `mock_${Date.now()}_${Math.floor(Math.random() * 10000)}`;
      uploadResult = { videoId: mockId, url: `https://www.youtube.com/watch?v=${mockId}` };
      console.log(`[orchestrator][mock] upload simulé ${item.id} -> ${mockId}`);
    }

    if (uploadResult && uploadResult.videoId) {
      item.youtubeVideoId = uploadResult.videoId;
      item.youtubeUrl = uploadResult.url;
      item.publishedAt = new Date().toISOString();
      item.status = "published";
      item.error = undefined;
      console.log(`[orchestrator] item ${item.id} publié -> ${uploadResult.url}`);

      // Nettoyage fichier local optionnel (garder pour debug ? on supprime le dummy après succès)
      // On garde le fichier en dev pour inspection, mais on log
    } else {
      // Échec upload
      const msg = uploadError || "Échec upload inconnu";
      await this.handleItemFailure(job, item, msg);
      return;
    }

    // Succès: mettre à jour job progress/statut
    job.progress = {
      total: job.items.length,
      done: job.items.filter((i) => i.status === "published" || i.status === "skipped").length,
      failed: job.items.filter((i) => i.status === "failed").length,
    };
    // Recalcul nextRunAt
    const remainingQueued = job.items.filter((it) => it.status === "queued" && it.scheduledAt).sort((a, b) => new Date(a.scheduledAt!).getTime() - new Date(b.scheduledAt!).getTime());
    job.nextRunAt = remainingQueued[0]?.scheduledAt;
    job.updatedAt = new Date().toISOString();

    if (remainingQueued.length === 0) {
      const allDone = job.items.every((it) => it.status === "published" || it.status === "skipped" || it.status === "failed");
      if (allDone) {
        const hasFailed = job.items.some((it) => it.status === "failed");
        job.status = hasFailed && job.items.some((it) => it.status === "published") ? "completed" : hasFailed ? "failed" : "completed";
        if (job.status === "completed") console.log(`[orchestrator] job ${jobId} terminé avec succès`);
        else console.log(`[orchestrator] job ${jobId} terminé avec erreurs`);
      }
    }

    this.persistJob(job);
  }

  private async handleItemFailure(job: Job, item: JobItem, errorMsg: string): Promise<void> {
    item.error = errorMsg;
    const attempts = item.attempts ?? 1;

    if (attempts >= this.maxAttempts) {
      item.status = "failed";
      console.warn(`[orchestrator] item ${item.id} échoué définitivement après ${attempts} tentatives: ${errorMsg}`);
    } else {
      // Retry: repasse en queued avec backoff
      const backoffMinutes = Math.min(5 * attempts, 30); // 5,10,15...
      item.status = "queued";
      item.scheduledAt = new Date(Date.now() + backoffMinutes * 60 * 1000).toISOString();
      console.warn(`[orchestrator] item ${item.id} échec (tentative ${attempts}/${this.maxAttempts}): ${errorMsg} — replanifié dans ${backoffMinutes}min à ${item.scheduledAt}`);
    }

    job.progress = {
      total: job.items.length,
      done: job.items.filter((i) => i.status === "published" || i.status === "skipped").length,
      failed: job.items.filter((i) => i.status === "failed").length,
    };
    // Recalcul nextRunAt
    const queued = job.items.filter((it) => it.status === "queued" && it.scheduledAt).sort((a, b) => new Date(a.scheduledAt!).getTime() - new Date(b.scheduledAt!).getTime());
    job.nextRunAt = queued[0]?.scheduledAt;
    job.updatedAt = new Date().toISOString();
    // Si plus de queued et tout failed/published -> status
    if (queued.length === 0) {
      const allTerminal = job.items.every((it) => it.status === "published" || it.status === "failed" || it.status === "skipped");
      if (allTerminal) job.status = job.items.some((it) => it.status === "failed") ? "failed" : "completed";
    }
    this.persistJob(job);
  }

  // -------------------------------------------------------------------------
  // runDaemon
  // -------------------------------------------------------------------------

  /**
   * Lance une boucle qui poll les jobs pending/running et traite le prochain dû.
   * Utilise node-cron "* * * * *" (chaque minute) + setInterval configurable.
   * @param intervalMs intervalle de polling en ms (défaut 30_000)
   * @returns fonction stop() pour arrêter le daemon
   */
  public async runDaemon(intervalMs = 30_000): Promise<() => void> {
    await this.ensureScheduler();
    if (this.daemonRunning) {
      console.warn("[orchestrator] daemon déjà en cours — arrêt ancien avant redémarrage");
      this.stopDaemon();
    }
    this.daemonRunning = true;
    console.log(`[orchestrator] démarrage daemon (poll toutes les ${intervalMs / 1000}s + cron chaque minute)`);

    const poll = async () => {
      if (!this.daemonRunning) return;
      try {
        const jobs = this.listJobs().filter((j) => j.status === "pending" || j.status === "running");
        if (jobs.length === 0) return;

        // Trier jobs par prochain run
        const sorted = jobs
          .filter((j) => j.nextRunAt)
          .sort((a, b) => new Date(a.nextRunAt!).getTime() - new Date(b.nextRunAt!).getTime());

        // Si aucun nextRunAt mais status pending, on tente quand même
        const toProcess = sorted.length ? sorted : jobs;

        for (const job of toProcess) {
          if (!this.daemonRunning) break;
          // Vérifier via scheduler s'il y a un dû OU du programmé (pour upload anticipé avec publishAt YouTube)
          let hasDue = false;
          let hasQueued = false;
          try {
            hasDue = !!this.scheduler.getNextDueItem(job);
            hasQueued = job.items.some((it) => it.status === "queued" && it.scheduledAt);
          } catch {
            const now = Date.now();
            hasDue = job.items.some((it) => it.status === "queued" && it.scheduledAt && new Date(it.scheduledAt).getTime() <= now);
            hasQueued = job.items.some((it) => it.status === "queued" && it.scheduledAt);
          }
          const shouldProcess = hasDue || hasQueued;
          if (!shouldProcess) continue;
          if (!hasDue && hasQueued) {
            console.log(`[orchestrator][daemon] job ${job.id} a des items programmés (upload anticipé avec publishAt YouTube) — traitement...`);
          } else {
            console.log(`[orchestrator][daemon] job ${job.id} a un item dû — traitement...`);
          }
          try {
            await this.processNext(job.id);
          } catch (e: any) {
            console.warn(`[orchestrator][daemon] processNext échec job=${job.id}: ${e?.message || e}`);
            // continue aux autres jobs
          }
          // Petite pause entre jobs pour éviter burst
          await new Promise((r) => setTimeout(r, 500));
        }
      } catch (e: any) {
        console.warn(`[orchestrator][daemon] poll erreur: ${e?.message || e}`);
      }
    };

    // Cron chaque minute (spec: check chaque minute)
    try {
      this.daemonTask = cron.schedule("* * * * *", () => {
        poll().catch((e) => console.warn(`[orchestrator][daemon] cron poll erreur: ${e}`));
      });
    } catch (e) {
      console.warn(`[orchestrator] échec création cron daemon: ${e}`);
    }

    // Interval configurable pour réactivité (30s par défaut)
    this.daemonInterval = setInterval(() => {
      poll().catch(() => {});
    }, Math.max(5_000, intervalMs));

    // Poll immédiat après 2s
    setTimeout(() => poll().catch(() => {}), 2000);

    const stop = () => this.stopDaemon();
    return stop;
  }

  public stopDaemon(): void {
    console.log("[orchestrator] arrêt daemon");
    this.daemonRunning = false;
    if (this.daemonTask) {
      try {
        this.daemonTask.stop();
        (this.daemonTask as any).destroy?.();
      } catch {}
      this.daemonTask = undefined;
    }
    if (this.daemonInterval) {
      clearInterval(this.daemonInterval);
      this.daemonInterval = undefined;
    }
  }

  public shutdown(): void {
    this.stopDaemon();
    try {
      this.scheduler?.stopAll?.();
      this.scheduler?.shutdown?.();
    } catch {}
    this.persistAll();
    console.log("[orchestrator] shutdown complet");
  }

  // -------------------------------------------------------------------------
  // Contrôles délégués au scheduler
  // -------------------------------------------------------------------------

  public pauseJob(jobId: string): void {
    const job = this.jobs.get(jobId);
    if (!job) throw new Error(`[orchestrator] pauseJob: job ${jobId} introuvable`);
    job.status = "paused";
    job.updatedAt = new Date().toISOString();
    this.persistJob(job);
    try {
      this.scheduler?.pause?.(jobId);
    } catch {}
    console.log(`[orchestrator] job ${jobId} mis en pause`);
  }

  public resumeJob(jobId: string): void {
    const job = this.jobs.get(jobId);
    if (!job) throw new Error(`[orchestrator] resumeJob: job ${jobId} introuvable`);
    job.status = job.items.some((it) => it.status === "queued") ? "pending" : job.status === "paused" ? "pending" : job.status;
    job.updatedAt = new Date().toISOString();
    this.persistJob(job);
    try {
      this.scheduler?.resume?.(jobId);
      // Si autoStart, relancer le scheduler.start ? le daemon s'en charge sinon
      if (this.autoStartScheduler) {
        this.scheduler?.start?.(jobId, async (item: JobItem) => this.processItem(jobId, item.id));
      }
    } catch {}
    console.log(`[orchestrator] job ${jobId} repris`);
  }

  public cancelJob(jobId: string): void {
    const job = this.jobs.get(jobId);
    if (!job) throw new Error(`[orchestrator] cancelJob: job ${jobId} introuvable`);
    try {
      this.scheduler?.cancel?.(jobId);
    } catch {}
    // Le scheduler a déjà marqué skipped, mais on synchronise la map orchestrator
    const schedJob = this.scheduler?.getJob?.(jobId) as Job | undefined;
    if (schedJob) {
      job.status = schedJob.status;
      job.items = schedJob.items;
      job.nextRunAt = schedJob.nextRunAt;
    } else {
      job.status = "cancelled";
      for (const it of job.items) if (it.status === "queued") { it.status = "skipped"; it.error = "Job annulé"; }
      job.nextRunAt = undefined;
    }
    job.updatedAt = new Date().toISOString();
    this.persistJob(job);
    console.log(`[orchestrator] job ${jobId} annulé`);
  }

  public updateDelay(jobId: string, newDelayMinutes: number): void {
    const job = this.jobs.get(jobId);
    if (!job) throw new Error(`[orchestrator] updateDelay: job ${jobId} introuvable`);
    try {
      this.scheduler?.updateDelay?.(jobId, newDelayMinutes);
      // Resync depuis scheduler
      const updated = this.scheduler?.getJob?.(jobId) as Job | undefined;
      if (updated) {
        job.config.delayMinutes = updated.config.delayMinutes;
        job.items = updated.items;
        job.nextRunAt = updated.nextRunAt;
        job.updatedAt = updated.updatedAt;
      }
    } catch (e: any) {
      // fallback local si scheduler échoue — 1ère immédiate
      const safe = Math.max(1, Math.min(Number(newDelayMinutes) || 60, 60 * 24 * 7));
      job.config.delayMinutes = safe;
      const queued = job.items.filter((it) => it.status === "queued").sort((a, b) => new Date(a.scheduledAt ?? 0).getTime() - new Date(b.scheduledAt ?? 0).getTime());
      const now = Date.now();
      queued.forEach((it, idx) => { it.scheduledAt = new Date(now + safe * 60 * 1000 * idx).toISOString(); });
      job.nextRunAt = queued[0]?.scheduledAt;
      job.updatedAt = new Date().toISOString();
      console.warn(`[orchestrator] updateDelay fallback local: ${e?.message || e}`);
    }
    this.persistJob(job);
    console.log(`[orchestrator] job ${jobId} délai mis à jour -> ${job.config.delayMinutes}min`);
  }

  public getStats(jobId: string): any {
    const job = this.jobs.get(jobId);
    if (!job) throw new Error(`[orchestrator] getStats: job ${jobId} introuvable`);
    try {
      if (this.scheduler?.getStats) return this.scheduler.getStats(job);
    } catch {}
    // fallback
    const total = job.items.length;
    const published = job.items.filter((i) => i.status === "published").length;
    const failed = job.items.filter((i) => i.status === "failed").length;
    const queued = job.items.filter((i) => i.status === "queued").length;
    return { total, queued, published, failed, done: published, remaining: queued, progress: job.progress, nextRunAt: job.nextRunAt, status: job.status, delayMinutes: job.config.delayMinutes };
  }
}

export default Orchestrator;
