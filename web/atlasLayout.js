/** Pure coordinate and zoom helpers shared by the browser atlas and its tests. */

export const ATLAS_LEVEL_MIN = 0;
export const ATLAS_LEVEL_MAX = 7;
export const SURFACE_LABEL_LEVEL = 3;
export const ORBIT_UNFOLDED_LEVEL = 2;
export const SURFACE_CAMERA_DISTANCE = 2.9;
export const ATLAS_CAMERA_DISTANCE = 12.2;
export const ATLAS_PIN_GEOMETRY_RADIUS = 0.037;
export const SURFACE_PIN_SCALE = 0.12;
export const LIFTED_PIN_SCALE = 1;
export const ATLAS_PIN_SCALE_GAIN = 4.5;
export const SURFACE_RING_CENTER_OFFSET = 0.00025;

const clamp = (value, min, max) => Math.min(max, Math.max(min, value));
const smooth = value => {
  const t = clamp(value, 0, 1);
  return t * t * (3 - 2 * t);
};

export function clampAtlasLevel(value, fallback = SURFACE_LABEL_LEVEL) {
  const number = Number(value);
  return Number.isFinite(number) ? Math.round(clamp(number, ATLAS_LEVEL_MIN, ATLAS_LEVEL_MAX)) : fallback;
}

/** Map normalized wheel/slider zoom to camera distance without a timed transition. */
export function altitudeForZoom(value) {
  const zoom = clamp(Number(value) || 0, 0, 1);
  return SURFACE_CAMERA_DISTANCE * (ATLAS_CAMERA_DISTANCE / SURFACE_CAMERA_DISTANCE) ** zoom;
}

/** Inverse of altitudeForZoom; callers can scrub the camera and recover exact zoom. */
export function zoomForAltitude(value) {
  const altitude = clamp(Number(value) || SURFACE_CAMERA_DISTANCE, SURFACE_CAMERA_DISTANCE, ATLAS_CAMERA_DISTANCE);
  return Math.log(altitude / SURFACE_CAMERA_DISTANCE) / Math.log(ATLAS_CAMERA_DISTANCE / SURFACE_CAMERA_DISTANCE);
}

/** Continuous representation weights. The lift interval intentionally has no state snap. */
export function atlasZoomState(value) {
  const zoom = clamp(Number(value) || 0, 0, 1);
  const lift = smooth((zoom - 0.22) / (0.57 - 0.22));
  const atlas = smooth((zoom - 0.84) / (1 - 0.84));
  return {
    zoom,
    surface: 1 - lift,
    lift,
    orbit: lift * (1 - atlas),
    atlas,
    earthScale: 1 - 0.66 * lift,
    earthX: -1.9 * lift,
    cameraDistance: altitudeForZoom(zoom),
  };
}

/** Reduced-motion Lift uses two fixed spatial snapshots and fades through their midpoint. */
export function atlasPresentationState(value, reducedMotion = false) {
  const zoom = clamp(Number(value) || 0, 0, 1);
  if (!reducedMotion || zoom < 0.22 || zoom > 0.57) return { rawZoom: zoom, state: atlasZoomState(zoom), opacity: 1 };
  const progress = clamp((zoom - 0.22) / (0.57 - 0.22), 0, 1);
  const rawOpacity = progress <= 0.5 ? 1 - progress * 2 : (progress - 0.5) * 2;
  const opacity = rawOpacity < 1e-12 ? 0 : rawOpacity > 1 - 1e-12 ? 1 : rawOpacity;
  return {
    rawZoom: zoom,
    state: atlasZoomState(progress < 0.5 ? 0.22 : 0.57),
    opacity,
  };
}

export function stableWorldId(world) {
  const id = world?.id ?? world?.worldId ?? world?.eventId;
  return id == null || String(id).trim() === '' ? null : String(id);
}

/** Y rotation that places a geographic normal on the camera-facing +Z axis. */
export function surfaceFacingRotation(normal) {
  const x = Number(normal?.x), z = Number(normal?.z);
  if (!Number.isFinite(x) || !Number.isFinite(z) || Math.hypot(x, z) < 1e-8) return 0;
  return Math.atan2(-x, z);
}

