import test from 'node:test';
import assert from 'node:assert/strict';
import { mountHistoryTimeline, groupHistoryEras } from '../web/historyTimeline.js';

class Element {
  constructor(tag, document) { this.tagName = tag; this.ownerDocument = document; this.children = []; this.dataset = {}; this.listeners = {}; this.attributes = {}; this.style = {}; this.hidden = false; this.selected = false; this.value = '';
    const classes=new Set(); this.classList={toggle(name,force){if(force===undefined)force=!classes.has(name);if(force)classes.add(name);else classes.delete(name);return force;},add(name){classes.add(name);},remove(name){classes.delete(name);},contains(name){return classes.has(name);}}; }
  set textContent(value) { this._text = String(value); this.children = []; }
  get textContent() { return (this._text || '') + this.children.map(node => node.textContent || '').join(''); }
  append(...nodes) { for (const node of nodes) { node.parentNode?.children?.splice(node.parentNode.children.indexOf(node),1); node.parentNode=this; this.children.push(node); } }
  replaceChildren(...nodes) { for (const child of this.children) if (child.parentNode===this) child.parentNode=null; this.children=[]; this.append(...nodes); }
  insertBefore(node, reference) { if (reference != null && !this.children.includes(reference)) { const error=new Error('The reference node is not a child of this node.'); error.name='NotFoundError'; throw error; } const prior=node.parentNode?.children; if (prior) { const oldIndex=prior.indexOf(node); if (oldIndex>=0) prior.splice(oldIndex,1); } const index=this.children.indexOf(reference); node.parentNode=this; this.children.splice(index<0?this.children.length:index,0,node); return node; }
  setAttribute(key, value) { this.attributes[key] = String(value); }
  getAttribute(key) { return this.attributes[key] ?? null; }
  addEventListener(type, fn) {
    const existing=this.listeners[type];
    if (!existing) this.listeners[type]=fn;
    else { const callbacks=existing._callbacks || [existing]; callbacks.push(fn); this.listeners[type]=Object.assign(event=>callbacks.forEach(callback=>callback(event)),{_callbacks:callbacks}); }
  }
  removeEventListener(type, fn) {
    const existing=this.listeners[type]; if (!existing) return;
    const callbacks=existing._callbacks || [existing], next=callbacks.filter(callback=>callback!==fn);
    if (!next.length) delete this.listeners[type];
    else this.listeners[type]=Object.assign(event=>next.forEach(callback=>callback(event)),{_callbacks:next});
  }
  matches(selector) { return selector === 'select[data-history-select]' && this.tagName === 'select' && this.dataset.historySelect === 'true'; }
  queryAll(tag) { return [...(this.tagName === tag ? [this] : []), ...this.children.flatMap(node => node.queryAll?.(tag) || [])]; }
  querySelectorAll(selector) { return selector === 'input[data-batch-suggestion]'
    ? this.queryAll('input').filter(input => input.dataset.batchSuggestion)
    : selector === 'input[data-preview-exclude]' ? this.queryAll('input').filter(input => input.dataset.previewExclude)
    : selector === '[data-event-id]' ? this.queryAll('li').filter(node => node.dataset.eventId != null)
    : selector === 'button[data-action]' ? this.queryAll('button').filter(button => button.dataset.action) : []; }
  closest(selector) {
    if (selector === '[data-swipe-card]') { let node=this; while(node){if(node.dataset?.swipeCard==='true')return node;node=node.parentNode;} }
    if (selector === 'button[data-action]') { let node=this; while(node){if(node.tagName==='button'&&node.dataset?.action)return node;node=node.parentNode;} }
    if (selector === 'article.history-timeline-suggestion') { let node=this; while(node){if(node.tagName==='article'&&String(node.className).split(/\s+/).includes('history-timeline-suggestion'))return node;node=node.parentNode;} }
    return selector === 'button[data-history-id]' && this.tagName === 'button' && this.dataset.historyId ? this : null;
  }
  focus(options) { this.focused = true; this.focusOptions = options; this.listeners.focus?.({ target:this }); }
  async click() { const event={target:this,stopped:false,stopPropagation(){this.stopped=true;},preventDefault(){this.prevented=true;}}; for(let node=this;node;node=node.parentNode){await node.listeners.click?.(event);if(event.stopped)break;} return event; }
  scrollIntoView() { this.scrolled = true; }
  contains(node) { return node === this || this.children.some(child => child === node || child.contains?.(node)); }
  keydown(key) { const event={key,preventDefault(){this.prevented=true;},stopPropagation(){this.stopped=true;}}; this.listeners.keydown?.(event); return event; }
}
const document = { createElement(tag) { return new Element(tag, document); }, createTextNode(text) { return { textContent:String(text), queryAll:() => [] }; } };
const event = (id, year, title, extras = {}) => ({ id, year, title, summary:`${title} summary`, causeEventId:'q', ...extras });
const question = { id:'q', title:'The question', histories:[
  { id:'h1', events:[event('e1',-3000,'River begins',{ era:'Green beginnings' }), event('e2',-2800,'Settlement grows',{ era:'Green beginnings', causeEventId:'e1' }), event('e3',-1000,'Dry season',{ era:'Later change', causeEventId:'e2', checkFlags:[{ kind:'weave-ripple', wovenEventId:'woven-1', message:'Re-check this event.' }] })], suggestions:[] },
  { id:'h2', forkEventId:'e2', events:[event('e1',-3000,'River begins')] },
] };

