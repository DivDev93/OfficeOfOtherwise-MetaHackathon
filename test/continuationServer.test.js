import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, readFile, rm, readdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { createDemoServer } from '../server/index.js';
import { createContinuationStore } from '../src/demo/continuationStore.js';
import { continuationFor, MAX_CONTINUATION_DEPTH } from '../src/demo/continuation.js';
import { SpendCapError, markUndispatchedBudgetError } from '../src/lib/metaClient.js';

const headers = { 'x-demo-access-code': 'local-code', 'content-type': 'application/json' };
const cookies = new Map();
async function sessionCookie(url) {
  if (cookies.has(url)) return cookies.get(url);
  const response = await fetch(`${url}/health`);
  const cookie = response.headers.get('set-cookie')?.split(';')[0];
  if (!cookie) throw new Error('server did not issue its browser-session cookie');
  cookies.set(url, cookie); return cookie;
}
const branch = (year = 350) => ({ status: 'ok', divergence: 'What if the ancient library survived?', branches: [{ id: 'b1', title: 'Early astronomy', summary: 'Preserved star charts improve astronomical teaching.', year, place: { name: 'Alexandria', lat: 31, lon: 29 } }], hero: { title: 'Astronomy' } });
const completion = text => JSON.parse(text.match(/event: complete\ndata: (.+)/)?.[1] ?? '{}');
const post = async (url, input = { runId: 'root', branchId: 'b1' }, customHeaders = headers) => fetch(`${url}/api/continue`, { method: 'POST', headers: { ...customHeaders, cookie: customHeaders.cookie || await sessionCookie(url) }, body: JSON.stringify(input) });

async function setup(t, options = {}) {
  const base = await mkdtemp(join(tmpdir(), 'office-continuation-'));
  const runsDir = join(base, 'cached'), liveRunsDir = join(base, 'live'), webDir = join(base, 'web');
  await mkdir(join(runsDir, 'root'), { recursive: true });
  await mkdir(webDir);
  await mkdir(liveRunsDir);
  await writeFile(join(runsDir, 'root', 'branch.json'), JSON.stringify(options.parent ?? branch()));
  let calls = 0, contexts = [], server;
  const runner = async args => {
    calls++; contexts.push(args);
    if (options.runner) return options.runner(args);
    const saved = branch(350 + (args.continuation?.path.length ?? 0) * 100);
    await mkdir(join(liveRunsDir, args.runId), { recursive: true });
    await writeFile(join(liveRunsDir, args.runId, 'branch.json'), JSON.stringify(saved));
    await writeFile(join(liveRunsDir, args.runId, 'hero.png'), 'saved-image');
    args.onStep({ step: 'review', runId: args.runId, branch: saved });
    return { runId: args.runId, branch: saved, trace: [], costUsd: 0.01 };
  };
  runner.enforcesDailyCap = true;
  async function start(extra = {}) {
    server = createDemoServer({ runsDir, liveRunsDir, webDir, runPipeline: runner, rateLimit: 100, env: { DEMO_ACCESS_CODE: 'local-code' }, ...options.server, ...extra });
    await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
    return `http://127.0.0.1:${server.address().port}`;
  }
  const stop = () => new Promise(resolve => server.close(resolve));
  t.after(async () => { if (server?.listening) await stop(); await rm(base, { recursive: true, force: true }); });
  return { url: await start(), start, stop, liveRunsDir, runsDir, get calls() { return calls; }, contexts };
}

