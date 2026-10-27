import test from 'node:test';
import assert from 'node:assert/strict';
import { createMetaImage } from '../src/providers/metaImage.js';
import { createMetaClient, SpendCapError } from '../src/lib/metaClient.js';

test('image request is documented and decoded with default cost', async () => {
  let captured;
  const provider = createMetaImage({ env: {}, client: { async meteredPost(...args) { captured = args; return { data: [{ b64_json: Buffer.from('image').toString('base64') }] }; } } });
  const result = await provider.generate({ prompt: 'an atlas', size: '512x768' });
  assert.deepEqual(captured, ['/images/generations', { model: 'muse-image-1.0', prompt: 'an atlas', n: 1, size: '512x768', response_format: 'b64_json', output_format: 'png' }, { costUsd: 0.01, label: 'image' }]);
  assert.deepEqual(result, { buffer: Buffer.from('image'), mime: 'image/png', costUsd: 0.01 });
});
test('image cost override is validated and used', async () => {
  let options;
  const client = { async meteredPost(_path, _body, opts) { options = opts; return { data: [{ b64_json: 'eA==' }] }; } };
  const image = createMetaImage({ client, env: { META_IMAGE_COST_USD: '0' } });
  assert.equal((await image.generate({ prompt: 'atlas' })).costUsd, 0);
  assert.equal(options.costUsd, 0);
  for (const costUsd of [-1, Infinity, NaN]) assert.throws(() => createMetaImage({ client, costUsd }));
});
test('image generation refuses an exhausted cap before network', async () => {
  let calls = 0;
  const client = createMetaClient({ apiKey: 'fixture', spendCapUsd: 0.009, fetch: async () => { calls++; throw new Error('unexpected network'); } });
  await assert.rejects(createMetaImage({ client, env: {} }).generate({ prompt: 'atlas' }), SpendCapError);
  assert.equal(calls, 0);
});

test('decodes a large image without overflowing the stack', async () => {
  const source = Buffer.alloc(4 * 1024 * 1024, 173);
  const client = { async meteredPost() { return { data: [{ b64_json: source.toString('base64') }] }; } };
  const result = await createMetaImage({ client, env: {} }).generate({ prompt: 'atlas' });
  assert.deepEqual(result.buffer, source);
});
test('rejects malformed base64 and retains the response without logging it', async () => {
  for (const encoded of ['bad!', 'eA', 'eA==\n', 'eB==', '']) {
    const response = { data: [{ b64_json: encoded }] };
    const client = { async meteredPost() { return response; } };
    await assert.rejects(createMetaImage({ client, env: {} }).generate({ prompt: 'atlas' }), error => {
      assert.equal(error.rawResponse, response);
      assert.equal(Object.keys(error).includes('rawResponse'), false);
      assert.equal(error.message.includes(encoded) && encoded.length > 0, false);
      return true;
    });
  }
});
