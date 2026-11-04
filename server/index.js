import { createServer } from 'node:http';
import { readFile, readdir, stat, realpath } from 'node:fs/promises';
import { realpathSync } from 'node:fs';
import { resolve, join, extname, basename, dirname, sep } from 'node:path';
import { timingSafeEqual } from 'node:crypto';
import { randomUUID } from 'node:crypto';
import { createHash } from 'node:crypto';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { validateVoiceWav, MAX_AUDIO_BYTES, createDemoTranscriber } from '../src/providers/metaVoice.js';
import { createContinuationStore } from '../src/demo/continuationStore.js';
import { createHistoryStore } from '../src/demo/historyStore.js';
import { createHistoryAgent } from '../src/agents/historyAgent.js';
import { createHistoryService } from '../src/demo/historyService.js';
import { createHistoryQuestionAgent, HistoryQuestionError, dateWindowFor } from '../src/demo/historyQuestion.js';
import { createHistoryMediaStore, historyEventRevision, legacyHistoryEventRevision } from '../src/demo/historyMediaStore.js';
import { createMetaClient } from '../src/lib/metaClient.js';
import { fileLedger } from '../src/lib/spendLedger.js';
import { composeGeography } from '../web/historyModel.js';
import { createEventSceneStore } from '../src/demo/eventSceneStore.js';
import { createEventCutoutStore } from '../src/demo/eventCutoutStore.js';
import { continuationFor, MAX_CONTINUATION_DEPTH } from '../src/demo/continuation.js';
import { prepareAuthoredQuestion } from '../src/demo/authoredQuestion.js';
import { keywordCheck, createTopicPolicy, createModelClassifier, categoriesFromEnv } from '../src/guardrails/topicPolicy.js';
import { geographyText } from '../web/geography.js';
import { SpendCapError } from '../src/lib/metaClient.js';
import { configuredDailyCap, configuredRateLimit, configuredSpendCap, resolveLedgerPath, validateStartupConfig } from '../src/demo/budget.js';
import { configuredExpansionLimit, createExpansionBudget } from '../src/demo/expansionBudget.js';
import { selectRunEvidence } from '../src/evidence/index.js';
import { selectFreshEvidence } from '../src/evidence/fresh.js';

const assets = new Set(['branch.json', 'trace.json', 'hero.png', 'mask.png', 'cutout.png', 'model.glb', 'model.meshopt.glb']);
const types = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.json': 'application/json; charset=utf-8', '.png': 'image/png', '.glb': 'model/gltf-binary', '.svg': 'image/svg+xml', '.ico': 'image/x-icon' };
const safeId = s => typeof s === 'string' && /^[a-zA-Z0-9][a-zA-Z0-9_-]{0,127}$/.test(s);
// History identities are opaque store keys, not run-directory names. Migrated
// events contain ':' and migrated history IDs contain encoded path components.
const validHistoryId = s => typeof s === 'string' && s.length > 0 && s.length <= 240
  && s === s.trim() && !/[\u0000-\u001f\u007f]/.test(s);
const expansionCookieId = req => /(?:^|;\s*)otherwise_session=([a-f0-9-]{36})(?:;|$)/i.exec(req.headers.cookie ?? '')?.[1] ?? null;
const TWO_D_ONLY_REASON = 'SAM 3.1 returned no mask; cutout and 3D model were not generated';

function renderMetadata(branch) {
  return branch?.renderStatus === '2d-only'
    ? { renderStatus: '2d-only', status: 'provisional', reason: TWO_D_ONLY_REASON }
    : {};
}

function budgetAllowanceMessage(error) {
  const { estimate, spent, cap } = error ?? {};
  if (![estimate, spent, cap].every(Number.isFinite)) return 'Meta generation allowance reached. The next request exceeds the remaining allowance.';
  const remaining = Math.max(0, cap - spent);
  return `Meta generation allowance reached. The next request is estimated at $${estimate.toFixed(4)}; $${remaining.toFixed(4)} remains.`;
}

function spendCapProof(error) {
  if (!(error instanceof SpendCapError) || ![error.spent, error.estimate, error.cap].every(Number.isFinite)
      || error.spent < 0 || error.estimate <= 0 || error.cap < 0 || error.estimate <= error.cap - error.spent) return null;
  return { version: 1, source: 'shared-meta-client-spend-cap', terminalDispatch: 'refused-before-dispatch', spent: error.spent, estimate: error.estimate, cap: error.cap };
}

function validSpendCapProof(proof) {
  return proof?.version === 1 && ['shared-meta-client-spend-cap', 'persisted-harness-trace-spend-cap'].includes(proof.source) && proof.terminalDispatch === 'refused-before-dispatch'
    && [proof.spent, proof.estimate, proof.cap].every(Number.isFinite) && proof.spent >= 0 && proof.estimate > 0 && proof.cap >= 0
    && proof.estimate > proof.cap - proof.spent
    && (proof.source !== 'persisted-harness-trace-spend-cap' || /^[a-f0-9]{64}$/.test(proof.traceSha256 ?? ''));
}

function canonicalJson(value) {
  if (Array.isArray(value)) return value.map(canonicalJson);
  if (value && typeof value === 'object') return Object.fromEntries(Object.keys(value).sort().map(key => [key, canonicalJson(value[key])]));
  return value;
}

