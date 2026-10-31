import { normalizeGeography } from './geography.js';
import { REGIONS, GEOGRAPHY_STYLES } from './geographyRegions.js';

export const BASE_EARTH_IMAGE = '/assets/earth-blue-marble.jpg';
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
  try { const normalized = normalizeGeography(value); return normalized?.version === 1 ? normalized : undefined; } catch { return undefined; }
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
export function drawGeographyCanvas(canvas, image, geography, mode = 'scenario', regionId) {
  const context = canvas.getContext('2d');
  if (!context) throw new Error('Canvas drawing unavailable');
  context.clearRect(0, 0, canvas.width, canvas.height);
  const bounds = regionId ? REGIONS[regionId].bounds : undefined;
  if (bounds) {
    const [x, y] = projectCoordinate([bounds[0], bounds[3]], image.naturalWidth || image.width, image.naturalHeight || image.height);
    const [right, bottom] = projectCoordinate([bounds[2], bounds[1]], image.naturalWidth || image.width, image.naturalHeight || image.height);
    context.drawImage(image, x, y, right - x, bottom - y, 0, 0, canvas.width, canvas.height);
  } else context.drawImage(image, 0, 0, canvas.width, canvas.height);
  paintGeography(context, { version: 1, changes: visibleChanges(geography, mode) }, canvas.width, canvas.height, bounds);
  return canvas;
}
export function loadEarthImage() {
  return new Promise((resolve, reject) => {
    const image = new Image(); image.onload = () => resolve(image); image.onerror = () => reject(new Error('Earth texture unavailable')); image.src = BASE_EARTH_IMAGE;
  });
}
// The image can arrive after navigation or a toggle. Only the newest request paints.
export function createGeographyRenderer({ loadImage = loadEarthImage, paint, apply, onError = () => {} }) {
  let revision = 0, disposed = false, imagePromise;
  return {
    async set(geography, mode = 'scenario') {
      const request = ++revision;
      try {
        imagePromise ||= loadImage();
        const image = await imagePromise;
        if (disposed || request !== revision) return false;
        const frame = paint(image, safeGeography(geography), mode);
        if (disposed || request !== revision) { frame?.dispose?.(); return false; }
        apply(frame); return true;
      } catch (error) { imagePromise = undefined; if (!disposed && request === revision) onError(error); return false; }
    },
    dispose() { disposed = true; revision++; },
  };
}
