import { readFile, writeFile, mkdir, mkdtemp, rename, rm, rmdir, readdir, lstat } from 'node:fs/promises';
import { join, resolve, basename, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { PNG } from 'pngjs';
import { keywordCheck } from '../src/guardrails/topicPolicy.js';
import { repriceCachedRun } from './reprice-cached-run.js';

export const CURATED = Object.freeze([
  { id:'alexandria', divergence:'What if the Library of Alexandria never burned?', reuse:true },
  { id:'beringia', divergence:'What if the Bering land bridge never flooded?' },
  { id:'green-sahara', divergence:'What if the Sahara had stayed green?' },
  { id:'mechanisms', divergence:'What if Antikythera-style mechanisms had scaled into industry?' },
]);
const MAX_BYTES = 80_000_000;
const safeText = value => {
  if (typeof value !== 'string') return undefined;
  // Generated free text is public only if it passes both the topic keyword layer and a basic secret/URL screen.
  if (value.length > 12000 || /\b(?:sk-|Bearer\s+)[A-Za-z0-9._-]{12,}|[A-Za-z0-9_-]{40,}|https?:\/\/|\bwww\.|\.a\.run\.app\b|\b(?:TATTVA_|CHRONOS_|META_API_KEY|gs:\/\/)|(?:[A-Za-z]:\\|\/home\/|\/Users\/)/i.test(value) || !keywordCheck(value).allowed) throw new Error('Unsafe generated text cannot be published');
  return value;
};
const number = v => Number.isFinite(v) ? v : undefined;
function pickBranch(b) {
  if (!b || !b.place || !Number.isFinite(b.year) || !Number.isFinite(b.place.lat) || !Number.isFinite(b.place.lon) || Math.abs(b.place.lat)>90 || Math.abs(b.place.lon)>180) throw new Error('Invalid branch');
  if (typeof b.id !== 'string' || !/^b[0-9]{1,3}$/.test(b.id)) throw new Error('Invalid branch id');
  return {id:b.id,title:safeText(b.title),year:b.year,place:{name:safeText(b.place.name),lat:b.place.lat,lon:b.place.lon},summary:safeText(b.summary),scene:safeText(b.scene),score:number(b.score),reviewNote:safeText(b.reviewNote)};
}
function cleanStep(t) {
  return { step:safeText(t.step), model:safeText(t.model), ms:number(t.ms), costUsd:number(t.costUsd), originalCostUsd:number(t.originalCostUsd), recordedCostUsd:number(t.recordedCostUsd), reused:t.reused === true || undefined, summary:t.summary === true || undefined, allowed:typeof t.allowed === 'boolean' ? t.allowed : undefined, prompt:safeText(t.prompt), attempt:number(t.attempt), ok:typeof t.ok === 'boolean' ? t.ok : undefined };
}
function sanitize(branch, trace) {
  if (!branch || !['ok','blocked'].includes(branch.status)) throw new Error('Run did not complete');
  const clean = {status:branch.status,divergence:safeText(branch.divergence),branches:(branch.branches ?? []).map(pickBranch),hero:branch.hero ? {branchId:safeText(branch.hero.branchId),imagePrompt:safeText(branch.hero.imagePrompt),subject:safeText(branch.hero.subject)} : null,reframe:safeText(branch.reframe),reason:safeText(branch.reason),trace:(branch.trace ?? []).map(cleanStep),costUsd:number(branch.costUsd)};
  const selection = trace.selection ? {confidence:number(trace.selection.confidence),area:number(trace.selection.area),prompt:safeText(trace.selection.prompt)} : null;
  const pricingNote=trace.pricingNote ? {method:safeText(trace.pricingNote.method),sourceRunTimestamp:safeText(trace.pricingNote.sourceRunTimestamp),windowMs:number(trace.pricingNote.windowMs)} : undefined;
  return {branch:clean,trace:{steps:(trace.steps ?? []).map(cleanStep),selection,costUsd:number(trace.costUsd),recordedCostUsd:number(trace.recordedCostUsd),pricingNote}};
}
async function treeSize(path) {
  let sum=0;
  for (const entry of await readdir(path,{withFileTypes:true})) {
    const full=join(path,entry.name);
    if (entry.isSymbolicLink()) throw new Error('Symlinks are not accepted in cache');
    if (entry.isDirectory()) sum += await treeSize(full); else if (entry.isFile()) sum += (await lstat(full)).size;
  }
  return sum;
}
async function removeStaging(path, root) {
  const absolute = resolve(path), base = resolve(root);
  if (!absolute.startsWith(base + sep) || !/^\.cache-(?:stage|backup)-/.test(basename(absolute))) throw new Error('Invalid cache staging path');
  await rm(absolute, { recursive: true, force: true });
}
async function readRegular(path) {
  const info=await lstat(path); if (!info.isFile() || info.isSymbolicLink()) throw new Error('Source asset must be a regular file');
  return readFile(path);
}
function displayPng(input) {
  const src = PNG.sync.read(input); const scale = Math.min(1, 1024 / Math.max(src.width, src.height));
  const width = Math.max(1, Math.round(src.width * scale)), height = Math.max(1, Math.round(src.height * scale));
  const dst = new PNG({width,height});
  for (let y=0;y<height;y++) for (let x=0;x<width;x++) {
    const si=(Math.min(src.height-1,Math.floor(y/scale))*src.width+Math.min(src.width-1,Math.floor(x/scale)))*4;
    src.data.copy(dst.data,(y*width+x)*4,si,si+4);
  }
  return PNG.sync.write(dst);
}
async function sourceData(directory, { provisional2d = false } = {}) {
  const branch=JSON.parse(await readRegular(join(directory,'branch.json'))), trace=JSON.parse(await readRegular(join(directory,'trace.json')));
  const cleaned=sanitize(branch,trace);
  if (branch.status === 'blocked') return {...cleaned,files:{}};
  if (!branch.hero?.branchId || !cleaned.branch.branches.some(b => b.id === branch.hero.branchId) || !trace.selection || !Number.isFinite(trace.selection.confidence)) throw new Error('Incomplete run: hero, branches and mask confidence required');
  const files={};
  for (const name of ['hero.png','mask.png','cutout.png']) files[name]=await readRegular(join(directory,name));
  try { files['model.glb']=await readRegular(join(directory,'model.glb')); } catch (error) { if (!provisional2d || error.code !== 'ENOENT') throw error; }
  const png=Buffer.from([137,80,78,71,13,10,26,10]);
  for (const name of ['hero.png','mask.png','cutout.png']) if (!files[name].subarray(0,8).equals(png)) throw new Error('Invalid PNG asset');
  for (const name of ['hero.png','mask.png','cutout.png']) files[name]=displayPng(files[name]);
  if (!files['model.glb']) {
    if (!/\borrery\b/i.test(branch.hero?.subject ?? '') || (trace.steps ?? []).some(t => t.step === '3d')) throw new Error('Invalid provisional orrery source');
    return {...cleaned,files,provisional:true};
  }
  if (!(trace.steps ?? []).some(t => t.step === '3d' && t.model === 'Tattva TRELLIS' && Number.isFinite(t.ms) && t.ms >= 0 && !t.error && t.ok !== false)) throw new Error('Completed run requires a successful 3D trace');
  const glb=files['model.glb']; if (glb.length<20 || glb.toString('ascii',0,4)!=='glTF' || glb.readUInt32LE(4)!==2 || glb.readUInt32LE(8)!==glb.length) throw new Error('Invalid GLB asset');
  return {...cleaned,files};
}
/** Stage an already generated Meta 2D run without generating or claiming a 3D model. */
export async function stageMetaOnlyRun({slug, sourceDirectory, outputRoot='demo/runs', maxBytes=MAX_BYTES}={}) {
  const item=CURATED.find(x=>x.id===slug && !x.reuse);
  if (!item) throw new Error('Invalid curated slug');
  if (!Number.isInteger(maxBytes) || maxBytes<0 || maxBytes>MAX_BYTES) throw new Error('Invalid cache size cap');
  const branch=JSON.parse(await readRegular(join(sourceDirectory,'branch.json')));
  const trace=JSON.parse(await readRegular(join(sourceDirectory,'trace.json')));
  const data=sanitize(branch,trace);
  if (data.branch.status!=='ok') throw new Error('Curated run was blocked');
  if (data.branch.divergence!==item.divergence) throw new Error('Source divergence does not match curated prompt');
  if (!branch.hero?.branchId || !data.branch.branches.some(b=>b.id===branch.hero.branchId) || !trace.selection || !Number.isFinite(trace.selection.confidence) || trace.selection.confidence<.5 || trace.selection.confidence>1) throw new Error('Incomplete run: hero, branches and mask confidence required');
  if ((trace.steps ?? []).some(t=>t.step==='3d')) throw new Error('2D source contains a 3D trace');
  const files={}; let dimensions;
  for (const name of ['hero.png','mask.png','cutout.png']) {
    const bytes=await readRegular(join(sourceDirectory,name));
    let png; try { png=PNG.sync.read(bytes); } catch { throw new Error('Invalid PNG asset'); }
    if (!png.width || !png.height || (dimensions && (png.width!==dimensions[0] || png.height!==dimensions[1]))) throw new Error('PNG dimensions do not match');
    dimensions=[png.width,png.height];
    if (name==='cutout.png') {
      let visible=false, transparent=false;
      for (let i=3;i<png.data.length;i+=4) { if(png.data[i]>0) visible=true; if(png.data[i]<255) transparent=true; }
      if (!visible || !transparent) throw new Error('Cutout requires visible and transparent pixels');
    }
    files[name]=displayPng(bytes);
  }
  await mkdir(outputRoot,{recursive:true});
  const destination=join(outputRoot,slug);
  try { await lstat(destination); throw new Error('Run already staged'); } catch(e) { if(e.code!=='ENOENT') throw e; }
  const stage=await mkdtemp(join(resolve(outputRoot),'.cache-stage-'));
  try {
    await writeFile(join(stage,'branch.json'),JSON.stringify(data.branch,null,2)+'\n');
    await writeFile(join(stage,'trace.json'),JSON.stringify(data.trace,null,2)+'\n');
    await writeFile(join(stage,'manifest.json'),JSON.stringify({status:'provisional',reason:'3D model not generated'},null,2)+'\n');
    for (const [name,bytes] of Object.entries(files)) await writeFile(join(stage,name),bytes);
    if ((await treeSize(outputRoot))>=maxBytes) throw new Error('Cache size cap exceeded');
    await rename(stage,destination);
    return {slug,directory:destination,status:'provisional'};
  } finally { await removeStaging(stage,outputRoot); }
}
function publicError(error) {
  const known = new Set(['Cache size cap reached before generation', 'Cache size cap exceeded', 'Invalid provisional orrery source', 'Invalid PNG asset', 'Invalid GLB asset', 'Completed run requires a successful 3D trace', 'Incomplete run: hero, branches and mask confidence required', 'Run did not complete', 'Unsafe generated text cannot be published', 'Retry did not complete with sufficient mask confidence', 'Curated run was blocked', 'Classifier did not block the sample', 'Source divergence does not match curated prompt', 'Demo task budget checkpoint is required', 'Live caching requires confirmed TRELLIS configuration and Meta credentials', 'Invalid retry subject', 'Duplicate retry subject', 'Invalid visibly broken run', 'Blocked sample contains prohibited public content']);
  return known.has(error?.message) ? error.message : 'Cache operation failed';
}
/** Publish completed outputs once; run is an injected async function and is never called for Alexandria. */
export async function cacheDemo({ outputRoot='demo/runs', orrerySource, run, retrySubject={}, visiblyBroken=[], blockedPrompt, provisional2d=false, enforceLiveOrder=false, ledgerPath, maxBytes=MAX_BYTES }={}) {
  if (!Number.isInteger(maxBytes) || maxBytes<0 || maxBytes>MAX_BYTES) throw new Error('Invalid cache size cap');
  const retries=Object.entries(retrySubject); if (retries.some(([id,subject])=>!CURATED.some(x=>x.id===id && !x.reuse) || typeof subject!=='string' || !subject.trim() || subject.length>200)) throw new Error('Invalid retry subject');
  for (const [,subject] of retries) safeText(subject);
  if (!Array.isArray(visiblyBroken) || visiblyBroken.some(id => !CURATED.some(x => x.id === id && !x.reuse))) throw new Error('Invalid visibly broken run');
  if (blockedPrompt && !keywordCheck(blockedPrompt).allowed) throw new Error('Blocked sample contains prohibited public content');
  if (blockedPrompt) safeText(blockedPrompt);
  await mkdir(outputRoot,{recursive:true});
  const report={published:[],skipped:[],errors:[]};
  const entries=[...CURATED, ...(blockedPrompt ? [{id:'guardrail',divergence:blockedPrompt,blocked:true}] : [])];
  if (!blockedPrompt) report.skipped.push({id:'guardrail',reason:'No on-policy blocked receipt supplied'});
  let paidRunsHalted=false, alexandriaChecked=false, alexandriaMissing=false;
  for (const item of entries) {
    if (enforceLiveOrder && !item.reuse && !item.blocked && typeof run==='function') {
      if (!alexandriaChecked) {
        alexandriaChecked=true;
        try { const data=await sourceData(join(outputRoot,'alexandria')); if (data.branch.status !== 'ok' || data.branch.divergence !== CURATED[0].divergence) throw new Error('Invalid Alexandria cache'); }
        catch { report.errors.push({id:'alexandria',error:'Complete Alexandria 3D cache required before live runs'}); paidRunsHalted=true; alexandriaMissing=true; }
      }
      if (paidRunsHalted) { report.skipped.push({id:item.id,reason:'Live generation stopped'}); continue; }
    }
    if (enforceLiveOrder && item.blocked && alexandriaMissing) { report.skipped.push({id:item.id,reason:'Live generation stopped'}); continue; }
    const destination=join(outputRoot,item.id);
    try {
      let upgrading=false, previousPricingNote;
      try { await lstat(destination); if (item.reuse) { try { const manifest=JSON.parse(await readRegular(join(destination,'manifest.json'))); upgrading=manifest.status==='provisional' && manifest.reason==='3D model not generated'; } catch {} } if (!upgrading) {report.skipped.push({id:item.id,reason:'Already cached'}); continue;} } catch(e) { if(e.code!=='ENOENT') throw e; }
      if (upgrading) { const priorTrace=JSON.parse(await readRegular(join(destination,'trace.json'))); previousPricingNote=priorTrace.pricingNote; }
      if (!upgrading && (await treeSize(outputRoot)) >= maxBytes) throw new Error('Cache size cap reached before generation');
      let directory;
      if(item.reuse) { if(!orrerySource) {report.skipped.push({id:item.id,reason:'Existing complete orrery source required'});continue;} directory=orrerySource; }
      else { if(typeof run!=='function') {report.skipped.push({id:item.id,reason:'Live runner unavailable'});continue;} directory=(await run({divergence:item.divergence})).directory; }
      let data=await sourceData(directory,{provisional2d: item.reuse && provisional2d});
      if (upgrading && data.provisional) { report.skipped.push({id:item.id,reason:'Provisional cache awaits completed 3D'}); continue; }
      if (!item.blocked && !item.reuse && data.branch.status === 'blocked' && data.branch.divergence === item.divergence) { report.skipped.push({id:item.id,reason:'Curated prompt blocked by topic policy'}); continue; }
      if(item.blocked ? data.branch.status!=='blocked' : data.branch.status!=='ok') throw new Error(item.blocked ? 'Classifier did not block the sample' : 'Curated run was blocked');
      if (data.branch.divergence!==item.divergence) throw new Error('Source divergence does not match curated prompt');
      if (retrySubject[item.id] && (data.trace.selection.confidence < .5 || visiblyBroken.includes(item.id))) {
        directory=(await run({divergence:item.divergence,from:join(directory,'branch.json'),subjectOverride:retrySubject[item.id]})).directory;
        data=await sourceData(directory);
        if(data.branch.status!=='ok' || data.branch.divergence!==item.divergence || data.trace.selection.confidence < .5) throw new Error('Retry did not complete with sufficient mask confidence');
      }
      if (!item.blocked && data.trace.selection.confidence<.5) {report.skipped.push({id:item.id,reason:'Mask confidence below 0.5; explicit subject retry required'}); if (enforceLiveOrder && !item.reuse) paidRunsHalted=true; continue;}
      const stage=await mkdtemp(join(resolve(outputRoot),'.cache-stage-'));
      try {
        await writeFile(join(stage,'branch.json'),JSON.stringify(data.branch,null,2)+'\n'); await writeFile(join(stage,'trace.json'),JSON.stringify(data.trace,null,2)+'\n');
        for (const [name,bytes] of Object.entries(data.files)) await writeFile(join(stage,name),bytes);
        if (upgrading && previousPricingNote) {
          if (data.trace.pricingNote) {
            if (JSON.stringify(data.trace.pricingNote)!==JSON.stringify(previousPricingNote)) throw new Error('Conflicting pricing note');
          } else {
            await repriceCachedRun({cacheDirectory:stage,sourceTimestamp:previousPricingNote.sourceRunTimestamp,ledgerPath});
          }
        }
        if (data.provisional) await writeFile(join(stage,'manifest.json'),JSON.stringify({status:'provisional',reason:'3D model not generated'},null,2)+'\n');
        if ((await treeSize(outputRoot))-(upgrading ? await treeSize(destination) : 0)>=maxBytes) throw new Error('Cache size cap exceeded');
        if (upgrading) {
          const backup=await mkdtemp(join(resolve(outputRoot),'.cache-backup-')); await rmdir(backup);
          await rename(destination,backup);
          try { await rename(stage,destination); } catch (error) { await rename(backup,destination); throw error; }
          await removeStaging(backup,outputRoot);
        } else await rename(stage,destination);
        report.published.push(item.id);
      } finally { await removeStaging(stage,outputRoot); }
    } catch(error) { report.errors.push({id:item.id,error:publicError(error)}); if (enforceLiveOrder && !item.blocked && !item.reuse) paidRunsHalted=true; }
  }
  return report;
}
async function main() {
  const args=process.argv.slice(2); const options={}; let live=false;
  while(args.length) { const flag=args.shift(); if(flag==='--live') live=true; else if(flag==='--provisional-2d') options.provisional2d=true; else if(flag==='--orrery-source' && args.length) options.orrerySource=args.shift(); else if(flag==='--blocked-prompt' && args.length) options.blockedPrompt=args.shift(); else if(flag==='--visibly-broken' && args.length) { options.visiblyBroken ??= []; options.visiblyBroken.push(args.shift()); } else if(flag==='--retry' && args.length) { const value=args.shift(); const pos=value.indexOf('='); if(pos<1) throw new Error('Invalid retry subject'); options.retrySubject ??= {}; const id=value.slice(0,pos); if(Object.hasOwn(options.retrySubject,id)) throw new Error('Duplicate retry subject'); options.retrySubject[id]=value.slice(pos+1); } else throw new Error('Usage: node scripts/cache-demo.js [--orrery-source <completed-run-directory>] [--live] [--provisional-2d] [--retry <id>=<noun>] [--visibly-broken <id>] [--blocked-prompt <prompt>]'); }
  if(live) {
    if (process.env.CHRONOS_3D_CAPABILITY_CONFIRMED !== 'true' || !(process.env.CHRONOS_API_BASE?.trim() || process.env.CHRONOS_3D_ENDPOINT?.trim()) || !process.env.CHRONOS_API_TOKEN?.trim() || !(process.env.META_API_KEY?.trim() || process.env.MODEL_API_KEY?.trim())) throw new Error('Live caching requires confirmed TRELLIS configuration and Meta credentials');
    const {createDemoRunner}=await import('../src/demo/pipeline.js');
    options.run=createDemoRunner({env:process.env,dailyCapUsd:2});
    options.enforceLiveOrder=true;
  }
  const report=await cacheDemo(options); console.log(JSON.stringify(report,null,2)); if(report.errors.length) process.exitCode=1;
}
if(process.argv[1] && resolve(process.argv[1])===fileURLToPath(import.meta.url)) main().catch(error=>{console.error(publicError(error));process.exitCode=1;});
