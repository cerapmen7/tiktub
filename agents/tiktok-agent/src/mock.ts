import type { TikTokProfile, TikTokVideo } from "../../../shared/types.js";

// Générateur de données mock réalistes pour dev / fallback API

const MOCK_DESCRIPTIONS = [
  "POV : tu découvres ce spot secret à Paris 😍 #travel #paris #fyp #viral #explore",
  "Recette facile en 30s 🍝 tu vas adorer #food #recipe #cooking #tiktokfood #yummy",
  "Ce son est incroyable 🔥 #music #dance #trending #fyp #viral",
  "Astuce que personne ne connaît 🤫 #astuce #lifehack #tips #fyp",
  "Mon chat fait ça tous les matins 😂 #cat #pets #funny #cute #animals",
  "Transformation avant/après ✨ #glowup #makeup #beauty #transformation",
  "5 exercices pour des abdos en béton 💪 #fitness #sport #workout #gym #motivation",
  "Ce film va te faire pleurer 😭 #movie #cinema #netflix #fyp #emotional",
  "Tu savais ça ? 🤯 #facts #knowledge #learn #tiktokacademy #science",
  "Soirée entre potes vibes 🌃 #friends #party #night #vibes #fyp",
];

const MOCK_TITLES = MOCK_DESCRIPTIONS; // TikTok: description = titre

const MOCK_COVERS = [
  "https://picsum.photos/seed/tiktok1/576/1024",
  "https://picsum.photos/seed/tiktok2/576/1024",
  "https://picsum.photos/seed/tiktok3/576/1024",
  "https://picsum.photos/seed/tiktok4/576/1024",
  "https://picsum.photos/seed/tiktok5/576/1024",
];

/**
 * Génère un entier aléatoire entre min et max inclus.
 */
function randInt(min: number, max: number): number {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

/**
 * Génère un profil mock plausible.
 */
export function generateMockProfile(handle: string): TikTokProfile {
  const clean = handle.replace(/^@/, "").toLowerCase();
  return {
    handle: clean,
    nickname: `${clean.charAt(0).toUpperCase() + clean.slice(1)} Official`,
    avatar: `https://picsum.photos/seed/${clean}/200/200`,
    followers: randInt(10_000, 5_000_000),
    verified: Math.random() > 0.7,
    exists: true,
  };
}

/**
 * Génère `count` vidéos mock réalistes pour `handle`.
 * - playCount, likeCount, etc. aléatoires mais cohérents
 * - createTime réparti sur les 30 derniers jours
 * - hashtags extraits des descriptions
 */
export function generateMockVideos(handle: string, count: number): TikTokVideo[] {
  const clean = handle.replace(/^@/, "").toLowerCase();
  const n = Math.max(1, Math.min(count, 1000));
  const now = Math.floor(Date.now() / 1000);

  return Array.from({ length: n }, (_, i) => {
    const desc = MOCK_DESCRIPTIONS[i % MOCK_DESCRIPTIONS.length];
    // Variation légère pour éviter doublons exacts
    const suffix = i >= MOCK_DESCRIPTIONS.length ? ` (part ${Math.floor(i / MOCK_DESCRIPTIONS.length) + 1})` : "";
    const fullDesc = desc + suffix;
    const hashtags = extractHashtagsFromText(fullDesc);

    // Statistiques cohérentes: likes ~ 8-15% des vues, comments ~1-3%, shares ~0.5-2%
    const playCount = randInt(50_000, 5_000_000);
    const likeCount = Math.floor(playCount * (0.08 + Math.random() * 0.07));
    const commentCount = Math.floor(playCount * (0.01 + Math.random() * 0.02));
    const shareCount = Math.floor(playCount * (0.005 + Math.random() * 0.015));

    // Temps de création décroissant: plus récent en premier si on génère dans l'ordre
    const createTime = now - randInt(0, 30 * 24 * 3600) - i * 3600;

    return {
      id: `${clean}_${Date.now()}_${i}_${randInt(1000, 9999)}`,
      handle: clean,
      title: fullDesc,
      description: fullDesc,
      hashtags,
      coverUrl: MOCK_COVERS[i % MOCK_COVERS.length],
      // videoUrl volontairement placé à undefined pour tester fallback dummy en dev,
      // mais on fournit une URL placeholder http valide pour certains items
      videoUrl: i % 3 === 0 ? `https://example.com/mock/${clean}_${i}.mp4` : undefined,
      wmVideoUrl: `https://example.com/mock/${clean}_${i}_wm.mp4`,
      playCount,
      likeCount,
      commentCount,
      shareCount,
      createTime,
      duration: randInt(7, 67),
      musicTitle: `Original Sound - ${clean} #${i + 1}`,
    };
  });
}

/**
 * Helper local identique à celui de index.ts (évite dépendance circulaire)
 */
function extractHashtagsFromText(text: string): string[] {
  if (!text) return [];
  const matches = text.match(/#\w+/g);
  if (!matches) return [];
  return matches.map((m) => m.slice(1).toLowerCase());
}
