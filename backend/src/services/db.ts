/**
 * backend/src/services/db.ts — Prisma singleton + fallback JSON/mémoire
 *
 * - Tente d'instancier PrismaClient. Si DB inaccessible/non migrée, fallback vers mémoire + JSON `data/db.json`
 * - Expose helpers pour Jobs, JobItems, YoutubeToken, AppSettings
 * - Ne bloque jamais le dev (try/catch partout)
 */

import * as fs from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";

// Types partagés (fallback local si import échoue)
// @ts-ignore
import type { Job, JobItem, AppSettings, SortBy, JobConfig } from "../../../shared/types.js";

// ---------------------------------------------------------------------------
// Paths & helpers
// ---------------------------------------------------------------------------

function resolveFallbackPath(): string {
  // ENV override
  if (process.env.DB_JSON_PATH?.trim()) return path.resolve(process.env.DB_JSON_PATH.trim());
  // cwd/data/db.json si data existe
  const cwdData = path.join(process.cwd(), "data", "db.json");
  try {
    if (fs.existsSync(path.join(process.cwd(), "data"))) return cwdData;
  } catch {}
  // Depuis ce fichier: ../../.. -> tiktub/data/db.json
  try {
    const __filename = fileURLToPath(import.meta.url);
    const __dirname = path.dirname(__filename);
    // src/services/db.ts -> src -> backend -> tiktub
    const root = path.resolve(__dirname, "../../../data/db.json");
    return root;
  } catch {
    return cwdData;
  }
}

function ensureDirForFile(filePath: string): void {
  try {
    const dir = path.dirname(filePath);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  } catch {}
}

interface FileDbShape {
  jobs: Job[];
  tokens: any | null;
  settings: AppSettings | null;
}

// ---------------------------------------------------------------------------
// Prisma singleton (lazy) + état
// ---------------------------------------------------------------------------

let prisma: any | null = null;
let prismaAvailable: boolean | null = null; // null = non testé, true/false
let initializing: Promise<boolean> | null = null;

const fallbackPath = resolveFallbackPath();
let memoryCache: FileDbShape = { jobs: [], tokens: null, settings: null };
let memoryLoaded = false;

function loadMemoryCache(): void {
  if (memoryLoaded) return;
  try {
    if (fs.existsSync(fallbackPath)) {
      const raw = fs.readFileSync(fallbackPath, "utf-8");
      const parsed = JSON.parse(raw);
      if (parsed && typeof parsed === "object") {
        memoryCache.jobs = Array.isArray(parsed.jobs) ? parsed.jobs : [];
        memoryCache.tokens = parsed.tokens ?? null;
        memoryCache.settings = parsed.settings ?? null;
        console.log(`[db] fallback JSON chargé: ${memoryCache.jobs.length} jobs depuis ${fallbackPath}`);
      }
    }
  } catch (e) {
    console.warn(`[db] échec chargement fallback ${fallbackPath}: ${e}`);
  }
  memoryLoaded = true;
}

function persistMemoryCache(): void {
  try {
    ensureDirForFile(fallbackPath);
    fs.writeFileSync(fallbackPath, JSON.stringify(memoryCache, null, 2), "utf-8");
  } catch (e) {
    console.warn(`[db] échec persistance fallback ${fallbackPath}: ${e}`);
  }
}

async function tryInitPrisma(): Promise<boolean> {
  if (prismaAvailable !== null) return prismaAvailable;
  if (initializing) return initializing;

  initializing = (async () => {
    try {
      // Import dynamique pour éviter crash si @prisma/client non généré
      // @ts-ignore — prisma génère client après `prisma generate`
      const mod = await import("@prisma/client");
      const PrismaClient = (mod as any).PrismaClient;
      if (!PrismaClient) throw new Error("PrismaClient introuvable");

      const candidate = new PrismaClient();
      // Tentative connexion + requête légère
      await candidate.$connect();
      // Test query: tente findMany sur Job (si table n'existe pas -> erreur)
      try {
        await candidate.job.findMany({ take: 1 });
        console.log("[db] Prisma connecté et tables accessibles");
        prisma = candidate;
        prismaAvailable = true;
        return true;
      } catch (tableErr: any) {
        // Table manquante -> fallback mais on garde le client pour migrate future
        console.warn(`[db] Prisma tables inaccessibles (migration manquante?): ${tableErr?.message || tableErr} — fallback JSON`);
        // On garde prisma mais on le considère indisponible pour ne pas bloquer
        try {
          await candidate.$disconnect().catch(() => {});
        } catch {}
        prismaAvailable = false;
        loadMemoryCache();
        return false;
      }
    } catch (e: any) {
      console.warn(`[db] Prisma non disponible (${e?.message || e}) — fallback mémoire + JSON ${fallbackPath}`);
      prismaAvailable = false;
      loadMemoryCache();
      return false;
    } finally {
      initializing = null;
    }
  })();

  return initializing;
}

