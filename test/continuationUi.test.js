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
    setAttribute(key, value) { attributes.set(key, value); }, getAttribute(key) { return attributes.get(key); }, addEventListener(type, callback) { listeners.set(type, callback); }, dispatch(type) { return listeners.get(type)?.({target:this,currentTarget:this}); }, dispatchWithTarget(type,target,extra={}) { return listeners.get(type)?.({target,currentTarget:this,...extra}); }, click() { return listeners.get('click')?.({target:this,currentTarget:this}); }, keydown(key) { const event = {key,preventDefault(){this.prevented=true;},stopPropagation(){}}; listeners.get('keydown')?.(event); return event; }, matches(selector) { return selector === ':popover-open' && !!this.popoverOpen; }, hidePopover() { this.popoverOpen = false; this.hidePopoverCalls = (this.hidePopoverCalls || 0) + 1; }, scrollIntoView() {}, focus() { this.focused = true; listeners.get('focus')?.({target:this}); },
    querySelector(selector) { const className=selector.startsWith('.')?selector.slice(1):''; const search=node=>node?.className===className?node:(node?.children||[]).map(search).find(Boolean)||null; return search(this)|| (this.copy ||= element()); }, contains(node) { return node===this || this.children.some(child=>child===node||child.contains?.(node)); }, querySelectorAll() { return this.children.filter(child => child.dataset?.branchId); }, queryAll(tag) { return [...(this.tagName === tag ? [this] : []), ...this.children.flatMap(child => child.queryAll?.(tag) || [])]; }, closest(selector) { if (selector === 'button[data-action]' && this.tagName === 'button' && this.dataset?.action) return this; if (selector === 'button[data-id]' && this.tagName === 'button' && this.dataset?.id) return this; if (selector === '#chronicle' && this.id === 'chronicle') return this; if (selector === '#history-timeline-host' && this.id === 'history-timeline-host') return this; if (selector === 'button[data-history-id]' && this.tagName === 'button' && this.dataset?.historyId) return this; if (selector === 'button[data-year]' && this.tagName === 'button' && this.dataset?.year) return this; return null; }, removeAttribute(key) { attributes.delete(key); },
    pointerenter() { listeners.get('pointerenter')?.({target:this}); }, pointerleave() { listeners.get('pointerleave')?.({target:this}); },
    blur() { this.focused=false; listeners.get('blur')?.({target:this}); },
    getBoundingClientRect() { return {left:80,top:100,right:180,bottom:140,width:100,height:40}; } };
}
const textContentDeep = node => `${node?.textContent || ''}${(node?.children || []).map(textContentDeep).join('')}`;
const findNode = (node, predicate) => predicate(node) ? node : (node?.children || []).map(child => findNode(child, predicate)).find(Boolean) || null;
const findNodes = (node, predicate) => [...(predicate(node) ? [node] : []), ...(node?.children || []).flatMap(child => findNodes(child, predicate))];
function harness(fixtures, onPost = async () => { throw new Error('Unexpected generation'); }, setupRequired = false, initialHash = '', onArchive = () => Response.json({ runs: [] }), onHistory = () => Response.json({runs: []}), localReview = false, onScene = () => Response.json({status:'missing'}), onCutout = () => Response.json({status:'missing'}), scheduleTimer = setTimeout, cancelTimer = clearTimeout, onHead = null, onGet = null, setupAvailable = false) {
  const nodes = new Map(), get = id => { if (!nodes.has(id)) { const node = element(); node.id = id; if (id === 'root-generation-status') { node.hidden = true; node.setAttribute('role','status'); node.setAttribute('aria-live','polite'); } nodes.set(id, node); } return nodes.get(id); };
  const documentListeners = new Map(), document = { getElementById:get, createElement:tag => element(tag), createTextNode:text => ({ textContent:text }), querySelector:get, querySelectorAll:selector => selector === '[role="tab"]' ? ['scene-view','cutout-view','model-button'].map(get) : [], body:element(), addEventListener(type, callback) { documentListeners.set(type, callback); }, keydown(key) { const event = {key,preventDefault(){this.prevented=true;},stopPropagation(){this.stopped=true;}}; documentListeners.get('keydown')?.(event); return event; } };
  const windowListeners = new Map(), window = { innerWidth:390, innerHeight:844, opened:[], open(...args) { this.opened.push(args); }, addEventListener(type, callback) { const callbacks = windowListeners.get(type) || []; callbacks.push(callback); windowListeners.set(type, callbacks); }, dispatch(type) { for (const callback of windowListeners.get(type) || []) callback(); } };
  let reducedMotionMatches = false;
  const reducedMotionListeners = [];
  const reducedMotionQuery = { get matches() { return reducedMotionMatches; }, addEventListener(type, callback) { if (type === 'change') reducedMotionListeners.push(callback); } };
  const posts = [], gets = [], heads = [], atlasWorldHistory = [], atlasEntryHistory = [], atlasHistoryViews = [], storage = new Map(), location = { hash: initialHash, pathname: '/', search: '' };
  const fetch = async (url, options = {}) => {
    if (options.method === 'HEAD') { heads.push(url); if (onHead) return onHead(url); const parts = url.split('/'); return new Response('', { status: fixtures[parts[2]]?.assets?.includes(parts[3]) ? 200 : 404 }); }
     if (options.method === 'POST') {
       const body = JSON.parse(options.body); posts.push({ url, body });
       if (url === '/api/history/questions') {
         const attachment = body.attachment;
         if (attachment !== undefined && (!attachment || typeof attachment !== 'object' || Array.isArray(attachment)
             || attachment.mode !== 'history-event' || Object.keys(attachment).some(key => !['mode','questionId','historyId','eventId'].includes(key))
             || !['questionId','historyId','eventId'].every(key => typeof attachment[key] === 'string' && /^[A-Za-z0-9][A-Za-z0-9._:-]{0,159}$/.test(attachment[key])))) {
           return Response.json({error:'Choose a valid history event to attach this question to.',code:'invalid_attachment'}, {status:400});
         }
       }
       return onPost(url, options);
     }
    gets.push(url);
    if (onGet) { const override = await onGet(url); if (override) return override; }
    if (url.startsWith('/api/event-scene?')) return onScene(url);
    if (url.startsWith('/api/event-cutout?')) return onCutout(url);
    if (url === '/health') return Response.json({ status: 'ok', setupAvailable, metaKeyConfigured:!setupRequired, metaKeyOverrideActive:false, localHistoryAccess:true, voiceEnabled:false, expansionLimit:20, expansionUsed:0, ...(localReview ? { localReviewAccess: true } : {}) });
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
  vm.runInContext(`${source}\n globalThis.ui = {loadRun,selectBranch,activateBranch,selectStarMapNode,expandBranch,runPrompt,setView,setSurfaceMode,setAtlasLevel:applyAtlasGeographyLevel,toggleAtlasGeographyPanel,refreshHistory,loadServiceModeForTest:loadServiceMode,toggleArchiveHistory,setHistoryContextForTest:value=>historySession.setContext(value),setHistoryDateForTest:value=>historySession.setDate(value),reloadHistorySessionForTest:()=>historySession.reload(),selectHistoryEventForTest:id=>selectHistoryEvent(id),selectHistoryAtlasWorldForTest:(world,detail)=>selectHistoryAtlasWorld(world,detail),setHistoryAtlasLevelForTest:level=>atlasController.optionsRef.onLevelChange?.({level}),breakHistoryRendererForTest:()=>{atlasController.setHistoryView=()=>{throw new Error('fixture renderer failure');};},setCurrentRunContextForTest:id=>{currentRunId=id;currentManifest=knownRunManifests.get(id)||currentManifest;continuation=currentManifest?.continuation||continuation;renderExplorationTree();},setAtlasAttachmentIntent:value=>{atlasController.attachment=value;},setGlobe:api=>{Object.assign(atlasController.scene,api);renderGeography();},setModelApi:api=>{modelApi=api;},syncOtherQuestionsForTest:(level,mapNodes)=>{window.matchMedia=()=>({matches:true});atlasController.scene.level=level;syncAtlasOtherQuestionToggle(mapNodes);},previewGlobe:(branch,anchor)=>showAtlasPreview(branch,anchor),eventWorkFor:(runId,branchId)=>{const work=eventWork.get(eventKey(runId,branchId));return work?{...work}:null;},state:()=>({currentRunId,atlasCurrentWorldRunId,continuation,streamBusy,selectedContext,hasImage,activeView,continuationViewSelection,surfaceGeography,surfaceMode,historyMode,history:historySession.getState(),historyAtlasView:atlasController.getHistoryView(),selectedHistoryRecord,hasStory:document.body.classList.contains('has-story'),invitationOpen:document.body.classList.contains('invitation-open'),starMapNodes:atlasNodes,atlasAttachmentIntent,serverExpansionUsed,expansionLimit,enteredNodesCount:enteredNodes.size,pendingExpansionCount:pendingExpansionNodes.size,selectedBranchId,selectedWork:{...eventWork.get(eventKey(currentRunId,selectedBranchId))},activePreview:savedPreview.activePreview,previewHidden:savedPreview.element.hidden})};`, context);
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
  assert.equal(app.get('event-scene-action').textContent, 'Configure Meta key', 'a ref-less regenerated event offers the existing key setup instead of a misleading no-op generation action');
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
  assert.equal(app.get('hero-title').textContent, '1200 BCE · Observatory traditions begin', 'moving the date selects the nearest canonical event sheet');
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

test('mounted history hover previews saved media in the selected sheet, restores its media tab, and commits only on click', async () => {
  const stylesheet=readFileSync(new URL('../web/style.css',import.meta.url),'utf8');
  const previewCss=stylesheet.slice(stylesheet.lastIndexOf('/* Event hover expands'));
  assert.match(previewCss,/history-event-previewing:has\(#atlas-scene\[data-atlas-level="atlas"\]\) \.hero-panel[\s\S]*?width:min\(388px/);
  assert.match(previewCss,/\.hero-panel>\.atlas-world-details[\s\S]*?opacity:1;visibility:visible;pointer-events:auto/);
  assert.doesNotMatch(previewCss,/map-panel>#atlas-scene|#atlas-scene\s*\{[^}]*inset:/,'expanding the sheet does not change Atlas canvas insets');
  const events = [
    {id:'selected',year:100,title:'Selected event',summary:'Selected summary',cutoutRef:'/event-cutouts/'+'a'.repeat(64)+'.png'},
    {id:'hover-image',year:200,title:'Hovered with image',summary:'Hover summary',heroRef:{status:'complete',url:'/runs/saved-run/hero.png',runId:'saved-run',branchId:'branch-a'}},
    {id:'hover-cutout',year:300,title:'Cutout only event',summary:'Cutout preview',cutoutRef:'/event-cutouts/'+'b'.repeat(64)+'.png'},
  ];
  const suggestion={id:'suggestion-history-hover',year:250,title:'Suggested wetland observatories',summary:'A saved suggestion with an image.',sceneRef:'/event-scenes/'+'e'.repeat(64)+'.png'};
  const history={id:'history-hover',events,suggestions:[suggestion],suggestionWindows:[]};
  const siblingEvent={id:'sibling-canonical',year:90,title:'Sibling history event',summary:'Sibling owner record',sceneRef:'/event-scenes/'+'d'.repeat(64)+'.png'};
  const sibling={id:'history-hover-sibling',events:[siblingEvent],suggestions:[],suggestionWindows:[]};
  const question={id:'question-hover',title:'Hover question',divergenceYear:100,histories:[history,sibling]};
  const app=harness({},undefined,true,'',undefined,undefined,false,undefined,undefined,undefined,undefined,undefined,async url=>{
    if(url==='/api/history/preferences') return Response.json({autoSuggest:false});
    if(url.startsWith('/api/histories?')) return Response.json({questions:[question]});
    return null;
  });
  await tick();
  app.ui.setHistoryContextForTest({questionId:question.id,historyId:history.id,eventId:'selected',date:100});
  for(let i=0;i<10&&!app.ui.state().history.history;i++) await tick();
  app.get('cutout-view').click();
  assert.equal(app.get('cutout-view').getAttribute('aria-selected'),'true');
  app.ui.setHistoryAtlasLevelForTest('atlas');
  assert.equal(app.get('atlas-world-details').inert,true,'compact Atlas keeps the details subtree inert while collapsed');
  const timeline=app.get('history-timeline-host').children[0].children[1];
  const hoverButton=findNode(timeline,node=>node?.dataset?.id==='hover-image');
  const outButton=findNode(timeline,node=>node?.dataset?.id==='hover-cutout');
  assert.ok(hoverButton && outButton,'mounted history event controls are available');
  const originalHash=app.location.hash;
  app.get('history-timeline-host').dispatchWithTarget('pointerover',hoverButton);
  assert.equal(app.document.body.classList.contains('history-event-previewing'),true,'the compact sheet expansion is scoped to the temporary preview');
  assert.equal(app.get('atlas-world-details').inert,false,'the expanded transient sheet is reachable for image and details inspection');
  assert.equal(app.get('atlas-world-details').getAttribute('aria-hidden'),'false');
  assert.equal(app.get('hero-title').textContent,'200 CE · Hovered with image');
  assert.equal(app.get('hero-image').src,'/runs/saved-run/hero.png');
  assert.equal(app.get('event-scene-action').hidden,true,'transient preview cannot offer generation');
  assert.equal(app.ui.state().previewHidden,true,'history hover does not open a floating tooltip');
  assert.equal(app.posts.length,0);
  assert.equal(app.location.hash,originalHash);
  app.get('history-timeline-host').dispatchWithTarget('pointerout',hoverButton,{relatedTarget:app.get('chronicle')});
  assert.equal(app.get('hero-title').textContent,'100 CE · Selected event');
  assert.equal(app.document.body.classList.contains('history-event-previewing'),false,'pointer exit restores immediately without a sticky handoff corridor');
  assert.equal(app.get('atlas-world-details').inert,true,'the collapsed compact details sheet returns to inert after hover');
  assert.equal(app.get('cutout-view').getAttribute('aria-selected'),'true','the selected event media tab is restored exactly');
  app.get('chronicle').pointerenter();
  assert.equal(app.get('hero-title').textContent,'100 CE · Selected event','entering the sheet after pointer exit does not resurrect the old preview');
  assert.equal(app.ui.state().previewHidden,true);
  app.get('history-timeline-host').dispatchWithTarget('focusin',hoverButton);
  assert.equal(app.get('hero-title').textContent,'200 CE · Hovered with image','keyboard focus still previews the event');
  app.get('history-timeline-host').dispatchWithTarget('pointerout',hoverButton);
  assert.equal(app.get('hero-title').textContent,'200 CE · Hovered with image','pointer exit does not cancel a focus-owned preview');
  app.get('history-timeline-host').dispatchWithTarget('focusout',hoverButton,{relatedTarget:app.get('atlas-scene')});
  await new Promise(resolve=>setTimeout(resolve,250));
  assert.equal(app.get('hero-title').textContent,'100 CE · Selected event','leaving keyboard focus restores after its short focus delay');
  app.ui.previewGlobe({id:hoverButton.dataset.id,historyId:history.id,visualKind:'history-event'},{source:'keyboard'});
  app.ui.previewGlobe(null,{source:'keyboard'});
  assert.equal(app.get('hero-title').textContent,'200 CE · Hovered with image','keyboard clear preserves a focus-owned Atlas preview');
  app.ui.previewGlobe(null,{source:'pointer'});
  assert.equal(app.get('hero-title').textContent,'100 CE · Selected event','a pointer-origin Atlas clear ends even a focus-owned preview');
  app.ui.previewGlobe({id:'sibling-earth',historyId:sibling.id,latestEvent:siblingEvent,visualKind:'history-sibling'});
  assert.equal(app.get('hero-title').textContent,'90 CE · Sibling history event','a sibling Earth previews its canonical owner-history event');
  assert.equal(app.get('hero-image').src,siblingEvent.sceneRef);
  assert.equal(app.ui.state().history.historyId,history.id,'sibling hover does not commit a history switch');
  app.ui.previewGlobe(null);
  assert.equal(app.get('hero-title').textContent,'100 CE · Selected event');
  app.ui.previewGlobe({id:suggestion.id,historyId:history.id,visualKind:'history-suggestion'});
  assert.equal(app.get('hero-title').textContent,'250 CE · Suggested wetland observatories','Atlas suggestions use the same right-hand saved-media sheet');
  assert.equal(app.get('hero-tag').textContent,'SUGGESTION PREVIEW');
  assert.equal(app.get('hero-image').src,suggestion.sceneRef);
  assert.equal(app.ui.state().previewHidden,true,'event and suggestion previews never use the floating popover');
  assert.equal(app.ui.state().history.selectedEventId,'selected','suggestion hover does not select or weave the suggestion');
  app.ui.previewGlobe(null);
  assert.equal(app.get('hero-title').textContent,'100 CE · Selected event','leaving an Atlas suggestion restores immediately');
  app.get('chronicle').pointerenter();
  assert.equal(app.get('hero-title').textContent,'100 CE · Selected event','panel entry cannot resurrect a suggestion after pointer exit');
  app.get('atlas-open-details').click();
  app.get('history-timeline-host').dispatchWithTarget('pointerover',hoverButton);
  assert.equal(app.document.body.classList.contains('atlas-details-open'),true);
  assert.equal(app.get('hero-title').textContent,'200 CE · Hovered with image');
  app.get('atlas-close-details').click();
  assert.equal(app.document.body.classList.contains('history-event-previewing'),false,'closing the expanded details panel ends its transient event preview');
  assert.equal(app.get('hero-title').textContent,'100 CE · Selected event','closing details restores the committed event first');
  assert.equal(app.document.body.classList.contains('atlas-details-open'),false,'the close control then collapses the details panel');
  app.get('history-timeline-host').dispatchWithTarget('pointerover',outButton);
  assert.equal(app.get('hero-title').textContent,'300 CE · Cutout only event');
  assert.equal(app.get('hero-image').src,'/event-cutouts/'+'b'.repeat(64)+'.png','cutout-only media is usable as a preview image');
  timeline.dispatchWithTarget('click',outButton);
  assert.equal(app.ui.state().history.selectedEventId,'hover-cutout','click commits the event selection');
  assert.equal(app.get('hero-title').textContent,'300 CE · Cutout only event');
  assert.equal(new URLSearchParams(app.location.hash.slice(1)).get('event'),'hover-cutout');
  assert.deepEqual(app.posts,[],'hover and explicit local selection submit no generation requests');
});

test('clicking an Atlas suggestion commits its inspect selection across pointer exit, other previews and reload', async () => {
  const window={fromYear:1,toYear:1000};
  const event={id:'selected-sailboats',year:100,title:'Sailboats',summary:'Committed event',sceneRef:'/event-scenes/'+'a'.repeat(64)+'.png'};
  const suggestion={id:'suggestion-rock-paintings',year:250,title:'Wetland Rock Paintings',summary:'Cached suggestion',suggestionForEventId:event.id,window,sceneRef:'/event-scenes/'+'b'.repeat(64)+'.png'};
  const other={id:'temporary-medicine',year:300,title:'Medicine wheel',summary:'Another event preview',sceneRef:'/event-scenes/'+'c'.repeat(64)+'.png'};
  const history={id:'selection-history',events:[event,other],suggestions:[suggestion],suggestionWindows:[{window,status:'ready',suggestionCount:1}]};
  const question={id:'selection-question',title:'Suggestion selection',divergenceYear:100,histories:[history]};
  const createApp=hash=>harness({},undefined,true,hash,undefined,undefined,false,undefined,undefined,undefined,undefined,undefined,async url=>{
    if(url==='/api/history/preferences') return Response.json({autoSuggest:false});
    if(url.startsWith('/api/histories?')) return Response.json({questions:[question]});
    return null;
  });
  const app=createApp('');
  await tick(); app.ui.setHistoryContextForTest({questionId:question.id,historyId:history.id,eventId:event.id,date:100});
  for(let i=0;i<10&&!app.ui.state().history.history;i++) await tick();
  assert.ok(app.ui.state().history.suggestions.some(item=>item.id===suggestion.id),'the suggestion is loaded into the active cached window');
  const suggestionButton=findNode(app.get('history-timeline-host'),node=>node?.dataset?.action==='select-suggestion'&&node.dataset.id===suggestion.id);
  assert.ok(suggestionButton,'the timeline exposes an explicit inspect action for cached suggestions');
  app.get('history-timeline-host').dispatchWithTarget('pointerover',suggestionButton);
  app.ui.selectHistoryAtlasWorldForTest({...suggestion,historyId:history.id,visualKind:'history-suggestion'},{source:'scene-api'});
  assert.equal(app.ui.state().history.selectedEventId,suggestion.id,'clicking the Atlas suggestion commits its own identity');
  assert.equal(app.get('hero-title').textContent,'250 CE · Wetland Rock Paintings');
  assert.equal(app.get('hero-tag').textContent,'SELECTED SUGGESTION');
  assert.equal(new URLSearchParams(app.location.hash.slice(1)).get('event'),suggestion.id,'the selected suggestion is stored in the native history URL');
  const weaveButton=findNode(app.get('history-timeline-host'),node=>node?.dataset?.action==='weave'&&node.dataset.id===suggestion.id);
  assert.ok(weaveButton,'weaving remains a separate explicit action');
  app.get('history-timeline-host').dispatchWithTarget('pointerout',suggestionButton);
  assert.equal(app.get('hero-title').textContent,'250 CE · Wetland Rock Paintings','pointer exit keeps the clicked suggestion selected');
  app.ui.previewGlobe({id:other.id,historyId:history.id,visualKind:'history-event'});
  app.ui.previewGlobe(null,{source:'pointer'});
  assert.equal(app.get('hero-title').textContent,'250 CE · Wetland Rock Paintings','another temporary preview restores the clicked suggestion');
  assert.equal(app.get('hero-tag').textContent,'SELECTED SUGGESTION','preview exit preserves the selected suggestion identity and label');
  const reloaded=createApp(app.location.hash);
  await tick();
  for(let i=0;i<10&&!reloaded.ui.state().history.history;i++) await tick();
  assert.equal(reloaded.ui.state().history.selectedEventId,suggestion.id);
  assert.equal(reloaded.get('hero-title').textContent,'250 CE · Wetland Rock Paintings','reload restores the cached selected suggestion');
  assert.equal(reloaded.get('hero-tag').textContent,'SELECTED SUGGESTION');
  assert.deepEqual(app.posts,[],'inspect selection and hover do not weave, generate, or mutate history');
  assert.deepEqual(reloaded.posts,[],'reopening the selected suggestion is read-only');
});

test('committed sibling-history selection survives hover, timeline, timebar and zoom transitions', async () => {
  const active={id:'active-event',year:100,title:'Active history event',sceneRef:'/event-scenes/'+'a'.repeat(64)+'.png'};
  const activeLater={id:'active-later',year:150,title:'Active later event',sceneRef:'/event-scenes/'+'b'.repeat(64)+'.png'};
  const siblingFirst={id:'sibling-first',year:90,title:'Sibling first event',sceneRef:'/event-scenes/'+'c'.repeat(64)+'.png'};
  const siblingSelected={id:'sibling-selected',year:180,title:'Sibling selected event',sceneRef:'/event-scenes/'+'d'.repeat(64)+'.png'};
  const otherQuestionEvent={id:'other-question-event',year:70,title:'Other question event',sceneRef:'/event-scenes/'+'e'.repeat(64)+'.png'};
  const history={id:'active-history-selection',events:[active,activeLater],suggestions:[],suggestionWindows:[]};
  const sibling={id:'sibling-history-selection',events:[siblingFirst,siblingSelected],suggestions:[],suggestionWindows:[]};
  const question={id:'owner-question-selection',title:'History owner selection',divergenceYear:100,histories:[history,sibling]};
  const otherHistory={id:'other-question-history',events:[otherQuestionEvent],suggestions:[],suggestionWindows:[]};
  const otherQuestion={id:'other-question-selection',title:'Other question',divergenceYear:70,histories:[otherHistory]};
  const app=harness({},undefined,true,'',undefined,undefined,false,undefined,undefined,undefined,undefined,undefined,async url=>{
    if(url==='/api/history/preferences') return Response.json({autoSuggest:false});
    if(url.startsWith('/api/histories?')) return Response.json({questions:[question,otherQuestion]});
    return null;
  });
  await tick(); app.ui.setHistoryContextForTest({questionId:question.id,historyId:history.id,eventId:active.id,date:200});
  for(let i=0;i<10&&!app.ui.state().history.history;i++) await tick();
  app.ui.previewGlobe({...siblingSelected,historyId:sibling.id,questionId:question.id,visualKind:'history-spine-sibling'});
  assert.equal(app.get('hero-title').textContent,'180 CE · Sibling selected event','a sibling spine previews its canonical owner event');
  app.ui.previewGlobe(null,{source:'pointer'});
  assert.equal(app.get('hero-title').textContent,'100 CE · Active history event','temporary sibling preview restores the prior committed history');
  app.ui.selectHistoryAtlasWorldForTest({...siblingSelected,historyId:sibling.id,questionId:question.id,visualKind:'history-spine-sibling'},
    {questionId:question.id,historyId:sibling.id,date:200,visualKind:'history-spine-sibling'});
  assert.equal(app.ui.state().history.historyId,sibling.id,'explicit sibling event entry switches to its owner history');
  assert.equal(app.ui.state().history.selectedEventId,siblingSelected.id);
  assert.equal(app.ui.state().history.date,200,'the selected date is retained when the owner history changes');
  assert.equal(new URLSearchParams(app.location.hash.slice(1)).get('event'),siblingSelected.id);
  assert.equal(app.get('hero-title').textContent,'180 CE · Sibling selected event');
  app.ui.setHistoryAtlasLevelForTest('atlas');
  app.get('atlas-open-details').click(); app.get('atlas-close-details').click();
  assert.equal(app.get('hero-title').textContent,'180 CE · Sibling selected event','zoom and panel close keep the selected owner event');
  app.ui.previewGlobe({...activeLater,historyId:history.id,questionId:question.id,visualKind:'history-event'});
  app.ui.previewGlobe(null,{source:'pointer'});
  assert.equal(app.get('hero-title').textContent,'180 CE · Sibling selected event','hovering a different history restores the committed sibling selection');
  const timeline=app.get('history-timeline-host').children[0].children[1];
  const timelineButton=findNode(timeline,node=>node?.dataset?.action==='select-event'&&node.dataset.id===siblingFirst.id);
  timeline.dispatchWithTarget('click',timelineButton);
  assert.equal(app.ui.state().history.selectedEventId,siblingFirst.id,'timeline selection updates the selected canonical event');
  assert.equal(app.get('hero-title').textContent,'90 CE · Sibling first event');
  const timebarTick=findNode(app.get('history-timebar-host'),node=>node?.dataset?.eventId===siblingFirst.id);
  app.get('history-timebar-host').children[0].children[1].children[2].dispatchWithTarget('click',timebarTick);
  assert.equal(app.ui.state().history.date,90,'timebar event selection owns the clicked event date');
  assert.equal(app.ui.state().history.selectedEventId,siblingFirst.id);
  assert.equal(app.get('hero-title').textContent,'90 CE · Sibling first event');
  app.ui.selectHistoryAtlasWorldForTest({...otherQuestionEvent,historyId:otherHistory.id,questionId:otherQuestion.id,visualKind:'history-event'},
    {questionId:otherQuestion.id,historyId:otherHistory.id,date:90,visualKind:'history-event'});
  assert.equal(app.ui.state().history.questionId,otherQuestion.id,'Atlas event identity can switch to another question when explicitly entered');
  assert.equal(app.ui.state().history.historyId,otherHistory.id);
  assert.equal(app.ui.state().history.date,90,'other-question selection retains the current date');
  assert.equal(app.ui.state().history.selectedEventId,otherQuestionEvent.id);
  assert.equal(app.get('hero-title').textContent,'70 CE · Other question event');
  app.ui.previewGlobe({...siblingSelected,historyId:sibling.id,questionId:question.id,visualKind:'history-spine-sibling'});
  assert.equal(app.get('hero-title').textContent,'180 CE · Sibling selected event','a saved event from another question previews from its canonical owner');
  app.ui.previewGlobe(null,{source:'pointer'});
  assert.equal(app.get('hero-title').textContent,'70 CE · Other question event','a cross-question preview restores the committed owner');
  assert.deepEqual(app.posts,[],'preview, selection, zoom, and timebar navigation make no generation requests');
});

test('same-ID suggestions preview from the explicitly named sibling history owner', async () => {
  const activeEvent={id:'owner-active-event',year:100,title:'Active history anchor',sceneRef:'/event-scenes/'+'a'.repeat(64)+'.png'};
  const activeSuggestion={id:'shared-suggestion-id',year:150,title:'Active owner version',summary:'Active owner summary',window:{fromYear:100,toYear:199},sceneRef:'/event-scenes/'+'b'.repeat(64)+'.png'};
  const siblingEvent={id:'owner-sibling-event',year:100,title:'Sibling history anchor'};
  const siblingSuggestion={id:'shared-suggestion-id',year:150,title:'Sibling owner version',summary:'Sibling owner summary',window:{fromYear:100,toYear:199},heroRef:{status:'complete',url:'/runs/sibling/hero.png'}};
  const active={id:'owner-active-history',events:[activeEvent],suggestions:[activeSuggestion],suggestionWindows:[{window:activeSuggestion.window,status:'ready',suggestionCount:1}]};
  const sibling={id:'owner-sibling-history',events:[siblingEvent],suggestions:[siblingSuggestion],suggestionWindows:[{window:siblingSuggestion.window,status:'ready',suggestionCount:1}]};
  const question={id:'owner-question',title:'Suggestion owner question',histories:[active,sibling]};
  const app=harness({},async()=>{assert.fail('hovering a sibling suggestion must not generate media');},false,'',undefined,undefined,false,undefined,undefined,undefined,undefined,undefined,async url=>{
    if(url==='/api/history/preferences')return Response.json({autoSuggest:false});
    if(url.startsWith('/api/histories?'))return Response.json({questions:[question]});
    return null;
  });
  await tick(); app.ui.setHistoryContextForTest({questionId:question.id,historyId:active.id,eventId:activeEvent.id,date:100});
  for(let i=0;i<12&&!app.ui.state().history.history;i++)await tick();
  const hash=app.location.hash;
  app.ui.previewGlobe({id:siblingSuggestion.id,eventId:siblingSuggestion.id,questionId:question.id,historyId:sibling.id,visualKind:'history-suggestion'});
  assert.equal(app.get('hero-title').textContent,'150 CE · Sibling owner version');
  assert.equal(app.get('hero-image').src,siblingSuggestion.heroRef.url,'owner lookup does not use the active history record with the same ID');
  assert.equal(app.ui.state().history.selectedEventId,activeEvent.id,'owner-aware hover remains temporary');
  assert.equal(app.location.hash,hash);
  app.ui.previewGlobe(null,{source:'pointer'});
  assert.equal(app.get('hero-title').textContent,'100 CE · Active history anchor');
  assert.deepEqual(app.posts,[]);
});

test('suggestion preview resolves the question owner when two questions reuse a history ID', async () => {
  const window={fromYear:100,toYear:199};
  const activeEvent={id:'active-q-event',year:100,title:'Question one anchor',sceneRef:'/event-scenes/'+'1'.repeat(64)+'.png'};
  const activeSuggestion={id:'cross-question-suggestion',year:150,title:'Question one suggestion',window,sceneRef:'/event-scenes/'+'2'.repeat(64)+'.png'};
  const otherEvent={id:'other-q-event',year:100,title:'Question two anchor'};
  const otherSuggestion={id:'cross-question-suggestion',year:150,title:'Question two suggestion',window,heroRef:{status:'complete',url:'/runs/question-two/hero.png'}};
  const active={id:'shared-history-id',events:[activeEvent],suggestions:[activeSuggestion],suggestionWindows:[{window,status:'ready',suggestionCount:1}]};
  const other={id:'shared-history-id',events:[otherEvent],suggestions:[otherSuggestion],suggestionWindows:[{window,status:'ready',suggestionCount:1}]};
  const q1={id:'question-one-owner',title:'Question one',histories:[active]}, q2={id:'question-two-owner',title:'Question two',histories:[other]};
  const app=harness({},async()=>{assert.fail('owner-aware preview is read-only');},false,'',undefined,undefined,false,undefined,undefined,undefined,undefined,undefined,async url=>{
    if(url==='/api/history/preferences')return Response.json({autoSuggest:false});
    if(url.startsWith('/api/histories?'))return Response.json({questions:[q1,q2]});
    return null;
  });
  await tick(); app.ui.setHistoryContextForTest({questionId:q1.id,historyId:active.id,eventId:activeEvent.id,date:100});
  for(let i=0;i<12&&!app.ui.state().history.history;i++)await tick();
  app.ui.previewGlobe({id:otherSuggestion.id,eventId:otherSuggestion.id,questionId:q2.id,historyId:other.id,visualKind:'history-suggestion'});
  assert.equal(app.get('hero-title').textContent,'150 CE · Question two suggestion');
  assert.equal(app.get('hero-image').src,otherSuggestion.heroRef.url,'question ID disambiguates reused history IDs');
  assert.equal(app.ui.state().history.selectedEventId,activeEvent.id);
  app.ui.previewGlobe(null,{source:'pointer'});
  assert.equal(app.get('hero-title').textContent,'100 CE · Question one anchor');
  assert.deepEqual(app.posts,[]);
});

test('same-count saved content and media updates refresh Atlas while retaining the selected suggestion', async () => {
  const window={fromYear:1,toYear:1000};
  const event={id:'refresh-event',year:100,title:'Event before refresh',summary:'Original event text',sceneRef:'/event-scenes/'+'a'.repeat(64)+'.png'};
  const suggestion={id:'refresh-suggestion',year:200,title:'Suggestion before refresh',summary:'Original suggestion text',suggestionForEventId:event.id,window,sceneRef:'/event-scenes/'+'b'.repeat(64)+'.png'};
  const history={id:'refresh-history',events:[event],suggestions:[suggestion],suggestionWindows:[{window,status:'ready',suggestionCount:1}]};
  let canonicalQuestion={id:'refresh-question',title:'Refresh fixture',divergenceYear:100,histories:[history]};
  const app=harness({},undefined,true,'',undefined,undefined,false,undefined,undefined,undefined,undefined,undefined,async url=>{
    if(url==='/api/history/preferences') return Response.json({autoSuggest:false});
    if(url.startsWith('/api/histories?')) return Response.json(structuredClone({questions:[canonicalQuestion]}));
    return null;
  });
  await tick(); app.ui.setHistoryContextForTest({questionId:canonicalQuestion.id,historyId:history.id,eventId:event.id,date:100});
  for(let i=0;i<10&&!app.ui.state().history.history;i++) await tick();
  app.ui.selectHistoryEventForTest(suggestion.id);
  const priorViewCount=app.atlasHistoryViews.length;
  canonicalQuestion=structuredClone(canonicalQuestion);
  canonicalQuestion.histories[0].events[0]={...canonicalQuestion.histories[0].events[0],title:'Event after refresh',summary:'Updated event text'};
  canonicalQuestion.histories[0].suggestions[0]={...canonicalQuestion.histories[0].suggestions[0],title:'Suggestion after refresh',summary:'Updated suggestion text',sceneRef:'/event-scenes/'+'c'.repeat(64)+'.png'};
  await app.ui.reloadHistorySessionForTest();
  for(let i=0;i<10&&app.atlasHistoryViews.length===priorViewCount;i++) await tick();
  const latestView=app.atlasHistoryViews.at(-1);
  assert.ok(app.atlasHistoryViews.length>priorViewCount,'same-count canonical changes call setHistoryView again');
  assert.equal(latestView.questions[0].histories[0].events[0].title,'Event after refresh','event content reaches the Atlas projection');
  assert.equal(latestView.suggestions[0].title,'Suggestion after refresh','suggestion content reaches the Atlas projection');
  assert.equal(latestView.suggestions[0].sceneRef,'/event-scenes/'+'c'.repeat(64)+'.png','updated media refs reach the Atlas projection');
  assert.equal(latestView.selectedEventId,suggestion.id,'the selected suggestion identity survives canonical refresh');
  assert.equal(app.ui.state().history.selectedEventId,suggestion.id);
  assert.equal(app.get('hero-title').textContent,'200 CE · Suggestion after refresh');
  assert.equal(app.get('hero-image').src,'/event-scenes/'+'c'.repeat(64)+'.png','the selected sheet adopts the refreshed saved media');
});

test('saved-window chips focus the active batch and open exact overlapping cached windows', async () => {
  const first={fromYear:-3000,toYear:-2001}, second={fromYear:-2800,toYear:-1801};
  const selected={id:'selected-rock-paintings',year:-2950,title:'Wetland Rock Paintings',summary:'Inspected cached suggestion',suggestionForEventId:'canonical-event',window:first,sceneRef:'/event-scenes/'+'d'.repeat(64)+'.png'};
  const windowOne=[selected,{id:'first-window-two',year:-2700,title:'First batch two',window:first},{id:'first-window-three',year:-2400,title:'First batch three',window:first}];
  const windowTwo=[{id:'overlap-batch',year:-2300,title:'Overlapping cached batch',window:second}];
  const history={id:'saved-window-history',events:[],suggestions:[...windowOne,...windowTwo],suggestionWindows:[
    {window:first,status:'ready',batches:1,suggestionCount:3},{window:second,status:'ready',batches:1,suggestionCount:1},
  ]};
  const question={id:'saved-window-question',title:'Cached suggestion windows',divergenceYear:-3000,histories:[history]};
  const app=harness({},async()=>Response.json({status:'complete',url:'/history-media/'+'9'.repeat(64)+'.png',attached:true}),false,'',undefined,undefined,false,undefined,undefined,undefined,undefined,undefined,async url=>{
    if(url==='/api/history/preferences') return Response.json({autoSuggest:false});
    if(url.startsWith('/api/histories?')) return Response.json({questions:[question]});
    return null;
  });
  await tick(); app.ui.setHistoryContextForTest({questionId:question.id,historyId:history.id,eventId:selected.id,date:-3000,readOnly:true});
  for(let i=0;i<10&&!app.ui.state().history.history;i++) await tick();
  assert.equal(app.ui.state().history.selectedEventId,selected.id);
  assert.equal(app.get('hero-tag').textContent,'SELECTED SUGGESTION','the selected suggestion is visibly committed before window navigation');
  const panel=app.get('history-timeline-host').children[0].children[2];
  const initialDate=app.ui.state().history.date, initialHash=app.location.hash;
  const allCards=findNodes(panel,node=>node?.dataset?.suggestionId);
  assert.deepEqual(allCards.map(node=>node.dataset.suggestionId),['selected-rock-paintings','first-window-two','first-window-three','overlap-batch'],'the default gallery shows every cached suggestion in chronological order');
  assert.equal(findNodes(panel,node=>node?.className==='history-timeline-suggestion-group').length,2,'suggestions are grouped by their saved windows');
  assert.equal(findNode(panel,node=>node?.dataset?.suggestionId===selected.id)?.children[0]?.src,selected.sceneRef,'saved thumbnails are reused from canonical refs');
  const findWindow=(from,to)=>findNode(panel,node=>node?.dataset?.action==='suggest-window'&&node.dataset.fromYear===String(from)&&node.dataset.toYear===String(to));
  const firstChip=findWindow(first.fromYear,first.toYear), secondChip=findWindow(second.fromYear,second.toYear);
  assert.ok(firstChip&&secondChip,'both overlapping cached batches have their own navigation chip');
  assert.equal(firstChip.getAttribute('aria-current'),'true','the active preparation batch is visibly marked');
  assert.match(firstChip.textContent,/Current date/,'the active batch has a visible current label');
  panel.dispatchWithTarget('click',firstChip);
  assert.equal(app.ui.state().history.date,initialDate,'jumping to a cached window does not change the as-of date');
  assert.equal(app.ui.state().history.selectedEventId,selected.id,'reselecting the current batch preserves selection');
  assert.equal(findNode(panel,node=>node?.dataset?.windowKey===`${first.fromYear}:${first.toYear}`).focused,true,'the current chip scrolls and focuses its group');
  panel.dispatchWithTarget('click',secondChip);
  const switched=app.ui.state().history;
  assert.deepEqual(switched.window,first,'jumping between groups leaves the current preparation window intact');
  assert.equal(switched.date,initialDate,'browsing another batch does not move the as-of date');
  assert.equal(switched.selectedEventId,selected.id,'window navigation keeps the selected suggestion even outside the active batch');
  assert.equal(app.get('hero-tag').textContent,'SELECTED SUGGESTION');
  assert.equal(app.get('hero-title').textContent,'2950 BCE · Wetland Rock Paintings');
  assert.deepEqual(findNodes(panel,node=>node?.dataset?.suggestionId).map(node=>node.dataset.suggestionId),['selected-rock-paintings','first-window-two','first-window-three','overlap-batch'],'jumping between group anchors leaves every suggestion visible');
  assert.equal(findNode(panel,node=>node?.dataset?.windowKey===`${second.fromYear}:${second.toYear}`).focused,true,'the selected group receives focus without filtering');
  const inactiveTitle=findNode(panel,node=>node?.dataset?.action==='select-suggestion'&&node.dataset.id==='overlap-batch');
  const postsBeforeGalleryHover=app.posts.length;
  app.get('history-timeline-host').dispatchWithTarget('pointerover',inactiveTitle);
  assert.equal(app.get('hero-title').textContent,'2300 BCE · Overlapping cached batch','hovering a card title previews its canonical inactive-window suggestion');
  assert.equal(app.get('hero-tag').textContent,'SUGGESTION PREVIEW');
  assert.equal(app.ui.state().history.selectedEventId,selected.id);
  app.get('history-timeline-host').dispatchWithTarget('pointerout',inactiveTitle);
  assert.equal(app.get('hero-title').textContent,'2950 BCE · Wetland Rock Paintings','leaving the card restores the committed suggestion');
  assert.equal(app.get('hero-tag').textContent,'SELECTED SUGGESTION');
  assert.equal(app.posts.length,postsBeforeGalleryHover,'preview hover does not generate images');
  const dateAfterSwitch=switched.date, hashAfterSwitch=app.location.hash;
  panel.dispatchWithTarget('click',findWindow(second.fromYear,second.toYear));
  assert.equal(app.ui.state().history.date,dateAfterSwitch,'repeating a jump does not reset the as-of date');
  assert.equal(app.ui.state().history.selectedEventId,selected.id);
  assert.equal(app.location.hash,hashAfterSwitch);
  assert.equal(app.location.hash,initialHash,'gallery browsing does not rewrite the native history URL');
  for(let i=0;i<10&&app.posts.length<2;i++) await tick();
  assert.deepEqual(app.posts.map(post=>post.url),['/api/history/scene','/api/history/scene'],'gallery browsing does not generate images for inactive-window suggestions');
  assert.deepEqual(app.posts.map(post=>post.body.eventId).sort(),['first-window-two','first-window-three'].sort());
  const expand=findNode(panel,node=>node?.dataset?.action==='toggle-gallery');
  panel.dispatchWithTarget('click',expand);
  assert.equal(findNode(panel,node=>node?.dataset?.action==='toggle-gallery').getAttribute('aria-expanded'),'true');
  const expandedCards=findNodes(panel,node=>node?.dataset?.suggestionId);
  assert.deepEqual(expandedCards.map(node=>node.dataset.suggestionId),['selected-rock-paintings','first-window-two','first-window-three','overlap-batch'],'the expanded board compares every cached suggestion in chronological order across windows');
  assert.equal(findNodes(panel,node=>node?.className==='history-timeline-suggestion-group').length,1,'expanded board is one flat comparison grid across windows');
  panel.dispatchWithTarget('click',findNode(panel,node=>node?.dataset?.action==='toggle-gallery'));
  assert.equal(findNode(panel,node=>node?.dataset?.action==='toggle-gallery').getAttribute('aria-expanded'),'false','the board has a direct close action');
  app.window.matchMedia=query=>({matches:query.includes('max-width: 700px')});
  panel.dispatchWithTarget('click',findNode(panel,node=>node?.dataset?.action==='toggle-gallery'));
  const postsBeforeMobileInspect=app.posts.length;
  app.get('atlas-close-details').hidden=true;
  const mobileInspect=findNode(panel,node=>node?.dataset?.action==='select-suggestion'&&node.dataset.id==='first-window-three');
  panel.dispatchWithTarget('click',mobileInspect);
  assert.equal(app.ui.state().history.selectedEventId,'first-window-three','compact title activation commits the inspected cached suggestion');
  assert.equal(app.ui.state().history.date,initialDate,'compact inspection keeps the as-of date');
  assert.equal(app.get('history-timeline-host').children[0].classList.contains('history-gallery-expanded'),false,'compact inspection closes the full-screen board so its result is visible');
  assert.equal(app.document.body.classList.contains('atlas-details-open'),true,'compact inspection opens the selected-event details sheet');
  assert.equal(app.get('hero-title').focused,true,'Surface inspection focuses the revealed heading when its close control is hidden');
  assert.equal(app.posts.length,postsBeforeMobileInspect,'compact inspection remains read-only');
});

test('new history creation after selecting a suggestion attaches to its canonical event, not the suggestion or hover', async () => {
  const selected={id:'committed-sunda',year:-3000,title:'Sunda shelf communities'};
  const hovered={id:'preview-doggerland',year:-6000,title:'Doggerland foragers'};
  const suggestion={id:'suggestion-sunda',year:-2900,title:'Sunda coastal networks',suggestionForEventId:selected.id,window:{fromYear:-3000,toYear:-2001}};
  const history={id:'history-owner-sunda',events:[selected,hovered],suggestions:[suggestion],suggestionWindows:[{window:suggestion.window,status:'ready',suggestionCount:1}]};
  const question={id:'question-owner-sunda',title:'Climate question',divergenceYear:-3000,histories:[history]};
  const createdHistory={id:'created-history',events:[],suggestions:[],suggestionWindows:[]};
  const createdQuestion={id:'created-question',title:'New question',divergenceYear:2026,histories:[createdHistory]};
  const app=harness({},async url=>{
    if (url === '/api/history/scene') return Response.json({status:'unknown'});
    assert.equal(url,'/api/history/questions');
    return Response.json({question:createdQuestion,history:createdHistory,dateWindow:{fromYear:2001,toYear:3000}});
  },false,'',undefined,undefined,true,undefined,undefined,undefined,undefined,undefined,async url=>{
    if(url==='/health') return Response.json({status:'ok',metaKeyConfigured:true,localHistoryAccess:true,localReviewAccess:true,voiceEnabled:false});
    if(url==='/api/history/preferences') return Response.json({autoSuggest:false});
    if(url.startsWith('/api/histories?')) return Response.json({questions:[question]});
    return null;
  });
  await tick(); app.ui.setHistoryContextForTest({questionId:question.id,historyId:history.id,eventId:selected.id,date:-3000});
  for(let i=0;i<10&&!app.ui.state().history.history;i++) await tick();
  app.ui.selectHistoryEventForTest(suggestion.id);
  assert.equal(app.ui.state().history.selectedEventId,suggestion.id,'inspect selection keeps the suggestion identity');
  app.ui.previewGlobe({id:hovered.id,historyId:history.id,visualKind:'history-event'});
  assert.equal(app.get('hero-title').textContent,'6000 BCE · Doggerland foragers');
  await app.ui.runPrompt('What if coastal settlement changed?');
  const creation=app.posts.find(post=>post.url==='/api/history/questions');
  assert.deepEqual(creation.body.attachment,{mode:'history-event',questionId:question.id,historyId:history.id,eventId:selected.id});
});

test('automatic saved media completing during a temporary event preview updates only the selected-event snapshot', async () => {
  const selected={id:'selected-pending',year:100,title:'Scene being generated'};
  const hovered={id:'hovered-saved',year:200,title:'Saved sibling event',heroRef:{status:'complete',url:'/runs/hover-run/hero.png',runId:'hover-run',branchId:'hero'}};
  const history={id:'history-race',events:[selected,hovered],suggestions:[],suggestionWindows:[]};
  const question={id:'question-race',title:'Race question',divergenceYear:100,histories:[history]};
  let resolvePost;
  const app=harness({},()=>new Promise(resolve=>{resolvePost=()=>resolve(Response.json({status:'complete',url:'/history-media/'+'c'.repeat(64)+'.png'}));}),false,'',undefined,undefined,true,undefined,undefined,undefined,undefined,undefined,async url=>{
    if(url==='/health') return Response.json({status:'ok',metaKeyConfigured:true,localHistoryAccess:true,localReviewAccess:true,voiceEnabled:false});
    if(url==='/api/history/preferences') return Response.json({autoSuggest:false});
    if(url.startsWith('/api/histories?')) return Response.json({questions:[question]});
    return null;
  });
  await tick(); app.ui.setHistoryContextForTest({questionId:question.id,historyId:history.id,eventId:selected.id,date:100});
  for(let i=0;i<10&&!app.ui.state().history.history;i++) await tick();
  for(let i=0;i<8&&!app.posts.length;i++) await tick();
  assert.equal(app.posts.length,1,'active selected-event lifecycle prepares missing saved media');
  app.ui.previewGlobe({id:hovered.id,historyId:history.id,visualKind:'history-event'});
  assert.equal(app.get('hero-title').textContent,'200 CE · Saved sibling event');
  resolvePost(); await tick(); await tick();
  assert.equal(app.get('hero-title').textContent,'200 CE · Saved sibling event','the selected event response does not replace the active hover display');
  assert.equal(app.get('hero-image').src,'/runs/hover-run/hero.png');
  app.ui.previewGlobe(null); await new Promise(resolve=>setTimeout(resolve,250));
  assert.equal(app.get('hero-title').textContent,'100 CE · Scene being generated');
  assert.equal(app.get('hero-image').src,'/history-media/'+'c'.repeat(64)+'.png','the completed selected-event media survives restoration');
  assert.equal(app.ui.state().history.selectedEventId,selected.id);
});

test('history spines open sibling histories and questions at their latest events without generation', async () => {
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
  assert.equal(app.ui.state().history.date,600,'opening the sibling history selects its latest canonical event');
  app.starMap.options.onQuestionSelect('question-two',{source:'pointer'});
  assert.equal(app.ui.state().history.questionId,'question-two');
  assert.equal(app.ui.state().previewHidden,true,'switching questions clears a preview owned by the previous spine');
  assert.equal(app.ui.state().history.date,800);
  assert.equal(app.ui.state().history.selectedEventId,'two-latest');
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

test('fresh question authoring opens Meta setup when no key is configured and proceeds after setup', async () => {
  const question = {id:'written-q',title:'User question',divergenceYear:500,histories:[{id:'written-h',events:[],suggestions:[],suggestionWindows:[{window:{fromYear:1,toYear:1000},status:'ready',batches:1,suggestionCount:0}]}]};
  const history = question.histories[0];
  let health = {status:'ok',localHistoryAccess:true,setupAvailable:true,voiceEnabled:false,metaKeyConfigured:false,metaKeyOverrideActive:false};
  const app = harness({}, async url => {
    if (url === '/api/local-meta-key') {
      health = {status:'ok',localHistoryAccess:true,localReviewAccess:true,setupAvailable:true,voiceEnabled:false,metaKeyConfigured:true,metaKeyOverrideActive:true};
      return Response.json({setupAvailable:true,metaKeyConfigured:true,metaKeyOverrideActive:true,localReviewAccess:true,localHistoryAccess:true});
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
  assert.equal(app.get('service-mode').textContent,'Saved histories · Meta key setup required');
  assert.match(app.get('footer-service-mode').textContent,/configure a Meta API key for fresh questions/i);
  assert.equal(app.get('live-submit').getAttribute('aria-label'),'Configure a Meta API key to create a fresh history');
  assert.equal(app.get('live-submit').disabled,false,'the key setup CTA remains available without a configured key');
  await app.ui.runPrompt('What if river observatories changed?');
  assert.equal(app.posts.length,0,'keyless replay access cannot create a new history');
  assert.equal(app.get('meta-key-setup').open,true,'the keyless submit opens the existing local setup panel');
  assert.equal(app.get('meta-key-input').focused,true,'the keyless submit directs focus to the existing key setup');
  assert.equal(app.get('history-creation-status').hidden,false,'the access preflight message is visible beside the form');
  assert.match(app.get('history-creation-status').textContent,/Configure a Meta API key.*fresh history/);
  app.get('meta-key-input').value='fixture-meta-key'; app.get('meta-key-use').click();
  for (let i=0;i<10&&app.get('live-submit').getAttribute('aria-label')!=='Create a fresh history';i++) await tick();
  await tick();
  assert.equal(app.posts[0].url,'/api/local-meta-key');
  assert.equal(app.get('live-submit').getAttribute('aria-label'),'Create a fresh history');
  await app.ui.runPrompt('What if river observatories changed?');
  for (let i=0;i<10&&app.ui.state().history.loading;i++) await tick();
  assert.equal(app.posts[1].url,'/api/history/questions');
  assert.equal(app.posts[1].body.question,'What if river observatories changed?');
  assert.deepEqual(app.posts[1].body,{question:'What if river observatories changed?'},'a root question lets the framing model choose its divergence date and place');
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

test('whitespace-only root question shows an inline prompt and sends no request', async () => {
  const app = harness({});
  await tick();
  await app.ui.runPrompt('  \n  ');
  assert.deepEqual(app.posts,[],'empty trimmed prompts never reach history generation');
  assert.equal(app.get('history-creation-status').hidden,false);
  assert.match(app.get('history-creation-status').textContent,/Enter a question/);
});

test('root history creation reports endpoint rejections beside the question form', async () => {
  const app = harness({}, async url => {
    assert.equal(url,'/api/history/questions');
    return Response.json({error:'That prompt could not be verified against the topic policy, so it was not run. Try a science, technology, culture or geography question.',code:'topic_blocked'}, {status:400});
  });
  await tick();
  await app.ui.runPrompt('What if Buddhism spread to Arabia?');
  assert.deepEqual(app.posts[0].body,{question:'What if Buddhism spread to Arabia?'},'root submissions omit unsupported attachment modes');
  assert.equal(app.get('history-creation-status').hidden,false);
  assert.match(app.get('history-creation-status').textContent,/could not be verified against the topic policy/i);
  assert.equal(app.get('live-submit').disabled,false,'a rejected prompt can be corrected and retried');
  assert.equal(app.get('live-submit').getAttribute('aria-label'),'Create a fresh history');
  const html = readFileSync(new URL('../web/index.html',import.meta.url),'utf8');
  assert.match(html,/<div class="input-row">[\s\S]*?<\/div>\s*<p id="history-creation-status"[^>]*>/,'creation errors sit immediately below the input row, before content that can extend the form below the fold');
});

test('history creation stays visibly busy through service-mode refresh and reenables after reset', async () => {
  let finishRequest;
  const question = {id:'busy-question',title:'A new question',divergenceYear:500,histories:[{id:'busy-history',events:[]}]};
  const app = harness({}, () => new Promise(resolve => { finishRequest = resolve; }));
  await tick();
  const request = app.ui.runPrompt('What if observatories changed?');
  await tick();
  assert.equal(app.get('live-submit').disabled,true);
  assert.equal(app.get('live-submit').getAttribute('aria-label'),'Creating a fresh history');
  await app.ui.loadServiceModeForTest();
  assert.equal(app.get('live-submit').disabled,true,'a mode refresh does not reenable an in-flight request');
  assert.equal(app.get('live-submit').getAttribute('aria-label'),'Creating a fresh history');
  finishRequest(Response.json({question,history:question.histories[0],divergenceYear:500},{status:201}));
  await request;
  assert.equal(app.get('live-submit').disabled,false,'completion resynchronizes the CTA even though reset invalidates the request id');
  assert.equal(app.get('live-submit').getAttribute('aria-label'),'Create a fresh history');
});

test('keyless saved-history scene action opens the existing Meta setup instead of posting and failing', async () => {
  const event={id:'keyless-scene-event',year:300,title:'Event without scene'};
  const history={id:'keyless-scene-history',events:[event],suggestions:[],suggestionWindows:[]};
  const question={id:'keyless-scene-question',title:'Question',histories:[history]};
  const app=harness({},async()=>{assert.fail('the scene action must open setup without posting');},true,'',undefined,undefined,false,undefined,undefined,undefined,undefined,undefined,async url=>{
    if(url==='/health') return Response.json({status:'ok',setupAvailable:true,metaKeyConfigured:false,localHistoryAccess:true,localReviewAccess:false,voiceEnabled:false});
    if(url==='/api/history/preferences') return Response.json({autoSuggest:false});
    if(url.startsWith('/api/histories?')) return Response.json({questions:[question]});
    return null;
  },true);
  await tick(); app.ui.setHistoryContextForTest({questionId:question.id,historyId:history.id,eventId:event.id,date:300});
  for(let i=0;i<10&&!app.ui.state().history.history;i++) await tick();
  assert.equal(app.get('event-scene-action').textContent,'Configure Meta key');
  app.get('event-scene-action').click();
  assert.equal(app.get('meta-key-setup').open,true);
  assert.equal(app.get('meta-key-input').focused,true);
  assert.deepEqual(app.posts,[]);
});

test('native history URL reopens the exact question, history, date and event without POST or Meta access', async () => {
  const event = {id:'event-native',year:900,title:'Canopy observatories',summary:'A saved event.',place:{name:'Sahara',lat:20,lon:10},sceneRef:'/event-scenes/'+'c'.repeat(64)+'.png'};
  const history = {id:'history-native',events:[event],suggestions:[],suggestionWindows:[]};
  const question = {id:'question-native',question:'What if observatories spread?',title:'Observatories',divergenceYear:700,origin:'user-written',histories:[history]};
  const hash = '#question=question-native&history=history-native&date=900&event=event-native';
  const app = harness({}, undefined, true, hash, undefined, undefined, false, undefined, undefined, undefined, undefined, undefined, async url => {
    if (url === '/health') return Response.json({status:'ok',localHistoryAccess:true,localReviewAccess:true,voiceEnabled:false,metaKeyConfigured:true});
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

test('native history URL without a date opens the saved history at its latest canonical event', async () => {
  const older = {id:'event-older',year:700,title:'Canopy markers',place:{name:'Sahara',lat:20,lon:10},sceneRef:'/event-scenes/'+'a'.repeat(64)+'.png'};
  const latest = {id:'event-latest',year:900,title:'Canopy observatories',place:{name:'Sahara',lat:20,lon:10},sceneRef:'/event-scenes/'+'b'.repeat(64)+'.png'};
  const history = {id:'history-date-less',events:[older,latest],suggestions:[],suggestionWindows:[]};
  const question = {id:'question-date-less',question:'What if observatories spread?',title:'Observatories',histories:[history]};
  const app = harness({}, undefined, false, `#question=${question.id}&history=${history.id}`, undefined, undefined, false,
    undefined, undefined, undefined, undefined, undefined, async url => url === '/api/histories' ? Response.json({questions:[question]}) : null);
  await tick();
  for (let i=0;i<12 && !app.ui.state().history.questionId;i++) await tick();
  assert.equal(app.ui.state().history.questionId,question.id);
  assert.equal(app.ui.state().history.historyId,history.id);
  assert.equal(app.ui.state().history.date,latest.year);
  assert.equal(app.ui.state().history.selectedEventId,latest.id);
  assert.deepEqual(app.posts,[],'opening a date-less history link only reads saved state');
});

test('native history URL before the first event opens at that first event instead of an empty date', async () => {
  const first = {id:'first-event',year:-500,title:'Lake markers',place:{name:'Sahara',lat:20,lon:10}};
  const history = {id:'history-early-url',events:[first],suggestions:[],suggestionWindows:[]};
  const question = {id:'question-early-url',question:'What if the Sahara stayed green?',title:'Green Sahara',histories:[history]};
  const hash = `#question=${question.id}&history=${history.id}&date=-1000&event=missing-event`;
  const app = harness({}, undefined, false, hash, undefined, undefined, false,
    undefined, undefined, undefined, undefined, undefined, async url => url === '/api/histories' ? Response.json({questions:[question]}) : null);
  await tick();
  for (let i=0;i<12 && !app.ui.state().history.questionId;i++) await tick();
  assert.equal(app.ui.state().history.date,first.year);
  assert.equal(app.ui.state().history.selectedEventId,first.id);
  assert.equal(app.ui.state().history.history.events.filter(event => event.year <= app.ui.state().history.date).length,1);
});

test('Earth surface card stays collapsed until its chip is activated', () => {
  const app = harness({});
  const content = app.get('geography-content'), toggle = app.get('geography-toggle');
  content.hidden = true; toggle.setAttribute('aria-expanded','false');
  toggle.click();
  assert.equal(content.hidden,false);
  assert.equal(toggle.getAttribute('aria-expanded'),'true');
  toggle.click();
  assert.equal(content.hidden,true);
  assert.equal(toggle.getAttribute('aria-expanded'),'false');
});

test('canceling a new-history draft returns to the selected saved event without changing date, hash or media', async () => {
  const event={id:'preserved-event',year:1883,title:'Buried Oaks',summary:'Existing saved event.',sceneRef:'/event-scenes/'+'a'.repeat(64)+'.png',cutoutRef:'/event-cutouts/'+'b'.repeat(64)+'.png'};
  const history={id:'preserved-history',events:[event],suggestions:[],suggestionWindows:[]};
  const question={id:'preserved-question',title:'Existing question',histories:[history]};
  const app=harness({},async url=>{
    if(url==='/api/history/questions') return Response.json({error:'Safe fixture request failure.',code:'question_creation_failed'},{status:503});
    assert.fail('canceling a draft must not submit other work');
  },false,'',undefined,undefined,false,undefined,undefined,undefined,undefined,undefined,async url=>{
    if(url==='/api/history/preferences') return Response.json({autoSuggest:false});
    if(url.startsWith('/api/histories?')) return Response.json({questions:[question]});
    return null;
  });
  await tick(); app.ui.setHistoryContextForTest({questionId:question.id,historyId:history.id,eventId:event.id,date:1883});
  for(let i=0;i<10&&!app.ui.state().history.history;i++) await tick();
  const galleryHost=app.get('history-timeline-host');
  const timelineRoot=galleryHost.children[0];
  const suggestionsPanel=galleryHost.children[0].children[2];
  const expandGallery=findNode(suggestionsPanel,node=>node?.dataset?.action==='toggle-gallery');
  assert.ok(expandGallery,'a saved-history draft can be opened while the all-suggestions board is available');
  suggestionsPanel.dispatchWithTarget('click',expandGallery);
  assert.equal(timelineRoot.classList.contains('history-gallery-expanded'),true);
  app.get('cutout-view').click();
  assert.equal(app.ui.state().activeView,'cutout');
  assert.equal(app.get('workspace').classList.contains('hero-focus'),true,'a selected saved cutout uses the focused hero view');
  const before={...app.ui.state().history}, hash=app.location.hash, image=app.get('hero-image').src, footerStatus=app.get('status').textContent;
  assert.equal(app.document.body.classList.contains('has-story'),true);
  app.document.body.classList.add('atlas-focused');
  app.get('show-invitation').click();
  assert.equal(app.document.body.classList.contains('invitation-open'),true);
  assert.equal(timelineRoot.classList.contains('history-gallery-expanded'),true,'opening a draft suspends the expanded layout without discarding its gallery state');
  assert.equal(app.get('workspace').classList.contains('hero-focus'),false,'opening the draft suspends hero focus so the form remains visible');
  assert.equal(app.get('cancel-new-exploration').hidden,false,'an existing story exposes a clear draft-cancel action');
  app.get('prompt').value='A draft that should not replace this history';
  app.get('cancel-new-exploration').click();
  assert.equal(app.document.body.classList.contains('invitation-open'),false);
  assert.equal(app.get('prompt').value,'');
  assert.equal(app.get('show-invitation').focused,true,'Cancel returns focus to New exploration');
  assert.equal(app.get('status').textContent,footerStatus,'Cancel restores the story footer status instead of leaking draft feedback');
  assert.equal(app.get('history-creation-status').hidden,true,'Cancel clears inline draft feedback');
  assert.equal(app.ui.state().activeView,'cutout','Cancel restores the previously selected media tab');
  assert.equal(app.get('workspace').classList.contains('hero-focus'),true,'Cancel restores the selected cutout presentation');
  assert.equal(timelineRoot.classList.contains('history-gallery-expanded'),true,'Cancel returns to the expanded gallery without changing its selection');
  assert.equal(app.document.body.classList.contains('atlas-focused'),true,'Cancel restores the Atlas navigation mode that opened the draft');
  assert.equal(app.location.hash,hash);
  assert.equal(app.ui.state().history.questionId,before.questionId);
  assert.equal(app.ui.state().history.historyId,before.historyId);
  assert.equal(app.ui.state().history.date,before.date);
  assert.equal(app.ui.state().history.selectedEventId,before.selectedEventId);
  assert.equal(app.get('hero-image').src,image);
  assert.deepEqual(app.posts,[]);

  app.get('show-invitation').click();
  await app.ui.runPrompt('   \n  ');
  assert.match(app.get('history-creation-status').textContent,/Enter a question/);
  assert.equal(app.get('status').textContent,footerStatus,'preflight feedback stays out of the story footer');
  app.get('cancel-new-exploration').click();
  assert.equal(app.get('history-creation-status').hidden,true);
  assert.equal(app.get('history-creation-status').textContent,'');
  assert.equal(app.get('status').textContent,footerStatus,'Cancel restores the original story footer status after whitespace feedback');
  assert.deepEqual(app.posts,[],'whitespace preflight does not submit a request');
  app.get('show-invitation').click();
  await app.ui.runPrompt('What if river observatories changed?');
  assert.match(app.get('history-creation-status').textContent,/Safe fixture request failure/);
  assert.equal(app.get('status').textContent,'Safe fixture request failure.','server errors may appear in the footer while the draft is open');
  app.get('cancel-new-exploration').click();
  assert.equal(app.get('status').textContent,footerStatus,'Cancel restores the story footer after a failed server draft');
  assert.equal(app.get('history-creation-status').hidden,true);

  const css=readFileSync(new URL('../web/style.css',import.meta.url),'utf8');
  assert.match(css,/body:not\(\.invitation-open\):has\(\.history-gallery-expanded\) \.exploration-rail\s*\{/,'the mobile gallery drawer is suspended while the draft form is open');
  assert.match(css,/body:not\(\.invitation-open\):has\(\.history-gallery-expanded\) \.site-header\s*\{/,'mobile gallery chrome no longer covers the draft header');
  assert.match(css,/@media\(min-width:701px\) and \(max-width:1199px\)\{body:not\(\.invitation-open\) \.history-gallery-expanded \.history-timeline-suggestion-groups\{grid-template-columns:minmax\(0,1fr\)\}\}/,'intermediate tablet and laptop widths use one gallery column beside the right event sheet');
  assert.match(css,/@media\(min-width:701px\) and \(max-width:799px\)\{body:not\(\.invitation-open\) \.history-gallery-expanded \.history-timeline-suggestion\{grid-template-columns:minmax\(0,1fr\)\}body:not\(\.invitation-open\) \.history-gallery-expanded \.history-timeline-suggestion-image,body:not\(\.invitation-open\) \.history-gallery-expanded \.history-timeline-suggestion-image-placeholder,body:not\(\.invitation-open\) \.history-gallery-expanded \.history-timeline-suggestion-content\{grid-column:1\}\}/,'the narrow 701–799px gallery stacks its thumbnail above full-width text');
  assert.match(css,/body:not\(\.invitation-open\) \.history-gallery-expanded \.history-timeline-suggestion-groups\{display:grid;grid-template-columns:repeat\(2,minmax\(0,1fr\)\)/,'desktop gallery keeps two columns above the intermediate-width override');
  assert.match(css,/@media\(max-width:700px\)\{[\s\S]*?body:not\(\.invitation-open\):has\(\.history-gallery-expanded\) \.exploration-rail\{[^}]*inset:8px!important[^}]*width:auto!important/,'the phone gallery drawer keeps its full-width inset layout');

  app.get('show-invitation').click(); app.get('prompt').value='Escape draft';
  const escaped=app.document.keydown('Escape');
  assert.equal(escaped.prevented,true); assert.equal(escaped.stopped,true);
  assert.equal(app.document.body.classList.contains('invitation-open'),false,'Escape closes the draft back to the current story');
  assert.equal(app.ui.state().history.selectedEventId,before.selectedEventId);
  assert.equal(app.posts.length,1,'the only request was the explicit failed draft submission');
});

test('history cutout completion during a new-exploration draft stores media without stealing the draft or prior view', async () => {
  const event={id:'draft-cutout-event',year:1883,title:'Buried Oaks',summary:'A saved event.',sceneRef:'/event-scenes/'+'c'.repeat(64)+'.png'};
  const history={id:'draft-cutout-history',events:[event],suggestions:[],suggestionWindows:[]};
  const question={id:'draft-cutout-question',title:'Saved question',histories:[history]};
  let finishCutout;
  const pendingCutout=new Promise(resolve=>{finishCutout=resolve;});
  const app=harness({},async url=>{
    assert.equal(url,'/api/history/cutout');
    return pendingCutout;
  },false,'',undefined,undefined,false,undefined,undefined,undefined,undefined,undefined,async url=>{
    if(url==='/api/history/preferences') return Response.json({autoSuggest:false});
    if(url.startsWith('/api/histories?')) return Response.json({questions:[question]});
    return null;
  });
  await tick(); app.ui.setHistoryContextForTest({questionId:question.id,historyId:history.id,eventId:event.id,date:event.year});
  for(let i=0;i<10&&!app.ui.state().history.history;i++) await tick();
  assert.equal(app.ui.state().activeView,'scene');
  app.get('cutout-view').click(); await tick(); await tick();
  assert.equal(app.posts.length,1,'the test starts one explicit cutout request');
  app.get('show-invitation').click();
  assert.equal(app.document.body.classList.contains('invitation-open'),true);
  assert.equal(app.get('workspace').classList.contains('hero-focus'),false);
  finishCutout(Response.json({status:'complete',url:'/event-cutouts/'+'d'.repeat(64)+'.png'}));
  for(let i=0;i<8;i++) await tick();
  assert.equal(app.document.body.classList.contains('invitation-open'),true,'async completion must leave the draft open');
  assert.equal(app.get('workspace').classList.contains('hero-focus'),false,'async completion must not hide the draft behind hero focus');
  assert.equal(app.ui.state().activeView,'scene','completion does not replace the view selected before opening the draft');
  assert.equal(app.get('cutout-image').src,'/event-cutouts/'+'d'.repeat(64)+'.png','the completed cutout is still stored for inspection');
  app.get('cancel-new-exploration').click();
  assert.equal(app.document.body.classList.contains('invitation-open'),false);
  assert.equal(app.ui.state().activeView,'scene','Cancel restores the pre-draft view');
  assert.equal(app.get('workspace').classList.contains('hero-focus'),false);
  assert.deepEqual(app.posts.map(post=>post.url),['/api/history/cutout'],'closing the draft does not restart or duplicate media work');
});

test('history activation prepares only cached-window suggestions and the committed event, then reuses their refs', async () => {
  const window={fromYear:1,toYear:1000};
  const suggestions=[
    {id:'suggestion-a',year:30,title:'Suggestion A',summary:'A cached suggestion.',window},
    {id:'suggestion-b',year:40,title:'Suggestion B',summary:'Another cached suggestion.',window},
  ];
  const events=[
    {id:'past-pin',year:10,title:'A past pin'},
    {id:'selected-pin',year:20,title:'The committed event'},
    {id:'future-pin',year:50,title:'A future pin'},
    {id:'saved-pin',year:5,title:'Already has a scene',sceneRef:'/event-scenes/'+'a'.repeat(64)+'.png'},
  ];
  const history={id:'active-history',events,suggestions,suggestionWindows:[{window,status:'ready',batches:1,suggestionCount:2}]};
  const sibling={id:'sibling-history',events:[{id:'sibling-pin',year:15,title:'Different history pin'}],suggestions:[],suggestionWindows:[]};
  const question={id:'active-question',title:'History scene preparation',histories:[history,sibling]};
  const generatedUrls=new Map();
  const app=harness({},async (url,options)=>{
    assert.equal(url,'/api/history/scene');
    const identity=JSON.parse(options.body);
    const image=`/history-media/${String.fromCharCode(97+generatedUrls.size).repeat(64)}.png`;
    generatedUrls.set(identity.eventId,image);
    return Response.json({status:'complete',url:image});
  },false,'',undefined,undefined,true,undefined,undefined,undefined,undefined,undefined,async url=>{
    if(url==='/health') return Response.json({status:'ok',metaKeyConfigured:true,localHistoryAccess:true,localReviewAccess:true,voiceEnabled:false});
    if(url==='/api/history/preferences') return Response.json({autoSuggest:false});
    if(url.startsWith('/api/histories?')) return Response.json({questions:[question]});
    return null;
  });
  await tick();
  app.ui.setHistoryContextForTest({questionId:question.id,historyId:history.id,eventId:'selected-pin',date:20});
  for(let i=0;i<30&&generatedUrls.size<3;i++) await tick();
  assert.deepEqual([...generatedUrls.keys()],['suggestion-a','suggestion-b','selected-pin']);
  assert.ok(!generatedUrls.has('future-pin')&&!generatedUrls.has('past-pin')&&!generatedUrls.has('sibling-pin')&&!generatedUrls.has('saved-pin'));
  assert.equal(app.get('hero-image').src,generatedUrls.get('selected-pin'),'the committed sheet adopts its automatically prepared scene');
  app.ui.previewGlobe({id:'suggestion-a',historyId:history.id,visualKind:'history-suggestion'});
  assert.equal(app.get('hero-image').src,generatedUrls.get('suggestion-a'),'a canonical suggestion preview uses its prepared scene ref');
  const postCount=app.posts.length;
  app.ui.previewGlobe(null,{source:'pointer'});
  assert.equal(app.posts.length,postCount,'hovering and leaving a prepared suggestion makes no request');
  app.ui.setHistoryDateForTest(21);
  for(let i=0;i<3;i++) await tick();
  assert.equal(app.posts.length,postCount,'same-window renders dedupe scene preparation by canonical identity');
});

test('automatically prepared suggestion scenes refresh every gallery card without changing selection or date', async () => {
  const window={fromYear:1,toYear:1000};
  const suggestions=[
    {id:'gallery-a',year:260,title:'Gallery A',summary:'First saved possibility.',window},
    {id:'gallery-b',year:270,title:'Gallery B',summary:'Second saved possibility.',window},
    {id:'gallery-c',year:280,title:'Gallery C',summary:'Third saved possibility.',window},
  ];
  const history={id:'gallery-history',events:[],suggestions,suggestionWindows:[{window,status:'ready',batches:1,suggestionCount:3}]};
  const question={id:'gallery-question',title:'Gallery media refresh',histories:[history]};
  const generated=new Map();
  const app=harness({},async (url,options)=>{
    assert.equal(url,'/api/history/scene');
    const identity=JSON.parse(options.body), image=`/history-media/${String.fromCharCode(97+generated.size).repeat(64)}.png`;
    generated.set(identity.eventId,image); return Response.json({status:'complete',url:image,attached:true});
  },false,'',undefined,undefined,true,undefined,undefined,undefined,undefined,undefined,async url=>{
    if(url==='/health') return Response.json({status:'ok',metaKeyConfigured:true,localHistoryAccess:true,localReviewAccess:true,voiceEnabled:false});
    if(url==='/api/history/preferences') return Response.json({autoSuggest:false});
    if(url.startsWith('/api/histories?')) return Response.json({questions:[question]});
    return null;
  });
  await tick(); app.ui.setHistoryContextForTest({questionId:question.id,historyId:history.id,eventId:'gallery-b',date:270});
  const initial={date:app.ui.state().history.date,eventId:app.ui.state().history.selectedEventId};
  for(let i=0;i<40&&generated.size<3;i++) await tick();
  const cards=findNodes(app.get('history-timeline-host'),node=>node?.className==='history-timeline-suggestion');
  assert.equal(cards.length,3);
  assert.deepEqual(cards.map(card=>findNodes(card,node=>node?.tagName==='img')[0]?.src),suggestions.map(item=>generated.get(item.id)));
  const windowChip=findNodes(app.get('history-timeline-host'),node=>node?.dataset?.action==='suggest-window')[0];
  assert.match(windowChip?.textContent || '',/(?:Current date · )?3 ·/,'cached window count matches the three unique suggestion cards');
  assert.equal(app.ui.state().history.date,initial.date);
  assert.equal(app.ui.state().history.selectedEventId,initial.eventId);
  assert.equal(app.get('hero-image').src,generated.get('gallery-b'),'the selected sheet receives its image without changing selection');
  assert.equal(app.posts.length,3,'refreshing session/gallery state does not request or regenerate images');
});

test('unattached automatic scene results are reconciled before they appear in the saved-event sheet', async () => {
  const event={id:'unattached-event',year:40,title:'Canonical saved event'};
  const history={id:'unattached-history',events:[event],suggestions:[],suggestionWindows:[]};
  const question={id:'unattached-question',title:'Attachment race',histories:[history]};
  const app=harness({},async url=>{
    assert.equal(url,'/api/history/scene');
    return Response.json({status:'complete',url:`/history-media/${'f'.repeat(64)}.png`,attached:false});
  },false,'',undefined,undefined,true,undefined,undefined,undefined,undefined,undefined,async url=>{
    if(url==='/health') return Response.json({status:'ok',metaKeyConfigured:true,localHistoryAccess:true,localReviewAccess:true,voiceEnabled:false});
    if(url==='/api/history/preferences') return Response.json({autoSuggest:false});
    if(url.startsWith('/api/histories?')) return Response.json({questions:[question]});
    return null;
  });
  await tick(); app.ui.setHistoryContextForTest({questionId:question.id,historyId:history.id,eventId:event.id,date:40});
  for(let i=0;i<12&&!app.posts.length;i++) await tick();
  for(let i=0;i<6;i++) await tick();
  assert.equal((app.get('hero-image')?.src || '').includes('f'.repeat(64)),false,'a noncanonical result never appears as a saved image');
  assert.match(app.get('stage-empty').querySelector('p').textContent,/could not be confirmed/i);
});

test('history activation prepares a missing saved scene and cutout stays tied to the committed event', async () => {
  const event = {id:'event-new',year:500,title:'A saved history event',summary:'Written by the history service'};
  const history = {id:'h-media',events:[event],suggestions:[],suggestionWindows:[]};
  const question = {id:'q-media',title:'Media question',divergenceYear:500,histories:[history]};
  const app = harness({}, async url => {
    const kind = url.endsWith('/scene') ? 'scene' : 'cutout';
    return Response.json({status:'complete',url:`/history-media/${(kind==='scene'?'a':'b').repeat(64)}.png`});
  }, false, '', undefined, undefined, true, undefined, undefined, undefined, undefined, undefined, async url => {
    if (url === '/health') return Response.json({status:'ok',localHistoryAccess:true,localReviewAccess:true,voiceEnabled:false,metaKeyConfigured:true});
    if (url === '/api/history/preferences') return Response.json({autoSuggest:false});
    if (url.startsWith('/api/histories?')) return Response.json({questions:[question]});
    return null;
  });
  await tick();
  app.ui.setHistoryContextForTest({questionId:question.id,historyId:history.id,eventId:event.id,date:500});
  for (let i=0;i<10&&!app.ui.state().history.history;i++) await tick();
  for (let i=0;i<10&&!app.posts.length;i++) await tick();
  assert.equal(app.posts.length,1,'history activation prepares the missing committed scene once');
  assert.deepEqual(app.posts[0].body,{questionId:question.id,historyId:history.id,eventId:event.id});
  assert.equal(app.posts[0].url,'/api/history/scene');
  assert.match(app.get('hero-image').src,/^\/history-media\/[a-f\d]{64}\.png$/);
  app.get('cutout-view').click(); await tick(); await tick();
  assert.equal(app.posts.at(-1).url,'/api/history/cutout');
  assert.deepEqual(app.posts.at(-1).body,{questionId:question.id,historyId:history.id,eventId:event.id});
  assert.equal(app.posts.some(post=>post.url==='/api/event-scene'||post.url==='/api/event-cutout'),false);
});

test('local Meta key setup refreshes live feature mode and keeps the key out of browser storage', async () => {
  const secret = 'fixture-only-meta-key';
  let health = { status:'ok', voiceEnabled:false, localHistoryAccess:true, localReviewAccess:false, setupAvailable:true, metaKeyConfigured:false, metaKeyOverrideActive:false, expansionLimit:20, expansionUsed:0 };
  const app = harness({}, async (url, options) => {
    health = { ...health, voiceEnabled:true, localReviewAccess:true, metaKeyConfigured:true, metaKeyOverrideActive:true };
    return Response.json({ setupAvailable:true, metaKeyConfigured:true, metaKeyOverrideActive:true, localHistoryAccess:true, localReviewAccess:true });
  }, true, '', undefined, undefined, false, undefined, undefined, undefined, undefined, undefined, async url => url === '/health' ? Response.json(health) : null);
  await tick();
  assert.equal(app.get('meta-key-setup').hidden, false, 'setup appears when local history access has no configured key');
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

test('history SAM cutout reuses the selected legacy hero with local history authorization and hides absent 3D actions', async () => {
  const event={id:'saved-with-hero',year:1883,title:'Buried Oaks',summary:'A saved event with a legacy hero.',heroRef:{status:'complete',url:'/runs/saved-run/hero.png',runId:'saved-run',branchId:'b1'}};
  const history={id:'saved-history',events:[event],suggestions:[],suggestionWindows:[]};
  const question={id:'saved-question',title:'Saved question',histories:[history]};
  const app=harness({},async (url,options)=>{
    assert.equal(url,'/api/history/cutout');
    assert.deepEqual(JSON.parse(options.body),{questionId:question.id,historyId:history.id,eventId:event.id});
    return Response.json({status:'complete',url:'/history-media/'+'f'.repeat(64)+'.png',attached:true});
  },false,'',undefined,undefined,true,undefined,undefined,undefined,undefined,undefined,async url=>{
    if(url==='/health') return Response.json({status:'ok',metaKeyConfigured:true,localHistoryAccess:true,localReviewAccess:false,voiceEnabled:false});
    if(url==='/api/history/preferences') return Response.json({autoSuggest:false});
    if(url.startsWith('/api/histories?')) return Response.json({questions:[question]});
    return null;
  });
  await tick(); app.ui.setHistoryContextForTest({questionId:question.id,historyId:history.id,eventId:event.id,date:1883});
  for(let i=0;i<12&&!app.ui.state().history.history;i++) await tick();
  assert.equal(app.get('hero-image').src,event.heroRef.url);
  assert.equal(app.get('model-button').hidden,true,'3D remains hidden when there is no saved model and private generation is unavailable');
  assert.notEqual(app.get('cutout-view').disabled,true,'localHistoryAccess plus the configured key enables history media generation');
  app.get('cutout-view').click(); for(let i=0;i<8&&app.ui.state().activeView!=='cutout';i++) await tick();
  assert.equal(app.posts.length,1,'the explicit SAM action uses the saved hero directly without creating another scene');
  assert.equal(app.get('cutout-image').src,'/history-media/'+'f'.repeat(64)+'.png');
});

test('explicit SAM intent prepares a missing scene prerequisite and then completes the cutout', async () => {
  const retryOf='a'.repeat(64);
  const event={id:'needs-scene',year:1883,title:'Buried Oaks',sceneRef:{status:'unknown',retryOf}};
  const history={id:'chain-history',events:[event],suggestions:[],suggestionWindows:[]};
  const question={id:'chain-question',title:'Question',histories:[history]};
  const app=harness({},async url=>{
    if(url==='/api/history/cutout'&&!app.posts.some(post=>post.url==='/api/history/scene')) return Response.json({status:'missing-image',code:'scene_required',prerequisite:'scene'});
    if(url==='/api/history/scene') return Response.json({status:'complete',url:'/history-media/'+'b'.repeat(64)+'.png',attached:true});
    if(url==='/api/history/cutout') return Response.json({status:'complete',url:'/history-media/'+'c'.repeat(64)+'.png',attached:true});
    assert.fail(`Unexpected media request ${url}`);
  },false,'',undefined,undefined,true,undefined,undefined,undefined,undefined,undefined,async url=>{
    if(url==='/health') return Response.json({status:'ok',metaKeyConfigured:true,localHistoryAccess:true,localReviewAccess:false,voiceEnabled:false});
    if(url==='/api/history/preferences') return Response.json({autoSuggest:false});
    if(url.startsWith('/api/histories?')) return Response.json({questions:[question]});
    return null;
  });
  await tick(); app.ui.setHistoryContextForTest({questionId:question.id,historyId:history.id,eventId:event.id,date:1883});
  for(let i=0;i<12&&!app.ui.state().history.history;i++) await tick();
  app.get('cutout-view').click();
  for(let i=0;i<12&&app.ui.state().activeView!=='cutout';i++) await tick();
  assert.deepEqual(app.posts.map(post=>post.url),['/api/history/cutout','/api/history/scene','/api/history/cutout']);
  assert.deepEqual(app.posts[1].body,{questionId:question.id,historyId:history.id,eventId:event.id,retryOf});
  assert.equal(app.get('hero-image').src,'/history-media/'+'b'.repeat(64)+'.png');
  assert.equal(app.get('cutout-image').src,'/history-media/'+'c'.repeat(64)+'.png');
});

test('history cutout pending work is polled to completion without another manual detour', async () => {
  const event={id:'pending-cutout-event',year:10,title:'Saved scene',sceneRef:'/event-scenes/'+'d'.repeat(64)+'.png'};
  const history={id:'pending-cutout-history',events:[event],suggestions:[],suggestionWindows:[]};
  const question={id:'pending-cutout-question',title:'Question',histories:[history]};
  let calls=0;
  const app=harness({},async url=>{
    assert.equal(url,'/api/history/cutout'); calls++;
    return calls===1 ? Response.json({status:'pending'}, {status:202}) : Response.json({status:'complete',url:'/history-media/'+'e'.repeat(64)+'.png',attached:true});
  },false,'',undefined,undefined,true,undefined,undefined,undefined,undefined,undefined,async url=>{
    if(url==='/health') return Response.json({status:'ok',metaKeyConfigured:true,localHistoryAccess:true,localReviewAccess:false,voiceEnabled:false});
    if(url==='/api/history/preferences') return Response.json({autoSuggest:false});
    if(url.startsWith('/api/histories?')) return Response.json({questions:[question]});
    return null;
  });
  await tick(); app.ui.setHistoryContextForTest({questionId:question.id,historyId:history.id,eventId:event.id,date:10});
  for(let i=0;i<12&&!app.ui.state().history.history;i++) await tick();
  app.get('cutout-view').click();
  for(let i=0;i<20&&app.ui.state().activeView!=='cutout';i++) await new Promise(resolve=>setTimeout(resolve,50));
  assert.equal(calls,2,'the same explicit job is polled until the server returns its saved cutout');
  assert.equal(app.get('cutout-image').src,'/history-media/'+'e'.repeat(64)+'.png');
});

test('history SAM completion during a temporary preview updates the committed media snapshot without replacing the hover', async () => {
  const selected={id:'committed-cutout',year:100,title:'Committed scene',sceneRef:'/event-scenes/'+'a'.repeat(64)+'.png'};
  const hovered={id:'temporary-cutout-hover',year:200,title:'Hovered sibling',heroRef:{status:'complete',url:'/runs/hover-run/hero.png'}};
  const history={id:'cutout-race-history',events:[selected,hovered],suggestions:[],suggestionWindows:[]};
  const question={id:'cutout-race-question',title:'Question',histories:[history]};
  let finish;
  const pending=new Promise(resolve=>{finish=()=>resolve(Response.json({status:'complete',url:'/history-media/'+'f'.repeat(64)+'.png',attached:true}));});
  const app=harness({},async url=>{assert.equal(url,'/api/history/cutout');return pending;},false,'',undefined,undefined,true,undefined,undefined,undefined,undefined,undefined,async url=>{
    if(url==='/api/history/preferences') return Response.json({autoSuggest:false});
    if(url.startsWith('/api/histories?')) return Response.json({questions:[question]});
    return null;
  });
  await tick(); app.ui.setHistoryContextForTest({questionId:question.id,historyId:history.id,eventId:selected.id,date:100});
  for(let i=0;i<10&&!app.ui.state().history.history;i++) await tick();
  app.get('cutout-view').click(); await tick();
  assert.equal(app.posts.length,1);
  app.ui.previewGlobe({id:hovered.id,historyId:history.id,visualKind:'history-event'});
  finish(); await tick(); await tick();
  assert.equal(app.get('hero-title').textContent,'200 CE · Hovered sibling','the SAM response does not replace the active hover');
  assert.equal(app.get('hero-image').src,hovered.heroRef.url);
  app.ui.previewGlobe(null); await new Promise(resolve=>setTimeout(resolve,250));
  assert.equal(app.get('hero-title').textContent,'100 CE · Committed scene');
  assert.equal(app.get('cutout-image').src,'/history-media/'+'f'.repeat(64)+'.png');
  assert.equal(app.ui.state().activeView,'cutout','the explicit cutout intent is restored after the hover ends');
  assert.equal(app.ui.state().history.selectedEventId,selected.id);
  assert.equal(app.posts.length,1);
});

test('unattached SAM results are reconciled from the canonical history before display', async () => {
  const event={id:'canonical-cutout',year:80,title:'Canonical scene',sceneRef:'/event-scenes/'+'a'.repeat(64)+'.png'};
  const history={id:'canonical-cutout-history',events:[event],suggestions:[],suggestionWindows:[]};
  const question={id:'canonical-cutout-question',title:'Question',histories:[history]};
  let attached=false;
  const canonicalUrl='/event-cutouts/'+'e'.repeat(64)+'.png';
  const app=harness({},async()=>{attached=true;return Response.json({status:'complete',url:'/history-media/'+'f'.repeat(64)+'.png',attached:false});},false,'',undefined,undefined,true,undefined,undefined,undefined,undefined,undefined,async url=>{
    if(url==='/api/history/preferences') return Response.json({autoSuggest:false});
    if(url.startsWith('/api/histories?')) {
      const record=attached?{...event,cutoutRef:canonicalUrl}:event;
      return Response.json({questions:[{...question,histories:[{...history,events:[record]}]}]});
    }
    return null;
  });
  await tick(); app.ui.setHistoryContextForTest({questionId:question.id,historyId:history.id,eventId:event.id,date:80});
  for(let i=0;i<10&&!app.ui.state().history.history;i++) await tick();
  app.get('cutout-view').click(); for(let i=0;i<10&&app.ui.state().activeView!=='cutout';i++) await tick();
  assert.equal(app.get('cutout-image').src,canonicalUrl,'the sheet only shows the canonical persisted cutout URL');
});

test('unknown history scene offers one explicit retry with a receipt and visible possible-charge copy', async () => {
  const retryOf='c'.repeat(64), event={id:'uncertain-scene',year:100,title:'Uncertain scene',sceneRef:{status:'unknown',retryOf}};
  const history={id:'uncertain-history',events:[event],suggestions:[],suggestionWindows:[]};
  const question={id:'uncertain-question',title:'Question',histories:[history]};
  const app=harness({},async(url,options)=>{
    assert.equal(url,'/api/history/scene');
    assert.deepEqual(JSON.parse(options.body),{questionId:question.id,historyId:history.id,eventId:event.id,retryOf});
    return Response.json({status:'complete',url:'/history-media/'+'d'.repeat(64)+'.png',attached:true});
  },false,'',undefined,undefined,false,undefined,undefined,undefined,undefined,undefined,async url=>{
    if(url==='/api/history/preferences') return Response.json({autoSuggest:false});
    if(url.startsWith('/api/histories?')) return Response.json({questions:[question]});
    return null;
  });
  await tick(); app.ui.setHistoryContextForTest({questionId:question.id,historyId:history.id,eventId:event.id,date:100});
  for(let i=0;i<10&&!app.ui.state().history.history;i++) await tick();
  assert.equal(app.posts.length,0,'uncertain reservations are never auto-retried');
  assert.equal(app.get('event-scene-action').textContent,'Try new scene');
  assert.match(app.get('view-status').textContent,/may already have incurred a charge.*may incur another charge/i);
  app.get('event-scene-action').click(); await tick(); await tick();
  assert.equal(app.posts.length,1,'one explicit action starts the new attempt');
  assert.match(app.get('hero-image').src,/^\/history-media\//);
});

test('a persisted empty SAM result exposes Try SAM again with the canonical retry receipt', async () => {
  const retryOf='b'.repeat(64), event={id:'empty-cutout-event',year:1883,title:'Saved oak trunk',sceneRef:'/event-scenes/'+'a'.repeat(64)+'.png',cutoutRef:{status:'empty',retryOf}};
  const history={id:'empty-cutout-history',events:[event],suggestions:[],suggestionWindows:[]};
  const question={id:'empty-cutout-question',title:'Question',histories:[history]};
  const app=harness({},async(url,options)=>{
    assert.equal(url,'/api/history/cutout');
    assert.deepEqual(JSON.parse(options.body),{questionId:question.id,historyId:history.id,eventId:event.id,retryOf});
    return Response.json({status:'complete',url:'/history-media/'+'c'.repeat(64)+'.png',attached:true});
  },false,'',undefined,undefined,true,undefined,undefined,undefined,undefined,undefined,async url=>{
    if(url==='/api/history/preferences') return Response.json({autoSuggest:false});
    if(url.startsWith('/api/histories?')) return Response.json({questions:[question]});
    return null;
  });
  await tick(); app.ui.setHistoryContextForTest({questionId:question.id,historyId:history.id,eventId:event.id,date:1883});
  for(let i=0;i<10&&!app.ui.state().history.history;i++) await tick();
  assert.equal(app.posts.length,0,'the saved empty receipt does not retry automatically');
  assert.equal(app.get('cutout-view').textContent,'Try SAM again');
  assert.match(app.get('view-status').textContent,/found no usable subject/i);
  app.get('cutout-view').click(); for(let i=0;i<10&&app.ui.state().activeView!=='cutout';i++) await tick();
  assert.equal(app.posts.length,1);
  assert.equal(app.get('cutout-image').src,'/history-media/'+'c'.repeat(64)+'.png');
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
    ? Response.json({status:'ok',metaKeyConfigured:true,localHistoryAccess:true,localReviewAccess:true,voiceEnabled:true,expansionLimit:20,expansionUsed:0})
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

test('view-tab arrow navigation skips the hidden 3D tab when a story has no saved model', async () => {
  const root=run('no-model-tabs'); root.assets=['hero.png'];
  const app=harness({[root.id]:root});
  await tick(); await app.ui.loadRun(root.id,{animate:false}); app.ui.selectBranch(root.branch.branches[0]);
  assert.equal(app.get('model-button').hidden,true);
  assert.equal(app.get('model-button').disabled,false,'ordinary story controls may leave a hidden model tab enabled internally');
  app.get('cutout-view').focus();
  let prevented=false;
  app.get('[role="tablist"]').dispatchWithTarget('keydown',app.get('cutout-view'),{key:'ArrowRight',preventDefault(){prevented=true;}});
  assert.equal(prevented,true);
  assert.equal(app.get('scene-view').focused,true,'ArrowRight wraps to the next visible tab instead of focusing the hidden model action');
  assert.equal(app.get('scene-view').getAttribute('aria-selected'),'true');
});

test('mobile new-exploration draft uses a full-width scrollable drawer without timeline or atlas controls', () => {
  const css=readFileSync(new URL('../web/style.css',import.meta.url),'utf8');
  assert.match(css,/body\.invitation-open:has\(#atlas-scene\[data-atlas-level\]\) \.exploration-rail\{position:fixed!important;top:118px!important;right:8px!important;bottom:8px!important;left:8px!important;display:block!important;width:auto!important/);
  assert.match(css,/body\.invitation-open:has\(#atlas-scene\[data-atlas-level\]\) \.exploration-rail>#invitation\{position:absolute!important;inset:0!important;display:block!important;[^}]*overflow:auto!important/);
  assert.match(css,/body\.invitation-open:has\(#atlas-scene\[data-atlas-level\]\) \.exploration-rail>#exploration-tree,[\s\S]*?#history-timebar-host\{display:none!important\}/);
  assert.match(css,/body\.invitation-open\.has-story:has\(#atlas-scene\[data-atlas-level\]\) \.cancel-new-exploration\{position:sticky;top:0/);
});
