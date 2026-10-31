import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createDemoServer } from '../server/index.js';
import { createEventCutoutStore } from '../src/demo/eventCutoutStore.js';
import { SpendCapError, markUndispatchedBudgetError } from '../src/lib/metaClient.js';

const headers = { 'x-demo-access-code': 'code', 'content-type': 'application/json' };
const png = Buffer.from('89504e470d0a1a0a010203', 'hex');
async function setup(t, generate, segment = async () => ({ buffer: png, mime: 'image/png' }), serverOptions = {}) {
  const base = await mkdtemp(join(tmpdir(), 'event-scene-'));
  const runsDir = join(base, 'cached'), liveRunsDir = join(base, 'live');
  await mkdir(join(runsDir, 'root'), { recursive: true }); await mkdir(liveRunsDir);
  const event = (id, title) => ({ id, title, summary: `Scene of ${title}`, year: 1200, place: { name: 'Sahara', lat: 20, lon: 12 }, scene: `Illustration of ${title}` });
  await writeFile(join(runsDir, 'root', 'branch.json'), JSON.stringify({ status: 'ok', divergence: 'What if the Sahara stayed green?', hero: { branchId: 'hero' }, branches: [event('hero', 'A lake'), event('other', 'A farm'), event('third', 'A garden'), event('fourth', 'A village')] }));
  await writeFile(join(runsDir, 'root', 'hero.png'), png);
  let calls = 0, prompts = [];
  const renderEventScene = async ({ prompt }) => { calls++; prompts.push(prompt); return generate ? generate() : { buffer: png, mime: 'image/png' }; };
  renderEventScene.enforcesDailyCap = true;
  let cutoutCalls = 0, cutoutInputs = [];
  const segmentEventCutout = async ({ image, prompt }) => { cutoutCalls++; cutoutInputs.push({ image, prompt }); return segment({ image, prompt }); };
  segmentEventCutout.enforcesDailyCap = true;
  let server;
  const start = async (env = { DEMO_ACCESS_CODE: 'code' }) => {
    server = createDemoServer({ runsDir, liveRunsDir, renderEventScene, segmentEventCutout, env, rateLimit: 100, ...serverOptions });
    await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
    return `http://127.0.0.1:${server.address().port}`;
  };
  const stop = () => new Promise(resolve => server.close(resolve));
  t.after(async () => { if (server.listening) await stop(); await rm(base, { recursive: true, force: true }); });
  return { url: await start(), start, stop, runsDir, liveRunsDir, calls: () => calls, prompts, cutoutCalls: () => cutoutCalls, cutoutInputs };
}
const get = (url, branch = 'other') => fetch(`${url}/api/event-scene?runId=root&branchId=${branch}`, { headers });
const post = (url, branch = 'other', opts = {}) => fetch(`${url}/api/event-scene`, { method: 'POST', headers, body: JSON.stringify({ runId: 'root', branchId: branch, ...opts }) });
const getCutout = (url, branch = 'hero') => fetch(`${url}/api/event-cutout?runId=root&branchId=${branch}`, { headers });
const postCutout = (url, branch = 'hero', opts = {}) => fetch(`${url}/api/event-cutout`, { method: 'POST', headers, body: JSON.stringify({ runId: 'root', branchId: branch, ...opts }) });

test('event cutouts use the selected event image, persist by event identity, and reuse saved output', async t => {
  const f = await setup(t);
  assert.equal((await fetch(`${f.url}/api/event-cutout`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ runId: 'root', branchId: 'hero' }) })).status, 403);
  assert.equal((await fetch(`${f.url}/api/event-cutout`, { method: 'POST', headers: { ...headers, origin: 'https://untrusted.example' }, body: JSON.stringify({ runId: 'root', branchId: 'hero' }) })).status, 403);
  assert.equal((await (await getCutout(f.url, 'hero')).json()).status, 'missing');
  const generated = await (await postCutout(f.url, 'hero')).json();
  assert.equal(generated.status, 'complete'); assert.equal(generated.reused, false);
  assert.match(f.cutoutInputs[0].prompt, /lake/);
  assert.deepEqual(f.cutoutInputs[0].image, png);
  assert.deepEqual(Buffer.from(await (await fetch(f.url + generated.url)).arrayBuffer()), png);
  assert.equal((await (await postCutout(f.url, 'hero')).json()).reused, true);
  assert.equal(f.cutoutCalls(), 1);
  await f.stop(); const url = await f.start({ DEMO_ACCESS_CODE: 'code', DEMO_REPLAY_ONLY: 'true' });
  assert.equal((await (await getCutout(url, 'hero')).json()).url, generated.url);
  assert.equal((await (await postCutout(url, 'hero')).json()).reused, true);
  assert.equal(f.cutoutCalls(), 1);
  assert.equal((await (await postCutout(url, 'other')).json()).status, 'missing-image');
});

