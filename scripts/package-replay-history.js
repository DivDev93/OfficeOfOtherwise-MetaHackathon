import { createHash } from 'node:crypto';
import { createReadStream, existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const sourceRuns = resolve(repoRoot, 'out/voice-prototype-review/runs');
const sourceContinuation = join(sourceRuns, '.continuation');
const sourceScenes = join(sourceRuns, '.event-scenes');
const sourceCutouts = join(sourceRuns, '.event-cutouts');
const publicRuns = resolve(repoRoot, 'demo/runs');
const defaultOutput = resolve(repoRoot, 'demo/replay-history');

export const REPLAY_CHAIN = Object.freeze([
  Object.freeze({ id: 'df5e6d97-9f0d-49a0-bb62-ad52c3ae6d09', parentRunId: 'beringia', parentBranchId: 'b2', heroBranchId: 'b3', heroYear: 1380 }),
  Object.freeze({ id: 'c892b8d0-36c5-4eeb-a70b-022041a25c98', parentRunId: 'df5e6d97-9f0d-49a0-bb62-ad52c3ae6d09', parentBranchId: 'b3', heroBranchId: 'b1', heroYear: 1472 }),
  Object.freeze({ id: '1fc70744-d82b-4364-8b78-c79544a4f7d6', parentRunId: 'c892b8d0-36c5-4eeb-a70b-022041a25c98', parentBranchId: 'b1', heroBranchId: 'b1', heroYear: 1538 }),
]);

const LICHEN_FOLLOWUP = Object.freeze({
  id: 'cc1b3038-9c20-44d3-83e0-1045c6392d8e',
  parentRunId: REPLAY_CHAIN[0].id,
  parentBranchId: 'b1',
  heroBranchId: 'b1',
  heroYear: 1150,
  path: Object.freeze([
    Object.freeze({ runId: 'beringia', branchId: 'b2', year: 900 }),
    Object.freeze({ runId: REPLAY_CHAIN[0].id, branchId: 'b1', year: 1080 }),
  ]),
});
const PACKAGED_CONTINUATIONS = Object.freeze([...REPLAY_CHAIN, LICHEN_FOLLOWUP]);
const RAM_SETU_ROOT = Object.freeze({
  id: '04f9af4a-f4ee-48da-b8d6-85e73373452a',
  divergence: 'What if Ram Setu remained a continuous dry, passable land connection between India and Sri Lanka, supporting coastal ecology and cultural exchange?',
  heroBranchId: 'b4',
  heroYear: 1250,
});

const PATH_EVENTS = Object.freeze([
  Object.freeze({ runId: 'beringia', branchId: 'b2', year: 900 }),
  Object.freeze({ runId: REPLAY_CHAIN[0].id, branchId: 'b3', year: 1380 }),
  Object.freeze({ runId: REPLAY_CHAIN[1].id, branchId: 'b1', year: 1472 }),
]);
const ALT_EVENT = Object.freeze({ runId: REPLAY_CHAIN[0].id, branchId: 'b1', year: 1080 });
const PUBLIC_CUTOUT = Object.freeze({ runId: REPLAY_CHAIN[1].id, branchId: 'b4', year: 1645, contentAddress: '2d219132f3691e38783a530dfd48bc3600f9e1745a36755726680de2c3971fa5' });
const PUBLIC_EVENT_RUNS = Object.freeze(['beringia', ...PACKAGED_CONTINUATIONS.map(item => item.id)]);
const branchFields = ['id', 'title', 'year', 'place', 'summary', 'scene', 'causalLink', 'geography', 'uncertainty'];
const pathFields = ['runId', 'branchId', 'title', 'year', 'summary', 'place', 'causalLink', 'geography'];
const traceFields = ['step', 'model', 'ms', 'costUsd'];
const digest = buffer => createHash('sha256').update(buffer).digest('hex');
const jsonBytes = value => Buffer.from(`${JSON.stringify(value, null, 2)}\n`);
const safeId = value => typeof value === 'string' && /^[a-zA-Z0-9][a-zA-Z0-9_-]{0,127}$/.test(value);
const valueAt = (object, key) => object && Object.hasOwn(object, key) ? object[key] : undefined;

function pick(object, fields) {
  return Object.fromEntries(fields.filter(key => valueAt(object, key) !== undefined).map(key => [key, object[key]]));
}

export function sanitizeContinuation(value) {
  if (!value || value.rootRunId !== 'beringia' || typeof value.rootDivergence !== 'string' || !Array.isArray(value.path)) {
    throw new Error('Replay continuation metadata is invalid');
  }
  return {
    rootRunId: value.rootRunId,
    rootDivergence: value.rootDivergence,
    parentRunId: value.parentRunId,
    parentBranchId: value.parentBranchId,
    path: value.path.map(item => pick(item, pathFields)),
  };
}

export function sanitizeBranch(source, { traceSteps = [] } = {}) {
  if (!source || source.status !== 'ok' || typeof source.divergence !== 'string' || !Array.isArray(source.branches)) {
    throw new Error('Replay branch record is invalid');
  }
  const branches = source.branches.map(item => pick(item, branchFields));
  if (branches.some(item => !safeId(item.id) || typeof item.title !== 'string' || !Number.isInteger(item.year))) {
    throw new Error('Replay branch contains an invalid event');
  }
  const heroBranchId = source.hero?.branchId;
  if (!branches.some(item => item.id === heroBranchId)) throw new Error('Replay hero is not in its branch list');
  return {
    divergence: source.divergence,
    continuation: sanitizeContinuation(source.continuation),
    branches,
    hero: { branchId: heroBranchId },
    status: 'ok',
    trace: traceSteps.map(item => pick(item, traceFields)),
  };
}

function sourcePath(root, relativePath) {
  const candidate = resolve(root, relativePath);
  if (!candidate.startsWith(`${resolve(root)}${process.platform === 'win32' ? '\\' : '/'}`)) {
    throw new Error(`Source path escaped its allowlisted root: ${relativePath}`);
  }
  return candidate;
}

async function fileHash(path) {
  const hash = createHash('sha256');
  for await (const chunk of createReadStream(path)) hash.update(chunk);
  return hash.digest('hex');
}

function readJson(path) {
  return JSON.parse(readFileSync(path, 'utf8'));
}

function hashKey(parentRunId, branchId) {
  return digest(Buffer.from(JSON.stringify([parentRunId, branchId])));
}

function writeSafe(outputRoot, outputRelative, bytes, { replaceManifest = false, replaceSceneRecord = false } = {}) {
  const target = resolve(outputRoot, outputRelative);
  const base = `${resolve(outputRoot)}${process.platform === 'win32' ? '\\' : '/'}`;
  if (!target.startsWith(base)) throw new Error(`Package path escaped its allowlisted root: ${outputRelative}`);
  if (existsSync(target)) {
    const existing = readFileSync(target);
    if (!existing.equals(bytes)) {
      const generatedSceneRecord = replaceSceneRecord && /^\.event-scenes\/[a-f0-9]{64}\.json$/.test(outputRelative);
      if (!(replaceManifest && outputRelative === 'PACKAGE.json') && !generatedSceneRecord) throw new Error(`Refusing to overwrite different packaged data: ${outputRelative}`);
      writeFileSync(target, bytes);
    }
  } else {
    mkdirSync(dirname(target), { recursive: true });
    writeFileSync(target, bytes, { flag: 'wx' });
  }
  return digest(bytes);
}

function assertExpectedRun(record, expected, rootDivergence) {
  const continuation = record.continuation;
  if (record.status !== 'ok' || continuation?.rootRunId !== 'beringia' || continuation?.rootDivergence !== rootDivergence
      || continuation?.parentRunId !== expected.parentRunId || continuation?.parentBranchId !== expected.parentBranchId) {
    throw new Error(`The saved continuation graph changed for ${expected.id}`);
  }
  const selected = record.branches?.find(item => item.id === record.hero?.branchId);
  if (!selected || selected.id !== expected.heroBranchId || selected.year !== expected.heroYear) {
    throw new Error(`The selected Beringia event changed for ${expected.id}`);
  }
  const expectedPath = expected.path ?? PATH_EVENTS.slice(0, REPLAY_CHAIN.indexOf(expected) + 1);
  if (continuation.path.length !== expectedPath.length || expectedPath.some((item, index) => {
    const actual = continuation.path[index];
    return actual.runId !== item.runId || actual.branchId !== item.branchId || actual.year !== item.year;
  })) throw new Error(`The saved event path changed for ${expected.id}`);
}

function sanitizeStandaloneRoot(source, expected, traceSteps = []) {
  if (!source || source.status !== 'ok' || source.divergence !== expected.divergence || !Array.isArray(source.branches)) {
    throw new Error(`The recorded standalone root changed for ${expected.id}`);
  }
  const branches = source.branches.map(item => pick(item, branchFields));
  if (branches.some(item => !safeId(item.id) || typeof item.title !== 'string' || !Number.isInteger(item.year))) {
    throw new Error(`Standalone root contains an invalid event: ${expected.id}`);
  }
  const hero = branches.find(item => item.id === source.hero?.branchId);
  if (!hero || hero.id !== expected.heroBranchId || hero.year !== expected.heroYear
      || !Array.isArray(hero.geography?.changes) || !hero.geography.changes.some(item => typeof item.uncertainty === 'string' && item.uncertainty.length > 0)) {
    throw new Error(`Standalone root hero or geographic uncertainty changed: ${expected.id}`);
  }
  return {
    divergence: source.divergence,
    branches,
    hero: { branchId: hero.id },
    status: 'ok',
    trace: traceSteps.map(item => pick(item, traceFields)),
  };
}

function isPng(bytes) {
  return bytes.length >= 8 && bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]));
}

