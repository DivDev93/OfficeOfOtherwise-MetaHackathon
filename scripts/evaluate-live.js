import { appendFileSync, existsSync, mkdirSync, openSync, readFileSync, closeSync, readdirSync, writeFileSync, fsyncSync, linkSync, unlinkSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { createDemoRunner } from '../src/demo/pipeline.js';
import { DEFAULT_BASE_URL } from '../src/lib/metaClient.js';

export const EVALUATION_PROMPTS = Object.freeze([
  'What if the Library of Alexandria never burned?',
  'What if the Bering land bridge never flooded?',
  'What if the Sahara had stayed green?',
  'What if Antikythera-style mechanisms had scaled into industry?',
]);

// Largest previously documented fresh text/image/SAM run. It is an observed
// reference, not a guaranteed upper bound or a substitute for the hard ledger cap.
export const REFERENCE_PROMPT_COST_USD = 0.2858568;
export const MAX_PLANNED_LOGICAL_META_CALLS_PER_PROMPT = 13; // policy 1 + proposal 2 + branch checks 5 + review 2 + image 1 + SAM 2
export const SCOPED_ALLOWANCE_RELATIVE_PATH = join('out', 'evaluations', 'fresh-live-evaluation.json');
export const SCOPED_ALLOWANCE_SCOPE = 'four-prompt-live-evaluation';
export const SCOPED_ALLOWANCE_USD = 2;
export const SCOPED_REPORT_RELATIVE_PATH = join('out', 'evaluations', 'fresh-live-evaluation.jsonl');
export const EVALUATION_DAILY_CAP_USD = 3;
const PINNED_MODELS = Object.freeze({
  promptPolicy: 'muse-spark-1.3',
  branchPolicy: 'muse-spark-1.3',
  planner: 'muse-wonder-1.0',
  image: 'muse-image-1.0',
  segmentation: 'sam-3.1',
});

function numberEnv(env, key, fallback) {
  const value = env[key] === undefined || env[key] === '' ? fallback : Number(env[key]);
  if (!Number.isFinite(value) || value < 0) throw new Error(`Invalid ${key}`);
  return value;
}

function plainObject(value) { return value && typeof value === 'object' && !Array.isArray(value); }
function isAllowedMetaBaseUrl(value) {
  if (value === undefined || value === '') return true;
  const trimmed = String(value).trim();
  return trimmed === DEFAULT_BASE_URL || trimmed === `${DEFAULT_BASE_URL}/`;
}

/** Read only: this intentionally avoids fileLedger(), which creates a lock directory. */
export function inspectBudget({ cwd = process.cwd(), env = process.env, today = new Date().toISOString().slice(0, 10), checkpointPath = join('out', 'demo-task-budget.json') } = {}) {
  const resolvedCheckpointPath = resolve(cwd, checkpointPath);
  const ledgerPath = join(cwd, 'out', 'spend.json');
  const ledgerLockPath = `${ledgerPath}.lock`;
  const state = { valid: false, errors: [], checkpointPath: resolvedCheckpointPath, ledgerPath };
  try {
    if (existsSync(ledgerLockPath)) throw new Error('Spend ledger lock is present; investigate the active or unfinished ledger operation before retrying.');
    const checkpoint = JSON.parse(readFileSync(resolvedCheckpointPath, 'utf8'));
    const ledger = JSON.parse(readFileSync(ledgerPath, 'utf8'));
    if (existsSync(ledgerLockPath)) throw new Error('Spend ledger changed during preflight; investigate the active or unfinished ledger operation before retrying.');
    const scoped = resolvedCheckpointPath === resolve(cwd, SCOPED_ALLOWANCE_RELATIVE_PATH);
    if (scoped && (checkpoint.schemaVersion !== 1 || checkpoint.scope !== SCOPED_ALLOWANCE_SCOPE || checkpoint.ledgerPath !== 'out/spend.json' || !/^\d{4}-\d{2}-\d{2}T/.test(checkpoint.createdAt ?? ''))) throw new Error('Scoped allowance checkpoint is invalid');
    if (!Number.isFinite(checkpoint.startingMetaSpendUsd) || checkpoint.startingMetaSpendUsd < 0 || checkpoint.taskBudgetUsd !== 2 || (scoped && checkpoint.taskBudgetUsd !== SCOPED_ALLOWANCE_USD)) throw new Error('Task checkpoint is invalid');
    if (!Number.isFinite(ledger.totalUsd) || ledger.totalUsd < 0 || !Array.isArray(ledger.entries) || !plainObject(ledger.reservations ?? {})) throw new Error('Spend ledger is invalid');
    for (const entry of ledger.entries) if (!Number.isFinite(entry.usd) || entry.usd < 0 || typeof entry.at !== 'string') throw new Error('Spend ledger contains an invalid entry');
    const reservations = Object.values(ledger.reservations ?? {});
    for (const item of reservations) if (!Number.isFinite(item.usd) || item.usd < 0 || typeof item.day !== 'string') throw new Error('Spend ledger contains an invalid reservation');
    if (ledger.totalUsd < checkpoint.startingMetaSpendUsd) throw new Error('Spend ledger is below the task checkpoint');

    const metaEnvCapUsd = numberEnv(env, 'META_SPEND_CAP_USD', 100);
    const dailyCapUsd = Math.min(numberEnv(env, 'DEMO_DAILY_CAP_USD', EVALUATION_DAILY_CAP_USD), EVALUATION_DAILY_CAP_USD);
    const reservedUsd = reservations.reduce((sum, item) => sum + item.usd, 0);
    const checkpointCapUsd = checkpoint.startingMetaSpendUsd + checkpoint.taskBudgetUsd;
    const effectiveCapUsd = Math.min(metaEnvCapUsd, checkpointCapUsd);
    const committedUsd = ledger.totalUsd + reservedUsd;
    const dailySpentUsd = ledger.entries
      .filter(entry => entry.label !== 'chronos-3d' && new Date(entry.at).toISOString().slice(0, 10) === today)
      .reduce((sum, entry) => sum + entry.usd, 0) + reservedUsd;
    if (!Number.isFinite(dailySpentUsd)) throw new Error('Spend ledger contains an invalid timestamp');
    state.valid = true;
    Object.assign(state, {
      todayUtc: today,
      taskBudgetUsd: checkpoint.taskBudgetUsd,
      scope: checkpoint.scope ?? 'existing-demo-task',
      startingMetaSpendUsd: checkpoint.startingMetaSpendUsd,
      ledgerTotalUsd: ledger.totalUsd,
      reservedUsd,
      budgetUncertain: ledger.budgetUncertain === true,
      configuredMetaCapUsd: metaEnvCapUsd,
      configuredDailyCapUsd: dailyCapUsd,
      checkpointCapUsd,
      effectiveCapUsd,
      committedUsd,
      availableTotalUsd: Math.max(0, effectiveCapUsd - committedUsd),
      dailySpentUsd,
      availableDailyUsd: Math.max(0, dailyCapUsd - dailySpentUsd),
      referencePromptCostUsd: REFERENCE_PROMPT_COST_USD,
      referenceBatchCostUsd: REFERENCE_PROMPT_COST_USD * EVALUATION_PROMPTS.length,
      plannedLogicalMetaCallsPerPrompt: MAX_PLANNED_LOGICAL_META_CALLS_PER_PROMPT,
      plannedLogicalMetaCallsBatch: MAX_PLANNED_LOGICAL_META_CALLS_PER_PROMPT * EVALUATION_PROMPTS.length,
    });
  } catch (error) {
    state.errors.push(error.message);
  }
  return state;
}

export function parseArgs(argv) {
  let live = false, dryRun = false, initAllowance = false, capUsd, allowanceFile;
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--dry-run') {
      dryRun = true;
    } else if (argv[i] === '--live') {
      live = true;
    } else if (argv[i] === '--init-allowance') {
      initAllowance = true;
    } else if (argv[i] === '--cap-usd') {
      if (capUsd !== undefined || !argv[i + 1]) throw new Error('--cap-usd requires one positive absolute USD ceiling');
      capUsd = Number(argv[++i]);
      if (!Number.isFinite(capUsd) || capUsd <= 0) throw new Error('--cap-usd must be a positive number');
    } else if (argv[i] === '--allowance-file') {
      if (allowanceFile !== undefined || !argv[i + 1]) throw new Error('--allowance-file requires one path');
      const value = argv[++i];
      if (resolve(value) !== resolve(SCOPED_ALLOWANCE_RELATIVE_PATH)) throw new Error(`--allowance-file must be ${SCOPED_ALLOWANCE_RELATIVE_PATH}`);
      allowanceFile = SCOPED_ALLOWANCE_RELATIVE_PATH;
    } else throw new Error(`Unknown argument: ${argv[i]}`);
  }
  if (live && dryRun) throw new Error('--dry-run and --live cannot be combined');
  if (initAllowance && (live || dryRun || capUsd !== undefined || allowanceFile !== undefined)) throw new Error('--init-allowance cannot be combined with other options');
  if (live && capUsd === undefined) throw new Error('--live requires an explicit --cap-usd absolute ceiling');
  if (live && allowanceFile === undefined) throw new Error('--live requires --allowance-file out/evaluations/fresh-live-evaluation.json');
  if (!live && capUsd !== undefined) throw new Error('--cap-usd is only accepted with --live');
  return { live, dryRun, initAllowance, capUsd, allowanceFile };
}

