import { ORBIT_UNFOLDED_LEVEL, SURFACE_LABEL_LEVEL, stableWorldId } from '../atlasLayout.js';
import { projectHistoryAtlas } from '../historyAtlas.js';
import { buildHistorySpineLayout } from '../historySpines.js';
import { migrateSavedRuns } from './worldModel.js';

export const ATLAS_AXIS_MODES = Object.freeze([
  ['history-distance', 'Distance from history'],
  ['branch-order', 'Branch order'],
  ['theme', 'Theme'],
]);
export const ATLAS_PRESENT_YEAR = 2026;
export const ATLAS_VISITED_WORLD_STORAGE_KEY = 'otherwise-atlas-visited-worlds-v1';
const MAX_VISITED_WORLD_IDS = 512;
const PRESENT_DAY_WORLD_ID = 'present-day-earth';

const text = value => typeof value === 'string' ? value.trim() : '';
const firstValue = (...values) => values.find(value => value !== undefined && value !== null && value !== '');
const numberOrNull = value => Number.isFinite(Number(value)) && Number(value) !== 0 ? Number(value) : null;
const object = value => value && typeof value === 'object' && !Array.isArray(value) ? value : {};

function coordinatesOf(node) {
  const place = object(node.place || node.location);
  const geography = object(node.geography || node.geog);
  const lat = firstValue(node.lat, place.lat, place.latitude, geography.lat, geography.latitude);
  const lon = firstValue(node.lon, node.lng, place.lon, place.lng, place.longitude, geography.lon, geography.lng, geography.longitude);
  return {
    ...(Number.isFinite(Number(lat)) ? { lat: Number(lat) } : {}),
    ...(Number.isFinite(Number(lon)) ? { lon: Number(lon) } : {}),
  };
}

function branchingPlaceOf(world) {
  if (!world || !Number.isFinite(world.lat) || world.lat < -90 || world.lat > 90
    || !Number.isFinite(world.lon) || world.lon < -180 || world.lon > 180) return undefined;
  const name = text(object(world.place || world.location).name);
  return name ? { name, lat: world.lat, lon: world.lon } : undefined;
}

function locationLabel(world) {
  if (!world || !Number.isFinite(world.lat) || world.lat < -90 || world.lat > 90
    || !Number.isFinite(world.lon) || world.lon < -180 || world.lon > 180) return '';
  const name = text(object(world.place || world.location).name);
  const coordinates = `${world.lat.toFixed(4)}°, ${world.lon.toFixed(4)}°`;
  return name ? `${name} · ${coordinates}` : `Recorded coordinates · ${coordinates}`;
}

function verifiedImageIdentity(node) {
  const event = object(node.eventRef || node.eventReference);
  const provenance = object(node.provenance);
  const runId = firstValue(node.runId, event.runId, provenance.sourceRunId);
  const branchId = firstValue(node.branchId, event.branchId, provenance.sourceBranchId);
  if (typeof runId !== 'string' || typeof branchId !== 'string'
    || !/^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/.test(runId) || !/^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/.test(branchId)) return null;
  const id = stableWorldId(node);
  const encodedId = `${encodeURIComponent(runId)}::${encodeURIComponent(branchId)}`;
  const canonicalId = `${runId}:${branchId}`;
  const plainDoubleId = `${runId}::${branchId}`;
  const matchesWorld = id === encodedId || id === canonicalId || id === plainDoubleId;
  const matchesRefs = (!event.runId || String(event.runId) === runId) && (!event.branchId || String(event.branchId) === branchId)
    && (!provenance.sourceRunId || String(provenance.sourceRunId) === runId)
    && (!provenance.sourceBranchId || String(provenance.sourceBranchId) === branchId);
  return { runId, branchId, matchesWorld: matchesWorld && matchesRefs };
}

function checkedThumbnailUrl(node, identity) {
  if (!identity?.matchesWorld || !(node.ready === true || node.sceneStatus === 'Scene ready' || node.status === 'Scene ready')) return null;
  const candidate = firstValue(node.thumbnail, node.scene);
  if (typeof candidate !== 'string' || !candidate.startsWith('/') || candidate.includes('\\') || candidate.includes('?') || candidate.includes('#')) return null;
  const eventPath = /^\/event-scenes\/[a-f\d]{64}\.png$/i.test(candidate);
  const heroPath = candidate === `/runs/${encodeURIComponent(identity.runId)}/hero.png`;
  if (eventPath || (heroPath && node.heroSelected === true)) return candidate;
  return null;
}

function verifiedHeroRef(node, identity, rawHeroRef, thumbnail) {
  if (node.heroSelected !== true || !identity?.matchesWorld) return undefined;
  const expectedUrl = `/runs/${encodeURIComponent(identity.runId)}/hero.png`;
  const record = object(rawHeroRef);
  if (thumbnail === expectedUrl) return { url: expectedUrl, status: 'complete', runId: identity.runId, branchId: identity.branchId };
  if (record.status !== 'complete'
    || (record.runId && String(record.runId) !== identity.runId)
    || (record.branchId && String(record.branchId) !== identity.branchId)
    || (record.url && record.url !== expectedUrl)
    || (record.path && ![`candidate/live/${identity.runId}/hero.png`, `candidate/runs/${identity.runId}/hero.png`].includes(record.path))) return undefined;
  if (record.url !== expectedUrl && !record.path) return undefined;
  return { url: expectedUrl, status: 'complete', runId: identity.runId, branchId: identity.branchId };
}

