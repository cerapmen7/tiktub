import { create } from "zustand";
import type { Job, YouTubeChannel, AppSettings, TikTokProfile, TikTokVideo, SortBy } from "@shared/types";

export type Toast = {
  id: string;
  message: string;
  type: "success" | "error" | "info";
};

type YoutubeStatus = {
  authenticated: boolean;
  connected: boolean;
  mockMode: boolean;
  hasTokens: boolean;
} | null;

type PreviewState = {
  videos: Record<string, TikTokVideo[]> | TikTokVideo[] | null;
  loading: boolean;
  error: string | null;
};

interface AppState {
  // Jobs
  jobs: Job[];
  jobsLoading: boolean;
  // TikTok handles
  handles: string[];
  handleProfiles: Record<string, TikTokProfile>;
  // YouTube
  youtubeStatus: YoutubeStatus;
  youtubeChannels: YouTubeChannel[];
  selectedChannelId: string | null;
  // Settings / config wizard
  settings: AppSettings | null;
  wizardConfig: {
    delayMinutes: number;
    limitPerHandle: number;
    sortBy: SortBy;
    makePublic: boolean;
    addCredit: boolean;
    fetchAll: boolean;
    useScheduledPublish: boolean;
  };
  // Preview
  preview: PreviewState;
  // UI
  toasts: Toast[];

  // Actions - jobs
  setJobs: (jobs: Job[]) => void;
  setJobsLoading: (v: boolean) => void;

  // Handles
  addHandle: (handle: string, profile?: TikTokProfile) => void;
  removeHandle: (handle: string) => void;
  setHandleProfile: (handle: string, profile: TikTokProfile) => void;
  clearHandles: () => void;

  // YouTube
  setYoutubeStatus: (s: YoutubeStatus) => void;
  setYoutubeChannels: (ch: YouTubeChannel[]) => void;
  setSelectedChannelId: (id: string | null) => void;

  // Settings
  setSettings: (s: AppSettings | null) => void;
  setWizardConfig: (patch: Partial<AppState["wizardConfig"]>) => void;

  // Preview
  setPreview: (patch: Partial<PreviewState>) => void;

  // Toast
  pushToast: (message: string, type?: Toast["type"]) => void;
  removeToast: (id: string) => void;
}

export const useAppStore = create<AppState>((set) => ({
  jobs: [],
  jobsLoading: false,

  handles: [],
  handleProfiles: {},

  youtubeStatus: null,
  youtubeChannels: [],
  selectedChannelId: null,

  settings: null,
  wizardConfig: {
    delayMinutes: 60,
    limitPerHandle: 10,
    sortBy: "popular",
    makePublic: false,
    addCredit: true,
    fetchAll: false,
    useScheduledPublish: true,
  },

  preview: {
    videos: null,
    loading: false,
    error: null,
  },

  toasts: [],

  setJobs: (jobs) => set({ jobs }),
  setJobsLoading: (v) => set({ jobsLoading: v }),

  addHandle: (handle, profile) =>
    set((s) => {
      const clean = handle.replace(/^@/, "").toLowerCase().trim();
      if (!clean || s.handles.includes(clean)) return s;
      if (s.handles.length >= 10) return s;
      const next = { ...s.handleProfiles };
      if (profile) next[clean] = profile;
      return { handles: [...s.handles, clean], handleProfiles: next };
    }),

  removeHandle: (handle) =>
    set((s) => {
      const clean = handle.replace(/^@/, "").toLowerCase().trim();
      const nextProfiles = { ...s.handleProfiles };
      delete nextProfiles[clean];
      return {
        handles: s.handles.filter((h) => h !== clean),
        handleProfiles: nextProfiles,
      };
    }),

  setHandleProfile: (handle, profile) =>
    set((s) => ({
      handleProfiles: { ...s.handleProfiles, [handle]: profile },
    })),

  clearHandles: () => set({ handles: [], handleProfiles: {} }),

  setYoutubeStatus: (youtubeStatus) => set({ youtubeStatus }),
  setYoutubeChannels: (youtubeChannels) => set({ youtubeChannels }),
  setSelectedChannelId: (selectedChannelId) => set({ selectedChannelId }),

  setSettings: (settings) => set({ settings }),
  setWizardConfig: (patch) =>
    set((s) => ({ wizardConfig: { ...s.wizardConfig, ...patch } })),

  setPreview: (patch) => set((s) => ({ preview: { ...s.preview, ...patch } })),

  pushToast: (message, type = "info") =>
    set((s) => {
      const id = `${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
      const toast: Toast = { id, message, type };
      // auto remove after 3.5s
      setTimeout(() => {
        set((curr) => ({ toasts: curr.toasts.filter((t) => t.id !== id) }));
      }, 3500);
      return { toasts: [...s.toasts, toast] };
    }),

  removeToast: (id) => set((s) => ({ toasts: s.toasts.filter((t) => t.id !== id) })),
}));

// Helper to humanize delay
export function formatDelay(minutes: number): string {
  if (minutes < 60) return `${minutes} min`;
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  if (m === 0) return `${h}h`;
  return `${h}h ${m}min`;
}
