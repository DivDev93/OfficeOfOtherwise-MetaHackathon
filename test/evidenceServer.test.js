import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, rm, writeFile, copyFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createDemoServer } from '../server/index.js';
import { freshEvidenceDigest } from '../src/evidence/fresh.js';

const root = resolve(fileURLToPath(new URL('..', import.meta.url)));
const actualRuns = join(root, 'demo', 'runs');
const actualEvidence = join(root, 'demo', 'evidence', 'v1.json');

async function start(t, { runsDir = actualRuns, evidencePath = actualEvidence, liveRunsDir, runPipeline, env = { DEMO_REPLAY_ONLY: 'true' } } = {}) {
  const server = createDemoServer({ runsDir, evidencePath, liveRunsDir, runPipeline, webDir: join(root, 'web'), env });
  await new Promise(resolveListen => server.listen(0, '127.0.0.1', resolveListen));
  t.after(() => new Promise(resolveClose => server.close(resolveClose)));
  return `http://127.0.0.1:${server.address().port}`;
}

function freshArtifact(runId) {
  const retrievedAt = new Date().toISOString();
  const date = retrievedAt.slice(0, 10);
  const source = { id: 'alex-library', title: 'Library history', publisher: 'UChicago', url: 'https://penelope.uchicago.edu/~grout/encyclopaedia_romana/library.html', date, checkedDate: date, checkedAt: retrievedAt, retrievalTimestamp: retrievedAt, fetchStatus: 'fetched', provenance: 'bounded-live-fetch', verificationMethod: 'retrieved_excerpt', contentSha256: 'a'.repeat(64), excerpt: 'Retrieved source excerpt on the ancient Library of Alexandria.' };
  const branch = { id: 'b1', title: 'The living library', year: 250, place: { name: 'Alexandria', lat: 31.2, lon: 29.9 }, summary: 'The library survives.', scene: 'A scroll room at dawn.', changedAssumption: 'The library survives.', causalSteps: ['More texts are copied.', 'Scholars exchange copies.'], baselineClaims: [{ text: 'The library was a Ptolemaic institution.', sourceIds: ['alex-library'] }], uncertainty: 'Its later institutional continuity is unknown.', citations: ['alex-library'], unverifiedClaims: ['It survives for centuries.'], demonstrates: 'Copying networks could expand.', doesNotEstablish: 'That this alternative occurred.', discussionQuestion: 'What records would demonstrate continuity?', score: 8 };
  const artifact = { runId, status: 'ok', divergence: 'What if the Library of Alexandria survived?', branches: [branch], evidence: { status: 'retrieved', topicId: 'alexandria-library', retrievedAt, method: { label: 'Bounded public source retrieval', scope: 'Fixed approved sources; excerpts are not independently verified claims.', scoreDisclaimer: 'Model scores are not factual confidence.' }, sources: [source] } };
  artifact.evidence.artifactSha256 = freshEvidenceDigest(artifact);
  return artifact;
}

