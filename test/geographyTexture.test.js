import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { gunzipSync } from 'node:zlib';
import { projectCoordinate, unwrapRing, visibleChanges, paintGeography, drawGeographyCanvas, drawGeographyInsetCanvas, createGeographyRenderer } from '../web/geographyTexture.js';
import { REGIONS } from '../web/geographyRegions.js';
import { upgradeGeographyV1ToV2 } from '../web/geography.js';
import { applyTerrainScenario, createTerrainLoader, projectGeographyLocation, sampleTerrain } from '../web/terrainRaster.js';

const change = (region = 'sahara', kind = 'vegetation') => ({ id: `${region}-${kind}`, region, kind, intensity: 0.8, assumption: 'Illustrative local condition persists.', uncertainty: 'Location and coverage are approximate.' });
const geography = (...changes) => ({ version: 1, changes });
const sha256 = bytes => createHash('sha256').update(bytes).digest('hex');
function context() {
  return { paths: [], images: [], globalAlpha: 1, beginPath() { this.path = []; }, moveTo(x, y) { this.path.push([x,y]); }, lineTo(x,y) { this.path.push([x,y]); }, closePath() {}, fill() { this.paths.push({ color: this.fillStyle, points: this.path, alpha: this.globalAlpha }); }, clearRect() {}, drawImage(...args) { this.images.push(args); } };
}
test('equirectangular projection aligns poles, equator and regional bounds', () => {
  assert.deepEqual(projectCoordinate([-180,90], 360,180), [0,0]);
  assert.deepEqual(projectCoordinate([0,0], 360,180), [180,90]);
  assert.deepEqual(projectCoordinate([180,-90], 360,180), [360,180]);
  assert.deepEqual(projectCoordinate([79.6,9.6], 180,180, REGIONS['ram-setu'].bounds).map(Math.round), [90,90]);
});
test('Beringia crosses the dateline with short local edges and both map margins', () => {
  const ring = unwrapRing(REGIONS.beringia.polygons[0]);
  assert.ok(ring.some(([lon]) => lon > 180));
  for (let i=1; i<ring.length; i++) assert.ok(Math.abs(ring[i][0] - ring[i-1][0]) < 25);
  const ctx = context(); paintGeography(ctx, geography(change('beringia','land')),360,180);
  assert.ok(ctx.paths.some(path => path.points.some(([x])=>x>350)));
  assert.ok(ctx.paths.some(path => path.points.some(([x])=>x<10)));
});
test('lake masks are bounded local patches above vegetation, independent of input order', () => {
  const ctx = context(); paintGeography(ctx, geography(change('sahara','lake'), change()),360,180);
  assert.equal(ctx.paths.length, 9);
  assert.equal(ctx.paths[0].color,'#2c9d52');
  assert.equal(ctx.paths.at(-1).color,'#348cc2');
  assert.ok(REGIONS.sahara.kindPolygons.lake.every(ring => Math.max(...ring.map(point=>point[0])) - Math.min(...ring.map(point=>point[0])) < 5));
  assert.equal(ctx.globalAlpha, 1);
});
test('present-day and malformed or unsupported states paint only the reference; inset shares the toggle', () => {
  const scenario = geography(change('ram-setu','land'));
  for (const value of [undefined, {version:1,changes:[{...change(),region:'unknown'}]}]) assert.deepEqual(visibleChanges(value), []);
  assert.deepEqual(visibleChanges(scenario,'present'),[]);
  const ctx = context(), canvas = {width:540,height:210,getContext:()=>ctx}, image = {width:2048,height:1024};
  drawGeographyCanvas(canvas,image,scenario,'present','ram-setu');
  assert.equal(ctx.paths.length,0); assert.equal(ctx.images[0].length,9);
  drawGeographyCanvas(canvas,image,scenario,'scenario','ram-setu');
  assert.equal(ctx.paths.length,3);
});
test('late image completion applies only newest state after selection, present-day toggle and reset', async () => {
  let resolve; const pending = new Promise(done=>{resolve=done;}), frames=[];
  const renderer = createGeographyRenderer({ loadImage:()=>pending, loadTerrain:async()=>({}), paint:(image,state,mode)=>({state,mode}), apply:frame=>frames.push(frame) });
  const first = renderer.set(geography(change()));
  const second = renderer.set(geography(change('ram-setu','land')),'present');
  const reset = renderer.set(undefined,'present');
  resolve({});
  assert.deepEqual(await Promise.all([first,second,reset]),[false,false,true]);
  assert.deepEqual(frames,[{state:undefined,mode:'present'}]);
  await renderer.set(geography(change()),'scenario');
  assert.equal(frames.at(-1).state.changes[0].region,'sahara');
  renderer.dispose(); assert.equal(await renderer.set(undefined),false);
});

