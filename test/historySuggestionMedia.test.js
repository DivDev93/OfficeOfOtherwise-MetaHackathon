import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createDemoServer } from '../server/index.js';
import { createHistoryStore } from '../src/demo/historyStore.js';
import { createHistoryMediaStore, historyEventRevision, legacyHistoryEventRevision } from '../src/demo/historyMediaStore.js';
import { SpendCapError, markUndispatchedBudgetError } from '../src/lib/metaClient.js';

const PNG = Buffer.from('89504e470d0a1a0a', 'hex');
const identity = { questionId: 'question:prefix-01', historyId: 'history-question%3Aprefix-01', eventId: 'question:prefix-01:b2' };
const window = { fromYear: -3000, toYear: -2001 };
const existingEvent = { id: 'question:prefix-01:root', year: -2400, title: 'Medicinal lakeside gardens',
  summary: 'Water channels sustain medicinal gardens by the lakes.', place: { name: 'Sahara', lat: 20, lon: 10 }, causeEventId: identity.questionId };
const suggestion = { id: identity.eventId, year: -2200, title: 'Lakeside gardens share medicine',
  summary: 'Communities share medicinal plants grown beside the lakes.', place: { name: 'Sahara', lat: 20, lon: 10 },
  causeEventId: existingEvent.id, suggestionForEventId: existingEvent.id, window, verdict: 'fits', historyRevision: 'history-snapshot' };

function fixtureHistoryService(store) {
  return { async weave({ questionId, historyId, suggestionId }) {
    const question = store.get(questionId), history = question.histories.find(item => item.id === historyId);
    const candidate = history.suggestions.find(item => item.id === suggestionId);
    if (!candidate) throw new Error('Expected the current cached suggestion');
    const event = { ...candidate };
    for (const key of ['window', 'verdict', 'conflictsWith', 'reason', 'generatedAt', 'historyRevision', 'recheckStatus', 'recheckReason']) delete event[key];
    const saved = store.save({ ...question, histories: question.histories.map(item => item.id === historyId
      ? { ...item, events: [...item.events, event], suggestions: item.suggestions.filter(savedSuggestion => savedSuggestion.id !== suggestionId) } : item) });
    const savedHistory = saved.histories.find(item => item.id === historyId);
    return { question: saved, history: savedHistory, event: savedHistory.events.find(item => item.id === suggestionId) };
  } };
}