/** Yaw and latitude tilt that place a geographic normal at camera-forward +Z. */
export function surfaceFacingOrientation(normal, yawOffset = 0, blend = 1) {
  const x = Number(normal?.x), y = Number(normal?.y), z = Number(normal?.z);
  if (![x, y, z].every(Number.isFinite) || Math.hypot(x, y, z) < 1e-8) return { yaw: 0, pitch: 0 };
  const amount = Math.min(1, Math.max(0, Number(blend) || 0));
  const yaw = (surfaceFacingRotation({ x, z }) + (Number(yawOffset) || 0)) * amount;
  const pitch = Math.atan2(y, Math.hypot(x, z)) * amount;
  return {
    yaw: yaw === 0 ? 0 : yaw,
    pitch: pitch === 0 ? 0 : pitch,
  };
}

/** Pure counterpart to the Atlas group's Y-yaw followed by X-pitch rotation. */
export function transformSurfaceNormal(normal, { yaw = 0, pitch = 0 } = {}) {
  const x = Number(normal?.x), y = Number(normal?.y), z = Number(normal?.z);
  if (![x, y, z].every(Number.isFinite)) return { x: 0, y: 0, z: 0 };
  const yawCos = Math.cos(yaw), yawSin = Math.sin(yaw);
  const xYaw = x * yawCos + z * yawSin;
  const zYaw = -x * yawSin + z * yawCos;
  const pitchCos = Math.cos(pitch), pitchSin = Math.sin(pitch);
  const yPitch = y * pitchCos - zYaw * pitchSin;
  const zPitch = y * pitchSin + zYaw * pitchCos;
  return { x: xYaw, y: yPitch, z: zPitch };
}

/** Local rotation that makes a child object's world rotation equal the requested orientation. */
export function localQuaternionForWorldFacing(parentQuaternion, desiredWorldQuaternion) {
  const normalizeQuaternion = value => {
    const x = Number(value?.x), y = Number(value?.y), z = Number(value?.z), w = Number(value?.w);
    const length = Math.hypot(x, y, z, w);
    return length > 1e-10 && Number.isFinite(length)
      ? { x: x / length, y: y / length, z: z / length, w: w / length }
      : { x: 0, y: 0, z: 0, w: 1 };
  };
  const parent = normalizeQuaternion(parentQuaternion);
  const desired = normalizeQuaternion(desiredWorldQuaternion);
  const inverse = { x: -parent.x, y: -parent.y, z: -parent.z, w: parent.w };
  return normalizeQuaternion({
    x: inverse.w * desired.x + inverse.x * desired.w + inverse.y * desired.z - inverse.z * desired.y,
    y: inverse.w * desired.y - inverse.x * desired.z + inverse.y * desired.w + inverse.z * desired.x,
    z: inverse.w * desired.z + inverse.x * desired.y - inverse.y * desired.x + inverse.z * desired.w,
    w: inverse.w * desired.w - inverse.x * desired.x - inverse.y * desired.y - inverse.z * desired.z,
  });
}

/** World-space radius that projects to a requested CSS-pixel diameter. */
export function worldRadiusForScreenPixels(distance, fovDegrees, viewportHeight, pixels = 44) {
  const d = Number(distance), fov = Number(fovDegrees), height = Number(viewportHeight), size = Number(pixels);
  if (![d, fov, height, size].every(Number.isFinite) || d <= 0 || height <= 0 || !(fov > 0 && fov < 180) || size <= 0) return 0;
  const visibleHeight = 2 * d * Math.tan(fov * Math.PI / 360);
  return visibleHeight * size / (2 * height);
}

/** Keep event pins as surface dots, then inflate them into mini-Earths only during Lift. */
export function surfacePinScale(lift) {
  const progress = clamp(Number(lift) || 0, 0, 1);
  return SURFACE_PIN_SCALE + (LIFTED_PIN_SCALE - SURFACE_PIN_SCALE) * progress;
}

/** Place a spherical marker so its lower pole touches the scaled Earth surface. */
export function surfacePinAnchorRadius(earthRadius, pinScale) {
  return Math.max(0, Number(earthRadius) || 0) + ATLAS_PIN_GEOMETRY_RADIUS * Math.max(0, Number(pinScale) || 0);
}

/** Preserve the previous Orbit-to-Atlas sphere growth curve. */
export function atlasPinScale(atlas) {
  return 1 + ATLAS_PIN_SCALE_GAIN * clamp(Number(atlas) || 0, 0, 1);
}

export function pinScaleAtPresentation(lift, atlas) {
  return surfacePinScale(lift) * atlasPinScale(atlas);
}