test('legacy regional scenarios wait for terrain so saved masks render against elevation', async () => {
  const terrain = { elevation: new Int16Array([123]) };
  let loads = 0, received;
  const renderer = createGeographyRenderer({ loadImage: async()=>({}), loadTerrain: async()=>{ loads++; return terrain; },
    paint: (image,state,mode,loadedTerrain)=>{ received={state,mode,loadedTerrain}; return received; }, apply:()=>{} });
  assert.equal(await renderer.set(geography(change('sahara','lake'))), true);
  assert.equal(loads, 1);
  assert.equal(received.loadedTerrain, terrain);
  await renderer.set(geography(), 'scenario');
  assert.equal(loads, 1, 'empty v1 states do not need the terrain rasters');
  renderer.dispose();
});

test('synthetic terrain raster samples meters and clips global vegetation to land elevation', () => {
  const width = 8, height = 4, elevation = new Int16Array(width * height).fill(500), landmass = new Uint8Array(width * height).fill(1);
  elevation[3 * width + 4] = 0; landmass[3 * width + 4] = 0;
  const terrain = { width, height, elevation, landmass };
  assert.deepEqual(sampleTerrain(terrain, 22.5, -67.5), { height: 0, continent: 0 });
  const highResolution = { ...terrain, sahara: { width: 2, height: 2, bounds: [-2, 0, 2, 2], elevation: new Int16Array([1,2,3,4]) } };
  assert.equal(sampleTerrain(highResolution, -1, 1).height, 3, 'regional high resolution terrain supersedes the global sample');
  const data = new Uint8ClampedArray(8 * 4 * 4).fill(100);
  for (let i = 3; i < data.length; i += 4) data[i] = 255;
  const result = applyTerrainScenario({ data, width: 8, height: 4 }, terrain, {
    version: 2, seaLevelMeters: 0, continentalTransforms: [],
    changes: [{ bounds: [-180, -90, 180, 90], kind: 'vegetation', intensity: .8 }],
  });
  assert.equal(result.applied, true);
  assert.ok(data[0] < 100);
  assert.equal(data[(3 * width + 4) * 4], 100, 'ocean pixels remain unchanged by vegetation');
});

test('bounded land changes expose DEM shelf pixels and legacy Beringia uses the DEM contour', () => {
  const width = 360, height = 180, elevation = new Int16Array(width * height).fill(-50), landmass = new Uint8Array(width * height);
  const pixels = new Uint8ClampedArray(width * height * 4).fill(100);
  for (let i = 3; i < pixels.length; i += 4) pixels[i] = 255;
  const beringia = upgradeGeographyV1ToV2(geography(change('beringia', 'land')));
  applyTerrainScenario({ data: pixels, width, height }, { width, height, elevation, landmass }, beringia);
  const exposed = Math.floor((170 + 180) / 360 * width), exposedY = Math.floor((90 - 66) / 180 * height), index = exposedY * width + exposed;
  assert.ok(pixels[index * 4] > 100, 'the upgraded regional selector is shaded from the elevation raster');
  const datelineX = Math.floor((-170 + 180) / 360 * width), datelineIndex = exposedY * width + datelineX;
  assert.ok(pixels[datelineIndex * 4] > 100, 'the DEM-derived shelf continues across the dateline');
  const featherX = Math.floor((162.5 + 180) / 360 * width), featherIndex = exposedY * width + featherX;
  assert.ok(pixels[featherIndex * 4] > 100, 'the shallow shelf fades in across the regional boundary');
  const edgeX = Math.floor((160.5 + 180) / 360 * width), edgeIndex = exposedY * width + edgeX;
  assert.equal(pixels[edgeIndex * 4], 100, 'the feather prevents a hard rectangular cutoff at the first in-bounds cells');
  const outsideX = Math.floor((100 + 180) / 360 * width), outsideIndex = exposedY * width + outsideX;
  assert.equal(pixels[outsideIndex * 4], 100, 'the bounded change does not paint unrelated shelf cells');
});

