import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import {
  EVALUATION_PROMPTS,
  MAX_PLANNED_LOGICAL_META_CALLS_PER_PROMPT,
  REFERENCE_PROMPT_COST_USD,
  SCOPED_ALLOWANCE_RELATIVE_PATH,
  createPlan,
  initializeScopedAllowance,
  inspectBudget,
  liveRunnerOptions,
  parseArgs,
  runPromptBatch,
} from '../scripts/evaluate-live.js';

function tempRoot() { return mkdtempSync(join(tmpdir(), 'ooo-live-eval-')); }
function writeBudget(root, { totalUsd = 0.1, startingMetaSpendUsd = 0, reservations = {}, budgetUncertain = false } = {}) {
  mkdirSync(join(root, 'out'), { recursive: true });
  writeFileSync(join(root, 'out', 'demo-task-budget.json'), JSON.stringify({ startingMetaSpendUsd, taskBudgetUsd: 2 }));
  writeFileSync(join(root, 'out', 'spend.json'), JSON.stringify({ totalUsd, entries: [], reservations, budgetUncertain }));
}

test('default args are offline; live mode requires an explicit positive absolute cap and scoped allowance', () => {
  assert.deepEqual(parseArgs([]), { live: false, dryRun: false, initAllowance: false, capUsd: undefined, allowanceFile: undefined });
  assert.deepEqual(parseArgs(['--dry-run']), { live: false, dryRun: true, initAllowance: false, capUsd: undefined, allowanceFile: undefined });
  assert.throws(() => parseArgs(['--live']), /requires an explicit --cap-usd/);
  assert.throws(() => parseArgs(['--live', '--cap-usd', '0']), /positive number/);
  assert.throws(() => parseArgs(['--live', '--cap-usd', '4.6']), /requires --allowance-file/);
  assert.deepEqual(parseArgs(['--live', '--cap-usd', '4.6', '--allowance-file', 'out/evaluations/fresh-live-evaluation.json']).allowanceFile, join('out', 'evaluations', 'fresh-live-evaluation.json'));
  assert.throws(() => parseArgs(['--live', '--cap-usd', '4.6', '--allowance-file', 'out/other.json']), /must be/);
  assert.throws(() => parseArgs(['--init-allowance', '--dry-run']), /cannot be combined/);
  assert.throws(() => parseArgs(['--dry-run', '--live', '--cap-usd', '1']), /cannot be combined/);
  assert.throws(() => parseArgs(['--dry-run', '--cap-usd', '1']), /only accepted with --live/);
  assert.throws(() => parseArgs(['--unknown']), /Unknown argument/);
});

