import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFileSync } from 'node:fs';
import { continuationAction, causalEdges, createNavigationGuard, eventIdFromHash, runIdFromHash, replayLabel } from '../web/logic.js';
import * as logic from '../web/logic.js';
import * as geographyTexture from '../web/geographyTexture.js';
import * as geography from '../web/geography.js';
import * as geographyControls from '../web/geographyControls.js';
import * as geographyLabels from '../web/geographyLabels.js';
import * as savedPreviews from '../web/savedPreview.js';
import { createLocalMetaKeySetup } from '../web/localMetaKey.js';
import { createHistorySession } from '../web/historySession.js';
import { mountHistoryTimeline } from '../web/historyTimeline.js';
import { mountHistoryTimebar } from '../web/historyTimebar.js';
import { composeGeography } from '../web/historyModel.js';
import { historyAtlasStatus } from '../web/historyAtlas.js';
import { REGIONS, GEOGRAPHY_STYLES } from '../web/geographyRegions.js';

const branch = (id, title, year = 500) => ({ id, title, year, summary: `${title} changes this world.`, place: { name: title, lat: 20, lon: year / 100 } });
const choice = branch('a', 'Open observatory');
const next = branch('b', 'Ocean observatories', 600);
const run = (id, selected = choice, continuation = {}) => ({ id, branch: { status: 'ok', divergence: `What if ${id}?`, branches: [selected], hero: { branchId: selected.id } }, continuation: { rootRunId: id, path: [], children: [], ...continuation } });

test('causal arcs follow actual ancestry and selected parent, never join sibling choices', () => {
  const parent = branch('p', 'Chosen cause', -200), sibling = branch('s', 'Another possibility', 700);
  assert.deepEqual(causalEdges([choice, sibling]), []);
  const edges = causalEdges([choice, sibling], [parent, next]);
  assert.deepEqual(edges.map(edge => [edge.from.id, edge.to.id, edge.ancestry]), [['p', 'b', true], ['b', 'a', false], ['b', 's', false]]);
  assert.equal(causalEdges([choice], [parent, { title: 'Unknown location' }]).length, 0);
  assert.equal(runIdFromHash('#run=child_123'), 'child_123');
  assert.equal(eventIdFromHash('#run=child_123&event=branch-2'), 'branch-2');
  assert.equal(eventIdFromHash('#run=child_123&event=%3Cscript%3E'), '');
  assert.equal(replayLabel({ id: 'future', parentRunId: 'root', title: 'Ocean observatories', year: 600, divergence: 'What if a common root?' }), '600 CE · Ocean observatories');
  const guard = createNavigationGuard(), old = guard.begin(), current = guard.begin();
  assert.equal(old.signal.aborted, true); assert.equal(guard.current(old.id), false); assert.equal(guard.current(current.id), true);
});