test('generic v2 land elevation delta can expose ocean floor inside its bounds', () => {
  const width = 8, height = 4, elevation = new Int16Array(width * height).fill(-100), landmass = new Uint8Array(width * height);
  elevation[1 * width + 2] = 500; landmass[1 * width + 2] = 2;
  elevation[1 * width + 4] = -1000;
  const data = new Uint8ClampedArray(width * height * 4).fill(100);
  for (let i = 3; i < data.length; i += 4) data[i] = 255;
  const result = applyTerrainScenario({ data, width, height }, { width, height, elevation, landmass }, {
    version: 2, seaLevelMeters: 0, continentalTransforms: [],
    changes: [{ bounds: [-90, -45, 90, 45], kind: 'land', intensity: 1, elevationDeltaMeters: 150,
      assumption: 'Illustrative regional uplift.', uncertainty: 'Five-minute terrain cells do not resolve local shorelines.' }],
  });
  assert.equal(result.applied, true);
  assert.equal(result.elevation[1 * width + 3], 50, 'the adjusted elevation is retained for terrain-aware overlays');
  assert.ok(data[(1 * width + 3) * 4] > 100, 'dry DEM pixels inside the bounds are visibly shaded');
  assert.equal(data[(1 * width + 2) * 4], 100, 'existing dry land retains its basemap color');
  assert.equal(data[(1 * width + 4) * 4], 100, 'deep ocean below the uplift threshold retains its basemap color');
  assert.equal(data[0], 100, 'unaffected ocean stays unchanged');
  const forested = new Uint8ClampedArray(8 * 4 * 4).fill(100);
  for (let i = 3; i < forested.length; i += 4) forested[i] = 255;
  applyTerrainScenario({ data: forested, width, height }, { width, height, elevation, landmass }, {
    version: 2, seaLevelMeters: 0, continentalTransforms: [],
    changes: [
      { bounds: [-90,-45,90,45], kind: 'land', intensity: 1, elevationDeltaMeters: 150 },
      { bounds: [-90,-45,90,45], kind: 'vegetation', intensity: 1 },
    ],
  });
  const upliftPixel = 1 * width + 3;
  assert.ok(forested[upliftPixel * 4 + 1] / forested[upliftPixel * 4] > data[upliftPixel * 4 + 1] / data[upliftPixel * 4], 'vegetation overlays land exposed by local uplift');
  const reversed = new Uint8ClampedArray(8 * 4 * 4).fill(100);
  for (let i = 3; i < reversed.length; i += 4) reversed[i] = 255;
  applyTerrainScenario({ data: reversed, width, height }, { width, height, elevation, landmass }, {
    version: 2, seaLevelMeters: 0, continentalTransforms: [],
    changes: [
      { bounds: [-90,-45,90,45], kind: 'vegetation', intensity: 1 },
      { bounds: [-90,-45,90,45], kind: 'land', intensity: 1, elevationDeltaMeters: 150 },
    ],
  });
  assert.deepEqual(reversed, forested, 'exposure and forest overlay do not depend on change-array order');
});

