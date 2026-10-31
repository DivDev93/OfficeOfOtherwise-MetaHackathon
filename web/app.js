import { retryPrompt, formatYear, modelCardSteps, replayTraceGroups, parseSseBlock, availableView, completionStatus, cachedRetryRun, replayLabel, branchProgress, branchPhaseLabel, liveAccessMode, modelLoadProgress, continuationAction, createNavigationGuard, runIdFromHash, eventIdFromHash } from './logic.js';
import { createVoiceInput } from './voice.js';
import { safeGeography, visibleChanges, createGeographyRenderer, drawGeographyCanvas } from './geographyTexture.js';
import { REGIONS, GEOGRAPHY_STYLES } from './geographyRegions.js';
import { createStarMap } from './starmap.js?v=event-preview-2';
const $ = id => document.getElementById(id);
const voice = createVoiceInput({ prompt: $('prompt'), access: $('access'), controls: $('voice-controls'), record: $('voice-record'), stop: $('voice-stop'), cancel: $('voice-cancel'), message: $('voice-status') });
let voiceEnabled = false, localReviewAccess = false;
const hasLiveAccess = () => localReviewAccess || !!$('access').value;
const reducedMotion = matchMedia('(prefers-reduced-motion: reduce)');
let branchState = { branches: [], heroId: null, phase: 'idle' }, serviceMode = 'unknown', base = '', hasImage = false, hasCutout = false, hasModel = false, modelAsset = '', modelLoading = false, modelLoaded = false, modelError = false, modelRequestId = 0, loadingModelUrl = '', loadedModelUrl = '', activeView = 'scene', globeApi = null, modelApi = null, trace = [], savedTrace = [], savedRuns = [], selectedBranchId = null, replayActive = false, replayLoaded = false, replayRequest = 0;
const navigation = createNavigationGuard();
const knownRunMetadata = new Map();
const knownRunManifests = new Map(), manifestRequests = new Map();
let currentRunId = '', currentManifest = null, continuation = { path: [], children: [] }, streamBusy = false, selectedContext = null, continuationViewSelection = null;
let treeRenderRequest = 0, serviceModeReady = Promise.resolve(), rootGenerationActive = false;
let lastHandledLocationHash = location.hash;
let assetLoadRequest = 0, assetsLoading = false;
let savedNavigationState = '';
let starMapApi = null, starMapNodes = [];
let surfaceGeography, surfaceMode = 'scenario', surfaceUnavailable = false;
const eventWork = new Map();
const eventQueue = [];
let activeEventJobs = 0;
const MAX_EVENT_JOBS = 3;
const savedSceneCheckQueue = [];
let activeSavedSceneChecks = 0;
const MAX_SAVED_SCENE_CHECKS = 3;
const CAPACITY_RETRY_DELAYS = [500, 1000, 2000, 4000, 8000, 16000, 30000, 30000, 28000];
function enqueueEventJob(job) {
  return new Promise((resolve, reject) => {
    eventQueue.push({ job, resolve, reject });
    pumpEventJobs();
  });
}
function pumpEventJobs() {
  while (activeEventJobs < MAX_EVENT_JOBS && eventQueue.length) {
    const next = eventQueue.shift();
    activeEventJobs++;
    Promise.resolve().then(next.job).then(next.resolve, next.reject).finally(() => {
      activeEventJobs--;
      pumpEventJobs();
    });
  }
}
function enqueueSavedSceneCheck(job) {
  return new Promise((resolve, reject) => {
    savedSceneCheckQueue.push({ job, resolve, reject });
    pumpSavedSceneChecks();
  });
}
function pumpSavedSceneChecks() {
  while (activeSavedSceneChecks < MAX_SAVED_SCENE_CHECKS && savedSceneCheckQueue.length) {
    const next = savedSceneCheckQueue.shift();
    activeSavedSceneChecks++;
    Promise.resolve().then(next.job).then(next.resolve, next.reject).finally(() => {
      activeSavedSceneChecks--;
      pumpSavedSceneChecks();
    });
  }
}
async function postWithCapacityRetry(url, options, onRetry = () => {}) {
  let response, detail = {};
  for (let attempt = 0; attempt <= CAPACITY_RETRY_DELAYS.length; attempt++) {
    response = await fetch(url, options);
    if (response.ok) return { response, detail };
    detail = {}; try { detail = await response.json(); } catch {}
    if (response.status !== 429 || detail.status !== 'retryable' || attempt === CAPACITY_RETRY_DELAYS.length) return { response, detail };
    const delay = CAPACITY_RETRY_DELAYS[attempt];
    onRetry(delay, attempt + 1, CAPACITY_RETRY_DELAYS.length);
    await new Promise(resolve => setTimeout(resolve, delay));
  }
  return { response, detail };
}
const eventKey = (runId, branchId) => JSON.stringify([runId, branchId]);
const isSelected = (runId, branchId) => currentRunId === runId && selectedBranchId === branchId;
const taskLabel = state => state === 'needs-access' && serviceMode === 'replay-only' ? 'Run locally with Meta API key' : ({ 'not-started': 'Not explored', queued: 'Queued', 'in-progress': 'In progress', complete: 'Saved', uncertain: 'Needs review', failed: 'Failed', retryable: 'Can retry', 'needs-access': 'Needs live access', 'limit-reached': 'Step limit reached', empty: 'No consequences' })[state] || 'Status unavailable';
function consequenceState(runId, branchId, manifest = currentManifest) {
  if (!runId) return 'not-started';
  const work = eventWork.get(eventKey(runId, branchId));
  const edge = manifest?.continuation?.children?.find(item => item.branchId === branchId);
  if (work?.consequenceStatus) return work.consequenceStatus;
  if (edge?.status) return edge.status;
  if (work?.children?.length) return 'complete';
  if (work?.childrenMessage && /access/i.test(work.childrenMessage)) return 'needs-access';
  if (runId === currentRunId && serviceMode !== 'live-enabled' || runId === currentRunId && !hasLiveAccess()) return 'needs-access';
  return 'not-started';
}
function starNodeId(runId, branchId) { return `${encodeURIComponent(runId)}::${encodeURIComponent(branchId)}`; }
function localEventThumbnail(runId, branchId, manifest) {
  const work = eventWork.get(eventKey(runId, branchId));
  const prefix = `/runs/${encodeURIComponent(runId)}/`;
  const localImage = value => {
    if (typeof value !== 'string' || !value.startsWith(prefix)) return undefined;
    const filename = value.slice(prefix.length);
    return filename && !/[\\/%]/.test(filename) && /\.(?:png|webp|jpe?g)$/i.test(filename) ? value : undefined;
  };
  const eventScene = localImage(work?.sceneUrl) || (typeof work?.sceneUrl === 'string' && /^\/event-scenes\/[a-f0-9]{64}\.png$/.test(work.sceneUrl) ? work.sceneUrl : undefined);
  if (eventScene) return eventScene;
  const heroId = manifest.branch?.heroId || manifest.branch?.hero?.branchId || manifest.branch?.hero?.id;
  if (branchId === heroId && Array.isArray(manifest.assets) && manifest.assets.includes('hero.png')) return `${prefix}hero.png`;
  return undefined;
}
function eventSceneStatus(runId, branch, manifest) {
  if (localEventThumbnail(runId, branch.id, manifest)) return 'Scene ready';
  const work = eventWork.get(eventKey(runId, branch.id));
  if (!work) return 'Scene not checked';
  if (work.sceneQueued || work.sceneRunning) return 'Preparing scene';
  if (work.sceneInProgress) return 'Scene generation in progress';
  if (/access|run locally/i.test(work.sceneMessage || '')) return serviceMode === 'replay-only' ? 'Run locally for fresh scene generation' : 'Scene needs live access';
  if (work.sceneRetryable) return 'Scene unavailable · retry from the story list';
  if (work.sceneCheckDone) return work.sceneCheckStatus === 'missing' ? 'No saved scene' : 'Scene unavailable';
  if (work.sceneOnlyComplete || work.sceneMessage) return 'Scene unavailable';
  return 'Scene not checked';
}
function buildStarMapNodes(rootManifest) {
  const output = [], visited = new Set();
  const walk = (manifest, parentId = null, depth = 0) => {
    if (!manifest?.branch || !manifest.id || depth > 6 || visited.has(manifest.id) || output.length >= 80) return;
    visited.add(manifest.id);
    const parent = (manifest.continuation?.path || []).at(-1);
    const branchParentId = parent?.runId && parent?.branchId ? starNodeId(parent.runId, parent.branchId) : parentId;
    for (const branch of manifest.branch.branches || []) {
      if (!branch?.id || output.length >= 80) continue;
      const thumbnail = localEventThumbnail(manifest.id, branch.id, manifest);
      const sceneStatus = eventSceneStatus(manifest.id, branch, manifest);
      const consequences = consequenceState(manifest.id, branch.id, manifest);
      output.push({
        id: starNodeId(manifest.id, branch.id),
        runId: manifest.id,
        branchId: branch.id,
        title: branch.title || 'Untitled possibility',
        year: branch.year,
        summary: branch.summary || '',
        causalLink: branch.causalLink || '',
        location: typeof branch.location === 'string' ? branch.location : branch.location?.name || branch.place?.name || (typeof branch.place === 'string' ? branch.place : ''),
        status: sceneStatus,
        sceneStatus,
        consequencesStatus: taskLabel(consequences),
        scene: thumbnail,
        thumbnail,
        ready: !!thumbnail,
        parentId: branchParentId,
      });
    }
    for (const branch of manifest.branch.branches || []) {
      const edge = manifest.continuation?.children?.find(item => item.branchId === branch.id);
      const child = edge?.status === 'complete' && edge.runId ? knownRunManifests.get(edge.runId) : null;
      if (child) walk(child, starNodeId(manifest.id, branch.id), depth + 1);
    }
  };
  walk(rootManifest);
  return output;
}
function renderStarMap(rootManifest) {
  starMapNodes = rootManifest ? buildStarMapNodes(rootManifest) : [];
  const selectedId = starMapNodes.some(node => node.runId === currentRunId && node.branchId === selectedBranchId)
    ? starNodeId(currentRunId, selectedBranchId) : null;
  starMapApi?.setData({ nodes: starMapNodes, selectedId });
  if (rootManifest) checkHydratedEventScenes();
}
function checkHydratedEventScenes() {
  for (const node of starMapNodes) {
    if (node.thumbnail) continue;
    const manifest = knownRunManifests.get(node.runId);
    const branch = manifest?.branch?.branches?.find(item => item.id === node.branchId);
    if (branch) checkSavedEventScene(node.runId, branch, manifest);
  }
}
function checkSavedEventScene(runId, branch, manifest) {
  const key = eventKey(runId, branch.id);
  const work = eventWork.get(key) || { runId, branchId: branch.id, title: branch.title, children: [] };
  eventWork.set(key, work);
  if (localEventThumbnail(runId, branch.id, manifest) || work.sceneTaskPromise || work.sceneCheckDone || work.sceneCheckPromise) return;
  work.sceneCheckOnly = true;
  work.sceneQueued = true;
  work.sceneLoading = true;
  work.sceneMessage = 'Checking for a saved scene';
  const refresh = () => { if (isSelected(runId, branch.id)) renderEventWork(); else renderBranches(); };
  work.sceneCheckPromise = enqueueSavedSceneCheck(async () => {
    work.sceneQueued = false;
    work.sceneRunning = true;
    work.sceneLoading = true;
    refresh();
    try {
      const params = new URLSearchParams({ runId, branchId: branch.id });
      const response = await fetch(`/api/event-scene?${params}`);
      if (!response.ok) throw new Error('Could not check the saved scene');
      const result = await response.json();
      work.sceneCheckDone = true;
      if (result.status === 'complete' && result.url) {
        work.sceneUrl = result.url;
        work.sceneMessage = '';
        work.sceneRetryable = false;
        work.sceneInProgress = false;
      } else if (result.status === 'in-progress') {
        work.sceneMessage = 'Scene generation in progress';
        work.sceneInProgress = true;
        work.sceneRetryable = false;
        work.sceneCheckStatus = result.status;
      } else {
        work.sceneMessage = result.status === 'missing' ? 'No saved scene' : 'Saved scene unavailable';
        work.sceneInProgress = false;
        work.sceneRetryable = result.status !== 'missing';
        work.sceneCheckStatus = result.status;
      }
    } catch (error) {
      work.sceneCheckDone = true;
      work.sceneInProgress = false;
      work.sceneRetryable = true;
      work.sceneMessage = error.message || 'Could not check the saved scene';
    } finally {
      work.sceneQueued = false;
      work.sceneRunning = false;
      work.sceneLoading = false;
      work.sceneCheckOnly = false;
      work.interrupted = true;
      refresh();
    }
    return !!localEventThumbnail(runId, branch.id, manifest);
  });
}
async function selectStarMapNode(id) {
  const nodeId = typeof id === 'object' && id ? id.id : id;
  const node = starMapNodes.find(item => item.id === nodeId);
  if (!node?.ready) return;
  if (node.runId !== currentRunId) await loadRun(node.runId, { animate: false, autoConsequences: false, selectedBranchId: node.branchId });
  if (currentRunId !== node.runId) return;
  const branch = branchState.branches.find(item => item.id === node.branchId);
  if (branch) activateBranch(branch);
}
function closeExplorationMap() {
  const panel = $('exploration-map-panel');
  try { if (panel?.matches?.(':popover-open')) panel.hidePopover(); } catch {}
  $('open-exploration-map')?.focus({ preventScroll: true });
}
document.addEventListener('keydown', event => {
  if (event.key !== 'Escape') return;
  const panel = $('exploration-map-panel');
  if (!panel?.matches?.(':popover-open')) return;
  event.preventDefault(); event.stopPropagation(); closeExplorationMap();
});
$('close-exploration-map')?.addEventListener('click', () => setTimeout(() => $('open-exploration-map')?.focus({ preventScroll: true }), 0));
function initializeStarMap() {
  const container = $('starmap');
  if (!container) return;
  try { starMapApi = createStarMap(container, { nodes: starMapNodes, selectedId: null, onSelect: selectStarMapNode }); }
  catch { starMapApi = null; }
}
function renderExplorationTree(hydrate = false) {
  const host = $('exploration-tree-status');
  if (!host) { renderStarMap(null); return; }
  host.replaceChildren();
  if (!currentManifest?.branch || !currentRunId) { renderStarMap(null); return; }
  const selectedRunId = currentRunId;
  const rootRunId = continuation.rootRunId || currentRunId;
  const rootManifest = knownRunManifests.get(rootRunId) || (rootRunId === currentRunId ? currentManifest : null);
  if (!rootManifest) {
    $('branch-list')?.classList.toggle('visually-hidden', false);
    const request = ++treeRenderRequest;
    const loading = document.createElement('small'); loading.className = 'tree-loading'; loading.textContent = 'Loading saved exploration…'; host.append(loading);
    renderStarMap(null);
    treeManifest(rootRunId).then(manifest => {
      if (manifest && request === treeRenderRequest && currentRunId === selectedRunId && (continuation.rootRunId || currentRunId) === rootRunId) renderExplorationTree(true);
    });
    return;
  }
  $('branch-list')?.classList.toggle('visually-hidden', branchState.branches.length > 0);
  const rendered = new Set();
  let nodes = 0;
  const renderRun = (manifest, depth = 0) => {
    if (!manifest?.branch || depth > 6 || nodes >= 80 || rendered.has(manifest.id)) return null;
    rendered.add(manifest.id); nodes++;
    const run = document.createElement('section'); run.className = 'tree-run'; run.dataset.state = manifest.id === currentRunId ? 'current' : 'complete';
    run.dataset.runId = manifest.id;
    const isRoot = manifest.id === rootManifest.id;
    run.setAttribute('aria-label', isRoot
      ? `Exploration rooted at ${manifest.divergence || manifest.branch.divergence || manifest.title || manifest.id}`
      : `Saved possibilities following ${(manifest.continuation?.path || []).at(-1)?.title || 'the selected event'}`);
    if (isRoot) {
      const heading = document.createElement('strong'); heading.className = 'tree-root-title';
      heading.textContent = manifest.divergence || manifest.branch.divergence || manifest.title || manifest.branch.hero?.title || manifest.id;
      run.append(heading);
    }
    const branches = document.createElement('ol'); branches.className = 'tree-branches';
    for (const branch of manifest.branch.branches || []) {
      const item = document.createElement('li'); item.className = 'tree-branch';
      const state = consequenceState(manifest.id, branch.id, manifest);
      item.dataset.state = state;
      const event = document.createElement('button'); event.type = 'button'; event.className = 'tree-event';
      event.dataset.runId = manifest.id; event.dataset.branchId = branch.id;
      event.textContent = `${formatYear(branch.year)} · ${branch.title}`;
      event.setAttribute('aria-pressed', String(manifest.id === currentRunId && branch.id === selectedBranchId));
      const onCurrentPath = (continuation.path || []).some(item => item.runId === manifest.id && item.branchId === branch.id);
      if (manifest.id === currentRunId && branch.id === selectedBranchId) event.setAttribute('aria-current', 'true');
      else if (onCurrentPath) event.setAttribute('aria-current', 'step');
      event.addEventListener('click', async () => {
        if (manifest.id !== currentRunId) {
          await loadRun(manifest.id, { animate: false, autoConsequences: false, selectedBranchId: branch.id });
          if (currentRunId !== manifest.id) return;
        }
        const selected = branchState.branches.find(item => item.id === branch.id);
        if (selected) activateBranch(selected);
      });
      const statusNode = document.createElement('small'); statusNode.className = 'tree-status'; statusNode.dataset.state = state; statusNode.textContent = taskLabel(state);
      item.append(event, statusNode);
      const work = eventWork.get(eventKey(manifest.id, branch.id));
      const stages = [work?.sceneMessage || (work?.sceneUrl ? 'Scene ready' : ''), work?.childrenMessage, work?.cutoutMessage].filter(Boolean);
      if (stages.length && (state === 'queued' || state === 'in-progress' || work?.sceneOnlyComplete || work?.retryable || work?.cutoutRetryable || ['uncertain', 'failed', 'retryable'].includes(state))) {
        const stage = document.createElement('small'); stage.className = 'tree-stage'; stage.dataset.state = state; stage.textContent = [...new Set(stages)].join(' · '); item.append(stage);
      }
      const edge = manifest.continuation?.children?.find(child => child.branchId === branch.id);
      if (edge?.status === 'complete' && edge.runId) {
        const childManifest = knownRunManifests.get(edge.runId);
        if (childManifest) {
          const childNode = renderRun(childManifest, depth + 1);
          if (childNode) item.append(childNode);
        } else {
          const saved = document.createElement('small'); saved.className = 'tree-edge'; saved.dataset.state = 'complete'; saved.textContent = 'Saved consequence'; item.append(saved);
        }
      }
      branches.append(item);
    }
    run.append(branches);
    return run;
  };
  const tree = renderRun(rootManifest);
  if (tree) host.append(tree);
  renderStarMap(rootManifest);
  if (hydrate) hydrateExplorationTree(rootManifest, ++treeRenderRequest);
}
async function treeManifest(runId) {
  if (knownRunManifests.has(runId)) return knownRunManifests.get(runId);
  if (!manifestRequests.has(runId)) manifestRequests.set(runId, fetch(`/runs/${encodeURIComponent(runId)}`).then(async response => {
    if (!response.ok) return null;
    const manifest = await response.json();
    if (manifest?.branch && manifest.id === runId) knownRunManifests.set(runId, manifest);
    return manifest?.branch ? manifest : null;
  }).catch(() => null).finally(() => manifestRequests.delete(runId)));
  return manifestRequests.get(runId);
}
async function hydrateExplorationTree(rootManifest, request) {
  const visited = new Set(), budget = { nodes: 1 };
  const walk = async (manifest, depth) => {
    if (!manifest || depth >= 6 || budget.nodes >= 80 || visited.has(manifest.id)) return;
    visited.add(manifest.id);
    for (const edge of manifest.continuation?.children || []) {
      if (edge.status !== 'complete' || !edge.runId || budget.nodes >= 80) continue;
      const child = await treeManifest(edge.runId);
      if (child) { budget.nodes++; await walk(child, depth + 1); }
    }
  };
  await walk(rootManifest, 0);
  if (request === treeRenderRequest && (continuation.rootRunId || currentRunId) === rootManifest.id) {
    renderExplorationTree(false);
  }
}
const insetRenderer = createGeographyRenderer({
  paint(image, geography, mode) { return { image, geography, mode }; },
  apply({ image, geography, mode }) { if (visibleChanges(surfaceGeography).some(change => change.region === 'ram-setu')) drawGeographyCanvas($('geography-inset'), image, geography, mode, 'ram-setu'); },
});
function showGeography(branch) {
  // Some saved descendants predate materialising the full state on each branch.
  // Inherit only omitted metadata; malformed explicit states stay unsupported.
  const value = branch && branch.geography === undefined ? continuation.path?.findLast(item => item.geography !== undefined)?.geography : branch?.geography;
  surfaceGeography = safeGeography(value);
  surfaceUnavailable = value !== undefined && !surfaceGeography;
  renderGeography();
}
function setSurfaceMode(mode) { surfaceMode = mode; renderGeography(); }
function renderGeography() {
  const changes = visibleChanges(surfaceGeography);
  $('geography-present').setAttribute('aria-pressed', String(surfaceMode === 'present'));
  $('geography-scenario').setAttribute('aria-pressed', String(surfaceMode === 'scenario'));
  $('geography-scenario').disabled = changes.length === 0;
  if (!changes.length) $('geography-present').setAttribute('aria-pressed', 'true');
  if (!changes.length) $('geography-scenario').setAttribute('aria-pressed', 'false');
  $('geography-status').textContent = surfaceUnavailable ? 'Present-day reference · this scenario geography is unsupported and cannot be mapped.' : !surfaceGeography ? 'Present-day reference · no scenario geography recorded. Legacy stories retain their original map.' : !changes.length ? 'Present-day reference · no supported surface masks recorded. Other geographic changes are not mapped.' : surfaceMode === 'present' ? 'Present-day reference · compare with the selected scenario.' : `${changes.length} illustrative surface ${changes.length === 1 ? 'change' : 'changes'} · selected scenario`;
  const legend = $('geography-legend'); legend.replaceChildren();
  for (const change of surfaceGeography?.changes || []) {
    const item = document.createElement('li');
    const label = document.createElement('strong'); label.textContent = `${REGIONS[change.region].label} · ${GEOGRAPHY_STYLES[change.kind].label}${change.intensity === 0 ? ' · inactive' : ''}`;
    const swatch = document.createElement('span'); swatch.className = 'geography-swatch'; swatch.style.backgroundColor = GEOGRAPHY_STYLES[change.kind].color; swatch.setAttribute('aria-hidden', 'true');
    const assumption = document.createElement('span'); assumption.textContent = `Assumption: ${change.assumption}`;
    const uncertainty = document.createElement('small'); uncertainty.textContent = `Uncertainty: ${change.uncertainty}`;
    item.append(swatch, label, assumption, uncertainty); legend.append(item);
  }
  $('geography-detail').hidden = !changes.some(change => change.region === 'ram-setu');
  const mode = changes.length ? surfaceMode : 'present';
  globeApi?.setGeography(surfaceGeography, mode);
  insetRenderer.set(surfaceGeography, mode);
}
const status = text => $('status').textContent = text;
const viewStatus = (text, loading = false) => { $('view-status').textContent = text; $('view-status').hidden = !text; $('view-loading-indicator').hidden = !text || !loading; };
function updateRootGenerationProgress(message) {
  if (!rootGenerationActive) return;
  $('root-generation-message').textContent = message;
  $('root-generation-status').hidden = false;
}
function finishRootGenerationProgress(message = '') {
  rootGenerationActive = false;
  $('root-generation-message').textContent = message;
  $('root-generation-indicator').hidden = true;
  $('root-generation-status').hidden = !message;
}
function startRootGenerationProgress() {
  rootGenerationActive = true;
  $('root-generation-indicator').hidden = false;
  updateRootGenerationProgress('Checking your question…');
}
const setStageMessage = text => { const copy = $('stage-empty').querySelector('p'); if (copy) copy.textContent = text; };
const asset = name => `${base}/${name}`;
function applyServiceMode(mode) {
  serviceMode = mode;
  $('live-access').hidden = localReviewAccess || (mode !== 'live-enabled' && !voiceEnabled);
  $('live-submit').disabled = mode !== 'live-enabled' || streamBusy;
  const replayMessage = 'Saved stories · run locally with your own Meta API key for fresh exploration';
  const liveMessage = localReviewAccess ? 'Local exploration · saved worlds' : 'Saved runs · live access by invite';
  $('service-mode').textContent = mode === 'replay-only' ? replayMessage : mode === 'live-enabled' ? liveMessage : 'Saved runs · service mode unknown';
  $('footer-service-mode').textContent = mode === 'replay-only' ? replayMessage : mode === 'live-enabled' ? (localReviewAccess ? 'Fresh local exploration is enabled' : 'Fresh exploration is available with live access') : 'Saved stories · service mode unknown';
  if (mode === 'replay-only') status(replayMessage);
  else if (mode === 'unknown') status('Service mode unavailable · cached stories remain available');
  renderBranches();
}
async function loadServiceMode() {
  try {
    const response = await fetch('/health');
    if (!response.ok) throw new Error('Health endpoint unavailable');
    const health = await response.json();
    voiceEnabled = health.status === 'ok' && health.voiceEnabled === true;
    localReviewAccess = health.status === 'ok' && health.localReviewAccess === true;
    voice.setLocalAccess?.(localReviewAccess);
    voice.setEnabled(voiceEnabled);
    applyServiceMode(liveAccessMode(health));
    if (localReviewAccess) refreshHistory().catch(() => {});
  } catch { voiceEnabled = false; localReviewAccess = false; voice.setLocalAccess?.(false); voice.setEnabled(false); applyServiceMode('unknown'); }
}
function setView(view, userSelected = false) {
  if (userSelected) continuationViewSelection = view;
  const selectedHasAssets = !selectedBranchId || selectedBranchId === branchState.heroId;
  const selectedEvent = eventWork.get(eventKey(currentRunId, selectedBranchId));
  const eventImage = selectedEvent?.sceneUrl;
  const eventCutout = selectedEvent?.cutoutUrl;
  const imageAvailable = (hasImage && selectedHasAssets) || !!eventImage, cutoutAvailable = (hasCutout && selectedHasAssets) || !!eventCutout, modelAvailable = hasModel && selectedHasAssets;
  $('workspace').classList.toggle('selected-no-scene', !imageAvailable);
  const selectedEventTitle = branchState.branches.find(branch => branch.id === selectedBranchId)?.title;
  $('hero-image').alt = selectedEventTitle ? `Scene for ${selectedEventTitle}` : 'Generated scene';
  if (eventImage) $('hero-image').src = eventImage;
  else if (hasImage && selectedHasAssets) $('hero-image').src = asset('hero.png');
  if (eventCutout) $('cutout-image').src = eventCutout;
  else if (hasCutout && selectedHasAssets) $('cutout-image').src = asset('cutout.png');
  view = availableView(view, {image:imageAvailable, cutout:cutoutAvailable, model:modelAvailable && !!modelApi});
  activeView = view;
  $('event-progress').textContent = [selectedEvent?.sceneLoading && view === 'scene' ? '' : selectedEvent?.sceneMessage, selectedEvent?.childrenMessage, selectedEvent?.cutoutMessage].filter(Boolean).join(' · ');
  $('event-loading-indicator').hidden = !selectedEvent?.childrenLoading || !selectedEvent?.running;
  $('scene-view').disabled = !imageAvailable; $('cutout-view').disabled = !selectedBranchId; $('model-button').disabled = !selectedBranchId;
  $('hero-image').hidden = !imageAvailable || view !== 'scene';
  $('cutout-image').hidden = !cutoutAvailable || view !== 'cutout';
  $('model-view').hidden = !modelAvailable || view !== 'model';
  $('viewer-hint').hidden = view !== 'model';
  $('stage-empty').hidden = imageAvailable || (modelAvailable && view === 'model');
  const sceneLoading = view === 'scene' && !!selectedEvent?.sceneLoading && !eventImage;
  $('scene-loading').hidden = !sceneLoading;
  $('scene-loading-text').textContent = selectedEvent?.sceneMessage || 'Preparing the selected scene…';
  for (const [id, name] of [['scene-view','scene'],['cutout-view','cutout'],['model-button','model']]) {
    const selected = view === name;
    $(id).classList.toggle('active', selected);
    $(id).setAttribute('aria-selected', String(selected));
    $(id).tabIndex = selected ? 0 : -1;
  }
  $('chronicle-stage').setAttribute('aria-labelledby', `${view === 'scene' ? 'scene-view' : view === 'cutout' ? 'cutout-view' : 'model-button'}`);
  const modelFocus = modelAvailable && !!modelApi && view === 'model';
  const heroFocus = modelFocus || cutoutAvailable && view === 'cutout';
  $('workspace').classList.toggle('hero-focus', heroFocus);
  $('back-to-atlas').hidden = !heroFocus;
  $('orbit-button').hidden = !modelFocus;
  $('orbit-button').disabled = reducedMotion.matches || !modelLoaded;
  $('model-loading').hidden = !modelFocus || !modelLoading;
  $('model-loading-indicator').hidden = !modelFocus || !modelLoading;
  $('model-error').hidden = !modelFocus || !modelError;
  if (!modelFocus) {
    modelApi?.setAutoRotate(false);
    $('orbit-button').setAttribute('aria-pressed', 'false');
    $('orbit-button').textContent = 'Orbit object';
  }
  if (modelFocus) {
    if (!modelLoaded && !modelLoading && !modelError) requestModelLoad();
    else if (modelLoaded) modelApi?.refresh?.();
  }
}
function showGuard(data) {
  setStageMessage('No scene is attached to this blocked prompt. Choose the reframe to continue.');
  $('guardrail').hidden = false; $('reason').textContent = data.reason || 'This question is outside the scope of this exploration.';
  $('reframe').textContent = data.reframe || 'Try a question about science, technology, culture or geography.';
  $('retry').dataset.prompt = data.suggestion || retryPrompt(data.reframe);
  $('retry').hidden = !$('retry').dataset.prompt;
}
function renderBranches() {
  document.body.classList.toggle('has-story', branchState.branches.length > 0 || !!selectedContext || !!savedNavigationState);
  $('show-invitation').setAttribute('aria-expanded', String(!matchMedia('(max-width: 700px)').matches || document.body.classList.contains('invitation-open')));
  $('branch-list').replaceChildren(); $('map-empty').hidden = branchState.branches.length > 0 || branchState.phase === 'policy-checking' || rootGenerationActive;
  const selected = branchState.branches.find(item => item.id === selectedBranchId);
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
    button.disabled = streamBusy || replayActive;
    const taskState = consequenceState(currentRunId, b.id);
    button.dataset.state = taskState;
    const task = document.createElement('small'); task.className = 'branch-status'; task.dataset.state = taskState; task.textContent = taskLabel(taskState);
    button.append(task);
    button.setAttribute('aria-label', `${button.textContent}${b.place?.name ? ` · ${b.place.name}` : ''}`);
    button.addEventListener('click', () => activateBranch(b)); $('branch-list').append(button);
  }
  globeApi?.setBranches(branchState.branches, branchState.heroId, null, continuation.path || []);
  renderExplorationTree();
}
function selectBranch(branch, { persistLocation = true } = {}) {
  if (!branch?.id) return;
  if (branch.ancestorRunId) { openAncestor(branch.ancestorRunId, branch.branchId); return; }
  if (streamBusy || replayActive) return;
  selectedBranchId = branch.id;
  if (persistLocation && currentRunId) updateRunLocation(currentRunId, branch.id);
  viewStatus('');
  showGeography(branch);
  document.body.classList.add('has-story');
  const context = $('selected-branch-context');
  context.replaceChildren();
  context.hidden = true;
  $('hero-title').textContent = `${formatYear(branch.year)} · ${branch.title}`;
  $('hero-description').textContent = `${branch.summary || ''}${branch.causalLink ? ` Speculative cause: ${branch.causalLink}` : ''}`;
  $('hero-tag').textContent = branch.id === branchState.heroId && hasImage ? 'SELECTED EVENT · SCENE AVAILABLE' : 'SELECTED EVENT';
  if (branch.id !== branchState.heroId) setStageMessage('Preparing this event’s scene…');
  else if (!hasImage) setStageMessage('No scene was saved for this event.');
  setView(continuationViewSelection || 'scene');
  renderTrace();
  renderEventWork();
  globeApi?.select(branch);
  for (const button of $('branch-list').querySelectorAll('[data-branch-id]')) {
    const selected = button.dataset.branchId === selectedBranchId;
    button.classList.toggle('selected', selected);
    button.setAttribute('aria-pressed', String(selected));
  }
}
function renderEventWork() {
  const work = eventWork.get(eventKey(currentRunId, selectedBranchId));
  const section = $('event-consequences'); section.hidden = !selectedBranchId || !work;
  const selected = branchState.branches.find(branch => branch.id === selectedBranchId);
  const savedChild = continuation.children?.find(item => item.branchId === selectedBranchId);
  const list = $('event-children'); list.replaceChildren();
  if (!work) { $('event-loading-indicator').hidden = true; renderExplorationTree(); return; }
  setView(activeView);
  $('event-progress').textContent = [work.sceneLoading && activeView === 'scene' ? '' : work.sceneMessage, work.childrenMessage, work.cutoutMessage].filter(Boolean).join(' · ');
  $('event-loading-indicator').hidden = !work.childrenLoading || !work.running;
  if (!work.sceneUrl && work.sceneMessage) setStageMessage(work.sceneMessage + '.');
  $('event-retry').hidden = !work.retryable || work.running;
  if (work.sceneUrl && isSelected(work.runId, work.branchId)) {
    if (activeView === 'scene') setView('scene');
  }
  for (const child of work.children || []) {
    const button = document.createElement('button'); button.type = 'button'; button.className = 'outline event-child';
    button.textContent = `${formatYear(child.year)} · ${child.title} ↗`;
    button.addEventListener('click', async () => {
      const pending = loadRun(work.childRunId, { animate: false, autoConsequences:false, selectedBranchId: child.id });
      const request = replayRequest;
      await pending;
      if (request !== replayRequest || currentRunId !== work.childRunId) return;
      const selected = branchState.branches.find(item => item.id === child.id);
      if (selected) activateBranch(selected);
    });
    list.append(button);
  }
  renderBranches();
}
function queueSceneTask(runId, branch, work, access, allowGeneration, refresh, retry = false, background = false) {
  if (work.sceneUrl) return Promise.resolve(true);
  if (work.sceneTaskPromise && !retry && (work.sceneQueued || work.sceneRunning)) return work.sceneTaskPromise;
  work.sceneQueued = true; work.running = true;
  work.sceneLoading = true; work.sceneMessage = 'Queued to check the scene'; refresh();
  const task = enqueueEventJob(async () => {
    work.sceneQueued = false; work.sceneRunning = true; work.running = true; work.sceneLoading = true;
    work.sceneMessage = 'Checking the scene'; work.sceneInProgress = false; refresh();
    try {
      const params = new URLSearchParams({runId, branchId:branch.id});
      let response = await fetch(`/api/event-scene?${params}`, {headers:{'x-demo-access-code':access}});
      if (!response.ok) throw new Error('Could not check this event’s scene');
      let result = await response.json();
      if (result.status === 'missing' && allowGeneration) {
        work.sceneMessage = 'Creating this event’s scene'; refresh();
        const generated = await postWithCapacityRetry('/api/event-scene', {
          method:'POST', headers:{'content-type':'application/json','x-demo-access-code':access}, body:JSON.stringify({runId,branchId:branch.id}),
        }, (delay, attempt, limit) => { work.sceneMessage = `Scene queued · server busy, retry ${attempt}/${limit} in ${delay} ms`; refresh(); });
        if (!generated.response.ok) throw new Error(generated.detail.error || 'Could not create the scene');
        result = await generated.response.json();
      }
      if (result.status === 'complete' && result.url) {
        work.sceneUrl = result.url; work.sceneMessage = ''; work.sceneRetryable = false;
        if (work.sceneOnlyPrefetch && !work.childrenRunning) work.sceneOnlyComplete = true;
      } else if (result.status === 'missing') {
        work.sceneMessage = serviceMode === 'replay-only' ? 'Run locally with your own Meta API key for fresh scene generation' : 'Scene generation needs live access'; work.sceneRetryable = false;
        if (work.sceneOnlyPrefetch) work.sceneOnlyComplete = true;
      } else {
        work.sceneMessage = result.status === 'in-progress' ? 'Scene generation is in progress' : 'Scene generation did not complete; retry to check';
        work.sceneRetryable = true; work.sceneInProgress = result.status === 'in-progress';
        if (work.sceneOnlyPrefetch) work.sceneOnlyComplete = true;
        if (result.status === 'in-progress' && (work.pollCount || 0) < 30) {
          work.pollCount = (work.pollCount || 0) + 1;
          setTimeout(() => {
            if (!work.sceneRunning && (background || isSelected(runId, branch.id))) queueSceneTask(runId, branch, work, access, allowGeneration, refresh, true, background);
          }, 2000);
        }
      }
    } catch (error) {
      work.sceneMessage = error.message || 'Could not load scene'; work.sceneRetryable = true;
      if (work.sceneOnlyPrefetch) work.sceneOnlyComplete = true;
    } finally {
      work.sceneLoading = false; work.sceneQueued = false; work.sceneRunning = false; work.running = !!(work.childrenQueued || work.childrenRunning);
      work.retryable = !!(work.sceneRetryable || work.childrenRetryable); refresh();
    }
  });
  work.sceneTaskPromise = task.catch(error => {
    work.sceneLoading = false; work.sceneQueued = false; work.sceneRunning = false; work.sceneRetryable = true; work.retryable = true;
    work.sceneMessage = error?.message || 'Could not load scene'; work.running = !!(work.childrenQueued || work.childrenRunning); refresh(); return false;
  });
  return work.sceneTaskPromise;
}
function prefetchEventScenes(branches, runId, manifest) {
  if (!runId || !Array.isArray(branches) || !branches.length || serviceMode !== 'live-enabled' || !hasLiveAccess() || streamBusy || replayActive) return;
  // Scene-only work warms hover previews for this immediate child set. It never
  // queues consequences, so generated scenes cannot recursively expand worlds.
  const access = $('access').value, allowGeneration = serviceMode === 'live-enabled' && hasLiveAccess();
  for (const branch of branches) {
    if (!branch?.id) continue;
    const key = eventKey(runId, branch.id);
    const work = eventWork.get(key) || { runId, branchId:branch.id, title:branch.title, children:[] };
    eventWork.set(key, work);
    const confirmedScene = localEventThumbnail(runId, branch.id, manifest);
    if (confirmedScene) { work.sceneUrl = confirmedScene; work.sceneMessage = ''; work.sceneOnlyComplete = true; work.sceneOnlyPrefetch = true; continue; }
    if (work.sceneUrl || work.sceneTaskPromise || (work.sceneQueued && !work.sceneCheckOnly) || (work.sceneRunning && !work.sceneCheckOnly)) continue;
    work.sceneOnlyPrefetch = true;
    const refresh = () => { if (isSelected(runId, branch.id)) renderEventWork(); else renderBranches(); };
    const check = work.sceneCheckPromise && !work.sceneCheckDone
      ? work.sceneCheckPromise.then(hasSavedScene => hasSavedScene || queueSceneTask(runId, branch, work, access, allowGeneration, refresh, true, true))
      : queueSceneTask(runId, branch, work, access, allowGeneration, refresh, true, true);
    work.jobPromise = Promise.resolve(check).catch(error => {
      work.sceneRetryable = true; work.retryable = true; work.sceneMessage = error?.message || 'Could not load scene'; refresh(); return false;
    });
  }
}
function activateBranch(branch, retry = false, { background = false, sceneOnly = false, runId: targetRunId = currentRunId, manifest: targetManifest, persistSelection = true } = {}) {
  if (!branch?.id || streamBusy || replayActive) return;
  if (branch.ancestorRunId) { openAncestor(branch.ancestorRunId, branch.branchId); return; }
  if (!background && targetRunId === currentRunId) selectBranch(branch, { persistLocation: persistSelection });
  if (!targetRunId) return;
  const runId = targetRunId, key = eventKey(runId, branch.id);
  const ownerManifest = targetManifest || (runId === currentRunId ? currentManifest : knownRunManifests.get(runId));
  const ownerBranch = ownerManifest?.branch;
  const ownerHeroId = ownerBranch?.heroId || ownerBranch?.hero?.branchId || ownerBranch?.hero?.id || (runId === currentRunId ? branchState.heroId : null);
  const ownerChildren = ownerManifest?.continuation?.children || (runId === currentRunId ? continuation.children : []);
  let work = eventWork.get(key);
  const promoteScenePrefetch = !!work?.sceneOnlyPrefetch && !sceneOnly && !background;
  const promoteSavedSceneCheck = !!work?.sceneCheckOnly && !sceneOnly;
  if (work && !retry && !work.interrupted && !promoteScenePrefetch && !promoteSavedSceneCheck) {
    if (!background && runId === currentRunId) renderEventWork(); return;
  }
  if ((work?.childrenRunning || work?.childrenQueued) && !promoteScenePrefetch) return;
  work ||= { runId, branchId: branch.id, title: branch.title, children: [] };
  eventWork.set(key, work);
  work.interrupted = false; work.retryable = false;
  if (sceneOnly) work.sceneOnlyPrefetch = true;
  else if (!background) work.sceneOnlyPrefetch = false;
  const knownEdge = ownerChildren.find(item => item.branchId === branch.id);
  const budgetRetryEligible = work.budgetFailureRetryable || (['failed', 'retryable'].includes(knownEdge?.status) && knownEdge?.code === 'budget_exhausted');
  const budgetRetryRequested = retry && budgetRetryEligible;
  work.consequenceStatus = knownEdge?.status || (work.childRunId ? 'complete' : sceneOnly ? 'not-started' : 'queued');
  work.budgetFailureRetryable = budgetRetryEligible && !budgetRetryRequested;
  if (sceneOnly && !work.childRunId) work.childrenMessage = '';
  else if (!work.childRunId) work.childrenMessage = 'Queued to find consequences';
  const access = $('access').value;
  if (branch.id === ownerHeroId && runId === currentRunId && hasImage && !work.sceneUrl) { work.sceneUrl = asset('hero.png'); work.sceneMessage = ''; work.sceneLoading = false; }
  const allowGeneration = serviceMode === 'live-enabled' && hasLiveAccess();
  let savedChild = ownerChildren.find(item => item.branchId === branch.id);
  let continuationDispatched = false;
  const refresh = () => { if (isSelected(runId, branch.id)) renderEventWork(); else renderBranches(); };
  const job = async () => {
    // Activation is an explicit request. Preserve it through queue wait and navigation;
    // all presentation updates remain scoped to this run/branch in refresh().
    work.childrenQueued = false; work.childrenRunning = true; work.childrenRetryable = false; work.running = true;
    work.childrenLoading = !work.childRunId && !work.children?.length;
    work.childrenMessage = work.childRunId ? '' : 'Finding consequences';
    if (!work.childRunId && !savedChild) work.consequenceStatus = 'queued';
    refresh();
    try {
      if (savedChild?.status === 'complete' && savedChild.runId) {
        const response = await fetch(`/runs/${encodeURIComponent(savedChild.runId)}/branch.json`);
        if (!response.ok) throw new Error('Could not load saved consequences');
        const child = await response.json(); work.childRunId = savedChild.runId; work.children = child.branches || []; work.childrenMessage = work.children.length ? '' : 'No consequences were saved'; work.childrenLoading = false; work.consequenceStatus = 'complete';
        const childManifest = await treeManifest(savedChild.runId) || { id:savedChild.runId, branch:child, continuation:{rootRunId:savedChild.runId,children:[]} };
        knownRunManifests.set(savedChild.runId, childManifest);
        prefetchEventScenes(work.children, savedChild.runId, childManifest); refresh();
      }
      if (!work.childRunId) {
        let manifest = runId === currentRunId ? currentManifest : knownRunManifests.get(runId);
        if (!manifest) {
          const manifestResponse = await fetch(`/runs/${encodeURIComponent(runId)}`);
          if (!manifestResponse.ok) throw new Error('Could not check saved consequences');
          manifest = await manifestResponse.json();
          if (manifest?.branch) knownRunManifests.set(runId, manifest);
        }
        savedChild = manifest.continuation?.children?.find(item => item.branchId === branch.id) || savedChild;
        if (savedChild?.status === 'complete' && savedChild.runId) {
          const response = await fetch(`/runs/${encodeURIComponent(savedChild.runId)}/branch.json`);
          if (!response.ok) throw new Error('Could not load saved consequences');
          const child = await response.json(); work.childRunId = savedChild.runId; work.children = child.branches || []; work.childrenMessage = work.children.length ? '' : 'No consequences were saved'; work.childrenLoading = false; work.consequenceStatus = 'complete';
          const childManifest = await treeManifest(savedChild.runId) || { id:savedChild.runId, branch:child, continuation:{rootRunId:savedChild.runId,children:[]} };
          knownRunManifests.set(savedChild.runId, childManifest);
          prefetchEventScenes(work.children, savedChild.runId, childManifest); refresh();
          return;
        }
        if (savedChild?.status && !budgetRetryRequested) {
          work.consequenceStatus = savedChild.status;
          if (savedChild.status === 'in-progress') work.childrenMessage = 'This consequence is still being saved';
          else if (['failed', 'retryable'].includes(savedChild.status) && savedChild.code === 'budget_exhausted') {
            work.budgetFailureRetryable = true; work.childrenRetryable = true; work.retryable = true;
            work.childrenMessage = 'The spend limit ended this continuation attempt. Try again starts a new attempt; this attempt and its saved artifacts are preserved.';
          } else work.childrenMessage = 'This saved attempt needs review; automatic retries are disabled';
          refresh(); return;
        }
        const ownerPath = ownerManifest?.continuation?.path || (runId === currentRunId ? continuation.path : []);
        const action = continuationAction({runId, branchId:branch.id, children:savedChild && !budgetRetryRequested ? [savedChild] : [], path:ownerPath, mode:serviceMode, access:allowGeneration});
        if (action.type === 'generate') {
          work.consequenceStatus = 'queued'; work.childrenMessage = 'Queued to explore consequences'; refresh();
          continuationDispatched = true;
          const started = await postWithCapacityRetry('/api/continue', {
            method:'POST', headers:{'content-type':'application/json','x-demo-access-code':access}, body:JSON.stringify({runId,branchId:branch.id, ...(budgetRetryRequested ? {retryBudgetFailure:true} : {})}),
          }, (delay, attempt, limit) => { work.consequenceStatus = 'queued'; work.childrenMessage = `Continuation queued · server busy, retry ${attempt}/${limit} in ${delay} ms`; refresh(); });
          if (!started.response.ok || !started.response.body) {
            work.consequenceStatus = started.detail.status || (started.response.status === 403 || started.response.status === 429 ? 'retryable' : 'uncertain');
            work.budgetFailureRetryable = ['failed', 'retryable'].includes(work.consequenceStatus) && started.detail.code === 'budget_exhausted';
            throw new Error(started.detail.error || 'Could not explore consequences');
          }
          work.consequenceStatus = 'in-progress'; work.childrenMessage = 'Exploring consequences'; refresh();
          const reader = started.response.body.getReader(), decoder = new TextDecoder(); let buffer = '', completed = null, failure = null, failureStatus = null;
          const progress = { policy: 'Checking the topic', propose: 'Developing possible futures', review: 'Reviewing possible futures', image: 'Creating the scene', cutout: 'Isolating the subject', '3d': 'Preparing the 3D object' };
          const accept = block => {
            const event = parseSseBlock(block);
            if (event?.event === 'complete') completed = event.data;
            else if (event?.event === 'error') {
              failure = event.data?.message || event.data?.error || 'Could not explore consequences'; failureStatus = event.data?.status || null;
              work.budgetFailureRetryable = event.data?.code === 'budget_exhausted' && ['failed', 'retryable'].includes(failureStatus);
            }
            else if (progress[event?.event]) { work.childrenMessage = progress[event.event]; refresh(); }
          };
          while (true) { const {value, done} = await reader.read(); buffer += decoder.decode(value || new Uint8Array(), {stream:!done}); let match; while ((match = buffer.match(/\r?\n\r?\n/))) { accept(buffer.slice(0, match.index)); buffer = buffer.slice(match.index + match[0].length); } if (done) { if (buffer.trim()) accept(buffer); break; } }
          if (!completed) { work.consequenceStatus = ['retryable','failed','uncertain'].includes(failureStatus) ? failureStatus : 'uncertain'; throw new Error(failure || 'Consequences did not finish; check the saved world before retrying'); }
          work.childRunId = completed.runId || completed.id; work.children = completed.branch?.branches || []; work.childrenMessage = work.children.length ? '' : 'No consequences were generated'; work.childrenLoading = false;
          work.consequenceStatus = 'complete'; work.childrenRetryable = false;
          work.budgetFailureRetryable = false;
          if (work.childRunId) {
            // Keep the saved graph current even when the user navigated away
            // while this explicitly requested continuation was running.
            const parentManifest = runId === currentRunId ? currentManifest : knownRunManifests.get(runId);
            const nextContinuation = { ...(parentManifest?.continuation || (runId === currentRunId ? continuation : {})),
              children: [...(parentManifest?.continuation?.children || (runId === currentRunId ? continuation.children : []) || []).filter(item => item.branchId !== branch.id), {branchId:branch.id,runId:work.childRunId,status:'complete'}] };
            if (parentManifest) {
              const updatedManifest = { ...parentManifest, continuation: nextContinuation };
              knownRunManifests.set(runId, updatedManifest);
              if (runId === currentRunId) { currentManifest = updatedManifest; continuation = nextContinuation; }
            }
            let childManifest = await treeManifest(work.childRunId);
            if (!childManifest && completed.branch?.branches) childManifest = { id:work.childRunId, branch:completed.branch, continuation:completed.continuation || { rootRunId:work.childRunId, parentRunId:runId, parentBranchId:branch.id, path:[], children:[] } };
            if (childManifest) {
              knownRunManifests.set(work.childRunId, childManifest);
            }
            prefetchEventScenes(work.children, work.childRunId, childManifest || { id:work.childRunId, branch:completed.branch, continuation:{rootRunId:work.childRunId,children:[]} });
          }
        } else { work.childrenMessage = action.message || 'Consequences are not available yet'; work.consequenceStatus = action.type === 'limit' ? 'limit-reached' : action.type === 'unavailable' && !allowGeneration ? 'needs-access' : 'not-started'; work.retryable = false; work.interrupted = action.type !== 'limit' && !allowGeneration; }
      }
    } catch (error) {
      work.childrenMessage = work.budgetFailureRetryable
        ? `${error.message || 'The spend limit ended this continuation attempt.'} · Try again starts a new attempt; this attempt and its saved artifacts are preserved.`
        : error.message || 'Could not load this event';
      if (continuationDispatched && !['retryable', 'failed', 'in-progress', 'complete'].includes(work.consequenceStatus)) work.consequenceStatus = 'uncertain';
      work.childrenRetryable = !continuationDispatched || work.consequenceStatus === 'retryable' || work.budgetFailureRetryable;
    } finally {
      work.childrenLoading = false; work.childrenQueued = false; work.childrenRunning = false; work.running = !!(work.sceneQueued || work.sceneRunning);
      work.retryable = !!(work.sceneRetryable || work.childrenRetryable); refresh();
    }
  };
  const scenePromise = !work.sceneUrl
    ? work.sceneCheckPromise && !work.sceneCheckDone
      ? work.sceneCheckPromise.then(hasSavedScene => hasSavedScene || queueSceneTask(runId, branch, work, access, allowGeneration, refresh, true, background))
      : queueSceneTask(runId, branch, work, access, allowGeneration, refresh, retry, background)
    : Promise.resolve(true);
  if (!sceneOnly) { work.childrenQueued = true; work.childrenLoading = true; work.running = true; work.childrenMessage ||= 'Queued to find consequences'; }
  const childrenPromise = sceneOnly ? null : enqueueEventJob(job).catch(error => {
    work.childrenRunning = false; work.childrenQueued = false; work.childrenLoading = false; work.childrenRetryable = true; work.retryable = true; work.running = !!(work.sceneQueued || work.sceneRunning);
    work.childrenMessage = error?.message || 'Could not load this event';
    refresh();
  });
  if (!sceneOnly) work.childrenTaskPromise = childrenPromise;
  work.jobPromise = Promise.all([scenePromise, childrenPromise].filter(Boolean));
  if (sceneOnly) work.sceneOnlyPrefetch = true;
  if (background) renderBranches(); else renderEventWork();
  work.running = !!(work.sceneRunning || work.childrenRunning);
}
$('event-retry').addEventListener('click', () => { const branch = branchState.branches.find(item => item.id === selectedBranchId); if (branch) activateBranch(branch, true); });
async function restoreSelectedConsequences(runId, branch) {
  const saved = continuation.children?.find(item => item.branchId === branch?.id && item.status === 'complete' && item.runId);
  if (!saved) return;
  const response = await fetch(`/runs/${encodeURIComponent(saved.runId)}/branch.json`);
  if (!response.ok) throw new Error('Could not load saved consequences');
  const child = await response.json();
  if (runId !== currentRunId || branch.id !== selectedBranchId) return;
  const childManifest = await treeManifest(saved.runId) || { id: saved.runId, branch: child, continuation: { rootRunId: saved.runId, children: [] } };
  if (runId !== currentRunId || branch.id !== selectedBranchId) return;
  const key = eventKey(runId, branch.id), previous = eventWork.get(key) || {};
  const work = { ...previous, runId, branchId: branch.id, childRunId: saved.runId, children: child.branches || [], sceneMessage: previous.sceneUrl ? '' : previous.sceneMessage || '', childrenMessage: child.branches?.length ? '' : 'No consequences were saved', consequenceStatus: 'complete' };
  eventWork.set(key, work);
  prefetchEventScenes(work.children, saved.runId, childManifest);
  renderEventWork();
}
async function openAncestor(runId, branchId) {
  const pending = loadRun(runId, { animate: false, autoConsequences: false, selectedBranchId: branchId });
  const request = replayRequest;
  await pending;
  if (request !== replayRequest || currentRunId !== runId) return;
  const branch = branchState.branches.find(item => item.id === branchId);
  if (branch) activateBranch(branch);
}
function rememberRun(id) {
  if (!id) return;
  try {
    const previous = JSON.parse(localStorage.getItem('otherwise-run-history') || '[]');
    localStorage.setItem('otherwise-run-history', JSON.stringify([id, ...previous.filter(value => typeof value === 'string' && value !== id)].slice(0, 40)));
  } catch {}
}
function updateRunLocation(id, branchId = '') {
  if (!id) return;
  const safeBranchId = /^[a-zA-Z0-9][a-zA-Z0-9_-]{0,127}$/.test(branchId) ? branchId : '';
  const hash = `#run=${encodeURIComponent(id)}${safeBranchId ? `&event=${encodeURIComponent(safeBranchId)}` : ''}`;
  if (location.hash !== hash) history.pushState(null, '', hash);
  lastHandledLocationHash = hash;
  rememberRun(id); $('runs').value = id;
}
function renderAncestry() {
  const nav = $('world-path'); nav.replaceChildren();
  $('world-navigation').hidden = !currentRunId && !continuation.path?.length;
  $('world-back').hidden = !continuation.parentRunId;
  for (const item of continuation.path || []) {
    const button = document.createElement('button'); button.type = 'button'; button.className = 'outline';
    button.classList.add('tree-run-link'); button.dataset.state = 'complete';
    button.textContent = `${formatYear(item.year)} · ${item.title || 'Earlier world'}`;
    button.addEventListener('click', () => openAncestor(item.runId, item.branchId)); nav.append(button);
    nav.append(document.createTextNode(' → '));
  }
  const parent = continuation.path?.at(-1);
  const label = document.createElement('span'); label.dataset.state = 'current'; label.textContent = selectedContext ? `Exploring consequences of ${formatYear(selectedContext.year)} · ${selectedContext.title}…` : parent ? `Consequences of ${formatYear(parent.year)} · ${parent.title}` : 'Current possibilities'; nav.append(label);
}
async function expandBranch(branch) {
  if (branch?.ancestorRunId) { await openAncestor(branch.ancestorRunId, branch.branchId); return; }
  if (!branch?.id || streamBusy || replayActive) return;
  selectBranch(branch);
  const parentRunId = currentRunId;
  const event = eventWork.get(eventKey(parentRunId, branch.id));
  if (event?.sceneOnlyPrefetch && !event.childRunId) {
    activateBranch(branch);
    await event.childrenTaskPromise;
    if (currentRunId === parentRunId && event.childRunId) await loadRun(event.childRunId, { animate:false, autoConsequences:false });
    return;
  }
  if (event?.running) {
    status(event.consequenceStatus === 'in-progress' ? 'Consequences for this event are already being explored.' : 'This event is queued for scene and consequence preparation.');
    await event.jobPromise;
    if (currentRunId !== parentRunId) return;
    if (event.childRunId) await loadRun(event.childRunId, { animate: false, autoConsequences:false });
    return;
  }
  if (event?.sceneOnlyComplete && !event.childRunId) {
    activateBranch(branch);
    await event.jobPromise;
    if (currentRunId === parentRunId && event.childRunId) await loadRun(event.childRunId, { animate: false, autoConsequences:false });
    return;
  }
  const action = continuationAction({ runId: currentRunId, branchId: branch.id, children: continuation.children, path: continuation.path, busy: streamBusy, mode: serviceMode, access: hasLiveAccess() });
  if (action.type === 'open') { await loadRun(action.runId, { animate: false, autoConsequences:false }); return; }
  if (action.type !== 'generate') {
    const message = serviceMode === 'replay-only' ? 'Fresh exploration needs the demo running locally with your own Meta API key. Saved descendants remain available.' : action.message;
    status(message);
    if (message) {
      const notice = $('selected-branch-context');
      notice.hidden = false;
      notice.textContent = action.type === 'limit' ? `${branch.title}: ${message}` : `${branch.title}: ${message} The existing scene belongs to the current world; a new scene appears when the continuation completes.`;
      if (serviceMode === 'live-enabled' && !hasLiveAccess()) { $('live-access').open = true; $('access').focus(); }
    }
    return;
  }
  const parentPath = continuation.path || [], rootRunId = continuation.rootRunId || currentRunId;
  viewStatus(''); reset(); const request = replayRequest;
  continuation = { rootRunId, parentRunId, parentBranchId: branch.id, path: [...parentPath, { runId: parentRunId, branchId: branch.id, title: branch.title, year: branch.year, summary: branch.summary, causalLink: branch.causalLink, place: branch.place, geography: branch.geography }], children: [] };
  selectedContext = branch;
  showGeography(branch);
  $('hero-title').textContent = branch.title; $('hero-description').textContent = `${branch.summary || ''}${branch.causalLink ? ` Speculative cause: ${branch.causalLink}` : ''}`;
  $('hero-tag').textContent = 'SELECTED CAUSE · EXPLORING CONSEQUENCES';
  setStageMessage('Creating descendants of this selected path. Their scene will appear here.');
  status(`Following ${branch.title}…`); renderAncestry();
  await streamRun('/api/continue', { runId: parentRunId, branchId: branch.id }, request);
  if (request === replayRequest && currentRunId !== parentRunId) prefetchEventScenes(branchState.branches, currentRunId, currentManifest);
}
const archiveCachedIds = new Set(['alexandria', 'beringia', 'green-sahara', 'mechanisms']);
let archiveShowHistory = false, historyRequest = 0;
function renderArchive() {
  const cached = savedRuns.filter(run => archiveCachedIds.has(run.id));
  // ID-only history is not useful as a name. It remains in storage and becomes
  // discoverable when authenticated history or an opened manifest supplies metadata.
  const history = savedRuns.filter(run => !archiveCachedIds.has(run.id) && run.id !== 'guardrail'
    && (run.title && run.title !== run.id || run.divergence));
  const visible = [...cached, ...history.filter(run => archiveShowHistory || run.id === currentRunId)];
  $('runs').replaceChildren();
  if (!visible.length) $('runs').add(new Option('No saved stories yet', ''));
  for (const run of visible) $('runs').add(new Option(`${run.parentRunId ? '↳ ' : ''}${replayLabel(run)}`, run.id));
  if (currentRunId && visible.some(run => run.id === currentRunId)) $('runs').value = currentRunId;
  $('archive-history-toggle').textContent = archiveShowHistory ? 'Hide previous explorations' : 'Show previous explorations';
  $('archive-history-toggle').setAttribute('aria-pressed', String(archiveShowHistory));
  $('archive-history-hint').textContent = archiveShowHistory && !hasLiveAccess() && serviceMode === 'live-enabled' ? 'Enter your access code to see saved explorations.' : '';
}
function learnRunMetadata(id, branch, manifest) {
  const hero = branch.branches?.find(item => item.id === (branch.hero?.branchId || branch.hero?.id));
  const summary = { id, title: manifest.title || branch.hero?.title || hero?.title || branch.divergence || id,
    divergence: manifest.divergence || branch.divergence, status: manifest.status || branch.status,
    ...(Number.isInteger(hero?.year) ? { year: hero.year } : {}),
    ...(manifest.continuation?.parentRunId ? { parentRunId: manifest.continuation.parentRunId, parentBranchId: manifest.continuation.parentBranchId } : {}) };
  knownRunMetadata.set(id, summary);
  savedRuns = [...new Map([...savedRuns.map(run => [run.id, run]), [id, summary]]).values()];
  renderArchive();
}
async function refreshHistory() {
  const request = ++historyRequest;
  const headers = $('access').value ? { 'x-demo-access-code': $('access').value } : {};
  const responses = await Promise.allSettled([fetch('/runs'), hasLiveAccess() ? fetch('/api/history', { headers }) : Promise.resolve(null)]);
  const all = [];
  for (const result of responses) {
    if (result.status !== 'fulfilled' || !result.value?.ok) continue;
    const data = await result.value.json(); all.push(...(Array.isArray(data) ? data : data.runs || []));
  }
  if (request !== historyRequest) return;
  const merged = new Map(all.filter(run => run && typeof run.id === 'string').map(run => [run.id, run]));
  // Manifests already opened in this document are richer than ID-only local history.
  // Read this map after the fetches finish so a slower archive response cannot erase them.
  for (const [id, metadata] of knownRunMetadata) merged.set(id, metadata);
  savedRuns = [...merged.values()]; renderArchive();
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
  host.hidden = (!!selectedBranchId && !!branchState.heroId && selectedBranchId !== branchState.heroId) || (!recorded && !replayActive && !replayLoaded);
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
function reset({ preservePanel = false } = {}) { finishRootGenerationProgress(); assetLoadRequest++; assetsLoading = false; savedNavigationState = preservePanel ? 'loading' : ''; surfaceMode = 'scenario'; showGeography(null); voice.cancel(); replayRequest = navigation.begin().id; treeRenderRequest++; streamBusy = false; $('live-submit').disabled = serviceMode !== 'live-enabled'; currentRunId = ''; currentManifest = null; continuation = { path: [], children: [] }; selectedContext = null; continuationViewSelection = null; renderAncestry(); $('exploration-tree-status')?.replaceChildren(); $('event-children')?.replaceChildren(); $('event-consequences').hidden = true; branchState = { branches: [], heroId: null, phase: 'idle' }; trace = []; savedTrace = []; selectedBranchId = null; replayActive = false; replayLoaded = false; base = ''; hasImage = hasCutout = hasModel = false; modelAsset = ''; modelLoading = modelLoaded = modelError = false; loadingModelUrl = ''; loadedModelUrl = ''; modelRequestId++; modelApi?.clear?.(); globeApi?.select(null); document.body.classList.remove('invitation-open'); $('guardrail').hidden = true; $('generation').hidden = true; $('map-status').textContent = 'DRAG · SCROLL TO ZOOM'; $('hero-title').textContent = preservePanel ? 'Opening saved story…' : 'A world to step into'; $('hero-tag').textContent = branchPhaseLabel('idle'); $('hero-description').textContent = preservePanel ? '' : 'The strongest branch becomes a scene, then a subject to explore in three dimensions.'; $('selected-branch-context').hidden = true; $('selected-branch-context').replaceChildren(); setStageMessage(preservePanel ? 'Loading the selected saved story…' : 'A scene, a subject, a new dimension.'); renderBranches(); renderTrace(); setView('scene'); }
function setBranch(data, event = 'complete') {
  branchState = branchProgress(branchState, event, data);
  $('hero-tag').textContent = branchState.phase === 'final' ? (continuation.path?.length ? 'POSSIBLE CONSEQUENCE' : 'SELECTED EVENT') : branchPhaseLabel(branchState.phase);
  if (branchState.phase === 'blocked') { showGeography(null); showGuard(data); $('map-status').textContent = 'NO BRANCHES · REFRAME REQUIRED'; status('This question needs a reframe'); renderBranches(); return; }
  renderBranches();
  const hero = branchState.branches.find(b => b.id === branchState.heroId);
  if (!hero && event === 'complete') showGeography(null);
  if (hero) { showGeography(hero); if (event === 'complete') selectedContext = null; selectedBranchId = hero.id; $('hero-title').textContent = hero.title; $('hero-description').textContent = `${hero.summary}${hero.causalLink ? ` Speculative cause: ${hero.causalLink}` : ''}`; $('selected-branch-context').hidden = !selectedContext; if (selectedContext) $('selected-branch-context').textContent = `Speculative consequences of ${formatYear(selectedContext.year)} · ${selectedContext.title}. ${selectedContext.summary || ''}`; if (!hasImage) setStageMessage('Preparing the selected scene…'); syncBranchSelection(); globeApi?.focus(hero); }
  renderBranches();
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
  $('model-loading').hidden = activeView !== 'model'; $('model-loading-indicator').hidden = activeView !== 'model'; $('model-error').hidden = true;
  $('model-loading-label').textContent = 'Loading saved 3D model';
  $('model-progress').value = 0; $('model-progress-text').textContent = 'Preparing 3D model…';
  const fail = () => {
    if (requestId !== modelRequestId) return;
    loadingModelUrl = ''; modelLoading = false; modelLoaded = false; modelError = true;
    status('Saved 3D model failed to load. Retry from the 3D view.'); setView(activeView);
  };
  try {
  const loading = modelApi.load(url, {
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
    onError: fail,
  });
  loading?.catch?.(fail);
  } catch { fail(); }
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
    showGeography(arriving);
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
  const assetRequest = ++assetLoadRequest; assetsLoading = true;
  try {
    const [image, cutout, meshoptModel, model] = await Promise.all(['hero.png','cutout.png','model.meshopt.glb','model.glb'].map(n => exists(`${currentBase}/${n}`)));
    if (request !== null && request !== replayRequest || currentBase !== base) return false;
    hasImage = image; hasCutout = cutout; hasModel = meshoptModel || model; modelAsset = meshoptModel ? 'model.meshopt.glb' : model ? 'model.glb' : '';
    if (image) $('hero-image').src = `${currentBase}/hero.png`; if (cutout) $('cutout-image').src = `${currentBase}/cutout.png`;
    if (!image) setStageMessage('No hero scene image was saved with this story.');
    setView(continuationViewSelection || preferredView || (cutout ? 'cutout' : hasModel ? 'model' : 'scene'));
    return true;
  } finally { if (assetRequest === assetLoadRequest) assetsLoading = false; }
}
async function loadRun(id, { animate = true, autoConsequences = true, selectedBranchId: requestedBranchId } = {}) {
  if (!id) return; viewStatus(''); reset({ preservePanel: true }); const request = replayRequest; base = `/runs/${encodeURIComponent(id)}`; status('Opening saved story…');
  try {
    const [branchResponse, traceResponse, manifestResponse] = await Promise.all([fetch(asset('branch.json'), { signal: navigation.signal }),fetch(asset('trace.json'), { signal: navigation.signal }),fetch(base, { signal: navigation.signal })]);
    if (request !== replayRequest) return;
    if (!branchResponse.ok) throw new Error('Could not load this cached story');
    const branch = await branchResponse.json(); const record = traceResponse.ok ? await traceResponse.json() : {};
    let manifest = manifestResponse.ok ? await manifestResponse.json() : {};
    const remembered = knownRunManifests.get(id);
    if (remembered?.continuation?.children?.length) {
      const children = [...(manifest.continuation?.children || [])];
      for (const edge of remembered.continuation.children) {
        if (edge.status !== 'complete' || !edge.runId) continue;
        const index = children.findIndex(item => item.branchId === edge.branchId);
        if (index < 0) children.push(edge); else children[index] = edge;
      }
      manifest = { ...manifest, continuation: { ...(manifest.continuation || remembered.continuation), children } };
    }
    if (request !== replayRequest) return;
    await serviceModeReady;
    if (request !== replayRequest) return;
    const fragmentRunId = runIdFromHash(location.hash);
    if (!requestedBranchId && fragmentRunId === id) requestedBranchId = eventIdFromHash(location.hash);
    if (!branch.branches?.some(item => item.id === requestedBranchId)) requestedBranchId = '';
    currentRunId = id; continuation = manifest.continuation || { rootRunId: id, path: [], children: [] }; updateRunLocation(id, requestedBranchId); renderAncestry();
    currentManifest = { ...manifest, id, branch, continuation };
    knownRunManifests.set(id, currentManifest);
    learnRunMetadata(id, branch, manifest);
    $('prompt').value = branch.divergence || '';
    const records = record.steps || branch.trace || [];
    const focusTarget = branch.status === 'blocked' ? $('guardrail') : $('workspace');
    focusTarget.scrollIntoView({ behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth', block: 'start' });
    if (animate) await replaySavedBranches(branch, records, request);
    else { replayLoaded = true; savedTrace = records.filter(step => !step.summary); trace = savedTrace; setBranch(branch); renderTrace(); }
    if (request !== replayRequest) return;
    savedNavigationState = '';
    renderBranches();
    const requestedBranch = branchState.branches.find(item => item.id === requestedBranchId);
    if (requestedBranch) selectBranch(requestedBranch, { persistLocation: false });
    if (!await loadAssets('scene', request) || request !== replayRequest) return;
    renderBranches();
    const selected = branchState.branches.find(item => item.id === selectedBranchId) || branchState.branches.find(item => item.id === branchState.heroId);
    if (selected) {
      selectBranch(selected, { persistLocation: false });
      if (continuation.children?.some(item => item.branchId === selected.id && item.status === 'complete')) {
        try { await restoreSelectedConsequences(id, selected); }
        catch (error) { if (request === replayRequest) status(error.message || 'Could not load saved consequences'); }
      }
    }
    renderExplorationTree(true);
    if (autoConsequences && selected && request === replayRequest) activateBranch(selected, false, { persistSelection: false });
    status(manifest.status === 'simulated' ? 'Simulated guardrail · no classifier was called' : branch.status === 'blocked' ? 'This question needs a reframe' : branch.renderStatus === '2d-only' ? completionStatus(branch) : manifest.status === 'provisional' ? '2D preview · 3D model not generated' : 'Saved story ready');
  } catch (e) {
    if (request === replayRequest && e.name !== 'AbortError') {
      savedNavigationState = 'error';
      $('hero-title').textContent = 'Saved story unavailable'; $('hero-description').textContent = '';
      setStageMessage(e.message || 'Could not load this saved story'); renderBranches(); status(e.message || 'Could not load this saved story');
    }
  }
}
async function handleEvent(type, data, request) {
  if (request !== replayRequest) return;
  if (rootGenerationActive) {
    const stage = {
      policy: data.allowed === false || data.status === 'blocked' ? 'This question needs a reframe' : 'Checking the question against the topic policy…',
      propose: 'Developing possible futures…',
      review: 'Reviewing possible futures…',
      image: 'Creating the selected scene…',
      cutout: 'Isolating the selected subject…',
      '3d': 'Preparing the selected 3D object…',
    }[type];
    if (stage) updateRootGenerationProgress(stage);
  }
  if (type === 'policy') { if (data.allowed === false || data.status === 'blocked') showGuard(data); status(data.allowed === false ? 'This question needs a reframe' : 'Policy checked'); }
  if (type === 'propose' || type === 'review') { setBranch(data, type); if (type === 'propose' && branchState.branches.length) globeApi?.focus(branchState.branches[0]); status(type === 'propose' && branchState.phase === 'policy-checking' ? 'Topic policy checking · candidate text is not shown yet' : type === 'propose' && branchState.phase === 'empty' ? 'No suitable branches found' : type === 'propose' ? 'Policy-cleared paths · review in progress' : 'Hero selected · assets generating'); }
  if (data.trace) { trace = Array.isArray(data.trace) ? data.trace : data.trace.steps || trace; renderTrace(); }
  else if (data.ms != null || data.costUsd != null) { trace.push({ step: type, model: data.model, ms: data.ms, costUsd: data.costUsd }); renderTrace(); }
  if (data.runId || data.id && type === 'complete') base = `/runs/${encodeURIComponent(data.runId || data.id)}`;
  if (data.baseUrl) base = data.baseUrl;
  if (type === 'image' || type === 'cutout' || type === '3d' || type === 'complete') {
    if (type === 'cutout') { const unavailable = data.status === 'unavailable'; $('generation').hidden = unavailable; if (unavailable) status(completionStatus({ renderStatus: '2d-only' })); }
    if (type === '3d' || type === 'complete') $('generation').hidden = true;
    const incoming = data.branch || data;
    const incomingHero = incoming.branches?.find(branch => branch.id === (incoming.hero?.branchId || incoming.hero?.id));
    const keepAtlas = continuation.parentRunId || continuation.path?.length || surfaceGeography !== undefined || safeGeography(incomingHero?.geography) !== undefined;
    await loadAssets(keepAtlas ? continuationViewSelection || 'scene' : type === '3d' || (type === 'complete' && hasModel) ? 'model' : undefined, request);
  }
  if (request !== replayRequest) return;
  if (type === 'error') { if (rootGenerationActive) finishRootGenerationProgress(data.message || data.error || 'The run could not be completed'); if (branchState.phase === 'policy-checking') { branchState = { branches: [], heroId: null, phase: 'idle' }; $('hero-tag').textContent = branchPhaseLabel('idle'); renderBranches(); } $('generation').hidden = true; status(data.message || data.error || 'The run could not be completed'); }
  else if (type === 'complete') {
    const result = data.branch || data; setBranch(result);
    if (rootGenerationActive) finishRootGenerationProgress(branchState.phase === 'blocked' ? 'This question needs a reframe' : '');
    currentRunId = data.runId || data.id || currentRunId;
    if (data.continuation) continuation = data.continuation;
    if (currentRunId) {
      updateRunLocation(currentRunId);
      try {
        const response = await fetch(`/runs/${encodeURIComponent(currentRunId)}`, { signal: navigation.signal });
        if (request !== replayRequest) return;
        if (response.ok) { const manifest = await response.json(); if (request !== replayRequest) return; continuation = manifest.continuation || continuation; currentManifest = { ...manifest, id: currentRunId, branch: manifest.branch || result, continuation }; knownRunManifests.set(currentRunId, currentManifest); }
      } catch (e) { if (e.name === 'AbortError') return; }
      if (!currentManifest) { currentManifest = { id: currentRunId, branch: result, continuation }; knownRunManifests.set(currentRunId, currentManifest); }
      refreshHistory().catch(() => {});
    }
    renderAncestry(); renderBranches(); renderExplorationTree(true); status(data.reused ? 'Saved future reopened · no generation call' : completionStatus(result));
  }
}
async function streamRun(endpoint, body, request) {
  if (endpoint === '/api/run') startRootGenerationProgress();
  streamBusy = true; $('live-submit').disabled = true; renderBranches();
  const signal = navigation.signal;
  try {
    const response = await fetch(endpoint, { method:'POST', signal, headers:{'content-type':'application/json','x-demo-access-code':$('access').value}, body:JSON.stringify(body) });
    if (request !== replayRequest) return;
    if (!response.ok || !response.body) { let msg = `Unable to start (${response.status})`; try { const data = await response.json(); msg = data.error || msg; } catch {} throw new Error(msg); }
    const reader = response.body.getReader(), decoder = new TextDecoder(); let buffer = '';
    while (request === replayRequest) {
      const {value,done} = await reader.read();
      if (request !== replayRequest) { await reader.cancel(); return; }
      buffer += decoder.decode(value || new Uint8Array(), {stream:!done}); let match;
      while ((match = buffer.match(/\r?\n\r?\n/))) {
        const block = buffer.slice(0,match.index); buffer = buffer.slice(match.index + match[0].length); const event = parseSseBlock(block);
        if (event) await handleEvent(event.event, event.data, request);
        if (request !== replayRequest) return;
      }
      if (done) { if (buffer.trim()) { const event = parseSseBlock(buffer); if (event) await handleEvent(event.event, event.data, request); } break; }
    }
  } catch(e) {
    if (request === replayRequest && e.name !== 'AbortError') { if (rootGenerationActive) finishRootGenerationProgress(e.message || 'The run could not be completed'); status(`${e.message}${continuation.parentRunId ? ' · Return to the previous world to choose another path.' : ''}`); $('generation').hidden = true; }
  } finally {
    if (request === replayRequest) {
      if (rootGenerationActive) finishRootGenerationProgress('The exploration ended before it could be saved.');
      streamBusy = false; $('live-submit').disabled = serviceMode !== 'live-enabled'; renderBranches();
      if (endpoint === '/api/run' && currentRunId) {
        const selected = branchState.branches.find(branch => branch.id === selectedBranchId) || branchState.branches.find(branch => branch.id === branchState.heroId);
        if (selected && branchState.phase === 'final') activateBranch(selected, false, { background: true });
      }
    }
  }
}
async function runPrompt(prompt) {
  if (!prompt.trim() || streamBusy) return;
  if (serviceMode === 'replay-only') { status('Saved stories · run locally with your own Meta API key for fresh exploration'); return; }
  if (serviceMode !== 'live-enabled') { status('Service mode could not be confirmed · open a saved world below'); return; }
  if (!hasLiveAccess()) { status('Select a saved world, or enter a live access code.'); return; }
  viewStatus(''); reset(); history.pushState(null, '', location.pathname + location.search); $('prompt').value = prompt; status('Checking your question…');
  await streamRun('/api/run', {divergence:prompt}, replayRequest);
}
$('prompt-form').addEventListener('submit', e => { e.preventDefault(); runPrompt($('prompt').value); });
 $('show-invitation').addEventListener('click', () => {
  if (matchMedia('(max-width: 700px)').matches) {
    document.body.classList.toggle('invitation-open');
    $('show-invitation').setAttribute('aria-expanded', String(document.body.classList.contains('invitation-open')));
  } else $('show-invitation').setAttribute('aria-expanded', 'true');
  $('prompt').focus({ preventScroll: true });
 });
document.querySelectorAll('[data-prompt]').forEach(b => b.addEventListener('click', () => { voice.cancel(); $('prompt').value = b.dataset.prompt; if (b.dataset.run) loadRun(b.dataset.run); else $('prompt').focus(); }));
$('retry').addEventListener('click', () => {
  voice.cancel(); const prompt = $('retry').dataset.prompt; $('prompt').value = prompt;
  if (hasLiveAccess()) { runPrompt(prompt); return; }
  const cached = cachedRetryRun(savedRuns, prompt);
  if (cached) { $('runs').value = cached.id; loadRun(cached.id); }
  else status('No cached story matches this suggestion; select another story or enter a live access code.');
});
for (const mode of ['present', 'scenario']) $('geography-' + mode).addEventListener('click', () => setSurfaceMode(mode));
$('load-run').addEventListener('click', () => loadRun($('runs').value));
function toggleArchiveHistory() { archiveShowHistory = !archiveShowHistory; renderArchive(); if (archiveShowHistory) refreshHistory().catch(() => {}); }
$('archive-history-toggle').addEventListener('click', toggleArchiveHistory);
$('world-back').addEventListener('click', () => continuation.parentBranchId ? openAncestor(continuation.parentRunId, continuation.parentBranchId) : loadRun(continuation.parentRunId, { animate: false }));
  $('access').addEventListener('change', () => { refreshHistory().catch(() => {}); renderBranches(); });
function restoreLocationFromHash() {
  const hash = location.hash;
  if (hash === lastHandledLocationHash) return;
  lastHandledLocationHash = hash;
  const id = runIdFromHash(hash);
  if (id) loadRun(id, { animate: false, selectedBranchId: eventIdFromHash(hash) });
  else { viewStatus(''); reset(); }
}
window.addEventListener('hashchange', restoreLocationFromHash);
window.addEventListener('popstate', restoreLocationFromHash);
$('scene-view').addEventListener('click', () => { viewStatus(''); setView('scene', true); });
$('cutout-view').addEventListener('click', () => {
  const runId = currentRunId, branchId = selectedBranchId;
  if (!runId || !branchId) return;
  const key = eventKey(runId, branchId);
  const work = eventWork.get(key) || { runId, branchId, children: [] };
  eventWork.set(key, work);
  if (work.cutoutUrl || (branchId === branchState.heroId && hasCutout)) { viewStatus(''); setView('cutout', true); return; }
  if (work.cutoutRunning) return;
  work.cutoutRunning = true;
  work.cutoutRetryable = false; work.cutoutMessage = '';
  const access = $('access').value, allowCutoutGeneration = serviceMode === 'live-enabled' && hasLiveAccess();
  viewStatus('Cutout queued for checking and preparation…');
  const refreshScene = () => { if (isSelected(runId, branchId)) renderEventWork(); else renderBranches(); };
  const waitForScene = async () => {
    if (work.sceneUrl || (branchId === branchState.heroId && hasImage)) return true;
    work.sceneOnlyPrefetch = true;
    const sceneTask = work.sceneTaskPromise || queueSceneTask(runId, {id:branchId}, work, access, allowCutoutGeneration, refreshScene);
    await sceneTask;
    if (work.sceneUrl) return true;
    const message = work.sceneInProgress ? 'Scene generation is still in progress. Select the event scene again after it finishes.'
      : work.sceneMessage || 'A cutout needs a saved or newly generated event scene.';
    if (isSelected(runId, branchId)) viewStatus(message);
    work.cutoutRunning = false;
    return false;
  };
  const cutoutJob = async () => {
    try {
      if (isSelected(runId, branchId)) viewStatus('Checking and preparing the SAM cutout…', true);
      const params = new URLSearchParams({runId, branchId});
      let response = await fetch(`/api/event-cutout?${params}`, {headers:{'x-demo-access-code':access}});
      if (!response.ok) throw new Error('Could not check the cutout');
      let result = await response.json();
      if (result.status === 'missing' && allowCutoutGeneration) {
        if (isSelected(runId, branchId)) viewStatus('Creating this event’s SAM cutout…', true);
        const generated = await postWithCapacityRetry('/api/event-cutout', {
          method:'POST',headers:{'content-type':'application/json','x-demo-access-code':access},body:JSON.stringify({runId,branchId}),
        }, (delay, attempt, limit) => { if (isSelected(runId, branchId)) viewStatus(`Cutout queued · server busy, retry ${attempt}/${limit} in ${delay} ms`, true); });
        if (!generated.response.ok) {
          if (generated.response.status === 429 && generated.detail.status === 'retryable') {
            work.cutoutRetryable = true; work.cutoutMessage = 'SAM cutout is still waiting for capacity; select SAM cutout again to retry.';
            if (isSelected(runId, branchId)) { renderEventWork(); viewStatus(work.cutoutMessage); }
            return;
          }
          throw new Error(generated.detail.error || 'Could not create the cutout');
        }
        result = await generated.response.json();
      }
      if (result.status === 'complete' && result.url) {
        work.cutoutUrl = result.url;
        if (isSelected(runId, branchId)) { setView('cutout', true); viewStatus('SAM cutout ready'); }
      } else if (isSelected(runId, branchId)) {
        viewStatus(result.status === 'empty' ? 'SAM did not find a usable cutout for this scene.' : result.status === 'missing-image' ? 'The event scene must finish before a cutout can be created.' : result.status === 'missing' ? (serviceMode === 'replay-only' ? 'Run locally with your own Meta API key to create a fresh SAM cutout.' : 'A cutout needs live access.') : result.status === 'in-progress' ? 'Cutout generation is still in progress. Select SAM cutout again to check.' : 'The cutout could not be confirmed. Select SAM cutout again to check.');
      }
    } catch (error) { work.cutoutMessage = error.message || 'Could not create the cutout'; if (isSelected(runId, branchId)) viewStatus(work.cutoutMessage); }
    finally { work.cutoutRunning = false; if (isSelected(runId, branchId)) renderEventWork(); }
  };
  waitForScene().then(ready => {
    if (ready) enqueueEventJob(cutoutJob).catch(error => { work.cutoutRunning = false; if (isSelected(runId, branchId)) viewStatus(error.message || 'Could not create the cutout'); });
  }).catch(error => { work.cutoutRunning = false; if (isSelected(runId, branchId)) viewStatus(error.message || 'Could not create the cutout'); });
});
$('model-button').addEventListener('click', () => {
  const selectedHasModel = (!selectedBranchId || selectedBranchId === branchState.heroId) && hasModel && modelApi;
  if (selectedHasModel) { viewStatus(''); setView('model', true); }
  else if (assetsLoading && selectedBranchId) { viewStatus(''); setView('model', true); }
  else viewStatus('A 3D object is not available for this event. Fresh private 3D generation is not configured in this local preview.');
});
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
$('back-to-atlas').addEventListener('click', () => { setView('scene', true); $('scene-view').focus({ preventScroll: true }); });
$('retry-model').addEventListener('click', () => { loadedModelUrl = ''; loadingModelUrl = ''; modelError = false; requestModelLoad(); setView('model'); });
const sceneImage = $('hero-image'), sceneLightbox = $('scene-lightbox'), enlargedScene = $('scene-lightbox-image');
function openSceneLightbox() {
  if (sceneImage.hidden || !sceneImage.currentSrc) return;
  enlargedScene.src = sceneImage.currentSrc;
  enlargedScene.alt = sceneImage.alt;
  sceneLightbox.showModal();
}
sceneImage.addEventListener('click', openSceneLightbox);
sceneImage.addEventListener('keydown', event => {
  if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); openSceneLightbox(); }
});
$('scene-lightbox-close').addEventListener('click', () => sceneLightbox.close());
sceneLightbox.addEventListener('click', event => { if (event.target === sceneLightbox) sceneLightbox.close(); });
reset();
initializeStarMap();
serviceModeReady = loadServiceMode();
refreshHistory().catch(() => { $('runs').replaceChildren(new Option('Archive unavailable', '')); });
const linkedRun = runIdFromHash(location.hash); if (linkedRun) loadRun(linkedRun, { animate: false, selectedBranchId: eventIdFromHash(location.hash) });
import('./visuals.js').then(async ({createGlobe,createModelViewer}) => {
  // The independent model viewer can stay available if the globe CDN fails.
  try { modelApi = createModelViewer($('model-view')); setView(activeView); }
  catch { modelApi = null; setView(activeView); }
  try {
    globeApi = await createGlobe($('globe'), activateBranch);
    renderGeography();
    renderBranches();
    const visibleBranch = branchState.phase === 'replay' ? branchState.branches.at(-1) : branchState.branches.find(branch => branch.id === branchState.heroId);
    if (visibleBranch) globeApi.focus(visibleBranch);
  } catch { $('globe-fallback').hidden = false; }
}).catch(() => { $('globe-fallback').hidden = false; });
