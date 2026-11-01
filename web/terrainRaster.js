const TERRAIN_ROOT = '/assets/terrain/';
import { REGIONS } from './geographyRegions.js';
import { getContinentRegistry } from './geography.js';
export const TERRAIN_GRID = Object.freeze({ width: 4320, height: 2160 });
export const SAHARA_GRID = Object.freeze({ width: 3240, height: 1320, bounds: [-18, 12, 36, 34] });
const CONTINENT_CODES = Object.freeze({ africa: 1, eurasia: 2, 'north-america': 3, 'south-america': 4, australia: 5, antarctica: 6 });
const CONTINENT_CENTERS = new Map(getContinentRegistry().map(item => [item.id, item.center]));
const lakeMaskCache = new WeakMap();

async function readGzip(url, expectedBytes, fetchImpl = fetch) {
  const response = await fetchImpl(url);
  if (!response.ok) throw new Error(`Terrain data unavailable (${response.status}): ${url}`);
  const downloaded = new Uint8Array(await response.arrayBuffer());
  const isGzip = downloaded[0] === 0x1f && downloaded[1] === 0x8b;
  let bytes = downloaded;
  if (isGzip) {
    if (typeof DecompressionStream !== 'function') throw new Error('This browser cannot decompress local terrain data');
    const stream = new Blob([downloaded]).stream().pipeThrough(new DecompressionStream('gzip'));
    bytes = new Uint8Array(await new Response(stream).arrayBuffer());
  }
  if (bytes.byteLength !== expectedBytes) throw new Error(`Terrain data has an invalid size: ${url}`);
  return bytes;
}

// Loads only same-origin, versioned local assets. A rejected promise is evicted so
// a later retry can recover after the browser has finished downloading the files.
export function createTerrainLoader({ fetchImpl = fetch, root = TERRAIN_ROOT } = {}) {
  let pending;
  return function loadTerrain() {
    pending ||= (async () => {
      const [heights, landmass, saharaHeights] = await Promise.all([
        readGzip(`${root}elevation-global-5min.i16.gz`, TERRAIN_GRID.width * TERRAIN_GRID.height * 2, fetchImpl),
        readGzip(`${root}landmass-global-5min.u8.gz`, TERRAIN_GRID.width * TERRAIN_GRID.height, fetchImpl),
        readGzip(`${root}elevation-sahara-1min.i16.gz`, SAHARA_GRID.width * SAHARA_GRID.height * 2, fetchImpl),
      ]);
      return { width: TERRAIN_GRID.width, height: TERRAIN_GRID.height,
        elevation: decodeInt16LE(heights), landmass,
        sahara: { ...SAHARA_GRID, elevation: decodeInt16LE(saharaHeights) } };
    })().catch(error => { pending = undefined; throw error; });
    return pending;
  };
}

let sharedTerrainLoader;
export function loadLocalTerrain() {
  sharedTerrainLoader ||= createTerrainLoader();
  return sharedTerrainLoader();
}

function decodeInt16LE(bytes) {
  const probe = new Uint16Array([0x0102]);
  if (probe[0] === 0x0102) return new Int16Array(bytes.buffer, bytes.byteOffset, bytes.byteLength / 2);
  const values = new Int16Array(bytes.byteLength / 2), view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  for (let i = 0; i < values.length; i++) values[i] = view.getInt16(i * 2, true);
  return values;
}

export function sampleTerrain(terrain, lon, lat) {
  if (!terrain?.elevation || !Number.isFinite(lon) || !Number.isFinite(lat)) return { height: -32768, continent: 0 };
  const x = ((lon + 180) / 360 * terrain.width + terrain.width) % terrain.width;
  const y = Math.max(0, Math.min(terrain.height - 1, (90 - lat) / 180 * terrain.height));
  const index = Math.min(terrain.height - 1, Math.floor(y)) * terrain.width + Math.floor(x);
  return { height: terrainHeight(terrain, lon, lat, index), continent: terrain.landmass?.[index] || 0 };
}

function terrainHeight(terrain, lon, lat, globalIndex) {
  const local = terrain.sahara;
  if (local?.elevation && pointInBounds(lon, lat, local.bounds)) {
    const [west, south, east, north] = local.bounds;
    const x = Math.max(0, Math.min(local.width - 1, Math.floor((lon - west) / (east - west) * local.width)));
    const y = Math.max(0, Math.min(local.height - 1, Math.floor((north - lat) / (north - south) * local.height)));
    const value = local.elevation[y * local.width + x];
    if (value !== -32768) return value;
  }
  return terrain.elevation[globalIndex];
}

