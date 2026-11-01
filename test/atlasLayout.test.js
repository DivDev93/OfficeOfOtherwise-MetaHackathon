import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  ATLAS_CAMERA_DISTANCE, SURFACE_CAMERA_DISTANCE, allowEarthBodySelection, altitudeForZoom,
  atlasZoomState, createWorldRegistry, layoutAtlasWorlds, measuredFps,
  nearestDirectionalNeighbor, nearestProjectedAnchorHit, selectSurfaceLabels, surfaceFacingRotation, surfaceFacingOrientation, transformSurfaceNormal,
  slerpUnitVector, selectSurfaceWorldLabelIds, worldRadiusForScreenPixels, cappedTextureSize,
  fitCameraDistance, fitCenteredCameraDistance, layoutOrbitNeighborhood, zoomForAltitude,
  appendContinuousFrame, atlasPresentationState,
  clampScreenRectCenter, isSurfaceNormalVisible,
  localQuaternionForWorldFacing,
  ATLAS_PIN_GEOMETRY_RADIUS, ATLAS_PIN_SCALE_GAIN, LIFTED_PIN_SCALE, SURFACE_PIN_SCALE,
  atlasPinScale, pinAnchorRadiusAtPresentation, pinScaleAtPresentation,
  surfacePinAnchorRadius, surfacePinScale,
} from '../web/atlasLayout.js';

test('normalized zoom and camera altitude are continuous inverses', () => {
  for (let index = 0; index <= 100; index++) {
    const zoom = index / 100;
    const altitude = altitudeForZoom(zoom);
    assert.ok(altitude >= SURFACE_CAMERA_DISTANCE && altitude <= ATLAS_CAMERA_DISTANCE);
    assert.ok(Math.abs(zoomForAltitude(altitude) - zoom) < 1e-12);
    if (index) assert.ok(altitude > altitudeForZoom((index - 1) / 100));
  }
  for (const boundary of [0.22, 0.57, 0.84]) {
    const before = atlasZoomState(boundary - 1e-6);
    const at = atlasZoomState(boundary);
    const after = atlasZoomState(boundary + 1e-6);
    for (const key of ['surface', 'lift', 'orbit', 'atlas', 'earthScale', 'earthX']) {
      assert.ok(Math.abs(before[key] - at[key]) < 0.00002, `${key} jumps before transition at ${boundary}`);
      assert.ok(Math.abs(after[key] - at[key]) < 0.00002, `${key} jumps after transition at ${boundary}`);
    }
  }
  const orbit = atlasZoomState(0.7);
  assert.equal(orbit.lift, 1);
  assert.equal(orbit.atlas, 0);
  assert.equal(orbit.orbit, 1);
});

test('world identity records survive repeated altitude and layout reconciliations', () => {
  const registry = createWorldRegistry();
  const first = { id: 'kuching', parentId: 'sundaland', title: 'Kuching' };
  const record = registry.reconcile([first])[0];
  const persistentObject = { kind: 'same-world-render-object' };
  record.object = persistentObject;
  for (const zoom of [0, 0.2, 0.21, 0.5, 0.58, 0.84, 1, 0.33]) {
    atlasZoomState(zoom);
    const reconciled = registry.reconcile([{ ...first, title: `Updated at ${zoom}` }])[0];
    assert.strictEqual(reconciled, record);
    assert.strictEqual(registry.get('kuching').object, persistentObject);
  }
});

test('world registry prunes removed IDs so renderer can dispose evicted scene maps', () => {
  const registry = createWorldRegistry();
  const [kept, removed] = registry.reconcile([{ id: 'kept' }, { id: 'removed' }]);
  assert.deepEqual(registry.prune([{ id: 'kept' }]), [removed]);
  assert.strictEqual(registry.get('kept'), kept);
  assert.equal(registry.get('removed'), null);
});

