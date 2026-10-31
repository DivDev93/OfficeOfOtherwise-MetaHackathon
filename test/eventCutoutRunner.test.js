import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { PNG } from 'pngjs';
import { fileLedger } from '../src/lib/spendLedger.js';
import { createDemoEventCutoutRunner } from '../src/demo/pipeline.js';

async function fixtureRoot() {
  const root = await mkdtemp(join(tmpdir(), 'event-cutout-runner-'));
  fileLedger(join(root, 'spend.json')).initialize();
  return root;
}

test('event cutout runner uses the shared metered SAM client and applies its selected mask', async t => {
  const root = await fixtureRoot(); t.after(() => rm(root, { recursive: true, force: true }));
  const fixture = await readFile(new URL('./fixtures/sam-synthetic.txt', import.meta.url), 'utf8');
  const calls = [];
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (url, options) => {
    calls.push({ url: String(url), body: JSON.parse(options.body) });
    return { ok: true, json: async () => ({ output_text: fixture }) };
  };
  t.after(() => { globalThis.fetch = originalFetch; });
  const source = new PNG({ width: 3, height: 3 });
  for (let i = 0; i < source.data.length; i += 4) source.data.set([80, 120, 160, 255], i);
  const image = PNG.sync.write(source);
  const runner = createDemoEventCutoutRunner({ outputRoot: root, env: { META_API_KEY: 'fixture-key', META_API_BASE_URL: 'http://localhost', META_SEGMENT_COST_USD: '0.05' } });
  const result = await runner({ image, prompt: 'A bronze orrery' });
  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, 'http://localhost/responses');
  assert.equal(calls[0].body.model, 'sam-3.1');
  assert.equal(calls[0].body.input[0].content[0].text, 'A bronze orrery');
  assert.equal(fileLedger(join(root, 'spend.json'), { requireExisting: true }).total(), 0.05);
  const output = PNG.sync.read(result.buffer);
  assert.equal(result.mime, 'image/png');
  assert.equal(output.width, 3); assert.equal(output.height, 3);
  assert.deepEqual([...output.data].filter((_, index) => index % 4 === 3), [0, 0, 0, 0, 255, 255, 0, 255, 255]);
  assert.equal(fileLedger(join(root, 'spend.json'), { requireExisting: true }).total(), 0.05);

  const empty = JSON.parse(await readFile(new URL('./fixtures/sam-empty-completed-response.json', import.meta.url), 'utf8'));
  globalThis.fetch = async () => ({ ok: true, json: async () => empty });
  const emptyImage = PNG.sync.write(new PNG({ width: 1, height: 1 }));
  const emptyRunner = createDemoEventCutoutRunner({ outputRoot: root, env: { META_API_KEY: 'fixture-key', META_API_BASE_URL: 'http://localhost', META_SEGMENT_COST_USD: '0.05' } });
  assert.deepEqual(await emptyRunner({ image: emptyImage, prompt: 'A stone observatory' }), { status: 'empty' });
  assert.ok(Math.abs(fileLedger(join(root, 'spend.json'), { requireExisting: true }).total() - 0.15) < 1e-9);
  globalThis.fetch = originalFetch;
});
