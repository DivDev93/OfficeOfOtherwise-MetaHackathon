import { createServer } from 'node:http';
import { readFile, readdir, stat, realpath } from 'node:fs/promises';
import { resolve, join, extname } from 'node:path';
import { timingSafeEqual } from 'node:crypto';
import { randomUUID } from 'node:crypto';
import { createHash } from 'node:crypto';
import { pathToFileURL } from 'node:url';
import { validateVoiceWav, MAX_AUDIO_BYTES, createDemoTranscriber } from '../src/providers/metaVoice.js';
import { createContinuationStore } from '../src/demo/continuationStore.js';
import { createEventSceneStore } from '../src/demo/eventSceneStore.js';
import { createEventCutoutStore } from '../src/demo/eventCutoutStore.js';
import { continuationFor, MAX_CONTINUATION_DEPTH } from '../src/demo/continuation.js';
import { keywordCheck } from '../src/guardrails/topicPolicy.js';
import { geographyText } from '../web/geography.js';
import { SpendCapError } from '../src/lib/metaClient.js';
import { configuredDailyCap, configuredRateLimit, validateStartupConfig } from '../src/demo/budget.js';
import { configuredExpansionLimit, createExpansionBudget } from '../src/demo/expansionBudget.js';

const assets = new Set(['branch.json', 'trace.json', 'hero.png', 'mask.png', 'cutout.png', 'model.glb', 'model.meshopt.glb']);
const types = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.json': 'application/json; charset=utf-8', '.png': 'image/png', '.glb': 'model/gltf-binary', '.svg': 'image/svg+xml', '.ico': 'image/x-icon' };
const safeId = s => typeof s === 'string' && /^[a-zA-Z0-9][a-zA-Z0-9_-]{0,127}$/.test(s);
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

