import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createDemoServer } from '../server/index.js';

async function fixture(t, options = {}) {
  const base = await mkdtemp(join(tmpdir(), 'office-demo-'));
  const runsDir = join(base, 'runs'), webDir = join(base, 'web');
  await mkdir(join(runsDir, 'orrery'), { recursive: true }); await mkdir(webDir);
  await writeFile(join(webDir, 'index.html'), '<h1>Demo</h1>');
  await writeFile(join(runsDir, 'orrery', 'branch.json'), JSON.stringify({ status: 'ok', divergence: 'What if?', hero: { title: 'Orrery' } }));
  await writeFile(join(runsDir, 'orrery', 'hero.png'), Buffer.from('png'));
  const server = createDemoServer({ runsDir, webDir, env: { DEMO_ACCESS_CODE: 'private-code', DEMO_DAILY_CAP_USD: '1' }, ...options });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(async () => { await new Promise(resolve => server.close(resolve)); await rm(base, { recursive: true, force: true }); });
  return `http://127.0.0.1:${server.address().port}`;
}
const post = (url, code = 'private-code') => fetch(`${url}/api/run`, { method: 'POST', headers: { 'x-demo-access-code': code, 'content-type': 'application/json' }, body: JSON.stringify({ divergence: 'What if?' }) });
function fake(fn) { fn.enforcesDailyCap = true; return fn; }

test('lists replay and serves allowlisted assets and HEAD', async t => {
  const url = await fixture(t);
  const list = await (await fetch(`${url}/runs`)).json();
  assert.deepEqual(list.runs, [{ id: 'orrery', title: 'Orrery', divergence: 'What if?', status: 'ok', hasModel: false }]);
  assert.match(await (await fetch(url)).text(), /Demo/);
  const img = await fetch(`${url}/runs/orrery/hero.png`, { method: 'HEAD' });
  assert.equal(img.status, 200); assert.equal(img.headers.get('content-type'), 'image/png'); assert.equal(await img.text(), '');
  assert.equal((await fetch(`${url}/runs/orrery/secret.txt`)).status, 404);
  assert.equal((await fetch(`${url}/runs/%2e%2e%2fsecret`)).status, 404);
});

test('live gate defaults to replay and refuses runners without daily-cap enforcement', async t => {
  const url = await fixture(t, { runPipeline: async () => ({}) });
  assert.equal((await post(url, 'wrong')).status, 403);
  assert.equal((await post(url)).status, 503);
  const unset = await fixture(t, { env: {}, runPipeline: fake(async () => ({})) });
  assert.equal((await post(unset, '')).status, 403);
});

test('streams named events in order and redacts credentials', async t => {
  const runner = fake(async ({ onStep, dailyCapUsd }) => {
    assert.equal(dailyCapUsd, 1);
    for (const step of ['policy', 'propose', 'review', 'image', 'cutout', '3d']) onStep({ step, runId: 'sample', message: 'private-code', token: 'hidden' });
    return { runId: 'sample' };
  });
  const url = await fixture(t, { runPipeline: runner });
  const response = await post(url); assert.equal(response.status, 200);
  const text = await response.text();
  assert.deepEqual([...text.matchAll(/^event: (.+)$/gm)].map(m => m[1]), ['policy', 'propose', 'review', 'image', 'cutout', '3d', 'complete']);
  assert.doesNotMatch(text, /private-code|hidden/);
});

test('rate limits and excludes concurrent sessions', async t => {
  let release, started;
  const ready = new Promise(r => { started = r; });
  const runner = fake(async () => { started(); await new Promise(r => { release = r; }); return { runId: 'one' }; });
  const url = await fixture(t, { runPipeline: runner, rateLimit: 2 });
  const first = await post(url); await ready;
  assert.equal((await post(url)).status, 429);
  assert.equal((await post(url)).status, 429);
  release(); await first.text();
});

test('serves only registered live run assets after progress and rejects traversal', async t => {
  const liveRunsDir = await mkdtemp(join(tmpdir(), 'office-live-'));
  t.after(() => rm(liveRunsDir, { recursive: true, force: true }));
  await mkdir(join(liveRunsDir, 'run-123'));
  await writeFile(join(liveRunsDir, 'spend.json'), '{"private":true}');
  await writeFile(join(liveRunsDir, 'run-123', 'hero.png'), Buffer.from('live image'));
  let release, signalReady;
  const ready = new Promise(resolve => { signalReady = resolve; });
  const runner = fake(async ({ onStep }) => {
    onStep({ step: 'image', runId: 'run-123' });
    signalReady();
    await new Promise(resolve => { release = resolve; });
    return { runId: 'run-123' };
  });
  const url = await fixture(t, { runPipeline: runner, liveRunsDir });
  assert.equal((await fetch(`${url}/runs/run-123/hero.png`)).status, 404);
  const response = await post(url); await ready;
  const head = await fetch(`${url}/runs/run-123/hero.png`, { method: 'HEAD' });
  assert.equal(head.status, 200); assert.equal(head.headers.get('content-type'), 'image/png');
  assert.equal(await (await fetch(`${url}/runs/run-123/hero.png`)).text(), 'live image');
  assert.equal((await fetch(`${url}/runs/run-123/spend.json`)).status, 404);
  assert.equal((await fetch(`${url}/runs/run-123/%2e%2e%2fspend.json`)).status, 404);
  release(); await response.text();
});

