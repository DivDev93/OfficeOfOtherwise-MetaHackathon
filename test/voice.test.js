import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile, mkdtemp, mkdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { request as httpRequest } from 'node:http';
import { createMetaVoice, createDemoTranscriber, validateVoiceWav, MAX_AUDIO_BYTES, VOICE_MODEL } from '../src/providers/metaVoice.js';
import { createMetaClient, SpendCapError } from '../src/lib/metaClient.js';
import { memoryLedger } from '../src/lib/spendLedger.js';
import { encodeWav, createVoiceInput, prepareVoiceAudio } from '../web/voice.js';
import { createDemoServer } from '../server/index.js';

const responseFixture = JSON.parse(await readFile(new URL('./fixtures/voice-transcribe.json', import.meta.url), 'utf8'));
const wav = async (seconds = 2, rate = 24000) => Buffer.from(await encodeWav(new Float32Array(seconds * rate), rate).arrayBuffer());
const ok = value => ({ ok: true, json: async () => value });

test('canonical WAV bounds reject misleading format, metadata, duration, channels and lengths', async () => {
  assert.deepEqual(validateVoiceWav(await wav()), { durationSeconds: 2, sampleRate: 24000 });
  assert.equal(validateVoiceWav(await wav(30, 16000)).durationSeconds, 30);
  assert.equal(validateVoiceWav(await wav(30)).durationSeconds, 30);
  for (const [offset, value] of [[20, 3], [22, 2], [24, 44100], [28, 1], [32, 4], [34, 32], [40, 200]]) {
    const invalid = await wav(); invalid.writeUInt16LE(value, offset); assert.throws(() => validateVoiceWav(invalid));
  }
  assert.throws(() => validateVoiceWav(Buffer.alloc(MAX_AUDIO_BYTES + 1)));
  assert.throws(() => validateVoiceWav(Buffer.alloc(44)));
  assert.throws(() => validateVoiceWav(Buffer.concat([Buffer.from('extra'), Buffer.alloc(100)])));
  assert.throws(() => validateVoiceWav(Buffer.concat([Buffer.alloc(1), Buffer.alloc(45)])));
  assert.throws(() => createDemoTranscriber({ env: {}, outputRoot: 'test/fixtures/no-budget' }));
});

test('speech uses official multipart schema and records model, duration and conservative cost only', async () => {
  const ledger = memoryLedger(); let calls = 0;
  const client = createMetaClient({ apiKey: 'fixture-key', env: {}, ledger, fetch: async (url, init) => {
    calls++; assert.equal(url, 'https://api.meta.ai/v1/asr/transcribe');
    assert.equal(init.headers['Content-Type'], undefined);
    assert.equal(init.redirect, 'error');
    assert.deepEqual(JSON.parse(await init.body.get('request').text()), { model: VOICE_MODEL, mode: 'PUSH_TO_TALK', audioEncoding: 'WAV' });
    assert.equal(init.body.get('audio').type, 'audio/wav');
    assert.equal(init.body.get('audio').size, (await wav()).length);
    return ok(responseFixture);
  } });
  assert.deepEqual(await createMetaVoice({ client })({ audio: await wav() }), { transcript: responseFixture.transcript });
  assert.equal(calls, 1); assert.equal(ledger.entries()[0].durationSeconds, 2);
  assert.equal(ledger.entries()[0].model, VOICE_MODEL); assert(Math.abs(ledger.entries()[0].usd - .0001) < 1e-12);
  assert.doesNotMatch(JSON.stringify(ledger.entries()), /Sahara|fixture-voice|audioDurationMs|fixture-key/);
});

test('voice reservations enforce total/daily caps before fetch and reject invalid audio without spending', async () => {
  let calls = 0;
  for (const opts of [{ spendCapUsd: 0 }, { dailyCapUsd: 0 }]) {
    const client = createMetaClient({ apiKey: 'fixture', env: {}, ...opts, fetch: async () => { calls++; } });
    await assert.rejects(createMetaVoice({ client })({ audio: await wav() }), SpendCapError);
  }
  const client = createMetaClient({ apiKey: 'fixture', env: {}, fetch: async () => { calls++; } });
  await assert.rejects(createMetaVoice({ client })({ audio: Buffer.alloc(1) }));
  assert.equal(calls, 0);
});