const clamp = (x, low, high) => Math.max(low, Math.min(high, x));
const wrapLon = lon => ((lon + 180) % 360 + 360) % 360 - 180;
function pointInBounds(lon, lat, bounds) {
  const [west, south, east, north] = bounds;
  const insideLon = west <= east ? lon >= west && lon <= east : lon >= west || lon <= east;
  return insideLon && lat >= south && lat <= north;
}

function makeRigidProjector(transform, inverse = false, center = CONTINENT_CENTERS.get(transform.continentId)) {
  // Precompute the rigid transform once per continent, then apply it to points.
  // This keeps the 5 arc-minute raster path away from per-pixel matrix setup.
  const rad = Math.PI / 180;
  const vector = (longitude, latitude) => { const a = longitude * rad, b = latitude * rad; return [Math.cos(b)*Math.cos(a), Math.cos(b)*Math.sin(a), Math.sin(b)]; };
  const sourceCenter = vector(center[0], center[1]);
  const targetCenter = vector(center[0] + (transform.longitudeOffsetDeg || 0), clamp(center[1] + (transform.latitudeOffsetDeg || 0), -90, 90));
  const dot = sourceCenter[0]*targetCenter[0] + sourceCenter[1]*targetCenter[1] + sourceCenter[2]*targetCenter[2];
  const axis = [sourceCenter[1]*targetCenter[2]-sourceCenter[2]*targetCenter[1], sourceCenter[2]*targetCenter[0]-sourceCenter[0]*targetCenter[2], sourceCenter[0]*targetCenter[1]-sourceCenter[1]*targetCenter[0]];
  const axisLength = Math.hypot(axis[0], axis[1], axis[2]);
  if (axisLength > 1e-12) { axis[0] /= axisLength; axis[1] /= axisLength; axis[2] /= axisLength; }
  const moveAngle = Math.atan2(axisLength, dot), moveCos = axisLength > 1e-12 ? Math.cos(moveAngle) : 1, moveSin = axisLength > 1e-12 ? Math.sin(moveAngle) : 0;
  const spinAngle = (transform.rotationDeg || 0) * rad, spinCos = Math.cos(spinAngle), spinSin = Math.sin(spinAngle);
  return (lon, lat) => {
    const a = lon * rad, b = lat * rad, point = [Math.cos(b)*Math.cos(a), Math.cos(b)*Math.sin(a), Math.sin(b)];
    if (inverse) {
      if (spinSin) rotateAround(point, targetCenter, spinCos, -spinSin);
      if (moveSin) rotateAround(point, [-axis[0], -axis[1], -axis[2]], moveCos, moveSin);
    } else {
      if (moveSin) rotateAround(point, axis, moveCos, moveSin);
      if (spinSin) rotateAround(point, targetCenter, spinCos, spinSin);
    }
    return [wrapLon(Math.atan2(point[1], point[0]) / rad), Math.asin(clamp(point[2], -1, 1)) / rad];
  };
}

function rotateAround(point, axis, c, s) {
  const x = point[0], y = point[1], z = point[2], dot = axis[0]*x + axis[1]*y + axis[2]*z;
  const cx = axis[1]*z - axis[2]*y, cy = axis[2]*x - axis[0]*z, cz = axis[0]*y - axis[1]*x, k = dot * (1 - c);
  point[0] = x*c + cx*s + axis[0]*k;
  point[1] = y*c + cy*s + axis[1]*k;
  point[2] = z*c + cz*s + axis[2]*k;
}

// Branch places, camera targets and route endpoints all use present-day anchor
// coordinates in saved data. Apply the same sampled continent transform used by
// the texture at render time, without changing the saved branch location.
export function projectGeographyLocation(location, geography, terrain) {
  if (!location || !Number.isFinite(location.lat) || !Number.isFinite(location.lon)) return location;
  if (geography?.version !== 2 || !terrain || !geography.continentalTransforms?.length) return { ...location };
  const { continent } = sampleTerrain(terrain, location.lon, location.lat);
  const transform = geography.continentalTransforms.find(item => CONTINENT_CODES[item.continentId] === continent);
  if (!transform) return { ...location };
  const [lon, lat] = makeRigidProjector(transform)(location.lon, location.lat);
  return { ...location, lon, lat };
}

