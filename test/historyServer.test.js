import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { createDemoServer } from '../server/index.js';
import { createContinuationStore } from '../src/demo/continuationStore.js';
import { createEventSceneStore } from '../src/demo/eventSceneStore.js';
import { createHistoryStore } from '../src/demo/historyStore.js';
import { createHistoryService } from '../src/demo/historyService.js';

const headers = { 'x-demo-access-code': 'history-code' };
const geography = intensity => ({ version: 1, changes: [{ id: `sahara-${intensity}`, kind: 'vegetation', region: 'sahara', intensity,
  assumption: 'Illustrative vegetation state.', uncertainty: 'The boundary is schematic.' }] });
const branch = (id, year, title, extra = {}) => ({ id, year, title, summary: `${title} influences regional settlement.`,
  place: { name: 'Sahara', lat: 20, lon: 10 }, ...extra });

test('GET /api/histories migrates authorized saved runs once and composes geography as of a date', async t => {
  const base = await mkdtemp(join(tmpdir(), 'office-history-server-'));
  const runsDir = join(base, 'cached'), liveRunsDir = join(base, 'live');
  await mkdir(join(runsDir, 'question-root'), { recursive: true });
  await mkdir(join(liveRunsDir, 'child-run'), { recursive: true });
  const rootBranch = { status: 'ok', divergence: 'What if the Sahara remained green?', branches: [
    branch('b1', -3000, 'Wetland villages follow the lakes', { geography: geography(0.8) }),
    branch('b2', -2000, 'River traders map the grasslands'),
  ], hero: { branchId: 'b1', title: 'Green Sahara' } };
  const childBranch = { status: 'ok', divergence: rootBranch.divergence, branches: [
    branch('c1', -1000, 'Water keepers tend the channel gardens', { geography: geography(0.4) }),
  ] };
  const continuation = { rootRunId: 'question-root', rootDivergence: rootBranch.divergence, parentRunId: 'question-root', parentBranchId: 'b1', path: [
    { runId: 'question-root', branchId: 'b1', ...rootBranch.branches[0] },
    { runId: 'child-run', branchId: 'c1', ...childBranch.branches[0] },
  ] };
  const legacyText = JSON.stringify(rootBranch, null, 2);
  const legacyPath = join(runsDir, 'question-root', 'branch.json');
  await writeFile(legacyPath, legacyText);
  await writeFile(join(liveRunsDir, 'child-run', 'branch.json'), JSON.stringify(childBranch));
  createContinuationStore(liveRunsDir).save({ id: 'child-run', status: 'complete', rootDivergence: rootBranch.divergence, continuation,
    completion: { runId: 'child-run', branch: childBranch } });

  const server = createDemoServer({ runsDir, liveRunsDir, webDir: resolve('web'), packagedReplayRoot: null,
    env: { DEMO_ACCESS_CODE: 'history-code' }, rateLimit: 100 });
  await new Promise(resolveListen => server.listen(0, '127.0.0.1', resolveListen));
  t.after(async () => {
    await new Promise(resolveClose => server.close(resolveClose));
    await rm(base, { recursive: true, force: true });
  });
  const url = `http://127.0.0.1:${server.address().port}`;

  assert.equal((await fetch(`${url}/api/histories`)).status, 403);
  assert.equal((await fetch(`${url}/api/histories?asOfYear=0`, { headers })).status, 400);
  const earlyResponse = await fetch(`${url}/api/histories?asOfYear=-1500`, { headers });
  assert.equal(earlyResponse.status, 200);
  const early = await earlyResponse.json();
  assert.equal(early.asOfYear, -1500);
  assert.equal(early.questions.length, 1);
  const history = early.questions[0].histories[0];
  assert.deepEqual(history.events.map(event => event.id), ['question-root:b1', 'child-run:c1']);
  assert.deepEqual(history.asOf.events.map(event => event.id), ['question-root:b1']);
  assert.equal(history.asOf.geography.changes[0].intensity, 0.8);

  const later = await (await fetch(`${url}/api/histories?asOfYear=-500`, { headers })).json();
  assert.equal(later.questions[0].histories[0].asOf.geography.changes[0].intensity, 0.4);
  assert.deepEqual(later.questions[0].histories[0].suggestions.map(item => item.suggestionForEventId), ['question-root:b2']);
  assert.equal(await readFile(legacyPath, 'utf8'), legacyText, 'the API leaves the legacy source unchanged');
  assert.ok((await readFile(join(liveRunsDir, '.history', 'state-v1.json'), 'utf8')).includes('question-root'));

  const oldHistory = await fetch(`${url}/api/history`, { headers });
  assert.equal(oldHistory.status, 200, 'the existing endpoint remains available');
});