/** Create a new, one-use evaluation checkpoint at the ledger's current total. Never resets either existing budget file. */
export function initializeScopedAllowance({ cwd = process.cwd(), now = () => new Date().toISOString() } = {}) {
  const ledgerPath = resolve(cwd, 'out', 'spend.json');
  const taskPath = resolve(cwd, 'out', 'demo-task-budget.json');
  const allowancePath = resolve(cwd, SCOPED_ALLOWANCE_RELATIVE_PATH);
  const reportPath = resolve(cwd, SCOPED_REPORT_RELATIVE_PATH);
  if (existsSync(allowancePath)) throw new Error('Scoped evaluation allowance already exists; it cannot be reset or replaced.');
  if (existsSync(reportPath)) throw new Error('Evaluation report already exists; this one-time scope cannot be reinitialized.');
  if (existsSync(`${ledgerPath}.lock`)) throw new Error('Spend ledger lock is present; do not initialize during an active ledger operation.');
  const task = JSON.parse(readFileSync(taskPath, 'utf8'));
  const ledger = JSON.parse(readFileSync(ledgerPath, 'utf8'));
  if (task.taskBudgetUsd !== 2 || !Number.isFinite(task.startingMetaSpendUsd) || task.startingMetaSpendUsd < 0) throw new Error('Existing demo task checkpoint is invalid.');
  if (!Number.isFinite(ledger.totalUsd) || ledger.totalUsd < task.startingMetaSpendUsd || !Array.isArray(ledger.entries) || !plainObject(ledger.reservations ?? {})) throw new Error('Existing spend ledger is invalid or below its checkpoint.');
  if (ledger.budgetUncertain === true) throw new Error('Spend ledger is uncertain; investigate before initializing an evaluation allowance.');
  if (Object.keys(ledger.reservations ?? {}).length) throw new Error('Spend ledger has unresolved reservations; investigate before initializing an evaluation allowance.');
  if (existsSync(`${ledgerPath}.lock`)) throw new Error('Spend ledger changed during initialization; retry only after resolving the lock.');
  const checkpoint = {
    schemaVersion: 1,
    scope: SCOPED_ALLOWANCE_SCOPE,
    createdAt: now(),
    ledgerPath: 'out/spend.json',
    startingMetaSpendUsd: ledger.totalUsd,
    taskBudgetUsd: SCOPED_ALLOWANCE_USD,
  };
  mkdirSync(join(cwd, 'out', 'evaluations'), { recursive: true });
  const temporaryPath = `${allowancePath}.${process.pid}.tmp`;
  const descriptor = openSync(temporaryPath, 'wx');
  try {
    writeFileSync(descriptor, `${JSON.stringify(checkpoint, null, 2)}\n`);
    fsyncSync(descriptor);
  } finally { closeSync(descriptor); }
  try { linkSync(temporaryPath, allowancePath); }
  catch (error) { unlinkSync(temporaryPath); throw error; }
  unlinkSync(temporaryPath);
  return { checkpointPath: SCOPED_ALLOWANCE_RELATIVE_PATH, startingMetaSpendUsd: checkpoint.startingMetaSpendUsd, taskBudgetUsd: checkpoint.taskBudgetUsd, absoluteCheckpointCeilingUsd: checkpoint.startingMetaSpendUsd + checkpoint.taskBudgetUsd };
}

