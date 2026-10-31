import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createDemoServer } from '../server/index.js';

async function fixture(t, options = {}) {
  const base = await mkdtemp(join(tmpdir(), 'office-demo-'));
  const runsDir = join(base, 'runs'), webDir = join(base, 'web'), liveRunsDir = join(base, 'live');
  await mkdir(join(runsDir, 'orrery'), { recursive: true }); await mkdir(webDir);
  await writeFile(join(webDir, 'index.html'), '<h1>Demo</h1>');
  await writeFile(join(runsDir, 'orrery', 'branch.json'), JSON.stringify(options.branch ?? { status: 'ok', divergence: 'What if?', hero: { title: 'Orrery' } }));
  await writeFile(join(runsDir, 'orrery', 'hero.png'), Buffer.from('png'));
  if (options.meshoptModel) await writeFile(join(runsDir, 'orrery', 'model.meshopt.glb'), options.meshoptModel);
  const server = createDemoServer({ runsDir, liveRunsDir, webDir, env: { DEMO_ACCESS_CODE: 'private-code', DEMO_DAILY_CAP_USD: '1' }, ...options });
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

test('serves meshopt-compressed replay models and advertises them as available', async t => {
  const url = await fixture(t, { meshoptModel: Buffer.from('compressed model') });
  const run = await (await fetch(`${url}/runs/orrery`)).json();
  assert.equal(run.hasModel, true);
  assert.equal(run.assetUrls['model.meshopt.glb'], '/runs/orrery/model.meshopt.glb');
  const response = await fetch(`${url}/runs/orrery/model.meshopt.glb`);
  assert.equal(response.status, 200);
  assert.equal(response.headers.get('content-type'), 'model/gltf-binary');
  assert.equal(await response.text(), 'compressed model');
});

test('exposes an unauthenticated health endpoint for container probes', async t => {
  const url = await fixture(t);
  const response = await fetch(`${url}/health`);
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { status: 'ok', replayOnly: false, voiceEnabled: false, expansionLimit: 20, expansionUsed: 0 });
  assert.match(response.headers.get('set-cookie'), /HttpOnly; SameSite=Strict/);
  assert.doesNotMatch(response.headers.get('set-cookie'), /Max-Age|Expires/i);
  assert.equal(response.headers.get('set-cookie').split(';')[0].startsWith('otherwise_session='), true);
  assert.equal((await fetch(`${url}/health`, { method: 'HEAD' })).status, 200);
  const noAccessCode = await fixture(t, { env: {} });
  assert.deepEqual(await (await fetch(`${noAccessCode}/health`)).json(), { status: 'ok', replayOnly: true, voiceEnabled: false, expansionLimit: 20, expansionUsed: 0 });
  const configured = await fixture(t, { env: { DEMO_ACCESS_CODE: 'private-code', DEMO_MAX_EXPANSIONS_PER_SESSION: '4' } });
  assert.equal((await (await fetch(`${configured}/health`)).json()).expansionLimit, 4);
});

test('live gate defaults to replay and refuses runners without daily-cap enforcement', async t => {
  const url = await fixture(t, { runPipeline: async () => ({}) });
  assert.equal((await post(url, 'wrong')).status, 403);
  assert.equal((await post(url)).status, 503);
  const unset = await fixture(t, { env: {}, runPipeline: fake(async () => ({})) });
  assert.equal((await post(unset, '')).status, 403);
});

test('replay-only mode refuses a configured live runner before invoking it', async t => {
  let called = false;
  const url = await fixture(t, { env: { DEMO_REPLAY_ONLY: 'true', DEMO_ACCESS_CODE: 'private-code' }, runPipeline: fake(async () => { called = true; return {}; }) });
  const response = await post(url);
  assert.equal(response.status, 503);
  assert.deepEqual(await response.json(), { error: 'Live generation is disabled. Use replay mode.' });
  assert.equal(called, false);
  assert.deepEqual(await (await fetch(`${url}/health`)).json(), { status: 'ok', replayOnly: true, voiceEnabled: false, expansionLimit: 20, expansionUsed: 0 });
});