/** Apply a normalized v2 state to an equirectangular RGBA frame in-place. */
export function applyTerrainScenario({ data, width, height }, terrain, geography) {
  if (!terrain || !geography || geography.version !== 2) return { applied: false, reason: 'Terrain scenario needs a version 2 state and local elevation data.' };
  const transforms = geography.continentalTransforms || [];
  const changes = geography.changes || [];
  const effectiveChanges = changes.flatMap(change => {
    if (change.kind === 'lake' && change.region) {
      const region = REGIONS[change.region], basins = region?.lakeBasins || deriveLakeBasins(region);
      if (basins?.length) return basins.map((basin, index) => ({ ...change, id: `${change.id || change.region}-basin-${index + 1}`,
        bounds: basin.bounds, seed: basin.seed, waterLevelMeters: basin.waterLevelMeters ?? change.waterLevelMeters,
        localMinimumSearchDeg: basin.localMinimumSearchDeg }));
    }
    if (change.bounds) return { ...change, bounds: change.bounds };
    const legacyBounds = change.region ? (REGIONS[change.region]?.terrainBounds || REGIONS[change.region]?.bounds) : undefined;
    const region = change.region ? REGIONS[change.region] : undefined;
    return [legacyBounds ? { ...change, bounds: legacyBounds,
      ...(change.kind === 'land' && !Number.isFinite(change.elevationDeltaMeters) && Number.isFinite(region?.landExposureMeters)
        ? { elevationDeltaMeters: region.landExposureMeters } : {}) } : change];
  });
  // Resolve terrain first, then surface cover, then water so exposed ground
  // receives the same overlays regardless of the input change order.
  const changeOrder = { land: 0, vegetation: 1, ice: 1, lake: 2 };
  effectiveChanges.sort((a, b) => (changeOrder[a.kind] ?? 1) - (changeOrder[b.kind] ?? 1));
  const needsRaster = (geography.seaLevelMeters || 0) !== 0 || transforms.length || effectiveChanges.some(c => c.bounds && ['vegetation','lake','ice','land'].includes(c.kind));
  if (!needsRaster) return { applied: true, changedPixels: 0 };
  const lakeMasks = new Map();
  for (const change of effectiveChanges) if (change.kind === 'lake' && change.bounds) {
    const mask = cachedLakeMask(terrain, width, height, change);
    if (!mask) return { applied: false, reason: `Lake basin unsupported: seed ${JSON.stringify(change.seed || 'regional center')} is not continental land below its water-surface level.` };
    lakeMasks.set(change, mask);
  }
  const output = new Uint8ClampedArray(data);
  const renderElevation = new Int16Array(width * height).fill(-32768);
  const renderLandmass = new Uint8Array(width * height);
  const strideX = terrain.width / width, strideY = terrain.height / height;
  const transformByCode = new Map(transforms.map(t => [CONTINENT_CODES[t.continentId], t]));
  const projectByCode = new Map(transforms.map(t => [CONTINENT_CODES[t.continentId], makeRigidProjector(t)]));
  const unprojectByCode = new Map(transforms.map(t => [CONTINENT_CODES[t.continentId], makeRigidProjector(t, true)]));
  const transformExtents = new Map(transforms.map(t => [CONTINENT_CODES[t.continentId], { minX: width, maxX: -1, minY: height, maxY: -1 }]));
  let changedPixels = 0;
  // Forward-sample only to find destination extents; color and elevation are
  // inverse-resampled below so destination pixels do not get splat gaps.
  if (transforms.length) {
    var movedElevation = new Int16Array(width * height).fill(-32768);
    var movedLandmass = new Uint8Array(width * height);
    const sourceStepX = Math.max(1, Math.floor(terrain.width / width));
    const sourceStepY = Math.max(1, Math.floor(terrain.height / height));
    for (let py = 0; py < terrain.height; py += sourceStepY) {
      const lat = 90 - (py + .5) * 180 / terrain.height;
      for (let px = 0, base = py * terrain.width; px < terrain.width; px += sourceStepX) {
        const t = transformByCode.get(terrain.landmass[base + px]);
        if (!t) continue;
        const lon = -180 + (px + .5) * 360 / terrain.width;
        const [movedLon, movedLat] = projectByCode.get(terrain.landmass[base + px])(lon, lat);
        const oy = Math.max(0, Math.min(height - 1, Math.floor((90 - movedLat) / 180 * height)));
        const ox = Math.floor((wrapLon(movedLon) + 180) / 360 * width);
        const extent = transformExtents.get(terrain.landmass[base + px]);
        extent.minX = Math.min(extent.minX, ox); extent.maxX = Math.max(extent.maxX, ox);
        extent.minY = Math.min(extent.minY, oy); extent.maxY = Math.max(extent.maxY, oy);
      }
    }
  }
  const sea = geography.seaLevelMeters || 0;
  for (let y = 0; y < height; y++) {
    const lat = 90 - (y + .5) * 180 / height;
    const ty = Math.min(terrain.height - 1, Math.floor((y + .5) * strideY));
    for (let x = 0; x < width; x++) {
      const i = y * width + x, p = i * 4;
      const lon = -180 + (x + .5) * 360 / width;
      const tx = Math.floor((x + .5) * strideX), ti = ty * terrain.width + tx;
      const originalElevation = terrainHeight(terrain, lon, lat, ti), originalContinent = terrain.landmass[ti] || 0;
      let hasMovedPixel = false;
      // Fill forward-splat holes by inverse sampling only within each moved
      // continent's padded destination bounds. This keeps shorelines continuous
      // without evaluating a transform at every point on the whole globe.
      if (transforms.length) for (const [code, extent] of transformExtents) {
        if (extent.maxX < 0 || x < extent.minX - 2 || x > extent.maxX + 2 || y < extent.minY - 2 || y > extent.maxY + 2) continue;
        const [inverseLon, inverseLat] = unprojectByCode.get(code)(lon, lat);
        const resolved = resolveContinentSample(terrain, inverseLon, inverseLat, code);
        if (!resolved) continue;
        const { lon: sourceLon, lat: sourceLat, terrain: sourceTerrain } = resolved;
        const sourceX = Math.max(0, Math.min(width - 1, Math.floor((wrapLon(sourceLon) + 180) / 360 * width)));
        const sourceY = Math.max(0, Math.min(height - 1, Math.floor((90 - sourceLat) / 180 * height)));
        const sourceIndex = sourceY * width + sourceX, sourcePixel = sourceIndex * 4;
        let sourceHeight = sourceTerrain.height;
        output[p] = data[sourcePixel]; output[p + 1] = data[sourcePixel + 1]; output[p + 2] = data[sourcePixel + 2]; output[p + 3] = 255;
        let scenarioExposed = sourceTerrain.continent === 0 && sourceTerrain.height <= sea && sourceHeight > sea;
        if (scenarioExposed) paintExposedShelf(output, p, sourceHeight, sea, terrain, sourceLon, sourceLat, sourceTerrain.height);
        for (const change of effectiveChanges) {
          if (!change.bounds || !pointInBounds(sourceLon, sourceLat, change.bounds)) continue;
          const edge = edgeFeather(sourceLon, sourceLat, change.bounds), grain = geospatialGrain(sourceLon, sourceLat);
          if (change.kind === 'vegetation' && sourceHeight > sea && (sourceTerrain.continent > 0 || scenarioExposed)) {
            if (scenarioExposed) paintExposedVegetation(output, p, sourceHeight, sea, terrain, sourceLon, sourceLat, sourceTerrain.height, change.intensity, edge);
            else blend(output, p, [48,143,72], clamp((.12 + .44 * change.intensity * (sourceHeight > 2500 ? .45 : 1)) * edge * grain, 0, .65));
          }
          else if (change.kind === 'ice' && sourceHeight > 0) blend(output, p, [212,229,232], clamp((.2 + .58 * change.intensity) * edge * grain, 0, .78));
          else if (change.kind === 'lake' && lakeMasks.get(change)?.[sourceIndex]) blend(output, p, [38,130,174], clamp(.48 + change.intensity * .38, 0, .84));
          else if (change.kind === 'land' && Number.isFinite(change.elevationDeltaMeters)) {
            const originalHeight = sourceHeight;
            sourceHeight = clamp(sourceHeight + change.elevationDeltaMeters * edge, -32767, 32767);
            if (sourceTerrain.continent === 0 && originalHeight <= sea && sourceHeight > sea) {
              paintExposedShelf(output, p, sourceHeight, sea, terrain, sourceLon, sourceLat, originalHeight);
              scenarioExposed = true;
            }
          }
        }
        movedElevation[i] = sourceHeight; movedLandmass[i] = code; hasMovedPixel = true; break;
      }
      const wasMovedSource = transformByCode.has(originalContinent);
      let elevation = hasMovedPixel ? movedElevation[i] : wasMovedSource ? -32768 : originalElevation;
      const continent = hasMovedPixel ? movedLandmass[i] : wasMovedSource ? 0 : originalContinent;
      renderElevation[i] = elevation; renderLandmass[i] = continent;
      if (wasMovedSource && !hasMovedPixel) { output[p] = 28; output[p + 1] = 73; output[p + 2] = 105; output[p + 3] = 255; }
      if (elevation === -32768) continue;
      let scenarioExposed = sea < 0 && continent === 0 && originalElevation <= 0 && elevation > sea;
      if (scenarioExposed) {
        // Keep the DEM's exact sea threshold, then replace the ocean basemap
        // with an opaque land surface so exposed ground reads as land.
        paintExposedShelf(output, p, elevation, sea, terrain, lon, lat, originalElevation); changedPixels++;
      }
      for (const change of effectiveChanges) {
        if (hasMovedPixel || wasMovedSource) continue;
        if (!change.bounds || !pointInBounds(lon, lat, change.bounds)) continue;
        const edge = edgeFeather(lon, lat, change.bounds);
        const grain = geospatialGrain(lon, lat);
        if (change.kind === 'vegetation' && (continent || scenarioExposed) && elevation > sea) {
          if (scenarioExposed) paintExposedVegetation(output, p, elevation, sea, terrain, lon, lat, originalElevation, change.intensity, edge);
          else {
            const amount = clamp((.12 + .44 * change.intensity * (elevation > 2500 ? .45 : 1)) * edge * grain, 0, .65);
            blend(output, p, [48, 143, 72], amount);
          }
          changedPixels++;
        } else if (change.kind === 'ice' && continent && elevation > sea) {
          blend(output, p, [212, 229, 232], clamp((.2 + .58 * change.intensity) * edge * grain, 0, .78)); changedPixels++;
        } else if (change.kind === 'land' && Number.isFinite(change.elevationDeltaMeters)) {
          const originalElevation = elevation;
          elevation = clamp(elevation + change.elevationDeltaMeters * edge, -32767, 32767);
          if (!continent && originalElevation <= sea && elevation > sea) {
            paintExposedShelf(output, p, elevation, sea, terrain, lon, lat, originalElevation);
            scenarioExposed = true;
            renderLandmass[i] = 7; // scenario-exposed shelf; not a registered transform target
            changedPixels++;
          }
        } else if (change.kind === 'lake' && continent && lakeMasks.get(change)?.[i]) {
          // The bounds gate a local basin search; the DEM threshold follows
          // connected low ground and supplies the shoreline rather than a polygon.
          blend(output, p, [38, 130, 174], clamp(.48 + change.intensity * .38, 0, .84)); changedPixels++;
        }
      }
      renderElevation[i] = elevation;
    }
  }
  if (sea > 0) {
    const flooded = floodSeaLevel(renderElevation, renderLandmass, width, height, sea);
    for (let i = 0; i < flooded.length; i++) if (flooded[i] && renderLandmass[i] > 0) {
      blend(output, i * 4, [36, 111, 153], Math.min(.82, .25 + sea / 18000)); changedPixels++;
    }
  }
  data.set(output);
  return { applied: true, changedPixels, elevation: renderElevation };
}