test('timeline groups eras, lists cause links, per-flag ripple controls, fork actions and suggestions', async () => {
  const suggestionWindow={fromYear:-999,toYear:-800};
  const state = { question, history:question.histories[0], histories:question.histories, historyId:'h1', selectedEventId:'e2', date:-1000, window:suggestionWindow, autoSuggest:true,
    suggestions:[{ id:'s1', year:-900, title:'Canal network', summary:'It connects wetlands.', verdict:'fits', reason:'Fits beside the dry season.',window:suggestionWindow },
      { id:'s2', year:-850, title:'Rain returns', summary:'A conflicting possibility.', verdict:'conflicts', conflictsWith:'e3', reason:'Would reverse the dry spell.',window:suggestionWindow }] };
  const root = new Element('main', document), calls = [];
  const weavePlan={id:'plan-s1',questionId:question.id,historyId:'h1',suggestionIds:['s1'],existingEventIds:['q','e1','e2','e3'],
    existingEvents:state.history.events,chain:[{id:'s1',year:-900,title:'Canal network',causeEventId:question.id}],merges:[],conflicts:[]};
  const session = { checkWeaveBatch:async ids=>{calls.push(['checkWeaveBatch',[...ids]]);return weavePlan;},
    commitWeaveBatch:async body=>{calls.push(['commitWeaveBatch',{...body,suggestionIds:[...body.suggestionIds]}]);return {history:state.history};},getState:()=>({status:''}),
    forkSuggestion:id => calls.push(['forkSuggestion',id]), forkEvent:id => calls.push(['forkEvent',id]),
    keep:(id,woven) => calls.push(['keep',id,woven]), regenerate:(id,woven) => calls.push(['regenerate',id,woven]) };
  const mounted = mountHistoryTimeline(root, { getState:() => state, session, document });
  assert.deepEqual(groupHistoryEras(state.history.events).map(item => item.label), ['Green beginnings','Later change']);
  assert.match(mounted.element.textContent, /because ← 2,800 BCE · Settlement grows/);
  assert.match(mounted.element.textContent, /Saved suggestions · 2/);
  assert.match(mounted.element.textContent, /The date remains 1,000 BCE until you move the timebar/);
  assert.match(mounted.element.textContent, /Fits beside the dry season/);
  assert.match(mounted.element.textContent, /Would reverse the dry spell/);
  const timeline = mounted.element.children[1], suggestions = mounted.element.children[2];
  assert.equal(suggestions.hidden,true,'the suggestion list stays inside its review overlay until opened');
  assert.equal(timeline.queryAll('details').filter(item=>item.className==='history-era').length, 0, 'short histories keep every era expanded');
  assert.ok(timeline.queryAll('li').filter(row=>row.dataset.eventId).every(row=>row.children.some(child=>child.tagName==='details'&&child.className==='history-event-context')),'each event keeps cause and fork actions inside its compact disclosure');
  assert.ok(timeline.queryAll('li').some(row=>row.className==='history-era-divider'&&row.textContent.startsWith('Green beginnings ·')));
  state.date = -950; mounted.render(state);
  const click = async (container, action, id) => container.listeners.click({ target:{ closest:() => ({ dataset:{ action, id, wovenId:'woven-1' } }) } });
  await click(timeline,'keep','e3'); await click(timeline,'regenerate','e3'); await click(timeline,'fork-event','e3');
  const possibility=timeline.queryAll('button').find(button=>button.dataset.action==='open-window-deck');
  assert.ok(possibility,'the saved possibility window opens its review deck');
  await timeline.listeners.click({target:possibility});
  const deck=root.queryAll('section').find(node=>node.className==='history-suggestion-deck-portal');
  const listView=deck.queryAll('button').find(button=>button.dataset.action==='deck-list');
  await deck.listeners.click({target:listView});
  assert.equal(suggestions.parentNode,root.queryAll('section').find(node=>node.className==='history-suggestion-deck-portal'),
    'List opens in the review portal before a checked single weave');
  const weaveRow=suggestions.queryAll('button').find(button=>button.dataset.action==='weave'&&button.dataset.id==='s1');
  assert.ok(weaveRow,'the portal List contains the selected row Weave action');
  const forkRow=suggestions.queryAll('button').find(button=>button.dataset.action==='fork-suggestion'&&button.dataset.id==='s2');
  await forkRow.click();
  await weaveRow.click();
  assert.deepEqual(calls.map(([name])=>name),['keep','regenerate','forkEvent','forkSuggestion','checkWeaveBatch','commitWeaveBatch']);
  assert.deepEqual([...calls[4][1]],['s1'],'portal Weave checks only the clicked row suggestion');
  assert.deepEqual({...calls[5][1],suggestionIds:[...calls[5][1].suggestionIds],acceptedMergeIds:[...calls[5][1].acceptedMergeIds],excludedSuggestionIds:[...calls[5][1].excludedSuggestionIds]},
    {suggestionIds:['s1'],planId:'plan-s1',acceptedMergeIds:[],excludedSuggestionIds:[]},'portal Weave commits the checked no-conflict plan');
  state.selectedEventId='e3'; state.date=-1000; state.weaveFeedback={eventIds:['e3'],expiresAt:Date.now()+2000}; mounted.render(state);
  const wovenRow=timeline.queryAll('li').find(row=>row.dataset.eventId==='e3');
  assert.match(wovenRow.className,/history-event-woven-feedback/,'canonical woven rows receive the transient feedback class');
  assert.equal(wovenRow.scrolled,true,'the selected canonical row is scrolled into view as the weave pulse starts');
  const tabs = mounted.element.children[0]; assert.equal(tabs.queryAll('button').length, 2); assert.equal(tabs.queryAll('select').length, 0);
  assert.match(tabs.textContent,/CHRONICLE/); assert.match(tabs.textContent,/The question/); assert.match(tabs.textContent,/History 1/);
});

test('timeline recomputes generated era ranges after an inserted event and preserves named eras', () => {
  const events = [
    event('old',-1800,'First',{ era:'Era 1 · 1,800 BCE–1,000 BCE' }),
    event('middle',-1400,'Middle',{ era:'Era 1 · 1,800 BCE–1,400 BCE', causeEventId:'old' }),
    event('inserted',-1000,'Inserted',{ era:'Era 1 · 1,000 BCE', causeEventId:'middle' }),
    event('named',900,'Named',{ era:'Coastal observatories', causeEventId:'inserted' }),
  ];
  assert.deepEqual(groupHistoryEras(events).map(group=>group.label), ['Era 1 · 1800 BCE–1000 BCE','Coastal observatories']);
});

test('near-equal era and period labels merge into inline dividers in short timelines', () => {
  const events = [
    event('h1',-300,'Hellenistic start',{era:'Hellenistic Era'}),
    event('h2',-250,'Hellenistic middle',{era:'Hellenistic Period',causeEventId:'h1'}),
    event('r1',-100,'Republic event',{era:'Roman Republic',causeEventId:'h2'}),
  ];
  const groups=groupHistoryEras(events);
  assert.deepEqual(groups.map(group=>group.events.map(item=>item.id)),[['h1','h2'],['r1']]);
  const history={id:'eras',events,suggestions:[]};
  const state={question:{id:'q-eras',histories:[history]},history,histories:[history],historyId:history.id,date:-100,selectedEventId:'r1',suggestions:[]};
  const mounted=mountHistoryTimeline(new Element('main',document),{getState:()=>state,document});
  const timeline=mounted.element.children[1];
  assert.equal(timeline.queryAll('details').filter(item=>item.className==='history-era').length,0,'histories with twelve or fewer events never collapse eras');
  assert.equal(timeline.queryAll('ol').length,1,'all short-history events share one chronological rail');
  assert.match(timeline.textContent,/Hellenistic Era/); assert.match(timeline.textContent,/Roman Republic/,'short histories use inline era dividers');
  assert.ok(timeline.queryAll('li').some(row=>row.dataset.eventId==='r1'));
  assert.ok(timeline.queryAll('li').some(row=>row.className==='history-era-divider'&&row.textContent.startsWith('Roman Republic ·')));
});

test('Chronicle shows possibilities in date order and opens a window-scoped swipe deck', async () => {
  const close={fromYear:-50,toYear:-1}, far={fromYear:1700,toYear:1799};
  const near={id:'aden-44',year:-44,title:'Aden becomes a maritime hub',verdict:'fits',window:close,sceneRef:'/scenes/aden.png'};
  const later={id:'later-1776',year:1776,title:'A later possibility',verdict:'fits',window:far};
  const history={id:'chronicle',name:'Arabian Peninsula',events:[event('past',-1000,'Earlier event'),event('future',250,'Later event')],suggestions:[near,later],suggestionWindows:[
    {window:close,status:'ready',suggestionCount:1},{window:far,status:'ready',suggestionCount:1},
  ]};
  const state={questionId:'q-chronicle',question:{id:'q-chronicle',title:'How does the region change?',histories:[history]},history,histories:[history],historyId:history.id,date:-44,selectedEventId:'past',window:close,suggestions:[near,later]};
  const root=new Element('main',document), mounted=mountHistoryTimeline(root,{getState:()=>state,document});
  const host=mounted.element,timeline=host.children[1],header=host.children[0],suggestions=host.children[2];
  assert.match(header.textContent,/CHRONICLE/); assert.match(header.textContent,/How does the region change/);
  assert.match(header.textContent,/Arabian Peninsula/); assert.match(header.textContent,/As of 44 BCE · 2 events/);
  assert.match(timeline.textContent,/You are here · 44 BCE/);
  assert.equal(header.queryAll('button').length,0,'a single history has no history tabs');
  const possibility=timeline.queryAll('button').find(node=>node.dataset.action==='open-window-deck'&&node.dataset.windowKey==='-50:-1');
  assert.match(possibility.textContent,/✦ 1 possibility around 44 BCE/);
  assert.ok(timeline.children.indexOf(possibility.parentNode)<timeline.children.length-1,'the possibility is presented in the timeline flow');
  await timeline.listeners.click({target:{closest:()=>possibility}});
  const deck=root.queryAll('section').find(node=>node.className==='history-suggestion-deck-portal');
  assert.equal(deck.hidden,false); assert.match(deck.textContent,/Aden becomes a maritime hub/);
  assert.doesNotMatch(deck.textContent,/A later possibility/,'the deck is scoped to the selected suggestion window');
  assert.ok(deck.queryAll('button').some(node=>node.dataset.action==='deck-list'&&node.textContent==='List view'));
  assert.equal(state.date,-44); assert.equal(state.selectedEventId,'past','opening possibilities leaves the selected date and event unchanged');
  const listLink=deck.queryAll('button').find(node=>node.dataset.action==='deck-list');
  await deck.listeners.click({target:{closest:()=>listLink}});
  assert.equal(deck.querySelectorAll?.('.history-timeline-suggestions').length || deck.queryAll('section').filter(node=>node.className==='history-timeline-suggestions').length,1);
  assert.equal(suggestions.parentNode,deck,'List opens inside the review portal rather than the Chronicle sidebar');
  assert.equal(deck.hidden,false);
});

