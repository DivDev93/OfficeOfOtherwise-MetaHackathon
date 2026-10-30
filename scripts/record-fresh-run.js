import { existsSync, mkdirSync, openSync, readFileSync, closeSync, writeFileSync, fsyncSync, linkSync, unlinkSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { createDemoRunner } from '../src/demo/pipeline.js';
import { createDemoServer } from '../server/index.js';
import { DEFAULT_BASE_URL } from '../src/lib/metaClient.js';

export const RECORDING_PROMPT = 'What if the Library of Alexandria never burned?';
export const RECORDING_ALLOWANCE_PATH = join('out', 'evaluations', 'fresh-recording.json');
export const RECORDING_REPORT_PATH = join('out', 'recordings', 'fresh-run.jsonl');
export const RECORDING_SCOPE = 'one-prompt-fresh-recording';
export const MAX_ALLOWANCE_USD = 1;
export const MAX_ADDITIONAL_SPEND_USD = 10;
export const REFERENCE_PROMPT_COST_USD = 0.2858568;
export const PINNED_MODELS = Object.freeze({
  promptPolicy: 'muse-spark-1.3',
  branchPolicy: 'muse-spark-1.3',
  planner: 'muse-wonder-1.0',
  image: 'muse-image-1.0',
  segmentation: 'sam-3.1',
});

function nonnegativeNumber(env, key, fallback) {
  const value = env[key] === undefined || env[key] === '' ? fallback : Number(env[key]);
  if (!Number.isFinite(value) || value < 0) throw new Error(`Invalid ${key}`);
  return value;
}

function object(value) { return value !== null && typeof value === 'object' && !Array.isArray(value); }

export function pathsForAttempt(attempt) {
  if (attempt === undefined) return { checkpointPath: RECORDING_ALLOWANCE_PATH, reportPath: RECORDING_REPORT_PATH };
  if (typeof attempt !== 'string' || !/^[a-z0-9][a-z0-9_-]{0,31}$/.test(attempt)) throw new Error('Attempt name must be a 1–32 character safe identifier using lowercase letters, digits, hyphens, or underscores.');
  return {
    checkpointPath: join('out', 'evaluations', `fresh-recording-${attempt}.json`),
    reportPath: join('out', 'recordings', `fresh-run-${attempt}.jsonl`),
  };
}

function originalWorkflowBaseline(cwd) {
  const reportPath = resolve(cwd, RECORDING_REPORT_PATH);
  const rows = readFileSync(reportPath, 'utf8').split(/\r?\n/).filter(Boolean).map(line => JSON.parse(line));
  const baseline = rows.find(row => row.type === 'plan')?.budget?.ledgerTotalUsd;
  if (!Number.isFinite(baseline) || baseline < 0) throw new Error('The original fresh-run report does not contain a valid workflow spend baseline.');
  return baseline;
}

/** Read existing shared-budget state without creating a lock or changing files. */
export function inspectRecordingBudget({ cwd = process.cwd(), env = process.env, today = new Date().toISOString().slice(0, 10), attempt } = {}) {
  const paths = pathsForAttempt(attempt);
  const checkpointPath = resolve(cwd, paths.checkpointPath);
  const ledgerPath = resolve(cwd, 'out', 'spend.json');
  const state = { valid: false, errors: [], checkpointPath, ledgerPath };
  try {
    if (existsSync(`${ledgerPath}.lock`)) throw new Error('Spend ledger lock is present; investigate the active or unfinished ledger operation.');
    const checkpoint = JSON.parse(readFileSync(checkpointPath, 'utf8'));
    const ledger = JSON.parse(readFileSync(ledgerPath, 'utf8'));
    if (existsSync(`${ledgerPath}.lock`)) throw new Error('Spend ledger changed during preflight; investigate the active or unfinished ledger operation.');
    if (checkpoint.schemaVersion !== 1 || checkpoint.scope !== RECORDING_SCOPE || checkpoint.ledgerPath !== 'out/spend.json' || !/^\d{4}-\d{2}-\d{2}T/.test(checkpoint.createdAt ?? '')) throw new Error('Fresh recording allowance checkpoint is invalid.');
    if (!Number.isFinite(checkpoint.startingMetaSpendUsd) || checkpoint.startingMetaSpendUsd < 0 || checkpoint.taskBudgetUsd !== 1 || !Number.isFinite(checkpoint.allowanceUsd) || checkpoint.allowanceUsd <= 0 || checkpoint.allowanceUsd > MAX_ALLOWANCE_USD) throw new Error('Fresh recording allowance checkpoint is invalid.');
    let workflowBaselineUsd = null, workflowOverallCapUsd = null;
    if (attempt !== undefined) {
      workflowBaselineUsd = originalWorkflowBaseline(cwd);
      workflowOverallCapUsd = checkpoint.workflowOverallCapUsd;
      if (checkpoint.attempt !== attempt || checkpoint.workflowBaselineUsd !== workflowBaselineUsd || !Number.isFinite(workflowOverallCapUsd) || workflowOverallCapUsd < workflowBaselineUsd || workflowOverallCapUsd > workflowBaselineUsd + MAX_ADDITIONAL_SPEND_USD) throw new Error('Attempt checkpoint has an invalid workflow spend ceiling.');
      if (ledger.totalUsd > workflowOverallCapUsd) throw new Error('Shared spend ledger has reached the workflow overall cap.');
    }
    if (!Number.isFinite(ledger.totalUsd) || ledger.totalUsd < checkpoint.startingMetaSpendUsd || !Array.isArray(ledger.entries) || !object(ledger.reservations ?? {})) throw new Error('Shared spend ledger is invalid or below the fresh recording checkpoint.');
    for (const entry of ledger.entries) if (!Number.isFinite(entry.usd) || entry.usd < 0 || typeof entry.at !== 'string') throw new Error('Shared spend ledger contains an invalid entry.');
    const reservations = Object.values(ledger.reservations ?? {});
    for (const item of reservations) if (!Number.isFinite(item.usd) || item.usd < 0 || typeof item.day !== 'string') throw new Error('Shared spend ledger contains an invalid reservation.');
    if (ledger.budgetUncertain === true) throw new Error('Shared spend ledger is marked uncertain; investigate before recording.');
    if (reservations.length) throw new Error('Shared spend ledger has unresolved reservations; investigate before recording.');

    const configuredMetaCapUsd = nonnegativeNumber(env, 'META_SPEND_CAP_USD', 100);
    const dailyCapUsd = Math.min(nonnegativeNumber(env, 'DEMO_DAILY_CAP_USD', 3), 3);
    const dailySpentUsd = ledger.entries.filter(entry => entry.label !== 'chronos-3d' && new Date(entry.at).toISOString().slice(0, 10) === today).reduce((sum, entry) => sum + entry.usd, 0);
    if (!Number.isFinite(dailySpentUsd)) throw new Error('Shared spend ledger contains an invalid timestamp.');
    const committedUsd = ledger.totalUsd;
    const absoluteAllowanceCapUsd = checkpoint.startingMetaSpendUsd + checkpoint.allowanceUsd;
    const effectiveOverallCapUsd = workflowOverallCapUsd ?? Infinity;
    const totalCeilingUsd = Math.min(absoluteAllowanceCapUsd, configuredMetaCapUsd, effectiveOverallCapUsd);
    Object.assign(state, {
      valid: true, scope: checkpoint.scope, todayUtc: today,
      startingMetaSpendUsd: checkpoint.startingMetaSpendUsd,
      allowanceUsd: checkpoint.allowanceUsd, absoluteAllowanceCapUsd, attempt: attempt ?? null,
      workflowBaselineUsd, workflowOverallCapUsd,
      ledgerTotalUsd: ledger.totalUsd, committedUsd,
      availableTotalUsd: Math.max(0, totalCeilingUsd - committedUsd),
      configuredMetaCapUsd, configuredDailyCapUsd: dailyCapUsd, dailySpentUsd,
      availableDailyUsd: Math.max(0, dailyCapUsd - dailySpentUsd),
      budgetUncertain: false, apiCredentialPresent: Boolean(env.META_API_KEY || env.MODEL_API_KEY),
    });
  } catch (error) { state.errors.push(error.message); }
  return state;
}

export function parseArgs(argv) {
  let dryRun = false, serve = false, initAllowance = false, capUsd, allowanceUsd, overallCapUsd, attempt;
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--dry-run') dryRun = true;
    else if (argv[i] === '--serve') serve = true;
    else if (argv[i] === '--init-allowance') initAllowance = true;
    else if (argv[i] === '--attempt') {
      if (attempt !== undefined || !argv[i + 1]) throw new Error('--attempt requires one unique safe identifier');
      attempt = argv[++i];
      pathsForAttempt(attempt);
    } else if (argv[i] === '--overall-cap-usd') {
      if (overallCapUsd !== undefined || !argv[i + 1]) throw new Error('--overall-cap-usd requires one positive absolute USD ceiling');
      overallCapUsd = Number(argv[++i]);
      if (!Number.isFinite(overallCapUsd) || overallCapUsd <= 0) throw new Error('--overall-cap-usd must be a positive number');
    }
    else if (argv[i] === '--cap-usd') {
      if (capUsd !== undefined || !argv[i + 1]) throw new Error('--cap-usd requires one positive absolute USD ceiling');
      capUsd = Number(argv[++i]);
      if (!Number.isFinite(capUsd) || capUsd <= 0) throw new Error('--cap-usd must be a positive number');
    } else if (argv[i] === '--allowance-usd') {
      if (allowanceUsd !== undefined || !argv[i + 1]) throw new Error('--allowance-usd requires one positive USD allowance');
      allowanceUsd = Number(argv[++i]);
      if (!Number.isFinite(allowanceUsd) || allowanceUsd <= 0 || allowanceUsd > MAX_ALLOWANCE_USD) throw new Error(`--allowance-usd must be greater than 0 and no more than ${MAX_ALLOWANCE_USD}`);
    } else throw new Error(`Unknown argument: ${argv[i]}`);
  }
  if (serve && dryRun) throw new Error('--dry-run and --serve cannot be combined');
  if (initAllowance && (serve || dryRun || capUsd !== undefined)) throw new Error('--init-allowance cannot be combined with --serve, --dry-run, or --cap-usd');
  if (initAllowance && allowanceUsd === undefined) throw new Error('--init-allowance requires an explicit --allowance-usd');
  if (!initAllowance && allowanceUsd !== undefined) throw new Error('--allowance-usd is only accepted with --init-allowance');
  if (serve && capUsd === undefined) throw new Error('--serve requires an explicit --cap-usd absolute ceiling');
  if (!serve && capUsd !== undefined) throw new Error('--cap-usd is only accepted with --serve');
  if (overallCapUsd !== undefined && attempt === undefined) throw new Error('--overall-cap-usd requires --attempt');
  return { dryRun, serve, initAllowance, capUsd, allowanceUsd, overallCapUsd, attempt };
}

