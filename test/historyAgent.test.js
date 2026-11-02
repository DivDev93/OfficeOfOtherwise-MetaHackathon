import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createHistoryAgent } from '../src/agents/historyAgent.js';
import { migrateSavedTree } from '../web/historyModel.js';

const fixture = JSON.parse(await readFile(new URL('./fixtures/history-conflicts.json', import.meta.url), 'utf8'));
const json = value => JSON.stringify(value);

function agentFor(output, { policy } = {}) {
  const calls = [];
  const client = { async respond(args) { calls.push(args); return { text: typeof output === 'function' ? output(args) : json(output), response: {}, usage: { output_tokens: 10 }, costUsd: 0.001 }; } };
  return { agent: createHistoryAgent({ client, policy }), calls };
}

test('history suggestion agent accepts a named conflict and a compatible fit from recorded fixture data', async () => {
  const { agent, calls } = agentFor({ suggestions: fixture.suggestions });
  const suggestions = await agent.suggest({ ...fixture, window: fixture.window });
  assert.equal(suggestions.length, 2);
  assert.equal(suggestions[0].verdict, 'conflicts');
  assert.equal(suggestions[0].conflictsWith, 'channels-2400-bce');
  assert.match(suggestions[0].reason, /timed channels/i);
  assert.equal(suggestions[1].verdict, 'fits');
  assert.equal(suggestions[1].conflictsWith, null);
  assert.match(suggestions[0].id, /^suggestion:[a-f0-9]{64}$/);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].model, 'muse-wonder-1.0');
  assert.equal(calls[0].label, 'history-agent:suggest');
  assert.match(calls[0].instructions, /"fits" means it can plausibly be true alongside every event/);
});

test('conflicts require a named history event and a concrete reason', async () => {
  const invalid = structuredClone(fixture.suggestions[0]);
  invalid.conflictsWith = 'imagined-event';
  const { agent } = agentFor({ suggestions: [invalid] });
  await assert.rejects(agent.suggest(fixture), /named history event and reason/);
});

test('causes must refer to the question or an earlier event and suggestions stay inside the requested window', async () => {
  const lateCause = structuredClone(fixture.suggestions[1]);
  lateCause.causeEventId = 'future-event';
  const first = agentFor({ suggestions: [lateCause] }).agent;
  await assert.rejects(first.suggest(fixture), /cause must be the question or an earlier/);

  const outside = structuredClone(fixture.suggestions[1]);
  outside.year = -1999;
  const second = agentFor({ suggestions: [outside] }).agent;
  await assert.rejects(second.suggest(fixture), /Invalid history suggestion/);

  const sameYearCause = structuredClone(fixture.suggestions[1]);
  sameYearCause.year = -2400;
  const third = agentFor({ suggestions: [sameYearCause] }).agent;
  await assert.rejects(third.suggest(fixture), /cause must be the question or an earlier/);

  const zeroYear = structuredClone(fixture.suggestions[0]);
  zeroYear.year = 0;
  const fourth = agentFor({ suggestions: [zeroYear] }).agent;
  await assert.rejects(fourth.suggest(fixture), /Invalid history suggestion/);
});

test('duplicate candidates and fields outside the strict output schema are rejected', async () => {
  const duplicate = structuredClone(fixture.suggestions[1]);
  const repeated = agentFor({ suggestions: [duplicate, structuredClone(duplicate)] }).agent;
  await assert.rejects(repeated.suggest(fixture), /duplicate ids/);

  const selfReferential = { ...fixture.suggestions[1], id: 'candidate-id', causeEventId: 'candidate-id' };
  const strict = agentFor({ suggestions: [selfReferential] }).agent;
  await assert.rejects(strict.suggest(fixture), /unsupported fields/);
});

test('agent accepts canonical history and event ids emitted by deterministic migration', async () => {
  const migrated = migrateSavedTree([{ runId: 'legacy-root', run: {
    divergence: 'What if the inland lake remained larger?',
    branches: [{ id: 'branch:root', year: -3000, title: 'Wetland villages follow the lake',
      summary: 'Seasonal water supports settlement.', place: { name: 'Inland lake', lat: 10, lon: 20 } }],
    hero: { branchId: 'branch:root' },
  } }]).questions[0];
  const history = migrated.histories[0];
  assert.match(history.id, /%3A/);
  assert.match(history.events[0].id, /:/);
  const response = { suggestions: [{ year: -2500, place: { name: 'Inland lake', lat: 10, lon: 20 }, title: 'Garden plots track seasonal water',
    summary: 'Gardeners adapt plots to seasonal lake levels.', causeEventId: history.events[0].id, era: 'Late Holocene',
    geography: { version: 1, changes: [] }, verdict: 'fits', conflictsWith: null, reason: 'It can coexist with the earlier wetland villages.' }] };
  const client = { async respond() { return { text: JSON.stringify(response), response: {}, usage: {}, costUsd: 0 }; } };
  const suggestions = await createHistoryAgent({ client }).suggest({ question: migrated, history, window: { fromYear: -2600, toYear: -2400 } });
  assert.equal(suggestions.length, 1);
});

