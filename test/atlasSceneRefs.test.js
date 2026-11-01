import { createHash } from 'node:crypto';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { verifiedEventSceneRefs } from '../scripts/migrate-atlas-worlds.js';

test('event scene references require exact run/branch metadata and an existing image file', t => {
  const temporaryRoot = mkdtempSync(path.join(os.tmpdir(), 'atlas-scenes-'));
  t.after(() => rmSync(temporaryRoot, { recursive: true, force: true }));
  const sourceRoot = path.join(temporaryRoot, 'fixture');
  const runDirectory = path.join(sourceRoot, 'candidate', 'live', 'run-1');
  const eventDirectory = path.join(path.dirname(runDirectory), '.event-scenes');
  mkdirSync(runDirectory, { recursive: true });
  mkdirSync(eventDirectory, { recursive: true });
  const keyFor = branchId => createHash('sha256').update(JSON.stringify(['run-1', branchId])).digest('hex');
  const writeMetadata = (branchId, metadataBranchId = branchId, withImage = true) => {
    const key = keyFor(branchId);
    writeFileSync(path.join(eventDirectory, `${key}.json`), JSON.stringify({ runId: 'run-1', branchId: metadataBranchId, key, status: 'complete' }));
    if (withImage) writeFileSync(path.join(eventDirectory, `${key}.png`), Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x01]));
  };
  writeMetadata('b1');
  writeMetadata('b2', 'wrong-branch');
  writeMetadata('b3', 'b3', false);

  const run = { branches: [{ id: 'b1' }, { id: 'b2' }, { id: 'b3' }, { id: 'b4' }] };
  const refs = verifiedEventSceneRefs(run, 'run-1', runDirectory, temporaryRoot);
  assert.deepEqual(Object.keys(refs), ['run-1:b1']);
  assert.deepEqual(refs['run-1:b1'], { sceneRef: { path: 'fixture/candidate/live/.event-scenes/' + keyFor('b1') + '.png', status: 'complete' } });
});