test('continuation is durable, reuses a child after restart in replay-only mode, and restores assets/history', async t => {
  const f = await setup(t);
  const created = completion(await (await post(f.url)).text());
  assert.equal(created.reused, false);
  assert.equal(created.continuation.rootRunId, 'root');
  assert.equal(created.continuation.path[0].branchId, 'b1');
  assert.equal(f.contexts[0].divergence, branch().divergence);
  assert.equal(f.calls, 1);
  const parent = await (await fetch(`${f.url}/runs/root`)).json();
  assert.deepEqual(parent.continuation.children, [{ branchId: 'b1', runId: created.runId, status: 'complete' }]);
  await f.stop();
  const url = await f.start({ env: { DEMO_ACCESS_CODE: 'local-code', DEMO_REPLAY_ONLY: 'true' } });
  const reused = completion(await (await post(url)).text());
  assert.equal(reused.reused, true);
  assert.equal(reused.runId, created.runId);
  assert.equal(f.calls, 1);
  assert.equal(await (await fetch(`${url}/runs/${created.runId}/hero.png`)).text(), 'saved-image');
  assert.equal((await fetch(`${url}/api/history`)).status, 403);
  const history = await (await fetch(`${url}/api/history`, { headers })).json();
  assert.equal(history.runs.length, 2);
  assert.equal(history.runs.find(item => item.id === created.runId).parentRunId, 'root');
  assert.equal((await post(url, { runId: created.runId, branchId: 'b1' })).status, 503);
});

test('second-generation context retains root divergence and ordered saved ancestry, with a bounded depth', async t => {
  const f = await setup(t, { server: { maxContinuationDepth: 2 } });
  const first = completion(await (await post(f.url)).text());
  const second = completion(await (await post(f.url, { runId: first.runId, branchId: 'b1' })).text());
  assert.equal(second.continuation.path.length, 2);
  assert.deepEqual(second.continuation.path.map(item => item.runId), ['root', first.runId]);
  assert.equal(f.contexts[1].divergence, branch().divergence);
  assert.equal((await post(f.url, { runId: second.runId, branchId: 'b1' })).status, 400);
  assert.equal(f.calls, 2);
});

test('the default continuation depth is six selected events and rejects a seventh', () => {
  const makePath = count => Array.from({ length: count }, (_, i) => ({
    runId: `run-${i + 1}`, branchId: 'b1', title: 'A saved astronomy event', year: 100 + i * 50,
    summary: 'Preserved star charts improve astronomical teaching.', place: { name: 'Alexandria', lat: 31, lon: 29 },
  }));
  const rootDivergence = 'What if the ancient library survived?';
  const parent = { id: 'run-6', divergence: rootDivergence, branch: branch(400) };
  const savedAtFive = { status: 'complete', rootDivergence, continuation: { rootRunId: 'run-1', path: makePath(5) } };
  assert.equal(MAX_CONTINUATION_DEPTH, 6);
  assert.equal(continuationFor(parent, 'b1', savedAtFive).path.length, 6);
  const savedAtSix = { status: 'complete', rootDivergence, continuation: { rootRunId: 'run-1', path: makePath(6) } };
  assert.throws(() => continuationFor({ ...parent, id: 'run-7', branch: branch(450) }, 'b1', savedAtSix), /continuation depth limit/);
});

test('server-issued browser cookie enforces the expansion cap and ignores rotated caller UUIDs', async t => {
  const parent = branch(); parent.branches.push({ ...parent.branches[0], id:'b2', title:'Coastal observatory' });
  const f = await setup(t, { parent, server: { env: { DEMO_ACCESS_CODE:'local-code', DEMO_MAX_EXPANSIONS_PER_SESSION:'1' } } });
  const cookie = await sessionCookie(f.url);
  const first = await post(f.url, { runId:'root', branchId:'b1' }, { ...headers, cookie });
  assert.equal(first.status, 200);
  assert.equal(first.headers.get('x-expansion-used'),'1','the streaming response reconciles the server ledger in the client');
  const duplicate = await post(f.url, { runId:'root', branchId:'b1' }, { ...headers, cookie });
  assert.equal(duplicate.status, 409, 'reentry cannot launch a duplicate while the original result is not fully materialized');
  const capped = await post(f.url, { runId:'root', branchId:'b2' }, { ...headers, cookie });
  assert.equal(capped.status, 429);
  assert.equal((await capped.json()).code, 'session_expansion_limit');
  const rotated = await post(f.url, { runId:'root', branchId:'b2' }, { ...headers, cookie:'otherwise_session=22222222-2222-4222-8222-222222222222' });
  assert.equal(rotated.status, 400, 'a caller supplied UUID is not a valid server-issued browser session');
});

