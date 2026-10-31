import { BASE_EARTH_IMAGE, drawGeographyCanvas, safeGeography } from '../geographyTexture.js';

export const WORLD_TEXTURE_CURRENT_MAX_EDGE = 2048;
export const WORLD_TEXTURE_MINI_MAX_EDGE = 512;
export const WORLD_TEXTURE_CACHE_LIMIT = 24;

const worldIdOf = world => world?.id != null ? String(world.id)
  : world?.runId != null && world?.branchId != null ? `${world.runId}::${world.branchId}` : null;

function stableValue(value) {
  if (Array.isArray(value)) return value.map(stableValue);
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.keys(value).sort().map(key => [key, stableValue(value[key])]));
  }
  return value;
}

function dimensionsFor(image, maxEdge) {
  const width = Number(image?.naturalWidth || image?.width), height = Number(image?.naturalHeight || image?.height);
  if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) return null;
  const scale = Math.min(1, maxEdge / Math.max(width, height));
  return { width: Math.max(1, Math.round(width * scale)), height: Math.max(1, Math.round(height * scale)) };
}

function defaultCanvasFactory(width, height) {
  if (typeof document === 'undefined' || !document.createElement) throw new Error('Canvas creation unavailable');
  const canvas = document.createElement('canvas');
  canvas.width = width; canvas.height = height;
  return canvas;
}

const imageIdentityIds = new WeakMap();
let nextImageIdentity = 1;
function baseImageIdentity(image, explicitIdentity) {
  if (explicitIdentity != null && String(explicitIdentity)) return String(explicitIdentity);
  const source = image?.currentSrc || image?.src || image?.url;
  if (source) return String(source);
  if (!image || (typeof image !== 'object' && typeof image !== 'function')) return 'no-base-image';
  let id = imageIdentityIds.get(image);
  if (!id) { id = `base-object-${nextImageIdentity++}`; imageIdentityIds.set(image, id); }
  return id;
}

/**
 * Create bounded, per-world v1 scenario Earth canvases. The injected base image
 * keeps this helper synchronous and prevents it from starting network work.
 */
export function createWorldTextureFactory({
  canvasFactory = defaultCanvasFactory,
  draw = drawGeographyCanvas,
  maxEntries = WORLD_TEXTURE_CACHE_LIMIT,
  onEvict = () => {},
} = {}) {
  const limit = Math.max(1, Math.min(WORLD_TEXTURE_CACHE_LIMIT, Math.floor(Number(maxEntries) || WORLD_TEXTURE_CACHE_LIMIT)));
  const cache = new Map();

  function evict(key) {
    const entry = cache.get(key);
    if (!entry) return;
    cache.delete(key);
    onEvict(entry.result);
  }

  function create(world, { baseImage, baseIdentity } = {}) {
    const worldId = worldIdOf(world);
    if (!worldId) return { status: 'unsupported', reason: 'missing-world-id', fallback: 'scene-disc' };

    const rawGeography = world?.geography ?? world?.geog;
    const geography = rawGeography == null ? undefined : safeGeography(rawGeography);
    const sourceIdentity = baseImageIdentity(baseImage, baseIdentity);
    const normalizedKey = geography === undefined ? 'base-only' : JSON.stringify(stableValue(geography));
    const cacheKey = `${worldId}\u0000${sourceIdentity}\u0000${normalizedKey}`;

    // A stable world ID has one active geography/base version. Replacements
    // invalidate the prior texture record instead of retaining stale assets.
    for (const [key, entry] of cache) if (entry.worldId === worldId && key !== cacheKey) evict(key);
    const hit = cache.get(cacheKey);
    if (hit) {
      cache.delete(cacheKey); cache.set(cacheKey, hit);
      return hit.result;
    }

    if (rawGeography != null && !geography) {
      return { status: 'unsupported', worldId, reason: rawGeography?.version === 2 ? 'geography-v2' : 'invalid-geography', fallback: 'scene-disc' };
    }
    if (!baseImage) return { status: 'base-unavailable', worldId, geography, fallback: 'scene-disc' };

    const currentDimensions = dimensionsFor(baseImage, WORLD_TEXTURE_CURRENT_MAX_EDGE);
    const miniDimensions = dimensionsFor(baseImage, WORLD_TEXTURE_MINI_MAX_EDGE);
    if (!currentDimensions || !miniDimensions) return { status: 'base-unavailable', worldId, geography, fallback: 'scene-disc' };

    const currentCanvas = canvasFactory(currentDimensions.width, currentDimensions.height);
    currentCanvas.width = currentDimensions.width; currentCanvas.height = currentDimensions.height;
    const miniCanvas = canvasFactory(miniDimensions.width, miniDimensions.height);
    miniCanvas.width = miniDimensions.width; miniCanvas.height = miniDimensions.height;
    draw(currentCanvas, baseImage, geography, 'scenario');
    draw(miniCanvas, baseImage, geography, 'scenario');

    const result = {
      status: 'ready', worldId, geography,
      currentCanvas, miniCanvas,
      currentDimensions, miniDimensions,
      fallback: null,
    };
    cache.set(cacheKey, { worldId, result });
    while (cache.size > limit) evict(cache.keys().next().value);
    return result;
  }

  return {
    create,
    get size() { return cache.size; },
    clear() { for (const key of [...cache.keys()]) evict(key); },
    dispose() { this.clear(); },
  };
}