test('replay JSON redacts rejected branch text and keeps only safe rejection metadata', async t => {
  const url = await fixture(t, { branch: {
    status: 'ok', divergence: 'Science', hero: { title: 'Safe story' },
    rejected: [{ branch: { id: 'bad-1', title: 'Blocked title', summary: 'Blocked summary' }, category: 'politics', layer: 'model', reason: 'Private classifier detail' }],
  } });
  const branch = await (await fetch(`${url}/runs/orrery/branch.json`)).json();
  assert.equal(branch.rejectedCount, 1);
  assert.deepEqual(branch.rejected, [{ id: 'bad-1', category: 'politics', layer: 'model' }]);
  assert.doesNotMatch(JSON.stringify(branch), /Blocked title|Blocked summary|Private classifier detail/);
  const manifest = await (await fetch(`${url}/runs/orrery`)).json();
  assert.deepEqual(manifest.branch.rejected, branch.rejected);
});

test('2D-only branch render status is surfaced in replay metadata and live completion', async t => {
  const reason = 'SAM 3.1 returned no mask; cutout and 3D model were not generated';
  const replayUrl = await fixture(t, { branch: {
    status: 'ok', renderStatus: '2d-only', renderReason: 'no-segmentation-mask', divergence: 'Science', hero: { title: 'Scene' },
  } });
  const detail = await (await fetch(`${replayUrl}/runs/orrery`)).json();
  assert.equal(detail.status, 'provisional');
  assert.equal(detail.renderStatus, '2d-only');
  assert.equal(detail.reason, reason);
  assert.equal(detail.hasModel, false);
  const list = await (await fetch(`${replayUrl}/runs`)).json();
  assert.equal(list.runs[0].status, 'provisional');
  assert.equal(list.runs[0].renderStatus, '2d-only');

  const liveUrl = await fixture(t, { runPipeline: fake(async ({ runId }) => ({
    runId, branch: { status: 'ok', renderStatus: '2d-only' }, trace: [],
  })) });
  const response = await post(liveUrl);
  const text = await response.text();
  const completion = JSON.parse(text.match(/event: complete\ndata: (.+)/)[1]);
  assert.equal(completion.status, 'provisional');
  assert.equal(completion.renderStatus, '2d-only');
  assert.equal(completion.reason, reason);
});

test('streams named events in order and redacts credentials', async t => {
  const runner = fake(async ({ onStep, dailyCapUsd, runId }) => {
    assert.equal(dailyCapUsd, 1);
    for (const step of ['policy', 'propose', 'review', 'image', 'cutout', '3d']) onStep({ step, runId, message: 'private-code', token: 'hidden' });
    return { runId, rejected: [{ branch: { id: 'bad-1', title: 'Blocked SSE title' }, category: 'war', reason: 'Private SSE reason' }] };
  });
  const url = await fixture(t, { runPipeline: runner });
  const response = await post(url); assert.equal(response.status, 200);
  const text = await response.text();
  assert.deepEqual([...text.matchAll(/^event: (.+)$/gm)].map(m => m[1]), ['policy', 'propose', 'review', 'image', 'cutout', '3d', 'complete']);
  assert.doesNotMatch(text, /private-code|hidden|Blocked SSE title|Private SSE reason/);
  assert.match(text, /"rejectedCount":1/);
  assert.match(text, /"rejected":\[\{"id":"bad-1","category":"war"\}\]/);
});

test('root completion cannot claim an output ID other than its reserved run ID', async t => {
  const runner = fake(async () => ({ runId: 'unrelated-output', branch: { status: 'ok' } }));
  const url = await fixture(t, { runPipeline: runner });
  const response = await post(url);
  const text = await response.text();
  assert.equal(response.status, 200);
  assert.match(text, /event: error/);
  assert.doesNotMatch(text, /event: complete/);
  assert.equal((await fetch(`${url}/runs/unrelated-output`)).status, 404);
});