/** One-time checkpoint creation; snapshots the current ledger and never alters the existing task checkpoint. */
export function initializeRecordingAllowance({ cwd = process.cwd(), allowanceUsd, attempt, overallCapUsd, now = () => new Date().toISOString() } = {}) {
  if (!Number.isFinite(allowanceUsd) || allowanceUsd <= 0 || allowanceUsd > MAX_ALLOWANCE_USD) throw new Error(`Allowance must be greater than 0 and no more than ${MAX_ALLOWANCE_USD} USD.`);
  const paths = pathsForAttempt(attempt);
  const checkpointPath = resolve(cwd, paths.checkpointPath);
  const reportPath = resolve(cwd, paths.reportPath);
  const ledgerPath = resolve(cwd, 'out', 'spend.json');
  const taskPath = resolve(cwd, 'out', 'demo-task-budget.json');
  if (existsSync(checkpointPath)) throw new Error('Fresh recording allowance already exists; it cannot be reset or replaced.');
  if (existsSync(reportPath)) throw new Error('Fresh recording report already exists; this one-time scope cannot be reinitialized.');
  if (existsSync(`${ledgerPath}.lock`)) throw new Error('Spend ledger lock is present; do not initialize during an active ledger operation.');
  const task = JSON.parse(readFileSync(taskPath, 'utf8'));
  const ledger = JSON.parse(readFileSync(ledgerPath, 'utf8'));
  if (task.taskBudgetUsd !== 2 || !Number.isFinite(task.startingMetaSpendUsd) || task.startingMetaSpendUsd < 0) throw new Error('Existing demo task checkpoint is invalid.');
  if (!Number.isFinite(ledger.totalUsd) || ledger.totalUsd < task.startingMetaSpendUsd || !Array.isArray(ledger.entries) || !object(ledger.reservations ?? {})) throw new Error('Existing spend ledger is invalid or below its checkpoint.');
  if (ledger.budgetUncertain === true) throw new Error('Spend ledger is uncertain; investigate before initializing a recording allowance.');
  if (Object.keys(ledger.reservations ?? {}).length) throw new Error('Spend ledger has unresolved reservations; investigate before initializing a recording allowance.');
  if (existsSync(`${ledgerPath}.lock`)) throw new Error('Spend ledger changed during initialization; retry only after resolving the lock.');
  let workflowFields = {};
  if (attempt !== undefined) {
    const workflowBaselineUsd = originalWorkflowBaseline(cwd);
    const maxWorkflowCapUsd = workflowBaselineUsd + MAX_ADDITIONAL_SPEND_USD;
    const workflowCap = overallCapUsd ?? maxWorkflowCapUsd;
    if (!Number.isFinite(workflowCap) || workflowCap < ledger.totalUsd || workflowCap < workflowBaselineUsd || workflowCap > maxWorkflowCapUsd) throw new Error(`Workflow cap must be at least current spend and no more than ${maxWorkflowCapUsd} USD.`);
    workflowFields = { attempt, workflowBaselineUsd, workflowOverallCapUsd: workflowCap };
  } else if (overallCapUsd !== undefined) throw new Error('--overall-cap-usd requires a named attempt.');
  const checkpoint = {
    schemaVersion: 1,
    scope: RECORDING_SCOPE,
    createdAt: now(),
    ledgerPath: 'out/spend.json',
    startingMetaSpendUsd: ledger.totalUsd,
    taskBudgetUsd: 1,
    allowanceUsd,
    ...workflowFields,
  };
  mkdirSync(join(cwd, 'out', 'evaluations'), { recursive: true });
  const temporaryPath = `${checkpointPath}.${process.pid}.tmp`;
  const descriptor = openSync(temporaryPath, 'wx');
  try { writeFileSync(descriptor, `${JSON.stringify(checkpoint, null, 2)}\n`); fsyncSync(descriptor); }
  finally { closeSync(descriptor); }
  try { linkSync(temporaryPath, checkpointPath); }
  catch (error) { unlinkSync(temporaryPath); throw error; }
  unlinkSync(temporaryPath);
  return { checkpointPath: paths.checkpointPath, startingMetaSpendUsd: checkpoint.startingMetaSpendUsd, allowanceUsd, absoluteAllowanceCapUsd: checkpoint.startingMetaSpendUsd + allowanceUsd, ...workflowFields };
}

