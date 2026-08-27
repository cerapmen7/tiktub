import type { TikTokVideo } from "@shared/types";
import { Play, Heart, MessageCircle, Share2, Music } from "lucide-react";

type Props = {
  video: TikTokVideo;
  index?: number;
};

function formatCount(n?: number): string {
  if (n === undefined || n === null) return "—";
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1000) return `${(n / 1000).toFixed(1)}k`;
  return String(n);
}

export default function VideoCard({ video, index }: Props) {
  const thumb =
    video.coverUrl ||
    `https://picsum.photos/seed/${video.id || video.handle + (index ?? 0)}/320/480`;
  return (
    <div className="group overflow-hidden rounded-2xl bg-zinc-900 border border-zinc-800 hover:border-zinc-700 transition flex flex-col">
      <div className="relative aspect-[9/12] overflow-hidden bg-zinc-800">
        <img
          src={thumb}
          alt={video.title}
          className="h-full w-full object-cover group-hover:scale-[1.03] transition duration-500"
          loading="lazy"
        />
        <div className="absolute inset-0 bg-gradient-to-t from-black/70 via-black/10 to-transparent opacity-80" />
        {video.duration && (
          <span className="absolute left-2 top-2 rounded-lg bg-black/70 px-1.5 py-0.5 text-[11px] font-medium text-white border border-white/10">
            {Math.floor(video.duration)}s
          </span>
        )}
        <div className="absolute bottom-2 left-2 right-2 flex items-center gap-2 text-[11px] font-medium text-white">
          <span className="inline-flex items-center gap-1 rounded-full bg-black/60 px-2 py-1 border border-white/10">
            <Play className="h-3 w-3" /> {formatCount(video.playCount)}
          </span>
          <span className="inline-flex items-center gap-1 rounded-full bg-black/60 px-2 py-1 border border-white/10">
            <Heart className="h-3 w-3" /> {formatCount(video.likeCount)}
          </span>
        </div>
        {index !== undefined && (
          <span className="absolute right-2 top-2 h-6 w-6 rounded-full bg-violet-600 text-white grid place-items-center text-xs font-bold shadow-lg">
            {index + 1}
          </span>
        )}
      </div>
      <div className="p-3 space-y-2 flex-1 flex flex-col">
        <p className="text-sm font-medium leading-snug line-clamp-2 text-zinc-100" title={video.title}>
          {video.title || "Sans titre"}
        </p>
        {video.hashtags?.length ? (
          <p className="text-xs text-violet-300 line-clamp-1">{video.hashtags.map((t) => `#${t}`).join(" ")}</p>
        ) : null}
        <div className="mt-auto flex items-center gap-3 text-xs text-zinc-500 pt-1">
          <span className="inline-flex items-center gap-1">
            <Heart className="h-3 w-3" /> {formatCount(video.likeCount)}
          </span>
          <span className="inline-flex items-center gap-1">
            <MessageCircle className="h-3 w-3" /> {formatCount(video.commentCount)}
          </span>
          <span className="inline-flex items-center gap-1">
            <Share2 className="h-3 w-3" /> {formatCount(video.shareCount)}
          </span>
        </div>
        {video.musicTitle && (
          <div className="text-[11px] text-zinc-500 inline-flex items-center gap-1 truncate">
            <Music className="h-3 w-3" /> {video.musicTitle}
          </div>
        )}
        <div className="text-[11px] text-zinc-600">@{video.handle}</div>
      </div>
    </div>
  );
}

export function VideoSkeleton() {
  return (
    <div className="overflow-hidden rounded-2xl bg-zinc-900 border border-zinc-800 p-0">
      <div className="aspect-[9/12] skeleton" />
      <div className="p-3 space-y-2">
        <div className="h-3 rounded skeleton" />
        <div className="h-3 rounded skeleton w-5/6" />
        <div className="flex gap-2 pt-1">
          <div className="h-5 w-16 rounded-full skeleton" />
          <div className="h-5 w-16 rounded-full skeleton" />
        </div>
      </div>
    </div>
  );
}
