import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { atlasZoomState, layoutAtlasWorlds, layoutOrbitNeighborhood } from '../web/atlasLayout.js';
import { buildAtlasTimeline } from '../web/atlas/p2Atlas.js';
import { ATLAS_REVEAL_END_ZOOM, ATLAS_REVEAL_START_ZOOM, planAtlasReveal, renderableAtlasRevealPlan } from '../web/atlas/revealPlanner.js';

const graph = JSON.parse(await readFile(new URL('./fixtures/atlas-reveal-saved-sundaland.json', import.meta.url), 'utf8'));

function inputs(currentId, graphData = graph, timelineEdits = {}) {
  const entries = layoutAtlasWorlds(graphData.worlds, currentId);
  const orbitPositions = layoutOrbitNeighborhood(entries, currentId);
  const timeline = { ...buildAtlasTimeline(graphData, currentId), ...timelineEdits };
  return { entries, orbitPositions, timeline };
}

function zoomForStage(stage) {
  const endAtlas = atlasZoomState(ATLAS_REVEAL_END_ZOOM).atlas;
  let low = ATLAS_REVEAL_START_ZOOM, high = ATLAS_REVEAL_END_ZOOM;
  for (let index = 0; index < 48; index++) {
    const middle = (low + high) / 2;
    if (atlasZoomState(middle).atlas / endAtlas < stage) low = middle;
    else high = middle;
  }
  return (low + high) / 2;
}

function signature(plan) {
  return JSON.stringify({ phase: plan.phase, ids: plan.visibleIds, labels: plan.labelIds, hits: plan.hitIds,
    positions: [...plan.positions], opacity: [...plan.opacity],
    routes: plan.activeRoutes.map(route => [route.id, route.alpha, route.points]) });
}

test('saved Sundaland reveal stays parent-first, connected, reversible, and keeps selection hittable', () => {
  const currentId = 'sunda-root', context = inputs(currentId);
  const stages = [0, 0.06, 0.119, 0.1201, 0.22, 0.3199, 0.3201, 0.3799, 0.3801, 0.55, 0.78, 1];
  const plans = stages.map(stage => planAtlasReveal({ ...context, currentId, zoom: zoomForStage(stage) }));
  assert.deepEqual(plans.map(plan => plan.phase), [
    'orbit-star', 'orbit-star', 'orbit-star', 'move-question-anchor', 'move-question-anchor',
    'move-question-anchor', 'route-morph', 'route-morph', 'atlas-prefix', 'atlas-prefix', 'atlas-prefix', 'atlas-prefix',
  ]);
  for (const plan of plans) {
    assert.equal(plan.connectivity.status, 'connected');
    assert.equal(renderableAtlasRevealPlan(plan), plan, 'connected reveal takes over the legacy renderer');
    assert.equal(plan.selectedVisible, true);
    assert.ok(plan.visibleIds.includes(currentId), `${plan.phase} omitted current world`);
    assert.ok(plan.hitIds.includes(currentId), `${plan.phase} made current world unhittable`);
    for (const route of plan.activeRoutes) {
      assert.ok(plan.positions.has(route.parentId), `${route.id} has no visible parent`);
      assert.ok(plan.positions.has(route.childId), `${route.id} has no visible child`);
      assert.ok(route.points.length >= 2);
    }
    for (const id of plan.order) {
      const entry = context.entries.find(candidate => candidate.id === id);
      if (entry?.parentId == null || !plan.visibleIds.includes(id)) continue;
      assert.ok(plan.visibleIds.includes(String(entry.parentId)), `${id} appeared before parent ${entry.parentId}`);
    }
  }
  assert.equal(plans.at(-1).visibleIds.filter(id => !id.startsWith('\u0000')).length,
    graph.worlds.filter(world => world.questionId === 'q-sunda').length);
  assert.equal(plans.at(-1).activeRoutes.find(route => route.childId === currentId && route.kind === 'question-root')?.color, 'lineage');
  const descending = [...stages].reverse().map(stage => planAtlasReveal({ ...context, currentId, zoom: zoomForStage(stage) }));
  assert.deepEqual(descending.map(signature), plans.slice().reverse().map(signature));
});

test('folded questions remain represented by their chip and stem without entering the reveal order', () => {
  const currentId = 'sunda-kuching', context = inputs(currentId);
  assert.ok(context.timeline.foldedIds.includes('folded-sahara'));
  assert.ok(context.timeline.foldedIds.includes('folded-river'));
  const plan = planAtlasReveal({ ...context, currentId, zoom: ATLAS_REVEAL_END_ZOOM });
  assert.deepEqual(plan.foldedQuestionIds, ['q-folded']);
  assert.ok(plan.questionStems.some(path => path.questionId === 'q-folded' && path.foldedChip));
  assert.ok(!plan.order.includes('folded-sahara'));
  assert.ok(!plan.visibleIds.includes('folded-river'));
  assert.ok(plan.hitIds.includes(currentId));
  assert.equal(plan.connectivity.status, 'connected');
});