test('saved geography survives manifests, completion events and second-generation canonical ancestry', async t => {
  const parent = branch();
  const geography = { version: 1, changes: [{ id: 'green-sahara', kind: 'vegetation', region: 'sahara', intensity: 0.8,
    assumption: 'The Sahara retains grasslands.', uncertainty: 'Rainfall boundaries remain hypothetical.' }] };
  parent.branches[0].geography = geography;
  const f = await setup(t, { parent });
  const root = await (await fetch(`${f.url}/runs/root`)).json();
  assert.deepEqual(root.branch.branches[0].geography, geography);
  const first = completion(await (await post(f.url)).text());
  assert.deepEqual(first.continuation.path[0].geography, geography);
  const child = await (await fetch(`${f.url}/runs/${first.runId}`)).json();
  assert.deepEqual(child.continuation.path[0].geography, geography);
  const second = completion(await (await post(f.url, { runId: first.runId, branchId: 'b1' })).text());
  assert.deepEqual(second.continuation.path.map(event => event.geography), [geography, geography]);
  assert.deepEqual(f.contexts[1].continuation.path.map(event => event.geography), [geography, geography]);
});

test('saved v2 geography is accepted by the explicit continuation path and reaches the stub runner intact', async t => {
  const parent=branch();
  const geography={version:2,seaLevelMeters:-120,continentalTransforms:[],changes:[{id:'doggerland-wetland-plain',kind:'vegetation',intensity:0.75,
    bounds:[-2,50,8,58.5],assumption:'Exposed shelf supports marsh, grassland, and mixed woodland.',uncertainty:'Vegetation density varies locally with rivers, soils, and climate.'}]};
  parent.branches[0].geography=geography;
  const f=await setup(t,{parent});
  const response=await post(f.url);
  assert.equal(response.status,200);
  const result=completion(await response.text());
  assert.equal(f.calls,1,'the injected runner is invoked once and no provider is configured');
  assert.deepEqual(f.contexts[0].continuation.path[0].geography,geography);
  assert.deepEqual(result.continuation.path[0].geography,geography);
});

test('recorded v2 lake geography with a bounded seed reaches the continuation runner once', async t => {
  const geography={version:2,seaLevelMeters:-120,continentalTransforms:[],changes:[
    {id:'doggerland-wetland-plain',bounds:[-2,50,8,58.5],kind:'vegetation',intensity:0.75,
      assumption:'Exposed shelf supports marsh, grassland, and mixed woodland.',uncertainty:'Vegetation density varies locally with rivers, soils, and climate.'},
    {id:'doggerland-reserve-lake',bounds:[1,52,4,54],kind:'lake',intensity:0.8,waterLevelMeters:-70,seed:[2.5,53],
      assumption:'Low embankments retain river water in a shallow basin above the lowered global sea level.',
      uncertainty:'Lake extent varies with rainfall, river inflow, embankment maintenance, and sedimentation.'},
  ],assumption:'Global sea level remains approximately 120 metres below present day.',uncertainty:'Lake extents and exact shorelines are approximate.'};
  const parent=branch();
  parent.branches.push({id:'b4',title:'Doggerland Wetland Reserve Lake Established',summary:'A managed lake supports wetland study and local water storage.',year:1968,
    place:{name:'Doggerland, North Sea',lat:53,lon:2.5},geography});
  const f=await setup(t,{parent});
  const response=await post(f.url,{runId:'root',branchId:'b4'});
  assert.equal(response.status,200);
  const result=completion(await response.text());
  assert.equal(f.calls,1,'the injected stub pipeline runs once; no provider is configured');
  assert.deepEqual(f.contexts[0].continuation.path[0].geography,geography);
  assert.deepEqual(result.continuation.path[0].geography,geography);
});

