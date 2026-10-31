export const THREAD_TRAVEL_MS = 1500;
export const DIRECT_TRAVEL_MS = 400;
export const GHOST_TRAIL_DEFAULT = false;

export function smoothTravelProgress(progress) {
  const t = Math.max(0, Math.min(1, Number(progress) || 0));
  return t * t * (3 - 2 * t);
}

export function interpolateTravelPoint(from = {}, to = {}, progress = 0) {
  const t = Math.max(0, Math.min(1, Number(progress) || 0));
  return {
    x: (Number(from.x) || 0) + ((Number(to.x) || 0) - (Number(from.x) || 0)) * t,
    y: (Number(from.y) || 0) + ((Number(to.y) || 0) - (Number(from.y) || 0)) * t,
    z: (Number(from.z) || 0) + ((Number(to.z) || 0) - (Number(from.z) || 0)) * t,
  };
}

export function interpolateTravelZoom(from = 0, to = 0, progress = 0) {
  const t = Math.max(0, Math.min(1, Number(progress) || 0));
  return Number(from) + (Number(to) - Number(from)) * t;
}

/** Lift above the branch path, then descend to the requested arrival zoom. */
export function travelZoomAt(from = 0, to = 0, progress = 0, peak = 0.68, mode = 'threads') {
  const t = Math.max(0, Math.min(1, Number(progress) || 0));
  if (mode === 'cut') return t < 0.5 ? Number(from) : Number(to);
  const apex = Math.max(Number(from) || 0, Number(to) || 0, Number(peak) || 0);
  if (t <= 0.5) return interpolateTravelZoom(from, apex, smoothTravelProgress(t * 2));
  return interpolateTravelZoom(apex, to, smoothTravelProgress((t - 0.5) * 2));
}

/** Fade-through phase for one-scene cut travel; camera/world state switches at opacity zero. */
export function cutTravelOpacity(progress = 0) {
  const t = Math.max(0, Math.min(1, Number(progress) || 0));
  return t <= 0.5 ? 1 - 2 * t : 2 * t - 1;
}

const idOf = world => world?.id == null ? null : String(world.id);

/** Persistent arrival marker from the selected world's saved parent, independent of navigation history. */
export function arrivalParentWorldId(world, worlds = []) {
  const parentId = world?.parentId == null ? null : String(world.parentId);
  if (!parentId) return null;
  return (Array.isArray(worlds) ? worlds : []).some(item => idOf(item) === parentId) ? parentId : null;
}

/** Return the route between worlds through their nearest shared ancestor. */
export function lineageTravelPath(worlds = [], fromId, toId) {
  const byId = new Map((Array.isArray(worlds) ? worlds : []).map(world => [idOf(world), world]).filter(([id]) => id));
  const from = String(fromId ?? ''), to = String(toId ?? '');
  if (!byId.has(from) || !byId.has(to)) return [];
  if (from === to) return [from];
  const ancestorChain = id => {
    const chain = [], seen = new Set();
    let cursor = id;
    while (cursor && byId.has(cursor) && !seen.has(cursor)) {
      chain.push(cursor); seen.add(cursor);
      const parent = byId.get(cursor)?.parentId;
      cursor = parent == null ? '' : String(parent);
    }
    return chain;
  };
  const fromChain = ancestorChain(from), toChain = ancestorChain(to);
  const toAncestors = new Set(toChain);
  const common = fromChain.find(id => toAncestors.has(id));
  if (!common) return [from, to];
  const toCommonIndex = toChain.indexOf(common);
  return [...fromChain.slice(0, fromChain.indexOf(common) + 1), ...toChain.slice(0, toCommonIndex).reverse()];
}

/** Select a path segment for a normalized travel progress value. */
export function sampleLineagePath(pathIds = [], progress = 0) {
  if (!pathIds.length) return null;
  if (pathIds.length === 1) return { fromId: pathIds[0], toId: pathIds[0], progress: 1 };
  const t = Math.max(0, Math.min(1, Number(progress) || 0));
  const scaled = t * (pathIds.length - 1);
  const segment = Math.min(pathIds.length - 2, Math.floor(scaled));
  return { fromId: pathIds[segment], toId: pathIds[segment + 1], progress: t === 1 ? 1 : scaled - segment };
}

export function travelDuration(mode = 'threads', reducedMotion = false) {
  return mode === 'threads' && !reducedMotion ? THREAD_TRAVEL_MS : DIRECT_TRAVEL_MS;
}

/** True only while an asynchronous graph update is echoing the active travel destination. */
export function preservesTravelSource(travelState, requestedCurrentId) {
  return Boolean(travelState && !travelState.cutSwitched
    && String(requestedCurrentId ?? '') === String(travelState.toId ?? '')
    && String(travelState.fromId ?? '') !== String(travelState.toId ?? ''));
}