// Init fire-and-forget (ne bloque pas import)
// tryInitPrisma().catch(() => {});

// ---------------------------------------------------------------------------
// Helpers de conversion Prisma <-> shared types
// ---------------------------------------------------------------------------

function jobRecordToJob(row: any): Job {
  try {
    const handles: string[] = row.handles ? JSON.parse(row.handles) : [];
    const config: JobConfig = row.config ? JSON.parse(row.config) : {
      handles,
      delayMinutes: row.delayMinutes,
      limitPerHandle: row.limitPerHandle,
      sortBy: row.sortBy,
      youtubeChannelId: row.youtubeChannelId || undefined,
      makePublic: !!row.makePublic,
      addCredit: !!row.addCredit,
      asShorts: !!row.asShorts,
    };

    const items: JobItem[] = Array.isArray(row.items) ? row.items.map(itemRecordToItem) : [];

    return {
      id: row.id,
      config,
      status: row.status,
      items,
      createdAt: row.createdAt instanceof Date ? row.createdAt.toISOString() : String(row.createdAt),
      updatedAt: row.updatedAt instanceof Date ? row.updatedAt.toISOString() : String(row.updatedAt),
      nextRunAt: row.nextRunAt ? (row.nextRunAt instanceof Date ? row.nextRunAt.toISOString() : String(row.nextRunAt)) : undefined,
      progress: {
        total: row.progressTotal ?? items.length,
        done: row.progressDone ?? 0,
        failed: row.progressFailed ?? 0,
      },
    };
  } catch (e) {
    console.warn(`[db] jobRecordToJob échec: ${e}`);
    throw e;
  }
}

function itemRecordToItem(row: any): JobItem {
  // videoJson prioritaire
  let video: any = null;
  if (row.videoJson) {
    try {
      video = JSON.parse(row.videoJson);
    } catch {}
  }
  if (!video) {
    // Reconstitue minimal depuis colonnes
    const hashtags = row.hashtags ? JSON.parse(row.hashtags) : [];
    video = {
      id: row.videoId || row.id,
      handle: row.handle || "unknown",
      title: row.title || "",
      description: row.description || row.title || "",
      hashtags,
      coverUrl: row.coverUrl || undefined,
      videoUrl: row.videoUrl || undefined,
      wmVideoUrl: row.wmVideoUrl || undefined,
      playCount: row.playCount ?? undefined,
      likeCount: row.likeCount ?? undefined,
      commentCount: row.commentCount ?? undefined,
      shareCount: row.shareCount ?? undefined,
      createTime: row.createTime ?? undefined,
      duration: row.duration ?? undefined,
      musicTitle: row.musicTitle || undefined,
    };
  }

  return {
    id: row.id,
    jobId: row.jobId,
    video,
    status: row.status,
    youtubeVideoId: row.youtubeVideoId || undefined,
    youtubeUrl: row.youtubeUrl || undefined,
    scheduledAt: row.scheduledAt ? (row.scheduledAt instanceof Date ? row.scheduledAt.toISOString() : String(row.scheduledAt)) : undefined,
    publishedAt: row.publishedAt ? (row.publishedAt instanceof Date ? row.publishedAt.toISOString() : String(row.publishedAt)) : undefined,
    error: row.error || undefined,
    attempts: row.attempts ?? 0,
  };
}

function jobToPrismaCreate(job: Job): any {
  const handlesStr = JSON.stringify(job.config.handles || []);
  return {
    id: job.id,
    handles: handlesStr,
    delayMinutes: job.config.delayMinutes,
    limitPerHandle: job.config.limitPerHandle,
    sortBy: job.config.sortBy,
    youtubeChannelId: job.config.youtubeChannelId || null,
    makePublic: !!job.config.makePublic,
    addCredit: job.config.addCredit !== false,
    asShorts: job.config.asShorts !== false,
    status: job.status,
    nextRunAt: job.nextRunAt ? new Date(job.nextRunAt) : null,
    progressTotal: job.progress?.total ?? job.items.length,
    progressDone: job.progress?.done ?? 0,
    progressFailed: job.progress?.failed ?? 0,
    config: JSON.stringify(job.config),
    // items créés séparément
  };
}