export function createRecordingPlan({ args = parseArgs([]), budget, env = process.env, reportAlreadyExists = false } = {}) {
  const reasons = [...(budget?.errors ?? [])];
  if (reportAlreadyExists) reasons.push('Fresh recording report already exists; this one-use scope cannot be repeated.');
  const baseUrl = env.META_API_BASE_URL;
  if (baseUrl && baseUrl !== DEFAULT_BASE_URL && baseUrl !== `${DEFAULT_BASE_URL}/`) reasons.push('Configured API base is not the approved Meta endpoint.');
  const routing = {
    promptPolicy: env.META_TEXT_MODEL_POLICY_PROMPT || PINNED_MODELS.promptPolicy,
    branchPolicy: env.META_TEXT_MODEL_POLICY_BRANCHES || PINNED_MODELS.branchPolicy,
    planner: env.META_TEXT_MODEL_PLANNER || PINNED_MODELS.planner,
    image: env.META_IMAGE_MODEL || PINNED_MODELS.image,
    segmentation: env.META_SEGMENT_MODEL || PINNED_MODELS.segmentation,
  };
  if (Object.entries(PINNED_MODELS).some(([key, value]) => routing[key] !== value)) reasons.push('Configured model routing differs from the pinned Meta recording stack.');
  const topicPolicy = (env.TOPIC_POLICY_BLOCK ?? '').split(',').map(value => value.trim().toLowerCase()).filter(Boolean).sort().join(',');
  if (topicPolicy && topicPolicy !== 'politics,war') reasons.push('Recording requires the strict war-and-politics topic policy.');
  if (!budget?.valid) reasons.push('A fresh, separate one-run allowance and valid shared ledger are required.');
  if (budget?.valid) {
    if (budget.availableTotalUsd < REFERENCE_PROMPT_COST_USD) reasons.push('Remaining one-run total allowance is below the historical reference estimate.');
    if (budget.availableDailyUsd < REFERENCE_PROMPT_COST_USD) reasons.push('Remaining UTC daily allowance is below the historical reference estimate.');
    if (!budget.apiCredentialPresent) reasons.push('A Meta API credential is not configured in the process environment.');
    if (args.attempt !== undefined && !Number.isFinite(budget.workflowOverallCapUsd)) reasons.push('A named attempt requires its cumulative workflow cap.');
    if (args.overallCapUsd !== undefined && args.overallCapUsd > budget.workflowOverallCapUsd) reasons.push('The requested workflow ceiling cannot exceed the checkpoint cap.');
    const workflowCapUsd = Math.min(budget.workflowOverallCapUsd ?? Infinity, args.overallCapUsd ?? Infinity);
    if (args.serve && (args.capUsd > budget.absoluteAllowanceCapUsd || args.capUsd > budget.configuredMetaCapUsd || args.capUsd > workflowCapUsd)) reasons.push('The requested absolute ceiling exceeds the per-attempt, workflow, or configured Meta cap.');
    if (args.serve && args.capUsd - budget.committedUsd < REFERENCE_PROMPT_COST_USD) reasons.push('The requested absolute ceiling leaves less than the historical one-run estimate.');
  }
  if (args.serve && !env.DEMO_ACCESS_CODE) reasons.push('DEMO_ACCESS_CODE is required for the local recording UI.');
  return {
    mode: args.serve ? 'serve-one-run' : 'dry-run',
    readiness: reasons.length ? 'blocked' : 'ready',
    providerCallsWillOccur: false,
    reasons,
    attempt: args.attempt ?? 'first',
    apiCredentialPresent: Boolean(env.META_API_KEY || env.MODEL_API_KEY),
    localUiAccessCodePresent: Boolean(env.DEMO_ACCESS_CODE),
    prompt: RECORDING_PROMPT,
    topLevelRunAttempts: 1,
    providerRetryBehavior: 'Provider-specific bounded retries or SAM prompt fallback may occur under the shared clients and ledger cap.',
    plannedLogicalMetaCalls: 13,
    threeDProviderCalls: 0,
    evidenceRetrieval: 'Bounded fresh evidence from the fixed approved source registry for Alexandria; no general web search.',
    capUsd: args.serve ? args.capUsd : null,
    modelRouting: routing,
    budget: budget?.valid ? {
      todayUtc: budget.todayUtc,
      ledgerTotalUsd: budget.ledgerTotalUsd,
      committedUsd: budget.committedUsd,
      oneRunAllowanceUsd: budget.allowanceUsd,
      absoluteAllowanceCapUsd: budget.absoluteAllowanceCapUsd,
      workflowBaselineUsd: budget.workflowBaselineUsd,
      workflowOverallCapUsd: budget.workflowOverallCapUsd,
      availableAdditionalWorkflowUsd: budget.workflowOverallCapUsd === null ? null : Math.max(0, budget.workflowOverallCapUsd - budget.committedUsd),
      configuredMetaCapUsd: budget.configuredMetaCapUsd,
      availableTotalUsd: budget.availableTotalUsd,
      dailyCapUsd: budget.configuredDailyCapUsd,
      dailySpentUsd: budget.dailySpentUsd,
      availableDailyUsd: budget.availableDailyUsd,
      apiCredentialPresent: budget.apiCredentialPresent,
    } : null,
  };
}