export function createPlan({ budget, args, env = process.env, hasApiKey = Boolean(env.META_API_KEY || env.MODEL_API_KEY), evaluationAlreadyStarted = false } = {}) {
  const reasons = [...(budget?.errors ?? [])];
  if (!isAllowedMetaBaseUrl(env.META_API_BASE_URL)) reasons.push('Configured API base is not the approved Meta endpoint for this evaluator.');
  const modelRouting = {
    promptPolicy: env.META_TEXT_MODEL_POLICY_PROMPT || PINNED_MODELS.promptPolicy,
    branchPolicy: env.META_TEXT_MODEL_POLICY_BRANCHES || PINNED_MODELS.branchPolicy,
    planner: env.META_TEXT_MODEL_PLANNER || PINNED_MODELS.planner,
    image: env.META_IMAGE_MODEL || PINNED_MODELS.image,
    segmentation: env.META_SEGMENT_MODEL || PINNED_MODELS.segmentation,
  };
  if (Object.entries(PINNED_MODELS).some(([key, expected]) => modelRouting[key] !== expected)) reasons.push('Configured model routing differs from the pinned evaluation stack.');
  const topicPolicy = (env.TOPIC_POLICY_BLOCK ?? '').split(',').map(value => value.trim().toLowerCase()).filter(Boolean).sort().join(',');
  if (topicPolicy && topicPolicy !== 'politics,war') reasons.push('The evaluation requires the strict war-and-politics topic policy.');
  let requestedCapUsd = null;
  if (!budget?.valid) reasons.push('Existing task checkpoint and spend ledger must be readable and valid.');
  if (budget?.valid) {
    if (budget.budgetUncertain) reasons.push('The spend ledger is marked uncertain; investigate before any live run.');
    if (args.live && budget.scope !== SCOPED_ALLOWANCE_SCOPE) reasons.push('Live evaluation requires the separate four-prompt allowance checkpoint.');
    if (args.live && evaluationAlreadyStarted) reasons.push('The one-time evaluation scope already has a report; do not repeat its prompts.');
    requestedCapUsd = args.live ? args.capUsd : Math.min(budget.effectiveCapUsd, numberEnv(env, 'META_SPEND_CAP_USD', 100));
    if (args.live && requestedCapUsd > budget.effectiveCapUsd) reasons.push('The approved cap cannot exceed the current configured and checkpoint ceilings.');
    if (budget.availableTotalUsd < budget.referenceBatchCostUsd) reasons.push('Current total/task allowance is below the four-run historical reference estimate.');
    if (budget.availableDailyUsd < budget.referenceBatchCostUsd) reasons.push('Current UTC daily allowance is below the four-run historical reference estimate.');
    if (args.live && requestedCapUsd - budget.committedUsd < budget.referenceBatchCostUsd) reasons.push('The requested absolute ceiling does not leave the reference allowance for all four prompts.');
    if (args.live && !hasApiKey) reasons.push('A Meta API credential is not configured in the process environment.');
  }
  return {
    mode: args.live ? 'live' : 'dry-run',
    providerCallsWillOccur: false,
    readiness: reasons.length ? 'blocked' : 'ready',
    reasons,
    explicitLiveCapUsd: args.live ? args.capUsd : null,
    effectiveAbsoluteCapUsd: requestedCapUsd,
    prompts: [...EVALUATION_PROMPTS],
    attemptsPerPrompt: 1,
    plannedLogicalMetaCallsPerPrompt: MAX_PLANNED_LOGICAL_META_CALLS_PER_PROMPT,
    plannedLogicalMetaCallsBatch: MAX_PLANNED_LOGICAL_META_CALLS_PER_PROMPT * EVALUATION_PROMPTS.length,
    logicalCallCountNote: 'Logical POST calls at the current provider flow; transport-level retries, if applicable, are not counted as separate calls here.',
    threeDProviderCalls: 0,
    metaCostReference: {
      usdPerPrompt: REFERENCE_PROMPT_COST_USD,
      batchUsd: REFERENCE_PROMPT_COST_USD * EVALUATION_PROMPTS.length,
      basis: 'Largest documented single-run Meta estimate; one historical observation, not a guaranteed upper bound.',
    },
    modelRouting,
    budget: budget?.valid ? {
      todayUtc: budget.todayUtc,
      taskBudgetUsd: budget.taskBudgetUsd,
      startingMetaSpendUsd: budget.startingMetaSpendUsd,
      ledgerTotalUsd: budget.ledgerTotalUsd,
      reservedUsd: budget.reservedUsd,
      budgetUncertain: budget.budgetUncertain,
      checkpointCapUsd: budget.checkpointCapUsd,
      configuredMetaCapUsd: budget.configuredMetaCapUsd,
      effectiveCapUsd: budget.effectiveCapUsd,
      availableTotalUsd: budget.availableTotalUsd,
      dailyCapUsd: budget.configuredDailyCapUsd,
      dailySpentUsd: budget.dailySpentUsd,
      availableDailyUsd: budget.availableDailyUsd,
      apiCredentialPresent: Boolean(hasApiKey),
    } : null,
  };
}