function element(tagName = 'div') {
  const classes = new Set(), attributes = new Map(), listeners = new Map();
  return { tagName, children: [], value: '', hidden: false, textContent: '', dataset: {}, style: {}, classList: { add(...names) { names.forEach(name => classes.add(name)); }, remove(...names) { names.forEach(name => classes.delete(name)); }, contains(name) { return classes.has(name); }, toggle(name, enabled = !classes.has(name)) { enabled ? classes.add(name) : classes.delete(name); return enabled; } },
    append(...nodes) { this.children.push(...nodes); }, replaceChildren(...nodes) { this.children = nodes; }, add(node) { this.children.push(node); },
    setAttribute(key, value) { attributes.set(key, value); }, getAttribute(key) { return attributes.get(key); }, addEventListener(type, callback) { listeners.set(type, callback); }, dispatch(type) { return listeners.get(type)?.({target:this,currentTarget:this}); }, dispatchWithTarget(type,target) { return listeners.get(type)?.({target,currentTarget:this}); }, click() { return listeners.get('click')?.({target:this,currentTarget:this}); }, keydown(key) { const event = {key,preventDefault(){this.prevented=true;},stopPropagation(){}}; listeners.get('keydown')?.(event); return event; }, matches(selector) { return selector === ':popover-open' && !!this.popoverOpen; }, hidePopover() { this.popoverOpen = false; this.hidePopoverCalls = (this.hidePopoverCalls || 0) + 1; }, scrollIntoView() {}, focus() { this.focused = true; listeners.get('focus')?.({target:this}); },
    querySelector(selector) { const className=selector.startsWith('.')?selector.slice(1):''; const search=node=>node?.className===className?node:(node?.children||[]).map(search).find(Boolean)||null; return search(this)|| (this.copy ||= element()); }, contains(node) { return node===this || this.children.some(child=>child===node||child.contains?.(node)); }, querySelectorAll() { return this.children.filter(child => child.dataset?.branchId); }, queryAll(tag) { return [...(this.tagName === tag ? [this] : []), ...this.children.flatMap(child => child.queryAll?.(tag) || [])]; }, closest(selector) { if (selector === 'button[data-action]' && this.tagName === 'button' && this.dataset?.action) return this; if (selector === 'button[data-history-id]' && this.tagName === 'button' && this.dataset?.historyId) return this; if (selector === 'button[data-year]' && this.tagName === 'button' && this.dataset?.year) return this; return null; }, removeAttribute(key) { attributes.delete(key); },
    pointerenter() { listeners.get('pointerenter')?.({target:this}); }, pointerleave() { listeners.get('pointerleave')?.({target:this}); },
    blur() { this.focused=false; listeners.get('blur')?.({target:this}); },
    getBoundingClientRect() { return {left:80,top:100,right:180,bottom:140,width:100,height:40}; } };
}
const textContentDeep = node => `${node?.textContent || ''}${(node?.children || []).map(textContentDeep).join('')}`;
const findNode = (node, predicate) => predicate(node) ? node : (node?.children || []).map(child => findNode(child, predicate)).find(Boolean) || null;
function harness(fixtures, onPost = async () => { throw new Error('Unexpected generation'); }, replayOnly = false, initialHash = '', onArchive = () => Response.json({ runs: [] }), onHistory = () => Response.json({runs: []}), localReview = false, onScene = () => Response.json({status:'missing'}), onCutout = () => Response.json({status:'missing'}), scheduleTimer = setTimeout, cancelTimer = clearTimeout, onHead = null, onGet = null, setupAvailable = false) {
  const nodes = new Map(), get = id => { if (!nodes.has(id)) { const node = element(); if (id === 'root-generation-status') { node.hidden = true; node.setAttribute('role','status'); node.setAttribute('aria-live','polite'); } nodes.set(id, node); } return nodes.get(id); };
  const documentListeners = new Map(), document = { getElementById:get, createElement:tag => element(tag), createTextNode:text => ({ textContent:text }), querySelector:get, querySelectorAll:() => [], body:element(), addEventListener(type, callback) { documentListeners.set(type, callback); }, keydown(key) { const event = {key,preventDefault(){this.prevented=true;},stopPropagation(){}}; documentListeners.get('keydown')?.(event); return event; } };
  const windowListeners = new Map(), window = { innerWidth:390, innerHeight:844, opened:[], open(...args) { this.opened.push(args); }, addEventListener(type, callback) { const callbacks = windowListeners.get(type) || []; callbacks.push(callback); windowListeners.set(type, callbacks); }, dispatch(type) { for (const callback of windowListeners.get(type) || []) callback(); } };
  let reducedMotionMatches = false;
  const reducedMotionListeners = [];
  const reducedMotionQuery = { get matches() { return reducedMotionMatches; }, addEventListener(type, callback) { if (type === 'change') reducedMotionListeners.push(callback); } };
  const posts = [], gets = [], heads = [], atlasWorldHistory = [], atlasEntryHistory = [], atlasHistoryViews = [], storage = new Map(), location = { hash: initialHash, pathname: '/', search: '' };
  const fetch = async (url, options = {}) => {
    if (options.method === 'HEAD') { heads.push(url); if (onHead) return onHead(url); const parts = url.split('/'); return new Response('', { status: fixtures[parts[2]]?.assets?.includes(parts[3]) ? 200 : 404 }); }
    if (options.method === 'POST') { posts.push({ url, body: JSON.parse(options.body) }); return onPost(url, options); }
    gets.push(url);
    if (onGet) { const override = await onGet(url); if (override) return override; }
    if (url.startsWith('/api/event-scene?')) return onScene(url);
    if (url.startsWith('/api/event-cutout?')) return onCutout(url);
    if (url === '/health') return Response.json({ status: 'ok', replayOnly, setupAvailable, metaKeyConfigured:false, metaKeyOverrideActive:false, voiceEnabled:false, expansionLimit:20, expansionUsed:0, ...(localReview ? { localReviewAccess: true } : {}) });
    if (url === '/runs') return onArchive();
    if (url === '/api/history') return onHistory();
    const match = url.match(/^\/runs\/([^/]+)(?:\/(.*))?$/);
    const fixture = fixtures[match?.[1]];
    if (!fixture) return new Response('', { status: 404 });
    return Response.json(match[2] === 'branch.json' ? fixture.branch : match[2] === 'trace.json' ? { steps: [] } : fixture);
  };
  const context = vm.createContext({ ...logic, ...geographyTexture, ...geography, ...geographyControls, ...geographyLabels, ...savedPreviews, createLocalMetaKeySetup, createHistorySession, historyAtlasStatus,
    mountHistoryTimeline, mountHistoryTimebar, composeGeography, REGIONS, GEOGRAPHY_STYLES,
    loadLocalTerrain: async () => ({ width:1, height:1, elevation:new Int16Array([0]), landmass:new Uint8Array([1]) }), console, fetch, AbortController, TextDecoder, Uint8Array, URLSearchParams, setTimeout:scheduleTimer, clearTimeout:cancelTimer,
    createAtlasController(options) {
      const optionsDetails = document.createElement('details'); optionsDetails.className='atlas-view-options';
      const optionsBody = document.createElement('div'); optionsBody.className='atlas-view-options-body';
      optionsDetails.append(optionsBody); options.toolbarContainer?.replaceChildren(optionsDetails);
      const controller = {
        optionsRef:options, graph:options.graph || {}, nodes:options.graph?.mapNodes || [], selectedId:options.graph?.currentWorldId || null,
        scene:{ currentId:options.graph?.currentWorldId || null, level:'surface', enterWorld(id, settings = {}) { this.currentId = id; this.lastEntry = { id, settings }; atlasEntryHistory.push(id); }, setGeography(geography, mode, renderState) { this.geographyPreview = { geography, mode, renderState }; }, setZoom(value) { this.zoom = value; }, getZoom() { return this.zoom || 0; }, getLevel() { return this.level; } },
        setGraph(next) { this.graph = next; this.nodes = next.mapNodes || []; this.selectedId = next.currentWorldId || null; this.scene.currentId = this.selectedId; atlasWorldHistory.push(this.selectedId); },
        setHistoryView(view) { this.historyView = view; atlasHistoryViews.push(view); return view; }, getHistoryView() { return this.historyView || null; },
        setGeography(geography, mode, renderState) { this.scene.setGeography(geography, mode, renderState); },
        getData() { return { worlds:this.nodes.map(node => ({...node, eventRef:node.eventRef || (node.runId && node.branchId ? {runId:node.runId,branchId:node.branchId} : undefined)})), questions:this.graph.questions || [], currentWorldId:this.selectedId }; },
        getAttachmentIntent() { return {...(this.attachment || {mode:'current-world'}), currentWorldId:this.selectedId}; },
        getViewOptions() { return {}; },
        select(id) { const world = this.nodes.find(node => node.id === id); if (world) { this.selectedId = id; this.scene.enterWorld(id); options.onEnter?.(world, {source:'atlas-explicit-entry'}); } },
        destroy() {},
      };
      context.atlasController = controller;
      context.starMap = { get nodes() { return controller.nodes; }, get selectedId() { return controller.selectedId; }, select(id) { controller.select(id); }, get options() { return options; } };
      return Promise.resolve(controller);
    },
    createVoiceInput: () => ({ cancel() {}, setEnabled() {} }),
    document,
    matchMedia: query => query === '(prefers-reduced-motion: reduce)' ? reducedMotionQuery : ({ matches: false, addEventListener() {} }), window,
    location, history: { pushState(a, b, target) { location.hash = target.includes('#') ? target.slice(target.indexOf('#')) : ''; } },
    localStorage: { getItem: key => storage.get(key), setItem: (key, value) => storage.set(key, value) }, Option: function(text, value) { return { text, value }; },
  });
  const source = readFileSync(new URL('../web/app.js', import.meta.url), 'utf8').replace(/^import .*;\r?\n/gm, '').replace(/import\('\.\/visuals\.js'\)\.then\(async \(\{createModelViewer\}\) => \{[\s\S]*?\}\)\.catch\(\(\) => \{ modelApi = null; setView\(activeView\); \}\);/, '');
  vm.runInContext(`${source}\n globalThis.ui = {loadRun,selectBranch,activateBranch,selectStarMapNode,expandBranch,runPrompt,setView,setSurfaceMode,setAtlasLevel:applyAtlasGeographyLevel,toggleAtlasGeographyPanel,refreshHistory,loadServiceModeForTest:loadServiceMode,toggleArchiveHistory,setHistoryContextForTest:value=>historySession.setContext(value),setHistoryDateForTest:value=>historySession.setDate(value),selectHistoryEventForTest:id=>selectHistoryEvent(id),setHistoryAtlasLevelForTest:level=>atlasController.optionsRef.onLevelChange?.({level}),breakHistoryRendererForTest:()=>{atlasController.setHistoryView=()=>{throw new Error('fixture renderer failure');};},setCurrentRunContextForTest:id=>{currentRunId=id;currentManifest=knownRunManifests.get(id)||currentManifest;continuation=currentManifest?.continuation||continuation;renderExplorationTree();},setAtlasAttachmentIntent:value=>{atlasController.attachment=value;},setGlobe:api=>{Object.assign(atlasController.scene,api);renderGeography();},setModelApi:api=>{modelApi=api;},syncOtherQuestionsForTest:(level,mapNodes)=>{window.matchMedia=()=>({matches:true});atlasController.scene.level=level;syncAtlasOtherQuestionToggle(mapNodes);},previewGlobe:(branch,anchor)=>showAtlasPreview(branch,anchor),eventWorkFor:(runId,branchId)=>{const work=eventWork.get(eventKey(runId,branchId));return work?{...work}:null;},state:()=>({currentRunId,atlasCurrentWorldRunId,continuation,streamBusy,selectedContext,hasImage,activeView,continuationViewSelection,surfaceGeography,surfaceMode,historyMode,history:historySession.getState(),historyAtlasView:atlasController.getHistoryView(),selectedHistoryRecord,hasStory:document.body.classList.contains('has-story'),invitationOpen:document.body.classList.contains('invitation-open'),starMapNodes:atlasNodes,atlasAttachmentIntent,serverExpansionUsed,expansionLimit,enteredNodesCount:enteredNodes.size,pendingExpansionCount:pendingExpansionNodes.size,selectedBranchId,selectedWork:{...eventWork.get(eventKey(currentRunId,selectedBranchId))},activePreview:savedPreview.activePreview,previewHidden:savedPreview.element.hidden})};`, context);
  return { ui: context.ui, get, posts, gets, heads, atlasWorldHistory, atlasEntryHistory, atlasHistoryViews, storage, location, starMap: context.starMap, document, window, setReducedMotion(matches) { reducedMotionMatches = Boolean(matches); for (const listener of reducedMotionListeners) listener({ matches:reducedMotionMatches }); }, navigate(hash, ...events) { location.hash = hash; for (const event of events) window.dispatch(event); } };
}
const tick = () => new Promise(resolve => setImmediate(resolve));
const complete = fixture => new Response(`event: complete\ndata: ${JSON.stringify({ runId: fixture.id, branch: fixture.branch, continuation: fixture.continuation })}\n\n`, { headers: { 'content-type': 'text/event-stream' } });

