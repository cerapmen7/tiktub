/**
 * TikTub — Electron Main Process
 * - Lance le backend Express (backend/dist/index.js) en child process
 * - Affiche splash puis fenêtre principale
 * - Gère installer auto-update, menu, tray, deep links
 */

import { app, BrowserWindow, ipcMain, shell, Menu, dialog, nativeImage } from "electron";
import * as path from "node:path";
import * as fs from "node:fs";
import * as http from "node:http";
import { spawn, ChildProcess } from "node:child_process";
import { fileURLToPath } from "node:url";

// ------------------------------------------------------------
// Paths — gère dev vs packaged
// ------------------------------------------------------------
const isDev = !app.isPackaged;
// En dev: process.cwd() = C:\...\tiktub
// En prod packagé: app.getAppPath() = .../resources/app, backend dans resources
function getBackendDir(): string {
  if (isDev) return path.join(process.cwd(), "backend");
  // Packaged: gère asar (app.asar.unpacked) + extraResources + app
  const candidates = [
    path.join(process.resourcesPath, "app.asar.unpacked", "backend"),
    path.join(path.dirname(app.getAppPath()), "app.asar.unpacked", "backend"),
    path.join(process.resourcesPath, "backend"),
    path.join(app.getAppPath(), "backend"),
    path.join(path.join(app.getAppPath(), "..", "app.asar.unpacked", "backend")),
    path.join(process.cwd(), "backend"),
    path.join(process.cwd(), "resources", "app.asar.unpacked", "backend"),
  ];
  for (const c of candidates) if (fs.existsSync(path.join(c, "dist", "index.js"))) return c;
  return candidates[0];
}
function getFrontendDir(): string {
  if (isDev) return path.join(process.cwd(), "frontend", "dist");
  const candidates = [
    path.join(process.resourcesPath, "app.asar.unpacked", "frontend", "dist"),
    path.join(path.dirname(app.getAppPath()), "app.asar.unpacked", "frontend", "dist"),
    path.join(process.resourcesPath, "frontend", "dist"),
    path.join(app.getAppPath(), "frontend", "dist"),
    path.join(process.cwd(), "frontend", "dist"),
    path.join(process.cwd(), "resources", "app.asar.unpacked", "frontend", "dist"),
  ];
  for (const c of candidates) if (fs.existsSync(path.join(c, "index.html"))) return c;
  return candidates[0];
}

const BACKEND_PORT = Number(process.env.PORT) || 3001;
const BACKEND_URL = `http://localhost:${BACKEND_PORT}`;
const FRONTEND_DEV_URL = "http://localhost:5173";

let mainWindow: BrowserWindow | null = null;
let splashWindow: BrowserWindow | null = null;
let backendProcess: ChildProcess | null = null;
let backendReady = false;

// ------------------------------------------------------------
// Backend spawn & health check
// ------------------------------------------------------------
function startBackend(): Promise<void> {
  return new Promise((resolve, reject) => {
    const backendDir = getBackendDir();
    const entry = path.join(backendDir, "dist", "index.js");
    if (!fs.existsSync(entry)) {
      reject(new Error(`Backend introuvable: ${entry}`));
      return;
    }

    const env = {
      ...process.env,
      NODE_ENV: isDev ? "development" : "production",
      PORT: String(BACKEND_PORT),
      ELECTRON: "true",
      ELECTRON_RUN_AS_NODE: "1",
      FORCE_SERVE_FRONTEND: "true",
      // En packaged, userData pour DB
      DATABASE_URL: process.env.DATABASE_URL || `file:${path.join(app.getPath("userData"), "tiktub.db").replace(/\\/g, "/")}`,
      DOWNLOAD_DIR: path.join(app.getPath("userData"), "downloads"),
      FRONTEND_URL: isDev ? FRONTEND_DEV_URL : BACKEND_URL,
    };

    // Assure dossiers userData
    try {
      fs.mkdirSync(path.join(app.getPath("userData"), "downloads"), { recursive: true });
      // Copie DB si première install et DB vide
      const srcDb = path.join(backendDir, "prisma", "data", "tiktub.db");
      const destDb = path.join(app.getPath("userData"), "tiktub.db");
      if (fs.existsSync(srcDb) && !fs.existsSync(destDb)) {
        fs.copyFileSync(srcDb, destDb);
      }
    } catch {}

    console.log(`[electron] Lancement backend: node ${entry} (port ${BACKEND_PORT})`);
    backendProcess = spawn(process.execPath, [entry], {
      cwd: backendDir,
      env: env as NodeJS.ProcessEnv,
      stdio: ["ignore", "pipe", "pipe"],
      windowsHide: true,
    });

    backendProcess.stdout?.on("data", (d) => console.log(`[backend] ${String(d).trim()}`));
    backendProcess.stderr?.on("data", (d) => console.error(`[backend:err] ${String(d).trim()}`));
    backendProcess.on("exit", (code) => {
      console.log(`[backend] exit code ${code}`);
      if (!backendReady) reject(new Error(`Backend exited code ${code}`));
    });
    backendProcess.on("error", (e) => {
      console.error(`[backend] spawn error`, e);
      reject(e);
    });

    // Poll health
    const start = Date.now();
    const timeout = 30_000;
    const interval = setInterval(() => {
      if (Date.now() - start > timeout) {
        clearInterval(interval);
        reject(new Error("Timeout backend healthcheck"));
        return;
      }
      http.get(`${BACKEND_URL}/api/health`, (res) => {
        if (res.statusCode === 200) {
          let body = "";
          res.on("data", (c) => (body += c));
          res.on("end", () => {
            clearInterval(interval);
            backendReady = true;
            console.log(`[electron] Backend prêt: ${body.slice(0, 120)}`);
            resolve();
          });
        } else {
          res.resume();
        }
      }).on("error", () => {
        // not ready yet, keep polling
      });
    }, 600);
  });
}