test('saved causal links remain part of the trusted ancestry and pass policy before generation', async t => {
  const parent = branch();
  parent.branches[0].causalLink = 'Preserved observations enable shared astronomy curricula.';
  const f = await setup(t, { parent });
  const created = completion(await (await post(f.url)).text());
  assert.equal(created.continuation.path[0].causalLink, parent.branches[0].causalLink);
  const next = completion(await (await post(f.url, { runId: created.runId, branchId: 'b1' })).text());
  assert.equal(next.continuation.path[0].causalLink, parent.branches[0].causalLink);
  const unsafe = branch(); unsafe.branches[0].causalLink = 'Military wars reshape the curriculum.';
  const blocked = await setup(t, { parent: unsafe });
  assert.equal((await post(blocked.url)).status, 400);
  assert.equal(blocked.calls, 0);
});

test('invalid, unauthenticated, cross-origin, oversized and forged-ancestry requests fail before generation', async t => {
  const f = await setup(t);
  assert.equal((await post(f.url, undefined, {})).status, 403);
  assert.equal((await post(f.url, undefined, { ...headers, origin: 'https://elsewhere.example' })).status, 403);
  assert.equal((await post(f.url, { runId: '../private', branchId: 'b1' })).status, 400);
  assert.equal((await post(f.url, { runId: 'absent', branchId: 'b1' })).status, 404);
  assert.equal((await post(f.url, { runId: 'root', branchId: 'missing' })).status, 400);
  assert.equal((await post(f.url, { runId: 'root', branchId: 'b1', continuation: { path: [] } })).status, 400);
  assert.equal((await post(f.url, { runId: 'root', branchId: 'b1', padding: 'x'.repeat(9000) })).status, 413);
  assert.equal(f.calls, 0);
});

test('blocked or policy-invalid saved branches never invoke a runner', async t => {
  const blocked = await setup(t, { parent: { ...branch(), status: 'blocked' } });
  assert.equal((await post(blocked.url)).status, 400);
  const unsafe = branch(); unsafe.branches[0].summary = 'Military armies and wars change astronomy.';
  const policy = await setup(t, { parent: unsafe });
  assert.equal((await post(policy.url)).status, 400);
  assert.equal(blocked.calls + policy.calls, 0);
});

test('failed reservations survive restart and prohibit automatic paid retry', async t => {
  const f = await setup(t, { runner: async () => { throw new Error('provider interrupted'); } });
  assert.match(await (await post(f.url)).text(), /event: error/);
  assert.equal(f.calls, 1);
  await f.stop(); const url = await f.start();
  const retry = await post(url);
  assert.equal(retry.status, 409);
  assert.equal((await retry.json()).status, 'failed');
  assert.equal(f.calls, 1);
});

test('a proven undispatched budget refusal preserves its attempt and permits one later reservation', async t => {
  let calls = 0, liveDir;
  const f = await setup(t, { runner: async ({ runId, continuation }) => {
    calls++;
    if (calls === 1) throw markUndispatchedBudgetError(new SpendCapError(3, 0.1, 3), { dispatchCount: () => 0 }, 0);
    const saved = branch(350 + continuation.path.length * 100);
    await mkdir(join(liveDir, runId), { recursive: true });
    await writeFile(join(liveDir, runId, 'branch.json'), JSON.stringify(saved));
    return { runId, branch: saved };
  } });
  liveDir = f.liveRunsDir;
  const refusalText = await (await post(f.url)).text();
  assert.match(refusalText, /Meta generation allowance reached/);
  assert.match(refusalText, /estimated at \$0\.1000; \$0\.0000 remains/);
  assert.match(refusalText, /"code":"budget_exhausted"/);
  assert.match(refusalText, /can choose this path again later/);
  assert.match(refusalText, /"status":"retryable"/);
  const store = createContinuationStore(f.liveRunsDir);
  assert.equal(store.edge('root', 'b1'), null);
  const attempts = await readdir(join(f.liveRunsDir, '.continuation', 'attempts'));
  assert.equal(attempts.length, 1);
  const previous = store.get(attempts[0].replace(/\.json$/, ''));
  assert.equal(previous.status, 'retryable');
  await f.stop(); const url = await f.start();
  const result = completion(await (await post(url)).text());
  assert.equal(result.branch.status, 'ok');
  assert.equal(calls, 2);
  assert.equal((await post(url)).status, 200);
  assert.equal(calls, 2, 'reopening the completed future does not dispatch again');
});

