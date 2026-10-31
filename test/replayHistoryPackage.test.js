import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { createConfiguredDemoServer } from '../server/index.js';

const chain = [
  ['df5e6d97-9f0d-49a0-bb62-ad52c3ae6d09', 'b3', 1380],
  ['c892b8d0-36c5-4eeb-a70b-022041a25c98', 'b1', 1472],
  ['1fc70744-d82b-4364-8b78-c79544a4f7d6', 'b1', 1538],
];

async function startReplay(t) {
  const { server, replayOnly } = createConfiguredDemoServer({
    env: { DEMO_3D_ENABLED: 'false', HOST: '127.0.0.1', PORT: '0' },
  });
  assert.equal(replayOnly, true);
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise((resolve, reject) => server.close(error => error ? reject(error) : resolve())));
  return `http://127.0.0.1:${server.address().port}`;
}

test('clean replay default serves the recorded Beringia path and saved alternative without generation', async t => {
  const base = await startReplay(t);
  const health = await (await fetch(`${base}/health`)).json();
  assert.equal(health.replayOnly, true);

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
  assert.equal(blocked.status, 503);
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
  const base = await startReplay(t);
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
