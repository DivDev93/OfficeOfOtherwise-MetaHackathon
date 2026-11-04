import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createHistoryService, HistoryServiceError } from '../src/demo/historyService.js';
import { createHistoryStore } from '../src/demo/historyStore.js';
import { migrateSavedTree, normalizeQuestionHistories } from '../web/historyModel.js';

const question = normalizeQuestionHistories({ id: 'lake-chad', question: 'What if Lake Chad stayed larger?', histories: [{ id: 'history-1', events: [
  { id: 'channels-2400', year: -2400, place: { name: 'Lake Chad', lat: 13, lon: 14 }, title: 'Timed channels water dry fields',
    summary: 'Communities use seasonal channels to direct water toward fields.', causeEventId: 'lake-chad' },
  { id: 'settlement-1800', year: -1800, place: { name: 'Lake Chad', lat: 13, lon: 14 }, title: 'Shoreline settlement expands',
    summary: 'Seasonal gardens support new shoreline homes.', causeEventId: 'channels-2400' },
] }] });

function memoryStore(initial = question) {
  let saved = structuredClone(initial);
  return { get: id => id === saved.id ? saved : null, list: () => [saved], save: value => { saved = normalizeQuestionHistories(value); return saved; },
    usage: () => ({ suggestionWindowsGenerated: 0 }), recordUsage: () => ({ histories: 1 }), current: () => saved };
}

function memoryStoreMany(questions) {
  const saved = new Map(questions.map(item => [item.id, normalizeQuestionHistories(item)]));
  return { get: id => saved.get(id) ?? null, list: () => [...saved.values()], save: value => { const next = normalizeQuestionHistories(value); saved.set(next.id, next); return next; },
    usage: () => ({ suggestionWindowsGenerated: 0 }), recordUsage: () => ({ histories: 1 }) };
}

function deferred() {
  let resolve, reject;
  const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}

const candidate = (id, year, verdict = 'fits', conflictsWith = null) => ({ id, year,
  place: { name: 'Lake Chad', lat: 13, lon: 14 }, title: id, summary: `${id} changes the seasonal water pattern.`,
  causeEventId: 'channels-2400', era: 'Late Holocene', geography: { version: 1, changes: [] }, verdict, conflictsWith,
  reason: verdict === 'conflicts' ? 'This change leaves the timed channels without enough lake water.' : 'It is consistent with the channels.' });

test('suggestion windows cache by history and window; More explicitly appends a fresh batch', async () => {
  const store = memoryStore();
  let count = 0;
  const service = createHistoryService({ store, agent: { async suggest() { count++; return [candidate(`event-${count}`, -2200 - count)]; } } });
  const args = { questionId: 'lake-chad', historyId: 'history-1', window: { fromYear: -3000, toYear: -2000 }, userId: 'u', sessionId: 's' };
  const first = await service.suggest(args);
  assert.equal(first.generated, true);
  assert.deepEqual(first.generatedSuggestionIds, first.suggestions.map(item => item.id));
  const cached = await service.suggest(args);
  assert.equal(cached.cached, true);
  assert.equal(cached.generatedSuggestionIds, undefined, 'cached browse does not identify suggestions for auto-weave');
  assert.equal(count, 1);
  assert.equal(cached.suggestions[0].id, first.suggestions[0].id);
  const more = await service.suggest({ ...args, more: true });
  assert.equal(more.generated, true);
  assert.equal(count, 2);
  assert.equal(more.history.suggestions.length, 2);
});

test('cached suggestions survive earlier weaves; each stale candidate is rechecked without another Wonder window call', async () => {
  const store = memoryStore();
  let generationCalls = 0, compatibilityChecks = 0, rippleChecks = 0;
  const service = createHistoryService({ store, agent: {
    async suggest() { generationCalls++; return [candidate('suggestion-a', -2300), candidate('suggestion-b', -2200), candidate('suggestion-c', -2100)]; },
    async checkRipple() { rippleChecks++; return { inconsistent: false, reason: '' }; },
    async checkSuggestion({ suggestion, history }) {
      compatibilityChecks++;
      if (suggestion.id === 'suggestion-c') return { verdict: 'conflicts', conflictsWith: 'suggestion-b',
        reason: 'This alternative depends on channels that the newly woven event redirected.' };
      return { verdict: 'fits', conflictsWith: null, reason: 'The saved event remains compatible with all current events.' };
    },
  } });
  const args = { questionId: 'lake-chad', historyId: 'history-1', window: { fromYear: -2400, toYear: -2000 } };
  const generated = await service.suggest(args);
  assert.equal(generated.suggestions.length, 3);
  await service.weave({ questionId: args.questionId, historyId: args.historyId, suggestionId: 'suggestion-a' });
  await service.weave({ questionId: args.questionId, historyId: args.historyId, suggestionId: 'suggestion-b' });
  await assert.rejects(service.weave({ questionId: args.questionId, historyId: args.historyId, suggestionId: 'suggestion-c' }),
    error => error.code === 'suggestion_became_conflict' && error.conflictsWith === 'suggestion-b');
  const finalHistory = store.get('lake-chad').histories[0];
  const updated = finalHistory.suggestions.find(item => item.id === 'suggestion-c');
  assert.equal(updated.verdict, 'conflicts');
  assert.equal(updated.conflictsWith, 'suggestion-b');
  assert.deepEqual(updated.window, args.window);
  assert.equal(finalHistory.events.some(item => item.id === 'suggestion-a'), true);
  assert.equal(finalHistory.events.some(item => item.id === 'suggestion-b'), true);
  assert.equal(finalHistory.events.some(item => item.id === 'suggestion-c'), false, 'a newly conflicting possibility is not auto-forked');
  assert.equal(generationCalls, 1, 'weaving cached candidates does not regenerate the window');
  assert.equal(compatibilityChecks, 2, 'only stale candidates get Spark rechecks');
  assert.equal(rippleChecks, 2, 'each weave checks only its later event');
});