test('budget rejection after any dispatched request remains locked after restart', async t => {
  const f = await setup(t, { runner: async () => {
    throw markUndispatchedBudgetError(new SpendCapError(3, 0.1, 3), { dispatchCount: () => 1 }, 0);
  } });
  const text = await (await post(f.url)).text();
  assert.match(text, /"code":"budget_exhausted"/);
  assert.match(text, /Meta generation allowance reached/);
  assert.match(text, /continuation may contain partial work/);
  assert.match(text, /Automatic retry is disabled/);
  assert.match(text, /"status":"failed"/);
  assert.doesNotMatch(text, /"status":"retryable"/);
  await f.stop(); const url = await f.start();
  const rejected = await post(url);
  assert.equal(rejected.status, 409);
  assert.equal((await rejected.json()).status, 'failed');
  assert.equal(f.calls, 1);
});

test('explicit retry archives only a server-proven partial budget refusal and preserves the failed attempt', async t => {
  let liveDir, calls = 0;
  const f = await setup(t, { runner: async ({ runId, continuation }) => {
    calls++;
    if (calls === 1) throw markUndispatchedBudgetError(new SpendCapError(3, 0.1, 3), { dispatchCount: () => 1 }, 0);
    const saved = branch(350 + continuation.path.length * 100);
    await mkdir(join(liveDir, runId), { recursive: true });
    await writeFile(join(liveDir, runId, 'branch.json'), JSON.stringify(saved));
    return { runId, branch: saved };
  } });
  liveDir = f.liveRunsDir;
  const first = await (await post(f.url)).text();
  const firstError = JSON.parse(first.match(/event: error\ndata: (.+)/)?.[1] ?? '{}');
  assert.equal(firstError.status, 'failed');
  assert.equal(firstError.code, 'budget_exhausted');
  const store = createContinuationStore(f.liveRunsDir);
  const originalRunId = store.list().find(record => record.status === 'failed' && record.continuation?.parentRunId === 'root')?.id;
  assert.ok(originalRunId);

  const ordinary = await post(f.url);
  assert.equal(ordinary.status, 409, 'ordinary continuation requests cannot replay a partial paid attempt');
  assert.equal(f.calls, 1);
  const retried = await post(f.url, { runId: 'root', branchId: 'b1', retryBudgetFailure: true });
  assert.equal(completion(await retried.text()).branch.status, 'ok');
  assert.equal(f.calls, 2);

  const historical = store.get(originalRunId);
  assert.equal(historical.status, 'failed');
  assert.equal(historical.budgetFailure.source, 'shared-meta-client-spend-cap');
  assert.equal(historical.budgetFailure.terminalDispatch, 'refused-before-dispatch');
  const archivedEdges = await readdir(join(f.liveRunsDir, '.continuation', 'attempts'));
  assert.equal(archivedEdges.length, 1);
  const archived = JSON.parse(await readFile(join(f.liveRunsDir, '.continuation', 'attempts', archivedEdges[0]), 'utf8'));
  assert.equal(archived.runId, originalRunId);
  assert.equal(archived.previousStatus, 'failed');
  assert.equal(archived.budgetFailure.terminalDispatch, 'refused-before-dispatch');
  assert.equal(store.edge('root', 'b1').status, 'complete');
});