test('hero event reuses a cutout already present in its saved run', async t => {
  const f = await setup(t);
  await writeFile(join(f.runsDir, 'root', 'cutout.png'), png);
  const result = await (await postCutout(f.url, 'hero')).json();
  assert.deepEqual(result, { status: 'complete', url: '/runs/root/cutout.png', reused: true });
  assert.equal(f.cutoutCalls(), 0);
});

test('event cutout with a valid empty SAM result is durably remembered without fabricating an image', async t => {
  const f = await setup(t, undefined, async () => ({ status: 'empty' }));
  assert.equal((await (await postCutout(f.url, 'hero')).json()).status, 'empty');
  assert.equal((await (await getCutout(f.url, 'hero')).json()).status, 'empty');
  await f.stop(); const url = await f.start();
  assert.equal((await (await postCutout(url, 'hero')).json()).status, 'empty');
  assert.equal(f.cutoutCalls(), 1);
});

test('alternate event cutout consumes that event scene, and prohibited event content is rejected before SAM', async t => {
  const f = await setup(t);
  const scene = await (await post(f.url, 'other')).json();
  assert.equal(scene.status, 'complete');
  assert.equal((await (await postCutout(f.url, 'other')).json()).status, 'complete');
  assert.deepEqual(f.cutoutInputs[0].image, png);
  assert.match(f.cutoutInputs[0].prompt, /Illustration of A farm/);
  const root = await (await fetch(`${f.url}/runs/root`)).json();
  root.branch.branches.find(item => item.id === 'other').summary = 'A battlefield during war';
  await writeFile(join(f.runsDir, 'root', 'branch.json'), JSON.stringify(root.branch));
  assert.equal((await postCutout(f.url, 'other')).status, 400);
  assert.equal(f.cutoutCalls(), 1);
});

test('event scenes use exact event, cache durably, and reuse the hero', async t => {
  const f = await setup(t);
  assert.equal((await (await get(f.url, 'hero')).json()).url, '/runs/root/hero.png');
  assert.equal((await (await get(f.url)).json()).status, 'missing');
  const generated = await (await post(f.url)).json();
  assert.equal(generated.status, 'complete'); assert.equal(generated.reused, false);
  assert.match(f.prompts[0], /A farm/); assert.doesNotMatch(f.prompts[0], /A lake/);
  assert.deepEqual(Buffer.from(await (await fetch(f.url + generated.url)).arrayBuffer()), png);
  assert.equal((await (await post(f.url)).json()).reused, true); assert.equal(f.calls(), 1);
  await f.stop(); const url = await f.start({ DEMO_ACCESS_CODE: 'code', DEMO_REPLAY_ONLY: 'true' });
  assert.equal((await (await get(url)).json()).url, generated.url);
  assert.equal((await (await post(url)).json()).reused, true); assert.equal(f.calls(), 1);
  assert.equal((await post(url, 'none')).status, 404);
  assert.equal((await post(url, 'other', { prompt: 'injected' })).status, 400);
  assert.equal((await fetch(`${url}/api/event-scene?runId=root&branchId=other`)).status, 200);
  assert.equal((await fetch(`${url}/api/event-scene`, { method: 'POST', body: JSON.stringify({ runId: 'root', branchId: 'other' }) })).status, 403);
  assert.equal((await fetch(`${url}/api/event-scene`, { method: 'POST', headers: { ...headers, origin: 'https://untrusted.example' }, body: JSON.stringify({ runId: 'root', branchId: 'other' }) })).status, 403);
});