export function createDemoServer({ runsDir = resolve('demo/runs'), liveRunsDir = resolve('out'), webDir = resolve('web'), evidencePath = resolve('demo/evidence/v1.json'), runPipeline, renderEventScene, segmentEventCutout, renderHistoryScene, segmentHistoryCutout, historyQuestionGenerator, transcribeAudio, runnerFactories = {}, historyService: injectedHistoryService, voiceTimeoutMs = 45_000, env = process.env, rateLimit = 5, rateWindowMs = 60_000, now = Date.now, importRunIds = [], maxContinuationDepth = MAX_CONTINUATION_DEPTH, maxConcurrentJobs = Number(env.DEMO_MAX_CONCURRENT_JOBS ?? 3), localReviewAccess = false, localHistoryAccess = false, packagedReplayRoot = resolve(fileURLToPath(new URL('../demo/replay-history/', import.meta.url))) } = {}) {
  if (!Number.isInteger(maxConcurrentJobs) || maxConcurrentJobs < 1 || maxConcurrentJobs > 8) throw new RangeError('maxConcurrentJobs must be an integer from 1 to 8');
  // Keep browser-entered Meta credentials in this server instance only. Never
  // mutate process.env or the caller's configuration object.
  const runtimeEnv = { ...env };
  const bootMetaApiKey = runtimeEnv.META_API_KEY;
  const bootModelApiKey = runtimeEnv.MODEL_API_KEY;
  const bootVoiceEnabled = runtimeEnv.DEMO_VOICE_ENABLED;
  const bootLocalReviewAccess = localReviewAccess;
  const bootLocalHistoryAccess = localHistoryAccess;
  let localMetaKeyOverrideActive = false;
  let localReviewAccessEnabled = localReviewAccess;
  let localHistoryAccessEnabled = localHistoryAccess;
  let activeJobs = 0;
  const acquireJob = () => { if (activeJobs >= maxConcurrentJobs) return false; activeJobs++; return true; };
  const releaseJob = () => { activeJobs = Math.max(0, activeJobs - 1); };
  const activeContinuationAttempts = new Set();
  let voiceBusy = false, voiceRequests = [];
  const hasMetaKey = () => ['META_API_KEY', 'MODEL_API_KEY'].some(name => typeof runtimeEnv[name] === 'string' && !!runtimeEnv[name].trim());
  const voiceEnabled = () => runtimeEnv.DEMO_VOICE_ENABLED === 'true'
    && (localReviewAccessEnabled || (typeof runtimeEnv.DEMO_ACCESS_CODE === 'string' && runtimeEnv.DEMO_ACCESS_CODE.length > 0));
  const requests = new Map();
  const expansionLimit = configuredExpansionLimit(runtimeEnv);
  const liveRoots = new Map();
  const canonicalRoot = path => {
    const target = resolve(path);
    let current = target;
    const suffix = [];
    while (true) {
      try { return resolve(realpathSync(current), ...suffix); }
      catch {
        const parent = dirname(current);
        if (parent === current) return target;
        suffix.unshift(basename(current));
        current = parent;
      }
    }
  };
  const pathKey = path => process.platform === 'win32' ? path.toLocaleLowerCase('en-US') : path;
  const isWithinRoot = (candidate, parent) => {
    const childKey = pathKey(candidate), parentKey = pathKey(parent);
    const prefix = parentKey.endsWith(sep) ? parentKey : `${parentKey}${sep}`;
    return childKey === parentKey || childKey.startsWith(prefix);
  };
  const root = resolve(webDir), runsRoot = resolve(runsDir), liveRoot = canonicalRoot(resolve(liveRunsDir));
  const packagedRoot = packagedReplayRoot ? canonicalRoot(resolve(packagedReplayRoot)) : null;
  const writableRootIsPackage = !!packagedRoot && isWithinRoot(liveRoot, packagedRoot);
  async function writableRootSharesPackage() {
    if (!packagedRoot) return false;
    return isWithinRoot(canonicalRoot(liveRoot), canonicalRoot(packagedRoot));
  }
  const expansionBudget = createExpansionBudget(expansionLimit, { filePath: writableRootIsPackage ? undefined : join(liveRoot, '.expansion-sessions.json') });
  const store = createContinuationStore(liveRoot, now);
  const historyStore = createHistoryStore(liveRoot, now);
  const historyMedia = createHistoryMediaStore(liveRoot, { now });
  function cachedHistorySuggestion(questionId, history, suggestionId) {
    const suggestion = history.suggestions?.find(item => item.id === suggestionId);
    const window = suggestion?.window;
    if (!suggestion || !Number.isSafeInteger(window?.fromYear) || !Number.isSafeInteger(window?.toYear)) return null;
    const batch = historyStore.getWindow({ questionId, historyId: history.id, window });
    const cached = batch.suggestions?.find(item => item.id === suggestionId);
    return batch.status === 'ready' && cached && historyEventRevision(cached) === historyEventRevision(suggestion) ? suggestion : null;
  }
  function mediaSubjectWithReferences(questionId, history, subject, allowLegacyRevision = false) {
    const references = {};
    const revision = historyEventRevision(subject);
    for (const kind of ['scene', 'cutout']) {
      const identity = { questionId, historyId: history.id, eventId: subject.id, revision, kind };
      const record = historyMedia.get(identity) ?? (allowLegacyRevision
        ? historyMedia.get({ ...identity, revision: legacyHistoryEventRevision(subject) }) : null);
      if (!record) continue;
      const field = kind === 'scene' ? 'sceneRef' : 'cutoutRef';
      if (record.status === 'complete') references[field] = { status: 'complete', url: `/history-media/${record.key}.png` };
      else if (subject[field]?.status !== 'complete') references[field] = { status: record.status,
        ...(record.revision === revision && ['empty', 'unknown'].includes(record.status)
          ? { retryAvailable: true, retryOf: record.key } : {}) };
    }
    return Object.keys(references).length ? { ...subject, ...references } : subject;
  }
  function historyWithMediaReferences(question) {
    return { ...question, histories: question.histories.map(history => ({ ...history,
      events: history.events.map(event => mediaSubjectWithReferences(question.id, history, event, true)),
      ...(history.suggestions ? { suggestions: history.suggestions.map(suggestion => mediaSubjectWithReferences(question.id, history, suggestion)) } : {}),
    })) };
  }
  let activeHistoryService = injectedHistoryService ?? null;
  let historyServicePromise = null;
  let historyServiceLiveMode = injectedHistoryService ? null : null;
  // The checked-in replay package is a read-only fallback. Runtime state stays
  // in liveRoot, and a live registry record always wins for a colliding ID.
  const packagedStore = packagedRoot ? createContinuationStore(packagedRoot, now) : null;
  const packagedIds = new Set();
  function savedRecord(id) { return store.get(id) ?? (packagedIds.has(id) ? packagedStore?.get(id) ?? null : null); }
  function packagedChildMatches(edge) {
    const record = safeId(edge?.runId) ? savedRecord(edge.runId) : null;
    return record?.id === edge.runId && record.status === 'complete'
      && record.completion?.runId === edge.runId && record.completion?.branch?.status === 'ok'
      && record.continuation?.parentRunId === edge.parentRunId
      && record.continuation?.parentBranchId === edge.parentBranchId
      && JSON.stringify(canonicalJson(record.continuation)) === JSON.stringify(canonicalJson(edge.continuation));
  }
  const semanticBranch = source => ({ id: source.id, title: source.title, year: source.year, summary: source.summary, place: source.place,
    ...(source.causalLink !== undefined ? { causalLink: source.causalLink } : {}), ...(source.geography !== undefined ? { geography: source.geography } : {}) });
  async function packagedRunMatches(id, branch) {
    if (!packagedIds.has(id) || !packagedRoot || !branch) return false;
    for (const candidate of [packagedRoot, runsRoot]) {
      try {
        const actualRoot = await realpath(candidate);
        const actualPath = await realpath(join(candidate, id, 'branch.json'));
        const separator = actualRoot.includes('\\') ? '\\' : '/';
        if (!actualPath.startsWith(actualRoot + separator)) continue;
        const packagedBranch = JSON.parse(await readFile(actualPath, 'utf8'));
        const semanticRun = value => ({ status: value.status, divergence: value.divergence,
          branches: (Array.isArray(value.branches) ? value.branches : []).map(semanticBranch).sort((a, b) => String(a.id).localeCompare(String(b.id))) });
        return JSON.stringify(canonicalJson(semanticRun(branch))) === JSON.stringify(canonicalJson(semanticRun(packagedBranch)));
      } catch { /* try the other known packaged source root */ }
    }
    return false;
  }
  async function savedParentRecord(parent, branchId) {
    const live = store.get(parent?.id);
    if (live) return live;
    const packaged = packagedIds.has(parent?.id) ? packagedStore?.get(parent.id) : null;
    const branch = parent?.branch?.branches?.find(item => item.id === branchId);
    return packaged && await packagedRunMatches(parent.id, parent.branch) && branch ? packaged : null;
  }
  function packageEdgeMatches(parentId, branch, edge, parentDivergence) {
    const event = edge?.continuation?.path?.at(-1);
    if (!branch || edge?.parentRunId !== parentId || edge?.parentBranchId !== branch.id || event?.runId !== parentId || event?.branchId !== branch.id
      || edge.continuation?.rootDivergence !== parentDivergence) return false;
    return JSON.stringify(canonicalJson(semanticBranch(branch))) === JSON.stringify(canonicalJson(semanticBranch({ ...event, id: event.branchId })));
  }
  function savedEdge(parentId, branchId, parent) {
    const liveEdge = store.edge(parentId, branchId);
    if (liveEdge) return liveEdge;
    const branch = parent?.branch?.branches?.find(item => item.id === branchId);
    const packagedEdge = packagedIds.has(parentId) ? packagedStore?.edge(parentId, branchId) : null;
    return packageEdgeMatches(parentId, branch, packagedEdge, parent?.divergence) && packagedChildMatches(packagedEdge) ? packagedEdge : null;
  }
  const scenes = createEventSceneStore(liveRoot);
  const cutouts = createEventCutoutStore(liveRoot);
  const activeScenes = new Set(), activeCutouts = new Set();
  function savedBudgetFailure(record, parentRunId, parentBranchId) {
    return record?.status === 'failed' && record.continuation?.parentRunId === parentRunId
      && record.continuation?.parentBranchId === parentBranchId && validSpendCapProof(record.budgetFailure);
  }
  function sameSpendCapProof(left, right) {
    return validSpendCapProof(left) && validSpendCapProof(right)
      && ['version', 'source', 'terminalDispatch', 'spent', 'estimate', 'cap', 'traceSha256'].every(key => left[key] === right[key]);
  }
  async function persistedTraceBudgetProof(record, parentRunId, parentBranchId) {
    if (record?.status !== 'failed' || record.continuation?.parentRunId !== parentRunId || record.continuation?.parentBranchId !== parentBranchId || !safeId(record.id)) return null;
    let traceText, tracePath, actualRoot;
    try {
      actualRoot = await realpath(liveRoot);
      tracePath = await realpath(join(actualRoot, record.id, 'trace.json'));
      const separator = actualRoot.includes('\\') ? '\\' : '/';
      if (!tracePath.startsWith(actualRoot + separator)) return null;
      traceText = await readFile(tracePath, 'utf8');
    } catch { return null; }
    let trace;
    try { trace = JSON.parse(traceText); } catch { return null; }
    if (!Array.isArray(trace.steps) || !trace.steps.length || JSON.stringify(canonicalJson(trace.continuation)) !== JSON.stringify(canonicalJson(record.continuation))) return null;
    const finalStep = trace.steps.at(-1);
    const match = typeof finalStep?.error === 'string' && /^Meta spend cap reached: spent \$([0-9]+(?:\.[0-9]+)?) \+ next call ~\$([0-9]+(?:\.[0-9]+)?) > cap \$([0-9]+(?:\.[0-9]+)?)$/.exec(finalStep.error);
    if (!match || !trace.steps.slice(0, -1).some(step => Number.isFinite(step?.costUsd) && step.costUsd > 0)) return null;
    const proof = { version: 1, source: 'persisted-harness-trace-spend-cap', terminalDispatch: 'refused-before-dispatch', spent: Number(match[1]), estimate: Number(match[2]), cap: Number(match[3]), traceSha256: createHash('sha256').update(traceText).digest('hex') };
    return validSpendCapProof(proof) ? proof : null;
  }
  async function budgetFailureEdge(edge, parentRunId, parentBranchId) {
    const archivedDuringRetry = edge?.status === 'in-progress' && edge.archiveReason === 'explicit-budget-retry';
    if (!edge || !safeId(edge.runId) || !['failed', 'in-progress'].includes(edge.status) || (edge.status === 'in-progress' && !archivedDuringRetry)
        || edge.parentRunId !== parentRunId || edge.parentBranchId !== parentBranchId) return null;
    const record = store.get(edge.runId);
    if (!record || record.status !== 'failed' || record.continuation?.parentRunId !== parentRunId || record.continuation?.parentBranchId !== parentBranchId) return null;
    const recordProof = record.budgetFailure;
    if (validSpendCapProof(recordProof)) {
      if (recordProof.source === 'persisted-harness-trace-spend-cap') {
        const freshProof = await persistedTraceBudgetProof(record, parentRunId, parentBranchId);
        if (!sameSpendCapProof(recordProof, freshProof)) return null;
      }
      return validSpendCapProof(edge.budgetFailure) ? sameSpendCapProof(edge.budgetFailure, recordProof) ? recordProof : null
        : edge.status === 'failed' ? recordProof : null;
    }
    if (edge.status !== 'failed') return null;
    return await persistedTraceBudgetProof(record, parentRunId, parentBranchId);
  }
  function persistBudgetFailureProof(edge, proof) {
    const record = store.get(edge.runId);
    if (record?.status !== 'failed' || record.continuation?.parentRunId !== edge.parentRunId || record.continuation?.parentBranchId !== edge.parentBranchId || !validSpendCapProof(proof)) throw new Error('Budget retry evidence changed');
    if (!sameSpendCapProof(record.budgetFailure, proof)) store.save({ ...record, budgetFailure: proof });
    if (!sameSpendCapProof(edge.budgetFailure, proof)) store.finish({ ...edge, budgetFailure: proof }, edge.status);
  }
  function hasSavedBudgetFailure(parentRunId, parentBranchId) {
    return store.list().some(record => savedBudgetFailure(record, parentRunId, parentBranchId));
  }
  async function archiveBudgetFailureEdge(edge) {
    const current = store.edge(edge.parentRunId, edge.parentBranchId);
    const proof = current && current.runId === edge.runId ? await budgetFailureEdge(current, edge.parentRunId, edge.parentBranchId) : null;
    if (!current || !proof) throw new Error('Budget retry evidence changed');
    persistBudgetFailureProof(current, proof);
    if (current.status !== 'in-progress') {
      const archival = { ...current, archiveReason: 'explicit-budget-retry', previousStatus: current.status };
      store.finish(archival, 'in-progress');
      store.releaseUndispatched({ ...archival, status: 'in-progress' });
    } else {
      store.releaseUndispatched(current);
    }
  }
  async function explicitRetryableAttempt(edge, parentRunId, parentBranchId) {
    if (!edge || !['failed', 'uncertain'].includes(edge.status) || !safeId(edge.runId)
        || edge.parentRunId !== parentRunId || edge.parentBranchId !== parentBranchId
        || activeContinuationAttempts.has(edge.runId)) return false;
    const record = store.get(edge.runId);
    if (!record || record.id !== edge.runId || !['failed', 'uncertain'].includes(record.status)
        || record.continuation?.parentRunId !== parentRunId || record.continuation?.parentBranchId !== parentBranchId) return false;
    const saved = await manifest(edge.runId);
    return saved?.branch?.status !== 'ok';
  }
  for (const record of store.list()) liveRoots.set(record.id, liveRoot);
  function localBrowserRequest(req) {
    const address = server.address();
    const bindHost = address?.address === '::1' ? '[::1]' : address?.address === '127.0.0.1' ? '127.0.0.1' : '';
    const host = address && typeof address === 'object' && bindHost ? `${bindHost}:${address.port}` : '';
    const localPeer = ['127.0.0.1', '::ffff:127.0.0.1', '::1'].includes(req.socket.remoteAddress);
    const browserOrigin = req.headers.origin;
    return !!bindHost && localPeer && req.headers.host === host
      && req.headers['sec-fetch-site'] === 'same-origin'
      && (req.method === 'GET' || req.method === 'HEAD' ? (!browserOrigin || browserOrigin === `http://${host}`) : browserOrigin === `http://${host}`);
  }
  function localBrowserAccess(req) { return localReviewAccessEnabled === true && localBrowserRequest(req); }
  function hasLocalHistoryBrowserAccess(req) {
    return localHistoryAccessEnabled === true && localBrowserRequest(req);
  }
  function historyAuthorized(req) { return authorized(req) || hasLocalHistoryBrowserAccess(req); }
  function localMetaSetupAccess(req, { allowMissingOrigin = false } = {}) {
    const address = server.address();
    const bindHost = address?.address === '::1' ? '[::1]' : address?.address === '127.0.0.1' ? '127.0.0.1' : '';
    const host = address && typeof address === 'object' && bindHost ? `${bindHost}:${address.port}` : '';
    const localPeer = ['127.0.0.1', '::ffff:127.0.0.1', '::1'].includes(req.socket.remoteAddress);
    const expectedOrigin = `http://${host}`;
    return !!bindHost && localPeer && req.headers.host === host
      && req.headers['sec-fetch-site'] === 'same-origin'
      && (req.headers.origin === expectedOrigin || (allowMissingOrigin && !req.headers.origin));
  }
  function authorized(req) {
    if (localBrowserAccess(req)) return true;
    const a = Buffer.from(typeof runtimeEnv.DEMO_ACCESS_CODE === 'string' ? runtimeEnv.DEMO_ACCESS_CODE : '');
    const b = Buffer.from(typeof req.headers['x-demo-access-code'] === 'string' ? req.headers['x-demo-access-code'] : '');
    return a.length > 0 && a.length === b.length && timingSafeEqual(a, b);
  }
  function sameOrigin(req) { return !req.headers.origin || [`http://${req.headers.host}`, `https://${req.headers.host}`].includes(req.headers.origin); }
  function recordWorldEntered(req, worldId) {
    const sessionId = expansionCookieId(req);
    if (!expansionBudget.known(sessionId) || !safeId(worldId)) return null;
    try { return historyStore.recordWorldEntered({ userId: 'demo', sessionId, worldId }); }
    catch { return null; }
  }
  let secrets = [runtimeEnv.DEMO_ACCESS_CODE, runtimeEnv.META_API_KEY, runtimeEnv.MODEL_API_KEY, runtimeEnv.CHRONOS_API_TOKEN, runtimeEnv.CHRONOS_API_BASE, runtimeEnv.CHRONOS_3D_ENDPOINT].filter(x => typeof x === 'string' && x.length > 0);
  function refreshSecrets() {
    secrets = [runtimeEnv.DEMO_ACCESS_CODE, runtimeEnv.META_API_KEY, runtimeEnv.MODEL_API_KEY, runtimeEnv.CHRONOS_API_TOKEN, runtimeEnv.CHRONOS_API_BASE, runtimeEnv.CHRONOS_3D_ENDPOINT].filter(x => typeof x === 'string' && x.length > 0);
  }
  function localMetaSetupState(req) {
    return { setupAvailable: localMetaSetupAccess(req, { allowMissingOrigin: req.method === 'GET' || req.method === 'HEAD' }), metaKeyConfigured: hasMetaKey(), metaKeyOverrideActive: localMetaKeyOverrideActive, localReviewAccess: localBrowserAccess(req), localHistoryAccess: hasLocalHistoryBrowserAccess(req) };
  }
  function restoreEnvValue(name, value) {
    if (value === undefined) delete runtimeEnv[name]; else runtimeEnv[name] = value;
  }
  async function createRunner(factoryName, options) {
    if (typeof runnerFactories[factoryName] === 'function') return runnerFactories[factoryName]({ ...options, env: runtimeEnv });
    if (factoryName === 'createDemoTranscriber') return createDemoTranscriber({ ...options, env: runtimeEnv });
    const pipeline = await import('../src/demo/pipeline.js');
    return pipeline[factoryName]({ ...options, env: runtimeEnv });
  }
  let modelContext = null;
  function invalidateHistoryModels() {
    modelContext = null;
    if (!injectedHistoryService) {
      activeHistoryService = null;
      historyServiceLiveMode = null;
      historyServicePromise = null;
    }
  }
  function getHistoryModelContext() {
    const signature = createHash('sha256').update(JSON.stringify([
      runtimeEnv.META_API_KEY ?? '', runtimeEnv.MODEL_API_KEY ?? '', runtimeEnv.META_API_BASE_URL ?? '',
      runtimeEnv.META_SPEND_CAP_USD ?? '', runtimeEnv.META_DAILY_SPEND_CAP_USD ?? '', runtimeEnv.TOPIC_POLICY_BLOCK ?? '',
      runtimeEnv.META_TEXT_MODEL_POLICY_PROMPT ?? '', runtimeEnv.META_TEXT_MODEL_POLICY_BRANCHES ?? '',
    ])).digest('hex');
    if (modelContext?.signature === signature) return modelContext;
    const spendCapUsd = configuredSpendCap({ env: runtimeEnv, outputRoot: liveRoot });
    const dailyCapUsd = configuredDailyCap({ env: runtimeEnv, spendCapUsd });
    const ledger = fileLedger(resolveLedgerPath({ env: runtimeEnv, outputRoot: liveRoot }), { requireExisting: true });
    const client = createMetaClient({ env: runtimeEnv, ledger, spendCapUsd, dailyCapUsd });
    const categories = categoriesFromEnv(runtimeEnv);
    const policy = createTopicPolicy({ categories,
      classifyPrompt: createModelClassifier(client, { model: runtimeEnv.META_TEXT_MODEL_POLICY_PROMPT || 'muse-spark-1.3', categories }),
      classifyBranches: createModelClassifier(client, { model: runtimeEnv.META_TEXT_MODEL_POLICY_BRANCHES || 'muse-spark-1.3', categories }),
    });
    modelContext = { signature, client, policy, dailyCapUsd };
    return modelContext;
  }
  async function getHistoryService() {
    if (injectedHistoryService) return injectedHistoryService;
    const liveMode = hasMetaKey();
    if (activeHistoryService && historyServiceLiveMode === liveMode) return activeHistoryService;
    if (!historyServicePromise) historyServicePromise = Promise.resolve().then(() => {
      let agent;
      if (!liveMode) {
        agent = { async suggest() { const error = new Error('Configure a Meta API key to generate history suggestions.'); error.code = 'meta_key_required'; throw error; },
          async checkRipple() { const error = new Error('Configure a Meta API key to run history checks.'); error.code = 'meta_key_required'; throw error; },
          async checkSuggestion() { const error = new Error('Configure a Meta API key to check history suggestions.'); error.code = 'meta_key_required'; throw error; } };
      } else {
        const { client, policy } = getHistoryModelContext();
        agent = createHistoryAgent({ client, policy, model: runtimeEnv.META_TEXT_MODEL_PLANNER || 'muse-wonder-1.0',
          rippleModel: runtimeEnv.META_TEXT_MODEL_POLICY_BRANCHES || 'muse-spark-1.3' });
      }
      activeHistoryService = createHistoryService({ store: historyStore, agent, perSessionWindowCap: expansionLimit, now });
      historyServiceLiveMode = liveMode;
      return activeHistoryService;
    }).finally(() => { historyServicePromise = null; });
    return historyServicePromise;
  }
  async function historyRequestBody(req, res) {
    let body = '';
    for await (const chunk of req) {
      body += chunk;
      if (Buffer.byteLength(body) > 8192) { json(res, 413, { error: 'Request too large', code: 'request_too_large' }); return null; }
    }
    try {
      const input = JSON.parse(body);
      if (!input || typeof input !== 'object' || Array.isArray(input)) throw new Error('Expected an object');
      return input;
    } catch { json(res, 400, { error: 'Invalid JSON object', code: 'invalid_json' }); return null; }
  }
  async function historyAction(res, service, method, input, actor) {
    try {
      const result = await service[method]({ ...input, ...actor });
      if (result?.question?.id && Array.isArray(result.question.histories)) {
        const projection = await migratedHistories();
        const question = projection.questions.find(item => item.id === result.question.id);
        if (question) {
          const history = result.history && question.histories.find(item => item.id === result.history.id);
          const forkedHistory = result.forkedHistory && question.histories.find(item => item.id === result.forkedHistory.id);
          const event = result.event && (history?.events.find(item => item.id === result.event.id)
            || forkedHistory?.events.find(item => item.id === result.event.id));
          result.question = question;
          if (history) result.history = history;
          if (forkedHistory) result.forkedHistory = forkedHistory;
          if (event) result.event = event;
          if (Array.isArray(result.events) && history) result.events = result.events.map(item => history.events.find(saved => saved.id === item.id) ?? item);
          const decoratedHistory = history ?? forkedHistory;
          if (result.suggestion && decoratedHistory) result.suggestion = decoratedHistory.suggestions?.find(item => item.id === result.suggestion.id) ?? result.suggestion;
          if (Array.isArray(result.suggestions) && decoratedHistory) result.suggestions = result.suggestions.map(item =>
            decoratedHistory.suggestions?.find(saved => saved.id === item.id) ?? item);
        }
      }
      return json(res, 200, result);
    }
    catch (error) {
      const status = Number.isInteger(error?.status) ? error.status : error?.name === 'SpendCapError' ? 429 : 500;
      const code = typeof error?.code === 'string' ? error.code : status === 500 ? 'history_action_failed' : 'history_action_rejected';
      return json(res, status, { error: status === 500 ? 'History action could not be completed.' : error.message, code,
        ...(Number.isSafeInteger(error?.used) ? { used: error.used } : {}), ...(Number.isSafeInteger(error?.limit) ? { limit: error.limit } : {}),
        ...(error?.conflictsWith ? { conflictsWith: error.conflictsWith } : {}), ...(error?.reason ? { reason: error.reason } : {}),
        ...(error?.suggestion ? { suggestion: clean(error.suggestion) } : {}), ...(error?.conflicts ? { conflicts: clean(error.conflicts) } : {}),
        ...(error?.retryOf ? { retryOf: error.retryOf } : {}), ...(error?.possibleCharge ? { possibleCharge: true } : {}) });
    }
  }
  async function readHistoryMediaSource(event, identity) {
    const reference = event?.sceneRef?.status === 'complete' ? event.sceneRef : event?.heroRef;
    const url = typeof reference === 'string' ? reference : reference?.url;
    const match = typeof url === 'string' && /^\/(history-media|event-scenes)\/([a-f0-9]{64})\.png$/i.exec(url);
    const runAsset = typeof url === 'string' && /^\/runs\/([A-Za-z0-9][A-Za-z0-9_-]{0,127})\/hero\.png$/.exec(url);
    if (!match && !runAsset) return null;
    try {
      let path;
      if (match) {
        const [, kind, key] = match;
        const isHistoryMedia = kind.toLowerCase() === 'history-media';
        const record = isHistoryMedia ? historyMedia.byKey(key) : scenes.byKey(key);
        if (record?.status !== 'complete' || record.key !== key) return null;
        if (isHistoryMedia && (!identity || record.kind !== 'scene' || record.questionId !== identity.questionId
            || record.historyId !== identity.historyId || record.eventId !== identity.eventId || record.revision !== identity.revision)) return null;
        path = isHistoryMedia ? historyMedia.imagePath(key) : scenes.imagePath(key);
      } else {
        const run = await manifest(runAsset[1]);
        if (!run?.assets?.includes('hero.png')) return null;
        let found;
        for (const root of [runsRoot, liveRoot]) {
          try {
            const actualRoot = await realpath(root), actual = await realpath(join(root, runAsset[1], 'hero.png'));
            if (actual.startsWith(actualRoot + (actualRoot.includes('\\') ? '\\' : '/'))) { found = actual; break; }
          } catch { /* try the other registered run root */ }
        }
        if (!found) return null;
        path = found;
      }
      const actualRoot = await realpath(liveRoot), actualPath = await realpath(path);
      if (!runAsset && !actualPath.startsWith(actualRoot + (actualRoot.includes('\\') ? '\\' : '/'))) return null;
      const image = await readFile(actualPath);
      return image.subarray(0, 8).equals(Buffer.from('89504e470d0a1a0a', 'hex')) ? image : null;
    } catch { return null; }
  }
  async function historyHeroSubject(event) {
    const reference = event?.heroRef;
    const url = typeof reference === 'string' ? reference : reference?.url;
    const match = typeof url === 'string' && /^\/runs\/([A-Za-z0-9][A-Za-z0-9_-]{0,127})\/hero\.png$/.exec(url);
    const runId = reference?.runId ?? match?.[1], branchId = reference?.branchId;
    if (!match || !safeId(runId) || !safeId(branchId) || match[1] !== runId || event.id !== `${runId}:${branchId}`) return null;
    const run = await manifest(runId);
    if (!run || run.branch?.status !== 'ok' || run.branch.hero?.branchId !== branchId || !run.assets.includes('hero.png')) return null;
    const branch = run.branch.branches?.find(item => item.id === branchId);
    if (!branch || !['year', 'title', 'summary', 'place', 'geography'].every(key =>
      JSON.stringify(canonicalJson(event[key])) === JSON.stringify(canonicalJson(branch[key])))) return null;
    const subject = run.branch.hero.subject ?? branch.subject;
    if (typeof subject !== 'string' || !subject.trim() || subject.trim().length > 160 || /[\u0000-\u001f\u007f]/.test(subject)) return null;
    return subject.trim();
  }
  function validatedHistorySubject(event) {
    const subject = event?.subject;
    return typeof subject === 'string' && /^[\p{L}\p{N}][\p{L}\p{N}\s'-]{0,159}$/u.test(subject.trim())
      ? subject.trim() : null;
  }
  function clean(value) {
    if (typeof value === 'string') return secrets.reduce((s, secret) => s.split(secret).join('[redacted]'), value);
    if (Array.isArray(value)) return value.map(clean);
    if (value && typeof value === 'object') {
      const safe = {};
      for (const [key, item] of Object.entries(value)) {
        if (/token|secret|api.?key|authorization|access.?code/i.test(key)) continue;
        if (key === 'rejected' && Array.isArray(item)) {
          safe.rejectedCount = item.length;
          safe.rejected = item.map(entry => ({
            ...(safeId(entry?.branch?.id ?? entry?.id) ? { id: entry.branch?.id ?? entry.id } : {}),
            ...(['war', 'politics', 'other', 'unverifiable'].includes(entry?.category) ? { category: entry.category } : {}),
            ...(['keyword', 'model'].includes(entry?.layer) ? { layer: entry.layer } : {}),
          }));
          continue;
        }
        safe[key] = clean(item);
      }
      return safe;
    }
    return value;
  }
  function json(res, status, data) { res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' }); res.end(JSON.stringify(clean(data))); }
  async function file(res, path, method, allowedRoot) {
    try {
      const actualRoot = await realpath(allowedRoot);
      const actualPath = await realpath(path);
      const separator = actualRoot.includes('\\') ? '\\' : '/';
      if (!actualPath.startsWith(actualRoot + separator)) throw new Error('Outside root');
      let data = await readFile(actualPath);
      if ((allowedRoot === runsRoot || allowedRoot === liveRoot || allowedRoot === packagedRoot) && extname(path) === '.json') data = Buffer.from(JSON.stringify(clean(JSON.parse(data.toString('utf8')))));
      res.writeHead(200, { 'Content-Type': types[extname(path).toLowerCase()] ?? 'application/octet-stream', 'Content-Length': data.length, 'X-Content-Type-Options': 'nosniff' });
      res.end(method === 'HEAD' ? undefined : data);
    } catch { json(res, 404, { error: 'Not found' }); }
  }
  async function listRuns() {
    let entries;
    try { entries = await readdir(runsRoot, { withFileTypes: true }); } catch { return []; }
    const result = [];
    for (const entry of entries) {
      if (!entry.isDirectory() || !safeId(entry.name)) continue;
      const item = await manifest(entry.name);
      if (item) { const { assets: _assets, assetUrls: _assetUrls, branch: _branch, continuation: _continuation, ...summary } = item; result.push(summary); }
    }
    return result.sort((a, b) => a.id.localeCompare(b.id));
  }
  async function migratedHistories(asOfYear) {
    const ids = new Set((await listRuns()).map(item => item.id));
    for (const id of packagedIds) ids.add(id);
    for (const record of store.list()) if (record.status === 'complete') ids.add(record.id);
    for (const id of liveRoots.keys()) if (savedRecord(id)?.status === 'complete') ids.add(id);
    const records = [];
    const verifiedLegacyMedia = new Map();
    for (const id of [...ids].filter(safeId).sort()) {
      const item = await manifest(id);
      if (!item || item.branch?.status !== 'ok') continue;
      const record = savedRecord(id);
      const refs = {};
      for (const branch of item.branch.branches ?? []) {
        if (!safeId(branch?.id)) continue;
        const branchRefs = {};
        const selectedHero = item.branch.hero?.branchId === branch.id;
        const ref = file => ({ status: 'complete', url: `/runs/${encodeURIComponent(id)}/${file}`, path: `${id}/${file}`, runId: id, branchId: branch.id });
        if (selectedHero && item.assets.includes('hero.png')) branchRefs.heroRef = ref('hero.png');
        if (selectedHero && item.assets.includes('cutout.png')) branchRefs.cutoutRef = ref('cutout.png');
        if (selectedHero && item.hasModel) branchRefs.modelRef = ref(item.assets.includes('model.glb') ? 'model.glb' : 'model.meshopt.glb');
        const parent = item.continuation?.path?.at(-1);
        const questionId = item.questionAttachment?.questionId ?? item.continuation?.rootRunId ?? item.rootRunId ?? id;
        const causeEventId = branch.causeEventId ?? (parent ? `${parent.runId}:${parent.branchId}` : questionId);
        const scene = scenes.get(id, branch.id);
        if (scene?.status === 'complete' && scene.runId === id && scene.branchId === branch.id
            && scene.key === scenes.keyFor(id, branch.id)) {
          let imageAvailable = false;
          try {
            const actualRoot = await realpath(liveRoot);
            const actualImage = await realpath(scenes.imagePath(scene.key));
            imageAvailable = actualImage.startsWith(actualRoot + (actualRoot.includes('\\') ? '\\' : '/'))
              && (await stat(actualImage)).isFile();
          } catch { /* a completed reservation without its image is not a usable reference */ }
          if (imageAvailable) {
            branchRefs.sceneRef = { status: 'complete', url: `/event-scenes/${scene.key}.png`, runId: id, branchId: branch.id };
          }
        }
        const cutout = cutouts.get(id, branch.id);
        if (cutout?.status === 'complete') branchRefs.cutoutRef = { status: 'complete', url: `/event-cutouts/${cutout.key}.png`, runId: id, branchId: branch.id };
        const responseRefs = {};
        if (branchRefs.sceneRef) responseRefs.sceneRef = branchRefs.sceneRef;
        if (selectedHero) {
          if (item.assets.includes('hero.png')) responseRefs.heroRef = ref('hero.png');
          if (item.assets.includes('cutout.png')) responseRefs.cutoutRef = ref('cutout.png');
          if (item.hasModel) responseRefs.modelRef = ref(item.assets.includes('model.glb') ? 'model.glb' : 'model.meshopt.glb');
        }
        if (Object.keys(responseRefs).length) {
          const source = { branch, causeEventId, refs: responseRefs };
          verifiedLegacyMedia.set(`${questionId}\u0000${id}:${branch.id}`, source);
          verifiedLegacyMedia.set(`${questionId}\u0000suggestion:${id}:${branch.id}`, source);
        }
        if (Object.keys(branchRefs).length) refs[`${id}:${branch.id}`] = branchRefs;
      }
      records.push({ runId: id, run: { ...item.branch, id, questionAttachment: record?.questionAttachment ?? item.questionAttachment,
        ...(item.continuation?.path?.length ? { continuation: item.continuation } : {}) }, assetRefsByBranch: refs });
    }
    const snapshot = historyStore.migrateLegacy(records);
    // Legacy history state can predate event media refs. Project a verified ref
    // into this response only when the saved event still matches its exact
    // source event; never replace a persisted ref or rewrite the user's event.
    const withVerifiedLegacyMedia = question => ({ ...question, histories: question.histories.map(history => ({
      ...history, events: history.events.map(event => {
        const source = verifiedLegacyMedia.get(`${question.id}\u0000${event.id}`);
        if (!source) return event;
        const matchesSource = ['year', 'title', 'summary', 'place', 'geography'].every(key =>
          JSON.stringify(canonicalJson(event[key])) === JSON.stringify(canonicalJson(source.branch[key])))
          && event.causeEventId === source.causeEventId
          && (event.scene === undefined || event.scene === source.branch.scene);
        if (!matchesSource) return event;
        const missingRefs = Object.fromEntries(Object.entries(source.refs).filter(([key]) => !event[key]));
        return Object.keys(missingRefs).length ? { ...event, ...missingRefs } : event;
      }),
    })) });
    const mediaSnapshot = { ...snapshot, questions: snapshot.questions.map(withVerifiedLegacyMedia) };
    const withWindowState = question => historyWithMediaReferences({ ...question, histories: question.histories.map(history => {
      const byWindow = new Map();
      for (const suggestion of history.suggestions ?? []) {
        const window = suggestion.window;
        if (!Number.isSafeInteger(window?.fromYear) || !Number.isSafeInteger(window?.toYear)) continue;
        const key = `${window.fromYear}:${window.toYear}`;
        const cached = byWindow.get(key) ?? { window: { fromYear: window.fromYear, toYear: window.toYear }, status: 'ready', batches: 1, suggestionCount: 0 };
        cached.suggestionCount++;
        byWindow.set(key, cached);
      }
      for (const cached of historyStore.windows(question.id, history.id)) {
        const key = `${cached.window.fromYear}:${cached.window.toYear}`;
        byWindow.set(key, { ...byWindow.get(key), ...cached,
          suggestionCount: Math.max(byWindow.get(key)?.suggestionCount ?? 0, cached.suggestionCount) });
      }
      return { ...history, suggestionWindows: [...byWindow.values()].sort((a, b) => a.window.fromYear - b.window.fromYear || a.window.toYear - b.window.toYear) };
    }) });
    if (!Number.isSafeInteger(asOfYear)) return { ...mediaSnapshot, questions: mediaSnapshot.questions.map(withWindowState) };
    return { ...mediaSnapshot, asOfYear, questions: mediaSnapshot.questions.map(question => ({ ...withWindowState(question), histories: withWindowState(question).histories.map(history => {
      const events = history.events.filter(event => event.year <= asOfYear);
      const groups = new Map();
      for (const event of events) {
        const label = event.era ?? 'Undated era';
        if (!groups.has(label)) groups.set(label, []);
        groups.get(label).push(event);
      }
      const eras = [...groups].map(([label, members]) => ({ label, fromYear: members[0].year,
        toYear: members.at(-1).year, eventIds: members.map(event => event.id) }));
      return { ...history, asOf: { year: asOfYear, events, eras, geography: composeGeography(history.events, asOfYear) } };
    }) })) };
  }
  async function runSource(id) {
    const roots = [liveRoots.get(id), packagedIds.has(id) ? packagedRoot : null, runsRoot].filter(Boolean);
    for (const candidate of [...new Set(roots)]) {
      try {
        const actualRoot = await realpath(candidate);
        const runDir = await realpath(join(candidate, id));
        const separator = actualRoot.includes('\\') ? '\\' : '/';
        if (!runDir.startsWith(actualRoot + separator)) continue;
        let branch = null;
        try {
          const branchPath = await realpath(join(runDir, 'branch.json'));
          if (branchPath.startsWith(runDir + separator)) branch = JSON.parse(await readFile(branchPath, 'utf8'));
        } catch { /* active runs can expose assets before branch completion */ }
        return { root: candidate, runDir, branch, separator };
      } catch { /* try the next registered source */ }
    }
    return null;
  }
  async function manifest(id) {
    const source = await runSource(id);
    if (!source?.branch) return null;
    const { runDir, branch, separator } = source;
    try {
        const present = [];
        for (const name of assets) {
          try {
            const path = await realpath(join(runDir, name));
            if (path.startsWith(runDir + separator) && (await stat(path)).isFile()) present.push(name);
          } catch { /* missing asset */ }
        }
        const value = x => typeof x === 'string' ? x : '';
        let provisional;
        try {
          const manifestPath = await realpath(join(runDir, 'manifest.json'));
          if (manifestPath.startsWith(runDir + separator)) {
            const metadata = JSON.parse(await readFile(manifestPath, 'utf8'));
            if (['provisional', 'simulated'].includes(metadata.status)) provisional = { status: metadata.status, reason: value(metadata.reason) };
          }
        } catch { /* optional metadata */ }
        const assetUrls = Object.fromEntries(present.map(name => [name, `/runs/${encodeURIComponent(id)}/${name}`]));
        const rendering = renderMetadata(branch);
        const liveSaved = store.get(id);
        const packagedSaved = packagedIds.has(id) && await packagedRunMatches(id, branch) ? packagedStore?.get(id) : null;
        const saved = liveSaved ?? packagedSaved;
        const liveChildren = store.children(id);
        const childrenByBranch = new Map();
        if (packagedIds.has(id)) {
          for (const child of packagedStore?.children(id) ?? []) {
            const selectedBranch = branch.branches?.find(item => item.id === child.branchId);
            const edge = packagedStore?.edge(id, child.branchId);
            if (packageEdgeMatches(id, selectedBranch, edge, branch.divergence) && packagedChildMatches(edge)) childrenByBranch.set(child.branchId, child);
          }
        }
        for (const child of liveChildren) childrenByBranch.set(child.branchId, child);
        const branchIds = new Set((Array.isArray(branch.branches) ? branch.branches : []).map(item => item?.id).filter(safeId));
        const children = [...childrenByBranch.values()].filter(child => branchIds.has(child.branchId));
        for (const child of children) {
          const edge = store.edge(id, child.branchId);
          if (await budgetFailureEdge(edge, id, child.branchId)) child.code = 'budget_exhausted';
        }
        const continuation = { rootRunId: saved?.continuation?.rootRunId ?? id, path: [], ...(saved?.continuation ?? {}), children };
        const selectedHero = Array.isArray(branch.branches) ? branch.branches.find(item => item.id === branch.hero?.branchId) : null;
        return { id, title: value(branch.hero?.title) || value(selectedHero?.title) || value(branch.title) || value(branch.divergence) || id, divergence: value(branch.divergence), ...rendering, status: provisional?.status ?? rendering.status ?? (value(branch.status) || 'unknown'), ...((provisional?.reason ?? rendering.reason) ? { reason: provisional?.reason ?? rendering.reason } : {}), hasModel: present.includes('model.glb') || present.includes('model.meshopt.glb'), assets: present, assetUrls, branch, continuation, ...(saved?.questionAttachment ? { questionAttachment: saved.questionAttachment } : {}) };
    } catch { /* selected run metadata could not be read */ }
  }
  const ready = (async () => {
    // Only discover direct, safe-ID directories in the fixed packaged fixture;
    // never scan arbitrary output roots or copy package data into writable state.
    try {
      if (packagedRoot) {
        for (const entry of await readdir(packagedRoot, { withFileTypes: true })) {
          if (entry.isDirectory() && safeId(entry.name)) packagedIds.add(entry.name);
        }
        try {
          const packaged = JSON.parse(await readFile(join(packagedRoot, 'PACKAGE.json'), 'utf8'));
          if (safeId(packaged.root?.runId)) packagedIds.add(packaged.root.runId);
        } catch { /* root metadata is optional */ }
      }
    } catch { /* packaged replay data is optional */ }
    // Never turn the checked-in replay source into a writable import target.
    if (!(await writableRootSharesPackage())) {
      // An operator may import explicitly named IDs from the configured live root only.
      for (const id of importRunIds) {
        if (!safeId(id) || store.get(id)) continue;
        liveRoots.set(id, liveRoot);
        const item = await manifest(id);
        if (!item || item.branch?.status !== 'ok') { liveRoots.delete(id); continue; }
        store.save({ id, status: 'complete', rootDivergence: item.divergence, completion: { runId: id, branch: item.branch } });
      }
    }
  })();
  const server = createServer(async (req, res) => {
    try {
      await ready;
      const url = new URL(req.url, 'http://localhost');
      const path = url.pathname;
      if (path === '/api/local-meta-key' && (req.method === 'POST' || req.method === 'DELETE')) {
        if (!localMetaSetupAccess(req)) return json(res, 403, { error: 'Local Meta key setup is unavailable.' });
        if (activeJobs > 0 || voiceBusy) return json(res, 409, { error: 'Wait for active generation to finish before changing the Meta key.' });
        if (req.method === 'POST') {
          let body = '';
          for await (const chunk of req) {
            body += chunk;
            if (Buffer.byteLength(body) > 4096) return json(res, 413, { error: 'Meta key request is too large.' });
          }
          let input;
          try { input = JSON.parse(body); } catch { return json(res, 400, { error: 'Enter a valid Meta key.' }); }
          const apiKey = typeof input?.apiKey === 'string' ? input.apiKey.trim() : '';
          if (!input || Object.keys(input).some(key => key !== 'apiKey') || !apiKey || apiKey.length > 4096
              || /[\u0000-\u001f\u007f]/.test(apiKey)) return json(res, 400, { error: 'Enter a valid Meta key.' });
          if (activeJobs > 0 || voiceBusy) return json(res, 409, { error: 'Wait for active generation to finish before changing the Meta key.' });
          const candidateEnv = { ...runtimeEnv, META_API_KEY: apiKey };
          delete candidateEnv.MODEL_API_KEY;
          if (candidateEnv.DEMO_VOICE_ENABLED === undefined || !String(candidateEnv.DEMO_VOICE_ENABLED).trim()) candidateEnv.DEMO_VOICE_ENABLED = 'true';
          try { validateStartupConfig({ env: candidateEnv, outputRoot: liveRoot }); }
          catch { return json(res, 400, { error: 'Meta key configuration could not be applied.' }); }
          restoreEnvValue('META_API_KEY', apiKey);
          delete runtimeEnv.MODEL_API_KEY;
          if (candidateEnv.DEMO_VOICE_ENABLED !== runtimeEnv.DEMO_VOICE_ENABLED) runtimeEnv.DEMO_VOICE_ENABLED = candidateEnv.DEMO_VOICE_ENABLED;
          localMetaKeyOverrideActive = true;
          localReviewAccessEnabled = true;
          invalidateHistoryModels();
          refreshSecrets();
        } else {
          restoreEnvValue('META_API_KEY', bootMetaApiKey);
          restoreEnvValue('MODEL_API_KEY', bootModelApiKey);
          restoreEnvValue('DEMO_VOICE_ENABLED', bootVoiceEnabled);
          localMetaKeyOverrideActive = false;
          localReviewAccessEnabled = bootLocalReviewAccess;
          localHistoryAccessEnabled = bootLocalHistoryAccess;
          invalidateHistoryModels();
          refreshSecrets();
        }
        return json(res, 200, localMetaSetupState(req));
      }
      if (path === '/api/history/preferences' && (req.method === 'GET' || req.method === 'PUT')) {
        if (!historyAuthorized(req) || !sameOrigin(req)) return json(res, 403, { error: 'History needs an access code.', code: 'unauthorized' });
        const sessionId = expansionCookieId(req);
        if (!expansionBudget.known(sessionId)) return json(res, 403, { error: 'A valid browser session is required.', code: 'invalid_history_session' });
        const service = await getHistoryService(), actor = { userId: 'demo', sessionId };
        if (req.method === 'GET') return json(res, 200, service.preference(actor.userId, actor.sessionId));
        if (req.headers['content-type']?.split(';', 1)[0].trim().toLowerCase() !== 'application/json') return json(res, 415, { error: 'Use a JSON request body.', code: 'unsupported_media_type' });
        const input = await historyRequestBody(req, res);
        if (!input) return;
        const preferenceKeys = Object.keys(input);
        if (preferenceKeys.some(key => !['autoSuggest', 'autoWeave'].includes(key)) || !preferenceKeys.length
            || (input.autoSuggest !== undefined && typeof input.autoSuggest !== 'boolean')
            || (input.autoWeave !== undefined && typeof input.autoWeave !== 'boolean')) {
          return json(res, 400, { error: 'Provide autoSuggest and/or autoWeave as booleans.', code: 'invalid_preference' });
        }
        try { return json(res, 200, service.setPreference({ ...actor, autoSuggest: input.autoSuggest, autoWeave: input.autoWeave })); }
        catch (error) { return json(res, Number.isInteger(error?.status) ? error.status : 400, { error: error.message, code: error.code ?? 'invalid_preference' }); }
      }
      const historyActionNames = new Map([
        ['/api/history/suggest', ['POST', 'suggest']], ['/api/history/weave', ['POST', 'weave']],
        ['/api/history/weave-batch', ['POST', 'weaveBatch']],
        ['/api/history/pending-weave/finalize', ['POST', 'finalizePendingWeave']],
        ['/api/history/pending-weave/remove', ['POST', 'removePendingWeave']],
        ['/api/history/batch-check', ['POST', 'batchCheck']],
        ['/api/history/fork', ['POST', 'fork']], ['/api/history/ripple-check', ['POST', 'rippleCheck']],
        ['/api/history/ripple-check-batch', ['POST', 'rippleCheckBatch']],
        ['/api/history/keep', ['POST', 'keepEvent']], ['/api/history/regenerate', ['POST', 'regenerateEvent']],
      ]);
      const historyActionRoute = historyActionNames.get(path);
      if (historyActionRoute && req.method === historyActionRoute[0]) {
        if (!historyAuthorized(req) || !sameOrigin(req)) return json(res, 403, { error: 'History needs an access code.', code: 'unauthorized' });
        const [method] = historyActionRoute.slice(1);
        const generationJob = !['finalizePendingWeave', 'removePendingWeave'].includes(method);
        if (generationJob && !acquireJob()) return json(res, 429, { error: 'Another generation is in progress.', code: 'busy' });
        try {
        if (req.headers['content-type']?.split(';', 1)[0].trim().toLowerCase() !== 'application/json') return json(res, 415, { error: 'Use a JSON request body.', code: 'unsupported_media_type' });
        const sessionId = expansionCookieId(req);
        if (!expansionBudget.known(sessionId)) return json(res, 403, { error: 'A valid browser session is required.', code: 'invalid_history_session' });
        const input = await historyRequestBody(req, res);
        if (!input) return;
        const actor = { userId: 'demo', sessionId };
        if (method === 'batchCheck' && Object.keys(input).some(key => !['questionId', 'historyId', 'suggestionIds', 'retryOf'].includes(key))) {
          return json(res, 400, { error: 'Unsupported batch check fields.', code: 'invalid_batch' });
        }
        if (method === 'rippleCheckBatch' && Object.keys(input).some(key => !['questionId', 'historyId', 'eventIds', 'wovenEventIds'].includes(key))) {
          return json(res, 400, { error: 'Unsupported batch ripple fields.', code: 'invalid_ripple_batch' });
        }
        if (method === 'weaveBatch' && Object.keys(input).some(key => !['questionId', 'historyId', 'planId', 'acceptedMergeIds', 'excludedSuggestionIds', 'pending'].includes(key))) {
          return json(res, 400, { error: 'A checked batch plan is required.', code: 'invalid_batch' });
        }
        if ((method === 'finalizePendingWeave' || method === 'removePendingWeave')
            && Object.keys(input).some(key => !['questionId', 'historyId', 'pendingBatchId', ...(method === 'removePendingWeave' ? ['eventId'] : [])].includes(key))) {
          return json(res, 400, { error: 'A pending batch ID is required.', code: 'invalid_pending_batch' });
        }
        if (method === 'suggest' && !hasMetaKey() && !injectedHistoryService) {
          const history = historyStore.get(input.questionId)?.histories?.find(item => item.id === input.historyId);
          const cached = history?.suggestions?.some(item => item.window?.fromYear === input.window?.fromYear && item.window?.toYear === input.window?.toYear)
            || historyStore.getWindow({ questionId: input.questionId, historyId: input.historyId, window: input.window }).status === 'ready';
          if (!cached || input.more === true) return json(res, 503, { error: 'Configure a Meta API key to generate new history suggestions.', code: 'meta_key_required' });
        }
        if (method === 'batchCheck' && !hasMetaKey() && !injectedHistoryService) {
          return json(res, 503, { error: 'Configure a Meta API key to check a batch of history suggestions.', code: 'meta_key_required' });
        }
        if ((method === 'rippleCheck' || method === 'rippleCheckBatch' || method === 'regenerateEvent') && !hasMetaKey() && !injectedHistoryService) {
          return json(res, 503, { error: 'Configure a Meta API key to run new history checks.', code: 'meta_key_required' });
        }
        const service = await getHistoryService();
        return await historyAction(res, service, method, input, actor);
        } finally { if (generationJob) releaseJob(); }
      }
      if (req.method === 'POST' && path === '/api/history/questions') {
        if (!historyAuthorized(req) || !sameOrigin(req)) return json(res, 403, { error: 'History needs an access code.', code: 'unauthorized' });
        if (req.headers['content-type']?.split(';', 1)[0].trim().toLowerCase() !== 'application/json') return json(res, 415, { error: 'Use a JSON request body.', code: 'unsupported_media_type' });
        const sessionId = expansionCookieId(req);
        if (!expansionBudget.known(sessionId)) return json(res, 403, { error: 'A valid browser session is required.', code: 'invalid_history_session' });
        if (!hasMetaKey() && typeof runnerFactories.historyQuestionGenerator !== 'function' && typeof historyQuestionGenerator !== 'function') {
          return json(res, 503, { error: 'Configure a Meta API key to create a new history.', code: 'meta_key_required' });
        }
        const input = await historyRequestBody(req, res);
        if (!input) return;
        if (Object.keys(input).some(key => !['question', 'divergenceYear', 'place', 'attachment'].includes(key))) return json(res, 400, { error: 'Unsupported question fields.', code: 'invalid_question' });
        const attachment = input.attachment;
        let parentAttachment;
        if (attachment !== undefined) {
          if (!attachment || typeof attachment !== 'object' || Array.isArray(attachment) || attachment.mode !== 'history-event'
              || Object.keys(attachment).some(key => !['mode', 'questionId', 'historyId', 'eventId'].includes(key))
              || !validHistoryId(attachment.questionId) || !validHistoryId(attachment.historyId) || !validHistoryId(attachment.eventId)) {
            return json(res, 400, { error: 'Choose a valid history event to attach this question to.', code: 'invalid_attachment' });
          }
          let parent = historyStore.get(attachment.questionId);
          if (!parent) { await migratedHistories(); parent = historyStore.get(attachment.questionId); }
          const parentHistory = parent?.histories?.find(item => item.id === attachment.historyId);
          const parentEvent = parentHistory?.events?.find(item => item.id === attachment.eventId);
          if (!parentEvent) return json(res, 404, { error: 'The selected history event is not available.', code: 'attachment_not_found' });
          const fullAsOfEvents = parentHistory.events.filter(item => item.year <= parentEvent.year).sort((a, b) => a.year - b.year);
          const parentQuestion = parent.question ?? parent.title ?? parent.id;
          const contextText = (value, maximum) => typeof value === 'string' && !!value.trim() && value.trim().length <= maximum
            && !/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(value);
          if (fullAsOfEvents.length > 256 || !contextText(parentQuestion, 1000)
              || !contextText(parentEvent.title, 240) || !contextText(parentEvent.summary, 1000)
              || !contextText(parentEvent.place?.name, 240) || !Number.isFinite(parentEvent.place?.lat)
              || !Number.isFinite(parentEvent.place?.lon)) {
            return json(res, 413, { error: 'The selected parent history context cannot be represented within the safe input limit.', code: 'parent_context_too_large' });
          }
          const asOfGeography = geographyText(composeGeography(fullAsOfEvents, parentEvent.year));
          if (asOfGeography && !contextText(asOfGeography, 2000)) {
            return json(res, 413, { error: 'The selected parent history geography is too large to include safely.', code: 'parent_context_too_large' });
          }
          const projectedEvents = [];
          for (const item of fullAsOfEvents) {
            const geography = geographyText(item.geography);
            if (!contextText(item.title, 240) || !contextText(item.summary, 1000) || !contextText(item.place?.name, 240)
                || !Number.isFinite(item.place?.lat) || !Number.isFinite(item.place?.lon)
                || (geography && !contextText(geography, 500))) {
              return json(res, 413, { error: 'The selected parent history context cannot be represented within the safe input limit.', code: 'parent_context_too_large' });
            }
            projectedEvents.push({ year: item.year, title: item.title.trim(), summary: item.summary.trim(),
              place: { name: item.place.name.trim(), lat: item.place.lat, lon: item.place.lon }, ...(geography ? { geography } : {}) });
          }
          const parentContext = { question: parentQuestion.trim(),
            asOfEvent: { year: parentEvent.year, title: parentEvent.title.trim(), summary: parentEvent.summary.trim(),
              place: { name: parentEvent.place.name.trim(), lat: parentEvent.place.lat, lon: parentEvent.place.lon } },
            events: projectedEvents, eventCount: fullAsOfEvents.length, ...(asOfGeography ? { composedGeography: asOfGeography } : {}) };
          if (Buffer.byteLength(JSON.stringify(parentContext), 'utf8') > 24_000) {
            return json(res, 413, { error: 'The selected parent history context is too large to include safely.', code: 'parent_context_too_large' });
          }
          parentAttachment = { mode: 'history-event', questionId: parent.id, historyId: parentHistory.id, eventId: parentEvent.id,
            divergenceYear: parentEvent.year, divergencePlace: parentEvent.place,
            parentContext };
        }
        if (!acquireJob()) return json(res, 429, { error: 'Another generation is in progress.', code: 'busy' });
        try {
          let generator = historyQuestionGenerator;
          if (!generator && typeof runnerFactories.historyQuestionGenerator === 'function') {
            generator = await runnerFactories.historyQuestionGenerator({ env: runtimeEnv, outputRoot: liveRoot });
          }
          if (!generator) {
            const { client, policy } = getHistoryModelContext();
            generator = createHistoryQuestionAgent({ client, policy, model: runtimeEnv.META_TEXT_MODEL_PLANNER || 'muse-wonder-1.0' });
          }
          if (typeof generator !== 'function') throw new Error('Question framing is unavailable');
          const framed = await generator({ question: input.question,
            divergenceYear: input.divergenceYear ?? parentAttachment?.divergenceYear,
            place: input.place ?? parentAttachment?.divergencePlace,
            parentContext: parentAttachment?.parentContext });
          const { dateWindow: _dateWindow, ...question } = framed ?? {};
          const [initialHistory] = question.histories ?? [];
          if (!safeId(question.id) || typeof question.question !== 'string' || !question.question.trim()
              || typeof question.title !== 'string' || !question.title.trim() || !Number.isSafeInteger(question.divergenceYear)
              || question.divergenceYear === 0 || question.divergenceYear < -100_000 || question.divergenceYear > 3000
              || !question.divergencePlace || typeof question.divergencePlace.name !== 'string' || !question.divergencePlace.name.trim()
              || !Number.isFinite(question.divergencePlace.lat) || question.divergencePlace.lat < -90 || question.divergencePlace.lat > 90
              || !Number.isFinite(question.divergencePlace.lon) || question.divergencePlace.lon < -180 || question.divergencePlace.lon > 180
              || question.origin?.kind !== 'user-written' || question.histories?.length !== 1
              || !safeId(initialHistory?.id) || !Array.isArray(initialHistory.events) || initialHistory.events.length !== 0) {
            return json(res, 503, { error: 'Question framing returned an invalid history.', code: 'invalid_frame' });
          }
          const activeWindow = dateWindowFor(question.divergenceYear);
          const savedQuestion = historyStore.save({ ...question, ...(parentAttachment ? { questionAttachment: parentAttachment } : {}) });
          historyStore.recordUsage({ userId: 'demo', sessionId, kind: 'histories' });
          const history = savedQuestion.histories[0];
          const autoSuggest = historyStore.getPreference('demo', sessionId).autoSuggest;
          if (!res.destroyed) return json(res, 201, { question: savedQuestion, history, divergenceYear: savedQuestion.divergenceYear,
            dateWindow: activeWindow, autoSuggest });
        } catch (error) {
          const budgetExhausted = error instanceof SpendCapError;
          const status = Number.isInteger(error?.status) ? error.status : budgetExhausted ? 429 : 503;
          const code = budgetExhausted ? 'budget_exhausted' : typeof error?.code === 'string' ? error.code : 'question_creation_failed';
          const safeError = error instanceof HistoryQuestionError ? error.message
            : status >= 500 ? 'Question could not be created. No history was saved.' : error.message;
          if (!res.destroyed) json(res, status, { error: budgetExhausted ? budgetAllowanceMessage(error) : safeError, code,
            ...(error?.category ? { category: error.category } : {}) });
        } finally { releaseJob(); }
        return;
      }
      if (req.method === 'GET' && path === '/api/history') {
        if (!historyAuthorized(req) || !sameOrigin(req)) return json(res, 403, { error: 'History needs an access code.' });
        const records = new Map(store.list().map(record => [record.id, record]));
        for (const record of packagedStore?.list() ?? []) if (packagedIds.has(record.id) && !records.has(record.id)) records.set(record.id, record);
        const runs = [];
        for (const record of records.values()) {
          if (record.status !== 'complete') continue;
          const item = await manifest(record.id);
          if (item) runs.push({ id: item.id, title: item.title, divergence: record.rootDivergence ?? item.divergence, ...(record.continuation ? { parentRunId: record.continuation.parentRunId, parentBranchId: record.continuation.parentBranchId } : {}), ...(record.questionAttachment ? { questionAttachment: record.questionAttachment } : {}), updatedAt: record.updatedAt });
        }
        return json(res, 200, { runs: runs.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)) });
      }
      if (req.method === 'GET' && path === '/api/histories') {
        if (!historyAuthorized(req) || !sameOrigin(req)) return json(res, 403, { error: 'Histories need an access code.' });
        const rawYear = url.searchParams.get('asOfYear');
        const asOfYear = rawYear === null ? undefined : /^-?\d+$/.test(rawYear) ? Number(rawYear) : NaN;
        if (asOfYear !== undefined && (!Number.isSafeInteger(asOfYear) || asOfYear === 0)) return json(res, 400, { error: 'asOfYear must be a nonzero integer.' });
        return json(res, 200, await migratedHistories(asOfYear));
      }
      if ((req.method === 'GET' || req.method === 'HEAD') && path.startsWith('/history-media/')) {
        const match = /^\/history-media\/([a-f0-9]{64})\.png$/i.exec(path);
        const record = match && historyMedia.byKey(match[1]);
        if (!record || record.status !== 'complete' || record.key !== match[1]) return json(res, 404, { error: 'Not found' });
        return file(res, historyMedia.imagePath(match[1]), req.method, liveRoot);
      }
      if (req.method === 'POST' && (path === '/api/history/scene' || path === '/api/history/cutout')) {
        if (!historyAuthorized(req) || !sameOrigin(req)) return json(res, 403, { error: 'History media needs an access code.', code: 'unauthorized' });
        if (req.headers['content-type']?.split(';', 1)[0].trim().toLowerCase() !== 'application/json') return json(res, 415, { error: 'Use a JSON request body.', code: 'unsupported_media_type' });
        const sessionId = expansionCookieId(req);
        if (!expansionBudget.known(sessionId)) return json(res, 403, { error: 'A valid browser session is required.', code: 'invalid_history_session' });
        const input = await historyRequestBody(req, res);
        if (!input) return;
        if (Object.keys(input).some(key => !['questionId', 'historyId', 'eventId', 'retryOf'].includes(key))
            || !validHistoryId(input.questionId) || !validHistoryId(input.historyId) || !validHistoryId(input.eventId)) {
          return json(res, 400, { error: 'Choose a valid history event.', code: 'invalid_history_event' });
        }
        if (input.retryOf !== undefined && (typeof input.retryOf !== 'string' || !/^[a-f0-9]{64}$/i.test(input.retryOf))) {
          return json(res, 400, { error: 'Choose a valid prior media attempt.', code: 'invalid_retry' });
        }
        const question = historyStore.get(input.questionId);
        const history = question?.histories?.find(item => item.id === input.historyId);
        const savedEvent = history?.events?.find(item => item.id === input.eventId);
        const event = savedEvent ?? (history ? cachedHistorySuggestion(question.id, history, input.eventId) : null);
        if (!event) return json(res, 404, { error: 'Saved history subject not found.', code: 'not_found' });
        const kind = path.endsWith('/scene') ? 'scene' : 'cutout';
        const field = kind === 'scene' ? 'sceneRef' : 'cutoutRef';
        const revision = historyEventRevision(event);
        const identity = { questionId: question.id, historyId: history.id, eventId: event.id, revision, kind };
        const existing = historyMedia.get(identity) ?? (savedEvent
          ? historyMedia.get({ ...identity, revision: legacyHistoryEventRevision(event) }) : null);
        const retryRequested = input.retryOf !== undefined;
        const retryRecord = retryRequested ? historyMedia.byKey(input.retryOf) : null;
        if (retryRequested) {
          const matchesIdentity = retryRecord && retryRecord.questionId === identity.questionId
            && retryRecord.historyId === identity.historyId && retryRecord.eventId === identity.eventId
            && retryRecord.revision === identity.revision && retryRecord.kind === identity.kind;
          if (!matchesIdentity || !['unknown', 'empty'].includes(retryRecord.status)
              || !(existing?.key === input.retryOf || existing?.retryOf === input.retryOf)) {
            return json(res, 409, { status: 'retry_rejected', error: 'This saved media attempt cannot be retried for the current event.', code: 'retry_not_available' });
          }
        }
        if (existing?.status === 'complete') return json(res, 200, { status: 'complete', url: `/history-media/${existing.key}.png`, reused: true });
        if (existing?.status === 'empty' && !retryRequested) return json(res, 200, { status: 'empty', reused: true, retryAvailable: existing.revision === revision, retryOf: existing.revision === revision ? existing.key : undefined });
        if (existing?.status === 'pending') return json(res, 202, { status: 'pending' });
        if (existing?.status === 'unknown' && !retryRequested) return json(res, 200, { status: 'unknown', retryAvailable: existing.revision === revision, retryOf: existing.revision === revision ? existing.key : undefined });
        const priorReference = event[field];
        if (priorReference?.status === 'complete' && typeof priorReference.url === 'string') {
          const historyRef = /^\/history-media\/([a-f0-9]{64})\.png$/i.exec(priorReference.url);
          const legacyRef = /^\/(?:event-scenes|event-cutouts)\/[a-f0-9]{64}\.png$/i.test(priorReference.url);
          const record = historyRef && historyMedia.byKey(historyRef[1]);
          if ((record?.status === 'complete' && [revision, legacyHistoryEventRevision(event)].includes(record.revision) && record.kind === kind
              && record.questionId === question.id && record.historyId === history.id && record.eventId === event.id) || legacyRef) {
            return json(res, 200, { status: 'complete', url: priorReference.url, reused: true });
          }
        }
        if (!hasMetaKey() && !renderHistoryScene && !segmentHistoryCutout) return json(res, 503, { error: 'Configure a Meta API key to generate new history media.', code: 'meta_key_required' });
        let image, promptEvent = event;
        if (kind === 'cutout') {
          image = await readHistoryMediaSource(event, identity);
          // Legacy runs expose a checked hero through the history migration
          // projection, while the durable history event itself may still have
          // no media refs. Resolve that projection by the complete saved
          // identity and content before using its canonical local asset URL.
          if (!image || !event.heroRef) {
            const projected = await migratedHistories();
            const projectedHistory = projected.questions.find(item => item.id === question.id)?.histories
              ?.find(item => item.id === history.id);
            const projectedSubject = projectedHistory?.events.find(item => item.id === event.id)
              ?? projectedHistory?.suggestions?.find(item => item.id === event.id);
            if (projectedSubject && historyEventRevision(projectedSubject) === revision) {
              promptEvent = projectedSubject;
              if (!image) image = await readHistoryMediaSource(projectedSubject, identity);
            }
          }
          if (!image) return json(res, 200, { status: 'missing-image', code: 'scene_required', prerequisite: 'scene' });
        }
        const historyText = [question.question, question.title, ...history.events.map(item => `${item.year}: ${item.title}. ${item.summary}. ${geographyText(item.geography)}`)].filter(Boolean).join('\n');
        const prompt = kind === 'scene'
          ? `Create a realistic visual illustration of this alternate-history event, without text or labels. Event: ${event.title} (${event.year}), ${event.place?.name ?? ''}. ${event.summary}. Full history context:\n${historyText}`
          : validatedHistorySubject(promptEvent) ?? await historyHeroSubject(promptEvent) ?? event.title;
        const promptLimit = kind === 'scene' ? 12_000 : 1_000;
        if (Buffer.byteLength(prompt, 'utf8') > promptLimit) {
          return json(res, 413, { error: 'The full history context is too large to send safely for media generation.', code: 'media_context_too_large' });
        }
        if (!keywordCheck(prompt).allowed) return json(res, 400, { error: 'This event cannot pass the topic policy.', code: 'topic_blocked' });
        let dailyCapUsd;
        try { dailyCapUsd = configuredDailyCap({ env: runtimeEnv, outputRoot: liveRoot }); } catch { dailyCapUsd = NaN; }
        if (!Number.isFinite(dailyCapUsd) || dailyCapUsd <= 0) return json(res, 503, { error: 'History media generation is unavailable.', code: 'media_unavailable' });
        let runner;
        try {
          if (kind === 'scene') runner = renderHistoryScene ?? await createRunner('createDemoEventSceneRunner', { dailyCapUsd, outputRoot: liveRoot });
          else runner = segmentHistoryCutout ?? await createRunner('createDemoEventCutoutRunner', { dailyCapUsd, outputRoot: liveRoot });
        } catch { return json(res, 503, { error: 'History media generation is unavailable.', code: 'media_unavailable' }); }
        if (typeof runner !== 'function' || runner.enforcesDailyCap !== true) return json(res, 503, { error: 'History media generation is unavailable.', code: 'media_unavailable' });
        const worldId = createHash('sha256').update(JSON.stringify([question.id, history.id, event.id])).digest('hex');
        const allowance = expansionBudget.reserve(sessionId, worldId);
        if (!allowance.allowed) return json(res, 429, { error: 'This browser session has reached its saved-world limit.', code: 'world_limit', used: allowance.used, limit: allowance.limit });
        let reservation, dispatched = false, acquired = false;
        try {
          const reserved = retryRequested ? historyMedia.reserveRetry(identity, input.retryOf) : historyMedia.reserve(identity);
          if (reserved.status !== 'reserved') {
            if (reserved.status === 'complete') return json(res, 200, { status: 'complete', url: `/history-media/${reserved.record.key}.png`, reused: true });
            if (reserved.status === 'empty') return json(res, 200, { status: 'empty', reused: true, retryAvailable: true, retryOf: reserved.record.key });
            if (reserved.status === 'pending') return json(res, 202, { status: 'pending' });
            if (reserved.status === 'not-retryable') return json(res, 409, { status: 'retry_rejected', code: 'retry_not_available' });
            return json(res, 200, { status: 'unknown', retryAvailable: !!reserved.record && reserved.record.revision === revision,
              retryOf: reserved.record?.revision === revision ? reserved.record.key : undefined });
          }
          reservation = reserved.record;
          if (!acquireJob()) {
            historyMedia.releaseUndispatched(reservation);
            reservation = null;
            return json(res, 429, { status: 'retryable', error: 'Another generation is in progress.', code: 'busy' });
          }
          acquired = true;
          const ip = req.socket.remoteAddress ?? 'unknown';
          const startedAt = now();
          const previous = (requests.get(ip) ?? []).filter(value => startedAt - value < rateWindowMs);
          if (previous.length >= rateLimit) {
            historyMedia.releaseUndispatched(reservation);
            reservation = null;
            return json(res, 429, { status: 'retryable', error: 'Please try again shortly.', code: 'rate_limited' });
          }
          previous.push(startedAt);
          requests.set(ip, previous);
          dispatched = true;
          const result = kind === 'scene' ? await runner({ prompt }) : await runner({ image, prompt });
          if (kind === 'cutout' && result?.status === 'empty') {
            historyMedia.finish(reservation, 'empty');
            return json(res, 200, { status: 'empty', reused: false, retryAvailable: true, retryOf: reservation.key });
          }
          if (!Buffer.isBuffer(result?.buffer) || result.mime !== 'image/png' || result.buffer.length < 8
              || !result.buffer.subarray(0, 8).equals(Buffer.from('89504e470d0a1a0a', 'hex'))) throw new Error('Invalid history media image');
          historyMedia.complete(reservation, result.buffer);
          const latestQuestion = historyStore.get(question.id);
          const latestHistory = latestQuestion?.histories?.find(item => item.id === history.id);
          const latestEvent = latestHistory?.events?.find(item => item.id === event.id);
          const latestSuggestion = latestHistory ? cachedHistorySuggestion(question.id, latestHistory, event.id) : null;
          const latestSubject = latestEvent ?? latestSuggestion;
          let attached = false;
          if (latestSubject && historyEventRevision(latestSubject) === revision) {
            const url = `/history-media/${reservation.key}.png`;
            const ref = { status: 'complete', url };
            historyStore.save({ ...latestQuestion, histories: latestQuestion.histories.map(item => item.id === history.id
              ? {
                ...item,
                events: latestEvent ? item.events.map(saved => saved.id === event.id ? { ...saved, [field]: ref } : saved) : item.events,
                suggestions: latestSuggestion ? item.suggestions.map(saved => saved.id === event.id ? { ...saved, [field]: ref } : saved) : item.suggestions,
              } : item) });
            attached = true;
          }
          historyStore.recordWorldEntered({ userId: 'demo', sessionId, worldId });
          return json(res, 200, { status: 'complete', url: `/history-media/${reservation.key}.png`, reused: false, attached });
        } catch (error) {
          const budgetExhausted = error instanceof SpendCapError && error.continuationRetryable === true;
          const retryable = !!reservation && !dispatched || budgetExhausted;
          if (reservation && retryable) { try { historyMedia.releaseUndispatched(reservation); } catch { historyMedia.finish(reservation, 'unknown'); } }
          else if (reservation) historyMedia.finish(reservation, 'unknown');
          return json(res, 503, { status: retryable ? 'retryable' : 'unknown', code: budgetExhausted ? 'budget_exhausted' : 'media_generation_failed',
            error: budgetExhausted ? budgetAllowanceMessage(error) : 'History media generation could not be confirmed.',
            ...(!retryable && reservation?.revision === revision ? { retryAvailable: true, retryOf: reservation.key } : {}) });
        } finally { if (acquired) releaseJob(); }
      }
      if ((req.method === 'GET' || req.method === 'HEAD') && path === '/health') {
        const cookieId = expansionCookieId(req);
        const sessionId = expansionBudget.known(cookieId) ? cookieId : expansionBudget.issue();
        res.setHeader('Content-Type', 'application/json; charset=utf-8');
        res.setHeader('Cache-Control', 'no-store');
        res.setHeader('X-Content-Type-Options', 'nosniff');
        if (!expansionBudget.known(cookieId)) res.setHeader('Set-Cookie', `otherwise_session=${sessionId}; Path=/; HttpOnly; SameSite=Strict`);
        res.writeHead(200);
        return res.end(req.method === 'HEAD' ? undefined : JSON.stringify({ status: 'ok', ...localMetaSetupState(req), voiceEnabled: voiceEnabled(), expansionLimit, expansionUsed: expansionBudget.usage(sessionId) }));
      }
      if ((req.method === 'GET' || req.method === 'HEAD') && path === '/runs') return json(res, 200, { runs: await listRuns() });
      if ((req.method === 'GET' || req.method === 'HEAD') && path.startsWith('/event-scenes/')) {
        const match = /^\/event-scenes\/([a-f0-9]{64})\.png$/.exec(path);
        const record = match && scenes.byKey(match[1]);
        if (!record || record.status !== 'complete' || !safeId(record.runId) || !safeId(record.branchId) || scenes.keyFor(record.runId, record.branchId) !== match[1]) return json(res, 404, { error: 'Not found' });
        const item = await manifest(record.runId);
        if (!item?.branch?.branches?.some(branch => branch.id === record.branchId)) return json(res, 404, { error: 'Not found' });
        return file(res, scenes.imagePath(match[1]), req.method, liveRoot);
      }
      if ((req.method === 'GET' || req.method === 'HEAD') && path.startsWith('/event-cutouts/')) {
        const match = /^\/event-cutouts\/([a-f0-9]{64})\.png$/.exec(path);
        const record = match && cutouts.byKey(match[1]);
        if (!record || record.status !== 'complete' || !safeId(record.runId) || !safeId(record.branchId) || cutouts.keyFor(record.runId, record.branchId) !== match[1]) return json(res, 404, { error: 'Not found' });
        const item = await manifest(record.runId);
        if (!item?.branch?.branches?.some(branch => branch.id === record.branchId)) return json(res, 404, { error: 'Not found' });
        return file(res, cutouts.imagePath(match[1]), req.method, liveRoot);
      }
      if ((req.method === 'GET' || req.method === 'POST') && path === '/api/event-cutout') {
        if (!sameOrigin(req) || (req.method === 'POST' && !authorized(req))) return json(res, 403, { error: 'Cutout generation is unavailable.' });
        let input;
        if (req.method === 'GET') input = Object.fromEntries(url.searchParams);
        else {
          let body = '';
          for await (const chunk of req) { body += chunk; if (Buffer.byteLength(body) > 8192) return json(res, 413, { error: 'Request too large' }); }
          try { input = JSON.parse(body); } catch { return json(res, 400, { error: 'Invalid JSON' }); }
        }
        if (!input || Object.keys(input).some(key => !['runId', 'branchId'].includes(key)) || !safeId(input.runId) || !safeId(input.branchId)) return json(res, 400, { error: 'Choose a valid saved event.' });
        const item = await manifest(input.runId);
        const branch = item?.branch?.branches?.find(entry => entry.id === input.branchId);
        if (!branch) return json(res, 404, { error: 'Event not found.' });
        let context;
        try { context = continuationFor(item, input.branchId, await savedParentRecord(item, input.branchId), 100); }
        catch { return json(res, 400, { error: 'This saved event cannot be segmented.' }); }
        const policyInput = [branch.title, branch.summary, branch.scene, branch.place?.name, context.rootDivergence, ...context.path.map(event => `${event.title}. ${event.summary}. ${geographyText(event.geography)}`)].filter(value => typeof value === 'string').join('\n');
        if (!keywordCheck(policyInput).allowed) return json(res, 400, { error: 'This saved event cannot pass the topic policy.' });
        const prompt = (typeof branch.scene === 'string' && branch.scene.trim() ? branch.scene : branch.title).slice(0, 1000);
        if (!prompt || !keywordCheck(prompt).allowed) return json(res, 400, { error: 'This saved event cannot pass the topic policy.' });
        if (item.branch.hero?.branchId === input.branchId && item.assetUrls['cutout.png']) return json(res, 200, { status: 'complete', url: item.assetUrls['cutout.png'], reused: true });
        const existing = cutouts.get(input.runId, input.branchId);
        if (existing) {
          if (existing.status === 'complete') return json(res, 200, { status: 'complete', url: `/event-cutouts/${cutouts.keyFor(input.runId, input.branchId)}.png`, reused: true });
          return json(res, 200, { status: existing.status === 'in-progress' && !activeCutouts.has(cutouts.keyFor(input.runId, input.branchId)) ? 'uncertain' : existing.status });
        }
        const sceneRecord = scenes.get(input.runId, input.branchId);
        const hasHero = item.branch.hero?.branchId === input.branchId && item.assets.includes('hero.png');
        if (req.method === 'GET') return json(res, 200, { status: hasHero || sceneRecord?.status === 'complete' ? 'missing' : 'missing-image' });
        if (!hasHero && sceneRecord?.status !== 'complete') return json(res, 200, { status: 'missing-image' });
        if (await writableRootSharesPackage()) return json(res, 503, { error: 'Live generation is unavailable for packaged saved runs.' });
        if (!hasMetaKey() && !segmentEventCutout) return json(res, 503, { error: 'Configure a Meta API key to generate a cutout.', code: 'meta_key_required' });
        let imagePath, imageRoot;
        if (hasHero) {
          for (const candidate of [runsRoot, liveRoot]) {
            try { const actual = await realpath(candidate); const filePath = await realpath(join(candidate, input.runId, 'hero.png')); if (filePath.startsWith(actual + (actual.includes('\\') ? '\\' : '/'))) { imagePath = filePath; imageRoot = candidate; break; } } catch { /* try the other registered run root */ }
          }
        } else {
          imagePath = scenes.imagePath(scenes.keyFor(input.runId, input.branchId)); imageRoot = liveRoot;
        }
        let image;
        try {
          const actualRoot = await realpath(imageRoot);
          const actualPath = await realpath(imagePath);
          if (!actualPath.startsWith(actualRoot + (actualRoot.includes('\\') ? '\\' : '/'))) throw new Error('Outside image root');
          image = await readFile(actualPath);
        } catch { return json(res, 200, { status: 'missing-image' }); }
        const ip = req.socket.remoteAddress ?? 'unknown';
        let t = now(), previous = (requests.get(ip) ?? []).filter(n => t - n < rateWindowMs);
        if (previous.length >= rateLimit) return json(res, 429, { status: 'retryable', error: 'Please try again shortly.' });
        let dailyCapUsd;
        try { dailyCapUsd = configuredDailyCap({ env: runtimeEnv }); } catch { dailyCapUsd = NaN; }
        if (!Number.isFinite(dailyCapUsd) || dailyCapUsd <= 0) return json(res, 503, { error: 'Cutout generation is unavailable.' });
        let runner;
        try { runner = segmentEventCutout ?? await createRunner('createDemoEventCutoutRunner', { dailyCapUsd, outputRoot: liveRoot }); }
        catch { return json(res, 503, { error: 'Cutout generation is unavailable.' }); }
        if (typeof runner !== 'function' || runner.enforcesDailyCap !== true) return json(res, 503, { error: 'Cutout generation is unavailable.' });
        const latest = cutouts.get(input.runId, input.branchId);
        if (latest) return json(res, 200, { status: latest.status === 'in-progress' && !activeCutouts.has(cutouts.keyFor(input.runId, input.branchId)) ? 'uncertain' : latest.status });
        t = now(); previous = (requests.get(ip) ?? []).filter(n => t - n < rateWindowMs);
        if (previous.length >= rateLimit) return json(res, 429, { status: 'retryable', error: 'Please try again shortly.' });
        if (!acquireJob()) return json(res, 429, { status: 'retryable', error: 'Another generation is in progress.' });
        let reservation, activeKey, dispatched = false;
        try {
          reservation = cutouts.reserve(input.runId, input.branchId);
          if (!reservation) return json(res, 200, { status: cutouts.get(input.runId, input.branchId)?.status ?? 'uncertain' });
          activeKey = reservation.key;
          activeCutouts.add(activeKey);
          previous.push(t); requests.set(ip, previous);
          dispatched = true;
          const result = await runner({ image, prompt });
          if (result?.status === 'empty') {
            cutouts.finish(reservation, 'empty');
            if (!res.destroyed) json(res, 200, { status: 'empty' });
            return;
          }
          if (!Buffer.isBuffer(result?.buffer) || result.mime !== 'image/png' || result.buffer.length < 8 || !result.buffer.subarray(0, 8).equals(Buffer.from('89504e470d0a1a0a', 'hex'))) throw new Error('Invalid image');
          cutouts.complete(reservation, result.buffer);
          recordWorldEntered(req, createHash('sha256').update(JSON.stringify([input.runId, input.branchId])).digest('hex'));
          if (!res.destroyed) json(res, 200, { status: 'complete', url: `/event-cutouts/${reservation.key}.png`, reused: false });
        } catch (error) {
          const budgetExhausted = error instanceof SpendCapError && error.continuationRetryable === true;
          let retryable = !!reservation && !dispatched || budgetExhausted;
          if (reservation && retryable) { try { cutouts.releaseUndispatched(reservation); } catch { retryable = false; } }
          if (reservation && !retryable) cutouts.finish(reservation, 'uncertain');
          if (!res.destroyed) json(res, 503, { status: retryable ? (budgetExhausted ? 'retryable' : 'missing') : 'uncertain', ...(retryable && budgetExhausted ? { code: 'budget_exhausted', error: budgetAllowanceMessage(error) } : { error: retryable ? 'The cutout could not start. Please try again later.' : 'The cutout could not finish; its outcome needs review.' }) });
        } finally { if (activeKey) activeCutouts.delete(activeKey); releaseJob(); }
        return;
      }
      if ((req.method === 'GET' || req.method === 'POST') && path === '/api/event-scene') {
        if (!sameOrigin(req) || (req.method === 'POST' && !authorized(req))) return json(res, 403, { error: 'Scene generation is unavailable.' });
        let input;
        if (req.method === 'GET') input = Object.fromEntries(url.searchParams);
        else {
          let body = '';
          for await (const chunk of req) { body += chunk; if (Buffer.byteLength(body) > 8192) return json(res, 413, { error: 'Request too large' }); }
          try { input = JSON.parse(body); } catch { return json(res, 400, { error: 'Invalid JSON' }); }
        }
        if (!input || Object.keys(input).some(key => !['runId', 'branchId'].includes(key)) || !safeId(input.runId) || !safeId(input.branchId)) return json(res, 400, { error: 'Choose a valid saved event.' });
        const item = await manifest(input.runId);
        const branch = item?.branch?.branches?.find(entry => entry.id === input.branchId);
        if (!branch) return json(res, 404, { error: 'Event not found.' });
        if (item.branch.hero?.branchId === branch.id && item.assetUrls['hero.png']) return json(res, 200, { status: 'complete', url: item.assetUrls['hero.png'], reused: true });
        const existing = scenes.get(input.runId, input.branchId);
        if (existing) {
          if (existing.status === 'complete') return json(res, 200, { status: 'complete', url: `/event-scenes/${scenes.keyFor(input.runId, input.branchId)}.png`, reused: true });
          return json(res, 200, { status: existing.status === 'in-progress' && !activeScenes.has(scenes.keyFor(input.runId, input.branchId)) ? 'uncertain' : existing.status });
        }
        if (req.method === 'GET') return json(res, 200, { status: 'missing' });
        if (await writableRootSharesPackage()) return json(res, 503, { error: 'Live generation is unavailable for packaged saved runs.' });
        if (!hasMetaKey() && !renderEventScene) return json(res, 503, { error: 'Configure a Meta API key to generate a scene.', code: 'meta_key_required' });
        let context;
        try { context = continuationFor(item, input.branchId, await savedParentRecord(item, input.branchId), 100); }
        catch { return json(res, 400, { error: 'This saved event cannot be illustrated.' }); }
        const scene = typeof branch.scene === 'string' ? branch.scene.slice(0, 4000) : '';
        const pathContext = context.path.map(event => `${event.year}: ${event.title}. ${event.summary}. ${geographyText(event.geography)}`).join('\n');
        const prompt = `Create a realistic visual illustration of this speculative event, without text or labels. Event: ${branch.title} (${branch.year}), ${branch.place.name}. ${branch.summary}. ${scene}\nWorld history and hypothetical geography: ${context.rootDivergence}\n${pathContext}`;
        if (!keywordCheck(prompt).allowed) return json(res, 400, { error: 'This saved event cannot pass the topic policy.' });
        const ip = req.socket.remoteAddress ?? 'unknown';
        let t = now(), previous = (requests.get(ip) ?? []).filter(n => t - n < rateWindowMs);
        if (previous.length >= rateLimit) return json(res, 429, { status: 'retryable', error: 'Please try again shortly.' });
        let dailyCapUsd;
        try { dailyCapUsd = configuredDailyCap({ env: runtimeEnv }); } catch { dailyCapUsd = NaN; }
        if (!Number.isFinite(dailyCapUsd) || dailyCapUsd <= 0) return json(res, 503, { error: 'Scene generation is unavailable.' });
        let runner;
        try { runner = renderEventScene ?? await createRunner('createDemoEventSceneRunner', { dailyCapUsd, outputRoot: liveRoot }); }
        catch { return json(res, 503, { error: 'Scene generation is unavailable.' }); }
        if (typeof runner !== 'function' || runner.enforcesDailyCap !== true) return json(res, 503, { error: 'Scene generation is unavailable.' });
        const latest = scenes.get(input.runId, input.branchId);
        if (latest) return json(res, 200, { status: latest.status === 'in-progress' && !activeScenes.has(scenes.keyFor(input.runId, input.branchId)) ? 'uncertain' : latest.status });
        t = now(); previous = (requests.get(ip) ?? []).filter(n => t - n < rateWindowMs);
        if (previous.length >= rateLimit) return json(res, 429, { status: 'retryable', error: 'Please try again shortly.' });
        if (!acquireJob()) return json(res, 429, { status: 'retryable', error: 'Another exploration is in progress.' });
        let reservation, activeKey, dispatched = false;
        try {
          reservation = scenes.reserve(input.runId, input.branchId);
          if (!reservation) return json(res, 200, { status: scenes.get(input.runId, input.branchId)?.status ?? 'uncertain' });
          activeKey = reservation.key;
          activeScenes.add(activeKey);
          previous.push(t); requests.set(ip, previous);
          dispatched = true;
          const result = await runner({ prompt });
          if (!Buffer.isBuffer(result?.buffer) || result.mime !== 'image/png' || result.buffer.length < 8 || !result.buffer.subarray(0, 8).equals(Buffer.from('89504e470d0a1a0a', 'hex'))) throw new Error('Invalid image');
          scenes.complete(reservation, result.buffer);
          recordWorldEntered(req, createHash('sha256').update(JSON.stringify([input.runId, input.branchId])).digest('hex'));
          if (!res.destroyed) json(res, 200, { status: 'complete', url: `/event-scenes/${reservation.key}.png`, reused: false });
        } catch (error) {
          const budgetExhausted = error instanceof SpendCapError && error.continuationRetryable === true;
          let retryable = !!reservation && !dispatched || budgetExhausted;
          if (reservation && retryable) { try { scenes.releaseUndispatched(reservation); } catch { retryable = false; } }
          if (reservation && !retryable) scenes.finish(reservation, 'uncertain');
          if (!res.destroyed) json(res, 503, { status: retryable ? (budgetExhausted ? 'retryable' : 'missing') : 'uncertain', ...(retryable && budgetExhausted ? { code: 'budget_exhausted', error: budgetAllowanceMessage(error) } : { error: retryable ? 'The scene could not start. Please try again later.' : 'The scene could not finish; its outcome needs review.' }) });
        } finally { if (activeKey) activeScenes.delete(activeKey); releaseJob(); }
        return;
      }
      if ((req.method === 'GET' || req.method === 'HEAD') && path.startsWith('/runs/')) {
        const segments = path.split('/');
        if (segments.length === 4 && safeId(segments[2]) && segments[3] === 'evidence') {
          const id = segments[2];
          const saved = await manifest(id);
          let evidence = null;
          if (saved?.status === 'ok' && liveRoots.has(id)) {
            evidence = selectFreshEvidence(id, saved.branch);
          }
          // Imported saved runs can live under the writable root too. If their
          // exact branch artifact has curated evidence, serve that after fresh
          // evidence selection; selectRunEvidence binds it to the saved digest.
          if (!evidence && saved?.status === 'ok') {
            try {
              const dataset = JSON.parse(await readFile(evidencePath, 'utf8'));
              evidence = selectRunEvidence(dataset, id, saved.branch);
            } catch { /* missing, malformed, or stale notes must not be exposed */ }
          }
          return evidence ? json(res, 200, evidence) : json(res, 404, { error: 'No valid evidence is available for this run.' });
        }
        if (segments.length === 3 && safeId(segments[2])) {
          const data = await manifest(segments[2]);
          return data ? json(res, 200, data) : json(res, 404, { error: 'Not found' });
        }
        if (segments.length !== 4 || !safeId(segments[2]) || !assets.has(segments[3])) return json(res, 404, { error: 'Not found' });
        const source = await runSource(segments[2]);
        if (source) return file(res, join(source.runDir, segments[3]), req.method, source.root);
        return json(res, 404, { error: 'Not found' });
      }
      if (req.method === 'POST' && path === '/api/transcribe') {
        if (!voiceEnabled()) return json(res, 503, { error: 'Voice input is unavailable.' });
        if (!authorized(req)) return json(res, 403, { error: 'Voice input needs an access code.' });
        if (!hasMetaKey() && !transcribeAudio && typeof runnerFactories.createDemoTranscriber !== 'function') {
          return json(res, 503, { error: 'Configure a Meta API key to use voice input.', code: 'meta_key_required' });
        }
        if (req.headers.origin && req.headers.origin !== `http://${req.headers.host}` && req.headers.origin !== `https://${req.headers.host}`) return json(res, 403, { error: 'Voice input is unavailable.' });
        const t = now();
        voiceRequests = voiceRequests.filter(n => t - n < rateWindowMs);
        if (voiceBusy || voiceRequests.length >= rateLimit) return json(res, 429, { error: 'Voice input is busy. Try again later.' });
        voiceRequests.push(t);
        if (req.headers['content-type'] !== 'audio/wav') return json(res, 415, { error: 'Use a short WAV recording.' });
        if (Number(req.headers['content-length'] ?? 0) > MAX_AUDIO_BYTES) return json(res, 413, { error: 'Audio is too large. Keep it under 30 seconds.' });
        // Acquire before reading or initializing the metered client.
        voiceBusy = true;
        const controller = new AbortController();
        const timer = setTimeout(() => { controller.abort(); if (!req.complete) req.destroy(); }, voiceTimeoutMs);
        const closed = () => { if (!res.writableEnded) controller.abort(); };
        res.on('close', closed);
        let chunks = [], audio;
        try {
          const stopped = new Promise((_, reject) => controller.signal.addEventListener('abort', () => reject(new Error('Stopped')), { once: true }));
          const readAudio = () => new Promise((resolveRead, rejectRead) => {
            let length = 0;
            const cleanup = () => { req.off('data', data); req.off('end', end); req.off('error', error); controller.signal.removeEventListener('abort', abortRead); };
            const error = () => { cleanup(); rejectRead(new Error('Audio upload failed')); };
            const abortRead = () => { cleanup(); rejectRead(new Error('Stopped')); };
            const end = () => { cleanup(); resolveRead(Buffer.concat(chunks)); };
            const data = chunk => {
              length += chunk.length;
              if (length > MAX_AUDIO_BYTES) { cleanup(); req.pause(); res.setHeader('Connection', 'close'); resolveRead(null); return; }
              chunks.push(chunk);
            };
            req.on('data', data); req.on('end', end); req.on('error', error);
            controller.signal.addEventListener('abort', abortRead, { once: true });
          });
          audio = await Promise.race([readAudio(), stopped]);
          chunks = [];
          if (!audio) return json(res, 413, { error: 'Audio is too large. Keep it under 30 seconds.' });
          try { validateVoiceWav(audio); } catch { return json(res, 400, { error: 'Use a mono PCM WAV recording of at most 30 seconds.' }); }
          const runner = transcribeAudio ?? await createRunner('createDemoTranscriber', { outputRoot: liveRoot });
          if (typeof runner !== 'function' || runner.enforcesDailyCap !== true) return json(res, 503, { error: 'Voice input is unavailable.' });
          const result = await Promise.race([runner({ audio, signal: controller.signal, timeoutMs: voiceTimeoutMs }), stopped]);
          if (typeof result?.transcript !== 'string') throw new Error('Invalid transcript');
          if (!res.destroyed) json(res, 200, { transcript: result.transcript.trim().slice(0, 500) });
        } catch { if (!res.destroyed) json(res, 503, { error: 'Voice input could not finish. Please try again later.' }); }
        finally { clearTimeout(timer); res.off('close', closed); chunks = []; audio = undefined; voiceBusy = false; }
        return;
      }
      if (req.method === 'POST' && (path === '/api/run' || path === '/api/continue')) {
        const continuing = path === '/api/continue';
        if (!authorized(req) || !sameOrigin(req)) return json(res, 403, { error: 'Live generation requires local authorization or an access code.' });
        const ip = req.socket.remoteAddress ?? 'unknown';
        let t = now(), previous = (requests.get(ip) ?? []).filter(n => t - n < rateWindowMs);
        if (previous.length >= rateLimit) return json(res, 429, { status: 'retryable', error: 'Rate limit reached. Try again shortly.' });
        let body = '';
        for await (const chunk of req) { body += chunk; if (Buffer.byteLength(body) > 8192) return json(res, 413, { error: 'Request too large' }); }
        let input;
        try { input = JSON.parse(body); } catch { return json(res, 400, { error: 'Invalid JSON' }); }
        let continuation, edge, divergence, questionAttachment, activeContinuationId = null;
        const retryBudgetFailure = continuing && input?.retryBudgetFailure === true;
        const retryInterruptedAttempt = continuing && input?.retryInterruptedAttempt === true;
        if (continuing) {
          if (!input || Object.keys(input).some(key => !['runId', 'branchId', 'retryBudgetFailure', 'retryInterruptedAttempt'].includes(key)) || (input.retryBudgetFailure !== undefined && typeof input.retryBudgetFailure !== 'boolean') || (input.retryInterruptedAttempt !== undefined && typeof input.retryInterruptedAttempt !== 'boolean') || !safeId(input.runId ?? '') || !safeId(input.branchId ?? '')) return json(res, 400, { error: 'Choose a valid saved run and branch.' });
          const parent = await manifest(input.runId);
          if (!parent) return json(res, 404, { error: 'The parent run was not found.' });
          const parentSaved = await savedParentRecord(parent, input.branchId);
          try { continuation = continuationFor(parent, input.branchId, parentSaved, Math.min(MAX_CONTINUATION_DEPTH, Math.max(1, maxContinuationDepth))); }
          catch (error) { return json(res, 400, { error: error.message }); }
          divergence = continuation.rootDivergence;
          questionAttachment = parentSaved?.questionAttachment;
          edge = savedEdge(input.runId, input.branchId, parent);
          if (edge) {
            const saved = savedRecord(edge.runId);
            if (edge.status === 'complete' && saved?.status === 'complete' && await manifest(edge.runId)) {
              res.writeHead(200, { 'Content-Type': 'text/event-stream; charset=utf-8', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' });
              return res.end(`event: complete\ndata: ${JSON.stringify(clean({ ...saved.completion, continuation: saved.continuation, ...(saved.questionAttachment ? { questionAttachment: saved.questionAttachment } : {}), reused: true, step: 'complete', ...renderMetadata(saved.completion?.branch) }))}\n\n`);
            }
            const eligibleBudgetRetry = await budgetFailureEdge(edge, input.runId, input.branchId);
            const eligibleInterruptedRetry = retryInterruptedAttempt && await explicitRetryableAttempt(edge, input.runId, input.branchId);
            if ((!retryBudgetFailure || !eligibleBudgetRetry) && !eligibleInterruptedRetry) return json(res, 409, { error: eligibleBudgetRetry ? 'A previous budget-stopped continuation is preserved. Explicitly request a budget retry to continue.' : 'This continuation is active, complete, or has no safely reopenable result.', status: edge.status, ...(eligibleBudgetRetry ? { code: 'budget_exhausted' } : {}), ...(safeId(edge.runId ?? '') ? { runId: edge.runId } : {}) });
          } else if (hasSavedBudgetFailure(input.runId, input.branchId)) {
            if (!retryBudgetFailure) return json(res, 409, { error: 'A previous budget-stopped continuation is preserved. Explicitly request a budget retry to continue.', status: 'failed', code: 'budget_exhausted' });
          } else if (retryBudgetFailure || retryInterruptedAttempt) {
            return json(res, 409, { error: 'No server-recorded budget refusal authorizes this retry.', status: 'failed' });
          }
        } else {
          if (!input || Object.keys(input).some(key => !['divergence', 'attachment'].includes(key)) || typeof input?.divergence !== 'string' || !input.divergence.trim() || input.divergence.length > 2000) return json(res, 400, { error: 'A divergence is required' });
          divergence = input.divergence.trim();
          if (input.attachment !== undefined) {
            const questionId = randomUUID();
            const attachmentParent = input.attachment?.mode === 'current-world' && safeId(input.attachment.parentRunId)
              ? await manifest(input.attachment.parentRunId) : null;
            try {
              const prepared = prepareAuthoredQuestion({
                attachment: input.attachment,
                questionId,
                divergence,
                parent: attachmentParent,
                parentSaved: attachmentParent ? await savedParentRecord(attachmentParent, input.attachment.parentBranchId) : null,
                maxDepth: Math.min(MAX_CONTINUATION_DEPTH, Math.max(1, maxContinuationDepth)),
              });
              continuation = prepared.continuation;
              questionAttachment = prepared.questionAttachment;
            } catch (error) { return json(res, 400, { error: error.message }); }
          }
        }
        if (await writableRootSharesPackage()) return json(res, 503, { error: 'Live generation is unavailable for packaged saved runs.' });
        if (!hasMetaKey() && !runPipeline) return json(res, 503, { error: 'Configure a Meta API key to generate a new run.', code: 'meta_key_required' });
        if (continuing && !keywordCheck(divergence).allowed) return json(res, 400, { error: 'The saved branch cannot pass the topic policy.' });
        let dailyCapUsd;
        try { dailyCapUsd = configuredDailyCap({ env: runtimeEnv }); } catch { dailyCapUsd = NaN; }
        if (!Number.isFinite(dailyCapUsd) || dailyCapUsd <= 0) return json(res, 503, { error: 'Live generation is unavailable. Check the configured spending limits.' });
        let runner;
        try { runner = runPipeline ?? await createRunner('createDemoRunner', { dailyCapUsd, outputRoot: liveRoot }); }
        catch { return json(res, 503, { error: 'Live generation is unavailable. Check the Meta API configuration.' }); }
        if (typeof runner !== 'function' || runner.enforcesDailyCap !== true) return json(res, 503, { error: 'Live generation is unavailable. Check the Meta API configuration.' });
        if (continuing) {
          edge = store.edge(input.runId, input.branchId);
          if (edge) {
            const saved = savedRecord(edge.runId);
            if (edge.status === 'complete' && saved?.status === 'complete' && await manifest(edge.runId)) {
              res.writeHead(200, { 'Content-Type': 'text/event-stream; charset=utf-8', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' });
              return res.end(`event: complete\ndata: ${JSON.stringify(clean({ ...saved.completion, continuation: saved.continuation, ...(saved.questionAttachment ? { questionAttachment: saved.questionAttachment } : {}), reused: true, step: 'complete', ...renderMetadata(saved.completion?.branch) }))}\n\n`);
            }
            const eligibleBudgetRetry = await budgetFailureEdge(edge, input.runId, input.branchId);
            const eligibleInterruptedRetry = retryInterruptedAttempt && await explicitRetryableAttempt(edge, input.runId, input.branchId);
            if ((!retryBudgetFailure || !eligibleBudgetRetry) && !eligibleInterruptedRetry) return json(res, 409, { error: eligibleBudgetRetry ? 'A previous budget-stopped continuation is preserved. Explicitly request a budget retry to continue.' : 'This continuation is active, complete, or has no safely reopenable result.', status: edge.status, ...(eligibleBudgetRetry ? { code: 'budget_exhausted' } : {}), ...(safeId(edge.runId ?? '') ? { runId: edge.runId } : {}) });
          } else if (hasSavedBudgetFailure(input.runId, input.branchId)) {
            if (!retryBudgetFailure) return json(res, 409, { error: 'A previous budget-stopped continuation is preserved. Explicitly request a budget retry to continue.', status: 'failed', code: 'budget_exhausted' });
          } else if (retryBudgetFailure || retryInterruptedAttempt) {
            return json(res, 409, { error: 'No server-recorded budget refusal authorizes this retry.', status: 'failed' });
          }
        }
        t = now(); previous = (requests.get(ip) ?? []).filter(n => t - n < rateWindowMs);
        if (previous.length >= rateLimit) return json(res, 429, { status: 'retryable', error: 'Rate limit reached. Try again shortly.' });
        if (!acquireJob()) return json(res, 429, { status: 'retryable', error: 'A live run is already in progress. Try again shortly.' });
        let expansionUsed = null;
        try {
          if (continuing) {
            const sessionId = expansionCookieId(req);
            const reservation = expansionBudget.reserve(sessionId, `${input.runId}/${input.branchId}`);
            if (!reservation.allowed) {
              const status = reservation.reason === 'invalid' ? 400 : 429;
              return json(res, status, { error: reservation.reason === 'invalid' ? 'A valid browser session is required.' : 'This browser session reached its exploration limit.', code: reservation.reason === 'invalid' ? 'invalid_expansion_session' : 'session_expansion_limit', used: reservation.used ?? 0, limit: expansionLimit });
            }
            expansionUsed = reservation.used;
          }
          if (continuing) {
            edge = store.edge(input.runId, input.branchId);
            if (edge) {
              if (edge.status === 'complete') return json(res, 409, { error: 'This continuation already completed. Reopen its saved run.', status: 'complete' });
              const eligibleBudgetRetry = await budgetFailureEdge(edge, input.runId, input.branchId);
              const eligibleInterruptedRetry = retryInterruptedAttempt && await explicitRetryableAttempt(edge, input.runId, input.branchId);
              if ((!retryBudgetFailure || !eligibleBudgetRetry) && !eligibleInterruptedRetry) return json(res, 409, { error: eligibleBudgetRetry ? 'A previous budget-stopped continuation is preserved. Explicitly request a budget retry to continue.' : 'This continuation is active, complete, or has no safely reopenable result.', status: edge.status, ...(eligibleBudgetRetry ? { code: 'budget_exhausted' } : {}) });
              if (eligibleBudgetRetry) await archiveBudgetFailureEdge(edge);
              else store.archiveFinished(edge);
              edge = null;
            } else if (hasSavedBudgetFailure(input.runId, input.branchId)) {
              if (!retryBudgetFailure) return json(res, 409, { error: 'A previous budget-stopped continuation is preserved. Explicitly request a budget retry to continue.', status: 'failed', code: 'budget_exhausted' });
            } else if (retryBudgetFailure || retryInterruptedAttempt) {
              return json(res, 409, { error: 'No server-recorded budget refusal authorizes this retry.', status: 'failed' });
            }
            edge = store.reserve(input.runId, input.branchId, continuation);
            if (!edge) return json(res, 409, { error: 'This continuation is already reserved. Reopen its saved run.' });
            activeContinuationId = edge.runId;
            activeContinuationAttempts.add(activeContinuationId);
          }
          previous.push(t); requests.set(ip, previous);
          if (continuing) {
            if (!store.get(input.runId)) {
              const parent = await manifest(input.runId);
              const parentRecord = await savedParentRecord(parent, input.branchId);
              store.save({ id: input.runId, status: 'complete', rootDivergence: divergence, completion: { runId: input.runId, branch: clean(parent.branch) }, ...(parentRecord?.continuation ? { continuation: parentRecord.continuation } : {}), ...(parent.questionAttachment ? { questionAttachment: parent.questionAttachment } : {}) });
            }
          }
          const reservedRunId = questionAttachment?.questionId ?? edge?.runId ?? randomUUID();
          const persistedQuestionAttachment = questionAttachment ? { ...questionAttachment, questionId: reservedRunId } : undefined;
          store.save({ id: reservedRunId, status: 'in-progress', rootDivergence: divergence, ...(continuation ? { continuation } : {}), ...(persistedQuestionAttachment ? { questionAttachment: persistedQuestionAttachment } : {}) });
          res.writeHead(200, { 'Content-Type': 'text/event-stream; charset=utf-8', 'Cache-Control': 'no-store', Connection: 'keep-alive', 'X-Content-Type-Options': 'nosniff', ...(expansionUsed === null ? {} : { 'X-Expansion-Used': String(expansionUsed) }) });
          res.flushHeaders();
          const controller = new AbortController();
          res.on('close', () => { if (!res.writableEnded) controller.abort(); });
          const emit = (event, data) => { if (!res.destroyed && !res.writableEnded) res.write(`event: ${event}\ndata: ${JSON.stringify(clean(data))}\n\n`); };
          const allowed = new Set(['policy', 'evidence', 'propose', 'review', 'image', 'cutout', '3d']);
          try {
            const result = await runner({ divergence, continuation, ...(questionAttachment?.divergenceYear ? { divergenceYear: questionAttachment.divergenceYear } : {}), ...(questionAttachment?.divergencePlace ? { divergencePlace: questionAttachment.divergencePlace } : {}), runId: reservedRunId, signal: controller.signal, dailyCapUsd, onStep: event => { if (allowed.has(event?.step)) { if (safeId(event.runId ?? '')) liveRoots.set(event.runId, liveRoot); emit(event.step, event); } } });
            if (result?.runId !== reservedRunId) throw new Error('Generation did not complete under its reserved run ID');
            if (continuing && result?.branch?.status !== 'ok') throw new Error('Continuation did not complete');
            if (safeId(result?.runId ?? '')) liveRoots.set(result.runId, liveRoot);
            if (continuing && (await manifest(reservedRunId))?.branch?.status !== 'ok') throw new Error('Continuation was not saved');
            const completion = clean({ ...result, directory: undefined, ...(continuation ? { continuation } : {}), ...(questionAttachment ? { questionAttachment: persistedQuestionAttachment } : {}), reused: false });
            if (safeId(result?.runId ?? '')) store.save({ id: result.runId, status: 'complete', rootDivergence: divergence, ...(continuation ? { continuation } : {}), ...(questionAttachment ? { questionAttachment: persistedQuestionAttachment } : {}), completion });
            const generatedAssets = await manifest(reservedRunId);
            if (generatedAssets?.hasModel || generatedAssets?.assets?.includes('hero.png') || generatedAssets?.assets?.includes('cutout.png')) {
              const heroId = safeId(generatedAssets.branch?.hero?.branchId) ? generatedAssets.branch.hero.branchId : 'world';
              recordWorldEntered(req, createHash('sha256').update(JSON.stringify([reservedRunId, heroId])).digest('hex'));
            }
            if (edge) store.finish(edge, 'complete');
            emit('complete', { ...completion, ...renderMetadata(result?.branch), step: 'complete' });
          } catch (error) {
            // Only a metering refusal proven to precede every paid dispatch is
            // safe to release. Provider/network failures and disconnects keep
            // their durable reservation for review.
            let retryable = !!edge && !controller.signal.aborted && error instanceof SpendCapError && error.continuationRetryable === true;
            const budgetProof = continuing && !controller.signal.aborted ? spendCapProof(error) : null;
            const record = status => ({ id: reservedRunId, status, rootDivergence: divergence, ...(continuation ? { continuation } : {}), ...(questionAttachment ? { questionAttachment: persistedQuestionAttachment } : {}), ...(budgetProof ? { budgetFailure: budgetProof } : {}) });
            if (retryable) {
              store.save(record('retryable'));
              try { store.releaseUndispatched(edge); } catch { retryable = false; }
            }
            if (!retryable) {
              store.save(record(controller.signal.aborted ? 'uncertain' : 'failed'));
              if (edge && store.edge(edge.parentRunId, edge.parentBranchId)?.runId === edge.runId) store.finish({ ...edge, ...(budgetProof ? { budgetFailure: budgetProof } : {}) }, controller.signal.aborted ? 'uncertain' : 'failed');
            }
            const budgetFailure = !!budgetProof;
            const message = retryable
              ? `${budgetAllowanceMessage(error)} You can choose this path again later.`
              : budgetFailure
                ? `${budgetAllowanceMessage(error)} This continuation may contain partial work. Automatic retry is disabled to avoid duplicate charges.`
                : continuing
                  ? 'Exploration stopped. Enter this event to try again.'
                  : 'Live generation failed. Check server logs before trying again.';
            emit('error', { step: 'error', status: retryable ? 'retryable' : controller.signal.aborted ? 'uncertain' : 'failed', ...(budgetFailure ? { code: 'budget_exhausted' } : {}), error: message });
          }
          res.end();
        } finally { if (activeContinuationId) activeContinuationAttempts.delete(activeContinuationId); releaseJob(); }
        return;
      }
      if (req.method === 'GET' || req.method === 'HEAD') {
        let decoded;
        try { decoded = decodeURIComponent(path); } catch { return json(res, 400, { error: 'Invalid path' }); }
        const relative = decoded === '/' ? 'index.html' : decoded.slice(1);
        if (!relative || relative.includes('\\') || relative.split('/').some(s => s === '..' || s.startsWith('.'))) return json(res, 404, { error: 'Not found' });
        const target = resolve(root, relative);
        if (!target.startsWith(root + (root.includes('\\') ? '\\' : '/'))) return json(res, 404, { error: 'Not found' });
        return file(res, target, req.method, root);
      }
      json(res, 404, { error: 'Not found' });
    } catch { if (!res.headersSent) json(res, 500, { error: 'Server error' }); else res.end(); }
  });
  return server;
}

export function createConfiguredDemoServer({ env = process.env, outputRoot, host = env.HOST || '127.0.0.1', ...options } = {}) {
  const requestedOutputRoot = outputRoot ?? (typeof env.DEMO_LIVE_RUNS_DIR === 'string' && env.DEMO_LIVE_RUNS_DIR.trim() ? env.DEMO_LIVE_RUNS_DIR.trim() : undefined);
  const status = validateStartupConfig({ env, outputRoot: requestedOutputRoot ?? 'out' });
  const selectedOutputRoot = requestedOutputRoot ?? 'out';
  const normalizedHost = host === 'localhost' ? '127.0.0.1' : host;
  const isLoopback = normalizedHost === '127.0.0.1';
  const effectiveEnv = { ...env };
  let localReviewAccess = options.localReviewAccess ?? false;
  let localHistoryAccess = options.localHistoryAccess ?? false;
  if (isLoopback) {
    if (!effectiveEnv.DEMO_ACCESS_CODE?.trim()) {
      if (status.hasMetaKey) effectiveEnv.DEMO_ACCESS_CODE = randomUUID();
    }
    if (status.hasMetaKey && (effectiveEnv.DEMO_VOICE_ENABLED === undefined || String(effectiveEnv.DEMO_VOICE_ENABLED).trim() === '')) {
      effectiveEnv.DEMO_VOICE_ENABLED = 'true';
    }
    if (options.localReviewAccess === undefined && status.hasMetaKey) localReviewAccess = true;
    if (options.localHistoryAccess === undefined && options.localReviewAccess !== false && !effectiveEnv.DEMO_ACCESS_CODE?.trim()) localHistoryAccess = true;
  }
  const importRunIds = options.importRunIds ?? (env.DEMO_IMPORT_RUN_IDS ?? '').split(',').map(s => s.trim()).filter(Boolean);
  const rateLimit = options.rateLimit ?? configuredRateLimit({ env, isLoopback, hasMetaKey: status.hasMetaKey });
  const server = createDemoServer({
    liveRunsDir: resolve(selectedOutputRoot),
    ...options,
    importRunIds,
    rateLimit,
    env: effectiveEnv,
    localReviewAccess,
    localHistoryAccess,
  });
  const port = Number(env.PORT ?? 3000);
  if (!Number.isInteger(port) || port < 0 || port > 65535) throw new Error('Invalid PORT: must be an integer from 0 to 65535');
  return { server, host: normalizedHost, port, ...status, localReviewAccess, localHistoryAccess };
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  try {
    const { server, host, port, hasMetaKey, spendCapUsd, enable3d } = createConfiguredDemoServer();
    server.listen(port, host, () => {
      const boundPort = server.address()?.port ?? port;
      const status = hasMetaKey
        ? `Meta generation ready (spend ceiling $${spendCapUsd.toFixed(2)}, 3D generation ${enable3d ? 'enabled' : 'disabled'})`
        : 'saved histories ready; configure META_API_KEY in .env to generate new content';
      console.log(`Demo server listening on http://${host}:${boundPort} — ${status}`);
    });
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}
