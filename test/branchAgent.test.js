import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createBranchAgent } from '../src/agents/branchAgent.js';
import { createTopicPolicy } from '../src/guardrails/topicPolicy.js';
import { extractJson } from '../src/lib/json.js';
import { runHarness } from '../harness/run.js';

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

test('fresh evidence is retrieved after policy clearance and unsupported branch citations fail closed', async () => {
  const grounded = { ...BRANCHES[0], changedAssumption: 'The library survives its historical destruction.', causalSteps: ['More copies are retained.', 'Scholars exchange works across ports.'], baselineClaims: [{ text: 'Historical baseline text.', sourceIds: ['alex-library'] }], uncertainty: 'Later institutional and economic support remains unknown.', citations: ['alex-library'], unverifiedClaims: ['The institution survives continuously.'], demonstrates: 'Copying networks could expand.', doesNotEstablish: 'That this outcome would occur.', discussionQuestion: 'What evidence would show continuity?' };
  const evidence = { status: 'retrieved', topicId: 'alexandria-library', sources: [{ id: 'alex-library', title: 'Library history', url: 'https://www.ucl.ac.uk/example', excerptFormat: 'complete-source-units-v1', excerpt: 'Historical baseline text.' }] };
  const client = fakeClient({ propose: JSON.stringify([grounded]), review: { ...REVIEW, scores: [{ id: 'b1', score: 8, note: 'grounded' }] } });
  const events = [];
  const out = await createBranchAgent({ client, policy: allowAll, evidenceResolver: async () => evidence }).run({ divergence: 'What if Alexandria library survived?', onStep: event => events.push(event) });
  assert.equal(out.status, 'ok');
  assert.equal(out.evidence.sources[0].id, 'alex-library');
  assert.deepEqual(out.branches[0].citations, ['alex-library']);
  assert.match(client.calls[0].input, /Historical baseline text/);
  assert.deepEqual(events.find(event => event.step === 'evidence').evidence, evidence);
  assert.ok(client.calls.find(call => call.label === 'branch-agent:review').input.includes('Historical baseline text'));

  const unsupported = fakeClient({ propose: JSON.stringify([{ ...grounded, citations: ['unrelated-cached-source'] }]) });
  const rejected = await createBranchAgent({ client: unsupported, policy: allowAll, evidenceResolver: async () => evidence }).run({ divergence: 'What if Alexandria library survived?' });
  assert.equal(rejected.status, 'ungrounded');
  assert.equal(rejected.branches.length, 0);
  assert.equal(unsupported.calls.length, 1); // no review call after citation rejection
});

test('truncated fresh proposal array is rejected and retried before review', async () => {
  const grounded = { ...BRANCHES[0], changedAssumption: 'The library survives its historical destruction.', causalSteps: ['More copies are retained.', 'Scholars exchange works across ports.'], baselineClaims: [{ text: 'Historical baseline text.', sourceIds: ['alex-library'] }], uncertainty: 'Later support remains unknown.', citations: ['alex-library'], unverifiedClaims: ['The institution survives continuously.'], demonstrates: 'Copying networks could expand.', doesNotEstablish: 'That this outcome would occur.', discussionQuestion: 'What evidence would show continuity?' };
  const evidence = { status: 'retrieved', topicId: 'alexandria-library', sources: [{ id: 'alex-library', title: 'Library history', url: 'https://www.ucl.ac.uk/example', excerptFormat: 'complete-source-units-v1', excerpt: 'Historical baseline text.' }] };
  const calls = [];
  let spent = 0;
  const client = {
    calls,
    spent: () => spent,
    async respond(args) {
      calls.push(args);
      spent += 0.001;
      if (args.label.endsWith(':propose') && calls.filter(c => c.label.endsWith(':propose')).length === 1) {
        // extractJson can recover this complete inner object, but the response
        // status and top-level proposal shape make it unusable.
        return { text: `[${JSON.stringify(grounded)}`, response: { status: 'incomplete', incomplete_details: { reason: 'max_output_tokens' } }, usage: { output_tokens: 6000, output_tokens_details: { reasoning_tokens: 5126 } }, costUsd: 0.001 };
      }
      return { text: JSON.stringify(args.label.endsWith(':propose') ? [grounded] : { scores: [{ id: 'b1', score: 8, note: 'coherent' }], hero: { id: 'b1', imagePrompt: 'Brass engine', subject: 'brass engine' } }), response: { status: 'completed' }, usage: { output_tokens: 300 }, costUsd: 0.001 };
    },
  };
  const out = await createBranchAgent({ client, policy: allowAll, evidenceResolver: async () => evidence }).run({ divergence: 'What if the Library of Alexandria survived?' });

  assert.equal(out.status, 'ok');
  const proposals = out.trace.filter(item => item.step === 'propose');
  assert.deepEqual(proposals.map(item => item.ok), [false, true]);
  assert.equal(proposals[0].responseStatus, 'incomplete');
  assert.equal(proposals[0].incompleteReason, 'max_output_tokens');
  assert.equal(proposals[0].validShape, false);
  assert.equal(proposals[1].validShape, true);
  assert.equal(calls.filter(call => call.label.endsWith(':propose')).length, 2);
  assert.equal(calls[0].reasoning.effort, 'low');
  assert.equal(calls[0].maxOutputTokens, 9000);
  assert.equal(calls.some(call => call.label.endsWith(':review')), true);
});