function itemToPrismaCreate(item: JobItem, jobId: string): any {
  const v = item.video as any;
  return {
    id: item.id,
    jobId,
    videoId: v?.id || item.id,
    handle: v?.handle || "unknown",
    title: v?.title || "",
    description: v?.description || v?.title || "",
    hashtags: JSON.stringify(v?.hashtags || []),
    coverUrl: v?.coverUrl || null,
    videoUrl: v?.videoUrl || null,
    wmVideoUrl: v?.wmVideoUrl || null,
    playCount: typeof v?.playCount === "number" ? v.playCount : null,
    likeCount: typeof v?.likeCount === "number" ? v.likeCount : null,
    commentCount: typeof v?.commentCount === "number" ? v.commentCount : null,
    shareCount: typeof v?.shareCount === "number" ? v.shareCount : null,
    createTime: typeof v?.createTime === "number" ? v.createTime : null,
    duration: typeof v?.duration === "number" ? v.duration : null,
    musicTitle: v?.musicTitle || null,
    videoJson: JSON.stringify(v),
    status: item.status,
    youtubeVideoId: item.youtubeVideoId || null,
    youtubeUrl: item.youtubeUrl || null,
    scheduledAt: item.scheduledAt ? new Date(item.scheduledAt) : null,
    publishedAt: item.publishedAt ? new Date(item.publishedAt) : null,
    error: item.error || null,
    attempts: item.attempts ?? 0,
  };
}

// ---------------------------------------------------------------------------
// API publique
// ---------------------------------------------------------------------------

export async function getPrisma(): Promise<any | null> {
  const ok = await tryInitPrisma();
  return ok ? prisma : null;
}

export function isPrismaAvailable(): boolean {
  return prismaAvailable === true;
}

export function getFallbackPath(): string {
  return fallbackPath;
}

// -- Jobs --

export async function dbListJobs(): Promise<Job[]> {
  const p = await getPrisma();
  if (p) {
    try {
      const rows = await p.job.findMany({ include: { items: true }, orderBy: { createdAt: "desc" } });
      return rows.map(jobRecordToJob);
    } catch (e) {
      console.warn(`[db] dbListJobs prisma échec: ${e} — fallback`);
    }
  }
  loadMemoryCache();
  return [...memoryCache.jobs].sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
}

export async function dbGetJob(id: string): Promise<Job | null> {
  const p = await getPrisma();
  if (p) {
    try {
      const row = await p.job.findUnique({ where: { id }, include: { items: true } });
      if (row) return jobRecordToJob(row);
      return null;
    } catch (e) {
      console.warn(`[db] dbGetJob prisma échec: ${e} — fallback`);
    }
  }
  loadMemoryCache();
  return memoryCache.jobs.find((j) => j.id === id) || null;
}

export async function dbCreateJob(job: Job): Promise<Job> {
  const p = await getPrisma();
  if (p) {
    try {
      const data = jobToPrismaCreate(job);
      const created = await p.job.create({
        data: {
          ...data,
          items: {
            create: job.items.map((it) => itemToPrismaCreate(it, job.id)),
          },
        },
        include: { items: true },
      });
      return jobRecordToJob(created);
    } catch (e) {
      console.warn(`[db] dbCreateJob prisma échec: ${e} — fallback`);
    }
  }
  loadMemoryCache();
  memoryCache.jobs.push(job);
  persistMemoryCache();
  return job;
}

