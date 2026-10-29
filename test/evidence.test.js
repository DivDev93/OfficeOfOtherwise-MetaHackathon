import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { branchDigest, selectRunEvidence, validateEvidence } from '../src/evidence/index.js';

const dataset = JSON.parse(readFileSync(new URL('../demo/evidence/v1.json', import.meta.url), 'utf8'));
const runIds = ['alexandria', 'beringia', 'green-sahara', 'mechanisms'];
function readRun(runId) {
  return JSON.parse(readFileSync(new URL(`../demo/runs/${runId}/branch.json`, import.meta.url), 'utf8'));
}

test('evidence schema links checked baseline sources and covers every branch in four saved runs', () => {
  const result = validateEvidence(dataset, { readRun });
  assert.deepEqual(result, { valid: true, errors: [] });
  for (const runId of runIds) {
    const saved = readRun(runId);
    const evidence = selectRunEvidence(dataset, runId, saved);
    assert.ok(evidence, `${runId} evidence should match its saved branch artifact`);
    assert.deepEqual(evidence.run.branches.map(branch => branch.branchId), saved.branches.map(branch => branch.id));
    assert.ok(evidence.sources.length > 0);
    for (const branch of evidence.run.branches) {
      assert.ok(branch.baselineSourceIds.every(id => evidence.sources.some(source => source.id === id)));
      assert.ok(branch.uncertainty && branch.unverifiedClaims.length && branch.demonstrates && branch.doesNotEstablish && branch.discussionQuestion);
    }
  }
  assert.match(dataset.method.scoreDisclaimer, /not probabilities/i);
});

test('selection rejects mismatched or changed saved branch artifacts', () => {
  const saved = readRun('alexandria');
  assert.equal(branchDigest(saved), dataset.runs.find(run => run.runId === 'alexandria').branchSha256);
  assert.equal(selectRunEvidence(dataset, 'beringia', saved), null);
  const changed = structuredClone(saved);
  changed.branches[0].summary += ' revised';
  assert.equal(selectRunEvidence(dataset, 'alexandria', changed), null);
  const reordered = structuredClone(saved);
  reordered.branches.reverse();
  assert.equal(selectRunEvidence(dataset, 'alexandria', reordered), null);
});

test('validation reports stale digests and unknown baseline source IDs', () => {
  const stale = structuredClone(dataset);
  stale.runs[0].branchSha256 = '0'.repeat(64);
  stale.runs[1].branches[0].baselineSourceIds.push('missing-source');
  const result = validateEvidence(stale, { readRun });
  assert.equal(result.valid, false);
  assert.ok(result.errors.some(message => message.includes('alexandria evidence is stale')));
  assert.ok(result.errors.some(message => message.includes('invalid baseline source links')));
});

test('selector rejects malformed records, absent linked sources, unsafe URLs, and invalid method metadata', () => {
  const saved = readRun('alexandria');
  const mutations = [
    data => { data.sources = data.sources.filter(source => source.id !== 'alex-aristarchus'); },
    data => { data.sources[0].url = 'https://user:password@localhost/private'; },
    data => { data.method.scoreDisclaimer = ''; },
    data => { data.sources[0] = null; },
    data => { data.runs[0].branches[0] = null; },
    data => { data.runs[0] = null; },
  ];
  for (const mutate of mutations) {
    const malformed = structuredClone(dataset);
    mutate(malformed);
    assert.equal(validateEvidence(malformed).valid, false);
    assert.equal(selectRunEvidence(malformed, 'alexandria', saved), null);
  }
  assert.equal(selectRunEvidence(null, 'alexandria', saved), null);
});
