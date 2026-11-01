import test from 'node:test';
import assert from 'node:assert/strict';
import { clusterOpacityAtPresentation, orbitClusteredIdsForPresentation, planWorldClusters } from '../web/atlas/clusters.js';

function graph() {
  const parent = { id: 'run::parent', questionId: 'question-1', lat: 0, lon: 0 };
  const children = [
    { id: 'run::best', parentId: parent.id, questionId: parent.questionId, score: 10, lat: 1, lon: 179, mapState: 'saved-unexplored' },
    { id: 'run::second', parentId: parent.id, questionId: parent.questionId, score: 9, lat: 2, lon: -179, mapState: 'saved-unexplored' },
    { id: 'run::third', parentId: parent.id, questionId: parent.questionId, score: 8, lat: 4, lon: 178, mapState: 'saved-unexplored' },
    { id: 'run::fourth', parentId: parent.id, questionId: parent.questionId, score: 7, lat: 5, lon: -178, mapState: 'saved-unexplored' },
    { id: 'run::fifth', parentId: parent.id, questionId: parent.questionId, score: 6, lat: 6, lon: 177, mapState: 'saved-unexplored' },
    { id: 'run::explored', parentId: parent.id, questionId: parent.questionId, score: 0, lat: 0, lon: 179, mapState: 'explored' },
    ...[1, 2, 3].map(index => ({ id: `placeholder:${parent.id}:${index}`, parentId: parent.id, questionId: parent.questionId,
      role: 'generation-placeholder', isExpansionPlaceholder: true, selectable: false, mapState: 'generating', year: null })),
  ];
  return { parent, children, worlds: [parent, ...children] };
}

test('surface shows ranked pins and one centroid +N cluster; fan preserves exact member IDs', () => {
  const { parent, worlds } = graph();
  const plan = planWorldClusters(worlds, parent.id);
  assert.equal(plan.surface.visibleIds.length, 3);
  assert.deepEqual(plan.surface.visibleIds, ['run::best', 'run::second', 'run::third']);
  assert.deepEqual(plan.surface.clusters.map(item => [item.id, item.label, item.count]), [
    [`cluster:surface-overflow:${parent.id}`, '+3', 3],
  ]);
  const cluster = plan.surface.clusters[0];
  assert.deepEqual(cluster.memberIds, ['run::fourth', 'run::fifth', 'run::explored']);
  assert.equal(cluster.coordinateSpace, 'geographic');
  assert.ok(Math.abs(Math.abs(cluster.centroid.lon) - 180) < 3, 'spherical centroid stays near the dateline');
  const fanned = planWorldClusters(worlds, parent.id, { hoveredClusterId: cluster.id });
  assert.equal(fanned.surface.clusters.length, 0);
  assert.equal(fanned.surface.fannedClusterId, cluster.id);
  for (const id of cluster.memberIds) assert.ok(fanned.surface.visibleIds.includes(id), 'fan keeps original world IDs');
});

test('Orbit slider folds only unentered children and pending placeholders share nonenterable cloud shape', () => {
  const { parent, worlds } = graph();
  const plan = planWorldClusters(worlds, parent.id);
  assert.ok(plan.orbit.visibleIds.includes('run::explored'), 'explored worlds remain individually visible at every slider level');
  assert.ok(plan.orbit.visibleIds.includes('run::best'));
  assert.ok(plan.orbit.visibleIds.includes('run::second'));
  const overflow = plan.orbit.clusters.find(item => item.kind === 'orbit-overflow');
  const pending = plan.orbit.clusters.find(item => item.kind === 'generation-pending');
  assert.equal(overflow.count, 3);
  assert.deepEqual(overflow.memberIds, ['run::third', 'run::fourth', 'run::fifth']);
  assert.equal(pending.count, 3);
  assert.equal(pending.selectable, false);
  assert.deepEqual(pending.memberIds, [1, 2, 3].map(index => `placeholder:${parent.id}:${index}`));
  assert.equal(pending.color, 'cyan');
  assert.deepEqual(Object.keys(pending), Object.keys(overflow), 'pending and overflow use the same cloud payload shape');
  const open = planWorldClusters(worlds, parent.id, { orbitLevel: 7 });
  assert.equal(open.orbit.clusters.some(item => item.kind === 'orbit-overflow'), false);
  assert.deepEqual(planWorldClusters(worlds, parent.id, { surfaceLabelLevel: 0 }).surface.visibleIds, []);
});