test('world layout keeps selected children geographically anchored and stable by ID', () => {
  const worlds = [
    { id: 'sibling', parentId: 'origin', year: 2020, lat: 2, lon: 103 },
    { id: 'kuching', parentId: 'origin', year: 2021, lat: 1.55, lon: 110.35, reviewScore: 0.94 },
    { id: 'origin', year: 2020, lat: 1, lon: 104 },
  ];
  const layout = layoutAtlasWorlds(worlds, 'origin');
  const byId = new Map(layout.map(entry => [entry.id, entry]));
  assert.equal(byId.get('kuching').child, true);
  assert.equal(byId.get('origin').current, true);
  assert.ok(Math.abs(Math.hypot(byId.get('kuching').globe.x, byId.get('kuching').globe.y, byId.get('kuching').globe.z) - 1) < 1e-12);
  assert.deepEqual(
    layout.map(entry => [entry.id, entry.atlas.x, entry.atlas.y]).sort(),
    layoutAtlasWorlds([...worlds].reverse(), 'origin').map(entry => [entry.id, entry.atlas.x, entry.atlas.y]).sort(),
  );
  assert.equal(selectSurfaceLabels(worlds, 1, 'kuching')[0].id, 'kuching');
});

test('Orbit neighborhood centers the selected world and places parent left and children right', () => {
  const worlds = [
    { id: 'parent', parentId: null, lat: 0, lon: 0 },
    { id: 'current', parentId: 'parent', lat: 2, lon: 3 },
    { id: 'sibling', parentId: 'parent', lat: 4, lon: 6 },
    { id: 'child-a', parentId: 'current', lat: 8, lon: 9, reviewScore: 8 },
    { id: 'child-b', parentId: 'current', lat: 10, lon: 12, reviewScore: 3 },
    { id: 'unrelated', parentId: 'other', lat: -20, lon: -30 },
  ];
  const entries = layoutAtlasWorlds(worlds, 'current');
  const positions = layoutOrbitNeighborhood(entries, 'current');
  assert.deepEqual(positions.get('current'), { x: 0, y: 0, z: 0 });
  assert.ok(positions.get('parent').x < positions.get('current').x);
  assert.ok(positions.get('child-a').x > positions.get('current').x);
  assert.ok(positions.get('child-b').x > positions.get('current').x);
  assert.notEqual(positions.get('child-a').y, positions.get('child-b').y);
  assert.equal(positions.has('unrelated'), false);
});

test('root Orbit neighborhood uses its question as a virtual parent and limits siblings to that question', () => {
  const worlds = [
    { id: 'root-a', parentId: null, questionId: 'q-a' },
    { id: 'root-a-sibling', parentId: null, questionId: 'q-a' },
    { id: 'root-b', parentId: null, questionId: 'q-b' },
  ];
  const entries = layoutAtlasWorlds(worlds, 'root-a');
  const positions = layoutOrbitNeighborhood(entries, 'root-a');
  assert.equal(positions.get('question:q-a').kind, 'question-parent');
  assert.equal(positions.get('question:q-a').questionId, 'q-a');
  assert.ok(positions.get('question:q-a').x < positions.get('root-a').x);
  assert.ok(positions.get('root-a-sibling').x < positions.get('root-a').x);
  assert.notEqual(positions.get('root-a-sibling').y, 0, 'a single sibling cannot sit on the question-parent to current path');
  assert.equal(positions.has('root-b'), false, 'another question tree is not a sibling');
});

test('odd sibling counts never place a sibling on the parent-current Orbit path', () => {
  for (const count of [1, 3, 5]) {
    const worlds = [{ id: 'parent', parentId: null }, { id: 'current', parentId: 'parent' },
      ...Array.from({ length: count }, (_, i) => ({ id: `sibling-${i}`, parentId: 'parent' }))];
    const positions = layoutOrbitNeighborhood(layoutAtlasWorlds(worlds, 'current'), 'current');
    for (let i = 0; i < count; i++) assert.notEqual(positions.get(`sibling-${i}`).y, 0);
  }
});

test('current geographic normal rotates onto the camera axis and remains shared by surface markers', () => {
  const current = layoutAtlasWorlds([{ id: 'sundaland', parentId: null, lat: 2.3, lon: 113.9 }], 'sundaland')[0];
  const angle = surfaceFacingRotation(current.globe);
  const xFacing = current.globe.x * Math.cos(angle) + current.globe.z * Math.sin(angle);
  const zFacing = -current.globe.x * Math.sin(angle) + current.globe.z * Math.cos(angle);
  assert.ok(Math.abs(xFacing) < 1e-12, 'selected latitude/longitude rotates to screen center');
  assert.ok(zFacing > 0.99, 'selected marker faces the camera rather than the rear hemisphere');
  assert.ok(Math.abs(zFacing - Math.hypot(current.globe.x, current.globe.z)) < 1e-12, 'latitude remains unchanged during heading alignment');
  assert.equal(surfaceFacingRotation({ x: 0, z: 0 }), 0);
});

