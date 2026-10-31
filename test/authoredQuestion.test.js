import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createDemoServer } from '../server/index.js';
import { prepareAuthoredQuestion } from '../src/demo/authoredQuestion.js';

const parentBranch = {
  status: 'ok', divergence: 'A coastal observatory preserves its star charts.',
  branches: [{ id: 'b1', title: 'Astronomy school in Alexandria', year: 350,
    summary: 'Preserved star charts improve astronomical teaching.',
    place: { name: 'Alexandria', lat: 31, lon: 29 },
    geography: { version: 2, seaLevelMeters: -120, continentalTransforms: [], changes: [],
      assumption: 'Coastal shelves remain exposed.', uncertainty: 'Local shoreline details remain approximate.' } }],
};
const headers = { 'x-demo-access-code': 'local-code', 'content-type': 'application/json' };
const parseComplete = text => JSON.parse(text.match(/event: complete\ndata: (.+)/)?.[1] ?? '{}');

test('current-world attachment keeps question metadata separate from continuation edges and passes selected ancestry once', async t => {
  const base = await mkdtemp(join(tmpdir(), 'authored-question-'));
  const runsDir = join(base, 'cached'), liveRunsDir = join(base, 'live'), webDir = join(base, 'web');
  await mkdir(join(runsDir, 'root'), { recursive: true }); await mkdir(webDir);
  await writeFile(join(runsDir, 'root', 'branch.json'), JSON.stringify(parentBranch));
  let calls = 0, contexts = [];
  const runner = async args => {
    calls++; contexts.push(args);
    const branch = { status: 'ok', divergence: args.divergence,
      ...(args.divergenceYear ? { question: { divergenceYear: args.divergenceYear, divergencePlace: args.divergencePlace } } : {}),
      hero: { title: 'A saved event' }, branches: [{ id: 'b1', title: 'A later astronomy event', year: 500, summary: 'Shared star charts support careful navigation.', place: { name: 'Alexandria', lat: 31, lon: 29 }, theme: 'science-medicine', boldness: .75 }] };
    await mkdir(join(liveRunsDir, args.runId), { recursive: true });
    await writeFile(join(liveRunsDir, args.runId, 'branch.json'), JSON.stringify(branch));
    return { runId: args.runId, branch, trace: [] };
  };
  runner.enforcesDailyCap = true;
  const server = createDemoServer({ runsDir, liveRunsDir, webDir, runPipeline: runner, rateLimit: 100, env: { DEMO_ACCESS_CODE: 'local-code' } });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(async () => { await new Promise(resolve => server.close(resolve)); await rm(base, { recursive: true, force: true }); });
  const url = `http://127.0.0.1:${server.address().port}`;
  const cookie = (await fetch(`${url}/health`)).headers.get('set-cookie').split(';')[0];
  const continueParent = async () => fetch(`${url}/api/continue`, { method: 'POST', headers: { ...headers, cookie }, body: JSON.stringify({ runId: 'root', branchId: 'b1' }) });
  const normal = parseComplete(await (await continueParent()).text());
  assert.equal(calls, 1);
  const originalEdge = (await (await fetch(`${url}/runs/root`)).json()).continuation.children[0];
  const authored = async prompt => fetch(`${url}/api/run`, { method: 'POST', headers: { ...headers, cookie }, body: JSON.stringify({
    divergence: prompt, attachment: { mode: 'current-world', parentRunId: 'root', parentBranchId: 'b1' },
  }) });
  const first = parseComplete(await (await authored('A public astronomy school shares its star charts.')).text());
  const second = parseComplete(await (await authored('A regional archive teaches navigation from preserved charts.')).text());
  assert.notEqual(first.runId, second.runId);
  assert.equal(first.questionAttachment.questionId, first.runId);
  assert.equal(first.questionAttachment.parentWorldId, 'root::b1');
  assert.equal(first.questionAttachment.divergenceYear, 350);
  assert.equal(first.questionAttachment.divergencePlace.name, 'Alexandria');
  assert.equal(first.branch.branches[0].theme, 'science-medicine');
  assert.equal(first.branch.branches[0].boldness, .75);
  assert.deepEqual(first.branch.question, { divergenceYear: 350, divergencePlace: parentBranch.branches[0].place });
  assert.equal(contexts[1].divergenceYear, 350);
  assert.deepEqual(contexts[1].divergencePlace, parentBranch.branches[0].place);
  assert.equal(first.continuation.rootDivergence, parentBranch.divergence, 'generation retains the original scenario root alongside the new prompt');
  assert.equal(contexts[1].continuation.path[0].summary, parentBranch.branches[0].summary);
  assert.equal(contexts[1].continuation.path[0].geography.seaLevelMeters, -120);
  assert.equal(calls, 3, 'each authored question causes exactly one ordinary runner invocation');
  const after = (await (await fetch(`${url}/runs/root`)).json()).continuation.children[0];
  assert.deepEqual(after, originalEdge, 'authored attachments must not replace the generated-child edge');
  const manifest = await (await fetch(`${url}/runs/${first.runId}`)).json();
  assert.deepEqual(manifest.questionAttachment, first.questionAttachment);
  assert.equal(manifest.branch.branches[0].theme, 'science-medicine');
  assert.equal(manifest.branch.branches[0].boldness, .75);
  assert.equal(manifest.branch.question.divergenceYear, 350);

  const further = parseComplete(await (await fetch(`${url}/api/continue`, { method: 'POST', headers: { ...headers, cookie }, body: JSON.stringify({ runId: first.runId, branchId: 'b1' }) })).text());
  assert.equal(further.questionAttachment.questionId, first.runId, 'generated descendants retain their authored question identity');
  assert.equal(further.continuation.rootDivergence, 'A public astronomy school shares its star charts.', 'later generated children inherit this authored question as their root divergence');
  assert.equal(calls, 4);
  const history = await (await fetch(`${url}/api/history`, { headers: { ...headers, cookie } })).json();
  assert.equal(history.runs.find(run => run.id === first.runId).questionAttachment.mode, 'current-world');
  assert.equal(normal.runId, originalEdge.runId);

  const present = parseComplete(await (await fetch(`${url}/api/run`, { method: 'POST', headers: { ...headers, cookie }, body: JSON.stringify({
    divergence: 'A public observatory shares new star charts.', attachment: { mode: 'present-day' },
  }) })).text());
  assert.deepEqual(present.questionAttachment, { questionId: present.runId, mode: 'present-day', divergenceYear: 2026 });
  assert.equal(calls, 5);
});

