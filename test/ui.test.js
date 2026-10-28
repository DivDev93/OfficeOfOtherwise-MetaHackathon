import test from 'node:test';
import assert from 'node:assert/strict';
import { retryPrompt, formatYear, provenance, parseSseBlock, availableView, completionStatus, cachedRetryRun, replayLabel } from '../web/logic.js';
test('guardrail retry extracts a complete suggested question', () => { assert.equal(retryPrompt('Try “What if the Sahara had stayed green?”'), 'What if the Sahara had stayed green?'); assert.equal(retryPrompt('No suggestion'), ''); });
test('SSE parser handles named events and line endings', () => { assert.deepEqual(parseSseBlock('event: propose\r\ndata: {"branches":[]}'), {event:'propose',data:{branches:[]}}); });
test('provenance excludes summary duplicates and reports actual measured costs', () => { const p=provenance([{step:'branch-agent:propose',ms:1000,costUsd:.02},{step:'propose',ms:1000,costUsd:0,summary:true}]); assert.equal(p[1].ms,1000); assert.equal(p[1].costUsd,.02); assert.equal(p[2].available,false); assert.equal(formatYear(-50),'50 BCE'); });

test('unavailable views fall back to available content', () => {
 assert.equal(availableView('model',{image:true,cutout:true,model:false}),'scene');
 assert.equal(availableView('cutout',{image:true,cutout:true}),'cutout');
 assert.equal(availableView('model',{image:true,model:true}),'model');
});
test('completion preserves blocked and empty outcomes', () => {
 assert.match(completionStatus({status:'blocked'}),/reframe/);
 assert.match(completionStatus({status:'empty'}),/No suitable/);
 assert.equal(completionStatus({status:'ok'}),'Story complete');
});

test('guardrail retry finds an exact matching usable cached story', () => {
 const runs=[{id:'guard',status:'simulated',divergence:'What if A?'},{id:'a',status:'provisional',divergence:'What if A?'},{id:'b',status:'ok',divergence:'What if B?'}];
 assert.equal(cachedRetryRun(runs,'What if A?').id,'a');
 assert.equal(cachedRetryRun(runs,'what if A?'),null);
 assert.equal(cachedRetryRun(runs,'What if C?'),null);
 assert.match(replayLabel(runs[0]),/Simulated guardrail/);
 assert.match(replayLabel(runs[1]),/2D preview/);
});

test('offline 3D provenance identifies pre-generation and unknown cost and duration', () => {
 const item=provenance([{step:'3d',source:'gen3d-offline',ms:null,costUsd:null}])[5];
 assert.equal(item.model,'Tattva TRELLIS (existing infrastructure, pre-generated)');
 assert.equal(item.ms,null); assert.equal(item.costUsd,null);
 assert.equal(provenance([{step:'chronos',ms:20,costUsd:0}])[5].model,'Tattva TRELLIS (existing infrastructure)');
});