function verifiedSceneRef(rawSceneRef, identity) {
  if (!rawSceneRef || typeof rawSceneRef !== 'object' || rawSceneRef.status !== 'complete' || !identity?.matchesWorld) return undefined;
  if (String(rawSceneRef.runId ?? '') !== identity.runId || String(rawSceneRef.branchId ?? '') !== identity.branchId) return undefined;
  const url = rawSceneRef.url;
  if (typeof url !== 'string' || !/^\/event-scenes\/[a-f\d]{64}\.png$/i.test(url)) return undefined;
  return { url, status: 'complete', runId: identity.runId, branchId: identity.branchId };
}

function mapNodeToWorld(node, defaultQuestionId) {
  const id = stableWorldId(node);
  if (!id) return null;
  const parent = firstValue(node.parentId, node.parentWorldId);
  const questionId = firstValue(node.questionId, node.rootRunId, defaultQuestionId, node.runId, `question:${id}`);
  const coordinates = coordinatesOf(node);
  const eventRef = firstValue(node.eventRef, node.eventReference,
    node.runId && node.branchId ? { runId: String(node.runId), branchId: String(node.branchId) }
      : node.provenance?.sourceRunId && node.provenance?.sourceBranchId ? { runId: String(node.provenance.sourceRunId), branchId: String(node.provenance.sourceBranchId) } : undefined);
  const identity = verifiedImageIdentity(node);
  const rawSceneRef = firstValue(node.sceneRef, node.sceneReference, node.assetRefs?.sceneRef);
  const thumbnail = checkedThumbnailUrl(node, identity);
  const sceneRef = thumbnail && !thumbnail.endsWith('/hero.png')
    ? { url: thumbnail, status: 'complete', runId: identity.runId, branchId: identity.branchId }
    : verifiedSceneRef(rawSceneRef, identity) ?? (rawSceneRef && typeof rawSceneRef === 'object' && !rawSceneRef.url ? rawSceneRef : undefined);
  const rawHeroRef = firstValue(node.heroRef, node.assetRefs?.heroRef);
  const heroRef = verifiedHeroRef(node, identity, rawHeroRef, thumbnail);
  const cutoutRef = firstValue(node.cutoutRef, node.cutout, node.assetRefs?.cutoutRef);
  const modelRef = firstValue(node.modelRef, node.model, node.assetRefs?.modelRef);
  const geography = firstValue(node.geography, node.geog);
  const provenance = { ...object(node.provenance) };
  if (identity?.matchesWorld) {
    provenance.sourceRunId = identity.runId;
    provenance.sourceBranchId = identity.branchId;
  }
  return {
    ...node,
    id,
    parentId: parent == null ? null : String(parent),
    questionId: String(questionId),
    year: numberOrNull(node.year),
    title: text(node.title || node.label) || 'Untitled world',
    summary: text(node.summary || node.description),
    ...coordinates,
    ...(geography ? { geography } : {}),
    sceneRef: sceneRef ?? undefined,
    heroRef: heroRef ?? undefined,
    ...(cutoutRef !== undefined ? { cutoutRef } : {}),
    ...(modelRef !== undefined ? { modelRef } : {}),
    ...(eventRef !== undefined ? { eventRef } : {}),
    ...(Object.keys(provenance).length ? { provenance } : {}),
  };
}

function canonicalRunGraph(runData) {
  if (!Array.isArray(runData) || runData.length === 0) return { worlds: [], questions: [] };
  const graphs = runData.filter(record => Array.isArray(record?.worlds) && Array.isArray(record?.questions));
  if (graphs.length) {
    return {
      worlds: graphs.flatMap(graph => graph.worlds),
      questions: graphs.flatMap(graph => graph.questions),
    };
  }
  const records = runData.map(record => {
    const run = record?.run ?? record?.manifest ?? record;
    const runId = record?.runId ?? run?.runId ?? run?.id;
    return { runId, run, assetRefsByBranch: record?.assetRefsByBranch, assetRefs: record?.assetRefs };
  });
  return migrateSavedRuns(records);
}

function questionFromRoot(rootManifest, id, worlds) {
  if (!id) return null;
  const attachment = object(rootManifest?.questionAttachment);
  const questionObject = object(rootManifest?.question);
  const branchQuestion = object(rootManifest?.branch?.question);
  const questionText = text(typeof rootManifest?.question === 'string' ? rootManifest.question : '')
    || text(questionObject.prompt || questionObject.text || questionObject.question)
    || text(rootManifest?.prompt || rootManifest?.divergence || rootManifest?.rootDivergence
      || rootManifest?.branch?.divergence || branchQuestion.prompt || branchQuestion.text || rootManifest?.title);
  const years = worlds.filter(world => world.questionId === String(id)).map(world => numberOrNull(world.year)).filter(year => year != null);
  const divergenceYear = numberOrNull(attachment.divergenceYear ?? rootManifest?.divergenceYear ?? rootManifest?.question?.divergenceYear)
    ?? (years.length ? Math.min(...years) : null);
  const divergencePlace = firstValue(attachment.divergencePlace, rootManifest?.divergencePlace, rootManifest?.question?.divergencePlace);
  return {
    id: String(id), rootRunId: String(attachment.questionId ?? rootManifest?.rootRunId ?? id), question: questionText,
    ...(divergenceYear != null ? { divergenceYear } : {}),
    ...(divergencePlace !== undefined ? { divergencePlace } : {}),
    ...(attachment.mode ? { attachmentMode: attachment.mode } : {}),
    ...(attachment.parentWorldId ? { parentWorldId: String(attachment.parentWorldId) } : {}),
    ...(attachment.parentRunId ? { parentRunId: String(attachment.parentRunId) } : {}),
    ...(attachment.parentBranchId ? { parentBranchId: String(attachment.parentBranchId) } : {}),
  };
}

