import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createMetaClient, SpendCapError, MetaApiError, outputText, markUndispatchedBudgetError } from '../src/lib/metaClient.js';
import { costFromUsage } from '../src/lib/pricing.js';
import { memoryLedger } from '../src/lib/spendLedger.js';

test('only budget refusal before any Meta dispatch is marked safe to retry', async () => {
  const client = createMetaClient({ apiKey: 'test-key', spendCapUsd: 0, fetch: async () => { throw new Error('must not dispatch'); } });
  const start = client.dispatchCount();
  let error;
  try { await client.meteredPost('/images', { model: 'test' }, { costUsd: 0.1 }); } catch (caught) { error = caught; }
  assert.ok(error instanceof SpendCapError);
  assert.equal(markUndispatchedBudgetError(error, client, start).continuationRetryable, true);
  assert.equal(client.dispatchCount(), 0);

  const sent = createMetaClient({ apiKey: 'test-key', spendCapUsd: 1, fetch: async () => { throw new Error('network uncertain'); } });
  const before = sent.dispatchCount();
  await assert.rejects(sent.meteredPost('/images', { model: 'test' }, { costUsd: 0.1 }));
  assert.equal(sent.dispatchCount(), 1);
  let refused;
  try { await sent.meteredPost('/images', { model: 'test' }, { costUsd: 0.1 }); } catch (caught) { refused = caught; }
  assert.ok(refused instanceof SpendCapError);
  assert.equal(markUndispatchedBudgetError(refused, sent, before).continuationRetryable, undefined);

  const charged = createMetaClient({ apiKey: 'test-key', spendCapUsd: 0.15, fetch: async () => Response.json({ ok: true }) });
  const runStart = charged.dispatchCount();
  await charged.meteredPost('/images', { model: 'test' }, { costUsd: 0.1 });
  let later;
  try { await charged.meteredPost('/images', { model: 'test' }, { costUsd: 0.1 }); } catch (caught) { later = caught; }
  assert.ok(later instanceof SpendCapError);
  assert.equal(markUndispatchedBudgetError(later, charged, runStart).continuationRetryable, undefined, 'a settled earlier request is still a dispatch');
});
// Recorded shape of a Meta Responses payload (per dev.meta.ai/docs/quickstart).
const RESPONSE_FIXTURE = {
  id: 'resp_1', object: 'response', status: 'completed', model: 'muse-spark-1.3',
  output: [
    { type: 'reasoning', summary: [] },
    { type: 'message', role: 'assistant', content: [{ type: 'output_text', text: 'Paris.' }] },
  ],
  usage: { input_tokens: 15, input_tokens_details: { cached_tokens: 0 }, output_tokens: 258, output_tokens_details: { reasoning_tokens: 241 }, total_tokens: 273 },
};

function fakeFetch(responses) {
  const calls = [];
  const fn = async (url, init) => {
    calls.push({ url, init, body: init.body ? JSON.parse(init.body) : undefined });
    const next = responses.shift();
    return {
      ok: next.status >= 200 && next.status < 300,
      status: next.status,
      headers: { get: k => next.headers?.[k.toLowerCase()] },
      json: async () => next.body,
      text: async () => (typeof next.body === 'string' ? next.body : JSON.stringify(next.body)),
    };
  };
  fn.calls = calls;
  return fn;
}

const base = { apiKey: 'test-key', env: {}, sleep: async () => {} };

test('respond() posts to /responses with bearer auth and returns text + cost', async () => {
  const fetch = fakeFetch([{ status: 200, body: RESPONSE_FIXTURE }]);
  const client = createMetaClient({ ...base, fetch });
  const out = await client.respond({ model: 'muse-spark-1.3', input: 'Capital of France?' });

  assert.equal(fetch.calls[0].url, 'https://api.meta.ai/v1/responses');
  assert.equal(fetch.calls[0].init.headers.Authorization, 'Bearer test-key');
  assert.equal(fetch.calls[0].body.model, 'muse-spark-1.3');
  assert.equal(out.text, 'Paris.');
  // 15 * 1.25/M + 258 * 4.25/M
  assert.ok(Math.abs(out.costUsd - (15 * 1.25 + 258 * 4.25) / 1e6) < 1e-12);
  assert.equal(client.spent(), out.costUsd);
});

