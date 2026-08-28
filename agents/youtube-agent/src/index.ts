/**
 * @tiktub/youtube-agent — Agent YouTube
 * - OAuth2 (getAuthUrl, getTokens, setTokens, loadTokens, saveTokens, isAuthenticated)
 * - getChannels (mine=true)
 * - uploadVideo avec normalisation metadata + mode MOCK si credentials manquants
 * - Helpers de normalisation via shared/constants.ts
 *
 * Importable par backend via `import { getAuthUrl, uploadVideo } from "../../agents/youtube-agent/src/index.js"`
 */

import * as fs from "node:fs";
import * as path from "node:path";
import { google } from "googleapis";
import type { youtube_v3 } from "googleapis";

import type { YouTubeChannel } from "../../../shared/types.js";

import {
  loadTokens as loadTokensFromFile,
  saveTokens as saveTokensToFile,
  saveTokensToPath,
  getCachedTokens,
  setCachedTokens,
  resolveTokenPath,
  type YouTubeTokens,
} from "./tokens.js";

import {
  mockUploadVideo,
  mockGetChannels,
  mockGetAuthUrl,
  mockGetTokens,
} from "./mock.js";

// ---------------------------------------------------------------------------
// Constantes & helpers locaux — inline pour éviter import ESM/CJS cassé en packaged
// ---------------------------------------------------------------------------

const YOUTUBE_TITLE_LIMIT = 100 as number;
const YOUTUBE_DESC_LIMIT = 5000 as number;
const YOUTUBE_TAGS_LIMIT = 15 as number;

