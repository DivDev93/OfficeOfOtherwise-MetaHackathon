import { atlasZoomState } from '../atlasLayout.js';
import { transformAtlasEdgeShape } from './p2Atlas.js';

export const ATLAS_REVEAL_START_ZOOM = 0.84;
export const ATLAS_REVEAL_END_ZOOM = 0.9;

/** Only connected plans may take over the legacy scene renderer. */
export function renderableAtlasRevealPlan(candidate) {
  return candidate?.phase !== 'unresolved' && candidate?.connectivity?.connected ? candidate : null;
}

const clamp01 = value => Math.max(0, Math.min(1, Number(value) || 0));
const smoothstep = value => { const t = clamp01(value); return t * t * (3 - 2 * t); };
const virtualQuestionRootId = questionId => `${String.fromCharCode(0)}question-root:${questionId}`;
const point = value => value && Number.isFinite(Number(value.x)) && Number.isFinite(Number(value.y))
  ? { x: Number(value.x), y: Number(value.y), z: Number(value.z) || 0 } : null;

function interpolatePoint(from, to, amount) {
  const t = clamp01(amount);
  return { x: from.x + (to.x - from.x) * t, y: from.y + (to.y - from.y) * t,
    z: (from.z || 0) + ((to.z || 0) - (from.z || 0)) * t };
}

function polarPoint(start, end, center, amount, minimumRadius = 0.46) {
  const ax = start.x - center.x, ay = start.y - center.y;
  const bx = end.x - center.x, by = end.y - center.y;
  const r0 = Math.hypot(ax, ay), r1 = Math.hypot(bx, by);
  const a0 = Math.atan2(ay, ax), a1 = Math.atan2(by, bx);
  const angleDelta = Math.atan2(Math.sin(a1 - a0), Math.cos(a1 - a0));
  const radius = Math.max(minimumRadius, r0 + (r1 - r0) * amount);
  const angle = a0 + angleDelta * amount;
  return { x: center.x + Math.cos(angle) * radius, y: center.y + Math.sin(angle) * radius, z: 0 };
}

function treeOrder(entries, currentId) {
  const byId = new Map(entries.map(entry => [entry.id, entry]));
  const parent = new Map(entries.map(entry => [entry.id, entry.parentId == null ? null : String(entry.parentId)]));
  const children = new Map(entries.map(entry => [entry.id, []]));
  for (const entry of entries) {
    const parentId = parent.get(entry.id);
    if (parentId && children.has(parentId)) children.get(parentId).push(entry.id);
  }
  for (const ids of children.values()) ids.sort();

  const lineage = [], lineageSet = new Set();
  let cursor = String(currentId), cycle = false, missingParentId = null;
  while (cursor && byId.has(cursor)) {
    if (lineageSet.has(cursor)) { cycle = true; break; }
    lineageSet.add(cursor); lineage.push(cursor);
    const next = parent.get(cursor);
    if (next && !byId.has(next)) { missingParentId = next; break; }
    cursor = next;
  }
  lineage.reverse();

  const order = [...lineage], seen = new Set(order);
  const expand = seeds => {
    const queue = [...seeds];
    for (let index = 0; index < queue.length; index++) {
      const id = queue[index];
      const neighbors = [...(parent.get(id) ? [parent.get(id)] : []), ...(children.get(id) || [])]
        .filter(next => byId.has(next) && !seen.has(next)).sort();
      for (const next of neighbors) { seen.add(next); order.push(next); queue.push(next); }
    }
  };
  expand([...lineage].reverse());
  for (const entry of entries) {
    if (seen.has(entry.id)) continue;
    const chain = [], chainSeen = new Set();
    let id = entry.id;
    while (id && byId.has(id) && !seen.has(id) && !chainSeen.has(id)) {
      chainSeen.add(id); chain.push(id); id = parent.get(id);
    }
    chain.reverse();
    const additions = chain.filter(member => !seen.has(member));
    for (const member of additions) { seen.add(member); order.push(member); }
    expand(additions);
  }
  return { order, lineage, parent, children, cycle, missingParentId };
}

function routePoints(from, to, routeShape) {
  if (!from || !to || !Array.isArray(routeShape) || routeShape.length < 2) return [];
  return transformAtlasEdgeShape(from, to, routeShape).map(point);
}

function offsetPoint(value, delta) {
  return { x: value.x + delta.x, y: value.y + delta.y, z: Number(value.z) || 0 };
}

