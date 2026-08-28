import { Router } from "express";
import type { Request, Response } from "express";
import { z } from "zod";

import { queue } from "../services/queue.js";
import { db } from "../services/db.js";

const router = Router();

// ---------------------------------------------------------------------------
// Helpers cleanHandle — inline (évite import ESM/CJS cassé en packaged)
// ---------------------------------------------------------------------------

const HANDLE_REGEX = /^@?([A-Za-z0-9._]{2,24})$/;

function cleanHandle(input: string): string | null {
  const m = input.trim().match(HANDLE_REGEX);
  return m ? m[1].toLowerCase() : null;
}
function getCleanHandle(input: string): string | null {
  return cleanHandle(input);
}

// ---------------------------------------------------------------------------
// Zod schemas
// ---------------------------------------------------------------------------

const createJobSchema = z.object({
  handles: z.array(z.string().min(1).max(30)).min(1).max(10),
  delayMinutes: z.number().int().min(1).max(60 * 24 * 7).optional().default(60),
  limitPerHandle: z.number().int().min(1).max(50).optional().default(10),
  sortBy: z.enum(["popular", "most_liked", "recent"]).optional().default("popular"),
  youtubeChannelId: z.string().optional().nullable(),
  makePublic: z.boolean().optional().default(false),
  addCredit: z.boolean().optional().default(true),
  asShorts: z.boolean().optional().default(true),
  fetchAll: z.boolean().optional().default(false),
  useScheduledPublish: z.boolean().optional().default(true),
  // Alias supportés pour compat frontend
  delay: z.number().int().min(1).optional(),
  limit: z.number().int().min(1).optional(),
});

const delayPatchSchema = z.object({
  delayMinutes: z.number().int().min(1).max(60 * 24 * 7),
});

// ---------------------------------------------------------------------------
// POST /api/jobs — création
// ---------------------------------------------------------------------------

router.post("/", async (req: Request, res: Response) => {
  try {
    // Gère alias delay/limit
    const body = { ...req.body };
    if (body.delay !== undefined && body.delayMinutes === undefined) body.delayMinutes = body.delay;
    if (body.limit !== undefined && body.limitPerHandle === undefined) body.limitPerHandle = body.limit;

    const parsed = createJobSchema.safeParse(body);
    if (!parsed.success) {
      res.status(400).json({ success: false, data: null, error: parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join(", ") });
      return;
    }

    const input = parsed.data;

    // Nettoyage handles via cleanHandle
    const cleaned: string[] = [];
    const invalid: string[] = [];
    const seen = new Set<string>();
    for (const raw of input.handles) {
      const c = getCleanHandle(String(raw));
      if (!c) invalid.push(String(raw));
      else if (!seen.has(c)) { seen.add(c); cleaned.push(c); }
    }
    if (invalid.length) {
      res.status(400).json({ success: false, data: null, error: `Handles invalides: ${invalid.join(", ")}` });
      return;
    }
    if (cleaned.length === 0) {
      res.status(400).json({ success: false, data: null, error: "Aucun handle valide" });
      return;
    }

    const config = {
      handles: cleaned,
      delayMinutes: Math.max(1, Math.min(Number(input.delayMinutes) || 60, 60 * 24 * 7)),
      limitPerHandle: input.fetchAll ? 0 : Math.max(1, Math.min(Number(input.limitPerHandle) || 10, 50)),
      sortBy: input.sortBy as "popular" | "most_liked" | "recent",
      youtubeChannelId: input.youtubeChannelId ? String(input.youtubeChannelId).trim() : undefined,
      makePublic: Boolean(input.makePublic),
      addCredit: input.addCredit !== false,
      asShorts: input.asShorts !== false,
      fetchAll: Boolean(input.fetchAll),
      useScheduledPublish: input.useScheduledPublish !== false,
    };

    try {
      const job = await queue.createJob(config);
      res.status(201).json({ success: true, data: job, error: null });
    } catch (e: any) {
      res.status(500).json({ success: false, data: null, error: e?.message || "Échec création job" });
    }
  } catch (err: any) {
    res.status(500).json({ success: false, data: null, error: err?.message || "Erreur création job" });
  }
});

// ---------------------------------------------------------------------------
// GET /api/jobs — liste
// ---------------------------------------------------------------------------

router.get("/", async (_req: Request, res: Response) => {
  try {
    const jobs = await queue.listJobs();
    res.json({ success: true, data: jobs, error: null });
  } catch (err: any) {
    res.status(500).json({ success: false, data: null, error: err?.message || "Erreur liste jobs" });
  }
});

// ---------------------------------------------------------------------------
// GET /api/jobs/:id — détail
// ---------------------------------------------------------------------------

router.get("/:id", async (req: Request, res: Response) => {
  try {
    const id = String(req.params.id || "").trim();
    if (!id) {
      res.status(400).json({ success: false, data: null, error: "id manquant" });
      return;
    }
    const job = await queue.getJob(id);
    if (!job) {
      res.status(404).json({ success: false, data: null, error: `Job ${id} introuvable` });
      return;
    }
    // Enrichir avec stats si possible
    let stats: any = null;
    try {
      const orch = await queue.getOrchestrator();
      if (orch?.getStats) stats = orch.getStats(id);
      else {
        const sched = await queue.getScheduler();
        if (sched?.getStats) stats = sched.getStats(id);
      }
    } catch {}
    res.json({ success: true, data: { ...job, stats }, error: null });
  } catch (err: any) {
    res.status(500).json({ success: false, data: null, error: err?.message || "Erreur get job" });
  }
});

