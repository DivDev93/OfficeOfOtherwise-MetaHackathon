import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile, mkdtemp, rm, cp, mkdir, readdir, writeFile, symlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createConfiguredDemoServer, createDemoServer } from '../server/index.js';
import { createContinuationStore } from '../src/demo/continuationStore.js';

const chain = [
  ['df5e6d97-9f0d-49a0-bb62-ad52c3ae6d09', 'b3', 1380],
  ['c892b8d0-36c5-4eeb-a70b-022041a25c98', 'b1', 1472],
  ['1fc70744-d82b-4364-8b78-c79544a4f7d6', 'b1', 1538],
];

async function startReplay(t, { packagedFallback = false, liveCollision = false, liveChildCollision = false, liveParentMetadata = false, packageRootIsLiveRoot = false } = {}) {
  const outputRoot = await mkdtemp(join(tmpdir(), 'office-replay-history-'));
  const liveRunsDir = join(outputRoot, packagedFallback ? 'live-output' : 'replay-history');
  if (packagedFallback) await mkdir(liveRunsDir);
  else await cp(new URL('../demo/replay-history', import.meta.url), liveRunsDir, {
      recursive: true,
      filter: source => !source.endsWith('.expansion-sessions.json'),
    });
  if (liveCollision) {
    const runId = chain[0][0];
    await mkdir(join(liveRunsDir, runId), { recursive: true });
    await writeFile(join(liveRunsDir, runId, 'branch.json'), JSON.stringify({ status: 'ok', divergence: 'Live saved astronomy replay', branches: [
      { id: 'b1', title: 'A changed live lichen route', summary: 'A local observatory shares updated astronomy lessons.', year: 1081, place: { name: 'Kotzebue, Alaska', lat: 66.8983, lon: -162.5968 } },
    ], hero: { title: 'Live precedence' } }));
  }
  if (liveChildCollision) {
    createContinuationStore(liveRunsDir).save({
      id: chain[0][0], status: 'complete', rootDivergence: 'An unrelated saved scenario.',
      continuation: { rootRunId: 'unrelated', parentRunId: 'unrelated', parentBranchId: 'other', path: [] },
      completion: { runId: chain[0][0], branch: { status: 'ok', divergence: 'An unrelated saved scenario.', branches: [], hero: { title: 'Unrelated child' } } },
    });
  }
  if (liveParentMetadata) {
    createContinuationStore(liveRunsDir).save({
      id: 'beringia', status: 'complete', rootDivergence: 'Metadata-only parent record.',
      completion: { runId: 'beringia', branch: { status: 'ok', divergence: 'Metadata-only parent record.', branches: [] } },
    });
  }
  const { server, hasMetaKey } = createConfiguredDemoServer({
    outputRoot,
    liveRunsDir,
    ...(liveCollision ? { importRunIds: [chain[0][0]] } : {}),
    ...(packageRootIsLiveRoot ? { packagedReplayRoot: liveRunsDir, importRunIds: ['beringia'] } : {}),
    env: { DEMO_3D_ENABLED: 'false', DEMO_ACCESS_CODE: 'local-replay-code', HOST: '127.0.0.1', PORT: '0' },
  });
  assert.equal(hasMetaKey, false);
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(async () => {
    await new Promise((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
    await rm(outputRoot, { recursive: true, force: true });
  });
  return { base: `http://127.0.0.1:${server.address().port}`, liveRunsDir };
}

test('packaged saved history remains visible beside a separate writable live root without being copied', async t => {
  const { base } = await startReplay(t, { packagedFallback: true });
  const root = await (await fetch(`${base}/runs/beringia`)).json();
  assert.equal(root.divergence, 'What if the Bering land bridge never flooded?');
  assert.ok(root.continuation.children.some(edge => edge.branchId === 'b2' && edge.status === 'complete'));
  const descendant = await (await fetch(`${base}/runs/${chain[0][0]}`)).json();
  assert.equal(descendant.continuation.path.length, 1);
  assert.equal((await fetch(`${base}/runs/${chain[0][0]}/hero.png`)).status, 200);
  const history = await (await fetch(`${base}/api/history`, { headers: { 'x-demo-access-code': 'local-replay-code' } })).json();
  assert.ok(Array.isArray(history.runs), 'saved package records appear in the history endpoint');
  assert.equal((await readdir(new URL('../demo/replay-history/.continuation/runs/', import.meta.url))).length, 5,
    'serving packaged history does not rewrite or copy its records');
});

test('metadata-only live parent uses one packaged source for its manifest and branch asset', async t => {
  const { base } = await startReplay(t, { packagedFallback: true, liveParentMetadata: true });
  const manifest = await (await fetch(`${base}/runs/beringia`)).json();
  const response = await fetch(`${base}/runs/beringia/branch.json`);
  assert.equal(response.status, 200, 'a live continuation record without a run directory does not mask the packaged artifact');
  assert.deepEqual(await response.json(), manifest.branch, 'asset and manifest resolve from the same canonical run source');
});

test('an explicitly registered live record takes precedence over the packaged replay record', async t => {
  const { base } = await startReplay(t, { packagedFallback: true, liveCollision: true });
  const runId = chain[0][0];
  const manifest = await (await fetch(`${base}/runs/${runId}`)).json();
  assert.equal(manifest.title, 'Live precedence');
  assert.equal(manifest.divergence, 'Live saved astronomy replay');
  assert.equal(manifest.continuation.path.length, 0);
  assert.equal(manifest.continuation.children.length, 0, 'stale packaged edges are filtered when the same branch ID has changed meaning');
  const liveBranch = await (await fetch(`${base}/runs/${runId}/branch.json`)).json();
  assert.deepEqual(liveBranch, manifest.branch, 'a real live collision wins for both metadata and assets');
  const cookie = (await fetch(`${base}/health`)).headers.get('set-cookie')?.split(';')[0];
  const response = await fetch(`${base}/api/continue`, { method: 'POST',
    headers: { 'x-demo-access-code': 'local-replay-code', 'content-type': 'application/json', cookie },
    body: JSON.stringify({ runId, branchId: 'b1' }),
  });
  assert.equal(response.status, 503, 'the stale packaged child is not replayed for the changed live branch');
});

test('live child edges merge with packaged siblings and override only the same branch', async t => {
  const { base, liveRunsDir } = await startReplay(t, { packagedFallback: true });
  const store = createContinuationStore(liveRunsDir);
  const liveDifferentBranch = store.reserve('beringia', 'b1', {});
  store.finish(liveDifferentBranch, 'complete');
  const liveCollision = store.reserve('beringia', 'b2', {});
  store.finish(liveCollision, 'complete');

  const root = await (await fetch(`${base}/runs/beringia`)).json();
  const children = new Map(root.continuation.children.map(edge => [edge.branchId, edge.runId]));
  assert.equal(children.get('b1'), liveDifferentBranch.runId, 'a live sibling remains visible');
  assert.equal(children.get('b2'), liveCollision.runId, 'the live edge wins only its same-branch collision');
  assert.equal(children.size, 2, 'the packaged and live edges are merged by branch ID');
});

test('a live child ID collision cannot be reused as the packaged edge target', async t => {
  const { base } = await startReplay(t, { packagedFallback: true, liveChildCollision: true });
  const root = await (await fetch(`${base}/runs/beringia`)).json();
  assert.equal(root.continuation.children.some(edge => edge.branchId === 'b2'), false,
    'the packaged parent edge is hidden when its saved child record has unrelated ancestry');
  const cookie = (await fetch(`${base}/health`)).headers.get('set-cookie')?.split(';')[0];
  const response = await fetch(`${base}/api/continue`, { method: 'POST',
    headers: { 'x-demo-access-code': 'local-replay-code', 'content-type': 'application/json', cookie },
    body: JSON.stringify({ runId: 'beringia', branchId: 'b2' }),
  });
  assert.equal(response.status, 503, 'the unrelated live child is not replayed for the packaged parent edge');
});

test('a packaged descendant can be extended into the writable root with its saved ancestry intact', async t => {
  const outputRoot = await mkdtemp(join(tmpdir(), 'office-replay-extension-'));
  const liveRunsDir = join(outputRoot, 'live-output');
  const webDir = join(outputRoot, 'web');
  await Promise.all([mkdir(liveRunsDir), mkdir(webDir)]);
  const parentId = chain[0][0];
  const packagedRecordPath = new URL(`../demo/replay-history/.continuation/runs/${parentId}.json`, import.meta.url);
  const packagedBefore = await readFile(packagedRecordPath);
  const contexts = [];
  const runner = async args => {
    contexts.push(args);
    const branch = { status: 'ok', divergence: args.divergence, branches: [], hero: { title: 'Local continuation' } };
    await mkdir(join(liveRunsDir, args.runId), { recursive: true });
    await writeFile(join(liveRunsDir, args.runId, 'branch.json'), JSON.stringify(branch));
    return { runId: args.runId, branch, trace: [], costUsd: 0 };
  };
  runner.enforcesDailyCap = true;
  const server = createDemoServer({ liveRunsDir, webDir, runsDir: join(outputRoot, 'empty-cache'), runPipeline: runner, rateLimit: 100, env: { DEMO_ACCESS_CODE: 'local-code' } });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(async () => {
    await new Promise((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
    await rm(outputRoot, { recursive: true, force: true });
  });
  const base = `http://127.0.0.1:${server.address().port}`;
  const health = await fetch(`${base}/health`);
  const cookie = health.headers.get('set-cookie')?.split(';')[0];
  assert.ok(cookie);
  const response = await fetch(`${base}/api/continue`, {
    method: 'POST',
    headers: { 'x-demo-access-code': 'local-code', 'content-type': 'application/json', cookie },
    body: JSON.stringify({ runId: parentId, branchId: 'b2' }),
  });
  assert.equal(response.status, 200);
  assert.match(await response.text(), /event: complete/);
  assert.equal(contexts.length, 1);
  assert.equal(contexts[0].continuation.path.length, 2, 'the new run inherits the packaged parent ancestry');
  assert.equal(contexts[0].continuation.path[0].runId, 'beringia');
  assert.equal(contexts[0].continuation.path[1].runId, parentId);
  const materializedParent = createContinuationStore(liveRunsDir).get(parentId);
  assert.equal(materializedParent.status, 'complete', 'only the writable root receives a parent registry record');
  assert.equal(materializedParent.continuation.path.length, 1, 'materializing the parent preserves its packaged ancestry for sibling branches');
  assert.deepEqual(await readFile(packagedRecordPath), packagedBefore, 'the packaged parent record remains unchanged');
});

test('a completed packaged child edge is replayed from its saved record without generation', async t => {
  const { base } = await startReplay(t);
  const health = await fetch(`${base}/health`);
  const cookie = health.headers.get('set-cookie')?.split(';')[0];
  const response = await fetch(`${base}/api/continue`, {
    method: 'POST',
    headers: { 'x-demo-access-code': 'local-replay-code', 'content-type': 'application/json', cookie },
    body: JSON.stringify({ runId: 'beringia', branchId: 'b2' }),
  });
  assert.equal(response.status, 200);
  const body = await response.text();
  assert.match(body, /event: complete/);
  const completion = JSON.parse(body.match(/event: complete\ndata: (.+)/)?.[1] ?? '{}');
  assert.equal(completion.runId, chain[0][0]);
  assert.equal(completion.reused, true);
});

test('a packaged parent can be used as the source for an authored current-world question', async t => {
  const { base } = await startReplay(t);
  const cookie = (await fetch(`${base}/health`)).headers.get('set-cookie')?.split(';')[0];
  const response = await fetch(`${base}/api/run`, {
    method: 'POST',
    headers: { 'x-demo-access-code': 'local-replay-code', 'content-type': 'application/json', cookie },
    body: JSON.stringify({
      divergence: 'A public archive shares astronomy observations.',
      attachment: { mode: 'current-world', parentRunId: chain[0][0], parentBranchId: 'b2' },
    }),
  });
  assert.equal(response.status, 503, 'the attachment validates against packaged ancestry before replay-only mode blocks generation');
});

test('replay-only import setup never writes to a live root that is also its package root', async t => {
  const { base, liveRunsDir } = await startReplay(t, { packageRootIsLiveRoot: true });
  await fetch(`${base}/health`);
  assert.equal(createContinuationStore(liveRunsDir).get('beringia'), null, 'the root fixture was not imported into its own package');
});

test('a writable subdirectory under the packaged root is rejected before creating files', async t => {
  const { base, liveRunsDir } = await startReplay(t, { packageRootIsLiveRoot: true });
  const nestedLiveRoot = join(liveRunsDir, 'nested-runtime');
  const server = createDemoServer({ runsDir: join(liveRunsDir, 'cache'), liveRunsDir: nestedLiveRoot, packagedReplayRoot: liveRunsDir,
    webDir: join(liveRunsDir, 'web-nested'), importRunIds: ['beringia'], env: { DEMO_ACCESS_CODE: 'local-code' } });
  await mkdir(join(liveRunsDir, 'web-nested'));
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(async () => new Promise((resolve, reject) => server.close(error => error ? reject(error) : resolve())));
  const nestedBase = `http://127.0.0.1:${server.address().port}`;
  await fetch(`${nestedBase}/health`);
  assert.equal(createContinuationStore(liveRunsDir).get('beringia'), null, 'nested package imports are skipped');
  const response = await fetch(`${nestedBase}/api/run`, { method: 'POST',
    headers: { 'x-demo-access-code': 'local-code', 'content-type': 'application/json' },
    body: JSON.stringify({ divergence: 'A public archive shares astronomy observations.' }),
  });
  assert.equal(response.status, 503);
  assert.equal(await readdir(nestedLiveRoot).then(() => true, () => false), false, 'the nested writable directory was never created');
});

test('a symlinked writable subdirectory under the packaged root is also rejected', async t => {
  const { liveRunsDir } = await startReplay(t, { packageRootIsLiveRoot: true });
  const alias = join(liveRunsDir, '..', 'package-alias');
  try { await symlink(liveRunsDir, alias, process.platform === 'win32' ? 'junction' : 'dir'); }
  catch (error) {
    if (['EPERM', 'EACCES', 'ENOTSUP'].includes(error.code)) return t.skip(`directory symlinks are unavailable: ${error.code}`);
    throw error;
  }
  const nestedLiveRoot = join(alias, 'nested-runtime');
  const webDir = join(liveRunsDir, '..', 'web-symlink');
  await mkdir(webDir);
  const server = createDemoServer({ runsDir: join(liveRunsDir, 'cache'), liveRunsDir: nestedLiveRoot, packagedReplayRoot: liveRunsDir,
    webDir, importRunIds: ['beringia'], env: { DEMO_ACCESS_CODE: 'local-code' } });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(async () => new Promise((resolve, reject) => server.close(error => error ? reject(error) : resolve())));
  const base = `http://127.0.0.1:${server.address().port}`;
  await fetch(`${base}/health`);
  assert.equal(createContinuationStore(liveRunsDir).get('beringia'), null);
  const response = await fetch(`${base}/api/run`, { method: 'POST',
    headers: { 'x-demo-access-code': 'local-code', 'content-type': 'application/json' },
    body: JSON.stringify({ divergence: 'A public archive shares astronomy observations.' }),
  });
  assert.equal(response.status, 503);
  assert.equal(await readdir(nestedLiveRoot).then(() => true, () => false), false, 'the symlinked nested root was never created');
});

test('canonical path aliases cannot make the packaged root a writable target', async t => {
  const baseDir = await mkdtemp(join(tmpdir(), 'office-replay-alias-'));
  const packageRoot = join(baseDir, 'package');
  const aliasRoot = join(baseDir, 'live-alias');
  const webDir = join(baseDir, 'web');
  await cp(new URL('../demo/replay-history', import.meta.url), packageRoot, { recursive: true, filter: source => !source.endsWith('.expansion-sessions.json') });
  await mkdir(webDir);
  try { await symlink(packageRoot, aliasRoot, process.platform === 'win32' ? 'junction' : 'dir'); }
  catch (error) {
    await rm(baseDir, { recursive: true, force: true });
    if (['EPERM', 'EACCES', 'ENOTSUP'].includes(error.code)) return t.skip(`directory symlinks are unavailable: ${error.code}`);
    throw error;
  }
  const server = createDemoServer({ runsDir: join(baseDir, 'cache'), liveRunsDir: aliasRoot, packagedReplayRoot: packageRoot,
    webDir, importRunIds: ['beringia'], env: { DEMO_ACCESS_CODE: 'local-code' } });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(async () => {
    await new Promise((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
    await rm(baseDir, { recursive: true, force: true });
  });
  const base = `http://127.0.0.1:${server.address().port}`;
  assert.equal((await fetch(`${base}/health`)).status, 200);
  assert.equal(createContinuationStore(packageRoot).get('beringia'), null, 'realpath-equal roots skip imports');
  const response = await fetch(`${base}/api/run`, { method: 'POST',
    headers: { 'x-demo-access-code': 'local-code', 'content-type': 'application/json' },
    body: JSON.stringify({ divergence: 'A public archive shares astronomy observations.' }),
  });
  assert.equal(response.status, 503, 'writes stay disabled through a path alias to packaged data');
  assert.equal(createContinuationStore(packageRoot).get('beringia'), null);
});

test('clean replay default serves the recorded Beringia path and saved alternative without generation', async t => {
  const { base } = await startReplay(t);
  const health = await (await fetch(`${base}/health`)).json();
  assert.equal(health.metaKeyConfigured, false);
  assert.equal('replayOnly' in health, false);

  let manifest = await (await fetch(`${base}/runs/beringia`)).json();
  assert.equal(manifest.divergence, 'What if the Bering land bridge never flooded?');
  assert.ok(manifest.continuation.children.some(edge => edge.branchId === 'b2' && edge.runId === chain[0][0] && edge.status === 'complete'));

  for (let index = 0; index < chain.length; index++) {
    const [runId, heroBranchId, heroYear] = chain[index];
    const response = await fetch(`${base}/runs/${runId}`);
    assert.equal(response.status, 200, `saved run ${runId} is reachable`);
    manifest = await response.json();
    const hero = manifest.branch.branches.find(branch => branch.id === heroBranchId);
    assert.equal(hero?.year, heroYear);
    assert.equal(manifest.branch.hero.branchId, heroBranchId);
    assert.equal(manifest.continuation.path.length, index + 1);
    assert.ok(manifest.assets.includes('hero.png'));
    assert.equal(manifest.assets.includes('model.glb') || manifest.assets.includes('model.meshopt.glb'), false);
    if (index < chain.length - 1) {
      const nextId = chain[index + 1][0];
      assert.ok(manifest.continuation.children.some(edge => edge.runId === nextId && edge.status === 'complete'));
    }
  }

  const alternative = await (await fetch(`${base}/runs/${chain[0][0]}/branch.json`)).json();
  assert.equal(alternative.branches.find(branch => branch.id === 'b1')?.year, 1080);
  assert.equal(Object.hasOwn(alternative.hero, 'imagePrompt'), false);
  assert.equal(Object.hasOwn(alternative, 'rejected'), false);
  const packageRecord = JSON.parse(await readFile(new URL('../demo/replay-history/PACKAGE.json', import.meta.url), 'utf8'));
  const scene = packageRecord.completedEventScenes.find(item => item.runId === chain[0][0] && item.branchId === 'b1');
  assert.ok(scene, 'the saved 1080 alternative scene is packaged');
  const sceneResponse = await fetch(`${base}/event-scenes/${scene.contentAddress}.png`);
  assert.equal(sceneResponse.status, 200);
  assert.equal(sceneResponse.headers.get('content-type'), 'image/png');
  assert.ok((await sceneResponse.arrayBuffer()).byteLength > 8);
  for (const savedScene of packageRecord.completedEventScenes) {
    const response = await fetch(`${base}/event-scenes/${savedScene.contentAddress}.png`, { method: 'HEAD' });
    assert.equal(response.status, 200, `${savedScene.runId}/${savedScene.branchId} has its saved scene`);
  }

  const cutoutPackage = packageRecord.completedEventCutouts.find(item => item.runId === chain[1][0] && item.branchId === 'b4' && item.year === 1645);
  assert.ok(cutoutPackage, 'the exact saved Great Slave nonhero cutout is packaged');
  const cutoutLookup = await fetch(`${base}/api/event-cutout?runId=${cutoutPackage.runId}&branchId=${cutoutPackage.branchId}`);
  const cutoutAvailability = await cutoutLookup.json();
  assert.equal(cutoutLookup.status, 200);
  assert.equal(cutoutAvailability.status, 'complete');
  assert.equal(cutoutAvailability.reused, true);
  const cutoutImage = await fetch(`${base}${cutoutAvailability.url}`);
  assert.equal(cutoutImage.status, 200);
  assert.equal(cutoutImage.headers.get('content-type'), 'image/png');
  const cutoutBytes = Buffer.from(await cutoutImage.arrayBuffer());
  assert.ok(cutoutBytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])));

  const blocked = await fetch(`${base}/api/run`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ divergence: 'What if?' }) });
  assert.equal(blocked.status, 403, 'an unauthenticated caller still needs local browser authorization or an access code');
});

