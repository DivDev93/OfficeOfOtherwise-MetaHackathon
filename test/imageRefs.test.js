import test from 'node:test';
import assert from 'node:assert/strict';
import { defaultWorldImageUrl } from '../web/atlas/imageRefs.js';

const runId = 'run-a';
const branchId = 'b2';
const baseWorld = {
  id: `${runId}:${branchId}`,
  provenance: { sourceRunId: runId, sourceBranchId: branchId },
};

test('default scene resolver accepts only same-origin app event-scene refs with matching provenance', () => {
  const world = { ...baseWorld, sceneRef: { status: 'complete', url: '/event-scenes/' + 'a'.repeat(64) + '.png', runId, branchId } };
  assert.equal(defaultWorldImageUrl(world, { origin: 'https://atlas.example' }), `/event-scenes/${'a'.repeat(64)}.png`);
  assert.equal(defaultWorldImageUrl({ ...world, sceneRef: { ...world.sceneRef, url: 'https://other.example/event-scenes/' + 'a'.repeat(64) + '.png' } }, { origin: 'https://atlas.example' }), null);
  assert.equal(defaultWorldImageUrl({ ...world, id: `${runId}:b1` }, { origin: 'https://atlas.example' }), null);
  assert.equal(defaultWorldImageUrl({ ...world, sceneRef: { ...world.sceneRef, branchId: 'b1' } }, { origin: 'https://atlas.example' }), null);
});

test('selected hero resolution is exact-branch only and maps to the app run asset route', () => {
  const world = { ...baseWorld, heroRef: { status: 'complete', path: `candidate/live/${runId}/hero.png`, runId, branchId } };
  assert.equal(defaultWorldImageUrl(world, { origin: 'https://atlas.example', selected: false }), null);
  assert.equal(defaultWorldImageUrl(world, { origin: 'https://atlas.example', selected: true }), `/runs/${runId}/hero.png`);
  assert.equal(defaultWorldImageUrl({ ...world, heroRef: { ...world.heroRef, branchId: 'b1' } }, { origin: 'https://atlas.example', selected: true }), null);
  assert.equal(defaultWorldImageUrl({ ...world, heroRef: { ...world.heroRef, path: 'candidate/live/other-run/hero.png' } }, { origin: 'https://atlas.example', selected: true }), null);
});

test('QA fixture paths are not production default URLs', () => {
  const world = { ...baseWorld, sceneRef: { status: 'complete', path: `candidate/live/.event-scenes/${'a'.repeat(64)}.png` } };
  assert.equal(defaultWorldImageUrl(world, { origin: 'https://atlas.example' }), null);
});