export async function dbUpdateJob(job: Job): Promise<Job> {
  const p = await getPrisma();
  if (p) {
    try {
      const data = jobToPrismaCreate(job);
      // Upsert items: delete missing, update/create
      // Simplification: delete all items then recreate (acceptable pour sqlite dev)
      await p.jobItem.deleteMany({ where: { jobId: job.id } });
      const updated = await p.job.update({
        where: { id: job.id },
        data: {
          handles: data.handles,
          delayMinutes: data.delayMinutes,
          limitPerHandle: data.limitPerHandle,
          sortBy: data.sortBy,
          youtubeChannelId: data.youtubeChannelId,
          makePublic: data.makePublic,
          addCredit: data.addCredit,
          asShorts: data.asShorts,
          status: data.status,
          nextRunAt: data.nextRunAt,
          progressTotal: data.progressTotal,
          progressDone: data.progressDone,
          progressFailed: data.progressFailed,
          config: data.config,
          items: {
            create: job.items.map((it) => itemToPrismaCreate(it, job.id)),
          },
        },
        include: { items: true },
      });
      return jobRecordToJob(updated);
    } catch (e) {
      console.warn(`[db] dbUpdateJob prisma échec: ${e} — fallback`);
      // Fallback: try create if not exists
      try {
        const exists = await p.job.findUnique({ where: { id: job.id } });
        if (!exists) return dbCreateJob(job);
      } catch {}
    }
  }
  loadMemoryCache();
  const idx = memoryCache.jobs.findIndex((j) => j.id === job.id);
  if (idx >= 0) memoryCache.jobs[idx] = job;
  else memoryCache.jobs.push(job);
  persistMemoryCache();
  return job;
}

export async function dbDeleteJob(id: string): Promise<void> {
  const p = await getPrisma();
  if (p) {
    try {
      await p.job.delete({ where: { id } });
      return;
    } catch (e) {
      console.warn(`[db] dbDeleteJob prisma échec: ${e} — fallback`);
    }
  }
  loadMemoryCache();
  memoryCache.jobs = memoryCache.jobs.filter((j) => j.id !== id);
  persistMemoryCache();
}

// Pour update partiel (ex: patch delay, status)
export async function dbUpdateJobFields(id: string, patch: Partial<Job> & { config?: Partial<JobConfig> }): Promise<Job | null> {
  const existing = await dbGetJob(id);
  if (!existing) return null;
  // Merge config si patch.config fourni
  let newConfig = existing.config;
  if (patch.config) {
    newConfig = { ...existing.config, ...patch.config };
  }
  const merged: Job = {
    ...existing,
    ...patch,
    config: newConfig,
    // Ne pas écraser items si non fourni
    items: (patch as any).items ?? existing.items,
    updatedAt: new Date().toISOString(),
  };
  // Recalcul progress si items changés
  if ((patch as any).items) {
    merged.progress = {
      total: merged.items.length,
      done: merged.items.filter((i) => i.status === "published" || i.status === "skipped").length,
      failed: merged.items.filter((i) => i.status === "failed").length,
    };
  }
  return dbUpdateJob(merged);
}

// -- YoutubeToken --

export async function dbGetYoutubeToken(): Promise<any | null> {
  const p = await getPrisma();
  if (p) {
    try {
      const row = await p.youtubeToken.findFirst({ orderBy: { updatedAt: "desc" } });
      if (row) {
        if (row.rawJson) {
          try { return JSON.parse(row.rawJson); } catch {}
        }
        return {
          access_token: row.access_token,
          refresh_token: row.refresh_token,
          expiry_date: row.expiry_date ? Number(row.expiry_date) : null,
          token_type: row.token_type,
          scope: row.scope,
          id_token: row.id_token,
        };
      }
      return null;
    } catch (e) {
      console.warn(`[db] dbGetYoutubeToken prisma échec: ${e} — fallback`);
    }
  }
  loadMemoryCache();
  return memoryCache.tokens;
}

export async function dbSaveYoutubeToken(tokens: any): Promise<void> {
  const p = await getPrisma();
  if (p) {
    try {
      const existing = await p.youtubeToken.findFirst();
      const data: any = {
        access_token: tokens.access_token || null,
        refresh_token: tokens.refresh_token || null,
        expiry_date: tokens.expiry_date ? BigInt(tokens.expiry_date) : null,
        token_type: tokens.token_type || null,
        scope: tokens.scope || null,
        id_token: tokens.id_token || null,
        rawJson: JSON.stringify(tokens),
      };
      if (existing) {
        await p.youtubeToken.update({ where: { id: existing.id }, data });
      } else {
        await p.youtubeToken.create({ data });
      }
      return;
    } catch (e) {
      console.warn(`[db] dbSaveYoutubeToken prisma échec: ${e} — fallback`);
    }
  }
  loadMemoryCache();
  memoryCache.tokens = tokens;
  persistMemoryCache();
}

export async function dbClearYoutubeToken(): Promise<void> {
  const p = await getPrisma();
  if (p) {
    try {
      await p.youtubeToken.deleteMany({});
    } catch (e) {
      console.warn(`[db] dbClearYoutubeToken prisma échec: ${e}`);
    }
  }
  loadMemoryCache();
  memoryCache.tokens = null;
  persistMemoryCache();
}

