import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { PNG } from 'pngjs';
import { createSamMask, selectMask } from '../src/providers/samMask.js';

// Payloads are synthetic 2x2 rasters produced by the package's internal conformance encoder.
const fixture = await readFile(new URL('./fixtures/sam-synthetic.txt', import.meta.url), 'utf8');
const image = PNG.sync.write(new PNG({ width: 3, height: 3 }));
const request = { image, mime: 'image/png', prompt: 'anatomical atlas on oak lectern' };

test('SAM uses documented request fields, decodes and places masks, and selects highest confidence', async () => {
  const calls = [];
  const client = { async meteredPost(...args) { calls.push(args); return { output_text: fixture }; } };
  const result = await createSamMask({ client, env: {} }).segment(request);
  assert.equal(calls.length, 1);
  const [path, body, charge] = calls[0];
  assert.equal(path, '/responses');
  assert.deepEqual(Object.keys(body).sort(), ['input', 'metadata', 'model']);
  assert.equal(body.model, 'sam-3.1');
  assert.deepEqual(body.metadata, { include_confidence: 'true' });
  assert.deepEqual(body.input[0].content, [{ type: 'input_text', text: request.prompt }, { type: 'input_image', image_url: `data:image/png;base64,${image.toString('base64')}` }]);
  assert.equal(charge.costUsd, 0.05);
  assert.equal(result.costUsd, 0.05);
  assert.equal(result.selectedMask.confidence, 0.9);
  assert.deepEqual([...result.selectedMask.raster], [0,0,0,0,1,1,0,1,1]);
  assert.equal(result.rawOutputs[0], fixture);
});

test('SAM falls back once to head noun only when no matches', async () => {
  const calls = [];
  const observed = await Promise.all([1, 2].map(i => readFile(new URL(`./fixtures/sam-live-empty-${i}.txt`, import.meta.url), 'utf8')));
  const client = { async meteredPost(path, body) { calls.push(body); return { output_text: observed[calls.length - 1] }; } };
  const result = await createSamMask({ client, env: { META_SEGMENT_COST_USD: '0.02' } }).segment(request);
  assert.deepEqual(calls.map(x => x.input[0].content[0].text), [request.prompt, 'atlas']);
  assert.equal(result.costUsd, 0.04);
  assert.equal(result.selectedMask, null);
  assert.equal(result.rawOutputs.length, 2);
  assert.deepEqual(result.rawOutputs, observed);
  assert.deepEqual(result.rawResponses, observed.map(output_text => ({ output_text })));
});

test('confidence ties use foreground area and unknown confidence stays unknown', () => {
  const a = { confidence: 0.5, raster: Uint8Array.of(1,0) };
  const b = { confidence: 0.5, raster: Uint8Array.of(1,1) };
  const c = { raster: Uint8Array.of(1,1) };
  assert.equal(selectMask([a, b, c]), b);
  assert.equal(selectMask([c]), c);
});

test('malformed output and invalid cost fail rather than silently fall back', async () => {
  assert.throws(() => createSamMask({ client: { meteredPost() {} }, env: { META_SEGMENT_COST_USD: '-1' } }), /nonnegative/);
  let calls = 0;
  const provider = createSamMask({ client: { async meteredPost() { calls++; return { output_text: '<0f>bad' }; } }, env: {} });
  await assert.rejects(provider.segment(request), error => {
    assert.match(error.message, /could not be parsed/);
    assert.deepEqual(error.rawOutputs, ['<0f>bad']);
    assert.equal(error.costUsd, 0.05);
    assert.equal(error.trace[0].costUsd, 0.05);
    return true;
  });
  assert.equal(calls, 1);
});

test('fallback refusal retains first paid response and a zero-cost failed attempt', async () => {
  let calls = 0;
  const provider = createSamMask({ client: { async meteredPost() {
    if (++calls === 1) return { output_text: '' };
    throw new Error('spend cap');
  } }, env: {} });
  await assert.rejects(provider.segment(request), error => {
    assert.deepEqual(error.rawOutputs, ['']);
    assert.equal(error.costUsd, 0.05);
    assert.equal(error.trace.length, 2);
    assert.equal(error.trace[1].costUsd, 0);
    assert.equal(error.trace[1].status, 'failed');
    return true;
  });
});