function cachedLakeMask(terrain, width, height, change) {
  let cache = lakeMaskCache.get(terrain);
  if (!cache) { cache = new Map(); lakeMaskCache.set(terrain, cache); }
  const key = JSON.stringify([width, height, change.bounds, change.seed, change.waterLevelMeters, change.localMinimumSearchDeg, change.region]);
  if (cache.has(key)) { const existing = cache.get(key); cache.delete(key); cache.set(key, existing); return existing; }
  const mask = makeLakeMask(terrain, width, height, change);
  cache.set(key, mask);
  while (cache.size > 4) cache.delete(cache.keys().next().value);
  return mask;
}

function floodSeaLevel(elevation, landmass, width, height, level) {
  const flooded = new Uint8Array(width * height), queue = new Uint32Array(width * height);
  let head = 0, tail = 0;
  for (let i = 0; i < landmass.length; i++) {
    if (landmass[i] === 0 && elevation[i] !== -32768 && elevation[i] <= level) { flooded[i] = 1; queue[tail++] = i; }
  }
  while (head < tail) {
    const i = queue[head++], x = i % width, y = (i / width) | 0;
    let n = y * width + (x ? x - 1 : width - 1);
    if (!flooded[n] && elevation[n] !== -32768 && elevation[n] <= level) { flooded[n] = 1; queue[tail++] = n; }
    n = y * width + (x + 1 === width ? 0 : x + 1);
    if (!flooded[n] && elevation[n] !== -32768 && elevation[n] <= level) { flooded[n] = 1; queue[tail++] = n; }
    if (y) { n = i - width; if (!flooded[n] && elevation[n] !== -32768 && elevation[n] <= level) { flooded[n] = 1; queue[tail++] = n; } }
    if (y + 1 < height) { n = i + width; if (!flooded[n] && elevation[n] !== -32768 && elevation[n] <= level) { flooded[n] = 1; queue[tail++] = n; } }
  }
  return flooded;
}

