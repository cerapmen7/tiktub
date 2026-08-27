import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import {
  Sparkles,
  Youtube,
  AtSign,
  Settings2,
  Eye,
  Rocket,
  ChevronLeft,
  ChevronRight,
  Check,
  Trash2,
  Loader2,
  Wand2,
  Film,
  Clock,
  BadgeCheck,
  AlertCircle,
} from "lucide-react";
import ProgressBar from "../components/ProgressBar.tsx";
import DelaySlider from "../components/DelaySlider.tsx";
import HandleInput from "../components/HandleInput.tsx";
import YouTubeConnectButton from "../components/YouTubeConnectButton.tsx";
import VideoCard, { VideoSkeleton } from "../components/VideoCard.tsx";
import { useAppStore } from "../stores/appStore.ts";
import { preview, createJob } from "../lib/api.ts";
import type { TikTokVideo, SortBy } from "@shared/types";

const TOTAL_STEPS = 6;

const stepMeta = [
  { title: "Bienvenue", icon: Sparkles, desc: "Découvre TikTub" },
  { title: "YouTube", icon: Youtube, desc: "Connexion" },
  { title: "TikTok", icon: AtSign, desc: "Comptes" },
  { title: "Configuration", icon: Settings2, desc: "Réglages" },
  { title: "Aperçu", icon: Eye, desc: "Vidéos" },
  { title: "Lancer", icon: Rocket, desc: "Go !" },
];