test('timeout, cancellation, provider errors and malformed responses are redacted, never retried, and freeze uncertain spend', async () => {
  const audio = await wav();
  for (const kind of ['timeout', 'cancel', 'http', 'json', 'shape']) {
    const ledger = memoryLedger(), controller = new AbortController(); let calls = 0, sentSignal;
    const client = createMetaClient({ apiKey: 'fixture', env: {}, ledger, fetch: async (_url, init) => {
      calls++; sentSignal = init.signal;
      if (kind === 'cancel') queueMicrotask(() => controller.abort());
      if (['timeout', 'cancel'].includes(kind)) return new Promise(() => {});
      if (kind === 'http') return { ok: false, status: 429 };
      if (kind === 'json') return { ok: true, json: async () => { throw new Error('secret-raw-response'); } };
      return ok({ private: 'secret-raw-response' });
    } });
    await assert.rejects(createMetaVoice({ client })({ audio, signal: controller.signal, timeoutMs: 10 }), { message: 'Meta transcription failed' });
    if (['timeout', 'cancel'].includes(kind)) assert.equal(sentSignal.aborted, true);
    assert.equal(calls, 1); assert(Math.abs(ledger.reserved() - .0001) < 1e-12);
    await assert.rejects(createMetaVoice({ client })({ audio }), SpendCapError);
    await client.waitForIdle(); assert.equal(calls, 1);
  }
  const cancelled = new AbortController(); cancelled.abort();
  const ledger = memoryLedger(); const client = createMetaClient({ apiKey: 'fixture', env: {}, ledger });
  await assert.rejects(createMetaVoice({ client })({ audio, signal: cancelled.signal }));
  assert.equal(ledger.reserved(), 0);
});

async function serverFixture(t, options = {}) {
  const root = await mkdtemp(join(tmpdir(), 'office-voice-'));
  const runsDir = join(root, 'runs'), liveRunsDir = join(root, 'live'), webDir = join(root, 'web');
  await Promise.all([mkdir(runsDir), mkdir(liveRunsDir), mkdir(webDir)]);
  const server = createDemoServer({ runsDir, liveRunsDir, webDir, env: { DEMO_VOICE_ENABLED: 'true', DEMO_ACCESS_CODE: 'fixture-code', DEMO_REPLAY_ONLY: 'true' }, ...options });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(async () => { await new Promise(resolve => server.close(resolve)); await rm(root, { recursive: true, force: true }); });
  return `http://127.0.0.1:${server.address().port}`;
}
const fake = fn => Object.assign(fn, { enforcesDailyCap: true });
const post = async (url, { code = 'fixture-code', body, type = 'audio/wav', signal } = {}) => fetch(`${url}/api/transcribe`, { method: 'POST', headers: { 'x-demo-access-code': code, 'content-type': type }, body: body ?? await wav(), signal });

test('voice requires flag/code/metered runner, works in replay-only, and never invokes generation', async t => {
  let calls = 0;
  const url = await serverFixture(t, { transcribeAudio: fake(async () => { calls++; return responseFixture; }), runPipeline: () => { throw new Error('generation invoked'); } });
  assert.deepEqual(await (await fetch(`${url}/health`)).json(), { status: 'ok', replayOnly: true, voiceEnabled: true, expansionLimit:20, expansionUsed:0 });
  assert.equal((await post(url, { code: 'wrong' })).status, 403);
  assert.deepEqual(await (await post(url)).json(), { transcript: responseFixture.transcript });
  assert.equal(calls, 1);
  assert.equal((await fetch(`${url}/api/run`, { method: 'POST' })).status, 503);
  for (const env of [{}, { DEMO_VOICE_ENABLED: 'true' }, { DEMO_ACCESS_CODE: 'fixture-code' }]) {
    const disabled = await serverFixture(t, { env }); assert.equal((await post(disabled)).status, 503);
    assert.equal((await (await fetch(`${disabled}/health`)).json()).voiceEnabled, false);
  }
  const unmetered = await serverFixture(t, { transcribeAudio: async () => responseFixture });
  assert.equal((await post(unmetered)).status, 503);
});

test('voice rejects payload/type/format bounds before calling provider, and redacts provider errors', async t => {
  let calls = 0;
  const url = await serverFixture(t, { rateLimit: 10, transcribeAudio: fake(async () => { calls++; throw new Error('secret-transcript-and-key'); }) });
  assert.equal((await post(url, { type: 'application/json' })).status, 415);
  assert.equal((await post(url, { body: Buffer.alloc(MAX_AUDIO_BYTES + 1) })).status, 413);
  assert.equal((await post(url, { body: Buffer.alloc(100) })).status, 400);
  assert.equal(calls, 0);
  const response = await post(url); assert.equal(response.status, 503);
  assert.doesNotMatch(await response.text(), /secret-transcript|key/); assert.equal(calls, 1);
});

