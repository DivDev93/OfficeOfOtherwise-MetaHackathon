import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createDemoServer } from '../server/index.js';
import {
  MAX_ALLOWANCE_USD, RECORDING_ALLOWANCE_PATH, RECORDING_PROMPT, RECORDING_SCOPE,
  createRecordingPlan, createSingleRunGuard, initializeRecordingAllowance,
  inspectRecordingBudget, parseArgs, pathsForAttempt, startRecordingServer, strictRecordingEnv,
} from '../scripts/record-fresh-run.js';

function root() { return mkdtempSync(join(tmpdir(), 'ooo-record-fresh-')); }
function writeLedger(cwd, { totalUsd = 2.5, reservations = {}, budgetUncertain = false } = {}) {
  mkdirSync(join(cwd, 'out'), { recursive: true });
  writeFileSync(join(cwd, 'out', 'demo-task-budget.json'), JSON.stringify({ startingMetaSpendUsd: 1, taskBudgetUsd: 2 }));
  writeFileSync(join(cwd, 'out', 'spend.json'), JSON.stringify({ totalUsd, entries: [], reservations, budgetUncertain }));
}
function writeOriginalReport(cwd, baselineUsd) {
  mkdirSync(join(cwd, 'out', 'recordings'), { recursive: true });
  writeFileSync(join(cwd, 'out', 'recordings', 'fresh-run.jsonl'), `${JSON.stringify({ type: 'plan', budget: { ledgerTotalUsd: baselineUsd } })}\n`);
}

test('args default to a no-call dry-run and require explicit bounded mode switches', () => {
  assert.deepEqual(parseArgs([]), { dryRun: false, serve: false, initAllowance: false, capUsd: undefined, allowanceUsd: undefined, overallCapUsd: undefined, attempt: undefined });
  assert.equal(parseArgs(['--dry-run']).dryRun, true);
  assert.throws(() => parseArgs(['--serve']), /requires an explicit --cap-usd/);
  assert.throws(() => parseArgs(['--serve', '--cap-usd', '0']), /positive number/);
  assert.throws(() => parseArgs(['--init-allowance']), /requires an explicit --allowance-usd/);
  assert.throws(() => parseArgs(['--init-allowance', '--allowance-usd', '1.01']), /no more than 1/);
  assert.deepEqual(parseArgs(['--init-allowance', '--allowance-usd', '1', '--attempt', 'retry-2', '--overall-cap-usd', '13.75']), { dryRun: false, serve: false, initAllowance: true, capUsd: undefined, allowanceUsd: 1, overallCapUsd: 13.75, attempt: 'retry-2' });
  assert.throws(() => parseArgs(['--dry-run', '--attempt', '../retry']), /safe identifier/);
  assert.throws(() => parseArgs(['--dry-run', '--overall-cap-usd', '13']), /requires --attempt/);
  assert.throws(() => parseArgs(['--dry-run', '--serve']), /cannot be combined/);
  assert.throws(() => parseArgs(['--serve', '--cap-usd', '1', '--allowance-usd', '1']), /only accepted with --init-allowance/);
  assert.throws(() => parseArgs(['--unknown']), /Unknown argument/);
});