test('respond() includes validated Responses reasoning effort when requested', async () => {
  const fetch = fakeFetch([{ status: 200, body: RESPONSE_FIXTURE }]);
  const client = createMetaClient({ ...base, fetch });
  await client.respond({ model: 'muse-wonder-1.0', input: 'x', reasoning: { effort: 'low' } });
  assert.deepEqual(JSON.parse(fetch.calls[0].init.body).reasoning, { effort: 'low' });
  await assert.rejects(client.respond({ model: 'muse-wonder-1.0', input: 'x', reasoning: { effort: 'extreme' } }), /reasoning effort/);
  assert.equal(fetch.calls.length, 1);
});

test('spend cap refuses a call before it is sent', async () => {
  const fetch = fakeFetch([]);
  const client = createMetaClient({ ...base, fetch, spendCapUsd: 1, ledger: memoryLedger(0.999) });
  await assert.rejects(client.respond({ model: 'muse-spark-1.3', input: 'x' }), SpendCapError);
  assert.equal(fetch.calls.length, 0);
});

test('respond and metered image requests pass AbortSignal to fetch and keep dispatched spend uncertain', async () => {
  let observedSignal;
  const fetch = (_url, init) => new Promise((_, reject) => {
    observedSignal = init.signal;
    init.signal.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError')), { once:true });
  });
  const client = createMetaClient({ ...base, fetch, spendCapUsd:1, ledger:memoryLedger() });
  const controller = new AbortController();
  const pending = client.respond({ model:'muse-spark-1.3', input:'test', signal:controller.signal });
  await new Promise(resolve => setImmediate(resolve));
  controller.abort();
  await assert.rejects(pending, /Meta request stopped/);
  assert.equal(observedSignal.aborted, true);
  assert.equal(client.dispatchCount(), 1, 'an aborted dispatched call is not released as unspent');
});

test('meteredPost charges the supplied per-call cost and respects the cap', async () => {
  const fetch = fakeFetch([{ status: 200, body: { data: [{ b64_json: 'AAA' }] } }]);
  const client = createMetaClient({ ...base, fetch, spendCapUsd: 0.1 });
  await client.meteredPost('/images/generations', { model: 'muse-image' }, { costUsd: 0.06 });
  assert.equal(client.spent(), 0.06);
  await assert.rejects(client.meteredPost('/images/generations', { model: 'muse-image' }, { costUsd: 0.06 }), SpendCapError);
  assert.equal(fetch.calls.length, 1);
});

test('concurrent calls retain the reservation after a failed request', async () => {
  let finish;
  let calls = 0;
  const fetch = async () => {
    calls++;
    await new Promise(resolve => { finish = resolve; });
    return { ok: false, status: 400, text: async () => 'fixture failure' };
  };
  const client = createMetaClient({ ...base, fetch, spendCapUsd: 0.1 });
  const first = client.meteredPost('/images/generations', {}, { costUsd: 0.06 });
  await assert.rejects(client.meteredPost('/responses', {}, { costUsd: 0.05 }), SpendCapError);
  assert.equal(calls, 1);
  assert.ok(Math.abs(client.remaining() - 0.04) < 1e-9);
  let idle = false;
  const settled = client.waitForIdle().then(() => { idle = true; });
  assert.equal(idle, false);
  finish();
  await assert.rejects(first, MetaApiError);
  await settled;
  assert.ok(Math.abs(client.remaining() - 0.04) < 1e-9);
});

test('rejects invalid caps and call costs', async () => {
  for (const spendCapUsd of [-1, NaN, Infinity]) assert.throws(() => createMetaClient({ ...base, spendCapUsd }), /finite and nonnegative/);
  const client = createMetaClient(base);
  for (const costUsd of [-1, NaN, Infinity]) await assert.rejects(client.meteredPost('/x', {}, { costUsd }), /finite and nonnegative/);
});

test('does not retry paid POST failures and gives up with MetaApiError', async () => {
  const fetch = fakeFetch([{ status: 429, body: 'slow down' }, { status: 200, body: RESPONSE_FIXTURE }]);
  const client = createMetaClient({ ...base, fetch });
  await assert.rejects(client.respond({ model: 'muse-spark-1.3', input: 'x' }), MetaApiError);
  assert.equal(fetch.calls.length, 1);

  const bad = createMetaClient({ ...base, fetch: fakeFetch([{ status: 400, body: { error: 'bad model' } }]) });
  await assert.rejects(bad.respond({ model: 'nope', input: 'x' }), MetaApiError);
});