test('surface orientation centers high-latitude and dateline event normals, then fades pitch through Lift', () => {
  for (const [id, lat, lon] of [['beringia', 78.2, 179.4], ['svalbard', 78.2, 18.9], ['sundaland', 2.3, 113.9]]) {
    const current = layoutAtlasWorlds([{ id, lat, lon }], id)[0];
    const orientation = surfaceFacingOrientation(current.globe);
    const centered = transformSurfaceNormal(current.globe, orientation);
    assert.ok(Math.abs(centered.x) < 1e-12, `${id} centers on horizontal axis`);
    assert.ok(Math.abs(centered.y) < 1e-12, `${id} latitude is centered vertically`);
    assert.ok(centered.z > 1 - 1e-12, `${id} faces the camera`);
    assert.ok(Math.abs(surfaceFacingOrientation(current.globe, 0, .5).pitch) > 0.1 || Math.abs(lat) < 10, `${id} retains a smooth partial tilt during Lift`);
    assert.deepEqual(surfaceFacingOrientation(current.globe, 0, 0), { yaw: 0, pitch: 0 }, 'the geographic tilt disappears at full Lift');
  }
});

test('local globe orientation cancels the fractional parent rotation while preserving the intended world facing', () => {
  const multiply = (a, b) => ({
    x: a.w * b.x + a.x * b.w + a.y * b.z - a.z * b.y,
    y: a.w * b.y - a.x * b.z + a.y * b.w + a.z * b.x,
    z: a.w * b.z + a.x * b.y - a.y * b.x + a.z * b.w,
    w: a.w * b.w - a.x * b.x - a.y * b.y - a.z * b.z,
  });
  const yaw = { x: 0, y: Math.sin(.31), z: 0, w: Math.cos(.31) };
  const pitch = { x: Math.sin(-.22), y: 0, z: 0, w: Math.cos(-.22) };
  const parent = multiply(pitch, yaw);
  const drag = { x: 0, y: Math.sin(.12), z: 0, w: Math.cos(.12) };
  const desiredWorld = multiply(parent, drag);
  const local = localQuaternionForWorldFacing(parent, desiredWorld);
  const actualWorld = multiply(parent, local);
  for (const key of ['x', 'y', 'z', 'w']) assert.ok(Math.abs(actualWorld[key] - desiredWorld[key]) < 1e-12, `${key} component retains the intended world-facing quaternion`);
  const identityParent = localQuaternionForWorldFacing({ x: 0, y: 0, z: 0, w: 1 }, desiredWorld);
  for (const key of ['x', 'y', 'z', 'w']) assert.ok(Math.abs(identityParent[key] - desiredWorld[key]) < 1e-12);
});

test('44 CSS-pixel pin targets and arrow navigation use projected screen coordinates', () => {
  const distance = 4.2, fov = 38, height = 900;
  const radius = worldRadiusForScreenPixels(distance, fov, height, 44);
  const projectedDiameter = radius * 2 * height / (2 * distance * Math.tan(fov * Math.PI / 360));
  assert.ok(Math.abs(projectedDiameter - 44) < 1e-10);
  assert.equal(worldRadiusForScreenPixels(0, fov, height, 44), 0);
  const origin = { id: 'root', x: 400, y: 300 };
  const neighbors = [
    { id: 'left', x: 350, y: 302 }, { id: 'right', x: 480, y: 315 },
    { id: 'up', x: 402, y: 250 }, { id: 'down', x: 398, y: 360 },
  ];
  assert.equal(nearestDirectionalNeighbor(origin, neighbors, 'ArrowRight').id, 'right');
  assert.equal(nearestDirectionalNeighbor(origin, neighbors, 'ArrowLeft').id, 'left');
  assert.equal(nearestDirectionalNeighbor(origin, neighbors, 'ArrowUp').id, 'up');
  assert.equal(nearestDirectionalNeighbor(origin, neighbors, 'ArrowDown').id, 'down');
  assert.equal(allowEarthBodySelection(0), false);
  assert.equal(allowEarthBodySelection(0.56), false);
  assert.equal(allowEarthBodySelection(0.57), true);
  assert.equal(allowEarthBodySelection(1), true);
});

