import { retryPrompt, formatYear, provenance, parseSseBlock, availableView, completionStatus, cachedRetryRun, replayLabel } from './logic.js';
const $ = id => document.getElementById(id);
let branches = [], heroId = null, base = '', hasImage = false, hasCutout = false, hasModel = false, globeApi = null, modelApi = null, trace = [], savedRuns = [];
const status = text => $('status').textContent = text;
const asset = name => `${base}/${name}`;
function setView(view) {
  view = availableView(view, {image:hasImage, cutout:hasCutout, model:hasModel && !!modelApi});
  $('scene-view').disabled = !hasImage; $('cutout-view').disabled = !hasCutout; $('model-button').disabled = !hasModel || !modelApi;
  $('hero-image').hidden = !hasImage || view !== 'scene';
  $('cutout-image').hidden = !hasCutout || view !== 'cutout';
  $('model-view').hidden = !hasModel || view !== 'model';
  $('stage-empty').hidden = hasImage || (hasModel && view === 'model');
  for (const [id, name] of [['scene-view','scene'],['cutout-view','cutout'],['model-button','model']]) $(id).classList.toggle('active', view === name);
}
function showGuard(data) {
  $('guardrail').hidden = false; $('reason').textContent = data.reason || 'This question is outside the scope of this exploration.';
  $('reframe').textContent = data.reframe || 'Try a question about science, technology, culture or geography.';
  $('retry').dataset.prompt = data.suggestion || retryPrompt(data.reframe);
  $('retry').hidden = !$('retry').dataset.prompt;
}
function renderBranches() {
  $('branch-list').replaceChildren(); $('map-empty').hidden = branches.length > 0;
  for (const b of branches) {
    const button = document.createElement('button'); button.type = 'button'; button.className = b.id === heroId ? 'hero' : '';
    button.textContent = `${formatYear(b.year)} · ${b.title}`; button.setAttribute('aria-label', `${b.title}, ${b.place?.name || ''}, ${formatYear(b.year)}`);
    button.addEventListener('click', () => { globeApi?.focus(b); $('hero-description').textContent = b.summary || ''; }); $('branch-list').append(button);
  }
  globeApi?.setBranches(branches, heroId);
}
function renderTrace() {
  $('steps').replaceChildren();
  for (const p of provenance(trace)) {
    const el = document.createElement('div'); el.className = 'step'; const name = document.createElement('strong'); name.textContent = `${p.label}: ${p.model}`;
    const duration = Number.isFinite(p.ms) ? `${(p.ms / 1000).toFixed(1)}s` : 'Time not recorded';
    const cost = Number.isFinite(p.costUsd) ? `$${p.costUsd.toFixed(4)}` : 'Cost not recorded';
    const value = document.createElement('span'); value.textContent = p.available ? `${duration} · ${cost}` : 'Awaiting step'; el.append(name, value); $('steps').append(el);
  }
}
function reset() { branches = []; heroId = null; trace = []; base = ''; hasImage = hasCutout = hasModel = false; $('guardrail').hidden = true; $('generation').hidden = true; $('hero-title').textContent = 'A world to step into'; $('hero-tag').textContent = 'AWAITING A STORY'; $('hero-description').textContent = 'The strongest branch becomes a scene, then a subject to explore in three dimensions.'; renderBranches(); renderTrace(); setView('scene'); }
function setBranch(data) {
  if (data.status === 'blocked' || data.allowed === false) { showGuard(data); status('This question needs a reframe'); return; }
  if (Array.isArray(data.branches)) branches = data.branches;
  if (data.hero) heroId = data.hero.branchId || data.hero.id;
  renderBranches();
  const hero = branches.find(b => b.id === heroId);
  if (hero) { $('hero-title').textContent = hero.title; $('hero-tag').textContent = 'HERO BRANCH'; $('hero-description').textContent = hero.summary; globeApi?.focus(hero); }
}
async function exists(url) { try { const response = await fetch(url, { method:'HEAD' }); return response.ok; } catch { return false; } }
async function loadAssets(preferredView) {
  if (!base) return;
  const [image, cutout, model] = await Promise.all(['hero.png','cutout.png','model.glb'].map(n => exists(asset(n))));
  hasImage = image; hasCutout = cutout; hasModel = model;
  if (image) $('hero-image').src = asset('hero.png'); if (cutout) $('cutout-image').src = asset('cutout.png');
  if (model) modelApi?.load(asset('model.glb')); setView(preferredView || (cutout ? 'cutout' : model ? 'model' : 'scene'));
}
async function loadRun(id) {
  if (!id) return; reset(); base = `/runs/${encodeURIComponent(id)}`; status('Opening saved story…');
  try {
    const [branchResponse, traceResponse, manifestResponse] = await Promise.all([fetch(asset('branch.json')),fetch(asset('trace.json')),fetch(base)]);
    if (!branchResponse.ok) throw new Error('Could not load this cached story');
    const branch = await branchResponse.json(); const record = traceResponse.ok ? await traceResponse.json() : {};
    const manifest = manifestResponse.ok ? await manifestResponse.json() : {};
    $('prompt').value = branch.divergence || ''; setBranch(branch); trace = record.steps || branch.trace || []; renderTrace(); await loadAssets(); status(manifest.status === 'simulated' ? 'Simulated guardrail · no classifier was called' : branch.status === 'blocked' ? 'This question needs a reframe' : manifest.status === 'provisional' ? '2D preview · 3D model not generated' : 'Saved story ready');
  } catch (e) { status(e.message); }
}
async function handleEvent(type, data) {
  if (type === 'policy') { if (data.allowed === false || data.status === 'blocked') showGuard(data); status(data.allowed === false ? 'This question needs a reframe' : 'Policy checked'); }
  if (type === 'propose' || type === 'review') { setBranch(data); if (type === 'propose' && branches.length) globeApi?.focus(branches[0]); status(type === 'propose' ? 'Branches are appearing' : 'Hero selected'); }
  if (data.trace) { trace = Array.isArray(data.trace) ? data.trace : data.trace.steps || trace; renderTrace(); }
  else if (data.ms != null || data.costUsd != null) { trace.push({ step: type, model: data.model, ms: data.ms, costUsd: data.costUsd }); renderTrace(); }
  if (data.runId || data.id && type === 'complete') base = `/runs/${encodeURIComponent(data.runId || data.id)}`;
  if (data.baseUrl) base = data.baseUrl;
  if (type === 'image' || type === 'cutout' || type === '3d' || type === 'complete') { if (type === 'cutout') $('generation').hidden = false; if (type === '3d' || type === 'complete') $('generation').hidden = true; await loadAssets(type === '3d' || (type === 'complete' && hasModel) ? 'model' : undefined); }
  if (type === 'error') { $('generation').hidden = true; status(data.message || data.error || 'The run could not be completed'); }
  else if (type === 'complete') { const result = data.branch || data; setBranch(result); status(completionStatus(result)); }
}
async function runPrompt(prompt) {
  if (!prompt.trim()) return; const code = $('access').value;
  if (!code) { status('Select a cached story, or enter a live access code.'); return; }
  reset(); $('prompt').value = prompt; status('Checking your question…');
  try {
    const response = await fetch('/api/run', { method:'POST', headers:{'content-type':'application/json','x-demo-access-code':code}, body:JSON.stringify({divergence:prompt}) });
    if (!response.ok || !response.body) { let msg = `Unable to start (${response.status})`; try { const body = await response.json(); msg = body.error || msg; } catch {} throw new Error(msg); }
    const reader = response.body.getReader(), decoder = new TextDecoder(); let buffer = '';
    while (true) { const {value,done} = await reader.read(); buffer += decoder.decode(value || new Uint8Array(), {stream:!done}); let match;
      while ((match = buffer.match(/\r?\n\r?\n/))) { const block = buffer.slice(0,match.index); buffer = buffer.slice(match.index + match[0].length); const e = parseSseBlock(block); if (e) await handleEvent(e.event, e.data); }
      if (done) break;
    }
  } catch(e) { status(e.message); $('generation').hidden = true; }
}
$('prompt-form').addEventListener('submit', e => { e.preventDefault(); runPrompt($('prompt').value); });
document.querySelectorAll('[data-prompt]').forEach(b => b.addEventListener('click', () => { $('prompt').value = b.dataset.prompt; $('prompt').focus(); }));
$('retry').addEventListener('click', () => {
  const prompt = $('retry').dataset.prompt; $('prompt').value = prompt;
  if ($('access').value) { runPrompt(prompt); return; }
  const cached = cachedRetryRun(savedRuns, prompt);
  if (cached) { $('runs').value = cached.id; loadRun(cached.id); }
  else status('No cached story matches this suggestion; select another story or enter a live access code.');
});
$('load-run').addEventListener('click', () => loadRun($('runs').value));
$('scene-view').addEventListener('click', () => setView('scene')); $('cutout-view').addEventListener('click', () => setView('cutout')); $('model-button').addEventListener('click', () => setView('model'));
reset();
fetch('/runs').then(r => r.json()).then(data => { const runs = Array.isArray(data) ? data : data.runs || []; savedRuns = runs; $('runs').replaceChildren(); if (!runs.length) { $('runs').add(new Option('No saved stories yet', '')); return; } for (const run of runs) $('runs').add(new Option(replayLabel(run), run.id)); }).catch(() => { $('runs').replaceChildren(new Option('Archive unavailable', '')); });
import('./visuals.js').then(({createGlobe,createModelViewer}) => { globeApi = createGlobe($('globe')); modelApi = createModelViewer($('model-view')); renderBranches(); if (hasModel) { modelApi.load(asset('model.glb')); setView('model'); } }).catch(() => { $('globe-fallback').hidden = false; });