export function createDemoServer({ runsDir = resolve('demo/runs'), liveRunsDir = resolve('out'), webDir = resolve('web'), runPipeline, renderEventScene, segmentEventCutout, transcribeAudio, voiceTimeoutMs = 45_000, env = process.env, rateLimit = 5, rateWindowMs = 60_000, now = Date.now, importRunIds = [], maxContinuationDepth = MAX_CONTINUATION_DEPTH, maxConcurrentJobs = Number(env.DEMO_MAX_CONCURRENT_JOBS ?? 3), localReviewAccess = false } = {}) {
  if (!Number.isInteger(maxConcurrentJobs) || maxConcurrentJobs < 1 || maxConcurrentJobs > 8) throw new RangeError('maxConcurrentJobs must be an integer from 1 to 8');
  let activeJobs = 0;
  const acquireJob = () => { if (activeJobs >= maxConcurrentJobs) return false; activeJobs++; return true; };
  const releaseJob = () => { activeJobs = Math.max(0, activeJobs - 1); };
  let voiceBusy = false, voiceRequests = [];
  const voiceEnabled = env.DEMO_VOICE_ENABLED === 'true' && typeof env.DEMO_ACCESS_CODE === 'string' && env.DEMO_ACCESS_CODE.length > 0;
  const requests = new Map();
  const expansionLimit = configuredExpansionLimit(env);
  const liveRoots = new Map();
  const root = resolve(webDir), runsRoot = resolve(runsDir), liveRoot = resolve(liveRunsDir);
  const expansionBudget = createExpansionBudget(expansionLimit, { filePath: join(liveRoot, '.expansion-sessions.json') });
  const store = createContinuationStore(liveRoot, now);
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
  for (const record of store.list()) liveRoots.set(record.id, liveRoot);
  function localBrowserAccess(req) {
    const address = server.address();
    const host = address && typeof address === 'object' ? `127.0.0.1:${address.port}` : '';
    const localPeer = ['127.0.0.1', '::ffff:127.0.0.1'].includes(req.socket.remoteAddress);
    const browserOrigin = req.headers.origin;
    return localReviewAccess === true && address?.address === '127.0.0.1' && localPeer && req.headers.host === host
      && req.headers['sec-fetch-site'] === 'same-origin'
      && (req.method === 'GET' || req.method === 'HEAD' ? (!browserOrigin || browserOrigin === `http://${host}`) : browserOrigin === `http://${host}`);
  }
  function authorized(req) {
    if (localBrowserAccess(req)) return true;
    const a = Buffer.from(typeof env.DEMO_ACCESS_CODE === 'string' ? env.DEMO_ACCESS_CODE : '');
    const b = Buffer.from(typeof req.headers['x-demo-access-code'] === 'string' ? req.headers['x-demo-access-code'] : '');
    return a.length > 0 && a.length === b.length && timingSafeEqual(a, b);
  }
  function sameOrigin(req) { return !req.headers.origin || [`http://${req.headers.host}`, `https://${req.headers.host}`].includes(req.headers.origin); }
  const secrets = [env.DEMO_ACCESS_CODE, env.META_API_KEY, env.MODEL_API_KEY, env.CHRONOS_API_TOKEN, env.CHRONOS_API_BASE, env.CHRONOS_3D_ENDPOINT].filter(x => typeof x === 'string' && x.length > 0);
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
      if ((allowedRoot === runsRoot || allowedRoot === liveRoot) && extname(path) === '.json') data = Buffer.from(JSON.stringify(clean(JSON.parse(data.toString('utf8')))));
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
  async function manifest(id) {
    const roots = [runsRoot, liveRoots.get(id)].filter(Boolean);
    for (const candidate of roots) {
      try {
        const actualRoot = await realpath(candidate);
        const runDir = await realpath(join(candidate, id));
        const separator = actualRoot.includes('\\') ? '\\' : '/';
        if (!runDir.startsWith(actualRoot + separator)) continue;
        const branchPath = await realpath(join(runDir, 'branch.json'));
        if (!branchPath.startsWith(runDir + separator)) continue;
        const branch = JSON.parse(await readFile(branchPath, 'utf8'));
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
        const saved = store.get(id);
        const children = store.children(id);
        for (const child of children) {
          const edge = store.edge(id, child.branchId);
          if (await budgetFailureEdge(edge, id, child.branchId)) child.code = 'budget_exhausted';
        }
        const continuation = { rootRunId: saved?.continuation?.rootRunId ?? id, path: [], ...(saved?.continuation ?? {}), children };
        const selectedHero = Array.isArray(branch.branches) ? branch.branches.find(item => item.id === branch.hero?.branchId) : null;
        return { id, title: value(branch.hero?.title) || value(selectedHero?.title) || value(branch.title) || value(branch.divergence) || id, divergence: value(branch.divergence), ...rendering, status: provisional?.status ?? rendering.status ?? (value(branch.status) || 'unknown'), ...((provisional?.reason ?? rendering.reason) ? { reason: provisional?.reason ?? rendering.reason } : {}), hasModel: present.includes('model.glb') || present.includes('model.meshopt.glb'), assets: present, assetUrls, branch, continuation };
      } catch { /* no valid manifest in this root */ }
    }
    return null;
  }
  const ready = (async () => {
    // An operator may import explicitly named IDs from the configured live root only.
    for (const id of importRunIds) {
      if (!safeId(id) || store.get(id)) continue;
      liveRoots.set(id, liveRoot);
      const item = await manifest(id);
      if (!item || item.branch?.status !== 'ok') { liveRoots.delete(id); continue; }
      store.save({ id, status: 'complete', rootDivergence: item.divergence, completion: { runId: id, branch: item.branch } });
    }
  })();
  const server = createServer(async (req, res) => {
    try {
      await ready;
      const url = new URL(req.url, 'http://localhost');
      const path = url.pathname;
      if (req.method === 'GET' && path === '/api/history') {
        if (!authorized(req) || !sameOrigin(req)) return json(res, 403, { error: 'History needs an access code.' });
        const runs = [];
        for (const record of store.list()) {
          if (record.status !== 'complete') continue;
          const item = await manifest(record.id);
          if (item) runs.push({ id: item.id, title: item.title, divergence: record.rootDivergence ?? item.divergence, ...(record.continuation ? { parentRunId: record.continuation.parentRunId, parentBranchId: record.continuation.parentBranchId } : {}), updatedAt: record.updatedAt });
        }
        return json(res, 200, { runs: runs.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)) });
      }
      if ((req.method === 'GET' || req.method === 'HEAD') && path === '/health') {
        const cookieId = expansionCookieId(req);
        const sessionId = expansionBudget.known(cookieId) ? cookieId : expansionBudget.issue();
        res.setHeader('Content-Type', 'application/json; charset=utf-8');
        res.setHeader('Cache-Control', 'no-store');
        res.setHeader('X-Content-Type-Options', 'nosniff');
        if (!expansionBudget.known(cookieId)) res.setHeader('Set-Cookie', `otherwise_session=${sessionId}; Path=/; HttpOnly; SameSite=Strict`);
        res.writeHead(200);
        const replayOnly = env.DEMO_REPLAY_ONLY === 'true' || typeof env.DEMO_ACCESS_CODE !== 'string' || env.DEMO_ACCESS_CODE.length === 0;
        return res.end(req.method === 'HEAD' ? undefined : JSON.stringify({ status: 'ok', replayOnly, voiceEnabled, expansionLimit, expansionUsed: expansionBudget.usage(sessionId), ...(localBrowserAccess(req) ? { localReviewAccess: true } : {}) }));
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
        try { context = continuationFor(item, input.branchId, store.get(input.runId), 100); }
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
        if (env.DEMO_REPLAY_ONLY === 'true') return json(res, 503, { error: 'Live generation is disabled.' });
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
        try { dailyCapUsd = configuredDailyCap({ env }); } catch { dailyCapUsd = NaN; }
        if (!Number.isFinite(dailyCapUsd) || dailyCapUsd <= 0) return json(res, 503, { error: 'Cutout generation is unavailable.' });
        let runner;
        try { runner = segmentEventCutout ?? await import('../src/demo/pipeline.js').then(m => m.createDemoEventCutoutRunner({ env, dailyCapUsd, outputRoot: liveRoot })); }
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
        if (env.DEMO_REPLAY_ONLY === 'true') return json(res, 503, { error: 'Live generation is disabled.' });
        let context;
        try { context = continuationFor(item, input.branchId, store.get(input.runId), 100); }
        catch { return json(res, 400, { error: 'This saved event cannot be illustrated.' }); }
        const scene = typeof branch.scene === 'string' ? branch.scene.slice(0, 4000) : '';
        const pathContext = context.path.map(event => `${event.year}: ${event.title}. ${event.summary}. ${geographyText(event.geography)}`).join('\n');
        const prompt = `Create a realistic visual illustration of this speculative event, without text or labels. Event: ${branch.title} (${branch.year}), ${branch.place.name}. ${branch.summary}. ${scene}\nWorld history and hypothetical geography: ${context.rootDivergence}\n${pathContext}`;
        if (!keywordCheck(prompt).allowed) return json(res, 400, { error: 'This saved event cannot pass the topic policy.' });
        const ip = req.socket.remoteAddress ?? 'unknown';
        let t = now(), previous = (requests.get(ip) ?? []).filter(n => t - n < rateWindowMs);
        if (previous.length >= rateLimit) return json(res, 429, { status: 'retryable', error: 'Please try again shortly.' });
        let dailyCapUsd;
        try { dailyCapUsd = configuredDailyCap({ env }); } catch { dailyCapUsd = NaN; }
        if (!Number.isFinite(dailyCapUsd) || dailyCapUsd <= 0) return json(res, 503, { error: 'Scene generation is unavailable.' });
        let runner;
        try { runner = renderEventScene ?? await import('../src/demo/pipeline.js').then(m => m.createDemoEventSceneRunner({ env, dailyCapUsd, outputRoot: liveRoot })); }
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
        if (segments.length === 3 && safeId(segments[2])) {
          const data = await manifest(segments[2]);
          return data ? json(res, 200, data) : json(res, 404, { error: 'Not found' });
        }
        if (segments.length !== 4 || !safeId(segments[2]) || !assets.has(segments[3])) return json(res, 404, { error: 'Not found' });
        const cached = join(runsRoot, segments[2], segments[3]);
        if (await stat(cached).then(s => s.isFile()).catch(() => false)) return file(res, cached, req.method, runsRoot);
        const registeredRoot = liveRoots.get(segments[2]);
        if (registeredRoot) return file(res, join(registeredRoot, segments[2], segments[3]), req.method, registeredRoot);
        return json(res, 404, { error: 'Not found' });
      }
      if (req.method === 'POST' && path === '/api/transcribe') {
        if (!voiceEnabled) return json(res, 503, { error: 'Voice input is unavailable.' });
        if (!authorized(req)) return json(res, 403, { error: 'Voice input needs an access code.' });
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
          const runner = transcribeAudio ?? createDemoTranscriber({ env, outputRoot: liveRoot });
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
        if (!continuing && env.DEMO_REPLAY_ONLY === 'true') return json(res, 503, { error: 'Live generation is disabled. Use replay mode.' });
        if (!authorized(req) || !sameOrigin(req)) return json(res, 403, { error: 'Live generation is unavailable. Use replay mode.' });
        const ip = req.socket.remoteAddress ?? 'unknown';
        let t = now(), previous = (requests.get(ip) ?? []).filter(n => t - n < rateWindowMs);
        if (previous.length >= rateLimit) return json(res, 429, { status: 'retryable', error: 'Rate limit reached. Try replay mode.' });
        let body = '';
        for await (const chunk of req) { body += chunk; if (Buffer.byteLength(body) > 8192) return json(res, 413, { error: 'Request too large' }); }
        let input;
        try { input = JSON.parse(body); } catch { return json(res, 400, { error: 'Invalid JSON' }); }
        let continuation, edge, divergence;
        const retryBudgetFailure = continuing && input?.retryBudgetFailure === true;
        if (continuing) {
          if (!input || Object.keys(input).some(key => !['runId', 'branchId', 'retryBudgetFailure'].includes(key)) || (input.retryBudgetFailure !== undefined && typeof input.retryBudgetFailure !== 'boolean') || !safeId(input.runId ?? '') || !safeId(input.branchId ?? '')) return json(res, 400, { error: 'Choose a valid saved run and branch.' });
          const parent = await manifest(input.runId);
          if (!parent) return json(res, 404, { error: 'The parent run was not found.' });
          try { continuation = continuationFor(parent, input.branchId, store.get(input.runId), Math.min(MAX_CONTINUATION_DEPTH, Math.max(1, maxContinuationDepth))); }
          catch (error) { return json(res, 400, { error: error.message }); }
          divergence = continuation.rootDivergence;
          edge = store.edge(input.runId, input.branchId);
          if (edge) {
            const saved = store.get(edge.runId);
            if (edge.status === 'complete' && saved?.status === 'complete' && await manifest(edge.runId)) {
              res.writeHead(200, { 'Content-Type': 'text/event-stream; charset=utf-8', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' });
              return res.end(`event: complete\ndata: ${JSON.stringify(clean({ ...saved.completion, continuation: saved.continuation, reused: true, step: 'complete', ...renderMetadata(saved.completion?.branch) }))}\n\n`);
            }
            const eligibleBudgetRetry = await budgetFailureEdge(edge, input.runId, input.branchId);
            if (!retryBudgetFailure || !eligibleBudgetRetry) return json(res, 409, { error: eligibleBudgetRetry ? 'A previous budget-stopped continuation is preserved. Explicitly request a budget retry to continue.' : 'This continuation is unfinished or uncertain. Automatic retry is disabled to avoid duplicate charges.', status: edge.status, ...(eligibleBudgetRetry ? { code: 'budget_exhausted' } : {}), ...(safeId(edge.runId ?? '') ? { runId: edge.runId } : {}) });
          } else if (hasSavedBudgetFailure(input.runId, input.branchId)) {
            if (!retryBudgetFailure) return json(res, 409, { error: 'A previous budget-stopped continuation is preserved. Explicitly request a budget retry to continue.', status: 'failed', code: 'budget_exhausted' });
          } else if (retryBudgetFailure) {
            return json(res, 409, { error: 'No server-recorded budget refusal authorizes this retry.', status: 'failed' });
          }
        } else {
          if (typeof input?.divergence !== 'string' || !input.divergence.trim() || input.divergence.length > 2000) return json(res, 400, { error: 'A divergence is required' });
          divergence = input.divergence.trim();
        }
        if (env.DEMO_REPLAY_ONLY === 'true') return json(res, 503, { error: 'Live generation is disabled. Use replay mode.' });
        if (continuing && !keywordCheck(divergence).allowed) return json(res, 400, { error: 'The saved branch cannot pass the topic policy.' });
        let dailyCapUsd;
        try { dailyCapUsd = configuredDailyCap({ env }); } catch { dailyCapUsd = NaN; }
        if (!Number.isFinite(dailyCapUsd) || dailyCapUsd <= 0) return json(res, 503, { error: 'Live generation is unavailable. Use replay mode.' });
        let runner;
        try { runner = runPipeline ?? await import('../src/demo/pipeline.js').then(m => m.createDemoRunner({ env, dailyCapUsd, outputRoot: liveRoot })); }
        catch { return json(res, 503, { error: 'Live generation is unavailable. Use replay mode.' }); }
        if (typeof runner !== 'function' || runner.enforcesDailyCap !== true) return json(res, 503, { error: 'Live generation is unavailable. Use replay mode.' });
        if (continuing) {
          edge = store.edge(input.runId, input.branchId);
          if (edge) {
            const saved = store.get(edge.runId);
            if (edge.status === 'complete' && saved?.status === 'complete' && await manifest(edge.runId)) {
              res.writeHead(200, { 'Content-Type': 'text/event-stream; charset=utf-8', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' });
              return res.end(`event: complete\ndata: ${JSON.stringify(clean({ ...saved.completion, continuation: saved.continuation, reused: true, step: 'complete', ...renderMetadata(saved.completion?.branch) }))}\n\n`);
            }
            const eligibleBudgetRetry = await budgetFailureEdge(edge, input.runId, input.branchId);
            if (!retryBudgetFailure || !eligibleBudgetRetry) return json(res, 409, { error: eligibleBudgetRetry ? 'A previous budget-stopped continuation is preserved. Explicitly request a budget retry to continue.' : 'This continuation is unfinished or uncertain. Automatic retry is disabled to avoid duplicate charges.', status: edge.status, ...(eligibleBudgetRetry ? { code: 'budget_exhausted' } : {}), ...(safeId(edge.runId ?? '') ? { runId: edge.runId } : {}) });
          } else if (hasSavedBudgetFailure(input.runId, input.branchId)) {
            if (!retryBudgetFailure) return json(res, 409, { error: 'A previous budget-stopped continuation is preserved. Explicitly request a budget retry to continue.', status: 'failed', code: 'budget_exhausted' });
          } else if (retryBudgetFailure) {
            return json(res, 409, { error: 'No server-recorded budget refusal authorizes this retry.', status: 'failed' });
          }
        }
        t = now(); previous = (requests.get(ip) ?? []).filter(n => t - n < rateWindowMs);
        if (previous.length >= rateLimit) return json(res, 429, { status: 'retryable', error: 'Rate limit reached. Try replay mode.' });
        if (!acquireJob()) return json(res, 429, { status: 'retryable', error: 'A live run is already in progress. Try replay mode.' });
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
              if (!retryBudgetFailure || !eligibleBudgetRetry) return json(res, 409, { error: eligibleBudgetRetry ? 'A previous budget-stopped continuation is preserved. Explicitly request a budget retry to continue.' : 'This continuation is unfinished or uncertain. Automatic retry is disabled to avoid duplicate charges.', status: edge.status, ...(eligibleBudgetRetry ? { code: 'budget_exhausted' } : {}) });
              await archiveBudgetFailureEdge(edge);
              edge = null;
            } else if (hasSavedBudgetFailure(input.runId, input.branchId)) {
              if (!retryBudgetFailure) return json(res, 409, { error: 'A previous budget-stopped continuation is preserved. Explicitly request a budget retry to continue.', status: 'failed', code: 'budget_exhausted' });
            } else if (retryBudgetFailure) {
              return json(res, 409, { error: 'No server-recorded budget refusal authorizes this retry.', status: 'failed' });
            }
            edge = store.reserve(input.runId, input.branchId, continuation);
            if (!edge) return json(res, 409, { error: 'This continuation is already reserved. Reopen its saved run.' });
          }
          previous.push(t); requests.set(ip, previous);
          if (continuing) {
            if (!store.get(input.runId)) {
              const parent = await manifest(input.runId);
              store.save({ id: input.runId, status: 'complete', rootDivergence: divergence, completion: { runId: input.runId, branch: clean(parent.branch) } });
            }
          }
          const reservedRunId = edge?.runId ?? randomUUID();
          store.save({ id: reservedRunId, status: 'in-progress', rootDivergence: divergence, ...(continuation ? { continuation } : {}) });
          res.writeHead(200, { 'Content-Type': 'text/event-stream; charset=utf-8', 'Cache-Control': 'no-store', Connection: 'keep-alive', 'X-Content-Type-Options': 'nosniff', ...(expansionUsed === null ? {} : { 'X-Expansion-Used': String(expansionUsed) }) });
          res.flushHeaders();
          const controller = new AbortController();
          res.on('close', () => { if (!res.writableEnded) controller.abort(); });
          const emit = (event, data) => { if (!res.destroyed && !res.writableEnded) res.write(`event: ${event}\ndata: ${JSON.stringify(clean(data))}\n\n`); };
          const allowed = new Set(['policy', 'propose', 'review', 'image', 'cutout', '3d']);
          try {
            const result = await runner({ divergence, continuation, runId: reservedRunId, signal: controller.signal, dailyCapUsd, onStep: event => { if (allowed.has(event?.step)) { if (safeId(event.runId ?? '')) liveRoots.set(event.runId, liveRoot); emit(event.step, event); } } });
            if (result?.runId !== reservedRunId) throw new Error('Generation did not complete under its reserved run ID');
            if (continuing && result?.branch?.status !== 'ok') throw new Error('Continuation did not complete');
            if (safeId(result?.runId ?? '')) liveRoots.set(result.runId, liveRoot);
            if (continuing && (await manifest(reservedRunId))?.branch?.status !== 'ok') throw new Error('Continuation was not saved');
            const completion = clean({ ...result, directory: undefined, ...(continuation ? { continuation } : {}), reused: false });
            if (safeId(result?.runId ?? '')) store.save({ id: result.runId, status: 'complete', rootDivergence: divergence, ...(continuation ? { continuation } : {}), completion });
            if (edge) store.finish(edge, 'complete');
            emit('complete', { ...completion, ...renderMetadata(result?.branch), step: 'complete' });
          } catch (error) {
            // Only a metering refusal proven to precede every paid dispatch is
            // safe to release. Provider/network failures and disconnects keep
            // their durable reservation for review.
            let retryable = !!edge && !controller.signal.aborted && error instanceof SpendCapError && error.continuationRetryable === true;
            const budgetProof = continuing && !controller.signal.aborted ? spendCapProof(error) : null;
            const record = status => ({ id: reservedRunId, status, rootDivergence: divergence, ...(continuation ? { continuation } : {}), ...(budgetProof ? { budgetFailure: budgetProof } : {}) });
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
                  ? 'Continuation did not finish. Automatic retry is disabled to avoid duplicate charges.'
                  : 'Live generation failed. Check server logs and use replay mode.';
            emit('error', { step: 'error', status: retryable ? 'retryable' : controller.signal.aborted ? 'uncertain' : 'failed', ...(budgetFailure ? { code: 'budget_exhausted' } : {}), error: message });
          }
          res.end();
        } finally { releaseJob(); }
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
  const selectedOutputRoot = requestedOutputRoot ?? (status.replayOnly ? 'demo/replay-history' : 'out');
  const normalizedHost = host === 'localhost' ? '127.0.0.1' : host;
  const isLoopback = normalizedHost === '127.0.0.1';
  const effectiveEnv = { ...env };
  let localReviewAccess = options.localReviewAccess ?? false;
  if (status.replayOnly) {
    effectiveEnv.DEMO_REPLAY_ONLY = 'true';
  } else if (isLoopback) {
    if (!effectiveEnv.DEMO_ACCESS_CODE?.trim()) {
      effectiveEnv.DEMO_ACCESS_CODE = randomUUID();
    }
    if (effectiveEnv.DEMO_VOICE_ENABLED === undefined || String(effectiveEnv.DEMO_VOICE_ENABLED).trim() === '') {
      effectiveEnv.DEMO_VOICE_ENABLED = 'true';
    }
    if (options.localReviewAccess === undefined) {
      localReviewAccess = true;
    }
  }
  const importRunIds = options.importRunIds ?? (env.DEMO_IMPORT_RUN_IDS ?? '').split(',').map(s => s.trim()).filter(Boolean);
  const rateLimit = options.rateLimit ?? configuredRateLimit({ env, isLoopback, replayOnly: status.replayOnly });
  const server = createDemoServer({
    liveRunsDir: resolve(selectedOutputRoot),
    ...options,
    importRunIds,
    rateLimit,
    env: effectiveEnv,
    localReviewAccess,
  });
  const port = Number(env.PORT ?? 3000);
  if (!Number.isInteger(port) || port < 0 || port > 65535) throw new Error('Invalid PORT: must be an integer from 0 to 65535');
  return { server, host: normalizedHost, port, ...status, localReviewAccess };
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  try {
    const { server, host, port, replayOnly, spendCapUsd, enable3d } = createConfiguredDemoServer();
    server.listen(port, host, () => {
      const boundPort = server.address()?.port ?? port;
      const mode = replayOnly
        ? 'replay-only mode (set META_API_KEY in .env to enable live Meta generation)'
        : `live Meta mode (spend ceiling $${spendCapUsd.toFixed(2)}, 3D generation ${enable3d ? 'enabled' : 'disabled'})`;
      console.log(`Demo server listening on http://${host}:${boundPort} — ${mode}`);
    });
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}
