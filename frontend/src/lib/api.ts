import axios from "axios";
import type { TikTokProfile, TikTokVideo, YouTubeChannel, Job, JobConfig, AppSettings, SortBy } from "@shared/types";

// Fallback type if @shared not resolved
export type ApiResponse<T> = {
  success: boolean;
  data: T | null;
  error: string | null;
};

export const api = axios.create({
  baseURL: "/api",
  timeout: 30000,
  headers: {
    "Content-Type": "application/json",
  },
});

// Interceptors — log + normalize errors
api.interceptors.response.use(
  (res) => res,
  (error) => {
    const msg =
      error?.response?.data?.error ||
      error?.response?.data?.message ||
      error?.message ||
      "Erreur réseau";
    // Simple console warn; toast handled in UI
    console.warn("[api]", error?.config?.url, msg);
    return Promise.reject(new Error(msg));
  },
);

api.interceptors.request.use((cfg) => {
  // could attach auth token if needed
  return cfg;
});

// ---------------------------------------------------------------------------
// Helpers to unwrap ApiResponse
// ---------------------------------------------------------------------------
function unwrap<T>(res: { data: ApiResponse<T> }): T {
  const body = res.data;
  if (!body.success) throw new Error(body.error || "Erreur API");
  if (body.data === null || body.data === undefined) throw new Error(body.error || "Données manquantes");
  return body.data as T;
}

// ---------------------------------------------------------------------------
// TikTok
// ---------------------------------------------------------------------------
export async function validateHandle(handle: string): Promise<TikTokProfile> {
  const res = await api.post<ApiResponse<TikTokProfile>>("/tiktok/validate", { handle });
  return unwrap(res);
}

export type PreviewResponse = {
  handles: string[];
  limit: number;
  sortBy: SortBy;
  total: number;
  videos: Record<string, TikTokVideo[]> | TikTokVideo[];
  previews?: Record<string, TikTokVideo[]> | TikTokVideo[];
  errors?: Record<string, string>;
};

export async function preview(params: {
  handles: string[];
  limit?: number;
  sortBy?: SortBy;
  fetchAll?: boolean;
}): Promise<PreviewResponse> {
  const res = await api.post<ApiResponse<PreviewResponse>>("/tiktok/preview", {
    handles: params.handles,
    limit: params.limit ?? 10,
    sortBy: params.sortBy ?? "popular",
    fetchAll: params.fetchAll ?? false,
  });
  return unwrap(res);
}

// ---------------------------------------------------------------------------
// YouTube
// ---------------------------------------------------------------------------
export async function getAuthUrl(): Promise<{ authUrl: string; url: string; mock?: boolean }> {
  const res = await api.get<ApiResponse<{ authUrl: string; url: string; mock?: boolean }>>("/youtube/auth");
  return unwrap(res);
}

export async function getYoutubeStatus(): Promise<{
  authenticated: boolean;
  connected: boolean;
  mockMode: boolean;
  hasTokens: boolean;
}> {
  const res = await api.get<
    ApiResponse<{ authenticated: boolean; connected: boolean; mockMode: boolean; hasTokens: boolean }>
  >("/youtube/status");
  return unwrap(res);
}

export async function getYoutubeChannels(): Promise<YouTubeChannel[]> {
  const res = await api.get<ApiResponse<YouTubeChannel[]>>("/youtube/channels");
  return unwrap(res);
}

export async function disconnectYoutube(): Promise<{ disconnected: boolean }> {
  const res = await api.post<ApiResponse<{ disconnected: boolean }>>("/youtube/disconnect");
  return unwrap(res);
}

// ---------------------------------------------------------------------------
// Jobs
// ---------------------------------------------------------------------------
export async function createJob(config: JobConfig): Promise<Job> {
  const res = await api.post<ApiResponse<Job>>("/jobs", config);
  return unwrap(res);
}

export async function listJobs(): Promise<Job[]> {
  const res = await api.get<ApiResponse<Job[]>>("/jobs");
  const data = unwrap(res);
  // API returns { success, data: Job[] } — ensure array
  return Array.isArray(data) ? data : [];
}

export async function getJob(id: string): Promise<Job & { stats?: unknown }> {
  const res = await api.get<ApiResponse<Job>>(`/jobs/${id}`);
  return unwrap(res);
}

export async function pauseJob(id: string): Promise<Job> {
  const res = await api.post<ApiResponse<Job>>(`/jobs/${id}/pause`);
  return unwrap(res);
}

export async function resumeJob(id: string): Promise<Job> {
  const res = await api.post<ApiResponse<Job>>(`/jobs/${id}/resume`);
  return unwrap(res);
}

export async function cancelJob(id: string): Promise<Job> {
  const res = await api.post<ApiResponse<Job>>(`/jobs/${id}/cancel`);
  return unwrap(res);
}

export async function retryJob(id: string): Promise<Job> {
  const res = await api.post<ApiResponse<Job>>(`/jobs/${id}/retry`);
  return unwrap(res);
}

export async function updateJobDelay(id: string, delayMinutes: number): Promise<Job> {
  const res = await api.patch<ApiResponse<Job>>(`/jobs/${id}/delay`, { delayMinutes });
  return unwrap(res);
}

export async function deleteJob(id: string): Promise<{ deleted: boolean; id: string }> {
  const res = await api.delete<ApiResponse<{ deleted: boolean; id: string }>>(`/jobs/${id}`);
  return unwrap(res);
}

// ---------------------------------------------------------------------------
// Settings
// ---------------------------------------------------------------------------
export async function getSettings(): Promise<AppSettings> {
  const res = await api.get<ApiResponse<AppSettings>>("/settings");
  return unwrap(res);
}

export async function updateSettings(patch: Partial<AppSettings>): Promise<AppSettings> {
  const res = await api.patch<ApiResponse<AppSettings>>("/settings", patch);
  return unwrap(res);
}

// ---------------------------------------------------------------------------
// Health
// ---------------------------------------------------------------------------
export async function getHealth(): Promise<unknown> {
  const res = await api.get<ApiResponse<unknown>>("/health");
  return unwrap(res);
}
