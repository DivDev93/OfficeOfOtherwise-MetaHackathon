import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, readFile, readdir, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { PNG } from 'pngjs';
import { cacheDemo, CURATED } from '../scripts/cache-demo.js';
async function fixture(root,item,{model=true,confidence=.9,secret=false}={}) {
  const dir=join(root,item.id+'-source'); await mkdir(dir,{recursive:true});
  const branch={status:'ok',divergence:item.divergence,branches:[{id:'b1',title:'A new observatory',year:500,place:{name:'Alexandria',lat:31,lon:29},summary:'Astronomers explore the sky.',scene:'A bronze orrery.'}],hero:{branchId:'b1',imagePrompt:secret?'https://private.invalid':'A bronze orrery',subject:'orrery'},trace:[],privateUrl:'https://private.invalid'};
  const trace={steps:[{step:'image',model:'muse-image-1.0',ms:3,costUsd:.01,rawResponse:'secret'},{step:'3d',model:'Tattva TRELLIS',ms:5,costUsd:0}],selection:{confidence,area:1},source:'private-location',costUsd:.01};
  await writeFile(join(dir,'branch.json'),JSON.stringify(branch)); await writeFile(join(dir,'trace.json'),JSON.stringify(trace));
  const png=PNG.sync.write(new PNG({width:1,height:1})); for(const name of ['hero.png','mask.png','cutout.png']) await writeFile(join(dir,name),png);
  if(model){const glb=Buffer.alloc(20);glb.write('glTF');glb.writeUInt32LE(2,4);glb.writeUInt32LE(20,8);await writeFile(join(dir,'model.glb'),glb);}
  return dir;
}
test('reuses orrery without a runner and publishes sanitized display artifacts',async()=>{
 const dir=await mkdtemp(join(tmpdir(),'cache-demo-')); try {const source=await fixture(dir,CURATED[0]); const root=join(dir,'runs');let calls=0;
 const result=await cacheDemo({outputRoot:root,orrerySource:source,run:async()=>{calls++;throw new Error('offline');}});
 assert.deepEqual(result.published,['alexandria']); assert.equal(calls,3);
 const json=await readFile(join(root,'alexandria','branch.json'),'utf8');const trace=await readFile(join(root,'alexandria','trace.json'),'utf8');
 assert.doesNotMatch(json,/private\.invalid/);assert.doesNotMatch(trace,/private-location|rawResponse|secret/);assert.equal((await readdir(join(root,'alexandria'))).length,6);
 } finally{await rm(dir,{recursive:true,force:true});}
});
test('incomplete, unsafe and over-cap outputs never publish partial directories',async()=>{
 const dir=await mkdtemp(join(tmpdir(),'cache-demo-')); try {const root=join(dir,'runs');const incomplete=await fixture(dir,CURATED[0],{model:false});let result=await cacheDemo({outputRoot:root,orrerySource:incomplete});assert.ok(result.errors.some(e=>e.id==='alexandria'));assert.deepEqual(await readdir(root),[]);
 const unsafe=await fixture(dir,CURATED[0],{secret:true});result=await cacheDemo({outputRoot:root,orrerySource:unsafe});assert.match(result.errors[0].error,/Unsafe/);assert.deepEqual(await readdir(root),[]);
 const good=await fixture(dir,CURATED[0]);result=await cacheDemo({outputRoot:root,orrerySource:good,maxBytes:10});assert.match(result.errors[0].error,/cap/);assert.deepEqual(await readdir(root),[]);assert.ok(!(await readdir(dir)).some(n=>n.startsWith('.cache-stage-')));
 }finally{await rm(dir,{recursive:true,force:true});}
});
test('low confidence requires an explicit retry and only one retry is requested',async()=>{
 const dir=await mkdtemp(join(tmpdir(),'cache-demo-'));try {const root=join(dir,'runs'); const low=await fixture(dir,CURATED[1],{confidence:.3});let calls=[];
 const good=await fixture(join(dir,'retry'),CURATED[1]); const run=async opts=>{calls.push(opts);if(opts.divergence!==CURATED[1].divergence) throw new Error('offline');return {directory:opts.subjectOverride ? good : low};};
 let result=await cacheDemo({outputRoot:root,run});assert.ok(result.skipped.some(x=>x.id==='beringia' && /confidence/.test(x.reason)));assert.equal(calls.filter(x=>x.divergence===CURATED[1].divergence).length,1);
 calls=[];result=await cacheDemo({outputRoot:root,run,retrySubject:{beringia:'orrery'}});assert.ok(result.published.includes('beringia'));const attempts=calls.filter(x=>x.divergence===CURATED[1].divergence);assert.equal(attempts.length,2);assert.equal(attempts[1].subjectOverride,'orrery');assert.match(attempts[1].from,/branch\.json$/);
 }finally{await rm(dir,{recursive:true,force:true});}
});
test('rejects prohibited blocked prompt and never invents a guardrail receipt',async()=>{
 const dir=await mkdtemp(join(tmpdir(),'cache-demo-'));try {await assert.rejects(cacheDemo({outputRoot:join(dir,'runs'),blockedPrompt:'What if a war began?'}),/prohibited/);const result=await cacheDemo({outputRoot:join(dir,'runs')});assert.ok(result.skipped.some(x=>x.id==='guardrail'));}finally{await rm(dir,{recursive:true,force:true});}
});

