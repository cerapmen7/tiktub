/**
 * @tiktub/tiktok-agent — Agent TikTok
 * - validateHandle : vérifie existence d'un handle via tikwm.com (fallback mock)
 * - fetchTopVideos : récupère les vidéos triées (fallback mock)
 * - downloadVideo  : télécharge la vidéo vers destDir
 *
 * Notes:
 * - Utilise axios, gère les erreurs réseau gracieusement (retourne mock, ne crash pas)
 * - Logs en français, succincts
 * - Importable par backend via `import { validateHandle, fetchTopVideos } from "../../agents/tiktok-agent/src/index.js"`
 */

import axios from "axios";
import * as fs from "node:fs";
import * as path from "node:path";
import { generateMockVideos, generateMockProfile } from "./mock.js";
import type { TikTokProfile, TikTokVideo, SortBy } from "../../../shared/types.js";

// L'import shared est hors rootDir (src) pour ESM runtime.
// On utilise @ts-ignore pour permettre la compilation avec rootDir=src tout en gardant
// la résolution ESM correcte à l'exécution (backend importe via src/index.js).
// Le fallback local garantit le fonctionnement même si la résolution TS échoue.
// @ts-ignore
import { cleanHandle as cleanHandleShared } from "../../../shared/constants.js";

// Fallback local identique à shared/constants.ts (utilisé si l'import shared est indisponible à la compilation)
function cleanHandleLocal(input: string): string | null {
  const HANDLE_REGEX = /^@?([A-Za-z0-9._]{2,24})$/;
  const m = input.trim().match(HANDLE_REGEX);
  return m ? m[1].toLowerCase() : null;
}

