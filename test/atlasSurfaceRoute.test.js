import test from 'node:test';
import assert from 'node:assert/strict';
import { buildSurfaceArcRoute } from '../web/atlas/routeMorph.js';

function geographicNormal(lat, lon) {
  const phi = (90 - lat) * Math.PI / 180, theta = (lon + 180) * Math.PI / 180;
  return { x:-Math.sin(phi) * Math.cos(theta), y:Math.cos(phi), z:Math.sin(phi) * Math.sin(theta) };
}

test('Beringia Markovo-to-Whitehorse lineage surface route stays on geographic anchors', () => {
  const markovo = geographicNormal(64.68, 170.41);
  const whitehorse = geographicNormal(60.7212, -135.0568);
  const route = buildSurfaceArcRoute(markovo, whitehorse, 1.00025, 1.00025, { x:0, y:0, z:0 }, 24);
  assert.equal(route.length, 25);
  const nearPoint = (actual, expected) => Math.hypot(actual.x - expected.x, actual.y - expected.y, actual.z - expected.z) < 1e-10;
  assert.ok(nearPoint(route[0], { x:markovo.x * 1.00025, y:markovo.y * 1.00025, z:markovo.z * 1.00025 }),
    'the lineage starts at the parent event geography');
  assert.ok(nearPoint(route.at(-1), { x:whitehorse.x * 1.00025, y:whitehorse.y * 1.00025, z:whitehorse.z * 1.00025 }),
    'the lineage ends at the selected Whitehorse event geography');
  for (const point of route) assert.ok(Math.abs(Math.hypot(point.x, point.y, point.z) - 1.00025) < 1e-10,
    'every sampled route point follows the globe surface radius');
  const chordMidpointRadius = Math.hypot((route[0].x + route.at(-1).x) / 2,
    (route[0].y + route.at(-1).y) / 2, (route[0].z + route.at(-1).z) / 2);
  assert.ok(Math.hypot(route[12].x, route[12].y, route[12].z) > chordMidpointRadius + 0.01,
    'the route follows the spherical arc instead of the straight arrival chord');
});

test('surface route geometry is deterministic from geography and radii alone', () => {
  const from = geographicNormal(64.68, 170.41), to = geographicNormal(60.7212, -135.0568);
  const first = buildSurfaceArcRoute(from, to, 1.00025, 1.00025, { x:0, y:0, z:0 }, 24);
  const repeated = buildSurfaceArcRoute({ ...from }, { ...to }, 1.00025, 1.00025, { x:0, y:0, z:0 }, 24);
  assert.deepEqual(first, repeated, 'camera orientation and screen-space fan offsets cannot alter the geographic route');
});
