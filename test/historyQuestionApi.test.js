import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createDemoServer } from '../server/index.js';
import { createHistoryStore } from '../src/demo/historyStore.js';
import { createHistoryMediaStore } from '../src/demo/historyMediaStore.js';
import { historyEventRevision } from '../src/demo/historyMediaStore.js';
import { dateWindowFor } from '../src/demo/historyQuestion.js';

const PNG = Buffer.from('89504e470d0a1a0a', 'hex');
const event = (id, year, title, extras = {}) => ({ id, year, title, summary: `${title} shapes the landscape.`,
  place: { name: 'Sahara', lat: 20, lon: 10 }, causeEventId: 'question-one', geography: { version: 1, changes: [] }, ...extras });

async function start(t, { historyQuestionGenerator, renderHistoryScene, segmentHistoryCutout, seed = true } = {}) {
  const root = await mkdtemp(join(tmpdir(), 'office-history-question-api-'));
  const liveRunsDir = join(root, 'live'), runsDir = join(root, 'runs');
  await Promise.all([mkdir(liveRunsDir), mkdir(runsDir)]);
  if (seed) createHistoryStore(liveRunsDir).save({ id: 'question-one', question: 'What if the Sahara remained green?', histories: [{ id: 'history-one', events: [
    event('event-one', -2400, 'Water channels sustain gardens'),
  ] }] });
  const server = createDemoServer({ runsDir, liveRunsDir, packagedReplayRoot: null, webDir: join(root, 'web'),
    env: { META_API_KEY: 'test-key-no-network', META_SPEND_CAP_USD: '10', META_DAILY_SPEND_CAP_USD: '10',
      DEMO_ACCESS_CODE: 'history-api-code', DEMO_MAX_EXPANSIONS_PER_SESSION: '1' },
    ...(historyQuestionGenerator ? { historyQuestionGenerator } : {}), ...(renderHistoryScene ? { renderHistoryScene } : {}),
    ...(segmentHistoryCutout ? { segmentHistoryCutout } : {}),
  });
  await mkdir(join(root, 'web'));
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(async () => {
    if (server.listening) await new Promise((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
    await rm(root, { recursive: true, force: true });
  });
  const url = `http://127.0.0.1:${server.address().port}`;
  const health = await fetch(`${url}/health`);
  const cookie = health.headers.get('set-cookie')?.split(';', 1)[0];
  const sessionId = /otherwise_session=([^;]+)/.exec(cookie)?.[1];
  const headers = { cookie, origin: url, 'sec-fetch-site': 'same-origin', 'x-demo-access-code': 'history-api-code', 'content-type': 'application/json' };
  return { root, liveRunsDir, server, url, headers, sessionId };
}

const reply = async (base, path, headers, body) => fetch(`${base}${path}`, { method: 'POST', headers, body: JSON.stringify(body) });

test('authored question creates an empty user-written history and records only metadata attachment', async t => {
  let generatorCalls = 0;
  const server = await start(t, { historyQuestionGenerator: async ({ question, divergenceYear }) => {
    generatorCalls++;
    return { id: 'authored-question', question, title: 'Green Sahara gardens', divergenceYear: divergenceYear ?? -2400,
      divergencePlace: { name: 'Sahara', lat: 20, lon: 10 }, origin: { kind: 'user-written' },
      histories: [{ id: 'history-first', events: [] }], dateWindow: dateWindowFor(divergenceYear ?? -2400) };
  } });
  const result = await reply(server.url, '/api/history/questions', server.headers, {
    question: 'What if the Sahara stayed green?', divergenceYear: -2400,
    attachment: { mode: 'history-event', questionId: 'question-one', historyId: 'history-one', eventId: 'event-one' },
  });
  const responseBody = await result.json();
  assert.equal(result.status, 201, JSON.stringify(responseBody));
  const body = responseBody;
  assert.equal(generatorCalls, 1);
  assert.deepEqual(body.dateWindow, { fromYear: -3000, toYear: -2001 });
  assert.deepEqual(body.history.events, [], 'the new timeline does not clone the parent history or legacy tree');
  assert.deepEqual(body.question.origin, { kind: 'user-written' });
  assert.deepEqual(body.question.questionAttachment, { mode: 'history-event', questionId: 'question-one', historyId: 'history-one', eventId: 'event-one',
    divergenceYear: -2400, divergencePlace: { name: 'Sahara', lat: 20, lon: 10 }, parentContext: { question: 'What if the Sahara remained green?',
      asOfEvent: { year: -2400, title: 'Water channels sustain gardens', summary: 'Water channels sustain gardens shapes the landscape.',
        place: { name: 'Sahara', lat: 20, lon: 10 } }, events: [
        { year: -2400, title: 'Water channels sustain gardens', summary: 'Water channels sustain gardens shapes the landscape.',
          place: { name: 'Sahara', lat: 20, lon: 10 } },
      ], eventCount: 1 } });
  const saved = createHistoryStore(server.liveRunsDir).get('authored-question');
  assert.deepEqual(saved.histories[0].events, []);
  assert.deepEqual(createHistoryStore(server.liveRunsDir).usage('demo', server.sessionId), { worldsEntered: 0, suggestionWindowsGenerated: 0, histories: 1 });
});

test('explicit history scene and cutout use durable identity refs and count one world per actor/event', async t => {
  let sceneCalls = 0, cutoutCalls = 0;
  const scene = async ({ prompt }) => { sceneCalls++; assert.match(prompt, /Water channels/); return { buffer: PNG, mime: 'image/png' }; };
  scene.enforcesDailyCap = true;
  const cutout = async ({ image }) => { cutoutCalls++; assert.deepEqual(image, PNG); return { buffer: PNG, mime: 'image/png' }; };
  cutout.enforcesDailyCap = true;
  const server = await start(t, { renderHistoryScene: scene, segmentHistoryCutout: cutout });
  const identity = { questionId: 'question-one', historyId: 'history-one', eventId: 'event-one' };
  const generatedScene = await reply(server.url, '/api/history/scene', server.headers, identity);
  const sceneBody = await generatedScene.json();
  assert.equal(generatedScene.status, 200);
  assert.equal(sceneBody.status, 'complete');
  assert.match(sceneBody.url, /^\/history-media\/[a-f0-9]{64}\.png$/);
  assert.equal(sceneBody.attached, true);
  assert.equal((await fetch(`${server.url}${sceneBody.url}`)).status, 200);
  const generatedCutout = await reply(server.url, '/api/history/cutout', server.headers, identity);
  assert.equal((await generatedCutout.json()).status, 'complete');
  const savedStore = createHistoryStore(server.liveRunsDir);
  const savedQuestion = savedStore.get('question-one');
  savedStore.save({ ...savedQuestion, histories: savedQuestion.histories.map(history => ({ ...history,
    events: [...history.events, event('event-two', -2300, 'River gardens expand', { causeEventId: 'event-one', sceneRef: { status: 'complete', url: sceneBody.url } })] })) });
  const crossEventCutout = await reply(server.url, '/api/history/cutout', server.headers, { ...identity, eventId: 'event-two' });
  assert.equal((await crossEventCutout.json()).status, 'missing-image', 'a different event cannot reuse another event identity’s history image');
  const capped = await reply(server.url, '/api/history/scene', server.headers, { ...identity, eventId: 'event-two' });
  assert.equal(capped.status, 429, 'a second unique event world is blocked by the session cap');
  assert.equal((await capped.json()).code, 'world_limit');
  assert.equal(sceneCalls, 1);
  assert.equal(cutoutCalls, 1);
  const saved = createHistoryStore(server.liveRunsDir).get('question-one').histories[0].events[0];
  assert.equal(saved.sceneRef.url, sceneBody.url, 'the normalized event keeps the safe local URL');
  assert.match(saved.cutoutRef.url, /^\/history-media\/[a-f0-9]{64}\.png$/);
  assert.equal(createHistoryStore(server.liveRunsDir).usage('demo', server.sessionId).worldsEntered, 1,
    'scene and cutout count one unique event world');
});

test('history media becomes unknown after restart and does not dispatch again', async t => {
  const server = await start(t, { renderHistoryScene: Object.assign(async () => { throw new Error('must not dispatch'); }, { enforcesDailyCap: true }) });
  const store = createHistoryMediaStore(server.liveRunsDir);
  const seeded = createHistoryStore(server.liveRunsDir).get('question-one').histories[0].events[0];
  store.reserve({ questionId: 'question-one', historyId: 'history-one', eventId: 'event-one', revision: historyEventRevision(seeded), kind: 'scene' });
  const response = await reply(server.url, '/api/history/scene', server.headers, { questionId: 'question-one', historyId: 'history-one', eventId: 'event-one' });
  const result = await response.json();
  assert.equal(response.status, 200, JSON.stringify(result));
  assert.equal(result.status, 'unknown');
});

test('scene completion does not overwrite an event revision edited while the renderer is running', async t => {
  let startedResolve, releaseResolve;
  const started = new Promise(resolve => { startedResolve = resolve; });
  const released = new Promise(resolve => { releaseResolve = resolve; });
  const scene = async () => { startedResolve(); await released; return { buffer: PNG, mime: 'image/png' }; };
  scene.enforcesDailyCap = true;
  const server = await start(t, { renderHistoryScene: scene });
  const pending = reply(server.url, '/api/history/scene', server.headers,
    { questionId: 'question-one', historyId: 'history-one', eventId: 'event-one' });
  await started;
  const store = createHistoryStore(server.liveRunsDir);
  const question = store.get('question-one');
  store.save({ ...question, histories: question.histories.map(history => ({ ...history, events: history.events.map(item =>
    item.id === 'event-one' ? { ...item, summary: 'A concurrent saved edit changes this event.' } : item) })) });
  releaseResolve();
  const response = await pending, body = await response.json();
  assert.equal(response.status, 200);
  assert.equal(body.status, 'complete');
  assert.equal(body.attached, false);
  const current = store.get('question-one').histories[0].events[0];
  assert.equal(current.summary, 'A concurrent saved edit changes this event.');
  assert.equal(current.sceneRef, undefined);
});
