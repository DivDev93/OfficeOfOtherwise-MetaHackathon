import test from 'node:test';
import assert from 'node:assert/strict';
import { adaptAtlasGraph, ATLAS_VISITED_WORLD_STORAGE_KEY, createAtlasController } from '../web/atlas/controller.js';
import { atlasLOD } from '../web/atlas/p2Atlas.js';
import { defaultWorldImageUrl } from '../web/atlas/imageRefs.js';

class Element {
  constructor(document, tagName) {
    this.ownerDocument = document; this.tagName = tagName; this.children = []; this.parentElement = null;
    this.attributes = new Map(); this.listeners = new Map(); this.style = {}; this.value = ''; this.checked = false; this.disabled = false;
    this.textContent = ''; this.type = '';
  }
  append(...children) { for (const child of children) { child.parentElement = this; this.children.push(child); } }
  replaceChildren(...children) { this.children = []; this.append(...children); }
  setAttribute(name, value) { this.attributes.set(name, String(value)); }
  getAttribute(name) { return this.attributes.get(name) ?? null; }
  addEventListener(type, listener) { if (!this.listeners.has(type)) this.listeners.set(type, []); this.listeners.get(type).push(listener); }
  dispatch(type) { for (const listener of this.listeners.get(type) || []) listener({ type, target: this, currentTarget: this }); }
  remove() { if (this.parentElement) this.parentElement.children = this.parentElement.children.filter(child => child !== this); }
}

function fakeDocument() {
  const doc = {
    createElement(tag) { return new Element(doc, tag); },
    createTextNode(text) { const node = new Element(doc, '#text'); node.textContent = text; return node; },
    defaultView: { matchMedia: () => ({ matches: false }) },
  };
  return doc;
}

function all(root) { return [root, ...root.children.flatMap(all)]; }
function byLabel(root, label) { return all(root).find(element => element.getAttribute?.('aria-label') === label); }
function byText(root, label) { return all(root).find(element => element.tagName === 'label' && element.textContent === label); }

function sampleNodes() {
  const sceneRef = { path: 'fixture/run-1/event.png', status: 'complete' };
  const eventRef = { runId: 'run-1', branchId: 'event-1' };
  const root = { id: 'root:run-1', role: 'root-question', rootNodeId: 'root:run-1', runId: 'run-1', divergence: 'What if the coast stayed exposed?', divergenceYear: 1800 };
  const world = { id: 'run-1::event-1', parentId: root.id, runId: 'run-1', branchId: 'event-1', rootRunId: 'run-1', year: 1902, title: 'Kuching', summary: 'A connected coast.', place: { name: 'Kuching', lat: 1.55, lon: 110.35 }, sceneRef, eventRef, thumbnail: '/fixture-asset?worldId=run-1%3A%3Aevent-1&kind=scene', theme: 'geography-ecology', boldness: .8 };
  return { root, world, sceneRef, eventRef };
}

test('adapter preserves stable world IDs, parent/event references, verified refs, and question identity', () => {
  const { root, world, sceneRef, eventRef } = sampleNodes();
  const adapted = adaptAtlasGraph({
    mapNodes: [root, world], rootManifest: { id: 'run-1', divergence: root.divergence, divergenceYear: 1800 },
    currentRunId: 'run-1', selectedBranchId: 'event-1',
  });
  const result = adapted.worlds.find(item => item.id === world.id);
  assert.equal(result.id, world.id);
  assert.equal(result.parentId, null, 'the prompt node is not a spatial parent world');
  assert.equal(result.questionId, 'run-1');
  assert.equal(result.eventRef, eventRef);
  assert.deepEqual(result.place, world.place);
  assert.equal(result.sceneRef, sceneRef);
  assert.equal(result.thumbnail, world.thumbnail);
  assert.deepEqual([result.year, result.lat, result.lon, result.theme, result.boldness], [1902, 1.55, 110.35, 'geography-ecology', .8]);
  assert.equal(adapted.currentWorldId, world.id);
  assert.equal(adapted.questions[0].id, 'run-1');
  assert.equal(adapted.questions[0].divergenceYear, 1800);
});

