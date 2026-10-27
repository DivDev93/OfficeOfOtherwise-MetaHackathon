import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { readdirSync } from 'node:fs';
import { runHarness } from '../harness/run.js';
import { writeCutoutPng, decodePng } from '../src/lib/png.js';

function temp() { return mkdtempSync(join(tmpdir(), 'otherwise-harness-')); }

test('blocked divergence makes no image or segmentation calls', async () => {
  const dir = temp();
  try {
    const client = { spent: () => 0 };
    const agent = { run: async () => ({ status: 'blocked', reframe: 'Try science', trace: [], rejected: [] }) };
    const forbidden = () => { throw new Error('unexpected generation'); };
    const result = await runHarness({ divergence: 'blocked', client, agent, image: { generate: forbidden }, sam: { segment: forbidden }, outputRoot: dir, timestamp: 1, log() {} });
    assert.equal(result.branch.status, 'blocked');
    assert.equal(JSON.parse(readFileSync(join(dir, '1', 'trace.json'))).costUsd, 0);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('saved branch skips agent and writes images, trace, and only current costs', async () => {
  const dir = temp();
  try {
    const source = join(dir, 'branch.json');
    writeFileSync(source, JSON.stringify({ status: 'ok', hero: { imagePrompt: 'atlas', subject: 'atlas' }, trace: [{ step: 'propose', model: 'muse', ms: 3, costUsd: 0.04 }] }));
    let spent = 2;
    const client = { spent: () => spent };
    const image = { model: 'image', generate: async () => { spent += 0.01; return { buffer: writeCutoutPng(Uint8Array.from([3, 4, 5, 255, 6, 7, 8, 255]), 2, 1), mime: 'image/png', costUsd: 0.01 }; } };
    const selectedMask = { objectId: 'object-1', box: { left: 0, top: 0, right: 1, bottom: 1 }, confidence: 0.9, raster: Uint8Array.from([1, 0]), width: 2, height: 1 };
    const sam = { segment: async () => { spent += 0.05; return { masks: [selectedMask], selectedMask, trace: [{ model: 'sam', ms: 4, costUsd: 0.05, prompt: 'atlas' }], rawOutputs: ['fixture'] }; } };
    const result = await runHarness({ from: source, client, agent: { run() { throw new Error('agent called'); } }, image, sam, policy: { checkPrompt: async () => ({ allowed: true, layer: 'keyword' }) }, outputRoot: dir, timestamp: 2, log() {} });
    assert.ok(Math.abs(result.costUsd - 0.06) < 1e-9);
    const trace = JSON.parse(readFileSync(join(dir, '2', 'trace.json')));
    assert.equal(trace.steps[0].reused, true);
    assert.equal(trace.steps[0].originalCostUsd, 0.04);
    assert.equal(trace.steps[0].costUsd, 0);
    assert.deepEqual(trace.selection, { index: 0, objectId: 'object-1', confidence: 0.9, box: { left: 0, top: 0, right: 1, bottom: 1 }, area: 1, prompt: 'atlas' });
    assert.deepEqual([...decodePng(readFileSync(join(dir, '2', 'cutout.png'))).data].filter((_, i) => i % 4 === 3), [255, 0]);
    assert.equal(readFileSync(join(dir, '2', 'sam-raw-1.txt'), 'utf8'), 'fixture');
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('empty branch never calls image or segmentation', async () => {
  const dir = temp();
  try {
    const fail = () => { throw new Error('unexpected generation'); };
    const result = await runHarness({ client: { spent: () => 0 }, agent: { run: async () => ({ status: 'empty', trace: [], rejected: [] }) }, image: { generate: fail }, sam: { segment: fail }, outputRoot: dir, timestamp: 3, log() {} });
    assert.equal(result.branch.status, 'empty');
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('SAM failure persists paid calls and raw output', async () => {
  const dir = temp();
  try {
    let spent = 0;
    const failure = Object.assign(new Error('bad SAM payload'), { trace: [{ model: 'sam', ms: 12, costUsd: 0.05, prompt: 'atlas' }], rawOutputs: ['malformed output'], rawResponses: [{ status: 'completed', output_text: 'malformed output' }] });
    const image = { generate: async () => { spent += 0.01; return { buffer: writeCutoutPng(Uint8Array.from([0, 0, 0, 255]), 1, 1), mime: 'image/png', costUsd: 0.01 }; } };
    const sam = { segment: async () => { spent += 0.05; throw failure; } };
    await assert.rejects(runHarness({ client: { spent: () => spent }, agent: { run: async () => ({ status: 'ok', hero: { imagePrompt: 'atlas', subject: 'atlas' }, trace: [] }) }, image, sam, outputRoot: dir, timestamp: 4, log() {} }), /bad SAM payload/);
    const trace = JSON.parse(readFileSync(join(dir, '4', 'trace.json')));
    assert.ok(Math.abs(trace.costUsd - 0.06) < 1e-9);
    assert.equal(trace.steps.find(t => t.step === 'segment').costUsd, 0.05);
    assert.equal(readFileSync(join(dir, '4', 'sam-raw-1.txt'), 'utf8'), 'malformed output');
    assert.deepEqual(JSON.parse(readFileSync(join(dir, '4', 'sam-response-1.json'), 'utf8')), { status: 'completed', output_text: 'malformed output' });
  } finally { rmSync(dir, { recursive: true, force: true }); }
});



test('forged saved hero is blocked by topic policy before generation', async () => {
  const dir = temp();
  try {
    const source = join(dir, 'branch.json');
    writeFileSync(source, JSON.stringify({ status: 'ok', divergence: 'A library', branches: [], hero: { imagePrompt: 'A war scene', subject: 'artifact' }, trace: [] }));
    const { createTopicPolicy } = await import('../src/guardrails/topicPolicy.js');
    const fail = () => { throw new Error('unexpected generation'); };
    const result = await runHarness({ from: source, client: { spent: () => 0 }, image: { generate: fail }, sam: { segment: fail }, policy: createTopicPolicy(), outputRoot: dir, timestamp: 5, log() {} });
    assert.equal(result.blocked, true);
    const trace = JSON.parse(readFileSync(join(dir, '5', 'trace.json')));
    assert.equal(trace.steps.find(t => t.step === 'policy:reuse').allowed, false);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});


test('CLI reports missing credentials and preserves failure trace', () => {
  const dir = temp();
  try {
    const env = { ...process.env };
    delete env.META_API_KEY;
    delete env.MODEL_API_KEY;
    const script = fileURLToPath(new URL('../harness/run.js', import.meta.url));
    const result = spawnSync(process.execPath, [script, 'What if an ancient library survived?'], { cwd: dir, env, encoding: 'utf8' });
    assert.equal(result.status, 1);
    assert.match(result.stderr, /META_API_KEY is not set/);
    assert.doesNotMatch(result.stderr, /ReferenceError|before is not defined/);
    const output = join(dir, 'out', readdirSync(join(dir, 'out'))[0], 'trace.json');
    const trace = JSON.parse(readFileSync(output));
    assert.match(trace.steps.find(t => t.step === 'topic-policy').error, /META_API_KEY is not set/);
    assert.equal(trace.costUsd, 0);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});


test('image decode failure saves response without logging its payload', async () => {
  const dir = temp();
  try {
    let spent = 0;
    const payload = { data: [{ b64_json: 'fixture-secret-payload' }] };
    const error = Object.assign(new Error('invalid image data'), { rawResponse: payload });
    const messages = [];
    await assert.rejects(runHarness({ client: { spent: () => spent }, agent: { run: async () => ({ status: 'ok', hero: { imagePrompt: 'atlas', subject: 'atlas' }, trace: [] }) }, image: { generate: async () => { spent = 0.01; throw error; } }, sam: { segment() { throw new Error('unexpected segmentation'); } }, outputRoot: dir, timestamp: 6, log: text => messages.push(text) }), /invalid image data/);
    assert.deepEqual(JSON.parse(readFileSync(join(dir, '6', 'image-response.json'))), payload);
    assert.equal(JSON.parse(readFileSync(join(dir, '6', 'trace.json'))).costUsd, 0.01);
    assert.doesNotMatch(messages.join('\n'), /fixture-secret-payload/);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});


test('offline saved branch runs real metered image and SAM providers through PNG output', async () => {
  const dir = temp();
  try {
    const { createMetaClient } = await import('../src/lib/metaClient.js');
    const { createMetaImage } = await import('../src/providers/metaImage.js');
    const { createSamMask } = await import('../src/providers/samMask.js');
    const source = join(dir, 'branch.json');
    writeFileSync(source, JSON.stringify({ status: 'ok', divergence: 'A library survives', branches: [], hero: { imagePrompt: 'an atlas', subject: 'atlas' }, trace: [] }));
    const pixels = new Uint8Array(3 * 3 * 4).fill(255);
    const png = writeCutoutPng(pixels, 3, 3);
    const samText = readFileSync(new URL('./fixtures/sam-synthetic.txt', import.meta.url), 'utf8');
    const calls = [];
    const client = createMetaClient({ apiKey: 'fixture', spendCapUsd: 0.1, fetch: async (url, init) => {
      const body = JSON.parse(init.body);
      calls.push({ url, body });
      if (url.endsWith('/images/generations')) return { ok: true, json: async () => ({ data: [{ b64_json: png.toString('base64') }] }) };
      if (url.endsWith('/responses')) return { ok: true, json: async () => ({ output_text: samText }) };
      throw new Error('unexpected endpoint');
    } });
    const result = await runHarness({ from: source, subjectOverride: 'book', client, image: createMetaImage({ client, env: {} }), sam: createSamMask({ client, env: {} }), policy: { checkPrompt: async text => { assert.match(text, /book/); return { allowed: true, layer: 'keyword' }; } }, outputRoot: dir, timestamp: 7, log() {} });
    assert.equal(calls.length, 2);
    assert.equal(calls[0].body.model, 'muse-image-1.0');
    assert.equal(calls[1].body.model, 'sam-3.1');
    assert.equal(calls[1].body.input[0].content[0].text, 'book');
    assert.ok(Math.abs(result.costUsd - 0.06) < 1e-9);
    assert.deepEqual([...decodePng(readFileSync(join(dir, '7', 'cutout.png'))).data].filter((_, i) => i % 4 === 3), [0,0,0,0,255,255,0,255,255]);
    const trace = JSON.parse(readFileSync(join(dir, '7', 'trace.json')));
    assert.equal(trace.subjectOverride, 'book');
    assert.equal(JSON.parse(readFileSync(join(dir, '7', 'branch.json'))).hero.subject, 'atlas');
    assert.equal(trace.selection.confidence, 0.9);
    assert.equal(trace.selection.area, 4);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});