test('present-day attachment defaults to 2026 and invalid attachment requests are rejected before runner invocation', async t => {
  let calls = 0;
  const parent = { id: 'root', divergence: parentBranch.divergence, branch: parentBranch };
  const prepared = prepareAuthoredQuestion({ attachment: { mode: 'present-day' }, questionId: 'question-1', divergence: 'A public science archive shares research.', parent, parentSaved: null });
  assert.deepEqual(prepared.questionAttachment, { questionId: 'question-1', mode: 'present-day', divergenceYear: 2026 });
  assert.equal(prepared.continuation, undefined);
  assert.throws(() => prepareAuthoredQuestion({ attachment: { mode: 'current-world', parentRunId: '../root', parentBranchId: 'b1' }, questionId: 'question-2', divergence: 'A public archive shares astronomy.', parent, parentSaved: { status: 'complete' } }), /saved world/);
  assert.throws(() => prepareAuthoredQuestion({ attachment: { mode: 'present-day', filePath: 'C:\\private' }, questionId: 'question-3', divergence: 'A public archive shares astronomy.', parent, parentSaved: null }), /attachment/);
  assert.throws(() => prepareAuthoredQuestion({ attachment: { mode: 'present-day' }, questionId: 'question-4', divergence: 'A political election changes the science archive.', parent, parentSaved: null }), /topic policy/);
  assert.equal(calls, 0);
});