test('single Orbit overflow uses singular wording and fades away as Atlas releases its saved members', () => {
  const { parent, children, worlds } = graph();
  const single = planWorldClusters([parent, ...children.slice(0, 3)], parent.id).orbit.clusters.find(item => item.kind === 'orbit-overflow');
  assert.equal(single.count, 1);
  assert.equal(single.label, '1 possibility');

  const plan = planWorldClusters(worlds, parent.id);
  const overflow = plan.orbit.clusters.find(item => item.kind === 'orbit-overflow');
  const pending = plan.orbit.clusters.find(item => item.kind === 'generation-pending');
  assert.equal(clusterOpacityAtPresentation(overflow, 'orbit', { orbit: 1, atlas: 0 }, parent.id), 1);
  assert.equal(clusterOpacityAtPresentation(overflow, 'orbit', { orbit: 0, atlas: 1 }, parent.id), 0);
  assert.equal(clusterOpacityAtPresentation(pending, 'orbit', { orbit: 0, atlas: 1 }, parent.id), 0.85, 'Atlas keeps the generation cloud');

  const atlasClustered = new Set(orbitClusteredIdsForPresentation(plan, { atlas: 1, zoom: 1, orbitNeighborhoodIds: [parent.id] }));
  for (const id of overflow.memberIds) assert.equal(atlasClustered.has(id), false, 'saved overflow members are unclustered for Atlas LOD');
  for (const id of pending.memberIds) assert.equal(atlasClustered.has(id), true, 'pending members remain represented by their cloud');
  const orbitClustered = new Set(orbitClusteredIdsForPresentation(plan, { atlas: 0, zoom: 0.9, orbitNeighborhoodIds: [parent.id] }));
  for (const id of overflow.memberIds) assert.equal(orbitClustered.has(id), true, 'the Orbit overflow remains clustered before Atlas');
});

test('hovering an Orbit cloud reveals stable child IDs without changing their actionability', () => {
  const { parent, worlds } = graph();
  const initial = planWorldClusters(worlds, parent.id);
  const cluster = initial.orbit.clusters.find(item => item.kind === 'orbit-overflow');
  const expanded = planWorldClusters(worlds, parent.id, { hoveredClusterId: cluster.id });
  assert.equal(expanded.orbit.clusters.some(item => item.id === cluster.id), false);
  for (const id of cluster.memberIds) assert.ok(expanded.orbit.visibleIds.includes(id));
  assert.deepEqual(expanded.orbit.fannedClusterId, cluster.id);
  assert.equal(worlds.find(world => world.id === 'run::third').id, cluster.memberIds[0]);
});

test('pending and unentered clouds remain planned for inactive parents while the active world stays selected', () => {
  const { parent, worlds } = graph();
  const otherParent = { id: 'other::parent', questionId: 'question-2', lat: 10, lon: 30 };
  worlds.push(otherParent,
    { id: 'other::a', parentId: otherParent.id, questionId: 'question-2', score: 4, lat: 11, lon: 31 },
    { id: 'other::b', parentId: otherParent.id, questionId: 'question-2', score: 3, lat: 12, lon: 32 },
    { id: 'placeholder:other::parent:1', parentId: otherParent.id, questionId: 'question-2', isExpansionPlaceholder: true, selectable: false, year: null });
  const plan = planWorldClusters(worlds, parent.id, { orbitLevel: 0 });
  assert.equal(plan.parentId, parent.id, 'the active selection remains the requested world');
  assert.ok(plan.orbit.clusters.some(item => item.parentId === otherParent.id && item.kind === 'orbit-overflow'));
  assert.ok(plan.orbit.clusters.some(item => item.parentId === otherParent.id && item.kind === 'generation-pending'));
  assert.ok(plan.orbit.clusteredIds.includes('placeholder:other::parent:1'));
});
