import { contextBridge, ipcRenderer } from "electron";

// Expose une API safe au renderer (React)
contextBridge.exposeInMainWorld("tiktub", {
  // Infos app
  getVersion: (): Promise<string> => ipcRenderer.invoke("app:version"),
  getPlatform: (): string => process.platform,

  // Contrôles fenêtre
  minimize: () => ipcRenderer.send("window:minimize"),
  maximize: () => ipcRenderer.send("window:maximize"),
  close: () => ipcRenderer.send("window:close"),
  isMaximized: (): Promise<boolean> => ipcRenderer.invoke("window:isMaximized"),

  // Backend
  getBackendUrl: (): Promise<string> => ipcRenderer.invoke("backend:url"),
  checkBackendHealth: (): Promise<{ ok: boolean; data?: any }> => ipcRenderer.invoke("backend:health"),

  // Système
  openExternal: (url: string) => ipcRenderer.send("shell:openExternal", url),
  showItemInFolder: (path: string) => ipcRenderer.send("shell:showItemInFolder", path),

  // Events
  onBackendReady: (cb: () => void) => {
    ipcRenderer.on("backend:ready", cb);
    return () => ipcRenderer.removeListener("backend:ready", cb);
  },
  onBackendError: (cb: (msg: string) => void) => {
    const handler = (_: any, msg: string) => cb(msg);
    ipcRenderer.on("backend:error", handler);
    return () => ipcRenderer.removeListener("backend:error", handler);
  },
});

declare global {
  interface Window {
    tiktub: {
      getVersion(): Promise<string>;
      getPlatform(): string;
      minimize(): void;
      maximize(): void;
      close(): void;
      isMaximized(): Promise<boolean>;
      getBackendUrl(): Promise<string>;
      checkBackendHealth(): Promise<{ ok: boolean; data?: any }>;
      openExternal(url: string): void;
      showItemInFolder(path: string): void;
      onBackendReady(cb: () => void): () => void;
      onBackendError(cb: (msg: string) => void): () => void;
    };
  }
}