test('selecting a chronology event moves the as-of date and marker to that event year', () => {
  const history={id:'date-history',events:[event('older',-120,'Older event'),event('newer',245,'Newer event')],suggestions:[]};
  const state={questionId:'date-q',question:{id:'date-q',title:'Date question',histories:[history]},history,histories:[history],historyId:history.id,date:20,selectedEventId:'older'};
  const callbacks=[],mounted=mountHistoryTimeline(new Element('main',document),{getState:()=>state,session:{setDate(year){state.date=year;}},
    onEventSelect:(id,selection)=>{callbacks.push([id,selection]);state.selectedEventId=id;state.date=selection?.date??state.date;},document});
  const timeline=mounted.element.children[1],newer=timeline.queryAll('button').find(node=>node.dataset.action==='select-event'&&node.dataset.id==='newer');
  timeline.listeners.click({target:{closest:()=>newer}}); mounted.render(state);
  assert.equal(state.date,245); assert.equal(state.selectedEventId,'newer'); assert.deepEqual(callbacks,[['newer',{date:245}]]);
  const marker=timeline.queryAll('li').find(node=>node.className==='history-timeline-date-marker');
  const row=timeline.queryAll('li').find(node=>node.dataset.eventId==='newer');
  assert.equal(marker.textContent,'You are here · 245 CE'); assert.ok(timeline.children[0].children.indexOf(marker)<timeline.children[0].children.indexOf(row));
});

test('timeline footer keeps one suggest action and autosuggest controls in its overflow menu', () => {
  const history={id:'compact',events:[],suggestions:[],suggestionWindows:[{window:{fromYear:100,toYear:199},status:'ready',suggestionCount:1}]};
  const suggestion={id:'compact-s',year:120,title:'Possibility',verdict:'fits',window:{fromYear:100,toYear:199}};
  history.suggestions=[suggestion];
  const state={question:{id:'q-compact',histories:[history]},history,histories:[history],historyId:history.id,date:150,window:{fromYear:100,toYear:199},windowCached:true,suggestions:[suggestion]};
  const mounted=mountHistoryTimeline(new Element('main',document),{getState:()=>state,document});
  const timeline=mounted.element.children[1], footer=timeline.children.find(node=>node.className==='history-timeline-footer');
  assert.equal(footer.queryAll('button').filter(node=>node.dataset.action==='manual-more'||node.dataset.action==='manual-suggest').length,1);
  assert.match(footer.queryAll('button').find(node=>node.dataset.action==='manual-more'||node.dataset.action==='manual-suggest').textContent,/Suggest more around/);
  assert.equal(mounted.element.children[2].hidden,true,'saved suggestions are not shown in a separate tray by default');
  assert.ok(footer.queryAll('input').some(input=>input.dataset.autoSuggest==='true'));
  assert.ok(footer.queryAll('input').some(input=>input.dataset.autoWeave==='true'));
  assert.equal(timeline.queryAll('button').filter(node=>node.dataset.action==='open-window-deck').length,1);
});