function tiktokToYouTubeTitleLocal(tiktokTitle: string, handle: string, _addCredit: boolean): string {
  let title = tiktokTitle.trim() || `TikTok @${handle}`;
  if (title.length > YOUTUBE_TITLE_LIMIT) title = title.slice(0, YOUTUBE_TITLE_LIMIT - 3) + "...";
  return title;
}
function tiktokToYouTubeDescriptionLocal(
  video: { title: string; description: string; hashtags: string[]; handle: string },
  addCredit: boolean
): string {
  const tags = video.hashtags.map((h) => `#${h}`).join(" ");
  let desc = video.description || video.title || "";
  if (tags) desc += `\n\n${tags}`;
  if (addCredit) desc += `\n\nCrédit: @${video.handle} sur TikTok — Repost via TikTub`;
  desc += `\n\n#Shorts #TikTok`;
  if (desc.length > YOUTUBE_DESC_LIMIT) desc = desc.slice(0, YOUTUBE_DESC_LIMIT);
  return desc;
}
function normalizeHashtagsLocal(tags: string[]): string[] {
  return tags
    .map((t) => t.replace(/^#/, "").toLowerCase())
    .filter(Boolean)
    .slice(0, YOUTUBE_TAGS_LIMIT);
}

function getTiktokToYouTubeTitle(): typeof tiktokToYouTubeTitleLocal {
  return tiktokToYouTubeTitleLocal;
}
function getTiktokToYouTubeDescription(): typeof tiktokToYouTubeDescriptionLocal {
  return tiktokToYouTubeDescriptionLocal;
}
function getNormalizeHashtags(): typeof normalizeHashtagsLocal {
  return normalizeHashtagsLocal;
}

// ---------------------------------------------------------------------------
// Config OAuth2 & mock detection
// ---------------------------------------------------------------------------

const DEFAULT_SCOPES = [
  "https://www.googleapis.com/auth/youtube.upload",
  "https://www.googleapis.com/auth/youtube",
];

function getEnvConfig(): { clientId: string; clientSecret: string; redirectUri: string } {
  return {
    clientId: (process.env.GOOGLE_CLIENT_ID || "").trim(),
    clientSecret: (process.env.GOOGLE_CLIENT_SECRET || "").trim(),
    redirectUri: (process.env.GOOGLE_REDIRECT_URI || "http://localhost:3001/api/youtube/callback").trim(),
  };
}

function getScopes(): string[] {
  const raw = (process.env.YOUTUBE_SCOPES || "").trim();
  if (raw) return raw.split(/\s+/).filter(Boolean);
  return DEFAULT_SCOPES;
}

/**
 * Détecte le mode MOCK: credentials manquants ou placeholder.
 * Gère dev sans Google Cloud.
 */
export function isMockMode(): boolean {
  const { clientId, clientSecret } = getEnvConfig();
  if (!clientId || !clientSecret) return true;
  const lower = clientId.toLowerCase();
  if (
    lower.includes("placeholder") ||
    lower.includes("your_google") ||
    lower.includes("dummy") ||
    lower === "test" ||
    lower === "mock" ||
    clientId.trim() === ""
  )
    return true;
  // Détection du placeholder exact de .env.example
  if (clientId === "your_google_client_id.apps.googleusercontent.com") return true;
  return false;
}

// Singleton OAuth2
let oauth2Client: InstanceType<typeof google.auth.OAuth2> | null = null;

function getOAuth2Client(): InstanceType<typeof google.auth.OAuth2> {
  if (oauth2Client) return oauth2Client;
  const { clientId, clientSecret, redirectUri } = getEnvConfig();
  oauth2Client = new google.auth.OAuth2(clientId, clientSecret, redirectUri);

  // Rafraîchissement auto: persiste les nouveaux tokens
  oauth2Client.on("tokens", async (tokens) => {
    try {
      const current = getCachedTokens() || {};
      const merged: YouTubeTokens = { ...current, ...tokens };
      // conserve refresh_token s'il n'est pas renvoyé
      if (!merged.refresh_token && current.refresh_token) merged.refresh_token = current.refresh_token;
      setCachedTokens(merged);
      // sauvegarde disque (fire-and-forget, log erreur si échec)
      await saveTokensToPath(merged).catch((e) => console.warn(`[youtube-agent] échec sauvegarde tokens refresh: ${e}`));
      console.log("[youtube-agent] tokens rafraîchis automatiquement");
    } catch (e) {
      console.warn(`[youtube-agent] erreur handler tokens: ${e}`);
    }
  });

  // Restaure tokens du disque si dispo (au premier appel)
  // Note: asynchrone, mais setCredentials sera fait au prochain loadTokens ou setTokens
  loadTokensFromFile()
    .then((t) => {
      if (t && oauth2Client) {
        oauth2Client.setCredentials(t as any);
      }
    })
    .catch(() => {});

  return oauth2Client;
}

// ---------------------------------------------------------------------------
// Types upload
// ---------------------------------------------------------------------------

export interface UploadMetadata {
  title: string;
  description: string;
  tags: string[]; // sans #, sera normalisé
  privacyStatus: "public" | "private" | "unlisted";
  madeForKids: boolean;
  handle: string; // pour génération titre/description via helpers
  selfDeclaredMadeForKids?: boolean;
  addCredit?: boolean; // défaut true
  publishAt?: string; // ISO 8601 pour publication programmée YouTube (pas besoin PC allumé)
  scheduledPublishAt?: string; // alias
}

export interface UploadResult {
  videoId: string;
  url: string;
}

// ---------------------------------------------------------------------------
// Helpers normalisation metadata
// ---------------------------------------------------------------------------

/**
 * Normalise un titre TikTok → YouTube via shared helper.
 */
export function normalizeTitle(rawTitle: string, handle: string, addCredit = true): string {
  const fn = getTiktokToYouTubeTitle();
  return fn(rawTitle, handle, addCredit);
}

/**
 * Normalise description + hashtags → YouTube description.
 */
export function normalizeDescription(
  video: { title: string; description: string; hashtags: string[]; handle: string },
  addCredit = true
): string {
  const fn = getTiktokToYouTubeDescription();
  return fn(video, addCredit);
}

/**
 * Normalise tags YouTube (lowercase, sans #, max 15).
 */
export function normalizeTags(tags: string[]): string[] {
  const fn = getNormalizeHashtags();
  return fn(tags);
}

/**
 * Normalise l'ensemble des métadonnées d'upload.
 * - titre tronqué à 100c
 * - description tronquée à 5000c
 * - tags normalisés
 */
export function normalizeMetadata(meta: UploadMetadata): { title: string; description: string; tags: string[] } {
  const rawTags = Array.isArray(meta.tags) ? meta.tags : [];
  // hashtags peuvent contenir # — on nettoie
  const cleanedTags = normalizeTags(rawTags);

  const title = normalizeTitle(meta.title || "", meta.handle || "tiktok", meta.addCredit ?? true);

  const descInput = {
    title: meta.title || "",
    description: meta.description || meta.title || "",
    hashtags: cleanedTags,
    handle: meta.handle || "tiktok",
  };
  const description = normalizeDescription(descInput, meta.addCredit ?? true);

  return { title, description, tags: cleanedTags };
}

// ---------------------------------------------------------------------------
// Auth: getAuthUrl, getTokens, setTokens, loadTokens, saveTokens, isAuthenticated
// ---------------------------------------------------------------------------

/**
 * Génère l'URL OAuth2 Google.
 * - Scopes: youtube.upload + youtube
 * - Mode MOCK si credentials manquants → URL fictive
 */
export function getAuthUrl(state?: string): string {
  if (isMockMode()) {
    console.warn("[youtube-agent] Mode MOCK: credentials manquants ou placeholder — URL OAuth simulée");
    return mockGetAuthUrl(state);
  }
  const client = getOAuth2Client();
  const url = client.generateAuthUrl({
    access_type: "offline",
    prompt: "consent",
    scope: getScopes(),
    state: state || undefined,
    include_granted_scopes: true,
  });
  console.log(`[youtube-agent] URL OAuth générée${state ? ` (state=${state})` : ""}`);
  return url;
}

/**
 * Échange le code OAuth contre des tokens.
 * - Mode MOCK → retourne tokens fictifs sans appel API
 */
export async function getTokens(code: string): Promise<{ access_token?: string | null; refresh_token?: string | null; expiry_date?: number | null }> {
  if (isMockMode()) {
    console.warn("[youtube-agent] Mode MOCK: getTokens simulé (pas d'appel Google)");
    const fake = mockGetTokens();
    setCachedTokens(fake);
    return fake;
  }
  if (!code) throw new Error("[youtube-agent] getTokens: code manquant");
  const client = getOAuth2Client();
  console.log("[youtube-agent] échange code → tokens...");
  const { tokens } = await client.getToken(code);
  if (!tokens?.access_token) throw new Error("[youtube-agent] getTokens: aucun access_token reçu");
  setTokens(tokens as YouTubeTokens);
  // persistance
  await saveTokensToPath(tokens as YouTubeTokens).catch((e) => console.warn(`[youtube-agent] échec save après getTokens: ${e}`));
  console.log("[youtube-agent] tokens obtenus et sauvegardés");
  return {
    access_token: tokens.access_token ?? null,
    refresh_token: tokens.refresh_token ?? null,
    expiry_date: tokens.expiry_date ?? null,
  };
}

/**
 * Définit les tokens en mémoire et sur le client OAuth2.
 */
export function setTokens(tokens: YouTubeTokens): void {
  if (!tokens) throw new Error("[youtube-agent] setTokens: tokens manquants");
  const client = getOAuth2Client();
  // Ne pas écraser refresh_token si non fourni et déjà présent
  const current = getCachedTokens() || {};
  const merged: YouTubeTokens = { ...current, ...tokens };
  if (!tokens.refresh_token && current.refresh_token) merged.refresh_token = current.refresh_token as string;
  setCachedTokens(merged);
  try {
    client.setCredentials(merged as any);
  } catch (e) {
    console.warn(`[youtube-agent] setCredentials échec: ${e}`);
  }
  console.log("[youtube-agent] tokens définis en mémoire");
}

/**
 * Charge les tokens depuis fichier JSON (data/tokens.json).
 * Met à jour le client OAuth2.
 */
export async function loadTokens(customPath?: string): Promise<YouTubeTokens | null> {
  const tokens = await loadTokensFromFile(customPath);
  if (tokens) {
    try {
      const client = getOAuth2Client();
      client.setCredentials(tokens as any);
    } catch {
      // ignore
    }
  }
  return tokens;
}

/**
 * Sauvegarde les tokens vers fichier JSON.
 * @param customPath chemin optionnel (défaut: data/tokens.json)
 */
export async function saveTokens(customPath?: string): Promise<void> {
  // Si aucun cache, tente de lire credentials du client
  if (!getCachedTokens() && oauth2Client) {
    const creds = (oauth2Client as any).credentials as YouTubeTokens | undefined;
    if (creds?.access_token) setCachedTokens(creds);
  }
  const target = customPath ? resolveTokenPath(customPath) : undefined;
  await saveTokensToFile(target);
}

// Ré-export pour compatibilité import direct
export { resolveTokenPath as getTokenPath };

/**
 * Vérifie si l'agent est authentifié (tokens présents et non expirés ou mock).
 * - En mode MOCK, considéré comme authentifié pour permettre le dev (upload simulé)
 * - Sinon vérifie access_token présent
 */
export function isAuthenticated(): boolean {
  if (isMockMode()) {
    // En mock on peut toujours "publier" (simulation)
    // On log warning une seule fois pour transparence
    console.warn("[youtube-agent] isAuthenticated: mode MOCK → considéré comme authentifié (simulation)");
    return true;
  }
  const tokens = getCachedTokens();
  // fallback: credentials du client OAuth2
  const creds = (oauth2Client as any)?.credentials as YouTubeTokens | undefined;
  const effective = tokens || creds;
  if (!effective?.access_token) return false;
  // Si expiry_date présent et expiré sans refresh_token, non authentifié
  if (effective.expiry_date && Date.now() > effective.expiry_date && !effective.refresh_token) return false;
  return true;
}

// ---------------------------------------------------------------------------
// getChannels: liste chaînes YouTube de l'utilisateur
// ---------------------------------------------------------------------------

/**
 * Liste les chaînes YouTube associées au compte authentifié.
 * - Utilise youtube.channels.list mine=true part snippet,contentDetails
 * - Mode MOCK → retourne chaînes fictives
 */
export async function getChannels(): Promise<YouTubeChannel[]> {
  if (isMockMode()) {
    return mockGetChannels();
  }

  // S'assurer que les tokens sont chargés
  if (!getCachedTokens()) {
    await loadTokens().catch(() => {});
  }
  if (!isAuthenticated()) {
    throw new Error("[youtube-agent] getChannels: non authentifié — appelez getAuthUrl puis getTokens");
  }

  const client = getOAuth2Client();
  const youtube = google.youtube({ version: "v3", auth: client });

  console.log("[youtube-agent] récupération chaînes (channels.list mine=true)...");
  try {
    const res = await youtube.channels.list({
      part: ["snippet", "contentDetails"],
      mine: true,
    });

    const items = res.data.items || [];
    if (items.length === 0) {
      console.warn("[youtube-agent] aucune chaîne trouvée pour ce compte");
      return [];
    }

    const channels: YouTubeChannel[] = items.map((ch) => ({
      id: ch.id || "",
      title: ch.snippet?.title || "Chaîne sans titre",
      thumbnail: ch.snippet?.thumbnails?.default?.url || ch.snippet?.thumbnails?.medium?.url || undefined,
    }));

    console.log(`[youtube-agent] ${channels.length} chaîne(s) trouvée(s)`);
    return channels;
  } catch (err: any) {
    const msg = err?.response?.data?.error?.message || err?.message || String(err);
    // Si erreur auth, tenter refresh ou conseiller ré-auth
    if (msg.toLowerCase().includes("invalid_grant") || err?.code === 401) {
      console.warn(`[youtube-agent] getChannels échec auth: ${msg} — tokens peut-être expirés`);
    } else {
      console.warn(`[youtube-agent] getChannels échec: ${msg}`);
    }
    throw new Error(`[youtube-agent] getChannels: ${msg}`);
  }
}

// ---------------------------------------------------------------------------
// uploadVideo: upload vers YouTube avec progression + normalisation
// ---------------------------------------------------------------------------

/**
 * Upload une vidéo vers YouTube.
 * - Normalise titre/description/tags via helpers shared
 * - Utilise youtube.videos.insert avec media stream
 * - Gère progression via onUploadProgress → onProgress(pct)
 * - Mode MOCK si credentials placeholder → simulation sans appel API
 *
 * @param filePath chemin local du fichier vidéo
 * @param meta métadonnées (title, description, tags, privacyStatus, madeForKids, handle)
 * @param onProgress callback progression 0..100
 */
export async function uploadVideo(
  filePath: string,
  meta: UploadMetadata,
  onProgress?: (pct: number) => void
): Promise<UploadResult> {
  // Validation meta minimale
  if (!meta || typeof meta !== "object") throw new Error("[youtube-agent] uploadVideo: meta manquant");
  if (!meta.handle) throw new Error("[youtube-agent] uploadVideo: meta.handle requis pour normalisation");

  // Normalisation via shared constants
  const { title, description, tags } = normalizeMetadata(meta);

  const privacyStatus: "public" | "private" | "unlisted" =
    meta.privacyStatus === "public" || meta.privacyStatus === "private" || meta.privacyStatus === "unlisted"
      ? meta.privacyStatus
      : "private";

  const madeForKids = Boolean(meta.madeForKids);
  const selfDeclaredMadeForKids = meta.selfDeclaredMadeForKids ?? madeForKids;

  // Mode MOCK: pas besoin de vérifier fichier ni auth réelle
  if (isMockMode()) {
    console.warn(`[youtube-agent] uploadVideo MOCK: "${title}" (${path.basename(filePath)}) → simulation`);
    // Vérifie fichier pour log mais n'échoue pas
    try {
      await fs.promises.access(filePath, fs.constants.R_OK);
    } catch {
      console.warn(`[youtube-agent][mock] fichier introuvable: ${filePath} — simulation quand même`);
    }
    const result = await mockUploadVideo(filePath, { title, description, tags, privacyStatus, madeForKids, handle: meta.handle }, onProgress);
    return result;
  }

  // Mode réel: vérifications
  try {
    await fs.promises.access(filePath, fs.constants.R_OK);
  } catch {
    throw new Error(`[youtube-agent] uploadVideo: fichier introuvable ou illisible: ${filePath}`);
  }

  const stat = await fs.promises.stat(filePath).catch(() => null);
  if (!stat || stat.size === 0) throw new Error(`[youtube-agent] uploadVideo: fichier vide: ${filePath}`);
  console.log(`[youtube-agent] upload "${title}" (${(stat.size / 1024 / 1024).toFixed(2)} Mo) privacy=${privacyStatus} madeForKids=${madeForKids}`);

  // Auth
  if (!getCachedTokens()) {
    await loadTokens().catch(() => {});
  }
  if (!isAuthenticated()) {
    throw new Error("[youtube-agent] uploadVideo: non authentifié — OAuth requis");
  }

  const client = getOAuth2Client();
  const youtube = google.youtube({ version: "v3", auth: client });

  const fileSize = stat.size;
  let uploadedBytes = 0;
  // Pour progression, on wrappe le stream si onProgress fourni? googleapis gère onUploadProgress via axios.
  // On utilise l'option onUploadProgress du second argument.

  const media = {
    body: fs.createReadStream(filePath),
  };

  // Gestion publication programmée YouTube (pas besoin PC allumé)
  const rawPublishAt = (meta as any).publishAt || (meta as any).scheduledPublishAt;
  let publishAt: string | undefined;
  let effectivePrivacy = privacyStatus;
  if (rawPublishAt) {
    try {
      const d = new Date(rawPublishAt);
      if (!isNaN(d.getTime()) && d.getTime() > Date.now() + 60_000) {
        // YouTube exige private + publishAt pour programmé
        publishAt = d.toISOString();
        effectivePrivacy = "private";
        console.log(`[youtube-agent] publication programmée à ${publishAt} (YouTube gèrera la mise en public)`);
      }
    } catch {}
  }

  const requestBody: youtube_v3.Schema$Video = {
    snippet: {
      title,
      description,
      tags,
      // categoryId 22 = People & Blogs (adapté TikTok), optionnel
      categoryId: "22",
    },
    status: {
      privacyStatus: effectivePrivacy,
      madeForKids,
      selfDeclaredMadeForKids,
      ...(publishAt ? { publishAt } : {}),
    },
  };

  console.log(`[youtube-agent] envoi videos.insert part=snippet,status...${publishAt ? ` publishAt=${publishAt}` : ""}`);

  try {
    // @ts-ignore — googleapis overloads complexes, cast en any pour éviter conflit Readable vs GaxiosResponse
    const res: any = await (youtube.videos.insert as any)(
      {
        part: ["snippet", "status"],
        requestBody,
        media,
      },
      {
        // googleapis utilise axios en interne; onUploadProgress est supporté
        onUploadProgress: (evt: { bytesRead: number }) => {
          if (!onProgress) return;
          try {
            uploadedBytes = (evt as any).bytesRead ?? uploadedBytes;
            // fallback si bytesRead non fourni: estimation via fileSize? googleapis fournit bien bytesRead
            const pct = fileSize ? Math.min(100, Math.round((uploadedBytes / fileSize) * 100)) : 0;
            onProgress(pct);
          } catch {
            // ignore
          }
        },
      }
    );

    const videoId = res.data?.id;
    if (!videoId) throw new Error("Aucun videoId retourné par YouTube");

    // progression finale 100%
    try {
      onProgress?.(100);
    } catch {
      // ignore
    }

    const url = `https://www.youtube.com/watch?v=${videoId}`;
    console.log(`[youtube-agent] upload réussi → ${videoId} (${url})`);
    return { videoId, url };
  } catch (err: any) {
    const gErr = err?.response?.data?.error;
    const msg = gErr?.message || err?.message || String(err);
    const code = gErr?.code || err?.code;
    console.warn(`[youtube-agent] upload échec${code ? ` [${code}]` : ""}: ${msg}`);
    // Gestion spécifique quota / auth
    if (code === 403 || msg.toLowerCase().includes("quota")) {
      throw new Error(`[youtube-agent] uploadVideo quota dépassé ou permission refusée: ${msg}`);
    }
    if (code === 401 || msg.toLowerCase().includes("invalid credentials")) {
      throw new Error(`[youtube-agent] uploadVideo auth expirée: ${msg} — reconnectez via getAuthUrl`);
    }
    throw new Error(`[youtube-agent] uploadVideo: ${msg}`);
  }
}

// ---------------------------------------------------------------------------
// Ré-exports utilitaires
// ---------------------------------------------------------------------------

export type { YouTubeChannel, YouTubeTokens };
export type { YouTubeChannel as Channel } from "../../../shared/types.js";

// Pour tests / debug
export function _getOAuth2ClientForTests(): InstanceType<typeof google.auth.OAuth2> | null {
  return oauth2Client;
}
export function _resetOAuth2ClientForTests(): void {
  oauth2Client = null;
}
