import type { Job } from "@shared/types";
import { Clock, Pause, Play, XCircle, RotateCcw, Trash2, ExternalLink, Calendar, Hash, Timer } from "lucide-react";
import { formatDelay } from "../stores/appStore.ts";
import { deleteJob } from "../lib/api.ts";

type Props = {
  job: Job;
  onPause: (id: string) => void;
  onResume: (id: string) => void;
  onCancel: (id: string) => void;
  onRetry: (id: string) => void;
  onDelayChange?: (id: string, minutes: number) => void;
};

function statusBadge(status: Job["status"]) {
  const map: Record<string, { label: string; cls: string }> = {
    pending: { label: "En attente", cls: "bg-amber-500/15 text-amber-300 border-amber-500/20" },
    running: { label: "En cours", cls: "bg-emerald-500/15 text-emerald-300 border-emerald-500/20" },
    paused: { label: "En pause", cls: "bg-zinc-700 text-zinc-300 border-zinc-600" },
    completed: { label: "Terminé", cls: "bg-sky-500/15 text-sky-300 border-sky-500/20" },
    failed: { label: "Échoué", cls: "bg-red-500/15 text-red-300 border-red-500/20" },
    cancelled: { label: "Annulé", cls: "bg-zinc-800 text-zinc-500 border-zinc-700" },
  };
  const v = map[status] || map.pending;
  return <span className={`badge border ${v.cls}`}>{v.label}</span>;
}

function itemStatusBadge(s: string) {
  const map: Record<string, string> = {
    queued: "bg-zinc-800 text-zinc-400 border-zinc-700",
    downloading: "bg-sky-500/15 text-sky-300 border-sky-500/20",
    downloaded: "bg-violet-500/15 text-violet-300 border-violet-500/20",
    uploading: "bg-amber-500/15 text-amber-300 border-amber-500/20",
    published: "bg-emerald-500/15 text-emerald-300 border-emerald-500/20",
    failed: "bg-red-500/15 text-red-300 border-red-500/20",
    skipped: "bg-zinc-700 text-zinc-400 border-zinc-600",
  };
  return map[s] || map.queued;
}

