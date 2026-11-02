import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { createDemoServer } from '../server/index.js';
import { createContinuationStore } from '../src/demo/continuationStore.js';

const headers = { 'x-demo-access-code': 'history-code' };
const geography = intensity => ({ version: 1, changes: [{ id: `sahara-${intensity}`, kind: 'vegetation', region: 'sahara', intensity,
  assumption: 'Illustrative vegetation state.', uncertainty: 'The boundary is schematic.' }] });
const branch = (id, year, title, extra = {}) => ({ id, year, title, summary: `${title} influences regional settlement.`,
  place: { name: 'Sahara', lat: 20, lon: 10 }, ...extra });

test('GET /api/histories migrates authorized saved runs once and composes geography as of a date', async t => {
  const base = await mkdtemp(join(tmpdir(), 'office-history-server-'));
  const runsDir = join(base, 'cached'), liveRunsDir = join(base, 'live');
  await mkdir(join(runsDir, 'question-root'), { recursive: true });
  await mkdir(join(liveRunsDir, 'child-run'), { recursive: true });
  const rootBranch = { status: 'ok', divergence: 'What if the Sahara remained green?', branches: [
    branch('b1', -3000, 'Wetland villages follow the lakes', { geography: geography(0.8) }),
    branch('b2', -2000, 'River traders map the grasslands'),
  ], hero: { branchId: 'b1', title: 'Green Sahara' } };
  const childBranch = { status: 'ok', divergence: rootBranch.divergence, branches: [
    branch('c1', -1000, 'Water keepers tend the channel gardens', { geography: geography(0.4) }),
  ] };
  const continuation = { rootRunId: 'question-root', rootDivergence: rootBranch.divergence, parentRunId: 'question-root', parentBranchId: 'b1', path: [
    { runId: 'question-root', branchId: 'b1', ...rootBranch.branches[0] },
    { runId: 'child-run', branchId: 'c1', ...childBranch.branches[0] },
  ] };
  const legacyText = JSON.stringify(rootBranch, null, 2);
  const legacyPath = join(runsDir, 'question-root', 'branch.json');
  await writeFile(legacyPath, legacyText);
  await writeFile(join(liveRunsDir, 'child-run', 'branch.json'), JSON.stringify(childBranch));
  createContinuationStore(liveRunsDir).save({ id: 'child-run', status: 'complete', rootDivergence: rootBranch.divergence, continuation,
    completion: { runId: 'child-run', branch: childBranch } });

  const server = createDemoServer({ runsDir, liveRunsDir, webDir: resolve('web'), packagedReplayRoot: null,
    env: { DEMO_ACCESS_CODE: 'history-code' }, rateLimit: 100 });
  await new Promise(resolveListen => server.listen(0, '127.0.0.1', resolveListen));
  t.after(async () => {
    await new Promise(resolveClose => server.close(resolveClose));
    await rm(base, { recursive: true, force: true });
  });
  const url = `http://127.0.0.1:${server.address().port}`;

  assert.equal((await fetch(`${url}/api/histories`)).status, 403);
  assert.equal((await fetch(`${url}/api/histories?asOfYear=0`, { headers })).status, 400);
  const earlyResponse = await fetch(`${url}/api/histories?asOfYear=-1500`, { headers });
  assert.equal(earlyResponse.status, 200);
  const early = await earlyResponse.json();
  assert.equal(early.asOfYear, -1500);
  assert.equal(early.questions.length, 1);
  const history = early.questions[0].histories[0];
  assert.deepEqual(history.events.map(event => event.id), ['question-root:b1', 'child-run:c1']);
  assert.deepEqual(history.asOf.events.map(event => event.id), ['question-root:b1']);
  assert.equal(history.asOf.geography.changes[0].intensity, 0.8);

  const later = await (await fetch(`${url}/api/histories?asOfYear=-500`, { headers })).json();
  assert.equal(later.questions[0].histories[0].asOf.geography.changes[0].intensity, 0.4);
  assert.deepEqual(later.questions[0].histories[0].suggestions.map(item => item.suggestionForEventId), ['question-root:b2']);
  assert.equal(await readFile(legacyPath, 'utf8'), legacyText, 'the API leaves the legacy source unchanged');
  assert.ok((await readFile(join(liveRunsDir, '.history', 'state-v1.json'), 'utf8')).includes('question-root'));

  const oldHistory = await fetch(`${url}/api/history`, { headers });
  assert.equal(oldHistory.status, 200, 'the existing endpoint remains available');
});