test('missing API key fails loudly', async () => {
  const client = createMetaClient({ env: {}, fetch: fakeFetch([]) });
  await assert.rejects(client.respond({ model: 'muse-spark-1.3', input: 'x' }), /META_API_KEY/);
});

test('accepts MODEL_API_KEY (the name Meta docs use)', async () => {
  const fetch = fakeFetch([{ status: 200, body: RESPONSE_FIXTURE }]);
  const client = createMetaClient({ env: { MODEL_API_KEY: 'k2' }, fetch, sleep: async () => {} });
  await client.respond({ model: 'muse-spark-1.3', input: 'x' });
  assert.equal(fetch.calls[0].init.headers.Authorization, 'Bearer k2');
});

test('unknown models are priced at the highest known rates and flagged estimated', () => {
  const { estimated } = costFromUsage('future-model', { input_tokens: 10, output_tokens: 10 });
  assert.equal(estimated, true);
  assert.equal(costFromUsage('muse-spark-1.1', { input_tokens: 0, output_tokens: 0 }).estimated, false);
});

test('outputText walks output[] when output_text is absent', () => {
  assert.equal(outputText(RESPONSE_FIXTURE), 'Paris.');
  assert.equal(outputText({ output_text: 'direct' }), 'direct');
});

test('rejects a non-URL base (e.g. key pasted into META_API_BASE_URL) and trims whitespace', async () => {
  assert.throws(() => createMetaClient({ env: { META_API_KEY: 'k', META_API_BASE_URL: 'LLM_abc' } }), /META_API_BASE_URL/);
  const fetch = fakeFetch([{ status: 200, body: RESPONSE_FIXTURE }]);
  const client = createMetaClient({ env: { META_API_KEY: '  k3 ', META_API_BASE_URL: ' ' }, fetch, sleep: async () => {} });
  await client.respond({ model: 'muse-spark-1.3', input: 'x' });
  assert.equal(fetch.calls[0].url, 'https://api.meta.ai/v1/responses');
  assert.equal(fetch.calls[0].init.headers.Authorization, 'Bearer k3');
});

test('daily cap is shared between clients using the same ledger', async () => {
  const ledger = memoryLedger();
  let resolveFirst;
  const first = createMetaClient({ ...base, ledger, dailyCapUsd: 0.1, fetch: async () => { await new Promise(r => { resolveFirst = r; }); return { ok: true, json: async () => ({}) }; } });
  let secondCalls = 0;
  const second = createMetaClient({ ...base, ledger, dailyCapUsd: 0.1, fetch: async () => { secondCalls++; return { ok: true, json: async () => ({}) }; } });
  const running = first.meteredPost('/images', {}, { costUsd: 0.06 });
  await assert.rejects(second.meteredPost('/images', {}, { costUsd: 0.06 }), SpendCapError);
  assert.equal(secondCalls, 0);
  resolveFirst(); await running;
  await assert.rejects(second.meteredPost('/images', {}, { costUsd: 0.06 }), SpendCapError);
});

test('shared client scopes dispatch and settled spend to concurrent invocations', async () => {
  const ledger = memoryLedger();
  const releases = new Map(), started = new Set();
  const client = createMetaClient({ ...base, ledger, spendCapUsd: 1, fetch: async (_url, init) => {
    const label = JSON.parse(init.body).label;
    started.add(label);
    await new Promise(resolve => releases.set(label, resolve));
    return Response.json({ ok: true });
  } });
  const a = client.createInvocation(), b = client.createInvocation();
  const runA = client.runWithInvocation(a, () => client.meteredPost('/images', { label: 'a' }, { costUsd: 0.04 }));
  const runB = client.runWithInvocation(b, () => client.meteredPost('/images', { label: 'b' }, { costUsd: 0.07 }));
  while (started.size < 2) await new Promise(resolve => setTimeout(resolve, 1));
  releases.get('b')(); await runB;
  releases.get('a')(); await runA;
  assert.equal(a.dispatchCount(), 1); assert.equal(b.dispatchCount(), 1);
  assert.equal(a.spent(), 0.04); assert.equal(b.spent(), 0.07);
  assert.ok(Math.abs(ledger.total() - 0.11) < 1e-12);
});

