/**
 * @tiktub/youtube-agent — persistence tokens OAuth2
 * Gère lecture/écriture JSON (data/tokens.json ou tokens.json)
 */
import * as fs from "node:fs";
import * as path from "node:path";
// Cache mémoire — évite relire disque à chaque appel
let cachedTokens = null;
// ---------------------------------------------------------------------------
// Résolution du chemin par défaut
// ---------------------------------------------------------------------------
/**
 * Cherche le dossier `data` en remontant depuis cwd (max 5 niveaux).
 * Fallback: ./data/tokens.json ou ./tokens.json
 */
function findDataDir(start) {
    let dir = path.resolve(start);
    for (let i = 0; i < 5; i++) {
        const candidate = path.join(dir, "data");
        try {
            if (fs.existsSync(candidate))
                return candidate;
        }
        catch {
            // ignore
        }
        const parent = path.dirname(dir);
        if (parent === dir)
            break;
        dir = parent;
    }
    return null;
}
function getDefaultTokenPath() {
    // 1. Si env explicite
    if (process.env.YOUTUBE_TOKENS_PATH)
        return path.resolve(process.env.YOUTUBE_TOKENS_PATH);
    // 2. Cherche data/ existant
    const dataDir = findDataDir(process.cwd());
    if (dataDir)
        return path.join(dataDir, "tokens.json");
    // 3. Essaie chemin relatif depuis ce module (agents/youtube-agent -> projet root)
    // En runtime ESM, __dirname n'existe pas; on tente une résolution relative au cwd
    try {
        const fallback = path.resolve("data", "tokens.json");
        const fallbackDir = path.dirname(fallback);
        // si data n'existe pas, on utilisera quand même ce chemin (sera créé au save)
        if (fs.existsSync(fallbackDir) || fallbackDir.endsWith("data"))
            return fallback;
    }
    catch {
        // ignore
    }
    // 4. Dernier recours: fichier local au module
    return path.resolve("tokens.json");
}
/**
 * Résout le chemin effectif (custom ou défaut).
 */
export function resolveTokenPath(customPath) {
    if (customPath)
        return path.resolve(customPath);
    return getDefaultTokenPath();
}
// ---------------------------------------------------------------------------
// API mémoire
// ---------------------------------------------------------------------------
export function getCachedTokens() {
    return cachedTokens;
}
export function setCachedTokens(tokens) {
    cachedTokens = tokens ? { ...tokens } : null;
}
export function clearCachedTokens() {
    cachedTokens = null;
}
// ---------------------------------------------------------------------------
// Load / Save
// ---------------------------------------------------------------------------
/**
 * Charge les tokens depuis le fichier JSON.
 * - Retourne null si fichier absent / invalide
 * - Met à jour le cache mémoire
 */
export async function loadTokens(customPath) {
    const filePath = resolveTokenPath(customPath);
    try {
        const raw = await fs.promises.readFile(filePath, "utf-8");
        const parsed = JSON.parse(raw);
        // Validation minimale
        if (!parsed || typeof parsed !== "object") {
            console.warn(`[youtube-agent] tokens.json invalide: ${filePath}`);
            return null;
        }
        cachedTokens = parsed;
        console.log(`[youtube-agent] tokens chargés depuis ${filePath}`);
        return parsed;
    }
    catch (err) {
        if (err?.code === "ENOENT") {
            // fichier absent = normal au premier lancement
            console.log(`[youtube-agent] aucun tokens.json trouvé (${filePath})`);
            return null;
        }
        console.warn(`[youtube-agent] échec loadTokens ${filePath}: ${err?.message || err}`);
        return null;
    }
}
/**
 * Sauvegarde les tokens (cache mémoire ou fournis) vers fichier JSON.
 * - Crée le dossier parent si nécessaire
 */
export async function saveTokens(customPath) {
    const tokens = cachedTokens;
    if (!tokens) {
        console.warn("[youtube-agent] saveTokens: aucun token en mémoire, rien à sauvegarder");
        return;
    }
    await saveTokensToPath(tokens, customPath);
}
/**
 * Sauvegarde des tokens explicites vers un chemin.
 * - Surcharge utilisée par index.ts après refresh auto
 */
export async function saveTokensToPath(tokens, customPath) {
    const filePath = resolveTokenPath(customPath);
    const dir = path.dirname(filePath);
    try {
        await fs.promises.mkdir(dir, { recursive: true });
        await fs.promises.writeFile(filePath, JSON.stringify(tokens, null, 2), "utf-8");
        cachedTokens = { ...tokens };
        console.log(`[youtube-agent] tokens sauvegardés vers ${filePath}`);
    }
    catch (err) {
        console.warn(`[youtube-agent] échec saveTokens ${filePath}: ${err?.message || err}`);
        throw err;
    }
}
/**
 * Alias pour compatibilité: saveTokens(path, tokens)
 * Permet appel saveTokens("/tmp/tokens.json") ou saveTokens(tokens)
 */
export async function persistTokens(pathOrTokens, tokensMaybe) {
    if (typeof pathOrTokens === "string") {
        if (tokensMaybe) {
            await saveTokensToPath(tokensMaybe, pathOrTokens);
        }
        else {
            await saveTokens(pathOrTokens);
        }
    }
    else if (pathOrTokens && typeof pathOrTokens === "object") {
        await saveTokensToPath(pathOrTokens);
    }
    else {
        await saveTokens();
    }
}
//# sourceMappingURL=tokens.js.map