test('active history mode drives the real timeline, timebar and Atlas without selecting an event while scrubbing', async () => {
  const events = [
    { id:'event-bce', year:-1200, era:'Bronze observatories', title:'Observatory traditions begin', summary:'A new tradition is recorded.', causeEventId:null,
      geography:{version:1,changes:[{id:'green-sahara',region:'sahara',kind:'vegetation',intensity:0.8,assumption:'Green conditions persist.',uncertainty:'Illustrative.'},{id:'sahara-lakes',region:'sahara',kind:'lake',intensity:0.6,assumption:'Seasonal lakes persist.',uncertainty:'Illustrative.'}]} },
    { id:'event-ce', year:900, era:'Coastal era', title:'Coastal observatories spread', summary:'A later event in this history.', causeEventId:'event-bce',
      sceneRef:'/event-scenes/' + 'a'.repeat(64) + '.png', checkFlags:[{ kind:'weave-ripple', status:'pending', wovenEventId:'woven-1', message:'This event changed after a new possibility was woven.' }] },
  ];
  const history = { id:'history-root', events, suggestions:[], suggestionWindows:[] };
  const question = { id:'question-root', title:'What if observatories spread?', histories:[history] };
  const app = harness({}, async (url, options) => {
    assert.equal(url, '/api/history/regenerate');
    const updatedEvent = { ...events[1], title:'Rewritten coastal observatories', summary:'The newly regenerated account.' };
    delete updatedEvent.sceneRef; delete updatedEvent.checkFlags;
    const updatedHistory = { ...history, events:[events[0], updatedEvent], suggestions:[], suggestionWindows:[] };
    return Response.json({ question:{ ...question, histories:[updatedHistory] }, history:updatedHistory, event:updatedEvent });
  }, true, '', undefined, undefined, false, undefined, undefined, undefined, undefined, undefined, async url => {
    if (url === '/api/history/preferences') return Response.json({ autoSuggest:false });
    if (url.startsWith('/api/histories?')) return Response.json({ questions:[question] });
    return null;
  });
  await tick();
  app.window.matchMedia = query => ({ matches:query.includes('max-width: 430px') || query.includes('max-width:700px') });
  app.ui.setHistoryContextForTest({ questionId:question.id, historyId:history.id, eventId:'event-ce', date:900 });
  for (let index=0; index<10 && !app.ui.state().history.history; index++) await tick();
  assert.equal(app.ui.state().historyMode, true);
  assert.equal(app.get('history-timeline-host').hidden, false);
  assert.equal(app.get('history-timebar-host').hidden, false, 'the datebar is visible once the saved history has loaded');
  assert.equal(app.document.body.classList.contains('atlas-focused'), true, 'phone history starts in the compact globe view');
  assert.equal(app.get('atlas-show-tree').textContent, 'History', 'a persistent reopen control is labelled for the history rail');
  app.get('atlas-show-tree').click();
  assert.equal(app.document.body.classList.contains('atlas-panels-open'), true, 'the History control reopens the timeline drawer');
  app.get('focus-atlas').click();
  assert.equal(app.document.body.classList.contains('atlas-focused'), true, 'Focus Atlas closes the drawer and restores the compact view');
  app.ui.setHistoryAtlasLevelForTest('atlas');
  assert.equal(app.get('history-timebar-host').hidden, false, 'later Atlas level callbacks cannot hide the active history timebar');
  assert.match(app.get('history-asof-header').textContent, /History as of 900 CE · 2 events/);
  assert.equal(app.get('geography-status').textContent, 'As of 900 CE: Green Sahara, Sahara inland lakes', 'Earth panel names the composed active-history changes at its date');
  assert.equal(app.get('geography-reset-adjustments').textContent, 'Reset to history as of 900 CE', 'reset label names the current history baseline');
  assert.equal(app.get('hero-title').textContent, '900 CE · Coastal observatories spread');
  assert.equal(app.ui.state().historyAtlasView.composedGeography.changes.length, 2, 'Atlas snapshot contains canonical composed changes through its date');
  app.get('geography-present').click();
  assert.equal(app.ui.state().historyAtlasView.surfaceMode, 'present');
  assert.equal(app.ui.state().historyAtlasView.surfaceGeography.changes.length, 0, 'Present-day mode affects only the rendered surface');
  app.get('geography-scenario').click();
  const water = app.get('geography-water-number'); water.min = '-11000'; water.max = '9000'; water.value = '350'; water.dispatch('input');
  assert.equal(app.ui.state().historyAtlasView.surfaceGeography.seaLevelMeters, 350, 'local controls update the active history projection');
  assert.equal(app.ui.state().historyAtlasView.composedGeography.changes.length, 2, 'local preview controls do not edit stored event geography');
  const regenerate = findNode(app.get('history-timeline-host'), node => node?.dataset?.action === 'regenerate');
  assert.ok(regenerate);
  const timelineEvents = app.get('history-timeline-host').children[0].children[1];
  await timelineEvents.dispatchWithTarget('click', regenerate);
  assert.deepEqual(app.posts.at(-1).body, { questionId:question.id, historyId:history.id, eventId:'event-ce', wovenEventId:'woven-1' });
  assert.equal(app.get('hero-title').textContent, '900 CE · Rewritten coastal observatories', 'a same-ID regenerated history event refreshes the selected sheet');
  assert.match(app.get('hero-description').textContent, /newly regenerated account/);
  assert.equal(app.get('event-scene-action').hidden, true, 'ref-less regenerated events do not fall back to stale legacy media generation');
  const range = app.get('history-timebar-host').queryAll('input')[0];
  assert.ok(range, `range input is mounted: ${JSON.stringify(app.get('history-timebar-host').children.map(node => ({tag:node.tagName,children:node.children?.map(child=>child.tagName)})))}`);
  range.value = String(range.min); range.dispatch('input');
  assert.equal(app.ui.state().history.date, -1200);
  assert.equal(app.ui.state().historyAtlasView.surfaceGeography.seaLevelMeters, 0, 'a different as-of date starts from that date’s composed scenario');
  app.ui.setHistoryDateForTest(900);
  assert.equal(app.ui.state().historyAtlasView.surfaceGeography.seaLevelMeters, 350, 'date-specific local controls persist with their history and return date');
  app.get('geography-reset-adjustments').click();
  assert.equal(app.ui.state().historyAtlasView.surfaceGeography.seaLevelMeters, 0, 'reset restores the selected date’s composed baseline');
  app.ui.setHistoryDateForTest(-1200);
  assert.equal(app.ui.state().historyAtlasView.surfaceGeography.seaLevelMeters, 0);
  assert.equal(app.get('hero-title').textContent, '900 CE · Rewritten coastal observatories', 'moving the date changes the history view but keeps the selected event sheet');
  assert.match(app.get('history-asof-header').textContent, /History as of 1200 BCE · 1 event/);
  const firstEventTick = findNode(app.get('history-timebar-host'), node => node?.dataset?.eventId === 'event-bce');
  assert.ok(firstEventTick);
  app.get('history-timebar-host').children[0].children[1].children[2].dispatchWithTarget('click', firstEventTick);
  assert.equal(app.ui.state().history.selectedEventId, 'event-bce');
  assert.equal(app.get('hero-title').textContent, '1200 BCE · Observatory traditions begin', 'an explicit event tick selects its event sheet');
  assert.ok(app.atlasHistoryViews.some(view => view?.historyId === history.id && view.asOfYear === -1200));
  assert.equal(app.posts.filter(post => post.url === '/api/continue').length, 0, 'date changes and marker selections never submit legacy continuation requests');
  assert.equal(app.document.body.classList.contains('history-mode'), true, 'the legacy branch rail is hidden by active history-mode styles');
  app.ui.breakHistoryRendererForTest(); app.ui.setHistoryDateForTest(-1100);
  assert.equal(app.get('history-timeline-host').hidden, false, 'history rows remain active when the scene renderer throws');
  assert.equal(app.get('history-timebar-host').hidden, false, 'date controls remain active when the scene renderer throws');
  assert.match(app.get('history-render-status').textContent,/Atlas rendering is unavailable/);
});