test('synthetic terrain raster moves continent color and keeps present-day rendering exact', () => {
  const width = 8, height = 4, elevation = new Int16Array(width * height).fill(900), landmass = new Uint8Array(width * height);
  landmass[1 * width + 2] = 1;
  const data = new Uint8ClampedArray(width * height * 4);
  for (let i = 0; i < width * height; i++) { data[i*4] = i; data[i*4+1] = 80; data[i*4+2] = 120; data[i*4+3] = 255; }
  const baseline = new Uint8ClampedArray(data);
  const result = applyTerrainScenario({ data, width, height }, { width, height, elevation, landmass }, {
    version: 2, seaLevelMeters: 0,
    continentalTransforms: [{ continentId: 'africa', longitudeOffsetDeg: 90, latitudeOffsetDeg: 0, rotationDeg: 0 }], changes: [],
  });
  assert.equal(result.applied, true);
  assert.deepEqual([...data.slice((1 * width + 2) * 4, (1 * width + 2) * 4 + 3)], [28, 73, 105]);
  assert.equal(data[(1 * width + 4) * 4], 10, 'translated source color occupies its destination');
  assert.equal(result.elevation[1 * width + 4], 900, 'translated elevation follows the same rigid transform');
  assert.equal(result.elevation[1 * width + 2], -32768, 'vacated source location has no invented elevation');

  const latitudeData = new Uint8ClampedArray(baseline);
  const latitudeState = { version: 2, seaLevelMeters: 0,
    continentalTransforms: [{ continentId: 'africa', longitudeOffsetDeg: 0, latitudeOffsetDeg: 45, rotationDeg: 0 }], changes: [] };
  const moved = projectGeographyLocation({ lon: -67.5, lat: 22.5 }, latitudeState, { width, height, elevation, landmass });
  const movedX = Math.floor((moved.lon + 180) / 360 * width), movedY = Math.floor((90 - moved.lat) / 180 * height), movedPixel = movedY * width + movedX;
  const latitudeResult = applyTerrainScenario({ data: latitudeData, width, height }, { width, height, elevation, landmass }, latitudeState);
  assert.equal(latitudeData[movedPixel * 4], 10, 'latitude-only placement writes the raster pixel where projected anchors land');
  assert.equal(latitudeResult.elevation[movedPixel], 900);
});

test('latitude and longitude placement inverse-resamples a continent without splat gaps', () => {
  const width = 32, height = 16, elevation = new Int16Array(width * height).fill(-1000), landmass = new Uint8Array(width * height);
  for (let y = 4; y <= 11; y++) for (let x = 8; x <= 15; x++) { const i = y * width + x; elevation[i] = 500; landmass[i] = 1; }
  const data = new Uint8ClampedArray(width * height * 4);
  for (let i = 0; i < width * height; i++) { data[i*4] = i % 251; data[i*4+1] = 80; data[i*4+2] = 120; data[i*4+3] = 255; }
  const geography = { version: 2, seaLevelMeters: 0, continentalTransforms: [{ continentId: 'africa', longitudeOffsetDeg: 25, latitudeOffsetDeg: 20, rotationDeg: 12 }], changes: [] };
  const expected = new Map(), expectedCore = new Map();
  for (let y = 4; y <= 11; y++) for (let x = 8; x <= 15; x++) {
    const lon = -180 + (x + .5) * 360 / width, lat = 90 - (y + .5) * 180 / height;
    const moved = projectGeographyLocation({ lon, lat }, geography, { width, height, elevation, landmass });
    const mx = Math.floor((moved.lon + 180) / 360 * width), my = Math.floor((90 - moved.lat) / 180 * height), dest = my * width + mx;
    const values = expected.get(dest) || new Set(); values.add(data[(y * width + x) * 4]); expected.set(dest, values);
    if (x >= 10 && x <= 13 && y >= 6 && y <= 9) { const core = expectedCore.get(dest) || new Set(); core.add(data[(y * width + x) * 4]); expectedCore.set(dest, core); }
  }
  applyTerrainScenario({ data, width, height }, { width, height, elevation, landmass }, geography);
  const mismatches = [...expected].filter(([dest, colors]) => !colors.has(data[dest * 4]));
  assert.ok(mismatches.length <= Math.ceil(expected.size * .05), 'inverse resampling fills interior pixels; only isolated coast edge cells may fall between raster samples');
  assert.equal([...expectedCore].filter(([dest, colors]) => !colors.has(data[dest * 4])).length, 0, 'the projected continent core has no splat holes');
});