/** Shared rendered and hit-test center radius for the Surface ring and Lift spheres. */
export function pinAnchorRadiusAtPresentation(earthRadius, lift, atlas) {
  return Number(lift) <= 0 ? Math.max(0, Number(earthRadius) || 0) + SURFACE_RING_CENTER_OFFSET
    : surfacePinAnchorRadius(earthRadius, pinScaleAtPresentation(lift, atlas));
}

/** Whether a geodetic surface marker lies on the camera-facing hemisphere. */
export function isSurfaceNormalVisible(normal, towardCamera, horizonMargin = 0.02) {
  const vector = value => {
    const x = Number(value?.x), y = Number(value?.y), z = Number(value?.z);
    const length = Math.hypot(x, y, z);
    return length > 1e-10 && Number.isFinite(length) ? { x: x / length, y: y / length, z: z / length } : null;
  };
  const surface = vector(normal), view = vector(towardCamera);
  if (!surface || !view) return false;
  return surface.x * view.x + surface.y * view.y + surface.z * view.z > Number(horizonMargin || 0);
}

/** Clamp a projected label center so its entire pixel rectangle stays on the canvas. */
export function clampScreenRectCenter(center, bounds, width, height, padding = 0) {
  const left = Number(bounds?.left) || 0, top = Number(bounds?.top) || 0;
  const right = Number(bounds?.right), bottom = Number(bounds?.bottom);
  const safeRight = Number.isFinite(right) ? right : left + Math.max(0, Number(bounds?.width) || 0);
  const safeBottom = Number.isFinite(bottom) ? bottom : top + Math.max(0, Number(bounds?.height) || 0);
  const inset = Math.max(0, Number(padding) || 0);
  const halfWidth = Math.min(Math.max(0, Number(width) || 0) / 2, Math.max(0, safeRight - left - inset * 2) / 2);
  const halfHeight = Math.min(Math.max(0, Number(height) || 0) / 2, Math.max(0, safeBottom - top - inset * 2) / 2);
  return {
    x: clamp(Number(center?.x) || 0, left + inset + halfWidth, safeRight - inset - halfWidth),
    y: clamp(Number(center?.y) || 0, top + inset + halfHeight, safeBottom - inset - halfHeight),
  };
}

/** Camera distance that contains projected atlas bounds for the current host aspect ratio. */
export function fitCameraDistance(bounds, aspect, fovDegrees = 38, margin = 1.12) {
  const halfWidth = Math.max(Math.abs(Number(bounds?.left) || 0), Math.abs(Number(bounds?.right) || 0));
  const halfHeight = Math.max(Math.abs(Number(bounds?.top) || 0), Math.abs(Number(bounds?.bottom) || 0));
  const halfFov = Math.max(0.01, Number(fovDegrees) || 38) * Math.PI / 360;
  const safeAspect = Math.max(0.1, Number(aspect) || 1);
  return Math.max(1, margin * Math.max(halfHeight / Math.tan(halfFov), halfWidth / (Math.tan(halfFov) * safeAspect)));
}

/** Keep texture canvases within the requested GPU-safe maximum edge without upscaling. */
export function cappedTextureSize(width, height, maxEdge = 2048) {
  const w = Number(width), h = Number(height), cap = Number(maxEdge);
  if (![w, h, cap].every(Number.isFinite) || w <= 0 || h <= 0 || cap <= 0) return { width: 1, height: 1 };
  const scale = Math.min(1, cap / Math.max(w, h));
  return { width: Math.max(1, Math.round(w * scale)), height: Math.max(1, Math.round(h * scale)) };
}

/** Whole-Earth selection starts at Orbit; at Surface/Lift only world pins are targets. */
export function allowEarthBodySelection(zoom) {
  return Number(zoom) >= 0.57;
}

/** Pick the nearest projected neighbor in a keyboard direction. */
export function nearestDirectionalNeighbor(origin, candidates, key) {
  const horizontal = key === 'ArrowLeft' || key === 'ArrowRight';
  const direction = key === 'ArrowLeft' || key === 'ArrowUp' ? -1 : 1;
  const points = (Array.isArray(candidates) ? candidates : []).filter(point => point?.id != null && point.id !== origin?.id);
  const scored = points.map(point => {
    const dx = Number(point.x) - Number(origin?.x), dy = Number(point.y) - Number(origin?.y);
    const major = (horizontal ? dx : dy) * direction;
    const minor = horizontal ? dy : dx;
    return { point, major, score: major + Math.abs(minor) * 1.75 };
  });
  const ahead = scored.filter(item => item.major > Math.max(4, Math.abs(item.score - item.major) / 1.75 * 0.35))
    .sort((a, b) => a.score - b.score || String(a.point.id).localeCompare(String(b.point.id)));
  if (ahead.length) return ahead[0].point;
  const ordered = scored.sort((a, b) => String(a.point.id).localeCompare(String(b.point.id)));
  return ordered.length ? ordered[direction > 0 ? 0 : ordered.length - 1].point : null;
}