function resolveContinentSample(terrain, lon, lat, code) {
  const direct = sampleTerrain(terrain, lon, lat);
  if (direct.continent === code) return { lon, lat, terrain: direct };
  const x = Math.floor((wrapLon(lon) + 180) / 360 * terrain.width), y = Math.floor((90 - lat) / 180 * terrain.height);
  let best = null, bestDistance = Infinity;
  for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
    const sy = y + dy; if (sy < 0 || sy >= terrain.height) continue;
    const sx = ((x + dx) % terrain.width + terrain.width) % terrain.width, index = sy * terrain.width + sx;
    if (terrain.landmass[index] !== code) continue;
    const candidateLon = -180 + (sx + .5) * 360 / terrain.width, candidateLat = 90 - (sy + .5) * 180 / terrain.height;
    const distance = ((candidateLon - lon) * Math.max(.15, Math.cos(lat * Math.PI / 180))) ** 2 + (candidateLat - lat) ** 2;
    if (distance < bestDistance) {
      bestDistance = distance;
      best = { lon: candidateLon, lat: candidateLat, terrain: { height: terrainHeight(terrain, candidateLon, candidateLat, index), continent: code } };
    }
  }
  return best;
}

function edgeFeather(lon, lat, [west, south, east, north]) {
  const lonDistance = west <= east ? Math.min(lon - west, east - lon) : Math.min(lon < west ? lon + 180 + 180 - west : lon - west, lon < east ? east - lon : 180 - lon + east + 180);
  const degrees = Math.min(lonDistance * Math.max(.15, Math.cos(lat * Math.PI / 180)), lat - south, north - lat);
  return clamp(degrees / 2.2, 0, 1);
}