test('global sea rise floods only low terrain connected to ocean and projects anchors with raster transform', () => {
  const width = 5, height = 3, elevation = new Int16Array(width * height).fill(1000), landmass = new Uint8Array(width * height).fill(1);
  landmass[0] = landmass[5] = landmass[10] = 0; elevation[0] = -500; elevation[5] = elevation[10] = -100;
  elevation[6] = 0; elevation[8] = 0;
  const terrain = { width, height, elevation, landmass }, data = new Uint8ClampedArray(width * height * 4).fill(100);
  for (let i = 3; i < data.length; i += 4) data[i] = 255;
  applyTerrainScenario({ data, width, height }, terrain, { version: 2, seaLevelMeters: 1, continentalTransforms: [], changes: [] });
  assert.ok(data[6 * 4 + 2] > 100, 'connected lowland is water colored');
  assert.equal(data[8 * 4], 100, 'isolated depression remains dry');
  const fallData = new Uint8ClampedArray(width * height * 4).fill(100);
  for (let i = 3; i < fallData.length; i += 4) fallData[i] = 255;
  applyTerrainScenario({ data: fallData, width, height }, terrain, { version: 2, seaLevelMeters: -200, continentalTransforms: [], changes: [] });
  assert.notEqual(fallData[5 * 4], 100, 'higher shallow shelf becomes exposed when sea level falls');
  assert.equal(fallData[0], 100, 'deeper ocean remains underwater when sea level falls');
  const projected = projectGeographyLocation({ name: 'anchor', lon: -36, lat: 0 }, { version: 2, continentalTransforms: [{ continentId: 'africa', longitudeOffsetDeg: 90, latitudeOffsetDeg: 0, rotationDeg: 0 }] }, terrain);
  assert.ok(Math.abs(projected.lon - 54) < .3);
  assert.ok(Math.abs(projected.lat) < 5);
  assert.equal(projected.name, 'anchor');
});

test('lowered sea paints deterministic opaque land while preserving dry land and deep water', () => {
  const width = 8, height = 4, elevation = new Int16Array(width * height).fill(-100), landmass = new Uint8Array(width * height);
  const dryLand = 1 * width + 2, exposed = 1 * width + 4, deepWater = 1 * width + 6;
  elevation[dryLand] = 500; landmass[dryLand] = 1;
  elevation[exposed] = -50; elevation[deepWater] = -1000;
  const terrain = { width, height, elevation, landmass };
  const makeWaterFrame = () => {
    const data = new Uint8ClampedArray(width * height * 4);
    for (let i = 0; i < width * height; i++) { data.set([36, 111, 153, 255], i * 4); }
    return data;
  };
  const bare = makeWaterFrame(), forested = makeWaterFrame();
  const state = { version: 2, seaLevelMeters: -75, continentalTransforms: [], changes: [] };
  applyTerrainScenario({ data: bare, width, height }, terrain, state);
  applyTerrainScenario({ data: forested, width, height }, terrain, { ...state, changes: [{ bounds: [-180,-90,180,90], kind: 'vegetation', intensity: 1 }] });
  const rgb = (data, index) => [...data.slice(index * 4, index * 4 + 3)];
  assert.notDeepEqual(rgb(bare, exposed), [36,111,153], 'exposed DEM ground replaces the ocean blue with land material');
  assert.equal(bare[exposed * 4 + 3], 255, 'exposed material is opaque');
  assert.deepEqual(rgb(bare, dryLand), [36,111,153], 'present-day dry land keeps its basemap color');
  assert.deepEqual(rgb(bare, deepWater), [36,111,153], 'terrain below the lowered sea threshold stays underwater');
  assert.ok(rgb(forested, exposed)[1] / rgb(forested, exposed)[0] > rgb(bare, exposed)[1] / rgb(bare, exposed)[0], 'explicit vegetation overlays scenario-exposed ground with a greener palette');
  assert.notDeepEqual(rgb(forested, exposed), rgb(forested, 1 * width + 3), 'exposed forest has coherent spatial canopy texture rather than a flat green fill');
  assert.equal(forested[exposed * 4 + 3], 255, 'scenario-exposed canopy fully covers the ocean basemap');
  const edge = makeWaterFrame(), noCover = makeWaterFrame();
  applyTerrainScenario({ data: edge, width, height }, terrain, { ...state, changes: [{ bounds: [-180,-45,180,22.5], kind: 'vegetation', intensity: 1 }] });
  applyTerrainScenario({ data: noCover, width, height }, terrain, { ...state, changes: [{ bounds: [-180,-90,180,90], kind: 'vegetation', intensity: 0 }] });
  assert.deepEqual(rgb(edge, exposed), rgb(bare, exposed), 'zero feather coverage leaves exposed earth unchanged at the region edge');
  assert.deepEqual(rgb(noCover, exposed), rgb(bare, exposed), 'zero vegetation intensity leaves exposed earth unchanged');
  const repeated = makeWaterFrame();
  applyTerrainScenario({ data: repeated, width, height }, terrain, state);
  assert.deepEqual(rgb(repeated, exposed), rgb(bare, exposed), 'terrain material texture is deterministic');
  assert.notDeepEqual(rgb(bare, 1 * width + 3), rgb(bare, exposed), 'spatial texture varies across exposed ground');
});