test('concurrent requests do not dispatch the same image twice', async t => {
  let release; const pending = new Promise(resolve => { release = resolve; });
  const f = await setup(t, async () => { await pending; return { buffer: png, mime: 'image/png' }; });
  const first = post(f.url);
  while (!f.calls()) await new Promise(resolve => setTimeout(resolve, 5));
  assert.equal((await (await get(f.url)).json()).status, 'in-progress');
  assert.equal((await (await post(f.url)).json()).status, 'in-progress');
  release(); assert.equal((await (await first).json()).status, 'complete'); assert.equal(f.calls(), 1);
});

test('scene activity does not make a stale cutout reservation appear in progress', async t => {
  let release; const pending = new Promise(resolve => { release = resolve; });
  const f = await setup(t, async () => { await pending; return { buffer: png, mime: 'image/png' }; });
  // Seed the other store with a durable reservation, as if a previous server stopped mid-call.
  createEventCutoutStore(f.liveRunsDir).reserve('root', 'other');
  const scene = post(f.url, 'other');
  while (!f.calls()) await new Promise(resolve => setTimeout(resolve, 5));
  assert.equal((await (await getCutout(f.url, 'other')).json()).status, 'uncertain');
  release();
  assert.equal((await (await scene).json()).status, 'complete');
});

test('three independent live jobs can overlap while the shared cap rejects a fourth and releases slots', async t => {
  let release; const pending = new Promise(resolve => { release = resolve; });
  const f = await setup(t, async () => {
    if (f.calls() <= 2) await pending;
    return { buffer: png, mime: 'image/png' };
  }, async () => { await pending; return { buffer: png, mime: 'image/png' }; }, { maxConcurrentJobs: 3 });
  const firstScene = post(f.url, 'other');
  const secondScene = post(f.url, 'third');
  while (f.calls() < 2) await new Promise(resolve => setTimeout(resolve, 5));
  const cutout = postCutout(f.url, 'hero');
  while (f.cutoutCalls() < 1) await new Promise(resolve => setTimeout(resolve, 5));
  const rejectedRoot = await fetch(`${f.url}/api/run`, { method: 'POST', headers, body: JSON.stringify({ divergence: 'A green Sahara' }) });
  assert.equal(rejectedRoot.status, 429);
  assert.equal((await rejectedRoot.json()).status, 'retryable');
  release();
  assert.equal((await (await firstScene).json()).status, 'complete');
  assert.equal((await (await secondScene).json()).status, 'complete');
  assert.equal((await (await cutout).json()).status, 'complete');
  assert.equal((await (await post(f.url, 'fourth')).json()).status, 'complete');
  assert.equal(f.calls(), 3);
  assert.equal(f.cutoutCalls(), 1);
});

test('root runs share available capacity with event generation', async t => {
  let releaseScene, releaseRoot, rootStarted;
  const scenePending = new Promise(resolve => { releaseScene = resolve; });
  const rootPending = new Promise(resolve => { releaseRoot = resolve; });
  const rootReady = new Promise(resolve => { rootStarted = resolve; });
  const rootRunner = async ({ runId }) => { rootStarted(); await rootPending; return { runId }; };
  rootRunner.enforcesDailyCap = true;
  const f = await setup(t, async () => { await scenePending; return { buffer: png, mime: 'image/png' }; }, undefined,
    { maxConcurrentJobs: 2, runPipeline: rootRunner });
  const scene = post(f.url, 'other');
  while (!f.calls()) await new Promise(resolve => setTimeout(resolve, 5));
  const rootResponse = postRoot(f.url);
  await rootReady;
  const rejectedScene = await post(f.url, 'third');
  assert.equal(rejectedScene.status, 429);
  assert.equal((await rejectedScene.json()).status, 'retryable');
  releaseScene(); releaseRoot();
  assert.equal((await (await scene).json()).status, 'complete');
  assert.match(await (await rootResponse).text(), /event: complete/);
});

test('cutout capacity and event rate-limit rejections are marked retryable', async t => {
  let release; const pending = new Promise(resolve => { release = resolve; });
  const f = await setup(t, async () => { await pending; return { buffer: png, mime: 'image/png' }; }, undefined,
    { maxConcurrentJobs: 1 });
  const scene = post(f.url, 'other');
  while (!f.calls()) await new Promise(resolve => setTimeout(resolve, 5));
  const cutout = await postCutout(f.url, 'hero');
  assert.equal(cutout.status, 429);
  assert.equal((await cutout.json()).status, 'retryable');
  release();
  assert.equal((await (await scene).json()).status, 'complete');

  const limited = await setup(t, undefined, undefined, { rateLimit: 1 });
  assert.equal((await (await post(limited.url, 'other')).json()).status, 'complete');
  const sceneLimit = await post(limited.url, 'third');
  assert.equal(sceneLimit.status, 429);
  assert.equal((await sceneLimit.json()).status, 'retryable');
  const cutoutLimit = await postCutout(limited.url, 'hero');
  assert.equal(cutoutLimit.status, 429);
  assert.equal((await cutoutLimit.json()).status, 'retryable');
});

