import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createBranchAgent, normalizeContinuation } from '../src/agents/branchAgent.js';
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

test('policy-approved proposals stream while review is still in flight', async () => {
  let releaseReview;
  const events = [];
  const client = { spent: () => 0, async respond(args) {
    if (args.label.endsWith(':review')) await new Promise(resolve => { releaseReview = resolve; });
    return { text: JSON.stringify(args.label.endsWith(':propose') ? BRANCHES : REVIEW), costUsd: 0.01 };
  } };
  const pending = createBranchAgent({ client, policy: allowAll }).run({ divergence: 'What if the Library of Alexandria never burned?', onStep: event => events.push(event) });
  await new Promise(resolve => setImmediate(resolve));
  assert.deepEqual(events.map(e => e.step), ['policy', 'propose', 'propose']);
  assert.equal(events[1].pending, true);
  assert.equal(events[1].candidateCount, 4);
  assert.deepEqual(events[1].branches, []);
  assert.ok(events[2].branches.every(b => b.id !== 'b4' && b.id !== 'bad'));
  assert.equal(events[2].model, 'muse-wonder-1.0');
  assert.equal(events[2].policyModel, null);
  releaseReview(); await pending;
  assert.deepEqual(events.map(e => e.step), ['policy', 'propose', 'propose', 'review']);
  assert.equal(events[3].hero.branchId, 'b1');
});

test('Spark policy provenance is distinct from Wonder propose and review', async () => {
  const client = fakeClient({ propose: JSON.stringify(BRANCHES), review: REVIEW });
  const classify = async () => ({ verdict: 'allow', category: null, reason: 'ok' });
  const promptClassifier = Object.assign(classify, { model: 'muse-spark-1.3' });
  const branchClassifier = Object.assign(async () => ({ verdict: 'allow', category: null, reason: 'ok' }), { model: 'muse-spark-1.3' });
  const policy = createTopicPolicy({ classifyPrompt: promptClassifier, classifyBranches: branchClassifier });
  const events = [];
  const out = await createBranchAgent({ client, policy, model: 'muse-wonder-1.0' }).run({ divergence: 'What if the Library of Alexandria never burned?', onStep: event => events.push(event) });
  assert.equal(out.trace.find(t => t.step === 'policy:prompt').model, 'muse-spark-1.3');
  assert.equal(out.trace.find(t => t.step === 'policy:branches').model, 'muse-spark-1.3');
  assert.deepEqual(client.calls.map(call => call.model), ['muse-wonder-1.0', 'muse-wonder-1.0']);
  const proposal = events.find(event => event.step === 'propose' && event.pending === false);
  assert.equal(proposal.model, 'muse-wonder-1.0');
  assert.equal(proposal.policyModel, 'muse-spark-1.3');
});

const CONTINUATION = {
  rootRunId: 'root-library', rootDivergence: 'What if the Library of Alexandria never burned?',
  parentRunId: 'steam-run', parentBranchId: 'pumps',
  path: [
    { runId: 'root-library', branchId: 'steam', ...BRANCHES[0] },
    { runId: 'steam-run', branchId: 'pumps', title: 'Workshops copy steam pumps', year: 200, summary: 'Workshops retain the library scrolls and copy the mine pumps.', place: BRANCHES[0].place },
  ],
};