test('missing parent returns an explicit unresolved state and does not invent a connector', () => {
  const brokenGraph = { questions: [{ id: 'q', question: 'Question', divergenceYear: 1800 }],
    worlds: [{ id: 'selected', parentId: 'missing-parent', questionId: 'q', year: 1900 }] };
  const currentId = 'selected', context = inputs(currentId, brokenGraph);
  const plan = planAtlasReveal({ ...context, currentId, zoom: ATLAS_REVEAL_END_ZOOM });
  assert.equal(plan.phase, 'unresolved');
  assert.equal(plan.selectedVisible, true);
  assert.equal(plan.connectivity.status, 'unresolved-parent');
  assert.equal(plan.connectivity.connected, false);
  assert.equal(plan.connectivity.missingParentId, 'missing-parent');
  assert.equal(plan.connectivity.missingAnchorId, null);
  assert.deepEqual(plan.visibleIds, [currentId]);
  assert.deepEqual(plan.activeRoutes, []);
  assert.ok(plan.hitIds.includes(currentId));
});

test('missing question anchor is reported while retaining the active selection', () => {
  const currentId = 'sunda-root', context = inputs(currentId, graph, { questionRootPaths: [] });
  const plan = planAtlasReveal({ ...context, currentId, zoom: ATLAS_REVEAL_END_ZOOM });
  assert.equal(plan.connectivity.status, 'unresolved-anchor');
  assert.equal(plan.connectivity.connected, false);
  assert.equal(plan.connectivity.missingAnchorId, '\u0000question-root:q-sunda');
  assert.deepEqual(plan.activeRoutes, []);
  assert.ok(plan.hitIds.includes(currentId));
});

test('missing Orbit parent anchor is explicit instead of dropping the selected edge', () => {
  const currentId = 'sunda-kuching', context = inputs(currentId);
  const orbitPositions = new Map(context.orbitPositions);
  orbitPositions.delete('sunda-root');
  const plan = planAtlasReveal({ ...context, orbitPositions, currentId, zoom: 0.87 });
  assert.equal(plan.phase, 'unresolved');
  assert.equal(plan.selectedVisible, true);
  assert.equal(plan.connectivity.status, 'unresolved-anchor');
  assert.equal(plan.selectedVisible, true);
  assert.equal(plan.connectivity.missingAnchorId, 'orbit:sunda-root');
  assert.deepEqual(plan.activeRoutes, []);
  assert.ok(plan.hitIds.includes(currentId));
  assert.equal(renderableAtlasRevealPlan(plan), null,
    'a missing Orbit anchor keeps the candidate diagnostic but leaves continuous positions and legacy event paths to the scene');
});

test('unresolved Atlas coordinates keep the selected world at its Orbit coordinate', () => {
  const currentId = 'sunda-root', context = inputs(currentId);
  const positions = new Map(context.timeline.positions);
  positions.delete(currentId);
  const timeline = { ...context.timeline, positions };
  const plan = planAtlasReveal({ ...context, timeline, currentId, zoom: ATLAS_REVEAL_END_ZOOM });
  assert.equal(plan.phase, 'unresolved');
  assert.equal(plan.selectedVisible, true);
  assert.equal(plan.connectivity.status, 'unresolved-anchor');
  assert.deepEqual(plan.positions.get(currentId), context.orbitPositions.get(currentId));
  assert.deepEqual(plan.activeRoutes, []);
  assert.ok(plan.hitIds.includes(currentId));
});

test('unanchored unrelated components are reported and excluded from the reveal', () => {
  const currentId = 'sunda-root';
  const context = inputs(currentId, graph, { questionRootPaths: buildAtlasTimeline(graph, currentId).questionRootPaths
    .filter(path => path.questionId !== 'q-folded') });
  // Make the unrelated question visible while removing its root connector.
  const expanded = buildAtlasTimeline(graph, currentId, 'history-distance', { expandedQuestionIds: ['q-folded'] });
  const timeline = { ...expanded, questionRootPaths: expanded.questionRootPaths.filter(path => path.questionId !== 'q-folded') };
  const plan = planAtlasReveal({ ...context, timeline, currentId, zoom: ATLAS_REVEAL_END_ZOOM });
  assert.equal(plan.connectivity.status, 'connected');
  assert.ok(plan.connectivity.unresolvedComponents.some(issue => issue.status === 'unresolved-anchor' && issue.rootId === 'folded-sahara'));
  assert.ok(!plan.visibleIds.includes('folded-sahara'));
  assert.ok(!plan.order.includes('folded-river'));
  assert.ok(plan.hitIds.includes(currentId));
});
