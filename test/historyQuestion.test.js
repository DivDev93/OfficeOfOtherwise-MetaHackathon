import test from 'node:test';
import assert from 'node:assert/strict';
import { createHistoryQuestionAgent, dateWindowFor } from '../src/demo/historyQuestion.js';
import { SpendCapError } from '../src/lib/metaClient.js';

test('question classification runs before bounded Wonder framing and returns canonical era windows', async () => {
  const order = [];
  const agent = createHistoryQuestionAgent({
    policy: { async checkPrompt() { order.push('spark'); return { allowed: true }; } },
    client: { async respond({ input }) {
      order.push('wonder');
      const request = JSON.parse(input);
      assert.equal(request.divergenceYear, -500, 'explicit year is preserved for the model');
      return { text: JSON.stringify({ title: 'Wetland gardens flourish', divergenceYear: -500,
        place: { name: 'Sahara', lat: 20, lon: 10 } }) };
    } },
  });
  const result = await agent({ question: 'What if the Sahara stayed green?', divergenceYear: -500 });
  assert.deepEqual(order, ['spark', 'wonder']);
  assert.equal(result.histories.length, 1);
  assert.deepEqual(result.histories[0].events, [], 'initial history remains empty until a suggestion is explicitly woven');
  assert.deepEqual(result.origin, { kind: 'user-written' });
  assert.deepEqual(result.dateWindow, { fromYear: -1000, toYear: -1 });
  assert.deepEqual(dateWindowFor(500), { fromYear: 1, toYear: 1000 });
});

test('a keyword-blocked question reaches neither Spark nor Wonder', async () => {
  let modelCalls = 0;
  const agent = createHistoryQuestionAgent({
    policy: { async checkPrompt() { modelCalls++; return { allowed: true }; } },
    client: { async respond() { modelCalls++; throw new Error('unexpected model dispatch'); } },
  });
  await assert.rejects(agent({ question: 'What if a war changed the map?' }), error => error.code === 'topic_blocked');
  assert.equal(modelCalls, 0);
});

test('model-policy rejection prevents Wonder framing and persistence data creation', async () => {
  let wonderCalls = 0;
  const agent = createHistoryQuestionAgent({
    policy: { async checkPrompt() { return { allowed: false, category: 'politics', reframe: 'Try geography.' }; } },
    client: { async respond() { wonderCalls++; return {}; } },
  });
  await assert.rejects(agent({ question: 'What if a lake remained?' }), error => error.code === 'topic_blocked' && error.category === 'politics');
  assert.equal(wonderCalls, 0);
});

test('verified parent context is included in the Spark guard before any Wonder framing', async () => {
  const order = [];
  const agent = createHistoryQuestionAgent({
    policy: { async checkPrompt(text) { order.push(['spark', text]); return { allowed: true }; } },
    client: { async respond({ input }) { order.push(['wonder', JSON.parse(input)]); return { text: JSON.stringify({ title: 'River gardens', divergenceYear: -2400,
      place: { name: 'Sahara', lat: 20, lon: 10 } }) }; } },
  });
  await agent({ question: 'What if gardens spread?', divergenceYear: -2400,
    parentContext: { question: 'What if the Sahara stayed green?', asOfEvent: { year: -2400, title: 'Water channels',
      summary: 'Communities share seasonal irrigation.', place: { name: 'Sahara', lat: 20, lon: 10 } },
      events: [{ year: -2400, title: 'Water channels', summary: 'Communities share seasonal irrigation.',
        place: { name: 'Sahara', lat: 20, lon: 10 }, geography: 'Green Sahara' }], eventCount: 1 } });
  assert.equal(order[0][0], 'spark');
  assert.match(order[0][1], /Water channels/);
  assert.equal(order[1][0], 'wonder');
  assert.equal(order[1][1].parentContext.events[0].title, 'Water channels', 'Wonder receives the same complete verified context as Spark');
});

test('Meta spend-cap rejection is preserved for the API to report without saving a question', async () => {
  const agent = createHistoryQuestionAgent({
    policy: { async checkPrompt() { return { allowed: true }; } },
    client: { async respond() { throw new SpendCapError(10, 0.01, 10); } },
  });
  await assert.rejects(agent({ question: 'What if the Sahara stayed green?' }), error => error instanceof SpendCapError);
});