test('fresh branches with missing, extra, or ambiguous citation IDs are rejected before review and rendering', async () => {
  const outputRoot = mkdtempSync(join(tmpdir(), 'otherwise-fresh-citation-gate-'));
  const sources = [
    { id: 'alex-library', title: 'Library history', url: 'https://www.ucl.ac.uk/example', excerptFormat: 'complete-source-units-v1', excerpt: 'Historical baseline text.' },
    { id: 'alex-papyri', title: 'Papyrus records', url: 'https://www.ucl.ac.uk/papyri', excerptFormat: 'complete-source-units-v1', excerpt: 'Additional historical baseline text.' },
  ];
  const evidence = { status: 'retrieved', topicId: 'alexandria-library', sources };
  const base = { ...BRANCHES[0], changedAssumption: 'The library survives its historical destruction.', causalSteps: ['More copies are retained.', 'Scholars exchange works across ports.'], baselineClaims: [{ text: 'Historical baseline text.', sourceIds: ['alex-library'] }], citations: ['alex-library'], uncertainty: 'Later institutional and economic support remains unknown.', unverifiedClaims: ['The institution survives continuously.'], demonstrates: 'Copying networks could expand.', doesNotEstablish: 'That this outcome would occur.', discussionQuestion: 'What evidence would show continuity?' };
  const malformed = [
    [{ ...base, baselineClaims: [{ text: 'Historical baseline text.', sourceIds: ['alex-library', 'alex-papyri'] }], citations: ['alex-library'] }],
    [{ ...base, citations: ['alex-library', 'alex-papyri'] }],
    [base, { ...base, title: 'A conflicting duplicate ID' }],
  ];

  for (let index = 0; index < malformed.length; index++) {
    const branches = malformed[index];
    const client = fakeClient({ propose: JSON.stringify(branches) });
    let imageCalls = 0, samCalls = 0;
    try {
      const out = await runHarness({
        divergence: 'What if Alexandria library survived?', client,
        agent: createBranchAgent({ client, policy: allowAll, evidenceResolver: async () => evidence }),
        image: { generate: async () => { imageCalls++; throw new Error('image must not run'); } },
        sam: { segment: async () => { samCalls++; throw new Error('SAM must not run'); } },
        outputRoot, timestamp: index + 1, log() {},
      });
      assert.equal(out.branch.status, 'ungrounded');
      assert.equal(out.branch.branches.length, 0);
      assert.equal(client.calls.length, 1); // proposal only; no review call
      assert.equal(imageCalls, 0);
      assert.equal(samCalls, 0);
    } finally {
      rmSync(outputRoot, { recursive: true, force: true });
    }
  }
});

