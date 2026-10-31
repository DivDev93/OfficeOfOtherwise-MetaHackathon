import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  DIRECT_TRAVEL_MS, GHOST_TRAIL_DEFAULT, THREAD_TRAVEL_MS, arrivalParentWorldId,
  cutTravelOpacity, interpolateTravelPoint, interpolateTravelZoom, lineageTravelPath,
  preservesTravelSource, sampleLineagePath, smoothTravelProgress, travelDuration, travelZoomAt,
} from '../web/atlas/p3Travel.js';

const worlds = [
  { id: 'root', parentId: null },
  { id: 'a1', parentId: 'root' },
  { id: 'a2', parentId: 'a1' },
  { id: 'b1', parentId: 'root' },
  { id: 'b2', parentId: 'b1' },
  { id: 'other-root', parentId: null },
];

test('thread travel routes up to the nearest common ancestor then down', () => {
  assert.deepEqual(lineageTravelPath(worlds, 'a2', 'b2'), ['a2', 'a1', 'root', 'b1', 'b2']);
  assert.deepEqual(lineageTravelPath(worlds, 'a2', 'a1'), ['a2', 'a1']);
  assert.deepEqual(lineageTravelPath(worlds, 'a2', 'other-root'), ['a2', 'other-root']);
  assert.deepEqual(lineageTravelPath(worlds, 'missing', 'b2'), []);
});

test('travel progress advances across route edges without skipping endpoints', () => {
  const path = lineageTravelPath(worlds, 'a2', 'b2');
  assert.deepEqual(sampleLineagePath(path, 0), { fromId: 'a2', toId: 'a1', progress: 0 });
  assert.deepEqual(sampleLineagePath(path, 0.5), { fromId: 'root', toId: 'b1', progress: 0 });
  assert.deepEqual(sampleLineagePath(path, 1), { fromId: 'b1', toId: 'b2', progress: 1 });
  assert.equal(sampleLineagePath(['only'], 0.4).fromId, 'only');
  assert.equal(sampleLineagePath([], 0), null);
});

test('camera travel easing and altitude interpolation stay bounded, finite and endpoint-continuous', () => {
  assert.equal(smoothTravelProgress(0), 0);
  assert.equal(smoothTravelProgress(1), 1);
  assert.equal(smoothTravelProgress(-4), 0);
  assert.equal(smoothTravelProgress(4), 1);
  assert.ok(smoothTravelProgress(0.5) > 0 && smoothTravelProgress(0.5) < 1);
  assert.equal(interpolateTravelZoom(0.6, 0, 0), 0.6);
  assert.equal(interpolateTravelZoom(0.6, 0, 1), 0);
  assert.equal(interpolateTravelZoom(0.6, 0, 0.5), 0.3);
  assert.equal(travelZoomAt(0, 0, 0), 0);
  assert.equal(travelZoomAt(0, 0, 0.5), 0.68);
  assert.equal(travelZoomAt(0, 0, 1), 0);
  assert.equal(travelZoomAt(0.8, 0, 0.5), 0.8);
  const cutSamples = [0, 0.25, 0.49, 0.5, 0.75, 1];
  const cutZooms = cutSamples.map(progress => travelZoomAt(0.2, 0, progress, 0.68, 'cut'));
  assert.deepEqual(cutZooms, [0.2, 0.2, 0.2, 0, 0, 0]);
  assert.ok(Math.max(...cutZooms) <= 0.2, 'cut travel does not perform the threaded zoom excursion');
  assert.deepEqual([0, 0.25, 0.5, 0.75, 1].map(cutTravelOpacity), [1, 0.5, 0, 0.5, 1]);
  assert.deepEqual(interpolateTravelPoint({ x: 2, y: 0, z: -2 }, { x: 8, y: 4, z: 2 }, 0), { x: 2, y: 0, z: -2 });
  assert.deepEqual(interpolateTravelPoint({ x: 2, y: 0, z: -2 }, { x: 8, y: 4, z: 2 }, 1), { x: 8, y: 4, z: 2 });
  assert.deepEqual(interpolateTravelPoint({ x: 2, y: 0, z: -2 }, { x: 8, y: 4, z: 2 }, 0.5), { x: 5, y: 2, z: 0 });
  assert.ok(Object.values(interpolateTravelPoint({}, { x: Number.NaN, y: 2, z: 4 }, 0.5)).every(Number.isFinite));
});

test('thread and direct travel durations honor reduced motion; ancestor ghosts default off', () => {
  assert.equal(THREAD_TRAVEL_MS, 1500);
  assert.equal(DIRECT_TRAVEL_MS, 400);
  assert.equal(travelDuration('threads', false), 1500);
  assert.equal(travelDuration('cut', false), 400);
  assert.equal(travelDuration('threads', true), 400);
  assert.equal(GHOST_TRAIL_DEFAULT, false);
});

test('matching async current-world echoes preserve an active trip but different targets do not', () => {
  const trip = { fromId: 'a2', toId: 'b2', cutSwitched: false };
  assert.equal(preservesTravelSource(trip, 'b2'), true);
  assert.equal(preservesTravelSource(trip, 'a2'), false);
  assert.equal(preservesTravelSource(trip, 'other'), false);
  assert.equal(preservesTravelSource({ ...trip, cutSwitched: true }, 'b2'), false);
  assert.equal(preservesTravelSource(null, 'b2'), false);
});

test('arrival trail resolves from saved parent on reload or direct jump, never navigation history', () => {
  const graph = [{ id: 'sundaland', parentId: null }, { id: 'kuching', parentId: 'sundaland' }, { id: 'other', parentId: null }];
  assert.equal(arrivalParentWorldId(graph[1], graph), 'sundaland');
  assert.equal(arrivalParentWorldId(graph[2], graph), null);
  assert.equal(arrivalParentWorldId({ id: 'orphan', parentId: 'missing' }, graph), null);
});

test('scene exposes optional ghost and travel hooks while reusing the single current Earth mesh', () => {
  const source = readFileSync(new URL('../web/atlas/scene.js', import.meta.url), 'utf8');
  assert.match(source, /setTravelMode,/);
  assert.match(source, /setGhostTrail,/);
  assert.match(source, /const earthMesh = new THREE\.Mesh\(earthGeometry, earthMaterial\)/);
  assert.doesNotMatch(source, /new THREE\.Mesh\(new THREE\.SphereGeometry\([^\n]*world/i);
});

