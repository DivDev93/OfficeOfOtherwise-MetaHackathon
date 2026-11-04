import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { projectBatchPlan } from '../web/historyBatch.js';

const fixture = JSON.parse(await readFile(new URL('./fixtures/history-arabia-weave-batch.json', import.meta.url), 'utf8'));
const ids = fixture.history.suggestions.map(item => item.id);
const suggestions = fixture.history.suggestions;
const byTitle = title => suggestions.find(item => item.title === title).id;
const chain = [
  { ...suggestions[0], causeEventId: fixture.question.id },
  { ...suggestions[1], causeEventId: byTitle('Red Sea Monks Reach Jeddah') },
  { ...suggestions[2], causeEventId: byTitle("Buddhist Sailors' Shrine at Jeddah") },
  { ...suggestions[3], causeEventId: byTitle("Buddhist Sailors' Shrine at Jeddah") },
  { ...suggestions[4], causeEventId: byTitle('Meccan Jataka Reliefs') },
  { ...suggestions[5], causeEventId: byTitle('Lotus Carvings at Hegra') },
];
const plan = { id: 'batch-plan-test', questionId: fixture.question.id, historyId: fixture.history.id, chain, conflicts: [],
  merges: [{ id: 'batch-merge-healing', suggestionIds: [ids[4], ids[5]], title: 'Arabian Healing Houses',
    summary: 'A Vihara Healing Garden in Mecca, Arabia and a Buddhist Healing House at Hegra, Arabia combine Arabian and Indian medicinal practice.' }] };

test('batch plan preview defaults to six chronological events with the Jeddah causal step intact', () => {
  const projected = projectBatchPlan(plan);
  assert.equal(projected.events.length, 6);
  assert.deepEqual(projected.events.map(item => item.id), ids);
  assert.equal(projected.events[1].causeEventId, ids[0], 'the Jeddah shrine follows the monks arrival');
  assert.equal(projected.events[2].causeEventId, ids[1], 'later arts can follow the shrine');
  assert.deepEqual(projected.unresolvedConflicts, []);
});

test('accepted overlap merges preserve both source places and excluded causes rewire to retained ancestors', () => {
  const mediaPlan = { ...plan, chain: plan.chain.map(item => ['Vihara Healing Garden in Mecca', 'Buddhist Healing House at Hegra'].includes(item.title)
    ? { ...item, sceneRef: { status: 'complete', path: `scenes/${item.id}.png` } } : item) };
  const merged = projectBatchPlan(mediaPlan, { acceptedMergeIds: ['batch-merge-healing'] });
  assert.equal(merged.events.length, 5);
  const event = merged.events.find(item => item.id === 'batch-merge-healing');
  assert.match(event.summary, /Mecca, Arabia/);
  assert.match(event.summary, /Hegra, Arabia/);
  assert.equal(event.causeEventId, ids[3]);
  assert.deepEqual(event.sourceSuggestionIds, [ids[4], ids[5]]);
  assert.equal(event.sourceMediaRefs.length, 2);

  const excluded = projectBatchPlan(plan, { excludedSuggestionIds: [ids[1]] });
  assert.equal(excluded.events.some(item => item.id === ids[1]), false);
  assert.equal(excluded.events.find(item => item.id === ids[2]).causeEventId, ids[0]);
  assert.equal(excluded.events.find(item => item.id === ids[3]).causeEventId, ids[0]);
});

test('projector rejects unknown causes, self cycles, and overlapping accepted merge groups', () => {
  const unknownCause = { ...plan, chain: plan.chain.map(item => item.id === ids[2] ? { ...item, causeEventId: 'ghost-event' } : item) };
  assert.throws(() => projectBatchPlan(unknownCause), /earlier retained event/);
  const selfCause = { ...plan, chain: plan.chain.map(item => item.id === ids[2] ? { ...item, causeEventId: ids[2] } : item) };
  assert.throws(() => projectBatchPlan(selfCause), /Cyclic batch cause chain/);
  const overlaps = { ...plan, merges: [plan.merges[0], { id: 'another', suggestionIds: [ids[4], ids[2]], title: 'Overlap', summary: 'Mecca, Arabia and Hegra, Arabia.' }] };
  assert.throws(() => projectBatchPlan(overlaps, { acceptedMergeIds: ['batch-merge-healing', 'another'] }), /Overlapping or invalid batch merge/);
});

test('conflicts against an existing event remain unresolved until the suggestion is excluded', () => {
  const conflictPlan = { ...plan, conflicts: [{ suggestionId: ids[2], conflictsWith: 'existing-event', reason: 'This arrival contradicts the established route.' }] };
  assert.equal(projectBatchPlan(conflictPlan).unresolvedConflicts.length, 1);
  assert.equal(projectBatchPlan(conflictPlan, { excludedSuggestionIds: [ids[2]] }).unresolvedConflicts.length, 0);
});