function getCleanHandle(input: string): string | null {
  try {
    if (typeof cleanHandleShared === "function") {
      return cleanHandleShared(input);
    }
  } catch {
    // ignore, fallback
  }
  return cleanHandleLocal(input);
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Extrait les hashtags d'un texte (sans #, en minuscules).
 * Regex demandée: #\w+
 */
export function extractHashtags(text: string): string[] {
  if (!text) return [];
  const matches = text.match(/#\w+/g);
  if (!matches) return [];
  return matches.map((m) => m.slice(1).toLowerCase()).filter(Boolean);
}

// ---------------------------------------------------------------------------
// API tikwm.com — helpers de mapping
// ---------------------------------------------------------------------------

const TIKWM_BASE = process.env.TIKWM_API_URL || "https://www.tikwm.com";
const TIKWM_TIMEOUT = 10_000;

/**
 * Normalise la réponse user info de tikwm (plusieurs formats possibles)
 */
function parseUserInfo(raw: any): { nickname?: string; avatar?: string; followers?: number; verified?: boolean } | null {
  if (!raw) return null;
  // Formats possibles: raw.data.user , raw.data, raw.user, raw
  const user = raw?.data?.user || raw?.data || raw?.user || raw;
  if (!user || typeof user !== "object") return null;

  const nickname = user.nickname || user.nickName || user.uniqueId || user.unique_id;
  const avatar = user.avatarLarger || user.avatar || user.avatarThumb || user.avatar_larger;
  const followers = user.followerCount ?? user.follower_count ?? user.followers;
  const verified = user.verified ?? user.isVerified ?? false;

  // Si aucun champ reconnaissable, considérer comme invalide
  if (!nickname && !avatar && followers === undefined) return null;
  return { nickname, avatar, followers, verified: Boolean(verified) };
}

/**
 * Map un objet vidéo brut tikwm vers TikTokVideo
 */
function mapRawToVideo(raw: any, fallbackHandle: string): TikTokVideo | null {
  if (!raw || typeof raw !== "object") return null;

  // id: video_id, id, aweme_id, etc.
  const id = String(raw.video_id || raw.id || raw.aweme_id || raw.itemId || raw.videoId || `mock_${Date.now()}_${Math.random()}`);

  // handle: author.uniqueId
  const handle = (raw.author?.uniqueId || raw.author?.unique_id || raw.author || fallbackHandle || "").toString().replace(/^@/, "").toLowerCase() || fallbackHandle;

  // description / titre
  const titleRaw = raw.desc || raw.title || raw.text || raw.caption || "";
  const title = String(titleRaw).trim();
  const description = title; // TikTok n'a qu'une description
  const hashtags = extractHashtags(title);

  // cover
  const coverUrl =
    raw.cover ||
    raw.video?.cover ||
    raw.ai_dynamic_cover ||
    raw.origin_cover ||
    raw.dynamic_cover ||
    raw.video?.origin_cover ||
    raw.video?.dynamic_cover ||
    undefined;

  // video urls — tikwm expose souvent play, hdplay, wmplay, downloadAddr
  const videoUrl =
    raw.play ||
    raw.hdplay ||
    raw.playAddr ||
    raw.downloadAddr ||
    raw.video?.playAddr ||
    raw.video?.downloadAddr ||
    raw.video?.play ||
    raw.video?.download_addr ||
    undefined;

  const wmVideoUrl =
    raw.wmplay ||
    raw.wmPlay ||
    raw.wm_play ||
    raw.video?.wmplay ||
    undefined;

  // stats
  const playCount = raw.playCount ?? raw.play_count ?? raw.stats?.playCount ?? raw.stats?.play_count ?? raw.statistics?.playCount;
  const likeCount = raw.diggCount ?? raw.digg_count ?? raw.likeCount ?? raw.stats?.diggCount ?? raw.statistics?.diggCount;
  const commentCount = raw.commentCount ?? raw.comment_count ?? raw.stats?.commentCount;
  const shareCount = raw.shareCount ?? raw.share_count ?? raw.stats?.shareCount;

  const createTime = raw.createTime ?? raw.create_time ?? raw.create_time_stamp;
  const duration = raw.duration ?? raw.video?.duration;
  const musicTitle = raw.music?.title || raw.musicTitle || raw.music_title;

  return {
    id,
    handle,
    title: title || `TikTok @${handle}`,
    description,
    hashtags,
    coverUrl,
    videoUrl,
    wmVideoUrl,
    playCount: typeof playCount === "number" ? playCount : Number(playCount) || undefined,
    likeCount: typeof likeCount === "number" ? likeCount : Number(likeCount) || undefined,
    commentCount: typeof commentCount === "number" ? commentCount : Number(commentCount) || undefined,
    shareCount: typeof shareCount === "number" ? shareCount : Number(shareCount) || undefined,
    createTime: typeof createTime === "number" ? createTime : Number(createTime) || undefined,
    duration: typeof duration === "number" ? duration : Number(duration) || undefined,
    musicTitle,
  };
}

// ---------------------------------------------------------------------------
// validateHandle
// ---------------------------------------------------------------------------

/**
 * Valide un handle TikTok.
 * - Nettoie via cleanHandle (gère @)
 * - Tente vérification via tikwm.com/api/user/info (POST puis GET fallback)
 * - En cas d'échec réseau, retourne un profil mock plausible (ne crash pas)
 */
export async function validateHandle(handle: string): Promise<TikTokProfile> {
  const cleaned = getCleanHandle(handle);

  if (!cleaned) {
    console.log(`[tiktok-agent] validateHandle: handle invalide "${handle}"`);
    return {
      handle: handle.trim().replace(/^@/, "").toLowerCase(),
      exists: false,
    };
  }

  console.log(`[tiktok-agent] validation du handle @${cleaned}...`);

  // Tentative API tikwm
  const endpoints = [
    { method: "POST" as const, url: `${TIKWM_BASE}/api/user/info`, data: { unique_id: cleaned } },
    { method: "GET" as const, url: `${TIKWM_BASE}/api/user/info?unique_id=${encodeURIComponent(cleaned)}` },
  ];

  for (const ep of endpoints) {
    try {
      const res =
        ep.method === "POST"
          ? await axios.post(ep.url, ep.data, {
              timeout: TIKWM_TIMEOUT,
              headers: {
                "Content-Type": "application/json",
                "User-Agent": "Mozilla/5.0 TikTub/1.0",
                Referer: "https://www.tikwm.com/",
              },
              validateStatus: () => true,
            })
          : await axios.get(ep.url, {
              timeout: TIKWM_TIMEOUT,
              headers: {
                "User-Agent": "Mozilla/5.0 TikTub/1.0",
                Referer: "https://www.tikwm.com/",
              },
              validateStatus: () => true,
            });

      const body = res.data;

      // tikwm renvoie { code: 0, data: { user: {...} } } en succès
      // code -1 ou 1 = non trouvé / erreur
      if (res.status === 200 && body) {
        // Cas succès: code 0
        if (body.code === 0) {
          const parsed = parseUserInfo(body);
          if (parsed) {
            console.log(`[tiktok-agent] @${cleaned} trouvé via tikwm (code 0)`);
            return {
              handle: cleaned,
              nickname: parsed.nickname,
              avatar: parsed.avatar,
              followers: parsed.followers,
              verified: parsed.verified,
              exists: true,
            };
          }
        }
        // Certaines versions renvoient directement user sans code
        const parsedDirect = parseUserInfo(body);
        if (parsedDirect && body.code !== -1) {
          console.log(`[tiktok-agent] @${cleaned} trouvé (format direct)`);
          return {
            handle: cleaned,
            nickname: parsedDirect.nickname,
            avatar: parsedDirect.avatar,
            followers: parsedDirect.followers,
            verified: parsedDirect.verified,
            exists: true,
          };
        }
        // Si code explicite d'erreur (handle inexistant)
        if (body.code === -1 || body.msg?.toLowerCase().includes("not found") || body.msg?.toLowerCase().includes("user not found")) {
          console.log(`[tiktok-agent] @${cleaned} introuvable (tikwm code -1)`);
          return { handle: cleaned, exists: false };
        }
      }
    } catch (err: any) {
      console.log(`[tiktok-agent] échec requête validate ${ep.method} ${ep.url}: ${err?.message || err}`);
      // continue vers endpoint suivant puis fallback mock
    }
  }

  // Fallback mock: on considère le handle comme existant si le format est valide,
  // pour permettre le dev hors-ligne / sans clé API.
  console.log(`[tiktok-agent] fallback mock pour @${cleaned} (API indisponible)`);
  const mock = generateMockProfile(cleaned);
  return mock;
}

// ---------------------------------------------------------------------------
// fetchTopVideos
// ---------------------------------------------------------------------------

/**
 * Récupère les vidéos les plus populaires d'un handle.
 * - Appelle POST https://www.tikwm.com/api/user/posts?unique_id=handle&count=35 (avec fallback GET)
 * - Map vers TikTokVideo, extrait hashtags, trie selon sortBy
 * - Si échec, génère `limit` vidéos mock réalistes (minimum 5 si limit <5 et API fail, sinon limit)
 */
export async function fetchTopVideos(handle: string, limit: number, sortBy: SortBy): Promise<TikTokVideo[]> {
  const cleaned = getCleanHandle(handle) || handle.trim().replace(/^@/, "").toLowerCase();
  const safeLimit = Math.max(1, Math.min(limit || 10, 50));
  const count = Math.max(safeLimit, 35); // on demande 35 à l'API pour pouvoir trier puis slice

  console.log(`[tiktok-agent] fetchTopVideos @${cleaned} limit=${safeLimit} sortBy=${sortBy}`);

  let rawVideos: any[] | null = null;

  // 1) Tentative POST avec query params (spéc demandée)
  const postUrl = `${TIKWM_BASE}/api/user/posts?unique_id=${encodeURIComponent(cleaned)}&count=${count}`;
  const getUrl = `${TIKWM_BASE}/api/user/posts?unique_id=${encodeURIComponent(cleaned)}&count=${count}`;

  const attempts: Array<() => Promise<any>> = [
    async () => {
      const res = await axios.post(
        postUrl,
        { unique_id: cleaned, count: String(count), cursor: "0" },
        {
          timeout: TIKWM_TIMEOUT,
          headers: {
            "Content-Type": "application/json",
            "User-Agent": "Mozilla/5.0 TikTub/1.0",
            Referer: "https://www.tikwm.com/",
          },
          validateStatus: () => true,
        }
      );
      return res;
    },
    async () => {
      const res = await axios.get(getUrl, {
        timeout: TIKWM_TIMEOUT,
        headers: {
          "User-Agent": "Mozilla/5.0 TikTub/1.0",
          Referer: "https://www.tikwm.com/",
        },
        validateStatus: () => true,
      });
      return res;
    },
    // Variante POST sans query (certaines versions tikwm l'attendent)
    async () => {
      const res = await axios.post(
        `${TIKWM_BASE}/api/user/posts`,
        { unique_id: cleaned, count: String(count), cursor: "0" },
        {
          timeout: TIKWM_TIMEOUT,
          headers: {
            "Content-Type": "application/json",
            "User-Agent": "Mozilla/5.0 TikTub/1.0",
            Referer: "https://www.tikwm.com/",
          },
          validateStatus: () => true,
        }
      );
      return res;
    },
  ];

  for (const attempt of attempts) {
    try {
      const res = await attempt();
      const body = res?.data;
      if (!body) continue;

      // Logs debug
      if (body.code !== undefined && body.code !== 0) {
        console.log(`[tiktok-agent] tikwm posts code=${body.code} msg=${body.msg || body.message || ""}`);
        continue;
      }

      // Extraction des vidéos: plusieurs structures possibles
      const candidates =
        body?.data?.videos ||
        body?.data?.data?.videos ||
        body?.videos ||
        body?.data?.items ||
        body?.data;

      if (Array.isArray(candidates) && candidates.length > 0) {
        rawVideos = candidates;
        console.log(`[tiktok-agent] ${candidates.length} vidéos reçues via tikwm pour @${cleaned}`);
        break;
      }
      if (body?.data && Array.isArray(body.data) && body.data.length > 0) {
        rawVideos = body.data;
        console.log(`[tiktok-agent] ${body.data.length} vidéos reçues (data array)`);
        break;
      }
    } catch (err: any) {
      console.log(`[tiktok-agent] échec fetch attempt: ${err?.message || err}`);
    }
  }

  let videos: TikTokVideo[] = [];

  if (rawVideos && rawVideos.length > 0) {
    videos = rawVideos.map((r) => mapRawToVideo(r, cleaned)).filter(Boolean) as TikTokVideo[];

    if (videos.length === 0) {
      console.log(`[tiktok-agent] mapping a échoué, fallback mock`);
    }
  }

  // Fallback mock si API vide / échec
  if (videos.length === 0) {
    console.log(`[tiktok-agent] fallback mock: génération de ${safeLimit} vidéos pour @${cleaned}`);
    // Génère au moins 5 vidéos réalistes si API fail (spec), puis slice à safeLimit
    const mockCount = Math.max(safeLimit, 5);
    const mocks = generateMockVideos(cleaned, mockCount);
    videos = mocks.slice(0, safeLimit);
    // Tri mock aussi (already random mais on respecte sortBy)
  }

  // Tri selon sortBy
  switch (sortBy) {
    case "popular":
      videos.sort((a, b) => (b.playCount || 0) - (a.playCount || 0));
      break;
    case "most_liked":
      videos.sort((a, b) => (b.likeCount || 0) - (a.likeCount || 0));
      break;
    case "recent":
      videos.sort((a, b) => (b.createTime || 0) - (a.createTime || 0));
      break;
    default:
      videos.sort((a, b) => (b.playCount || 0) - (a.playCount || 0));
  }

  const sliced = videos.slice(0, safeLimit);
  console.log(`[tiktok-agent] retour de ${sliced.length} vidéos triées (${sortBy}) pour @${cleaned}`);
  return sliced;
}

// ---------------------------------------------------------------------------
// downloadVideo
// ---------------------------------------------------------------------------

/**
 * Télécharge une vidéo vers destDir/${video.id}.mp4
 * - Utilise video.videoUrl || wmVideoUrl
 * - En cas d'URL invalide ou échec réseau, crée un fichier dummy pour le dev
 */
export async function downloadVideo(video: TikTokVideo, destDir: string): Promise<string> {
  const fileName = `${video.id}.mp4`;
  const filePath = path.join(destDir, fileName);
  const url = video.videoUrl || video.wmVideoUrl;

  // Assure que le dossier existe
  await fs.promises.mkdir(destDir, { recursive: true });

  // Si pas d'URL, dummy direct
  if (!url || !/^https?:\/\//.test(url)) {
    console.log(`[tiktok-agent] pas d'URL valide pour ${video.id}, création dummy`);
    return createDummyFile(filePath, video);
  }

  console.log(`[tiktok-agent] téléchargement ${video.id} depuis ${url} vers ${filePath}`);

  try {
    const response = await axios.get(url, {
      responseType: "stream",
      timeout: 30_000,
      headers: {
        "User-Agent": "Mozilla/5.0 TikTub/1.0",
        Referer: "https://www.tiktok.com/",
      },
      validateStatus: (s) => s >= 200 && s < 400,
    });

    // Vérifie content-type plausible
    const contentType = String(response.headers["content-type"] || "");
    if (contentType.includes("application/json")) {
      throw new Error(`Réponse JSON au lieu de vidéo (content-type: ${contentType})`);
    }

    const writer = fs.createWriteStream(filePath);

    await new Promise<void>((resolve, reject) => {
      const stream: any = response.data;
      stream.pipe(writer);
      writer.on("finish", resolve);
      writer.on("error", reject);
      stream.on("error", reject);
    });

    // Vérifie taille fichier
    const stat = await fs.promises.stat(filePath);
    if (stat.size < 1024) {
      console.log(`[tiktok-agent] fichier trop petit (${stat.size}o), considéré comme échec -> dummy`);
      await fs.promises.unlink(filePath).catch(() => {});
      return createDummyFile(filePath, video);
    }

    console.log(`[tiktok-agent] téléchargé ${filePath} (${stat.size} octets)`);
    return filePath;
  } catch (err: any) {
    console.log(`[tiktok-agent] échec téléchargement ${video.id}: ${err?.message || err} -> dummy`);
    // Nettoie fichier partiel
    await fs.promises.unlink(filePath).catch(() => {});
    return createDummyFile(filePath, video);
  }
}

/**
 * Crée un fichier dummy .mp4 (contenu texte) pour le dev/tests.
 */
async function createDummyFile(filePath: string, video: TikTokVideo): Promise<string> {
  const dummyContent = [
    `Dummy video file for TikTub dev`,
    `id: ${video.id}`,
    `handle: @${video.handle}`,
    `title: ${video.title}`,
    `hashtags: ${video.hashtags.join(", ")}`,
    `originalUrl: ${video.videoUrl || video.wmVideoUrl || "none"}`,
    `generatedAt: ${new Date().toISOString()}`,
    `---`,
    `Ce fichier est un placeholder. En production, il contiendrait le flux MP4 réel.`,
  ].join("\n");

  await fs.promises.writeFile(filePath, dummyContent, "utf-8");
  console.log(`[tiktok-agent] dummy créé: ${filePath}`);
  return filePath;
}

// Ré-exports pour compatibilité
export type { TikTokProfile, TikTokVideo, SortBy } from "../../../shared/types.js";
