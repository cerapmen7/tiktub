import { useEffect, useState } from "react";
import { Settings as SettingsIcon, Save, Loader2, RefreshCw, Clock, Upload, Folder } from "lucide-react";
import { getSettings, updateSettings } from "../lib/api.ts";
import { useAppStore } from "../stores/appStore.ts";
import DelaySlider from "../components/DelaySlider.tsx";
import type { AppSettings } from "@shared/types";

export default function Settings() {
  const stored = useAppStore((s) => s.settings);
  const setStored = useAppStore((s) => s.setSettings);
  const pushToast = useAppStore((s) => s.pushToast);
  const [form, setForm] = useState<AppSettings>({
    defaultDelayMinutes: 60,
    maxConcurrentUploads: 2,
    downloadDir: "./data/downloads",
  });
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const fetchSettings = async () => {
    try {
      setLoading(true);
      setError(null);
      const s = await getSettings();
      setForm(s);
      setStored(s);
    } catch (e: any) {
      setError(e.message || "Erreur chargement settings");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (stored) {
      setForm(stored);
      setLoading(false);
    } else {
      fetchSettings();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleSave = async () => {
    try {
      setSaving(true);
      const updated = await updateSettings(form);
      setForm(updated);
      setStored(updated);
      pushToast("Paramètres sauvegardés", "success");
    } catch (e: any) {
      pushToast(e.message || "Échec sauvegarde", "error");
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return (
      <div className="max-w-2xl mx-auto space-y-4">
        <div className="h-8 w-40 skeleton" />
        <div className="card space-y-3">
          <div className="h-5 w-full skeleton" />
          <div className="h-10 w-full skeleton" />
          <div className="h-10 w-full skeleton" />
        </div>
      </div>
    );
  }

  return (
    <div className="max-w-2xl mx-auto space-y-6">
      <div className="space-y-1">
        <h1 className="text-2xl sm:text-3xl font-extrabold tracking-tight flex items-center gap-2">
          <SettingsIcon className="h-7 w-7 text-violet-400" /> Paramètres
        </h1>
        <p className="text-sm text-zinc-400">Gère les valeurs par défaut du pipeline. Correspond à GET/PATCH /api/settings.</p>
      </div>

      {error && (
        <div className="rounded-xl bg-red-500/10 border border-red-500/20 p-4 flex items-center gap-2 text-sm text-red-300">
          {error} <button onClick={fetchSettings} className="btn-secondary !px-2 !py-1 text-xs ml-auto"><RefreshCw className="h-3 w-3" /> Recharger</button>
        </div>
      )}

      <div className="card space-y-6">
        <DelaySlider
          value={form.defaultDelayMinutes}
          onChange={(v) => setForm((f) => ({ ...f, defaultDelayMinutes: v }))}
        />

        <div className="grid sm:grid-cols-2 gap-4">
          <label className="space-y-1.5">
            <span className="text-sm font-medium text-zinc-200 flex items-center gap-1.5">
              <Upload className="h-4 w-4 text-violet-400" /> Uploads concurrents
            </span>
            <div className="flex items-center gap-3">
              <input
                type="range"
                min={1}
                max={10}
                value={form.maxConcurrentUploads}
                onChange={(e) => setForm((f) => ({ ...f, maxConcurrentUploads: Number(e.target.value) }))}
                className="flex-1"
              />
              <span className="rounded-lg bg-zinc-800 border border-zinc-700 px-3 py-1.5 text-sm font-bold text-white min-w-[40px] text-center">{form.maxConcurrentUploads}</span>
            </div>
            <span className="text-xs text-zinc-500">1 à 10 uploads simultanés</span>
          </label>

          <label className="space-y-1.5">
            <span className="text-sm font-medium text-zinc-200 flex items-center gap-1.5">
              <Clock className="h-4 w-4 text-violet-400" /> Délai actuel
            </span>
            <div className="rounded-xl bg-zinc-800 border border-zinc-700 px-4 py-3 text-sm font-mono text-white">
              {form.defaultDelayMinutes} minutes (~{(form.defaultDelayMinutes / 60).toFixed(1)}h)
            </div>
            <span className="text-xs text-zinc-500">Synchronisé avec le wizard</span>
          </label>
        </div>

        <label className="space-y-1.5 block">
          <span className="text-sm font-medium text-zinc-200 flex items-center gap-1.5">
            <Folder className="h-4 w-4 text-violet-400" /> Dossier de téléchargement
          </span>
          <input
            value={form.downloadDir}
            onChange={(e) => setForm((f) => ({ ...f, downloadDir: e.target.value }))}
            placeholder="./data/downloads"
            className="input font-mono text-sm"
          />
          <span className="text-xs text-zinc-500">Chemin relatif ou absolu sur le serveur</span>
        </label>

        <div className="flex items-center gap-2 pt-2">
          <button onClick={handleSave} disabled={saving} className="btn-primary flex-1 sm:flex-none">
            {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
            Sauvegarder
          </button>
          <button onClick={fetchSettings} className="btn-secondary">
            <RefreshCw className="h-4 w-4" /> Recharger
          </button>
        </div>

        <div className="rounded-xl bg-violet-500/10 border border-violet-500/20 p-3 text-xs text-violet-200 leading-relaxed">
          Ces paramètres sont utilisés comme valeurs par défaut pour les nouveaux jobs. Les jobs existants gardent leur propre <code className="bg-violet-500/20 px-1 py-0.5 rounded">delayMinutes</code> modifiable depuis le Dashboard (PATCH /api/jobs/:id/delay).
        </div>
      </div>

      <div className="rounded-xl bg-zinc-900 border border-zinc-800 p-4 space-y-2">
        <h3 className="text-sm font-semibold text-white">Endpoints liés</h3>
        <code className="block text-xs font-mono text-zinc-400 leading-relaxed">
          GET /api/settings<br />
          PATCH /api/settings &#123; defaultDelayMinutes, maxConcurrentUploads, downloadDir &#125;
        </code>
      </div>
    </div>
  );
}
