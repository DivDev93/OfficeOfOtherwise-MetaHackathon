import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createMetaClient, SpendCapError, MetaApiError, outputText } from '../src/lib/metaClient.js';
import { costFromUsage } from '../src/lib/pricing.js';
import { memoryLedger } from '../src/lib/spendLedger.js';

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

test('spend cap refuses a call before it is sent', async () => {
  const fetch = fakeFetch([]);
  const client = createMetaClient({ ...base, fetch, spendCapUsd: 1, ledger: memoryLedger(0.999) });
  await assert.rejects(client.respond({ model: 'muse-spark-1.3', input: 'x' }), SpendCapError);
  assert.equal(fetch.calls.length, 0);
});

test('meteredPost charges the supplied per-call cost and respects the cap', async () => {
  const fetch = fakeFetch([{ status: 200, body: { data: [{ b64_json: 'AAA' }] } }]);
  const client = createMetaClient({ ...base, fetch, spendCapUsd: 0.1 });
  await client.meteredPost('/images/generations', { model: 'muse-image' }, { costUsd: 0.06 });
  assert.equal(client.spent(), 0.06);
  await assert.rejects(client.meteredPost('/images/generations', { model: 'muse-image' }, { costUsd: 0.06 }), SpendCapError);
  assert.equal(fetch.calls.length, 1);
});

test('retries 429 then succeeds; gives up with MetaApiError on 400', async () => {
  const fetch = fakeFetch([{ status: 429, body: 'slow down' }, { status: 200, body: RESPONSE_FIXTURE }]);
  const client = createMetaClient({ ...base, fetch });
  const out = await client.respond({ model: 'muse-spark-1.3', input: 'x' });
  assert.equal(out.text, 'Paris.');
  assert.equal(fetch.calls.length, 2);

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

test('unknown models are priced conservatively and flagged estimated', () => {
  const { estimated } = costFromUsage('muse-wonder-1.0', { input_tokens: 10, output_tokens: 10 });
  assert.equal(estimated, true);
  assert.equal(costFromUsage('muse-spark-1.1', {}).estimated, false);
});

test('outputText walks output[] when output_text is absent', () => {
  assert.equal(outputText(RESPONSE_FIXTURE), 'Paris.');
  assert.equal(outputText({ output_text: 'direct' }), 'direct');
});
