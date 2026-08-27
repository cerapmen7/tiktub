export type SortBy = "popular" | "most_liked" | "recent";
export interface TikTokProfile {
    handle: string;
    nickname?: string;
    avatar?: string;
    followers?: number;
    verified?: boolean;
    exists: boolean;
}
export interface TikTokVideo {
    id: string;
    handle: string;
    title: string;
    description: string;
    hashtags: string[];
    coverUrl?: string;
    videoUrl?: string;
    wmVideoUrl?: string;
    playCount?: number;
    likeCount?: number;
    commentCount?: number;
    shareCount?: number;
    createTime?: number;
    duration?: number;
    musicTitle?: string;
}
export interface YouTubeChannel {
    id: string;
    title: string;
    thumbnail?: string;
}
export interface JobConfig {
    handles: string[];
    delayMinutes: number;
    limitPerHandle: number;
    sortBy: SortBy;
    youtubeChannelId?: string;
    makePublic: boolean;
    addCredit: boolean;
    asShorts: boolean;
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
    scheduledAt?: string;
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
    progress: {
        total: number;
        done: number;
        failed: number;
    };
}
export interface AppSettings {
    defaultDelayMinutes: number;
    maxConcurrentUploads: number;
    downloadDir: string;
}
//# sourceMappingURL=types.d.ts.map