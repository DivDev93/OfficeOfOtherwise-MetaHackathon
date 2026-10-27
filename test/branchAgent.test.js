import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createBranchAgent } from '../src/agents/branchAgent.js';
import { createTopicPolicy } from '../src/guardrails/topicPolicy.js';
import { extractJson } from '../src/lib/json.js';

const BRANCHES = [
  { id: 'b1', title: 'Alexandrian steam age', year: 120, place: { name: 'Alexandria', lat: 31.2, lon: 29.9 }, summary: 'Hero\'s aeolipile is copied from surviving scrolls. Steam pumps drain Nile mines.', scene: 'A brass steam engine hauling stone on the harbour.' },
  { id: 'b2', title: 'Library university network', year: 300, place: { name: 'Pergamon', lat: 39.1, lon: 27.2 }, summary: 'Copies spread to sister libraries. Scholarship becomes networked.', scene: 'Scribes at a signal tower relaying texts.' },
  { id: 'b3', title: 'Early heliocentric navigation', year: 450, place: { name: 'Rhodes', lat: 36.4, lon: 28.2 }, summary: 'Aristarchus\' model survives. Navigators chart by it.', scene: 'A bronze astrolabe on a ship deck.' },
  { id: 'b4', title: 'Siege of Alexandria', year: 200, place: { name: 'Alexandria', lat: 31.2, lon: 29.9 }, summary: 'Armies besiege the city.', scene: 'Soldiers on walls.' },
  { id: 'bad', title: 'No coordinates', year: 1, place: { name: 'Nowhere' }, summary: 'x' },
];
const REVIEW = { scores: [{ id: 'b1', score: 9, note: 'tight causal chain' }, { id: 'b2', score: 6, note: 'plausible' }, { id: 'b3', score: 7, note: 'good' }], hero: { id: 'b1', imagePrompt: 'Photoreal brass steam engine on an Alexandrian quay at dawn.', subject: 'brass steam engine' } };

function fakeClient(script) {
  let spent = 0;
  const calls = [];
  return {
    calls,
    spent: () => spent,
    async respond(args) {
      calls.push(args);
      const step = args.label.split(':')[1];
      const queue = script[step];
      const text = Array.isArray(queue) ? queue.shift() : queue;
      spent += 0.001;
      return { text: typeof text === 'string' ? text : JSON.stringify(text), costUsd: 0.001, usage: { output_tokens: 100 } };
    },
  };
}
const allowAll = createTopicPolicy({ classify: async () => ({ verdict: 'allow', category: null, reason: '' }) });

test('happy path: proposes, filters, reviews, ranks and picks the hero with a full trace', async () => {
  const client = fakeClient({ propose: '```json\n' + JSON.stringify(BRANCHES) + '\n```', review: REVIEW });
  const out = await createBranchAgent({ client, policy: allowAll }).run({ divergence: 'What if the Library of Alexandria never burned?', count: 3 });

  assert.equal(out.status, 'ok');
  assert.deepEqual(out.branches.map(b => b.id), ['b1', 'b3', 'b2']); // ranked by score, invalid + war branch gone
  assert.deepEqual(out.rejected.map(r => r.branch.id), ['b4']);       // keyword layer caught the siege
  assert.equal(out.hero.branchId, 'b1');
  assert.equal(out.hero.subject, 'brass steam engine');
  assert.deepEqual(out.trace.map(t => t.step).sort(), ['policy:branches', 'policy:prompt', 'propose', 'review']);
  assert.equal(client.calls[0].model, 'muse-wonder-1.0');
  assert.ok(out.costUsd > 0);
});

test('blocked divergence spends nothing on generation and returns a reframe', async () => {
  const client = fakeClient({});
  const out = await createBranchAgent({ client, policy: allowAll }).run({ divergence: 'What if the Nazis won World War II?' });
  assert.equal(out.status, 'blocked');
  assert.match(out.reframe, /science, technology, culture and geography/);
  assert.equal(client.calls.length, 0);
});