test('unavailable stale-candidate check keeps the saved suggestion with a pending marker', async () => {
  const store = memoryStore();
  const original = store.get('lake-chad');
  original.histories[0].suggestions = [candidate('saved-fit', -2300, 'fits')];
  store.save(original);
  const service = createHistoryService({ store, agent: { async suggest() { throw new Error('No generation expected'); } } });
  const history = store.get('lake-chad').histories[0];
  const suggestion = history.suggestions[0];
  // A real history edit makes the saved fixture stale; lack of checker must not evict it or demand More.
  const changed = store.get('lake-chad');
  changed.histories[0].events[0].summary = 'Channels now follow a changed seasonal route.';
  store.save(changed);
  await assert.rejects(service.weave({ questionId: 'lake-chad', historyId: 'history-1', suggestionId: suggestion.id }),
    error => error.code === 'suggestion_recheck_pending' && /remains available/i.test(error.message));
  const retained = store.get('lake-chad').histories[0].suggestions.find(item => item.id === suggestion.id);
  assert.equal(retained.recheckStatus, 'pending');
  assert.equal(retained.verdict, 'fits');
});

test('history changes during a Spark recheck leave the cached candidate pending without an automatic retry', async () => {
  const store = memoryStore();
  const initial = store.get('lake-chad');
  initial.histories[0].suggestions = [candidate('saved-fit', -2300, 'fits')];
  store.save(initial);
  const gate = deferred();
  let calls = 0;
  const service = createHistoryService({ store, agent: { async suggest() { throw new Error('No window generation expected'); },
    async checkSuggestion() { calls++; return gate.promise; } } });
  const stale = store.get('lake-chad');
  stale.histories[0].events[0].summary = 'Channels now serve a new seasonal route.';
  store.save(stale);
  const checking = service.weave({ questionId: 'lake-chad', historyId: 'history-1', suggestionId: 'saved-fit' });
  while (!calls) await new Promise(resolve => setTimeout(resolve, 0));
  const editedAgain = store.get('lake-chad');
  editedAgain.histories[0].events[1].summary = 'The settlement now depends on a later water course.';
  store.save(editedAgain);
  gate.resolve({ verdict: 'fits', conflictsWith: null, reason: 'It remains compatible with the new history.' });
  await assert.rejects(checking, error => error.code === 'suggestion_recheck_pending');
  assert.equal(calls, 1, 'a changed revision does not trigger an automatic recheck loop');
  const retained = store.get('lake-chad').histories[0].suggestions.find(item => item.id === 'saved-fit');
  assert.equal(retained.recheckStatus, 'pending');
  assert.equal(retained.verdict, 'fits');
  assert.match(retained.recheckReason, /history-changed-during-check/);
});

test('migration suggestions receive a deterministic history revision without model calls', () => {
  const migrated = migrateSavedTree([{ runId: 'legacy-revision', run: { divergence: 'What if seasonal lakes stayed larger?',
    branches: [
      { id: 'visited', year: -3000, title: 'Wetland villages follow the lakes', summary: 'Seasonal lakes sustain gardens.', place: { name: 'Lake basin', lat: 12, lon: 14 } },
      { id: 'unvisited', year: -2000, title: 'Canal gardens expand', summary: 'Gardeners use small canals.', place: { name: 'Lake basin', lat: 12, lon: 14 } },
    ], hero: { branchId: 'visited' } } }]).questions[0];
  assert.equal(migrated.histories[0].suggestions[0].historyRevision, undefined);
  const store = memoryStoreMany([migrated]);
  let modelCalls = 0;
  createHistoryService({ store, agent: { async suggest() { modelCalls++; return []; } } });
  const stamped = store.get(migrated.id).histories[0].suggestions[0];
  assert.match(stamped.historyRevision, /^[a-f0-9]{64}$/);
  assert.equal(stamped.verdict, 'fits');
  assert.equal(modelCalls, 0);
});

test('older conflicting alternatives fork at the earlier year and do not share events after it', async () => {
  const olderQuestion = normalizeQuestionHistories({ id: 'marsh-question', question: 'What if marshes spread earlier?', histories: [{ id: 'history-marsh', events: [
    { id: 'older-waterway', year: -5000, place: { name: 'Lake Chad', lat: 13, lon: 14 }, title: 'Early waterway gardens', summary: 'Gardens follow a lake margin.', causeEventId: 'marsh-question' },
    { id: 'channels-2400', year: -2400, place: { name: 'Lake Chad', lat: 13, lon: 14 }, title: 'Timed channels water dry fields', summary: 'Channels direct open lake water to dry fields.', causeEventId: 'older-waterway' },
    { id: 'later-settlement', year: -1800, place: { name: 'Lake Chad', lat: 13, lon: 14 }, title: 'Later shoreline settlement', summary: 'Homes follow the channels.', causeEventId: 'channels-2400' },
  ] }] });
  const store = memoryStore(olderQuestion);
  const suggestion = { ...candidate('marsh-by-3000', -3000, 'conflicts', 'channels-2400'), causeEventId: 'channels-2400', window: { fromYear: -3500, toYear: -2000 } };
  const withSuggestion = store.get('marsh-question');
  withSuggestion.histories[0].suggestions = [suggestion];
  store.save(withSuggestion);
  const result = await createHistoryService({ store, agent: { async suggest() { return []; } } }).fork({ questionId: 'marsh-question', historyId: 'history-marsh',
    eventId: 'channels-2400', suggestionId: 'marsh-by-3000' });
  assert.deepEqual(result.sharedEventIds, ['older-waterway']);
  assert.deepEqual(result.history.events.map(event => event.id), ['older-waterway', 'marsh-by-3000']);
  assert.equal(result.history.origin.forkYear, -3000);
  assert.equal(result.history.forkEventId, 'channels-2400');
  assert.equal(result.history.events.find(event => event.id === 'marsh-by-3000').causeEventId, 'marsh-question');
  assert.match(result.history.forkReason, /original cause, Timed channels water dry fields, falls after fork year -3000/);
});