test('named retry attempt has distinct one-use paths and stays within the original workflow cap', () => {
  const cwd = root();
  try {
    writeLedger(cwd, { totalUsd: 2.5 });
    initializeRecordingAllowance({ cwd, allowanceUsd: 1, now: () => '2026-10-29T10:00:00.000Z' });
    writeOriginalReport(cwd, 2.5);
    const firstCheckpoint = readFileSync(join(cwd, RECORDING_ALLOWANCE_PATH), 'utf8');
    const firstReport = readFileSync(join(cwd, 'out', 'recordings', 'fresh-run.jsonl'), 'utf8');
    writeLedger(cwd, { totalUsd: 2.7 });

    const initialized = initializeRecordingAllowance({ cwd, attempt: 'retry-2', allowanceUsd: 1, overallCapUsd: 12.5, now: () => '2026-10-29T12:00:00.000Z' });
    assert.equal(initialized.workflowBaselineUsd, 2.5);
    assert.equal(initialized.workflowOverallCapUsd, 12.5);
    assert.deepEqual(pathsForAttempt('retry-2'), { checkpointPath: join('out', 'evaluations', 'fresh-recording-retry-2.json'), reportPath: join('out', 'recordings', 'fresh-run-retry-2.jsonl') });
    assert.equal(readFileSync(join(cwd, RECORDING_ALLOWANCE_PATH), 'utf8'), firstCheckpoint);
    assert.equal(readFileSync(join(cwd, 'out', 'recordings', 'fresh-run.jsonl'), 'utf8'), firstReport);

    const env = { META_API_KEY: 'private', DEMO_ACCESS_CODE: 'private', META_SPEND_CAP_USD: '100' };
    const budget = inspectRecordingBudget({ cwd, env, attempt: 'retry-2', today: '2026-10-29' });
    assert.equal(budget.valid, true);
    assert.equal(budget.absoluteAllowanceCapUsd, 3.7);
    assert.equal(budget.workflowBaselineUsd, 2.5);
    assert.equal(budget.workflowOverallCapUsd, 12.5);
    const plan = createRecordingPlan({ args: parseArgs(['--serve', '--cap-usd', '3.7', '--attempt', 'retry-2', '--overall-cap-usd', '12.5']), budget, env });
    assert.equal(plan.readiness, 'ready');
    assert.equal(plan.attempt, 'retry-2');
    assert.throws(() => initializeRecordingAllowance({ cwd, attempt: '../escape', allowanceUsd: 1 }), /safe identifier/);
    assert.throws(() => initializeRecordingAllowance({ cwd, attempt: 'retry-3', allowanceUsd: 1, overallCapUsd: 12.50001 }), /no more than 12.5/);
  } finally { rmSync(cwd, { recursive: true, force: true }); }
});

test('allowance initialization snapshots shared spend and never replaces prior scope or files', () => {
  const cwd = root();
  try {
    writeLedger(cwd);
    const taskPath = join(cwd, 'out', 'demo-task-budget.json');
    const ledgerPath = join(cwd, 'out', 'spend.json');
    const before = [readFileSync(taskPath, 'utf8'), readFileSync(ledgerPath, 'utf8')];
    const initialized = initializeRecordingAllowance({ cwd, allowanceUsd: 0.8, now: () => '2026-10-29T12:00:00.000Z' });
    assert.equal(initialized.startingMetaSpendUsd, 2.5);
    assert.equal(initialized.allowanceUsd, 0.8);
    const checkpoint = JSON.parse(readFileSync(join(cwd, RECORDING_ALLOWANCE_PATH), 'utf8'));
    assert.equal(checkpoint.scope, RECORDING_SCOPE);
    assert.equal(checkpoint.absoluteAllowanceCapUsd, undefined);
    assert.equal(checkpoint.taskBudgetUsd, 1);
    assert.deepEqual([readFileSync(taskPath, 'utf8'), readFileSync(ledgerPath, 'utf8')], before);
    assert.throws(() => initializeRecordingAllowance({ cwd, allowanceUsd: 0.8 }), /cannot be reset or replaced/);
  } finally { rmSync(cwd, { recursive: true, force: true }); }
});

test('allowance initialization fails closed on uncertainty, reservations, lock, or invalid ceiling', () => {
  const cwd = root();
  try {
    writeLedger(cwd, { budgetUncertain: true });
    assert.throws(() => initializeRecordingAllowance({ cwd, allowanceUsd: 0.5 }), /uncertain/);
    writeLedger(cwd, { reservations: { active: { usd: 0.1, day: '2026-10-29' } } });
    assert.throws(() => initializeRecordingAllowance({ cwd, allowanceUsd: 0.5 }), /unresolved reservations/);
    writeLedger(cwd);
    mkdirSync(join(cwd, 'out', 'spend.json.lock'));
    assert.throws(() => initializeRecordingAllowance({ cwd, allowanceUsd: 0.5 }), /lock is present/);
    assert.throws(() => initializeRecordingAllowance({ cwd, allowanceUsd: MAX_ALLOWANCE_USD + 0.1 }), /no more than/);
  } finally { rmSync(cwd, { recursive: true, force: true }); }
});