test('history spines switch questions and sibling histories at the retained date without generation', async () => {
  const makeHistory = (id, events) => ({ id, events, suggestions:[], suggestionWindows:[] });
  const questions = [
    { id:'question-one', title:'Question one', divergenceYear:400, histories:[
      makeHistory('history-one', [{id:'one-old',year:100,title:'One old'},{id:'one-latest',year:700,title:'One latest'}]),
      makeHistory('history-one-sibling', [{id:'one-sibling',year:600,title:'Sibling event'}]),
    ] },
    { id:'question-two', title:'Question two', divergenceYear:500, histories:[
      makeHistory('history-two', [{id:'two-old',year:200,title:'Two old'},{id:'two-latest',year:800,title:'Too new'}]),
    ] },
  ];
  const app = harness({}, undefined, true, '', undefined, undefined, false, undefined, undefined, undefined, undefined, undefined, async url => {
    if (url === '/api/history/preferences') return Response.json({autoSuggest:true});
    if (url.startsWith('/api/histories?')) return Response.json({questions});
    return null;
  });
  await tick();
  app.ui.setHistoryContextForTest({questionId:'question-one',historyId:'history-one',eventId:'one-latest',date:650});
  for (let i=0;i<10&&!app.ui.state().history.history;i++) await tick();
  assert.equal(app.ui.state().historyAtlasView.questions.length,2);
  const orbitToggle = app.get('history-orbit-toggle');
  assert.equal(orbitToggle.textContent,'Show Orbit level');
  assert.equal(orbitToggle.hidden,false);
  const optionsPanel = findNode(app.get('atlas-toolbar'),node=>node?.className==='atlas-view-options-body');
  assert.ok(optionsPanel?.children.includes(orbitToggle),'Orbit toggle is inside interactive View options, not under the header overlay');
  app.starMap.options.onQuestionPreview(questions[1],{clientX:20,clientY:30});
  assert.equal(app.ui.state().previewHidden,false,'Atlas hover opens a metadata preview');
  app.starMap.options.onHistorySelect('history-one-sibling',{date:650,questionId:'question-one',source:'pointer'});
  assert.equal(app.ui.state().history.historyId,'history-one-sibling');
  assert.equal(app.ui.state().history.date,650);
  app.starMap.options.onQuestionSelect('question-two',{source:'pointer'});
  assert.equal(app.ui.state().history.questionId,'question-two');
  assert.equal(app.ui.state().previewHidden,true,'switching questions clears a preview owned by the previous spine');
  assert.equal(app.ui.state().history.date,650);
  assert.equal(app.ui.state().history.selectedEventId,'two-old');
  assert.equal(app.ui.state().historyAtlasView.activeQuestionId,'question-two');
  assert.equal(app.ui.state().historyAtlasView.showOrbit,false,'Orbit remains opt-in');
  assert.equal(orbitToggle.hidden,true,'Orbit level is unavailable for a question with one history');
  assert.deepEqual(app.posts,[],'selecting history spines and question chips is read-only');
});