function geospatialGrain(lon, lat) {
  // Appearance-only deterministic grain; it never changes sampled elevation.
  const x = Math.floor((lon + 180) * 32), y = Math.floor((lat + 90) * 32);
  let n = Math.imul(x ^ 0x9e3779b9, 0x85ebca6b) ^ Math.imul(y ^ 0xc2b2ae35, 0x27d4eb2f);
  n = Math.imul(n ^ (n >>> 16), 0x7feb352d); n ^= n >>> 15;
  return .78 + ((n >>> 0) % 1000) / 1000 * .28;
}

function makeLakeMask(terrain, width, height, change) {
  const mask = new Uint8Array(width * height), bounds = change.bounds;
  const { xRanges, yStart, yEnd } = pixelRanges(bounds, width, height);
  let seedPoint = Array.isArray(change.seed) ? change.seed : [(bounds[0] + bounds[2]) / 2, (bounds[1] + bounds[3]) / 2];
  if (!Number.isFinite(change.waterLevelMeters) && Number.isFinite(change.localMinimumSearchDeg)) {
    let lowest = Infinity, selected;
    for (let y = yStart; y <= yEnd; y++) {
      const lat = 90 - (y + .5) * 180 / height;
      if (Math.abs(lat - seedPoint[1]) > change.localMinimumSearchDeg) continue;
      for (const [xStart, xEnd] of xRanges) for (let x = xStart; x <= xEnd; x++) {
        const lon = -180 + (x + .5) * 360 / width;
        if (Math.abs(lon - seedPoint[0]) > change.localMinimumSearchDeg) continue;
        const tx = Math.floor((x + .5) * terrain.width / width), ty = Math.floor((y + .5) * terrain.height / height), index = ty * terrain.width + tx;
        if ((terrain.landmass[index] || 0) === 0) continue;
        const value = terrainHeight(terrain, lon, lat, index);
        if (value !== -32768 && value < lowest) { lowest = value; selected = [lon, lat]; }
      }
    }
    if (!selected) return null;
    seedPoint = selected;
  }
  // Explicit seeds resolve to their containing output pixel. Never replace an
  // ocean/high seed with an unrelated lower basin elsewhere in its bounds.
  const seedX = Math.max(0, Math.min(width - 1, Math.floor((seedPoint[0] + 180) / 360 * width)));
  const seedY = Math.max(0, Math.min(height - 1, Math.floor((90 - seedPoint[1]) / 180 * height)));
  const seedLon = -180 + (seedX + .5) * 360 / width, seedLat = 90 - (seedY + .5) * 180 / height;
  const seedIndex = seedY * width + seedX;
  const seedTerrain = sampleTerrain(terrain, seedLon, seedLat);
  const level = Number.isFinite(change.waterLevelMeters) ? change.waterLevelMeters : seedTerrain.height;
  if (seedY < yStart || seedY > yEnd || !xRanges.some(([start, end]) => seedX >= start && seedX <= end)
      || !pointInBounds(seedLon, seedLat, bounds) || seedTerrain.continent === 0
      || seedTerrain.height === -32768 || seedTerrain.height > level) return null;
  const seed = seedIndex;
  const area = xRanges.reduce((sum, [start, end]) => sum + end - start + 1, 0) * (yEnd - yStart + 1);
  const queue = new Uint32Array(Math.max(1, area)); let head = 0, tail = 0; queue[tail++] = seed; mask[seed] = 1;
  while (head < tail) {
    const index = queue[head++], x = index % width, y = (index / width) | 0;
    for (const [nx, ny] of [[x-1,y],[x+1,y],[x,y-1],[x,y+1]]) {
      if (nx < 0 || nx >= width || ny < 0 || ny >= height) continue;
      const next = ny * width + nx; if (mask[next]) continue;
      const lon = -180 + (nx + .5) * 360 / width, lat = 90 - (ny + .5) * 180 / height;
      if (!pointInBounds(lon, lat, bounds)) continue;
      const tx = Math.floor((nx + .5) * terrain.width / width), ty = Math.floor((ny + .5) * terrain.height / height);
      const value = terrainHeight(terrain, lon, lat, ty * terrain.width + tx);
      if ((terrain.landmass[ty * terrain.width + tx] || 0) === 0 || value === -32768 || value > level) continue;
      mask[next] = 1; queue[tail++] = next;
    }
  }
  return mask;
}

