import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { createDemoServer } from '../server/index.js';
import { createHistoryStore } from '../src/demo/historyStore.js';
import { createHistoryService } from '../src/demo/historyService.js';
import { migrateSavedTree } from '../web/historyModel.js';

const access = { 'x-demo-access-code': 'history-actions-code' };
const event = (id, year, title, extras = {}) => ({ id, year, title, summary: `${title} shapes the landscape.`,
  place: { name: 'Sahara', lat: 20, lon: 10 }, causeEventId: 'q', era: 'Green Sahara', geography: { version: 1, changes: [] }, ...extras });

async function start(t, { liveRunsDir, service, env = { DEMO_ACCESS_CODE: 'history-actions-code' } }) {
  const server = createDemoServer({ runsDir: join(liveRunsDir, 'runs'), liveRunsDir, packagedReplayRoot: null,
    webDir: resolve('web'), env, historyService: service });
  await new Promise(resolveListen => server.listen(0, '127.0.0.1', resolveListen));
  t.after(async () => {
    if (!server.listening) return;
    await new Promise(resolveClose => server.close(resolveClose));
  });
  const url = `http://127.0.0.1:${server.address().port}`;
  const health = await fetch(`${url}/health`);
  const cookie = health.headers.get('set-cookie')?.split(';', 1)[0];
  assert.ok(cookie, 'server issues the durable browser session cookie');
  const headers = { ...access, cookie, 'content-type': 'application/json' };
  return { url, headers, server };
}

function seed(liveRunsDir) {
  const store = createHistoryStore(liveRunsDir);
  const question = { id: 'question-one', question: 'What if the Sahara remained green?', histories: [{ id: 'history-one', events: [
    event('root-event', -5000, 'Lakes sustain early settlements', { causeEventId: 'question-one' }),
    event('later-event', -2000, 'Communities tend river gardens', { causeEventId: 'root-event' }),
    event('later-event-two', -1500, 'Shallow basins support reed craft', { causeEventId: 'root-event' }),
  ] }] };
  store.save(question);
  return { store, question };
}

