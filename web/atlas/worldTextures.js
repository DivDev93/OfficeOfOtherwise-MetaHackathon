import { drawGeographyCanvas, safeGeography } from '../geographyTexture.js';
import { createTerrainLoader } from '../terrainRaster.js';

export const WORLD_TEXTURE_CURRENT_MAX_EDGE = 2048;
export const WORLD_TEXTURE_MINI_MAX_EDGE = 512;
export const WORLD_TEXTURE_CACHE_LIMIT = 24;

const worldIdOf = world => world?.id != null ? String(world.id)
  : world?.runId != null && world?.branchId != null ? `${world.runId}::${world.branchId}` : null;

function stableValue(value) {
  if (Array.isArray(value)) return value.map(stableValue);
  if (value && typeof value === 'object') return Object.fromEntries(Object.keys(value).sort().map(key => [key, stableValue(value[key])]));
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
  const canvas = document.createElement('canvas'); canvas.width = width; canvas.height = height;
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
 * Bounded per-world scenario textures. Non-empty v1 and all v2 terrain are
 * loaded asynchronously; callers are notified when both canvases are ready.
 */
export function createWorldTextureFactory({
  canvasFactory = defaultCanvasFactory,
  draw = drawGeographyCanvas,
  loadTerrain = createTerrainLoader(),
  maxEntries = WORLD_TEXTURE_CACHE_LIMIT,
  onReady = () => {},
  onEvict = () => {},
  onError = () => {},
} = {}) {
  const limit = Math.max(1, Math.min(WORLD_TEXTURE_CACHE_LIMIT, Math.floor(Number(maxEntries) || WORLD_TEXTURE_CACHE_LIMIT)));
  const cache = new Map();
  let disposed = false;

  function evict(key) {
    const entry = cache.get(key);
    if (!entry) return;
    cache.delete(key);
    if (entry.result.status === 'ready') onEvict(entry.result);
  }

  function canvasFor(image, maxEdge) {
    const dimensions = dimensionsFor(image, maxEdge);
    if (!dimensions) return null;
    const canvas = canvasFactory(dimensions.width, dimensions.height);
    canvas.width = dimensions.width; canvas.height = dimensions.height;
    return { canvas, dimensions };
  }

  function render(worldId, geography, baseImage, current, mini, terrain) {
    draw(current.canvas, baseImage, geography, 'scenario', undefined, terrain);
    draw(mini.canvas, baseImage, geography, 'scenario', undefined, terrain);
    return {
      status: 'ready', worldId, geography,
      currentCanvas: current.canvas, miniCanvas: mini.canvas,
      currentDimensions: current.dimensions, miniDimensions: mini.dimensions, terrain,
      fallback: null,
    };
  }

  function create(world, { baseImage, baseIdentity } = {}) {
    const worldId = worldIdOf(world);
    if (!worldId) return { status: 'unsupported', reason: 'missing-world-id', fallback: 'scene-disc' };

    const rawGeography = world?.geography ?? world?.geog;
    const geography = rawGeography == null ? undefined : safeGeography(rawGeography);
    if (rawGeography != null && !geography) {
      return { status: 'unsupported', worldId, reason: 'invalid-geography', fallback: 'scene-disc' };
    }
    if (!baseImage) return { status: 'base-unavailable', worldId, geography, fallback: 'scene-disc' };

    const sourceIdentity = baseImageIdentity(baseImage, baseIdentity);
    const normalizedKey = geography === undefined ? 'base-only' : JSON.stringify(stableValue(geography));
    const cacheKey = `${worldId}\u0000${sourceIdentity}\u0000${normalizedKey}`;
    for (const [key, entry] of cache) if (entry.worldId === worldId && key !== cacheKey) evict(key);
    const hit = cache.get(cacheKey);
    if (hit) {
      cache.delete(cacheKey); cache.set(cacheKey, hit);
      return hit.result;
    }

    const current = canvasFor(baseImage, WORLD_TEXTURE_CURRENT_MAX_EDGE);
    const mini = canvasFor(baseImage, WORLD_TEXTURE_MINI_MAX_EDGE);
    if (!current || !mini) return { status: 'base-unavailable', worldId, geography, fallback: 'scene-disc' };

    const entry = { worldId, result: null };
    cache.set(cacheKey, entry);
    const needsTerrain = geography?.version === 2 || (geography?.version === 1 && geography.changes.length > 0);
    if (!needsTerrain) {
      entry.result = render(worldId, geography, baseImage, current, mini);
    } else {
      entry.result = { status: 'pending', worldId, geography, fallback: 'present-day-texture' };
      const pending = Promise.resolve().then(() => loadTerrain()).then(terrain => {
        if (disposed || cache.get(cacheKey) !== entry) return null;
        // Legacy curated masks are upgraded by the shared renderer when terrain
        // is supplied, so Atlas uses the same coastline pipeline as saved v2.
        const result = render(worldId, geography, baseImage, current, mini, terrain);
        entry.result = result;
        onReady(result);
        return result;
      }).catch(error => {
        if (!disposed && cache.get(cacheKey) === entry) {
          // A transient asset failure must not become a cached permanent fallback.
          cache.delete(cacheKey);
          onError(error, { worldId, geography });
        }
        return null;
      });
      entry.result.promise = pending;
    }
    while (cache.size > limit) evict(cache.keys().next().value);
    return entry.result;
  }

  return {
    create,
    get size() { return cache.size; },
    clear() { for (const key of [...cache.keys()]) evict(key); },
    dispose() { disposed = true; this.clear(); },
  };
}
