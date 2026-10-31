import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, writeFileSync, rmSync, mkdirSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { readdirSync } from 'node:fs';
import { runHarness } from '../harness/run.js';
import { createMetaClient } from '../src/lib/metaClient.js';
import { writeCutoutPng, decodePng } from '../src/lib/png.js';
import { createSamMask } from '../src/providers/samMask.js';

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

test('overlapping harness runs sharing one client keep trace cost invocation-local', async () => {
  const dir = temp();
  try {
    const started = new Map(), releases = new Map();
    const client = createMetaClient({ apiKey: 'fixture', spendCapUsd: 1, fetch: async (_url, init) => {
      const label = JSON.parse(init.body).label;
      started.set(label, true);
      await new Promise(resolve => releases.set(label, resolve));
      return Response.json({ ok: true });
    } });
    const makeRun = (label, costUsd) => runHarness({
      divergence: label, client, outputRoot: dir, timestamp: label, log() {},
      agent: { run: async () => {
        await client.meteredPost('/images', { label }, { costUsd });
        return { status: 'blocked', trace: [], rejected: [] };
      } },
      image: { generate() { throw new Error('unexpected image'); } },
      sam: { segment() { throw new Error('unexpected segmentation'); } },
    });
    const a = makeRun('run-a', 0.04), b = makeRun('run-b', 0.07);
    while (started.size < 2) await new Promise(resolve => setTimeout(resolve, 1));
    releases.get('run-b')(); const resultB = await b;
    releases.get('run-a')(); const resultA = await a;
    assert.equal(resultA.costUsd, 0.04); assert.equal(resultB.costUsd, 0.07);
    assert.equal(JSON.parse(readFileSync(join(dir, 'run-a', 'trace.json'))).costUsd, 0.04);
    assert.equal(JSON.parse(readFileSync(join(dir, 'run-b', 'trace.json'))).costUsd, 0.07);
    assert.ok(Math.abs(client.spent() - 0.11) < 1e-12, 'the shared global ledger still reports total spend');
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

test('completed empty SAM result preserves a 2D-only story without inventing a cutout or starting 3D', async () => {
  const dir = temp();
  try {
    let spent = 0, samCalls = 0, threeDCalls = 0;
    const emptyResponse = JSON.parse(readFileSync(new URL('./fixtures/sam-empty-completed-response.json', import.meta.url), 'utf8'));
    const client = { spent: () => spent, async meteredPost(_path, _body, { costUsd }) { samCalls++; spent += costUsd; return emptyResponse; } };
    const image = { model: 'fixture-image', async generate() { spent += 0.01; return { buffer: writeCutoutPng(Uint8Array.from([20, 30, 40, 255]), 1, 1), mime: 'image/png', costUsd: 0.01 }; } };
    const sam = createSamMask({ client, env: { META_SEGMENT_COST_USD: '0.05' } });
    const events = [];
    const result = await runHarness({
      divergence: 'What if a library survived?',
      client,
      agent: { run: async () => ({ status: 'ok', divergence: 'What if a library survived?', branches: [], hero: { imagePrompt: 'A brass pump', subject: 'brass pump' }, trace: [] }) },
      image, sam, outputRoot: dir, timestamp: 8, log: text => events.push(text), no3d: false,
      chronos3d: { generate() { threeDCalls++; throw new Error('must not generate without a mask'); } },
      onStep: event => events.push(event),
    });
    const runDir = join(dir, '8');
    const branch = JSON.parse(readFileSync(join(runDir, 'branch.json'), 'utf8'));
    const trace = JSON.parse(readFileSync(join(runDir, 'trace.json'), 'utf8'));
    assert.equal(result.renderStatus, '2d-only');
    assert.equal(branch.renderStatus, '2d-only');
    assert.equal(branch.renderReason, 'no-segmentation-mask');
    assert.equal(trace.renderStatus, '2d-only');
    assert.equal(trace.steps.find(step => step.step === 'cutout').status, 'unavailable');
    assert.equal(trace.steps.find(step => step.step === 'cutout').reason, 'no-segmentation-mask');
    const cutoutSummary = trace.steps.find(step => step.step === 'cutout');
    assert.equal(cutoutSummary.summary, true);
    assert.equal(cutoutSummary.costUsd, 0);
    assert.ok(Math.abs(cutoutSummary.originalCostUsd - 0.1) < 1e-9);
    assert.equal(trace.steps.filter(step => step.step === 'segment').length, 2);
    assert.ok(Math.abs(trace.steps.filter(step => !step.summary).reduce((sum, step) => sum + (step.costUsd ?? 0), 0) - result.costUsd) < 1e-9);
    assert.equal(samCalls, 2);
    assert.equal(threeDCalls, 0);
    assert.equal(existsSync(join(runDir, 'hero.png')), true);
    assert.equal(existsSync(join(runDir, 'mask.png')), false);
    assert.equal(existsSync(join(runDir, 'cutout.png')), false);
    assert.equal(existsSync(join(runDir, 'model.glb')), false);
    assert.ok(events.some(event => event?.step === 'cutout' && event.status === 'unavailable'));
    assert.ok(events.some(event => typeof event === 'string' && event.includes('2D preview only')));
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
    const result = spawnSync(process.execPath, [script, '--no-3d', 'What if an ancient library survived?'], { cwd: dir, env, encoding: 'utf8' });
    assert.equal(result.status, 1);
    assert.match(result.stderr, /META_API_KEY is not set/);
    assert.doesNotMatch(result.stderr, /ReferenceError|before is not defined/);
    const run = readdirSync(join(dir, 'out'), { withFileTypes: true }).find(entry => entry.isDirectory()).name;
    const output = join(dir, 'out', run, 'trace.json');
    const trace = JSON.parse(readFileSync(output));
    assert.match(trace.steps.find(t => t.step === 'topic-policy').error, /META_API_KEY is not set/);
    assert.equal(trace.costUsd, 0);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('CLI fails before any live work when META_SPEND_CAP_USD is invalid', () => {
  const dir = temp();
  try {
    const script = fileURLToPath(new URL('../harness/run.js', import.meta.url));
    const result = spawnSync(process.execPath, [script, '--no-3d', 'What if a library survived?'], { cwd: dir, env: { ...process.env, META_API_KEY: 'sentinel', META_SPEND_CAP_USD: '-5' }, encoding: 'utf8' });
    assert.equal(result.status, 1);
    assert.match(result.stderr, /Invalid META_SPEND_CAP_USD/i);
    assert.doesNotMatch(result.stderr, /sentinel/);
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

test('3D receives original image and mask, persists model and streams ordered events', async () => {
  const dir = temp();
  try {
    const png = writeCutoutPng(Uint8Array.from([3,4,5,255,6,7,8,255]),2,1);
    const hero = { branchId:'b1', imagePrompt:'an atlas', subject:'atlas' };
    const mask = { raster:Uint8Array.from([1,0]), width:2, height:1, confidence:.9 };
    let seen; const events = [];
    const args = { timestamp: 'abc', outputRoot:dir, log(){}, client:{spent:()=>0}, no3d:false,
      agent:{run:async ({onStep})=>{ for (const step of ['policy','propose','review']) onStep({step}); return {status:'ok',hero,trace:[]}; }},
      image:{generate:async()=>({buffer:png,mime:'image/png',costUsd:.01})},
      sam:{segment:async()=>({selectedMask:mask,masks:[mask],trace:[{ms:2,costUsd:.05}]})},
      chronos3d:{generate:async input=>{seen=input;return {glb:Buffer.from('fixture glb'),ms:42};}}, onStep:e=>events.push(e) };
    await runHarness(args);
    assert.deepEqual(events.map(e=>e.step), ['policy','propose','review','image','cutout','3d']);
    assert.ok(events.every(e=>e.runId==='abc'));
    assert.equal(events.at(-1).url, '/runs/abc/model.glb');
    assert.deepEqual(seen.imagePng,png);
    assert.deepEqual(seen.maskPng,readFileSync(join(dir,'abc','mask.png')));
    assert.match(seen.idempotencyKey,/^relic:[a-f0-9]{64}$/);
    const key=seen.idempotencyKey; await runHarness(args); assert.equal(seen.idempotencyKey,key);
    assert.equal(readFileSync(join(dir,'abc','model.glb'),'utf8'),'fixture glb');
    assert.deepEqual(JSON.parse(readFileSync(join(dir,'abc','trace.json'))).steps.at(-1),{step:'3d',model:'Tattva TRELLIS',ms:42,costUsd:0});
  } finally { rmSync(dir,{recursive:true,force:true}); }
});

test('3D is opt-in for injected harness calls and missing client fails before agent', async () => {
  let called=false;
  await assert.rejects(runHarness({client:{spent:()=>0},agent:{run(){called=true;}},no3d:false}), /Chronos 3D client is required/);
  assert.equal(called,false);
});

test('harness forwards bounded ancestry and persists it with the stable reserved run ID', async () => {
  const dir = temp();
  try {
    const continuation = {
      rootRunId: 'root', rootDivergence: 'What if the library survived?', parentRunId: 'root', parentBranchId: 'b1',
      path: [{ runId: 'root', branchId: 'b1', title: 'Steam workshops', year: 120, summary: 'Surviving scrolls spread pump designs.', place: { name: 'Alexandria', lat: 31, lon: 29 }, ignored: 'discarded' }],
      ignored: 'discarded',
    };
    let seen;
    const result = await runHarness({ divergence: continuation.rootDivergence, continuation, timestamp: 'reserved-run-id', outputRoot: dir, log() {}, client: { spent: () => 0 },
      agent: { run: async args => { seen = args; return { status: 'empty', branches: [], trace: [] }; } } });
    assert.equal(seen.continuation.parentBranchId, 'b1');
    assert.equal(seen.continuation.ignored, undefined);
    assert.equal(seen.continuation.path[0].ignored, undefined);
    const branch = JSON.parse(readFileSync(join(dir, 'reserved-run-id', 'branch.json')));
    const trace = JSON.parse(readFileSync(join(dir, 'reserved-run-id', 'trace.json')));
    assert.deepEqual(branch.continuation, seen.continuation);
    assert.deepEqual(trace.continuation, seen.continuation);
    assert.equal(result.directory, join(dir, 'reserved-run-id'));
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('saved causal links are policy checked before image generation', async () => {
  const dir = temp();
  try {
    const source = join(dir, 'branch.json');
    writeFileSync(source, JSON.stringify({ status: 'ok', divergence: 'A library survives', branches: [{ title: 'Steam workshops', summary: 'Pumps spread.', causalLink: 'An army copies them.' }], hero: { imagePrompt: 'A brass pump', subject: 'pump' }, trace: [] }));
    const { createTopicPolicy } = await import('../src/guardrails/topicPolicy.js');
    const result = await runHarness({ from: source, client: { spent: () => 0 }, image: { generate() { throw new Error('unexpected generation'); } }, policy: createTopicPolicy(), outputRoot: dir, timestamp: 'saved-cause', log() {} });
    assert.equal(result.blocked, true);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('saved hero geography reaches image generation and its free text is policy checked first', async () => {
  const dir = temp();
  try {
    const source = join(dir, 'branch.json');
    const geography = { version: 1, changes: [{ id: 'green-sahara', kind: 'vegetation', region: 'sahara', intensity: 0.8,
      assumption: 'Grasslands persist across the Sahara.', uncertainty: 'Rainfall boundaries are illustrative.' }] };
    const saved = { status: 'ok', divergence: 'A greener Sahara', branches: [{ id: 'b1', title: 'Field station', summary: 'Botany expands.', geography }], hero: { branchId: 'b1', imagePrompt: 'A field station', subject: 'building' }, trace: [] };
    writeFileSync(source, JSON.stringify(saved));
    let imagePrompt, policyInput;
    const png = writeCutoutPng(Uint8Array.from([1, 2, 3, 255]), 1, 1);
    const result = await runHarness({ from: source, client: { spent: () => 0 }, outputRoot: dir, timestamp: 'geo-image', log() {},
      image: { generate: async ({ prompt }) => { imagePrompt = prompt; return { buffer: png, mime: 'image/png', costUsd: 0 }; } },
      sam: { segment: async () => ({ selectedMask: null, trace: [] }) }, policy: { checkPrompt: async text => { policyInput = text; return { allowed: true }; } } });
    assert.ok(imagePrompt.includes(geography.changes[0].assumption));
    assert.ok(imagePrompt.includes(geography.changes[0].uncertainty));
    assert.ok(policyInput.includes(geography.changes[0].uncertainty));
    assert.deepEqual(result.branch.branches[0].geography, geography);
    saved.branches[0].geography.changes[0].uncertainty = 'An army occupies the region.';
    writeFileSync(source, JSON.stringify(saved));
    const { createTopicPolicy } = await import('../src/guardrails/topicPolicy.js');
    const blocked = await runHarness({ from: source, client: { spent: () => 0 }, outputRoot: dir, timestamp: 'geo-block', log() {},
      image: { generate() { throw new Error('unexpected generation'); } }, policy: createTopicPolicy() });
    assert.equal(blocked.blocked, true);
    saved.branches[0].geography.changes[0].region = 'atlantis';
    writeFileSync(source, JSON.stringify(saved));
    await assert.rejects(runHarness({ from: source, client: { spent: () => 0 }, outputRoot: dir, timestamp: 'geo-invalid', log() {} }), /Invalid geography/);
    geography.changes[0].region = 'sahara';
    geography.changes[0].uncertainty = 'Rainfall boundaries are illustrative.';
    saved.branches[0].geography = geography;
    saved.hero.branchId = 'unknown';
    writeFileSync(source, JSON.stringify(saved));
    await assert.rejects(runHarness({ from: source, client: { spent: () => 0 }, outputRoot: dir, timestamp: 'geo-hero', log() {} }), /requires a saved hero branch/);
    saved.hero.branchId = 'b1';
    saved.continuation = { rootRunId: 'root', rootDivergence: 'A greener Sahara', parentRunId: 'root', parentBranchId: 'b1',
      path: [{ runId: 'root', branchId: 'b1', title: 'Grasslands persist', year: 300, summary: 'Grasslands persist.', place: { name: 'Sahara', lat: 24, lon: 12 }, geography: { version: 1, changes: [{ ...geography.changes[0], region: 'sahara' }] } }] };
    saved.branches[0].geography = { version: 1, changes: [] };
    writeFileSync(source, JSON.stringify(saved));
    await assert.rejects(runHarness({ from: source, client: { spent: () => 0 }, outputRoot: dir, timestamp: 'geo-erased', log() {} }), /inherited condition/);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('CLI refuses unconfirmed 3D before Meta work', () => {
  const dir=temp();
  try { const env={...process.env,CHRONOS_3D_CAPABILITY_CONFIRMED:'false'}; const script=fileURLToPath(new URL('../harness/run.js',import.meta.url));
    const result=spawnSync(process.execPath,[script,'What if a library survived?'],{cwd:dir,env,encoding:'utf8'});
    assert.equal(result.status,1); assert.match(result.stderr,/capability must be confirmed/); assert.deepEqual(readdirSync(join(dir,'out')),[]);
  } finally {rmSync(dir,{recursive:true,force:true});}
});

test('disconnect after proposal waits for review and prevents image and 3D work', async () => {
  const dir=temp();
  try {
    const {createBranchAgent}=await import('../src/agents/branchAgent.js');
    const controller=new AbortController(), branch={id:'b1',title:'Observatory',year:500,place:{name:'Alexandria',lat:31,lon:29},summary:'Astronomers study the sky.',scene:'An orrery.'};
    let release, reviewSettled=false, idle=false, imageCalls=0, jobs=0;
    const client={spent:()=>0,waitForIdle:async()=>{idle=true;},respond:async ({label})=>{
      if(label.endsWith(':review')) {await new Promise(resolve=>{release=resolve;});reviewSettled=true;return {text:JSON.stringify({scores:[{id:'b1',score:9}],hero:{id:'b1',imagePrompt:'An orrery',subject:'orrery'}}),costUsd:0};}
      return {text:JSON.stringify([branch]),costUsd:0};
    }};
    const policy={checkPrompt:async()=>({allowed:true,layer:'keyword'}),checkBranches:async()=>({kept:[branch],rejected:[]})};
    const agent=createBranchAgent({client,policy});
    let finished=false;
    const pending=runHarness({divergence:'What if an ancient library survived?',agent,client,signal:controller.signal,outputRoot:dir,timestamp:9,log(){},no3d:false,
      image:{generate(){imageCalls++;}},sam:{segment(){throw new Error('unexpected SAM');}},chronos3d:{generate(){jobs++;}},
      onStep:event=>{if(event.step==='propose' && event.pending === false) controller.abort();}}).finally(()=>{finished=true;});
    await new Promise(resolve=>setImmediate(resolve));
    assert.equal(finished,false); assert.equal(reviewSettled,false);
    release(); await assert.rejects(pending,/Run aborted/);
    assert.equal(reviewSettled,true);assert.equal(idle,true);assert.equal(imageCalls,0);assert.equal(jobs,0);
    assert.match(JSON.parse(readFileSync(join(dir,'9','trace.json'))).steps.at(-1).error,/aborted/);
  } finally {rmSync(dir,{recursive:true,force:true});}
});
