import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { cacheGuardrailFixture } from '../scripts/cache-guardrail-fixture.js';

test('simulated guardrail replay records actual fail-closed policy and never calls a model', async t => {
  const root = mkdtempSync(join(tmpdir(), 'guardrail-fixture-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const { destination } = await cacheGuardrailFixture(root);
  const branch = JSON.parse(readFileSync(join(destination, 'branch.json')));
  const manifest = JSON.parse(readFileSync(join(destination, 'manifest.json')));
  const trace = JSON.parse(readFileSync(join(destination, 'trace.json')));
  assert.equal(branch.status, 'blocked');
  assert.match(branch.reframe, /What if the Library of Alexandria never burned/);
  assert.equal(manifest.status, 'simulated');
  assert.equal(trace.costUsd, 0);
  assert.deepEqual(trace.steps, []);
  await assert.rejects(cacheGuardrailFixture(root), /exist/i);
});