test('adapter migrates saved run data without changing canonical event IDs', () => {
  const graph = adaptAtlasGraph({ runData: [{ runId: 'saved-run', run: {
    divergence: 'What if the highland route stayed open?',
    branches: [{ id: 'route-1', title: 'Highland exchange', year: 1200, place: { lat: 6, lon: 102 }, summary: 'Communities trade seasonal goods.' }],
  } }] });
  assert.equal(graph.worlds[0].id, 'saved-run:route-1');
  assert.equal(graph.worlds[0].eventRef.runId, 'saved-run');
  assert.equal(graph.worlds[0].eventRef.branchId, 'route-1');
  assert.equal(graph.worlds[0].questionId, 'saved-run');
});

test('attached-question metadata keeps the question ID and explicit parent-world relationship', () => {
  const { world } = sampleNodes();
  const attachment = { questionId: 'question-2', mode: 'current-world', parentWorldId: world.id, parentRunId: 'run-1', parentBranchId: 'event-1', divergenceYear: 1902, divergencePlace: { name: 'Kuching', lat: 1.55, lon: 110.35 } };
  const adapted = adaptAtlasGraph({
    mapNodes: [{ ...world, id: 'question-2::event-2', parentId: world.id, questionId: 'question-2', runId: 'question-2', branchId: 'event-2', year: 2100 }],
    rootManifest: { id: 'question-2', divergence: 'A public school shares coastal charts.', questionAttachment: attachment },
  });
  const question = adapted.questions.find(item => item.id === 'question-2');
  assert.equal(adapted.worlds[0].questionId, 'question-2');
  assert.equal(question.parentWorldId, world.id);
  assert.equal(question.parentRunId, 'run-1');
  assert.equal(question.parentBranchId, 'event-1');
  assert.deepEqual(question.divergencePlace, attachment.divergencePlace);
});

test('root-question records stay nonspatial and first events attach to the question record without fake Earth nodes', () => {
  const root = { id: 'root:root-run', role: 'root-question', rootNodeId: 'root:root-run', runId: 'root-run', questionId: 'root-run', title: 'Question prompt', parentId: null };
  const worlds = [1, 2, 3].map(index => ({
    id: `root-run::event-${index}`, runId: 'root-run', branchId: `event-${index}`, questionId: 'root-run', parentId: root.id,
    title: `Event ${index}`, year: 1000 + index * 100, summary: 'A saved event.', place: { lat: index, lon: index },
  }));
  const adapted = adaptAtlasGraph({ mapNodes: [root, ...worlds], rootManifest: { id: 'root-run', question: { prompt: 'What if the coastline stayed connected?' } } });
  assert.equal(adapted.worlds.length, 3);
  assert.equal(adapted.worlds.some(world => world.role === 'root-question'), false);
  assert.ok(adapted.worlds.every(world => world.parentId === null), 'question nodes do not become fake globe parents');
  assert.deepEqual(adapted.questions, [{ id: 'root-run', rootRunId: 'root-run', question: 'What if the coastline stayed connected?', divergenceYear: 1100 }]);
});

