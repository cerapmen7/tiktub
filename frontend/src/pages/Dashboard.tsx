import { useEffect, useState, useCallback } from "react";
import { Link } from "react-router-dom";
import { RefreshCw, LayoutDashboard, Plus, Loader2, Search, AlertCircle } from "lucide-react";
import { listJobs, pauseJob, resumeJob, cancelJob, retryJob, updateJobDelay } from "../lib/api.ts";
import { useAppStore } from "../stores/appStore.ts";
import JobCard from "../components/JobCard.tsx";
import StatCard from "../components/StatCard.tsx";
import { Film, Clock, CheckCircle, XCircle } from "lucide-react";
import type { Job } from "@shared/types";

export default function Dashboard() {
  const jobs = useAppStore((s) => s.jobs);
  const setJobs = useAppStore((s) => s.setJobs);
  const pushToast = useAppStore((s) => s.pushToast);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [filter, setFilter] = useState<string>("all");
  const [search, setSearch] = useState("");

  const fetchJobs = useCallback(async () => {
    try {
      setError(null);
      const data = await listJobs();
      setJobs(data);
    } catch (e: any) {
      setError(e.message || "Erreur chargement jobs");
    } finally {
      setLoading(false);
    }
  }, [setJobs]);

  // initial + polling 3s
  useEffect(() => {
    fetchJobs();
    const id = window.setInterval(fetchJobs, 3000);
    return () => window.clearInterval(id);
  }, [fetchJobs]);

  const handlePause = async (id: string) => {
    try {
      await pauseJob(id);
      pushToast("Job en pause", "info");
      fetchJobs();
    } catch (e: any) {
      pushToast(e.message, "error");
    }
  };
  const handleResume = async (id: string) => {
    try {
      await resumeJob(id);
      pushToast("Job repris", "success");
      fetchJobs();
    } catch (e: any) {
      pushToast(e.message, "error");
    }
  };
  const handleCancel = async (id: string) => {
    if (!confirm("Annuler ce job ? Les items en cours seront stoppés.")) return;
    try {
      await cancelJob(id);
      pushToast("Job annulé", "info");
      fetchJobs();
    } catch (e: any) {
      pushToast(e.message, "error");
    }
  };
  const handleRetry = async (id: string) => {
    try {
      await retryJob(id);
      pushToast("Retry lancé", "success");
      fetchJobs();
    } catch (e: any) {
      pushToast(e.message, "error");
    }
  };
  const handleDelay = async (id: string, minutes: number) => {
    try {
      await updateJobDelay(id, minutes);
      pushToast(`Délai → ${minutes} min`, "success");
      fetchJobs();
    } catch (e: any) {
      pushToast(e.message, "error");
    }
  };

  const filtered = jobs.filter((j) => {
    if (filter !== "all" && j.status !== filter) return false;
    if (search) {
      const q = search.toLowerCase();
      const hay = `${j.id} ${j.config.handles.join(" ")} ${j.status}`.toLowerCase();
      if (!hay.includes(q)) return false;
    }
    return true;
  });

  const stats = {
    total: jobs.length,
    running: jobs.filter((j) => j.status === "running").length,
    pending: jobs.filter((j) => j.status === "pending").length,
    completed: jobs.filter((j) => j.status === "completed").length,
    failed: jobs.filter((j) => j.status === "failed").length,
    totalItems: jobs.reduce((a, j) => a + (j.progress?.total || 0), 0),
    doneItems: jobs.reduce((a, j) => a + (j.progress?.done || 0), 0),
  };

  return (
    <div className="space-y-6">
      <div className="rounded-[20px] card-premium p-6 flex flex-col sm:flex-row sm:items-end justify-between gap-4 overflow-hidden relative">
        <div className="absolute inset-0 bg-gradient-to-r from-violet-500/[0.06] via-transparent to-pink-500/[0.06] pointer-events-none" />
        <div className="relative">
          <h1 className="text-2xl sm:text-3xl font-extrabold tracking-tight flex items-center gap-3 font-display">
            <span className="h-9 w-9 rounded-xl bg-gradient-to-br from-violet-600 to-pink-500 grid place-items-center shadow-lg shadow-violet-600/20">
              <LayoutDashboard className="h-5 w-5 text-white" />
            </span>
            Dashboard <span className="hidden sm:inline-flex rounded-full bg-violet-500/15 border border-violet-500/20 px-2.5 py-1 text-xs font-bold tracking-widest uppercase text-violet-300">PRO</span>
          </h1>
          <p className="text-sm text-zinc-400 mt-2 max-w-xl">Suivi temps réel • <span className="text-emerald-300 font-medium">1ère vidéo immédiate</span> puis programmée sur YouTube — plus besoin de laisser le PC allumé.</p>
        </div>
        <div className="flex items-center gap-2">
          <button onClick={fetchJobs} className="btn-secondary !px-3 !py-2 text-xs">
            <RefreshCw className={`h-4 w-4 ${loading ? "animate-spin" : ""}`} /> Actualiser
          </button>
          <Link to="/" className="btn-primary !px-4 !py-2 text-sm">
            <Plus className="h-4 w-4" /> Nouveau job
          </Link>
        </div>
      </div>

      {/* stats */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <StatCard icon={<Film className="h-5 w-5" />} label="Jobs totaux" value={stats.total} sub={`${stats.totalItems} vidéos • ${stats.doneItems} faites`} />
        <StatCard icon={<Clock className="h-5 w-5" />} label="En cours / attente" value={`${stats.running + stats.pending}`} sub={`${stats.running} running • ${stats.pending} pending`} accent="linear-gradient(135deg,#06b6d4,#3b82f6)" />
        <StatCard icon={<CheckCircle className="h-5 w-5" />} label="Terminés" value={stats.completed} sub={`${stats.doneItems}/${stats.totalItems} done`} accent="linear-gradient(135deg,#10b981,#06b6d4)" />
        <StatCard icon={<XCircle className="h-5 w-5" />} label="Échecs" value={stats.failed} sub="jobs failed" accent="linear-gradient(135deg,#ef4444,#f59e0b)" />
      </div>

      {/* filters */}
      <div className="flex flex-col sm:flex-row gap-3 items-stretch sm:items-center justify-between">
        <div className="flex items-center gap-1.5 overflow-auto pb-1 sm:pb-0">
          {[
            { v: "all", l: "Tous" },
            { v: "running", l: "En cours" },
            { v: "pending", l: "En attente" },
            { v: "paused", l: "Pausés" },
            { v: "completed", l: "Terminés" },
            { v: "failed", l: "Échoués" },
          ].map((f) => (
            <button
              key={f.v}
              onClick={() => setFilter(f.v)}
              className={`whitespace-nowrap rounded-full px-3.5 py-1.5 text-xs font-semibold border transition ${filter === f.v ? "bg-violet-600 border-violet-500 text-white" : "bg-zinc-800 border-zinc-700 text-zinc-400 hover:border-zinc-600 hover:text-white"}`}
            >
              {f.l}
            </button>
          ))}
        </div>
        <div className="relative sm:w-[260px]">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-zinc-500" />
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Rechercher id, handle…"
            className="input pl-9 py-2 text-sm"
          />
        </div>
      </div>

      {/* content */}
      {loading && jobs.length === 0 ? (
        <div className="grid gap-3">
          {Array.from({ length: 3 }).map((_, i) => (
            <div key={i} className="card space-y-3">
              <div className="h-5 w-32 skeleton" />
              <div className="h-2 rounded-full skeleton" />
              <div className="h-24 skeleton" />
            </div>
          ))}
        </div>
      ) : error ? (
        <div className="card flex items-start gap-3 bg-red-500/10 border-red-500/20">
          <AlertCircle className="h-5 w-5 text-red-400 mt-0.5" />
          <div>
            <p className="font-semibold text-red-300">Erreur</p>
            <p className="text-sm text-red-200/80">{error}</p>
            <button onClick={fetchJobs} className="btn-secondary !px-3 !py-1.5 text-xs mt-3">
              <RefreshCw className="h-3.5 w-3.5" /> Réessayer
            </button>
          </div>
        </div>
      ) : filtered.length === 0 ? (
        <div className="card border-dashed text-center py-12 space-y-3">
          <Film className="h-10 w-10 text-zinc-600 mx-auto" />
          <h3 className="font-semibold text-white">Aucun job</h3>
          <p className="text-sm text-zinc-400 max-w-md mx-auto">
            {jobs.length === 0 ? "Lance ton premier job via le Wizard. Les jobs apparaîtront ici avec progression et queue." : "Aucun job ne correspond au filtre."}
          </p>
          <Link to="/" className="btn-primary inline-flex">
            <Plus className="h-4 w-4" /> Créer un job
          </Link>
        </div>
      ) : (
        <div className="grid gap-4">
          {filtered.map((job: Job) => (
            <JobCard
              key={job.id}
              job={job}
              onPause={handlePause}
              onResume={handleResume}
              onCancel={handleCancel}
              onRetry={handleRetry}
              onDelayChange={handleDelay}
            />
          ))}
        </div>
      )}

      {/* polling indicator */}
      <div className="flex items-center justify-center gap-2 text-xs text-zinc-600">
        <span className="h-2 w-2 rounded-full bg-emerald-500 animate-pulse" /> Polling automatique toutes les 3s
        {loading && <Loader2 className="h-3 w-3 animate-spin" />}
      </div>
    </div>
  );
}