test('each saved window becomes one chronological possibility row and the deck stays scoped', async () => {
  const firstWindow={fromYear:100,toYear:199}, secondWindow={fromYear:200,toYear:299};
  const first={id:'s-first',year:120,title:'First window',summary:'Saved first',window:firstWindow,sceneRef:'/event-scenes/first.png'};
  const second={id:'s-second',year:220,title:'Second window',summary:'Saved second',window:secondWindow};
  const third={id:'s-third',year:240,title:'Later in second',summary:'Saved third',window:secondWindow};
  const alreadyWoven={id:'e-first',year:50,title:'Already woven duplicate',window:firstWindow};
  const active={id:'gallery-history',events:[event('e-first',50,'Earlier'),event('e-selected',300,'Selected')],suggestions:[alreadyWoven,first,second,third],suggestionWindows:[
    {window:firstWindow,status:'ready',suggestionCount:1},{window:secondWindow,status:'ready',suggestionCount:2},
  ]};
  const state={questionId:'q-gallery',question:{id:'q-gallery',title:'Question',histories:[active]},history:active,histories:[active],historyId:active.id,selectedEventId:'e-first',date:150,window:firstWindow,suggestions:[first,second,third,alreadyWoven]};
  const root=new Element('main',document), mounted=mountHistoryTimeline(root,{getState:()=>state,document});
  const timeline=mounted.element.children[1], suggestions=mounted.element.children[2];
  assert.equal(timeline.queryAll('button').filter(node=>node.dataset.action==='open-window-deck').length,2);
  assert.deepEqual(timeline.queryAll('button').filter(node=>node.dataset.action==='open-window-deck').map(node=>node.textContent),[
    '✦ 1 possibility around 120 CE','✦ 2 possibilities around 220 CE',
  ]);
  assert.equal(suggestions.hidden,true,'the saved suggestion list is closed until requested from the deck');
  assert.equal(timeline.queryAll('button').some(node=>node.dataset.action==='jump-suggestions'),false,'there is no separate View all shortcut');
  const secondRow=timeline.queryAll('button').find(node=>node.dataset.windowKey==='200:299');
  await timeline.listeners.click({target:{closest:()=>secondRow}});
  const deck=root.queryAll('section').find(node=>node.className==='history-suggestion-deck-portal');
  assert.match(deck.textContent,/Second window/);
  assert.doesNotMatch(deck.textContent,/First window/,'opening a possibility row scopes the deck to that cached window');
  assert.equal(state.date,150); assert.equal(state.selectedEventId,'e-first');
});
test('batch preview resolves selected rows, reuses unchanged checks, toggles merges, and commits one plan', async () => {
  const window={fromYear:100,toYear:199};
  const fits=[event('fit-a',120,'Fit A',{verdict:'fits',window}),event('fit-b',130,'Fit B',{verdict:'fits',window})];
  const conflict=event('conflict',140,'Conflict',{verdict:'conflicts',conflictsWith:'anchor',window});
  const history={id:'batch-history',events:[event('anchor',50,'Anchor')],suggestions:[...fits,conflict],suggestionWindows:[{window,status:'ready'}]};
  const state={questionId:'batch-question',question:{id:'batch-question',histories:[history]},history,histories:[history],historyId:history.id,date:150,window,suggestions:[...fits,conflict],windowCached:true};
  const calls=[], cachedPlans=new Map(); let checkCount=0;
  const plan={id:'plan-1',questionId:'batch-question',historyId:history.id,suggestionIds:['fit-a','fit-b'],
    existingEventIds:['anchor'],existingEvents:[{id:'anchor',year:50}],
    chain:[{...fits[0],causeEventId:'anchor'},{...fits[1],causeEventId:'fit-a'}],
    merges:[{id:'merge-ab',suggestionIds:['fit-a','fit-b'],title:'Combined possibility',summary:'Together'}],conflicts:[]};
  const session={checkWeaveBatch:async ids=>{const key=ids.join(',');if(!cachedPlans.has(key)){checkCount++;calls.push(['check',[...ids]]);cachedPlans.set(key,plan);}return cachedPlans.get(key);},
    commitWeaveBatch:async body=>{calls.push(['commit',{...body,suggestionIds:[...body.suggestionIds],acceptedMergeIds:[...body.acceptedMergeIds],excludedSuggestionIds:[...body.excludedSuggestionIds]}]);return {history};},more:()=>calls.push(['more']),getState:()=>({status:''})};
  const root=new Element('main',document), mounted=mountHistoryTimeline(root,{getState:()=>state,session,document});
  const suggestions=mounted.element.children[2], timeline=mounted.element.children[1];
  const possibility=timeline.queryAll('button').find(button=>button.dataset.action==='open-window-deck');
  assert.ok(possibility,'the window row opens the deck before the List review');
  await timeline.listeners.click({target:possibility});
  const portal=root.children.find(node=>node.className==='history-suggestion-deck-portal');
  const listView=portal.queryAll('button').find(button=>button.dataset.action==='deck-list');
  await portal.listeners.click({target:listView});
  const checks=()=>suggestions.queryAll('input').filter(input=>input.dataset.batchSuggestion);
  assert.deepEqual(checks().filter(input=>input.checked).map(input=>input.dataset.batchSuggestion),['fit-a','fit-b']);
  assert.equal(checks().find(input=>input.dataset.batchSuggestion==='conflict').checked,false);
  assert.equal(checks().find(input=>input.dataset.batchSuggestion==='conflict').disabled,true);
  let fitA=checks().find(input=>input.dataset.batchSuggestion==='fit-a'); fitA.checked=false;
  suggestions.listeners.change({target:fitA});
  mounted.render(state);
  assert.equal(checks().find(input=>input.dataset.batchSuggestion==='fit-a').checked,false,'refresh rendering preserves an explicit deselection');
  const selectNone=suggestions.querySelectorAll('button[data-action]').find(button=>button.dataset.action==='batch-select-none');
  await selectNone.click();
  assert.equal(suggestions.querySelectorAll('button[data-action]').find(button=>button.dataset.action==='batch-preview').textContent,'Weave selected (0)',
    'Select none updates the visible batch review action through the native querySelectorAll path');
  const selectAll=suggestions.querySelectorAll('button[data-action]').find(button=>button.dataset.action==='batch-select-all');
  await selectAll.click();
  assert.equal(suggestions.querySelectorAll('button[data-action]').find(button=>button.dataset.action==='batch-preview').textContent,'Weave selected (2)',
    'Select all updates the visible batch review action through the native querySelectorAll path');
  const preview=suggestions.querySelectorAll('button[data-action]').find(button=>button.dataset.action==='batch-preview');
  assert.equal(preview.textContent,'Weave selected (2)');
  assert.equal(preview.getAttribute('aria-label'),'Weave 2 selected suggestions into history');
  await preview.click();
  const panel=mounted.element.children[3], buttons=()=>panel.querySelectorAll('button[data-action]');
  assert.match(panel.textContent,/2 resulting events/);
  assert.match(panel.textContent,/because ← Anchor/); assert.match(panel.textContent,/because ← Fit A/,'cause links can point to another selected peer');
  assert.equal(checkCount,1);
  const mergeToggle=buttons().find(button=>button.dataset.action==='batch-merge-toggle');
  await panel.listeners.click({target:{closest:()=>mergeToggle}});
  assert.match(panel.textContent,/1 resulting event/,'accepting a proposed merge updates the preview projection');
  const keepSeparate=buttons().find(button=>button.dataset.action==='batch-merge-toggle');
  await panel.listeners.click({target:{closest:()=>keepSeparate}});
  assert.match(panel.textContent,/2 resulting events/);
  const cancel=buttons().find(button=>button.dataset.action==='batch-cancel');
  await panel.listeners.click({target:{closest:()=>cancel}});
  const reopen=suggestions.querySelectorAll('button[data-action]').find(button=>button.dataset.action==='batch-preview');
  await reopen.click();
  assert.equal(checkCount,1,'cancel and reopen with unchanged selection reuses the session plan');
  const merge=panel.querySelectorAll('button[data-action]').find(button=>button.dataset.action==='batch-merge-toggle');
  await panel.listeners.click({target:{closest:()=>merge}});
  const commit=panel.querySelectorAll('button[data-action]').find(button=>button.dataset.action==='batch-commit');
  await panel.listeners.click({target:{closest:()=>commit}});
  assert.deepEqual(calls.slice(0,2),[['check',['fit-a','fit-b']],['commit',{suggestionIds:['fit-a','fit-b'],planId:'plan-1',acceptedMergeIds:['merge-ab'],excludedSuggestionIds:[]}]]);
  const more=timeline.queryAll('button').find(button=>button.dataset.action==='manual-more');
  assert.match(more.textContent,/Suggest more around 150 CE/);
  await timeline.listeners.click({target:{closest:()=>more}});
  assert.deepEqual(calls.at(-1),['more'],'More retains its existing action');
  const otherHistory={...history,id:'other-history'}; state.history=otherHistory; state.histories=[otherHistory]; state.historyId=otherHistory.id;
  mounted.render(state);
  assert.deepEqual(checks().filter(input=>input.checked).map(input=>input.dataset.batchSuggestion),['fit-a','fit-b'],'each history starts with its own default selection');
});

test('batch preview blocks unresolved conflicts and commits only after an affected suggestion is excluded', async () => {
  const candidate=event('conf-a',120,'Conflicting possibility',{verdict:'fits'});
  const history={id:'conf-history',events:[event('anchor',50,'Anchor')],suggestions:[candidate]};
  const state={questionId:'q-conflict',question:{id:'q-conflict',histories:[history]},history,histories:[history],historyId:history.id,date:150,window:{fromYear:100,toYear:199},suggestions:[candidate]};
  const plan={id:'conf-plan',questionId:state.questionId,historyId:history.id,suggestionIds:[candidate.id],
    existingEventIds:['anchor'],existingEvents:[{id:'anchor',year:50}],
    chain:[{...candidate,causeEventId:'anchor'}],merges:[],conflicts:[{suggestionId:candidate.id,conflictsWith:'anchor',reason:'They compete for the same event slot.'}]};
  let commitBody=null;
  const session={checkWeaveBatch:async()=>plan,commitWeaveBatch:async body=>{commitBody=body;return {history};},getState:()=>({status:''})};
  const mounted=mountHistoryTimeline(new Element('main',document),{getState:()=>state,session,document});
  const suggestions=mounted.element.children[2], tray=suggestions.querySelectorAll('button[data-action]').find(item=>item.dataset.action==='batch-preview');
  await suggestions.listeners.click({target:{closest:()=>tray}});
  const panel=mounted.element.children[3], find=(action)=>panel.querySelectorAll('button[data-action]').find(item=>item.dataset.action===action);
  assert.match(panel.textContent,/1 unresolved conflict/);
  assert.equal(find('batch-commit').disabled,true,'the commit is blocked while a conflict remains included');
  const exclude=panel.queryAll('input').find(input=>input.dataset.previewExclude===candidate.id);
  exclude.checked=true; panel.listeners.change({target:exclude});
  assert.match(panel.textContent,/0 resulting events/);
  assert.equal(find('batch-commit').disabled,false);
  await panel.listeners.click({target:{closest:()=>find('batch-commit')}});
  assert.deepEqual(commitBody,{suggestionIds:[candidate.id],planId:'conf-plan',acceptedMergeIds:[],excludedSuggestionIds:[candidate.id]});
});

