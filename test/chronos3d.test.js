import test from 'node:test';
import assert from 'node:assert/strict';
import { createChronos3dClient, chronosIdempotencyKey } from '../src/providers/chronos3d.js';
import { memoryLedger } from '../src/lib/spendLedger.js';

const key = chronosIdempotencyKey('run', { subject: 'orrery' });
const png = Buffer.from('png');
const glb = Buffer.alloc(20); glb.write('glTF'); glb.writeUInt32LE(2, 4); glb.writeUInt32LE(20, 8);
const job = (status, extra = {}) => ({ jobId: 'abc-1', status, provider: { id: 'trellis' }, ...extra });
const json = data => new Response(JSON.stringify(data), { status: 200 });
const bytes = data => new Response(data, { status: 200 });
const ledger = () => { const keys = new Set(); return { keys, reserveChronosJob({ idempotencyKey, maxJobs }) { if (!keys.has(idempotencyKey) && keys.size >= maxJobs) throw new Error('job cap'); keys.add(idempotencyKey); } }; };
const client = (fetch, opts = {}) => createChronos3dClient({ baseUrl: 'https://example.invalid', token: 'test-secret', fetch, jobLedger: ledger(), capabilityConfirmed: true, pollMs: 1, ...opts });
const args = { imagePng: png, maskPng: png, idempotencyKey: key };

test('stable keys are scoped to run and hero', () => { assert.equal(key, chronosIdempotencyKey('run', { subject: 'orrery' })); assert.notEqual(key, chronosIdempotencyKey('run2', { subject: 'orrery' })); });
test('submits relic, polls and downloads valid GLB', async () => {
  const calls = []; const replies = [json(job('queued')), json(job('processing')), json(job('completed', { artifact: { kind: 'glb', url: '/api/lyra/jobs/abc-1/model' } })), bytes(glb)];
  const result = await client(async (url, init) => { calls.push([String(url), init]); return replies.shift(); }).generate(args);
  assert.deepEqual(result.glb, glb); assert.equal(result.jobId, 'abc-1');
  const body = JSON.parse(calls[0][1].body); assert.equal(body.providerId, 'trellis'); assert.deepEqual(body.relic, { v: 1 }); assert.equal(body.idempotencyKey, key); assert.equal(body.imageProfile, '3d-object'); assert.equal(body.sourceDataUrl, `data:image/png;base64,${png.toString('base64')}`); assert.equal(body.maskDataUrl, body.sourceDataUrl); assert.equal(calls[0][1].headers.authorization, 'Bearer test-secret');
});
test('fails closed without confirmed capability and without reserving', async () => { const l = ledger(); let called = false; await assert.rejects(client(async () => { called = true; }, { jobLedger: l, capabilityConfirmed: false }).generate(args), /not confirmed/); assert.equal(called, false); assert.equal(l.keys.size, 0); });
test('failures and unknown provider are counted and never trigger another submission', async () => { const l = ledger(); let calls = 0; await assert.rejects(client(async () => { calls++; return json(job('failed')); }, { jobLedger: l }).generate(args), /failed/); assert.equal(l.keys.size, 1); assert.equal(calls, 1); await assert.rejects(client(async () => json(job('queued', { provider: { id: 'mock' } })), { jobLedger: l }).generate(args), /did not select/); });
test('durable ledger refuses duplicate and new jobs at the cap after failure', async () => { const l = memoryLedger(); let calls = 0; const c = client(async () => { calls++; return json(job('failed')); }, { jobLedger: l, maxJobs: 1 }); await assert.rejects(c.generate(args)); await assert.rejects(c.generate(args), /already reserved/); await assert.rejects(c.generate({ ...args, idempotencyKey: chronosIdempotencyKey('other', 'hero') }), /cap/); assert.equal(calls, 1); });
test('rejects remote plain HTTP while permitting loopback fixtures', () => { assert.throws(() => client(async () => {}, { baseUrl: 'http://example.invalid' }), /HTTPS/); assert.doesNotThrow(() => client(async () => {}, { baseUrl: 'http://127.0.0.1:5000' })); });
test('network errors never expose credentials or responses', async () => { await assert.rejects(client(async () => { throw new Error('test-secret'); }).generate(args), error => !error.message.includes('test-secret')); });
test('timeout and caller abort are respected', async () => { const fetch = async (_url, { signal }) => new Promise((_, reject) => signal.addEventListener('abort', () => reject(Error('secret')))); const keepAlive = setTimeout(() => {}, 100); try { await assert.rejects(client(fetch, { timeoutMs: 10 }).generate(args), /timed out/); } finally { clearTimeout(keepAlive); } const a = new AbortController(); a.abort(); await assert.rejects(client(async (_url, { signal }) => { if (signal.aborted) throw Error('aborted'); }, {}).generate({ ...args, signal: a.signal }), /aborted/); });
test('cross-origin model requires allowlist and never receives bearer', async () => { const artifact = { kind: 'glb', url: 'https://assets.example.invalid/model' }; let calls = []; const makeFetch = async (url, init) => { calls.push(init); return calls.length === 1 ? json(job('completed', { artifact })) : bytes(glb); }; await assert.rejects(client(makeFetch).generate(args), /origin/); calls = []; await client(makeFetch, { allowedArtifactOrigins: ['https://assets.example.invalid'] }).generate(args); assert.equal(calls[1].headers, undefined); assert.equal(calls[1].redirect, 'error'); });
test('invalid GLB is rejected', async () => { let n = 0; await assert.rejects(client(async () => ++n === 1 ? json(job('completed', { artifact: { kind: 'glb', url: '/model' } })) : bytes(Buffer.from('bad'))).generate(args), /Invalid GLB/); });
