import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, writeFile, realpath, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve, relative, isAbsolute } from 'node:path';
import { createHash } from 'node:crypto';
import { createDemoServer } from '../server/index.js';

const ids = ['alexandria', 'beringia', 'green-sahara', 'mechanisms'];
const digest = bytes => createHash('sha256').update(bytes).digest('hex');

test('every real cached branch uses the same continuation runner and leaves cached 3D assets intact', async t => {
  const temp = await mkdtemp(join(tmpdir(), 'office-cached-continuation-'));
  const liveRunsDir = join(temp, 'live'); await mkdir(liveRunsDir);
  const calls = [];
  const runner = async args => {
    calls.push(args);
    const parent = args.continuation.path.at(-1);
    const child = { status: 'ok', divergence: args.divergence, branches: [{ id:'b1', title:'A later event', year:parent.year + 100,
      summary:'A later scenario follows the earlier choice.', place:{ name:'Sahara', lat:20, lon:10 } }], hero:{ branchId:'b1' }, continuation:args.continuation };
    await mkdir(join(liveRunsDir, args.runId), { recursive:true });
    await writeFile(join(liveRunsDir, args.runId, 'branch.json'), JSON.stringify(child));
    await writeFile(join(liveRunsDir, args.runId, 'hero.png'), 'fixture image');
    args.onStep({ step:'image', runId:args.runId });
    return { runId:args.runId, branch:child, costUsd:0 };
  };
  runner.enforcesDailyCap = true;
  const server = createDemoServer({ runsDir:resolve('demo/runs'), liveRunsDir, webDir:resolve('web'), runPipeline:runner,
    rateLimit:100, env:{ DEMO_ACCESS_CODE:'test-code' } });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(async () => {
    await new Promise(resolve => server.close(resolve));
    const target = await realpath(temp), tempRoot = await realpath(tmpdir());
    const inside = relative(tempRoot, target);
    assert.ok(inside && !inside.startsWith('..') && !isAbsolute(inside), 'fixture cleanup stays inside the temporary directory');
    await rm(target, {recursive:true, force:true});
  });
  const base = `http://127.0.0.1:${server.address().port}`;
  for (const id of ids) {
    const saved = JSON.parse(await readFile(`demo/runs/${id}/branch.json`, 'utf8'));
    const glbPath = `demo/runs/${id}/model.glb`;
    const before = digest(await readFile(glbPath));
    const manifest = await (await fetch(`${base}/runs/${id}`)).json();
    assert.equal(manifest.hasModel, true, `${id} keeps its saved 3D model`);
    assert.equal(digest(Buffer.from(await (await fetch(`${base}/runs/${id}/model.glb`)).arrayBuffer())), before);
    for (const branch of saved.branches) {
      const health = await fetch(`${base}/health`);
      const cookie = health.headers.get('set-cookie')?.split(';')[0];
      const response = await fetch(`${base}/api/continue`, { method:'POST', headers:{'content-type':'application/json','x-demo-access-code':'test-code',cookie}, body:JSON.stringify({runId:id, branchId:branch.id}) });
      assert.equal(response.status, 200, `${id}/${branch.id}`);
      const events = await response.text();
      assert.match(events, /event: image/);
      const result = JSON.parse(events.match(/event: complete\ndata: (.+)/)[1]);
      assert.equal(result.continuation.path[0].branchId, branch.id);
      assert.equal(result.continuation.rootDivergence, saved.divergence);
      assert.equal(calls.at(-1).continuation.path[0].title, branch.title);
      if (branch.geography) assert.deepEqual(result.continuation.path[0].geography, branch.geography);
      assert.equal(await (await fetch(`${base}/runs/${result.runId}/hero.png`)).text(), 'fixture image');
    }
    assert.equal(digest(await readFile(glbPath)), before, `${id} original GLB is unchanged`);
  }
  assert.equal(calls.length, 12);
});
