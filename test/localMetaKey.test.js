import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createConfiguredDemoServer } from '../server/index.js';

const localHeaders = url => ({ origin: url, 'sec-fetch-site': 'same-origin' });
async function start(t, { env = {}, runnerFactories = {}, bind = '127.0.0.1' } = {}) {
  const root = await mkdtemp(join(tmpdir(), 'office-local-meta-key-'));
  const outputRoot = join(root, 'out');
  const runsDir = join(root, 'runs');
  await mkdir(runsDir, { recursive: true });
  const instance = createConfiguredDemoServer({ outputRoot, runsDir, host: bind, env: { PORT: '0', META_SPEND_CAP_USD: '10', ...env }, runnerFactories });
  try { await new Promise((resolve, reject) => { instance.server.once('error', reject); instance.server.listen(0, bind, resolve); }); }
  catch (error) { await rm(root, { recursive: true, force: true }); throw error; }
  t.after(async () => { await new Promise(resolve => instance.server.close(resolve)); await rm(root, { recursive: true, force: true }); });
  const host = bind === '::1' ? '[::1]' : '127.0.0.1';
  return { ...instance, url: `http://${host}:${instance.server.address().port}`, root };
}
const postJson = (url, path, body, headers = localHeaders(url)) => fetch(`${url}${path}`, {
  method: 'POST', headers: { ...headers, 'content-type': 'application/json' }, body: JSON.stringify(body),
});
const runRequest = url => postJson(url, '/api/run', { divergence: 'What if a garden grew?' });
function tinyWav() {
  const wav = Buffer.alloc(46);
  wav.write('RIFF', 0); wav.writeUInt32LE(38, 4); wav.write('WAVEfmt ', 8); wav.writeUInt32LE(16, 16);
  wav.writeUInt16LE(1, 20); wav.writeUInt16LE(1, 22); wav.writeUInt32LE(24_000, 24); wav.writeUInt32LE(48_000, 28);
  wav.writeUInt16LE(2, 32); wav.writeUInt16LE(16, 34); wav.write('data', 36); wav.writeUInt32LE(2, 40);
  return wav;
}

test('local judge key switches replay to live in memory and resets to boot config without exposing the key', async t => {
  const { url } = await start(t, { env: {} });
  const browserGet = { 'sec-fetch-site': 'same-origin' };
  const initial = await (await fetch(`${url}/health`, { headers: browserGet })).json();
  assert.equal(initial.setupAvailable, true, 'same-origin browser health GET may omit Origin');
  assert.equal(initial.metaKeyConfigured, false); assert.equal(initial.metaKeyOverrideActive, false); assert.equal('replayOnly' in initial, false);

  const apiKey = 'fixture-local-key-only-in-test';
  const appliedResponse = await postJson(url, '/api/local-meta-key', { apiKey: `  ${apiKey}  ` });
  const appliedText = await appliedResponse.text();
  assert.equal(appliedResponse.status, 200); assert.doesNotMatch(appliedText, /fixture-local-key-only-in-test/);
  assert.deepEqual(JSON.parse(appliedText), { setupAvailable: true, metaKeyConfigured: true, metaKeyOverrideActive: true, localReviewAccess: true, localHistoryAccess: true });

  const restoredResponse = await fetch(`${url}/api/local-meta-key`, { method: 'DELETE', headers: localHeaders(url) });
  const restoredText = await restoredResponse.text();
  assert.equal(restoredResponse.status, 200); assert.doesNotMatch(restoredText, /fixture-local-key-only-in-test/);
  assert.deepEqual(JSON.parse(restoredText), { setupAvailable: true, metaKeyConfigured: false, metaKeyOverrideActive: false, localReviewAccess: false, localHistoryAccess: true });
});