test('chunked audio upload is bounded independently of content-length', async t => {
  let calls = 0;
  const url = await serverFixture(t, { transcribeAudio: fake(async () => { calls++; return responseFixture; }) });
  const status = await new Promise((resolve, reject) => {
    const req = httpRequest(`${url}/api/transcribe`, { method: 'POST', headers: { 'content-type': 'audio/wav', 'x-demo-access-code': 'fixture-code' } }, res => { res.resume(); resolve(res.statusCode); });
    req.on('error', reject); req.write(Buffer.alloc(MAX_AUDIO_BYTES)); req.end(Buffer.alloc(1));
  });
  assert.equal(status, 413); assert.equal(calls, 0);
});

test('voice serializes uploads, rate limits starts, bounds response length, and aborts a timed out provider', async t => {
  let release, ready; const started = new Promise(r => { ready = r; });
  const url = await serverFixture(t, { rateLimit: 1, transcribeAudio: fake(async () => { ready(); await new Promise(r => { release = r; }); return { transcript: 'a'.repeat(600) }; }) });
  const first = post(url); await started;
  assert.equal((await post(url)).status, 429); release();
  assert.equal((await (await first).json()).transcript.length, 500);
  assert.equal((await post(url)).status, 429);
  let aborted = false, providerReady;
  const providerStarted = new Promise(resolve => { providerReady = resolve; });
  // The deadline includes uploading the request; leave scheduling room so this
  // fixture reaches the deliberately stalled provider before the deadline.
  const timeout = await serverFixture(t, { voiceTimeoutMs: 1_000, transcribeAudio: fake(async ({ signal }) => {
    signal.addEventListener('abort', () => { aborted = true; }); providerReady();
    return new Promise(() => {});
  }) });
  const timedOut = post(timeout, { body: await wav(.01) });
  await providerStarted;
  assert.equal((await timedOut).status, 503); assert.equal(aborted, true);
});

function element(value = '') {
  const listeners = {};
  return { value, hidden: false, disabled: false, textContent: '', files: [], focus() { this.focused = true; }, closest() { return null; },
    addEventListener(name, fn) { listeners[name] = fn; }, emit(name) { return listeners[name]?.(); } };
}
const tick = () => new Promise(resolve => setImmediate(resolve));
function uiFixture(overrides = {}) {
  const nodes = Object.fromEntries(['prompt', 'access', 'controls', 'record', 'stop', 'cancel', 'message'].map(key => [key, element()]));
  nodes.access.value = 'fixture-code';
  const events = {};
  class Recorder {
    constructor() { this.state = 'inactive'; this.mimeType = 'audio/webm'; }
    start() { this.state = 'recording'; }
    stop() {
      this.state = 'inactive';
      this.ondataavailable?.({ data: new Blob(['recorded audio']) });
      queueMicrotask(() => this.onstop?.());
    }
  }
  const platform = { addEventListener(name, fn) { events[name] = fn; }, MediaRecorder: Recorder,
    navigator: { mediaDevices: { getUserMedia: async () => ({ getTracks: () => [{ stop() {} }] }) } }, ...overrides.platform };
  const controller = createVoiceInput({ ...nodes, platform, prepare: async blob => blob, ...overrides }); controller.setEnabled(true);
  return { ...nodes, controller, events };
}

async function recordAndStop(ui) {
  await ui.record.emit('click'); ui.stop.emit('click'); await tick();
}

test('microphone transcription only edits/focuses prompt and never submits; typing, cancel and reset defeat late results', async () => {
  for (const action of ['success', 'typing', 'cancel', 'reset', 'pagehide']) {
    let release, calls = [];
    const ui = uiFixture({ fetchImpl: async (url, init) => { calls.push({ url, init }); return new Promise(r => { release = r; }); } });
    await recordAndStop(ui);
    if (action === 'typing') { ui.prompt.value = 'New question'; ui.prompt.emit('input'); }
    if (action === 'cancel') ui.cancel.emit('click');
    if (action === 'reset') ui.controller.cancel();
    if (action === 'pagehide') ui.events.pagehide();
    release(ok(responseFixture)); await tick();
    if (action === 'success') { assert.equal(ui.prompt.value, responseFixture.transcript); assert.equal(ui.prompt.focused, true); }
    else { assert.equal(ui.prompt.value, action === 'typing' ? 'New question' : ''); assert.equal(calls[0].init.signal.aborted, true); }
    assert(calls.every(call => call.url === '/api/transcribe'));
    ui.controller.cancel();
  }
});