// ---------------------------------------------------------------------------
// POST /api/jobs/:id/pause
// ---------------------------------------------------------------------------

router.post("/:id/pause", async (req: Request, res: Response) => {
  try {
    const id = String(req.params.id || "").trim();
    if (!id) { res.status(400).json({ success: false, data: null, error: "id manquant" }); return; }
    const job = await queue.getJob(id);
    if (!job) { res.status(404).json({ success: false, data: null, error: `Job ${id} introuvable` }); return; }
    const updated = await queue.pauseJob(id);
    res.json({ success: true, data: updated || job, error: null });
  } catch (err: any) {
    res.status(500).json({ success: false, data: null, error: err?.message || "Erreur pause job" });
  }
});

// ---------------------------------------------------------------------------
// POST /api/jobs/:id/resume
// ---------------------------------------------------------------------------

router.post("/:id/resume", async (req: Request, res: Response) => {
  try {
    const id = String(req.params.id || "").trim();
    if (!id) { res.status(400).json({ success: false, data: null, error: "id manquant" }); return; }
    const job = await queue.getJob(id);
    if (!job) { res.status(404).json({ success: false, data: null, error: `Job ${id} introuvable` }); return; }
    const updated = await queue.resumeJob(id);
    res.json({ success: true, data: updated || job, error: null });
  } catch (err: any) {
    res.status(500).json({ success: false, data: null, error: err?.message || "Erreur resume job" });
  }
});

// ---------------------------------------------------------------------------
// POST /api/jobs/:id/cancel
// ---------------------------------------------------------------------------

router.post("/:id/cancel", async (req: Request, res: Response) => {
  try {
    const id = String(req.params.id || "").trim();
    if (!id) { res.status(400).json({ success: false, data: null, error: "id manquant" }); return; }
    const job = await queue.getJob(id);
    if (!job) { res.status(404).json({ success: false, data: null, error: `Job ${id} introuvable` }); return; }
    const updated = await queue.cancelJob(id);
    res.json({ success: true, data: updated || job, error: null });
  } catch (err: any) {
    res.status(500).json({ success: false, data: null, error: err?.message || "Erreur cancel job" });
  }
});

// ---------------------------------------------------------------------------
// POST /api/jobs/:id/retry — relance items failed
// ---------------------------------------------------------------------------

router.post("/:id/retry", async (req: Request, res: Response) => {
  try {
    const id = String(req.params.id || "").trim();
    if (!id) { res.status(400).json({ success: false, data: null, error: "id manquant" }); return; }
    const job = await queue.getJob(id);
    if (!job) { res.status(404).json({ success: false, data: null, error: `Job ${id} introuvable` }); return; }

    try {
      const updated = await queue.retryJob(id);
      res.json({ success: true, data: updated, error: null });
    } catch (e: any) {
      res.status(400).json({ success: false, data: null, error: e?.message || "Échec retry" });
    }
  } catch (err: any) {
    res.status(500).json({ success: false, data: null, error: err?.message || "Erreur retry job" });
  }
});

// ---------------------------------------------------------------------------
// PATCH /api/jobs/:id/delay { delayMinutes }
// ---------------------------------------------------------------------------

router.patch("/:id/delay", async (req: Request, res: Response) => {
  try {
    const id = String(req.params.id || "").trim();
    if (!id) { res.status(400).json({ success: false, data: null, error: "id manquant" }); return; }

    const parsed = delayPatchSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ success: false, data: null, error: parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join(", ") });
      return;
    }

    const job = await queue.getJob(id);
    if (!job) { res.status(404).json({ success: false, data: null, error: `Job ${id} introuvable` }); return; }

    if (job.status === "cancelled" || job.status === "completed") {
      res.status(400).json({ success: false, data: null, error: `Impossible de modifier le délai d'un job ${job.status}` });
      return;
    }

    const updated = await queue.updateDelay(id, parsed.data.delayMinutes);
    res.json({ success: true, data: updated, error: null });
  } catch (err: any) {
    res.status(500).json({ success: false, data: null, error: err?.message || "Erreur update delay" });
  }
});

// ---------------------------------------------------------------------------
// DELETE optionnel (non demandé mais utile) — supprime un job
// ---------------------------------------------------------------------------

router.delete("/:id", async (req: Request, res: Response) => {
  try {
    const id = String(req.params.id || "").trim();
    if (!id) { res.status(400).json({ success: false, data: null, error: "id manquant" }); return; }
    const job = await queue.getJob(id);
    if (!job) { res.status(404).json({ success: false, data: null, error: `Job ${id} introuvable` }); return; }
    await db.deleteJob(id);
    // aussi nettoyer queues mémoire
    try {
      const sched = await queue.getScheduler();
      sched?.jobs?.delete?.(id);
    } catch {}
    try {
      const orch = await queue.getOrchestrator();
      orch?.jobs?.delete?.(id);
    } catch {}
    res.json({ success: true, data: { deleted: true, id }, error: null });
  } catch (err: any) {
    res.status(500).json({ success: false, data: null, error: err?.message || "Erreur suppression job" });
  }
});

export default router;
