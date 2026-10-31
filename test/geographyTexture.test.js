import test from 'node:test';
import assert from 'node:assert/strict';
import { projectCoordinate, unwrapRing, safeGeography, visibleChanges, paintGeography, drawGeographyCanvas, createGeographyRenderer } from '../web/geographyTexture.js';
import { REGIONS } from '../web/geographyRegions.js';

const change = (region = 'sahara', kind = 'vegetation') => ({ id: `${region}-${kind}`, region, kind, intensity: 0.8, assumption: 'Illustrative local condition persists.', uncertainty: 'Location and coverage are approximate.' });
const geography = (...changes) => ({ version: 1, changes });
function context() {
  return { paths: [], images: [], globalAlpha: 1, beginPath() { this.path = []; }, moveTo(x, y) { this.path.push([x,y]); }, lineTo(x,y) { this.path.push([x,y]); }, closePath() {}, fill() { this.paths.push({ color: this.fillStyle, points: this.path, alpha: this.globalAlpha }); }, clearRect() {}, drawImage(...args) { this.images.push(args); } };
}
test('equirectangular projection aligns poles, equator and regional bounds', () => {
  assert.deepEqual(projectCoordinate([-180,90], 360,180), [0,0]);
  assert.deepEqual(projectCoordinate([0,0], 360,180), [180,90]);
  assert.deepEqual(projectCoordinate([180,-90], 360,180), [360,180]);
  assert.deepEqual(projectCoordinate([79.6,9.6], 180,180, REGIONS['ram-setu'].bounds).map(Math.round), [90,90]);
});
test('v2 ancestry is never passed to the v1 atlas renderer', () => {
  const v2={version:2,seaLevelMeters:-120,continentalTransforms:[],changes:[{id:'shelf',kind:'vegetation',intensity:0.7,bounds:[-2,50,8,58.5],assumption:'Marshes persist.',uncertainty:'Coverage varies.'}]};
  assert.equal(safeGeography(v2),undefined);
  assert.deepEqual(visibleChanges(v2),[]);
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
  const renderer = createGeographyRenderer({ loadImage:()=>pending, paint:(image,state,mode)=>({state,mode}), apply:frame=>frames.push(frame) });
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