test('budget preflight reads existing state without changing checkpoint or ledger', () => {
  const root = tempRoot();
  try {
    writeBudget(root, { totalUsd: 0.5, startingMetaSpendUsd: 0.2, reservations: { pending: { usd: 0.1, day: '2026-10-29' } } });
    const checkpointPath = join(root, 'out', 'demo-task-budget.json'), ledgerPath = join(root, 'out', 'spend.json');
    const before = [readFileSync(checkpointPath, 'utf8'), readFileSync(ledgerPath, 'utf8')];
    const budget = inspectBudget({ cwd: root, env: {}, today: '2026-10-29' });
    assert.equal(budget.valid, true);
    assert.equal(budget.ledgerTotalUsd, 0.5);
    assert.equal(budget.reservedUsd, 0.1);
    assert.equal(budget.availableTotalUsd, 1.6);
    assert.equal(budget.availableDailyUsd, 2.9);
    const highConfiguredDaily = inspectBudget({ cwd: root, env: { DEMO_DAILY_CAP_USD: '50' }, today: '2026-10-29' });
    assert.equal(highConfiguredDaily.configuredDailyCapUsd, 3);
    assert.deepEqual([readFileSync(checkpointPath, 'utf8'), readFileSync(ledgerPath, 'utf8')], before);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test('budget preflight refuses to read while the shared ledger is locked', () => {
  const root = tempRoot();
  try {
    writeBudget(root);
    mkdirSync(join(root, 'out', 'spend.json.lock'));
    const budget = inspectBudget({ cwd: root, env: {} });
    assert.equal(budget.valid, false);
    assert.match(budget.errors.join(' '), /lock is present/);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test('preflight refuses a batch that exceeds available checkpoint allowance or uncertain ledger', () => {
  const baseBudget = {
    valid: true, errors: [], todayUtc: '2026-10-29', taskBudgetUsd: 2, startingMetaSpendUsd: 0.5,
    ledgerTotalUsd: 2.3, reservedUsd: 0, budgetUncertain: false, configuredMetaCapUsd: 100,
    configuredDailyCapUsd: 3, checkpointCapUsd: 2.5, effectiveCapUsd: 2.5, committedUsd: 2.3,
    availableTotalUsd: 0.2, dailySpentUsd: 0, availableDailyUsd: 3,
    referencePromptCostUsd: REFERENCE_PROMPT_COST_USD, referenceBatchCostUsd: REFERENCE_PROMPT_COST_USD * 4,
    plannedLogicalMetaCallsPerPrompt: MAX_PLANNED_LOGICAL_META_CALLS_PER_PROMPT, plannedLogicalMetaCallsBatch: MAX_PLANNED_LOGICAL_META_CALLS_PER_PROMPT * 4,
  };
  const blocked = createPlan({ budget: baseBudget, args: parseArgs([]), env: {}, hasApiKey: false });
  assert.equal(blocked.readiness, 'blocked');
  assert.match(blocked.reasons.join(' '), /below the four-run historical reference estimate/);
  const uncertain = createPlan({ budget: { ...baseBudget, budgetUncertain: true }, args: parseArgs([]), env: {}, hasApiKey: false });
  assert.match(uncertain.reasons.join(' '), /marked uncertain/);
  assert.equal(blocked.providerCallsWillOccur, false);
  assert.equal(blocked.plannedLogicalMetaCallsBatch, 52);
  assert.equal(blocked.threeDProviderCalls, 0);
});

test('live cap cannot raise the current effective task ceiling', () => {
  const budget = {
    valid: true, errors: [], todayUtc: '2026-10-29', taskBudgetUsd: 2, startingMetaSpendUsd: 0,
    scope: 'four-prompt-live-evaluation',
    ledgerTotalUsd: 0, reservedUsd: 0, budgetUncertain: false, configuredMetaCapUsd: 100,
    configuredDailyCapUsd: 3, checkpointCapUsd: 2, effectiveCapUsd: 2, committedUsd: 0,
    availableTotalUsd: 2, dailySpentUsd: 0, availableDailyUsd: 3,
    referencePromptCostUsd: REFERENCE_PROMPT_COST_USD, referenceBatchCostUsd: REFERENCE_PROMPT_COST_USD * 4,
    plannedLogicalMetaCallsPerPrompt: MAX_PLANNED_LOGICAL_META_CALLS_PER_PROMPT, plannedLogicalMetaCallsBatch: MAX_PLANNED_LOGICAL_META_CALLS_PER_PROMPT * 4,
  };
  const plan = createPlan({ budget, args: parseArgs(['--live', '--cap-usd', '2.01', '--allowance-file', 'out/evaluations/fresh-live-evaluation.json']), env: {}, hasApiKey: true });
  assert.equal(plan.readiness, 'blocked');
  assert.match(plan.reasons.join(' '), /cannot exceed/);
  assert.equal(plan.providerCallsWillOccur, false);
});

test('preflight pins the expected Meta models and strict topic policy', () => {
  const budget = { valid: false, errors: [], effectiveCapUsd: 0, availableTotalUsd: 0, availableDailyUsd: 0 };
  const plan = createPlan({ budget, args: parseArgs([]), env: { META_TEXT_MODEL_PLANNER: 'other-model', TOPIC_POLICY_BLOCK: 'none' }, hasApiKey: false });
  assert.match(plan.reasons.join(' '), /pinned evaluation stack/);
  assert.match(plan.reasons.join(' '), /strict war-and-politics/);
});

test('preflight blocks a non-Meta API endpoint before live runner construction', () => {
  const budget = { valid: true, errors: [], scope: 'four-prompt-live-evaluation', budgetUncertain: false,
    effectiveCapUsd: 5, committedUsd: 0, availableTotalUsd: 5, availableDailyUsd: 3,
    referenceBatchCostUsd: REFERENCE_PROMPT_COST_USD * 4, configuredDailyCapUsd: 3 };
  const args = parseArgs(['--live', '--cap-usd', '4.6', '--allowance-file', 'out/evaluations/fresh-live-evaluation.json']);
  const plan = createPlan({ budget, args, env: { META_API_BASE_URL: 'https://proxy.invalid/v1' }, hasApiKey: true });
  assert.equal(plan.readiness, 'blocked');
  assert.match(plan.reasons.join(' '), /not the approved Meta endpoint/);
  assert.equal(plan.providerCallsWillOccur, false);
});

test('batch runner measures first policy-cleared branch, scene, and total; never asks for 3D', async () => {
  let tick = 0;
  const calls = [], records = [];
  const result = await runPromptBatch({
    prompts: EVALUATION_PROMPTS.slice(0, 2), outputRoot: 'out', now: () => 1000,
    clock: () => tick,
    async runner(args) {
      calls.push(args);
      tick += 41;
      args.onStep({ step: 'propose', pending: false, branches: [{ id: 'safe' }] });
      tick += 29;
      args.onStep({ step: 'image' });
      tick += 30;
      return { branch: { status: 'ok', renderStatus: '2d-only' }, renderStatus: '2d-only', costUsd: 0.12, trace: [{ step: 'image', costUsd: 0.01 }] };
    },
    onRecord: record => records.push(record),
  });
  assert.equal(calls.length, 2);
  assert.equal(calls[0].timestamp, 1000);
  assert.equal(calls[1].timestamp, 1001);
  assert.deepEqual(records[0].latencyMs, { firstSafeBranch: 41, scene: 70, total: 100 });
  assert.equal(records[0].renderStatus, '2d-only');
  assert.equal(records[0].recordedMetaCostUsd, 0.12);
  assert.deepEqual(records[0].threeD, { called: false, costUsd: null, note: 'No 3D provider call was made; any separately generated replay-model cost remains unknown.' });
  assert.equal(result.stoppedOnFailure, false);
});

test('failed attempt retains paths to harness failure evidence and stops further prompts', async () => {
  const root = tempRoot(), runId = 4000;
  try {
    const runDir = join(root, String(runId));
    const recorded = [];
    const result = await runPromptBatch({
      prompts: EVALUATION_PROMPTS, outputRoot: root, now: () => runId, clock: () => 10,
      runner: async () => {
        mkdirSync(runDir, { recursive: true });
        writeFileSync(join(runDir, 'trace.json'), JSON.stringify({ costUsd: 0.03, steps: [{ step: 'agent', error: 'fixture failure' }] }));
        throw new Error('fixture failure');
      },
      onRecord: record => recorded.push(record),
    });
    assert.equal(result.attempted, 1);
    assert.equal(result.planned, 4);
    assert.equal(result.stoppedOnFailure, true);
    assert.equal(recorded[0].status, 'failed');
    assert.equal(recorded[0].recordedMetaCostUsd, 0.03);
    assert.equal(recorded[0].artifacts['trace.json'], join(runDir, 'trace.json'));
    assert.equal(recorded[0].trace[0].error, 'fixture failure');
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test('batch runner refuses to reuse an existing output directory', async () => {
  const root = tempRoot(), runId = 5000;
  try {
    const runDir = join(root, String(runId));
    mkdirSync(runDir, { recursive: true });
    writeFileSync(join(runDir, 'keep.txt'), 'preserve');
    let calls = 0;
    const result = await runPromptBatch({
      prompts: EVALUATION_PROMPTS.slice(0, 2), outputRoot: root, now: () => runId,
      runner: async () => { calls++; return {}; },
    });
    assert.equal(calls, 0);
    assert.equal(result.attempted, 1);
    assert.match(result.records[0].failure, /refusing to overwrite/);
    assert.equal(readFileSync(join(runDir, 'keep.txt'), 'utf8'), 'preserve');
    assert.equal(result.records[0].artifacts.directory, null);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test('scoped allowance initialization snapshots existing ledger and refuses resets', () => {
  const root = tempRoot();
  try {
    writeBudget(root, { totalUsd: 2.6447512, startingMetaSpendUsd: 0.9271792 });
    const beforeTask = readFileSync(join(root, 'out', 'demo-task-budget.json'), 'utf8');
    const beforeLedger = readFileSync(join(root, 'out', 'spend.json'), 'utf8');
    const created = initializeScopedAllowance({ cwd: root, now: () => '2026-10-29T12:00:00.000Z' });
    assert.equal(created.startingMetaSpendUsd, 2.6447512);
    assert.equal(created.absoluteCheckpointCeilingUsd, 4.6447512);
    const scopedPath = join(root, 'out', 'evaluations', 'fresh-live-evaluation.json');
    assert.equal(JSON.parse(readFileSync(scopedPath, 'utf8')).taskBudgetUsd, 2);
    const scopedBudget = inspectBudget({ cwd: root, env: {}, checkpointPath: SCOPED_ALLOWANCE_RELATIVE_PATH });
    assert.equal(scopedBudget.valid, true);
    assert.equal(scopedBudget.scope, 'four-prompt-live-evaluation');
    assert.equal(scopedBudget.effectiveCapUsd, 4.6447512);
    assert.equal(readFileSync(join(root, 'out', 'demo-task-budget.json'), 'utf8'), beforeTask);
    assert.equal(readFileSync(join(root, 'out', 'spend.json'), 'utf8'), beforeLedger);
    assert.throws(() => initializeScopedAllowance({ cwd: root }), /cannot be reset or replaced/);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test('scoped allowance initialization blocks uncertainty, reservations and concurrent ledger operations', () => {
  const root = tempRoot();
  try {
    writeBudget(root, { budgetUncertain: true });
    assert.throws(() => initializeScopedAllowance({ cwd: root }), /uncertain/);
    writeBudget(root, { reservations: { pending: { usd: 0.1, day: '2026-10-29' } } });
    assert.throws(() => initializeScopedAllowance({ cwd: root }), /unresolved reservations/);
    writeBudget(root);
    mkdirSync(join(root, 'out', 'spend.json.lock'));
    assert.throws(() => initializeScopedAllowance({ cwd: root }), /lock is present/);
    assert.equal(existsSync(join(root, 'out', 'evaluations', 'fresh-live-evaluation.json')), false);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test('live runner preserves configured daily cap and uses separate scoped checkpoint', () => {
  const options = liveRunnerOptions({ args: { capUsd: 4.6 }, budget: { configuredDailyCapUsd: 1.25 }, env: {} });
  assert.equal(options.dailyCapUsd, 1.25);
  assert.equal(options.budgetCheckpointPath, join('out', 'evaluations', 'fresh-live-evaluation.json'));
  assert.equal(options.env.META_SPEND_CAP_USD, '4.6');
  assert.equal(options.env.META_API_BASE_URL, 'https://api.meta.ai/v1');
  assert.equal(options.env.DEMO_3D_ENABLED, 'false');
});
