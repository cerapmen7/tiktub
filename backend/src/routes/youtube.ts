import { Router } from "express";
import type { Request, Response } from "express";
import { db } from "../services/db.js";

const router = Router();

// ---------------------------------------------------------------------------
// Helpers: load youtube-agent dynamique
// ---------------------------------------------------------------------------

async function loadYouTubeAgent(): Promise<any | null> {
  const rels = [
    "../../../agents/youtube-agent/src/index.js",
    "../../../../agents/youtube-agent/src/index.js",
    "../../../agents/youtube-agent/dist/agents/youtube-agent/src/index.js",
    "../../../../agents/youtube-agent/dist/agents/youtube-agent/src/index.js",
  ];
  for (const spec of rels) {
    try {
      const mod = await import(spec);
      if (mod) return mod;
    } catch {}
  }
  try {
    const { fileURLToPath } = await import("node:url");
    const path = await import("node:path");
    const fs = await import("node:fs");
    const { pathToFileURL } = await import("node:url");
    const __filename = fileURLToPath(import.meta.url);
    const __dirname = path.dirname(__filename);
    const root = path.resolve(__dirname, "../../../");
    const candidates = [
      path.join(root, "agents", "youtube-agent", "src", "index.js"),
      path.join(root, "agents", "youtube-agent", "dist", "agents", "youtube-agent", "src", "index.js"),
    ];
    for (const abs of candidates) {
      if (fs.existsSync(abs)) {
        const mod = await import(pathToFileURL(abs).href);
        if (mod) return mod;
      }
    }
  } catch {}
  return null;
}

async function restoreTokensToAgent(agent: any): Promise<void> {
  try {
    const saved = await db.getYoutubeToken();
    if (saved && agent?.setTokens) {
      try { agent.setTokens(saved); } catch {}
    } else if (saved && agent?.loadTokens) {
      try { await agent.loadTokens(); } catch {}
    }
  } catch {}
}

// ---------------------------------------------------------------------------
// GET /api/youtube/auth -> { authUrl }
// ---------------------------------------------------------------------------

router.get("/auth", async (_req: Request, res: Response) => {
  try {
    const agent = await loadYouTubeAgent();
    if (agent && typeof agent.getAuthUrl === "function") {
      try {
        await restoreTokensToAgent(agent);
        const url = agent.getAuthUrl();
        res.json({ success: true, data: { authUrl: url, url }, error: null });
        return;
      } catch (e: any) {
        console.warn(`[youtube/auth] agent getAuthUrl échec: ${e?.message || e}`);
        // fallback
      }
    }
    // Fallback mock si agent indisponible ou échec
    const mockUrl = `https://accounts.google.com/o/oauth2/auth?client_id=mock&redirect_uri=${encodeURIComponent(process.env.GOOGLE_REDIRECT_URI || "http://localhost:3001/api/youtube/callback")}&scope=${encodeURIComponent("https://www.googleapis.com/auth/youtube.upload")}&response_type=code&access_type=offline&prompt=consent&state=tiktub_mock`;
    res.json({ success: true, data: { authUrl: mockUrl, url: mockUrl, mock: true }, error: null });
  } catch (err: any) {
    res.status(500).json({ success: false, data: null, error: err?.message || "Erreur génération authUrl" });
  }
});

// ---------------------------------------------------------------------------
// GET /api/youtube/callback?code=...&state=...
// ---------------------------------------------------------------------------