test('historical failed continuation trace proves the terminal spend refusal before an explicit retry', async t => {
  const f = await setup(t);
  const parentBranch = branch();
  const continuation = continuationFor({ id: 'root', status: 'complete', divergence: parentBranch.divergence, branch: parentBranch }, 'b1');
  const store = createContinuationStore(f.liveRunsDir);
  const edge = store.reserve('root', 'b1', continuation);
  const failedRunId = edge.runId;
  await mkdir(join(f.liveRunsDir, failedRunId), { recursive: true });
  await writeFile(join(f.liveRunsDir, failedRunId, 'trace.json'), JSON.stringify({ continuation, steps: [
    { step: 'topic-policy', costUsd: 0.03 },
    { step: 'agent', error: 'Meta spend cap reached: spent $3.0000 + next call ~$0.1000 > cap $3.00' },
  ] }));
  store.save({ id: failedRunId, status: 'failed', rootDivergence: continuation.rootDivergence, continuation });
  store.finish(edge, 'failed');

  const ordinary = await post(f.url);
  assert.equal(ordinary.status, 409);
  const discoverable = await ordinary.json();
  assert.equal(discoverable.status, 'failed');
  assert.equal(discoverable.code, 'budget_exhausted');
  assert.equal(f.calls, 0, 'eligibility discovery reads the saved trace without starting generation');
  assert.equal(store.get(failedRunId).budgetFailure, undefined, 'eligibility discovery does not mutate historical records');
  const parentManifest = await (await fetch(`${f.url}/runs/root`)).json();
  assert.equal(parentManifest.continuation.children.find(child => child.branchId === 'b1').code, 'budget_exhausted');
  assert.equal(store.get(failedRunId).budgetFailure, undefined, 'manifest proof remains read-only');

  const response = await post(f.url, { runId: 'root', branchId: 'b1', retryBudgetFailure: true });
  assert.equal(completion(await response.text()).branch.status, 'ok');
  assert.equal(f.calls, 1);
  assert.equal(store.get(failedRunId).status, 'failed', 'the historical run record remains intact');
  const archivedFiles = await readdir(join(f.liveRunsDir, '.continuation', 'attempts'));
  assert.equal(archivedFiles.length, 1);
  const archived = JSON.parse(await readFile(join(f.liveRunsDir, '.continuation', 'attempts', archivedFiles[0]), 'utf8'));
  assert.equal(archived.runId, failedRunId);
  assert.equal(archived.previousStatus, 'failed');
});

test('historical trace without an exact terminal budget refusal does not authorize retry', async t => {
  const f = await setup(t);
  const parentBranch = branch();
  const continuation = continuationFor({ id: 'root', status: 'complete', divergence: parentBranch.divergence, branch: parentBranch }, 'b1');
  const store = createContinuationStore(f.liveRunsDir);
  const edge = store.reserve('root', 'b1', continuation);
  const failedRunId = edge.runId;
  await mkdir(join(f.liveRunsDir, failedRunId), { recursive: true });
  await writeFile(join(f.liveRunsDir, failedRunId, 'trace.json'), JSON.stringify({ continuation, steps: [
    { step: 'topic-policy', costUsd: 0.03 },
    { step: 'agent', error: 'Provider unavailable after request dispatch' },
  ] }));
  store.save({ id: failedRunId, status: 'failed', rootDivergence: continuation.rootDivergence, continuation });
  store.finish(edge, 'failed');
  const response = await post(f.url, { runId: 'root', branchId: 'b1', retryBudgetFailure: true });
  assert.equal(response.status, 409);
  assert.equal((await response.json()).status, 'failed');
  assert.equal(f.calls, 0);
  assert.equal(store.edge('root', 'b1').status, 'failed');
});

test('historical spend-cap text with mismatched ancestry does not authorize retry', async t => {
  const f = await setup(t);
  const parentBranch = branch();
  const continuation = continuationFor({ id: 'root', status: 'complete', divergence: parentBranch.divergence, branch: parentBranch }, 'b1');
  const store = createContinuationStore(f.liveRunsDir);
  const edge = store.reserve('root', 'b1', continuation);
  await mkdir(join(f.liveRunsDir, edge.runId), { recursive: true });
  await writeFile(join(f.liveRunsDir, edge.runId, 'trace.json'), JSON.stringify({ continuation: { ...continuation, parentBranchId: 'forged' }, steps: [
    { step: 'topic-policy', costUsd: 0.03 },
    { step: 'agent', error: 'Meta spend cap reached: spent $3.0000 + next call ~$0.1000 > cap $3.00' },
  ] }));
  store.save({ id: edge.runId, status: 'failed', rootDivergence: continuation.rootDivergence, continuation });
  store.finish(edge, 'failed');
  const response = await post(f.url, { runId: 'root', branchId: 'b1', retryBudgetFailure: true });
  assert.equal(response.status, 409);
  assert.equal((await response.json()).status, 'failed');
  assert.equal(f.calls, 0);
  assert.equal(store.edge('root', 'b1').status, 'failed');
});