test('v2 geography inset crops the terrain-composited global frame', () => {
  function makeContext(canvas) {
    return { images: [], clearRect() {}, drawImage(...args) { this.images.push(args); }, getImageData() { return { data: new Uint8ClampedArray(canvas.width * canvas.height * 4) }; }, putImageData() {} };
  }
  const source = { width: 360, height: 180 }, image = { width: 360, height: 180 }, terrain = { width: 1, height: 1, elevation: new Int16Array([10]), landmass: new Uint8Array([1]) };
  const outputContext = makeContext(source); source.getContext = () => outputContext;
  let scratch;
  drawGeographyInsetCanvas(source, image, { version: 2, seaLevelMeters: 0, continentalTransforms: [], changes: [] }, 'scenario', 'ram-setu', terrain,
    (width, height) => { scratch = { width, height, getContext: () => makeContext(scratch) }; return scratch; });
  assert.equal(outputContext.images.length, 1);
  assert.equal(outputContext.images[0][0], scratch);
  assert.equal(outputContext.images[0].length, 9);
});

test('v2 inset caps its full-frame terrain pass at the shared globe texture width', () => {
  function makeContext(canvas) {
    return { images: [], clearRect() {}, drawImage(...args) { this.images.push(args); }, getImageData() { return { data: new Uint8ClampedArray(canvas.width * canvas.height * 4) }; }, putImageData() {} };
  }
  const output = { width: 480, height: 240 }, outputContext = makeContext(output); output.getContext = () => outputContext;
  const image = { width: 8192, height: 4096 }, terrain = { width: 1, height: 1, elevation: new Int16Array([10]), landmass: new Uint8Array([1]) };
  let scratchSize;
  drawGeographyInsetCanvas(output, image, { version: 2, seaLevelMeters: 0, continentalTransforms: [], changes: [] }, 'scenario', 'ram-setu', terrain,
    (width, height) => { scratchSize = [width, height]; const scratch = { width, height }; scratch.getContext = () => makeContext(scratch); return scratch; });
  assert.deepEqual(scratchSize, [4096, 2048]);
});

