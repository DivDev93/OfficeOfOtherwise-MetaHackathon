import test from 'node:test';
import assert from 'node:assert/strict';
import { createWorldTextureFactory } from '../web/atlas/worldTextures.js';
import { paintGeography } from '../web/geographyTexture.js';

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

test('v1 geography waits for terrain and makes distinct current and mini canvases at capped dimensions', async () => {
  const terrain = { version: 'test-terrain' }, terrainCalls = [];
  const factory = createWorldTextureFactory({ canvasFactory: makeCanvas, loadTerrain: async () => terrain,
    draw(canvas, image, geography, _mode, _region, loadedTerrain) {
      terrainCalls.push(loadedTerrain);
      canvas.getContext('2d').drawImage(image, 0, 0);
      paintGeography(canvas.getContext('2d'), geography, canvas.width, canvas.height);
    } });
  const saharaPending = factory.create(world('sahara-world', { version: 1, changes: [change('green-sahara', 'sahara', 'vegetation')] }), { baseImage });
  const beringiaPending = factory.create(world('beringia-world', { version: 1, changes: [change('beringia-land', 'beringia', 'land')] }), { baseImage });
  assert.equal(saharaPending.status, 'pending');
  const [sahara, beringia] = await Promise.all([saharaPending.promise, beringiaPending.promise]);

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
  assert.deepEqual(terrainCalls, [terrain, terrain, terrain, terrain], 'the shared renderer receives terrain for both resolutions');
});

test('v2 geography loads terrain asynchronously and never becomes a permanent unsupported fallback', async () => {
  let drawCalls = 0;
  let ready;
  const factory = createWorldTextureFactory({ canvasFactory: makeCanvas, loadTerrain: async () => ({ raster: true }), onReady: result => { ready = result; }, draw(_canvas, _base, _geo, _mode, _region, terrain) { assert.deepEqual(terrain, { raster: true }); drawCalls++; } });
  const result = factory.create(world('deep-sea', {
    version: 2, seaLevelMeters: -120, continentalTransforms: [], changes: [],
  }), { baseImage });
  assert.equal(result.status, 'pending');
  assert.equal((await result.promise).status, 'ready');
  assert.equal(factory.create(world('deep-sea', { version: 2, seaLevelMeters: -120, continentalTransforms: [], changes: [] }), { baseImage }).status, 'ready');
  assert.equal(ready.status, 'ready');
  assert.equal(drawCalls, 2);
});

test('failed local terrain load is evicted so the next request can recover', async () => {
  let attempts = 0;
  const factory = createWorldTextureFactory({ canvasFactory: makeCanvas, draw() {},
    loadTerrain: async () => { if (++attempts === 1) throw new Error('temporary asset read failure'); return { raster: true }; } });
  const saved = world('retry-world', { version: 2, seaLevelMeters: -80, continentalTransforms: [], changes: [] });
  const failed = factory.create(saved, { baseImage });
  assert.equal(failed.status, 'pending');
  assert.equal(await failed.promise, null);
  assert.equal(factory.size, 0, 'the failed pending entry does not cache a permanent fallback');
  const retry = factory.create(saved, { baseImage });
  assert.equal(retry.status, 'pending');
  assert.equal((await retry.promise).status, 'ready');
  assert.equal(attempts, 2);
});

test('same world IDs invalidate changed geography or base identity and invoke eviction cleanup', async () => {
  const evicted = [];
  const factory = createWorldTextureFactory({ canvasFactory: makeCanvas, loadTerrain: async () => ({}), draw() {}, onEvict: result => evicted.push(result) });
  const initialPending = factory.create(world('same-world', { version: 1, changes: [change('green-sahara', 'sahara', 'vegetation')] }), { baseImage, baseIdentity: 'earth-base-v1' });
  const initial = await initialPending.promise;
  const changedPending = factory.create(world('same-world', { version: 1, changes: [change('exposed-shelf', 'sundaland', 'land')] }), { baseImage, baseIdentity: 'earth-base-v1' });
  const changedGeo = await changedPending.promise;
  assert.notEqual(changedGeo, initial);
  assert.equal(factory.size, 1);
  assert.deepEqual(evicted, [initial]);
  const changedBasePending = factory.create(world('same-world', { version: 1, changes: [change('exposed-shelf', 'sundaland', 'land')] }), { baseImage, baseIdentity: 'earth-base-v2' });
  const changedBase = await changedBasePending.promise;
  assert.notEqual(changedBase, changedGeo);
  assert.equal(factory.size, 1);
  assert.deepEqual(evicted, [initial, changedGeo]);
});

test('normalized identity cache hits and LRU stays bounded to 24 worlds', async () => {
  let canvasCount = 0;
  const factory = createWorldTextureFactory({ canvasFactory(width, height) { canvasCount++; return makeCanvas(width, height); }, loadTerrain: async () => ({}), draw() {} });
  const saved = world('stable', { version: 1, changes: [change('green-sahara', 'sahara', 'vegetation')] });
  const first = factory.create(saved, { baseImage, baseIdentity: 'base' });
  const equivalent = factory.create({ ...saved, geography: { changes: saved.geography.changes, version: 1 } }, { baseImage, baseIdentity: 'base' });
  assert.equal(equivalent, first);
  assert.equal(canvasCount, 2, 'cache hit reuses both canvases');
  const ready = await first.promise;

  for (let index = 0; index < 24; index++) factory.create(world(`world-${index}`, undefined), { baseImage, baseIdentity: 'base' });
  assert.equal(factory.size, 24);
  const before = canvasCount;
  const recreatedPending = factory.create(saved, { baseImage, baseIdentity: 'base' });
  const recreated = await recreatedPending.promise;
  assert.notEqual(recreated, ready, 'least-recently-used entry was evicted');
  assert.equal(ready.status, 'ready');
  assert.equal(canvasCount, before + 2);
  assert.equal(factory.size, 24);
  factory.dispose();
  assert.equal(factory.size, 0);
});