test('verified thumbnails retain same-event provenance; fixtures and nonhero images never become world textures', () => {
  const eventUrl = `/event-scenes/${'a'.repeat(64)}.png`;
  const eventNode = { id: 'run-1::event-1', runId: 'run-1', branchId: 'event-1', eventRef: { runId: 'run-1', branchId: 'event-1' },
    questionId: 'run-1', title: 'Verified event', thumbnail: eventUrl, scene: eventUrl, sceneStatus: 'Scene ready', ready: true };
  const eventWorld = adaptAtlasGraph({ mapNodes: [eventNode] }).worlds[0];
  assert.deepEqual(eventWorld.provenance, { sourceRunId: 'run-1', sourceBranchId: 'event-1' });
  assert.deepEqual(eventWorld.sceneRef, { url: eventUrl, status: 'complete', runId: 'run-1', branchId: 'event-1' });
  assert.equal(defaultWorldImageUrl(eventWorld), eventUrl);

  const fixtureWorld = adaptAtlasGraph({ mapNodes: [{ ...eventNode, thumbnail: '/fixture-asset?worldId=run-1%3A%3Aevent-1&kind=scene', scene: undefined }] }).worlds[0];
  assert.equal(fixtureWorld.sceneRef, undefined);
  assert.equal(defaultWorldImageUrl(fixtureWorld), null);

  const heroUrl = '/runs/run-1/hero.png';
  const heroNode = { ...eventNode, thumbnail: heroUrl, scene: heroUrl };
  const nonhero = adaptAtlasGraph({ mapNodes: [heroNode] }).worlds[0];
  assert.equal(nonhero.heroRef, undefined);
  assert.equal(defaultWorldImageUrl(nonhero, { selected: true }), null, 'a hero image is not inferred for a nonhero event');
  const hero = adaptAtlasGraph({ mapNodes: [{ ...heroNode, heroSelected: true }] }).worlds[0];
  assert.deepEqual(hero.heroRef, { url: heroUrl, status: 'complete', runId: 'run-1', branchId: 'event-1' });
  assert.equal(defaultWorldImageUrl(hero, { selected: true }), heroUrl);

  const mismatched = adaptAtlasGraph({ mapNodes: [{ ...eventNode, eventRef: { runId: 'run-1', branchId: 'other-event' } }] }).worlds[0];
  assert.equal(mismatched.sceneRef, undefined, 'a URL for a different event cannot attach to this node');
  assert.equal(defaultWorldImageUrl(mismatched), null);
  const mismatchedRef = adaptAtlasGraph({ mapNodes: [{ ...eventNode, thumbnail: undefined, scene: undefined,
    sceneRef: { url: eventUrl, status: 'complete', runId: 'run-1', branchId: 'other-event' } }] }).worlds[0];
  assert.equal(mismatchedRef.sceneRef, undefined, 'a saved scene reference must carry matching event identity');
  assert.equal(defaultWorldImageUrl(mismatchedRef), null);
});