/** Stable spherical interpolation for unit vectors, including coincident and antipodal endpoints. */
export function slerpUnitVector(from, to, progress) {
  const normalize = value => {
    const x = Number(value?.x) || 0, y = Number(value?.y) || 0, z = Number(value?.z) || 0;
    const length = Math.hypot(x, y, z);
    return length > 1e-12 ? { x: x / length, y: y / length, z: z / length } : { x: 0, y: 0, z: 1 };
  };
  const a = normalize(from), b = normalize(to);
  const t = clamp(Number(progress) || 0, 0, 1);
  if (t === 0) return a;
  if (t === 1) return b;
  const dot = clamp(a.x * b.x + a.y * b.y + a.z * b.z, -1, 1);
  if (dot > 0.9995) return normalize({ x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t, z: a.z + (b.z - a.z) * t });
  if (dot < -0.9995) {
    const abs = { x: Math.abs(a.x), y: Math.abs(a.y), z: Math.abs(a.z) };
    const basis = abs.x <= abs.y && abs.x <= abs.z ? { x: 1, y: 0, z: 0 }
      : abs.y <= abs.z ? { x: 0, y: 1, z: 0 } : { x: 0, y: 0, z: 1 };
    const projection = a.x * basis.x + a.y * basis.y + a.z * basis.z;
    const perpendicular = normalize({ x: basis.x - projection * a.x, y: basis.y - projection * a.y, z: basis.z - projection * a.z });
    const angle = Math.PI * t;
    return normalize({ x: a.x * Math.cos(angle) + perpendicular.x * Math.sin(angle), y: a.y * Math.cos(angle) + perpendicular.y * Math.sin(angle), z: a.z * Math.cos(angle) + perpendicular.z * Math.sin(angle) });
  }
  const angle = Math.acos(dot), sinAngle = Math.sin(angle);
  const wa = Math.sin((1 - t) * angle) / sinAngle, wb = Math.sin(t * angle) / sinAngle;
  return normalize({ x: wa * a.x + wb * b.x, y: wa * a.y + wb * b.y, z: wa * a.z + wb * b.z });
}

function yearKey(world) {
  const value = Number(world?.year);
  return Number.isFinite(value) ? value : Number.POSITIVE_INFINITY;
}

function depthOf(id, byId, memo, visiting = new Set()) {
  if (memo.has(id)) return memo.get(id);
  const world = byId.get(id);
  if (!world || world.parentId == null) { memo.set(id, 0); return 0; }
  const parentId = String(world.parentId);
  if (!byId.has(parentId) || visiting.has(id)) { memo.set(id, 0); return 0; }
  const next = new Set(visiting); next.add(id);
  const value = depthOf(parentId, byId, memo, next) + 1;
  memo.set(id, value);
  return value;
}