test('persisted historical proof revalidates its trace hash for manifest and retry checks', async t => {
  const f = await setup(t);
  const parentBranch = branch();
  const continuation = continuationFor({ id: 'root', status: 'complete', divergence: parentBranch.divergence, branch: parentBranch }, 'b1');
  const store = createContinuationStore(f.liveRunsDir);
  const edge = store.reserve('root', 'b1', continuation);
  await mkdir(join(f.liveRunsDir, edge.runId), { recursive: true });
  const traceText = JSON.stringify({ continuation, steps: [
    { step: 'topic-policy', costUsd: 0.03 },
    { step: 'agent', error: 'Meta spend cap reached: spent $3.0000 + next call ~$0.1000 > cap $3.00' },
  ] });
  await writeFile(join(f.liveRunsDir, edge.runId, 'trace.json'), traceText);
  const budgetFailure = { version: 1, source: 'persisted-harness-trace-spend-cap', terminalDispatch: 'refused-before-dispatch', spent: 3, estimate: 0.1, cap: 3, traceSha256: createHash('sha256').update(traceText).digest('hex') };
  store.save({ id: edge.runId, status: 'failed', rootDivergence: continuation.rootDivergence, continuation, budgetFailure });
  store.finish({ ...edge, budgetFailure }, 'failed');

  const before = await (await fetch(`${f.url}/runs/root`)).json();
  assert.equal(before.continuation.children[0].code, 'budget_exhausted');
  await writeFile(join(f.liveRunsDir, edge.runId, 'trace.json'), `${traceText}\n`);
  const after = await (await fetch(`${f.url}/runs/root`)).json();
  assert.equal(after.continuation.children[0].code, undefined, 'a changed trace no longer matches its persisted proof hash');
  const response = await post(f.url, { runId: 'root', branchId: 'b1', retryBudgetFailure: true });
  assert.equal(response.status, 409);
  assert.equal(f.calls, 0);
  assert.equal(store.edge('root', 'b1').status, 'failed');
});

test('client retry flag cannot authorize a fresh or uncertain continuation', async t => {
  const f = await setup(t, { runner: async () => { throw new Error('provider outcome unknown'); } });
  const fresh = await post(f.url, { runId: 'root', branchId: 'b1', retryBudgetFailure: true });
  assert.equal(fresh.status, 409);
  assert.match((await fresh.json()).error, /No server-recorded budget refusal/);
  assert.equal(f.calls, 0);
  assert.match(await (await post(f.url)).text(), /event: error/);
  const uncertain = await post(f.url, { runId: 'root', branchId: 'b1', retryBudgetFailure: true });
  assert.equal(uncertain.status, 409);
  assert.equal((await uncertain.json()).status, 'failed');
  assert.equal(f.calls, 1);
});

test('a runner cannot report a continuation complete without valid saved output', async t => {
  const f = await setup(t, { runner: async ({ runId }) => ({ runId, branch: branch() }) });
  const text = await (await post(f.url)).text();
  assert.match(text, /event: error/);
  assert.doesNotMatch(text, /event: complete/);
  assert.equal((await post(f.url)).status, 409);
  assert.equal(f.calls, 1);
});

test('atomic reservation blocks separate store instances and incomplete records remain blocked after restart', async t => {
  const f = await setup(t);
  const a = createContinuationStore(f.liveRunsDir), b = createContinuationStore(f.liveRunsDir);
  const reserved = a.reserve('root', 'b1', {});
  assert.equal(b.reserve('root', 'b1', {}), null);
  assert.equal(b.edge('root', 'b1').runId, reserved.runId);
  const response = await post(f.url);
  assert.equal(response.status, 409);
  assert.equal((await response.json()).status, 'in-progress');
  assert.equal(f.calls, 0);
});