test('overlapping 44px hits belong to the nearest projected anchor with deterministic depth and ID ties', () => {
  const nearerAnchor = { id: 'farther-depth', distanceSquared: 4, hitDistance: 8 };
  const nearerDepth = { id: 'nearer-depth', distanceSquared: 25, hitDistance: 2 };
  assert.equal(nearestProjectedAnchorHit([nearerDepth, nearerAnchor]), nearerAnchor,
    'screen anchor distance outranks ray depth when hit targets overlap');
  const tiedDepth = { id: 'z-node', distanceSquared: 25 + 5e-7, hitDistance: 2 + 5e-7 };
  const stableId = { id: 'a-node', distanceSquared: 25, hitDistance: 2 };
  assert.equal(nearestProjectedAnchorHit([tiedDepth, stableId]), stableId);
  assert.equal(nearestProjectedAnchorHit([stableId, tiedDepth]), stableId,
    'sub-pixel numeric ties do not depend on candidate insertion order');
  assert.equal(nearestProjectedAnchorHit([{ id: 'bad', distanceSquared: NaN, hitDistance: 0 }, nearerAnchor]), nearerAnchor);
  assert.equal(nearestProjectedAnchorHit([]), null);
});

test('screen-pixel hit sizing uses transformed world camera depth for rotated surface clusters', () => {
  const fov = 38, height = 600, cameraDistance = 3, localZ = 1.17, pitch = Math.PI / 4;
  const viewDepth = cameraDistance - localZ * Math.cos(pitch);
  const radius = worldRadiusForScreenPixels(viewDepth, fov, height, 48);
  const projectedDiameter = 2 * radius * height / (2 * viewDepth * Math.tan(fov * Math.PI / 360));
  assert.ok(Math.abs(projectedDiameter - 48) < 1e-9);
  const staleLocalDistance = cameraDistance - localZ;
  const incorrectlySizedRadius = worldRadiusForScreenPixels(staleLocalDistance, fov, height, 48);
  const rotatedDiameter = 2 * incorrectlySizedRadius * height / (2 * viewDepth * Math.tan(fov * Math.PI / 360));
  assert.ok(rotatedDiameter < 44, `the old local-coordinate sizing shrinks the 48px target to ${rotatedDiameter.toFixed(1)}px`);
});

test('surface labels stay on current, ranked direct children, arrived parent, and explicit ghosts', () => {
  const worlds = [
    { id: 'root', parentId: null, score: 100 },
    { id: 'parent', parentId: 'root', score: 99 },
    { id: 'current', parentId: 'parent', score: 1 },
    { id: 'best-child', parentId: 'current', score: 10 },
    { id: 'next-child', parentId: 'current', score: 9 },
    { id: 'unrelated', parentId: null, score: 200 },
  ];
  assert.deepEqual(new Set(selectSurfaceWorldLabelIds(worlds, 'current', 1, 'parent')), new Set(['current', 'parent', 'best-child']));
  assert.deepEqual(new Set(selectSurfaceWorldLabelIds(worlds, 'current', 0, null, ['parent', 'root'])), new Set(['current', 'parent', 'root']));
});

test('surface label rectangles clamp fully inside compact and desktop canvas bounds', () => {
  for (const bounds of [
    { left: 0, top: 0, right: 390, bottom: 844 },
    { left: 120, top: 30, right: 1560, bottom: 930 },
  ]) {
    const center = clampScreenRectCenter({ x: bounds.left - 70, y: bounds.top + 2 }, bounds, 220, 36, 4);
    assert.ok(center.x - 110 >= bounds.left + 4);
    assert.ok(center.x + 110 <= bounds.right - 4);
    assert.ok(center.y - 18 >= bounds.top + 4);
    assert.ok(center.y + 18 <= bounds.bottom - 4);
  }
});