function stopBackend() {
  if (backendProcess && !backendProcess.killed) {
    try {
      backendProcess.kill("SIGTERM");
      setTimeout(() => {
        if (backendProcess && !backendProcess.killed) backendProcess.kill("SIGKILL");
      }, 3000);
    } catch {}
  }
}

// ------------------------------------------------------------
// Windows
// ------------------------------------------------------------
function createSplashWindow() {
  splashWindow = new BrowserWindow({
    width: 420,
    height: 380,
    frame: false,
    transparent: true,
    alwaysOnTop: true,
    resizable: false,
    show: false,
    center: true,
    backgroundColor: "#00000000",
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
    },
  });

  const splashPath = path.join(__dirname, "splash.html");
  // En dev __dirname = dist-electron/src, splash.html copié à côté
  // En prod, __dirname = resources/app/dist-electron/src
  const candidates = [
    splashPath,
    path.join(__dirname, "..", "src", "splash.html"),
    path.join(process.cwd(), "electron", "src", "splash.html"),
    path.join(app.getAppPath(), "electron", "src", "splash.html"),
  ];
  let found = candidates.find((p) => fs.existsSync(p));
  if (found) {
    splashWindow.loadFile(found);
  } else {
    // fallback data URL minimal
    splashWindow.loadURL(`data:text/html,<body style="background:#0a0a0f;color:white;display:flex;align-items:center;justify-content:center;height:100vh;font-family:sans-serif"><h2>TikTub chargement...</h2></body>`);
  }

  splashWindow.once("ready-to-show", () => splashWindow?.show());
}

