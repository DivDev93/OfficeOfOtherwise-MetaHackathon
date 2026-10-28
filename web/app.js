import { retryPrompt, formatYear, provenance, parseSseBlock, availableView, completionStatus, cachedRetryRun, replayLabel, branchProgress, branchPhaseLabel, liveAccessMode, modelLoadProgress } from './logic.js';
const $ = id => document.getElementById(id);
let branchState = { branches: [], heroId: null, phase: 'idle' }, serviceMode = 'unknown', base = '', hasImage = false, hasCutout = false, hasModel = false, modelAsset = '', modelLoading = false, modelLoaded = false, modelError = false, modelRequestId = 0, loadingModelUrl = '', loadedModelUrl = '', activeView = 'scene', globeApi = null, modelApi = null, trace = [], savedRuns = [];
const status = text => $('status').textContent = text;
const asset = name => `${base}/${name}`;
function applyServiceMode(mode) {
  serviceMode = mode;
  $('live-access').hidden = mode !== 'live-enabled';
  $('live-submit').disabled = mode !== 'live-enabled';
  $('service-mode').textContent = mode === 'replay-only' ? '●  REPLAY-ONLY SERVICE' : mode === 'live-enabled' ? '●  REPLAY + LIVE' : '●  SERVICE MODE UNKNOWN';
  if (mode === 'replay-only') status('Replay-only service · live generation unavailable');
  else if (mode === 'unknown') status('Service mode unavailable · cached stories remain available');
}
async function loadServiceMode() {
  try {
    const response = await fetch('/health');
    if (!response.ok) throw new Error('Health endpoint unavailable');
    applyServiceMode(liveAccessMode(await response.json()));
  } catch { applyServiceMode('unknown'); }
}
function setView(view) {
  view = availableView(view, {image:hasImage, cutout:hasCutout, model:hasModel && !!modelApi});
  activeView = view;
  $('scene-view').disabled = !hasImage; $('cutout-view').disabled = !hasCutout; $('model-button').disabled = !hasModel || !modelApi;
  $('hero-image').hidden = !hasImage || view !== 'scene';
  $('cutout-image').hidden = !hasCutout || view !== 'cutout';
  $('model-view').hidden = !hasModel || view !== 'model';
  $('stage-empty').hidden = hasImage || (hasModel && view === 'model');
  for (const [id, name] of [['scene-view','scene'],['cutout-view','cutout'],['model-button','model']]) $(id).classList.toggle('active', view === name);
  const modelFocus = hasModel && !!modelApi && view === 'model';
  $('workspace').classList.toggle('model-focus', modelFocus);
  $('back-to-atlas').hidden = !modelFocus;
  $('model-loading').hidden = !modelFocus || !modelLoading;
  $('model-error').hidden = !modelFocus || !modelError;
  if (modelFocus && !modelLoaded && !modelLoading && !modelError) requestModelLoad();
}
function showGuard(data) {
  $('guardrail').hidden = false; $('reason').textContent = data.reason || 'This question is outside the scope of this exploration.';
  $('reframe').textContent = data.reframe || 'Try a question about science, technology, culture or geography.';
  $('retry').dataset.prompt = data.suggestion || retryPrompt(data.reframe);
  $('retry').hidden = !$('retry').dataset.prompt;
}
function renderBranches() {
  $('branch-list').replaceChildren(); $('map-empty').hidden = branchState.branches.length > 0 || branchState.phase === 'policy-checking';
  if (branchState.phase === 'policy-checking') {
    const count = Math.min(branchState.candidateCount || 1, 8);
    for (let i = 0; i < count; i++) {
      const card = document.createElement('button'); card.type = 'button'; card.disabled = true;
      card.textContent = `Path ${i + 1} · checking topic policy`;
      card.setAttribute('aria-label', `Candidate path ${i + 1}; checking topic policy`); $('branch-list').append(card);
    }
    return;
  }
  for (const b of branchState.branches) {
    const button = document.createElement('button'); button.type = 'button'; button.className = b.id === branchState.heroId ? 'hero' : '';
    const provisional = branchState.phase === 'provisional';
    button.textContent = `${formatYear(b.year)} · ${b.title}${provisional ? ' · pending review' : ''}`;
    button.setAttribute('aria-label', `${b.title}, ${b.place?.name || ''}, ${formatYear(b.year)}${provisional ? ', policy-cleared candidate, review in progress' : ''}`);
    button.addEventListener('click', () => { globeApi?.focus(b); $('hero-description').textContent = b.summary || ''; }); $('branch-list').append(button);
  }
  globeApi?.setBranches(branchState.branches, branchState.heroId);
}
function renderTrace() {
  $('steps').replaceChildren();
  const hasRecordedSteps = trace.some(s => !s.summary);
  for (const p of provenance(trace)) {
    const el = document.createElement('div'); el.className = 'step'; const name = document.createElement('strong');
    const recordedReplay = p.label === 'Policy' && serviceMode === 'replay-only' && p.model.includes('Muse Wonder');
    name.textContent = `${p.label}: ${p.model}${recordedReplay ? ' · saved replay' : ''}`;
    const duration = Number.isFinite(p.ms) ? `${(p.ms / 1000).toFixed(1)}s` : 'Time not recorded';
    const cost = Number.isFinite(p.costUsd) ? `$${p.costUsd.toFixed(4)}` : 'Cost not recorded';
    const value = document.createElement('span'); value.textContent = p.available ? `${duration} · ${cost}` : hasRecordedSteps ? 'Not recorded in this replay' : 'No replay loaded'; el.append(name, value); $('steps').append(el);
  }
  renderHeroModels();
}
function metricText(item) {
  const duration = Number.isFinite(item?.ms) ? `${(item.ms / 1000).toFixed(1)}s` : 'Time not recorded';
  const cost = Number.isFinite(item?.costUsd) ? `$${item.costUsd.toFixed(4)}` : 'Cost not recorded';
  return `${duration} · ${cost}`;
}
function renderHeroModels() {
  const host = $('hero-models'); host.replaceChildren();
  const recorded = trace.some(s => !s.summary);
  host.hidden = !recorded;
  if (!recorded) return;
  const steps = provenance(trace);
  const sparkUsed = /Muse Spark/.test(steps[0].model);
  const models = [
    { role: 'Topic policy', model: 'Muse Spark 1.3', metrics: sparkUsed ? metricText(steps[0]) : 'Current live role · no call in this replay' },
  ];
  if (!sparkUsed && steps[0].available) models.push({ role: 'Saved policy call', model: steps[0].model, metrics: metricText(steps[0]) });
  const branchMs = [steps[1].ms, steps[2].ms].every(Number.isFinite) ? steps[1].ms + steps[2].ms : null;
  const branchCost = [steps[1].costUsd, steps[2].costUsd].every(Number.isFinite) ? steps[1].costUsd + steps[2].costUsd : null;
  models.push(
    { role: 'Branches + review', model: 'Muse Wonder 1.0', metrics: steps[1].available || steps[2].available ? metricText({ ms: branchMs, costUsd: branchCost }) : 'Not recorded in this replay' },
    { role: 'Scene', model: 'Muse Image 1.0', metrics: metricText(steps[3]) },
    { role: 'Cutout', model: 'SAM 3.1', metrics: metricText(steps[4]) },
    { role: '3D viewer', model: 'Meta SAM 3D Objects', metrics: metricText(steps[5]) },
  );
  for (const item of models) {
    const card = document.createElement('div'); card.className = 'hero-model-card';
    const model = document.createElement('strong'); model.textContent = item.model;
    const role = document.createElement('span'); role.textContent = item.role;
    const metrics = document.createElement('small'); metrics.textContent = item.metrics;
    card.append(model, role, metrics); host.append(card);
  }
}
function reset() { branchState = { branches: [], heroId: null, phase: 'idle' }; trace = []; base = ''; hasImage = hasCutout = hasModel = false; modelAsset = ''; modelLoading = modelLoaded = modelError = false; loadingModelUrl = ''; modelRequestId++; $('guardrail').hidden = true; $('generation').hidden = true; $('map-status').textContent = 'DRAG TO EXPLORE'; $('hero-title').textContent = 'A world to step into'; $('hero-tag').textContent = branchPhaseLabel('idle'); $('hero-description').textContent = 'The strongest branch becomes a scene, then a subject to explore in three dimensions.'; renderBranches(); renderTrace(); setView('scene'); }
function setBranch(data, event = 'complete') {
  branchState = branchProgress(branchState, event, data);
  $('hero-tag').textContent = branchPhaseLabel(branchState.phase);
  if (branchState.phase === 'blocked') { showGuard(data); $('map-status').textContent = 'NO BRANCHES · REFRAME REQUIRED'; status('This question needs a reframe'); renderBranches(); return; }
  renderBranches();
  const hero = branchState.branches.find(b => b.id === branchState.heroId);
  if (hero) { $('hero-title').textContent = hero.title; $('hero-description').textContent = hero.summary; globeApi?.focus(hero); }
}
async function exists(url) { try { const response = await fetch(url, { method:'HEAD' }); return response.ok; } catch { return false; } }
function requestModelLoad() {
  if (!base || !modelAsset || !modelApi) return;
  const url = asset(modelAsset);
  if (url === loadedModelUrl) { modelLoaded = true; modelLoading = false; setView(activeView); return; }
  if (url === loadingModelUrl) return;
  const requestId = ++modelRequestId;
  loadingModelUrl = url; modelLoading = true; modelLoaded = false; modelError = false;
  $('model-loading').hidden = activeView !== 'model'; $('model-error').hidden = true;
  $('model-progress').value = 0; $('model-progress-text').textContent = 'Preparing 3D model…';
  modelApi.load(url, {
    onProgress(event) {
      if (requestId !== modelRequestId) return;
      const progress = modelLoadProgress(event);
      if (progress.value === null) $('model-progress').removeAttribute('value');
      else { $('model-progress').max = 100; $('model-progress').value = progress.value; }
      $('model-progress-text').textContent = progress.label;
    },
    onLoad() {
      if (requestId !== modelRequestId) return;
      loadedModelUrl = url; loadingModelUrl = ''; modelLoading = false; modelLoaded = true; modelError = false;
      setView(activeView);
    },
    onError() {
      if (requestId !== modelRequestId) return;
      loadingModelUrl = ''; modelLoading = false; modelLoaded = false; modelError = true;
      status('3D model failed to load. Retry from the 3D view.'); setView(activeView);
    },
  });
}
async function replaySavedBranches(branch) {
  const branches = Array.isArray(branch.branches) ? branch.branches : [];
  if (!branches.length || branch.status === 'blocked' || branch.status === 'empty') { setBranch(branch); return; }
  for (let i = 1; i <= branches.length; i++) {
    branchState = { branches: branches.slice(0, i), heroId: null, phase: 'replay' };
    $('hero-tag').textContent = `CACHED REPLAY · ${i}/${branches.length} PATHS`;
    $('map-status').textContent = `CACHED REPLAY · ${i} OF ${branches.length} PATHS`;
    status(`Replaying saved branches · ${i} of ${branches.length}`);
    renderBranches();
    if (i < branches.length) await new Promise(resolve => setTimeout(resolve, 360));
  }
  setBranch(branch);
  $('map-status').textContent = `CACHED REPLAY · ${branches.length} PATHS`;
}
async function loadAssets(preferredView) {
  if (!base) return;
  const [image, cutout, meshoptModel, model] = await Promise.all(['hero.png','cutout.png','model.meshopt.glb','model.glb'].map(n => exists(asset(n))));
  hasImage = image; hasCutout = cutout; hasModel = meshoptModel || model; modelAsset = meshoptModel ? 'model.meshopt.glb' : model ? 'model.glb' : '';
  if (image) $('hero-image').src = asset('hero.png'); if (cutout) $('cutout-image').src = asset('cutout.png');
  setView(preferredView || (cutout ? 'cutout' : hasModel ? 'model' : 'scene'));
}
async function loadRun(id) {
  if (!id) return; reset(); base = `/runs/${encodeURIComponent(id)}`; status('Opening saved story…');
  try {
    const [branchResponse, traceResponse, manifestResponse] = await Promise.all([fetch(asset('branch.json')),fetch(asset('trace.json')),fetch(base)]);
    if (!branchResponse.ok) throw new Error('Could not load this cached story');
    const branch = await branchResponse.json(); const record = traceResponse.ok ? await traceResponse.json() : {};
    const manifest = manifestResponse.ok ? await manifestResponse.json() : {};
    $('prompt').value = branch.divergence || '';
    await replaySavedBranches(branch);
    trace = record.steps || branch.trace || []; renderTrace(); await loadAssets();
    status(manifest.status === 'simulated' ? 'Simulated guardrail · no classifier was called' : branch.status === 'blocked' ? 'This question needs a reframe' : branch.renderStatus === '2d-only' ? completionStatus(branch) : manifest.status === 'provisional' ? '2D preview · 3D model not generated' : 'Saved story ready');
  } catch (e) { status(e.message); }
}
async function handleEvent(type, data) {
  if (type === 'policy') { if (data.allowed === false || data.status === 'blocked') showGuard(data); status(data.allowed === false ? 'This question needs a reframe' : 'Policy checked'); }
  if (type === 'propose' || type === 'review') { setBranch(data, type); if (type === 'propose' && branchState.branches.length) globeApi?.focus(branchState.branches[0]); status(type === 'propose' && branchState.phase === 'policy-checking' ? 'Topic policy checking · candidate text is not shown yet' : type === 'propose' && branchState.phase === 'empty' ? 'No suitable branches found' : type === 'propose' ? 'Policy-cleared paths · review in progress' : 'Hero selected · assets generating'); }
  if (data.trace) { trace = Array.isArray(data.trace) ? data.trace : data.trace.steps || trace; renderTrace(); }
  else if (data.ms != null || data.costUsd != null) { trace.push({ step: type, model: data.model, ms: data.ms, costUsd: data.costUsd }); renderTrace(); }
  if (data.runId || data.id && type === 'complete') base = `/runs/${encodeURIComponent(data.runId || data.id)}`;
  if (data.baseUrl) base = data.baseUrl;
  if (type === 'image' || type === 'cutout' || type === '3d' || type === 'complete') { if (type === 'cutout') { const unavailable = data.status === 'unavailable'; $('generation').hidden = unavailable; if (unavailable) status(completionStatus({ renderStatus: '2d-only' })); } if (type === '3d' || type === 'complete') $('generation').hidden = true; await loadAssets(type === '3d' || (type === 'complete' && hasModel) ? 'model' : undefined); }
  if (type === 'error') { if (branchState.phase === 'policy-checking') { branchState = { branches: [], heroId: null, phase: 'idle' }; $('hero-tag').textContent = branchPhaseLabel('idle'); renderBranches(); } $('generation').hidden = true; status(data.message || data.error || 'The run could not be completed'); }
  else if (type === 'complete') { const result = data.branch || data; setBranch(result); status(completionStatus(result)); }
}
async function runPrompt(prompt) {
  if (!prompt.trim()) return; const code = $('access').value;
  if (serviceMode === 'replay-only') { status('Replay-only service · open a cached story below'); return; }
  if (serviceMode !== 'live-enabled') { status('Service mode could not be confirmed · open a cached story below'); return; }
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
$('back-to-atlas').addEventListener('click', () => setView(hasCutout ? 'cutout' : 'scene'));
$('retry-model').addEventListener('click', () => { loadedModelUrl = ''; loadingModelUrl = ''; modelError = false; requestModelLoad(); setView('model'); });
reset();
loadServiceMode();
fetch('/runs').then(r => r.json()).then(data => { const runs = Array.isArray(data) ? data : data.runs || []; savedRuns = runs; $('runs').replaceChildren(); if (!runs.length) { $('runs').add(new Option('No saved stories yet', '')); return; } for (const run of runs) $('runs').add(new Option(replayLabel(run), run.id)); }).catch(() => { $('runs').replaceChildren(new Option('Archive unavailable', '')); });
import('./visuals.js').then(({createGlobe,createModelViewer}) => { globeApi = createGlobe($('globe')); modelApi = createModelViewer($('model-view')); renderBranches(); setView(activeView); }).catch(() => { $('globe-fallback').hidden = false; });