test('controller accumulates opened questions, replaces exact IDs, preserves inactive placeholders and selection', async () => {
  const doc = fakeDocument(), host = doc.createElement('div'), toolbar = doc.createElement('div');
  const q1Root = { id: 'root:q1', role: 'root-question', questionId: 'q1', title: 'First question', parentId: null };
  const q1World = { id: 'q1::event-1', runId: 'q1', branchId: 'event-1', questionId: 'q1', parentId: q1Root.id, title: 'First event', year: 1000, summary: 'First saved event.', place: { lat: 20, lon: 10 }, sceneRef: { path: 'old/scene.png', status: 'complete' } };
  const pending1 = { id: 'placeholder:q1::event-1:1', role: 'generation-placeholder', isExpansionPlaceholder: true, selectable: false, questionId: 'q1', parentId: q1World.id, mapState: 'generating', year: null };
  const q2Root = { id: 'root:q2', role: 'root-question', questionId: 'q2', title: 'Second question', parentId: null };
  const q2World = { id: 'q2::event-1', runId: 'q2', branchId: 'event-1', questionId: 'q2', parentId: q2Root.id, title: 'Second event', year: 1400, summary: 'Second saved event.', place: { lat: 40, lon: 50 } };
  const pending2 = { id: 'placeholder:q2::event-1:1', role: 'generation-placeholder', isExpansionPlaceholder: true, selectable: false, questionId: 'q2', parentId: q2World.id, mapState: 'generating', year: null };
  const scene = { setWorlds(value) { this.graph = value; }, setAxisMode() {}, setSurfaceLabelLevel() {}, setOrbitLevel() {}, setTravelMode() {}, setGhostTrail() {} };
  const api = await createAtlasController({
    container: host, toolbarContainer: toolbar, renderer: scene, document: doc,
    graph: { mapNodes: [q1Root, q1World, pending1], questions: [{ id: 'q1', rootRunId: 'q1', question: 'First question', divergenceYear: 900 }], currentWorldId: q1World.id },
  });
  api.setGraph({ mapNodes: [q2Root, q2World, pending2], questions: [{ id: 'q2', rootRunId: 'q2', question: 'Second question', divergenceYear: 1300 }] });
  assert.deepEqual(new Set(scene.graph.worlds.map(world => world.id)), new Set([q1World.id, pending1.id, q2World.id, pending2.id]));
  assert.equal(scene.graph.worlds.find(world => world.id === q1World.id).parentId, null);
  assert.equal(scene.graph.currentId, q1World.id, 'an update without explicit currentWorldId does not switch selection');
  assert.deepEqual(new Set(scene.graph.questions.map(question => question.id)), new Set(['q1', 'q2']));
  const inactive = atlasLOD(scene.graph.worlds, q2World.id, 'q2', { questions: scene.graph.questions });
  assert.ok(inactive.chips.some(chip => chip.questionId === 'q1'), 'the renderer receives the inactive question so it can fold it into a chip');

  const replacement = { ...q1World, title: 'Updated first event' }; delete replacement.sceneRef;
  api.setGraph({ mapNodes: [q1Root, replacement], questions: [{ id: 'q1', rootRunId: 'q1', question: 'Updated question text' }] });
  const replaced = scene.graph.worlds.find(world => world.id === q1World.id);
  assert.equal(replaced.title, 'Updated first event');
  assert.equal(replaced.sceneRef, undefined, 'same-ID updates replace prior assets instead of keeping stale refs');
  assert.equal(scene.graph.worlds.some(world => world.id === pending1.id), false, 'a non-generating parent update removes only its stale pending placeholder');
  assert.ok(scene.graph.worlds.some(world => world.id === pending2.id), 'an inactive question placeholder survives an unrelated update');
  assert.equal(scene.graph.currentId, q1World.id);

  api.setGraph({ mapNodes: [q2Root, q2World], questions: [{ id: 'q2', rootRunId: 'q2', question: 'Second question' }], currentWorldId: q2World.id });
  assert.equal(scene.graph.currentId, q2World.id, 'explicit graph selection switches the active world');
  const persistedCount = scene.graph.worlds.filter(world => !world.isExpansionPlaceholder).length;
  api.setGraph({ mapNodes: [], currentWorldId: null });
  assert.equal(scene.graph.worlds.some(world => world.isExpansionPlaceholder), false, 'an explicit empty-map reset drops all pending placeholders');
  assert.equal(scene.graph.worlds.length, persistedCount, 'reset preserves every persisted world');
  assert.equal(scene.graph.currentId, null);
  api.destroy();
});

