import { normalizeGeography, upgradeGeographyV1ToV2 } from './geography.js';
import { REGIONS, GEOGRAPHY_STYLES } from './geographyRegions.js';
import { applyTerrainScenario, createTerrainLoader } from './terrainRaster.js';

export const BASE_EARTH_IMAGE = '/assets/earth-blue-marble.jpg';
export const GLOBAL_TERRAIN_RENDER_WIDTH = 4096;
const terrainFrameCache = new WeakMap();
export function projectCoordinate([lon, lat], width, height, bounds = [-180, -90, 180, 90]) {
  return [(lon - bounds[0]) / (bounds[2] - bounds[0]) * width, (bounds[3] - lat) / (bounds[3] - bounds[1]) * height];
}
export function unwrapRing(ring) {
  let previous;
  return ring.map(([longitude, latitude]) => {
    let lon = longitude;
    if (previous !== undefined) {
      while (lon - previous > 180) lon -= 360;
      while (lon - previous < -180) lon += 360;
    }
    previous = lon;
    return [lon, latitude];
  });
}
export function safeGeography(value) {
  try { return normalizeGeography(value); } catch { return undefined; }
}
export function visibleChanges(value, mode = 'scenario') {
  return mode === 'scenario' ? (safeGeography(value)?.changes || []).filter(change => change.intensity > 0) : [];
}
export function paintGeography(context, geography, width, height, bounds) {
  // Water stays above vegetation when both illustrative conditions are present.
  const changes = visibleChanges(geography).sort((a, b) => Number(a.kind === 'lake') - Number(b.kind === 'lake'));
  for (const change of changes) {
    const region = REGIONS[change.region], style = GEOGRAPHY_STYLES[change.kind];
    context.fillStyle = style.color;
    // Intensity controls a qualitative illustration, never metres or sea level.
    context.globalAlpha = 0.35 + 0.57 * change.intensity;
    for (const polygon of region.kindPolygons?.[change.kind] || region.polygons) {
      const ring = unwrapRing(polygon);
      for (const offset of [-360, 0, 360]) {
        context.beginPath();
        ring.forEach(([lon, lat], index) => {
          const [x, y] = projectCoordinate([lon + offset, lat], width, height, bounds);
          if (index === 0) context.moveTo(x, y); else context.lineTo(x, y);
        });
        context.closePath(); context.fill();
      }
    }
  }
  context.globalAlpha = 1;
}
export function drawGeographyCanvas(canvas, image, geography, mode = 'scenario', regionId, terrain) {
  const context = canvas.getContext('2d');
  if (!context) throw new Error('Canvas drawing unavailable');
  context.clearRect(0, 0, canvas.width, canvas.height);
  const bounds = regionId ? REGIONS[regionId].bounds : undefined;
  if (bounds) {
    const [x, y] = projectCoordinate([bounds[0], bounds[3]], image.naturalWidth || image.width, image.naturalHeight || image.height);
    const [right, bottom] = projectCoordinate([bounds[2], bounds[1]], image.naturalWidth || image.width, image.naturalHeight || image.height);
    context.drawImage(image, x, y, right - x, bottom - y, 0, 0, canvas.width, canvas.height);
  } else context.drawImage(image, 0, 0, canvas.width, canvas.height);
  const terrainGeography = geography?.version === 1 && terrain ? upgradeGeographyV1ToV2(geography) : geography;
  if (mode !== 'present' && terrainGeography?.version === 2 && !regionId) {
    if (!terrain) throw new Error('Terrain data is required to render this geography scenario.');
    const pixels = context.getImageData(0, 0, canvas.width, canvas.height);
    const imageKey = image.currentSrc || image.src || '';
    const frameKey = `${canvas.width}x${canvas.height}|${imageKey}|${JSON.stringify(terrainGeography)}`;
    let frames = terrainFrameCache.get(terrain);
    if (!frames) { frames = new Map(); terrainFrameCache.set(terrain, frames); }
    if (frames.has(frameKey)) {
      const cached = frames.get(frameKey); frames.delete(frameKey); frames.set(frameKey, cached);
      pixels.data.set(cached.pixels); context.putImageData(pixels, 0, 0); canvas.terrainElevation = cached.elevation;
      return canvas;
    }
    const result = applyTerrainScenario(pixels, terrain, terrainGeography);
    if (!result.applied) throw new Error(result.reason);
    context.putImageData(pixels, 0, 0);
    canvas.terrainElevation = result.elevation;
    if (result.elevation) {
      frames.set(frameKey, { pixels: new Uint8ClampedArray(pixels.data), elevation: result.elevation });
      while (frames.size > 2) frames.delete(frames.keys().next().value);
    }
  } else if (terrainGeography?.version !== 2) {
    paintGeography(context, { version: 1, changes: visibleChanges(geography, mode) }, canvas.width, canvas.height, bounds);
  }
  return canvas;
}