test('newer audio wins even when the older response arrives last', async () => {
  const replies = [];
  const ui = uiFixture({ fetchImpl: () => new Promise(resolve => replies.push(resolve)) });
  await recordAndStop(ui);
  ui.controller.cancel(); await recordAndStop(ui);
  replies[1](ok({ transcript: 'New question' })); await tick();
  replies[0](ok({ transcript: 'Old question' })); await tick();
  assert.equal(ui.prompt.value, 'New question'); ui.controller.cancel();
});

test('browser conversion limits decoded duration, closes audio context, and generates mono 24k WAV', async () => {
  let closed = 0, duration = 1, offlineArgs;
  class Audio {
    async decodeAudioData() { return { duration }; }
    async close() { closed++; }
  }
  class Offline {
    constructor(...args) { offlineArgs = args; }
    createBufferSource() { return { connect() {}, start() {} }; }
    async startRendering() { return { getChannelData: () => new Float32Array(24000) }; }
  }
  const platform = { AudioContext: Audio, OfflineAudioContext: Offline };
  const result = await prepareVoiceAudio(new Blob(['fixture']), platform);
  assert.deepEqual(offlineArgs, [1, 24000, 24000]); assert.equal(closed, 1);
  assert.equal(validateVoiceWav(Buffer.from(await result.arrayBuffer())).durationSeconds, 1);
  duration = 30.1;
  await assert.rejects(prepareVoiceAudio(new Blob(['fixture']), platform), /30 seconds/);
  assert.equal(closed, 2);
  await assert.rejects(prepareVoiceAudio(new Blob([new Uint8Array(8 * 1024 * 1024 + 1)]), platform), /8 MB/);
});

test('microphone permission cancellation, Stop, Cancel and recording errors stop all tracks', async () => {
  let resolvePermission, stops = 0, recorder;
  class Recorder {
    constructor() { recorder = this; this.state = 'inactive'; this.mimeType = 'audio/webm'; }
    start() { this.state = 'recording'; }
    stop() { this.state = 'inactive'; queueMicrotask(() => this.onstop?.()); }
  }
  const platform = { MediaRecorder: Recorder, navigator: { mediaDevices: { getUserMedia: () => new Promise(r => { resolvePermission = r; }) } } };
  const stream = { getTracks: () => [{ stop: () => { stops++; } }] };
  const ui = uiFixture({ platform, fetchImpl: async () => ok(responseFixture) });
  const pending = ui.record.emit('click'); ui.cancel.emit('click'); resolvePermission(stream); await pending; assert.equal(stops, 1);
  for (const action of ['stop', 'cancel', 'error']) {
    const recording = ui.record.emit('click'); resolvePermission(stream); await recording;
    if (action === 'error') recorder.onerror(); else ui[action].emit('click');
    await tick(); assert.equal(ui.stop.hidden, true);
  }
  assert.equal(stops, 4); ui.controller.cancel();
});

test('microphone time limit automatically stops every track and prepares the recording', async t => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  let stopped = 0, prepared = 0;
  class Recorder {
    constructor() { this.state = 'inactive'; this.mimeType = 'audio/webm'; }
    start() { this.state = 'recording'; }
    stop() { this.state = 'inactive'; queueMicrotask(() => this.onstop()); }
  }
  const ui = uiFixture({ platform: { MediaRecorder: Recorder, navigator: { mediaDevices: { getUserMedia: async () => ({ getTracks: () => [{ stop() { stopped++; } }, { stop() { stopped++; } }] }) } } },
    prepare: async blob => { prepared++; return blob; }, fetchImpl: async () => ok(responseFixture) });
  await ui.record.emit('click'); t.mock.timers.tick(29_000); await tick();
  assert.equal(stopped, 2); assert.equal(prepared, 1); assert.equal(ui.prompt.value, responseFixture.transcript);
  ui.controller.cancel();
});


test('local review permits microphone transcription without a client-side code', async () => {
  const calls=[];
  const ui=uiFixture({fetchImpl:async (url, init)=>{calls.push({url,init}); return ok({transcript:'What if lakes remained?'})}});
  ui.access.value=''; ui.controller.setLocalAccess(true);
  await recordAndStop(ui);
  assert.equal(ui.prompt.value,'What if lakes remained?');
  assert.equal(calls.length,1); assert.equal(calls[0].init.headers['x-demo-access-code'],'');
  ui.controller.cancel();
});