test('uncertain preview offers an explicit receipt retry and explains possible charge', async () => {
  const candidate=event('uncertain-fit',120,'Possibility',{verdict:'fits'}), history={id:'uncertain-history',events:[],suggestions:[candidate]};
  const state={questionId:'q-uncertain',question:{id:'q-uncertain',histories:[history]},history,histories:[history],historyId:history.id,date:150,window:{fromYear:100,toYear:199},suggestions:[candidate]};
  const plan={id:'receipt-plan',questionId:state.questionId,historyId:history.id,suggestionIds:[candidate.id],existingEventIds:[state.questionId],existingEvents:[],chain:[{...candidate,causeEventId:state.questionId}],merges:[],conflicts:[]};
  const calls=[]; let uncertain={retryOf:'receipt-opaque',possibleCharge:true}, status='The prior check outcome is uncertain.';
  const session={checkWeaveBatch:async(ids,options={})=>{calls.push([ids,options]);if(options.retryOf){uncertain=null;return plan;}return null;},
    getState:()=>({status,batchCheckUncertain:uncertain})};
  const mounted=mountHistoryTimeline(new Element('main',document),{getState:()=>state,session,document});
  const suggestions=mounted.element.children[2], preview=suggestions.querySelectorAll('button[data-action]').find(item=>item.dataset.action==='batch-preview');
  await preview.click();
  let panel=mounted.element.children[3];
  assert.match(panel.textContent,/may have incurred a charge/);
  let retry=panel.querySelectorAll('button[data-action]').find(item=>item.dataset.action==='batch-retry');
  assert.equal(retry.textContent,'Retry batch check');
  await panel.listeners.click({target:{closest:()=>retry}});
  panel=mounted.element.children[3];
  assert.match(panel.textContent,/Preview 1 selected suggestions/);
  assert.match(panel.textContent,/because ← Starting question/);
  assert.doesNotMatch(panel.textContent,/q-uncertain/,'internal question IDs are not shown as cause labels');
  assert.deepEqual(calls,[[['uncertain-fit'],{}],[['uncertain-fit'],{retryOf:'receipt-opaque'}]]);
});

test('pending and unavailable batch ripple flags expose one explicit combined retry', async () => {
  const history={id:'ripple-history',events:[event('anchor',50,'Anchor'),
    event('later-a',160,'Later A',{checkFlags:[{kind:'weave-ripple',status:'pending',wovenEventId:'woven-a'}]}),
    event('later-b',170,'Later B',{checkFlags:[{kind:'weave-ripple',status:'unavailable',wovenEventId:'woven-b'}]}),
    event('later-c',180,'Review only',{checkFlags:[{kind:'weave-ripple',status:'review',wovenEventId:'woven-c'}]})]};
  const state={questionId:'q-ripple',question:{id:'q-ripple',histories:[history]},history,histories:[history],historyId:history.id,date:170};
  const calls=[], root=new Element('main',document), mounted=mountHistoryTimeline(root,{getState:()=>state,session:{retryRippleBatch:(events,woven)=>calls.push([events,woven])},document});
  const timeline=mounted.element.children[1], retry=timeline.queryAll('button').find(button=>button.dataset.action==='retry-ripple-batch');
  assert.equal(retry.textContent,'Retry combined re-check · 2');
  await timeline.listeners.click({target:{closest:()=>retry}});
  assert.deepEqual(calls,[[['later-a','later-b'],['woven-a','woven-b']]]);
});

test('auto-weave preference is opt-in and pending batches expose Keep all plus event-level Remove', async () => {
  const pendingA=event('pending-a',120,'Pending shrine',{causeEventId:'anchor',pending:true,pendingBatchId:'batch-pending',pendingWindows:[{fromYear:100,toYear:199}]});
  const pendingB=event('pending-b',140,'Pending observatory',{causeEventId:'pending-a',pending:true,pendingBatchId:'batch-pending',pendingWindows:[{fromYear:100,toYear:199},{fromYear:200,toYear:299}]});
  const history={id:'pending-history',events:[event('anchor',50,'Anchor'),pendingA,pendingB],suggestions:[]};
  const state={questionId:'pending-question',question:{id:'pending-question',histories:[history]},history,histories:[history],historyId:history.id,
    selectedEventId:'pending-a',date:150,window:{fromYear:100,toYear:199},autoSuggest:true,autoWeave:false,busyIds:new Set()};
  const calls=[],root=new Element('main',document);
  const session={setAutoWeave:value=>calls.push(['autoWeave',value]),finalizePendingBatch:id=>calls.push(['finalize',id]),removePendingEvent:(batchId,id)=>calls.push(['remove',batchId,id])};
  const mounted=mountHistoryTimeline(root,{getState:()=>state,session,document});
  const timeline=mounted.element.children[1],suggestions=mounted.element.children[2];
  const autoWeave=timeline.queryAll('input').find(input=>input.dataset.autoWeave==='true');
  assert.equal(autoWeave.checked,false,'auto-weave is opt-in by default');
  autoWeave.checked=true; timeline.listeners.change({target:autoWeave});
  assert.deepEqual(calls,[['autoWeave',true]]);
  const rows=timeline.queryAll('li');
  const pendingRows=rows.filter(row=>row.dataset.pending==='true');
  assert.deepEqual(pendingRows.map(row=>row.dataset.eventId),['pending-a','pending-b']);
  assert.ok(pendingRows.every(row=>row.className.includes('history-event-pending')),'pending rows receive the dashed pending style');
  assert.match(pendingRows[0].textContent,/Pending · Auto-weave · 100 CE to 199 CE/);
  assert.match(pendingRows[1].textContent,/200 CE to 299 CE/,'source window labels use the timeline year formatter');
  const keep=timeline.queryAll('button').find(button=>button.dataset.action==='finalize-pending-batch');
  assert.equal(keep.textContent,'Keep all pending · 2');
  const remove=pendingRows[0].queryAll('button').find(button=>button.dataset.action==='remove-pending-event');
  assert.equal(remove.getAttribute('aria-label'),'Remove pending event Pending shrine');
  const click=async button=>timeline.listeners.click({target:{closest:()=>button}});
  await click(keep); await click(remove);
  assert.deepEqual(calls,[['autoWeave',true],['finalize','batch-pending'],['remove','batch-pending','pending-a']]);
});

test('compact timeline keeps the batch action understandable with its short phone label', () => {
  const fit=event('phone-fit',120,'Phone fit',{verdict:'fits'}),history={id:'phone-history',events:[],suggestions:[fit]};
  const state={questionId:'phone-question',question:{id:'phone-question',histories:[history]},history,histories:[history],historyId:history.id,
    date:150,window:{fromYear:100,toYear:199},suggestions:[fit]};
  const mounted=mountHistoryTimeline(new Element('main',document),{getState:()=>state,isCompact:()=>true,document});
  const action=mounted.element.children[2].queryAll('button').find(button=>button.dataset.action==='batch-preview');
  assert.equal(action.textContent,'Weave selected (1)');
  assert.equal(action.getAttribute('aria-label'),'Weave 1 selected suggestions into history');
});

