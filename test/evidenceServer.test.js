import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, rm, writeFile, copyFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createDemoServer } from '../server/index.js';

const root = resolve(fileURLToPath(new URL('..', import.meta.url)));
const actualRuns = join(root, 'demo', 'runs');
const actualEvidence = join(root, 'demo', 'evidence', 'v1.json');

async function start(t, { runsDir = actualRuns, evidencePath = actualEvidence } = {}) {
  const server = createDemoServer({ runsDir, evidencePath, webDir: join(root, 'web'), env: { DEMO_REPLAY_ONLY: 'true' } });
  await new Promise(resolveListen => server.listen(0, '127.0.0.1', resolveListen));
  t.after(() => new Promise(resolveClose => server.close(resolveClose)));
  return `http://127.0.0.1:${server.address().port}`;
}

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
