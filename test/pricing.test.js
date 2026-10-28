import test from 'node:test';
import assert from 'node:assert/strict';
import { costFromUsage, estimateTextCost } from '../src/lib/pricing.js';

test('Wonder and Spark price regular, cached, and output tokens at their published rates', () => {
  const usage = { input_tokens: 1000, input_tokens_details: { cached_tokens: 200 }, output_tokens: 500 };
  assert.deepEqual(costFromUsage('muse-wonder-1.0', usage), { usd: (800 * 4 + 200 * .2 + 500 * 20) / 1e6, estimated: false });
  assert.deepEqual(costFromUsage('muse-spark-1.3', usage), { usd: (800 * 1.25 + 200 * .15 + 500 * 4.25) / 1e6, estimated: false });
  assert.deepEqual(costFromUsage('unknown-model', usage), { ...costFromUsage('muse-wonder-1.0', usage), estimated: true });
});

test('missing, malformed, or impossible usage is never silently priced as zero', () => {
  for (const usage of [undefined, {}, { input_tokens: 1 }, { input_tokens: '1', output_tokens: 0 }, { input_tokens: 1, output_tokens: -1 }, { input_tokens: 1, output_tokens: 1, input_tokens_details: { cached_tokens: 2 } }, { input_tokens: 1, output_tokens: 1, input_tokens_details: { cached_tokens: null } }]) {
    assert.throws(() => costFromUsage('muse-wonder-1.0', usage), /usage unavailable or invalid/);
  }
});

test('preflight estimates full UTF-8 request bytes plus framing and maximum output', () => {
  const body = JSON.stringify({ input: [{ role: 'user', content: '🌍 地図' }] });
  const bytes = Buffer.byteLength(body, 'utf8');
  assert.ok(bytes > body.length);
  assert.equal(estimateTextCost('muse-wonder-1.0', { inputBytes: bytes, maxOutputTokens: 100 }), ((bytes + 4096) * 4 + 100 * 20) / 1e6);
  assert.throws(() => estimateTextCost('muse-wonder-1.0', { inputBytes: bytes, maxOutputTokens: -1 }), /Invalid/);
});