test('explicit fork suggestions receive the excluded event and replacement instruction', async () => {
  const excluded = fixture.history.events[0];
  const history = { id: 'history-forked', events: [], forkEventId: excluded.id,
    forkReason: `What if instead of ${excluded.title}?`, origin: { kind: 'deliberate-what-if', replacedEvent: excluded } };
  const { agent, calls } = agentFor({ suggestions: [{ year: -2300, place: excluded.place, title: 'Seasonal gardens follow a different channel',
    summary: 'Gardeners create small seasonal plots around a side channel.', causeEventId: fixture.question.id, era: 'Late Holocene',
    geography: { version: 1, changes: [] }, verdict: 'fits', conflictsWith: null, reason: 'The alternative does not preserve the excluded channel layout.' }] });
  await agent.suggest({ question: fixture.question, history, window: { fromYear: -2500, toYear: -2000 } });
  const input = JSON.parse(calls[0].input);
  assert.equal(input.history.fork.eventId, excluded.id);
  assert.equal(input.history.fork.reason, history.forkReason);
  assert.equal(input.history.fork.excludedEvent.title, excluded.title);
  assert.match(calls[0].instructions, /plausible replacement for that event, not an event alongside it/);
  assert.equal(calls.length, 1, 'fork context is supplied in the normal single Wonder proposal call');
});

test('stale cached suggestion checker names a current conflict and rejects unknown conflict ids', async () => {
  const suggestion = { id: 'saved-suggestion', year: -2300, title: 'Lake channels adapt', summary: 'Channels change over time.' };
  const { agent, calls } = agentFor({ verdict: 'conflicts', conflictsWith: 'channels-2400-bce', reason: 'This suggestion depends on open water unavailable in the named history event.' });
  const checked = await agent.checkSuggestion({ question: fixture.question, history: fixture.history, suggestion });
  assert.deepEqual(checked, { verdict: 'conflicts', conflictsWith: 'channels-2400-bce', reason: 'This suggestion depends on open water unavailable in the named history event.' });
  assert.equal(calls[0].model, 'muse-spark-1.3');
  assert.equal(calls[0].label, 'history-agent:recheck-suggestion');
  const input = JSON.parse(calls[0].input);
  assert.equal(input.question.text, fixture.question.question);
  assert.equal(input.cachedSuggestion.id, suggestion.id);
  assert.deepEqual(input.currentHistory.map(event => event.id), ['channels-2400-bce']);

  const invalid = agentFor({ verdict: 'conflicts', conflictsWith: 'unknown-event', reason: 'This old scenario now contradicts an unlisted event.' }).agent;
  await assert.rejects(invalid.checkSuggestion({ question: fixture.question, history: fixture.history, suggestion }), /current history event/);
});

test('topic policy removes disallowed proposals before they are exposed', async () => {
  let checked = 0;
  const policy = { async checkBranches(items) { checked++; return { kept: items.slice(1), rejected: [{ branch: items[0] }] }; } };
  const { agent } = agentFor({ suggestions: fixture.suggestions }, { policy });
  const suggestions = await agent.suggest(fixture);
  assert.equal(checked, 1);
  assert.deepEqual(suggestions.map(item => item.title), [fixture.suggestions[1].title]);
});

test('ripple checker reports a flag without editing the later event', async () => {
  const { agent, calls } = agentFor({ inconsistent: true, reason: 'The new channel diversion leaves this later settlement without water.' });
  const event = { ...fixture.history.events[0], year: -1800 };
  const result = await agent.checkRipple({ question: fixture.question, event, history: fixture.history,
    wovenEvent: { id: 'new-channel', year: -2200, title: 'A new channel diversion' } });
  assert.deepEqual(result, { inconsistent: true, reason: 'The new channel diversion leaves this later settlement without water.' });
  assert.equal(calls[0].model, 'muse-spark-1.3');
  assert.equal(calls[0].label, 'history-agent:ripple');
  const input = JSON.parse(calls[0].input);
  assert.deepEqual(input.question, { id: fixture.question.id, text: fixture.question.question });
});

test('explicit regeneration returns a checked revision while preserving the target identity and date', async () => {
  const later = { ...fixture.history.events[0], id: 'later-event', year: -1800 };
  const { agent, calls } = agentFor({ title: 'Shoreline gardens adapt to channels',
    summary: 'Gardeners adjust planting around the new seasonal channel flows.', causeEventId: 'lake-chad',
    era: 'Late Holocene', geography: { version: 1, changes: [] } });
  const replacement = await agent.regenerateEvent({ question: fixture.question, event: later,
    history: { ...fixture.history, events: [fixture.history.events[0], later] }, wovenEvent: { id: 'new-channel', year: -2200 } });
  assert.equal(replacement.id, later.id);
  assert.equal(replacement.year, later.year);
  assert.equal(replacement.place, later.place);
  assert.match(replacement.title, /gardens/i);
  assert.equal(calls[0].model, 'muse-wonder-1.0');
  assert.equal(calls[0].label, 'history-agent:regenerate');
});