export default function JobCard({ job, onPause, onResume, onCancel, onRetry, onDelayChange }: Props) {
  const pct = job.progress?.total ? Math.round((job.progress.done / job.progress.total) * 100) : 0;
  const canPause = job.status === "running" || job.status === "pending";
  const canResume = job.status === "paused";
  const canCancel = job.status !== "completed" && job.status !== "cancelled" && job.status !== "failed";
  const hasFailed = (job.progress?.failed ?? 0) > 0 || job.items?.some((i) => i.status === "failed");

  return (
    <div className="card space-y-4">
      {/* header */}
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0 space-y-1">
          <div className="flex flex-wrap items-center gap-2">
            <span className="font-mono text-xs text-zinc-500">#{job.id.slice(0, 8)}</span>
            {statusBadge(job.status)}
            <span className="inline-flex items-center gap-1 text-xs text-zinc-500">
              <Calendar className="h-3 w-3" /> {new Date(job.createdAt).toLocaleString("fr-FR")}
            </span>
          </div>
          <div className="flex flex-wrap gap-1.5">
            {job.config.handles.map((h) => (
              <span key={h} className="inline-flex items-center gap-1 rounded-full bg-zinc-800 border border-zinc-700 px-2.5 py-1 text-xs font-medium text-zinc-300">
                <Hash className="h-3 w-3 text-violet-400" />{h}
              </span>
            ))}
          </div>
        </div>
        <div className="flex items-center gap-1.5">
          {canPause && (
            <button onClick={() => onPause(job.id)} className="btn-secondary !px-3 !py-1.5 text-xs">
              <Pause className="h-3.5 w-3.5" /> Pause
            </button>
          )}
          {canResume && (
            <button onClick={() => onResume(job.id)} className="btn-primary !px-3 !py-1.5 text-xs">
              <Play className="h-3.5 w-3.5" /> Reprendre
            </button>
          )}
          {canCancel && (
            <button onClick={() => onCancel(job.id)} className="btn-ghost !px-3 !py-1.5 text-xs text-amber-400 hover:text-amber-300 hover:bg-amber-500/10">
              <XCircle className="h-3.5 w-3.5" /> Annuler
            </button>
          )}
          {hasFailed && (
            <button onClick={() => onRetry(job.id)} className="btn-secondary !px-3 !py-1.5 text-xs">
              <RotateCcw className="h-3.5 w-3.5" /> Retry
            </button>
          )}
        </div>
      </div>

      {/* progress */}
      <div className="space-y-2">
        <div className="flex items-center justify-between text-xs">
          <span className="font-medium text-zinc-400">
            Progression: <b className="text-white">{job.progress.done}/{job.progress.total}</b> {job.progress.failed ? <span className="text-red-400">• {job.progress.failed} échecs</span> : null}
          </span>
          <span className="font-bold text-violet-300">{pct}%</span>
        </div>
        <div className="h-2 rounded-full bg-zinc-800 overflow-hidden">
          <div className="h-full rounded-full transition-all" style={{ width: `${pct}%`, background: "linear-gradient(90deg,#7c3aed,#ec4899)" }} />
        </div>
        <div className="flex flex-wrap gap-2 text-xs text-zinc-500">
          <span className="inline-flex items-center gap-1"><Timer className="h-3 w-3" /> Délai: {formatDelay(job.config.delayMinutes)}</span>
          <span>• Tri: {job.config.sortBy}</span>
          <span>• Limit/handle: {job.config.limitPerHandle}</span>
          <span className={job.config.makePublic ? "text-emerald-400" : "text-zinc-500"}>• {job.config.makePublic ? "Public" : "Privé"}</span>
          {job.nextRunAt && <span className="inline-flex items-center gap-1"><Clock className="h-3 w-3" /> Prochaine: {new Date(job.nextRunAt).toLocaleTimeString("fr-FR")}</span>}
        </div>
        {onDelayChange && job.status !== "completed" && job.status !== "cancelled" && (
          <div className="flex items-center gap-2 pt-1">
            <label className="text-xs text-zinc-400">Modifier délai:</label>
            <input
              type="range"
              min={15}
              max={2880}
              step={15}
              defaultValue={job.config.delayMinutes}
              onMouseUp={(e) => onDelayChange(job.id, Number((e.target as HTMLInputElement).value))}
              onTouchEnd={(e) => onDelayChange(job.id, Number((e.target as HTMLInputElement).value))}
              className="flex-1 max-w-[200px]"
            />
            <span className="text-xs font-medium text-zinc-300">{formatDelay(job.config.delayMinutes)}</span>
          </div>
        )}
      </div>

      {/* items */}
      {job.items?.length ? (
        <div className="space-y-2">
          <h4 className="text-xs font-semibold tracking-widest uppercase text-zinc-400">Queue ({job.items.length})</h4>
          <div className="max-h-[320px] overflow-auto rounded-xl border border-zinc-800 divide-y divide-zinc-800/50 bg-zinc-900/50">
            {job.items.map((it) => (
              <div key={it.id} className="flex items-center gap-3 p-3">
                <img
                  src={it.video.coverUrl || `https://picsum.photos/seed/${it.video.id}/80/80`}
                  alt={it.video.title}
                  className="h-12 w-12 rounded-lg object-cover bg-zinc-800 border border-zinc-700 flex-shrink-0"
                />
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium text-zinc-100">{it.video.title || "Sans titre"}</p>
                  <p className="text-xs text-zinc-500 truncate">@{it.video.handle} • {it.video.hashtags?.slice(0,3).map(t=>`#${t}`).join(" ")}</p>
                  <div className="flex flex-wrap items-center gap-1.5 mt-1">
                    <span className={`badge border text-[11px] ${itemStatusBadge(it.status)}`}>{it.status}</span>
                    {it.scheduledAt && <span className="text-[11px] text-zinc-500 inline-flex items-center gap-1"><Clock className="h-3 w-3" />{new Date(it.scheduledAt).toLocaleString("fr-FR")}</span>}
                    {it.error && <span className="text-[11px] text-red-400 truncate max-w-[200px]">{it.error}</span>}
                  </div>
                </div>
                <div className="flex flex-col items-end gap-1 flex-shrink-0">
                  {it.youtubeUrl ? (
                    <a href={it.youtubeUrl} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-xs font-medium text-sky-400 hover:text-sky-300">
                      <ExternalLink className="h-3 w-3" /> YouTube
                    </a>
                  ) : it.youtubeVideoId ? (
                    <a href={`https://youtube.com/watch?v=${it.youtubeVideoId}`} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-xs text-sky-400">
                      <ExternalLink className="h-3 w-3" /> {it.youtubeVideoId}
                    </a>
                  ) : null}
                  <span className="text-[11px] text-zinc-600">#{it.attempts} tentatives</span>
                </div>
              </div>
            ))}
          </div>
        </div>
      ) : (
        <p className="text-xs text-zinc-500 italic">Aucun item dans la queue — en attente de génération.</p>
      )}

      {/* footer actions */}
      <div className="flex items-center justify-between pt-2 border-t border-zinc-800/50">
        <span className="text-[11px] text-zinc-600">MAJ: {new Date(job.updatedAt).toLocaleString("fr-FR")}</span>
        <button
          onClick={() => {
            if (confirm("Supprimer ce job ?")) {
              deleteJob(job.id).then(() => location.reload());
            }
          }}
          className="inline-flex items-center gap-1 text-xs text-zinc-500 hover:text-red-400 transition"
        >
          <Trash2 className="h-3 w-3" /> Supprimer
        </button>
      </div>
    </div>
  );
}