test('rate limits and excludes concurrent sessions', async t => {
  let release, started;
  let calls = 0;
  const ready = new Promise(r => { started = r; });
  const runner = fake(async ({ runId }) => { calls++; if (calls === 1) { started(); await new Promise(r => { release = r; }); } return { runId }; });
  const url = await fixture(t, { runPipeline: runner, rateLimit: 2, maxConcurrentJobs: 1 });
  const first = await post(url); await ready;
  assert.equal((await post(url)).status, 429);
  assert.equal((await post(url)).status, 429);
  release(); await first.text();
  const afterBusyResponses = await post(url);
  assert.equal(afterBusyResponses.status, 200);
  assert.match(await afterBusyResponses.text(), /event: complete/);
  assert.equal(calls, 2, 'busy responses did not consume the second rate-limit allowance');
  const rateLimited = await post(url);
  assert.equal(rateLimited.status, 429);
  assert.equal((await rateLimited.json()).status, 'retryable');
});

test('serves only registered live run assets after progress and rejects traversal', async t => {
  const liveRunsDir = await mkdtemp(join(tmpdir(), 'office-live-'));
  t.after(() => rm(liveRunsDir, { recursive: true, force: true }));
  await mkdir(join(liveRunsDir, 'run-123'));
  await writeFile(join(liveRunsDir, 'spend.json'), '{"private":true}');
  await writeFile(join(liveRunsDir, 'run-123', 'hero.png'), Buffer.from('live image'));
  let release, signalReady, generatedRunId;
  const ready = new Promise(resolve => { signalReady = resolve; });
  const runner = fake(async ({ onStep, runId }) => {
    generatedRunId = runId;
    await mkdir(join(liveRunsDir, runId), { recursive: true });
    await writeFile(join(liveRunsDir, runId, 'hero.png'), Buffer.from('live image'));
    onStep({ step: 'image', runId });
    signalReady();
    await new Promise(resolve => { release = resolve; });
    return { runId };
  });
  const url = await fixture(t, { runPipeline: runner, liveRunsDir });
  assert.equal((await fetch(`${url}/runs/run-123/hero.png`)).status, 404);
  const response = await post(url); await ready;
  const head = await fetch(`${url}/runs/${generatedRunId}/hero.png`, { method: 'HEAD' });
  assert.equal(head.status, 200); assert.equal(head.headers.get('content-type'), 'image/png');
  assert.equal(await (await fetch(`${url}/runs/${generatedRunId}/hero.png`)).text(), 'live image');
  assert.equal((await fetch(`${url}/runs/${generatedRunId}/spend.json`)).status, 404);
  assert.equal((await fetch(`${url}/runs/${generatedRunId}/%2e%2e%2fspend.json`)).status, 404);
  release(); await response.text();
});

test('run manifests expose only safe metadata for cached and registered live runs', async t => {
  const liveRunsDir = await mkdtemp(join(tmpdir(), 'office-manifest-'));
  t.after(() => rm(liveRunsDir, { recursive: true, force: true }));
  let liveRunId;
  const runner = fake(async ({ onStep, runId }) => {
    liveRunId = runId;
    await mkdir(join(liveRunsDir, runId), { recursive: true });
    await writeFile(join(liveRunsDir, runId, 'branch.json'), JSON.stringify({ status: 'ok', divergence: 'Geography', secret: 'hidden', hero: { title: 'Live' } }));
    onStep({ step: 'policy', runId });
    return { runId };
  });
  const url = await fixture(t, { liveRunsDir, runPipeline: runner });
  const cached = await (await fetch(`${url}/runs/orrery`)).json();
  assert.equal(cached.id, 'orrery'); assert.equal(cached.branch.divergence, 'What if?');
  assert.equal(cached.assetUrls['hero.png'], '/runs/orrery/hero.png');
  assert.equal(cached.hasModel, false);
  assert.equal((await fetch(`${url}/runs/live-1`)).status, 404);
  await (await post(url)).text();
  const live = await (await fetch(`${url}/runs/${liveRunId}`)).json();
  assert.equal(live.id, liveRunId); assert.equal(live.branch.divergence, 'Geography');
  assert.equal(live.branch.secret, undefined); assert.equal(live.assetUrls['branch.json'], `/runs/${liveRunId}/branch.json`);
  assert.equal((await fetch(`${url}/runs/${liveRunId}`, { method: 'HEAD' })).status, 200);
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