export default function SetupWizard() {
  const navigate = useNavigate();
  const [step, setStep] = useState(1);
  const handles = useAppStore((s) => s.handles);
  const handleProfiles = useAppStore((s) => s.handleProfiles);
  const removeHandle = useAppStore((s) => s.removeHandle);
  const addHandle = useAppStore((s) => s.addHandle);
  const wizardConfig = useAppStore((s) => s.wizardConfig);
  const setWizardConfig = useAppStore((s) => s.setWizardConfig);
  const youtubeStatus = useAppStore((s) => s.youtubeStatus);
  const selectedChannelId = useAppStore((s) => s.selectedChannelId);
  const pushToast = useAppStore((s) => s.pushToast);
  const previewState = useAppStore((s) => s.preview);
  const setPreview = useAppStore((s) => s.setPreview);

  const [launching, setLaunching] = useState(false);

  const canNext = useMemo(() => {
    if (step === 2) return !!youtubeStatus?.authenticated; // need youtube auth
    if (step === 3) return handles.length > 0;
    if (step === 4) return true;
    if (step === 5) return true;
    return true;
  }, [step, youtubeStatus, handles.length]);

  const next = () => {
    if (step === 2 && !youtubeStatus?.authenticated) {
      pushToast("Connecte d'abord ton YouTube", "error");
      return;
    }
    if (step === 3 && handles.length === 0) {
      pushToast("Ajoute au moins un compte TikTok", "error");
      return;
    }
    if (step < TOTAL_STEPS) setStep((s) => s + 1);
  };
  const prev = () => setStep((s) => Math.max(1, s - 1));

  // Preview fetch when entering step 5
  useEffect(() => {
    if (step === 5 && handles.length) {
      let cancelled = false;
      (async () => {
        try {
          setPreview({ loading: true, error: null });
          const data = await preview({
            handles,
            limit: wizardConfig.limitPerHandle,
            sortBy: wizardConfig.sortBy,
          });
          if (cancelled) return;
          // data.videos may be array or record
          setPreview({ videos: (data.videos as any) ?? (data as any).previews ?? null, loading: false });
        } catch (e: any) {
          if (cancelled) return;
          setPreview({ loading: false, error: e.message || "Erreur preview" });
        }
      })();
      return () => {
        cancelled = true;
      };
    }
  }, [step, handles, wizardConfig.limitPerHandle, wizardConfig.sortBy, setPreview]);

  const handleLaunch = async () => {
    if (!handles.length) {
      pushToast("Aucun handle", "error");
      return;
    }
    try {
      setLaunching(true);
      const job = await createJob({
        handles,
        delayMinutes: wizardConfig.delayMinutes,
        limitPerHandle: wizardConfig.limitPerHandle,
        sortBy: wizardConfig.sortBy,
        youtubeChannelId: selectedChannelId || undefined,
        makePublic: wizardConfig.makePublic,
        addCredit: wizardConfig.addCredit,
        asShorts: true,
      });
      pushToast(`Job créé: ${job.id.slice(0, 8)}`, "success");
      navigate("/dashboard");
    } catch (e: any) {
      pushToast(e.message || "Échec création job", "error");
    } finally {
      setLaunching(false);
    }
  };

  // flatten preview videos for display & count
  const previewList: TikTokVideo[] = useMemo(() => {
    const v = previewState.videos;
    if (!v) return [];
    if (Array.isArray(v)) return v;
    // record
    return Object.values(v as Record<string, TikTokVideo[]>).flat();
  }, [previewState.videos]);

  const totalPreview = previewList.length;

  return (
    <div className="max-w-4xl mx-auto space-y-6">
      {/* header */}
      <div className="text-center space-y-3">
        <div className="inline-flex items-center gap-2 rounded-full bg-violet-500/10 border border-violet-500/20 px-3 py-1 text-xs font-semibold tracking-widest uppercase text-violet-300">
          <Wand2 className="h-3.5 w-3.5" /> Assistant de configuration
        </div>
        <h1 className="text-3xl sm:text-4xl font-extrabold tracking-tight">
          Lance ton <span className="text-gradient">TikTub</span> en 6 étapes
        </h1>
        <p className="text-sm text-zinc-400 max-w-2xl mx-auto">
          Importe automatiquement des TikToks vers YouTube Shorts avec délai, tri et crédits. Commence par connecter YouTube et ajoute tes créateurs préférés.
        </p>
      </div>

      <ProgressBar current={step} total={TOTAL_STEPS} />

      {/* stepper pills */}
      <div className="hidden sm:flex items-center justify-between gap-2">
        {stepMeta.map((m, i) => {
          const n = i + 1;
          const active = n === step;
          const done = n < step;
          const Icon = m.icon;
          return (
            <div
              key={m.title}
              className={`flex-1 flex items-center gap-2 rounded-xl border px-3 py-2.5 transition ${active ? "bg-violet-600 border-violet-500 text-white shadow-lg shadow-violet-600/20" : done ? "bg-emerald-500/10 border-emerald-500/20 text-emerald-200" : "bg-zinc-900 border-zinc-800 text-zinc-500"}`}
            >
              <div className={`h-7 w-7 rounded-lg grid place-items-center flex-shrink-0 ${active ? "bg-white/15" : done ? "bg-emerald-500/20" : "bg-zinc-800"}`}>
                {done ? <Check className="h-4 w-4" /> : <Icon className="h-4 w-4" />}
              </div>
              <div className="min-w-0 leading-none">
                <div className="text-xs font-bold">{m.title}</div>
                <div className="text-[11px] opacity-70">{m.desc}</div>
              </div>
            </div>
          );
        })}
      </div>

      {/* card */}
      <div className="card min-h-[420px] flex flex-col">
        <div className="flex-1">
          {step === 1 && <Step1 onNext={next} />}
          {step === 2 && <Step2 />}
          {step === 3 && <Step3 handles={handles} handleProfiles={handleProfiles} onAdd={addHandle} onRemove={removeHandle} />}
          {step === 4 && (
            <Step4
              delay={wizardConfig.delayMinutes}
              onDelay={(v) => setWizardConfig({ delayMinutes: v })}
              limit={wizardConfig.limitPerHandle}
              onLimit={(v) => setWizardConfig({ limitPerHandle: v })}
              sortBy={wizardConfig.sortBy}
              onSort={(v) => setWizardConfig({ sortBy: v })}
              makePublic={wizardConfig.makePublic}
              onMakePublic={(v) => setWizardConfig({ makePublic: v })}
              addCredit={wizardConfig.addCredit}
              onAddCredit={(v) => setWizardConfig({ addCredit: v })}
            />
          )}
          {step === 5 && (
            <Step5
              loading={previewState.loading}
              error={previewState.error}
              videos={previewList}
              total={totalPreview}
              handles={handles}
              refetch={() => {
                setPreview({ loading: true, error: null });
                preview({ handles, limit: wizardConfig.limitPerHandle, sortBy: wizardConfig.sortBy })
                  .then((d) => setPreview({ videos: (d.videos as any) ?? null, loading: false }))
                  .catch((e: any) => setPreview({ loading: false, error: e.message }));
              }}
            />
          )}
          {step === 6 && (
            <Step6
              handles={handles}
              config={wizardConfig}
              channelId={selectedChannelId}
              onLaunch={handleLaunch}
              launching={launching}
              youtubeConnected={!!youtubeStatus?.authenticated}
            />
          )}
        </div>

        {/* nav */}
        <div className="mt-6 flex items-center justify-between border-t border-zinc-800 pt-4 gap-3">
          <button
            onClick={prev}
            disabled={step === 1}
            className="btn-secondary disabled:opacity-40 disabled:cursor-not-allowed"
          >
            <ChevronLeft className="h-4 w-4" /> Précédent
          </button>
          <div className="text-xs text-zinc-500 hidden sm:block">
            Étape {step} sur {TOTAL_STEPS} — {stepMeta[step - 1].title}
          </div>
          {step < TOTAL_STEPS ? (
            <button
              onClick={next}
              disabled={!canNext}
              className="btn-primary disabled:opacity-40 disabled:cursor-not-allowed"
              title={!canNext ? "Condition non remplie" : ""}
            >
              Suivant <ChevronRight className="h-4 w-4" />
            </button>
          ) : (
            <button onClick={handleLaunch} disabled={launching || !handles.length} className="btn-primary">
              {launching ? <Loader2 className="h-4 w-4 animate-spin" /> : <Rocket className="h-4 w-4" />}
              Lancer l&apos;automatisation
            </button>
          )}
        </div>
      </div>

      {/* quick summary floating */}
      {handles.length > 0 && (
        <div className="flex flex-wrap items-center justify-center gap-2 text-xs">
          <span className="inline-flex items-center gap-1 rounded-full bg-zinc-800 border border-zinc-700 px-3 py-1 text-zinc-300">
            <AtSign className="h-3 w-3 text-violet-400" /> {handles.length} compte(s): {handles.join(", ")}
          </span>
          <span className="inline-flex items-center gap-1 rounded-full bg-zinc-800 border border-zinc-700 px-3 py-1 text-zinc-300">
            <Clock className="h-3 w-3 text-sky-400" /> {wizardConfig.limitPerHandle} vidéos/handle • tri {wizardConfig.sortBy}
          </span>
          {youtubeStatus?.authenticated && (
            <span className="inline-flex items-center gap-1 rounded-full bg-emerald-500/15 border border-emerald-500/20 px-3 py-1 text-emerald-300">
              <BadgeCheck className="h-3 w-3" /> YouTube connecté
            </span>
          )}
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Step 1
// ---------------------------------------------------------------------------
function Step1({ onNext }: { onNext: () => void }) {
  return (
    <div className="space-y-6 py-2">
      <div className="rounded-2xl gradient-brand-subtle border border-violet-500/20 p-6 sm:p-8 flex flex-col sm:flex-row gap-6 items-start">
        <div className="h-16 w-16 rounded-2xl gradient-brand grid place-items-center shadow-lg shadow-violet-600/20 flex-shrink-0">
          <Film className="h-8 w-8 text-white" />
        </div>
        <div className="space-y-2">
          <h2 className="text-2xl font-extrabold tracking-tight text-white">Bienvenue sur TikTub 🎬</h2>
          <p className="text-sm leading-relaxed text-zinc-300">
            TikTub republie automatiquement tes TikToks préférés vers YouTube Shorts. Connecte ton compte YouTube, choisis 1 à 10 créateurs TikTok, règle le délai et laisse le pipeline s&apos;occuper du téléchargement + upload.
          </p>
          <ul className="grid sm:grid-cols-3 gap-3 pt-3 text-xs">
            {[
              { t: "Multi-comptes", d: "Jusqu'à 10 handles" },
              { t: "Pipeline auto", d: "Queue + retry" },
              { t: "YouTube Shorts", d: "Upload natif" },
            ].map((f) => (
              <li key={f.t} className="rounded-xl bg-zinc-900/70 border border-zinc-700/50 p-3">
                <div className="font-semibold text-white">{f.t}</div>
                <div className="text-zinc-400">{f.d}</div>
              </li>
            ))}
          </ul>
        </div>
      </div>

      <div className="grid sm:grid-cols-2 gap-3">
        <div className="rounded-xl bg-zinc-900 border border-zinc-800 p-4 space-y-1">
          <h3 className="font-semibold text-white flex items-center gap-2">
            <Sparkles className="h-4 w-4 text-violet-400" /> Comment ça marche ?
          </h3>
          <ol className="list-decimal list-inside text-sm text-zinc-400 space-y-1 leading-relaxed">
            <li>Connexion YouTube OAuth</li>
            <li>Choix des comptes TikTok</li>
            <li>Configuration du délai & tri</li>
            <li>Aperçu des vidéos</li>
            <li>Lancement → Dashboard</li>
          </ol>
        </div>
        <div className="rounded-xl bg-zinc-900 border border-zinc-800 p-4 space-y-2">
          <h3 className="font-semibold text-white">Prêt ?</h3>
          <p className="text-sm text-zinc-400">Le wizard prend 2 minutes. Tu pourras tout modifier ensuite dans le Dashboard et Settings.</p>
          <button onClick={onNext} className="btn-primary w-full mt-1">
            Commencer <ChevronRight className="h-4 w-4" />
          </button>
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Step 2
// ---------------------------------------------------------------------------
function Step2() {
  const setSelectedChannelId = useAppStore((s) => s.setSelectedChannelId);
  return (
    <div className="space-y-4 py-2">
      <div className="space-y-1">
        <h2 className="text-xl font-bold tracking-tight flex items-center gap-2">
          <Youtube className="h-5 w-5 text-red-500" /> Connexion YouTube
        </h2>
        <p className="text-sm text-zinc-400">Authentifie-toi pour autoriser les uploads. Choisis ensuite la chaîne cible.</p>
      </div>
      <YouTubeConnectButton onChannelSelect={(id) => setSelectedChannelId(id)} />
    </div>
  );
}

// ---------------------------------------------------------------------------
// Step 3
// ---------------------------------------------------------------------------
function Step3({
  handles,
  handleProfiles,
  onAdd,
  onRemove,
}: {
  handles: string[];
  handleProfiles: Record<string, any>;
  onAdd: (h: string, p: any) => void;
  onRemove: (h: string) => void;
}) {
  const pushToast = useAppStore((s) => s.pushToast);
  return (
    <div className="space-y-5 py-2">
      <div className="space-y-1">
        <h2 className="text-xl font-bold tracking-tight flex items-center gap-2">
          <AtSign className="h-5 w-5 text-violet-400" /> Comptes TikTok
        </h2>
        <p className="text-sm text-zinc-400">Ajoute 1 à 10 comptes. Validation live, profils avec avatar + followers.</p>
      </div>

      <HandleInput onAdd={onAdd} maxReached={handles.length >= 10} />

      {handles.length > 0 ? (
        <div className="space-y-2">
          <h3 className="text-xs font-semibold tracking-widest uppercase text-zinc-400">Chaînes ajoutées ({handles.length}/10)</h3>
          <div className="grid gap-2">
            {handles.map((h) => {
              const p = handleProfiles[h];
              return (
                <div key={h} className="flex items-center gap-3 rounded-xl bg-zinc-800 border border-zinc-700 p-3">
                  <img
                    src={p?.avatar || `https://picsum.photos/seed/${h}/80/80`}
                    alt={h}
                    className="h-10 w-10 rounded-full object-cover border border-zinc-600"
                  />
                  <div className="min-w-0 flex-1">
                    <div className="text-sm font-semibold text-white flex items-center gap-1.5">
                      @{h} {p?.verified && <BadgeCheck className="h-4 w-4 text-sky-400" />}
                      {p?.exists !== false && <span className="inline-flex items-center gap-1 rounded-full bg-emerald-500/15 border border-emerald-500/20 px-2 py-0.5 text-[10px] font-bold text-emerald-300">VALIDÉ</span>}
                    </div>
                    <div className="text-xs text-zinc-400 truncate">
                      {p?.nickname || h} {p?.followers ? `• ${Intl.NumberFormat("fr-FR").format(p.followers)}` : ""}
                    </div>
                  </div>
                  <button
                    onClick={() => {
                      onRemove(h);
                      pushToast(`@${h} retiré`, "info");
                    }}
                    className="inline-flex h-8 w-8 items-center justify-center rounded-lg bg-zinc-900 border border-zinc-700 text-zinc-400 hover:text-red-400 hover:border-red-500/30 hover:bg-red-500/10 transition"
                    aria-label={`Retirer ${h}`}
                  >
                    <Trash2 className="h-4 w-4" />
                  </button>
                </div>
              );
            })}
          </div>
          {handles.length < 10 && (
            <p className="text-xs text-zinc-500 flex items-center gap-1">
              <span className="h-1.5 w-1.5 rounded-full bg-emerald-500" /> Tu peux encore ajouter {10 - handles.length} chaîne(s). Bouton « Ajouter une chaîne » = input ci-dessus.
            </p>
          )}
          {handles.length >= 10 && <p className="text-xs text-amber-400 flex items-center gap-1"><AlertCircle className="h-3 w-3" /> Limite atteinte.</p>}
        </div>
      ) : (
        <div className="rounded-xl border border-dashed border-zinc-700 bg-zinc-900/50 p-8 text-center space-y-2">
          <AtSign className="h-8 w-8 text-zinc-600 mx-auto" />
          <p className="text-sm font-medium text-zinc-400">Aucun compte ajouté</p>
          <p className="text-xs text-zinc-500">Tape un handle au-dessus (ex: @khaby.lame) — validation instantanée.</p>
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Step 4
// ---------------------------------------------------------------------------
function Step4({
  delay,
  onDelay,
  limit,
  onLimit,
  sortBy,
  onSort,
  makePublic,
  onMakePublic,
  addCredit,
  onAddCredit,
}: {
  delay: number;
  onDelay: (v: number) => void;
  limit: number;
  onLimit: (v: number) => void;
  sortBy: SortBy;
  onSort: (v: SortBy) => void;
  makePublic: boolean;
  onMakePublic: (v: boolean) => void;
  addCredit: boolean;
  onAddCredit: (v: boolean) => void;
}) {
  return (
    <div className="space-y-6 py-2">
      <div className="space-y-1">
        <h2 className="text-xl font-bold tracking-tight flex items-center gap-2">
          <Settings2 className="h-5 w-5 text-violet-400" /> Configuration
        </h2>
        <p className="text-sm text-zinc-400">Règle le délai, le nombre de vidéos et le tri.</p>
      </div>

      <DelaySlider value={delay} onChange={onDelay} />

      <div className="grid sm:grid-cols-2 gap-4">
        <div className="space-y-2">
          <label className="text-sm font-medium text-zinc-200 flex items-center gap-2">
            <Film className="h-4 w-4 text-violet-400" /> Vidéos par compte
          </label>
          <div className="flex items-center gap-3">
            <input
              type="range"
              min={5}
              max={50}
              step={1}
              value={limit}
              onChange={(e) => onLimit(Number(e.target.value))}
              className="flex-1"
            />
            <span className="rounded-lg bg-zinc-800 border border-zinc-700 px-3 py-1.5 text-sm font-bold text-white min-w-[52px] text-center">
              {limit}
            </span>
          </div>
          <p className="text-xs text-zinc-500">5 à 50 vidéos par handle (total max {limit}×n).</p>
        </div>

        <div className="space-y-2">
          <label className="text-sm font-medium text-zinc-200">Tri</label>
          <div className="grid grid-cols-3 gap-1.5">
            {[
              { v: "popular", l: "Populaires", e: "🔥" },
              { v: "most_liked", l: "Plus likées", e: "❤️" },
              { v: "recent", l: "Récentes", e: "🕒" },
            ].map((o) => (
              <button
                key={o.v}
                onClick={() => onSort(o.v as SortBy)}
                className={`rounded-xl border px-3 py-2.5 text-xs font-semibold transition ${sortBy === o.v ? "bg-violet-600 border-violet-500 text-white shadow" : "bg-zinc-800 border-zinc-700 text-zinc-400 hover:border-zinc-600 hover:text-white"}`}
              >
                <span className="block text-base">{o.e}</span>
                {o.l}
              </button>
            ))}
          </div>
        </div>
      </div>

      <div className="grid sm:grid-cols-2 gap-3">
        <label className="flex items-center justify-between rounded-xl bg-zinc-800 border border-zinc-700 p-4 cursor-pointer hover:border-zinc-600 transition">
          <div>
            <div className="text-sm font-medium text-white">Rendre public</div>
            <div className="text-xs text-zinc-500">{makePublic ? "Public immédiatement" : "Privé / non répertorié"}</div>
          </div>
          <input type="checkbox" checked={makePublic} onChange={(e) => onMakePublic(e.target.checked)} className="h-5 w-10 appearance-none rounded-full bg-zinc-700 relative transition checked:bg-violet-600 before:absolute before:h-4 before:w-4 before:rounded-full before:bg-white before:top-0.5 before:left-0.5 before:transition checked:before:translate-x-5" />
        </label>
        <label className="flex items-center justify-between rounded-xl bg-zinc-800 border border-zinc-700 p-4 cursor-pointer hover:border-zinc-600 transition">
          <div>
            <div className="text-sm font-medium text-white">Ajouter crédit</div>
            <div className="text-xs text-zinc-500">@handle dans desc.</div>
          </div>
          <input type="checkbox" checked={addCredit} onChange={(e) => onAddCredit(e.target.checked)} className="h-5 w-10 appearance-none rounded-full bg-zinc-700 relative transition checked:bg-violet-600 before:absolute before:h-4 before:w-4 before:rounded-full before:bg-white before:top-0.5 before:left-0.5 before:transition checked:before:translate-x-5" />
        </label>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Step 5
// ---------------------------------------------------------------------------
function Step5({
  loading,
  error,
  videos,
  total,
  handles,
  refetch,
}: {
  loading: boolean;
  error: string | null;
  videos: TikTokVideo[];
  total: number;
  handles: string[];
  refetch: () => void;
}) {
  return (
    <div className="space-y-4 py-2">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h2 className="text-xl font-bold tracking-tight flex items-center gap-2">
            <Eye className="h-5 w-5 text-violet-400" /> Aperçu
          </h2>
          <p className="text-sm text-zinc-400">
            {handles.length} compte(s) • {total} vidéos trouvées • tri phía server
          </p>
        </div>
        <button onClick={refetch} className="btn-secondary text-xs !px-3 !py-1.5">
          <Wand2 className="h-3.5 w-3.5" /> Rafraîchir
        </button>
      </div>

      {loading && (
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3">
          {Array.from({ length: 8 }).map((_, i) => (
            <VideoSkeleton key={i} />
          ))}
        </div>
      )}
      {error && (
        <div className="rounded-xl bg-red-500/10 border border-red-500/20 p-4 flex items-start gap-3">
          <AlertCircle className="h-5 w-5 text-red-400 flex-shrink-0 mt-0.5" />
          <div className="space-y-1">
            <p className="text-sm font-semibold text-red-300">Erreur preview</p>
            <p className="text-xs text-red-200/80">{error}</p>
            <button onClick={refetch} className="btn-secondary !px-3 !py-1.5 text-xs mt-2">
              Réessayer
            </button>
          </div>
        </div>
      )}
      {!loading && !error && videos.length === 0 && (
        <div className="rounded-xl border border-dashed border-zinc-700 p-8 text-center">
          <Eye className="h-8 w-8 text-zinc-600 mx-auto mb-2" />
          <p className="text-sm text-zinc-400">Aucune vidéo à afficher</p>
          <p className="text-xs text-zinc-500">Vérifie les handles ou change le tri.</p>
        </div>
      )}
      {!loading && !error && videos.length > 0 && (
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3">
          {videos.map((v, i) => (
            <VideoCard key={`${v.handle}_${v.id}_${i}`} video={v} index={i} />
          ))}
        </div>
      )}
      {!loading && !error && videos.length > 0 && (
        <p className="text-xs text-zinc-500 text-center">Grille: thumbnails + titre + stats plays/likes. Chargement skeleton pendant fetch.</p>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Step 6
// ---------------------------------------------------------------------------
function Step6({
  handles,
  config,
  channelId,
  onLaunch,
  launching,
  youtubeConnected,
}: {
  handles: string[];
  config: { delayMinutes: number; limitPerHandle: number; sortBy: SortBy; makePublic: boolean; addCredit: boolean };
  channelId: string | null;
  onLaunch: () => void;
  launching: boolean;
  youtubeConnected: boolean;
}) {
  const totalVideos = handles.length * config.limitPerHandle;
  const durationHours = Math.round((totalVideos * config.delayMinutes) / 60);
  return (
    <div className="space-y-6 py-2">
      <div className="text-center space-y-2">
        <div className="mx-auto h-16 w-16 rounded-2xl gradient-brand grid place-items-center shadow-lg shadow-violet-600/20">
          <Rocket className="h-8 w-8 text-white" />
        </div>
        <h2 className="text-2xl font-extrabold tracking-tight">Prêt à lancer !</h2>
        <p className="text-sm text-zinc-400">Vérifie le récapitulatif puis lance le pipeline.</p>
      </div>

      <div className="grid sm:grid-cols-2 gap-3">
        <div className="rounded-xl bg-zinc-800 border border-zinc-700 p-4 space-y-2">
          <h3 className="text-xs font-bold tracking-widest uppercase text-zinc-400">Récapitulatif</h3>
          <ul className="space-y-1.5 text-sm">
            <li className="flex justify-between"><span className="text-zinc-500">Comptes</span><b className="text-white">{handles.join(", ")}</b></li>
            <li className="flex justify-between"><span className="text-zinc-500">Vidéos/compte</span><b className="text-white">{config.limitPerHandle}</b></li>
            <li className="flex justify-between"><span className="text-zinc-500">Total estimé</span><b className="text-white">{totalVideos} vidéos</b></li>
            <li className="flex justify-between"><span className="text-zinc-500">Délai</span><b className="text-white">{config.delayMinutes} min</b></li>
            <li className="flex justify-between"><span className="text-zinc-500">Durée totale</span><b className="text-violet-300">~{durationHours}h</b></li>
            <li className="flex justify-between"><span className="text-zinc-500">Tri</span><b className="text-white">{config.sortBy}</b></li>
            <li className="flex justify-between"><span className="text-zinc-500">Chaîne YT</span><b className="text-white truncate max-w-[150px]">{channelId || "Auto"}</b></li>
          </ul>
        </div>
        <div className="rounded-xl bg-zinc-900 border border-zinc-800 p-4 space-y-3">
          <h3 className="text-xs font-bold tracking-widest uppercase text-zinc-400">Options</h3>
          <div className="space-y-2 text-sm">
            <div className={`flex items-center gap-2 ${config.makePublic ? "text-emerald-300" : "text-zinc-500"}`}>
              {config.makePublic ? <Check className="h-4 w-4" /> : <AlertCircle className="h-4 w-4" />} {config.makePublic ? "Public" : "Privé"}
            </div>
            <div className={`flex items-center gap-2 ${config.addCredit ? "text-emerald-300" : "text-zinc-500"}`}>
              {config.addCredit ? <Check className="h-4 w-4" /> : <AlertCircle className="h-4 w-4" />} Crédit {config.addCredit ? "activé" : "désactivé"}
            </div>
            <div className={`flex items-center gap-2 ${youtubeConnected ? "text-emerald-300" : "text-amber-400"}`}>
              {youtubeConnected ? <Check className="h-4 w-4" /> : <AlertCircle className="h-4 w-4" />} YouTube {youtubeConnected ? "connecté" : "non connecté → mock upload"}
            </div>
          </div>
          {!youtubeConnected && (
            <p className="text-xs text-amber-400 bg-amber-500/10 border border-amber-500/20 rounded-lg p-2">YouTube non connecté: le pipeline fonctionnera en mode mock. Connecte-toi à l’étape 2 pour de vrais uploads.</p>
          )}
        </div>
      </div>

      <button
        onClick={onLaunch}
        disabled={launching || handles.length === 0}
        className="btn-primary w-full py-4 text-base"
      >
        {launching ? <Loader2 className="h-5 w-5 animate-spin" /> : <Rocket className="h-5 w-5" />}
        {launching ? "Création du job…" : "Lancer l’automatisation → Dashboard"}
      </button>
      <p className="text-xs text-zinc-500 text-center">POST /api/jobs — redirection Dashboard après succès. Polling 3s pour suivi.</p>
    </div>
  );
}