export function strictRecordingEnv({ source = process.env, capUsd } = {}) {
  const safeSource = Object.fromEntries(Object.entries(source).filter(([key]) => !key.startsWith('CHRONOS_')));
  return {
    ...safeSource,
    META_API_BASE_URL: DEFAULT_BASE_URL,
    META_SPEND_CAP_USD: String(capUsd),
    DEMO_DAILY_CAP_USD: String(Math.min(nonnegativeNumber(source, 'DEMO_DAILY_CAP_USD', 3), 3)),
    DEMO_3D_ENABLED: 'false',
    DEMO_REPLAY_ONLY: 'false',
    TOPIC_POLICY_BLOCK: 'war,politics',
    META_TEXT_MODEL_POLICY_PROMPT: PINNED_MODELS.promptPolicy,
    META_TEXT_MODEL_POLICY_BRANCHES: PINNED_MODELS.branchPolicy,
    META_TEXT_MODEL_PLANNER: PINNED_MODELS.planner,
    META_IMAGE_MODEL: PINNED_MODELS.image,
    META_SEGMENT_MODEL: PINNED_MODELS.segmentation,
    CHRONOS_3D_ENABLED: 'false',
  };
}

/** Reject arbitrary prompts and every second valid invocation before reaching the provider runner. */
export function createSingleRunGuard(runner, { prompt = RECORDING_PROMPT } = {}) {
  if (typeof runner !== 'function') throw new Error('A recording runner is required.');
  let consumed = false;
  const guarded = async options => {
    if (consumed) throw new Error('This recording server permits exactly one fresh run; restart only with a new authorized allowance.');
    if (options?.divergence?.trim() !== prompt) throw new Error('This recording server accepts only the approved Alexandria prompt.');
    consumed = true;
    return runner({ ...options, divergence: prompt });
  };
  guarded.enforcesDailyCap = runner.enforcesDailyCap === true;
  return guarded;
}