test('explicitly visited replay worlds stay lit across return, graph replacement, and session reload only for opened IDs', async () => {
  const doc = fakeDocument(), host = doc.createElement('div'), toolbar = doc.createElement('div');
  const stored = new Map();
  const visitedStorage = { getItem(key) { return stored.get(key) ?? null; }, setItem(key, value) { stored.set(key, value); } };
  const root = { id: 'replay-root::event-1', runId: 'replay-root', branchId: 'event-1', questionId: 'replay-root', parentId: null, title: 'Saved root', year: 1000, mapState: 'saved-unexplored' };
  const leaf = { id: 'replay-root::event-2', runId: 'replay-root', branchId: 'event-2', questionId: 'replay-root', parentId: root.id, title: 'Replay leaf', year: 1100, mapState: 'saved-unexplored' };
  const otherRoot = { id: 'other-question::event-1', runId: 'other-question', branchId: 'event-1', questionId: 'other-question', parentId: null, title: 'Hydrated other root', year: 900, mapState: 'saved-unexplored' };
  const scene = { setWorlds(value) { this.graph = value; }, enterWorld(id, options) { this.entered = { id, options }; }, setAxisMode() {}, setSurfaceLabelLevel() {}, setOrbitLevel() {}, setTravelMode() {}, setGhostTrail() {} };
  const api = await createAtlasController({
    container: host, toolbarContainer: toolbar, renderer: scene, document: doc, visitedStorage,
    graph: { worlds: [root, leaf, otherRoot], questions: [{ id: 'replay-root', question: 'Replay' }, { id: 'other-question', question: 'Other' }], currentWorldId: root.id },
  });
  const initial = new Map(scene.graph.worlds.map(world => [world.id, world]));
  assert.equal(initial.get(root.id).explored, true, 'only the initially selected world is recorded as visited');
  assert.equal(initial.get(leaf.id).explored, undefined);
  assert.equal(initial.get(otherRoot.id).explored, undefined, 'read-only graph hydration does not visit other roots');

  assert.equal(api.enterWorld(leaf.id), true, 'explicit entry works in replay/no-key mode');
  assert.equal(scene.graph.worlds.find(world => world.id === leaf.id).explored, true);
  api.enterWorld(root.id);
  assert.equal(scene.graph.worlds.find(world => world.id === leaf.id).explored, true, 'returning to the parent keeps the visited leaf lit');

  api.setGraph({ worlds: [{ ...root, title: 'Updated root' }, { ...leaf, title: 'Updated replay leaf' }, otherRoot], questions: [{ id: 'replay-root', question: 'Replay' }, { id: 'other-question', question: 'Other' }] });
  assert.equal(scene.graph.worlds.find(world => world.id === leaf.id).explored, true, 'same-ID replacements merge session visit state');
  assert.equal(scene.graph.worlds.find(world => world.id === otherRoot.id).explored, undefined);
  const savedIds = JSON.parse(stored.get(ATLAS_VISITED_WORLD_STORAGE_KEY));
  assert.deepEqual(new Set(savedIds), new Set([root.id, leaf.id]));

  api.destroy();
  const reloadDoc = fakeDocument(), reloadHost = reloadDoc.createElement('div'), reloadToolbar = reloadDoc.createElement('div');
  const reloadScene = { setWorlds(value) { this.graph = value; }, setAxisMode() {}, setSurfaceLabelLevel() {}, setOrbitLevel() {}, setTravelMode() {}, setGhostTrail() {} };
  const reloaded = await createAtlasController({
    container: reloadHost, toolbarContainer: reloadToolbar, renderer: reloadScene, document: reloadDoc, visitedStorage,
    graph: { worlds: [root, leaf, otherRoot], questions: [{ id: 'replay-root', question: 'Replay' }, { id: 'other-question', question: 'Other' }], currentWorldId: root.id },
  });
  assert.equal(reloadScene.graph.worlds.find(world => world.id === leaf.id).explored, true, 'session visit IDs restore the lit state');
  assert.equal(reloadScene.graph.worlds.find(world => world.id === otherRoot.id).explored, undefined);
  reloaded.setGraph({ worlds: [root, leaf, otherRoot], currentWorldId: otherRoot.id });
  assert.equal(reloadScene.graph.worlds.find(world => world.id === otherRoot.id).explored, true, 'an explicitly selected setGraph world is recorded');
  reloaded.destroy();
});