router.get("/callback", async (req: Request, res: Response) => {
  try {
    const code = String(req.query.code || "").trim();
    const state = String(req.query.state || "").trim();
    const errorParam = String(req.query.error || "").trim();

    if (errorParam) {
      res.status(400).json({ success: false, data: null, error: `OAuth error: ${errorParam}` });
      return;
    }

    if (!code) {
      // Si pas de code, probablement appel direct navigateur -> redirige vers frontend avec erreur
      // Mais en API, on retourne JSON
      const wantsHtml = req.headers.accept?.includes("text/html");
      if (wantsHtml) {
        const frontend = process.env.FRONTEND_URL || "http://localhost:5173";
        res.redirect(`${frontend}?youtube=error&reason=missing_code`);
        return;
      }
      res.status(400).json({ success: false, data: null, error: "Code OAuth manquant (param ?code=)" });
      return;
    }

    const agent = await loadYouTubeAgent();
    if (agent && typeof agent.getTokens === "function") {
      try {
        const tokens = await agent.getTokens(code);
        // Persiste via db + agent saveTokens
        try { await db.saveYoutubeToken(tokens); } catch {}
        try { if (agent.saveTokens) await agent.saveTokens(); } catch {}
        // Si requête navigateur (text/html), redirige vers frontend succès
        const wantsHtml = req.headers.accept?.includes("text/html");
        if (wantsHtml) {
          const frontend = process.env.FRONTEND_URL || "http://localhost:5173";
          res.redirect(`${frontend}?youtube=connected`);
          return;
        }
        res.json({ success: true, data: { connected: true, tokens: { hasAccessToken: !!tokens.access_token, hasRefreshToken: !!tokens.refresh_token, expiry_date: tokens.expiry_date ?? null }, state: state || undefined }, error: null });
        return;
      } catch (e: any) {
        console.warn(`[youtube/callback] getTokens échec: ${e?.message || e}`);
        const wantsHtml = req.headers.accept?.includes("text/html");
        if (wantsHtml) {
          const frontend = process.env.FRONTEND_URL || "http://localhost:5173";
          res.redirect(`${frontend}?youtube=error&reason=${encodeURIComponent(e?.message || "token_exchange_failed")}`);
          return;
        }
        res.status(500).json({ success: false, data: null, error: e?.message || "Échec échange code -> tokens" });
        return;
      }
    }

    // Fallback mock: simule tokens
    const mockTokens = {
      access_token: `mock_access_${Date.now()}`,
      refresh_token: `mock_refresh_${Date.now()}`,
      expiry_date: Date.now() + 3600_000,
      token_type: "Bearer",
      scope: "https://www.googleapis.com/auth/youtube.upload https://www.googleapis.com/auth/youtube",
    };
    try { await db.saveYoutubeToken(mockTokens); } catch {}
    const wantsHtml = req.headers.accept?.includes("text/html");
    if (wantsHtml) {
      const frontend = process.env.FRONTEND_URL || "http://localhost:5173";
      res.redirect(`${frontend}?youtube=connected&mock=1`);
      return;
    }
    res.json({ success: true, data: { connected: true, mock: true, tokens: mockTokens, state: state || undefined }, error: null });
  } catch (err: any) {
    console.error("[youtube/callback] erreur:", err);
    res.status(500).json({ success: false, data: null, error: err?.message || "Erreur callback youtube" });
  }
});

// ---------------------------------------------------------------------------
// GET /api/youtube/channels
// ---------------------------------------------------------------------------

router.get("/channels", async (_req: Request, res: Response) => {
  try {
    const agent = await loadYouTubeAgent();
    if (agent) await restoreTokensToAgent(agent);

    // Vérifie auth
    const isAuth = agent ? (typeof agent.isAuthenticated === "function" ? agent.isAuthenticated() : true) : false;
    // Si mock mode, agent.isAuthenticated retourne true -> on continue
    if (agent && typeof agent.getChannels === "function") {
      try {
        const channels = await agent.getChannels();
        res.json({ success: true, data: channels, error: null });
        return;
      } catch (e: any) {
        // Si 401 / non authentifié, on renvoie 401 avec message
        const msg = e?.message || String(e);
        if (msg.toLowerCase().includes("non authentifié") || msg.includes("401") || msg.includes("auth")) {
          res.status(401).json({ success: false, data: null, error: msg });
          return;
        }
        console.warn(`[youtube/channels] getChannels échec: ${msg} — fallback mock`);
        // Fallback mock
        const mock = [
          { id: "UC_mock_1", title: "Chaîne TikTub Mock 1", thumbnail: "https://picsum.photos/seed/yt1/88/88" },
          { id: "UC_mock_2", title: "Chaîne secondaire", thumbnail: "https://picsum.photos/seed/yt2/88/88" },
        ];
        res.json({ success: true, data: mock, error: null });
        return;
      }
    }

    // Fallback sans agent
    const mock = [
      { id: "UC_mock_1", title: "Chaîne TikTub Mock 1", thumbnail: "https://picsum.photos/seed/yt1/88/88" },
    ];
    res.json({ success: true, data: mock, error: null });
  } catch (err: any) {
    res.status(500).json({ success: false, data: null, error: err?.message || "Erreur récupération chaînes" });
  }
});