test('empty histories show starting points without verdict badges or empty-history boilerplate', () => {
  const fit={...event('start-fit',120,'A shrine is built',{verdict:'fits',reason:'The supplied history contains no events, so this possibility conflicts with nothing listed.'}),summary:'The shrine becomes a stop for travelers.'};
  const conflict={...event('start-conflict',130,'An impossible overlap',{verdict:'conflicts',conflictsWith:'future',reason:'The supplied history contains no events, so nothing conflicts with this possibility.'})};
  const meaningful={...event('start-meaningful',140,'Caravanserai network',{verdict:'fits',reason:'Seasonal hosts maintain a route from Mecca to the coast.'})};
  const history={id:'starting-history',events:[],suggestions:[fit,conflict,meaningful],suggestionWindows:[{window:{fromYear:100,toYear:199},status:'ready'}]};
  const state={questionId:'starting-question',question:{id:'starting-question',histories:[history]},history,histories:[history],historyId:history.id,date:150,window:{fromYear:100,toYear:199},suggestions:history.suggestions};
  const mounted=mountHistoryTimeline(new Element('main',document),{getState:()=>state,document});
  const suggestions=mounted.element.children[2], cards=()=>suggestions.queryAll('article').filter(node=>node.className==='history-timeline-suggestion');
  assert.equal(suggestions.queryAll('h3')[0].textContent,'Starting points · 3');
  assert.equal(suggestions.getAttribute('aria-label'),'Starting points · 3 in this timeline');
  assert.equal(suggestions.queryAll('div').find(node=>node.className==='history-timeline-suggestion-groups').getAttribute('aria-label'),'Starting points');
  assert.equal(suggestions.queryAll('h4').some(node=>node.textContent==='Starting points'),false,'the Starting points label is not duplicated below the primary heading');
  assert.equal(cards().some(card=>card.queryAll('div').some(node=>String(node.className).includes('history-verdict'))),false,'the UI omits both fits and conflicts badges');
  assert.deepEqual(cards().map(card=>card.queryAll('input').find(node=>node.dataset.batchSuggestion)?.checked),[true,false,true],
    'hiding verdicts does not alter fit preselection or conflict exclusion');
  assert.doesNotMatch(cards()[0].textContent,/supplied history contains no events/i);
  assert.doesNotMatch(cards()[1].textContent,/supplied history contains no events/i);
  assert.match(cards()[0].textContent,/The shrine becomes a stop for travelers/,'meaningful summaries remain visible');
  assert.match(cards()[2].textContent,/Seasonal hosts maintain a route/,'meaningful reasons remain visible');
  assert.ok(cards()[0].queryAll('button').some(button=>button.dataset.action==='weave'));
  assert.ok(cards()[1].queryAll('button').some(button=>button.dataset.action==='fork-suggestion'));
  state.history={...history,events:[event('canonical-event',50,'A canonical event')]};
  state.histories=[state.history]; mounted.render(state);
  const populatedCards=mounted.element.children[2].queryAll('article').filter(node=>node.className==='history-timeline-suggestion');
  assert.ok(populatedCards[0].queryAll('span').some(node=>String(node.className).includes('history-verdict-dot')),'canonical history restores compact fit/conflict dots');
});

test('preview portals above filtered rails and restores to the timeline on close or destroy', async () => {
  const portalDocument={createElement(tag){return new Element(tag,portalDocument);},createTextNode(text){return {textContent:String(text),queryAll:()=>[]};}};
  portalDocument.body=new Element('body',portalDocument);
  const candidate=event('portal-fit',120,'Portal possibility',{verdict:'fits'}), history={id:'portal-history',events:[],suggestions:[candidate]};
  const state={questionId:'q-portal',question:{id:'q-portal',title:'Portal question',histories:[history]},history,histories:[history],historyId:history.id,date:150,window:{fromYear:100,toYear:199},suggestions:[candidate]};
  const plan={id:'portal-plan',questionId:state.questionId,historyId:history.id,suggestionIds:[candidate.id],existingEventIds:[state.questionId],existingEvents:[],chain:[{...candidate,causeEventId:state.questionId}],merges:[],conflicts:[]};
  let checks=0, cachedPlan=null, pendingPlan=null, resolvePlan;
  const session={checkWeaveBatch:()=>{if(cachedPlan)return Promise.resolve(cachedPlan);if(pendingPlan)return pendingPlan;checks++;
      pendingPlan=new Promise(resolve=>{resolvePlan=()=>{cachedPlan=plan;resolve(plan);};});return pendingPlan;},getState:()=>({status:''})};
  const root=new Element('main',portalDocument), mounted=mountHistoryTimeline(root,{getState:()=>state,session,document:portalDocument});
  const panel=mounted.element.children[3], suggestions=mounted.element.children[2];
  const open=()=>{const button=suggestions.querySelectorAll('button[data-action]').find(item=>item.dataset.action==='batch-preview');return suggestions.listeners.click({target:{closest:()=>button}});};
  const firstOpen=open();
  assert.equal(panel.parentNode,portalDocument.body,'portal escapes filtered containing blocks');
  const cancel=panel.querySelectorAll('button[data-action]').find(item=>item.dataset.action==='batch-cancel');
  await panel.listeners.click({target:{closest:()=>cancel}});
  assert.equal(panel.parentNode,mounted.element,'Cancel restores the preview to its original timeline position');
  const reopened=open();
  assert.equal(checks,1,'reopening the same scoped selection uses its cached plan');
  assert.equal(panel.parentNode,portalDocument.body);
  resolvePlan(); await Promise.all([firstOpen,reopened]);
  assert.match(panel.textContent,/because ← Portal question/,'the reopened preview receives the original in-flight plan');
  const closeAgain=panel.querySelectorAll('button[data-action]').find(item=>item.dataset.action==='batch-cancel');
  await panel.listeners.click({target:{closest:()=>closeAgain}});
  await open(); assert.equal(checks,1,'a completed preview remains cached after cancel/reopen');
  mounted.destroy();
  assert.equal(panel.parentNode,mounted.element,'destroy restores the preview before removing the timeline root');
});

test('history tabs appear only for multiple histories and preserve date selection', () => {
  const shared=event('shared',100,'Shared event');
  const histories=Array.from({length:3},(_,index)=>({id:`h${index+1}`,name:`History ${index+1}`,events:[shared,event(`unique-${index+1}`,150+index,`Unique ${index+1}`)]}));
  const state={question:{id:'q-tabs',title:'A question',histories},history:histories[1],histories,historyId:'h2',date:178,selectedEventId:'unique-2'};
  const changes=[], mounted=mountHistoryTimeline(new Element('main',document),{getState:()=>state,onHistoryChange:(id,index)=>changes.push([id,index]),document});
  const header=mounted.element.children[0], nav=header.queryAll('nav')[0];
  assert.match(header.textContent,/CHRONICLE/); assert.match(header.textContent,/A question/); assert.match(header.textContent,/History 2/); assert.match(header.textContent,/178 CE · 2 events/);
  assert.equal(nav.queryAll('button').length,3); assert.equal(nav.queryAll('button').filter(node=>node.getAttribute('aria-current')==='true').length,1);
  const choose=nav.queryAll('button').find(node=>node.dataset.historyId==='h3');
  header.listeners.click({target:{closest:selector=>selector==='button[data-action]'?choose:selector==='button[data-history-id]'?choose:null}});
  assert.deepEqual(changes,[['h3','2']]); assert.equal(state.date,178); assert.equal(state.selectedEventId,'unique-2');
});

test('a single history renders Chronicle identity without history tabs', () => {
  const only={id:'only-history',name:'One history',events:[event('only-event',50,'One saved event')]};
  const state={question:{id:'only-question',title:'Solo question',histories:[only]},histories:[only],history:only,historyId:only.id,date:50,selectedEventId:'only-event'};
  const mounted=mountHistoryTimeline(new Element('main',document),{getState:()=>state,document});
  const header=mounted.element.children[0];
  assert.equal(header.hidden,false); assert.match(header.textContent,/CHRONICLE.*Solo question.*One history/s);
  assert.equal(header.queryAll('nav').length,0); assert.equal(header.queryAll('button').length,0);
});