test('shared-client spend refusal is classified using only that invocation dispatches', async () => {
  const ledger = memoryLedger();
  let release;
  const client = createMetaClient({ ...base, ledger, spendCapUsd: 0.1, fetch: async () => {
    await new Promise(resolve => { release = resolve; });
    return Response.json({ ok: true });
  } });
  const first = client.createInvocation(), second = client.createInvocation();
  const running = client.runWithInvocation(first, () => client.meteredPost('/images', {}, { costUsd: 0.08 }));
  while (!release) await new Promise(resolve => setTimeout(resolve, 1));
  let refusal;
  try { await client.runWithInvocation(second, () => client.meteredPost('/images', {}, { costUsd: 0.08 })); }
  catch (error) { refusal = error; }
  assert.ok(refusal instanceof SpendCapError);
  assert.equal(markUndispatchedBudgetError(refusal, second, 0).continuationRetryable, true);
  assert.equal(first.dispatchCount(), 1); assert.equal(second.dispatchCount(), 0);
  release(); await running;
  assert.equal(first.spent(), 0.08); assert.equal(second.spent(), 0);
});

test('missing usage retains its reservation and blocks future calls', async () => {
  const ledger = memoryLedger();
  const fetch = fakeFetch([{ status: 200, body: { output_text: 'fixture' } }]);
  const client = createMetaClient({ ...base, ledger, fetch });
  await assert.rejects(client.respond({ model: 'muse-spark', input: 'x' }), /usage unavailable/);
  assert.equal(ledger.total(), 0);
  assert.ok(ledger.reserved() > 0);
  await assert.rejects(client.respond({ model: 'muse-spark', input: 'x' }), SpendCapError);
  assert.equal(fetch.calls.length, 1);
});

test('actual cost above reservation is retained and blocks future calls', async () => {
  const ledger = memoryLedger();
  const fetch = fakeFetch([{ status: 200, body: { output_text: 'fixture', usage: { input_tokens: 1, output_tokens: 10000 } } }]);
  const client = createMetaClient({ ...base, ledger, fetch });
  const result = await client.respond({ model: 'muse-spark', input: 'x', maxOutputTokens: 1 });
  assert.equal(ledger.total(), result.costUsd);
  await assert.rejects(client.respond({ model: 'muse-spark', input: 'x' }), SpendCapError);
});

test('rejects unsafe transport and never exposes upstream error content', async () => {
  assert.throws(() => createMetaClient({ ...base, baseUrl: 'http://example.com' }), /META_API_BASE_URL/);
  assert.throws(() => createMetaClient({ ...base, baseUrl: 'https://user:password@example.com' }), /META_API_BASE_URL/);
  assert.doesNotThrow(() => createMetaClient({ ...base, baseUrl: 'http://localhost:1234' }));
  const fetch = fakeFetch([{ status: 503, body: 'sentinel-secret' }]);
  const client = createMetaClient({ ...base, fetch });
  await assert.rejects(client.respond({ model: 'muse-spark', input: 'x' }), e => { assert.doesNotMatch(JSON.stringify(e) + e.message, /sentinel-secret/); return e instanceof MetaApiError; });
  assert.equal(fetch.calls[0].init.redirect, 'error');
  assert.equal(fetch.calls.length, 1);
});

test('rejects unmetered tools and output limit overrides before making a request', async () => {
  const fetch = fakeFetch([]);
  const client = createMetaClient({ ...base, fetch });
  await assert.rejects(client.respond({ model: 'muse-wonder-1.0', input: 'x', max_output_tokens: 999999 }), /Unsupported/);
  await assert.rejects(client.respond({ model: 'muse-wonder-1.0', input: 'x', tools: [{ type: 'web_search' }] }), /Unsupported/);
  assert.equal(fetch.calls.length, 0);
});

test('invalid usage retains the reservation and stops further calls', async () => {
  const ledger = memoryLedger();
  const fetch = fakeFetch([{ status: 200, body: { usage: { input_tokens: 2, output_tokens: 1, input_tokens_details: { cached_tokens: 3 } } } }]);
  const client = createMetaClient({ ...base, fetch, ledger });
  await assert.rejects(client.respond({ model: 'muse-wonder-1.0', input: 'x' }), /usage unavailable or invalid/);
  assert.ok(ledger.reserved() > 0);
  await assert.rejects(client.respond({ model: 'muse-wonder-1.0', input: 'x' }), SpendCapError);
});