test('retries once when the model returns unparseable JSON', async () => {
  const client = fakeClient({ propose: ['sorry, here you go: not json', JSON.stringify(BRANCHES)], review: REVIEW });
  const out = await createBranchAgent({ client, policy: allowAll }).run({ divergence: 'What if the Library of Alexandria never burned?' });
  assert.equal(out.status, 'ok');
  assert.deepEqual(out.trace.filter(t => t.step === 'propose').map(t => t.ok), [false, true]);
});

test('gives up after two bad attempts', async () => {
  const client = fakeClient({ propose: ['nope', 'still nope'] });
  await assert.rejects(createBranchAgent({ client, policy: allowAll }).run({ divergence: 'What if the Sahara stayed green?' }), /no parseable JSON/);
});

test('falls back to the top-ranked branch when the reviewer names an unknown hero', async () => {
  const client = fakeClient({ propose: JSON.stringify(BRANCHES), review: { ...REVIEW, hero: { id: 'zzz', imagePrompt: 'x', subject: 'y' } } });
  const out = await createBranchAgent({ client, policy: allowAll }).run({ divergence: 'What if the Library of Alexandria never burned?' });
  assert.equal(out.hero.branchId, 'b1');
  assert.equal(out.hero.imagePrompt, BRANCHES[0].scene);
});

test('empty when every branch is off-policy', async () => {
  const client = fakeClient({ propose: JSON.stringify([BRANCHES[3]]), review: REVIEW });
  const out = await createBranchAgent({ client, policy: allowAll }).run({ divergence: 'What if the Library of Alexandria never burned?' });
  assert.equal(out.status, 'empty');
  assert.equal(out.rejected.length, 1);
});

test('waits for an in-flight review before returning empty or a policy error', async () => {
  for (const shouldReject of [false, true]) {
    let releaseReview;
    let spent = 0;
    const client = {
      spent: () => spent,
      async respond(args) {
        if (args.label.endsWith(':review')) await new Promise(resolve => { releaseReview = resolve; });
        spent += 0.01;
        return { text: JSON.stringify(args.label.endsWith(':propose') ? [BRANCHES[0]] : REVIEW), costUsd: 0.01 };
      },
    };
    const policy = {
      checkPrompt: async () => ({ allowed: true, layer: 'keyword' }),
      checkBranches: async () => { if (shouldReject) throw new Error('policy failed'); return { kept: [], rejected: [BRANCHES[0]] }; },
    };
    let done = false;
    const result = createBranchAgent({ client, policy }).run({ divergence: 'science' }).finally(() => { done = true; });
    await new Promise(resolve => setImmediate(resolve));
    assert.equal(done, false);
    releaseReview();
    if (shouldReject) await assert.rejects(result, /policy failed/);
    else assert.equal((await result).costUsd, 0.02);
    assert.equal(spent, 0.02);
  }
});

test('extractJson handles fences, prose and braces inside strings', () => {
  assert.deepEqual(extractJson('Here:\n```json\n{"a":"}{"}\n```'), { a: '}{' });
  assert.deepEqual(extractJson('pre [1,2,{"b":[3]}] post'), [1, 2, { b: [3] }]);
  assert.equal(extractJson('nothing'), undefined);
});

test('a hero the reviewer picked from a policy-rejected branch is never used', async () => {
  const client = fakeClient({ propose: JSON.stringify(BRANCHES), review: { scores: [{ id: 'b4', score: 10 }, { id: 'b2', score: 5 }], hero: { id: 'b4', imagePrompt: 'soldiers', subject: 'siege tower' } } });
  const out = await createBranchAgent({ client, policy: allowAll }).run({ divergence: 'What if the Library of Alexandria never burned?' });
  assert.ok(!out.branches.some(b => b.id === 'b4'));
  assert.notEqual(out.hero.branchId, 'b4');
  assert.notEqual(out.hero.subject, 'siege tower');
});
