/**
 * @tiktub/youtube-agent — mocks pour dev sans credentials Google
 */

import type { YouTubeChannel } from "../../../shared/types.js";

// ---------------------------------------------------------------------------
// Constantes mock
// ---------------------------------------------------------------------------

export const MOCK_CHANNELS: YouTubeChannel[] = [
  { id: "mock_channel_1", title: "TikTub Mock Channel", thumbnail: "https://picsum.photos/seed/mockyt1/200/200" },
  { id: "mock_channel_2", title: "Second Mock Channel", thumbnail: "https://picsum.photos/seed/mockyt2/200/200" },
];

// Délai simulé pour upload (ms)
const MOCK_UPLOAD_MIN_DELAY = 600;
const MOCK_UPLOAD_MAX_DELAY = 1500;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function randomDelay(): number {
  return MOCK_UPLOAD_MIN_DELAY + Math.floor(Math.random() * (MOCK_UPLOAD_MAX_DELAY - MOCK_UPLOAD_MIN_DELAY));
}

// ---------------------------------------------------------------------------
// Mock upload
// ---------------------------------------------------------------------------

export interface MockUploadMeta {
  title: string;
  description: string;
  tags: string[];
  privacyStatus: string;
  madeForKids: boolean;
  handle: string;
}

/**
 * Simule un upload YouTube.
 * - Log warning
 * - Appelle onProgress par paliers 0..100%
 * - Retourne fake videoId `mock_${Date.now()}`
 */
export async function mockUploadVideo(
  _filePath: string,
  _meta: MockUploadMeta,
  onProgress?: (pct: number) => void
): Promise<{ videoId: string; url: string }> {
  console.warn("[youtube-agent] Mode MOCK actif — simulation upload (pas d'appel API Google)");

  // Simulation progression
  const steps = [10, 30, 55, 80, 100];
  for (const pct of steps) {
    await sleep(randomDelay() / steps.length);
    try {
      onProgress?.(pct);
    } catch {
      // ignore erreur callback
    }
    console.log(`[youtube-agent][mock] progression ${pct}%`);
  }

  const videoId = `mock_${Date.now()}`;
  const url = `https://www.youtube.com/watch?v=${videoId}`;

  console.warn(`[youtube-agent][mock] upload simulé -> ${videoId} (${url})`);
  return { videoId, url };
}

/**
 * Simule getChannels en mode mock.
 */
export async function mockGetChannels(): Promise<YouTubeChannel[]> {
  console.warn("[youtube-agent] Mode MOCK — retour chaînes fictives");
  await sleep(200);
  return [...MOCK_CHANNELS];
}

/**
 * Génère une URL OAuth mock pour dev.
 */
export function mockGetAuthUrl(state?: string): string {
  console.warn("[youtube-agent] Mode MOCK — génération URL OAuth fictive");
  const base = "http://localhost:3001/mock-youtube-auth";
  return state ? `${base}?state=${encodeURIComponent(state)}` : base;
}

/**
 * Génère des tokens mock.
 */
export function mockGetTokens(): { access_token: string; refresh_token: string; expiry_date: number } {
  console.warn("[youtube-agent] Mode MOCK — génération tokens fictifs");
  return {
    access_token: `mock_access_${Date.now()}`,
    refresh_token: `mock_refresh_${Date.now()}`,
    expiry_date: Date.now() + 3600 * 1000,
  };
}