test('history actions are authorized, cached, weave with ripple flags, and support explicit Keep and Regenerate', async t => {
  const liveRunsDir = await mkdtemp(join(tmpdir(), 'office-history-actions-'));
  t.after(() => rm(liveRunsDir, { recursive: true, force: true }));
  const { store } = seed(liveRunsDir);
  let suggestionCalls = 0, rippleCalls = 0, regenerateCalls = 0;
  const agent = {
    client: { dispatchCount: () => suggestionCalls + rippleCalls + regenerateCalls },
    async suggest() {
      suggestionCalls++;
      return [{ id: 'suggestion-one', year: -3000, place: { name: 'Sahara', lat: 20, lon: 10 }, title: 'Canal gardens expand',
        summary: 'Communities share shallow water channels.', causeEventId: 'root-event', era: 'Green Sahara',
        geography: { version: 1, changes: [] }, verdict: 'fits', conflictsWith: null, reason: '' }];
    },
    async checkRipple() { rippleCalls++; return { inconsistent: true, reason: 'Later gardens assume the canals were never woven.' }; },
    async regenerateEvent({ event: target }) { regenerateCalls++; return { title: 'Updated river gardens', summary: target.summary, causeEventId: 'suggestion-one', era: target.era, geography: target.geography }; },
  };
  const service = createHistoryService({ store, agent, perSessionWindowCap: 1 });
  const { url, headers } = await start(t, { liveRunsDir, service });

  assert.equal((await fetch(`${url}/api/history/suggest`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' })).status, 403,
    'suggestions require the existing access code');
  const body = { questionId: 'question-one', historyId: 'history-one', window: { fromYear: -3500, toYear: -2500 } };
  const [first, concurrent] = await Promise.all([0, 1].map(() => fetch(`${url}/api/history/suggest`, { method: 'POST', headers, body: JSON.stringify(body) })));
  assert.equal(first.status, 200);
  assert.equal(concurrent.status, 200);
  assert.equal(suggestionCalls, 1, 'concurrent default requests share one paid generation');
  assert.equal((await first.json()).suggestions.length, 1);
  const cached = await fetch(`${url}/api/history/suggest`, { method: 'POST', headers, body: JSON.stringify(body) });
  assert.equal(cached.status, 200);
  assert.equal((await cached.json()).cached, true);
  assert.equal(suggestionCalls, 1, 'cached reads do not call the model');
  const more = await fetch(`${url}/api/history/suggest`, { method: 'POST', headers, body: JSON.stringify({ ...body, more: true }) });
  assert.equal(more.status, 429, 'More remains subject to the per-session window cap');

  const weave = await fetch(`${url}/api/history/weave`, { method: 'POST', headers,
    body: JSON.stringify({ questionId: 'question-one', historyId: 'history-one', suggestionId: 'suggestion-one' }) });
  assert.equal(weave.status, 200);
  const woven = await weave.json();
  assert.equal(woven.event.id, 'suggestion-one');
  assert.equal(woven.ripple.length, 2);
  assert.equal(rippleCalls, 2);
  const withTwoFlags = store.get('question-one');
  const target = withTwoFlags.histories[0].events.find(item => item.id === 'later-event');
  target.checkFlags.push({ kind: 'weave-ripple', eventId: 'later-event', wovenEventId: 'root-event', year: target.year,
    status: 'review', message: 'Written before the root event was woven in.', actions: ['keep', 'regenerate'] });
  store.save(withTwoFlags);
  const keep = await fetch(`${url}/api/history/keep`, { method: 'POST', headers,
    body: JSON.stringify({ questionId: 'question-one', historyId: 'history-one', eventId: 'later-event', wovenEventId: 'root-event' }) });
  assert.equal(keep.status, 200);
  const keptEvent = (await keep.json()).event;
  assert.equal(keptEvent.checkFlags.find(flag => flag.wovenEventId === 'root-event').status, 'kept');
  assert.equal(keptEvent.checkFlags.find(flag => flag.wovenEventId === 'suggestion-one').status, 'review', 'Keep resolves only the selected ripple flag');
  const regenerate = await fetch(`${url}/api/history/regenerate`, { method: 'POST', headers,
    body: JSON.stringify({ questionId: 'question-one', historyId: 'history-one', eventId: 'later-event', wovenEventId: 'suggestion-one' }) });
  assert.equal(regenerate.status, 200);
  const regeneratedEvent = (await regenerate.json()).event;
  assert.equal(regeneratedEvent.title, 'Updated river gardens');
  assert.equal(regeneratedEvent.checkFlags.some(flag => flag.wovenEventId === 'root-event' && flag.status === 'kept'), true,
    'Regenerate preserves unrelated ripple flags');
  assert.equal(regenerateCalls, 1);
});

test('history preferences default on, persist by browser session, and legacy history response stays unchanged', async t => {
  const liveRunsDir = await mkdtemp(join(tmpdir(), 'office-history-pref-'));
  t.after(() => rm(liveRunsDir, { recursive: true, force: true }));
  const { store } = seed(liveRunsDir);
  const service = createHistoryService({ store, agent: { async suggest() { return []; } } });
  const { url, headers } = await start(t, { liveRunsDir, service });
  const sessionId = /otherwise_session=([^;]+)/.exec(headers.cookie)[1];
  store.reserveWindow({ questionId: 'question-one', historyId: 'history-one', window: { fromYear: -800, toYear: -200 },
    requestId: 'empty-window', userId: 'demo', sessionId, cap: 5 });
  store.completeWindow({ questionId: 'question-one', historyId: 'history-one', window: { fromYear: -800, toYear: -200 },
    requestId: 'empty-window', suggestions: [] });
  const histories = await fetch(`${url}/api/histories`, { headers });
  const history = (await histories.json()).questions.find(item => item.id === 'question-one').histories[0];
  assert.deepEqual(history.suggestionWindows, [{ window: { fromYear: -800, toYear: -200 }, status: 'ready', batches: 1, suggestionCount: 0 }],
    'an empty completed window remains cached and visible to clients');
  const before = await fetch(`${url}/api/history/preferences`, { headers: access });
  assert.equal(before.status, 403, 'preferences require a valid browser session');
  const preference = await fetch(`${url}/api/history/preferences`, { headers });
  assert.deepEqual(await preference.json(), { autoSuggest: true });
  const changed = await fetch(`${url}/api/history/preferences`, { method: 'PUT', headers, body: JSON.stringify({ autoSuggest: false }) });
  assert.deepEqual(await changed.json(), { autoSuggest: false });
  const legacy = await fetch(`${url}/api/history`, { headers });
  assert.equal(legacy.status, 200);
  assert.deepEqual(Object.keys(await legacy.json()), ['runs']);
});

test('a pending window recovered after restart is uncertain and cannot auto-dispatch again', async t => {
  const liveRunsDir = await mkdtemp(join(tmpdir(), 'office-history-restart-'));
  t.after(() => rm(liveRunsDir, { recursive: true, force: true }));
  const { store } = seed(liveRunsDir);
  store.reserveWindow({ questionId: 'question-one', historyId: 'history-one', window: { fromYear: -3500, toYear: -2500 },
    requestId: 'stale-request', userId: 'demo', sessionId: 'session-123', cap: 5 });
  const restartedStore = createHistoryStore(liveRunsDir);
  let calls = 0;
  const service = createHistoryService({ store: restartedStore, agent: { async suggest() { calls++; return []; } } });
  const { url, headers } = await start(t, { liveRunsDir, service });
  const response = await fetch(`${url}/api/history/suggest`, { method: 'POST', headers,
    body: JSON.stringify({ questionId: 'question-one', historyId: 'history-one', window: { fromYear: -3500, toYear: -2500 } }) });
  assert.equal(response.status, 409);
  assert.equal((await response.json()).code, 'generation_uncertain');
  assert.equal(calls, 0, 'restart recovery does not redispatch a possibly paid request');
});

test('world-entry accounting is durable and counts one event once across scene, cutout, and model routes', async t => {
  const liveRunsDir = await mkdtemp(join(tmpdir(), 'office-history-world-count-'));
  t.after(() => rm(liveRunsDir, { recursive: true, force: true }));
  const store = createHistoryStore(liveRunsDir);
  const first = store.recordWorldEntered({ userId: 'demo', sessionId: 'session-abc', worldId: 'world-hash-one' });
  const duplicate = store.recordWorldEntered({ userId: 'demo', sessionId: 'session-abc', worldId: 'world-hash-one' });
  const second = store.recordWorldEntered({ userId: 'demo', sessionId: 'session-abc', worldId: 'world-hash-two' });
  assert.equal(first.counted, true);
  assert.equal(duplicate.counted, false);
  assert.equal(second.usage.worldsEntered, 2);
  const restarted = createHistoryStore(liveRunsDir);
  assert.equal(restarted.recordWorldEntered({ userId: 'demo', sessionId: 'session-abc', worldId: 'world-hash-one' }).counted, false);
  assert.equal(restarted.usage('demo', 'session-abc').worldsEntered, 2);
  const persisted = await readFile(join(liveRunsDir, '.history', 'usage-v1.json'), 'utf8');
  assert.doesNotMatch(persisted, /world-hash-one|world-hash-two|session-abc|demo/);
});

test('window caps include reserved attempts, while generated-window usage counts completed batches only', async t => {
  const liveRunsDir = await mkdtemp(join(tmpdir(), 'office-history-window-usage-'));
  t.after(() => rm(liveRunsDir, { recursive: true, force: true }));
  const store = createHistoryStore(liveRunsDir);
  const identity = { questionId: 'q-usage', historyId: 'h-usage', window: { fromYear: -500, toYear: -100 } };
  store.reserveWindow({ ...identity, requestId: 'spend-refused', userId: 'demo', sessionId: 'session-usage', cap: 1 });
  store.failWindow({ ...identity, requestId: 'spend-refused', uncertain: false, reason: 'spend-cap' });
  assert.equal(store.usage('demo', 'session-usage').suggestionWindowsGenerated, 0, 'pre-dispatch spend refusal is not a generated window');
  assert.equal(store.reserveWindow({ ...identity, requestId: 'automatic-retry', userId: 'demo', sessionId: 'session-usage', cap: 1 }).status, 'failed',
    'the failed reservation still prevents an implicit retry');
  assert.equal(store.reserveWindow({ ...identity, requestId: 'explicit-more', more: true, userId: 'demo', sessionId: 'session-usage', cap: 1 }).status, 'capped',
    'all attempts remain subject to the session cap');
});

test('migrated suggestion windows remain ready and empty after weaving the last candidate across GET and restart', async t => {
  const liveRunsDir = await mkdtemp(join(tmpdir(), 'office-history-migrated-cache-'));
  t.after(() => rm(liveRunsDir, { recursive: true, force: true }));
  const runsDir = join(liveRunsDir, 'runs'), runDir = join(runsDir, 'legacy-root');
  await mkdir(runDir, { recursive: true });
  await writeFile(join(runDir, 'branch.json'), JSON.stringify({ status: 'ok', divergence: 'What if the Sahara remained green?',
    branches: [
      event('visited', -4000, 'Lake settlements grow', { causeEventId: 'legacy-root' }),
      event('candidate-a', -3000, 'Shallow canal gardens spread', { causeEventId: 'legacy-root' }),
      event('candidate-b', -1000, 'Reed craft follows the basin', { causeEventId: 'legacy-root' }),
    ], hero: { branchId: 'visited' } }));
  let calls = 0, compatibilityCalls = 0;
  const makeService = () => createHistoryService({ store: createHistoryStore(liveRunsDir), agent: {
    async suggest() { calls++; return []; }, async checkRipple() { calls++; return { inconsistent: false }; },
    async checkSuggestion() { compatibilityCalls++; return { verdict: 'fits', conflictsWith: null, reason: '' }; },
  } });
  const first = await start(t, { liveRunsDir, service: makeService() });
  const initialResponse = await fetch(`${first.url}/api/histories`, { headers: first.headers });
  const initialQuestion = (await initialResponse.json()).questions.find(item => item.id === 'legacy-root');
  const initialHistory = initialQuestion.histories[0];
  const consumed = initialHistory.suggestions.find(item => item.suggestionForEventId === 'legacy-root:candidate-a');
  const preserved = initialHistory.suggestions.find(item => item.suggestionForEventId === 'legacy-root:candidate-b');
  assert.ok(consumed && preserved, 'the P1 saved-tree migration created both cached possibilities');
  const weave = await fetch(`${first.url}/api/history/weave`, { method: 'POST', headers: first.headers,
    body: JSON.stringify({ questionId: 'legacy-root', historyId: initialHistory.id, suggestionId: consumed.id }) });
  assert.equal(weave.status, 200);
  await weave.json();
  const afterWeave = (await (await fetch(`${first.url}/api/histories`, { headers: first.headers })).json()).questions.find(item => item.id === 'legacy-root').histories[0];
  assert.equal(afterWeave.suggestions.some(item => item.id === consumed.id), false, 'the woven candidate stays consumed after legacy migration reruns');
  assert.equal(afterWeave.suggestions.some(item => item.id === preserved.id), true, 'other unwoven candidates remain available');
  assert.deepEqual(afterWeave.suggestionWindows.find(item => item.window.fromYear === consumed.window.fromYear),
    { window: consumed.window, status: 'ready', batches: 1, suggestionCount: 0 }, 'the consumed window remains cached even when empty');
  assert.equal(calls, 0, 'migrated cache weaving does not invoke Wonder or unrelated ripple checks');
  assert.equal(compatibilityCalls, 1, 'the remaining migrated candidate is explicitly checked against the changed history');

  await new Promise(resolveClose => first.server.close(resolveClose));
  const restarted = await start(t, { liveRunsDir, service: makeService() });
  const afterRestart = (await (await fetch(`${restarted.url}/api/histories`, { headers: restarted.headers })).json())
    .questions.find(item => item.id === 'legacy-root').histories[0];
  assert.equal(afterRestart.suggestions.some(item => item.id === consumed.id), false);
  assert.equal(afterRestart.suggestions.some(item => item.id === preserved.id), true);
  assert.deepEqual(afterRestart.suggestionWindows.find(item => item.window.fromYear === consumed.window.fromYear),
    { window: consumed.window, status: 'ready', batches: 1, suggestionCount: 0 });
  assert.equal(calls, 0, 'restart and migrated-cache reads never redispatch generation or ripple checks');
  assert.equal(compatibilityCalls, 1, 'the persisted compatibility revision prevents a repeated Spark check');
});

test('duplicate persisted history IDs recover four immutable paths and keep later weaving scoped to one history', async t => {
  const liveRunsDir = await mkdtemp(join(tmpdir(), 'office-history-collision-recovery-'));
  t.after(() => rm(liveRunsDir, { recursive: true, force: true }));
  const divergence = 'What if the Sahara remained green?';
  const branch = (id, year, title) => ({ id, year, title, summary: `${title} shapes the region.`, place: { name: 'Sahara', lat: 20, lon: 10 } });
  const a = branch('a', -5000, 'Lake basins form');
  const b = branch('b', -4000, 'Water keepers share channels');
  const savedRun = (runId, branches, extras = {}) => ({ runId, run: { id: runId, divergence, branches, ...extras } });
  const root = savedRun('deep-root', [a, branch('candidate-x', -2800, 'Small gardens grow'), branch('candidate-y', -2600, 'Reed paths cross the basin')], { hero: { branchId: 'a' } });
  const middle = savedRun('deep-middle', [b], { hero: { branchId: 'b' }, continuation: { rootRunId: 'deep-root', path: [
    { runId: 'deep-root', branchId: 'a', ...a },
  ] } });
  const leaves = ['c1', 'c2', 'c3', 'c4'].map((branchId, index) => {
    const leaf = branch(branchId, -2300 + index * 100, `Deep visited path ${branchId}`);
    return savedRun(`deep-leaf-${branchId}`, [], { continuation: { rootRunId: 'deep-root', path: [
      { runId: 'deep-root', branchId: 'a', ...a }, { runId: 'deep-middle', branchId: 'b', ...b },
      { runId: `deep-leaf-${branchId}`, branchId, ...leaf },
    ] } });
  });
  const records = [root, middle, ...leaves];
  const migrated = migrateSavedTree(records).questions[0];
  assert.equal(migrated.histories.length, 4);
  assert.equal(new Set(migrated.histories.map(item => item.id)).size, 4);
  const owner = migrated.histories.find(item => item.suggestions?.some(suggestion => suggestion.id === 'suggestion:deep-root:candidate-x'));
  assert.ok(owner, 'the real migration assigns candidate suggestions to one path');
  const selected = owner.suggestions.find(item => item.id === 'suggestion:deep-root:candidate-x');
  const woven = { ...selected };
  delete woven.window; delete woven.verdict; delete woven.conflictsWith; delete woven.reason; delete woven.suggestionForEventId;
  const corruptHistory = { ...structuredClone(owner), id: 'history-collided', events: [...structuredClone(owner.events), woven],
    suggestions: owner.suggestions.filter(item => item.id !== selected.id) };
  const statePath = join(liveRunsDir, '.history', 'state-v1.json');
  await mkdir(join(liveRunsDir, '.history'), { recursive: true });
  const corruptState = { schemaVersion: 1, questions: { 'deep-root': { ...migrated,
    histories: Array.from({ length: 4 }, () => structuredClone(corruptHistory)) } }, windowBatches: {}, preferences: {} };
  await writeFile(statePath, JSON.stringify(corruptState));

  const store = createHistoryStore(liveRunsDir);
  const recovery = store.migrateLegacy(records);
  const repaired = recovery.questions.find(item => item.id === 'deep-root');
  assert.equal(repaired.histories.length, 4);
  assert.equal(new Set(repaired.histories.map(item => item.id)).size, 4);
  assert.deepEqual(repaired.histories.map(item => item.events.at(-1).id).filter(id => id.startsWith('deep-leaf-')).sort(),
    ['deep-leaf-c1:c1', 'deep-leaf-c2:c2', 'deep-leaf-c3:c3', 'deep-leaf-c4:c4']);
  assert.equal(repaired.histories.filter(item => item.events.some(event => event.id === woven.id)).length, 1,
    'the provable woven event is restored only to its legacy suggestion owner');
  assert.ok(JSON.parse(await readFile(statePath, 'utf8')).recoveryReceipts, 'the repair leaves a durable recovery receipt');
  assert.equal(new Set(createHistoryStore(liveRunsDir).get('deep-root').histories.map(item => item.id)).size, 4);
  const weaveOwner = repaired.histories.find(item => item.suggestions?.some(suggestion => suggestion.id === 'suggestion:deep-root:candidate-y'));
  assert.ok(weaveOwner, 'the recovered path retains its other unwoven legacy suggestion');
  const beforePaths = new Map(repaired.histories.map(history => [history.id, history.events.map(event => event.id)]));
  let compatibilityCalls = 0;
  const service = createHistoryService({ store, agent: { async suggest() { return []; },
    async checkSuggestion() { compatibilityCalls++; return { verdict: 'fits', conflictsWith: null, reason: '' }; },
    async checkRipple() { return { inconsistent: false }; } } });
  await service.weave({ questionId: 'deep-root', historyId: weaveOwner.id, suggestionId: 'suggestion:deep-root:candidate-y' });
  assert.equal(compatibilityCalls, 1, 'recovery-scoped weaving explicitly rechecks its stale migrated candidate');
  const afterPaths = store.get('deep-root').histories;
  const changedPaths = afterPaths.filter(history => JSON.stringify(history.events.map(event => event.id)) !== JSON.stringify(beforePaths.get(history.id)));
  assert.equal(changedPaths.length, 1, 'weaving after recovery updates only the selected history');
  assert.ok(changedPaths[0].events.some(event => event.id === 'suggestion:deep-root:candidate-y'));

  const unsafeRoot = await mkdtemp(join(tmpdir(), 'office-history-collision-guard-'));
  t.after(() => rm(unsafeRoot, { recursive: true, force: true }));
  await mkdir(join(unsafeRoot, '.history'), { recursive: true });
  await writeFile(join(unsafeRoot, '.history', 'state-v1.json'), JSON.stringify(corruptState));
  const unsafeStore = createHistoryStore(unsafeRoot);
  assert.throws(() => unsafeStore.get('deep-root'), /Duplicate history IDs/, 'unreconciled duplicates fail closed');
  assert.throws(() => unsafeStore.save(corruptState.questions['deep-root']), /Duplicate history/, 'normalization also refuses to persist duplicate identities');
});

test('keyless history preserves stale migrated suggestions as pending and requires explicit More for new generation', async t => {
  const liveRunsDir = await mkdtemp(join(tmpdir(), 'office-history-replay-stale-'));
  t.after(() => rm(liveRunsDir, { recursive: true, force: true }));
  const runDir = join(liveRunsDir, 'runs', 'legacy-replay-root');
  await mkdir(runDir, { recursive: true });
  await writeFile(join(runDir, 'branch.json'), JSON.stringify({ status: 'ok', divergence: 'What if the Sahara remained green?',
    branches: [
      event('visited', -4000, 'Lake settlements grow', { causeEventId: 'legacy-replay-root' }),
      event('candidate-a', -3000, 'Shallow canal gardens spread', { causeEventId: 'legacy-replay-root' }),
      event('candidate-b', -1000, 'Reed craft follows the basin', { causeEventId: 'legacy-replay-root' }),
    ], hero: { branchId: 'visited' } }));
  const replay = await start(t, { liveRunsDir, env: { DEMO_ACCESS_CODE: 'history-actions-code' } });
  const migrated = (await (await fetch(`${replay.url}/api/histories`, { headers: replay.headers })).json()).questions
    .find(item => item.id === 'legacy-replay-root').histories[0];
  const first = migrated.suggestions.find(item => item.suggestionForEventId === 'legacy-replay-root:candidate-a');
  const second = migrated.suggestions.find(item => item.suggestionForEventId === 'legacy-replay-root:candidate-b');
  assert.ok(first && second);
  const firstWeave = await fetch(`${replay.url}/api/history/weave`, { method: 'POST', headers: replay.headers,
    body: JSON.stringify({ questionId: 'legacy-replay-root', historyId: migrated.id, suggestionId: first.id }) });
  assert.equal(firstWeave.status, 200, 'the migrated candidate remains directly usable before its history changes');
  const staleWeave = await fetch(`${replay.url}/api/history/weave`, { method: 'POST', headers: replay.headers,
    body: JSON.stringify({ questionId: 'legacy-replay-root', historyId: migrated.id, suggestionId: second.id }) });
  assert.equal(staleWeave.status, 409, 'a stale compatibility verdict is not silently trusted');
  const staleBody = await staleWeave.json();
  assert.equal(staleBody.code, 'suggestion_recheck_pending');
  assert.equal(staleBody.suggestion.id, second.id);
  assert.equal(staleBody.suggestion.recheckStatus, 'pending');
  const saved = (await (await fetch(`${replay.url}/api/histories`, { headers: replay.headers })).json()).questions
    .find(item => item.id === 'legacy-replay-root').histories[0];
  assert.equal(saved.suggestions.find(item => item.id === second.id).recheckStatus, 'pending', 'the unavailable check state survives GET');
  const more = await fetch(`${replay.url}/api/history/suggest`, { method: 'POST', headers: replay.headers,
    body: JSON.stringify({ questionId: 'legacy-replay-root', historyId: migrated.id, window: second.window, more: true }) });
  assert.equal(more.status, 503, 'a saved stale candidate does not trigger generation; a new batch needs explicit live More');
});