test('weaving inserts a fitting event in date order and persists explicit Spark ripple flags', async () => {
  const store = memoryStore();
  const later = store.get('lake-chad').histories[0].events[1];
  const item = candidate('suggestion-fit', -2200);
  const withSuggestion = store.get('lake-chad');
  withSuggestion.histories[0].suggestions = [item];
  store.save(withSuggestion);
  const rippleCalls = [];
  const service = createHistoryService({ store, agent: { async suggest() { return []; }, async checkRipple(args) {
    rippleCalls.push(args); return { inconsistent: true, reason: 'The channel layout no longer supplies this later settlement.' };
  } } });
  const result = await service.weave({ questionId: 'lake-chad', historyId: 'history-1', suggestionId: 'suggestion-fit' });
  assert.deepEqual(result.history.events.map(event => event.id), ['channels-2400', 'suggestion-fit', 'settlement-1800']);
  assert.equal(rippleCalls.length, 1);
  assert.equal(result.ripple[0].eventId, later.id);
  assert.match(result.ripple[0].message, /Written before 2200 BCE was woven in/);
  assert.ok(result.history.events.find(event => event.id === later.id).checkFlags.some(flag => flag.kind === 'weave-ripple'));
  assert.equal(result.history.events.find(event => event.id === later.id).title, later.title, 'ripple checks never auto-edit events');
});

test('batch weave validates all six candidates, saves them together, and runs one combined ripple check', async () => {
  const store = memoryStore();
  const questionWithCandidates = store.get('lake-chad');
  const suggestions = Array.from({ length: 6 }, (_, index) => ({
    ...candidate(`batch-${index + 1}`, -2300 + index * 50),
    sceneRef: { status: 'complete', path: `scenes/${index + 1}.png` },
  }));
  questionWithCandidates.histories[0].suggestions = suggestions;
  store.save(questionWithCandidates);
  const calls = [];
  const service = createHistoryService({ store, agent: { async suggest() { return []; }, async planBatchWeave({ suggestions: selected }) {
    return { chain: selected.map(item => ({ suggestionId: item.id, causeEventId: 'channels-2400' })), merges: [], conflicts: [] };
  }, async checkRippleBatch(args) {
    calls.push(args);
    return [{ eventId: 'settlement-1800', inconsistent: true, reason: 'The later settlement now lacks sufficient water.' }];
  } } });
  const ids = suggestions.map(item => item.id);
  const checked = await service.batchCheck({ questionId: 'lake-chad', historyId: 'history-1', suggestionIds: ids, userId: 'u', sessionId: 's' });
  const result = await service.weaveBatch({ questionId: 'lake-chad', historyId: 'history-1', planId: checked.plan.id,
    acceptedMergeIds: [], excludedSuggestionIds: [], userId: 'u', sessionId: 's' });
  assert.deepEqual(result.events.map(item => item.id), ids);
  assert.deepEqual(result.history.events.map(item => item.id), ['channels-2400', ...ids, 'settlement-1800']);
  assert.equal(result.history.suggestions.length, 0);
  assert.equal(result.events[0].causeEventId, 'channels-2400');
  assert.equal(result.events[0].sceneRef.path, suggestions[0].sceneRef.path);
  assert.equal(calls.length, 1);
  assert.deepEqual(calls[0].wovenEvents.map(item => item.id), ids);
  assert.equal(calls[0].events.length, 1);
  assert.equal(result.ripple.length, 6, 'the combined verdict is associated with each newly earlier woven event');
  assert.equal(result.ripple[0].status, 'review');

  const replay = await service.weaveBatch({ questionId: 'lake-chad', historyId: 'history-1', planId: checked.plan.id,
    acceptedMergeIds: [], excludedSuggestionIds: [], userId: 'u', sessionId: 's' });
  assert.equal(replay.cached, true);
  assert.equal(replay.history.events.filter(item => ids.includes(item.id)).length, 6);
  assert.equal(calls.length, 1, 'idempotent replay does not dispatch another Spark request');
});

test('batch weave rejects an invalid selection before inserting any selected event', async () => {
  const store = memoryStore();
  const questionWithCandidates = store.get('lake-chad');
  const suggestions = [candidate('batch-valid', -2300), candidate('batch-conflict', -2200, 'conflicts', 'settlement-1800')];
  questionWithCandidates.histories[0].suggestions = suggestions;
  store.save(questionWithCandidates);
  const service = createHistoryService({ store, agent: { async suggest() { return []; }, async checkRippleBatch() { throw new Error('should not dispatch'); } } });
  await assert.rejects(service.weaveBatch({ questionId: 'lake-chad', historyId: 'history-1', suggestionIds: suggestions.map(item => item.id), userId: 'u', sessionId: 's' }),
    error => error.code === 'invalid_batch');
  assert.deepEqual(store.get('lake-chad').histories[0].events.map(item => item.id), ['channels-2400', 'settlement-1800']);
  assert.equal(store.get('lake-chad').histories[0].suggestions.length, 2);
});

test('batch check does not redispatch an uncertain Wonder request without its explicit retry receipt', async () => {
  const store = memoryStore();
  const item = candidate('batch-review', -2200);
  const withSuggestion = store.get('lake-chad');
  withSuggestion.histories[0].suggestions = [item];
  store.save(withSuggestion);
  let dispatches = 0;
  const service = createHistoryService({ store, perSessionWindowCap: 3, agent: {
    client: { dispatchCount: () => dispatches },
    async suggest() { return []; },
    async planBatchWeave({ question, suggestions }) {
      dispatches++;
      if (dispatches === 1) throw new Error('response lost after dispatch');
      return { chain: [{ suggestionId: suggestions[0].id, causeEventId: question.id }], merges: [], conflicts: [] };
    },
  } });
  const args = { questionId: 'lake-chad', historyId: 'history-1', suggestionIds: [item.id], userId: 'u', sessionId: 's' };
  let receipt;
  await assert.rejects(service.batchCheck(args), error => {
    assert.equal(error.code, 'batch_plan_uncertain');
    assert.equal(error.possibleCharge, true);
    receipt = error.retryOf;
    return !!receipt;
  });
  await assert.rejects(service.batchCheck(args), error => error.code === 'batch_plan_uncertain' && error.retryOf === receipt);
  assert.equal(dispatches, 1);
  const explicit = await service.batchCheck({ ...args, retryOf: receipt });
  assert.equal(explicit.plan.chain[0].id, item.id);
  assert.equal(dispatches, 2);
});