test('live CLI requires credentials and delegates task cap to the checkpoint', async () => {
 const dir=await mkdtemp(join(tmpdir(),'cache-demo-')); try {
  const script=fileURLToPath(new URL('../scripts/cache-demo.js',import.meta.url));
  const env={...process.env, CHRONOS_3D_CAPABILITY_CONFIRMED:'true', CHRONOS_API_BASE:'https://example.invalid',CHRONOS_API_TOKEN:'fixture-token',META_API_KEY:'fixture-key',META_SPEND_CAP_USD:'100'};
  const missing=spawnSync(process.execPath,[script,'--live'],{cwd:dir,env:{...env,CHRONOS_API_TOKEN:''},encoding:'utf8'});
  assert.equal(missing.status,1);assert.match(missing.stderr,/requires confirmed TRELLIS configuration and Meta credentials/);assert.doesNotMatch(missing.stderr,/fixture-key/);
  const checkpoint=spawnSync(process.execPath,[script,'--live'],{cwd:dir,env,encoding:'utf8'});
  assert.equal(checkpoint.status,1);assert.match(checkpoint.stdout,/Complete Alexandria 3D cache required/);assert.doesNotMatch(checkpoint.stdout,/fixture-token|fixture-key/);
 } finally {await rm(dir,{recursive:true,force:true});}
});

test('requires successful 3D provenance and hides unsafe errors', async()=>{
 const dir=await mkdtemp(join(tmpdir(),'cache-demo-')); try {
  const source=await fixture(dir,CURATED[0]); const path=join(source,'trace.json'); const trace=JSON.parse(await readFile(path,'utf8')); trace.steps=trace.steps.filter(x=>x.step!=='3d'); await writeFile(path,JSON.stringify(trace));
  const result=await cacheDemo({outputRoot:join(dir,'runs'),orrerySource:source,run:async()=>{throw new Error('Bearer supersecretfixture123456 https://private.invalid');}});
  assert.match(result.errors.find(x=>x.id==='alexandria').error,/3D trace/); assert.doesNotMatch(JSON.stringify(result),/supersecret|private\.invalid/);
 } finally {await rm(dir,{recursive:true,force:true});}
});

test('retry is conditional and a low confidence retry is rejected',async()=>{
 const dir=await mkdtemp(join(tmpdir(),'cache-demo-')); try {
  const good=await fixture(join(dir,'good'),CURATED[1]); const low=await fixture(join(dir,'low'),CURATED[1],{confidence:.2}); let calls=0;
  let result=await cacheDemo({outputRoot:join(dir,'one'),retrySubject:{beringia:'object'},run:async o=>{if(o.divergence!==CURATED[1].divergence) throw Error('offline');calls++;return {directory:good};}});
  assert.equal(calls,1); assert.ok(result.published.includes('beringia')); calls=0;
  result=await cacheDemo({outputRoot:join(dir,'two'),retrySubject:{beringia:'object'},run:async o=>{if(o.divergence!==CURATED[1].divergence) throw Error('offline');calls++;return {directory:low};}});
  assert.equal(calls,2); assert.match(result.errors.find(x=>x.id==='beringia').error,/sufficient mask confidence/);
  calls=0; result=await cacheDemo({outputRoot:join(dir,'three'),retrySubject:{beringia:'object'},visiblyBroken:['beringia'],run:async o=>{if(o.divergence!==CURATED[1].divergence) throw Error('offline');calls++;return {directory:good};}}); assert.equal(calls,2); assert.ok(result.published.includes('beringia'));
 } finally {await rm(dir,{recursive:true,force:true});}
});

