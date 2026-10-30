import { retryPrompt, formatYear, modelCardSteps, replayTraceGroups, parseSseBlock, availableView, completionStatus, freshRetrievalStatus, cachedRetryRun, suggestionAction, sourceVerificationLabel, lessonMarkdown, normalizeFreshEvidence, freshUnverifiedClaims, freshLessonMarkdown, replayLabel, branchProgress, branchPhaseLabel, liveAccessMode, modelLoadProgress } from './logic.js';
const $ = id => document.getElementById(id);
const reducedMotion = matchMedia('(prefers-reduced-motion: reduce)');
let branchState = { branches: [], heroId: null, phase: 'idle' }, serviceMode = 'unknown', base = '', hasImage = false, hasCutout = false, hasModel = false, modelAsset = '', modelLoading = false, modelLoaded = false, modelError = false, modelRequestId = 0, loadingModelUrl = '', loadedModelUrl = '', activeView = 'scene', globeApi = null, modelApi = null, trace = [], savedTrace = [], savedRuns = [], selectedBranchId = null, replayActive = false, replayLoaded = false, replayRequest = 0, currentRunId = '', learningEvidence = null, freshEvidenceEnvelope = null, learningState = 'none', lessonExportContent = '', compareBranchId = '';
const status = text => $('status').textContent = text;
const setStageMessage = text => { const copy = $('stage-empty').querySelector('p'); if (copy) copy.textContent = text; };
function setFreshRunStatus(message, { kind = 'progress', mapLabel = null, stageMessage = null } = {}) {
  const host = $('fresh-run-status');
  host.hidden = !message;
  host.dataset.state = kind;
  host.setAttribute('role', kind === 'error' ? 'alert' : 'status');
  host.textContent = message;
  if (mapLabel) $('map-status').textContent = mapLabel;
  if (stageMessage) setStageMessage(stageMessage);
}
const asset = name => `${base}/${name}`;
function applyServiceMode(mode) {
  serviceMode = mode;
  $('live-access').hidden = mode !== 'live-enabled';
  $('live-submit').disabled = mode !== 'live-enabled';
  $('service-mode').textContent = mode === 'replay-only' ? 'Showing saved runs · live generation by invite' : mode === 'live-enabled' ? 'Saved runs · live access by invite' : 'Saved runs · service mode unknown';
  if (mode === 'replay-only') status('Showing saved runs · live generation by invite');
  else if (mode === 'unknown') status('Service mode unavailable · cached stories remain available');
}
async function loadServiceMode() {
  try {
    const response = await fetch('/health');
    if (!response.ok) throw new Error('Health endpoint unavailable');
    applyServiceMode(liveAccessMode(await response.json()));
  } catch { applyServiceMode('unknown'); }
  return serviceMode;
}
function setView(view) {
  view = availableView(view, {image:hasImage, cutout:hasCutout, model:hasModel && !!modelApi});
  activeView = view;
  $('scene-view').disabled = !hasImage; $('cutout-view').disabled = !hasCutout; $('model-button').disabled = !hasModel || !modelApi;
  $('hero-image').hidden = !hasImage || view !== 'scene';
  $('cutout-image').hidden = !hasCutout || view !== 'cutout';
  $('model-view').hidden = !hasModel || view !== 'model';
  $('viewer-hint').hidden = view !== 'model';
  $('stage-empty').hidden = hasImage || (hasModel && view === 'model');
  for (const [id, name] of [['scene-view','scene'],['cutout-view','cutout'],['model-button','model']]) {
    const selected = view === name;
    $(id).classList.toggle('active', selected);
    $(id).setAttribute('aria-selected', String(selected));
    $(id).tabIndex = selected ? 0 : -1;
  }
  $('chronicle-stage').setAttribute('aria-labelledby', `${view === 'scene' ? 'scene-view' : view === 'cutout' ? 'cutout-view' : 'model-button'}`);
  const modelFocus = hasModel && !!modelApi && view === 'model';
  const heroFocus = modelFocus || hasCutout && view === 'cutout';
  $('workspace').classList.toggle('hero-focus', heroFocus);
  $('back-to-atlas').hidden = !heroFocus;
  $('orbit-button').hidden = !modelFocus;
  $('orbit-button').disabled = reducedMotion.matches || !modelLoaded;
  $('model-loading').hidden = !modelFocus || !modelLoading;
  $('model-error').hidden = !modelFocus || !modelError;
  if (!modelFocus) {
    modelApi?.setAutoRotate(false);
    $('orbit-button').setAttribute('aria-pressed', 'false');
    $('orbit-button').textContent = 'Orbit object';
  }
  if (modelFocus && !modelLoaded && !modelLoading && !modelError) requestModelLoad();
}
function showGuard(data) {
  setStageMessage('No scene is attached to this blocked prompt. Choose the reframe to continue.');
  $('guardrail').hidden = false; $('reason').textContent = data.reason || 'This question is outside the scope of this exploration.';
  $('reframe').textContent = data.reframe || 'Try a question about science, technology, culture or geography.';
  $('retry').dataset.prompt = data.suggestion || retryPrompt(data.reframe);
  $('retry').hidden = !$('retry').dataset.prompt;
}
function renderBranches() {
  document.body.classList.toggle('has-story', branchState.branches.length > 0);
  $('show-invitation').setAttribute('aria-expanded', String(!matchMedia('(max-width: 700px)').matches || document.body.classList.contains('invitation-open')));
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
    const button = document.createElement('button'); button.type = 'button'; button.dataset.branchId = b.id;
    button.className = [b.id === branchState.heroId ? 'hero' : '', b.id === selectedBranchId ? 'selected' : ''].filter(Boolean).join(' ');
    button.setAttribute('aria-pressed', String(b.id === selectedBranchId));
    const provisional = branchState.phase === 'provisional';
    button.textContent = `${formatYear(b.year)} · ${b.title}${provisional ? ' · pending review' : ''}`;
    button.setAttribute('aria-label', `${b.title}, ${b.place?.name || ''}, ${formatYear(b.year)}${provisional ? ', policy-cleared candidate, review in progress' : ''}`);
    button.addEventListener('click', () => selectBranch(b)); $('branch-list').append(button);
  }
  globeApi?.setBranches(branchState.branches, branchState.heroId);
}
function textList(host, values, tag = 'li') {
  host.replaceChildren();
  for (const value of values) {
    const item = document.createElement(tag);
    item.textContent = value;
    host.append(item);
  }
}
function renderSourceFacts(host, ids, sources) {
  host.replaceChildren();
  const linked = ids.map(id => sources.find(item => item.id === id)).filter(Boolean);
  if (!linked.length) {
    const note = document.createElement('li'); note.textContent = 'No baseline sources are linked to this path.'; host.append(note);
    return;
  }
  for (const source of linked) {
    const item = document.createElement('li');
    const fact = document.createElement('span'); fact.textContent = source.baselineParaphrase || 'Source recorded without a baseline summary.';
    const link = document.createElement('a');
    link.textContent = ` ${source.title || 'Source'}${source.publisher ? ` · ${source.publisher}` : ''}${source.checkedDate ? ` · checked ${source.checkedDate}` : ''} · ${sourceVerificationLabel(source.verificationMethod)}`;
    try {
      const url = new URL(source.url);
      if (!['https:', 'http:'].includes(url.protocol)) throw new Error('Unsupported source URL');
      link.href = url.href; link.target = '_blank'; link.rel = 'noopener noreferrer';
    } catch { link.removeAttribute('href'); link.removeAttribute('target'); }
    item.append(fact, link); host.append(item);
  }
}
function appendFreshSourceClaim(host, claim, sources) {
  const linked = claim.sourceIds.map(id => sources.find(source => source.id === id)).filter(Boolean);
  if (!linked.length) return false;
  const item = document.createElement('li');
  const text = document.createElement('p'); text.textContent = claim.text; item.append(text);
  for (const source of linked) {
    const citation = document.createElement('div'); citation.className = 'fresh-citation';
    const link = document.createElement('a');
    link.textContent = `${source.title || source.id}${source.publisher ? ` · ${source.publisher}` : ''}${source.checkedDate ? ` · checked ${source.checkedDate}` : ''} · Retrieved excerpt`;
    try { const url = new URL(source.url); if (!['https:', 'http:'].includes(url.protocol)) throw new Error('Unsupported source URL'); link.href = url.href; link.target = '_blank'; link.rel = 'noopener noreferrer'; }
    catch { link.removeAttribute('href'); link.removeAttribute('target'); }
    citation.append(link);
    const excerpt = document.createElement('blockquote'); excerpt.textContent = source.excerpt; citation.append(excerpt);
    item.append(citation);
  }
  host.append(item);
  return true;
}
function renderFreshLearning(branch, evidence) {
  const clean = normalizeFreshEvidence(branch, evidence);
  if (!clean) return false;
  $('learning-content').hidden = true;
  $('learning-score').hidden = true;
  $('download-lesson').hidden = true;
  $('learning-comparison').hidden = true;
  lessonExportContent = '';
  const topic = clean.topicId ? ` for ${clean.topicId}` : '';
  if (clean.status !== 'retrieved') {
    const details = (Array.isArray(clean.errors) ? clean.errors : []).map(error => typeof error === 'string' ? error : error?.message).filter(Boolean);
    $('learning-status').textContent = `Fresh baseline retrieval unavailable${topic}. No retrieved source excerpts or source-backed claims are shown; this branch remains an imagined path.${details.length ? ` Retrieval detail: ${details.join('; ')}` : ''}`;
    return true;
  }
  $('learning-status').textContent = `${freshRetrievalStatus(clean)}${topic}${clean.retrievedAt ? ` · retrieved ${clean.retrievedAt}` : ''} The alternate sequence is hypothetical.`;
  const sources = clean.sources;
  const claims = clean.baselineClaims;
  const baseline = $('learning-baseline'); baseline.replaceChildren();
  for (const claim of claims) {
    appendFreshSourceClaim(baseline, claim, sources);
  }
  if (!baseline.childElementCount) { const item = document.createElement('li'); item.textContent = 'No baseline claim has a valid source link.'; baseline.append(item); }
  $('learning-assumption').textContent = branch.changedAssumption || 'No changed assumption was recorded.';
  textList($('learning-steps'), Array.isArray(branch.causalSteps) ? branch.causalSteps : []);
  $('learning-uncertainty').textContent = branch.uncertainty || 'Uncertainty was not recorded for this branch.';
  const unverified = freshUnverifiedClaims(branch, clean);
  textList($('learning-unverified'), unverified.length ? unverified : ['No explicit unverified-claims list was recorded.']);
  $('learning-demonstrates').textContent = branch.demonstrates || 'The scene illustrates the selected imagined path.';
  $('learning-limits').textContent = branch.doesNotEstablish || 'Retrieved excerpts do not establish that the imagined events occurred.';
  $('learning-question').textContent = branch.discussionQuestion || 'Which assumption most changes the outcome, and what evidence could help test it?';

  const alternates = branchState.branches.filter(item => item.id !== branch.id && Array.isArray(item.baselineClaims));
  const comparison = $('learning-comparison');
  comparison.hidden = alternates.length === 0; $('comparison-content').hidden = alternates.length === 0;
  let comparisonBranch = null;
  if (alternates.length) {
    const select = $('compare-branch');
    select.replaceChildren(...alternates.map(item => new Option(item.title, item.id)));
    if (!alternates.some(item => item.id === compareBranchId)) compareBranchId = alternates[0].id;
    select.value = compareBranchId;
    comparisonBranch = alternates.find(item => item.id === compareBranchId);
    const target = $('compare-baseline'); target.replaceChildren();
    const comparisonEvidence = normalizeFreshEvidence(comparisonBranch, evidence);
    for (const claim of comparisonEvidence?.baselineClaims || []) appendFreshSourceClaim(target, claim, comparisonEvidence.sources);
    if (!target.childElementCount) { const item = document.createElement('li'); item.textContent = 'No baseline claim has a valid source link.'; target.append(item); }
    const comparisonUnverified = freshUnverifiedClaims(comparisonBranch, comparisonEvidence);
    textList($('compare-unverified'), comparisonUnverified.length ? comparisonUnverified : ['No explicit unverified-claims list was recorded.']);
    $('compare-assumption').textContent = comparisonBranch.changedAssumption || 'No changed assumption recorded.';
    textList($('compare-steps'), Array.isArray(comparisonBranch.causalSteps) ? comparisonBranch.causalSteps : []);
    $('compare-uncertainty').textContent = comparisonBranch.uncertainty || 'No uncertainty note recorded.';
    $('compare-limits').textContent = comparisonBranch.doesNotEstablish || 'Retrieved excerpts do not establish that the imagined events occurred.';
  }
  $('learning-method').textContent = `Method: Retrieved excerpt; model-derived claims${clean.method?.label ? ` · ${clean.method.label}` : ''}. Retrieval does not constitute human verification.`;
  lessonExportContent = freshLessonMarkdown({ run: { divergence: $('prompt').value }, branch, comparisonBranch, evidence: clean,
    supportedTopics: Array.isArray(clean.supportedTopics) ? clean.supportedTopics : [] });
  $('download-lesson').hidden = !lessonExportContent;
  const citations = $('learning-sources'); citations.replaceChildren();
  for (const source of sources.filter(source => claims.some(claim => claim.sourceIds.includes(source.id)))) {
    const item = document.createElement('li'); const link = document.createElement('a'); link.textContent = source.title || source.id;
    try { const url = new URL(source.url); if (!['https:', 'http:'].includes(url.protocol)) throw new Error('Unsupported URL'); link.href = url.href; link.target = '_blank'; link.rel = 'noopener noreferrer'; } catch { link.textContent += ' (link unavailable)'; }
    item.append(link); citations.append(item);
  }
  $('learning-content').hidden = false;
  return true;
}
function renderLearningPanel() {
  const panel = $('learning-panel');
  const branch = branchState.branches.find(item => item.id === selectedBranchId);
  panel.hidden = !branch;
  $('show-evidence').hidden = !branch;
  if (!branch) return;
  $('learning-content').hidden = true;
  $('learning-score').hidden = true;
  $('download-lesson').hidden = true;
  $('learning-comparison').hidden = true;
  lessonExportContent = '';
  if (renderFreshLearning(branch, freshEvidenceEnvelope)) return;
  if (learningState === 'loading') {
    $('learning-status').textContent = 'Loading the source notes for this saved story…';
    return;
  }
  if (learningState !== 'ready' || !learningEvidence) {
    $('learning-status').textContent = currentRunId
      ? 'Source notes are not available for this saved story. The branch remains an imagined path; no historical sources are attached here.'
      : 'Source notes are available for selected saved stories. This live exploration has no curated source set.';
    return;
  }
  const run = learningEvidence.run;
  const evidenceBranch = Array.isArray(run?.branches)
    ? run.branches.find(item => item.branchId === branch.id)
    : null;
  if (!evidenceBranch) {
    $('learning-status').textContent = 'No source notes are available for this branch. Its events remain imagined.';
    return;
  }
  $('learning-status').textContent = `Selected branch: ${evidenceBranch.title || branch.title}. Historical notes and the imagined sequence are shown separately.`;
  const alternateBranches = Array.isArray(run.branches) ? run.branches.filter(item => item.branchId !== branch.id) : [];
  const comparison = $('learning-comparison');
  comparison.hidden = alternateBranches.length === 0;
  $('comparison-content').hidden = alternateBranches.length === 0;
  let comparisonBranch = null;
  if (alternateBranches.length) {
    const compareSelect = $('compare-branch');
    compareSelect.replaceChildren(...alternateBranches.map(item => new Option(item.title, item.branchId)));
    if (!alternateBranches.some(item => item.branchId === compareBranchId)) compareBranchId = alternateBranches[0].branchId;
    compareSelect.value = compareBranchId;
    comparisonBranch = alternateBranches.find(item => item.branchId === compareBranchId);
    renderSourceFacts($('compare-baseline'), comparisonBranch.baselineSourceIds || [], learningEvidence.sources || []);
    $('compare-assumption').textContent = comparisonBranch.changedAssumption || 'No changed assumption recorded.';
    textList($('compare-steps'), Array.isArray(comparisonBranch.causalSteps) ? comparisonBranch.causalSteps : []);
    $('compare-uncertainty').textContent = comparisonBranch.uncertainty || 'No uncertainty note recorded.';
  }
  const sources = Array.isArray(learningEvidence.sources) ? learningEvidence.sources : [];
  const baselineIds = Array.isArray(evidenceBranch.baselineSourceIds) ? evidenceBranch.baselineSourceIds : [];
  const baselineItems = baselineIds.map(id => ({ id, source: sources.find(item => item.id === id) })).filter(item => item.source);
  renderSourceFacts($('learning-baseline'), baselineIds, sources);
  $('learning-assumption').textContent = evidenceBranch.changedAssumption || 'No changed assumption was recorded.';
  textList($('learning-steps'), Array.isArray(evidenceBranch.causalSteps) ? evidenceBranch.causalSteps : []);
  $('learning-uncertainty').textContent = evidenceBranch.uncertainty || 'Uncertainty was not recorded for this branch.';
  textList($('learning-unverified'), Array.isArray(evidenceBranch.unverifiedClaims) && evidenceBranch.unverifiedClaims.length
    ? evidenceBranch.unverifiedClaims
    : ['No explicit unverified-claims list was recorded.']);
  $('learning-demonstrates').textContent = evidenceBranch.demonstrates || 'The scene illustrates the selected imagined path.';
  $('learning-limits').textContent = evidenceBranch.doesNotEstablish || 'This visualization is not evidence that the imagined events occurred.';
  $('learning-question').textContent = evidenceBranch.discussionQuestion || 'Which assumption most changes the outcome, and what evidence could help test it?';
  const score = Number.isFinite(branch.score) ? branch.score : Number.isFinite(evidenceBranch.modelReviewScore) ? evidenceBranch.modelReviewScore : null;
  if (score !== null) {
    $('learning-score').textContent = `Model review score: ${score}/10 · a ranking signal for this branch, not a probability that it would happen.`;
    $('learning-score').hidden = false;
  }
  const method = learningEvidence.method;
  $('learning-method').textContent = method?.label
    ? `Method: ${method.label}${method.scope ? ` · ${method.scope}` : ''}${method.role ? ` · ${method.role}` : ''}${method.reviewedAgainst ? ` · reviewed against ${method.reviewedAgainst}` : ''}${method.scoreDisclaimer ? ` ${method.scoreDisclaimer}` : ''}`
    : 'Historical sources establish the starting baseline; the changed path and its causal steps are hypothetical.';
  lessonExportContent = lessonMarkdown({ run, branch, evidenceBranch, comparisonBranch, sources, method: learningEvidence.method, score });
  $('download-lesson').hidden = !lessonExportContent;
  const citations = $('learning-sources'); citations.replaceChildren();
  for (const source of baselineItems.map(item => item.source)) {
    const item = document.createElement('li');
    const link = document.createElement('a'); link.textContent = source.title || source.id;
    try { const url = new URL(source.url); if (!['https:', 'http:'].includes(url.protocol)) throw new Error('Unsupported URL'); link.href = url.href; link.target = '_blank'; link.rel = 'noopener noreferrer'; }
    catch { link.textContent += ' (link unavailable)'; }
    item.append(link); citations.append(item);
  }
  $('learning-content').hidden = false;
}
function selectBranch(branch) {
  if (!branch?.id) return;
  selectedBranchId = branch.id;
  document.body.classList.add('has-story');
  const context = $('selected-branch-context');
  context.replaceChildren();
  if (!branchState.heroId || branch.id === branchState.heroId) context.hidden = true;
  else {
    const label = document.createElement('strong'); label.textContent = `Selected alternate · ${branch.title}. `;
    context.append(label, document.createTextNode(`${branch.summary || 'An alternate path through this moment.'} Scene and 3D preview show the reviewed hero path: ${$('hero-title').textContent}.`));
    context.hidden = false;
  }
  globeApi?.select(branch);
  for (const button of $('branch-list').querySelectorAll('[data-branch-id]')) {
    const selected = button.dataset.branchId === selectedBranchId;
    button.classList.toggle('selected', selected);
    button.setAttribute('aria-pressed', String(selected));
  }
  renderLearningPanel();
}
function renderTrace() { renderHeroModels(); }
function metricText(item, fallback = 'Not recorded in this replay') {
  if (!item?.available) return replayActive ? 'Pending' : replayLoaded ? fallback : 'No replay loaded';
  const duration = Number.isFinite(item?.ms) ? `${(item.ms / 1000).toFixed(1)}s` : 'Time not recorded';
  const cost = Number.isFinite(item?.costUsd) ? `$${item.costUsd.toFixed(4)}` : 'Cost not recorded';
  return `${duration} · ${cost}`;
}
function renderHeroModels() {
  const host = $('hero-models'); host.replaceChildren();
  const recorded = trace.some(s => !s.summary);
  host.hidden = !recorded && !replayActive && !replayLoaded;
  const models = modelCardSteps(trace, replayLoaded ? savedTrace : trace).map(item => ({
    ...item, metrics: `${metricText(item)}${replayActive && item.available && item.pending ? ' · more steps pending' : ''}`,
  }));
  for (const item of models) {
    const card = document.createElement('div'); card.className = 'hero-model-card';
    const model = document.createElement('strong'); model.textContent = item.model;
    const role = document.createElement('span'); role.textContent = item.role;
    const metrics = document.createElement('small'); metrics.textContent = item.metrics;
    card.append(model, role, metrics); host.append(card);
  }
}
function reset() { replayRequest++; branchState = { branches: [], heroId: null, phase: 'idle' }; trace = []; savedTrace = []; selectedBranchId = null; replayActive = false; replayLoaded = false; currentRunId = ''; learningEvidence = null; freshEvidenceEnvelope = null; learningState = 'none'; lessonExportContent = ''; compareBranchId = ''; base = ''; hasImage = hasCutout = hasModel = false; modelAsset = ''; modelLoading = modelLoaded = modelError = false; loadingModelUrl = ''; modelRequestId++; globeApi?.select(null); document.body.classList.remove('has-story', 'invitation-open'); $('guardrail').hidden = true; $('generation').hidden = true; $('map-status').textContent = 'DRAG TO EXPLORE'; setFreshRunStatus(''); $('hero-title').textContent = 'A world to step into'; $('hero-tag').textContent = branchPhaseLabel('idle'); $('hero-description').textContent = 'The strongest branch becomes a scene, then a subject to explore in three dimensions.'; $('selected-branch-context').hidden = true; $('selected-branch-context').replaceChildren(); $('learning-panel').hidden = true; $('learning-comparison').open = false; $('show-evidence').hidden = true; $('download-lesson').hidden = true; setStageMessage('A scene, a subject, a new dimension.'); renderBranches(); renderTrace(); setView('scene'); }
function setBranch(data, event = 'complete') {
  branchState = branchProgress(branchState, event, data);
  $('hero-tag').textContent = branchPhaseLabel(branchState.phase);
  if (branchState.phase === 'blocked') { showGuard(data); $('map-status').textContent = 'NO BRANCHES · REFRAME REQUIRED'; setFreshRunStatus('The prompt was stopped by topic policy before source retrieval. Reframe it or open a saved story.', { kind: 'error', stageMessage: 'This prompt was blocked before branch or image generation.' }); status('This question needs a reframe'); renderBranches(); return; }
  if (['evidence-unavailable', 'ungrounded', 'empty'].includes(branchState.phase)) {
    const message = branchState.phase === 'empty'
      ? 'No suitable branches passed review. No image was generated. Try another supported prompt or open a saved story from the archive.'
      : completionStatus(data.branch || data);
    const mapLabel = branchState.phase === 'evidence-unavailable' ? 'FRESH EVIDENCE UNAVAILABLE' : branchState.phase === 'ungrounded' ? 'NO GROUNDED PATHS' : 'NO SUITABLE PATHS';
    setFreshRunStatus(message, { kind: 'error', mapLabel, stageMessage: message });
    $('hero-title').textContent = 'No path to render';
    $('hero-description').textContent = message;
    setStageMessage(message);
    renderBranches(); renderLearningPanel(); status(message); return;
  }
  renderBranches();
  const hero = branchState.branches.find(b => b.id === branchState.heroId);
  if (hero) { selectedBranchId = hero.id; $('hero-title').textContent = hero.title; $('hero-description').textContent = hero.summary; $('selected-branch-context').hidden = true; if (!hasImage) setStageMessage('Preparing the selected scene…'); syncBranchSelection(); globeApi?.focus(hero); }
  renderLearningPanel();
}
function syncBranchSelection() {
  for (const button of $('branch-list').querySelectorAll('[data-branch-id]')) {
    const selected = button.dataset.branchId === selectedBranchId;
    button.classList.toggle('selected', selected);
    button.setAttribute('aria-pressed', String(selected));
  }
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
async function replaySavedBranches(branch, records = [], request = replayRequest) {
  const branches = Array.isArray(branch.branches) ? branch.branches : [];
  const liveRecords = records.filter(step => !step.summary);
  const groups = replayTraceGroups(records);
  const reveal = index => {
    if (request !== replayRequest) return;
    trace = groups.slice(0, index + 1).flat();
    renderTrace();
  };
  const pause = async ms => { await new Promise(resolve => setTimeout(resolve, ms)); return request === replayRequest; };
  if (request !== replayRequest) return;
  replayLoaded = true;
  savedTrace = liveRecords;
  replayActive = true;
  trace = [];
  setStageMessage('Reviewing the recorded paths…');
  renderTrace();
  reveal(0);
  if (!branches.length || branch.status === 'blocked' || branch.status === 'empty') {
    setBranch(branch);
    replayActive = false;
    renderTrace();
    return;
  }

  if (!await pause(220)) return;
  reveal(1);
  for (let i = 1; i <= branches.length; i++) {
    if (request !== replayRequest) return;
    const arriving = branches[i - 1];
    branchState = { branches: branches.slice(0, i), heroId: null, phase: 'replay' };
    selectedBranchId = arriving.id;
    $('hero-tag').textContent = `CACHED REPLAY · ${i}/${branches.length} PATHS`;
    $('map-status').textContent = `CACHED REPLAY · ${i} OF ${branches.length} PATHS`;
    status(`Replaying saved branches · ${i} of ${branches.length}`);
    renderBranches();
    globeApi?.focus(arriving);
    if (i < branches.length && !await pause(2200)) return;
  }
  if (request !== replayRequest) return;
  reveal(2);
  if (!await pause(300)) return;
  setBranch(branch);
  $('map-status').textContent = `CACHED REPLAY · ${branches.length} PATHS`;
  if (!await pause(180)) return;
  reveal(3);
  if (!await pause(220)) return;
  reveal(4);
  if (!await pause(220)) return;
  reveal(5);
  if (request !== replayRequest) return;
  replayActive = false;
  renderTrace();
}
async function loadAssets(preferredView, request = null) {
  if (!base) return false;
  const currentBase = base;
  const [image, cutout, meshoptModel, model] = await Promise.all(['hero.png','cutout.png','model.meshopt.glb','model.glb'].map(n => exists(`${currentBase}/${n}`)));
  if (request !== null && request !== replayRequest) return false;
  hasImage = image; hasCutout = cutout; hasModel = meshoptModel || model; modelAsset = meshoptModel ? 'model.meshopt.glb' : model ? 'model.glb' : '';
  if (image) $('hero-image').src = `${currentBase}/hero.png`; if (cutout) $('cutout-image').src = `${currentBase}/cutout.png`;
  if (!image) setStageMessage('No hero scene image was saved with this story.');
  setView(preferredView || (cutout ? 'cutout' : hasModel ? 'model' : 'scene'));
  return true;
}
async function loadRun(id) {
  if (!id) return; reset(); const request = replayRequest; currentRunId = id; learningState = 'loading'; base = `/runs/${encodeURIComponent(id)}`; status('Opening saved story…');
  try {
    const evidencePromise = fetch(`/runs/${encodeURIComponent(id)}/evidence`).then(async response => response.ok ? await response.json() : null).catch(() => null);
    const [branchResponse, traceResponse, manifestResponse, evidence] = await Promise.all([fetch(asset('branch.json')),fetch(asset('trace.json')),fetch(base),evidencePromise]);
    if (request !== replayRequest) return;
    if (!branchResponse.ok) throw new Error('Could not load this cached story');
    const branch = await branchResponse.json(); const record = traceResponse.ok ? await traceResponse.json() : {};
    const manifest = manifestResponse.ok ? await manifestResponse.json() : {};
    if (request !== replayRequest) return;
    learningEvidence = evidence;
    learningState = evidence ? 'ready' : 'unavailable';
    if (evidence?.run?.branches?.some(item => Array.isArray(item.baselineClaims))) {
      // The endpoint returns a digest-checked projection; its presence is the
      // authority for treating this replay envelope as retrieved evidence.
      freshEvidenceEnvelope = { status: evidence.sources?.length ? 'retrieved' : 'unavailable', retrievedAt: evidence.authoredAt, sources: evidence.sources || [], method: evidence.method };
    }
    $('prompt').value = branch.divergence || '';
    const records = record.steps || branch.trace || [];
    const focusTarget = branch.status === 'blocked' ? $('guardrail') : $('workspace');
    focusTarget.scrollIntoView({ behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth', block: 'start' });
    await replaySavedBranches(branch, records, request);
    if (request !== replayRequest) return;
    renderLearningPanel();
    if (!await loadAssets('scene', request) || request !== replayRequest) return;
    status(manifest.status === 'simulated' ? 'Simulated guardrail · no classifier was called' : branch.status === 'blocked' ? 'This question needs a reframe' : branch.renderStatus === '2d-only' ? completionStatus(branch) : manifest.status === 'provisional' ? '2D preview · 3D model not generated' : 'Saved story ready');
  } catch (e) { if (request === replayRequest) status(e.message); }
}
async function handleEvent(type, data) {
  if (type === 'evidence') {
    freshEvidenceEnvelope = data.evidence || data;
    if (['retrieved', 'unavailable'].includes(freshEvidenceEnvelope.status)) {
      const retrieved = freshEvidenceEnvelope.status === 'retrieved';
      const message = freshRetrievalStatus(freshEvidenceEnvelope);
      setFreshRunStatus(message, { kind: retrieved ? 'progress' : 'error', mapLabel: retrieved ? 'FETCHING BASELINE EVIDENCE' : 'FRESH EVIDENCE UNAVAILABLE', stageMessage: retrieved ? 'Retrieved excerpts are being checked against branch claims…' : message });
      status(message);
    }
    renderLearningPanel();
  }
  if (type === 'policy') {
    if (data.allowed === false || data.status === 'blocked') {
      showGuard(data);
      setFreshRunStatus('The prompt was stopped by topic policy before source retrieval. Reframe it or open a saved story.', { kind: 'error', mapLabel: 'NO BRANCHES · REFRAME REQUIRED', stageMessage: 'This prompt was blocked before branch or image generation.' });
    } else setFreshRunStatus('Prompt passed topic policy; retrieving excerpts from the registered public sources…', { mapLabel: 'RETRIEVING BASELINE', stageMessage: 'Retrieving approved-source excerpts before branch generation…' });
    status(data.allowed === false ? 'This question needs a reframe' : 'Policy checked');
  }
  if (type === 'propose' || type === 'review') {
    setBranch(data, type);
    if (type === 'propose' && branchState.phase === 'policy-checking') setFreshRunStatus('Checking topic policy before displaying candidate paths…', { mapLabel: 'CHECKING TOPIC POLICY', stageMessage: 'Checking candidate paths against topic policy…' });
    else if (type === 'propose' && branchState.phase === 'provisional') setFreshRunStatus('Policy-cleared candidates are ready; branch review is in progress.', { mapLabel: 'REVIEWING PATHS', stageMessage: 'Reviewing grounded branch claims and causal consistency…' });
    else if (type === 'review' && branchState.phase === 'reviewed') setFreshRunStatus('Branch review is complete; generating the selected scene.', { mapLabel: 'GENERATING SCENE', stageMessage: 'Generating the selected branch scene…' });
    if (type === 'propose' && branchState.branches.length) globeApi?.focus(branchState.branches[0]);
    status(type === 'propose' && branchState.phase === 'policy-checking' ? 'Topic policy checking · candidate text is not shown yet' : type === 'propose' && branchState.phase === 'empty' ? 'No suitable branches found' : type === 'propose' ? 'Policy-cleared paths · review in progress' : 'Hero selected · assets generating');
  }
  if (data.trace) { trace = Array.isArray(data.trace) ? data.trace : data.trace.steps || trace; renderTrace(); }
  else if (data.ms != null || data.costUsd != null) { trace.push({ step: type, model: data.model, ms: data.ms, costUsd: data.costUsd }); renderTrace(); }
  if (data.runId || data.id && type === 'complete') base = `/runs/${encodeURIComponent(data.runId || data.id)}`;
  if (data.baseUrl) base = data.baseUrl;
  if (type === 'image' || type === 'cutout' || type === '3d' || type === 'complete') {
    if (type === 'image') setFreshRunStatus('Hero scene generated; preparing subject segmentation…', { mapLabel: 'PREPARING CUTOUT', stageMessage: 'Preparing the SAM 3.1 subject mask…' });
    if (type === 'cutout') { const unavailable = data.status === 'unavailable'; $('generation').hidden = unavailable; if (unavailable) status(completionStatus({ renderStatus: '2d-only' })); else setFreshRunStatus('Subject cutout is ready; finishing the run…', { mapLabel: 'FINISHING RUN', stageMessage: 'Subject cutout ready.' }); }
    if (type === '3d' || type === 'complete') $('generation').hidden = true;
    await loadAssets(type === '3d' || (type === 'complete' && hasModel) ? 'model' : undefined);
  }
  if (type === 'error') { if (branchState.phase === 'policy-checking') { branchState = { branches: [], heroId: null, phase: 'idle' }; $('hero-tag').textContent = branchPhaseLabel('idle'); renderBranches(); } $('generation').hidden = true; setFreshRunStatus('Live generation failed before a completed result was confirmed. Open a saved story from the archive.', { kind: 'error', stageMessage: 'Live generation did not complete.' }); status('The live run could not be completed. Open a saved story from the archive.'); }
  else if (type === 'complete') { const result = data.branch || data; if (result.evidence?.status) freshEvidenceEnvelope = result.evidence; setBranch(result); renderLearningPanel(); if (result.status === 'ok' && result.evidence?.status === 'retrieved') setFreshRunStatus(`${freshRetrievalStatus(result.evidence)} Fresh branch generation is complete.`, { mapLabel: 'FRESH BRANCH READY', stageMessage: 'Fresh branch and scene are ready to explore.' }); status(completionStatus(result)); }
}
async function runPrompt(prompt) {
  if (!prompt.trim()) return; const code = $('access').value;
  if (serviceMode === 'replay-only') { status('Showing saved runs · live generation by invite'); return; }
  if (serviceMode !== 'live-enabled') { status('Service mode could not be confirmed · open a cached story below'); return; }
  if (!code) { status('Select a cached story, or enter a live access code.'); return; }
  reset(); const request = replayRequest; $('prompt').value = prompt; setFreshRunStatus('Checking the prompt against topic policy…', { mapLabel: 'CHECKING TOPIC POLICY', stageMessage: 'Checking the prompt before source retrieval…' }); status('Checking your question…');
  try {
    const response = await fetch('/api/run', { method:'POST', headers:{'content-type':'application/json','x-demo-access-code':code}, body:JSON.stringify({divergence:prompt}) });
    if (request !== replayRequest) return;
    if (!response.ok || !response.body) { let msg = `Unable to start (${response.status})`; try { const body = await response.json(); msg = body.error || msg; } catch {} throw new Error(msg); }
    const reader = response.body.getReader(), decoder = new TextDecoder(); let buffer = '';
    while (true) { const {value,done} = await reader.read(); buffer += decoder.decode(value || new Uint8Array(), {stream:!done}); let match;
      if (request !== replayRequest) return;
      while ((match = buffer.match(/\r?\n\r?\n/))) { const block = buffer.slice(0,match.index); buffer = buffer.slice(match.index + match[0].length); const e = parseSseBlock(block); if (e && request === replayRequest) await handleEvent(e.event, e.data); }
      if (done) break;
    }
  } catch(e) { if (request === replayRequest) { status(e.message); $('generation').hidden = true; } }
}
$('prompt-form').addEventListener('submit', e => { e.preventDefault(); runPrompt($('prompt').value); });
 $('show-invitation').addEventListener('click', () => {
  if (matchMedia('(max-width: 700px)').matches) {
    document.body.classList.toggle('invitation-open');
    $('show-invitation').setAttribute('aria-expanded', String(document.body.classList.contains('invitation-open')));
  } else $('show-invitation').setAttribute('aria-expanded', 'true');
  $('prompt').focus({ preventScroll: true });
 });
document.querySelectorAll('[data-prompt]').forEach(button => button.addEventListener('click', () => {
  const prompt = button.dataset.prompt;
  const suggestion = suggestionAction(serviceMode, savedRuns, prompt);
  if (suggestion.action === 'open-saved-run') {
      $('runs').value = suggestion.run.id;
      loadRun(suggestion.run.id);
      return;
  }
  if (suggestion.action === 'no-saved-match') {
    $('prompt').value = prompt;
    status('No saved story matches this question yet. Choose another saved story below.');
  } else {
    $('prompt').value = prompt;
    if (serviceMode === 'unknown') status('Service mode could not be confirmed · open a cached story below');
  }
  $('prompt').focus({ preventScroll: true });
}));
$('retry').addEventListener('click', () => {
  const prompt = $('retry').dataset.prompt; $('prompt').value = prompt;
  if ($('access').value) { runPrompt(prompt); return; }
  const cached = cachedRetryRun(savedRuns, prompt);
  if (cached) { $('runs').value = cached.id; loadRun(cached.id); }
  else status('No cached story matches this suggestion; select another story or enter a live access code.');
});
$('load-run').addEventListener('click', () => loadRun($('runs').value));
$('compare-branch').addEventListener('change', () => {
  compareBranchId = $('compare-branch').value;
  renderLearningPanel();
});
$('download-lesson').addEventListener('click', () => {
  if (!lessonExportContent) return;
  const title = branchState.branches.find(branch => branch.id === selectedBranchId)?.title || 'scenario-brief';
  const filename = `${title.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'scenario-brief'}.md`;
  const url = URL.createObjectURL(new Blob([lessonExportContent], { type: 'text/markdown;charset=utf-8' }));
  const link = document.createElement('a'); link.href = url; link.download = filename; link.hidden = true; document.body.append(link); link.click(); link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
});
$('scene-view').addEventListener('click', () => setView('scene')); $('cutout-view').addEventListener('click', () => setView('cutout')); $('model-button').addEventListener('click', () => setView('model'));
document.querySelector('[role="tablist"]').addEventListener('keydown', event => {
  const tabs = [...document.querySelectorAll('[role="tab"]')].filter(tab => !tab.disabled);
  const current = tabs.indexOf(event.target);
  if (current < 0) return;
  const next = event.key === 'ArrowRight' ? (current + 1) % tabs.length
    : event.key === 'ArrowLeft' ? (current - 1 + tabs.length) % tabs.length
      : event.key === 'Home' ? 0 : event.key === 'End' ? tabs.length - 1 : -1;
  if (next < 0) return;
  event.preventDefault(); tabs[next].focus(); tabs[next].click();
});
$('orbit-button').addEventListener('click', () => {
  const enabled = $('orbit-button').getAttribute('aria-pressed') !== 'true';
  const active = modelApi?.setAutoRotate(enabled) || false;
  $('orbit-button').setAttribute('aria-pressed', String(active));
  $('orbit-button').textContent = active ? 'Pause orbit' : 'Orbit object';
});
$('orbit-button').disabled = reducedMotion.matches;
reducedMotion.addEventListener?.('change', () => {
  $('orbit-button').disabled = reducedMotion.matches || !modelLoaded;
  if (reducedMotion.matches) {
    modelApi?.setAutoRotate(false);
    $('orbit-button').setAttribute('aria-pressed', 'false');
    $('orbit-button').textContent = 'Orbit object';
  }
});
$('back-to-atlas').addEventListener('click', () => { setView('scene'); $('scene-view').focus({ preventScroll: true }); });
$('show-evidence').addEventListener('click', () => {
  setView('scene');
  requestAnimationFrame(() => {
    $('learning-panel').scrollIntoView({ behavior: reducedMotion.matches ? 'auto' : 'smooth', block: 'nearest' });
    $('learning-title').tabIndex = -1;
    $('learning-title').focus({ preventScroll: true });
  });
});
$('retry-model').addEventListener('click', () => { loadedModelUrl = ''; loadingModelUrl = ''; modelError = false; requestModelLoad(); setView('model'); });
reset();
async function loadSavedRuns() {
  const picker = $('runs');
  try {
    const response = await fetch('/runs');
    if (!response.ok) throw new Error(`Archive unavailable (${response.status})`);
    const data = await response.json();
    const runs = (Array.isArray(data) ? data : Array.isArray(data?.runs) ? data.runs : [])
      .filter(run => run && typeof run.id === 'string' && run.id);
    savedRuns = runs;
    picker.replaceChildren();
    if (!runs.length) {
      picker.add(new Option('No saved stories yet', ''));
      $('archive-status').textContent = 'No saved stories are available right now.';
      return;
    }
    picker.add(new Option('Choose a saved story…', ''));
    for (const run of runs) picker.add(new Option(replayLabel(run), run.id));
    $('archive-status').textContent = `${runs.length} saved ${runs.length === 1 ? 'entry' : 'entries'} ready to open.`;
  } catch (error) {
    savedRuns = [];
    picker.replaceChildren(new Option('Archive unavailable', ''));
    $('archive-status').textContent = 'Saved stories could not be reached. Try reloading the page.';
    status(error.message || 'Saved stories could not be reached');
  }
}
async function initializeEntryPoints() {
  await Promise.all([loadServiceMode(), loadSavedRuns()]);
  $('runs').disabled = savedRuns.length === 0;
  $('load-run').disabled = savedRuns.length === 0;
  for (const button of document.querySelectorAll('[data-prompt]')) button.disabled = false;
  if (serviceMode === 'replay-only') {
    $('archive-status').textContent = savedRuns.length
      ? `${savedRuns.length} saved ${savedRuns.length === 1 ? 'entry' : 'entries'} ready · choose a question to open its story.`
      : 'No saved stories are available right now.';
  } else if (serviceMode === 'unknown') {
    $('archive-status').textContent = savedRuns.length
      ? `${savedRuns.length} saved ${savedRuns.length === 1 ? 'entry' : 'entries'} ready. Live access could not be confirmed.`
      : 'Archive and live access could not be confirmed.';
  }
}
initializeEntryPoints();
import('./visuals.js').then(async ({createGlobe,createModelViewer}) => {
  // The independent model viewer can stay available if the globe CDN fails.
  try { modelApi = createModelViewer($('model-view')); setView(activeView); }
  catch { modelApi = null; setView(activeView); }
  try {
    globeApi = await createGlobe($('globe'), selectBranch);
    renderBranches();
    const visibleBranch = branchState.phase === 'replay' ? branchState.branches.at(-1) : branchState.branches.find(branch => branch.id === branchState.heroId);
    if (visibleBranch) globeApi.focus(visibleBranch);
  } catch { $('globe-fallback').hidden = false; }
}).catch(() => { $('globe-fallback').hidden = false; });