test('continuation carries original assumption and every chosen event into proposal and review', async () => {
  const child = { ...BRANCHES[1], causalLink: 'Copied mine pumps let workshops power paper mills.' };
  const client = fakeClient({ propose: JSON.stringify([child]), review: REVIEW });
  const policyInputs = [];
  const policy = { ...allowAll, checkPrompt: async text => { policyInputs.push(text); return allowAll.checkPrompt(text); } };
  const out = await createBranchAgent({ client, policy }).run({ divergence: CONTINUATION.rootDivergence, continuation: CONTINUATION });
  assert.equal(out.status, 'ok');
  assert.equal(out.branches[0].causalLink, child.causalLink);
  for (const call of client.calls) {
    assert.ok(call.input.includes(CONTINUATION.rootDivergence));
    for (const event of CONTINUATION.path) assert.ok(call.input.includes(event.summary));
    assert.match(call.instructions, /strictly later nonzero integer year/);
    assert.match(call.instructions, /hypotheses, not sourced or verified history/);
    assert.match(call.instructions, /Do not overwrite or contradict/);
  }
  assert.ok(policyInputs[0].includes(CONTINUATION.path[1].summary));
  assert.equal(out.continuation.parentBranchId, 'pumps');
  assert.equal('id' in out.continuation.path[0], false);
});

test('continuation drops backwards, same-year, zero, fractional and causeless events before review or streaming', async () => {
  const base = { ...BRANCHES[1], causalLink: 'The earlier pumps support paper mills.' };
  const proposals = [
    ...[120, 200, 0, 200.5].map((year, i) => ({ ...base, id: `invalid-${i}`, year })),
    { ...base, id: 'causeless', year: 250, causalLink: ' ' },
    { ...base, id: 'later', year: 201 },
  ];
  const client = fakeClient({ propose: JSON.stringify(proposals), review: REVIEW });
  const events = [];
  const out = await createBranchAgent({ client, policy: allowAll }).run({ divergence: CONTINUATION.rootDivergence, continuation: CONTINUATION, onStep: event => events.push(event) });
  assert.deepEqual(out.branches.map(b => b.id), ['later']);
  assert.deepEqual(events.find(e => e.step === 'propose' && e.pending === false).branches.map(b => b.id), ['later']);
  const reviewBranches = JSON.parse(client.calls[1].input.split('\nBranches:\n')[1]);
  assert.deepEqual(reviewBranches.map(b => b.id), ['later']);
});

test('second-depth continuation preserves ancestor causal mechanisms independently of summaries', async () => {
  const mechanism = 'Shared pump casting dimensions let workshops exchange replacement parts.';
  const context = { ...CONTINUATION, path: [CONTINUATION.path[0], { ...CONTINUATION.path[1], summary: 'Workshops expand.', causalLink: mechanism }] };
  const child = { ...BRANCHES[1], causalLink: 'Interchangeable parts let paper mills maintain pumps.' };
  const client = fakeClient({ propose: JSON.stringify([child]), review: REVIEW });
  const policyInputs = [];
  const policy = { ...allowAll, checkPrompt: async text => { policyInputs.push(text); return allowAll.checkPrompt(text); } };
  const out = await createBranchAgent({ client, policy }).run({ divergence: context.rootDivergence, continuation: context });
  assert.equal(out.status, 'ok');
  assert.equal(out.continuation.path[1].causalLink, mechanism);
  assert.equal('causalLink' in out.continuation.path[0], false);
  assert.ok(policyInputs[0].includes(mechanism));
  for (const call of client.calls) assert.ok(call.input.includes(mechanism));
  for (const causalLink of ['', ' ', null, 5, 'x'.repeat(4001)]) {
    assert.throws(() => normalizeContinuation({ ...context, path: [context.path[0], { ...context.path[1], causalLink }] }), /Invalid continuation causalLink/);
  }
});

test('continuation allows later BCE descendants and returns empty without review for invalid children', async () => {
  const context = { ...CONTINUATION, parentRunId: CONTINUATION.rootRunId, parentBranchId: 'steam', path: [{ ...CONTINUATION.path[0], year: -200 }] };
  const child = { ...BRANCHES[0], year: -150, causalLink: 'Surviving scrolls spread pump designs.' };
  let client = fakeClient({ propose: JSON.stringify([child]), review: REVIEW });
  assert.equal((await createBranchAgent({ client, policy: allowAll }).run({ divergence: 'A library survives', continuation: context })).status, 'ok');
  client = fakeClient({ propose: JSON.stringify([{ ...child, year: -250 }]) });
  assert.equal((await createBranchAgent({ client, policy: allowAll }).run({ divergence: 'A library survives', continuation: context })).status, 'empty');
  assert.equal(client.calls.length, 1);
});