function normalizeTargetRoot(outputRoot) {
  const target = resolve(outputRoot);
  const base = `${repoRoot}${process.platform === 'win32' ? '\\' : '/'}`;
  if (!target.startsWith(base) || target === repoRoot) throw new Error('Replay history output must stay inside the repository');
  return target;
}

export async function packageReplayHistory({ sourceRunRoot = sourceRuns, publicRunRoot = publicRuns, outputRoot = defaultOutput } = {}) {
  const output = normalizeTargetRoot(outputRoot);
  const source = resolve(sourceRunRoot), publicRoot = resolve(publicRunRoot);
  const rootBranchPath = sourcePath(publicRoot, 'beringia/branch.json');
  const rootBranch = readJson(rootBranchPath);
  const rootPathBranch = rootBranch.branches?.find(item => item.id === 'b2');
  if (rootBranch.status !== 'ok' || rootBranch.divergence !== 'What if the Bering land bridge never flooded?'
      || rootBranch.hero?.branchId !== 'b2' || rootPathBranch?.year !== 900) {
    throw new Error('The public Beringia root no longer matches the recorded 900 CE starting point');
  }

  const preparedRuns = new Map();
  const origins = [];
  const outputHashes = [];
  const originFor = async (runId, role, root, sourceRelative, outputRelative, bytes) => {
    const sourceFile = sourcePath(root, sourceRelative);
    if (!existsSync(sourceFile)) throw new Error(`Missing allowlisted replay source: ${sourceRelative}`);
    const outputSha256 = writeSafe(output, outputRelative, bytes);
    origins.push({ runId, role, sourceSha256: await fileHash(sourceFile), output: outputRelative, outputSha256 });
    outputHashes.push({ path: outputRelative, sha256: outputSha256 });
    return outputSha256;
  };

  for (const expected of PACKAGED_CONTINUATIONS) {
    if (!safeId(expected.id)) throw new Error('Unsafe allowlist identifier');
    const runDir = sourcePath(source, expected.id);
    const branchPath = sourcePath(runDir, 'branch.json');
    const tracePath = sourcePath(runDir, 'trace.json');
    const rawBranch = readJson(branchPath);
    const rawTrace = readJson(tracePath);
    if (!Array.isArray(rawTrace.steps)) throw new Error(`Trace steps are missing for ${expected.id}`);
    assertExpectedRun(rawBranch, expected, rootBranch.divergence);
    const safeTrace = { steps: rawTrace.steps.map(step => pick(step, traceFields)) };
    const branch = sanitizeBranch(rawBranch, { traceSteps: safeTrace.steps });
    const continuation = branch.continuation;
    const sourceBranchRel = `${expected.id}/branch.json`;
    const sourceTraceRel = `${expected.id}/trace.json`;
    const branchOut = `${expected.id}/branch.json`;
    const traceOut = `${expected.id}/trace.json`;
    const branchBytes = jsonBytes(branch), traceBytes = jsonBytes(safeTrace);
    await originFor(expected.id, 'branch', source, sourceBranchRel, branchOut, branchBytes);
    await originFor(expected.id, 'trace-summary', source, sourceTraceRel, traceOut, traceBytes);

    for (const asset of ['hero.png']) {
      const assetPath = sourcePath(runDir, asset);
      const bytes = readFileSync(assetPath);
      if (!isPng(bytes)) throw new Error(`Invalid ${asset} image for ${expected.id}`);
      await originFor(expected.id, asset, source, `${expected.id}/${asset}`, `${expected.id}/${asset}`, bytes);
    }

    const sourceStoreRun = sourcePath(sourceContinuation, `runs/${expected.id}.json`);
    if (!existsSync(sourceStoreRun)) throw new Error(`Missing continuation store record for ${expected.id}`);
    const sourceStoreHash = await fileHash(sourceStoreRun);
    const storeRecord = {
      id: expected.id,
      status: 'complete',
      rootDivergence: rootBranch.divergence,
      continuation,
      completion: { runId: expected.id, branch },
      updatedAt: new Date(statSync(branchPath).mtimeMs).toISOString(),
    };
    const storeOut = `.continuation/runs/${expected.id}.json`;
    const storeBytes = jsonBytes(storeRecord);
    writeSafe(output, storeOut, storeBytes);
    origins.push({ runId: expected.id, role: 'continuation-store-record', sourceSha256: sourceStoreHash, output: storeOut, outputSha256: digest(storeBytes) });
    outputHashes.push({ path: storeOut, sha256: digest(storeBytes) });
    preparedRuns.set(expected.id, { branch, continuation });
  }

  const edgeOrigins = [];
  for (const expected of PACKAGED_CONTINUATIONS) {
    const edgeName = `${hashKey(expected.parentRunId, expected.parentBranchId)}.json`;
    const sourceEdgeRel = `edges/${edgeName}`;
    const edgeOut = `.continuation/${sourceEdgeRel}`;
    const sourceEdgePath = sourcePath(sourceContinuation, sourceEdgeRel);
    if (!existsSync(sourceEdgePath)) throw new Error(`Missing allowlisted continuation edge: ${expected.parentRunId}/${expected.parentBranchId}`);
    const rawEdge = readJson(sourceEdgePath);
    if (rawEdge.parentRunId !== expected.parentRunId || rawEdge.parentBranchId !== expected.parentBranchId || rawEdge.runId !== expected.id || rawEdge.status !== 'complete') {
      throw new Error(`Continuation edge does not match the allowlist: ${expected.parentRunId}/${expected.parentBranchId}`);
    }
    const edge = {
      parentRunId: rawEdge.parentRunId,
      parentBranchId: rawEdge.parentBranchId,
      runId: rawEdge.runId,
      status: rawEdge.status,
      continuation: preparedRuns.get(expected.id).continuation,
      updatedAt: rawEdge.updatedAt,
    };
    const edgeBytes = jsonBytes(edge);
    writeSafe(output, edgeOut, edgeBytes);
    edgeOrigins.push({ parentRunId: expected.parentRunId, parentBranchId: expected.parentBranchId, runId: expected.id, sourceSha256: await fileHash(sourceEdgePath), output: edgeOut, outputSha256: digest(edgeBytes) });
    outputHashes.push({ path: edgeOut, sha256: digest(edgeBytes) });
  }

  const sceneOrigins = [], missingScenes = [];
  for (const runId of PUBLIC_EVENT_RUNS) {
    const branch = runId === 'beringia' ? rootBranch : preparedRuns.get(runId).branch;
    for (const event of branch.branches) {
      const key = hashKey(runId, event.id);
      const sourceRecordRel = `${key}.json`, sourcePngRel = `${key}.png`;
      const recordPath = sourcePath(sourceScenes, sourceRecordRel);
      const pngPath = sourcePath(sourceScenes, sourcePngRel);
      if (!existsSync(recordPath)) {
        if (event.id !== branch.hero?.branchId) missingScenes.push({ runId, branchId: event.id, reason: 'no saved complete scene record' });
        continue;
      }
      const record = readJson(recordPath);
      if (record.runId !== runId || record.branchId !== event.id || record.key !== key || record.status !== 'complete' || !existsSync(pngPath)) {
        if (event.id !== branch.hero?.branchId) missingScenes.push({ runId, branchId: event.id, reason: 'scene record or image is incomplete' });
        continue;
      }
      const png = readFileSync(pngPath);
      if (!isPng(png)) throw new Error(`Invalid saved event scene PNG for ${runId}/${event.id}`);
      const safeRecord = { runId, branchId: event.id, status: 'complete' };
      const safeRecordBytes = jsonBytes(safeRecord);
      const recordOut = `.event-scenes/${key}.json`, pngOut = `.event-scenes/${key}.png`;
      writeSafe(output, recordOut, safeRecordBytes, { replaceSceneRecord: true });
      writeSafe(output, pngOut, png);
      sceneOrigins.push({ runId, branchId: event.id, contentAddress: key, sourceRecordSha256: await fileHash(recordPath), sourcePngSha256: await fileHash(pngPath), record: recordOut, png: pngOut, pngSha256: digest(png) });
      outputHashes.push({ path: recordOut, sha256: digest(safeRecordBytes) }, { path: pngOut, sha256: digest(png) });
    }
  }

  const cutoutKey = hashKey(PUBLIC_CUTOUT.runId, PUBLIC_CUTOUT.branchId);
  if (cutoutKey !== PUBLIC_CUTOUT.contentAddress) throw new Error('The saved nonhero cutout address changed');
  const cutoutRecordRel = `${cutoutKey}.json`, cutoutPngRel = `${cutoutKey}.png`;
  const cutoutRecordPath = sourcePath(sourceCutouts, cutoutRecordRel), cutoutPngPath = sourcePath(sourceCutouts, cutoutPngRel);
  if (!existsSync(cutoutRecordPath) || !existsSync(cutoutPngPath)) throw new Error('The recorded Great Slave nonhero cutout is missing');
  const cutoutRecord = readJson(cutoutRecordPath);
  if (cutoutRecord.runId !== PUBLIC_CUTOUT.runId || cutoutRecord.branchId !== PUBLIC_CUTOUT.branchId || cutoutRecord.key !== cutoutKey || cutoutRecord.status !== 'complete') {
    throw new Error('The recorded Great Slave nonhero cutout store entry changed');
  }
  const cutoutPng = readFileSync(cutoutPngPath);
  if (!isPng(cutoutPng)) throw new Error('The recorded Great Slave nonhero cutout is not a PNG');
  const safeCutoutRecord = { runId: PUBLIC_CUTOUT.runId, branchId: PUBLIC_CUTOUT.branchId, status: 'complete' };
  const safeCutoutBytes = jsonBytes(safeCutoutRecord);
  const cutoutRecordOut = `.event-cutouts/${cutoutKey}.json`, cutoutPngOut = `.event-cutouts/${cutoutKey}.png`;
  writeSafe(output, cutoutRecordOut, safeCutoutBytes);
  writeSafe(output, cutoutPngOut, cutoutPng);
  const cutoutOrigin = {
    runId: PUBLIC_CUTOUT.runId,
    branchId: PUBLIC_CUTOUT.branchId,
    year: PUBLIC_CUTOUT.year,
    contentAddress: cutoutKey,
    sourceRecordSha256: await fileHash(cutoutRecordPath),
    sourcePngSha256: await fileHash(cutoutPngPath),
    record: cutoutRecordOut,
    png: cutoutPngOut,
    pngSha256: digest(cutoutPng),
  };
  outputHashes.push({ path: cutoutRecordOut, sha256: digest(safeCutoutBytes) }, { path: cutoutPngOut, sha256: digest(cutoutPng) });

  const standaloneDir = sourcePath(source, RAM_SETU_ROOT.id);
  const standaloneBranchPath = sourcePath(standaloneDir, 'branch.json');
  const standaloneTracePath = sourcePath(standaloneDir, 'trace.json');
  const standaloneRegistryPath = sourcePath(sourceContinuation, `runs/${RAM_SETU_ROOT.id}.json`);
  const rawStandaloneBranch = readJson(standaloneBranchPath);
  const rawStandaloneTrace = readJson(standaloneTracePath);
  const rawStandaloneRegistry = readJson(standaloneRegistryPath);
  if (!Array.isArray(rawStandaloneTrace.steps) || rawStandaloneRegistry.id !== RAM_SETU_ROOT.id
      || rawStandaloneRegistry.status !== 'complete' || rawStandaloneRegistry.rootDivergence !== RAM_SETU_ROOT.divergence) {
    throw new Error('The recorded Ram Setu root registry or trace changed');
  }
  const standaloneBranch = sanitizeStandaloneRoot(rawStandaloneBranch, RAM_SETU_ROOT, rawStandaloneTrace.steps);
  const standaloneTrace = { steps: rawStandaloneTrace.steps.map(step => pick(step, traceFields)) };
  const standaloneBranchBytes = jsonBytes(standaloneBranch);
  const standaloneTraceBytes = jsonBytes(standaloneTrace);
  await originFor(RAM_SETU_ROOT.id, 'standalone-root-branch', source, `${RAM_SETU_ROOT.id}/branch.json`, `${RAM_SETU_ROOT.id}/branch.json`, standaloneBranchBytes);
  await originFor(RAM_SETU_ROOT.id, 'trace-summary', source, `${RAM_SETU_ROOT.id}/trace.json`, `${RAM_SETU_ROOT.id}/trace.json`, standaloneTraceBytes);
  const standaloneHeroPath = sourcePath(standaloneDir, 'hero.png');
  const standaloneHero = readFileSync(standaloneHeroPath);
  if (!isPng(standaloneHero)) throw new Error('The recorded Ram Setu root hero is not a PNG');
  await originFor(RAM_SETU_ROOT.id, 'hero.png', source, `${RAM_SETU_ROOT.id}/hero.png`, `${RAM_SETU_ROOT.id}/hero.png`, standaloneHero);
  const standaloneStoreRecord = {
    id: RAM_SETU_ROOT.id,
    status: 'complete',
    rootDivergence: RAM_SETU_ROOT.divergence,
    completion: { runId: RAM_SETU_ROOT.id, branch: standaloneBranch },
    updatedAt: new Date(statSync(standaloneBranchPath).mtimeMs).toISOString(),
  };
  const standaloneStoreBytes = jsonBytes(standaloneStoreRecord);
  const standaloneStoreOut = `.continuation/runs/${RAM_SETU_ROOT.id}.json`;
  await originFor(RAM_SETU_ROOT.id, 'standalone-root-registry', sourceContinuation, `runs/${RAM_SETU_ROOT.id}.json`, standaloneStoreOut, standaloneStoreBytes);

  const rootSourceHash = await fileHash(rootBranchPath);
  origins.push({ runId: 'beringia', role: 'public-root-branch', sourceSha256: rootSourceHash });
  const packageRecord = {
    schemaVersion: 1,
    root: { runId: 'beringia', branchId: 'b2', year: 900, divergence: rootBranch.divergence, sourceSha256: rootSourceHash },
    path: [...PATH_EVENTS, { runId: REPLAY_CHAIN[2].id, branchId: 'b1', year: 1538 }],
    alternative: ALT_EVENT,
    additionalReplays: [
      { runId: LICHEN_FOLLOWUP.id, parentRunId: LICHEN_FOLLOWUP.parentRunId, parentBranchId: LICHEN_FOLLOWUP.parentBranchId, heroBranchId: LICHEN_FOLLOWUP.heroBranchId, heroYear: LICHEN_FOLLOWUP.heroYear },
      { runId: RAM_SETU_ROOT.id, divergence: RAM_SETU_ROOT.divergence, heroBranchId: RAM_SETU_ROOT.heroBranchId, heroYear: RAM_SETU_ROOT.heroYear, deepLink: `/#run=${RAM_SETU_ROOT.id}` },
    ],
    continuationEdges: edgeOrigins,
    packagedContinuationRuns: [...preparedRuns.keys()],
    completedEventScenes: sceneOrigins,
    completedEventCutouts: [cutoutOrigin],
    unavailableEventScenes: missingScenes,
    origins,
    outputHashes,
    excluded: ['raw provider responses', 'private output directories', 'model and mask assets', 'credentials', '3D backend code'],
  };
  const packageBytes = jsonBytes(packageRecord);
  writeSafe(output, 'PACKAGE.json', packageBytes, { replaceManifest: true });
  return { outputRoot: output, runCount: preparedRuns.size, edgeCount: edgeOrigins.length, sceneCount: sceneOrigins.length, cutoutCount: 1, standaloneRootCount: 1, missingSceneCount: missingScenes.length, outputBytes: outputHashes.reduce((sum, item) => sum + statSync(resolve(output, item.path)).size, packageBytes.length) };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  packageReplayHistory().then(summary => process.stdout.write(`${JSON.stringify(summary, null, 2)}\n`)).catch(error => {
    process.stderr.write(`${error.message}\n`);
    process.exitCode = 1;
  });
}