test('history API failure keeps the active rail in a status state instead of exposing the legacy nested tree', async () => {
  const app = harness({}, undefined, true, '', undefined, undefined, false, undefined, undefined, undefined, undefined, undefined, async url => {
    if (url === '/api/history/preferences') return Response.json({autoSuggest:false});
    if (url.startsWith('/api/histories?')) return new Response('unavailable',{status:503});
    return null;
  });
  await tick();
  app.ui.setHistoryContextForTest({questionId:'missing-question',historyId:'missing-history',eventId:'missing-event',date:650});
  for (let i=0;i<10&&app.ui.state().history.loading;i++) await tick();
  assert.equal(app.document.body.classList.contains('history-requested'),true);
  assert.equal(app.get('history-timeline-host').hidden,false);
  const historyStatus = findNode(app.get('history-timeline-host'),node=>node?.className==='history-timeline-status');
  assert.match(historyStatus?.textContent || '',/Could not load|No saved history/);
  assert.deepEqual(app.posts,[]);
});

test('fresh question authoring opens Meta setup in replay mode and proceeds after local key configuration', async () => {
  const question = {id:'written-q',title:'User question',divergenceYear:500,histories:[{id:'written-h',events:[],suggestions:[],suggestionWindows:[{window:{fromYear:1,toYear:1000},status:'ready',batches:1,suggestionCount:0}]}]};
  const history = question.histories[0];
  let health = {status:'ok',replayOnly:true,localReplayHistoryAccess:true,setupAvailable:true,voiceEnabled:false,metaKeyConfigured:false,metaKeyOverrideActive:false};
  const app = harness({}, async url => {
    if (url === '/api/local-meta-key') {
      health = {status:'ok',replayOnly:false,localReplayHistoryAccess:false,localReviewAccess:true,setupAvailable:true,voiceEnabled:false,metaKeyConfigured:true,metaKeyOverrideActive:true};
      return Response.json({setupAvailable:true,metaKeyConfigured:true,metaKeyOverrideActive:true,replayOnly:false,localReviewAccess:true,localReplayHistoryAccess:false});
    }
    assert.equal(url,'/api/history/questions');
    return Response.json({question,history,dateWindow:{fromYear:1,toYear:1000}});
  }, true, '', undefined, undefined, false, undefined, undefined, undefined, undefined, undefined, async url => {
    if (url === '/health') return Response.json(health);
    if (url === '/api/history/preferences') return Response.json({autoSuggest:false});
    if (url.startsWith('/api/histories?')) return Response.json({questions:[question]});
    return null;
  });
  await tick();
  assert.equal(app.get('service-mode').textContent,'Saved histories · local replay');
  assert.match(app.get('footer-service-mode').textContent,/configure a Meta API key for fresh questions/i);
  assert.equal(app.get('live-submit').getAttribute('aria-label'),'Configure a Meta API key to create a fresh history');
  assert.equal(app.get('live-submit').disabled,false,'the replay-only CTA opens setup instead of submitting a question');
  await app.ui.runPrompt('What if river observatories changed?');
  assert.equal(app.posts.length,0,'keyless replay access cannot create a new history');
  assert.equal(app.get('meta-key-setup').open,true,'the keyless submit opens the existing local setup panel');
  assert.match(app.get('status').textContent,/Configure a Meta API key.*fresh history/);
  app.get('meta-key-input').value='fixture-meta-key'; app.get('meta-key-use').click();
  for (let i=0;i<10&&app.get('live-submit').getAttribute('aria-label')!=='Create a fresh history';i++) await tick();
  await tick();
  assert.equal(app.posts[0].url,'/api/local-meta-key');
  assert.equal(app.get('live-submit').getAttribute('aria-label'),'Create a fresh history');
  await app.ui.runPrompt('What if river observatories changed?');
  for (let i=0;i<10&&app.ui.state().history.loading;i++) await tick();
  assert.equal(app.posts[1].url,'/api/history/questions');
  assert.equal(app.posts[1].body.question,'What if river observatories changed?');
  assert.deepEqual(app.posts[1].body.attachment,{mode:'present-day',divergenceYear:2026});
  assert.equal(app.ui.state().history.date,500);
  assert.equal(app.ui.state().history.historyId,'written-h');
  assert.equal(app.get('history-timebar-host').hidden,false,'an empty history still shows its date controls');
  assert.equal(app.ui.state().history.suggestions.length,0,'creation does not force a seed weave or suggestion');
  assert.match(app.get('hero-title').textContent,/No saved event at 500 CE/);
  assert.equal(app.posts.some(post=>post.url==='/api/run'),false);
  assert.equal(app.ui.state().historyMode,true,JSON.stringify(app.ui.state().history));
  const nativeLocation = new URLSearchParams(app.location.hash.slice(1));
  assert.equal(nativeLocation.get('question'),'written-q');
  assert.equal(nativeLocation.get('history'),'written-h');
  assert.equal(nativeLocation.get('date'),'500');
});

