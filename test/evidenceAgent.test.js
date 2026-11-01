import test from 'node:test';
import assert from 'node:assert/strict';
import { createBranchAgent } from '../src/agents/branchAgent.js';
import { createTopicPolicy } from '../src/guardrails/topicPolicy.js';
import { selectFreshEvidence } from '../src/evidence/fresh.js';

const unit = 'The Library of Alexandria supported scholars who studied and copied texts in the Museum, although its institutional history remains incomplete.';
const source = {
  id: 'alex-library', title: 'The Library of Alexandria', publisher: 'University of Chicago',
  url: 'https://penelope.uchicago.edu/~grout/encyclopaedia_romana/library.html',
  date: '2026-10-29', checkedDate: '2026-10-29', checkedAt: '2026-10-29T12:00:00.000Z', retrievalTimestamp: '2026-10-29T12:00:00.000Z',
  fetchStatus: 'fetched', provenance: 'bounded-live-fetch', verificationMethod: 'retrieved_excerpt', contentSha256: 'a'.repeat(64),
  excerptFormat: 'complete-source-units-v1', excerpt: unit,
};
const evidence = {
  status: 'retrieved', topicId: 'alexandria-library', retrievedAt: '2026-10-29T12:00:00.000Z',
  method: { label: 'Bounded public source retrieval', scope: 'Fixed approved sources; quotations are not verification.', scoreDisclaimer: 'Scores are not factual confidence.' },
  sources: [source],
};
const proposal = {
  id: 'b1', title: 'A Continuing Library', year: 260,
  place: { name: 'Alexandria', lat: 31.2, lon: 29.9 },
  summary: 'A durable school keeps copying texts and comparing astronomical models.',
  scene: 'A scholar studies a bronze instrument beside the library.',
  changedAssumption: 'Assume a durable institution continues copying and teaching texts.',
  causalSteps: ['Repeated copying preserves more works.', 'Teaching networks bring the works to later scholars.'],
  baselineClaims: [{ text: unit, sourceIds: ['alex-library'] }],
  uncertainty: 'The library history is incomplete, and institutional continuity is hypothetical.',
  citations: ['alex-library'], unverifiedClaims: ['The institution survives for centuries.'],
  demonstrates: 'How continued copying might change scholarly access.',
  doesNotEstablish: 'It does not establish that the historical library survived.',
  discussionQuestion: 'What evidence could establish continuity between institutions?',
};
const review = { scores: [{ id: 'b1', score: 7, note: 'A cautious hypothetical.' }], hero: { id: 'b1', imagePrompt: 'A bronze instrument in a library.', subject: 'bronze instrument' } };

function policy() {
  return createTopicPolicy({ classify: async () => ({ verdict: 'allow', category: null, reason: '' }) });
}
function client(proposals = [proposal]) {
  const calls = [];
  let spent = 0;
  return {
    calls, spent: () => spent,
    async respond(args) {
      calls.push(args); spent += 0.001;
      const result = args.label.endsWith(':propose') ? proposals : review;
      return { text: JSON.stringify(result), costUsd: 0.001, usage: { output_tokens: 100 } };
    },
  };
}

test('fresh source passages are provided to the planner and exact grounded claims survive into a digest-bound artifact', async () => {
  const model = client();
  const events = [];
  const artifact = await createBranchAgent({ client: model, policy: policy(), evidenceResolver: async () => evidence })
    .run({ runId: 'fresh-1', divergence: 'What if the Library of Alexandria survived?', onStep: event => events.push(event) });
  assert.equal(artifact.status, 'ok');
  assert.match(model.calls[0].input, /baselineUnits/);
  assert.match(model.calls[0].input, new RegExp(unit.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
  assert.equal(artifact.branches[0].baselineClaims[0].text, unit);
  assert.match(artifact.branches[0].uncertainty, /library history is incomplete/);
  assert.ok(events.some(event => event.step === 'evidence' && event.status === 'retrieved'));
  const selected = selectFreshEvidence('fresh-1', artifact);
  assert.ok(selected);
  assert.match(selected.run.branches[0].baselineClaims[0].text, /institutional history remains incomplete/);
  assert.match(selected.run.branches[0].uncertainty, /hypothetical/);
});

test('unavailable retrieval and ungrounded retrieved quotes reuse only unsourced branch core', async () => {
  const unavailableClient = client();
  const events = [];
  const unavailable = await createBranchAgent({ client: unavailableClient, policy: policy(), evidenceResolver: async () => ({ status: 'unavailable', reason: 'topic_out_of_coverage', sources: [] }) })
    .run({ runId: 'fresh-2', divergence: 'What if an unsupported topic changed?', onStep: event => events.push(event) });
  assert.equal(unavailable.status, 'ok');
  assert.deepEqual(unavailable.evidenceStatus, { status: 'unavailable', reason: 'topic_out_of_coverage' });
  assert.equal(unavailableClient.calls.length, 2, 'unsupported topics still use the normal propose and review flow');
  assert.match(unavailableClient.calls[0].instructions, /Do not invent citations/);
  assert.ok(!('baselineClaims' in unavailable.branches[0]));
  assert.ok(!('citations' in unavailable.branches[0]));
  assert.ok(events.some(event => event.step === 'evidence' && event.status === 'unavailable'));

  const paraphrase = { ...proposal, baselineClaims: [{ text: 'The Library supported scholars.', sourceIds: ['alex-library'] }] };
  const ungroundedClient = client([paraphrase]);
  const ungrounded = await createBranchAgent({ client: ungroundedClient, policy: policy(), evidenceResolver: async () => evidence })
    .run({ runId: 'fresh-3', divergence: 'What if the Library of Alexandria survived?' });
  assert.equal(ungrounded.status, 'ok');
  assert.deepEqual(ungrounded.evidenceStatus, { status: 'unavailable', reason: 'no_complete_source_passage' });
  assert.equal(ungroundedClient.calls.length, 2, 'the existing proposal is reviewed once without another proposal call');
  assert.ok(ungroundedClient.calls.some(call => call.label.endsWith(':review') && /Do not invent citations/.test(call.instructions)));
  for (const field of ['baselineClaims', 'citations', 'changedAssumption', 'causalSteps', 'uncertainty', 'unverifiedClaims', 'demonstrates', 'doesNotEstablish', 'discussionQuestion']) {
    assert.ok(!(field in ungrounded.branches[0]), `unsupported ${field} must not survive fallback`);
  }
  assert.equal(selectFreshEvidence('fresh-3', ungrounded), null, 'the unsupported baseline cannot be shown as sourced evidence');

  const noCoreClient = client([{ id: 'invalid', title: 'Missing core fields' }]);
  const noCore = await createBranchAgent({ client: noCoreClient, policy: policy(), evidenceResolver: async () => evidence })
    .run({ runId: 'fresh-4', divergence: 'What if the Library of Alexandria survived?' });
  assert.equal(noCore.status, 'empty');
  assert.equal(noCoreClient.calls.length, 1, 'no review runs without a valid core branch');
  assert.equal(noCore.evidenceStatus.reason, 'no_complete_source_passage');
});
