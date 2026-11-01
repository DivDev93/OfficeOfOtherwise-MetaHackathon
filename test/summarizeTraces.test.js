import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const script = fileURLToPath(new URL('../scripts/summarize-traces.js', import.meta.url));
const put = async (path, value) => {
  await mkdir(join(path, '..'), { recursive: true });
  await writeFile(path, `${JSON.stringify(value)}\n`);
};

test('offline summary deduplicates copies, separates branch and stage evidence, and omits private inputs', async t => {
  const dir = await mkdtemp(join(tmpdir(), 'trace-summary-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const runs = join(dir, 'runs');
  const tasks = join(runs, '.continuation', 'edges');
  const eventScenes = join(runs, '.event-scenes');
  const eventCutouts = join(runs, '.event-cutouts');
  const output = join(dir, 'public.json');
  const privateManifest = join(dir, 'private', 'manifest.json');
  const rootId = '11111111-1111-4111-8111-111111111111';
  const childId = '22222222-2222-4222-8222-222222222222';
  const emptyId = '33333333-3333-4333-8333-333333333333';
  const blockedId = '44444444-4444-4444-8444-444444444444';
  const trace = { prompt: 'private prompt', steps: [
    { step: 'propose', model: 'muse-wonder-1.0', ms: 100, ok: true },
    { step: 'review', model: 'muse-wonder-1.0', ms: 200, ok: true }
  ] };
  await put(join(runs, rootId, 'trace.json'), trace);
  await put(join(runs, rootId, 'branch.json'), { status: 'ok' });
  await put(join(runs, emptyId, 'trace.json'), { steps: [{ step: 'propose', model: 'muse-wonder-1.0', ms: 200 }] });
  await put(join(runs, emptyId, 'branch.json'), { status: 'empty' });
  await put(join(runs, blockedId, 'trace.json'), { steps: [] });
  await put(join(runs, blockedId, 'branch.json'), { status: 'blocked' });
  await put(join(runs, '55555555-5555-4555-8555-555555555555', 'trace.json'), { steps: [{ step: 'image', model: 'muse-image-1.0', ms: 83, error: 'private failure text' }] });
  await put(join(runs, '55555555-5555-4555-8555-555555555555', 'branch.json'), { status: 'ok' });
  await put(join(runs, 'snapshot', 'demo', 'runs', rootId, 'trace.json'), trace);
  await put(join(runs, 'snapshot', 'demo', 'runs', rootId, 'branch.json'), { status: 'ok' });
  await put(join(runs, childId, 'trace.json'), { continuation: { parentRunId: rootId }, steps: [{ step: 'propose', model: 'muse-wonder-1.0', ms: 300 }] });
  await put(join(runs, childId, 'branch.json'), { status: 'failed' });
  await put(join(tasks, 'edge.json'), { parentRunId: rootId, parentBranchId: 'b1', runId: childId, status: 'uncertain' });
  await put(join(eventScenes, 'scene.json'), { runId: rootId, branchId: 'b1', status: 'complete' });
  await put(join(eventCutouts, 'cutout.json'), { runId: rootId, branchId: 'b1', status: 'in-progress' });

  const result = spawnSync(process.execPath, [script,
    '--runs-root', runs, '--task-root', runs, '--output', output, '--private-manifest', privateManifest
  ], { encoding: 'utf8' });
  assert.equal(result.status, 0, result.stderr);
  const summary = JSON.parse(await readFile(output, 'utf8'));
  assert.equal(summary.cohort.uniqueRunRecords, 5);
  assert.equal(summary.cohort.copiedTraceRecordsExcluded, 1);
  assert.equal(summary.cohort.runsByType.root.branchEvidenceStates.branchOkNoRecordedStageError, 1);
  assert.equal(summary.cohort.runsByType.root.branchEvidenceStates.branchOkWithRecordedStageError, 1);
  assert.equal(summary.cohort.runsByType.root.branchEvidenceStates.branchEmpty, 1);
  assert.equal(summary.cohort.runsByType.root.branchEvidenceStates.branchBlocked, 1);
  assert.equal(summary.cohort.runsByType.continuation.branchEvidenceStates.branchStatusFailed, 1);
  assert.equal(summary.cohort.tasksByType.continuation.dispatchUnknown, 1);
  assert.equal(summary.cohort.tasksByType.eventCutout.incomplete, 1);
  const propose = summary.durations.find(row => row.runType === 'root' && row.stage === 'propose');
  assert.equal(propose.medianMs, 150, 'even-sample median averages the middle pair');
  assert.equal(propose.p90Ms, 200, 'p90 retains nearest-rank semantics');
  const imageFailure = summary.durations.find(row => row.runType === 'root' && row.stage === 'image');
  assert.equal(imageFailure.outcome, 'error-recorded');
  assert.equal(imageFailure.cacheStatus, 'cache-status-unknown');
  assert.equal(imageFailure.instrumentation, 'application-measured-elapsed-span');
  assert.deepEqual(summary.recordedStageErrorRecords.find(row => row.reasonCategory === 'image-stage'), { runType: 'root', reasonCategory: 'image-stage', records: 1 });
  const publicText = await readFile(output, 'utf8');
  assert.doesNotMatch(publicText, /private prompt|private failure text|11111111|22222222/);
  const manifest = JSON.parse(await readFile(privateManifest, 'utf8'));
  assert.ok(manifest.sourceFiles.length >= 11);
  assert.ok(manifest.sourceFiles.every(file => /^[a-f0-9]{64}$/.test(file.sha256)));

  const verifiedOutput = join(dir, 'verified-public.json');
  const verifiedManifest = join(dir, 'verified-private', 'manifest.json');
  const verified = spawnSync(process.execPath, [script,
    '--runs-root', runs, '--task-root', runs, '--output', verifiedOutput,
    '--private-manifest', verifiedManifest, '--verify-manifest', privateManifest
  ], { encoding: 'utf8' });
  assert.equal(verified.status, 0, verified.stderr);
  assert.deepEqual(JSON.parse(await readFile(verifiedOutput, 'utf8')), summary);
});