function deriveLakeBasins(region) {
  const polygons = region?.kindPolygons?.lake;
  if (!polygons?.length) return [];
  return polygons.map((ring, index) => {
    const longitudes = ring.map(point => point[0]), latitudes = ring.map(point => point[1]);
    const west = Math.min(...longitudes), east = Math.max(...longitudes), south = Math.min(...latitudes), north = Math.max(...latitudes);
    const seed = [longitudes.reduce((sum, value) => sum + value, 0) / ring.length, latitudes.reduce((sum, value) => sum + value, 0) / ring.length];
    const pad = 2;
    return { bounds: [west - pad, south - pad, east + pad, north + pad], seed, waterLevelMeters: 300, id: index };
  });
}

function pixelRanges([west, south, east, north], width, height) {
  const xAt = longitude => Math.max(0, Math.min(width - 1, Math.floor((longitude + 180) / 360 * width)));
  const yStart = Math.max(0, Math.min(height - 1, Math.floor((90 - north) / 180 * height)));
  const yEnd = Math.max(yStart, Math.min(height - 1, Math.ceil((90 - south) / 180 * height) - 1));
  const xRanges = west <= east ? [[xAt(west), xAt(east)]] : [[0, xAt(east)], [xAt(west), width - 1]];
  return { xRanges, yStart, yEnd };
}

function blend(data, index, color, alpha) {
  data[index] = data[index] * (1 - alpha) + color[0] * alpha;
  data[index + 1] = data[index + 1] * (1 - alpha) + color[1] * alpha;
  data[index + 2] = data[index + 2] * (1 - alpha) + color[2] * alpha;
}