test('an archive collision fails closed and never discards the existing reservation', async t => {
  const f = await setup(t);
  const store = createContinuationStore(f.liveRunsDir);
  const edge = store.reserve('root', 'b1', {});
  await writeFile(join(f.liveRunsDir, '.continuation', 'attempts', `${edge.runId}.json`), 'existing evidence');
  assert.throws(() => store.releaseUndispatched(edge), /already archived/);
  assert.equal(store.edge('root', 'b1').runId, edge.runId);
  assert.equal((await post(f.url)).status, 409);
  assert.equal(f.calls, 0);
});

test('double click cannot start a second runner and a disconnected run remains reserved', async t => {
  let started, aborted;
  const ready = new Promise(resolve => { started = resolve; });
  const stopped = new Promise(resolve => { aborted = resolve; });
  const f = await setup(t, { runner: async ({ signal }) => {
    started();
    await new Promise((resolve, reject) => signal.addEventListener('abort', () => { aborted(); reject(new Error('Disconnected')); }, { once: true }));
  } });
  const controller = new AbortController();
  const response = await fetch(`${f.url}/api/continue`, { method: 'POST', headers: { ...headers, cookie: await sessionCookie(f.url) }, signal: controller.signal, body: JSON.stringify({ runId: 'root', branchId: 'b1' }) });
  await ready;
  assert.equal((await post(f.url)).status, 409);
  controller.abort();
  await response.text().catch(() => {});
  await stopped;
  const retry = await post(f.url);
  assert.equal(retry.status, 409);
  assert.equal((await retry.json()).status, 'uncertain');
  assert.equal(f.calls, 1);
});

test('live root generation and explicit trusted import persist without exposing other output directories', async t => {
  const f = await setup(t);
  const generated = completion(await (await fetch(`${f.url}/api/run`, { method: 'POST', headers, body: JSON.stringify({ divergence: branch().divergence }) })).text());
  await mkdir(join(f.liveRunsDir, 'operator-run'));
  await writeFile(join(f.liveRunsDir, 'operator-run', 'branch.json'), JSON.stringify(branch()));
  await mkdir(join(f.liveRunsDir, 'private-output'));
  await writeFile(join(f.liveRunsDir, 'private-output', 'branch.json'), JSON.stringify(branch()));
  assert.equal((await fetch(`${f.url}/runs/operator-run`)).status, 404);
  await f.stop(); const url = await f.start({ importRunIds: ['operator-run', '../private-output'] });
  assert.equal((await fetch(`${url}/runs/${generated.runId}`)).status, 200);
  assert.equal((await fetch(`${url}/runs/operator-run`)).status, 200);
  assert.equal((await fetch(`${url}/runs/private-output`)).status, 404);
  assert.equal((await fetch(`${url}/runs/operator-run/spend.json`)).status, 404);
});

test('continuation capacity and rate-limit rejections are machine-readable retries', async t => {
  let release, started;
  const ready = new Promise(resolve => { started = resolve; });
  const runner = async ({ runId }) => { started(); await new Promise(resolve => { release = resolve; }); return { runId }; };
  const full = await setup(t, { runner, server: { maxConcurrentJobs: 1 } });
  const root = fetch(`${full.url}/api/run`, { method: 'POST', headers, body: JSON.stringify({ divergence: 'A preserved library' }) });
  await ready;
  const rejectedByCapacity = await post(full.url);
  assert.equal(rejectedByCapacity.status, 429);
  assert.equal((await rejectedByCapacity.json()).status, 'retryable');
  release();
  assert.match(await (await root).text(), /event: complete/);

  const limited = await setup(t, { server: { rateLimit: 1 } });
  const rootResult = await fetch(`${limited.url}/api/run`, { method: 'POST', headers, body: JSON.stringify({ divergence: 'A preserved library' }) });
  assert.equal(rootResult.status, 200);
  await rootResult.text();
  const rejectedByRate = await post(limited.url);
  assert.equal(rejectedByRate.status, 429);
  assert.equal((await rejectedByRate.json()).status, 'retryable');
});
