import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { modelCardSteps } from '../web/logic.js';

test('saved runs show the actual policy model and only recorded stages', async () => {
  for (const id of ['alexandria', 'beringia', 'green-sahara', 'mechanisms']) {
    const { steps } = JSON.parse(await readFile(new URL(`../demo/runs/${id}/trace.json`, import.meta.url)));
    const cards = modelCardSteps(steps);
    assert.equal(cards.length, 5, id);
    assert.equal(cards.find(card => card.role === 'Topic policy').model, 'Muse Wonder 1.0', id);
    assert.ok(cards.every(card => !card.model.includes('Muse Spark')), id);
    assert.deepEqual(modelCardSteps([], steps), cards, `${id}: pending cards use saved models`);
  }
});

test('missing calls and summary records do not create cards; actual Spark calls do', () => {
  assert.deepEqual(modelCardSteps([{ step: 'image', summary: true }]), []);
  assert.deepEqual(modelCardSteps([{ step: 'topic-policy', model: 'muse-spark-1.3' }]), [
    { role: 'Topic policy', index: 0, model: 'Muse Spark 1.3' },
  ]);
  assert.deepEqual(modelCardSteps([{ step: 'image' }]), [
    { role: 'Scene', index: 3, model: 'Muse Image' },
  ]);
});
