import test from 'node:test';
import assert from 'node:assert/strict';
import { retryPrompt, formatYear, provenance, replayTraceGroups, parseSseBlock, availableView, completionStatus, cachedRetryRun, replayLabel, branchProgress, branchPhaseLabel, liveAccessMode, modelLoadProgress } from '../web/logic.js';
test('guardrail retry extracts a complete suggested question', () => { assert.equal(retryPrompt('Try “What if the Sahara had stayed green?”'), 'What if the Sahara had stayed green?'); assert.equal(retryPrompt('No suggestion'), ''); });
test('SSE parser handles named events and line endings', () => { assert.deepEqual(parseSseBlock('event: propose\r\ndata: {"branches":[]}'), {event:'propose',data:{branches:[]}}); });
test('provenance excludes summary duplicates and reports actual measured costs', () => { const p=provenance([{step:'branch-agent:propose',ms:1000,costUsd:.02},{step:'propose',ms:1000,costUsd:0,summary:true}]); assert.equal(p[1].ms,1000); assert.equal(p[1].costUsd,.02); assert.equal(p[2].available,false); assert.equal(formatYear(-50),'50 BCE'); });
test('saved replay provenance is revealed in policy-to-3D order without summary duplicates', () => {
 const records=[
  {step:'policy:prompt',model:'muse-wonder-1.0'},
  {step:'propose',model:'muse-wonder-1.0'},
  {step:'review',model:'muse-wonder-1.0'},
  {step:'image',model:'muse-image-1.0'},
  {step:'segment',model:'sam-3.1'},
  {step:'3d',model:'Meta SAM 3D Objects'},
  {step:'image',model:'muse-image-1.0',summary:true},
 ];
 assert.deepEqual(replayTraceGroups(records).map(group=>group.map(step=>step.step)),[
  ['policy:prompt'],['propose'],['review'],['image'],['segment'],['3d'],
 ]);
});
test('policy provenance follows measured models and retains historical Wonder attribution', () => {
 assert.equal(provenance([{step:'policy:prompt',model:'muse-spark-1.3',ms:10,costUsd:0}])[0].model,'Muse Spark 1.3');
 assert.equal(provenance([{step:'policy:prompt',model:'muse-wonder-1.0',ms:10,costUsd:0}])[0].model,'Muse Wonder 1.0');
 assert.equal(provenance([{step:'policy:prompt',model:'muse-wonder-1.0',summary:true}])[0].model,'Muse Spark 1.3');
 assert.equal(provenance([])[5].model,'Meta SAM 3D Objects');
});

test('3D model loading progress is bounded and readable with or without a content length', () => {
 assert.deepEqual(modelLoadProgress({loaded:1024*1024,total:4*1024*1024}),{value:25,label:'25% · 1.00 MB / 4.00 MB'});
 assert.deepEqual(modelLoadProgress({loaded:2*1024*1024}),{value:null,label:'2.00 MB downloaded'});
 assert.deepEqual(modelLoadProgress({loaded:9,total:10_000}),{value:0,label:'0% · 9 B / 0.01 MB'});
 assert.deepEqual(modelLoadProgress({}),{value:null,label:'Preparing 3D model…'});
});

test('unavailable views fall back to available content', () => {
 assert.equal(availableView('model',{image:true,cutout:true,model:false}),'scene');
 assert.equal(availableView('cutout',{image:true,cutout:true}),'cutout');
 assert.equal(availableView('cutout',{image:true,cutout:false,model:false}),'scene');
 assert.equal(availableView('model',{image:true,model:true}),'model');
});
test('completion preserves blocked and empty outcomes', () => {
 assert.match(completionStatus({status:'blocked'}),/reframe/);
 assert.match(completionStatus({status:'empty'}),/No suitable/);
 assert.equal(completionStatus({status:'ok'}),'Story complete');
 assert.equal(completionStatus({status:'ok',renderStatus:'2d-only',renderReason:'no-segmentation-mask'}),'2D scene only · no SAM cutout available');
});
test('health response selects replay-only/live mode and fails closed when unavailable or malformed', () => {
 assert.equal(liveAccessMode({status:'ok',replayOnly:true}),'replay-only');
 assert.equal(liveAccessMode({status:'ok',replayOnly:false}),'live-enabled');
 assert.equal(liveAccessMode(null),'unknown');
 assert.equal(liveAccessMode({status:'error',replayOnly:false}),'unknown');
 assert.equal(liveAccessMode({status:'ok',replayOnly:'false'}),'unknown');
});