test('surface markers sit at Earth radius and their mini-Earth representations inflate only across Lift', () => {
  assert.equal(surfacePinScale(0), SURFACE_PIN_SCALE);
  assert.equal(surfacePinScale(1), LIFTED_PIN_SCALE);
  assert.ok(surfacePinScale(0.5) > SURFACE_PIN_SCALE && surfacePinScale(0.5) < LIFTED_PIN_SCALE);
  assert.equal(atlasPinScale(0), 1, 'Orbit pins retain the original size');
  assert.equal(atlasPinScale(1), 1 + ATLAS_PIN_SCALE_GAIN, 'Atlas retains the previous 1 + 4.5×atlas size curve');
  assert.equal(pinScaleAtPresentation(1, 0), 1, 'Lift ends at the existing Orbit pin size');
  assert.equal(pinScaleAtPresentation(1, 1), 1 + ATLAS_PIN_SCALE_GAIN, 'only Atlas applies the old 1 + 4.5× growth');
  assert.equal(pinAnchorRadiusAtPresentation(1, 0, 0), 1 + 0.00025, 'surface hit targets share the exact rendered ring center');
  assert.ok(Math.abs(pinAnchorRadiusAtPresentation(0.34, 0.5, 0)
    - surfacePinAnchorRadius(0.34, pinScaleAtPresentation(0.5, 0))) < 1e-12, 'Lift hit targets share the rendered sphere center');
  const surfaceScale = surfacePinScale(0);
  const surfaceAnchor = surfacePinAnchorRadius(1, surfaceScale);
  assert.ok(Math.abs((surfaceAnchor - ATLAS_PIN_GEOMETRY_RADIUS * surfaceScale) - 1) < 1e-12, 'marker lower pole rests at the exact unit Earth surface');
  const liftedScale = surfacePinScale(1) * atlasPinScale(0);
  const shrunkEarth = atlasZoomState(0.57).earthScale;
  const liftedAnchor = surfacePinAnchorRadius(shrunkEarth, liftedScale);
  assert.ok(Math.abs((liftedAnchor - ATLAS_PIN_GEOMETRY_RADIUS * liftedScale) - shrunkEarth) < 1e-12, 'Lift keeps the expanding pin tangent to the shrinking globe source');
});

