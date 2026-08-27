import { Router } from "express";
import type { Request, Response } from "express";
import { z } from "zod";
import { db } from "../services/db.js";

const router = Router();

const patchSettingsSchema = z.object({
  defaultDelayMinutes: z.number().int().min(1).max(60 * 24 * 7).optional(),
  maxConcurrentUploads: z.number().int().min(1).max(10).optional(),
  downloadDir: z.string().min(1).max(500).optional(),
});

/**
 * GET /api/settings
 */
router.get("/", async (_req: Request, res: Response) => {
  try {
    const settings = await db.getSettings();
    res.json({ success: true, data: settings, error: null });
  } catch (err: any) {
    res.status(500).json({ success: false, data: null, error: err?.message || "Erreur lecture settings" });
  }
});

/**
 * PATCH /api/settings
 * body: Partial<AppSettings>
 */
router.patch("/", async (req: Request, res: Response) => {
  try {
    const parsed = patchSettingsSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ success: false, data: null, error: parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join(", ") });
      return;
    }

    const patched = await db.updateSettings(parsed.data);

    res.json({ success: true, data: patched, error: null });
  } catch (err: any) {
    res.status(500).json({ success: false, data: null, error: err?.message || "Erreur mise à jour settings" });
  }
});

export default router;
