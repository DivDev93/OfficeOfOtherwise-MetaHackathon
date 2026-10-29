import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { modelCardSteps } from '../web/logic.js';

test('saved runs show the actual policy model and only recorded stages', async () => {
  for (const id of ['alexandria', 'beringia', 'green-sahara', 'mechanisms']) {
    const { steps } = JSON.parse(await readFile(new URL(`../demo/runs/${id}/trace.json`, import.meta.url)));
    const cards = modelCardSteps(steps);
    assert.equal(cards.length, 4, id);
    const wonder = cards.find(card => card.model === 'Muse Wonder 1.0');
    assert.equal(wonder.role, 'Policy checks + Branches / review', id);
    const wonderCalls = steps.filter(step => !step.summary && /policy|propose|review/.test(step.step));
    assert.equal(wonder.ms, wonderCalls.reduce((total, call) => total + call.ms, 0), id);
    assert.equal(wonder.costUsd, wonderCalls.reduce((total, call) => total + call.costUsd, 0), id);
    assert.ok(cards.every(card => !card.model.includes('Muse Spark')), id);
    assert.deepEqual(modelCardSteps([], steps).map(({model,role}) => ({model,role})), cards.map(({model,role}) => ({model,role})), `${id}: pending cards use saved models`);
    assert.ok(modelCardSteps([], steps).every(card => card.pending && !card.available));
  }
});

test('missing calls and summary records do not create cards; actual Spark calls do', () => {
  assert.deepEqual(modelCardSteps([{ step: 'image', summary: true }]), []);
  assert.deepEqual(modelCardSteps([{ step: 'topic-policy', model: 'muse-spark-1.3' }]), [
    { role: 'Policy checks', model: 'Muse Spark 1.3', ms: null, costUsd: null, available: true, pending: false },
  ]);
  assert.deepEqual(modelCardSteps([{ step: 'image' }]), [
    { role: 'Scene', model: 'Muse Image 1.0', ms: null, costUsd: null, available: true, pending: false },
  ]);
});

test('canonical model names merge roles without counting summaries or hiding unknown metrics', () => {
  const calls = [
    { step: 'policy', model: 'muse-wonder-1.0', ms: 100, costUsd: 0 },
    { step: 'propose', model: 'Muse Wonder', ms: 200, costUsd: .02 },
    { step: 'review', model: 'Muse Wonder 1.0', ms: 300, costUsd: null },
    { step: 'review', model: 'Muse Wonder 1.0', ms: 300, costUsd: 1, summary: true },
    { step: 'policy', model: 'muse-spark-1.3', ms: 50, costUsd: .01 },
  ];
  const cards = modelCardSteps(calls);
  assert.equal(cards.length, 2);
  assert.deepEqual(cards.find(card => card.model === 'Muse Wonder 1.0'), {
    model: 'Muse Wonder 1.0', role: 'Policy checks + Branches / review', ms: 600,
    costUsd: null, available: true, pending: false,
  });
  const partial = modelCardSteps(calls.slice(0, 1), calls)[0];
  assert.equal(partial.ms, 100);
  assert.equal(partial.costUsd, 0);
  assert.equal(partial.pending, true);
});