/** Stable story coordinates: selected world stays left; its children unfold to the right. */
export function layoutAtlasWorlds(worlds = [], currentId = null) {
  const items = (Array.isArray(worlds) ? worlds : []).filter(world => stableWorldId(world));
  const byId = new Map(items.map(world => [stableWorldId(world), world]));
  const current = currentId == null ? null : String(currentId);
  const currentWorld = byId.get(current);
  const rootId = currentWorld?.parentId == null ? current : String(currentWorld.parentId);
  const depthMemo = new Map();
  const ordered = [...items].sort((a, b) => yearKey(a) - yearKey(b) || stableWorldId(a).localeCompare(stableWorldId(b)));
  const laneById = new Map();
  for (const world of ordered) {
    const id = stableWorldId(world);
    const parent = world.parentId == null ? null : String(world.parentId);
    const siblings = ordered.filter(candidate => (candidate.parentId == null ? null : String(candidate.parentId)) === parent);
    const lane = siblings.findIndex(candidate => stableWorldId(candidate) === id);
    laneById.set(id, lane - (siblings.length - 1) / 2);
  }
  return items.map(world => {
    const id = stableWorldId(world);
    const parentId = world.parentId == null ? null : String(world.parentId);
    const depth = depthOf(id, byId, depthMemo);
    const isCurrent = id === current;
    const isLineage = current != null && (id === rootId || depthOf(current, byId, depthMemo) >= depth && (() => {
      let cursor = current;
      while (cursor && cursor !== id) cursor = byId.get(cursor)?.parentId == null ? null : String(byId.get(cursor).parentId);
      return cursor === id;
    })());
    const isChild = parentId === current;
    const siblingOfCurrent = currentWorld && parentId === (currentWorld.parentId == null ? null : String(currentWorld.parentId)) && !isCurrent;
    const lon = Number(world.lon ?? world.geography?.lon ?? world.geog?.lon);
    const lat = Number(world.lat ?? world.geography?.lat ?? world.geog?.lat);
    const hasGeo = Number.isFinite(lon) && Number.isFinite(lat);
    const phi = (90 - (hasGeo ? lat : 0)) * Math.PI / 180;
    const theta = ((hasGeo ? lon : laneById.get(id) * 38) + 180) * Math.PI / 180;
    const globe = hasGeo
      ? { x: -Math.sin(phi) * Math.cos(theta), y: Math.cos(phi), z: Math.sin(phi) * Math.sin(theta) }
      : { x: Math.sin(theta), y: Math.sin(phi), z: Math.cos(theta) };
    const atlasX = isCurrent ? -1.9 : Math.max(0.55, Math.min(4.8, 0.72 + depth * 1.18));
    const atlasY = (laneById.get(id) || 0) * (isChild ? 0.72 : 0.43);
    const atlasZ = siblingOfCurrent ? -0.35 : (isChild ? 0.2 : 0);
    return {
      id, parentId, world, depth, lane: laneById.get(id) || 0,
      current: isCurrent, lineage: Boolean(isLineage), child: isChild,
      sibling: Boolean(siblingOfCurrent), globe, atlas: { x: atlasX, y: atlasY, z: atlasZ },
    };
  });
}

/** Stable local Orbit neighborhood: parent left, selected world centered, its children right. */
export function layoutOrbitNeighborhood(entries = [], currentId) {
  const current = entries.find(entry => entry.id === String(currentId ?? ''));
  if (!current) return new Map();
  const isRoot = current.parentId == null;
  const siblings = entries.filter(entry => entry.id !== current.id && (isRoot
    ? entry.parentId == null && String(entry.world?.questionId ?? '') === String(current.world?.questionId ?? '')
    : entry.parentId === current.parentId));
  const children = entries.filter(entry => entry.parentId === current.id).sort((a, b) => {
    const score = entry => Number(entry.world?.provenance?.reviewScore ?? entry.world?.reviewScore ?? entry.world?.score ?? 0);
    return score(b) - score(a) || a.id.localeCompare(b.id);
  });
  const positions = new Map([[current.id, { x: 0, y: 0, z: 0 }]]);
  if (current.parentId != null) positions.set(String(current.parentId), { x: -2.1, y: 0, z: 0 });
  else if (current.world?.questionId != null) {
    // Synthetic orbit key; the scene renders this as the active question anchored at present-day Earth.
    positions.set(`question:${String(current.world.questionId)}`, { x: -2.1, y: 0, z: 0, kind: 'question-parent', questionId: String(current.world.questionId) });
  }
  const spread = (items, x, spacing) => items.forEach((entry, index) => {
    positions.set(entry.id, { x, y: (index - (items.length - 1) / 2) * spacing, z: 0 });
  });
  spread(children, 2.05, 0.72);
  spread(siblings, -1.05, 0.68);
  return positions;
}

/** Keep labels bounded and deterministic; review score and current selection rank first. */
export function selectSurfaceLabels(worlds, level = SURFACE_LABEL_LEVEL, currentId = null) {
  const limit = clampAtlasLevel(level);
  const ranked = [...(Array.isArray(worlds) ? worlds : [])].filter(world => stableWorldId(world)).sort((a, b) => {
    const currentRank = Number(stableWorldId(b) === String(currentId)) - Number(stableWorldId(a) === String(currentId));
    const score = (Number(b.provenance?.reviewScore ?? b.reviewScore ?? b.score) || 0) - (Number(a.provenance?.reviewScore ?? a.reviewScore ?? a.score) || 0);
    return currentRank || score || yearKey(a) - yearKey(b) || stableWorldId(a).localeCompare(stableWorldId(b));
  });
  return ranked.slice(0, limit);
}