// A v2 inset must crop the already terrain-composited global surface. Cropping
// the source image first would lose transformed shorelines and basin masks.
export function drawGeographyInsetCanvas(canvas, image, geography, mode = 'scenario', regionId, terrain, createCanvas = createScratchCanvas) {
  const region = REGIONS[regionId];
  if (!region) throw new Error(`Unsupported geography inset: ${regionId}`);
  const terrainGeography = geography?.version === 1 && terrain ? upgradeGeographyV1ToV2(geography) : geography;
  if (terrainGeography?.version !== 2 || mode === 'present') return drawGeographyCanvas(canvas, image, terrainGeography, mode, regionId, terrain);
  const imageWidth = image.naturalWidth || image.width, imageHeight = image.naturalHeight || image.height;
  const scale = Math.min(1, GLOBAL_TERRAIN_RENDER_WIDTH / imageWidth);
  const width = Math.max(1, Math.round(imageWidth * scale)), height = Math.max(1, Math.round(imageHeight * scale));
  const full = createCanvas(width, height);
  full.width = width; full.height = height;
  drawGeographyCanvas(full, image, terrainGeography, mode, undefined, terrain);
  const [x, y] = projectCoordinate([region.bounds[0], region.bounds[3]], width, height);
  const [right, bottom] = projectCoordinate([region.bounds[2], region.bounds[1]], width, height);
  const context = canvas.getContext('2d');
  if (!context) throw new Error('Canvas drawing unavailable');
  context.clearRect(0, 0, canvas.width, canvas.height);
  context.drawImage(full, x, y, right - x, bottom - y, 0, 0, canvas.width, canvas.height);
  return canvas;
}

function createScratchCanvas(width, height) {
  if (typeof OffscreenCanvas === 'function') return new OffscreenCanvas(width, height);
  if (typeof document !== 'undefined') { const canvas = document.createElement('canvas'); canvas.width = width; canvas.height = height; return canvas; }
  throw new Error('Canvas drawing unavailable');
}
export function loadEarthImage() {
  return new Promise((resolve, reject) => {
    const image = new Image(); image.onload = () => resolve(image); image.onerror = () => reject(new Error('Earth texture unavailable')); image.src = BASE_EARTH_IMAGE;
  });
}
// The image can arrive after navigation or a toggle. Only the newest request paints.
export function createGeographyRenderer({ loadImage = loadEarthImage, loadTerrain = createTerrainLoader(), paint, apply, onError = () => {} }) {
  let revision = 0, disposed = false, imagePromise, terrainPromise;
  return {
    async set(geography, mode = 'scenario') {
      const request = ++revision;
      try {
        imagePromise ||= loadImage();
        const image = await imagePromise;
        if (disposed || request !== revision) return false;
        let state;
        try { state = geography == null ? undefined : normalizeGeography(geography); }
        catch (error) {
          if (!disposed && request === revision) onError(new Error(`Unsupported or invalid geography selector: ${error.message}`));
          return false;
        }
        let terrain;
        const needsTerrain = state?.version === 2 || (state?.version === 1 && state.changes.length > 0);
        if (mode !== 'present' && needsTerrain) {
          terrainPromise ||= loadTerrain();
          terrain = await terrainPromise;
          if (disposed || request !== revision) return false;
        }
        const frame = await paint(image, state, mode, terrain);
        if (disposed || request !== revision) { frame?.dispose?.(); return false; }
        apply(frame); return true;
      } catch (error) { imagePromise = undefined; terrainPromise = undefined; if (!disposed && request === revision) onError(error); return false; }
    },
    dispose() { disposed = true; revision++; },
  };
}