test('global scenario pixels and heightfield are reused between globe and inset canvases', () => {
  const terrain = { width: 8, height: 4, elevation: new Int16Array(32).fill(100), landmass: new Uint8Array(32).fill(1) };
  const image = { width: 8, height: 4, src: '/assets/shared-earth-test.jpg' };
  const geography = { version: 2, seaLevelMeters: 1, continentalTransforms: [], changes: [] };
  const makeCanvas = () => {
    const canvas = { width: 8, height: 4, output: null };
    const context = { clearRect() {}, drawImage() {}, getImageData() { const data = new Uint8ClampedArray(8 * 4 * 4); for (let i = 3; i < data.length; i += 4) data[i] = 255; return { data }; }, putImageData(pixels) { canvas.output = pixels; } };
    canvas.getContext = () => context; return canvas;
  };
  const first = makeCanvas(), second = makeCanvas();
  drawGeographyCanvas(first, image, geography, 'scenario', undefined, terrain);
  drawGeographyCanvas(second, { ...image }, geography, 'scenario', undefined, terrain);
  assert.strictEqual(second.terrainElevation, first.terrainElevation);
  assert.deepEqual(second.output.data, first.output.data);
});

test('lake basin seed stays on owned land when its bounds include much deeper ocean', () => {
  const width = 8, height = 4, elevation = new Int16Array(width * height).fill(1000), landmass = new Uint8Array(width * height).fill(1);
  for (let y = 0; y < height; y++) { elevation[y * width] = -5000; landmass[y * width] = 0; }
  elevation[2 * width + 4] = elevation[2 * width + 5] = 250;
  const data = new Uint8ClampedArray(width * height * 4).fill(100);
  for (let i = 3; i < data.length; i += 4) data[i] = 255;
  applyTerrainScenario({ data, width, height }, { width, height, elevation, landmass }, {
    version: 2, seaLevelMeters: 0, continentalTransforms: [],
    changes: [{ kind: 'lake', bounds: [-180,-90,180,90], seed: [22.5,-22.5], waterLevelMeters: 300, intensity: 1 }],
  });
  assert.ok(data[(2 * width + 4) * 4] < 100, 'seeded continental basin is water colored');
  assert.ok(data[(2 * width + 5) * 4] < 100, 'connected lowland remains in the basin');
  assert.equal(data[0], 100, 'unrelated deep ocean is never selected as a lake');
  const unsupported = new Uint8ClampedArray(width * height * 4).fill(100);
  const rejected = applyTerrainScenario({ data: unsupported, width, height }, { width, height, elevation, landmass }, {
    version: 2, seaLevelMeters: 0, continentalTransforms: [],
    changes: [{ kind: 'lake', bounds: [-180,-90,180,90], seed: [-157.5,67.5], waterLevelMeters: 300, intensity: 1 }],
  });
  assert.equal(rejected.applied, false, 'an ocean seed does not relocate to a distant basin');
  assert.equal(unsupported[2 * width + 4], 100, 'unsupported basin leaves the frame untouched');
});

test('shipped elevation and landmass rasters match their metadata and distinguish coast from inland relief', async () => {
  const metadata = JSON.parse(await readFile(new URL('../web/assets/terrain/terrain-metadata.json', import.meta.url), 'utf8'));
  for (const dataset of Object.values(metadata.datasets)) {
    const compressed = await readFile(new URL(`../web${dataset.file}`, import.meta.url));
    const uncompressed = gunzipSync(compressed);
    assert.equal(compressed.byteLength, dataset.compressedBytes, `${dataset.file} compressed byte count`);
    assert.equal(sha256(compressed), dataset.compressedSha256, `${dataset.file} compressed SHA-256`);
    assert.equal(uncompressed.byteLength, dataset.uncompressedBytes, `${dataset.file} uncompressed byte count`);
    assert.equal(sha256(uncompressed), dataset.uncompressedSha256, `${dataset.file} uncompressed SHA-256`);
  }

  const terrain = await createTerrainLoader({ fetchImpl: async url => {
    const asset = await readFile(new URL(`../web/assets/terrain/${url.split('/').at(-1)}`, import.meta.url));
    return new Response(asset);
  } })();
  assert.deepEqual(sampleTerrain(terrain, 10, 24), { height: 1079, continent: 1 }, 'Sahara inland relief');
  assert.deepEqual(sampleTerrain(terrain, -20, 15), { height: -3858, continent: 0 }, 'Atlantic ocean beyond the West African coast');
  assert.deepEqual(sampleTerrain(terrain, 86, 28), { height: 3861, continent: 2 }, 'Eurasian mountain relief');
});
