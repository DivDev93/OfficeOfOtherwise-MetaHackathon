import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, readFile, rm, readdir } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { repriceCachedRun } from '../scripts/reprice-cached-run.js';
const timestamp='1793139066427';
async function setup(dir) {
 const cache=join(dir,'cache'); await mkdir(cache); const trace={steps:[{step:'topic-policy',model:'muse-wonder-1.0',costUsd:.01},{step:'policy:prompt',model:'muse-wonder-1.0',costUsd:0,summary:true},{step:'image',model:'muse-image-1.0',costUsd:.02}],costUsd:.03};
 const entry={label:'topic-policy',model:'muse-wonder-1.0',usd:.01,at:new Date(Number(timestamp)+1000).toISOString(),usage:{input_tokens:100,input_tokens_details:{cached_tokens:20},output_tokens:200}};
 const ledger=join(dir,'ledger.json'); await writeFile(join(cache,'trace.json'),JSON.stringify(trace)); await writeFile(ledger,JSON.stringify({entries:[entry]})); return {cache,ledger,entry,trace};
}
test('reprices matched charges once and preserves original values',async()=>{
 const dir=await mkdtemp(join(tmpdir(),'reprice-')); try {const {cache,ledger}=await setup(dir); const originalLedger=await readFile(ledger,'utf8'); const result=await repriceCachedRun({cacheDirectory:cache,sourceTimestamp:timestamp,ledgerPath:ledger}); assert.equal(result.status,'repriced'); const t=JSON.parse(await readFile(join(cache,'trace.json'),'utf8')); assert.equal(t.steps[0].recordedCostUsd,.01); assert.ok(Math.abs(t.steps[0].costUsd-.004324)<1e-12); assert.ok(Math.abs(t.costUsd-.024324)<1e-12); assert.equal(t.recordedCostUsd,.03); assert.equal(t.steps[1].costUsd,0); assert.equal(t.pricingNote.sourceRunTimestamp,timestamp); assert.equal(await readFile(ledger,'utf8'),originalLedger); assert.equal((await repriceCachedRun({cacheDirectory:cache,sourceTimestamp:timestamp,ledgerPath:ledger})).status,'already-repriced'); assert.deepEqual(await readdir(cache),['trace.json']); } finally {await rm(dir,{recursive:true,force:true});}
});
test('missing, ambiguous and out-of-window matches leave trace unchanged',async()=>{
 for(const variant of ['missing','ambiguous','outside']) {const dir=await mkdtemp(join(tmpdir(),'reprice-')); try {const {cache,ledger,entry}=await setup(dir); const before=await readFile(join(cache,'trace.json'),'utf8'); if(variant==='outside') entry.at=new Date(Number(timestamp)+600001).toISOString(); await writeFile(ledger,JSON.stringify({entries:variant==='missing'?[]:variant==='ambiguous'?[entry,entry]:[entry]})); await assert.rejects(repriceCachedRun({cacheDirectory:cache,sourceTimestamp:timestamp,ledgerPath:ledger}),/Missing or ambiguous/); assert.equal(await readFile(join(cache,'trace.json'),'utf8'),before); } finally {await rm(dir,{recursive:true,force:true});}}
});