test('toolbar has real labelled controls, preview never enters, and only explicit entry forwards to app', async () => {
  const doc = fakeDocument(), host = doc.createElement('div'), toolbar = doc.createElement('div');
  const { root, world } = sampleNodes(); let enterCount = 0, attachment = null;
  const scene = {
    setWorlds(value) { this.graph = value; }, setAxisMode(value) { this.axisMode = value; },
    setGeography(geography, mode, renderState) { this.geographyPreview = { geography, mode, renderState }; },
    setSurfaceLabelLevel(value) { this.surfaceLevel = value; }, setOrbitLevel(value) { this.orbitLevel = value; },
    setTravelMode(value) { this.travelMode = value; }, setGhostTrail(value) { this.ghost = value; },
    getZoom() { return this.zoom || 0; }, setZoom(value) { this.zoom = value; },
    getSurfaceDetailZoom() { return this.surfaceDetail || 0; }, setSurfaceDetailZoom(value) { this.surfaceDetail = value; },
    focusWorld(id) { this.focused = id; return true; }, enterWorld(id, options) { this.entered = { id, options }; return true; },
  };
  const api = await createAtlasController({
    container: host, toolbarContainer: toolbar, renderer: scene, document: doc,
    graph: { mapNodes: [root, world], rootManifest: { id: 'run-1', divergence: root.divergence }, currentRunId: 'run-1', selectedBranchId: 'event-1' },
    getZoomOutTarget: zoom => zoom < 0.22 ? 0.68 : null,
    onEnter() { enterCount++; }, onAttachmentIntent(value) { attachment = value; },
  });
  assert.equal(scene.graph.worlds.find(item => item.id === world.id).id, world.id);
  assert.equal(byLabel(toolbar, 'Branching location context').textContent, 'Kuching · 1.5500°, 110.3500°');
  assert.equal(byLabel(toolbar, 'Branching location context').title, 'Branching location: Kuching · 1.5500°, 110.3500°');
  const presentAttachment = byLabel(toolbar, 'Present-day Earth');
  presentAttachment.checked = true; presentAttachment.dispatch('change');
  assert.deepEqual(api.getAttachmentIntent(), { mode: 'present-day', parentId: null, divergenceYear: 2026, currentWorldId: world.id },
    'a selected world location is not attached to a present-day question until the user explicitly focuses it');
  const currentAttachment = byLabel(toolbar, 'Current world');
  currentAttachment.checked = true; currentAttachment.dispatch('change');
  const focusPlace = byLabel(toolbar, 'Focus selected location on Surface');
  assert.equal(focusPlace.disabled, false);
  focusPlace.dispatch('click');
  assert.equal(scene.focused, world.id, 'location focus uses the scene API that resets manual orientation');
  assert.equal(enterCount, 0, 'location focus reuses Surface orientation without firing world-entry actions');
  assert.equal(api.getAttachmentIntent().parentId, world.id, 'focused location remains associated with the selected branching world');
  const geographyPreview = { version: 2, seaLevelMeters: -120, continentalTransforms: [], changes: [] };
  api.setGeography(geographyPreview, 'scenario', geographyPreview);
  assert.deepEqual(scene.geographyPreview, { geography: geographyPreview, mode: 'scenario', renderState: geographyPreview });
  assert.equal(scene.surfaceLevel, 3); assert.equal(scene.orbitLevel, 2); assert.equal(scene.axisMode, 'history-distance');
  assert.equal(scene.travelMode, 'threads'); assert.equal(scene.ghost, false);
  assert.equal(byText(toolbar, 'Labelled pins (surface)').children[0].value, '3');
  assert.equal(byText(toolbar, 'Unfolded worlds (orbit)').children[0].value, '2');
  const zoomSlider = byLabel(toolbar, 'Zoom (left: closer than Surface, center: Surface, right: Atlas)');
  assert.equal(zoomSlider.type, 'range');
  assert.equal(zoomSlider.min, '-100');
  const zoomIn = byLabel(toolbar, 'Zoom in'), zoomOut = byLabel(toolbar, 'Zoom out');
  assert.equal(zoomIn.disabled, false, 'zoom in remains available for closer Surface detail');
  zoomIn.dispatch('click');
  assert.equal(scene.surfaceDetail, 8); assert.equal(zoomSlider.value, '-8');
  zoomOut.dispatch('click');
  assert.equal(scene.surfaceDetail, 0, 'zoom out returns from detail to fitted Surface first');
  zoomOut.dispatch('click');
  assert.equal(scene.zoom, .68, 'the configured first zoom-out target reaches Orbit');
  zoomIn.dispatch('click');
  assert.equal(Number(scene.zoom.toFixed(2)), .6, 'plus moves one step back toward Surface');
  zoomOut.dispatch('click');
  assert.equal(Number(scene.zoom.toFixed(2)), .68, 'later zoom-out returns by its normal increment');
  scene.zoom = 1; zoomOut.dispatch('click');
  assert.equal(scene.zoom, 1, 'zoom out is disabled at the atlas end');
  assert.equal(zoomOut.disabled, true);
  scene.zoom = 0.4; zoomSlider.value = '65'; zoomSlider.dispatch('input');
  assert.equal(scene.zoom, .65, 'slider moves left-to-right from surface to atlas');
  zoomSlider.value = '-38'; zoomSlider.dispatch('input');
  assert.equal(scene.zoom, 0); assert.equal(scene.surfaceDetail, 38, 'negative slider values control Surface detail');
  assert.equal(zoomSlider.value, '-38');
  zoomSlider.value = '-100'; zoomSlider.dispatch('input');
  assert.equal(zoomIn.disabled, true, 'plus is disabled only when maximum Surface detail is reached');
  zoomSlider.value = '0'; zoomSlider.dispatch('input');
  assert.equal(api.getAttachmentIntent().mode, 'current-world');
  assert.equal(api.getAttachmentIntent().parentId, world.id);
  // Invoking the controller API represents an explicit user entry action.
  assert.equal(api.enterWorld(world.id, { zoom: .72 }), true);
  assert.equal(enterCount, 1); assert.deepEqual(scene.entered, { id: world.id, options: { zoom: .72 } });
  byText(toolbar, 'Labelled pins (surface)').children[0].value = '5'; byText(toolbar, 'Labelled pins (surface)').children[0].dispatch('input');
  byText(toolbar, 'Unfolded worlds (orbit)').children[0].value = '4'; byText(toolbar, 'Unfolded worlds (orbit)').children[0].dispatch('input');
  byLabel(toolbar, 'Vertical axis').value = 'theme'; byLabel(toolbar, 'Vertical axis').dispatch('change');
  byLabel(toolbar, 'Camera travel').value = 'cut'; byLabel(toolbar, 'Camera travel').dispatch('change');
  const ghost = all(toolbar).find(element => element.tagName === 'input' && element.type === 'checkbox');
  ghost.checked = true; ghost.dispatch('change');
  assert.equal(scene.surfaceLevel, 5); assert.equal(scene.orbitLevel, 4); assert.equal(scene.axisMode, 'theme'); assert.equal(scene.travelMode, 'cut');
  assert.equal(scene.ghost, true);
  const present = byLabel(toolbar, 'Present-day Earth');
  present.checked = true; present.dispatch('change');
  assert.deepEqual(attachment, { mode: 'present-day', parentId: null, divergenceYear: 2026, currentWorldId: world.id,
    divergencePlace: { name: 'Kuching', lat: 1.55, lon: 110.35 } });
  assert.equal(api.getAttachmentIntent().mode, 'present-day');
  const current = byLabel(toolbar, 'Current world'); current.checked = true; current.dispatch('change');
  assert.deepEqual(attachment, { mode: 'current-world', parentId: world.id, divergenceYear: 1902, currentWorldId: world.id });
  api.destroy();
});