test('native history URL reopens the exact question, history, date and event without POST or Meta access', async () => {
  const event = {id:'event-native',year:900,title:'Canopy observatories',summary:'A saved event.',place:{name:'Sahara',lat:20,lon:10},sceneRef:'/event-scenes/'+'c'.repeat(64)+'.png'};
  const history = {id:'history-native',events:[event],suggestions:[],suggestionWindows:[]};
  const question = {id:'question-native',question:'What if observatories spread?',title:'Observatories',divergenceYear:700,origin:'user-written',histories:[history]};
  const hash = '#question=question-native&history=history-native&date=900&event=event-native';
  const app = harness({}, undefined, true, hash, undefined, undefined, false, undefined, undefined, undefined, undefined, undefined, async url => {
    if (url === '/health') return Response.json({status:'ok',localReplayHistoryAccess:true,voiceEnabled:false});
    if (url === '/api/history/preferences') return Response.json({autoSuggest:true});
    if (url.startsWith('/api/histories?')) return Response.json({questions:[question]});
    return null;
  });
  await tick();
  for (let i=0;i<10&&app.ui.state().history.loading;i++) await tick();
  assert.equal(app.ui.state().history.questionId,question.id);
  assert.equal(app.ui.state().history.historyId,history.id);
  assert.equal(app.ui.state().history.date,900);
  assert.equal(app.ui.state().history.selectedEventId,event.id);
  assert.equal(app.get('hero-title').textContent,'900 CE · Canopy observatories');
  assert.equal(app.document.body.classList.contains('has-story'),true,'a canonical reload restores the story toolbar as well as the selected history');
  assert.equal(app.location.hash,hash);
  assert.deepEqual(app.posts,[],'canonical reload only reads persisted history and event media refs');
  assert.equal(app.ui.state().historyMode,true);
});

