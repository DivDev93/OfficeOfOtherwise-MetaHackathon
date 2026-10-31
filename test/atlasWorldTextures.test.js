import test from 'node:test';
import assert from 'node:assert/strict';
import { createWorldTextureFactory } from '../web/atlas/worldTextures.js';

function makeCanvas(width, height) {
  const context = {
    paths: [], images: [], globalAlpha: 1,
    clearRect() {}, drawImage(...args) { this.images.push(args); },
    beginPath() { this.currentPath = []; },
    moveTo(x, y) { this.currentPath.push([x, y]); },
    lineTo(x, y) { this.currentPath.push([x, y]); },
    closePath() {},
    fill() { this.paths.push({ color: this.fillStyle, points: [...this.currentPath], alpha: this.globalAlpha }); },
  };
  return { width, height, context, getContext: type => type === '2d' ? context : null };
}

const baseImage = { width: 8192, height: 4096, src: '/assets/earth-blue-marble.jpg' };
const change = (id, region, kind) => ({
  id, region, kind, intensity: .8,
  assumption: 'An illustrative physical condition persists.',
  uncertainty: 'The depicted extent is approximate.',
});
const world = (id, geography) => ({ id, geography });

test('v1 geography makes distinct world-specific current and mini canvases at capped dimensions', () => {
  const factory = createWorldTextureFactory({ canvasFactory: makeCanvas });
  const sahara = factory.create(world('sahara-world', { version: 1, changes: [change('green-sahara', 'sahara', 'vegetation')] }), { baseImage });
  const beringia = factory.create(world('beringia-world', { version: 1, changes: [change('beringia-land', 'beringia', 'land')] }), { baseImage });

  assert.equal(sahara.status, 'ready');
  assert.deepEqual(sahara.currentDimensions, { width: 2048, height: 1024 });
  assert.deepEqual(sahara.miniDimensions, { width: 512, height: 256 });
  assert.deepEqual([sahara.currentCanvas.width, sahara.currentCanvas.height], [2048, 1024]);
  assert.deepEqual([sahara.miniCanvas.width, sahara.miniCanvas.height], [512, 256]);
  assert.equal(sahara.currentCanvas.context.images[0][0], baseImage);
  assert.equal(sahara.miniCanvas.context.images[0][0], baseImage);
  assert.equal(sahara.currentCanvas.context.paths[0].color, '#2c9d52');
  assert.equal(beringia.currentCanvas.context.paths[0].color, '#b2a16e');
  assert.notDeepEqual(sahara.currentCanvas.context.paths[0].points, beringia.currentCanvas.context.paths[0].points);
  assert.deepEqual(sahara.geography.changes[0], change('green-sahara', 'sahara', 'vegetation'));
});

test('unsupported v2 is reported for scene-disc fallback and is never passed to the v1 painter', () => {
  let drawCalls = 0;
  const factory = createWorldTextureFactory({ canvasFactory: makeCanvas, draw() { drawCalls++; } });
  const result = factory.create(world('deep-sea', {
    version: 2, seaLevelMeters: -120, continentalTransforms: [], changes: [],
  }), { baseImage });
  assert.equal(result.status, 'unsupported');
  assert.equal(result.reason, 'geography-v2');
  assert.equal(result.fallback, 'scene-disc');
  assert.equal(drawCalls, 0);
  assert.equal(result.currentCanvas, undefined);
});

test('same world IDs invalidate changed geography or base identity and invoke eviction cleanup', () => {
  const evicted = [];
  const factory = createWorldTextureFactory({ canvasFactory: makeCanvas, onEvict: result => evicted.push(result) });
  const initial = factory.create(world('same-world', { version: 1, changes: [change('green-sahara', 'sahara', 'vegetation')] }), { baseImage, baseIdentity: 'earth-base-v1' });
  const changedGeo = factory.create(world('same-world', { version: 1, changes: [change('exposed-shelf', 'sundaland', 'land')] }), { baseImage, baseIdentity: 'earth-base-v1' });
  assert.notEqual(changedGeo, initial);
  assert.equal(factory.size, 1);
  assert.deepEqual(evicted, [initial]);
  const changedBase = factory.create(world('same-world', { version: 1, changes: [change('exposed-shelf', 'sundaland', 'land')] }), { baseImage, baseIdentity: 'earth-base-v2' });
  assert.notEqual(changedBase, changedGeo);
  assert.equal(factory.size, 1);
  assert.deepEqual(evicted, [initial, changedGeo]);
});

test('normalized identity cache hits and LRU stays bounded to 24 worlds', () => {
  let canvasCount = 0;
  const factory = createWorldTextureFactory({ canvasFactory(width, height) { canvasCount++; return makeCanvas(width, height); } });
  const saved = world('stable', { version: 1, changes: [change('green-sahara', 'sahara', 'vegetation')] });
  const first = factory.create(saved, { baseImage, baseIdentity: 'base' });
  const equivalent = factory.create({ ...saved, geography: { changes: saved.geography.changes, version: 1 } }, { baseImage, baseIdentity: 'base' });
  assert.equal(equivalent, first);
  assert.equal(canvasCount, 2, 'cache hit reuses both canvases');

  for (let index = 0; index < 24; index++) factory.create(world(`world-${index}`, undefined), { baseImage, baseIdentity: 'base' });
  assert.equal(factory.size, 24);
  const before = canvasCount;
  const recreated = factory.create(saved, { baseImage, baseIdentity: 'base' });
  assert.notEqual(recreated, first, 'least-recently-used entry was evicted');
  assert.equal(canvasCount, before + 2);
  assert.equal(factory.size, 24);
  factory.dispose();
  assert.equal(factory.size, 0);
});
