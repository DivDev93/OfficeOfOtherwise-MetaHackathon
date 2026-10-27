import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { PNG } from 'pngjs';
import { runSegmentImage } from '../scripts/segment-image.js';

test('single SAM attempt saves full response, mask, cutout and diagnostics without network', async t => {
  const root = mkdtempSync(join(tmpdir(), 'sam-diagnostic-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const hero = join(root, 'hero.png');
  const png = new PNG({ width: 3, height: 3 });
  png.data.fill(255);
  writeFileSync(hero, PNG.sync.write(png));
  const fixture = readFileSync(new URL('./fixtures/sam-synthetic.txt', import.meta.url), 'utf8');
  const response = { status: 'completed', output_text: fixture, marker: 'preserved' };
  const calls = [];
  const client = { async meteredPost(...args) { calls.push(args); return response; } };
  const { dir, diagnostics } = await runSegmentImage({ imagePath: hero, prompt: 'book', client, outRoot: root, env: {} });
  assert.equal(calls.length, 1);
  assert.equal(calls[0][1].input[0].content[0].text, 'book');
  assert.equal(diagnostics.status, 'matched');
  assert.equal(diagnostics.costUsd, 0.05);
  assert.equal(diagnostics.selectedMask.confidence, 0.9);
  assert.deepEqual(JSON.parse(readFileSync(join(dir, 'sam-response-1.json'))), response);
  assert.equal(readFileSync(join(dir, 'sam-output-1.txt'), 'utf8'), fixture);
  const mask = PNG.sync.read(readFileSync(join(dir, 'mask.png')));
  const cutout = PNG.sync.read(readFileSync(join(dir, 'cutout.png')));
  assert.equal(mask.data[0], 0);
  assert.equal(mask.data[(1 * 3 + 1) * 4], 255);
  assert.equal(cutout.data[3], 0);
  assert.equal(cutout.data[(1 * 3 + 1) * 4 + 3], 255);
});

test('no match and paid parse errors retain diagnostics and make only one attempt', async t => {
  const root = mkdtempSync(join(tmpdir(), 'sam-diagnostic-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const hero = join(root, 'hero.png');
  writeFileSync(hero, PNG.sync.write(new PNG({ width: 3, height: 3 })));
  let calls = 0;
  const client = { async meteredPost() { calls++; return { status: 'completed', output_text: '' }; } };
  const result = await runSegmentImage({ imagePath: hero, prompt: 'book', client, outRoot: root, env: {} });
  assert.equal(result.diagnostics.status, 'no_matches');
  assert.equal(calls, 1);
  client.meteredPost = async () => { calls++; return { status: 'completed', output_text: '<0f>bad' }; };
  await assert.rejects(runSegmentImage({ imagePath: hero, prompt: 'book', client, outRoot: root, env: {} }), error => {
    assert.equal(JSON.parse(readFileSync(join(error.outputDir, 'diagnostics.json'))).costUsd, 0.05);
    assert.equal(JSON.parse(readFileSync(join(error.outputDir, 'sam-response-1.json'))).output_text, '<0f>bad');
    return true;
  });
  assert.equal(calls, 2);
  await assert.rejects(runSegmentImage({ imagePath: hero, prompt: 'war', client, outRoot: root }), /blocked/);
  await assert.rejects(runSegmentImage({ imagePath: hero, prompt: 'red book', client, outRoot: root }), /one alphabetic word/);
  assert.equal(calls, 2);
});