/** Current world, ranked direct children, optional arrived parent and explicit ghost ancestors. */
export function selectSurfaceWorldLabelIds(worlds, currentId, level = SURFACE_LABEL_LEVEL, arrivalFromId = null, ghostAncestorIds = []) {
  const items = (Array.isArray(worlds) ? worlds : []).filter(world => stableWorldId(world));
  const current = String(currentId ?? '');
  const currentWorld = items.find(world => stableWorldId(world) === current);
  const children = (currentWorld ? items.filter(world => String(world.parentId ?? '') === current) : []).sort((a, b) => {
    const aScore = Number(a.provenance?.reviewScore ?? a.reviewScore ?? a.score) || 0;
    const bScore = Number(b.provenance?.reviewScore ?? b.reviewScore ?? b.score) || 0;
    return bScore - aScore || yearKey(a) - yearKey(b) || stableWorldId(a).localeCompare(stableWorldId(b));
  });
  return new Set([
    ...(currentWorld ? [current] : []),
    ...(arrivalFromId && items.some(world => stableWorldId(world) === String(arrivalFromId)) ? [String(arrivalFromId)] : []),
    ...children.slice(0, clampAtlasLevel(level)).map(stableWorldId),
    ...(Array.isArray(ghostAncestorIds) ? ghostAncestorIds.map(String) : []),
  ]);
}

/** Level 2 opens two unresolved branches by default; higher levels expose more explicitly. */
export function orbitUnfoldLimit(level = ORBIT_UNFOLDED_LEVEL) {
  return clampAtlasLevel(level, ORBIT_UNFOLDED_LEVEL);
}

/** Offset a cluster around its centroid when hovered, retaining stable input order. */
export function hoverFan(points, radius = 0.34) {
  const items = Array.isArray(points) ? points : [];
  if (items.length < 2) return items.map(point => ({ ...point }));
  const cx = items.reduce((sum, point) => sum + Number(point.x || 0), 0) / items.length;
  const cy = items.reduce((sum, point) => sum + Number(point.y || 0), 0) / items.length;
  return items.map((point, index) => {
    const angle = -Math.PI / 2 + 2 * Math.PI * index / items.length;
    return { ...point, x: cx + Math.cos(angle) * radius, y: cy + Math.sin(angle) * radius };
  });
}

/** Measured FPS from real frame timestamps; no synthetic or target-rate samples. */
export function measuredFps(timestamps) {
  const valid = (Array.isArray(timestamps) ? timestamps : []).filter(Number.isFinite);
  if (valid.length < 2) return 0;
  const elapsed = valid.at(-1) - valid[0];
  return elapsed > 0 ? (valid.length - 1) * 1000 / elapsed : 0;
}

/** Keep FPS windows continuous: a level change starts a fresh timestamp window. */
export function appendContinuousFrame(previousFrames = [], previousLevel = '', level = '', timestamp, limit = 40) {
  const frames = previousLevel === level ? [...previousFrames] : [];
  if (Number.isFinite(Number(timestamp))) frames.push(Number(timestamp));
  const maxFrames = Math.max(2, Math.floor(Number(limit) || 40));
  if (frames.length > maxFrames) frames.splice(0, frames.length - maxFrames);
  return { level, frames };
}

/** Retain one record per world ID across zoom/layout changes. */
export function createWorldRegistry() {
  const records = new Map();
  return {
    reconcile(worlds) {
      const present = new Set();
      return (Array.isArray(worlds) ? worlds : []).flatMap(world => {
        const id = stableWorldId(world);
        if (!id) return [];
        present.add(id);
        let record = records.get(id);
        if (!record) { record = { id, world, object: null, label: null }; records.set(id, record); }
        record.world = world;
        return [record];
      });
    },
    prune(worlds) {
      const present = new Set((Array.isArray(worlds) ? worlds : []).map(stableWorldId).filter(Boolean));
      const removed = [];
      for (const [id, record] of records) if (!present.has(id)) { records.delete(id); removed.push(record); }
      return removed;
    },
    get(id) { return records.get(String(id)) || null; },
    clear() { records.clear(); },
  };
}