test('checked batch performs one Spark call for multiple later events and persists an unavailable result without replaying', async () => {
  const store = memoryStore();
  const questionWithCandidates = store.get('lake-chad');
  questionWithCandidates.histories[0].events.push({ id: 'reed-craft-1500', year: -1500,
    place: { name: 'Lake Chad', lat: 13, lon: 14 }, title: 'Reed craft travels the shore', summary: 'Shore communities exchange reed craft.',
    causeEventId: 'settlement-1800' });
  const suggestions = [candidate('checked-a', -2300), candidate('checked-b', -2200)];
  questionWithCandidates.histories[0].suggestions = suggestions;
  store.save(questionWithCandidates);
  let rippleCalls = 0;
  const service = createHistoryService({ store, agent: { async suggest() { return []; },
    async planBatchWeave({ question, suggestions: selected }) { return { chain: selected.map(item => ({ suggestionId: item.id, causeEventId: question.id })), merges: [], conflicts: [] }; },
    async checkRippleBatch({ events }) { rippleCalls++; assert.deepEqual(events.map(item => item.id), ['settlement-1800', 'reed-craft-1500']);
      if (rippleCalls === 1) throw new Error('Spark unavailable');
      return events.map(item => ({ eventId: item.id, inconsistent: false, reason: '' }));
    },
  } });
  const args = { questionId: 'lake-chad', historyId: 'history-1', suggestionIds: suggestions.map(item => item.id), userId: 'u', sessionId: 's' };
  const checked = await service.batchCheck(args);
  const result = await service.weaveBatch({ questionId: args.questionId, historyId: args.historyId, planId: checked.plan.id,
    acceptedMergeIds: [], excludedSuggestionIds: [], userId: 'u', sessionId: 's' });
  assert.equal(rippleCalls, 1);
  assert.equal(result.ripple.length, 4, 'each later event gets one flag per newly earlier event');
  assert.ok(result.ripple.every(flag => flag.status === 'unavailable'));
  const replay = await service.weaveBatch({ questionId: args.questionId, historyId: args.historyId, planId: checked.plan.id,
    acceptedMergeIds: [], excludedSuggestionIds: [], userId: 'u', sessionId: 's' });
  assert.equal(replay.cached, true);
  assert.equal(rippleCalls, 1, 'idempotent commit does not automatically retry an uncertain Spark check');
  const retried = await service.rippleCheckBatch({ questionId: args.questionId, historyId: args.historyId,
    eventIds: ['settlement-1800', 'reed-craft-1500'], wovenEventIds: suggestions.map(item => item.id) });
  assert.equal(rippleCalls, 2, 'the explicit retry makes one productive combined Spark call');
  assert.deepEqual(retried.ripple, []);
  assert.ok(['settlement-1800', 'reed-craft-1500'].every(id => store.get('lake-chad').histories[0].events
    .find(item => item.id === id).checkFlags.every(flag => flag.kind !== 'weave-ripple' || flag.status === 'kept')));
});