function paintExposedShelf(data, index, height, sea, terrain, lon, lat, originalHeight) {
  const relief = clamp((height - sea) / 1800, 0, 1);
  const shore = 1 - clamp((height - sea) / 260, 0, 1);
  const slope = exposedShelfSlope(terrain, lon, lat, originalHeight);
  const texture = exposedShelfTexture(lon, lat);
  const light = clamp(.88 + .18 * relief - .2 * slope + texture, .48, 1.24);
  const earth = [150 + 32 * relief, 111 + 35 * relief, 72 + 25 * relief];
  const sand = [196, 177, 132];
  for (let c = 0; c < 3; c++) data[index + c] = Math.round(((earth[c] * (1 - shore)) + (sand[c] * shore)) * light);
}

function exposedShelfSlope(terrain, lon, lat, center) {
  if (!terrain?.elevation || terrain.width < 2 || terrain.height < 2) return 0;
  const dLon = 360 / terrain.width, dLat = 180 / terrain.height;
  const east = sampleTerrain(terrain, lon + dLon, lat).height;
  const west = sampleTerrain(terrain, lon - dLon, lat).height;
  const north = sampleTerrain(terrain, lon, lat + dLat).height;
  const south = sampleTerrain(terrain, lon, lat - dLat).height;
  const delta = Math.max(Math.abs(east - west), Math.abs(north - south));
  return clamp(delta / Math.max(1, Math.abs(center) + 900), 0, 1);
}

function exposedShelfTexture(lon, lat) {
  // Coherent value noise at three scales gives ground relief without a
  // separately allocated texture or changes to the underlying DEM.
  return (valueNoise(lon, lat, 2, 0x9e3779b9) - .5) * .11
    + (valueNoise(lon, lat, 9, 0x85ebca6b) - .5) * .09
    + (valueNoise(lon, lat, 32, 0xc2b2ae35) - .5) * .07;
}

function paintExposedVegetation(data, index, height, sea, terrain, lon, lat, originalHeight, intensity, edge) {
  const relief = clamp((height - sea) / 1800, 0, 1);
  const slope = exposedShelfSlope(terrain, lon, lat, originalHeight);
  const broad = valueNoise(lon, lat, 1.8, 0x27d4eb2f);
  const mid = valueNoise(lon, lat, 7, 0x165667b1);
  const fine = valueNoise(lon, lat, 25, 0x7feb352d);
  const texture = (broad - .5) * .42 + (mid - .5) * .3 + (fine - .5) * .22;
  const canopy = clamp(.74 + texture * .85, .3, 1);
  const cover = clamp(intensity * edge, 0, 1);
  const ground = clamp((1 - cover) * .72 + Math.max(0, .42 - canopy) * .7, 0, .58);
  const shade = clamp(.97 + (relief - .35) * .14 - slope * .3 + (fine - .5) * .12, .54, 1.12);
  const coverage = cover * cover * (3 - 2 * cover);
  // Organic canopy tones vary with coherent patch noise; sparse openings show
  // mossy groundcover and the earth material beneath rather than flat green.
  const green = [36 + mid * 28, 78 + canopy * 50, 42 + broad * 24];
  const groundTone = [112 + broad * 28, 111 + mid * 26, 68 + fine * 22];
  for (let c = 0; c < 3; c++) {
    const value = green[c] * (1 - ground) + groundTone[c] * ground;
    const material = value * shade;
    data[index + c] = Math.round(data[index + c] * (1 - coverage) + material * coverage);
  }
}

function valueNoise(lon, lat, scale, seed) {
  const x = (lon + 180) * scale, y = (lat + 90) * scale;
  const x0 = Math.floor(x), y0 = Math.floor(y), fx = x - x0, fy = y - y0;
  const smoothX = fx * fx * (3 - 2 * fx), smoothY = fy * fy * (3 - 2 * fy);
  const hash = (gx, gy) => {
    let n = Math.imul(gx ^ seed, 0x45d9f3b) ^ Math.imul(gy ^ (seed >>> 1), 0x119de1f3);
    n = Math.imul(n ^ (n >>> 16), 0x7feb352d); n ^= n >>> 15;
    return (n >>> 0) / 0xffffffff;
  };
  const north = hash(x0, y0) * (1 - smoothX) + hash(x0 + 1, y0) * smoothX;
  const south = hash(x0, y0 + 1) * (1 - smoothX) + hash(x0 + 1, y0 + 1) * smoothX;
  return north * (1 - smoothY) + south * smoothY;
}
