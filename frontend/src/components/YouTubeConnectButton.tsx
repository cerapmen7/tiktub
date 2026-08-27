import { useEffect, useState } from "react";
import { Youtube, ExternalLink, Check, Loader2, Unplug, RefreshCw } from "lucide-react";
import { getAuthUrl, getYoutubeStatus, getYoutubeChannels, disconnectYoutube } from "../lib/api.ts";
import { useAppStore } from "../stores/appStore.ts";
import type { YouTubeChannel } from "@shared/types";

type Props = {
  onChannelSelect?: (id: string | null) => void;
};

export default function YouTubeConnectButton({ onChannelSelect }: Props) {
  const { youtubeStatus, setYoutubeStatus, youtubeChannels, setYoutubeChannels, selectedChannelId, setSelectedChannelId, pushToast } =
    useAppStore();
  const [loadingAuth, setLoadingAuth] = useState(false);
  const [loadingStatus, setLoadingStatus] = useState(true);
  const [channelsLoading, setChannelsLoading] = useState(false);

  const refreshStatus = async () => {
    try {
      setLoadingStatus(true);
      const s = await getYoutubeStatus();
      setYoutubeStatus(s);
      if (s.authenticated) {
        try {
          setChannelsLoading(true);
          const ch = await getYoutubeChannels();
          setYoutubeChannels(ch);
          if (ch.length && !selectedChannelId) {
            setSelectedChannelId(ch[0].id);
            onChannelSelect?.(ch[0].id);
          }
        } catch (e: any) {
          // channels may 401 if not auth
          if (e.message?.includes("401") || e.message?.includes("auth")) {
            // remain
          } else console.warn(e);
        } finally {
          setChannelsLoading(false);
        }
      }
    } catch (e: any) {
      console.warn(e);
    } finally {
      setLoadingStatus(false);
    }
  };

  useEffect(() => {
    refreshStatus();
    // check query param youtube=connected
    const url = new URL(window.location.href);
    if (url.searchParams.get("youtube") === "connected") {
      pushToast("YouTube connecté !", "success");
      url.searchParams.delete("youtube");
      window.history.replaceState({}, "", url.toString());
      refreshStatus();
    }
    if (url.searchParams.get("youtube") === "error") {
      pushToast("Erreur connexion YouTube", "error");
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleConnect = async () => {
    try {
      setLoadingAuth(true);
      const { authUrl, url } = await getAuthUrl();
      const target = authUrl || url;
      if (target) {
        window.location.href = target;
      } else {
        pushToast("Impossible d'obtenir l'URL d'auth", "error");
      }
    } catch (e: any) {
      pushToast(e.message || "Erreur OAuth", "error");
    } finally {
      setLoadingAuth(false);
    }
  };

  const handleDisconnect = async () => {
    try {
      await disconnectYoutube();
      setYoutubeStatus({ authenticated: false, connected: false, mockMode: false, hasTokens: false });
      setYoutubeChannels([]);
      setSelectedChannelId(null);
      onChannelSelect?.(null);
      pushToast("Déconnecté de YouTube", "info");
    } catch (e: any) {
      pushToast(e.message, "error");
    }
  };

  if (loadingStatus) {
    return (
      <div className="flex items-center gap-2 text-sm text-zinc-400">
        <Loader2 className="h-4 w-4 animate-spin" /> Vérification YouTube…
      </div>
    );
  }

  const connected = !!youtubeStatus?.authenticated;

  if (!connected) {
    return (
      <div className="space-y-3">
        <div className="flex items-center gap-3 rounded-xl bg-red-500/10 border border-red-500/20 p-4">
          <div className="h-10 w-10 rounded-xl bg-red-600 flex items-center justify-center flex-shrink-0">
            <Youtube className="h-5 w-5 text-white" />
          </div>
          <div className="flex-1 min-w-0">
            <p className="text-sm font-semibold text-white">Non connecté à YouTube</p>
            <p className="text-xs text-zinc-400">Connecte ton compte pour uploader automatiquement.</p>
          </div>
        </div>
        <button onClick={handleConnect} disabled={loadingAuth} className="btn-primary w-full">
          {loadingAuth ? <Loader2 className="h-4 w-4 animate-spin" /> : <ExternalLink className="h-4 w-4" />}
          Se connecter avec YouTube
        </button>
        <p className="text-xs text-zinc-500 text-center">
          Tu seras redirigé vers Google OAuth. Scopes: youtube.upload
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-3 rounded-xl bg-emerald-500/10 border border-emerald-500/20 p-4">
        <div className="h-10 w-10 rounded-xl bg-emerald-600 flex items-center justify-center">
          <Check className="h-5 w-5 text-white" />
        </div>
        <div className="flex-1">
          <p className="text-sm font-semibold text-white flex items-center gap-2">
            YouTube connecté <span className="rounded-full bg-emerald-500/20 border border-emerald-500/30 px-2 py-0.5 text-[10px] font-bold tracking-widest uppercase text-emerald-300">OK</span>
          </p>
          <p className="text-xs text-zinc-400">
            {youtubeStatus?.mockMode ? "Mode mock actif (dev)" : "Compte authentifié"} • {youtubeChannels.length} chaîne(s)
          </p>
        </div>
        <button onClick={handleDisconnect} className="btn-ghost text-xs text-zinc-400 hover:text-red-400">
          <Unplug className="h-4 w-4" /> Déconnecter
        </button>
      </div>

      <div className="space-y-2">
        <div className="flex items-center justify-between">
          <label className="text-sm font-medium text-zinc-200">Chaîne cible</label>
          <button
            onClick={refreshStatus}
            className="inline-flex items-center gap-1 text-xs text-zinc-400 hover:text-white"
            title="Rafraîchir"
          >
            <RefreshCw className={`h-3 w-3 ${channelsLoading ? "animate-spin" : ""}`} /> Actualiser
          </button>
        </div>
        {channelsLoading ? (
          <div className="flex items-center gap-2 text-sm text-zinc-500">
            <Loader2 className="h-4 w-4 animate-spin" /> Chargement…
          </div>
        ) : youtubeChannels.length ? (
          <div className="grid gap-2">
            {youtubeChannels.map((ch: YouTubeChannel) => {
              const active = selectedChannelId === ch.id;
              return (
                <button
                  key={ch.id}
                  onClick={() => {
                    setSelectedChannelId(ch.id);
                    onChannelSelect?.(ch.id);
                  }}
                  className={`flex items-center gap-3 rounded-xl border p-3 text-left transition ${
                    active ? "bg-violet-600/20 border-violet-500/40 ring-1 ring-violet-500/20" : "bg-zinc-800 border-zinc-700 hover:border-zinc-600"
                  }`}
                >
                  <img src={ch.thumbnail || `https://picsum.photos/seed/${ch.id}/80/80`} alt={ch.title} className="h-10 w-10 rounded-full object-cover border border-zinc-700" />
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-medium text-white truncate">{ch.title}</p>
                    <p className="text-xs font-mono text-zinc-500 truncate">{ch.id}</p>
                  </div>
                  {active && <Check className="h-5 w-5 text-violet-400" />}
                </button>
              );
            })}
          </div>
        ) : (
          <p className="text-xs text-zinc-500">Aucune chaîne trouvée.</p>
        )}
        <p className="text-xs text-zinc-500">Les vidéos seront uploadées sur la chaîne sélectionnée en mode Shorts.</p>
      </div>
    </div>
  );
}