test('run manifests expose only safe metadata for cached and registered live runs', async t => {
  const liveRunsDir = await mkdtemp(join(tmpdir(), 'office-manifest-'));
  t.after(() => rm(liveRunsDir, { recursive: true, force: true }));
  await mkdir(join(liveRunsDir, 'live-1'));
  await writeFile(join(liveRunsDir, 'live-1', 'branch.json'), JSON.stringify({ status: 'ok', divergence: 'Geography', secret: 'hidden', hero: { title: 'Live' } }));
  const runner = fake(async ({ onStep }) => { onStep({ step: 'policy', runId: 'live-1' }); return { runId: 'live-1' }; });
  const url = await fixture(t, { liveRunsDir, runPipeline: runner });
  const cached = await (await fetch(`${url}/runs/orrery`)).json();
  assert.equal(cached.id, 'orrery'); assert.equal(cached.branch.divergence, 'What if?');
  assert.equal(cached.assetUrls['hero.png'], '/runs/orrery/hero.png');
  assert.equal(cached.hasModel, false);
  assert.equal((await fetch(`${url}/runs/live-1`)).status, 404);
  await (await post(url)).text();
  const live = await (await fetch(`${url}/runs/live-1`)).json();
  assert.equal(live.id, 'live-1'); assert.equal(live.branch.divergence, 'Geography');
  assert.equal(live.branch.secret, undefined); assert.equal(live.assetUrls['branch.json'], '/runs/live-1/branch.json');
  assert.equal((await fetch(`${url}/runs/live-1`, { method: 'HEAD' })).status, 200);
  assert.equal((await fetch(`${url}/runs/%2e%2e%2flive-1`)).status, 404);
});

test('provisional metadata overrides branch status without claiming a model', async t => {
  const runsDir = await mkdtemp(join(tmpdir(), 'office-provisional-'));
  t.after(() => rm(runsDir, { recursive: true, force: true }));
  await mkdir(join(runsDir, 'example'));
  await writeFile(join(runsDir, 'example', 'branch.json'), JSON.stringify({ status: 'ok', divergence: 'Science' }));
  await writeFile(join(runsDir, 'example', 'manifest.json'), JSON.stringify({ status: 'provisional', reason: '3D model not generated', secret: 'hidden' }));
  const url = await fixture(t, { runsDir });
  const list = await (await fetch(`${url}/runs`)).json();
  assert.deepEqual(list.runs, [{ id: 'example', title: 'Science', divergence: 'Science', status: 'provisional', reason: '3D model not generated', hasModel: false }]);
  const detail = await (await fetch(`${url}/runs/example`)).json();
  assert.equal(detail.status, 'provisional'); assert.equal(detail.reason, '3D model not generated');
  assert.equal(detail.hasModel, false); assert.equal(detail.secret, undefined);
  assert.equal((await fetch(`${url}/runs/example/model.glb`)).status, 404);
  assert.equal((await fetch(`${url}/runs/example/manifest.json`)).status, 404);
});

test('simulated guardrail replay is explicitly labeled in list and manifest', async t => {
  const runsDir = await mkdtemp(join(tmpdir(), 'office-simulated-'));
  t.after(() => rm(runsDir, { recursive: true, force: true }));
  await mkdir(join(runsDir, 'guardrail'));
  await writeFile(join(runsDir, 'guardrail', 'branch.json'), JSON.stringify({ status: 'blocked', divergence: 'Fixture' }));
  await writeFile(join(runsDir, 'guardrail', 'manifest.json'), JSON.stringify({ status: 'simulated', reason: 'Fixture classifier unavailable', token: 'hidden' }));
  const url = await fixture(t, { runsDir });
  const list = await (await fetch(`${url}/runs`)).json();
  assert.equal(list.runs[0].status, 'simulated');
  assert.equal(list.runs[0].reason, 'Fixture classifier unavailable');
  const detail = await (await fetch(`${url}/runs/guardrail`)).json();
  assert.equal(detail.status, 'simulated'); assert.equal(detail.reason, 'Fixture classifier unavailable');
  assert.equal(detail.hasModel, false); assert.equal(detail.token, undefined);
});