test('recording preflight reads a separate allowance and the same global ledger without mutation', () => {
  const cwd = root();
  try {
    writeLedger(cwd, { totalUsd: 2.5 });
    initializeRecordingAllowance({ cwd, allowanceUsd: 0.8, now: () => '2026-10-29T12:00:00.000Z' });
    const checkpointPath = join(cwd, RECORDING_ALLOWANCE_PATH);
    const ledgerPath = join(cwd, 'out', 'spend.json');
    const before = [readFileSync(checkpointPath, 'utf8'), readFileSync(ledgerPath, 'utf8')];
    const budget = inspectRecordingBudget({ cwd, env: { META_API_KEY: 'private', META_SPEND_CAP_USD: '10' }, today: '2026-10-29' });
    assert.equal(budget.valid, true);
    assert.equal(budget.allowanceUsd, 0.8);
    assert.ok(Math.abs(budget.availableTotalUsd - 0.8) < 1e-9);
    assert.equal(budget.apiCredentialPresent, true);
    assert.deepEqual([readFileSync(checkpointPath, 'utf8'), readFileSync(ledgerPath, 'utf8')], before);
    const plan = createRecordingPlan({ args: parseArgs([]), budget, env: { META_API_KEY: 'private' } });
    assert.equal(plan.prompt, RECORDING_PROMPT);
    assert.equal(plan.providerCallsWillOccur, false);
    assert.equal(plan.readiness, 'ready');
    assert.equal(plan.threeDProviderCalls, 0);
  } finally { rmSync(cwd, { recursive: true, force: true }); }
});

test('recording preflight blocks missing allowance, invalid models, endpoint, and non-strict topic policy', () => {
  const cwd = root();
  try {
    const missing = inspectRecordingBudget({ cwd, env: {} });
    const plan = createRecordingPlan({ args: parseArgs([]), budget: missing, env: { META_TEXT_MODEL_PLANNER: 'external', TOPIC_POLICY_BLOCK: 'none', META_API_BASE_URL: 'https://proxy.invalid/v1' } });
    assert.equal(plan.readiness, 'blocked');
    assert.match(plan.reasons.join(' '), /approved Meta endpoint/);
    assert.match(plan.reasons.join(' '), /pinned Meta recording stack/);
    assert.match(plan.reasons.join(' '), /strict war-and-politics/);
    assert.match(plan.reasons.join(' '), /separate one-run allowance/);
    assert.equal(plan.providerCallsWillOccur, false);
  } finally { rmSync(cwd, { recursive: true, force: true }); }
});

test('live plan cannot raise the explicitly initialized allowance or configured cap', () => {
  const cwd = root();
  try {
    writeLedger(cwd, { totalUsd: 2.5 });
    initializeRecordingAllowance({ cwd, allowanceUsd: 0.8, now: () => '2026-10-29T12:00:00.000Z' });
    const budget = inspectRecordingBudget({ cwd, env: { META_API_KEY: 'private', META_SPEND_CAP_USD: '10' }, today: '2026-10-29' });
    const args = parseArgs(['--serve', '--cap-usd', '3.4']);
    const plan = createRecordingPlan({ args, budget, env: { META_API_KEY: 'private', DEMO_ACCESS_CODE: 'code' } });
    assert.equal(plan.readiness, 'blocked');
    assert.match(plan.reasons.join(' '), /exceeds the per-attempt/);
    assert.equal(plan.providerCallsWillOccur, false);
  } finally { rmSync(cwd, { recursive: true, force: true }); }
});

test('recording plan refuses to reuse an existing one-use report', () => {
  const plan = createRecordingPlan({ args: parseArgs([]), budget: { valid: true, errors: [], apiCredentialPresent: true, availableTotalUsd: 1, availableDailyUsd: 1, absoluteAllowanceCapUsd: 1, configuredMetaCapUsd: 1, committedUsd: 0, configuredDailyCapUsd: 1 }, env: { META_API_KEY: 'private' }, reportAlreadyExists: true });
  assert.equal(plan.readiness, 'blocked');
  assert.match(plan.reasons.join(' '), /one-use scope cannot be repeated/);
});

test('strict recording env pins Meta-only models and disables 3D', () => {
  const env = strictRecordingEnv({ source: { META_API_KEY: 'private', META_API_BASE_URL: 'https://proxy.invalid/v1', DEMO_3D_ENABLED: 'true', META_TEXT_MODEL_PLANNER: 'external', CHRONOS_3D_ENDPOINT: 'https://private.invalid' }, capUsd: 3.3 });
  assert.equal(env.META_API_KEY, 'private');
  assert.equal(env.META_API_BASE_URL, 'https://api.meta.ai/v1');
  assert.equal(env.META_SPEND_CAP_USD, '3.3');
  assert.equal(env.DEMO_3D_ENABLED, 'false');
  assert.equal(env.TOPIC_POLICY_BLOCK, 'war,politics');
  assert.equal(env.META_TEXT_MODEL_PLANNER, 'muse-wonder-1.0');
  assert.equal(env.CHRONOS_3D_ENDPOINT, undefined);
});