test('continuation rejects malformed, mismatched, unordered and oversized ancestry before model calls', async () => {
  for (const context of [
    { ...CONTINUATION, path: [] }, { ...CONTINUATION, parentBranchId: 'forged' },
    { ...CONTINUATION, path: [CONTINUATION.path[0], { ...CONTINUATION.path[1], year: 100 }] },
    { ...CONTINUATION, rootDivergence: 'x'.repeat(4001) },
    { ...CONTINUATION, path: Array(33).fill(CONTINUATION.path[0]) },
    { ...CONTINUATION, path: [{ ...CONTINUATION.path[0], year: 0 }] },
  ]) {
    const client = fakeClient({});
    await assert.rejects(createBranchAgent({ client, policy: allowAll }).run({ divergence: 'A library survives', continuation: context }), /Invalid continuation/);
    assert.equal(client.calls.length, 0);
  }
  assert.equal(normalizeContinuation(undefined), undefined);
});

test('causal links cannot hide prohibited topics from either keyword or model policy', async () => {
  const children = [
    { ...BRANCHES[1], id: 'keyword', causalLink: 'The pumps equip an army.' },
    { ...BRANCHES[1], id: 'classifier', causalLink: 'The pumps finance a struggle for the crown.' },
    { ...BRANCHES[1], id: 'clean', causalLink: 'The pumps power workshops.' },
  ];
  const policy = createTopicPolicy({ classify: async text => text.includes('crown') ? { verdict: 'block', category: 'politics' } : { verdict: 'allow' } });
  const client = fakeClient({ propose: JSON.stringify(children), review: REVIEW });
  const out = await createBranchAgent({ client, policy }).run({ divergence: CONTINUATION.rootDivergence, continuation: CONTINUATION });
  assert.deepEqual(out.branches.map(b => b.id), ['clean']);
  assert.deepEqual(out.rejected.map(r => r.branch.id), ['keyword', 'classifier']);
});

test('a prohibited ancestor is blocked before generating any descendants', async () => {
  const client = fakeClient({});
  const continuation = { ...CONTINUATION, path: [CONTINUATION.path[0], { ...CONTINUATION.path[1], summary: 'An army copies the pumps.' }] };
  const out = await createBranchAgent({ client, policy: allowAll }).run({ divergence: 'A library survives', continuation });
  assert.equal(out.status, 'blocked');
  assert.equal(client.calls.length, 0);
});

const GEOGRAPHY = { version: 1, changes: [{ id: 'green-sahara', kind: 'vegetation', region: 'sahara', intensity: 0.7,
  assumption: 'The Sahara retains extensive grassland.', uncertainty: 'Rainfall and exact boundaries are hypothetical.' }] };

test('model geography survives planning, review, streaming and the selected hero image prompt', async () => {
  const branch = { ...BRANCHES[0], geography: GEOGRAPHY };
  const client = fakeClient({ propose: JSON.stringify([branch]), review: REVIEW });
  const events = [], policyInputs = [];
  const policy = createTopicPolicy({ classifyBranches: async text => { policyInputs.push(text); return { verdict: 'allow' }; } });
  const out = await createBranchAgent({ client, policy }).run({ divergence: 'What if the Sahara stayed green?', onStep: event => events.push(event) });
  assert.deepEqual(out.branches[0].geography, GEOGRAPHY);
  assert.deepEqual(events.find(event => event.step === 'propose' && event.pending === false).branches[0].geography, GEOGRAPHY);
  assert.ok(client.calls[1].input.includes(GEOGRAPHY.changes[0].assumption));
  assert.ok(policyInputs[0].includes(GEOGRAPHY.changes[0].uncertainty));
  assert.ok(out.hero.imagePrompt.includes(GEOGRAPHY.changes[0].assumption));
  assert.ok(out.hero.imagePrompt.includes(GEOGRAPHY.changes[0].uncertainty));
  assert.match(client.calls[0].instructions, /no supported visualization, not no physical change/);
  assert.match(client.calls[0].instructions, /"sahara":\["vegetation","lake"\]/);
});