test('eras fold into compact rows only when a history has more than twelve events', () => {
  const events=Array.from({length:13},(_,index)=>event(`event-${index}`,index*10,`Event ${index}`,{era:index<7?'First era':'Second era'}));
  const history={id:'long-history',events,suggestions:[]};
  const state={questionId:'long-q',question:{id:'long-q',title:'Long history',histories:[history]},history,histories:[history],historyId:history.id,date:120};
  const mounted=mountHistoryTimeline(new Element('main',document),{getState:()=>state,document});
  const timeline=mounted.element.children[1], eras=timeline.queryAll('details').filter(item=>item.className==='history-era');
  assert.equal(eras.length,2); assert.ok(eras.every(era=>era.children[0]?.tagName==='summary'));
  assert.match(eras[0].queryAll('summary')[0].textContent,/First era.*0 CE–60 CE.*7 events/);
  assert.equal(eras.some(era=>era.open),false,'unselected eras start folded in long histories');
});
test('deck and inline List review share window scope without losing checked selection', async () => {
  const window={fromYear:100,toYear:199};
  const suggestions=[
    event('deck-a',110,'First deck source',{verdict:'fits',window}),
    event('deck-b',120,'Second deck source',{verdict:'fits',window}),
    event('deck-c',130,'Third deck source',{verdict:'conflicts',conflictsWith:'anchor',window}),
  ];
  const history={id:'deck-history',events:[],suggestions,suggestionWindows:[{window,status:'ready',suggestionCount:3}]};
  const state={questionId:'deck-question',question:{id:'deck-question',histories:[history]},history,histories:[history],historyId:history.id,suggestions,date:130,window};
  const calls=[],held=[];
  const plan={id:'deck-plan',questionId:state.questionId,historyId:history.id,suggestionIds:['deck-a','deck-b'],existingEventIds:[state.questionId],existingEvents:[],
    chain:[{...suggestions[0],causeEventId:state.questionId},{...suggestions[1],causeEventId:'deck-a'}],merges:[],conflicts:[]};
  const session={setHeldSuggestionIds(ids){state.heldSuggestionIds=[...ids];held.push([...ids]);},checkWeaveBatch:async ids=>{calls.push(['check',[...ids]]);return plan;},getState:()=>({status:''})};
  const root=new Element('main',document),mounted=mountHistoryTimeline(root,{getState:()=>state,session,document});
  const timeline=mounted.element.children[1],suggestionsPanel=mounted.element.children[2],portal=root.children.find(node=>node.className==='history-suggestion-deck-portal');
  const possibility=timeline.queryAll('button').find(node=>node.dataset.action==='open-window-deck');
  await timeline.listeners.click({target:{closest:()=>possibility}});
  let card=portal.queryAll('article').find(node=>node.dataset.swipeCard==='true');
  assert.equal(card.dataset.suggestionId,'deck-a','the deck starts with the first chronological unreviewed source');
  assert.deepEqual(card.queryAll('button').map(node=>node.dataset.action),['deck-inspect','deck-pass','deck-keep'],'deck cards expose only inspection plus Not now and Keep decisions');
  assert.equal(card.queryAll('span').some(node=>String(node.className).includes('history-verdict')),false,'starting-point decks hide fit/conflict verdict labels');
  const listLink=portal.queryAll('button').find(node=>node.dataset.action==='deck-list');
  await portal.listeners.click({target:{closest:()=>listLink}});
  assert.equal(suggestionsPanel.parentNode,portal,'List review renders inside the same overlay, not in the Chronicle rail');
  const listChecks=()=>suggestionsPanel.queryAll('input').filter(input=>input.dataset.batchSuggestion);
  assert.deepEqual(listChecks().filter(input=>input.checked).map(input=>input.dataset.batchSuggestion),['deck-a','deck-b']);
  assert.equal(portal.queryAll('button').find(node=>node.dataset.action==='deck-mode-deck').textContent,'Deck');
  const deckMode=portal.queryAll('button').find(node=>node.dataset.action==='deck-mode-deck');
  await portal.listeners.click({target:{closest:()=>deckMode}});
  card=portal.queryAll('article').find(node=>node.dataset.swipeCard==='true');
  portal.listeners.keydown({key:'ArrowRight',target:card,preventDefault(){},stopPropagation(){}});
  assert.equal(state.heldSuggestionIds[0],'deck-a','right arrow keeps and synchronizes the active owner held set');
  card=portal.queryAll('article').find(node=>node.dataset.swipeCard==='true'); assert.equal(card.dataset.suggestionId,'deck-b');
  portal.listeners.keydown({key:'ArrowLeft',target:card,preventDefault(){},stopPropagation(){}});
  assert.deepEqual(held.at(-1),['deck-a'],'passing a card does not add it to held suggestion IDs');
  const passedToggle=portal.queryAll('button').find(node=>node.dataset.action==='deck-passed-toggle');
  await portal.listeners.click({target:{closest:()=>passedToggle}});
  const passedRow=portal.queryAll('div').find(node=>node.className==='history-deck-passed-row');
  assert.ok(passedRow.queryAll('button').some(node=>node.dataset.action==='deck-weave'));
  assert.ok(passedRow.queryAll('button').some(node=>node.dataset.action==='deck-rekeep'));
  const undo=portal.queryAll('button').find(node=>node.dataset.action==='deck-undo');
  await portal.listeners.click({target:{closest:()=>undo}});
  card=portal.queryAll('article').find(node=>node.dataset.swipeCard==='true'); assert.equal(card.dataset.suggestionId,'deck-b');
  const keep=card.queryAll('button').find(node=>node.dataset.action==='deck-keep');
  await portal.listeners.click({target:{closest:()=>keep}});
  assert.deepEqual(state.heldSuggestionIds,['deck-a','deck-b']);
  assert.deepEqual(listChecks().filter(input=>input.checked).map(input=>input.dataset.batchSuggestion),['deck-a','deck-b'],'deck decisions do not rewrite list checkbox selection');
  const review=portal.queryAll('button').find(node=>node.dataset.action==='deck-review-kept');
  await portal.listeners.click({target:{closest:()=>review}});
  assert.deepEqual(calls,[['check',['deck-a','deck-b']]],'Review kept checks kept deck IDs, not list selection');
  const panel=mounted.element.children[3]; assert.match(panel.textContent,/2 selected suggestions/);
  const cancel=panel.queryAll('button').find(node=>node.dataset.action==='batch-cancel');
  await panel.listeners.click({target:{closest:()=>cancel}});
  assert.equal(panel.hidden,true); assert.equal(portal.hidden,false);
  assert.equal(portal.queryAll('article').find(node=>node.dataset.swipeCard==='true').dataset.suggestionId,'deck-c');
  assert.equal(timeline.queryAll('li').filter(node=>node.dataset.eventId).length,0);
});
test('event rows quietly count unwoven suggestions inspired by that event', () => {
  const source=event('source',100,'Source event');
  const history={id:'quiet-history',events:[source,event('woven-copy',130,'Already woven',{causeEventId:'source'})],suggestions:[
    event('held-suggestion',110,'Held',{inspiredByEventId:'source'}),
    event('passed-suggestion',120,'Passed',{inspiredByEventId:'source'}),
    event('woven-copy',130,'Already woven',{inspiredByEventId:'source'}),
  ]};
  const state={questionId:'quiet-question',question:{id:'quiet-question',histories:[history]},history,histories:[history],historyId:history.id,
    suggestions:[...history.suggestions],heldSuggestionIds:['held-suggestion']};
  const mounted=mountHistoryTimeline(new Element('main',document),{getState:()=>state,document});
  const row=mounted.element.queryAll('li').find(item=>item.dataset.eventId==='source');
  assert.equal(row.queryAll('span').find(node=>node.className==='history-event-quiet-suggestions').textContent,'+2 unwoven');
});