test('renderer preview and entry paths are distinct; reduced motion forces direct travel', async () => {
  const doc = fakeDocument(), host = doc.createElement('div'), toolbar = doc.createElement('div');
  const { root, world } = sampleNodes(); let previewCount = 0, enterCount = 0, previewAnchor = null;
  const scene = { setWorlds() {}, setSurfaceLabelLevel() {}, setOrbitLevel() {}, setTravelMode(value) { this.travelMode = value; }, getZoom() { return 0; }, enterWorld(id, options) { this.entered = { id, options }; }, destroy() {} };
  const controller = await createAtlasController({
    container: host, toolbarContainer: toolbar, document: doc, reducedMotion: true,
    rendererFactory: async (_host, callbacks) => { scene.callbacks = callbacks; return scene; },
    mapNodes: [root, world], rootManifest: { id: 'run-1', divergence: root.divergence },
    onPreview(_world, anchor) { previewCount++; previewAnchor = anchor; }, onEnter() { enterCount++; },
  });
  const anchor = { x: 12, y: 24 };
  scene.callbacks.onPreview(world, anchor); assert.equal(previewCount, 1); assert.equal(previewAnchor, anchor); assert.equal(enterCount, 0);
  scene.callbacks.onEnter(world); assert.equal(enterCount, 1); assert.deepEqual(scene.entered, { id: world.id, options: { zoom: 0 } });
  const enteredBeforeRejectedNodes = scene.entered;
  assert.equal(scene.callbacks.onEnter({ ...world, selectable: false }), false);
  assert.equal(scene.callbacks.onEnter({ ...world, isExpansionPlaceholder: true }), false);
  assert.equal(enterCount, 1, 'nonselectable and placeholder nodes never reach the app entry callback');
  assert.equal(scene.entered, enteredBeforeRejectedNodes, 'rejected nodes do not move the scene');
  assert.equal(scene.travelMode, 'cut'); assert.equal(byLabel(toolbar, 'Camera travel').disabled, true);
  assert.deepEqual(controller.getViewOptions().reducedMotion, true);
  controller.destroy();
});