test('provisional Alexandria is explicitly labelled and upgrades only with valid 3D',async()=>{
 const dir=await mkdtemp(join(tmpdir(),'cache-demo-')); try {
  const source=await fixture(dir,CURATED[0],{model:false}); const tracePath=join(source,'trace.json'); const sourceTrace=JSON.parse(await readFile(tracePath,'utf8')); sourceTrace.steps=sourceTrace.steps.filter(x=>x.step!=='3d'); await writeFile(tracePath,JSON.stringify(sourceTrace)); const root=join(dir,'runs');
  let result=await cacheDemo({outputRoot:root,orrerySource:source,provisional2d:true}); assert.deepEqual(result.published,['alexandria']);
  const dest=join(root,'alexandria'); const manifest=JSON.parse(await readFile(join(dest,'manifest.json'),'utf8')); assert.deepEqual(manifest,{status:'provisional',reason:'3D model not generated'});
  assert.equal(JSON.parse(await readFile(join(dest,'branch.json'),'utf8')).status,'ok'); assert.ok(!(await readdir(dest)).includes('model.glb'));
  result=await cacheDemo({outputRoot:root,orrerySource:source,provisional2d:true}); assert.ok(result.skipped.some(x=>x.id==='alexandria'));
  const glb=Buffer.alloc(20); glb.write('glTF'); glb.writeUInt32LE(2,4); glb.writeUInt32LE(20,8); await writeFile(join(source,'model.glb'),glb); sourceTrace.steps.push({step:'3d',model:'Tattva TRELLIS',ms:5,costUsd:0}); await writeFile(tracePath,JSON.stringify(sourceTrace));
  result=await cacheDemo({outputRoot:root,orrerySource:source,maxBytes:10}); assert.ok(result.errors.some(x=>x.id==='alexandria')); assert.deepEqual(JSON.parse(await readFile(join(dest,'manifest.json'),'utf8')),manifest);
  result=await cacheDemo({outputRoot:root,orrerySource:source}); assert.ok(result.published.includes('alexandria')); assert.ok((await readdir(dest)).includes('model.glb')); assert.ok(!(await readdir(dest)).includes('manifest.json'));
  result=await cacheDemo({outputRoot:root,orrerySource:source}); assert.ok(result.skipped.some(x=>x.id==='alexandria' && x.reason==='Already cached'));
  assert.ok(!(await readdir(dir)).some(n=>n.startsWith('.cache-stage-') || n.startsWith('.cache-backup-')));
 } finally {await rm(dir,{recursive:true,force:true});}
});

test('live order refuses paid runs without complete Alexandria and stops after a failure',async()=>{
 const dir=await mkdtemp(join(tmpdir(),'cache-demo-')); try {
  let calls=0; const runner=async()=>{calls++;throw Error('offline');};
  let result=await cacheDemo({outputRoot:join(dir,'missing'),run:runner,enforceLiveOrder:true}); assert.equal(calls,0); assert.ok(result.errors.some(x=>x.id==='alexandria'));
  const source=await fixture(join(dir,'provisional'),CURATED[0],{model:false}); const tracePath=join(source,'trace.json'); const trace=JSON.parse(await readFile(tracePath,'utf8')); trace.steps=trace.steps.filter(x=>x.step!=='3d'); await writeFile(tracePath,JSON.stringify(trace));
  result=await cacheDemo({outputRoot:join(dir,'partial'),orrerySource:source,provisional2d:true,run:runner,enforceLiveOrder:true}); assert.equal(calls,0); assert.ok(result.errors.some(x=>x.id==='alexandria'));
  const good=await fixture(join(dir,'complete'),CURATED[0]); result=await cacheDemo({outputRoot:join(dir,'ready'),orrerySource:good,run:runner,enforceLiveOrder:true}); assert.equal(calls,1); assert.ok(result.errors.some(x=>x.id==='beringia')); assert.ok(result.skipped.some(x=>x.id==='green-sahara' && /stopped/.test(x.reason)));
 } finally {await rm(dir,{recursive:true,force:true});}
});

test('live order continues after a topic-policy blocked curated prompt',async()=>{
 const dir=await mkdtemp(join(tmpdir(),'cache-demo-')); try {
  const good=await fixture(join(dir,'complete'),CURATED[0]); const blocked=join(dir,'blocked'); await mkdir(blocked); await writeFile(join(blocked,'branch.json'),JSON.stringify({status:'blocked',divergence:CURATED[1].divergence,branches:[]})); await writeFile(join(blocked,'trace.json'),JSON.stringify({steps:[]})); let calls=0;
  const result=await cacheDemo({outputRoot:join(dir,'runs'),orrerySource:good,enforceLiveOrder:true,run:async()=>{calls++;if(calls===1)return {directory:blocked};throw Error('offline');}});
  assert.equal(calls,2); assert.ok(result.skipped.some(x=>x.id==='beringia' && /blocked/.test(x.reason))); assert.ok(result.errors.some(x=>x.id==='green-sahara'));
 } finally {await rm(dir,{recursive:true,force:true});}
});
