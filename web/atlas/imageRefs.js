import { stableWorldId } from '../atlasLayout.js';

function identity(world) {
  const runId = String(world?.provenance?.sourceRunId ?? '');
  const branchId = String(world?.provenance?.sourceBranchId ?? '');
  const worldId = stableWorldId(world);
  if (!runId || !branchId || (worldId !== `${runId}:${branchId}` && worldId !== `${runId}::${branchId}`)) return null;
  return { runId, branchId };
}

function sameOriginPath(value, origin, pattern) {
  if (typeof value !== 'string' || !value || value.includes('\\') || value.includes('%')) return null;
  let url;
  try { url = new URL(value, origin); } catch { return null; }
  if (url.origin !== origin || url.search || url.hash || !pattern.test(url.pathname)) return null;
  return url.pathname;
}

/** Resolve only app-served, same-origin scene art with world and provenance identity intact. */
export function defaultWorldImageUrl(world, { selected = false, origin = globalThis.location?.origin || 'http://atlas.local' } = {}) {
  const ids = identity(world);
  if (!ids) return null;
  const sceneRef = world.sceneRef;
  const sceneValue = typeof sceneRef === 'string' ? sceneRef : sceneRef?.url;
  if (sceneRef?.status !== 'unavailable') {
    const sceneIdMatches = (!sceneRef?.runId || String(sceneRef.runId) === ids.runId)
      && (!sceneRef?.branchId || String(sceneRef.branchId) === ids.branchId);
    if (sceneIdMatches) {
      const scenePath = sameOriginPath(sceneValue, origin, /^\/event-scenes\/[a-f\d]{64}\.png$/i);
      if (scenePath) return scenePath;
    }
  }
  if (!selected) return null;
  const heroRef = world.heroRef;
  if (heroRef?.status !== 'complete') return null;
  if (heroRef.runId && String(heroRef.runId) !== ids.runId) return null;
  if (heroRef.branchId && String(heroRef.branchId) !== ids.branchId) return null;
  const expectedFixturePaths = [`candidate/live/${ids.runId}/hero.png`, `candidate/runs/${ids.runId}/hero.png`];
  if (heroRef.path && !expectedFixturePaths.includes(heroRef.path)) return null;
  const heroUrl = heroRef.url || `/runs/${encodeURIComponent(ids.runId)}/hero.png`;
  return sameOriginPath(heroUrl, origin, /^\/runs\/[^/]+\/hero\.png$/);
}