test('compact window deck keeps recovery shortcuts and its List pane in the overlay', async () => {
  const doc={createElement(tag){return new Element(tag,doc);},createTextNode(text){return {textContent:String(text),queryAll:()=>[]};},defaultView:{innerWidth:375,innerHeight:812,addEventListener(){},removeEventListener(){}}};
  doc.body=new Element('body',doc);
  const window={fromYear:100,toYear:199};
  const sources=[event('fit-one',110,'First fit',{verdict:'fits',window}),event('fit-two',120,'Second fit',{verdict:'fits',window})];
  const history={id:'shortcut-history',events:[],suggestions:sources,suggestionWindows:[{window,status:'ready',suggestionCount:2}]};
  const state={questionId:'shortcut-question',question:{id:'shortcut-question',histories:[history]},history,histories:[history],historyId:history.id,suggestions:sources,date:150,window};
  const plan={id:'shortcut-plan',questionId:state.questionId,historyId:history.id,suggestionIds:sources.map(item=>item.id),existingEventIds:[state.questionId],existingEvents:[],
    chain:sources.map((item,index)=>({...item,causeEventId:index?sources[index-1].id:state.questionId})),merges:[],conflicts:[]};
  const checked=[]; let cachedPlan=null;
  const session={setHeldSuggestionIds(ids){state.heldSuggestionIds=[...ids];},checkWeaveBatch:async ids=>{if(!cachedPlan){checked.push([...ids]);cachedPlan=plan;}return cachedPlan;},getState:()=>({status:''})};
  const root=new Element('main',doc),mounted=mountHistoryTimeline(root,{getState:()=>state,session,document:doc,isCompact:()=>true});
  const timeline=mounted.element.children[1],portal=doc.body.children.find(node=>node.className==='history-suggestion-deck-portal');
  const possibility=timeline.queryAll('button').find(node=>node.dataset.action==='open-window-deck');
  await timeline.listeners.click({target:{closest:()=>possibility}});
  assert.equal(doc.body.classList.contains('history-phone-deck-active'),true);
  const portalMenu=portal.queryAll('details').find(node=>node.className==='history-suggestion-more'); assert.ok(portalMenu);
  for (let index=0;index<sources.length;index++) {
    const pass=portal.queryAll('button').find(node=>node.dataset.action==='deck-pass'); await portal.listeners.click({target:{closest:()=>pass}});
  }
  const keepAll=portal.queryAll('button').find(node=>node.dataset.action==='deck-keep-all-fits');
  assert.equal(keepAll.disabled,false,'the ellipsis menu recovers fits after all cards are passed');
  const panel=mounted.element.children.find(node=>node.className==='history-batch-preview');
  assert.ok(panel,'the batch preview exists in the Chronicle before it opens');
  await portal.listeners.click({target:{closest:()=>keepAll}});
  assert.deepEqual(checked,[['fit-one','fit-two']]);
  assert.equal(panel.parentNode,doc.body,'the batch preview moves into the body portal while open');
  const cancel=panel.queryAll('button').find(node=>node.dataset.action==='batch-cancel');
  await panel.listeners.click({target:{closest:()=>cancel}});
  const review=portal.queryAll('button').find(node=>node.dataset.action==='deck-review-kept');
  assert.equal(review.disabled,false,'kept suggestions remain reviewable after cancelling Keep all fits');
  await portal.listeners.click({target:{closest:()=>review}});
  assert.equal(panel.hidden,false,'Review kept opens the cached batch preview');
  assert.equal(checked.length,1,'Review kept reuses the cached plan');
  const cancelAgain=panel.queryAll('button').find(node=>node.dataset.action==='batch-cancel');
  await panel.listeners.click({target:{closest:()=>cancelAgain}});
  const listButton=portal.queryAll('button').find(node=>node.dataset.action==='deck-list'&&node.textContent==='List view');
  assert.equal(portal.hidden,false,'the deck remains visible after canceling review');
  assert.ok(listButton,'deck mode exposes List view after canceling review');
  await portal.listeners.click({target:{closest:()=>listButton}});
  const listSuggestions=portal.queryAll('section').find(node=>node.className==='history-timeline-suggestions');
  assert.ok(listSuggestions,'the compact portal contains the List review region');
  assert.equal(listSuggestions.parentNode,portal,'List remains owned by the compact review overlay');
  assert.equal(mounted.element.queryAll('section').some(node=>node.className==='history-timeline-suggestions'),false,
    'List content is removed from the Chronicle rail while it is open in the portal');
  assert.equal(doc.body.classList.contains('history-phone-deck-active'),true,'List stays in the overlay on compact screens');
  const timelineButton=portal.queryAll('button').find(node=>node.dataset.action==='deck-close');
  await portal.listeners.click({target:{closest:()=>timelineButton}});
  assert.equal(doc.body.classList.contains('history-phone-deck-active'),false,'Timeline returns to the Chronicle rail');
});
test('successful weave source removal clears held IDs after the outer render without duplicating Chronicle controls', async () => {
  const window={fromYear:100,toYear:199};
  const source=event('emit-source',110,'Emitted source',{verdict:'fits',window});
  const history={id:'emit-history',events:[],suggestions:[source],suggestionWindows:[{window,status:'ready',suggestionCount:6}]};
  const state={questionId:'emit-question',question:{id:'emit-question',title:'Emit question',histories:[history]},history,histories:[history],historyId:history.id,suggestions:[source],window};
  let subscriber=null, heldUpdates=0;
  const plan={id:'emit-plan',questionId:state.questionId,historyId:history.id,suggestionIds:[source.id],existingEventIds:[state.questionId],existingEvents:[],
    chain:[{...source,causeEventId:state.questionId}],merges:[],conflicts:[]};
  const session={
    setHeldSuggestionIds(ids){state.heldSuggestionIds=[...ids];heldUpdates++;subscriber?.(state);},
    checkWeaveBatch:async()=>plan,
    commitWeaveBatch:async()=>{history.events=[event('woven-canonical',110,source.title,{causeEventId:state.questionId})];history.suggestions=[];state.suggestions=[];return {history};},
    getState:()=>({status:''}),
  };
  const root=new Element('main',document), mounted=mountHistoryTimeline(root,{getState:()=>state,session,subscribe:callback=>{subscriber=callback;return()=>{};},document});
  const tray=mounted.element.children[2], timeline=mounted.element.children[1];
  const possibility=timeline.queryAll('button').find(node=>node.dataset.action==='open-window-deck');
  assert.match(possibility.textContent,/✦ 1 possibility around 110 CE/,'cached counts do not inflate the actionable possibility count');
  await timeline.listeners.click({target:{closest:()=>possibility}});
  const portal=root.children.find(node=>node.className==='history-suggestion-deck-portal');
  const keep=portal.queryAll('button').find(node=>node.dataset.action==='deck-keep');
  await portal.listeners.click({target:{closest:()=>keep}});
  assert.deepEqual(state.heldSuggestionIds,['emit-source']);
  const review=portal.queryAll('button').find(node=>node.dataset.action==='deck-review-kept');
  const panel=mounted.element.children.find(node=>node.className==='history-batch-preview');
  assert.ok(panel,'the batch preview is present in the Chronicle before Review kept opens it');
  await portal.listeners.click({target:{closest:()=>review}});
  const commit=panel.queryAll('button').find(node=>node.dataset.action==='batch-commit');
  await panel.listeners.click({target:{closest:()=>commit}});
  assert.deepEqual(state.heldSuggestionIds,[],'commit source removal clears owner held IDs through the emitting session');
  assert.equal(heldUpdates,2,'one keep and one source-removal reconciliation each emit once');
  assert.equal(tray.queryAll('h3').filter(node=>node.textContent==='Saved suggestions · 0').length,1,'the finished render tree contains one heading');
  assert.equal(timeline.queryAll('input').filter(node=>node.dataset.autoSuggest==='true').length,1,'auto-suggest control is not duplicated');
  assert.equal(timeline.queryAll('input').filter(node=>node.dataset.autoWeave==='true').length,1,'auto-weave control is not duplicated');
  assert.equal(tray.queryAll('button').filter(node=>node.dataset.action==='batch-preview').length,1,'the weave tray is not duplicated');
  assert.equal(timeline.queryAll('button').filter(node=>node.dataset.action==='open-window-deck').length,0,'a cached window with no unwoven sources has no possibility row');
  assert.equal(portal.hidden,true,'a successful weave returns from the deck to the timeline');
  assert.ok(timeline.queryAll('li').some(node=>node.dataset.eventId==='woven-canonical'),'the canonical woven event is visible in the timeline');
});