test('one-use guard rejects other prompts and a second valid request before calling the runner', async () => {
  let calls = 0;
  const guarded = createSingleRunGuard(async options => { calls++; return { prompt: options.divergence }; });
  await assert.rejects(guarded({ divergence: 'What if a different topic?' }), /only the approved Alexandria prompt/);
  assert.deepEqual(await guarded({ divergence: `${RECORDING_PROMPT}  ` }), { prompt: RECORDING_PROMPT });
  await assert.rejects(guarded({ divergence: RECORDING_PROMPT }), /exactly one fresh run/);
  assert.equal(calls, 1);
});

test('one-use guarded pipeline passes server live-cap admission and rejects a second POST', async t => {
  const cwd = root();
  let calls = 0;
  const runner = async () => { calls++; return { runId: 'one', branch: { status: 'ok' }, costUsd: 0 }; };
  runner.enforcesDailyCap = true;
  const guarded = createSingleRunGuard(runner);
  assert.equal(guarded.enforcesDailyCap, true);
  const server = createDemoServer({
    runsDir: join(cwd, 'demo', 'runs'), liveRunsDir: join(cwd, 'out'), webDir: join(cwd, 'web'),
    env: { DEMO_ACCESS_CODE: 'test-private-code', DEMO_DAILY_CAP_USD: '1' },
    runPipeline: guarded,
  });
  await new Promise((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve); });
  t.after(async () => {
    await new Promise(resolve => server.close(resolve));
    rmSync(cwd, { recursive: true, force: true });
  });
  const url = `http://127.0.0.1:${server.address().port}/api/run`;
  const post = () => fetch(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-demo-access-code': 'test-private-code' },
    body: JSON.stringify({ divergence: RECORDING_PROMPT }),
  });
  const first = await post();
  assert.equal(first.status, 200);
  assert.match(await first.text(), /event: complete/);
  assert.equal(calls, 1);
  const second = await post();
  assert.equal(second.status, 200);
  assert.match(await second.text(), /event: error/);
  assert.equal(calls, 1);
});

test('startRecordingServer preserves the live-cap flag through report wrapping and permits one stubbed POST', async t => {
  const cwd = root();
  writeLedger(cwd, { totalUsd: 1.1 });
  initializeRecordingAllowance({ cwd, allowanceUsd: 1, now: () => '2026-10-29T12:00:00.000Z' });
  const env = { META_API_KEY: 'test-meta-key', DEMO_ACCESS_CODE: 'test-private-code', META_SPEND_CAP_USD: '10', DEMO_DAILY_CAP_USD: '3' };
  const budget = inspectRecordingBudget({ cwd, env, today: '2026-10-29' });
  assert.equal(budget.valid, true);
  let calls = 0;
  const runner = async options => {
    calls++;
    const evidence = { status: 'retrieved', topicId: 'alexandria-library', sources: [] };
    options.onStep({ step: 'evidence', evidence });
    return { runId: 'stub-run', branch: { status: 'ok', evidence }, costUsd: 0.02, trace: [] };
  };
  runner.enforcesDailyCap = true;
  const args = parseArgs(['--serve', '--cap-usd', String(budget.absoluteAllowanceCapUsd)]);
  const started = await startRecordingServer({ args, budget, env, cwd, runnerFactory(options) {
    assert.equal(options.taskBudgetUsd, 1);
    assert.equal(options.dailyCapUsd, budget.configuredDailyCapUsd);
    return runner;
  } });
  t.after(async () => {
    await new Promise(resolve => started.server.close(resolve));
    rmSync(cwd, { recursive: true, force: true });
  });
  assert.equal(new URL(started.url).hostname, '127.0.0.1');
  const post = () => fetch(`${started.url}/api/run`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-demo-access-code': 'test-private-code' },
    body: JSON.stringify({ divergence: RECORDING_PROMPT }),
  });
  const first = await post();
  assert.equal(first.status, 200);
  const firstEvents = await first.text();
  assert.match(firstEvents, /event: evidence/);
  assert.match(firstEvents, /event: complete/);
  assert.equal(calls, 1);
  const second = await post();
  assert.equal(second.status, 200);
  assert.match(await second.text(), /event: error/);
  assert.equal(calls, 1);
  const report = readFileSync(started.reportPath, 'utf8');
  assert.match(report, /"freshEvidence"/);
  assert.match(report, /"topLevelRunAttempts":1/);
});
