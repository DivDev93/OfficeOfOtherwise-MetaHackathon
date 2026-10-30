import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, readFileSync, unlinkSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { taskSpendCap } from '../src/demo/budget.js';
import { createDemoRunner } from '../src/demo/pipeline.js';

test('task checkpoint clamps the configured cap and cannot be silently reset', t => {
  const root = mkdtempSync(join(tmpdir(), 'demo-budget-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  assert.throws(() => taskSpendCap({ outputRoot: root, env: {} }), /checkpoint/);
  writeFileSync(join(root, 'demo-task-budget.json'), JSON.stringify({ startingMetaSpendUsd: 0.5, taskBudgetUsd: 2 }));
  assert.throws(() => taskSpendCap({ outputRoot: root, env: {} }), /ledger is missing/i);
  writeFileSync(join(root, 'spend.json'), JSON.stringify({ totalUsd: 0.5, entries: [], reservations: {} }));
  assert.equal(taskSpendCap({ outputRoot: root, env: { META_SPEND_CAP_USD: '100' } }), 2.5);
  assert.equal(taskSpendCap({ outputRoot: root, env: { META_SPEND_CAP_USD: '1' } }), 1);
  writeFileSync(join(root, 'demo-task-budget.json'), JSON.stringify({ startingMetaSpendUsd: 0.5, taskBudgetUsd: 3 }));
  assert.throws(() => taskSpendCap({ outputRoot: root, env: {} }), /Invalid/);
});

test('taskSpendCap accepts an explicitly selected evaluation checkpoint without changing the demo default', t => {
  const root = mkdtempSync(join(tmpdir(), 'demo-scoped-budget-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const outputRoot = join(root, 'out');
  const evaluationCheckpoint = join(outputRoot, 'evaluations', 'fresh-live-evaluation.json');
  mkdirSync(join(outputRoot, 'evaluations'), { recursive: true });
  writeFileSync(join(outputRoot, 'demo-task-budget.json'), JSON.stringify({ startingMetaSpendUsd: 0.5, taskBudgetUsd: 2 }));
  writeFileSync(evaluationCheckpoint, JSON.stringify({ startingMetaSpendUsd: 2.6, taskBudgetUsd: 2 }));
  writeFileSync(join(outputRoot, 'spend.json'), JSON.stringify({ totalUsd: 2.6, entries: [], reservations: {} }));
  assert.equal(taskSpendCap({ outputRoot, env: {}, checkpointPath: evaluationCheckpoint }), 4.6);
  assert.equal(taskSpendCap({ outputRoot, env: {} }), 2.5);
});

test('Meta-only live runner does not require 3D configuration, but enabled 3D remains gated', async t => {
  const root = mkdtempSync(join(tmpdir(), 'demo-runner-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const runner = createDemoRunner({ env: { META_API_KEY: 'fixture-key' }, outputRoot: root, dailyCapUsd: 3 });
  assert.equal(runner.enforcesDailyCap, true);
  await assert.rejects(runner({ divergence: 'What if a library survived?' }), /budget checkpoint/i);
  const with3d = createDemoRunner({ env: { DEMO_3D_ENABLED: 'true' }, outputRoot: root, dailyCapUsd: 3 });
  await assert.rejects(with3d({ divergence: 'What if a library survived?' }), /confirmed Chronos/i);
});

test('one-run recording allowance requires an explicitly matching scope and preserves the default checkpoint', t => {
  const root = mkdtempSync(join(tmpdir(), 'demo-recording-budget-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const checkpointPath = join(root, 'recording-budget.json');
  writeFileSync(join(root, 'demo-task-budget.json'), JSON.stringify({ startingMetaSpendUsd: 0.5, taskBudgetUsd: 2 }));
  writeFileSync(checkpointPath, JSON.stringify({ startingMetaSpendUsd: 3.75, taskBudgetUsd: 1 }));
  writeFileSync(join(root, 'spend.json'), JSON.stringify({ totalUsd: 3.75, entries: [], reservations: {} }));
  assert.throws(() => taskSpendCap({ outputRoot: root, checkpointPath, env: {} }), /Invalid/);
  assert.equal(taskSpendCap({ outputRoot: root, checkpointPath, taskBudgetUsd: 1, env: {} }), 4.75);
  assert.equal(taskSpendCap({ outputRoot: root, checkpointPath, taskBudgetUsd: 1, env: { META_SPEND_CAP_USD: '4' } }), 4);
  assert.equal(taskSpendCap({ outputRoot: root, env: {} }), 2.5);
  assert.throws(() => taskSpendCap({ outputRoot: root, checkpointPath, taskBudgetUsd: 3, env: {} }), /Invalid/);
});

test('initialization durably creates the ledger and never resets an existing checkpoint', t => {
  const root = mkdtempSync(join(tmpdir(), 'demo-init-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const script = fileURLToPath(new URL('../scripts/init-demo-budget.js', import.meta.url));
  const run = () => spawnSync(process.execPath, [script], { cwd: root, encoding: 'utf8' });
  assert.equal(run().status, 0);
  const checkpoint = join(root, 'out', 'demo-task-budget.json');
  const ledger = join(root, 'out', 'spend.json');
  assert.equal(JSON.parse(readFileSync(ledger)).totalUsd, 0);
  const saved = readFileSync(checkpoint, 'utf8');
  assert.equal(run().status, 1);
  assert.equal(readFileSync(checkpoint, 'utf8'), saved);
  unlinkSync(ledger);
  assert.equal(run().status, 1);
  assert.throws(() => taskSpendCap({ outputRoot: join(root, 'out'), env: {} }), /ledger is missing/i);
  assert.equal(readFileSync(checkpoint, 'utf8'), saved);
});

test('branch and smoke scripts require a checkpoint before live calls', t => {
  const root = mkdtempSync(join(tmpdir(), 'demo-scripts-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  for (const name of ['branch', 'smoke']) {
    const script = fileURLToPath(new URL(`../scripts/${name}.js`, import.meta.url));
    const result = spawnSync(process.execPath, [script], { cwd: root, env: { ...process.env, META_API_KEY: 'fixture-sentinel' }, encoding: 'utf8' });
    assert.equal(result.status, 1);
    assert.match(result.stderr, /checkpoint/i);
    assert.doesNotMatch(result.stderr, /fixture-sentinel/);
  }
});