function jsonIfPresent(path) {
  try { return JSON.parse(readFileSync(path, 'utf8')); } catch { return null; }
}

function artifactPaths(runDirectory) {
  const paths = Object.fromEntries(['branch.json', 'trace.json', 'hero.png', 'mask.png', 'cutout.png']
    .map(name => [name, existsSync(join(runDirectory, name)) ? join(runDirectory, name) : null]));
  let additionalFiles = [];
  try {
    additionalFiles = readdirSync(runDirectory, { withFileTypes: true })
      .filter(entry => entry.isFile() && /^(?:sam-(?:raw|response)-\d+\.\w+|image-response\.json)$/.test(entry.name))
      .map(entry => join(runDirectory, entry.name));
  } catch { /* A pre-run failure may leave no run directory. */ }
  return { ...paths, additionalEvidenceFiles: additionalFiles };
}

/** Runs one sequential attempt per prompt and stops on the first thrown run error. */
export async function runPromptBatch({ runner, prompts = EVALUATION_PROMPTS, outputRoot = 'out', onRecord = () => {}, now = Date.now, clock = () => performance.now() } = {}) {
  if (typeof runner !== 'function') throw new Error('A runner is required');
  const records = [];
  let stoppedOnFailure = false;
  for (let index = 0; index < prompts.length; index++) {
    const divergence = prompts[index];
    const timestamp = now() + index;
    const started = clock();
    let firstSafeBranchMs = null, sceneMs = null;
    const runDirectory = resolve(outputRoot, String(timestamp));
    let result = null, error = null, runnerStarted = false;
    try {
      if (existsSync(runDirectory)) throw new Error(`Run output path already exists; refusing to overwrite ${String(timestamp)}`);
      runnerStarted = true;
      result = await runner({
        divergence,
        timestamp,
        onStep(event) {
          const elapsed = Math.max(0, Math.round(clock() - started));
          if (firstSafeBranchMs === null && event?.step === 'propose' && event.pending === false && Array.isArray(event.branches) && event.branches.length) firstSafeBranchMs = elapsed;
          if (sceneMs === null && event?.step === 'image') sceneMs = elapsed;
        },
      });
    } catch (caught) {
      error = caught?.message ?? String(caught);
    }
    const totalMs = Math.max(0, Math.round(clock() - started));
    const tracePath = join(runDirectory, 'trace.json');
    const branchPath = join(runDirectory, 'branch.json');
    const savedTrace = runnerStarted ? jsonIfPresent(tracePath) : null;
    const savedBranch = runnerStarted ? jsonIfPresent(branchPath) : null;
    const runTrace = result?.trace ?? savedTrace?.steps ?? [];
    const is2dOnly = result?.renderStatus === '2d-only' || result?.branch?.renderStatus === '2d-only' || savedTrace?.renderStatus === '2d-only' || savedBranch?.renderStatus === '2d-only';
    const record = {
      prompt: divergence,
      runId: String(timestamp),
      status: error ? 'failed' : (result?.branch?.status ?? savedBranch?.status ?? 'unknown'),
      renderStatus: is2dOnly ? '2d-only' : result?.branch?.status === 'ok' ? 'segmented' : null,
      failure: error,
      latencyMs: { firstSafeBranch: firstSafeBranchMs, scene: sceneMs, total: totalMs },
      recordedMetaCostUsd: Number.isFinite(result?.costUsd) ? result.costUsd : Number.isFinite(savedTrace?.costUsd) ? savedTrace.costUsd : null,
      recordedCostBasis: 'Shared-client ledger entries; estimates are not provider invoices.',
      threeD: { called: false, costUsd: null, note: 'No 3D provider call was made; any separately generated replay-model cost remains unknown.' },
      sourceQuality: 'Not assessed by this evaluator. Curated baseline notes are not generated for fresh runs.',
      artifacts: {
        directory: runnerStarted && existsSync(runDirectory) ? runDirectory : null,
        ...(runnerStarted ? artifactPaths(runDirectory) : { ...Object.fromEntries(['branch.json', 'trace.json', 'hero.png', 'mask.png', 'cutout.png'].map(name => [name, null])), additionalEvidenceFiles: [] }),
      },
      trace: runTrace,
    };
    records.push(record);
    onRecord(record, index);
    if (error) { stoppedOnFailure = true; break; }
  }
  return { records, stoppedOnFailure, attempted: records.length, planned: prompts.length };
}