test('malformed or ancestry-erasing geography never reaches review or stream, while omission inherits', async () => {
  const context = { ...CONTINUATION, path: CONTINUATION.path.map(event => ({ ...event, geography: GEOGRAPHY })) };
  const child = { ...BRANCHES[1], causalLink: 'The inherited grassland supports botanical workshops.' };
  const client = fakeClient({ propose: JSON.stringify([
    { ...child, id: 'missing-condition', geography: { version: 1, changes: [] } },
    { ...child, id: 'unknown-region', geography: { version: 1, changes: [{ ...GEOGRAPHY.changes[0], region: 'atlantis' }] } },
    { ...child, id: 'weakened', geography: { version: 1, changes: [{ ...GEOGRAPHY.changes[0], intensity: 0.1 }] } },
    { ...child, id: 'inherited' },
  ]), review: REVIEW });
  const events = [];
  const out = await createBranchAgent({ client, policy: allowAll }).run({ divergence: context.rootDivergence, continuation: context, onStep: event => events.push(event) });
  assert.deepEqual(out.branches.map(branch => branch.id), ['inherited']);
  assert.deepEqual(out.branches[0].geography, GEOGRAPHY);
  assert.deepEqual(out.continuation.path.map(event => event.geography), [GEOGRAPHY, GEOGRAPHY]);
  const reviewed = JSON.parse(client.calls[1].input.split('\nBranches:\n')[1]);
  assert.deepEqual(reviewed.map(branch => branch.id), ['inherited']);
  assert.deepEqual(events.find(event => event.step === 'propose' && event.pending === false).branches.map(branch => branch.id), ['inherited']);
  for (const call of client.calls) assert.ok(call.input.includes(GEOGRAPHY.changes[0].assumption));
  assert.throws(() => normalizeContinuation({ ...context, path: [context.path[0], { ...context.path[1], geography: { version: 1, changes: [] } }] }), /Invalid geography/);
});

test('geography free text cannot bypass keyword or model policy, including inherited uncertainty', async () => {
  const geographic = uncertainty => ({ ...GEOGRAPHY, changes: [{ ...GEOGRAPHY.changes[0], uncertainty }] });
  const policy = createTopicPolicy({ classifyBranches: async text => text.includes('crown') ? { verdict: 'block', category: 'politics' } : { verdict: 'allow' } });
  const client = fakeClient({ propose: JSON.stringify([
    { ...BRANCHES[0], id: 'keyword', geography: geographic('An army uses the grassland.') },
    { ...BRANCHES[0], id: 'model', geography: geographic('A struggle for the crown changes rainfall study.') },
    { ...BRANCHES[0], id: 'clean', geography: GEOGRAPHY },
  ]), review: REVIEW });
  const out = await createBranchAgent({ client, policy }).run({ divergence: 'A greener Sahara' });
  assert.deepEqual(out.branches.map(branch => branch.id), ['clean']);
  assert.deepEqual(out.rejected.map(item => item.branch.id), ['keyword', 'model']);
  const noCalls = fakeClient({});
  const inherited = { ...CONTINUATION, path: [{ ...CONTINUATION.path[0], geography: geographic('An army uses the grassland.') }, CONTINUATION.path[1]] };
  const blocked = await createBranchAgent({ client: noCalls, policy: allowAll }).run({ divergence: 'A greener Sahara', continuation: inherited });
  assert.equal(blocked.status, 'blocked');
  assert.equal(noCalls.calls.length, 0);
});