test('history scene and cutout generation use explicit history identities and never run on selection', async () => {
  const event = {id:'event-new',year:500,title:'A saved history event',summary:'Written by the history service'};
  const history = {id:'h-media',events:[event],suggestions:[],suggestionWindows:[]};
  const question = {id:'q-media',title:'Media question',divergenceYear:500,histories:[history]};
  const app = harness({}, async url => {
    const kind = url.endsWith('/scene') ? 'scene' : 'cutout';
    return Response.json({status:'complete',url:`/history-media/${(kind==='scene'?'a':'b').repeat(64)}.png`});
  }, true, '', undefined, undefined, false, undefined, undefined, undefined, undefined, undefined, async url => {
    if (url === '/health') return Response.json({status:'ok',localReplayHistoryAccess:true,voiceEnabled:false});
    if (url === '/api/history/preferences') return Response.json({autoSuggest:false});
    if (url.startsWith('/api/histories?')) return Response.json({questions:[question]});
    return null;
  });
  await tick();
  app.ui.setHistoryContextForTest({questionId:question.id,historyId:history.id,eventId:event.id,date:500});
  for (let i=0;i<10&&!app.ui.state().history.history;i++) await tick();
  assert.deepEqual(app.posts,[],'opening a saved history event does not generate media');
  app.get('event-scene-action').click(); await tick(); await tick();
  assert.deepEqual(app.posts.at(-1).body,{questionId:question.id,historyId:history.id,eventId:event.id});
  assert.equal(app.posts.at(-1).url,'/api/history/scene');
  assert.match(app.get('hero-image').src,/^\/history-media\/[a-f\d]{64}\.png$/);
  app.get('cutout-view').click(); await tick(); await tick();
  assert.equal(app.posts.at(-1).url,'/api/history/cutout');
  assert.deepEqual(app.posts.at(-1).body,{questionId:question.id,historyId:history.id,eventId:event.id});
  assert.equal(app.posts.some(post=>post.url==='/api/event-scene'||post.url==='/api/event-cutout'),false);
});

test('local Meta key setup refreshes live feature mode and keeps the key out of browser storage', async () => {
  const secret = 'fixture-only-meta-key';
  let health = { status:'ok', replayOnly:true, voiceEnabled:false, localReviewAccess:false, setupAvailable:true, metaKeyConfigured:false, metaKeyOverrideActive:false, expansionLimit:20, expansionUsed:0 };
  const app = harness({}, async (url, options) => {
    health = { ...health, replayOnly:false, voiceEnabled:true, localReviewAccess:true, metaKeyConfigured:true, metaKeyOverrideActive:true };
    return Response.json({ setupAvailable:true, metaKeyConfigured:true, metaKeyOverrideActive:true, replayOnly:false, localReviewAccess:true });
  }, true, '', undefined, undefined, false, undefined, undefined, undefined, undefined, undefined, async url => url === '/health' ? Response.json(health) : null);
  await tick();
  assert.equal(app.get('meta-key-setup').hidden, false, 'setup appears on a local replay-only startup');
  app.get('meta-key-input').value = secret;
  app.get('meta-key-use').click();
  assert.equal(app.get('meta-key-input').value, '', 'input clears before the request resolves');
  await tick(); await tick();
  assert.equal(app.posts.length, 1);
  assert.equal(app.posts[0].url, '/api/local-meta-key');
  assert.deepEqual(app.posts[0].body, { apiKey:secret });
  assert.equal(app.get('live-submit').disabled, false, 'the refreshed health mode enables fresh exploration');
  assert.match(app.get('service-mode').textContent, /local exploration/i);
  assert.equal(app.get('meta-key-clear').disabled, false);
  assert.match(app.get('meta-key-config-status').textContent, /local-session override is active/i);
  assert.equal([...app.storage.values()].some(value => String(value).includes(secret)), false);
});