const postRoot = (url) => fetch(`${url}/api/run`, { method: 'POST', headers, body: JSON.stringify({ divergence: 'A green Sahara' }) });

test('live job concurrency limit rejects invalid configuration', () => {
  assert.throws(() => createDemoServer({ maxConcurrentJobs: 0 }), /maxConcurrentJobs/);
  assert.throws(() => createDemoServer({ maxConcurrentJobs: 9 }), /maxConcurrentJobs/);
});

test('provider failures remain durably uncertain and do not dispatch again', async t => {
  const f = await setup(t, () => { throw new Error('Provider outcome unknown'); });
  assert.equal((await (await post(f.url)).json()).status, 'uncertain');
  assert.equal((await (await post(f.url)).json()).status, 'uncertain');
  await f.stop(); const url = await f.start();
  assert.equal((await (await get(url)).json()).status, 'uncertain'); assert.equal(f.calls(), 1);
});

test('undispatched budget refusal explains the event scene estimate and releases its reservation', async t => {
  let calls = 0;
  const refused = markUndispatchedBudgetError(new SpendCapError(13.7006471020833, 0.1, 13.75783705), { dispatchCount: () => 0 }, 0);
  const f = await setup(t, () => { calls++; if (calls === 1) throw refused; return { buffer: png, mime: 'image/png' }; });
  const response = await post(f.url);
  const result = await response.json();
  assert.equal(response.status, 503);
  assert.equal(result.status, 'retryable');
  assert.equal(result.code, 'budget_exhausted');
  assert.match(result.error, /Meta generation allowance reached/);
  assert.match(result.error, /estimated at \$0\.1000; \$0\.0572 remains/);
  assert.equal((await (await get(f.url)).json()).status, 'missing', 'the proven undispatched reservation was released');
  assert.equal((await (await post(f.url)).json()).status, 'complete');
  assert.equal(calls, 2);
});

test('undispatched budget refusal explains the SAM estimate and releases its reservation', async t => {
  let calls = 0;
  const refused = markUndispatchedBudgetError(new SpendCapError(13.7006471020833, 0.1, 13.75783705), { dispatchCount: () => 0 }, 0);
  const f = await setup(t, undefined, async () => {
    calls++;
    if (calls === 1) throw refused;
    return { buffer: png, mime: 'image/png' };
  });
  const response = await postCutout(f.url);
  const result = await response.json();
  assert.equal(response.status, 503);
  assert.equal(result.status, 'retryable');
  assert.equal(result.code, 'budget_exhausted');
  assert.match(result.error, /Meta generation allowance reached/);
  assert.match(result.error, /estimated at \$0\.1000; \$0\.0572 remains/);
  assert.equal((await (await getCutout(f.url)).json()).status, 'missing', 'the proven undispatched reservation was released');
  assert.equal((await (await postCutout(f.url)).json()).status, 'complete');
  assert.equal(calls, 2);
});

test('cached events with prohibited scene text never reach the image runner', async t => {
  const f = await setup(t);
  const root = await (await fetch(`${f.url}/runs/root`)).json();
  root.branch.branches.find(item => item.id === 'other').scene = 'A battlefield during war';
  await writeFile(join(f.runsDir, 'root', 'branch.json'), JSON.stringify(root.branch));
  assert.equal((await post(f.url)).status, 400);
  assert.equal(f.calls(), 0);
  root.branch.branches.find(item => item.id === 'other').scene = 'A thriving lake';
  root.branch.branches.find(item => item.id === 'other').summary = 'A battlefield during war';
  await writeFile(join(f.runsDir, 'root', 'branch.json'), JSON.stringify(root.branch));
  assert.equal((await post(f.url)).status, 400);
  assert.equal(f.calls(), 0);
});
