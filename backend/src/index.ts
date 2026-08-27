import "dotenv/config";
import express from "express";
import type { Request, Response } from "express";
import cors from "cors";
import morgan from "morgan";
import * as path from "node:path";
import * as fs from "node:fs";
import { fileURLToPath } from "node:url";

import { errorHandler } from "./middleware/error.js";
import healthRouter from "./routes/health.js";
import tiktokRouter from "./routes/tiktok.js";
import youtubeRouter from "./routes/youtube.js";
import jobsRouter from "./routes/jobs.js";
import settingsRouter from "./routes/settings.js";

const app = express();

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------

const PORT = Number(process.env.PORT) || 3001;
const FRONTEND_URL = process.env.FRONTEND_URL || "http://localhost:5173";
const NODE_ENV = process.env.NODE_ENV || "development";

// ---------------------------------------------------------------------------
// Middlewares
// ---------------------------------------------------------------------------

app.use(
  cors({
    origin: FRONTEND_URL,
    credentials: true,
    methods: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
    allowedHeaders: ["Content-Type", "Authorization"],
  })
);

// Morgan dev log
app.use(morgan(NODE_ENV === "production" ? "combined" : "dev"));
app.use(express.json({ limit: "2mb" }));
app.use(express.urlencoded({ extended: true }));

// ---------------------------------------------------------------------------
// Routes
// ---------------------------------------------------------------------------

app.use("/api/health", healthRouter);
app.use("/api/tiktok", tiktokRouter);
app.use("/api/youtube", youtubeRouter);
app.use("/api/jobs", jobsRouter);
app.use("/api/settings", settingsRouter);

// Route racine pour monitoring
app.get("/api", (_req: Request, res: Response) => {
  res.json({
    success: true,
    data: {
      name: "TikTub Backend API",
      version: "1.0.0",
      env: NODE_ENV,
      frontendUrl: FRONTEND_URL,
      endpoints: [
        "GET /api/health",
        "POST /api/tiktok/validate",
        "POST /api/tiktok/preview",
        "GET /api/youtube/auth",
        "GET /api/youtube/callback",
        "GET /api/youtube/channels",
        "GET /api/youtube/status",
        "POST /api/youtube/disconnect",
        "POST /api/jobs",
        "GET /api/jobs",
        "GET /api/jobs/:id",
        "POST /api/jobs/:id/pause",
        "POST /api/jobs/:id/resume",
        "POST /api/jobs/:id/cancel",
        "POST /api/jobs/:id/retry",
        "PATCH /api/jobs/:id/delay",
        "GET /api/settings",
        "PATCH /api/settings",
      ],
    },
    error: null,
  });
});

// ---------------------------------------------------------------------------
// Static frontend en production
// ---------------------------------------------------------------------------

try {
  const __filename = fileURLToPath(import.meta.url);
  const __dirname = path.dirname(__filename);
  // En build: dist/index.js -> dist, donc frontend dist est ../../frontend/dist
  // En dev via tsx: src/index.ts -> src, donc frontend est ../../frontend/dist
  const candidates = [
    path.resolve(__dirname, "../../frontend/dist"),
    path.resolve(__dirname, "../../../frontend/dist"),
    path.resolve(process.cwd(), "frontend/dist"),
    path.resolve(process.cwd(), "../frontend/dist"),
  ];

  let frontendDist: string | null = null;
  for (const c of candidates) {
    if (fs.existsSync(c) && fs.existsSync(path.join(c, "index.html"))) {
      frontendDist = c;
      break;
    }
  }

  const shouldServeStatic = frontendDist && (NODE_ENV === "production" || process.env.ELECTRON === "true" || process.env.FORCE_SERVE_FRONTEND === "true");
  if (shouldServeStatic && frontendDist) {
    console.log(`[backend] Serving frontend static from ${frontendDist} (env=${NODE_ENV}, electron=${process.env.ELECTRON || "false"})`);
    app.use(express.static(frontendDist));
    // SPA fallback — sert index.html pour toute route non-API
    app.get("*", (req: Request, res: Response, next) => {
      if (req.path.startsWith("/api/")) {
        next();
        return;
      }
      res.sendFile(path.join(frontendDist!, "index.html"));
    });
  } else if (frontendDist) {
    console.log(`[backend] Frontend dist trouvé à ${frontendDist} mais NODE_ENV=${NODE_ENV}, static non servi (dev mode - ELECTRON/FORCE_SERVE_FRONTEND non défini)`);
  } else {
    if (NODE_ENV === "production") console.warn("[backend] Frontend dist introuvable en production — API seule");
  }
} catch (e) {
  console.warn(`[backend] échec config static frontend: ${e}`);
}

// ---------------------------------------------------------------------------
// 404 JSON pour API inconnue
// ---------------------------------------------------------------------------

app.use("/api", (req: Request, res: Response) => {
  res.status(404).json({
    success: false,
    data: null,
    error: `Route API introuvable: ${req.method} ${req.path}`,
  });
});

// ---------------------------------------------------------------------------
// Error handler global
// ---------------------------------------------------------------------------

app.use(errorHandler);

// ---------------------------------------------------------------------------
// Orchestrator daemon au démarrage (try/catch)
// ---------------------------------------------------------------------------

async function startDaemon(): Promise<void> {
  try {
    const { queue } = await import("./services/queue.js");
    // Init queue (charge jobs depuis db/json)
    await queue.init();
    const stopFn = await queue.startDaemon();
    if (stopFn) {
      console.log("[backend] Orchestrator daemon lancé au démarrage");
      // Graceful shutdown
      const shutdown = async () => {
        console.log("[backend] Arrêt daemon...");
        try { stopFn(); } catch {}
        try {
          const orch = await queue.getOrchestrator();
          orch?.stopDaemon?.();
          orch?.shutdown?.();
        } catch {}
        try {
          const sched = await queue.getScheduler();
          sched?.stopAll?.();
          sched?.shutdown?.();
        } catch {}
        process.exit(0);
      };
      process.on("SIGINT", shutdown);
      process.on("SIGTERM", shutdown);
    } else {
      console.warn("[backend] Orchestrator daemon non démarré (fallback)");
    }
  } catch (e: any) {
    console.warn(`[backend] Impossible de lancer orchestrator daemon: ${e?.message || e}`);
    console.warn("[backend] Le serveur API reste disponible, le pipeline auto sera inactif jusqu'à correction");
  }
}

// ---------------------------------------------------------------------------
// Start server
// ---------------------------------------------------------------------------

app.listen(PORT, async () => {
  console.log(`[backend] TikTub API listening on http://localhost:${PORT} (env=${NODE_ENV})`);
  console.log(`[backend] CORS allowed origin: ${FRONTEND_URL}`);
  console.log(`[backend] Health: http://localhost:${PORT}/api/health`);

  // Démarre le daemon en arrière-plan
  await startDaemon();
});

export default app;
