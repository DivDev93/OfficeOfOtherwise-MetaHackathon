import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFileSync } from 'node:fs';
import { continuationAction, causalEdges, createNavigationGuard, eventIdFromHash, runIdFromHash, replayLabel } from '../web/logic.js';
import * as logic from '../web/logic.js';
import * as geographyTexture from '../web/geographyTexture.js';
import { REGIONS, GEOGRAPHY_STYLES } from '../web/geographyRegions.js';

const branch = (id, title, year = 500) => ({ id, title, year, summary: `${title} changes this world.`, place: { name: title, lat: 20, lon: year / 100 } });
const choice = branch('a', 'Open observatory');
const next = branch('b', 'Ocean observatories', 600);
const run = (id, selected = choice, continuation = {}) => ({ id, branch: { status: 'ok', divergence: `What if ${id}?`, branches: [selected], hero: { branchId: selected.id } }, continuation: { rootRunId: id, path: [], children: [], ...continuation } });

test('continuation actions reopen completed children without access, and lock incomplete/duplicate generation', () => {
  assert.deepEqual(continuationAction({ runId: 'root', branchId: 'a', mode: 'replay-only', children: [{ branchId: 'a', runId: 'child', status: 'complete' }] }), { type: 'open', runId: 'child' });
  assert.equal(continuationAction({ runId: 'root', branchId: 'a', mode: 'live-enabled', access: true }).type, 'generate');
  assert.equal(continuationAction({ runId: 'run-at-limit', branchId: 'a', path: Array(6), mode: 'live-enabled', access: true }).type, 'limit');
  assert.match(continuationAction({ runId: 'run-at-limit', branchId: 'a', path: Array(6), mode: 'live-enabled', access: true }).message, /six-step.*return to an earlier world/i);
  assert.deepEqual(continuationAction({ runId: 'run-at-limit', branchId: 'a', path: Array(6), children: [{ branchId: 'a', runId: 'saved-child', status: 'complete' }] }), { type: 'open', runId: 'saved-child' }, 'a saved descendant remains openable at the limit');
  assert.equal(continuationAction({ runId: 'run-before-limit', branchId: 'a', path: Array(5), mode: 'live-enabled', access: true }).type, 'generate', 'the sixth selected event is still allowed');
  assert.equal(continuationAction({ runId: 'root', branchId: 'a', mode: 'replay-only', access: true }).type, 'unavailable');
  assert.match(continuationAction({ runId: 'root', branchId: 'a', mode: 'replay-only' }).message, /running locally with your own Meta API key/i);
  assert.doesNotMatch(continuationAction({ runId: 'root', branchId: 'a', mode: 'replay-only' }).message, /access code/i);
  assert.match(continuationAction({ runId: 'root', branchId: 'a', mode: 'live-enabled', access: false }).message, /access code for live generation/i);
  assert.equal(continuationAction({ runId: 'root', branchId: 'a', mode: 'live-enabled', access: true, busy: true }).type, 'wait');
  assert.equal(continuationAction({ children: [{ branchId: 'a', runId: 'child', status: 'failed' }], branchId: 'a', mode: 'live-enabled', access: true }).type, 'unavailable');
});

test('six-step terminal keeps the selected scene, alternatives, and ancestor path while skipping another continuation', async () => {
  const alternative = branch('alt', 'Study another path', 700);
  const root = run('at-limit', choice, { path: Array.from({ length: 6 }, (_, index) => ({ runId:`ancestor-${index}`, branchId:`choice-${index}`, title:`Earlier path ${index + 1}`, year:400 + index })) });
  root.branch.branches.push(alternative); root.assets = ['hero.png'];
  const app = harness({ 'at-limit': root }, undefined, false);
  app.get('access').value = 'fixture-access';
  await tick();
  await app.ui.loadRun('at-limit', { animate:false, autoConsequences:false });
  app.ui.activateBranch(choice);
  for (let index = 0; index < 12; index++) await tick();
  assert.equal(app.posts.some(post => post.url === '/api/continue'), false, 'the known terminal state does not make a doomed continuation request');
  assert.equal(app.get('hero-image').src, '/runs/at-limit/hero.png', 'the selected event keeps its own saved scene');
  assert.equal(app.get('branch-list').children.length, 2, 'alternative events remain selectable');
  assert.match(textContentDeep(app.get('event-progress')), /six-step continuation limit.*return to an earlier world/i);
  assert.equal(app.get('branch-list').children[0].children[0].textContent, 'Step limit reached');
  assert.equal(app.get('world-navigation').hidden, false);
  assert.equal(app.get('world-path').children.filter((_, index) => index < 12 && index % 2 === 0).length, 6, 'all earlier choices remain available for backtracking');
});

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

function element() {
  const classes = new Set(), attributes = new Map(), listeners = new Map();
  return { children: [], value: '', hidden: false, textContent: '', dataset: {}, style: {}, classList: { add(...names) { names.forEach(name => classes.add(name)); }, remove(...names) { names.forEach(name => classes.delete(name)); }, contains(name) { return classes.has(name); }, toggle(name, enabled = !classes.has(name)) { enabled ? classes.add(name) : classes.delete(name); return enabled; } },
    append(...nodes) { this.children.push(...nodes); }, replaceChildren(...nodes) { this.children = nodes; }, add(node) { this.children.push(node); },
    setAttribute(key, value) { attributes.set(key, value); }, getAttribute(key) { return attributes.get(key); }, addEventListener(type, callback) { listeners.set(type, callback); }, click() { return listeners.get('click')?.({target:this}); }, keydown(key) { const event = {key,preventDefault(){this.prevented=true;},stopPropagation(){}}; listeners.get('keydown')?.(event); return event; }, matches(selector) { return selector === ':popover-open' && !!this.popoverOpen; }, hidePopover() { this.popoverOpen = false; this.hidePopoverCalls = (this.hidePopoverCalls || 0) + 1; }, scrollIntoView() {}, focus() { this.focused = true; },
    querySelector() { return this.copy ||= element(); }, querySelectorAll() { return this.children.filter(child => child.dataset?.branchId); }, removeAttribute(key) { attributes.delete(key); } };
}
const textContentDeep = node => `${node?.textContent || ''}${(node?.children || []).map(textContentDeep).join('')}`;
const findNode = (node, predicate) => predicate(node) ? node : (node?.children || []).map(child => findNode(child, predicate)).find(Boolean) || null;
function harness(fixtures, onPost = async () => { throw new Error('Unexpected generation'); }, replayOnly = false, initialHash = '', onArchive = () => Response.json({ runs: [] }), onHistory = () => Response.json({runs: []}), localReview = false, onScene = () => Response.json({status:'missing'}), onCutout = () => Response.json({status:'missing'}), scheduleTimer = setTimeout, cancelTimer = clearTimeout, onHead = null, onGet = null) {
  const nodes = new Map(), get = id => { if (!nodes.has(id)) { const node = element(); if (id === 'root-generation-status') { node.hidden = true; node.setAttribute('role','status'); node.setAttribute('aria-live','polite'); } nodes.set(id, node); } return nodes.get(id); };
  const documentListeners = new Map(), document = { getElementById:get, createElement:element, createTextNode:text => ({ textContent:text }), querySelector:get, querySelectorAll:() => [], body:element(), addEventListener(type, callback) { documentListeners.set(type, callback); }, keydown(key) { const event = {key,preventDefault(){this.prevented=true;},stopPropagation(){}}; documentListeners.get('keydown')?.(event); return event; } };
  const windowListeners = new Map(), window = { addEventListener(type, callback) { const callbacks = windowListeners.get(type) || []; callbacks.push(callback); windowListeners.set(type, callbacks); }, dispatch(type) { for (const callback of windowListeners.get(type) || []) callback(); } };
  const posts = [], gets = [], heads = [], storage = new Map(), location = { hash: initialHash, pathname: '/', search: '' };
  const fetch = async (url, options = {}) => {
    if (options.method === 'HEAD') { heads.push(url); if (onHead) return onHead(url); const parts = url.split('/'); return new Response('', { status: fixtures[parts[2]]?.assets?.includes(parts[3]) ? 200 : 404 }); }
    if (options.method === 'POST') { posts.push({ url, body: JSON.parse(options.body) }); return onPost(url, options); }
    gets.push(url);
    if (onGet) { const override = await onGet(url); if (override) return override; }
    if (url.startsWith('/api/event-scene?')) return onScene(url);
    if (url.startsWith('/api/event-cutout?')) return onCutout(url);
    if (url === '/health') return Response.json({ status: 'ok', replayOnly, ...(localReview ? { localReviewAccess: true } : {}) });
    if (url === '/runs') return onArchive();
    if (url === '/api/history') return onHistory();
    const match = url.match(/^\/runs\/([^/]+)(?:\/(.*))?$/);
    const fixture = fixtures[match?.[1]];
    if (!fixture) return new Response('', { status: 404 });
    return Response.json(match[2] === 'branch.json' ? fixture.branch : match[2] === 'trace.json' ? { steps: [] } : fixture);
  };
  const context = vm.createContext({ ...logic, ...geographyTexture, REGIONS, GEOGRAPHY_STYLES, console, fetch, AbortController, TextDecoder, Uint8Array, URLSearchParams, setTimeout:scheduleTimer, clearTimeout:cancelTimer,
    createStarMap(container, options) { context.starMap = { container, options, nodes: options.nodes, selectedId: options.selectedId, setData(data) { this.nodes = data.nodes; this.selectedId = data.selectedId; }, select(id) { this.options.onSelect(this.nodes.find(node => node.id === id) || id); }, destroy() {} }; return context.starMap; },
    createVoiceInput: () => ({ cancel() {}, setEnabled() {} }),
    document,
    matchMedia: () => ({ matches: false, addEventListener() {} }), window,
    location, history: { pushState(a, b, target) { location.hash = target.includes('#') ? target.slice(target.indexOf('#')) : ''; } },
    localStorage: { getItem: key => storage.get(key), setItem: (key, value) => storage.set(key, value) }, Option: function(text, value) { return { text, value }; },
  });
  const source = readFileSync(new URL('../web/app.js', import.meta.url), 'utf8').replace(/^import .*;\r?\n/gm, '').replace("import('./visuals.js')", "Promise.reject(new Error('No renderer in fixture'))");
  vm.runInContext(`${source}\n globalThis.ui = {loadRun,selectBranch,activateBranch,expandBranch,runPrompt,setView,setSurfaceMode,refreshHistory,toggleArchiveHistory, setGlobe:api=>{globeApi=api;renderGeography();}, setModelApi:api=>{modelApi=api;}, state:()=>({currentRunId,continuation,streamBusy,selectedContext,hasImage,activeView,surfaceGeography,surfaceMode,hasStory:document.body.classList.contains('has-story'),starMapNodes})};`, context);
  return { ui: context.ui, get, posts, gets, heads, storage, location, starMap: context.starMap, document, window, navigate(hash, ...events) { location.hash = hash; for (const event of events) window.dispatch(event); } };
}
const tick = () => new Promise(resolve => setImmediate(resolve));
const complete = fixture => new Response(`event: complete\ndata: ${JSON.stringify({ runId: fixture.id, branch: fixture.branch, continuation: fixture.continuation })}\n\n`, { headers: { 'content-type': 'text/event-stream' } });