test('fresh generation stops before proposing when no in-scope live source can be fetched', async () => {
  const client = fakeClient({});
  const out = await createBranchAgent({ client, policy: allowAll, evidenceResolver: async () => ({ status: 'unavailable', reason: 'topic_out_of_coverage', sources: [] }) }).run({ divergence: 'What if an unknown island culture used glass?' });
  assert.equal(out.status, 'evidence_unavailable');
  assert.equal(client.calls.length, 0);
});

test('fresh generation rejects lost qualifications before branch policy, review, streams and rendering', async () => {
  const sourceText = 'Strato became head of the Lyceum at Alexandria in 287 BC and it is thought that Aristarchus studied with him there starting his studies shortly after that date.';
  const unsupported = 'Aristarchus studied with Strato in Alexandria shortly after Strato became head of the Lyceum there in 287 BC.';
  const base = { ...BRANCHES[0], changedAssumption: 'Teaching continues.', causalSteps: ['More texts circulate.', 'Scholars exchange observations.'], baselineClaims: [{ text: unsupported, sourceIds: ['alex-aristarchus'] }], citations: ['alex-aristarchus'], uncertainty: 'Later funding is unknown.', unverifiedClaims: ['Astronomy flourishes.'], demonstrates: 'A possible network.', doesNotEstablish: 'That this occurred.', discussionQuestion: 'What records survive?' };
  const source = { id: 'alex-aristarchus', excerptFormat: 'complete-source-units-v1', excerpt: sourceText };
  const outputRoot = mkdtempSync(join(tmpdir(), 'otherwise-source-fidelity-'));
  try {
    for (const candidateSource of [source, { id: source.id, excerpt: sourceText }]) {
      const client = fakeClient({ propose: JSON.stringify([base]) });
      const events = [];
      let branchPolicyCalls = 0, imageCalls = 0, samCalls = 0;
      const policy = { checkPrompt: async () => ({ allowed: true }), checkBranches: async () => { branchPolicyCalls++; throw new Error('unsupported baseline reached policy'); } };
      const out = await runHarness({
        divergence: 'What if the Library of Alexandria survived?', client,
        agent: createBranchAgent({ client, policy, evidenceResolver: async () => ({ status: 'retrieved', sources: [candidateSource] }) }),
        image: { generate: async () => { imageCalls++; throw new Error('must not render'); } },
        sam: { segment: async () => { samCalls++; throw new Error('must not segment'); } },
        outputRoot, timestamp: candidateSource.excerptFormat ? 1 : 2, log() {}, onStep: event => events.push(event),
      });
      assert.equal(out.branch.status, 'ungrounded');
      assert.equal(branchPolicyCalls, 0);
      assert.equal(client.calls.length, 1);
      assert.equal(imageCalls + samCalls, 0);
      assert.ok(events.every(event => !(event.branches?.length)));
    }
  } finally { rmSync(outputRoot, { recursive: true, force: true }); }

  const supported = { ...base, baselineClaims: [{ text: sourceText, sourceIds: [source.id] }] };
  const client = fakeClient({ propose: JSON.stringify([base, { ...supported, id: 'b2' }]), review: REVIEW });
  const events = [];
  const out = await createBranchAgent({ client, policy: allowAll, evidenceResolver: async () => ({ status: 'retrieved', sources: [source] }) }).run({ divergence: 'What if the Library of Alexandria survived?', onStep: event => events.push(event) });
  assert.equal(out.status, 'ok');
  assert.deepEqual(out.branches.map(branch => branch.id), ['b2']);
  assert.equal(out.branches[0].baselineClaims[0].text, sourceText);
  assert.ok(events.flatMap(event => event.branches ?? []).every(branch => branch.id === 'b2'));
  assert.match(client.calls[0].input, /baselineUnits/);
  assert.match(client.calls[0].instructions, /MUST copy exactly one entire baselineUnit/);
  assert.match(client.calls[1].instructions, /Preserve them unchanged/);
});
