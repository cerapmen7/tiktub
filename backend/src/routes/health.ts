import { Router } from "express";
import type { Request, Response } from "express";
import { db } from "../services/db.js";

const router = Router();

router.get("/", async (_req: Request, res: Response) => {
  try {
    let dbStatus: string = "unknown";
    try {
      const prisma = await db.getPrisma();
      if (prisma) dbStatus = db.isPrismaAvailable() ? "connected" : "fallback";
      else dbStatus = "fallback (json)";
    } catch {
      dbStatus = "fallback";
    }

    const uptime = Math.floor(process.uptime());
    const mem = process.memoryUsage();

    res.json({
      success: true,
      data: {
        status: "ok",
        service: "tiktub-backend",
        version: "1.0.0",
        uptime,
        timestamp: new Date().toISOString(),
        dbStatus,
        memory: {
          rss: Math.round(mem.rss / 1024 / 1024) + " MB",
          heapUsed: Math.round(mem.heapUsed / 1024 / 1024) + " MB",
        },
        env: process.env.NODE_ENV || "development",
      },
      error: null,
    });
  } catch (err: any) {
    res.status(500).json({
      success: false,
      data: null,
      error: err?.message || "Erreur health check",
    });
  }
});

// aussi sous /api/health (le routeur est monté à /api/health, donc GET /)
export default router;