test('packaged manifest source and output hashes are well-formed', async () => {
  const packageRecord = JSON.parse(await readFile(new URL('../demo/replay-history/PACKAGE.json', import.meta.url), 'utf8'));
  assert.deepEqual(packageRecord.path.map(item => item.year), [900, 1380, 1472, 1538]);
  assert.equal(packageRecord.alternative.year, 1080);
  assert.equal(packageRecord.continuationEdges.length, 4);
  assert.equal(packageRecord.completedEventCutouts.length, 1);
  assert.ok(packageRecord.packagedContinuationRuns.includes('cc1b3038-9c20-44d3-83e0-1045c6392d8e'));
  assert.equal(packageRecord.additionalReplays.find(item => item.runId === '04f9af4a-f4ee-48da-b8d6-85e73373452a')?.deepLink, '/#run=04f9af4a-f4ee-48da-b8d6-85e73373452a');
  assert.ok(packageRecord.origins.length >= 10);
  for (const item of packageRecord.outputHashes) assert.match(item.sha256, /^[a-f0-9]{64}$/);
  const branchBytes = await readFile(new URL('../demo/replay-history/df5e6d97-9f0d-49a0-bb62-ad52c3ae6d09/branch.json', import.meta.url));
  assert.equal(createHash('sha256').update(branchBytes).digest('hex'), packageRecord.outputHashes.find(item => item.path.endsWith('df5e6d97-9f0d-49a0-bb62-ad52c3ae6d09/branch.json')).sha256);
});

