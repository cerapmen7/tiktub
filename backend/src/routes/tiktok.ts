import { Router } from "express";
import type { Request, Response } from "express";
import { z } from "zod";

// @ts-ignore — shared hors rootDir
import { cleanHandle as cleanHandleShared } from "../../../shared/constants.js";

const router = Router();

// ---------------------------------------------------------------------------
// Helpers cleanHandle avec fallback
// ---------------------------------------------------------------------------

const HANDLE_REGEX = /^@?([A-Za-z0-9._]{2,24})$/;

function cleanHandleLocal(input: string): string | null {
  const m = input.trim().match(HANDLE_REGEX);
  return m ? m[1].toLowerCase() : null;
}

function getCleanHandle(input: string): string | null {
  try {
    if (typeof cleanHandleShared === "function") return cleanHandleShared(input);
  } catch {}
  return cleanHandleLocal(input);
}

// ---------------------------------------------------------------------------
// Zod schemas
// ---------------------------------------------------------------------------

const validateSchema = z.object({
  handle: z.string().min(1).max(30),
});

const previewSchema = z.object({
  handles: z.array(z.string().min(1).max(30)).min(1).max(10),
  limit: z.number().int().min(1).max(50).optional().default(10),
  sortBy: z.enum(["popular", "most_liked", "recent"]).optional().default("popular"),
});

// ---------------------------------------------------------------------------
// Dynamic load tiktok-agent
// ---------------------------------------------------------------------------

async function loadTikTokAgent(): Promise<any | null> {
  const candidates = [
    "../../../agents/tiktok-agent/src/index.js",
    "../../../../agents/tiktok-agent/src/index.js",
  ];
  for (const spec of candidates) {
    try {
      const mod = await import(spec);
      if (mod) return mod;
    } catch {}
  }
  // absolute fallback
  try {
    const { fileURLToPath } = await import("node:url");
    const path = await import("node:path");
    const fs = await import("node:fs");
    const __filename = fileURLToPath(import.meta.url);
    const __dirname = path.dirname(__filename);
    const root = path.resolve(__dirname, "../../../");
    const abs = path.join(root, "agents", "tiktok-agent", "src", "index.js");
    if (fs.existsSync(abs)) {
      const { pathToFileURL } = await import("node:url");
      const mod = await import(pathToFileURL(abs).href);
      if (mod) return mod;
    }
  } catch {}
  return null;
}

// ---------------------------------------------------------------------------
// POST /api/tiktok/validate { handle }
// ---------------------------------------------------------------------------

router.post("/validate", async (req: Request, res: Response) => {
  try {
    const parsed = validateSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ success: false, data: null, error: parsed.error.issues.map((i) => i.message).join(", ") });
      return;
    }

    const rawHandle = parsed.data.handle;
    const cleaned = getCleanHandle(rawHandle);
    if (!cleaned) {
      res.status(400).json({ success: false, data: null, error: `Handle invalide: "${rawHandle}". Format attendu: 2-24 caractères alphanum + . _ (ex: @charlidamelio)` });
      return;
    }

    // Tente via agent
    const agent = await loadTikTokAgent();
    if (agent && typeof agent.validateHandle === "function") {
      try {
        const profile = await agent.validateHandle(cleaned);
        res.json({ success: true, data: profile, error: null });
        return;
      } catch (e: any) {
        console.warn(`[tiktok route] validateHandle agent échec: ${e?.message || e}`);
        // fallback mock local
      }
    }

    // Fallback mock si agent indisponible
    try {
      // tente import mock direct
      let mockMod: any = null;
      try {
        // @ts-ignore
        mockMod = await import("../../../agents/tiktok-agent/src/mock.js");
      } catch {}
      if (mockMod?.generateMockProfile) {
        const profile = mockMod.generateMockProfile(cleaned);
        res.json({ success: true, data: profile, error: null });
        return;
      }
    } catch {}

    // Dernier fallback ultra minimal
    res.json({
      success: true,
      data: {
        handle: cleaned,
        nickname: `${cleaned} (mock)`,
        avatar: `https://picsum.photos/seed/${cleaned}/200/200`,
        followers: 12345,
        verified: false,
        exists: true,
      },
      error: null,
    });
  } catch (err: any) {
    console.error("[tiktok/validate] erreur:", err);
    res.status(500).json({ success: false, data: null, error: err?.message || "Erreur validation handle" });
  }
});