test('negative-latitude/longitude surface markers remain on the unit Earth and cull with the horizon', () => {
  const entry = layoutAtlasWorlds([{ id: 'negative-geo', lat: -33.9, lon: -151.2 }], 'negative-geo')[0];
  const unitLength = Math.hypot(entry.globe.x, entry.globe.y, entry.globe.z);
  const actualSurfacePoint = { x: entry.globe.x / unitLength, y: entry.globe.y / unitLength, z: entry.globe.z / unitLength };
  assert.ok(Math.abs(Math.hypot(actualSurfacePoint.x, actualSurfacePoint.y, actualSurfacePoint.z) - 1) < 1e-12);
  assert.ok(isSurfaceNormalVisible(entry.globe, entry.globe), 'the event is visible when its normal faces the camera');
  assert.equal(isSurfaceNormalVisible(entry.globe, { x: -entry.globe.x, y: -entry.globe.y, z: -entry.globe.z }), false, 'the same event is hidden on the far hemisphere');
  const scale = surfacePinScale(0);
  assert.ok(Math.abs(surfacePinAnchorRadius(1, scale) - ATLAS_PIN_GEOMETRY_RADIUS * scale - 1) < 1e-12);
  const source = readFileSync(new URL('../web/atlas/scene.js', import.meta.url), 'utf8');
  assert.match(source, /new THREE\.RingGeometry\(/, 'surface uses flat tangent ring markers');
  assert.match(source, /setFromUnitVectors\(new THREE\.Vector3\(0, 0, 1\)/, 'ring normals align to each geographic normal');
  assert.match(source, /vertexColors: false/, 'instance colors do not require missing geometry vertex colors');
  assert.match(source, /surfacePinInstances\.setColorAt/, 'each tangent marker still receives its world color');
});

test('surface arc interpolation stays finite for coincident, near-coincident and antipodal nodes', () => {
  const cases = [
    [{ x: 0, y: 1, z: 0 }, { x: 0, y: 1, z: 0 }, 0.5],
    [{ x: 0, y: 0, z: 1 }, { x: 1e-8, y: 0, z: 1 }, 0.5],
    [{ x: 1, y: 0, z: 0 }, { x: -1, y: 0, z: 0 }, 0.5],
  ];
  for (const [from, to, progress] of cases) {
    const point = slerpUnitVector(from, to, progress);
    assert.ok([point.x, point.y, point.z].every(Number.isFinite));
    assert.ok(Math.abs(Math.hypot(point.x, point.y, point.z) - 1) < 1e-10);
  }
  assert.deepEqual(slerpUnitVector({ x: 1, y: 0, z: 0 }, { x: 0, y: 0, z: 1 }, 0), { x: 1, y: 0, z: 0 });
  assert.deepEqual(slerpUnitVector({ x: 1, y: 0, z: 0 }, { x: 0, y: 0, z: 1 }, 1), { x: 0, y: 0, z: 1 });
});

test('GPU texture dimensions are capped without upscaling or changing aspect ratio', () => {
  assert.deepEqual(cappedTextureSize(8192, 4096, 2048), { width: 2048, height: 1024 });
  assert.deepEqual(cappedTextureSize(1024, 768, 2048), { width: 1024, height: 768 });
  assert.deepEqual(cappedTextureSize(4000, 3000, 2048), { width: 2048, height: 1536 });
});

test('atlas camera fit covers historical and future bounds at narrow host aspect ratios', () => {
  const aspect = 700 / 800, fov = 38;
  const bounds = { left: -5.25, right: 5.65, bottom: -4.1, top: 4.8 };
  const distance = fitCameraDistance(bounds, aspect, fov, 1.08);
  const halfHeight = distance * Math.tan(fov * Math.PI / 360);
  const halfWidth = halfHeight * aspect;
  assert.ok(halfWidth >= Math.max(Math.abs(bounds.left), Math.abs(bounds.right)) * 1.08);
  assert.ok(halfHeight >= Math.max(Math.abs(bounds.bottom), Math.abs(bounds.top)) * 1.08);
  assert.ok(fitCameraDistance(bounds, 1.5, fov, 1.08) < distance, 'wide canvases need less atlas camera distance');
});

test('fitting centred bounds does not double-count their offset from the origin', () => {
  const frame = { left: 10, right: 30, bottom: 40, top: 50 };
  const shifted = { left: -10, right: 10, bottom: -5, top: 5 };
  assert.equal(fitCenteredCameraDistance(frame, 1.6), fitCenteredCameraDistance(shifted, 1.6));
  assert.ok(fitCenteredCameraDistance(frame, 1.6) < fitCameraDistance(frame, 1.6));
});

test('FPS uses observed timestamp spacing and reports zero without an elapsed interval', () => {
  assert.equal(measuredFps([]), 0);
  assert.equal(measuredFps([100]), 0);
  assert.ok(Math.abs(measuredFps([100, 116.6666666667, 133.3333333333]) - 60) < 1e-8);
  assert.equal(measuredFps([50, 100, 150]), 20);
  assert.equal(measuredFps([100, 100, 100]), 0);
  assert.equal(measuredFps([0, Number.NaN, 20]), 50);
});

test('FPS windows reset on zoom-level reentry and retain only continuous timestamps', () => {
  const priorOrbit = Array.from({ length: 40 }, (_, index) => 100 + index * 16.67);
  const lift = appendContinuousFrame(priorOrbit, 'orbit', 'lift', 10_000);
  assert.deepEqual(lift.frames, [10_000]);
  assert.equal(measuredFps(lift.frames), 0, 'transition entry does not reuse stale Orbit timestamps');
  let orbit = appendContinuousFrame(lift.frames, lift.level, 'orbit', 20_000);
  assert.deepEqual(orbit.frames, [20_000]);
  orbit = appendContinuousFrame(orbit.frames, orbit.level, 'orbit', 20_016.67);
  orbit = appendContinuousFrame(orbit.frames, orbit.level, 'orbit', 20_033.34);
  assert.ok(Math.abs(measuredFps(orbit.frames) - 60) < 0.1);
  const capped = appendContinuousFrame(Array.from({ length: 5 }, (_, index) => index), 'orbit', 'orbit', 5, 3);
  assert.deepEqual(capped.frames, [3, 4, 5]);
});

test('reduced-motion Lift fades between fixed surface and Orbit snapshots without spatial interpolation', () => {
  const start = atlasPresentationState(0.22, true);
  const beforeMidpoint = atlasPresentationState(0.34, true);
  const midpoint = atlasPresentationState(0.395, true);
  const afterMidpoint = atlasPresentationState(0.46, true);
  const end = atlasPresentationState(0.57, true);
  assert.equal(start.opacity, 1);
  assert.equal(beforeMidpoint.state.lift, 0);
  assert.equal(midpoint.opacity, 0);
  assert.equal(midpoint.state.lift, 1, 'snapshot switches only at the fade-through');
  assert.equal(afterMidpoint.state.lift, 1);
  assert.equal(end.opacity, 1);
  assert.equal(new Set([start.state.cameraDistance, beforeMidpoint.state.cameraDistance, afterMidpoint.state.cameraDistance, end.state.cameraDistance]).size, 2);
  assert.deepEqual(atlasPresentationState(0.34, true), beforeMidpoint, 'reverse scrubbing is deterministic');
  const ordinary = atlasPresentationState(0.395, false);
  assert.equal(ordinary.opacity, 1);
  assert.ok(ordinary.state.lift > 0 && ordinary.state.lift < 1, 'default motion keeps continuous Lift');
});

test('perspective horizon hides an oblique surface anchor even on the front hemisphere', () => {
  const view = { x: 0, y: 0, z: 3 };
  const threshold = 1 / 3;
  assert.equal(isSurfaceNormalVisible({ x: Math.sqrt(0.96), y: 0, z: 0.2 }, view, threshold), false);
  assert.equal(isSurfaceNormalVisible({ x: Math.sqrt(0.75), y: 0, z: 0.5 }, view, threshold), true);
});

test('scene foundation uses one renderer, scene, camera and no timed camera tween', () => {
  const scene = readFileSync(new URL('../web/atlas/scene.js', import.meta.url), 'utf8');
  assert.equal((scene.match(/new THREE\.WebGLRenderer\(/g) || []).length, 1);
  assert.equal((scene.match(/new THREE\.Scene\(/g) || []).length, 1);
  assert.equal((scene.match(/new THREE\.PerspectiveCamera\(/g) || []).length, 1);
  assert.doesNotMatch(scene, /setInterval\s*\(|cameraTween|transitionDuration/i);
  assert.match(scene, /resizeLayoutTimer\s*=\s*setTimeout\(/, 'the only timeout debounces layout recomputation, not camera motion');
  assert.equal((scene.match(/setTimeout\s*\(/g) || []).length, 1);
  assert.match(scene, /onPreview\(world \|\| null, anchor \|\| null\)/);
});

test('terrain transforms stay render-only and align Atlas pins, anchors, routes and camera facing', () => {
  const scene = readFileSync(new URL('../web/atlas/scene.js', import.meta.url), 'utf8');
  assert.match(scene, /projectGeographyLocation\(\{ lat, lon \}, texture\.geography, texture\.terrain\)/);
  assert.match(scene, /function surfacePoint\(entry, radius = 1\) \{ return geographyPoint\(entry, radius, projectedGlobe\(entry\)\); \}/);
  assert.match(scene, /surfacePoint\(entry\)\.normalize\(\)/, 'flat pins use the transformed surface normal');
  assert.match(scene, /surfaceFacingOrientation\(projectedGlobe\(current\)\)/, 'the camera follows transformed current coordinates');
  assert.match(scene, /atlasGroup\.quaternion\.copy\(surfacePitchQuaternion\)\.multiply\(surfaceYawQuaternion\)/, 'latitude and longitude alignment rotate the full Atlas surface together');
  assert.match(scene, /surfacePoint\(parent, fromRadius\).*surfacePoint\(child, markerRadius\)/s, 'causal route arcs use transformed anchors');
  assert.match(scene, /projectGeographyLocation\(\{ lat: rawLat, lon: rawLon \}, geographyTexture\.geography, geographyTexture\.terrain\)/, 'the selected marker is painted at its transformed coordinate');
  assert.match(scene, /surfaceFacingOrientation\(projectedGlobe\(entry\)\)/, 'each snapshot globe faces its transformed event coordinate');
  assert.match(scene, /localQuaternionForWorldFacing\(atlasGroup\.quaternion, earthDesiredWorldQuaternion\)/, 'current Earth keeps full event-facing orientation while the shared rig rotates less');
  assert.match(scene, /facing\.yaw \+ rotation/, 'manual surface rotation stays in the intended world facing');
  assert.match(scene, /key\.position\.copy\(camera\.position\)/, 'the globe key light follows the camera side');
  assert.match(scene, /key\.target\.position\.copy\(cameraFocus\)/, 'the moving key light aims at the viewed scene');
  assert.match(scene, /Root question parent anchored to present-day Earth/);
  assert.match(scene, /getOrbitQuestionTargets:/, 'the virtual question parent is available to screen-space labels');
  assert.match(scene, /animateQuestionRefocus && !motionReduced/, 'active question time focus transitions respect reduced motion');
});