test('fresh evidence is streamed and served only from a registered run with a valid bound artifact', async t => {
  const temp = await mkdtemp(join(tmpdir(), 'office-fresh-evidence-'));
  t.after(() => rm(temp, { recursive: true, force: true }));
  const liveRunsDir = join(temp, 'live');
  const runId = 'fresh-001';
  const artifact = freshArtifact(runId);
  const runner = async ({ onStep }) => {
    await mkdir(join(liveRunsDir, runId), { recursive: true });
    await writeFile(join(liveRunsDir, runId, 'branch.json'), JSON.stringify(artifact));
    onStep({ step: 'evidence', runId, status: 'retrieved', evidence: artifact.evidence });
    return { runId, branch: artifact };
  };
  runner.enforcesDailyCap = true;
  const url = await start(t, { liveRunsDir, runPipeline: runner, env: { DEMO_REPLAY_ONLY: 'false', DEMO_ACCESS_CODE: 'fixture-code', DEMO_DAILY_CAP_USD: '3' } });
  const response = await fetch(`${url}/api/run`, { method: 'POST', headers: { 'content-type': 'application/json', 'x-demo-access-code': 'fixture-code' }, body: JSON.stringify({ divergence: artifact.divergence }) });
  assert.equal(response.status, 200);
  const stream = await response.text();
  assert.match(stream, /event: evidence/);
  assert.match(stream, /"evidence":\{"status":"retrieved"/);
  const fetched = await fetch(`${url}/runs/${runId}/evidence`);
  assert.equal(fetched.status, 200);
  const normalized = await fetched.json();
  assert.equal(normalized.run.runId, runId);
  assert.equal(normalized.run.branches[0].branchId, 'b1');
  assert.equal((await fetch(`${url}/runs/not-registered/evidence`)).status, 404);
});

test('fresh evidence endpoint rejects stale digest and malformed or unsupported citations', async t => {
  const temp = await mkdtemp(join(tmpdir(), 'office-fresh-evidence-invalid-'));
  t.after(() => rm(temp, { recursive: true, force: true }));
  const liveRunsDir = join(temp, 'live');
  const runId = 'fresh-invalid';
  let artifact = freshArtifact(runId);
  const runner = async ({ onStep }) => {
    await mkdir(join(liveRunsDir, runId), { recursive: true });
    await writeFile(join(liveRunsDir, runId, 'branch.json'), JSON.stringify(artifact));
    onStep({ step: 'evidence', runId, status: 'retrieved', evidence: artifact.evidence });
    return { runId, branch: artifact };
  };
  runner.enforcesDailyCap = true;
  const url = await start(t, { liveRunsDir, runPipeline: runner, env: { DEMO_REPLAY_ONLY: 'false', DEMO_ACCESS_CODE: 'fixture-code', DEMO_DAILY_CAP_USD: '3' } });
  const post = () => fetch(`${url}/api/run`, { method: 'POST', headers: { 'content-type': 'application/json', 'x-demo-access-code': 'fixture-code' }, body: JSON.stringify({ divergence: artifact.divergence }) });
  await (await post()).text();
  artifact.branches[0].uncertainty += ' altered after retrieval';
  await writeFile(join(liveRunsDir, runId, 'branch.json'), JSON.stringify(artifact));
  assert.equal((await fetch(`${url}/runs/${runId}/evidence`)).status, 404);
  artifact = freshArtifact(runId);
  artifact.branches[0].citations = ['cached-source-from-another-prompt'];
  artifact.evidence.artifactSha256 = freshEvidenceDigest(artifact);
  await (await post()).text();
  assert.equal((await fetch(`${url}/runs/${runId}/evidence`)).status, 404);
});

test('evidence endpoint serves only the matching cached run and its used sources', async t => {
  const url = await start(t);
  const alpha = await (await fetch(`${url}/runs/alexandria/evidence`)).json();
  assert.equal(alpha.run.runId, 'alexandria');
  assert.deepEqual(alpha.run.branches.map(branch => branch.branchId), ['b1', 'b5', 'b2']);
  assert.ok(alpha.sources.length < 16);
  assert.ok(alpha.run.branches.every(branch => branch.baselineSourceIds.every(id => alpha.sources.some(source => source.id === id))));
  const sahara = await (await fetch(`${url}/runs/green-sahara/evidence`)).json();
  assert.equal(sahara.run.runId, 'green-sahara');
  assert.equal((await fetch(`${url}/runs/guardrail/evidence`)).status, 404);
  assert.equal((await fetch(`${url}/runs/unknown/evidence`)).status, 404);
});

test('evidence endpoint refuses a changed copy of a curated branch artifact', async t => {
  const temp = await mkdtemp(join(tmpdir(), 'office-evidence-stale-'));
  t.after(() => rm(temp, { recursive: true, force: true }));
  const runsDir = join(temp, 'runs'), runDir = join(runsDir, 'alexandria');
  await mkdir(runDir, { recursive: true });
  const changed = JSON.parse(await readFile(join(actualRuns, 'alexandria', 'branch.json'), 'utf8'));
  changed.branches[0].summary += ' altered';
  await writeFile(join(runDir, 'branch.json'), JSON.stringify(changed));
  const url = await start(t, { runsDir });
  assert.equal((await fetch(`${url}/runs/alexandria/evidence`)).status, 404);
});

test('evidence endpoint fails closed for missing links, unsafe source URLs, invalid methods, and malformed records', async t => {
  const temp = await mkdtemp(join(tmpdir(), 'office-evidence-invalid-'));
  t.after(() => rm(temp, { recursive: true, force: true }));
  const evidencePath = join(temp, 'evidence.json');
  const base = JSON.parse(await readFile(actualEvidence, 'utf8'));
  const variants = [
    data => { data.sources = data.sources.filter(source => source.id !== 'alex-aristarchus'); },
    data => { data.sources[0].url = 'http://example.org/source'; },
    data => { data.method.scope = ' '; },
    data => { data.runs[0].branches[0] = null; },
  ];
  const url = await start(t, { evidencePath });
  for (const mutate of variants) {
    const data = structuredClone(base);
    mutate(data);
    await writeFile(evidencePath, JSON.stringify(data));
    const response = await fetch(`${url}/runs/alexandria/evidence`);
    assert.equal(response.status, 404);
  }
});

test('evidence endpoint refuses simulated manifests even when branch JSON matches a curated run', async t => {
  const temp = await mkdtemp(join(tmpdir(), 'office-evidence-simulated-'));
  t.after(() => rm(temp, { recursive: true, force: true }));
  const runsDir = join(temp, 'runs'), runDir = join(runsDir, 'alexandria');
  await mkdir(runDir, { recursive: true });
  await copyFile(join(actualRuns, 'alexandria', 'branch.json'), join(runDir, 'branch.json'));
  await writeFile(join(runDir, 'manifest.json'), JSON.stringify({ status: 'simulated', reason: 'fixture' }));
  const url = await start(t, { runsDir });
  assert.equal((await fetch(`${url}/runs/alexandria/evidence`)).status, 404);
});