function createMainWindow() {
  const iconPath = getIconPath();
  mainWindow = new BrowserWindow({
    width: 1280,
    height: 820,
    minWidth: 1050,
    minHeight: 680,
    show: false,
    backgroundColor: "#0a0a0f",
    title: "TikTub — TikTok → YouTube",
    icon: iconPath && fs.existsSync(iconPath) ? iconPath : undefined,
    frame: true, // On garde frame natif pour simplicité, mais preload expose controls custom si besoin
    autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(__dirname, "preload.cjs"),
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: false,
    },
  });

  // Chargement — backend sert maintenant le frontend même en dev via ELECTRON=true
  const tryLoad = async () => {
    // 1) Si dev et Vite dispo, tente Vite (hot reload)
    if (isDev) {
      try {
        // test rapide si Vite répond
        await new Promise<void>((resolve, reject) => {
          http.get(FRONTEND_DEV_URL, (res) => {
            res.resume();
            if (res.statusCode && res.statusCode < 400) resolve();
            else reject(new Error(`Vite ${res.statusCode}`));
          }).on("error", reject);
        });
        console.log(`[electron] Vite détecté → ${FRONTEND_DEV_URL}`);
        await mainWindow!.loadURL(FRONTEND_DEV_URL);
        return;
      } catch {
        console.log(`[electron] Vite indisponible, fallback ${BACKEND_URL} (backend sert frontend)`);
      }
    }
    // 2) Fallback: backend sert le frontend (ELECTRON=true → FORCE_SERVE_FRONTEND)
    try {
      await mainWindow!.loadURL(BACKEND_URL);
      // Si backend renvoie 404 JSON (cas dev sans static), fallback file://
      mainWindow!.webContents.on("did-finish-load", async () => {
        try {
          const url = mainWindow!.webContents.getURL();
          if (url.startsWith(BACKEND_URL)) {
            const html = await mainWindow!.webContents.executeJavaScript("document.documentElement.innerHTML");
            if (html && html.includes("Route API introuvable")) {
              const frontendIndex = path.join(getFrontendDir(), "index.html");
              if (fs.existsSync(frontendIndex)) {
                console.log(`[electron] Backend 404 → Fallback file:// ${frontendIndex}`);
                await mainWindow!.loadFile(frontendIndex);
              }
            }
          }
        } catch {}
      });
    } catch (e) {
      console.log(`[electron] Backend load fail, fallback file://`);
      const frontendIndex = path.join(getFrontendDir(), "index.html");
      if (fs.existsSync(frontendIndex)) {
        await mainWindow!.loadFile(frontendIndex);
      } else {
        throw e;
      }
    }
    // 3) Ultime fallback file:// si did-fail-load
    mainWindow!.webContents.on("did-fail-load", (_e, code, desc, url) => {
      if (url.startsWith(BACKEND_URL) || url.startsWith(FRONTEND_DEV_URL)) {
        const frontendIndex = path.join(getFrontendDir(), "index.html");
        if (fs.existsSync(frontendIndex)) {
          console.log(`[electron] did-fail-load ${code} → file:// ${frontendIndex}`);
          mainWindow?.loadFile(frontendIndex);
        }
      }
    });
  };
  tryLoad().catch((e) => console.error("[electron] tryLoad error", e));

  mainWindow.once("ready-to-show", () => {
    if (splashWindow && !splashWindow.isDestroyed()) {
      setTimeout(() => {
        splashWindow?.close();
        splashWindow = null;
      }, 400);
    }
    mainWindow?.show();
    mainWindow?.focus();
    if (isDev) mainWindow?.webContents.openDevTools({ mode: "detach" });
  });

  // Liens externes → navigateur système
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url);
    return { action: "deny" };
  });
  mainWindow.webContents.on("will-navigate", (event, url) => {
    const current = mainWindow?.webContents.getURL();
    // Autorise navigation interne http://localhost:*
    if (url.startsWith("http://localhost:") || url.startsWith(BACKEND_URL) || url.startsWith(FRONTEND_DEV_URL)) return;
    // Bloque et ouvre externe
    if (url.startsWith("http://") || url.startsWith("https://")) {
      event.preventDefault();
      shell.openExternal(url);
    }
  });

  mainWindow.on("closed", () => (mainWindow = null));
}

function getIconPath(): string | null {
  const candidates = [
    path.join(process.cwd(), "assets", "icon.ico"),
    path.join(process.cwd(), "assets", "icon.png"),
    path.join(process.cwd(), "build", "icon.ico"),
    path.join(app.getAppPath(), "assets", "icon.png"),
    path.join(process.resourcesPath, "assets", "icon.png"),
  ];
  for (const p of candidates) if (fs.existsSync(p)) return p;
  return null;
}

// ------------------------------------------------------------
// Menu
// ------------------------------------------------------------
function buildMenu() {
  const template: Electron.MenuItemConstructorOptions[] = [
    {
      label: "Fichier",
      submenu: [
        { role: "quit", label: "Quitter" },
      ],
    },
    {
      label: "Affichage",
      submenu: [
        { role: "reload", label: "Recharger" },
        { role: "forceReload", label: "Recharger (forcé)" },
        { role: "toggleDevTools", label: "Outils de développement" },
        { type: "separator" },
        { role: "resetZoom", label: "Zoom 100%" },
        { role: "zoomIn", label: "Zoom +" },
        { role: "zoomOut", label: "Zoom -" },
        { role: "togglefullscreen", label: "Plein écran" },
      ],
    },
    {
      label: "Aide",
      submenu: [
        {
          label: "Ouvrir dossier données",
          click: () => shell.openPath(app.getPath("userData")),
        },
        {
          label: "Santé backend",
          click: async () => {
            try {
              const data = await new Promise<string>((res, rej) => {
                http.get(`${BACKEND_URL}/api/health`, (r) => {
                  let b = "";
                  r.on("data", (c) => (b += c));
                  r.on("end", () => res(b));
                }).on("error", rej);
              });
              dialog.showMessageBox({
                type: "info",
                title: "TikTub — Santé",
                message: data.slice(0, 800),
                buttons: ["OK"],
              });
            } catch (e: any) {
              dialog.showErrorBox("Erreur backend", String(e?.message || e));
            }
          },
        },
        { type: "separator" },
        {
          label: `À propos TikTub v${app.getVersion()}`,
          click: () => {
            dialog.showMessageBox({
              type: "info",
              title: "À propos TikTub",
              message: `TikTub v${app.getVersion()}`,
              detail: "Automation IA TikTok → YouTube Shorts\n\n• Multi-chaînes\n• Délai configurable\n• Même titres / hashtags / descriptions\n\n© 2026 cerapmen7",
              buttons: ["OK"],
              icon: getIconPath() ? nativeImage.createFromPath(getIconPath()!) : undefined,
            });
          },
        },
        {
          label: "GitHub",
          click: () => shell.openExternal("https://github.com/cerapmen7/tiktub"),
        },
      ],
    },
  ];
  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}