test('present-day Earth entry selects new-question attachment without entering a world or triggering scene generation', async () => {
  const doc = fakeDocument(), host = doc.createElement('div'), toolbar = doc.createElement('div');
  let appEntries = 0, attachment = null, sceneEntries = 0, selectedMeta = null;
  const scene = {
    setWorlds(value) { this.graph = value; }, setSurfaceLabelLevel() {}, setOrbitLevel() {}, setTravelMode() {},
    enterWorld() { sceneEntries++; },
  };
  const controller = await createAtlasController({
    container: host, toolbarContainer: toolbar, document: doc,
    rendererFactory: async (_container, callbacks) => { scene.callbacks = callbacks; return scene; },
    worlds: [{ id: 'saved-world', parentId: null, questionId: 'saved-question', year: 1900, title: 'Saved world' }],
    questions: [{ id: 'saved-question', question: 'Saved question', divergenceYear: 1800 }],
    currentWorldId: 'saved-world',
    onAttachmentIntent(value) { attachment = value; },
    onEnter(_world, meta) { appEntries++; selectedMeta = meta; },
  });
  const presentEarth = { id: 'present-day-earth', kind: 'present-day', year: 2026, title: 'Present-day Earth' };
  assert.equal(scene.callbacks.onEnter(presentEarth), true, 'renderer click/Enter routes the virtual present-day Earth');
  assert.equal(sceneEntries, 0, 'virtual present-day entry never enters a world or starts expansion');
  assert.equal(controller.getData().currentWorldId, 'saved-world', 'the selected event world is unchanged');
  assert.equal(controller.getAttachmentIntent().mode, 'present-day');
  assert.deepEqual(attachment, { mode: 'present-day', parentId: null, divergenceYear: 2026, currentWorldId: 'saved-world' });
  assert.equal(appEntries, 1, 'only the app UI callback is emitted');
  assert.deepEqual(selectedMeta, { source: 'present-day-question', attachmentIntent: attachment });
  assert.equal(byLabel(toolbar, 'Present-day Earth').checked, true);
  assert.equal(controller.enterWorld('present-day-earth'), true, 'the public explicit-entry path accepts the virtual Earth ID');
  assert.equal(sceneEntries, 0);
  assert.equal(appEntries, 2);
  controller.destroy();
});

test('question chip activation stays on the question and never enters or selects an event world', async () => {
  const doc = fakeDocument(), host = doc.createElement('div'), toolbar = doc.createElement('div');
  const world = { id:'saved-world', parentId:null, questionId:'saved-question', year:1900, title:'Saved world' };
  const question = { id:'saved-question', question:'A saved question', divergenceYear:1800 };
  let questionEntries = 0, worldEntries = 0, enteredScene = 0, previewed = null;
  const scene = { setWorlds() {}, setSurfaceLabelLevel() {}, setOrbitLevel() {}, setTravelMode() {}, enterWorld() { enteredScene++; } };
  const controller = await createAtlasController({
    container:host, toolbarContainer:toolbar, document:doc,
    rendererFactory:async (_container, callbacks) => { scene.callbacks = callbacks; return scene; },
    worlds:[world], questions:[question], currentWorldId:world.id,
    onQuestionPreview(value) { previewed = value; },
    onQuestionEnter() { questionEntries++; }, onEnter() { worldEntries++; },
  });
  scene.callbacks.onQuestionPreview({ id:question.id }, { clientX:4, clientY:8 });
  assert.equal(previewed.question, question.question);
  assert.equal(scene.callbacks.onQuestionEnter({ id:question.id }), true);
  assert.equal(questionEntries, 1);
  assert.equal(worldEntries, 0);
  assert.equal(enteredScene, 0);
  assert.equal(controller.getData().currentWorldId, world.id);
  assert.equal(scene.callbacks.onQuestionEnter({ id:'unknown-question' }), false);
  controller.destroy();
});