function targetRoutes(timeline, visibleWorldIds, offset) {
  const routes = [];
  for (const path of timeline.parentChildPaths || []) {
    if (!visibleWorldIds.has(path.parentId) || !visibleWorldIds.has(path.childId)) continue;
    const from = timeline.positions.get(path.parentId), to = timeline.positions.get(path.childId);
    const points = routePoints(from, to, path.routeShape);
    if (points.length) routes.push({ id: `${path.parentId}>${path.childId}`, parentId: path.parentId,
      childId: path.childId, kind: 'parent-child', alpha: 1, points: points.map(value => offsetPoint(value, offset)) });
  }
  for (const path of timeline.questionRootPaths || []) {
    if (!visibleWorldIds.has(path.worldId)) continue;
    const questionRootId = virtualQuestionRootId(path.questionId);
    if (!(timeline.questionBranches || []).some(branch => String(branch.questionId) === String(path.questionId))) continue;
    const points = routePoints(path.from, timeline.positions.get(path.worldId), path.routeShape);
    if (points.length) routes.push({ id: `${questionRootId}>${path.worldId}`, parentId: questionRootId,
      childId: path.worldId, kind: 'question-root', color: path.color || 'proposed', alpha: 1,
      points: points.map(value => offsetPoint(value, offset)) });
  }
  return routes;
}

function componentDiagnostics(entries, timeline) {
  const byId = new Map(entries.map(entry => [entry.id, entry]));
  const rootById = new Map(), unresolvedById = new Map();
  for (const entry of entries) {
    if (rootById.has(entry.id) || unresolvedById.has(entry.id)) continue;
    const chain = [], seen = new Set();
    let cursor = entry.id, issue = null, rootId = null;
    while (cursor && byId.has(cursor)) {
      if (seen.has(cursor)) { issue = { status: 'cycle', rootId: cursor }; break; }
      seen.add(cursor); chain.push(cursor);
      const parentId = byId.get(cursor).parentId == null ? null : String(byId.get(cursor).parentId);
      if (!parentId) { rootId = cursor; break; }
      if (!byId.has(parentId)) { issue = { status: 'unresolved-parent', rootId: cursor, missingParentId: parentId }; break; }
      cursor = parentId;
    }
    if (!issue && rootId) {
      const root = byId.get(rootId), questionId = String(root.world?.questionId ?? '');
      const anchorId = virtualQuestionRootId(questionId);
      const hasBranch = (timeline.questionBranches || []).some(branch => String(branch.questionId) === questionId);
      const hasConnection = (timeline.questionRootPaths || []).some(path => path.worldId === rootId
        && String(path.questionId) === questionId);
      if (!questionId || !hasBranch || !hasConnection || !point(timeline.positions.get(rootId))) {
        issue = { status: 'unresolved-anchor', rootId, missingAnchorId: anchorId };
      }
    }
    if (issue) for (const id of chain) unresolvedById.set(id, issue);
    else for (const id of chain) rootById.set(id, rootId);
  }
  const unresolvedComponents = [...new Map([...unresolvedById.values()]
    .map(issue => [issue.rootId, issue])).values()].sort((a, b) => String(a.rootId).localeCompare(String(b.rootId)));
  return { eligibleIds: new Set(rootById.keys()), unresolvedById, unresolvedComponents };
}

function connectivityFor({ currentId, entries, timeline, tree, diagnostics }) {
  const byId = new Map(entries.map(entry => [entry.id, entry]));
  const current = byId.get(currentId);
  const unresolvedComponents = diagnostics.unresolvedComponents;
  if (tree.cycle) return { status: 'cycle', connected: false, missingParentId: null, missingAnchorId: null, unresolvedComponents };
  if (!current) return { status: 'missing-current', connected: false, missingParentId: currentId, missingAnchorId: null };
  if (tree.missingParentId) return { status: 'unresolved-parent', connected: false,
    missingParentId: tree.missingParentId, missingAnchorId: null, unresolvedComponents };
  const currentIssue = diagnostics.unresolvedById.get(currentId);
  if (currentIssue) return { status: currentIssue.status, connected: false,
    missingParentId: currentIssue.missingParentId ?? null, missingAnchorId: currentIssue.missingAnchorId ?? null,
    unresolvedComponents };
  const root = entries.find(entry => entry.id === tree.lineage[0]);
  if (!root) return { status: 'unresolved-parent', connected: false,
    missingParentId: current.parentId == null ? null : String(current.parentId), missingAnchorId: null, unresolvedComponents };
  for (let index = 1; index < tree.lineage.length; index++) {
    const parentId = tree.lineage[index - 1], childId = tree.lineage[index];
    if (!timeline.parentChildPaths?.some(path => path.parentId === parentId && path.childId === childId)) {
      return { status: 'unresolved-parent', connected: false, missingParentId: parentId, missingAnchorId: null, unresolvedComponents };
    }
  }
  const questionId = String(root.world?.questionId ?? '');
  const anchorId = virtualQuestionRootId(questionId);
  const hasBranch = (timeline.questionBranches || []).some(branch => String(branch.questionId) === questionId);
  const hasConnection = (timeline.questionRootPaths || []).some(path => path.worldId === root.id && String(path.questionId) === questionId);
  if (!questionId || !hasBranch || !hasConnection || !point(timeline.positions.get(root.id))) {
    return { status: 'unresolved-anchor', connected: false, missingParentId: null,
      missingAnchorId: anchorId, unresolvedComponents };
  }
  return { status: 'connected', connected: true, missingParentId: null, missingAnchorId: null,
    anchorId, rootId: root.id, unresolvedComponents };
}