/** Adapt existing app nodes, canonical records, or saved run data without changing event IDs or refs. */
export function adaptAtlasGraph({
  mapNodes = [], worlds = [], questions = [], runData = [], rootManifest = null,
  rootRunId = null, currentRunId = null, selectedBranchId = null, currentWorldId = null,
} = {}) {
  const migrated = worlds.length || questions.length ? { worlds, questions } : canonicalRunGraph(runData);
  const defaultQuestionId = firstValue(rootManifest?.questionAttachment?.questionId, rootRunId, rootManifest?.rootRunId, rootManifest?.id, rootManifest?.runId);
  const sourceNodes = Array.isArray(mapNodes) && mapNodes.length ? mapNodes : migrated.worlds;
  const rootQuestionNode = sourceNodes.find(node => node?.role === 'root-question');
  const rootQuestionNodes = sourceNodes.filter(node => node?.role === 'root-question');
  const questionNodeIds = new Set(rootQuestionNodes.map(stableWorldId).filter(Boolean));
  const adaptedWorlds = sourceNodes.filter(node => node?.role !== 'root-question').map(node => {
    const world = mapNodeToWorld(node, defaultQuestionId);
    if (world && world.parentId != null && questionNodeIds.has(world.parentId)) world.parentId = null;
    return world;
  }).filter(Boolean);
  const questionRecords = new Map();
  for (const question of [...migrated.questions, ...(Array.isArray(questions) ? questions : [])]) {
    if (question?.id != null) questionRecords.set(String(question.id), { ...question, id: String(question.id) });
  }
  const rootQuestionId = defaultQuestionId || adaptedWorlds[0]?.questionId || null;
  const rootQuestionSource = rootQuestionNode ? { ...rootQuestionNode, ...object(rootManifest) } : rootManifest;
  const derivedQuestion = questionFromRoot(rootQuestionSource, rootQuestionId, adaptedWorlds);
  if (derivedQuestion && !questionRecords.has(derivedQuestion.id)) questionRecords.set(derivedQuestion.id, derivedQuestion);
  for (const world of adaptedWorlds) {
    if (!questionRecords.has(world.questionId)) {
      const derived = questionFromRoot(rootQuestionSource, world.questionId, adaptedWorlds);
      questionRecords.set(world.questionId, derived || { id: world.questionId, rootRunId: world.questionId, question: '' });
    }
  }
  const currentWorld = currentWorldId != null
    ? adaptedWorlds.find(world => world.id === String(currentWorldId))
    : adaptedWorlds.find(world => String(world.runId ?? world.provenance?.sourceRunId ?? '') === String(currentRunId ?? '')
      && String(world.branchId ?? world.provenance?.sourceBranchId ?? '') === String(selectedBranchId ?? ''));
  return {
    worlds: adaptedWorlds,
    questions: [...questionRecords.values()],
    currentWorldId: currentWorld?.id ?? (currentWorldId != null && adaptedWorlds.some(world => world.id === String(currentWorldId)) ? String(currentWorldId) : null),
    currentQuestionId: currentWorld?.questionId ?? rootQuestionId,
  };
}

function makeControl(doc, tag, labelText, parent) {
  const label = doc.createElement('label');
  label.textContent = labelText;
  const control = doc.createElement(tag);
  label.append(control);
  parent.append(label);
  return { label, control };
}

function radioGroup(doc, parent, legendText, name, choices, selectedValue) {
  const fieldset = doc.createElement('fieldset');
  const legend = doc.createElement('legend'); legend.textContent = legendText; fieldset.append(legend);
  const inputs = new Map();
  for (const [value, labelText] of choices) {
    const label = doc.createElement('label'), input = doc.createElement('input');
    input.type = 'radio'; input.name = name; input.value = value; input.checked = value === selectedValue;
    input.setAttribute('aria-label', labelText); label.append(input, doc.createTextNode(labelText)); fieldset.append(label); inputs.set(value, input);
  }
  parent.append(fieldset);
  return { fieldset, inputs };
}