test('geography follows saved selection, survives pending continuation, toggles, and clears on legacy navigation despite late bytes', async () => {
  const condition = { id:'green-sahara',region:'sahara',kind:'vegetation',intensity:0.8,assumption:'Green landscape persists.',uncertainty:'Extent is illustrative.' };
  const parentChoice = {...choice,geography:{version:1,changes:[condition]}};
  const root = run('geo-root',parentChoice), legacy = run('legacy',next), future = run('future',{...next,geography:parentChoice.geography});
  let release; const pendingResponse = new Promise(resolve=>{release=resolve;});
  const app = harness({'geo-root':root,legacy,future},()=>pendingResponse); await tick();
  const surfaces=[];
  app.ui.setGlobe({setGeography:(state,mode)=>surfaces.push({state,mode}),setBranches(){},select(){},focus(){}});
  await app.ui.loadRun('geo-root',{animate:false,autoConsequences:false});
  assert.equal(surfaces.at(-1).state.changes[0].id,'green-sahara');
  app.ui.setSurfaceMode('present'); assert.equal(surfaces.at(-1).mode,'present');
  app.ui.setSurfaceMode('scenario'); assert.equal(surfaces.at(-1).mode,'scenario');
  app.get('access').value='fixture-only';
  const pending = app.ui.expandBranch(parentChoice);
  assert.equal(surfaces.at(-1).state.changes[0].id,'green-sahara');
  assert.equal(app.ui.state().continuation.path[0].geography.changes[0].id,'green-sahara');
  await app.ui.loadRun('legacy',{animate:false});
  assert.equal(surfaces.at(-1).state,undefined); assert.equal(surfaces.at(-1).mode,'present');
  release(complete(future)); await pending;
  assert.equal(surfaces.at(-1).state,undefined);
  assert.match(app.get('geography-status').textContent,/no scenario geography recorded/);
});

test('fresh reload without access learns the opened world title and retains it when archive arrives later', async () => {
  const child = run('child', next, { rootRunId: 'root', parentRunId: 'root', parentBranchId: 'a', path: [{ runId: 'root', branchId: 'a', ...choice }] });
  child.title = next.title;
  let release;
  const archive = new Promise(resolve => { release = resolve; });
  const app = harness({ child }, undefined, true, '#run=child', () => archive);
  await tick();
  const currentLabel = () => app.get('runs').children.find(option => option.value === 'child')?.text;
  assert.match(currentLabel(), /600 CE · Ocean observatories/);
  assert.match(currentLabel(), /^↳ /, 'the manifest supplies parent metadata too');
  release(Response.json({ runs: [] })); await tick();
  assert.match(currentLabel(), /600 CE · Ocean observatories/, 'slow ID-only history cannot overwrite known metadata');
  assert.equal(app.get('runs').value, 'child');
  assert.equal(app.get('access').value, ''); assert.equal(app.posts.length, 0);
  assert.equal(app.gets.filter(url => url === '/runs/child').length, 1, 'reuse the manifest already needed to open this world');
  assert.equal(app.gets.includes('/api/history'), false);
  assert.deepEqual(JSON.parse(app.storage.get('otherwise-run-history')), ['child'], 'local history continues to store IDs only');

  const fastArchive = harness({ child }, undefined, true); await tick();
  await fastArchive.ui.loadRun('child', { animate: false });
  assert.match(fastArchive.get('runs').children.find(option => option.value === 'child').text, /600 CE · Ocean observatories/, 'opening after archive completion also updates the selector');
});

test('saved descendants inherit omitted geography from ancestry but invalid explicit geography stays unsupported', async () => {
  const geography = {version:1,changes:[{id:'sahara-green',region:'sahara',kind:'vegetation',intensity:0.7,assumption:'Green Sahara persists.',uncertainty:'Regional extent is illustrative.'}]};
  const path = [{runId:'earlier',branchId:choice.id,...choice,geography}];
  const inherited = run('inherited',next,{rootRunId:'earlier',parentRunId:'earlier',path});
  const invalid = run('invalid',{...next,geography:{version:1,changes:[{region:'unknown'}]}},{rootRunId:'earlier',path});
  const app = harness({inherited,invalid},undefined,true); await tick();
  await app.ui.loadRun('inherited',{animate:false});
  assert.equal(app.ui.state().surfaceGeography.changes[0].id,'sahara-green');
  assert.match(app.get('geography-status').textContent,/illustrative surface change/);
  await app.ui.loadRun('invalid',{animate:false});
  assert.equal(app.ui.state().surfaceGeography,undefined);
  assert.match(app.get('geography-status').textContent,/unsupported/);
});

test('actual UI reopens saved descendants without POST, and restores ancestry from manifest', async () => {
  const child = run('child', next, { rootRunId: 'root', parentRunId: 'root', parentBranchId: 'a', path: [{ runId: 'root', branchId: 'a', ...choice }] });
  const root = run('root', choice, { children: [{ branchId: 'a', runId: 'child', status: 'complete' }] });
  const app = harness({ root, child }, undefined, true); await tick();
  await app.ui.loadRun('root', { animate: false, autoConsequences:false });
  assert.equal(app.posts.length, 0, 'programmatic hero selection is navigation only');
  await app.ui.expandBranch(choice);
  assert.equal(app.ui.state().currentRunId, 'child'); assert.equal(app.posts.length, 0);
  assert.equal(app.ui.state().continuation.path[0].year, 500);
  assert.equal(app.location.hash, '#run=child');
  assert.match(app.storage.get('otherwise-run-history'), /child/);
  assert.equal(app.get('world-back').hidden, false);
});

test('actual UI locks duplicate clicks, clears old assets, and rejects late stream after replay navigation', async () => {
  let release; const waiting = new Promise(resolve => { release = resolve; });
  const root = run('root'), other = run('other', next), child = run('child', next);
  root.assets = ['hero.png'];
  const app = harness({ root, other, child }, async () => waiting); await tick();
  await app.ui.loadRun('root', { animate: false, autoConsequences:false });
  app.get('access').value = 'fixture-only';
  assert.equal(app.ui.state().hasImage, true, 'the parent has a scene that must be cleared');
  const pending = app.ui.expandBranch(choice);
  assert.equal(app.ui.state().streamBusy, true); assert.equal(app.ui.state().hasImage, false);
  assert.equal(app.ui.state().hasStory, true, 'the selected cause stays visible before proposals arrive');
  assert.match(app.get('hero-title').textContent, /Open observatory/);
  await app.ui.expandBranch(choice); assert.equal(app.posts.length, 1);
  await app.ui.loadRun('other', { animate: false });
  release(complete(child)); await pending;
  assert.equal(app.ui.state().currentRunId, 'other'); assert.match(app.get('hero-title').textContent, /Ocean observatories/);
  assert.equal(app.location.hash, '#run=other');
  assert.equal(app.get('live-submit').disabled, false, 'navigating away from an old stream restores Explore');
});

test('late SSE bytes cannot replace a world selected after streaming starts, and hash restores on reload', async () => {
  const root = run('root'), other = run('other', next), child = run('child', next);
  let controller;
  const body = new ReadableStream({ start(stream) { controller = stream; } });
  const app = harness({ root, other, child }, async () => new Response(body), false, '#run=root');
  await tick();
  assert.equal(app.ui.state().currentRunId, 'root', 'the app restores the hash during initialization');
  app.get('access').value = 'fixture-only';
  const pending = app.ui.expandBranch(choice); await tick();
  controller.enqueue(new TextEncoder().encode(`event: propose\ndata: ${JSON.stringify({ pending: true, candidateCount: 3 })}\n\n`)); await tick();
  await app.ui.loadRun('other', { animate: false });
  controller.enqueue(new TextEncoder().encode(`event: complete\ndata: ${JSON.stringify({ runId: 'child', branch: child.branch })}\n\n`)); controller.close();
  await pending;
  assert.equal(app.ui.state().currentRunId, 'other'); assert.equal(app.location.hash, '#run=other');
});

test('fresh Explore root can expand and a new root does not inherit earlier ancestry', async () => {
  const root = run('fresh'), child = run('child', next, { rootRunId: 'fresh', parentRunId: 'fresh', parentBranchId: 'a', path: [{ runId: 'fresh', branchId: 'a', ...choice }] });
  let roots = 0;
  const app = harness({ fresh: root, child }, async (url, options) => {
    if (url === '/api/run') { roots++; return complete(root); }
    if (url === '/api/event-scene') return Response.json({status:'complete',url:'/runs/fresh/event-a.png'});
    assert.deepEqual(JSON.parse(options.body), { runId: 'fresh', branchId: 'a' }); return complete(child);
  }); await tick(); app.get('access').value = 'fixture-only';
  await app.ui.runPrompt('What if observatories spread?');
  assert.equal(app.ui.state().currentRunId, 'fresh');
  await app.ui.expandBranch(choice); assert.equal(app.ui.state().currentRunId, 'child');
  await app.ui.runPrompt('What if a different root?');
  assert.equal(roots, 2); assert.equal(app.ui.state().currentRunId, 'fresh');
  assert.equal(app.ui.state().continuation.path.length, 0);
  assert.ok([...app.storage.values()].every(value => !value.includes('fixture-only')));
});

test('fresh root completion explores the selected hero once and only prefetches immediate child scenes', async () => {
  const root = run('fresh-root', choice); root.assets = ['hero.png'];
  const childHero = branch('b', 'Ocean observatories', 600), childAlt = branch('c', 'Coastal observatories', 650);
  const child = run('child', childHero, {rootRunId:'fresh-root',parentRunId:'fresh-root',parentBranchId:'a',path:[{runId:'fresh-root',branchId:'a',...choice}]});
  child.branch.branches.push(childAlt); child.assets = ['hero.png'];
  const continuationRequests = [];
  const app = harness({[root.id]:root,[child.id]:child}, async (url, options) => {
    if (url === '/api/run') return complete(root);
    if (url === '/api/continue') {
      const body = JSON.parse(options.body); continuationRequests.push([body.runId,body.branchId]);
      return complete(child);
    }
    assert.equal(url, '/api/event-scene');
    const body = JSON.parse(options.body);
    return Response.json({status:'complete',url:`/runs/${body.runId}/event-${body.branchId}.png`});
  }, false, '', undefined, undefined, true, async () => Response.json({status:'missing'}));
  await tick(); app.get('access').value = 'fixture';
  await app.ui.runPrompt('What if observatories spread?');
  for (let i = 0; i < 60 && (!continuationRequests.length || !app.posts.some(post => post.url === '/api/event-scene')); i++) await tick();
  for (let i = 0; i < 12; i++) await tick();
  assert.deepEqual(continuationRequests, [['fresh-root','a']]);
  assert.deepEqual(app.posts.filter(post => post.url === '/api/event-scene').map(post => [post.body.runId,post.body.branchId]), [['child','c']]);
  assert.equal(app.ui.state().currentRunId, 'fresh-root');
  assert.match(app.get('hero-title').textContent, /Open observatory/);
  assert.equal(app.starMap.selectedId, 'fresh-root::a', 'the newly explored event remains the selected root hero');
});

