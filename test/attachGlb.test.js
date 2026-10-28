import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, readFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { attachGlb } from '../scripts/attach-glb.js';

async function fixture(t, status = 'provisional') {
  const base = await mkdtemp(join(tmpdir(), 'attach-glb-')); t.after(() => rm(base, { recursive:true, force:true }));
  const root = join(base, 'runs'), run = join(root, 'demo'); await mkdir(run, {recursive:true});
  const manifest = {status, reason:'3D model not generated'};
  await writeFile(join(run, 'manifest.json'), JSON.stringify(manifest));
  await writeFile(join(run, 'branch.json'), JSON.stringify({status:'ok'}));
  await writeFile(join(run, 'trace.json'), JSON.stringify({steps:[{step:'image',costUsd:0.1}], history:['preserved']}));
  const json = Buffer.from(JSON.stringify({ asset: { version: '2.0' }, scene: 0, scenes: [{ nodes: [] }] }));
  const paddedLength = Math.ceil(json.length / 4) * 4;
  const glb = Buffer.alloc(20 + paddedLength, 0x20);
  glb.write('glTF'); glb.writeUInt32LE(2,4); glb.writeUInt32LE(glb.length,8);
  glb.writeUInt32LE(paddedLength,12); glb.writeUInt32LE(0x4e4f534a,16); json.copy(glb,20);
  const source = join(base, 'input.glb'); await writeFile(source, glb);
  return {root, run, source, glb};
}
test('attaches a pre-generated model and retains trace data', async t => {
 const f = await fixture(t); await attachGlb({slug:'demo',glbPath:f.source,outputRoot:f.root});
 assert.deepEqual(await readFile(join(f.run,'model.glb')),f.glb);
 const trace=JSON.parse(await readFile(join(f.run,'trace.json')));
 assert.deepEqual(trace.history,['preserved']); assert.deepEqual(trace.steps[1],{step:'3d',model:'Tattva TRELLIS (existing infrastructure)',provider:'trellis',ms:null,costUsd:null,source:'gen3d-offline'});
 assert.equal(JSON.parse(await readFile(join(f.run,'manifest.json'))).status,'complete');
 await assert.rejects(attachGlb({slug:'demo',glbPath:f.source,outputRoot:f.root}),/already exists/);
});
test('rejects invalid GLB, traversal, simulated run, and oversize cache without changes', async t => {
 const f=await fixture(t); const original=await readFile(join(f.run,'trace.json'));
 await assert.rejects(attachGlb({slug:'../demo',glbPath:f.source,outputRoot:f.root}),/slug/);
 await writeFile(f.source,Buffer.alloc(20)); await assert.rejects(attachGlb({slug:'demo',glbPath:f.source,outputRoot:f.root}),/Invalid GLB/);
 await writeFile(f.source,f.glb); await assert.rejects(attachGlb({slug:'demo',glbPath:f.source,outputRoot:f.root,maxBytes:1}),/size cap/);
 await writeFile(join(f.run,'manifest.json'),JSON.stringify({status:'simulated'})); await assert.rejects(attachGlb({slug:'demo',glbPath:f.source,outputRoot:f.root}),/provisional/);
 assert.deepEqual(await readFile(join(f.run,'trace.json')),original);
});
test('refuses to replace prior 3D provenance', async t => {
 const f=await fixture(t); await writeFile(join(f.run,'trace.json'),JSON.stringify({steps:[{step:'3d',model:'Chronos'}]}));
 await assert.rejects(attachGlb({slug:'demo',glbPath:f.source,outputRoot:f.root}),/provenance/);
});