// ------------------------------------------------------------
// IPC
// ------------------------------------------------------------
function setupIpc() {
  ipcMain.handle("app:version", () => app.getVersion());
  ipcMain.handle("backend:url", () => BACKEND_URL);
  ipcMain.handle("backend:health", async () => {
    return new Promise((resolve) => {
      http.get(`${BACKEND_URL}/api/health`, (res) => {
        let b = "";
        res.on("data", (c) => (b += c));
        res.on("end", () => {
          try {
            const j = JSON.parse(b);
            resolve({ ok: res.statusCode === 200, data: j });
          } catch {
            resolve({ ok: res.statusCode === 200, data: b });
          }
        });
      }).on("error", (e) => resolve({ ok: false, data: String(e) }));
    });
  });
  ipcMain.handle("window:isMaximized", (e) => {
    const w = BrowserWindow.fromWebContents(e.sender);
    return w ? w.isMaximized() : false;
  });
  ipcMain.on("window:minimize", (e) => BrowserWindow.fromWebContents(e.sender)?.minimize());
  ipcMain.on("window:maximize", (e) => {
    const w = BrowserWindow.fromWebContents(e.sender);
    if (!w) return;
    if (w.isMaximized()) w.unmaximize();
    else w.maximize();
  });
  ipcMain.on("window:close", (e) => BrowserWindow.fromWebContents(e.sender)?.close());
  ipcMain.on("shell:openExternal", (_e, url: string) => {
    if (typeof url === "string" && (url.startsWith("http://") || url.startsWith("https://"))) shell.openExternal(url);
  });
  ipcMain.on("shell:showItemInFolder", (_e, p: string) => {
    if (typeof p === "string" && p) shell.showItemInFolder(p);
  });
}

// ------------------------------------------------------------
// Single instance
// ------------------------------------------------------------
const gotLock = app.requestSingleInstanceLock();
if (!gotLock) {
  app.quit();
} else {
  app.on("second-instance", () => {
    if (mainWindow) {
      if (mainWindow.isMinimized()) mainWindow.restore();
      mainWindow.focus();
    }
  });
}

// ------------------------------------------------------------
// Lifecycle
// ------------------------------------------------------------
app.whenReady().then(async () => {
  // Sécurité: désactive navigation non souhaitée
  app.on("web-contents-created", (_e, contents) => {
    contents.on("will-attach-webview", (ev) => ev.preventDefault());
  });

  setupIpc();
  buildMenu();
  createSplashWindow();

  try {
    await startBackend();
    if (splashWindow) splashWindow.webContents.send("backend:ready");
    // petit délai pour animation splash
    setTimeout(() => createMainWindow(), 700);
  } catch (e: any) {
    console.error(`[electron] Backend erreur: ${e?.message || e}`);
    if (splashWindow && !splashWindow.isDestroyed()) {
      splashWindow.webContents.executeJavaScript(`
        document.querySelector('.dots').textContent = 'Erreur backend: ${String(e?.message || e).replace(/'/g, "\\'").slice(0, 80)}';
        document.querySelector('.bar').style.background = '#ef4444';
      `).catch(() => {});
      dialog.showErrorBox(
        "TikTub — Erreur backend",
        `Impossible de démarrer le serveur:\n${e?.message || e}\n\nL'application va continuer en mode dégradé (fallback).`
      );
      // Continue quand même vers fenêtre principale
      createMainWindow();
    }
  }

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) createMainWindow();
  });
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});

app.on("before-quit", () => {
  stopBackend();
});

app.on("quit", () => {
  stopBackend();
});

// Gestion erreurs non catch
process.on("uncaughtException", (e) => console.error("[electron] uncaught", e));