test('all lazy Meta runner factories receive the active server-only key and perform no external calls in the fixture', async t => {
  const selected = {};
  const png = Buffer.from('89504e470d0a1a0a', 'hex');
  const runnerFactories = {
    createDemoRunner: ({ env }) => { selected.run = env.META_API_KEY; const runner = async ({ runId }) => ({ runId, branch: { status: 'ok', branches: [], hero: null } }); runner.enforcesDailyCap = true; return runner; },
    createDemoEventSceneRunner: ({ env }) => { selected.scene = env.META_API_KEY; const runner = async () => ({ buffer: png, mime: 'image/png' }); runner.enforcesDailyCap = true; return runner; },
    createDemoEventCutoutRunner: ({ env }) => { selected.cutout = env.META_API_KEY; const runner = async () => ({ buffer: png, mime: 'image/png' }); runner.enforcesDailyCap = true; return runner; },
    createDemoTranscriber: ({ env }) => { selected.voice = env.META_API_KEY; const runner = async () => ({ transcript: 'fixture transcript' }); runner.enforcesDailyCap = true; return runner; },
  };
  const { url, root } = await start(t, { runnerFactories });
  const applied = await postJson(url, '/api/local-meta-key', { apiKey: 'fixture-all-provider-key' });
  assert.equal(applied.status, 200);
  const runResponse = await runRequest(url);
  assert.equal(runResponse.status, 200); await runResponse.text();

  const runId = 'saved-fixture-run';
  const runDir = join(root, 'runs', runId);
  await mkdir(runDir, { recursive: true });
  const event = (id, title) => ({ id, title, year: 1200, place: { name: 'Alexandria', lat: 31.2, lon: 29.9 }, summary: 'A garden brings new botanical methods to the city.', scene: 'A botanical garden grows beside the harbor.' });
  await writeFile(join(runDir, 'branch.json'), JSON.stringify({ id: runId, status: 'ok', divergence: 'What if a garden grew?', branches: [event('b1', 'Harbor garden'), event('b2', 'Botanical atlas')], hero: { branchId: 'b1' } }));
  await writeFile(join(runDir, 'hero.png'), png);
  const scene = await postJson(url, '/api/event-scene', { runId, branchId: 'b2' });
  assert.equal(scene.status, 200); assert.equal((await scene.json()).status, 'complete');
  const cutout = await postJson(url, '/api/event-cutout', { runId, branchId: 'b1' });
  assert.equal(cutout.status, 200); assert.equal((await cutout.json()).status, 'complete');
  const voice = await fetch(`${url}/api/transcribe`, { method: 'POST', headers: { ...localHeaders(url), 'content-type': 'audio/wav' }, body: tinyWav() });
  assert.equal(voice.status, 200); assert.equal((await voice.json()).transcript, 'fixture transcript');
  assert.deepEqual(selected, { run: 'fixture-all-provider-key', scene: 'fixture-all-provider-key', cutout: 'fixture-all-provider-key', voice: 'fixture-all-provider-key' });
});

test('bad setup payloads and non-loopback or cross-origin requests cannot install a key', async t => {
  const { url } = await start(t);
  for (const body of [{ apiKey: '' }, { apiKey: 'x', extra: 'y' }, { apiKey: 'bad\nkey' }]) {
    assert.equal((await postJson(url, '/api/local-meta-key', body)).status, 400);
  }
  const tooLarge = await postJson(url, '/api/local-meta-key', { apiKey: 'x'.repeat(5000) });
  assert.equal(tooLarge.status, 413);
  const crossOrigin = await postJson(url, '/api/local-meta-key', { apiKey: 'should-not-apply' }, { origin: 'https://attacker.example', 'sec-fetch-site': 'cross-site' });
  assert.equal(crossOrigin.status, 403);
  const publicBind = await start(t, { bind: '0.0.0.0' });
  const publicSetup = await postJson(publicBind.url, '/api/local-meta-key', { apiKey: 'should-not-apply' });
  assert.equal(publicSetup.status, 403);
});

test('IPv6 loopback setup works when the host supports ::1', async t => {
  let instance;
  try { instance = await start(t, { bind: '::1' }); }
  catch (error) {
    if (['EAFNOSUPPORT', 'EADDRNOTAVAIL', 'EPROTONOSUPPORT'].includes(error.code)) return t.skip('IPv6 loopback is unavailable on this host');
    throw error;
  }
  const health = await (await fetch(`${instance.url}/health`, { headers: { 'sec-fetch-site': 'same-origin' } })).json();
  assert.equal(health.setupAvailable, true);
  const applied = await postJson(instance.url, '/api/local-meta-key', { apiKey: 'test-key' });
  assert.equal(applied.status, 200); assert.equal((await applied.json()).localReviewAccess, true);
});

test('key changes are rejected while a generation job is active', async t => {
  let startRunner;
  const started = new Promise(resolve => { startRunner = resolve; });
  let releaseRunner;
  const gate = new Promise(resolve => { releaseRunner = resolve; });
  const runnerFactories = { createDemoRunner: ({ env }) => {
    assert.equal(env.META_API_KEY, 'fixture-boot-key');
    const runner = async ({ runId }) => { startRunner(); await gate; return { runId, branch: { status: 'ok', branches: [], hero: null } }; };
    runner.enforcesDailyCap = true; return runner;
  } };
  const { url } = await start(t, { env: { META_API_KEY: 'fixture-boot-key' }, runnerFactories });
  const running = runRequest(url);
  await started;
  const blocked = await postJson(url, '/api/local-meta-key', { apiKey: 'fixture-next-key' });
  assert.equal(blocked.status, 409); assert.doesNotMatch(await blocked.text(), /fixture-(?:boot|next)-key/);
  releaseRunner(); const response = await running; assert.equal(response.status, 200); await response.text();
});