function sanitized(value, secrets) {
  if (typeof value === 'string') return secrets.reduce((result, secret) => secret ? result.split(secret).join('[redacted]') : result, value);
  if (Array.isArray(value)) return value.map(item => sanitized(item, secrets));
  if (object(value)) {
    const result = {};
    for (const [key, item] of Object.entries(value)) if (!/token|secret|api.?key|authorization|access.?code/i.test(key)) result[key] = sanitized(item, secrets);
    return result;
  }
  return value;
}

function appendJsonLine(path, record, secrets) {
  const descriptor = openSync(path, 'a');
  try { writeFileSync(descriptor, `${JSON.stringify(sanitized(record, secrets))}\n`); fsyncSync(descriptor); }
  finally { closeSync(descriptor); }
}

/** Serve the recording UI on loopback and accept only one exact prompt attempt. */
export async function startRecordingServer({ args, budget, env = process.env, cwd = process.cwd(), now = () => Date.now(), runnerFactory = createDemoRunner } = {}) {
  const paths = pathsForAttempt(args.attempt);
  const reportAlreadyExists = existsSync(resolve(cwd, paths.reportPath));
  const plan = createRecordingPlan({ args, budget, env, reportAlreadyExists });
  if (plan.readiness !== 'ready' || !args.serve) throw new Error(`Recording server is blocked: ${plan.reasons.join(' ') || 'serve mode is required'}`);
  const reportPath = resolve(cwd, paths.reportPath);
  const scopedEnv = strictRecordingEnv({ source: env, capUsd: args.capUsd });
  const secrets = [scopedEnv.META_API_KEY, scopedEnv.MODEL_API_KEY, scopedEnv.DEMO_ACCESS_CODE].filter(Boolean);
  let runOrdinal = 0;
  const runner = runnerFactory({ env: scopedEnv, outputRoot: resolve(cwd, 'out'), budgetCheckpointPath: resolve(cwd, paths.checkpointPath), dailyCapUsd: budget.configuredDailyCapUsd, taskBudgetUsd: 1 });
  const reportingRunner = async options => {
    if (existsSync(reportPath)) throw new Error('Fresh recording report already exists; refusing to overwrite it.');
    mkdirSync(join(cwd, 'out', 'recordings'), { recursive: true });
    const planDescriptor = openSync(reportPath, 'wx');
    try {
      writeFileSync(planDescriptor, `${JSON.stringify({ type: 'plan', createdAt: new Date().toISOString(), ...plan, providerCallsWillOccur: true })}\n`);
      fsyncSync(planDescriptor);
    } finally { closeSync(planDescriptor); }
    const startTime = performance.now();
    let runError = null, result;
    try {
      result = await runner({ ...options, onStep(event) {
        options.onStep?.(event);
        appendJsonLine(reportPath, { type: 'event', event }, secrets);
      } });
      return result;
    } catch (error) {
      runError = error?.message ?? String(error);
      throw error;
    } finally {
      runOrdinal++;
      appendJsonLine(reportPath, {
        type: 'complete', completedAt: new Date().toISOString(), prompt: RECORDING_PROMPT,
        runOrdinal, topLevelRunAttempts: 1,
        status: runError ? 'failed' : result?.branch?.status ?? 'unknown',
        latencyMs: Math.max(0, Math.round(performance.now() - startTime)),
        metaCostUsd: Number.isFinite(result?.costUsd) ? result.costUsd : null,
        costBasis: 'Shared-client spend ledger entries; estimates are not provider invoices.',
        threeD: { called: false, costUsd: null },
        freshEvidence: result?.freshEvidence ?? result?.branch?.evidence ?? null,
        runId: result?.runId ?? null,
        error: runError,
        artifactsDirectory: result?.directory ?? null,
        trace: result?.trace ?? null,
      }, secrets);
    }
  };
  reportingRunner.enforcesDailyCap = runner.enforcesDailyCap === true;
  const singleRun = createSingleRunGuard(reportingRunner);
  const server = createDemoServer({ env: scopedEnv, runsDir: resolve(cwd, 'demo', 'runs'), liveRunsDir: resolve(cwd, 'out'), webDir: resolve(cwd, 'web'), runPipeline: singleRun });
  await new Promise((resolveListen, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolveListen);
  });
  const address = server.address();
  return { server, url: `http://127.0.0.1:${address.port}`, reportPath, plan };
}

