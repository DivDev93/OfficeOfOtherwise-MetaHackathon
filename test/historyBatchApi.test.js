import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { createDemoServer } from '../server/index.js';
import { createHistoryStore } from '../src/demo/historyStore.js';
import { createHistoryService } from '../src/demo/historyService.js';
import { normalizeQuestionHistories } from '../web/historyModel.js';
import { readFile } from 'node:fs/promises';

const fixture = JSON.parse(await readFile(new URL('./fixtures/history-arabia-weave-batch.json', import.meta.url), 'utf8'));
const accessCode = 'history-batch-plan-code';

test('batch-check is authorized, persisted, media-stable, and required for atomic commit', async t => {
  const liveRunsDir = await mkdtemp(join(tmpdir(), 'office-history-batch-api-'));
  t.after(() => rm(liveRunsDir, { recursive: true, force: true }));
  const store = createHistoryStore(liveRunsDir);
  const ids = fixture.history.suggestions.map(item => item.id);
  const question = normalizeQuestionHistories({ ...fixture.question, histories: [{ ...fixture.history,
    events: [], suggestions: fixture.history.suggestions.map(item => ({ ...item, causeEventId: fixture.question.id,
      era: 'Late Antiquity', geography: { version: 1, changes: [] }, verdict: 'fits', conflictsWith: null, reason: 'Fits current history.',
      ...([ids[4], ids[5]].includes(item.id) ? { sceneRef: { status: 'complete', path: `scenes/${item.id}.png` } } : {}) })) }] });
  store.save(question);
  let planCalls = 0, rippleCalls = 0;
  const idFor = title => fixture.history.suggestions.find(item => item.title === title).id;
  const agent = { async suggest() { return []; }, async planBatchWeave() {
    planCalls++;
    return { chain: [
      { suggestionId: idFor('Red Sea Monks Reach Jeddah'), causeEventId: fixture.question.id },
      { suggestionId: idFor("Buddhist Sailors' Shrine at Jeddah"), causeEventId: idFor('Red Sea Monks Reach Jeddah') },
      { suggestionId: idFor('Lotus Carvings at Hegra'), causeEventId: idFor("Buddhist Sailors' Shrine at Jeddah") },
      { suggestionId: idFor('Meccan Jataka Reliefs'), causeEventId: idFor("Buddhist Sailors' Shrine at Jeddah") },
      { suggestionId: idFor('Vihara Healing Garden in Mecca'), causeEventId: idFor('Meccan Jataka Reliefs') },
      { suggestionId: idFor('Buddhist Healing House at Hegra'), causeEventId: idFor('Lotus Carvings at Hegra') },
    ], merges: [{ suggestionIds: [ids[4], ids[5]], title: 'Arabian Healing Houses',
      summary: 'A Vihara Healing Garden in Mecca, Arabia and a Buddhist Healing House at Hegra, Arabia share healing methods.' }],
    conflicts: [{ suggestionId: ids[1], conflictsWith: ids[2], reason: 'The shrine and carving accounts place the same foundation at incompatible dates.' }] };
  }, async checkRippleBatch(args) { rippleCalls++; return args.events.map(event => ({ eventId: event.id, inconsistent: false, reason: '' })); } };
  const service = createHistoryService({ store, agent, perSessionWindowCap: 10 });
  const server = createDemoServer({ runsDir: join(liveRunsDir, 'runs'), liveRunsDir, packagedReplayRoot: null,
    webDir: resolve('web'), env: { DEMO_ACCESS_CODE: accessCode }, historyService: service });
  await new Promise(resolveListen => server.listen(0, '127.0.0.1', resolveListen));
  t.after(async () => { if (server.listening) await new Promise(resolveClose => server.close(resolveClose)); });
  const baseUrl = `http://127.0.0.1:${server.address().port}`;
  const health = await fetch(`${baseUrl}/health`);
  const cookie = health.headers.get('set-cookie')?.split(';', 1)[0];
  const headers = { 'x-demo-access-code': accessCode, cookie, 'content-type': 'application/json' };
  const request = (path, body, requestHeaders = headers) => fetch(`${baseUrl}${path}`, { method: 'POST', headers: requestHeaders, body: JSON.stringify(body) });
  const selection = { questionId: fixture.question.id, historyId: fixture.history.id, suggestionIds: ids };
  assert.equal((await request('/api/history/batch-check', selection, { 'content-type': 'application/json' })).status, 403);
  const checked = await request('/api/history/batch-check', selection);
  assert.equal(checked.status, 200);
  const { plan } = await checked.json();
  assert.equal(plan.chain.length, 6);
  assert.ok(plan.merges[0].id);
  assert.equal(plan.plannerVersion, 2);
  const stored = createHistoryStore(liveRunsDir).getBatchPlan(plan.planKey);
  assert.equal(stored.status, 'ready', 'the trusted plan survives a store restart');

  const currentQuestion = store.get(fixture.question.id);
  const latestHistory = currentQuestion.histories[0];
  latestHistory.suggestions = latestHistory.suggestions.map(item => item.id === ids[0]
    ? { ...item, sceneRef: { status: 'complete', path: 'scenes/red-sea.png' } } : item);
  store.save({ ...currentQuestion, histories: currentQuestion.histories.map(item => item.id === latestHistory.id ? latestHistory : item) });
  const replay = await request('/api/history/batch-check', selection);
  assert.equal(replay.status, 200);
  const replayPlan = await replay.json();
  assert.equal(replayPlan.cached, true);
  assert.equal(replayPlan.plan.chain[0].sceneRef.path, 'scenes/red-sea.png');
  assert.equal(planCalls, 1, 'semantic plan cache ignores later media completion');

  const unchecked = await request('/api/history/weave-batch', selection);
  assert.equal(unchecked.status, 400, 'raw suggestion IDs cannot bypass plan review');

  const beforeStaleEdit = store.get(fixture.question.id);
  const staleHistory = beforeStaleEdit.histories[0];
  const oldSummary = staleHistory.suggestions.find(item => item.id === ids[0]).summary;
  staleHistory.suggestions = staleHistory.suggestions.map(item => item.id === ids[0] ? { ...item, summary: `${item.summary} Revised.` } : item);
  store.save({ ...beforeStaleEdit, histories: beforeStaleEdit.histories.map(item => item.id === staleHistory.id ? staleHistory : item) });
  const staleCommit = await request('/api/history/weave-batch', { questionId: selection.questionId, historyId: selection.historyId, planId: plan.id,
    acceptedMergeIds: [plan.merges[0].id], excludedSuggestionIds: [ids[1]] });
  assert.equal(staleCommit.status, 409);
  assert.equal((await staleCommit.json()).code, 'batch_plan_stale');
  const restored = store.get(fixture.question.id);
  const restoredHistory = restored.histories[0];
  restoredHistory.suggestions = restoredHistory.suggestions.map(item => item.id === ids[0] ? { ...item, summary: oldSummary } : item);
  store.save({ ...restored, histories: restored.histories.map(item => item.id === restoredHistory.id ? restoredHistory : item) });

  const unresolved = await request('/api/history/weave-batch', { questionId: selection.questionId, historyId: selection.historyId, planId: plan.id,
    acceptedMergeIds: [plan.merges[0].id], excludedSuggestionIds: [] });
  assert.equal(unresolved.status, 409);
  assert.equal((await unresolved.json()).code, 'batch_conflicts_unresolved');
  const committed = await request('/api/history/weave-batch', { questionId: selection.questionId, historyId: selection.historyId, planId: plan.id,
    acceptedMergeIds: [plan.merges[0].id], excludedSuggestionIds: [ids[1]] });
  assert.equal(committed.status, 200);
  const result = await committed.json();
  assert.equal(result.events.length, 4);
  assert.equal(result.events[0].sceneRef.path, 'scenes/red-sea.png');
  assert.equal(result.events.find(item => item.id === ids[2]).causeEventId, ids[0], 'excluding a cause reconnects descendants to the nearest earlier retained cause');
  const merged = result.events.find(item => item.id === plan.merges[0].id);
  assert.match(merged.summary, /Mecca, Arabia/);
  assert.match(merged.summary, /Hegra, Arabia/);
  assert.deepEqual(merged.sourceSuggestionIds, [ids[4], ids[5]]);
  assert.equal(merged.sourceMediaRefs.length, 2, 'both source images survive normalization of the merged event');
  const repeat = await request('/api/history/weave-batch', { questionId: selection.questionId, historyId: selection.historyId, planId: plan.id,
    acceptedMergeIds: [plan.merges[0].id], excludedSuggestionIds: [ids[1]] });
  assert.equal(repeat.status, 200);
  assert.equal((await repeat.json()).cached, true);
  assert.equal(planCalls, 1);
  assert.equal(rippleCalls, 0, 'an empty base history has no later events to check');
});