test('durable batch commit receipt replays after restart before Spark finalization, preserving merge and exclusion choices', async t => {
  const root = await mkdtemp(join(tmpdir(), 'office-history-batch-commit-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const sourceA = { ...candidate('durable-a', -2300), sceneRef: { status: 'complete', path: 'scenes/durable-a.png' } };
  const sourceB = { ...candidate('durable-b', -2250), heroRef: { status: 'complete', path: 'scenes/durable-b.png' } };
  const excluded = candidate('durable-excluded', -2200);
  const initial = structuredClone(question);
  initial.histories[0].suggestions = [sourceA, sourceB, excluded];
  const firstStore = createHistoryStore(root);
  firstStore.save(initial);
  const enteredRipple = deferred();
  const finishRipple = deferred();
  let rippleCalls = 0;
  const agent = { async suggest() { return []; },
    async planBatchWeave({ question: currentQuestion, suggestions }) {
      return { chain: suggestions.map(item => ({ suggestionId: item.id, causeEventId: 'channels-2400' })),
        merges: [{ suggestionIds: [sourceA.id, sourceB.id], title: 'Combined lake practice',
          summary: 'Lake Chad communities combine the shared water practices.' }], conflicts: [] };
    },
    async checkRippleBatch({ events }) {
      rippleCalls++;
      enteredRipple.resolve(events);
      return finishRipple.promise;
    } };
  const firstService = createHistoryService({ store: firstStore, agent });
  const args = { questionId: 'lake-chad', historyId: 'history-1', suggestionIds: [sourceA.id, sourceB.id, excluded.id], userId: 'durable-user', sessionId: 'durable-session' };
  const checked = await firstService.batchCheck(args);
  const mergeId = checked.plan.merges[0].id;
  const commitPromise = firstService.weaveBatch({ ...args, planId: checked.plan.id, acceptedMergeIds: [mergeId], excludedSuggestionIds: [excluded.id] });
  const laterEvents = await enteredRipple.promise;
  assert.deepEqual(laterEvents.map(item => item.id), ['settlement-1800']);

  const reopenedStore = createHistoryStore(root);
  const receipt = reopenedStore.getBatchPlan(checked.plan.planKey);
  assert.equal(receipt.status, 'committed', 'the plan receipt is durable in the same write as the changed history');
  assert.deepEqual(receipt.acceptedMergeIds, [mergeId]);
  assert.deepEqual(receipt.excludedSuggestionIds, [excluded.id]);
  const reopenedService = createHistoryService({ store: reopenedStore, agent: {
    async suggest() { return []; },
    async planBatchWeave() { throw new Error('replay must not plan again'); },
    async checkRippleBatch() { rippleCalls++; throw new Error('replay must not redispatch Spark'); },
  } });
  const replay = await reopenedService.weaveBatch({ ...args, planId: checked.plan.id, acceptedMergeIds: [mergeId], excludedSuggestionIds: [excluded.id] });
  assert.equal(replay.cached, true);
  assert.equal(replay.events.length, 1);
  assert.equal(replay.events[0].id, mergeId);
  assert.deepEqual(replay.events[0].sourceSuggestionIds, [sourceA.id, sourceB.id]);
  assert.deepEqual(replay.events[0].sourceMediaRefs.map(item => item.suggestionId), [sourceA.id, sourceB.id]);
  assert.equal(replay.history.events.filter(item => item.id === mergeId).length, 1);
  assert.equal(replay.history.suggestions.some(item => item.id === excluded.id), true);
  assert.equal(rippleCalls, 1, 'restart replay does not redispatch the in-flight combined Spark check');

  finishRipple.resolve([{ eventId: 'settlement-1800', inconsistent: false, reason: '' }]);
  await commitPromise;
  const finishedStore = createHistoryStore(root);
  assert.equal(finishedStore.get('lake-chad').histories[0].events.filter(item => item.id === mergeId).length, 1);
  assert.equal(finishedStore.getBatchPlan(checked.plan.planKey).status, 'committed');
  assert.equal(rippleCalls, 1);
});

test('pending batch finalize and remove are persistence-only; removal restores source media and repairs descendants', async () => {
  const makeSources = () => [
    { ...candidate('pending-a', -2300), window: { fromYear: -2500, toYear: -2000 }, sceneRef: { status: 'complete', path: 'scenes/pending-a.png' } },
    { ...candidate('pending-b', -2250), window: { fromYear: -2500, toYear: -2000 }, heroRef: { status: 'complete', path: 'scenes/pending-b.png' } },
    { ...candidate('pending-excluded', -2200), window: { fromYear: -2500, toYear: -2000 } },
  ];
  async function createPendingRun() {
    const store = memoryStore();
    const sources = makeSources();
    const saved = store.get('lake-chad');
    saved.histories[0].suggestions = sources;
    store.save(saved);
    let modelCalls = 0;
    const service = createHistoryService({ store, agent: { async suggest() { throw new Error('not used'); },
      async planBatchWeave({ suggestions }) {
        modelCalls++;
        return { chain: suggestions.map(item => ({ suggestionId: item.id, causeEventId: 'channels-2400' })),
          merges: [{ suggestionIds: ['pending-a', 'pending-b'], title: 'Combined water practice',
            summary: 'Lake Chad communities combine the water practices.' }], conflicts: [] };
      }, async checkRippleBatch({ events }) {
        modelCalls++;
        return events.map(item => ({ eventId: item.id, inconsistent: false, reason: '' }));
      } } });
    const args = { questionId: 'lake-chad', historyId: 'history-1', suggestionIds: sources.map(item => item.id), userId: 'u', sessionId: 's' };
    const checked = await service.batchCheck(args);
    const mergeId = checked.plan.merges[0].id;
    const result = await service.weaveBatch({ ...args, planId: checked.plan.id, acceptedMergeIds: [mergeId],
      excludedSuggestionIds: ['pending-excluded'], pending: true });
    assert.equal(result.pendingBatchId, result.events[0].pendingBatchId);
    return { store, service, sources, args, result, mergeId, modelCalls: () => modelCalls };
  }

  const finalized = await createPendingRun();
  assert.equal(finalized.result.history.weaveBatches[0].sourceSuggestions.length, 2);
  assert.deepEqual(finalized.result.events[0].pendingWindows, [{ fromYear: -2500, toYear: -2000 }]);
  assert.deepEqual(finalized.result.events[0].sourceMediaRefs.map(item => item.suggestionId), ['pending-a', 'pending-b']);
  const callsBeforeFinalize = finalized.modelCalls();
  const kept = await finalized.service.finalizePendingWeave({ questionId: 'lake-chad', historyId: 'history-1', pendingBatchId: finalized.result.pendingBatchId });
  assert.equal(kept.events[0].pending, undefined);
  assert.equal(kept.history.weaveBatches[0].status, 'kept');
  assert.equal(finalized.modelCalls(), callsBeforeFinalize, 'finalize is persistence-only');
  assert.equal((await finalized.service.finalizePendingWeave({ questionId: 'lake-chad', historyId: 'history-1', pendingBatchId: finalized.result.pendingBatchId })).cached, true);
  await assert.rejects(finalized.service.removePendingWeave({ questionId: 'lake-chad', historyId: 'history-1', pendingBatchId: finalized.result.pendingBatchId }),
    error => error.code === 'pending_batch_finalized');

  const removed = await createPendingRun();
  const child = { id: 'pending-descendant', year: -1700, place: { name: 'Lake Chad', lat: 13, lon: 14 },
    title: 'A later settlement follows the combined practice', summary: 'Lake Chad settlement builders adapt the combined practice.',
    causeEventId: removed.mergeId };
  const withChild = removed.store.get('lake-chad');
  withChild.histories[0].events.push(child);
  removed.store.save(withChild);
  const callsBeforeRemove = removed.modelCalls();
  const restored = await removed.service.removePendingWeave({ questionId: 'lake-chad', historyId: 'history-1', pendingBatchId: removed.result.pendingBatchId });
  assert.equal(removed.modelCalls(), callsBeforeRemove, 'remove is persistence-only');
  assert.equal(restored.history.events.some(item => item.id === removed.mergeId), false);
  assert.equal(restored.history.events.find(item => item.id === child.id).causeEventId, 'channels-2400');
  assert.ok(restored.history.events.every(event => event.causeEventId === 'lake-chad'
    || restored.history.events.some(cause => cause.id === event.causeEventId && cause.year < event.year)));
  assert.deepEqual(restored.history.suggestions.map(item => item.id), ['pending-a', 'pending-b', 'pending-excluded']);
  assert.equal(restored.history.suggestions.find(item => item.id === 'pending-a').sceneRef.path, 'scenes/pending-a.png');
  assert.equal(restored.history.suggestions.find(item => item.id === 'pending-b').heroRef.path, 'scenes/pending-b.png');
  assert.equal(restored.history.events.find(item => item.id === 'settlement-1800').checkFlags.some(flag => flag.kind === 'weave-ripple'), false);
  assert.equal(restored.history.weaveBatches[0].status, 'removed');
  assert.equal((await removed.service.removePendingWeave({ questionId: 'lake-chad', historyId: 'history-1', pendingBatchId: removed.result.pendingBatchId })).cached, true);
});

test('removing one pending merged row restores only its sources and leaves the other batch rows pending', async () => {
  const store = memoryStore();
  const sources = [
    { ...candidate('row-a', -2300), window: { fromYear: -2500, toYear: -2000 } },
    { ...candidate('row-mid-a', -2200), window: { fromYear: -2500, toYear: -2000 }, sceneRef: { status: 'complete', path: 'scenes/row-mid-a.png' } },
    { ...candidate('row-mid-b', -2150), window: { fromYear: -2500, toYear: -2000 }, heroRef: { status: 'complete', path: 'scenes/row-mid-b.png' } },
    { ...candidate('row-c', -2100), window: { fromYear: -2500, toYear: -2000 } },
  ];
  const seeded = store.get('lake-chad');
  seeded.histories[0].suggestions = sources;
  store.save(seeded);
  let modelCalls = 0;
  const service = createHistoryService({ store, agent: { async suggest() { throw new Error('not used'); },
    async planBatchWeave({ suggestions }) {
      modelCalls++;
      return { chain: suggestions.map((item, index) => ({ suggestionId: item.id,
        causeEventId: index ? suggestions[index - 1].id : 'channels-2400' })),
        merges: [{ suggestionIds: ['row-mid-a', 'row-mid-b'], title: 'Combined middle-row practice',
          summary: 'Lake Chad communities combine these related middle-period practices.' }], conflicts: [] };
    }, async checkRippleBatch({ events }) {
      modelCalls++;
      return events.map(item => ({ eventId: item.id, inconsistent: true, reason: 'Review after the provisional changes.' }));
    } } });
  const args = { questionId: 'lake-chad', historyId: 'history-1', suggestionIds: sources.map(item => item.id), userId: 'u', sessionId: 's' };
  const checked = await service.batchCheck(args);
  const mergedId = checked.plan.merges[0].id;
  const committed = await service.weaveBatch({ ...args, planId: checked.plan.id, acceptedMergeIds: [mergedId],
    excludedSuggestionIds: [], pending: true });
  assert.deepEqual(committed.events.map(item => item.id), ['row-a', mergedId, 'row-c']);
  assert.equal(modelCalls, 2, 'the checked batch uses one Wonder and one combined Spark call');
  const callCount = modelCalls;
  const removed = await service.removePendingWeave({ questionId: 'lake-chad', historyId: 'history-1',
    pendingBatchId: committed.pendingBatchId, eventId: mergedId });
  assert.equal(modelCalls, callCount, 'per-row remove is persistence-only');
  assert.deepEqual(removed.removedEventIds, [mergedId]);
  assert.deepEqual(removed.history.events.filter(item => item.pending).map(item => item.id), ['row-a', 'row-c']);
  assert.equal(removed.history.events.find(item => item.id === 'row-c').causeEventId, 'row-a');
  assert.deepEqual(removed.history.suggestions.map(item => item.id), ['row-mid-a', 'row-mid-b']);
  assert.equal(removed.history.suggestions.find(item => item.id === 'row-mid-a').sceneRef.path, 'scenes/row-mid-a.png');
  assert.equal(removed.history.suggestions.find(item => item.id === 'row-mid-b').heroRef.path, 'scenes/row-mid-b.png');
  assert.deepEqual(removed.history.weaveBatches[0].eventIds, ['row-a', 'row-c']);
  assert.deepEqual(removed.history.weaveBatches[0].sourceSuggestions.map(item => item.id), ['row-a', 'row-c']);
  const laterFlags = removed.history.events.find(item => item.id === 'settlement-1800').checkFlags.filter(flag => flag.kind === 'weave-ripple');
  assert.deepEqual(laterFlags.map(flag => flag.wovenEventId), ['row-a', 'row-c']);
  assert.equal((await service.removePendingWeave({ questionId: 'lake-chad', historyId: 'history-1',
    pendingBatchId: committed.pendingBatchId, eventId: mergedId })).cached, true, 'repeat removal cannot restore duplicate source suggestions');
  const finalized = await service.finalizePendingWeave({ questionId: 'lake-chad', historyId: 'history-1', pendingBatchId: committed.pendingBatchId });
  assert.deepEqual(finalized.events.map(item => item.id), ['row-a', 'row-c']);
  assert.ok(finalized.events.every(item => item.pending !== true));
  assert.equal(modelCalls, callCount, 'finalizing the remaining rows is persistence-only');
});

test('conflicting suggestion forks with shared earlier prefix and leaves original history intact', async () => {
  const store = memoryStore();
  const item = candidate('suggestion-alt', -2300, 'conflicts', 'channels-2400');
  const questionWithSuggestion = store.get('lake-chad');
  questionWithSuggestion.histories[0].suggestions = [item];
  store.save(questionWithSuggestion);
  const service = createHistoryService({ store, agent: { async suggest() { return []; } } });
  const result = await service.fork({ questionId: 'lake-chad', historyId: 'history-1', eventId: 'channels-2400', suggestionId: 'suggestion-alt' });
  assert.equal(result.sharedEventIds.length, 0);
  assert.deepEqual(result.history.events.map(event => event.id), ['suggestion-alt']);
  assert.equal(result.history.forkEventId, 'channels-2400');
  assert.deepEqual(store.get('lake-chad').histories[0].events.map(event => event.id), ['channels-2400', 'settlement-1800']);
  assert.equal(result.readyForAlternative, false);
});

test('direct deliberate fork copies only the strictly earlier prefix and remains ready for an alternative', async () => {
  const store = memoryStore();
  const service = createHistoryService({ store, agent: { async suggest() { return []; } } });
  const result = await service.fork({ questionId: 'lake-chad', historyId: 'history-1', eventId: 'settlement-1800' });
  assert.deepEqual(result.history.events.map(event => event.id), ['channels-2400']);
  assert.equal(result.history.forkEventId, 'settlement-1800');
  assert.equal(result.history.origin.kind, 'deliberate-what-if');
  assert.equal(result.history.origin.replacedEvent.id, 'settlement-1800');
  assert.equal(result.history.origin.replacedEvent.title, 'Shoreline settlement expands');
  assert.equal(result.readyForAlternative, true);
});

test('a conflicting suggestion cannot be woven', async () => {
  const store = memoryStore();
  const questionWithSuggestion = store.get('lake-chad');
  questionWithSuggestion.histories[0].suggestions = [candidate('suggestion-conflict', -2300, 'conflicts', 'channels-2400')];
  store.save(questionWithSuggestion);
  const service = createHistoryService({ store, agent: { async suggest() { return []; } } });
  await assert.rejects(service.weave({ questionId: 'lake-chad', historyId: 'history-1', suggestionId: 'suggestion-conflict' }),
    error => error instanceof HistoryServiceError && ['conflict_requires_fork', 'suggestion_became_conflict'].includes(error.code) && error.status === 409);
});

test('explicit regeneration replaces one flagged later event; Keep resolves its flag without a model call', async () => {
  const store = memoryStore();
  const current = store.get('lake-chad');
  current.histories[0].events[1].checkFlags = [{ kind: 'weave-ripple', eventId: 'settlement-1800', wovenEventId: 'channels-2400',
    message: 'Written before channels were woven in. Re-check suggested.', actions: ['keep', 'regenerate'] }];
  store.save(current);
  let calls = 0;
  const service = createHistoryService({ store, agent: { async suggest() { return []; }, async regenerateEvent({ event }) {
    calls++;
    return { id: event.id, year: event.year, place: event.place, title: 'Regenerated shoreline settlement',
      summary: 'The later homes use the new channel flows.', causeEventId: 'channels-2400', era: event.era, geography: event.geography };
  } } });
  const result = await service.regenerateEvent({ questionId: 'lake-chad', historyId: 'history-1', eventId: 'settlement-1800' });
  assert.equal(result.event.title, 'Regenerated shoreline settlement');
  assert.equal(result.event.checkFlags.some(flag => flag.kind === 'weave-ripple'), false);
  assert.equal(calls, 1);

  const another = store.get('lake-chad');
  another.histories[0].events[1].checkFlags = [{ kind: 'weave-ripple', eventId: 'settlement-1800', wovenEventId: 'channels-2400', actions: ['keep', 'regenerate'] }];
  store.save(another);
  const kept = await service.keepEvent({ questionId: 'lake-chad', historyId: 'history-1', eventId: 'settlement-1800' });
  assert.equal(kept.event.checkFlags[0].status, 'kept');
  assert.equal(calls, 1, 'Keep does not make a model call');
});

test('empty histories with the same history id in different questions do not share window cache keys', async () => {
  const firstQuestion = normalizeQuestionHistories({ id: 'q-one', question: 'First question', histories: [{ id: 'history-empty', events: [] }] });
  const secondQuestion = normalizeQuestionHistories({ id: 'q-two', question: 'Second question', histories: [{ id: 'history-empty', events: [] }] });
  const store = memoryStoreMany([firstQuestion, secondQuestion]);
  let calls = 0;
  const service = createHistoryService({ store, agent: { async suggest({ question }) {
    calls++;
    return [{ id: `suggestion-${question.id}`, year: -1000, place: { name: 'A', lat: 0, lon: 0 }, title: question.id,
      summary: `A change for ${question.id}.`, causeEventId: question.id, verdict: 'fits', conflictsWith: null, reason: 'Compatible with the question.' }];
  } } });
  const window = { fromYear: -1100, toYear: -900 };
  const one = await service.suggest({ questionId: 'q-one', historyId: 'history-empty', window });
  const two = await service.suggest({ questionId: 'q-two', historyId: 'history-empty', window });
  assert.equal(calls, 2);
  assert.equal(one.suggestions[0].title, 'q-one');
  assert.equal(two.suggestions[0].title, 'q-two');
});

test('concurrent windows append against the latest history without losing either batch', async () => {
  const store = memoryStore();
  const gates = [];
  const service = createHistoryService({ store, agent: { suggest({ window }) {
    const gate = deferred(); gates.push(gate);
    return gate.promise;
  } } });
  const firstWindow = { fromYear: -2300, toYear: -2200 };
  const secondWindow = { fromYear: -2100, toYear: -2000 };
  const first = service.suggest({ questionId: 'lake-chad', historyId: 'history-1', window: firstWindow });
  const second = service.suggest({ questionId: 'lake-chad', historyId: 'history-1', window: secondWindow });
  while (gates.length < 2) await new Promise(resolve => setTimeout(resolve, 0));
  gates[1].resolve([candidate('second-window', -2050)]);
  gates[0].resolve([candidate('first-window', -2250)]);
  await Promise.all([first, second]);
  assert.deepEqual(store.get('lake-chad').histories[0].suggestions.map(item => item.id).sort(), ['first-window', 'second-window']);
});

test('an explicit More request does not join an initial window request already in flight', async () => {
  const store = memoryStore();
  const gates = [];
  const service = createHistoryService({ store, agent: { suggest() {
    const gate = deferred(); gates.push(gate);
    return gate.promise;
  } } });
  const args = { questionId: 'lake-chad', historyId: 'history-1', window: { fromYear: -2300, toYear: -2100 } };
  const initial = service.suggest(args);
  while (gates.length < 1) await new Promise(resolve => setTimeout(resolve, 0));
  const more = service.suggest({ ...args, more: true });
  while (gates.length < 2) await new Promise(resolve => setTimeout(resolve, 0));
  gates[1].resolve([candidate('more-batch', -2150)]);
  gates[0].resolve([candidate('initial-batch', -2250)]);
  await Promise.all([initial, more]);
  assert.deepEqual(store.get('lake-chad').histories[0].suggestions.map(item => item.id).sort(), ['initial-batch', 'more-batch']);
});

test('weave commits review-needed flags before Spark; Keep during a deferred check is preserved and retry is idempotent', async () => {
  const store = memoryStore();
  const withSuggestion = store.get('lake-chad');
  withSuggestion.histories[0].suggestions = [candidate('suggestion-pending', -2200)];
  store.save(withSuggestion);
  const gate = deferred();
  let rippleCalls = 0;
  const service = createHistoryService({ store, agent: { async suggest() { return []; }, async checkRipple() { rippleCalls++; return gate.promise; } } });
  const weaving = service.weave({ questionId: 'lake-chad', historyId: 'history-1', suggestionId: 'suggestion-pending' });
  while (rippleCalls === 0) await new Promise(resolve => setTimeout(resolve, 0));
  const pending = store.get('lake-chad').histories[0].events.find(item => item.id === 'settlement-1800');
  assert.equal(pending.checkFlags[0].status, 'pending');
  const fork = await service.fork({ questionId: 'lake-chad', historyId: 'history-1', eventId: 'settlement-1800' });
  await service.keepEvent({ questionId: 'lake-chad', historyId: 'history-1', eventId: 'settlement-1800' });
  gate.resolve({ inconsistent: true, reason: 'The new water course differs.' });
  await weaving;
  const kept = store.get('lake-chad').histories[0].events.find(item => item.id === 'settlement-1800');
  assert.equal(kept.checkFlags[0].status, 'kept');
  assert.ok(store.get('lake-chad').histories.some(item => item.id === fork.history.id), 'the concurrent fork remains saved');
  const replay = await service.weave({ questionId: 'lake-chad', historyId: 'history-1', suggestionId: 'suggestion-pending' });
  assert.equal(replay.cached, true);
  assert.equal(rippleCalls, 1);
});

test('weaving a second event preserves the first weave flag; Keep and Regenerate target only one flag', async () => {
  const store = memoryStore();
  const current = store.get('lake-chad');
  current.histories[0].events.push(
    { id: 'woven-a', year: -2300, place: { name: 'Lake Chad', lat: 13, lon: 14 }, title: 'First new channel', summary: 'A seasonal channel redirects water.', causeEventId: 'channels-2400' },
    { id: 'woven-b', year: -2200, place: { name: 'Lake Chad', lat: 13, lon: 14 }, title: 'Second new channel', summary: 'A second channel adjusts the flow.', causeEventId: 'woven-a' },
  );
  current.histories[0].events.find(item => item.id === 'settlement-1800').checkFlags = [
    { kind: 'weave-ripple', eventId: 'settlement-1800', wovenEventId: 'woven-a', status: 'review', reason: 'Review A.' },
  ];
  current.histories[0].suggestions = [candidate('suggestion-second', -2100)];
  store.save(current);
  let checkedWovenId;
  const service = createHistoryService({ store, agent: { async suggest() { return []; }, async checkRipple() { return { inconsistent: true, reason: 'Another flow changed.' }; },
    async regenerateEvent({ wovenEvent }) { checkedWovenId = wovenEvent.id; return { title: 'Revised settlement', summary: 'Homes adapt to the selected channel.',
      causeEventId: 'channels-2400', era: 'Late Holocene', geography: { version: 1, changes: [] } }; } } });
  await service.weave({ questionId: 'lake-chad', historyId: 'history-1', suggestionId: 'suggestion-second' });
  let event = store.get('lake-chad').histories[0].events.find(item => item.id === 'settlement-1800');
  assert.deepEqual(event.checkFlags.map(flag => flag.wovenEventId).sort(), ['suggestion-second', 'woven-a']);
  await assert.rejects(service.keepEvent({ questionId: 'lake-chad', historyId: 'history-1', eventId: 'settlement-1800' }),
    error => error.code === 'ambiguous_ripple_flag');
  await assert.rejects(service.regenerateEvent({ questionId: 'lake-chad', historyId: 'history-1', eventId: 'settlement-1800' }),
    error => error.code === 'ambiguous_ripple_flag');
  await service.keepEvent({ questionId: 'lake-chad', historyId: 'history-1', eventId: 'settlement-1800', wovenEventId: 'woven-a' });
  const ref = '/event-scenes/' + 'a'.repeat(64) + '.png';
  const withMedia = store.get('lake-chad');
  withMedia.histories[0].events.find(item => item.id === 'settlement-1800').sceneRef = ref;
  store.save(withMedia);
  const result = await service.regenerateEvent({ questionId: 'lake-chad', historyId: 'history-1', eventId: 'settlement-1800', wovenEventId: 'suggestion-second' });
  assert.equal(checkedWovenId, 'suggestion-second');
  assert.equal(result.event.title, 'Revised settlement');
  assert.equal(result.event.sceneRef, undefined, 'media generated for the old content is cleared');
  assert.deepEqual(result.event.checkFlags.map(flag => [flag.wovenEventId, flag.status]), [['woven-a', 'kept']]);
});

test('regeneration refuses to overwrite an event whose geography changed during the model request', async () => {
  const store = memoryStore();
  const current = store.get('lake-chad');
  current.histories[0].events[1].checkFlags = [{ kind: 'weave-ripple', eventId: 'settlement-1800', wovenEventId: 'channels-2400',
    status: 'review', actions: ['keep', 'regenerate'] }];
  store.save(current);
  const gate = deferred();
  let dispatches = 0;
  const service = createHistoryService({ store, agent: { client: { dispatchCount: () => dispatches }, async suggest() { return []; },
    async regenerateEvent() { dispatches++; return gate.promise; } } });
  const generation = service.regenerateEvent({ questionId: 'lake-chad', historyId: 'history-1', eventId: 'settlement-1800', wovenEventId: 'channels-2400' });
  while (dispatches === 0) await new Promise(resolve => setTimeout(resolve, 0));
  const edited = store.get('lake-chad');
  const event = edited.histories[0].events.find(item => item.id === 'settlement-1800');
  event.geography = { version: 1, changes: [{ id: 'sahara-keep', kind: 'vegetation', region: 'sahara', intensity: 0.3,
    assumption: 'User adjusted vegetation.', uncertainty: 'Illustrative.' }] };
  store.save(edited);
  gate.resolve({ title: 'Model replacement', summary: 'New summary.', causeEventId: 'channels-2400', era: 'Late Holocene', geography: { version: 1, changes: [] } });
  await assert.rejects(generation, error => error.code === 'regeneration_uncertain');
  const saved = store.get('lake-chad').histories[0].events.find(item => item.id === 'settlement-1800');
  assert.equal(saved.title, 'Shoreline settlement expands');
  assert.equal(saved.geography.changes[0].intensity, 0.3);
});