function blockedPlan({ zoom, stage, currentId, connectivity, timeline, orbitPositions }) {
  const currentPosition = point(timeline.positions.get(currentId)) || point(orbitPositions?.get(currentId));
  const positions = new Map(currentPosition ? [[currentId, currentPosition]] : []);
  return { zoom, stage, phase: 'unresolved', currentId, selectedVisible: Boolean(currentPosition), connectivity,
    order: [currentId], lineage: [],
    visibleIds: currentPosition ? [currentId] : [], positions, opacity: new Map(currentPosition ? [[currentId, 1]] : []),
    activeRoutes: [], labelIds: currentPosition ? [currentId] : [], hitIds: currentPosition ? [currentId] : [],
    foldedQuestionIds: (timeline.chips || []).map(chip => String(chip.questionId)),
    questionStems: timeline.questionStemPaths || [] };
}

/**
 * Plan a deterministic, reversible Orbit-to-Atlas reveal. This function describes
 * geometry and IDs only; renderers must apply its visibility/opacity and interaction
 * IDs together. Missing lineage edges or question anchors return an explicit
 * unresolved state that retains the selected world when its Atlas coordinate exists,
 * without inventing a link. `selectedVisible` reports when even that is impossible.
 */
export function planAtlasReveal({ timeline, entries, orbitPositions, currentId, zoom }) {
  const current = currentId == null ? '' : String(currentId);
  const normalizedZoom = Math.max(0, Math.min(1, Number(zoom) || 0));
  const endAtlas = atlasZoomState(ATLAS_REVEAL_END_ZOOM).atlas;
  const stage = clamp01(atlasZoomState(normalizedZoom).atlas / endAtlas);
  if (!timeline?.positions || !(timeline.positions instanceof Map)) throw new TypeError('timeline.positions must be a Map');
  if (!Array.isArray(entries) || !Array.isArray(timeline.questionBranches)) throw new TypeError('timeline and entries are required');

  const foldedIds = new Set((timeline.foldedIds || []).map(String));
  const orbit = orbitPositions instanceof Map ? orbitPositions : new Map();
  const nonFoldedEntries = entries.filter(entry => !foldedIds.has(String(entry.id)))
    .map(entry => ({ ...entry, id: String(entry.id), parentId: entry.parentId == null ? null : String(entry.parentId) }));
  const diagnostics = componentDiagnostics(nonFoldedEntries, timeline);
  const visibleEntries = nonFoldedEntries.filter(entry => diagnostics.eligibleIds.has(entry.id));
  const entryById = new Map(visibleEntries.map(entry => [String(entry.id), entry]));
  const currentEntry = entryById.get(current);
  const tree = treeOrder(visibleEntries, current);
  const connectivity = connectivityFor({ currentId: current, entries: nonFoldedEntries, timeline, tree, diagnostics });
  if (!connectivity.connected) return blockedPlan({ zoom: normalizedZoom, stage, currentId: current, connectivity, timeline, orbitPositions:orbit });

  const currentOrbit = point(orbit.get(current));
  const currentAtlas = point(timeline.positions.get(current));
  if (!currentEntry || !currentOrbit || !currentAtlas) return blockedPlan({ zoom: normalizedZoom, stage, currentId: current,
    connectivity: { status: 'unresolved-anchor', connected: false, missingParentId: null, missingAnchorId: `world:${current}` }, timeline, orbitPositions:orbit });

  const parentId = currentEntry.parentId == null ? null : String(currentEntry.parentId);
  const questionId = String(currentEntry.world?.questionId ?? '');
  const questionAnchorId = virtualQuestionRootId(questionId);
  const requiredOrbitAnchor = parentId == null ? `question:${questionId}` : parentId;
  if (!point(orbit.get(requiredOrbitAnchor))) return blockedPlan({ zoom: normalizedZoom, stage, currentId: current,
    connectivity: { ...connectivity, status: 'unresolved-anchor', connected: false,
      missingAnchorId: `orbit:${requiredOrbitAnchor}` }, timeline, orbitPositions:orbit });
  const delta = { x: currentOrbit.x - currentAtlas.x, y: currentOrbit.y - currentAtlas.y };
  const siblings = parentId == null
    ? visibleEntries.filter(entry => entry.id !== current && entry.parentId == null && String(entry.world?.questionId ?? '') === questionId)
    : visibleEntries.filter(entry => entry.id !== current && String(entry.parentId ?? '') === parentId);
  const sourceIds = new Set([current, ...(parentId ? [parentId] : []),
    ...visibleEntries.filter(entry => String(entry.parentId ?? '') === current).map(entry => String(entry.id)),
    ...siblings.map(entry => String(entry.id))]);
  const sourceRoutes = [];
  for (const child of visibleEntries) {
    if (child.parentId == null) continue;
    const childId = String(child.id), sourceParentId = String(child.parentId);
    const included = childId === current || (sourceParentId === current && sourceIds.has(childId))
      || (parentId != null && sourceParentId === parentId && sourceIds.has(childId));
    if (!included) continue;
    const from = point(orbit.get(sourceParentId)), to = point(orbit.get(childId));
    if (from && to) sourceRoutes.push({ id: `${sourceParentId}>${childId}`, parentId: sourceParentId, childId,
      kind: 'parent-child', alpha: 1, points: [from, to] });
  }
  if (parentId == null) {
    const questionOrbit = point(orbit.get(`question:${questionId}`));
    if (questionOrbit) for (const root of visibleEntries.filter(entry => entry.parentId == null
      && String(entry.world?.questionId ?? '') === questionId)) {
      const rootOrbit = point(orbit.get(String(root.id)));
      const connection = timeline.questionRootPaths?.find(path => path.worldId === String(root.id));
      if (rootOrbit) sourceRoutes.push({ id: `${questionAnchorId}>${root.id}`, parentId: questionAnchorId,
        childId: String(root.id), kind: 'question-root', color: connection?.color || 'proposed', alpha: 1,
        points: [questionOrbit, rootOrbit] });
    }
  }

  const visibleIds = [], positions = new Map(), opacity = new Map(), activeRoutes = [];
  let phase, prefix = 0;
  const addId = (id, position, alpha = 1) => {
    if (!position) return;
    if (!positions.has(id)) visibleIds.push(id);
    positions.set(id, point(position)); opacity.set(id, clamp01(alpha));
  };

  if (stage < 0.12) {
    phase = 'orbit-star';
    const fade = smoothstep(stage / 0.12);
    for (const id of sourceIds) addId(id, orbit.get(id), id === current || id === parentId ? 1 : 1 - fade);
    if (parentId == null) {
      const questionOrbit = orbit.get(`question:${questionId}`);
      if (questionOrbit) addId(questionAnchorId, questionOrbit);
    }
    for (const route of sourceRoutes) {
      const isSelectedRoute = route.childId === current;
      const alpha = isSelectedRoute ? 1 : 1 - fade;
      if (alpha > 0.01) activeRoutes.push({ ...route, alpha });
    }
  } else if (stage < 0.32) {
    phase = parentId == null ? 'move-question-anchor' : 'move-parent';
    const move = smoothstep((stage - 0.12) / 0.20);
    const currentPosition = currentOrbit;
    addId(current, currentPosition);
    let movingId, start, end;
    if (parentId != null) {
      movingId = parentId;
      start = point(orbit.get(parentId));
      const parentAtlas = point(timeline.positions.get(parentId));
      end = parentAtlas && offsetPoint(parentAtlas, delta);
      if (start && end) addId(parentId, polarPoint(start, end, currentPosition, move));
    } else {
      movingId = questionAnchorId;
      start = point(orbit.get(`question:${questionId}`));
      const branch = timeline.questionBranches.find(item => String(item.questionId) === questionId);
      end = branch ? offsetPoint({ x: branch.x, y: branch.y, z: 0 }, delta) : null;
      if (start && end) addId(questionAnchorId, interpolatePoint(start, end, move));
    }
    const from = positions.get(movingId), to = positions.get(current);
    if (from && to) activeRoutes.push({ id: `${movingId}>${current}`, parentId: movingId,
      childId: current, kind: parentId == null ? 'question-root' : 'parent-child', alpha: 1, points: [from, to] });
  } else {
    phase = stage < 0.38 ? 'route-morph' : 'atlas-prefix';
    const routeMorph = smoothstep((stage - 0.32) / 0.06);
    const translation = smoothstep((stage - 0.38) / 0.62);
    const offset = { x: delta.x * (1 - translation), y: delta.y * (1 - translation) };
    const rawCount = tree.lineage.length + translation * (tree.order.length - tree.lineage.length);
    prefix = Math.min(tree.order.length, Math.floor(rawCount + 1e-9));
    const fraction = prefix >= tree.order.length ? 0 : clamp01(rawCount - prefix);
    const nextId = fraction > 0 ? tree.order[prefix] : null;
    const activeCount = Math.min(tree.order.length, prefix + (nextId ? 1 : 0));
    const activeWorldIds = new Set(tree.order.slice(0, activeCount));
    for (const id of activeWorldIds) {
      const target = point(timeline.positions.get(id));
      if (!target) continue;
      const alpha = id === nextId ? fraction : (stage < 0.38 && !tree.lineage.includes(id) ? routeMorph : 1);
      addId(id, offsetPoint(target, offset), alpha);
    }
    const visibleQuestions = new Set([...activeWorldIds].map(id => {
      const entry = entryById.get(id);
      return entry?.parentId == null ? String(entry.world?.questionId ?? '') : '';
    }).filter(Boolean));
    for (const id of visibleQuestions) {
      const branch = timeline.questionBranches.find(item => String(item.questionId) === id);
      if (!branch) continue;
      const rootId = virtualQuestionRootId(id);
      const questionAlpha = id === String(entryById.get(nextId)?.world?.questionId ?? '')
        && nextId && entryById.get(nextId)?.parentId == null ? fraction : 1;
      addId(rootId, offsetPoint({ x: branch.x, y: branch.y, z: 0 }, offset), questionAlpha);
    }
    const routes = targetRoutes(timeline, activeWorldIds, offset);
    for (const route of routes) {
      const alpha = route.childId === nextId ? fraction
        : (stage < 0.38 && route.childId !== current ? routeMorph : 1);
      if (alpha > 0.01) activeRoutes.push({ ...route, alpha });
    }
    if (stage < 0.38) {
      const selectedRoute = activeRoutes.find(route => route.childId === current);
      const sourceFrom = parentId
        ? point(timeline.positions.get(parentId)) && offsetPoint(timeline.positions.get(parentId), delta)
        : positions.get(questionAnchorId);
      const sourceTo = positions.get(current);
      if (selectedRoute && sourceFrom && sourceTo) {
        const target = selectedRoute.points;
        const segments = Math.max(target.length - 1, 1);
        const start = sourceFrom, end = sourceTo;
        selectedRoute.points = target.map((pointValue, index) => {
          const t = index / segments;
          const source = interpolatePoint(start, end, t);
          return interpolatePoint(source, pointValue, routeMorph);
        });
        selectedRoute.points[0] = start;
        selectedRoute.points[selectedRoute.points.length - 1] = end;
      }
    }
  }

  // Never let the planner silently remove the current selection, even if malformed
  // caller geometry omitted it from the progressive prefix.
  if (!positions.has(current) && currentOrbit) addId(current, currentOrbit);
  const labels = visibleIds.filter(id => (opacity.get(id) ?? 1) > 0.2);
  const questionRootPrefix = `${String.fromCharCode(0)}question-root:`;
  const hitIds = visibleIds.filter(id => !id.startsWith(questionRootPrefix) && (opacity.get(id) ?? 1) > 0.45);
  if (!hitIds.includes(current) && positions.has(current)) hitIds.push(current);
  return { zoom: normalizedZoom, stage, phase, currentId: current, selectedVisible: true, connectivity, order: tree.order,
    lineage: tree.lineage, prefix, visibleIds, positions, opacity, activeRoutes,
    labelIds: labels, hitIds, foldedQuestionIds: (timeline.chips || []).map(chip => String(chip.questionId)),
    questionStems: timeline.questionStemPaths || [] };
}
