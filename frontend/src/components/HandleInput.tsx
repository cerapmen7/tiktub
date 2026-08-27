import { useState, useEffect, useRef } from "react";
import { AtSign, Loader2, Check, X, AlertCircle, UserPlus } from "lucide-react";
import { validateHandle } from "../lib/api.ts";
import type { TikTokProfile } from "@shared/types";
import { useAppStore } from "../stores/appStore.ts";

type Props = {
  onAdd: (handle: string, profile: TikTokProfile) => void;
  disabled?: boolean;
  maxReached?: boolean;
};

export default function HandleInput({ onAdd, disabled, maxReached }: Props) {
  const pushToast = useAppStore((s) => s.pushToast);
  const [value, setValue] = useState("");
  const [loading, setLoading] = useState(false);
  const [profile, setProfile] = useState<TikTokProfile | null>(null);
  const [error, setError] = useState<string | null>(null);
  const debounceRef = useRef<number | null>(null);

  // live validation debounce 600ms
  useEffect(() => {
    if (debounceRef.current) window.clearTimeout(debounceRef.current);
    const raw = value.trim();
    if (!raw) {
      setProfile(null);
      setError(null);
      return;
    }
    // basic format check before calling API
    if (raw.replace(/^@/, "").length < 2) {
      setError(null);
      setProfile(null);
      return;
    }
    debounceRef.current = window.setTimeout(async () => {
      try {
        setLoading(true);
        setError(null);
        const p = await validateHandle(raw);
        if (!p.exists) {
          setError("Ce handle n'existe pas");
          setProfile(null);
        } else {
          setProfile(p);
        }
      } catch (e: any) {
        setError(e.message || "Validation impossible");
        setProfile(null);
      } finally {
        setLoading(false);
      }
    }, 600);
    return () => {
      if (debounceRef.current) window.clearTimeout(debounceRef.current);
    };
  }, [value]);

  const canAdd = !!profile && !loading && !disabled && !maxReached;

  const handleAdd = () => {
    if (!profile) return;
    const clean = profile.handle.replace(/^@/, "").toLowerCase();
    onAdd(clean, profile);
    setValue("");
    setProfile(null);
    setError(null);
    pushToast(`@${clean} ajouté`, "success");
  };

  return (
    <div className="space-y-3">
      <div className="relative">
        <span className="absolute left-3 top-1/2 -translate-y-1/2 text-zinc-500">
          <AtSign className="h-4 w-4" />
        </span>
        <input
          value={value}
          onChange={(e) => setValue(e.target.value)}
          placeholder="@charlidamelio"
          className="input pl-9 pr-24"
          disabled={disabled}
          onKeyDown={(e) => {
            if (e.key === "Enter" && canAdd) handleAdd();
          }}
          aria-label="Handle TikTok"
        />
        <div className="absolute right-1.5 top-1/2 -translate-y-1/2 flex items-center gap-1">
          {loading && <Loader2 className="h-4 w-4 animate-spin text-violet-400" />}
          {!loading && profile && <Check className="h-4 w-4 text-emerald-400" />}
          {!loading && error && <AlertCircle className="h-4 w-4 text-red-400" />}
          <button
            onClick={handleAdd}
            disabled={!canAdd}
            className="inline-flex items-center gap-1 rounded-lg bg-violet-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-violet-500 disabled:opacity-40 disabled:cursor-not-allowed transition"
          >
            <UserPlus className="h-3.5 w-3.5" /> Ajouter
          </button>
        </div>
      </div>

      {/* feedback */}
      {profile && (
        <div className="flex items-center gap-3 rounded-xl bg-emerald-500/10 border border-emerald-500/20 p-3">
          <img
            src={profile.avatar || `https://picsum.photos/seed/${profile.handle}/80/80`}
            alt={profile.handle}
            className="h-9 w-9 rounded-full object-cover border border-emerald-500/30"
          />
          <div className="min-w-0 flex-1">
            <div className="text-sm font-semibold text-white flex items-center gap-1.5">
              @{profile.handle} {profile.verified && <span className="text-sky-400">✔</span>}
              <span className="inline-flex items-center gap-1 rounded-full bg-emerald-500/20 px-2 py-0.5 text-[10px] font-bold tracking-widest uppercase text-emerald-300">
                <Check className="h-3 w-3" /> Validé
              </span>
            </div>
            <div className="text-xs text-zinc-400 truncate">
              {profile.nickname || profile.handle} {profile.followers ? `• ${Intl.NumberFormat("fr-FR").format(profile.followers)} followers` : ""}
            </div>
          </div>
        </div>
      )}
      {error && <p className="text-xs text-red-400 flex items-center gap-1.5"><X className="h-3.5 w-3.5" />{error}</p>}
      {maxReached && <p className="text-xs text-amber-400">Limite de 10 chaînes atteinte.</p>}
      <p className="text-xs text-zinc-500">Appuie sur Entrée ou clique sur Ajouter. Validation live via l&apos;API TikTok.</p>
    </div>
  );
}