// ---------------------------------------------------------------------------
// GET /api/youtube/status
// ---------------------------------------------------------------------------

router.get("/status", async (_req: Request, res: Response) => {
  try {
    const agent = await loadYouTubeAgent();
    if (agent) await restoreTokensToAgent(agent);

    let authenticated = false;
    let mockMode = false;
    let hasTokens = false;

    try {
      const saved = await db.getYoutubeToken();
      hasTokens = !!(saved && (saved.access_token || saved.refresh_token));
    } catch {}

    if (agent && typeof agent.isAuthenticated === "function") {
      try { authenticated = agent.isAuthenticated(); } catch { authenticated = hasTokens; }
      try { mockMode = typeof agent.isMockMode === "function" ? agent.isMockMode() : false; } catch {}
    } else {
      authenticated = hasTokens;
      mockMode = true;
    }

    // Si tokens en base, considéré connecté même si agent dit non (cas mock)
    if (hasTokens) authenticated = true;

    res.json({
      success: true,
      data: {
        authenticated,
        connected: authenticated,
        mockMode,
        hasTokens,
      },
      error: null,
    });
  } catch (err: any) {
    res.status(500).json({ success: false, data: null, error: err?.message || "Erreur status youtube" });
  }
});

// ---------------------------------------------------------------------------
// POST /api/youtube/disconnect
// ---------------------------------------------------------------------------

router.post("/disconnect", async (_req: Request, res: Response) => {
  try {
    const agent = await loadYouTubeAgent();
    // Clear tokens en base
    try { await db.clearYoutubeToken(); } catch (e) { console.warn(`[youtube/disconnect] db clear échec: ${e}`); }

    // Clear cache agent
    if (agent) {
      try {
        if (typeof agent.clearCachedTokens === "function") agent.clearCachedTokens();
        else if (agent.setCachedTokens) agent.setCachedTokens(null);
        else if (agent._resetOAuth2ClientForTests) agent._resetOAuth2ClientForTests();
      } catch {}
      // Essaie aussi tokens.ts
      try {
        // @ts-ignore
        const tokensMod = await import("../../../agents/youtube-agent/src/tokens.js");
        if (tokensMod?.clearCachedTokens) tokensMod.clearCachedTokens();
        // supprime fichier tokens.json
        try {
          const fs = await import("node:fs");
          const path = await import("node:path");
          const { fileURLToPath } = await import("node:url");
          const __filename = fileURLToPath(import.meta.url);
          const __dirname = path.dirname(__filename);
          const root = path.resolve(__dirname, "../../../");
          const candidates = [
            path.join(root, "data", "tokens.json"),
            path.join(process.cwd(), "data", "tokens.json"),
          ];
          for (const p of candidates) {
            try { if (fs.existsSync(p)) fs.unlinkSync(p); } catch {}
          }
        } catch {}
      } catch {}
    }

    res.json({ success: true, data: { disconnected: true }, error: null });
  } catch (err: any) {
    res.status(500).json({ success: false, data: null, error: err?.message || "Erreur déconnexion youtube" });
  }
});

export default router;