export async function runCli(argv = process.argv.slice(2), { env = process.env, cwd = process.cwd(), log = console.log, errorLog = console.error } = {}) {
  let args;
  try { args = parseArgs(argv); }
  catch (error) { errorLog(error.message); return 2; }
  if (args.initAllowance) {
    try { log(JSON.stringify(initializeRecordingAllowance({ cwd, allowanceUsd: args.allowanceUsd, attempt: args.attempt, overallCapUsd: args.overallCapUsd }), null, 2)); return 0; }
    catch (error) { errorLog(error.message); return 2; }
  }
  const paths = pathsForAttempt(args.attempt);
  const budget = inspectRecordingBudget({ cwd, env, attempt: args.attempt });
  const plan = createRecordingPlan({ args, budget, env, reportAlreadyExists: existsSync(resolve(cwd, paths.reportPath)) });
  if (args.serve && plan.readiness === 'ready') {
    try {
      const recording = await startRecordingServer({ args, budget, env, cwd });
      log(JSON.stringify({ ...recording.plan, url: recording.url, reportPath: recording.reportPath, providerCallsWillOccur: 'only after the browser sends the single approved prompt' }, null, 2));
      return new Promise(resolveResult => {
        const shutdown = () => recording.server.close(() => resolveResult(0));
        process.once('SIGINT', shutdown);
        process.once('SIGTERM', shutdown);
      });
    } catch (error) { errorLog(error.message); return 2; }
  }
  log(JSON.stringify(plan, null, 2));
  return plan.readiness === 'ready' ? 0 : 2;
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  runCli().then(code => { process.exitCode = code; }).catch(error => { console.error(error.message); process.exitCode = 1; });
}