/** Mount labelled atlas controls and bridge explicit scene entry/preview callbacks to app code. */
export async function createAtlasController({
  container, toolbarContainer = null, renderer = null, rendererFactory = null,
  graph = {}, mapNodes = [], worlds = [], questions = [], runData = [], rootManifest = null,
  currentRunId = null, selectedBranchId = null, currentWorldId = null,
  onPreview = () => {}, onEnter = () => {}, onQuestionPreview = () => {}, onQuestionEnter = () => {}, onMetrics = () => {}, onLevelChange = () => {},
  onAttachmentIntent = () => {}, onViewOptionsChange = () => {}, onHistoryEventSelect = () => {},
  onHistorySelect = () => {}, onQuestionSelect = () => {},
  getZoomOutTarget = () => null,
  visitedStorage = undefined,
  document: documentObject = container?.ownerDocument, window: windowObject = documentObject?.defaultView,
  reducedMotion = windowObject?.matchMedia?.('(prefers-reduced-motion: reduce)')?.matches ?? false,
} = {}) {
  if (!container?.append || !documentObject) throw new TypeError('createAtlasController requires a DOM container');
  const data = adaptAtlasGraph({ ...graph, mapNodes: graph.mapNodes ?? mapNodes, worlds: graph.worlds ?? worlds, questions: graph.questions ?? questions, runData: graph.runData ?? runData, rootManifest: graph.rootManifest ?? rootManifest, currentRunId: graph.currentRunId ?? currentRunId, selectedBranchId: graph.selectedBranchId ?? selectedBranchId, currentWorldId: graph.currentWorldId ?? currentWorldId });
  let disposed = false;
  let currentId = data.currentWorldId;
  let focusedPlaceWorldId = null;
  let storage = visitedStorage;
  if (storage === undefined) { try { storage = windowObject?.sessionStorage; } catch { storage = null; } }
  const isSafeWorldId = value => typeof value === 'string' && value.length > 0 && value.length <= 256 && !/[\u0000-\u001f\u007f]/.test(value);
  const visitedWorldIds = new Set();
  try {
    const loaded = JSON.parse(storage?.getItem?.(ATLAS_VISITED_WORLD_STORAGE_KEY) || '[]');
    if (Array.isArray(loaded)) for (const id of loaded.slice(-MAX_VISITED_WORLD_IDS)) if (isSafeWorldId(id)) visitedWorldIds.add(id);
  } catch {}
  const persistVisitedWorldIds = () => { try { storage?.setItem?.(ATLAS_VISITED_WORLD_STORAGE_KEY, JSON.stringify([...visitedWorldIds])); } catch {} };
  const rememberVisitedId = id => {
    if (!isSafeWorldId(id)) return;
    visitedWorldIds.delete(id); visitedWorldIds.add(id);
    while (visitedWorldIds.size > MAX_VISITED_WORLD_IDS) visitedWorldIds.delete(visitedWorldIds.values().next().value);
    persistVisitedWorldIds();
  };
  const worldRecords = new Map(data.worlds.map(world => [world.id, visitedWorldIds.has(world.id) ? { ...world, explored: true } : world]));
  if (currentId && worldRecords.has(currentId)) {
    rememberVisitedId(currentId);
    const selected = worldRecords.get(currentId);
    if (selected.explored !== true) worldRecords.set(currentId, { ...selected, explored: true });
  }
  data.worlds = [...worldRecords.values()];
  const questionRecords = new Map(data.questions.map(question => [question.id, question]));
  let historyProjection = null;
  let historyProjectionSignature = '';
  const viewOptions = { axisMode: 'history-distance', travelMode: reducedMotion ? 'cut' : 'threads', ghostTrail: false, attachment: 'current', reducedMotion: Boolean(reducedMotion) };
  let toolbar = toolbarContainer;
  if (!toolbar) { toolbar = documentObject.createElement('div'); toolbar.setAttribute('role', 'toolbar'); toolbar.setAttribute('aria-label', 'Atlas controls'); container.parentElement?.insertBefore(toolbar, container); }
  toolbar.replaceChildren?.(); toolbar.setAttribute('role', 'toolbar'); toolbar.setAttribute('aria-label', 'Atlas controls');
  const viewOptionsDetails = documentObject.createElement('details');
  viewOptionsDetails.className = 'atlas-view-options';
  viewOptionsDetails.setAttribute('data-atlas-zoom-ignore', 'true');
  const viewOptionsSummary = documentObject.createElement('summary'); viewOptionsSummary.textContent = 'View options';
  viewOptionsDetails.append(viewOptionsSummary); toolbar.append(viewOptionsDetails);
  const viewOptionsBody = documentObject.createElement('div'); viewOptionsBody.className = 'atlas-view-options-body'; viewOptionsDetails.append(viewOptionsBody);
  const makeButton = (label, ariaLabel) => { const button = documentObject.createElement('button'); button.type = 'button'; button.textContent = label; button.setAttribute('aria-label', ariaLabel); button.style.minWidth = '44px'; button.style.minHeight = '44px'; viewOptionsBody.append(button); return button; };
  const zoomOut = makeButton('−', 'Zoom out'), zoomIn = makeButton('+', 'Zoom in');
  const updateZoomControls = (value, surfaceDetail = sceneApi?.getSurfaceDetailZoom?.() ?? 0) => {
    const zoom = Math.max(0, Math.min(1, Number(value) || 0));
    const detail = Math.max(0, Math.min(100, Number(surfaceDetail) || 0));
    zoomOut.disabled = zoom >= 1 && detail <= 0;
    zoomIn.disabled = zoom <= 0 && detail >= 100;
  };
  const surface = makeControl(documentObject, 'input', 'Labelled pins (surface)', viewOptionsBody).control;
  surface.type = 'number'; surface.min = '0'; surface.max = '7'; surface.step = '1'; surface.value = String(SURFACE_LABEL_LEVEL); surface.setAttribute('aria-valuetext', `${SURFACE_LABEL_LEVEL} labelled pins`);
  const unfold = makeControl(documentObject, 'input', 'Unfolded worlds (orbit)', viewOptionsBody).control;
  unfold.type = 'number'; unfold.min = '0'; unfold.max = '7'; unfold.step = '1'; unfold.value = String(ORBIT_UNFOLDED_LEVEL); unfold.setAttribute('aria-valuetext', `${ORBIT_UNFOLDED_LEVEL} unfolded worlds`);
  const axisLabel = documentObject.createElement('label'); axisLabel.textContent = 'Vertical axis';
  const axis = documentObject.createElement('select'); axis.setAttribute('aria-label', 'Vertical axis');
  for (const [value, labelText] of ATLAS_AXIS_MODES) { const option = documentObject.createElement('option'); option.value = value; option.textContent = labelText; axis.append(option); }
  axis.value = viewOptions.axisMode; axisLabel.append(axis); viewOptionsBody.append(axisLabel);
  const travelLabel = documentObject.createElement('label'); travelLabel.textContent = 'Camera travel';
  const travel = documentObject.createElement('select'); travel.setAttribute('aria-label', 'Camera travel');
  for (const [value, labelText] of [['threads', 'Travel along threads'], ['cut', 'Cut directly']]) { const option = documentObject.createElement('option'); option.value = value; option.textContent = labelText; travel.append(option); }
  travel.value = viewOptions.travelMode; travel.disabled = Boolean(reducedMotion); if (reducedMotion) travel.setAttribute('aria-description', 'Reduced motion uses direct cuts');
  travelLabel.append(travel); viewOptionsBody.append(travelLabel);
  const ghost = makeControl(documentObject, 'input', 'Ghost trail', viewOptionsBody).control; ghost.type = 'checkbox'; ghost.checked = false;
  const attachment = radioGroup(documentObject, viewOptionsBody, 'Attach a new question to', 'atlas-question-attachment', [['current', 'Current world'], ['present', 'Present-day Earth']], viewOptions.attachment);
  const legacyOrbitField = unfold.parentElement;
  const historyLegacyFields = [legacyOrbitField, axisLabel, travelLabel, ghost.parentElement];
  const setHistoryControlVisibility = active => { for (const field of historyLegacyFields) if (field) field.hidden = Boolean(active); };

  const currentWorld = () => data.worlds.find(world => world.id === currentId) || null;
  const focusPlace = makeButton('Focus place', 'Focus selected location on Surface');
  const placeStatus = documentObject.createElement('span');
  placeStatus.setAttribute('role', 'status');
  placeStatus.setAttribute('aria-live', 'polite');
  placeStatus.className = 'atlas-place-context';
  placeStatus.setAttribute('aria-label', 'Branching location context');
  toolbar.append(placeStatus);
  const updatePlaceControls = () => {
    const world = historyProjection ? null : currentWorld();
    const hasCoordinates = Boolean(world && Number.isFinite(world.lat) && world.lat >= -90 && world.lat <= 90
      && Number.isFinite(world.lon) && world.lon >= -180 && world.lon <= 180);
    focusPlace.disabled = !hasCoordinates;
    focusPlace.hidden = !hasCoordinates;
    placeStatus.hidden = !hasCoordinates;
    placeStatus.textContent = locationLabel(world);
    placeStatus.title = hasCoordinates ? `Branching location: ${locationLabel(world)}` : '';
  };
  const markWorldVisited = id => {
    const worldId = String(id ?? '');
    if (!isSafeWorldId(worldId) || !worldRecords.has(worldId)) return null;
    rememberVisitedId(worldId);
    const existing = worldRecords.get(worldId);
    const visited = existing.explored === true ? existing : { ...existing, explored: true };
    worldRecords.set(worldId, visited);
    data.worlds = [...worldRecords.values()];
    return visited;
  };
  const intent = () => viewOptions.attachment === 'present'
    ? { mode: 'present-day', parentId: null, divergenceYear: ATLAS_PRESENT_YEAR, currentWorldId: currentId,
      ...(focusedPlaceWorldId === currentId && branchingPlaceOf(currentWorld()) ? { divergencePlace: branchingPlaceOf(currentWorld()) } : {}) }
    : { mode: 'current-world', parentId: currentId, divergenceYear: currentWorld()?.year ?? null, currentWorldId: currentId };
  const notifyViewOptions = () => onViewOptionsChange({ ...viewOptions });
  let sceneApi = renderer;
  const explicitEnter = world => {
    if (disposed || !world || world.selectable === false || world.isExpansionPlaceholder) return false;
    if (world.kind === 'present-day' || world.id === PRESENT_DAY_WORLD_ID) {
      viewOptions.attachment = 'present';
      attachment.inputs.get('present').checked = true;
      const attachmentIntent = intent();
      onAttachmentIntent(attachmentIntent);
      onEnter(world, { source: 'present-day-question', attachmentIntent });
      notifyViewOptions();
      return true;
    }
    const id = stableWorldId(world);
    if (!id || !worldRecords.has(id)) return false;
    if (id !== currentId) focusedPlaceWorldId = null;
    currentId = id;
    const visited = markWorldVisited(id) || world;
    updatePlaceControls();
    sceneApi?.setWorlds?.({ worlds: data.worlds, questions: data.questions, currentId });
    sceneApi?.enterWorld?.(id, { zoom: 0 });
    onEnter(visited, { source: 'atlas-explicit-entry' });
    notifyViewOptions();
    return true;
  };
  if (!sceneApi) {
    const factory = rendererFactory || (await import('./scene.js')).createAtlasScene;
    sceneApi = await factory(container, {
      onPreview: (world, anchor) => { if (!disposed) onPreview(world ?? null, anchor); },
      onEnter: explicitEnter,
      onQuestionPreview: (question, anchor) => {
        if (!disposed) onQuestionPreview(question && questionRecords.get(String(question.id)) || question || null, anchor);
      },
      onQuestionEnter: (question, anchor) => {
        if (disposed || !question || !questionRecords.has(String(question.id))) return false;
        onQuestionEnter(questionRecords.get(String(question.id)), anchor);
        return true;
      },
      onHistoryEventSelect: (event, anchor) => {
        if (disposed || !historyProjection || !event) return false;
        onHistoryEventSelect(event, {
          questionId: historyProjection.questionId,
          historyId: String(event.historyId ?? historyProjection.historyId),
          date: historyProjection.asOfYear,
          visualKind: event.visualKind,
          source: anchor?.source || 'pointer',
          anchor: anchor || null,
        });
        return true;
      },
      onHistorySelect: (historyId, anchor) => {
        if (disposed || !historyProjection || String(historyProjection.historyId) === String(historyId)) return false;
        onHistorySelect(String(historyId), { questionId:historyProjection.questionId,
          date:historyProjection.asOfYear, source:anchor?.source || 'pointer', anchor:anchor || null });
        return true;
      },
      onQuestionSelect: (questionId, anchor) => {
        if (disposed || !historyProjection) return false;
        const question = questionRecords.get(String(questionId))
          || historyProjection.questions?.find(item => String(item.id) === String(questionId));
        if (!question) return false;
        onQuestionSelect(String(question.id), { question, source:anchor?.source || 'pointer', anchor:anchor || null });
        return true;
      },
      onMetrics,
      onZoomChange: zoom => updateZoomControls(zoom),
      onSurfaceDetailChange: (detail, zoom) => updateZoomControls(zoom, detail),
      onLevelChange: level => { updateZoomControls(Number(level?.zoom ?? sceneApi?.getZoom?.() ?? 0)); onLevelChange(level); },
      surfaceLabelLevel: SURFACE_LABEL_LEVEL,
      orbitLevel: ORBIT_UNFOLDED_LEVEL,
      reducedMotion: Boolean(reducedMotion),
    });
  }
  const scene = sceneApi;
  scene.setWorlds?.({ worlds: data.worlds, questions: data.questions, currentId });
  scene.setAxisMode?.(viewOptions.axisMode);
  scene.setSurfaceLabelLevel?.(SURFACE_LABEL_LEVEL);
  scene.setOrbitLevel?.(ORBIT_UNFOLDED_LEVEL);
  scene.setTravelMode?.(viewOptions.travelMode);
  scene.setGhostTrail?.(false);
  updatePlaceControls();
  const focusSelectedPlace = () => {
    if (disposed || focusPlace.disabled || !currentId) return false;
    // Reuse the scene's selected-world Surface orientation without firing the
    // app's world-entry callback or starting consequence generation.
    const focused = typeof scene.focusWorld === 'function'
      ? scene.focusWorld(currentId)
      : scene.enterWorld?.(currentId, { zoom: 0 });
    if (focused === false) return false;
    focusedPlaceWorldId = currentId;
    onAttachmentIntent(intent());
    return true;
  };
  const syncSurfaceDetail = value => {
    scene.setSurfaceDetailZoom?.(value);
    updateZoomControls(Number(scene.getZoom?.()) || 0, Number(scene.getSurfaceDetailZoom?.()) || 0);
  };
  const syncZoom = value => { const zoom = Math.max(0, Math.min(1, Number(value) || 0)); updateZoomControls(zoom); scene.setZoom?.(zoom); };
  updateZoomControls(Number(scene.getZoom?.()) || 0);
  zoomOut.addEventListener('click', () => {
    const currentZoom = Number(scene.getZoom?.()) || 0;
    const detail = Number(scene.getSurfaceDetailZoom?.()) || 0;
    if (detail > 0) { syncSurfaceDetail(Math.max(0, detail - 8)); return; }
    const targetZoom = getZoomOutTarget(currentZoom);
    syncZoom(Number.isFinite(targetZoom) ? targetZoom : currentZoom + 0.08);
  });
  zoomIn.addEventListener('click', () => {
    const currentZoom = Number(scene.getZoom?.()) || 0;
    if (currentZoom <= 0) syncSurfaceDetail(Math.min(100, (Number(scene.getSurfaceDetailZoom?.()) || 0) + 8));
    else syncZoom(currentZoom - 0.08);
  });
  focusPlace.addEventListener('click', focusSelectedPlace);
  surface.addEventListener('input', () => { const value = Math.max(0, Math.min(7, Number(surface.value) | 0)); surface.value = String(value); surface.setAttribute('aria-valuetext', `${value} labelled pins`); scene.setSurfaceLabelLevel?.(value); });
  unfold.addEventListener('input', () => { const value = Math.max(0, Math.min(7, Number(unfold.value) | 0)); unfold.value = String(value); unfold.setAttribute('aria-valuetext', `${value} unfolded worlds`); scene.setOrbitLevel?.(value); });
  axis.addEventListener('change', () => { if (!ATLAS_AXIS_MODES.some(([value]) => value === axis.value)) return; viewOptions.axisMode = axis.value; scene.setAxisMode?.(axis.value); notifyViewOptions(); });
  travel.addEventListener('change', () => { if (reducedMotion) { travel.value = 'cut'; return; } viewOptions.travelMode = travel.value === 'cut' ? 'cut' : 'threads'; scene.setTravelMode?.(viewOptions.travelMode); notifyViewOptions(); });
  ghost.addEventListener('change', () => { viewOptions.ghostTrail = ghost.checked; scene.setGhostTrail?.(ghost.checked); notifyViewOptions(); });
  for (const [mode, input] of attachment.inputs) input.addEventListener('change', () => {
    if (!input.checked) return;
    viewOptions.attachment = mode; onAttachmentIntent(intent()); notifyViewOptions();
  });

  return {
    scene,
    getData: () => ({ worlds: [...data.worlds], questions: [...data.questions], currentWorldId: currentId }),
    getViewOptions: () => ({ ...viewOptions }),
    getAttachmentIntent: intent,
    focusSelectedPlace,
    setGeography(geography, mode, renderState) { if (!disposed && !historyProjection) scene.setGeography?.(geography, mode, renderState); },
    setHistoryView(snapshot = null) {
      if (disposed) return null;
      if (snapshot == null) {
        historyProjection = null;
        historyProjectionSignature = '';
        setHistoryControlVisibility(false);
        scene.setHistoryView?.(null);
        scene.setWorlds?.({ worlds: data.worlds, questions: data.questions, currentId });
        updatePlaceControls();
        return null;
      }
      const activeQuestionId = String(snapshot.activeQuestionId ?? snapshot.questionId ?? snapshot.question?.id ?? '');
      const question = snapshot.question || questionRecords.get(activeQuestionId)
        || snapshot.questions?.find(item => String(item.id) === activeQuestionId);
      const asOfYear = snapshot.asOfYear ?? snapshot.date;
      const spineQuestions = Array.isArray(snapshot.questions) ? [...snapshot.questions] : [...questionRecords.values()];
      for (const item of spineQuestions) if (item?.id != null) questionRecords.set(String(item.id), item);
      if (question && !spineQuestions.some(item => String(item.id) === activeQuestionId)) spineQuestions.push(question);
      const projection = {
        ...projectHistoryAtlas(question, {
        historyId: snapshot.historyId ?? snapshot.history?.id,
        asOfYear,
        window: snapshot.window,
        suggestions: snapshot.suggestions,
        }),
        selectedEventId: snapshot.selectedEventId == null ? '' : String(snapshot.selectedEventId),
        selectedEventHistoryId: String(snapshot.selectedEventHistoryId ?? snapshot.historyId ?? snapshot.history?.id ?? ''),
        surfaceMode: snapshot.surfaceMode === 'present' ? 'present' : 'scenario',
        activeQuestionId,
        questions:spineQuestions,
        showOrbit: Boolean(snapshot.showOrbit),
      };
      projection.spineLayout = buildHistorySpineLayout({ questions:spineQuestions, activeQuestionId,
        activeHistoryId:projection.historyId, asOfYear:projection.asOfYear, window:projection.window,
        suggestions:projection.suggestions });
      projection.siblingEarths = projection.spineLayout.siblingEarths;
      // Geography controls provide a local display preview. Keep it separate
      // from the event-derived as-of composition used by the history model.
      const suppliedSurfaceGeography = snapshot.surfaceGeography ?? snapshot.composedGeography;
      if (projection.surfaceMode === 'present') {
        projection.surfaceGeography = null;
        projection.surface = { ...projection.surface, geography: null };
      } else if (suppliedSurfaceGeography != null) {
        try {
          projection.surfaceGeography = typeof structuredClone === 'function'
            ? structuredClone(suppliedSurfaceGeography)
            : JSON.parse(JSON.stringify(suppliedSurfaceGeography));
          projection.surface = { ...projection.surface, geography: projection.surfaceGeography };
        } catch {
          // Ignore invalid/non-serializable preview state and render the
          // canonical composition from the active history instead.
        }
      }
      const signature = JSON.stringify(projection);
      historyProjection = projection;
      setHistoryControlVisibility(true);
      if (signature !== historyProjectionSignature) {
        historyProjectionSignature = signature;
        scene.setHistoryView?.(projection);
      }
      updatePlaceControls();
      return projection;
    },
    getHistoryView: () => historyProjection,
    setGraph(next = {}) {
      if (disposed) return;
      const updated = adaptAtlasGraph(next);
      const incomingIds = new Set(updated.worlds.map(world => world.id));
      const incomingQuestions = new Set([
        ...updated.questions.map(question => String(question.id)),
        ...updated.worlds.map(world => String(world.questionId ?? '')).filter(Boolean),
      ]);
      const explicitQuestionIds = new Set((Array.isArray(next.questions) ? next.questions : []).map(question => String(question?.id ?? '')));
      const incomingById = new Map(updated.worlds.map(world => [world.id, world]));
      for (const world of updated.worlds) worldRecords.set(world.id, visitedWorldIds.has(world.id) ? { ...world, explored: true } : world);
      for (const question of updated.questions) {
        const id = String(question.id);
        const inferredEmpty = !text(question.question) && Object.keys(question).every(key => ['id', 'rootRunId', 'question'].includes(key));
        if (!inferredEmpty || explicitQuestionIds.has(id) || !questionRecords.has(id)) questionRecords.set(id, question);
      }

      // Pending clouds are the only graph nodes reconciled by absence. Keep
      // them for inactive roots; remove them when their parent stops generating,
      // or on the explicit empty-map reset/abort update.
      const emptyMapUpdate = Array.isArray(next.mapNodes) && next.mapNodes.length === 0
        && (!Array.isArray(next.worlds) || next.worlds.length === 0)
        && (!Array.isArray(next.runData) || next.runData.length === 0);
      for (const [id, world] of worldRecords) {
        if (!world.isExpansionPlaceholder || incomingIds.has(id)) continue;
        const parent = incomingById.get(String(world.parentId ?? ''));
        if (emptyMapUpdate || (parent && incomingQuestions.has(String(world.questionId ?? '')) && parent.mapState !== 'generating')) worldRecords.delete(id);
      }
      data.worlds = [...worldRecords.values()];
      data.questions = [...questionRecords.values()];
      if (Object.prototype.hasOwnProperty.call(next, 'currentWorldId')) {
        const requested = next.currentWorldId == null ? null : String(next.currentWorldId);
        if (requested !== currentId) focusedPlaceWorldId = null;
        currentId = requested && worldRecords.has(requested) ? requested : null;
        if (currentId) markWorldVisited(currentId);
      }
      data.worlds = [...worldRecords.values()];
      updatePlaceControls();
      if (!historyProjection) scene.setWorlds?.({ worlds: data.worlds, questions: data.questions, currentId });
    },
    enterWorld(id, { zoom = 0 } = {}) {
      if (disposed) return false;
      if (historyProjection) {
        const sibling = historyProjection.siblingEarths?.find(item => item.id === String(id));
        if (sibling) {
          onHistorySelect(String(sibling.historyId), { questionId:historyProjection.questionId, date:historyProjection.asOfYear,
            source:'controller-explicit-entry', anchor:null });
          return true;
        }
        const selected = [...historyProjection.pins, ...historyProjection.suggestions].find(item => item.id === String(id))
          || historyProjection.spineLayout?.nodes?.find(node => node.eventId === String(id))?.event;
        if (!selected) return false;
        const eventNode = historyProjection.spineLayout?.nodes?.find(node => node.eventId === String(selected.id));
        const owner = questionRecords.get(String(historyProjection.activeQuestionId))?.histories?.find(history =>
          history.events?.some(event => String(event.id) === String(selected.id)));
        const selectedHistoryId = String(selected.historyId || owner?.id || eventNode?.historyId || historyProjection.historyId);
        onHistoryEventSelect({ ...selected, historyId:selectedHistoryId }, { questionId: historyProjection.questionId, historyId: selectedHistoryId,
          date: historyProjection.asOfYear, visualKind: selected.visualKind, source: 'controller-explicit-entry', anchor: null });
        return true;
      }
      if (String(id) === PRESENT_DAY_WORLD_ID) return explicitEnter({ id: PRESENT_DAY_WORLD_ID, kind: 'present-day', year: ATLAS_PRESENT_YEAR, title: 'Present-day Earth' });
      const world = data.worlds.find(item => item.id === String(id));
      if (!world || world.selectable === false || world.isExpansionPlaceholder) return false;
      if (world.id !== currentId) focusedPlaceWorldId = null;
      currentId = world.id;
      const visited = markWorldVisited(world.id) || world;
      updatePlaceControls();
      scene.setWorlds?.({ worlds: data.worlds, questions: data.questions, currentId });
      scene.enterWorld?.(world.id, { zoom }); onEnter(visited, { source: 'controller-explicit-entry' }); return true;
    },
    setViewOptions(next = {}) {
      if (disposed) return;
      if (ATLAS_AXIS_MODES.some(([value]) => value === next.axisMode)) { viewOptions.axisMode = next.axisMode; axis.value = next.axisMode; scene.setAxisMode?.(next.axisMode); }
      if (next.travelMode === 'threads' || next.travelMode === 'cut') { viewOptions.travelMode = reducedMotion ? 'cut' : next.travelMode; travel.value = viewOptions.travelMode; scene.setTravelMode?.(viewOptions.travelMode); }
      if (typeof next.ghostTrail === 'boolean') { viewOptions.ghostTrail = next.ghostTrail; ghost.checked = next.ghostTrail; scene.setGhostTrail?.(next.ghostTrail); }
      notifyViewOptions();
    },
    destroy() { if (disposed) return; disposed = true; scene.destroy?.(); if (!toolbarContainer) toolbar.remove(); },
  };
}