test('SAM cutout request is tied to the selected event and reused on a second click', async () => {
  const alternate = branch('alt', 'Mammoth steppe', -4500), root = run('root');
  root.branch.branches.push(alternate); root.assets = ['hero.png'];
  let finishCutout; const pendingCutout = new Promise(resolve => { finishCutout = resolve; });
  root.continuation.children = [{branchId:'a',runId:'uncertain-child',status:'uncertain'}];
  const app = harness({root}, async (url, options) => {
    assert.equal(url, '/api/event-cutout');
    assert.deepEqual(JSON.parse(options.body), {runId:'root', branchId:'alt'});
    return pendingCutout;
  }, false, '', undefined, undefined, false, () => Response.json({status:'complete',url:'/event-scenes/example.png'}));
  await tick(); await app.ui.loadRun('root',{animate:false}); app.get('access').value = 'fixture';
  for (let i = 0; i < 6; i++) await tick();
  app.ui.selectBranch(alternate);
  app.get('cutout-view').click();
  assert.equal(app.get('view-loading-indicator').hidden, true);
  assert.match(app.get('view-status').textContent, /queued/);
  await tick(); await tick();
  assert.equal(app.get('view-loading-indicator').hidden, false);
  assert.match(app.get('view-status').textContent, /Creating this event/);
  finishCutout(Response.json({status:'complete',url:'/event-cutouts/example.png'}));
  await tick(); await tick();
  assert.equal(app.get('cutout-image').src,'/event-cutouts/example.png');
  assert.equal(app.get('view-loading-indicator').hidden, true);
  assert.equal(app.ui.state().activeView,'cutout');
  app.get('cutout-view').click(); await tick();
  assert.equal(app.posts.length,1);
});

test('SAM cutout waits for the event scene before requesting segmentation', async () => {
  const alternate = branch('alt', 'Mammoth steppe', -4500), root = run('root');
  root.branch.branches.push(alternate); root.assets = ['hero.png'];
  const order = [];
  const app = harness({root}, async (url, options) => {
    assert.fail(`Unexpected POST ${url}`);
    return Response.json({status:'complete',url:'/event-cutouts/example.png'});
  }, false, '', undefined, undefined, false, () => {
    order.push('/api/event-scene?');
    return Response.json({status:'complete',url:'/event-scenes/example.png'});
  }, () => {
    order.push('/api/event-cutout?');
    return Response.json({status:'complete',url:'/event-cutouts/example.png'});
  });
  await tick(); await app.ui.loadRun('root', {animate:false}); app.ui.selectBranch(alternate);
  app.get('cutout-view').click();
  for (let i = 0; i < 10; i++) await tick();
  assert.deepEqual(order, ['/api/event-scene?', '/api/event-scene?', '/api/event-cutout?']);
  assert.equal(app.get('cutout-image').src, '/event-cutouts/example.png');
});

test('saved model loading indicator clears on success, error, retry and run switch', async () => {
  const root = run('model-root', choice), other = run('other', next);
  root.assets = ['hero.png', 'model.glb']; other.assets = ['hero.png'];
  const app = harness({'model-root':root, other}); await tick();
  const requests = [];
  app.ui.setModelApi({load(url, callbacks) { requests.push({url, callbacks}); }, setAutoRotate() { return false; }});
  await app.ui.loadRun('model-root', {animate:false});
  app.get('model-button').click();
  assert.equal(app.get('model-loading').hidden, false);
  assert.equal(app.get('model-loading-indicator').hidden, false);
  assert.equal(app.get('model-loading-label').textContent, 'Loading saved 3D model');
  requests.at(-1).callbacks.onLoad();
  assert.equal(app.get('model-loading').hidden, true);
  assert.equal(app.get('model-loading-indicator').hidden, true);
  app.get('retry-model').click();
  assert.equal(requests.length, 2);
  assert.equal(app.get('model-loading-indicator').hidden, false);
  requests.at(-1).callbacks.onError();
  assert.equal(app.get('model-loading').hidden, true);
  assert.equal(app.get('model-loading-indicator').hidden, true);
  assert.equal(app.get('model-error').hidden, false);
  app.get('retry-model').click();
  const pending = requests.at(-1);
  assert.equal(app.get('model-loading-indicator').hidden, false);
  await app.ui.loadRun('other', {animate:false});
  assert.equal(app.get('model-loading').hidden, true);
  assert.equal(app.get('model-loading-indicator').hidden, true);
  pending.callbacks.onLoad();
  assert.equal(app.get('model-loading-indicator').hidden, true);
});

test('desktop story mode collapses New exploration and keeps voice disclosure tied to it', async () => {
  const root=run('desktop-invitation',choice);
  const app=harness({[root.id]:root},undefined,false,'',undefined,undefined,false,undefined,undefined,setTimeout,clearTimeout,null,url=>url==='/health'
    ? Response.json({status:'ok',replayOnly:false,localReviewAccess:true,voiceEnabled:true,expansionLimit:20,expansionUsed:0})
    : null);
  await tick();
  await app.ui.loadRun(root.id,{animate:false,autoConsequences:false});
  const button=app.get('show-invitation'), voiceDisclosure=app.get('voice-disclosure');
  assert.equal(app.document.body.classList.contains('has-story'),true);
  assert.equal(app.document.body.classList.contains('invitation-open'),false,'story load closes invitation on desktop too');
  assert.equal(button.getAttribute('aria-expanded'),'false');
  assert.equal(voiceDisclosure.open,false,'voice controls stay collapsed while invitation is closed');
  assert.match(readFileSync(new URL('../web/style.css',import.meta.url),'utf8'),/\.has-story:not\(\.invitation-open\) \.exploration-rail #invitation\s*\{display:none\}/,'desktop CSS hides the invitation while a story is open');
  button.click();
  assert.equal(app.document.body.classList.contains('invitation-open'),true);
  assert.equal(button.getAttribute('aria-expanded'),'true');
  assert.equal(voiceDisclosure.open,true,'opening the invitation expands available voice controls');
  button.click();
  assert.equal(app.document.body.classList.contains('invitation-open'),false);
  assert.equal(button.getAttribute('aria-expanded'),'false');
  assert.equal(voiceDisclosure.open,false);
});