test('fixture event sequence exposes policy-cleared proposals before review and finalizes the hero later', () => {
 const branch={id:'b1',title:'Open observatory',year:500,place:{name:'Alexandria'},summary:'Astronomers map the sky.'};
 const blocked={id:'b2',title:'Rejected candidate'};
 let state={branches:[],heroId:null,phase:'idle'};
 state=branchProgress(state,'propose',{pending:true,candidateCount:3});
 assert.equal(state.phase,'policy-checking'); assert.deepEqual(state.branches,[]); assert.equal(state.candidateCount,3);
 assert.match(branchPhaseLabel(state.phase),/CHECKING TOPIC POLICY/);
 // The follow-up event replaces placeholders with policy-cleared branch text.
 state=branchProgress(state,'propose',{branches:[branch]});
 assert.equal(state.phase,'provisional'); assert.deepEqual(state.branches,[branch]); assert.equal(state.heroId,null);
 assert.match(branchPhaseLabel(state.phase),/REVIEW IN PROGRESS/);
 state=branchProgress(state,'review',{branches:[{...branch,score:9}],hero:{branchId:'b1'}});
 assert.equal(state.phase,'reviewed'); assert.equal(state.heroId,'b1');
 state=branchProgress(state,'complete',{branch:{status:'ok',branches:[{...branch,score:9}],hero:{branchId:'b1'}}});
 assert.equal(state.phase,'final'); assert.equal(state.heroId,'b1');
 assert.equal(branchProgress(state,'policy',{branches:[blocked]}),state);
});

test('blocked events clear candidate branches instead of leaving a provisional display', () => {
 const state=branchProgress({branches:[{id:'b1'}],heroId:null,phase:'provisional'},'complete',{branch:{status:'blocked',branches:[]}});
 assert.deepEqual(state,{branches:[],heroId:null,phase:'blocked'});
 assert.match(branchPhaseLabel(state.phase),/OUTSIDE EXPLORATION SCOPE/);
 const empty=branchProgress({branches:[],heroId:null,phase:'policy-checking'},'complete',{branch:{status:'empty',branches:[]}});
 assert.equal(empty.phase,'empty'); assert.match(branchPhaseLabel(empty.phase),/NO SUITABLE PATHS/);
 assert.equal(branchProgress({branches:[],heroId:null,phase:'policy-checking'},'propose',{pending:false,branches:[]}).phase,'empty');
});

test('guardrail retry finds an exact matching usable cached story', () => {
 const runs=[{id:'guard',status:'simulated',divergence:'What if A?'},{id:'a',status:'provisional',divergence:'What if A?'},{id:'b',status:'ok',divergence:'What if B?'}];
 assert.equal(cachedRetryRun(runs,'What if A?').id,'a');
 assert.equal(cachedRetryRun(runs,'what if A?'),null);
 assert.equal(cachedRetryRun(runs,'What if C?'),null);
 assert.match(replayLabel(runs[0]),/Simulated guardrail/);
 assert.match(replayLabel(runs[1]),/2D preview/);
 assert.equal(replayLabel({id:'alexandria',divergence:'What if the Library of Alexandria never burned?'}),'Alexandria · Library survives');
});

test('offline 3D provenance identifies pre-generation and unknown cost and duration', () => {
 const item=provenance([{step:'3d',source:'gen3d-offline',ms:null,costUsd:null}])[5];
 assert.equal(item.model,'Tattva TRELLIS (existing infrastructure, pre-generated)');
 assert.equal(item.ms,null); assert.equal(item.costUsd,null);
 assert.equal(provenance([{step:'chronos',ms:20,costUsd:0}])[5].model,'Tattva TRELLIS (existing infrastructure)');
 assert.equal(`3D: ${provenance([{step:'3d',source:'gen3d-offline',provider:'sam3dobjects',ms:12,costUsd:null}])[5].model}`,'3D: Meta SAM 3D Objects (via Tattva Cloud Run)');
 assert.equal(provenance([{step:'3d',source:'gen3d-offline',provider:'trellis',ms:12,costUsd:null}])[5].model,'Tattva TRELLIS (existing infrastructure, pre-generated)');
});