test('clean replay exposes the saved Lichen follow-up and direct Ram Setu root', async t => {
  const { base } = await startReplay(t);
  const lichenRunId = 'cc1b3038-9c20-44d3-83e0-1045c6392d8e';
  const ramRunId = '04f9af4a-f4ee-48da-b8d6-85e73373452a';
  const packageRecord = JSON.parse(await readFile(new URL('../demo/replay-history/PACKAGE.json', import.meta.url), 'utf8'));

  const lichenParent = await (await fetch(`${base}/runs/df5e6d97-9f0d-49a0-bb62-ad52c3ae6d09`)).json();
  assert.ok(lichenParent.continuation.children.some(edge => edge.branchId === 'b1' && edge.runId === lichenRunId && edge.status === 'complete'));
  const lichen = await (await fetch(`${base}/runs/${lichenRunId}`)).json();
  assert.deepEqual(lichen.continuation.path.map(event => event.year), [900, 1080]);
  assert.equal(lichen.branch.hero.branchId, 'b1');
  assert.equal(lichen.branch.branches.length, 3);
  assert.deepEqual(lichen.branch.branches.map(branch => branch.year), [1150, 1310, 1380]);
  assert.ok(lichen.assets.includes('hero.png'));
  const childScenes = packageRecord.completedEventScenes.filter(item => item.runId === lichenRunId);
  assert.deepEqual(childScenes.map(item => item.branchId), [], 'there are no saved event-scene store entries for these immediate consequences');
  const lichenHero = await fetch(`${base}/runs/${lichenRunId}/hero.png`);
  assert.equal(lichenHero.status, 200);
  assert.equal(lichenHero.headers.get('content-type'), 'image/png');

  const ramResponse = await fetch(`${base}/runs/${ramRunId}`);
  assert.equal(ramResponse.status, 200, 'the standalone root registry supports its direct deep link');
  const ram = await ramResponse.json();
  assert.equal(ram.id, ramRunId);
  assert.equal(ram.continuation.rootRunId, ramRunId);
  assert.equal(ram.branch.hero.branchId, 'b4');
  assert.equal(ram.branch.branches.find(branch => branch.id === 'b4')?.year, 1250);
  const uncertainty = ram.branch.branches.find(branch => branch.id === 'b4')?.geography?.changes?.[0]?.uncertainty;
  assert.match(uncertainty, /remain uncertain/);
  assert.ok(ram.assets.includes('hero.png'));
  assert.equal(ram.hasModel, false);
  assert.equal(Object.hasOwn(ram.branch.hero, 'imagePrompt'), false);
  const ramHero = await fetch(`${base}/runs/${ramRunId}/hero.png`);
  assert.equal(ramHero.status, 200);
  assert.equal(ramHero.headers.get('content-type'), 'image/png');
});