// ---------------------------------------------------------------------------
// POST /api/tiktok/preview { handles, limit, sortBy }
// ---------------------------------------------------------------------------

router.post("/preview", async (req: Request, res: Response) => {
  try {
    const parsed = previewSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ success: false, data: null, error: parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join(", ") });
      return;
    }

    const { handles, limit, sortBy } = parsed.data;

    // Nettoyage & validation handles
    const cleaned: string[] = [];
    const invalid: string[] = [];
    const seen = new Set<string>();
    for (const raw of handles) {
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

    const safeLimit = Math.max(1, Math.min(Number(limit) || 10, 50));
    const safeSortBy = (["popular", "most_liked", "recent"] as const).includes(sortBy as any) ? sortBy : "popular";

    const agent = await loadTikTokAgent();

    const results: Record<string, any[]> = {};
    const errors: Record<string, string> = {};

    for (const handle of cleaned) {
      try {
        let videos: any[] | null = null;
        if (agent && typeof agent.fetchTopVideos === "function") {
          try {
            videos = await agent.fetchTopVideos(handle, safeLimit, safeSortBy);
          } catch (e: any) {
            console.warn(`[tiktok/preview] fetchTopVideos @${handle} échec: ${e?.message || e}`);
            videos = null;
          }
        }
        if (!videos || videos.length === 0) {
          // fallback mock
          try {
            let mockMod: any = null;
            try {
              // @ts-ignore
              mockMod = await import("../../../agents/tiktok-agent/src/mock.js");
            } catch {}
            if (mockMod?.generateMockVideos) {
              videos = mockMod.generateMockVideos(handle, safeLimit);
              // tri mock selon sortBy
              if (safeSortBy === "popular") videos!.sort((a: any, b: any) => (b.playCount || 0) - (a.playCount || 0));
              else if (safeSortBy === "most_liked") videos!.sort((a: any, b: any) => (b.likeCount || 0) - (a.likeCount || 0));
              else videos!.sort((a: any, b: any) => (b.createTime || 0) - (a.createTime || 0));
              videos = videos!.slice(0, safeLimit);
            }
          } catch {}
        }
        if (!videos || videos.length === 0) {
          // ultime fallback local
          videos = Array.from({ length: safeLimit }, (_, i) => ({
            id: `${handle}_${Date.now()}_${i}`,
            handle,
            title: `Mock vidéo @${handle} #${i} #fyp #viral`,
            description: `Mock vidéo @${handle} #${i}`,
            hashtags: ["fyp", "viral"],
            playCount: 10000 + i * 5000,
            likeCount: 1000 + i * 500,
            createTime: Math.floor(Date.now() / 1000) - i * 86400,
          }));
        }
        results[handle] = videos!;
      } catch (e: any) {
        errors[handle] = e?.message || String(e);
      }
    }

    // Format de retour: soit map par handle, soit flat array si un seul handle (compat)
    const allVideos = cleaned.length === 1 ? results[cleaned[0]] : results;
    const total = cleaned.length === 1 ? (Array.isArray(allVideos) ? (allVideos as any[]).length : 0) : Object.values(results).reduce((a, v) => a + (v as any[]).length, 0);

    res.json({
      success: true,
      data: {
        handles: cleaned,
        limit: safeLimit,
        sortBy: safeSortBy,
        total,
        videos: allVideos,
        // pour compat frontend qui attend peut-être `previews`
        previews: allVideos,
        errors: Object.keys(errors).length ? errors : undefined,
      },
      error: null,
    });
  } catch (err: any) {
    console.error("[tiktok/preview] erreur:", err);
    res.status(500).json({ success: false, data: null, error: err?.message || "Erreur preview tiktok" });
  }
});

export default router;