test('fresh root stream exposes accessible stage progress before SSE and clears it on success', async () => {
  const root = run('progress-root', choice); root.assets = ['hero.png'];
  let controller;
  const body = new ReadableStream({start(stream) { controller = stream; }});
  const rootResponse = new Response(body, {headers:{'content-type':'text/event-stream'}});
  const app = harness({[root.id]:root}, async url => url === '/api/run' ? rootResponse : Response.json({status:'uncertain',error:'Fixture ends child generation'}, {status:400}), false, '', undefined, undefined, true);
  await tick(); app.get('access').value = 'fixture';
  const pending = app.ui.runPrompt('What if observatories spread?'); await tick();
  assert.equal(app.get('root-generation-status').hidden, false, 'progress is visible before the first stream event');
  assert.equal(app.get('root-generation-indicator').hidden, false, 'the visible root progress includes an animated indicator');
  assert.equal(app.get('root-generation-status').getAttribute('role'), 'status');
  assert.equal(app.get('root-generation-status').getAttribute('aria-live'), 'polite');
  assert.match(app.get('root-generation-message').textContent, /Checking your question/);
  const send = (event, data) => controller.enqueue(new TextEncoder().encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`));
  send('policy', {allowed:true}); await tick();
  assert.match(app.get('root-generation-message').textContent, /topic policy/);
  send('propose', root.branch); await tick();
  assert.match(app.get('root-generation-message').textContent, /Developing possible futures/);
  send('review', root.branch); await tick();
  assert.match(app.get('root-generation-message').textContent, /Reviewing possible futures/);
  send('complete', {runId:root.id,branch:root.branch}); controller.close(); await pending;
  assert.equal(app.get('root-generation-status').hidden, true, 'successful completion clears the root progress message');
  assert.equal(app.get('root-generation-indicator').hidden, true, 'the root progress animation stops at completion');
});

test('fresh root progress stops for guardrail and transport errors while retaining the terminal message', async () => {
  const terminal = async (id, event, data) => {
    let controller;
    const body = new ReadableStream({start(stream) { controller = stream; }});
    const app = harness({[id]:run(id)}, async () => new Response(body, {headers:{'content-type':'text/event-stream'}}), false, '', undefined, undefined, true);
    await tick(); app.get('access').value = 'fixture';
    const pending = app.ui.runPrompt('What if a question?'); await tick();
    const payload = JSON.stringify(data);
    controller.enqueue(new TextEncoder().encode(`event: ${event}\ndata: ${payload}\n\n`)); controller.close();
    await pending;
    assert.equal(app.get('root-generation-status').hidden, false);
    assert.equal(app.get('root-generation-indicator').hidden, true);
    assert.equal(app.get('root-generation-message').textContent, event === 'complete' ? 'This question needs a reframe' : 'This question could not be completed');
  };
  const blocked = run('blocked-root'); blocked.branch = {status:'blocked',branches:[],hero:{branchId:null}};
  await terminal('blocked-root', 'complete', {runId:'blocked-root',branch:blocked.branch});
  await terminal('error-root', 'error', {message:'This question could not be completed'});
});

test('selecting a prefetched child hero starts its own continuation once', async () => {
  const root = run('root', choice); root.assets = ['hero.png'];
  const child = run('child', next, {rootRunId:'root',parentRunId:'root',parentBranchId:'a',path:[{runId:'root',branchId:'a',...choice}]}); child.assets = ['hero.png'];
  const grandchild = run('grandchild', branch('g','Grandchild',700));
  const app = harness({root,child,grandchild}, async (url, options) => {
    assert.equal(url, '/api/continue');
    const body = JSON.parse(options.body);
    return complete(body.runId === 'root' ? child : grandchild);
  }, false, '', undefined, undefined, false);
  await tick(); app.get('access').value = 'fixture'; await app.ui.loadRun('root', {animate:false});
  app.ui.activateBranch(choice);
  for (let i = 0; i < 24 && !app.get('event-children').children.length; i++) await tick();
  assert.equal(app.get('event-children').children.length, 1);
  await app.get('event-children').children[0].click();
  for (let i = 0; i < 24 && app.posts.filter(post => post.url === '/api/continue').length < 2; i++) await tick();
  assert.deepEqual(app.posts.filter(post => post.url === '/api/continue').map(post => [post.body.runId,post.body.branchId]), [['root','a'],['child','b']]);
  assert.equal(app.ui.state().currentRunId, 'child');
  assert.match(app.get('hero-title').textContent, /Ocean observatories/);
});

test('tree navigation selects the clicked descendant before activation and never expands its unclicked hero', async () => {
  const root = run('root', choice); root.assets = ['hero.png'];
  root.continuation.children = [{branchId:'a',runId:'child',status:'complete'}];
  const childHero = branch('b','Ocean observatories',600), clicked = branch('c','Coastal observatories',650);
  const child = run('child', childHero, {rootRunId:'root',parentRunId:'root',parentBranchId:'a',path:[{runId:'root',branchId:'a',...choice}]});
  child.branch.branches.push(clicked); child.assets = ['hero.png'];
  const grandchild = run('grandchild', branch('g','Tide observatories',700));
  const continuationRequests = [];
  const app = harness({root,child,grandchild}, async (url, options) => {
    if (url === '/api/event-scene') return Response.json({status:'complete',url:'/runs/child/event-c.png'});
    assert.equal(url, '/api/continue');
    const body = JSON.parse(options.body); continuationRequests.push([body.runId,body.branchId]);
    return complete(grandchild);
  }, false, '', undefined, undefined, true, () => Response.json({status:'missing'}));
  await tick(); await app.ui.loadRun('root',{animate:false,autoConsequences:false});
  for(let i=0;i<12;i++) await tick();
  const childRunNode = findNode(app.get('exploration-tree-status'), node => node?.className === 'tree-run' && node.dataset.runId === 'child');
  const clickedNode = findNode(childRunNode, node => node?.className === 'tree-event' && node.dataset.branchId === 'c');
  await clickedNode.click();
  for(let i=0;i<24 && !continuationRequests.length;i++) await tick();
  assert.deepEqual(continuationRequests, [['child','c']]);
  assert.equal(app.ui.state().currentRunId,'child');
  assert.match(app.get('hero-title').textContent,/Coastal observatories/);
});

test('starmap hydrates read-only and explicit event selection preserves run-scoped identity and requests consequences', async () => {
  const root = run('root', choice, { children: [{ branchId: 'a', runId: 'child', status: 'complete' }] });
  root.assets = ['hero.png', 'model.glb'];
  const alternate = branch('alt', 'Mammoth steppe', -4500);
  choice.causalLink = 'A measured shift in seasonal rainfall made year-round observation practical.';
  choice.scene = 'a descriptive prompt, never a preview URL';
  root.branch.branches.push(alternate);
  const reusedId = branch('a', 'Ocean observatories', 600);
  const childAlt = branch('child-alt', 'Coastal observatories', 650);
  const child = run('child', reusedId, { rootRunId:'root', parentRunId:'root', parentBranchId:'a', path:[{runId:'root',branchId:'a',...choice}] });
  child.branch.branches.push(childAlt);
  child.assets = ['hero.png'];
  let appSceneChecks = 0;
  const app = harness({ root, child }, async url => {
    assert.equal(url, '/api/continue');
    return Response.json({status:'uncertain',error:'Fixture stops before generation'}, {status:400});
  }, false, '', undefined, undefined, false, async url => {
    const params = new URL(url, 'http://local.test').searchParams;
    if (params.get('runId') === 'root' && params.get('branchId') === 'alt' && appSceneChecks++ === 0) return Response.json({status:'missing'});
    return Response.json({status:'complete',url:`/runs/${params.get('runId')}/event-${params.get('branchId')}.png`});
  });
  await tick();
  await app.ui.loadRun('root', { animate:false, autoConsequences:false });
  for (let i = 0; i < 8; i++) await tick();
  const rootEvent = app.starMap.nodes.find(node => node.runId === 'root' && node.branchId === 'a');
  const childEvent = app.starMap.nodes.find(node => node.runId === 'child' && node.branchId === 'a');
  const childAltEvent = app.starMap.nodes.find(node => node.runId === 'child' && node.branchId === 'child-alt');
  assert.ok(rootEvent && childEvent, 'the same branch key in separate runs remains two distinct events');
  assert.notEqual(rootEvent.id, childEvent.id);
  assert.equal(childEvent.parentId, rootEvent.id);
  assert.equal(rootEvent.consequencesStatus, 'Saved');
  assert.equal(rootEvent.summary, choice.summary);
  assert.equal(rootEvent.causalLink, choice.causalLink);
  assert.equal(rootEvent.location, choice.place.name, 'map previews receive a location label instead of the branch coordinate object');
  assert.equal(typeof rootEvent.location, 'string');
  assert.equal(rootEvent.scene, '/runs/root/hero.png', 'the preview receives a confirmed local scene URL, not prompt text');
  assert.equal(rootEvent.thumbnail, '/runs/root/hero.png', 'only a manifest-listed local hero asset is used');
  assert.equal(rootEvent.ready, true, 'the saved root hero scene enables the map event');
  const alternateEvent = app.starMap.nodes.find(node => node.runId === 'root' && node.branchId === 'alt');
  assert.equal(alternateEvent.ready, false, 'an event with no confirmed scene stays pending');
  assert.equal(app.starMap.selectedId, rootEvent.id);
  assert.equal(app.heads.filter(url => url.startsWith('/runs/child/') && /model(?:\.meshopt)?\.glb$/.test(url)).length, 0, 'saved graph hydration does not request child models');
  assert.equal(app.posts.length, 0);
  app.starMap.select(rootEvent.id);
  for (let i = 0; i < 8; i++) await tick();
  assert.equal(app.posts.length, 0, 'clicking an event with a saved child reopens its results without generation');
  const globeSelections = [];
  app.ui.setGlobe({ setGeography(){}, setBranches(){}, select(branch){ globeSelections.push(branch?.id); } });
  app.ui.activateBranch(alternate);
  for (let i = 0; i < 8; i++) await tick();
  const sceneReadyAlternate = app.starMap.nodes.find(node => node.runId === 'root' && node.branchId === 'alt');
  assert.equal(sceneReadyAlternate.ready, true, 'a confirmed local scene enables selection even before consequences are ready');
  assert.equal(sceneReadyAlternate.consequencesStatus, 'Needs live access');
  assert.equal(app.posts.length, 0, 'scene lookup without access does not generate consequences');
  app.get('exploration-map-panel').popoverOpen = true;
  app.starMap.select(childAltEvent.id);
  assert.equal(app.get('exploration-map-panel').popoverOpen, true, 'node selection itself leaves the map open');
  const escape = app.document.keydown('Escape');
  assert.equal(escape.prevented, true);
  assert.equal(app.get('exploration-map-panel').popoverOpen, false, 'Escape closes the map during asynchronous run navigation');
  for (let i = 0; i < 8; i++) await tick();
  assert.equal(app.ui.state().currentRunId, 'child');
  assert.equal(app.starMap.selectedId, childAltEvent.id, 'navigation restores the exact nonhero selected event identity');
  assert.equal(app.get('hero-title').textContent.includes('Coastal observatories'), true, 'the auto-selected child hero never replaces the requested map event');
  assert.equal(app.get('exploration-map-panel').popoverOpen, false, 'late navigation and graph refresh work cannot reopen an explicitly closed map');
  assert.equal(globeSelections.at(-1), 'child-alt', 'the underlying globe follows the exact map-selected event');
  assert.equal(app.posts.length, 0, 'read-only graph hydration and no-access selection make no generation request');
  app.get('access').value = 'fixture';
  app.starMap.select(childAltEvent.id);
  for (let i = 0; i < 12 && app.posts.length === 0; i++) await tick();
  assert.deepEqual(app.posts.map(post => [post.url, post.body.runId, post.body.branchId]), [['/api/continue','child','child-alt']], 'an explicit event selection starts consequence lookup for that exact run and branch');
});

test('starmap confirms durable nonhero scenes with bounded read-only checks after restart', async () => {
  const root = run('restart-root', choice);
  const alternate = branch('alt', 'Mammoth steppe', -4500);
  root.branch.branches.push(alternate);
  root.assets = ['hero.png'];
  const sceneChecks = [];
  const savedSceneUrl = `/event-scenes/${'a'.repeat(64)}.png`;
  const app = harness({'restart-root':root}, async () => { assert.fail('Saved-scene hydration must not generate'); }, false, '', undefined, undefined, false, async url => {
    const params = new URL(url, 'http://local.test').searchParams;
    sceneChecks.push([params.get('runId'), params.get('branchId')]);
    return params.get('branchId') === 'alt'
      ? Response.json({status:'complete',url:savedSceneUrl})
      : Response.json({status:'missing'});
  });
  await tick(); await app.ui.loadRun('restart-root', {animate:false,autoConsequences:false});
  for (let i = 0; i < 16 && !app.starMap.nodes.some(node => node.branchId === 'alt' && node.ready); i++) await tick();
  const restored = app.starMap.nodes.find(node => node.runId === 'restart-root' && node.branchId === 'alt');
  assert.equal(restored.ready, true);
  assert.equal(restored.thumbnail, savedSceneUrl, 'the server-confirmed hashed event-scene route is accepted as local');
  assert.equal(restored.status, 'Scene ready');
  assert.deepEqual(sceneChecks, [['restart-root','alt']], 'each nonhero event is checked once per page session');
  app.ui.selectBranch(choice);
  for (let i = 0; i < 8; i++) await tick();
  assert.deepEqual(sceneChecks, [['restart-root','alt']], 'rerendering the graph does not repeat saved-scene checks');
  assert.equal(app.posts.length, 0, 'graph hydration performs read-only scene checks');
});

test('pending read-only scene checks do not occupy the user event-job workers', async () => {
  const root = run('root', choice);
  root.assets = ['hero.png'];
  for (let index = 0; index < 4; index++) root.branch.branches.push(branch(`unready-${index}`, `Unready path ${index}`, 700 + index));
  let releaseChecks;
  const checksPending = new Promise(resolve => { releaseChecks = resolve; });
  const app = harness({root}, async url => {
    assert.equal(url, '/api/continue');
    return Response.json({status:'uncertain',error:'Fixture stops before generation'}, {status:400});
  }, false, '', undefined, undefined, false, () => checksPending);
  await tick();
  app.get('access').value = 'fixture';
  await app.ui.loadRun('root', {animate:false, autoConsequences:false});
  for (let index = 0; index < 8; index++) await tick();
  assert.equal(app.gets.filter(url => url.startsWith('/api/event-scene?')).length, 3, 'saved-scene hydration is independently capped at three read-only checks');
  app.ui.activateBranch(choice);
  for (let index = 0; index < 8 && app.posts.length === 0; index++) await tick();
  assert.equal(app.posts.length, 1, 'the selected event continuation runs while all three scene-check workers are waiting');
  releaseChecks(Response.json({status:'missing'}));
  for (let index = 0; index < 8; index++) await tick();
});

test('continuation scenes keep the atlas available after cutout/complete and retain a manually chosen view', async () => {
  const root = run('root'), child = run('child', next, { rootRunId: 'root', parentRunId: 'root', parentBranchId: 'a', path: [{ runId: 'root', branchId: 'a', ...choice }] });
  child.assets = ['hero.png', 'cutout.png', 'model.glb'];
  let controller;
  const app = harness({ root, child }, async () => new Response(new ReadableStream({ start(stream) { controller = stream; } })));
  await tick();
  await app.ui.loadRun('root', { animate: false, autoConsequences:false });
  app.get('access').value = 'fixture-only';
  const pending = app.ui.expandBranch(choice); await tick();
  const send = (type, data) => controller.enqueue(new TextEncoder().encode(`event: ${type}\ndata: ${JSON.stringify(data)}\n\n`));
  send('cutout', { runId: 'child', status: 'ok' }); await tick();
  assert.equal(app.ui.state().activeView, 'scene', 'automatic cutout arrival keeps the atlas visible');
  assert.equal(app.get('workspace').classList.contains('hero-focus'), false);
  send('complete', { runId: 'child', branch: child.branch, continuation: child.continuation }); controller.close(); await pending;
  assert.equal(app.ui.state().activeView, 'scene', 'complete with 3D available keeps the continuation in Scene');
  assert.equal(app.get('branch-list').children.length, 1);
  assert.equal(app.get('branch-list').children[0].disabled, false, 'descendants can be followed immediately');

  // Open the parent again, then explicitly choose the cutout while its descendant streams.
  app.get('access').value = '';
  await app.ui.loadRun('root', { animate: false, autoConsequences:false });
  app.get('access').value = 'fixture-only';
  const manual = app.ui.expandBranch(choice); await tick();
  send('cutout', { runId: 'child', status: 'ok' }); await tick();
  app.ui.setView('cutout', true);
  send('complete', { runId: 'child', branch: child.branch, continuation: child.continuation }); controller.close(); await manual;
  assert.equal(app.ui.state().activeView, 'cutout', 'a manual view choice survives subsequent stream assets');
});

test('geography roots keep Scene through streamed assets and respect manual cutout selection', async () => {
  const geography = {version:1,changes:[{id:'green-sahara',region:'sahara',kind:'vegetation',intensity:0.8,assumption:'A green Sahara persists.',uncertainty:'Extent is approximate.'}]};
  const root = run('geo-root',{...choice,geography}); root.assets = ['hero.png','cutout.png','model.glb'];
  let controller;
  const app = harness({'geo-root':root},async()=>new Response(new ReadableStream({start(stream){controller=stream;}})));
  await tick(); app.get('access').value='fixture-only';
  const send=(type,data)=>controller.enqueue(new TextEncoder().encode(`event: ${type}\ndata: ${JSON.stringify(data)}\n\n`));
  const first=app.ui.runPrompt('What if the Sahara stayed green?'); await tick();
  send('review',root.branch); await tick();
  send('image',{runId:root.id}); await tick(); assert.equal(app.ui.state().activeView,'scene');
  send('cutout',{runId:root.id,status:'ok'}); await tick();
  assert.equal(app.ui.state().activeView,'scene'); assert.equal(app.get('workspace').classList.contains('hero-focus'),false);
  send('complete',{runId:root.id,branch:root.branch}); controller.close(); await first;
  assert.equal(app.ui.state().activeView,'scene');
  const second=app.ui.runPrompt('What if the Sahara stayed green?'); await tick();
  send('review',root.branch); await tick(); send('cutout',{runId:root.id,status:'ok'}); await tick();
  app.ui.setView('cutout',true);
  send('complete',{runId:root.id,branch:root.branch}); controller.close(); await second;
  assert.equal(app.ui.state().activeView,'cutout'); assert.equal(app.get('workspace').classList.contains('hero-focus'),true);
});

test('legacy root asset events retain their existing automatic cutout default', async () => {
  const root=run('legacy-root'); root.assets=['hero.png','cutout.png'];
  const app=harness({'legacy-root':root},async()=>new Response(`event: cutout\ndata: ${JSON.stringify({runId:root.id,status:'ok'})}\n\nevent: complete\ndata: ${JSON.stringify({runId:root.id,branch:root.branch})}\n\n`));
  await tick(); app.get('access').value='fixture-only'; await app.ui.runPrompt('What if observatories flourished?');
  assert.equal(app.ui.state().activeView,'cutout');
});


test('archive defaults to four named cached worlds, keeps remembered IDs private, and reveals named history on request', async () => {
  const cached = ['alexandria', 'beringia', 'green-sahara', 'mechanisms'].map(id => ({ id, title: id, divergence: `What if ${id}?` }));
  const historical = { id: 'uuid-child', title: 'A new settlement', parentRunId: 'green-sahara', divergence: 'What if Sahara stayed green?' };
  const app = harness({}, undefined, false, '', () => Response.json({runs:cached}), () => Response.json({runs:[historical]})); await tick();
  app.storage.set('otherwise-run-history', JSON.stringify(['unknown-uuid', 'uuid-child']));
  await app.ui.refreshHistory();
  assert.deepEqual(app.get('runs').children.map(option => option.value), cached.map(run => run.id));
  assert.ok(app.get('runs').children.every(option => !option.text.includes('Saved world')));
  assert.deepEqual(JSON.parse(app.storage.get('otherwise-run-history')), ['unknown-uuid', 'uuid-child']);
  app.get('access').value = 'local-fixture';
  app.ui.toggleArchiveHistory(); await tick();
  assert.equal(app.get('archive-history-toggle').getAttribute('aria-pressed'), 'true');
  assert.equal(app.get('runs').children.some(option => option.value === 'unknown-uuid'), false);
  assert.match(app.get('runs').children.find(option => option.value === 'uuid-child').text, /A new settlement/);
  app.ui.toggleArchiveHistory();
  assert.equal(app.get('archive-history-toggle').getAttribute('aria-pressed'), 'false');
  assert.equal(app.get('runs').children.some(option => option.value === 'uuid-child'), false);
});


test('local preview opens a continuation without exposing or storing an access code', async () => {
  const root = run('local-root', choice), child = run('local-child', next, {rootRunId:'local-root',parentRunId:'local-root',parentBranchId:'a',path:[{runId:'local-root',branchId:'a',...choice}]});
  const app = harness({'local-root':root,'local-child':child}, async url => {
    if (url === '/api/event-scene') return Response.json({status:'complete',url:'/runs/local-root/event-a.png'});
    return complete(child);
  }, false, '', () => Response.json({runs:[]}), () => Response.json({runs:[]}), true);
  await tick(); await app.ui.loadRun('local-root', {animate:false});
  assert.equal(app.get('access').value,''); assert.equal(app.get('live-access').hidden,true);
  await app.ui.expandBranch(choice);
  for (let i = 0; i < 8; i++) await tick();
  assert.equal(app.posts.filter(post => post.url === '/api/continue').length,1, 'opening the child does not automatically advance its selected event');
  assert.ok(app.posts.some(post => post.url === '/api/event-scene' && post.body.runId === 'local-child'),'the immediate child scene is warmed for its hover preview');
  assert.equal(app.ui.state().currentRunId,'local-child');
  assert.equal(app.get('access').value,''); assert.equal(JSON.stringify([...app.storage.values()]).includes('secret-code'),false);
});


test('selection retains exact event and offers saved children without generation', async () => {
  const alternate = branch('alt', 'Mammoth steppe', -4500);
  const root = run('root'); root.branch.branches.push(alternate); root.assets = ['hero.png', 'cutout.png', 'model.glb'];
  root.continuation.children = [{branchId:'alt',runId:'child',status:'complete'}];
  const child = run('child', next, {rootRunId:'root',parentRunId:'root',parentBranchId:'alt',path:[{runId:'root',branchId:'alt',...alternate}]});
  const app = harness({root,child}, undefined, true, '', undefined, undefined, false, () => Response.json({status:'complete',url:'/runs/root/event-alt.png',reused:true}));
  await tick(); await app.ui.loadRun('root',{animate:false,autoConsequences:false});
  app.ui.activateBranch(alternate); await tick(); await tick();
  assert.equal(app.ui.state().currentRunId,'root');
  assert.match(app.get('hero-title').textContent,/4500 BCE · Mammoth steppe/);
  assert.equal(app.get('hero-image').src,'/runs/root/event-alt.png');
  assert.equal(app.get('model-button').disabled,false);
  app.get('model-button').click();
  assert.match(app.get('view-status').textContent,/not configured/);
  assert.equal(app.get('event-children').children.length,1);
  assert.equal(app.posts.length,0);
  app.get('event-children').children[0].click(); await tick(); await tick(); await tick();
  assert.equal(app.ui.state().currentRunId,'child');
  assert.match(app.get('hero-title').textContent,/Ocean observatories/);
  assert.equal(app.posts.length,0);
});

test('reopening a run restores saved hero consequences in the visible tree without a new request', async () => {
  const root = run('root', choice), child = run('child', next, {rootRunId:'root',parentRunId:'root',parentBranchId:'a',path:[{runId:'root',branchId:'a',...choice}]});
  root.continuation.children = [{branchId:'a',runId:'child',status:'complete'}];
  const app = harness({root, child}, undefined, true);
  await tick(); await app.ui.loadRun('root', {animate:false});
  assert.equal(app.get('event-consequences').hidden, false);
  assert.equal(app.get('event-children').children.length, 1);
  assert.match(app.get('event-children').children[0].textContent, /Ocean observatories/);
  assert.match(textContentDeep(app.get('exploration-tree-status').children[0]), /Open observatory/);
  assert.match(textContentDeep(app.get('exploration-tree-status').children[0]), /Saved/);
  assert.equal(app.posts.length, 0);
});

test('reopening a saved event prefetches only its immediate missing child scenes', async () => {
  const root = run('root', choice); root.assets = ['hero.png'];
  const childHero = branch('b', 'Ocean observatories', 600), childAlt = branch('c', 'Coastal observatories', 650);
  const child = run('child', childHero, {rootRunId:'root',parentRunId:'root',parentBranchId:'a',path:[{runId:'root',branchId:'a',...choice}],children:[{branchId:'c',runId:'grandchild',status:'complete'}]});
  child.branch.branches.push(childAlt); child.assets = ['hero.png'];
  const grandchild = run('grandchild', branch('g', 'Deep sea observatories', 700), {rootRunId:'root',path:[{runId:'root',branchId:'a',...choice},{runId:'child',branchId:'c',...childAlt}]});
  root.continuation.children = [{branchId:'a',runId:'child',status:'complete'}];
  const app = harness({root,child,grandchild}, async (url, options) => {
    assert.equal(url, '/api/event-scene', 'restoring saved consequences only generates scenes');
    const body = JSON.parse(options.body);
    return Response.json({status:'complete',url:`/runs/${body.runId}/event-${body.branchId}.png`});
  }, false, '', undefined, undefined, true, async () => Response.json({status:'missing'}));
  await tick(); await app.ui.loadRun('root', {animate:false,autoConsequences:false});
  for (let i = 0; i < 24 && !app.posts.some(post => post.url === '/api/event-scene'); i++) await tick();
  for (let i = 0; i < 12; i++) await tick();
  assert.deepEqual(app.posts.filter(post => post.url === '/api/event-scene').map(post => [post.body.runId,post.body.branchId]), [['child','c']]);
  assert.equal(app.posts.some(post => post.url === '/api/continue'), false, 'scene warming does not generate another consequence level');
  assert.equal(app.ui.state().currentRunId, 'root');
  assert.match(app.get('hero-title').textContent, /Open observatory/);
  assert.equal(app.starMap.selectedId, 'root::a', 'the selected parent event stays selected while its saved child scenes warm');
});

test('saved descendants in the exploration tree open as navigable worlds without replay generation', async () => {
  const root = run('root', choice), child = run('child', next, {rootRunId:'root',parentRunId:'root',parentBranchId:'a',path:[{runId:'root',branchId:'a',...choice}]});
  root.continuation.children = [{branchId:'a',runId:'child',status:'complete'}];
  const app = harness({root, child}, undefined, true);
  await tick(); await app.ui.loadRun('root', {animate:false});
  for (let i = 0; i < 6; i++) await tick();
  const savedWorld = findNode(app.get('exploration-tree-status'), node => node?.className === 'tree-run' && node.dataset.runId === 'child');
  assert.ok(savedWorld, 'saved descendants are present in the tree');
  const openWorldEvent = findNode(savedWorld, node => node?.dataset?.branchId === 'b');
  assert.equal(typeof openWorldEvent.click, 'function');
  await openWorldEvent.click();
  for (let i = 0; i < 8; i++) await tick();
  assert.equal(app.ui.state().currentRunId, 'child');
  assert.match(app.get('hero-title').textContent, /Ocean observatories/);
  assert.equal(app.posts.length, 0, 'opening saved tree nodes never replays generation');
});

test('opening a descendant keeps the complete saved tree rooted at the original divergence', async () => {
  const root = run('root', choice), child = run('child', next, {rootRunId:'root',parentRunId:'root',parentBranchId:'a',path:[{runId:'root',branchId:'a',...choice}]});
  root.title = 'Root title'; child.title = 'Child title'; root.continuation.children = [{branchId:'a',runId:'child',status:'complete'}];
  const app = harness({root, child}, undefined, true);
  await tick(); await app.ui.loadRun('child', {animate:false});
  for (let i = 0; i < 8; i++) await tick();
  const tree = app.get('exploration-tree-status');
  const rootNode = findNode(tree, node => node?.className === 'tree-run' && node.dataset.runId === 'root');
  const childNode = findNode(tree, node => node?.className === 'tree-run' && node.dataset.runId === 'child');
  assert.ok(rootNode, 'the tree remains rooted at the original run');
  assert.ok(childNode, 'the opened descendant appears under its ancestors');
  assert.match(rootNode.children[0].textContent, /What if root/);
  assert.equal((textContentDeep(tree).match(/What if root\?/g) || []).length, 1, 'the root divergence is shown only once');
  const selectedEvent = findNode(childNode, node => node?.dataset?.branchId === 'b');
  assert.equal(selectedEvent.getAttribute('aria-current'), 'true', 'the current event remains identified within the full tree');
  assert.equal(findNode(tree, node => node?.className === 'tree-run' && node.dataset.runId === 'child').dataset.runId, 'child', 'the child is represented once');
  assert.equal(app.posts.length, 0);
});

test('opening a live run auto-explores its selected hero, while replay mode shows access status', async () => {
  const root = run('root', choice), child = run('child', next, {rootRunId:'root',parentRunId:'root',parentBranchId:'a',path:[{runId:'root',branchId:'a',...choice}]});
  root.assets = ['hero.png'];
  const replay = harness({root}, undefined, true);
  await tick(); await replay.ui.loadRun('root', {animate:false}); await tick(); await tick();
  for (let i = 0; i < 8 && !replay.get('event-progress').textContent; i++) await tick();
  assert.match(replay.get('service-mode').textContent, /run locally with your own Meta API key/i);
  assert.match(replay.get('footer-service-mode').textContent, /run locally with your own Meta API key/i);
  assert.match(textContentDeep(replay.get('exploration-tree-status').children[0]), /Run locally with Meta API key/);
  assert.match(replay.get('event-progress').textContent, /running locally with your own Meta API key/i);
  assert.doesNotMatch(replay.get('event-progress').textContent, /access code/i);
  assert.equal(replay.posts.length, 0);
  await replay.ui.expandBranch(choice);
  assert.match(replay.get('selected-branch-context').textContent, /running locally with your own Meta API key/i);

  const live = harness({root, child}, async (url, options) => {
    if (url === '/api/event-scene') { const body = JSON.parse(options.body); return Response.json({status:'complete',url:`/runs/${body.runId}/event-${body.branchId}.png`}); }
    assert.equal(url, '/api/continue'); return complete(child);
  }, false, '', undefined, undefined, true);
  await tick(); await live.ui.loadRun('root', {animate:false});
  for (let i = 0; i < 8 && !live.posts.some(post => post.url === '/api/continue'); i++) await tick();
  assert.deepEqual(live.posts.filter(post => post.url === '/api/continue').map(post => [post.body.runId,post.body.branchId]), [['root','a']], 'opening a live run explores only its selected hero');
  live.ui.activateBranch(choice);
  for (let i = 0; i < 24 && !live.posts.some(post => post.url === '/api/event-scene' && post.body.runId === 'child'); i++) await tick();
  assert.equal(live.posts.filter(post => post.url === '/api/continue').length, 1);
  assert.ok(live.posts.some(post => post.url === '/api/event-scene' && post.body.runId === 'child'), 'the selected event’s immediate child scene is pre-generated');
  for (let i = 0; i < 8; i++) await tick();
  assert.match(textContentDeep(live.get('exploration-tree-status').children[0]), /Saved/);
  assert.equal(live.get('event-children').children.length, 1);
  assert.doesNotMatch(readFileSync(new URL('../web/index.html', import.meta.url), 'utf8'), /id="follow-selected"/);
});

test('event fragment restores exact selection across reload and back/forward without expanding the wrong hero', async () => {
  const alternate = next;
  const root = run('root', choice);
  root.branch.branches.push(alternate);
  root.assets = ['hero.png'];
  const heroFuture = run('hero-future', next, {rootRunId:'root',parentRunId:'root',parentBranchId:'a',path:[{runId:'root',branchId:'a',...choice}]});
  const alternateFuture = run('alternate-future', choice, {rootRunId:'root',parentRunId:'root',parentBranchId:'b',path:[{runId:'root',branchId:'b',...alternate}]});
  const app = harness({root,'hero-future':heroFuture,'alternate-future':alternateFuture}, async (url, options) => {
    if (url === '/api/event-scene') return Response.json({status:'complete',url:'/scene.png'});
    assert.equal(url, '/api/continue');
    const body = JSON.parse(options.body);
    return complete(body.branchId === 'b' ? alternateFuture : heroFuture);
  }, false, '#run=root&event=b', undefined, undefined, true);
  const continuationCalls = () => app.posts.filter(post => post.url === '/api/continue').map(post => [post.body.runId, post.body.branchId]);
  for (let i = 0; i < 30 && !continuationCalls().length; i++) await tick();
  assert.match(app.get('hero-title').textContent, /Ocean observatories/);
  assert.deepEqual(continuationCalls(), [['root','b']], 'reload follows the exact event in the fragment, not the default hero');
  assert.equal(app.location.hash, '#run=root&event=b');

  app.navigate('#run=root', 'popstate', 'hashchange');
  for (let i = 0; i < 30 && continuationCalls().length < 2; i++) await tick();
  assert.match(app.get('hero-title').textContent, /Open observatory/);
  assert.deepEqual(continuationCalls(), [['root','b'],['root','a']], 'plain run fragments retain the legacy default-hero behavior');

  app.navigate('#run=root&event=b', 'popstate', 'hashchange');
  for (let i = 0; i < 30; i++) await tick();
  assert.match(app.get('hero-title').textContent, /Ocean observatories/);
  assert.deepEqual(continuationCalls(), [['root','b'],['root','a']], 'back/forward restoration does not duplicate or redirect the saved event work');
});

test('saved scene check paints the hash-selected event and clears its spinner without a second click', async () => {
  const alternate = next, root = run('root', choice);
  root.branch.branches.push(alternate); root.assets = ['hero.png'];
  const child = run('child', choice, {rootRunId:'root',parentRunId:'root',parentBranchId:'b',path:[{runId:'root',branchId:'b',...alternate}]});
  const sceneChecks = [];
  const sceneUrl = `/event-scenes/${'a'.repeat(64)}.png`;
  const app = harness({root,child}, async (url, options) => {
    if (url === '/api/continue') return complete(child);
    assert.equal(url, '/api/event-scene');
    return Response.json({status:'complete',url:sceneUrl});
  }, false, '#run=root&event=b', undefined, undefined, true, async url => {
    const query = new URLSearchParams(url.split('?')[1]);
    const identity = [query.get('runId'),query.get('branchId')]; sceneChecks.push(identity);
    return Response.json(identity[0] === 'root' && identity[1] === 'b' ? {status:'complete',url:sceneUrl} : {status:'missing'});
  });
  for (let i = 0; i < 50 && (app.get('hero-image').hidden || !app.get('scene-loading').hidden); i++) await tick();
  assert.match(app.get('hero-title').textContent, /Ocean observatories/);
  assert.ok(sceneChecks.some(([runId,branchId]) => runId === 'root' && branchId === 'b'));
  assert.equal(app.get('hero-image').src, sceneUrl, 'the saved scene is shown for the selected event');
  assert.equal(app.get('hero-image').hidden, false);
  assert.equal(app.get('scene-loading').hidden, true, 'the selected scene spinner clears when the saved image arrives');
  assert.deepEqual(app.posts.filter(post => post.url === '/api/continue').map(post => [post.body.runId,post.body.branchId]), [['root','b']], 'restoration does not dispatch the default hero or sibling continuation');
});

test('a 3D tab choice during saved-asset checks survives their completion without generation calls', async () => {
  const root = run('root', choice); root.assets = ['hero.png','cutout.png','model.glb'];
  let releaseHeads;
  const headGate = new Promise(resolve => { releaseHeads = resolve; });
  const app = harness({root}, undefined, true, '', undefined, undefined, false, undefined, undefined, undefined, undefined, async url => {
    await headGate;
    const [,runId,asset] = url.match(/^\/runs\/([^/]+)\/(.+)$/) || [];
    return new Response('', {status:runId === root.id && root.assets.includes(asset) ? 200 : 404});
  });
  const modelLoads = [];
  app.ui.setModelApi({clear(){},setAutoRotate(){},load(url){modelLoads.push(url); return new Promise(()=>{});}});
  await tick();
  const loading = app.ui.loadRun('root', {animate:false,autoConsequences:false});
  for (let i = 0; i < 30 && app.heads.length < 4; i++) await tick();
  assert.equal(app.heads.length, 4, 'all saved-asset checks are waiting');
  app.ui.selectBranch(choice);
  app.get('model-button').click();
  releaseHeads();
  await loading;
  assert.equal(app.ui.state().activeView, 'model', 'the user’s 3D choice wins when saved assets become available');
  assert.deepEqual(modelLoads, ['/runs/root/model.glb'], 'the selected saved model loads locally once');
  assert.equal(app.posts.length, 0, 'asset inspection and model selection do not call a generation route');
});

test('saved-run navigation keeps the panel shell stable, clears stale imagery, and retains a readable load error', async () => {
  const root = run('root', choice), child = run('child', next);
  root.assets = ['hero.png']; child.assets = ['hero.png'];
  let releaseChild;
  const childGate = new Promise(resolve => { releaseChild = resolve; });
  const app = harness({root,child}, undefined, true, '', undefined, undefined, false, undefined, undefined, undefined, undefined, null, async url => {
    if (url === '/runs/child/branch.json') { await childGate; return Response.json(child.branch); }
    if (url === '/runs/missing/branch.json') return new Response('', {status:404});
    return null;
  });
  await tick(); await app.ui.loadRun('root', {animate:false,autoConsequences:false});
  assert.equal(app.get('hero-image').hidden, false);
  const openingChild = app.ui.loadRun('child', {animate:false,autoConsequences:false});
  assert.equal(app.ui.state().hasStory, true, 'the selected-world panel remains mounted during the pending run fetch');
  assert.equal(app.get('hero-title').textContent, 'Opening saved story…');
  assert.equal(app.get('hero-image').hidden, true, 'the previous world image is hidden immediately');
  releaseChild(); await openingChild;
  assert.equal(app.ui.state().hasStory, true);
  assert.match(app.get('hero-title').textContent, /Ocean observatories/);
  assert.equal(app.get('hero-image').src, '/runs/child/hero.png');
  assert.equal(app.get('hero-image').hidden, false);
  assert.equal(app.posts.length, 0, 'run navigation does not fan out to continuation generation');

  await app.ui.loadRun('missing', {animate:false,autoConsequences:false});
  assert.equal(app.ui.state().hasStory, true, 'the panel stays visible to explain a terminal load error');
  assert.equal(app.get('hero-title').textContent, 'Saved story unavailable');
  assert.match(app.get('stage-empty').querySelector('p').textContent, /Could not load this cached story/);
  assert.equal(app.get('hero-image').hidden, true);
});

test('continuation stream replaces the waiting label with visible stage progress', async () => {
  const root = run('root', choice), future = run('child', next, {rootRunId:'root',parentRunId:'root',parentBranchId:'a',path:[{runId:'root',branchId:'a',...choice}]});
  let streamController;
  const app = harness({root, child:future}, async url => {
    assert.equal(url, '/api/continue');
    return new Response(new ReadableStream({start(controller) { streamController = controller; }}), {headers:{'content-type':'text/event-stream'}});
  }, false, '', undefined, undefined, true, () => Response.json({status:'complete',url:'/scene.png'}));
  await tick(); await app.ui.loadRun('root', {animate:false});
  app.ui.activateBranch(choice);
  for (let i = 0; i < 8 && !streamController; i++) await tick();
  assert.ok(streamController);
  streamController.enqueue(new TextEncoder().encode('event: propose\ndata: {}\n\n'));
  await tick(); await tick();
  assert.match(app.get('event-progress').textContent, /Developing possible futures/);
  assert.equal(app.get('event-loading-indicator').hidden, false);
  streamController.enqueue(new TextEncoder().encode(`event: complete\ndata: ${JSON.stringify({runId:'child',branch:future.branch})}\n\n`));
  streamController.close();
  for (let i = 0; i < 8; i++) await tick();
  assert.equal(app.get('event-children').children.length, 1);
  assert.equal(app.get('event-loading-indicator').hidden, true);
});

test('an in-flight event updates its own tree state after selection changes', async () => {
  const alternate = branch('alt', 'Mammoth steppe', -4500), root = run('root'); root.branch.branches.push(alternate);
  let releaseScene; const pendingScene = new Promise(resolve => { releaseScene = resolve; });
  const app = harness({root}, undefined, false, '', undefined, undefined, false, () => pendingScene);
  await tick(); await app.ui.loadRun('root', {animate:false});
  for (let i = 0; i < 6 && !app.get('event-progress').textContent; i++) await tick();
  app.ui.activateBranch(alternate);
  app.ui.selectBranch(choice);
  releaseScene(Response.json({status:'missing'}));
  for (let i = 0; i < 12; i++) await tick();
  const rootNode = app.get('exploration-tree-status').children[0];
  const altItem = rootNode.children[1].children.find(item => item.children[0]?.dataset?.branchId === 'alt');
  assert.ok(altItem);
  assert.notEqual(altItem.dataset.state, 'queued');
  assert.match(altItem.children[1].textContent, /Needs live access/);
  assert.equal(app.posts.length, 0, 'stale queued work never dispatches generation');
});

test('continuation completion checks child scenes within the cap without expanding child continuations', async () => {
  const root = run('root'); root.assets = ['hero.png'];
  const branches = ['c1', 'c2', 'c3', 'c4'].map((id, index) => branch(id, `Event ${id}`, -4500 - index));
  const child = run('child', branches[0], {rootRunId:'root',parentRunId:'root',parentBranchId:'a',path:[{runId:'root',branchId:'a',...choice}]});
  child.branch.branches.push(...branches.slice(1));
  const grandchildren = [branch('g1','Grandchild one',-3000), branch('g2','Grandchild two',-3001)];
  const grandchild = run('grandchild', grandchildren[0], {rootRunId:'root',parentRunId:'child',parentBranchId:'c1',path:child.continuation.path});
  grandchild.branch.branches.push(grandchildren[1]);
  const pending = new Map();
  const sceneChecks = [];
  const scenePosts = [];
  const continuationChecks = [];
  const app = harness({root,child,grandchild}, async (url, options) => {
    const body = JSON.parse(options.body);
    if (url === '/api/event-scene') {
      scenePosts.push(body.branchId);
      return new Promise(resolve => pending.set(body.branchId, resolve));
    }
    assert.equal(url, '/api/continue');
    continuationChecks.push([body.runId,body.branchId]);
    return complete(body.runId === 'root' ? child : grandchild);
  }, false, '', undefined, undefined, false, url => {
    const id = new URL(url, 'http://local').searchParams.get('branchId');
    sceneChecks.push(id);
    return Response.json({status:'missing'});
  });
  await tick(); app.get('access').value = 'fixture';
  await app.ui.loadRun('root', {animate:false,autoConsequences:false});
  for (let i = 0; i < 8; i++) await tick();
  assert.equal(app.posts.length, 0, 'opening a run does not start a continuation');
  app.ui.activateBranch(choice);
  for (let i = 0; i < 32 && pending.size < 3; i++) await tick();
  assert.deepEqual([...pending.keys()].sort(), ['c1', 'c2', 'c3'], `child event scenes are generated with the shared three-slot cap: ${JSON.stringify({posts:app.posts,gets:app.gets})}`);
  pending.get('c1')(Response.json({status:'complete',url:'/runs/child/event-c1.png'}));
  for (let i = 0; i < 40 && !pending.has('c4'); i++) await tick();
  assert.ok(pending.has('c4'), 'the fourth child scene starts when a worker slot frees');
  for (const resolve of pending.values()) resolve(Response.json({status:'complete',url:'/runs/child/event-scene.png'}));
  for (let i = 0; i < 16; i++) await tick();
  assert.equal(app.posts.filter(post => post.url === '/api/continue').length, 1, 'only the explicitly expanded event generates consequences');
  assert.deepEqual(continuationChecks, [['root','a']]);
  assert.deepEqual(scenePosts.sort(), ['c1','c2','c3','c4'], 'all immediate child scenes are pre-generated, with no descendant continuations');
  assert.equal(app.ui.state().currentRunId, 'root', 'map selection keeps the parent world open while consequences are prepared');
  assert.ok(sceneChecks.includes('c4'), 'the full child scene set was checked for hover previews');
});

test('opening a run leaves its branches untouched until clicked', async () => {
  const alternate = branch('alt','Mammoth steppe',-4500), root = run('root'); root.branch.branches.push(alternate); root.assets = ['hero.png'];
  const child = run('child',next,{rootRunId:'root',parentRunId:'root',parentBranchId:'alt',path:[{runId:'root',branchId:'alt',...alternate}]});
  const grandchild = run('grandchild',branch('g','Grandchild',700));
  const app = harness({root,child,grandchild}, async (url,options) => {
    assert.equal(url,'/api/continue');
    const body = JSON.parse(options.body);
    assert.ok([["root","alt"],["child","b"]].some(([runId,branchId])=>body.runId===runId&&body.branchId===branchId));
    return complete(body.runId === 'root' ? child : grandchild);
  });
  await tick(); app.get('access').value='fixture';
  await app.ui.loadRun('root',{animate:false,autoConsequences:false});
  for(let i=0;i<8;i++) await tick();
  assert.equal(app.posts.length,0,'suppressed run navigation starts no hero prefetch');
  app.ui.activateBranch(alternate);
  for(let i=0;i<12 && !app.posts.some(post=>post.url==='/api/continue');i++) await tick();
  const continuations = app.posts.filter(post=>post.url==='/api/continue');
  assert.equal(continuations.length,1);
  assert.deepEqual(continuations.map(post=>[post.body.runId,post.body.branchId]),[['root','alt']],'the clicked event advances');
});

test('clicking a child starts continuation before its read-only scene check resolves', async () => {
  const root = run('root'); root.assets=['hero.png'];
  const child = run('child',next,{rootRunId:'root',parentRunId:'root',parentBranchId:'a',path:[{runId:'root',branchId:'a',...choice}]});
  let releaseScene; const scenePending = new Promise(resolve=>{releaseScene=resolve;});
  const app = harness({root,child}, async (url,options) => {
    assert.equal(url,'/api/continue');
    const body=JSON.parse(options.body);
    return complete(body.runId==='root'?child:run('grandchild',branch('g','Grandchild',-2000)));
  }, false, '', undefined, undefined, false, url => {
    const id=new URL(url,'http://local').searchParams.get('runId');
    return id==='child'?scenePending:Response.json({status:'missing'});
  });
  await tick(); app.get('access').value='fixture';
  await app.ui.loadRun('root',{animate:false,autoConsequences:false});
  app.ui.activateBranch(choice);
  for(let i=0;i<16 && !app.gets.some(url=>url.startsWith('/api/event-scene?runId=child'));i++) await tick();
  assert.ok(app.gets.some(url=>url.startsWith('/api/event-scene?runId=child')),'the child scene prefetch is pending');
  await app.ui.loadRun('child',{animate:false,autoConsequences:false});
  app.ui.activateBranch(next);
  for(let i=0;i<12 && !app.posts.some(post=>post.url==='/api/continue' && post.body.runId==='child');i++) await tick();
  assert.ok(app.posts.some(post=>post.url==='/api/continue' && post.body.runId==='child'),'click promotion dispatches consequences without waiting for the scene');
  releaseScene(Response.json({status:'complete',url:'/runs/child/event-b.png'}));
  for(let i=0;i<12;i++) await tick();
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

test('continuation SSE keeps a proven retryable refusal distinct from an uncertain failure', async () => {
  const root = run('root'); root.assets = ['hero.png'];
  const app = harness({root}, async url => {
    if (url === '/api/event-scene') return Response.json({status:'complete',url:'/runs/root/event-a.png'});
    return new Response('event: error\ndata: {"status":"retryable","message":"Spend cap reached before dispatch"}\n\n', {headers:{'content-type':'text/event-stream'}});
  });
  await tick(); await app.ui.loadRun('root', {animate:false});
  for (let i = 0; i < 8; i++) await tick();
  app.get('access').value = 'fixture';
  app.ui.activateBranch(choice);
  for (let i = 0; i < 12; i++) await tick();
  const selected = findNode(app.get('exploration-tree-status'), node => node?.className === 'tree-branch' && node.children[0]?.dataset?.branchId === 'a');
  assert.equal(selected.dataset.state, 'retryable');
  assert.match(selected.children[1].textContent, /Can retry/);
  assert.equal(app.posts.filter(post => post.url === '/api/continue').length, 1, 'an SSE error is never automatically replayed');
});

test('only a persisted budget-exhausted edge gets an explicit retry that carries the server revalidation flag', async () => {
  const root = run('root'); root.assets = ['hero.png'];
  root.continuation.children = [{branchId:'a',status:'failed',code:'budget_exhausted'}];
  const child = run('child', next, {rootRunId:'root',parentRunId:'root',parentBranchId:'a',path:[{runId:'root',branchId:'a',...choice}]});
  child.branch.branches = [];
  const app = harness({root,child}, async (url, options) => {
    assert.equal(url, '/api/continue');
    assert.deepEqual(JSON.parse(options.body), {runId:'root',branchId:'a',retryBudgetFailure:true});
    return complete(child);
  });
  await tick(); await app.ui.loadRun('root',{animate:false,autoConsequences:false});
  app.get('access').value = 'fixture'; app.ui.activateBranch(choice);
  for (let i=0;i<12;i++) await tick();
  assert.equal(app.posts.filter(post => post.url === '/api/continue').length,0,'opening a failed edge does not retry it');
  assert.equal(app.get('event-retry').hidden,false);
  assert.match(app.get('event-progress').textContent,/spend limit ended this continuation attempt.*new attempt; this attempt and its saved artifacts are preserved/i);
  app.get('event-retry').click();
  for (let i=0;i<20;i++) await tick();
  assert.equal(app.posts.filter(post => post.url === '/api/continue').length,1,'only the explicit Try again click dispatches a retry');
  assert.equal(app.get('event-retry').hidden,true,'success clears the retry control');
});

test('a terminal budget-exhausted SSE failure becomes retryable only after its explicit action', async () => {
  const root = run('root'); root.assets = ['hero.png'];
  const child = run('child', next, {rootRunId:'root',parentRunId:'root',parentBranchId:'a',path:[{runId:'root',branchId:'a',...choice}]});
  child.branch.branches = [];
  let attempts = 0;
  const app = harness({root,child}, async (url, options) => {
    attempts++;
    assert.equal(url, '/api/continue');
    assert.deepEqual(JSON.parse(options.body), attempts === 1
      ? {runId:'root',branchId:'a'}
      : {runId:'root',branchId:'a',retryBudgetFailure:true});
    return attempts === 1
      ? new Response('event: error\ndata: {"step":"error","status":"failed","code":"budget_exhausted","error":"The spend cap stopped this continuation"}\n\n', {headers:{'content-type':'text/event-stream'}})
      : complete(child);
  });
  await tick(); await app.ui.loadRun('root',{animate:false,autoConsequences:false});
  app.get('access').value = 'fixture'; app.ui.activateBranch(choice);
  for (let i=0;i<16;i++) await tick();
  assert.equal(attempts,1,'the terminal stream failure is not replayed automatically');
  assert.equal(app.get('event-retry').hidden,false);
  assert.match(app.get('event-progress').textContent,/new attempt; this attempt and its saved artifacts are preserved/i);
  app.get('event-retry').click();
  for (let i=0;i<20;i++) await tick();
  assert.equal(attempts,2);
  assert.equal(app.get('event-retry').hidden,true);
});

test('uncertain and generic failed continuation edges stay locked', async () => {
  for (const edge of [
    {branchId:'a',status:'uncertain',code:'budget_exhausted'},
    {branchId:'a',status:'failed',code:'provider_error'},
  ]) {
    const root = run('root'); root.continuation.children = [edge];
    const app = harness({root}, async () => { assert.fail('A failed or uncertain edge must not retry'); });
    await tick(); await app.ui.loadRun('root',{animate:false,autoConsequences:false}); app.ui.activateBranch(choice);
    for (let i=0;i<12;i++) await tick();
    assert.equal(app.get('event-retry').hidden,true,JSON.stringify(edge));
    assert.equal(app.posts.filter(post => post.url === '/api/continue').length,0,JSON.stringify(edge));
  }
});

test('continuation retries only machine-marked pre-dispatch HTTP 429 responses with a bounded backoff', async () => {
  const root = run('root'); root.assets = ['hero.png'];
  const child = run('child', next, {rootRunId:'root',parentRunId:'root',parentBranchId:'a',path:[{runId:'root',branchId:'a',...choice}]});
  child.branch.branches = [];
  let attempts = 0; const waits = [];
  const app = harness({root,child}, async url => {
    if (url === '/api/event-scene') return Response.json({status:'complete',url:'/runs/root/event-a.png'});
    attempts++;
    if (attempts < 3) return Response.json({status:'retryable',error:'Shared capacity is full'}, {status:429});
    return complete(child);
  }, false, '', undefined, undefined, false, undefined, undefined, (callback, delay) => { waits.push(delay); queueMicrotask(callback); return waits.length; });
  await tick(); await app.ui.loadRun('root', {animate:false});
  for (let i = 0; i < 8; i++) await tick();
  app.get('access').value = 'fixture'; app.ui.activateBranch(choice);
  for (let i = 0; i < 80 && attempts < 3; i++) await tick();
  assert.equal(attempts, 3, 'two proven undispatched refusals are retried, then the request completes');
  assert.deepEqual(waits, [500,1000], 'capacity refusals use bounded exponential backoff');
  assert.equal(app.ui.state().currentRunId, 'root', 'background continuation completion keeps the current world open');
});

test('scene and SAM cutout retry proven pre-dispatch 429 refusals with the shared backoff', async () => {
  const alternate = branch('alt','Mammoth steppe',-4500), root = run('root');
  root.branch.branches.push(alternate); root.assets = ['hero.png'];
  let scenePosts = 0, cutoutPosts = 0; const waits = [];
  const app = harness({root}, async url => {
    if (url === '/api/event-scene') {
      scenePosts++;
      return scenePosts === 1 ? Response.json({status:'retryable',error:'At capacity'}, {status:429}) : Response.json({status:'complete',url:'/runs/root/event-alt.png'});
    }
    if (url === '/api/continue') return new Response('event: error\ndata: {"status":"uncertain","message":"No consequence result"}\n\n', {headers:{'content-type':'text/event-stream'}});
    if (url === '/api/event-cutout') {
      cutoutPosts++;
      return cutoutPosts === 1 ? Response.json({status:'retryable',error:'At capacity'}, {status:429}) : Response.json({status:'complete',url:'/runs/root/event-alt-cutout.png'});
    }
    assert.fail(`Unexpected POST ${url}`);
  }, false, '', undefined, undefined, false, () => Response.json({status:'missing'}), () => Response.json({status:'missing'}), (callback, delay) => { waits.push(delay); queueMicrotask(callback); return waits.length; });
  await tick(); await app.ui.loadRun('root',{animate:false}); app.get('access').value = 'fixture';
  app.ui.activateBranch(alternate);
  for (let i=0;i<40 && scenePosts<2;i++) await tick();
  app.get('cutout-view').click();
  for (let i=0;i<40 && cutoutPosts<2;i++) await tick();
  assert.equal(scenePosts,2); assert.equal(cutoutPosts,2);
  assert.deepEqual(waits,[500,500], 'scene and cutout share the proven-refusal retry policy');
  assert.equal(app.get('cutout-image').src,'/runs/root/event-alt-cutout.png');
});

test('capacity retry exhausts at a bounded two-minute budget and leaves the event retryable', async () => {
  const root = run('root'); root.assets = ['hero.png'];
  const child = run('child', next, {rootRunId:'root',parentRunId:'root',parentBranchId:'a',path:[{runId:'root',branchId:'a',...choice}]});
  child.branch.branches = [];
  let attempts = 0; const waits = [];
  const scheduleImmediately = (callback, delay) => { waits.push(delay); queueMicrotask(callback); return waits.length; };
  const app = harness({root,child}, async url => {
    if (url === '/api/continue') { attempts++; return attempts <= 10 ? Response.json({status:'retryable',error:'At capacity'}, {status:429}) : complete(child); }
    return Response.json({status:'complete',url:'/runs/root/event-a.png'});
  }, false, '', undefined, undefined, false, undefined, undefined, scheduleImmediately);
  await tick(); await app.ui.loadRun('root',{animate:false});
  for(let i=0;i<8;i++) await tick();
  app.get('access').value='fixture'; app.ui.activateBranch(choice);
  for(let i=0;i<80 && attempts<10;i++) await tick();
  assert.equal(attempts,10);
  assert.deepEqual(waits,[500,1000,2000,4000,8000,16000,30000,30000,28000]);
  assert.equal(waits.reduce((sum,delay)=>sum+delay,0),119500);
  const node = findNode(app.get('exploration-tree-status'), item => item?.className === 'tree-branch' && item.children[0]?.dataset?.branchId === 'a');
  assert.equal(node.dataset.state,'retryable');
  assert.equal(app.get('event-retry').hidden,false,'exhausted consequences stay manually retryable');
  app.get('event-retry').click();
  for(let i=0;i<20 && attempts<11;i++) await tick();
  for(let i=0;i<10;i++) await tick();
  assert.equal(attempts,11,'manual retry succeeds after the bounded automatic retry budget');
  assert.equal(app.get('event-retry').hidden,true,'successful consequences clear the retry control');
  const completedNode = findNode(app.get('exploration-tree-status'), item => item?.className === 'tree-branch' && item.children[0]?.dataset?.branchId === 'a');
  assert.equal(completedNode.dataset.state,'complete');
});

test('exhausted cutout capacity retry remains visible and manually retryable', async () => {
  const alternate=branch('alt','Mammoth steppe',-4500), root=run('root'); root.branch.branches.push(alternate); root.assets=['hero.png'];
  let attempts=0; const waits=[];
  const app=harness({root}, async url => {
    assert.equal(url,'/api/event-cutout'); attempts++;
    return Response.json({status:'retryable',error:'At capacity'}, {status:429});
  }, false, '', undefined, undefined, false, () => Response.json({status:'complete',url:'/runs/root/event-alt.png'}), () => Response.json({status:'missing'}),
  (callback,delay)=>{waits.push(delay);queueMicrotask(callback);return waits.length;});
  await tick(); await app.ui.loadRun('root',{animate:false,autoConsequences:false});
  app.get('access').value='fixture'; app.ui.selectBranch(alternate); app.get('cutout-view').click();
  for(let i=0;i<100 && attempts<10;i++) await tick();
  for(let i=0;i<8;i++) await tick();
  assert.equal(attempts,10);
  assert.equal(waits.reduce((sum,delay)=>sum+delay,0),119500);
  assert.match(app.get('view-status').textContent,/still waiting for capacity/);
  assert.match(app.get('event-progress').textContent,/select SAM cutout again to retry/i, JSON.stringify({view:app.get('view-status').textContent,progress:app.get('event-progress').textContent,title:app.get('hero-title').textContent}));
});

test('selection generates scene then consequences, retains parent, reuses results and ignores stale navigation', async () => {
  const alternate=branch('alt','Mammoth steppe',-4500), root=run('root'), other=run('other'); root.branch.branches.push(alternate); root.assets=['hero.png'];
  const future=run('child',next,{rootRunId:'root',parentRunId:'root',parentBranchId:'alt',path:[{runId:'root',branchId:'alt',...alternate}]}); future.assets=['hero.png'];
  const grandchild=run('grandchild',branch('g','Grandchild',700)); grandchild.branch.branches=[];
  let release; const wait = new Promise(resolve => { release=resolve; });
  const app=harness({root,child:future,grandchild,other},async (url,options)=>{
    if (url==='/api/event-scene') { const body=JSON.parse(options.body); await wait; return Response.json({status:'complete',url:`/runs/${body.runId}/event-${body.branchId}.png`}); }
    assert.equal(url,'/api/continue'); const body=JSON.parse(options.body); return complete(body.runId==='root'?future:grandchild);
  },false,'',undefined,undefined,false,async url=>{
    const params=new URL(url,'http://local').searchParams;
    return params.get('runId')==='child' ? Response.json({status:'complete',url:'/runs/child/event-b.png'}) : Response.json({status:'missing'});
  });
  await tick(); await app.ui.loadRun('root',{animate:false}); app.get('access').value='fixture';
  app.ui.activateBranch(alternate);
  assert.equal(app.get('scene-loading').hidden, false, 'the queued scene task is visible immediately');
  assert.match(app.get('event-progress').textContent, /Queued to find consequences/);
  assert.match(app.get('scene-loading-text').textContent, /Checking for a saved scene|Queued to check the scene/);
  app.ui.activateBranch(alternate); await tick();
  for (let i=0;i<24 && !app.posts.some(post=>post.url==='/api/event-scene');i++) await tick();
  assert.ok(app.posts.some(post=>post.url==='/api/event-scene') && app.posts.some(post=>post.url==='/api/continue'), 'saved-scene confirmation and consequence work both reach their routes');
  assert.equal(app.get('scene-loading').hidden, false);
  assert.match(app.get('scene-loading-text').textContent, /Creating this event/);
  release(); await tick(); await tick(); await tick();
  for(let i=0;i<20&&app.posts.filter(post=>post.url==='/api/continue').length<1;i++) await tick();
  assert.equal(app.posts.filter(post=>post.url==='/api/continue').length,1, 'the selected event gets one explicit continuation');
  assert.equal(app.posts.filter(post=>post.url==='/api/event-scene').length,1, 'the child scene is read from its existing local event asset');
  assert.equal(app.ui.state().currentRunId,'root'); assert.match(app.get('hero-title').textContent,/Mammoth steppe/);
  assert.equal(app.get('hero-image').src,'/runs/root/event-alt.png'); assert.equal(app.get('event-children').children.length,1);
  assert.equal(app.get('scene-loading').hidden, true);
  app.ui.activateBranch(alternate); await tick(); assert.equal(app.posts.filter(post=>post.url==='/api/continue').length,1, 'reselect reuses the saved continuation without a child continuation');
  await app.ui.loadRun('other',{animate:false}); assert.equal(app.ui.state().currentRunId,'other');
});


test('navigation during scene generation never paints a different event and reselect resumes consequences', async () => {
  const alternate=branch('alt','Mammoth steppe',-4500), root=run('root'); root.branch.branches.push(alternate); root.assets=['hero.png'];
  const future=run('child',next,{rootRunId:'root',parentRunId:'root',parentBranchId:'alt',path:[{runId:'root',branchId:'alt',...alternate}]});
  const grandchild=run('grandchild',branch('g','Grandchild',700)); grandchild.branch.branches=[];
  let release; const wait=new Promise(resolve=>{release=resolve;});
  const app=harness({root,child:future,grandchild},async (url,options)=>{ if(url==='/api/event-scene'){await wait;const body=JSON.parse(options.body);return Response.json({status:'complete',url:`/runs/${body.runId}/event-${body.branchId}.png`});} const body=JSON.parse(options.body);return complete(body.runId==='root'?future:grandchild); },false,'',undefined,undefined,false,async url=>{
    const params=new URL(url,'http://local').searchParams;
    return params.get('runId')==='child' ? Response.json({status:'complete',url:'/runs/child/event-b.png'}) : Response.json({status:'missing'});
  });
  await tick(); await app.ui.loadRun('root',{animate:false}); app.get('access').value='fixture';
  app.ui.activateBranch(alternate); await tick(); app.ui.selectBranch(choice); release(); await tick(); await tick();
  assert.match(app.get('hero-title').textContent,/Open observatory/); assert.equal(app.get('hero-image').src,'/runs/root/hero.png');
  assert.equal(app.posts.filter(post => post.url === '/api/continue').length,1, 'only the explicitly requested continuation survives navigation away');
  app.ui.activateBranch(alternate); await tick(); await tick(); await tick();
  assert.equal(app.posts.filter(post => post.url === '/api/continue').length,1, 'reselect does not duplicate the saved continuation');
  assert.equal(app.get('hero-image').src,'/runs/root/event-alt.png'); assert.equal(app.get('event-children').children.length,1);
});

test('a completed explicit continuation remains in the saved tree after navigation away', async () => {
  const alternate = branch('alt', 'Mammoth steppe', -4500), root = run('root');
  root.branch.branches.push(alternate); root.branch.hero = {branchId:'alt'}; root.assets = ['hero.png'];
  const other = run('other', next), child = run('child', next, {rootRunId:'root',parentRunId:'root',parentBranchId:'alt',path:[{runId:'root',branchId:'alt',...alternate}]});
  let finish; const pending = new Promise(resolve => { finish = resolve; });
  const app = harness({root, other, child}, async url => {
    if (url === '/api/event-scene') return Response.json({status:'complete',url:'/runs/root/event-alt.png'});
    assert.equal(url, '/api/continue'); return pending;
  });
  await tick(); await app.ui.loadRun('root', {animate:false}); app.get('access').value = 'fixture';
  app.ui.activateBranch(alternate);
  for (let i = 0; i < 8 && app.posts.length < 2; i++) await tick();
  assert.deepEqual(app.posts.map(post => post.url), ['/api/continue']);
  app.get('access').value = '';
  await app.ui.loadRun('other', {animate:false});
  finish(complete(child));
  for (let i = 0; i < 8; i++) await tick();
  await app.ui.loadRun('root', {animate:false});
  for (let i = 0; i < 6; i++) await tick();
  assert.ok(findNode(app.get('exploration-tree-status'), node => node?.className === 'tree-run' && node.dataset.runId === 'child'));
  assert.equal(app.posts.filter(post => post.url === '/api/continue').length, 1, 'returning to the tree does not replay the saved continuation');
});


test('scene accessible name follows the selected event after navigating between saved worlds', async () => {
  const root=run('root',choice), other=run('other',next); root.assets=['hero.png']; other.assets=['hero.png'];
  const app=harness({root,other}); await tick();
  await app.ui.loadRun('root',{animate:false}); assert.equal(app.get('hero-image').alt,'Scene for Open observatory');
  await app.ui.loadRun('other',{animate:false});
  assert.equal(app.get('hero-image').src,'/runs/other/hero.png');
  assert.equal(app.get('hero-image').alt,'Scene for Ocean observatories');
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