test('GET /api/histories restores only source-matching verified legacy scene refs into an edited history response', async t => {
  const base = await mkdtemp(join(tmpdir(), 'office-history-media-'));
  const runsDir = join(base, 'cached'), liveRunsDir = join(base, 'live');
  await mkdir(join(runsDir, 'question-root'), { recursive: true });
  await mkdir(join(liveRunsDir, 'saved-run'), { recursive: true });
  await mkdir(join(liveRunsDir, 'visitor-run'), { recursive: true });
  const rootDivergence = 'What if lower seas joined the forest plain?';
  const rootEvent = branch('b1', -3000, 'River plain communities connect the islands', { geography: geography(0.8) });
  const rootBranch = { status: 'ok', divergence: rootDivergence, branches: [rootEvent], hero: { branchId: 'b1' } };
  await writeFile(join(runsDir, 'question-root', 'branch.json'), JSON.stringify(rootBranch));

  const savedEvent = branch('c1', -1000, 'Canopy researchers map medicinal species', { scene: 'Naturalists cross a walkway above the forest canopy.', geography: geography(0.7) });
  const editedEvent = branch('c2', -500, 'River teams catalog forest seedling plots', { scene: 'Researchers label young trees along an inland river.', geography: geography(0.6) });
  const savedBranch = { status: 'ok', divergence: rootDivergence, branches: [savedEvent, editedEvent] };
  const savedContinuation = { rootRunId: 'question-root', rootDivergence, parentRunId: 'question-root', parentBranchId: 'b1', path: [
    { runId: 'question-root', branchId: 'b1', ...rootEvent },
  ] };
  const visitedContinuation = { rootRunId: 'question-root', rootDivergence, parentRunId: 'saved-run', parentBranchId: 'c1', path: [
    ...savedContinuation.path, { runId: 'saved-run', branchId: 'c1', ...savedEvent },
  ] };
  await writeFile(join(liveRunsDir, 'saved-run', 'branch.json'), JSON.stringify(savedBranch));
  await writeFile(join(liveRunsDir, 'visitor-run', 'branch.json'), JSON.stringify({ status: 'ok', divergence: rootDivergence, branches: [] }));
  const continuationStore = createContinuationStore(liveRunsDir);
  continuationStore.save({ id: 'saved-run', status: 'complete', rootDivergence, continuation: savedContinuation,
    completion: { runId: 'saved-run', branch: savedBranch } });
  continuationStore.save({ id: 'visitor-run', status: 'complete', rootDivergence, continuation: visitedContinuation,
    completion: { runId: 'visitor-run', branch: { status: 'ok', divergence: rootDivergence, branches: [] } } });

  const scenes = createEventSceneStore(liveRunsDir);
  const image = Buffer.from('89504e470d0a1a0a', 'hex');
  for (const id of ['c1', 'c2']) scenes.complete(scenes.reserve('saved-run', id), image);

  const histories = createHistoryStore(liveRunsDir);
  histories.save({ id: 'question-root', question: rootDivergence, histories: [{ id: 'history-question-root%3Ab1', events: [
    { ...rootEvent, id: 'question-root:b1', causeEventId: 'question-root' },
    { ...savedEvent, id: 'saved-run:c1', causeEventId: 'question-root:b1' },
    { ...editedEvent, id: 'saved-run:c2', summary: 'A later edited description that no longer matches the saved scene.', causeEventId: 'question-root:b1' },
  ] }] });

  const server = createDemoServer({ runsDir, liveRunsDir, webDir: resolve('web'), packagedReplayRoot: null,
    env: { DEMO_ACCESS_CODE: 'history-code' } });
  await new Promise(resolveListen => server.listen(0, '127.0.0.1', resolveListen));
  t.after(async () => {
    await new Promise(resolveClose => server.close(resolveClose));
    await rm(base, { recursive: true, force: true });
  });
  const url = `http://127.0.0.1:${server.address().port}`;
  const response = await fetch(`${url}/api/histories`, { headers });
  assert.equal(response.status, 200);
  const result = await response.json();
  const events = result.questions[0].histories.find(item => item.id === 'history-question-root%3Ab1').events;
  const canopy = events.find(event => event.id === 'saved-run:c1');
  assert.deepEqual(canopy.sceneRef, { status: 'complete', url: `/event-scenes/${scenes.keyFor('saved-run', 'c1')}.png`, runId: 'saved-run', branchId: 'c1' });
  assert.equal((await fetch(`${url}${canopy.sceneRef.url}`)).status, 200, 'the restored scene reference resolves to its exact stored image');
  const edited = events.find(event => event.id === 'saved-run:c2');
  assert.equal(edited.summary, 'A later edited description that no longer matches the saved scene.');
  assert.equal(edited.sceneRef, undefined, 'changed event content does not inherit stale media');
  assert.equal(histories.get('question-root').histories[0].events.find(event => event.id === 'saved-run:c1').sceneRef, undefined,
    'response repair does not persist over the saved history');
});