async function start(t, renderScene, { maxExpansions = 1, weave = true, legacyMedia, segmentHistoryCutout, maxConcurrentJobs = 3 } = {}) {
  const root = await mkdtemp(join(tmpdir(), 'history-suggestion-media-'));
  const liveRunsDir = join(root, 'live'), runsDir = join(root, 'runs'), webDir = join(root, 'web');
  await Promise.all([mkdir(liveRunsDir), mkdir(runsDir), mkdir(webDir)]);
  const store = createHistoryStore(liveRunsDir);
  store.save({ id: identity.questionId, question: 'What if the Sahara remained green?', title: 'Green Sahara',
    divergenceYear: -2400, divergencePlace: existingEvent.place,
    histories: [{ id: identity.historyId, events: [existingEvent], suggestions: [] }] });
  store.reserveWindow({ ...identity, window, requestId: 'seed-window', userId: 'demo', sessionId: 'seed-session', cap: 10 });
  store.completeWindow({ ...identity, window, requestId: 'seed-window', suggestions: [suggestion] });
  if (legacyMedia) {
    const savedEvent = store.get(identity.questionId).histories[0].events[0];
    const media = createHistoryMediaStore(liveRunsDir);
    const reserved = media.reserve({ questionId: identity.questionId, historyId: identity.historyId,
      eventId: savedEvent.id, revision: legacyHistoryEventRevision(savedEvent), kind: 'scene' });
    if (legacyMedia === 'complete') media.complete(reserved.record, PNG);
  }
  renderScene.enforcesDailyCap = true;
  const server = createDemoServer({ runsDir, liveRunsDir, webDir, packagedReplayRoot: null,
    env: { META_API_KEY: 'fixture-no-network-key', META_SPEND_CAP_USD: '10', META_DAILY_SPEND_CAP_USD: '10',
      DEMO_ACCESS_CODE: 'media-test-code', DEMO_MAX_EXPANSIONS_PER_SESSION: String(maxExpansions),
      DEMO_MAX_CONCURRENT_JOBS: String(maxConcurrentJobs) },
    renderHistoryScene: renderScene, ...(segmentHistoryCutout ? { segmentHistoryCutout } : {}),
    ...(weave ? { historyService: fixtureHistoryService(store) } : {}) });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(async () => {
    if (server.listening) await new Promise((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
    await rm(root, { recursive: true, force: true });
  });
  const url = `http://127.0.0.1:${server.address().port}`;
  const health = await fetch(`${url}/health`);
  const cookie = health.headers.get('set-cookie')?.split(';', 1)[0];
  const headers = { cookie, origin: url, 'sec-fetch-site': 'same-origin', 'x-demo-access-code': 'media-test-code', 'content-type': 'application/json' };
  return { url, headers, liveRunsDir, store };
}

const post = (base, path, headers, body) => fetch(`${base}${path}`, { method: 'POST', headers, body: JSON.stringify(body) });
const getHistories = async server => (await (await fetch(`${server.url}/api/histories`, { headers: server.headers })).json()).questions
  .find(question => question.id === identity.questionId).histories.find(history => history.id === identity.historyId);

test('cached suggestion scene persists across reload and weave using exact prefixed IDs', async t => {
  let calls = 0;
  const scene = async ({ prompt }) => { calls++; assert.match(prompt, /Lakeside gardens share medicine/); return { buffer: PNG, mime: 'image/png' }; };
  const server = await start(t, scene);
  const prepared = await post(server.url, '/api/history/scene', server.headers, identity);
  const body = await prepared.json();
  assert.equal(prepared.status, 200);
  assert.deepEqual({ status: body.status, attached: body.attached }, { status: 'complete', attached: true });
  assert.match(body.url, /^\/history-media\/[a-f0-9]{64}\.png$/);
  assert.equal((await getHistories(server)).suggestions[0].sceneRef.url, body.url);
  assert.equal((await (await post(server.url, '/api/history/scene', server.headers, identity)).json()).reused, true);
  assert.equal(calls, 1);

  const woven = await post(server.url, '/api/history/weave', server.headers, { questionId: identity.questionId,
    historyId: identity.historyId, suggestionId: identity.eventId });
  const wovenBody = await woven.json();
  assert.equal(woven.status, 200);
  assert.equal('suggestionForEventId' in wovenBody.event, false,
    'normalization drops the migration-only suggestion lineage marker when it becomes an event');
  assert.equal(wovenBody.event.sceneRef.url, body.url, 'weave response carries the persisted suggestion image');
  assert.equal((await getHistories(server)).events.find(item => item.id === identity.eventId).sceneRef.url, body.url,
    'reload after weave retains the same image reference');
  assert.equal(server.store.usage('demo', server.headers.cookie.match(/otherwise_session=([^;]+)/)[1]).worldsEntered, 1);
});

test('concurrent suggestion preparation deduplicates dispatch and survives a weave race', async t => {
  let calls = 0, signalStarted, release;
  const started = new Promise(resolve => { signalStarted = resolve; });
  const pending = new Promise(resolve => { release = resolve; });
  const scene = async () => { calls++; signalStarted(); await pending; return { buffer: PNG, mime: 'image/png' }; };
  const server = await start(t, scene);
  const first = post(server.url, '/api/history/scene', server.headers, identity);
  await started;
  const duplicate = await post(server.url, '/api/history/scene', server.headers, identity);
  assert.equal(duplicate.status, 202);
  assert.deepEqual(await duplicate.json(), { status: 'pending' });
  const woven = await post(server.url, '/api/history/weave', server.headers, { questionId: identity.questionId,
    historyId: identity.historyId, suggestionId: identity.eventId });
  assert.equal(woven.status, 200);
  assert.equal('suggestionForEventId' in (await woven.json()).event, false,
    'the in-flight case also exercises normalized migrated suggestions');
  release();
  const completed = await first, result = await completed.json();
  assert.equal(completed.status, 200);
  assert.equal(result.attached, true, JSON.stringify({ result, current: server.store.get(identity.questionId)?.histories[0] }));
  assert.equal(calls, 1);
  assert.equal((await getHistories(server)).events.find(item => item.id === identity.eventId).sceneRef.url, result.url);
});

test('undispatched suggestion image budget refusal stays retryable without double-counting its world', async t => {
  let calls = 0;
  const refusal = markUndispatchedBudgetError(new SpendCapError(1.25, 0.1, 1.3), { dispatchCount: () => 0 }, 0);
  const scene = async () => {
    calls++;
    if (calls === 1) throw refusal;
    return { buffer: PNG, mime: 'image/png' };
  };
  const server = await start(t, scene);
  const first = await post(server.url, '/api/history/scene', server.headers, identity);
  const denied = await first.json();
  assert.equal(first.status, 503);
  assert.equal(denied.status, 'retryable');
  assert.equal(denied.code, 'budget_exhausted');
  assert.equal((await getHistories(server)).suggestions[0].sceneRef, undefined);
  const retry = await post(server.url, '/api/history/scene', server.headers, identity);
  assert.equal((await retry.json()).status, 'complete');
  assert.equal(calls, 2);
  const sessionId = /otherwise_session=([^;]+)/.exec(server.headers.cookie)[1];
  assert.equal(server.store.usage('demo', sessionId).worldsEntered, 1);
});

test('legacy event image identities reuse saved output and mark interrupted reservations unknown', async t => {
  let calls = 0;
  const scene = async () => { calls++; return { buffer: PNG, mime: 'image/png' }; };
  const completeServer = await start(t, scene, { legacyMedia: 'complete' });
  const saved = await getHistories(completeServer);
  const event = saved.events.find(item => item.id === existingEvent.id);
  assert.equal(event.sceneRef.status, 'complete');
  assert.match(event.sceneRef.url, /^\/history-media\/[a-f0-9]{64}\.png$/);
  const reused = await post(completeServer.url, '/api/history/scene', completeServer.headers,
    { ...identity, eventId: existingEvent.id });
  assert.equal((await reused.json()).reused, true);
  assert.equal(calls, 0, 'pre-change completed output cannot be regenerated');

  const interruptedServer = await start(t, scene, { legacyMedia: 'pending' });
  const interrupted = await getHistories(interruptedServer);
  assert.equal(interrupted.events.find(item => item.id === existingEvent.id).sceneRef.status, 'unknown');
  const unknown = await post(interruptedServer.url, '/api/history/scene', interruptedServer.headers,
    { ...identity, eventId: existingEvent.id });
  assert.equal((await unknown.json()).status, 'unknown');
  assert.equal(calls, 0, 'pre-change interrupted output is never automatically dispatched again');
});

test('unknown history media retries only by explicit prior key and coalesces the same attempt', async t => {
  let calls = 0, signalStarted, release;
  const started = new Promise(resolve => { signalStarted = resolve; });
  const pending = new Promise(resolve => { release = resolve; });
  const scene = async () => {
    calls++;
    if (calls === 1) throw new Error('provider outcome could not be confirmed');
    signalStarted(); await pending;
    return { buffer: PNG, mime: 'image/png' };
  };
  const server = await start(t, scene);
  const first = await post(server.url, '/api/history/scene', server.headers, identity);
  const uncertain = await first.json();
  assert.equal(first.status, 503);
  assert.equal(uncertain.status, 'unknown');
  assert.equal(uncertain.retryAvailable, true);
  assert.match(uncertain.retryOf, /^[a-f0-9]{64}$/);

  const passive = await post(server.url, '/api/history/scene', server.headers, identity);
  const passiveBody = await passive.json();
  assert.equal(passive.status, 200);
  assert.deepEqual({ status: passiveBody.status, retryAvailable: passiveBody.retryAvailable }, { status: 'unknown', retryAvailable: true });
  assert.match(passiveBody.retryOf, /^[a-f0-9]{64}$/);
  assert.equal((await getHistories(server)).suggestions[0].sceneRef.retryOf, passiveBody.retryOf,
    'history reload exposes the exact retry token for the canonical subject');
  assert.equal(calls, 1, 'reading terminal status never dispatches another attempt');

  const wrongKind = await post(server.url, '/api/history/cutout', server.headers, { ...identity, retryOf: passiveBody.retryOf });
  assert.equal(wrongKind.status, 409);
  assert.equal((await wrongKind.json()).code, 'retry_not_available');
  assert.equal(calls, 1);

  const woven = await post(server.url, '/api/history/weave', server.headers,
    { questionId: identity.questionId, historyId: identity.historyId, suggestionId: identity.eventId });
  assert.equal(woven.status, 200);
  const savedQuestion = server.store.get(identity.questionId);
  const savedHistory = savedQuestion.histories.find(item => item.id === identity.historyId);
  const wovenEvent = savedHistory.events.find(item => item.id === identity.eventId);
  server.store.save({ ...savedQuestion, histories: savedQuestion.histories.map(item => item.id === identity.historyId
    ? { ...item, events: item.events.map(event => event.id === identity.eventId ? { ...event, summary: 'Edited after the uncertain image attempt.' } : event) } : item) });
  const stale = await post(server.url, '/api/history/scene', server.headers, { ...identity, retryOf: passiveBody.retryOf });
  assert.equal(stale.status, 409, 'a prior record cannot be retried after the event revision changes');
  server.store.save({ ...server.store.get(identity.questionId), histories: server.store.get(identity.questionId).histories.map(item => item.id === identity.historyId
    ? { ...item, events: item.events.map(event => event.id === identity.eventId ? wovenEvent : event) } : item) });
  assert.equal(calls, 1);

  const retry = post(server.url, '/api/history/scene', server.headers, { ...identity, retryOf: passiveBody.retryOf });
  await started;
  const duplicate = await post(server.url, '/api/history/scene', server.headers, { ...identity, retryOf: passiveBody.retryOf });
  assert.equal(duplicate.status, 202);
  assert.deepEqual(await duplicate.json(), { status: 'pending' });
  release();
  const retryResponse = await retry, result = await retryResponse.json();
  assert.equal(retryResponse.status, 200);
  assert.equal(result.status, 'complete');
  assert.notEqual(result.url, `/history-media/${passiveBody.retryOf}.png`);
  assert.equal(calls, 2, 'same retryOf dispatches at most one new attempt');

  const media = createHistoryMediaStore(server.liveRunsDir);
  const old = media.byKey(passiveBody.retryOf);
  assert.equal(old.status, 'unknown', 'the uncertain prior attempt remains preserved');
  const completed = await post(server.url, '/api/history/scene', server.headers, { ...identity, retryOf: passiveBody.retryOf });
  const completedBody = await completed.json();
  assert.equal(completedBody.status, 'complete', 'retrying the old key cannot overwrite a completed attempt');
  assert.equal(calls, 2);

  const baseIdentity = { ...identity, revision: historyEventRevision(suggestion), kind: 'scene' };
  const latestKey = /\/history-media\/([a-f0-9]{64})\.png$/.exec(completedBody.url)[1];
  await rm(join(server.liveRunsDir, '.history-media', `${media.keyFor(baseIdentity)}.latest.json`), { force: true });
  const afterRestart = createHistoryMediaStore(server.liveRunsDir);
  assert.equal(afterRestart.get(baseIdentity).key, passiveBody.retryOf, 'missing latest pointer falls back to the preserved original unknown record');
  const repaired = afterRestart.reserveRetry(baseIdentity, passiveBody.retryOf);
  assert.equal(repaired.status, 'complete');
  assert.equal(repaired.record.key, latestKey);
  assert.equal(afterRestart.get(baseIdentity).key, latestKey, 'an existing retry record repairs the missing atomic latest pointer');
});

test('known empty SAM result permits only an explicit new cutout attempt', async t => {
  let sceneCalls = 0, cutoutCalls = 0;
  const scene = async () => { sceneCalls++; return { buffer: PNG, mime: 'image/png' }; };
  const cutout = async ({ image }) => {
    cutoutCalls++; assert.deepEqual(image, PNG);
    return cutoutCalls === 1 ? { status: 'empty' } : { buffer: PNG, mime: 'image/png' };
  };
  cutout.enforcesDailyCap = true;
  const server = await start(t, scene, { segmentHistoryCutout: cutout });
  assert.equal((await (await post(server.url, '/api/history/scene', server.headers, identity)).json()).status, 'complete');
  const first = await post(server.url, '/api/history/cutout', server.headers, identity);
  const empty = await first.json();
  assert.equal(empty.status, 'empty');
  assert.equal(empty.retryAvailable, true);
  assert.match(empty.retryOf, /^[a-f0-9]{64}$/);
  const passive = await post(server.url, '/api/history/cutout', server.headers, identity);
  assert.equal((await passive.json()).status, 'empty');
  assert.equal(cutoutCalls, 1, 'empty results do not retry without explicit intent');
  const retry = await post(server.url, '/api/history/cutout', server.headers, { ...identity, retryOf: empty.retryOf });
  const completed = await retry.json();
  assert.equal(retry.status, 200);
  assert.equal(completed.status, 'complete');
  assert.equal(cutoutCalls, 2);
  assert.equal(sceneCalls, 1);
  assert.equal(createHistoryMediaStore(server.liveRunsDir).byKey(empty.retryOf).status, 'empty',
    'the no-mask record remains intact after a fresh explicit attempt');
});

test('explicit retry still obeys the saved-world session cap before provider dispatch', async t => {
  let calls = 0;
  const scene = async () => { calls++; return { buffer: PNG, mime: 'image/png' }; };
  const server = await start(t, scene, { maxExpansions: 1 });
  const rootScene = await post(server.url, '/api/history/scene', server.headers, { ...identity, eventId: existingEvent.id });
  assert.equal((await rootScene.json()).status, 'complete');
  const media = createHistoryMediaStore(server.liveRunsDir);
  const prior = media.reserve({ ...identity, revision: historyEventRevision(suggestion), kind: 'scene' });
  media.finish(prior.record, 'unknown');
  const rejected = await post(server.url, '/api/history/scene', server.headers,
    { ...identity, retryOf: prior.record.key });
  const body = await rejected.json();
  assert.equal(rejected.status, 429);
  assert.equal(body.code, 'world_limit');
  assert.equal(calls, 1, 'the session cap blocks retry before dispatch');
  assert.equal(media.byKey(prior.record.key).status, 'unknown', 'the old uncertain attempt remains preserved');
});

test('pre-dispatch busy rejection restores the retry receipt for a later explicit attempt', async t => {
  let calls = 0, signalStarted, release;
  const started = new Promise(resolve => { signalStarted = resolve; });
  const pending = new Promise(resolve => { release = resolve; });
  const scene = async () => {
    calls++;
    if (calls === 1) { signalStarted(); await pending; }
    return { buffer: PNG, mime: 'image/png' };
  };
  const server = await start(t, scene, { maxExpansions: 2, maxConcurrentJobs: 1 });
  const media = createHistoryMediaStore(server.liveRunsDir);
  const targetIdentity = { ...identity, revision: historyEventRevision(suggestion), kind: 'scene' };
  const previous = media.reserve(targetIdentity);
  media.finish(previous.record, 'unknown');

  const occupying = post(server.url, '/api/history/scene', server.headers, { ...identity, eventId: existingEvent.id });
  await started;
  const busy = await post(server.url, '/api/history/scene', server.headers, { ...identity, retryOf: previous.record.key });
  const busyBody = await busy.json();
  assert.equal(busy.status, 429);
  assert.equal(busyBody.code, 'busy');
  assert.equal(busyBody.status, 'retryable');
  assert.equal(media.get(targetIdentity).key, previous.record.key,
    'pre-dispatch rejection restores the latest pointer to the original terminal attempt');
  release();
  assert.equal((await (await occupying).json()).status, 'complete');

  const retried = await post(server.url, '/api/history/scene', server.headers, { ...identity, retryOf: previous.record.key });
  assert.equal((await retried.json()).status, 'complete');
  assert.equal(calls, 2, 'the later explicit retry is allowed once the slot is free');
  assert.equal(media.byKey(previous.record.key).status, 'unknown');
});
