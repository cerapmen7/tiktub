export type SortBy = "popular" | "most_liked" | "recent";

export interface TikTokProfile {
  handle: string; // without @
  nickname?: string;
  avatar?: string;
  followers?: number;
  verified?: boolean;
  exists: boolean;
}

export interface TikTokVideo {
  id: string;
  handle: string;
  title: string; // original desc / caption
  description: string;
  hashtags: string[];
  coverUrl?: string;
  videoUrl?: string; // direct download url (no watermark if possible)
  wmVideoUrl?: string;
  playCount?: number;
  likeCount?: number;
  commentCount?: number;
  shareCount?: number;
  createTime?: number; // unix
  duration?: number;
  musicTitle?: string;
}

export interface YouTubeChannel {
  id: string;
  title: string;
  thumbnail?: string;
}

export interface JobConfig {
  handles: string[]; // cleaned without @
  delayMinutes: number; // délai entre publications
  limitPerHandle: number; // nb vidéos par handle
  sortBy: SortBy;
  youtubeChannelId?: string;
  makePublic: boolean; // true = public, false = private/unlisted
  addCredit: boolean;
  asShorts: boolean; // always true for tiktok port
}

export type JobStatus = "pending" | "running" | "paused" | "completed" | "failed" | "cancelled";
export type ItemStatus = "queued" | "downloading" | "downloaded" | "uploading" | "published" | "failed" | "skipped";

export interface JobItem {
  id: string;
  jobId: string;
  video: TikTokVideo;
  status: ItemStatus;
  youtubeVideoId?: string;
  youtubeUrl?: string;
  scheduledAt?: string; // ISO
  publishedAt?: string;
  error?: string;
  attempts: number;
}

export interface Job {
  id: string;
  config: JobConfig;
  status: JobStatus;
  items: JobItem[];
  createdAt: string;
  updatedAt: string;
  nextRunAt?: string;
  progress: { total: number; done: number; failed: number };
}

export interface AppSettings {
  defaultDelayMinutes: number;
  maxConcurrentUploads: number;
  downloadDir: string;
}