function printPlan(plan) { console.log(JSON.stringify(plan, null, 2)); }

export function liveRunnerOptions({ args, budget, env = process.env } = {}) {
  return {
    env: {
      ...env,
      META_API_BASE_URL: DEFAULT_BASE_URL,
      META_SPEND_CAP_USD: String(args.capUsd),
      DEMO_3D_ENABLED: 'false',
      TOPIC_POLICY_BLOCK: 'war,politics',
      META_TEXT_MODEL_POLICY_PROMPT: PINNED_MODELS.promptPolicy,
      META_TEXT_MODEL_POLICY_BRANCHES: PINNED_MODELS.branchPolicy,
      META_TEXT_MODEL_PLANNER: PINNED_MODELS.planner,
      META_IMAGE_MODEL: PINNED_MODELS.image,
      META_SEGMENT_MODEL: PINNED_MODELS.segmentation,
    },
    outputRoot: 'out',
    budgetCheckpointPath: SCOPED_ALLOWANCE_RELATIVE_PATH,
    dailyCapUsd: budget.configuredDailyCapUsd,
  };
}

async function main(argv = process.argv.slice(2)) {
  let args;
  try { args = parseArgs(argv); }
  catch (error) { console.error(error.message); process.exitCode = 2; return; }
  if (args.initAllowance) {
    try { console.log(JSON.stringify(initializeScopedAllowance(), null, 2)); }
    catch (error) { console.error(error.message); process.exitCode = 2; }
    return;
  }
  const budget = inspectBudget({ checkpointPath: args.allowanceFile ?? join('out', 'demo-task-budget.json') });
  const evaluationAlreadyStarted = existsSync(resolve(SCOPED_REPORT_RELATIVE_PATH));
  const plan = createPlan({ budget, args, evaluationAlreadyStarted });
  if (!args.live) { printPlan(plan); return; }
  if (plan.readiness !== 'ready') { printPlan(plan); process.exitCode = 2; return; }

  // The supplied cap may only tighten current limits. Replay and 3D are forced off.
  const runner = createDemoRunner(liveRunnerOptions({ args, budget }));
  const evaluationDirectory = resolve('out', 'evaluations');
  mkdirSync(evaluationDirectory, { recursive: true });
  const reportPath = resolve(SCOPED_REPORT_RELATIVE_PATH);
  const descriptor = openSync(reportPath, 'wx');
  closeSync(descriptor);
  appendFileSync(reportPath, `${JSON.stringify({ type: 'plan', createdAt: new Date().toISOString(), ...plan, providerCallsWillOccur: true })}\n`);
  const outcome = await runPromptBatch({ runner, onRecord: record => appendFileSync(reportPath, `${JSON.stringify({ type: 'run', ...record })}\n`) });
  appendFileSync(reportPath, `${JSON.stringify({ type: 'complete', completedAt: new Date().toISOString(), ...outcome })}\n`);
  console.log(JSON.stringify({ reportPath, ...outcome }, null, 2));
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  main().catch(error => { console.error(error.message); process.exitCode = 1; });
}
