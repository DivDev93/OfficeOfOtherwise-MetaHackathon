import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createHistoryStore } from '../src/demo/historyStore.js';

const branch = (id, year, title, extra = {}) => ({ id, year, title, summary: `${title} reshapes life around the inland sea.`, place: { name: 'Lake Chad', lat: 13, lon: 14 }, ...extra });

async function fixture(t) {
  const root = await mkdtemp(join(tmpdir(), 'office-history-store-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  return root;
}

test('deterministically migrates a realistic saved tree without rewriting its legacy files', async t => {
  const root = await fixture(t), legacy = join(root, 'legacy');
  const rootRun = { id: 'question-a', divergence: 'What if Lake Chad stayed broad?', branches: [
    branch('b1', -6500, 'Farmers settle beside the lake', { geography: { version: 1, changes: [{ id: 'lake', region: 'sahara', kind: 'lake', intensity: 0.8 }] } }),
    branch('b2', -4200, 'Reed boats cross the lake'),
    branch('b3', 900, 'River explorers map the channels'),
  ] };
  const childRun = { id: 'child-a', divergence: rootRun.divergence,
    continuation: { rootRunId: 'question-a', rootDivergence: rootRun.divergence, path: [
      { runId: 'question-a', branchId: 'b1', ...rootRun.branches[0] },
      { runId: 'child-a', branchId: 'c1', ...branch('c1', -3900, 'Canal keepers mark flood seasons') },
    ] }, branches: [branch('c2', -3600, 'Stone docks extend the settlement')] };
  const legacyTrees = [
    { runId: 'question-a', run: rootRun, assetRefsByBranch: { 'question-a:b1': { sceneRef: 'question-a/b1/scene.png', modelRef: '../private.glb' } } },
    { runId: 'child-a', run: childRun },
  ];
  await mkdir(join(legacy, 'question-a'), { recursive: true });
  const sourcePath = join(legacy, 'question-a', 'branch.json');
  const original = JSON.stringify(rootRun, null, 2);
  await writeFile(sourcePath, original);
  const store = createHistoryStore(root, () => Date.UTC(2026, 10, 1));
  const migrated = store.migrateLegacy(legacyTrees);

  assert.equal(migrated.questions.length, 1);
  const question = migrated.questions[0];
  assert.equal(question.id, 'question-a');
  assert.equal(question.histories.length, 1);
  const [history] = question.histories;
  assert.deepEqual(history.events.map(event => event.id), ['question-a:b1', 'child-a:c1']);
  assert.equal(history.events[0].causeEventId, 'question-a');
  assert.equal(history.events[1].causeEventId, 'question-a:b1');
  assert.equal(history.events[0].sceneRef, 'question-a/b1/scene.png');
  assert.equal(history.events[0].modelRef, undefined, 'unsafe asset refs are dropped during migration');
  assert.deepEqual(history.suggestions.map(item => item.suggestionForEventId), ['question-a:b2', 'child-a:c2', 'question-a:b3']);
  assert.equal(history.suggestions[0].verdict, 'fits');
  assert.equal(history.suggestions[0].reason, 'migrated from earlier exploration');
  assert.equal(migrated.metadata.counts.histories, 1);
  assert.equal(await readFile(sourcePath, 'utf8'), original, 'the saved tree is still byte-for-byte intact');

  const restarted = createHistoryStore(root, () => Date.UTC(2026, 10, 2));
  assert.deepEqual(restarted.get(question.id), question);
  assert.deepEqual(restarted.list(), [question]);
});

test('batch plan reservations persist ready plans and require their receipt for an uncertain explicit retry', async t => {
  const root = await fixture(t), store = createHistoryStore(root, () => Date.UTC(2026, 10, 3));
  const base = { planKey: 'a'.repeat(64), questionId: 'q', historyId: 'h', userId: 'u', sessionId: 's', cap: 5 };
  const first = store.reserveBatchPlan({ ...base, requestId: 'request-1' });
  assert.equal(first.status, 'reserved');
  store.failBatchPlan({ planKey: base.planKey, requestId: 'request-1', uncertain: true });
  const unknown = store.reserveBatchPlan({ ...base, requestId: 'request-2' });
  assert.equal(unknown.status, 'unknown');
  assert.ok(unknown.retryOf);
  const retry = store.reserveBatchPlan({ ...base, requestId: 'request-2', retryOf: unknown.retryOf });
  assert.equal(retry.status, 'reserved', 'only the matching explicit receipt permits redispatch');
  const plan = { id: 'batch-plan:test', questionId: 'q', historyId: 'h', suggestionIds: [] };
  assert.equal(store.completeBatchPlan({ planKey: base.planKey, requestId: 'request-2', plan }).status, 'ready');
  const interrupted = { ...base, planKey: 'b'.repeat(64), requestId: 'request-pending' };
  store.reserveBatchPlan(interrupted);
  const restarted = createHistoryStore(root);
  assert.deepEqual(restarted.getBatchPlan(base.planKey).plan, plan);
  assert.equal(restarted.getBatchPlan(interrupted.planKey).status, 'unknown');
  assert.ok(restarted.getBatchPlan(interrupted.planKey).retryOf, 'restart recovery exposes a receipt-bound retry instead of automatic dispatch');
});

test('migration reruns are stable and preserve questions already edited by later phases', async t => {
  const root = await fixture(t), store = createHistoryStore(root);
  const legacy = [{ runId: 'saved-q', run: { id: 'saved-q', divergence: 'A preserved astronomy archive', branches: [branch('b1', 100, 'Star charts guide seasonal travel')] } }];
  const first = store.migrateLegacy(legacy).questions[0];
  const edited = { ...first, histories: first.histories.map(history => ({ ...history, suggestions: history.suggestions.map(event => ({ ...event, summary: 'A later human edit to this event.' })) })) };
  store.save(edited);
  const second = store.migrateLegacy(legacy).questions[0];
  assert.equal(second.histories[0].suggestions[0].summary, 'A later human edit to this event.');
  assert.deepEqual(store.get('saved-q'), second);
});

test('later saved continuations extend a migrated history and remove newly visited cached possibilities', async t => {
  const root = await fixture(t), store = createHistoryStore(root);
  const rootRun = { id: 'new-root', divergence: 'What if inland lakes remained?', branches: [
    branch('b1', -3000, 'Lake communities keep a seasonal record'),
    branch('b2', -2000, 'Traders chart the northern channel'),
  ] };
  const rootRecord = { runId: rootRun.id, run: rootRun };
  const before = store.migrateLegacy([rootRecord]).questions[0];
  assert.equal(before.histories[0].events.length, 0);
  assert.equal(before.histories[0].suggestions.length, 2);
  const child = branch('c1', -1000, 'Canal keepers restore the old channel');
  const childRun = { id: 'new-child', divergence: rootRun.divergence,
    continuation: { rootRunId: rootRun.id, path: [{ runId: rootRun.id, branchId: 'b1', ...rootRun.branches[0] }, { runId: 'new-child', branchId: 'c1', ...child }] }, branches: [] };
  const after = store.migrateLegacy([rootRecord, { runId: childRun.id, run: childRun }]).questions[0];
  assert.equal(after.histories.length, 1);
  const originalHistoryId = after.histories[0].id;
  assert.deepEqual(after.histories[0].events.map(event => event.id), ['new-root:b1', 'new-child:c1']);
  assert.deepEqual(after.histories[0].suggestions.map(item => item.suggestionForEventId), ['new-root:b2']);
  store.save({ ...after, histories: after.histories.map(history => ({ ...history,
    events: history.events.map((event, index) => index === 1 ? { ...event, summary: 'Preserve this saved edit.' } : event) })) });
  const deepEvent = branch('d1', -500, 'Channel gardens support a later observatory');
  const deepRun = { id: 'deep-run', divergence: rootRun.divergence,
    continuation: { rootRunId: rootRun.id, path: [...childRun.continuation.path,
      { runId: 'deep-run', branchId: 'd1', ...deepEvent }] }, branches: [] };
  const extended = store.migrateLegacy([rootRecord, { runId: childRun.id, run: childRun }, { runId: deepRun.id, run: deepRun }]).questions[0];
  assert.equal(extended.histories.length, 1);
  assert.equal(extended.histories[0].id, originalHistoryId, 'extending H1 keeps its persisted history identity');
  assert.deepEqual(extended.histories[0].events.map(event => event.id), ['new-root:b1', 'new-child:c1', 'deep-run:d1']);
  assert.equal(extended.histories[0].events[1].summary, 'Preserve this saved edit.');
});

test('durable per-user/session usage counters survive restart without storing raw identifiers', async t => {
  const root = await fixture(t), store = createHistoryStore(root);
  assert.deepEqual(store.recordUsage({ userId: 'user-1', sessionId: 'session-1', kind: 'worldsEntered' }), { worldsEntered: 1, suggestionWindowsGenerated: 0, histories: 0 });
  store.recordUsage({ userId: 'user-1', sessionId: 'session-1', kind: 'suggestionWindowsGenerated', amount: 2 });
  store.recordUsage({ userId: 'user-1', sessionId: 'session-1', kind: 'histories' });
  assert.deepEqual(createHistoryStore(root).usage('user-1', 'session-1'), { worldsEntered: 1, suggestionWindowsGenerated: 2, histories: 1 });
  const persisted = await readFile(join(root, '.history', 'usage-v1.json'), 'utf8');
  assert.doesNotMatch(persisted, /user-1|session-1/);
  assert.throws(() => store.recordUsage({ userId: 'user-1', sessionId: 'session-1', kind: 'not-a-counter' }), /Invalid/);
});

test('corrupt or unsupported history state is never silently overwritten', async t => {
  const root = await fixture(t), directory = join(root, '.history');
  await mkdir(directory);
  await writeFile(join(directory, 'state-v1.json'), '{broken');
  const store = createHistoryStore(root);
  assert.throws(() => store.save({ id: 'q', histories: [] }), /Cannot read durable history state/);
  assert.equal(await readFile(join(directory, 'state-v1.json'), 'utf8'), '{broken');
});