test('GET /api/histories restores selected-hero assets only on the exact unchanged hero event', async t => {
  const base = await mkdtemp(join(tmpdir(), 'office-history-hero-media-'));
  const runsDir = join(base, 'cached'), liveRunsDir = join(base, 'live');
  const heroDir = join(runsDir, 'green-sahara');
  await mkdir(heroDir, { recursive: true });
  await mkdir(join(liveRunsDir, 'visitor-run'), { recursive: true });
  const divergence = 'What if the Sahara remained green?';
  const rootEvents = [
    branch('b1', -5000, 'Wetland villages follow the lakes', { geography: geography(0.8) }),
    branch('b2', -2800, 'Sailboats connect green Sahara settlements', { geography: geography(0.6) }),
  ];
  const rootBranch = { status: 'ok', divergence, branches: rootEvents, hero: { branchId: 'b2', title: rootEvents[1].title } };
  await writeFile(join(heroDir, 'branch.json'), JSON.stringify(rootBranch));
  for (const name of ['hero.png', 'cutout.png']) await writeFile(join(heroDir, name), Buffer.from('89504e470d0a1a0a', 'hex'));
  await writeFile(join(heroDir, 'model.glb'), Buffer.from('glTF\u0002\u0000\u0000\u0000'));

  const continuation = { rootRunId: 'green-sahara', rootDivergence: divergence, parentRunId: 'green-sahara', parentBranchId: 'b2',
    path: [{ runId: 'green-sahara', branchId: 'b2', ...rootEvents[1] }] };
  const visitorBranch = { status: 'ok', divergence, branches: [] };
  await writeFile(join(liveRunsDir, 'visitor-run', 'branch.json'), JSON.stringify(visitorBranch));
  createContinuationStore(liveRunsDir).save({ id: 'visitor-run', status: 'complete', rootDivergence: divergence, continuation,
    completion: { runId: 'visitor-run', branch: visitorBranch } });

  const histories = createHistoryStore(liveRunsDir);
  histories.save({ id: 'green-sahara', question: divergence, histories: [{ id: 'history-green-sahara%3Ab2', events: [
    { ...rootEvents[0], id: 'green-sahara:b1', causeEventId: 'green-sahara' },
    { ...rootEvents[1], id: 'green-sahara:b2', causeEventId: 'green-sahara' },
  ] }] });

  const server = createDemoServer({ runsDir, liveRunsDir, webDir: resolve('web'), packagedReplayRoot: null,
    env: { DEMO_ACCESS_CODE: 'history-code' } });
  await new Promise(resolveListen => server.listen(0, '127.0.0.1', resolveListen));
  t.after(async () => {
    await new Promise(resolveClose => server.close(resolveClose));
    await rm(base, { recursive: true, force: true });
  });
  const url = `http://127.0.0.1:${server.address().port}`;
  const response = await fetch(`${url}/api/histories`, { headers });
  assert.equal(response.status, 200);
  const result = await response.json();
  const events = result.questions[0].histories.find(item => item.id === 'history-green-sahara%3Ab2').events;
  const heroEvent = events.find(event => event.id === 'green-sahara:b2');
  for (const [key, name] of [['heroRef', 'hero.png'], ['cutoutRef', 'cutout.png'], ['modelRef', 'model.glb']]) {
    assert.deepEqual(heroEvent[key], { status: 'complete', url: `/runs/green-sahara/${name}`, path: `green-sahara/${name}`, runId: 'green-sahara', branchId: 'b2' });
    assert.equal((await fetch(`${url}${heroEvent[key].url}`)).status, 200, `${key} points to the verified served asset`);
  }
  assert.equal(heroEvent.sceneRef, undefined, 'a curated hero image remains a hero ref when no event scene exists');
  const otherEvent = events.find(event => event.id === 'green-sahara:b1');
  assert.equal(otherEvent.heroRef, undefined, 'the selected hero does not attach to another branch event');
  assert.equal(otherEvent.cutoutRef, undefined);
  assert.equal(otherEvent.modelRef, undefined);
  const persistedHero = histories.get('green-sahara').histories[0].events.find(event => event.id === 'green-sahara:b2');
  assert.equal(persistedHero.heroRef, undefined, 'response enrichment does not overwrite saved history state');
});