// -- AppSettings --

const DEFAULT_SETTINGS: AppSettings = {
  defaultDelayMinutes: Number(process.env.DEFAULT_DELAY_MINUTES) || 60,
  maxConcurrentUploads: Number(process.env.MAX_CONCURRENT_UPLOADS) || 2,
  downloadDir: process.env.DOWNLOAD_DIR || "./data/downloads",
};

export async function dbGetSettings(): Promise<AppSettings> {
  const p = await getPrisma();
  if (p) {
    try {
      const row = await p.appSettings.findUnique({ where: { id: "settings" } });
      if (row) {
        return {
          defaultDelayMinutes: row.defaultDelayMinutes,
          maxConcurrentUploads: row.maxConcurrentUploads,
          downloadDir: row.downloadDir,
        };
      }
      // Créer si absent
      const created = await p.appSettings.create({
        data: {
          id: "settings",
          defaultDelayMinutes: DEFAULT_SETTINGS.defaultDelayMinutes,
          maxConcurrentUploads: DEFAULT_SETTINGS.maxConcurrentUploads,
          downloadDir: DEFAULT_SETTINGS.downloadDir,
        },
      });
      return {
        defaultDelayMinutes: created.defaultDelayMinutes,
        maxConcurrentUploads: created.maxConcurrentUploads,
        downloadDir: created.downloadDir,
      };
    } catch (e) {
      console.warn(`[db] dbGetSettings prisma échec: ${e} — fallback`);
    }
  }
  loadMemoryCache();
  if (memoryCache.settings) return memoryCache.settings;
  memoryCache.settings = { ...DEFAULT_SETTINGS };
  persistMemoryCache();
  return memoryCache.settings;
}

export async function dbUpdateSettings(patch: Partial<AppSettings>): Promise<AppSettings> {
  const current = await dbGetSettings();
  const merged: AppSettings = {
    defaultDelayMinutes: patch.defaultDelayMinutes ?? current.defaultDelayMinutes,
    maxConcurrentUploads: patch.maxConcurrentUploads ?? current.maxConcurrentUploads,
    downloadDir: patch.downloadDir ?? current.downloadDir,
  };

  // Validation bornes
  merged.defaultDelayMinutes = Math.max(1, Math.min(Number(merged.defaultDelayMinutes) || 60, 60 * 24 * 7));
  merged.maxConcurrentUploads = Math.max(1, Math.min(Number(merged.maxConcurrentUploads) || 2, 10));

  const p = await getPrisma();
  if (p) {
    try {
      const updated = await p.appSettings.upsert({
        where: { id: "settings" },
        update: {
          defaultDelayMinutes: merged.defaultDelayMinutes,
          maxConcurrentUploads: merged.maxConcurrentUploads,
          downloadDir: merged.downloadDir,
        },
        create: {
          id: "settings",
          defaultDelayMinutes: merged.defaultDelayMinutes,
          maxConcurrentUploads: merged.maxConcurrentUploads,
          downloadDir: merged.downloadDir,
        },
      });
      return {
        defaultDelayMinutes: updated.defaultDelayMinutes,
        maxConcurrentUploads: updated.maxConcurrentUploads,
        downloadDir: updated.downloadDir,
      };
    } catch (e) {
      console.warn(`[db] dbUpdateSettings prisma échec: ${e} — fallback`);
    }
  }
  memoryCache.settings = merged;
  persistMemoryCache();
  return merged;
}

// -- Utilitaire pour orchestrator onPersist --

export async function dbPersistJobFromOrchestrator(job: Job): Promise<void> {
  try {
    await dbUpdateJob(job);
  } catch (e) {
    console.warn(`[db] dbPersistJobFromOrchestrator échec: ${e}`);
  }
}

// Export singleton helpers & prisma getter
export const db = {
  getPrisma,
  isPrismaAvailable,
  listJobs: dbListJobs,
  getJob: dbGetJob,
  createJob: dbCreateJob,
  updateJob: dbUpdateJob,
  deleteJob: dbDeleteJob,
  updateJobFields: dbUpdateJobFields,
  persistJob: dbPersistJobFromOrchestrator,
  getYoutubeToken: dbGetYoutubeToken,
  saveYoutubeToken: dbSaveYoutubeToken,
  clearYoutubeToken: dbClearYoutubeToken,
  getSettings: dbGetSettings,
  updateSettings: dbUpdateSettings,
  getFallbackPath,
};

export default db;