test('weave action response retains canonical hero refs for existing events without assigning them to the new event', async t => {
  const base = await mkdtemp(join(tmpdir(), 'office-history-weave-media-'));
  const runsDir = join(base, 'cached'), liveRunsDir = join(base, 'live');
  const heroDir = join(runsDir, 'green-sahara');
  await mkdir(heroDir, { recursive: true });
  await mkdir(join(liveRunsDir, 'visitor-run'), { recursive: true });
  const divergence = 'What if the Sahara remained green?';
  const rootEvents = [
    branch('b1', -5000, 'Wetland villages follow the lakes', { geography: geography(0.8) }),
    branch('b2', -2800, 'Sailboats connect green Sahara settlements', { geography: geography(0.6) }),
    branch('b3', -2200, 'Reed workshops preserve inland channels', { geography: geography(0.5) }),
  ];
  const rootBranch = { status: 'ok', divergence, branches: rootEvents, hero: { branchId: 'b2', title: rootEvents[1].title } };
  await writeFile(join(heroDir, 'branch.json'), JSON.stringify(rootBranch));
  for (const name of ['hero.png', 'cutout.png']) await writeFile(join(heroDir, name), Buffer.from('89504e470d0a1a0a', 'hex'));
  await writeFile(join(heroDir, 'model.glb'), Buffer.from('glTF\u0002\u0000\u0000\u0000'));

  const continuation = { rootRunId: 'green-sahara', rootDivergence: divergence, parentRunId: 'green-sahara', parentBranchId: 'b2',
    path: [{ runId: 'green-sahara', branchId: 'b2', ...rootEvents[1] }] };
  const visitorBranch = { status: 'ok', divergence, branches: [] };
  await writeFile(join(liveRunsDir, 'visitor-run', 'branch.json'), JSON.stringify(visitorBranch));
  createContinuationStore(liveRunsDir).save({ id: 'visitor-run', status: 'complete', rootDivergence: divergence, continuation,
    completion: { runId: 'visitor-run', branch: visitorBranch } });

  const historyStore = createHistoryStore(liveRunsDir);
  historyStore.save({ id: 'green-sahara', question: divergence, histories: [{ id: 'history-green-sahara%3Ab2', events: [
    { ...rootEvents[1], id: 'green-sahara:b2', causeEventId: 'green-sahara' },
  ] }] });
  const historyService = createHistoryService({ store: createHistoryStore(liveRunsDir), agent: {
    async suggest() { return []; },
    async checkSuggestion() { return { verdict: 'fits', conflictsWith: null, reason: '' }; },
    async checkRipple() { return { inconsistent: false, reason: '' }; },
  } });

  const server = createDemoServer({ runsDir, liveRunsDir, webDir: resolve('web'), packagedReplayRoot: null,
    historyService, env: { DEMO_ACCESS_CODE: 'history-code' } });
  await new Promise(resolveListen => server.listen(0, '127.0.0.1', resolveListen));
  t.after(async () => {
    await new Promise(resolveClose => server.close(resolveClose));
    await rm(base, { recursive: true, force: true });
  });
  const url = `http://127.0.0.1:${server.address().port}`;
  const beforeResponse = await fetch(`${url}/api/histories`, { headers });
  assert.equal(beforeResponse.status, 200);
  const before = await beforeResponse.json();
  const initialHistory = before.questions[0].histories.find(item => item.id === 'history-green-sahara%3Ab2');
  assert.ok(initialHistory.events.find(event => event.id === 'green-sahara:b2').heroRef, 'the GET projection repairs the existing sailboats event');
  const suggestion = initialHistory.suggestions.find(item => item.suggestionForEventId === 'green-sahara:b3');
  assert.ok(suggestion);
  const health = await fetch(`${url}/health`);
  const cookie = health.headers.get('set-cookie')?.split(';', 1)[0];
  assert.ok(cookie);

  const weaveResponse = await fetch(`${url}/api/history/weave`, { method: 'POST', headers: { ...headers, cookie, 'content-type': 'application/json' },
    body: JSON.stringify({ questionId: 'green-sahara', historyId: initialHistory.id, suggestionId: suggestion.id }) });
  assert.equal(weaveResponse.status, 200);
  const woven = await weaveResponse.json();
  const sailboats = woven.history.events.find(event => event.id === 'green-sahara:b2');
  assert.equal(sailboats.heroRef?.url, '/runs/green-sahara/hero.png');
  assert.equal(sailboats.cutoutRef?.url, '/runs/green-sahara/cutout.png');
  assert.equal(sailboats.modelRef?.url, '/runs/green-sahara/model.glb');
  for (const ref of [sailboats.heroRef, sailboats.cutoutRef, sailboats.modelRef]) assert.equal((await fetch(`${url}${ref.url}`)).status, 200);
  assert.equal(woven.event.id, suggestion.id);
  assert.equal(woven.event.heroRef, undefined, 'the new event does not inherit the selected hero assets');
  assert.equal(woven.event.cutoutRef, undefined);
  assert.equal(woven.event.modelRef, undefined);
  assert.equal(historyStore.get('green-sahara').histories[0].events.find(event => event.id === 'green-sahara:b2').heroRef, undefined,
    'the action response hydrates refs without persisting them');
});
