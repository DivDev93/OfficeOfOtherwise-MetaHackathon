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
  insertBefore(node, reference) { node.parentNode?.children?.splice(node.parentNode.children.indexOf(node),1); const index=this.children.indexOf(reference); node.parentNode=this; this.children.splice(index<0?this.children.length:index,0,node); return node; }
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
    : selector === 'button[data-action]' ? this.queryAll('button').filter(button => button.dataset.action) : []; }
  closest(selector) {
    if (selector === '[data-swipe-card]') { let node=this; while(node){if(node.dataset?.swipeCard==='true')return node;node=node.parentNode;} }
    if (selector === 'button[data-action]') { let node=this; while(node){if(node.tagName==='button'&&node.dataset?.action)return node;node=node.parentNode;} }
    if (selector === 'article.history-timeline-suggestion') { let node=this; while(node){if(node.tagName==='article'&&String(node.className).split(/\s+/).includes('history-timeline-suggestion'))return node;node=node.parentNode;} }
    return selector === 'button[data-history-id]' && this.tagName === 'button' && this.dataset.historyId ? this : null;
  }
  focus(options) { this.focused = true; this.focusOptions = options; this.listeners.focus?.({ target:this }); }
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
  const state = { question, history:question.histories[0], histories:question.histories, historyId:'h1', selectedEventId:'e3', date:-1000, window:{ fromYear:-1500,toYear:-501 }, autoSuggest:true,
    suggestions:[{ id:'s1', year:-900, title:'Canal network', summary:'It connects wetlands.', verdict:'fits', reason:'Fits beside the dry season.' },
      { id:'s2', year:-850, title:'Rain returns', summary:'A conflicting possibility.', verdict:'conflicts', conflictsWith:'e3', reason:'Would reverse the dry spell.' }] };
  const root = new Element('main', document), calls = [];
  const session = { weave:id => calls.push(['weave',id]), forkSuggestion:id => calls.push(['forkSuggestion',id]), forkEvent:id => calls.push(['forkEvent',id]),
    keep:(id,woven) => calls.push(['keep',id,woven]), regenerate:(id,woven) => calls.push(['regenerate',id,woven]) };
  const mounted = mountHistoryTimeline(root, { getState:() => state, session, document });
  assert.deepEqual(groupHistoryEras(state.history.events).map(item => item.label), ['Green beginnings','Later change']);
  assert.match(mounted.element.textContent, /because ← 2,800 BCE · Settlement grows/);
  assert.match(mounted.element.textContent, /Saved suggestions · 2/);
  assert.match(mounted.element.textContent, /The date remains 1,000 BCE until you move the timebar/);
  assert.match(mounted.element.textContent, /Fits beside the dry season/);
  assert.match(mounted.element.textContent, /Would reverse the dry spell/);
  const timeline = mounted.element.children[1], suggestions = mounted.element.children[2];
  const details = timeline.queryAll('details').find(item=>item.queryAll('button').some(button=>button.dataset.id==='e3'));
  assert.equal(details.open, true, 'the selected event era opens on first view');
  details.open = false; details.listeners.toggle(); state.date = -950; mounted.render(state);
  assert.equal(timeline.queryAll('details').find(item=>item.queryAll('button').some(button=>button.dataset.id==='e3')).open, false, 'manual era folding is preserved across date changes');
  const click = async (container, action, id) => container.listeners.click({ target:{ closest:() => ({ dataset:{ action, id, wovenId:'woven-1' } }) } });
  await click(timeline,'keep','e3'); await click(timeline,'regenerate','e3'); await click(timeline,'fork-event','e3');
  await click(suggestions,'weave','s1'); await click(suggestions,'fork-suggestion','s2');
  assert.deepEqual(calls, [['keep','e3','woven-1'],['regenerate','e3','woven-1'],['forkEvent','e3'],['weave','s1'],['forkSuggestion','s2']]);
  const tabs = mounted.element.children[0]; assert.equal(tabs.queryAll('button').length, 1); assert.equal(tabs.queryAll('select').length, 0);
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

test('all saved suggestion windows stay visible, window controls jump without moving date, and expanded board flattens chronologically', async () => {
  const firstWindow={fromYear:100,toYear:199}, secondWindow={fromYear:200,toYear:299};
  const first={id:'s-first',year:120,title:'First window',summary:'Saved first',reason:'Migrated from earlier exploration.',window:firstWindow,sceneRef:'/event-scenes/first.png'};
  const second={id:'s-second',year:220,title:'Second window',summary:'Saved second',window:secondWindow};
  const third={id:'s-third',year:240,title:'Later in second',summary:'Saved third',window:secondWindow,heroRef:{status:'complete',url:'/runs/old/hero.png'}};
  const alreadyWoven={id:'e-first',year:50,title:'Already woven duplicate',window:firstWindow};
  const active={id:'gallery-history',events:[event('e-first',50,'Earlier',{era:'Early'}),event('e-selected',300,'Selected',{era:'Late'})],suggestions:[alreadyWoven,first,second,third],suggestionWindows:[
    {window:firstWindow,status:'ready',suggestionCount:1},{window:secondWindow,status:'ready',suggestionCount:2},
  ]};
  const state={question:{id:'q-gallery',histories:[active]},history:active,histories:[active],historyId:active.id,selectedEventId:'e-first',date:150,window:firstWindow,suggestions:[first,alreadyWoven]};
  const calls=[], inspected=[];
  const root=new Element('main',document), mounted=mountHistoryTimeline(root,{getState:()=>state,onWindowSelect:window=>calls.push(window),onEventSelect:id=>inspected.push(id),document});
  const timeline=mounted.element.children[1], suggestions=mounted.element.children[2];
  const cards=()=>suggestions.queryAll('article').filter(node=>node.className==='history-timeline-suggestion');
  assert.deepEqual(cards().map(card=>card.dataset.suggestionId),['s-first','s-second','s-third']);
  assert.equal(cards().some(card=>card.dataset.suggestionId==='e-first'),false,'already-woven event IDs are excluded from the suggestion gallery');
  assert.match(timeline.queryAll('button').find(button=>button.dataset.action==='jump-suggestions').textContent,/3/,'the direct gallery shortcut counts only visible unwoven suggestions');
  assert.equal(cards()[0].children[0].tagName,'img'); assert.equal(cards()[0].children[0].src,first.sceneRef);
  assert.match(suggestions.queryAll('h4').map(node=>node.textContent).join(' '),/100.*199/,'the date window is labeled once in its group header');
  assert.doesNotMatch(cards()[0].textContent,/100.*199/,'the window label is not repeated inside each row');
  const rowDetailsButton=cards()[0].queryAll('button').find(button=>button.dataset.action==='toggle-suggestion-details');
  const rowDetailsPanel=cards()[0].queryAll('div').find(node=>node.dataset.suggestionDetails==='s-first');
  assert.equal(rowDetailsButton.getAttribute('aria-expanded'),'false','suggestion details start collapsed');
  assert.equal(rowDetailsButton.getAttribute('aria-label'),'Show summary and reason for First window');
  assert.equal(rowDetailsButton.getAttribute('aria-controls'),rowDetailsPanel.id);
  assert.equal(rowDetailsPanel.hidden,true);
  assert.match(rowDetailsPanel.textContent,/Saved first/,'the summary is available inside the disclosure');
  assert.ok(cards()[0].queryAll('button').some(button=>button.dataset.action==='weave'&&button.getAttribute('aria-label')==='Weave First window into history'));
  const clickDetails=button=>suggestions.listeners.click({target:{closest:selector=>selector==='button[data-action]'?button:null}});
  await clickDetails(rowDetailsButton);
  assert.equal(inspected.length,0,'opening details does not inspect or select the suggestion');
  assert.equal(rowDetailsButton.getAttribute('aria-expanded'),'true');
  assert.equal(rowDetailsPanel.hidden,false);
  mounted.render(state);
  let reopenedDetails=cards()[0].queryAll('button').find(button=>button.dataset.action==='toggle-suggestion-details');
  let reopenedPanel=cards()[0].queryAll('div').find(node=>node.dataset.suggestionDetails==='s-first');
  assert.equal(reopenedDetails.getAttribute('aria-expanded'),'true','an open disclosure survives timeline rerenders');
  assert.equal(reopenedPanel.hidden,false);
  await clickDetails(reopenedDetails);
  assert.equal(reopenedDetails.getAttribute('aria-expanded'),'false','the same Details control closes the panel');
  assert.equal(reopenedPanel.hidden,true);
  mounted.render(state);
  reopenedDetails=cards()[0].queryAll('button').find(button=>button.dataset.action==='toggle-suggestion-details');
  assert.equal(reopenedDetails.getAttribute('aria-expanded'),'false','closing persists across subsequent rerenders');
  assert.doesNotMatch(suggestions.textContent,/Migrated from earlier exploration/i,'migration housekeeping is omitted from product cards');
  assert.equal(cards()[2].children[0].src,third.heroRef.url,'legacy hero is used when a suggestion has no scene ref');
  const jump=suggestions.queryAll('button').find(button=>button.dataset.action==='suggest-window'&&button.dataset.fromYear==='200');
  suggestions.listeners.click({target:{closest:()=>jump}});
  assert.equal(state.date,150); assert.equal(state.selectedEventId,'e-first'); assert.deepEqual(calls,[],'cached-window navigation is only a scroll target');
  const group=suggestions.queryAll('section').find(item=>item.dataset.windowKey==='200:299');
  assert.equal(group.focused,true); assert.equal(group.scrolled,true);
  const jumpAll=timeline.queryAll('button').find(button=>button.dataset.action==='jump-suggestions');
  timeline.listeners.click({target:{closest:()=>jumpAll}});
  assert.equal(suggestions.scrolled,true,'the always-visible suggestion shortcut scrolls the gallery into view');
  assert.equal(suggestions.queryAll('button').find(button=>button.dataset.action==='toggle-gallery').getAttribute('aria-expanded'),'true');
  assert.deepEqual(cards().map(card=>card.dataset.suggestionId),['s-first','s-second','s-third'],'the expanded board preserves one chronological card list across windows');
  assert.match(suggestions.textContent,/All saved suggestions · oldest first/);
  const inspectTitle=cards()[0].queryAll('button').find(button=>button.dataset.action==='select-suggestion');
  assert.equal(inspectTitle.getAttribute('aria-pressed'),'false');
  suggestions.listeners.click({target:{closest:()=>inspectTitle}});
  assert.deepEqual(inspected,['s-first'],'the title is the direct keyboard and click inspection target');
  suggestions.listeners.click({target:{closest:selector=>selector==='button[data-action]'?null:selector==='article.history-timeline-suggestion'?cards()[0]:null}});
  assert.deepEqual(inspected,['s-first','s-first'],'clicking the saved thumbnail also selects the suggestion without weaving it');
  const selectedDetails=timeline.queryAll('details').find(details=>details.queryAll('button').some(button=>button.dataset.id==='e-selected'));
  selectedDetails.open=false; selectedDetails.listeners.toggle();
  state.selectedEventId='e-selected'; mounted.render(state);
  assert.equal(timeline.queryAll('details').find(details=>details.queryAll('button').some(button=>button.dataset.id==='e-selected')).open,true,'a newly selected event reopens its era');
  assert.equal(timeline.queryAll('li').find(row=>row.dataset.eventId==='e-selected').scrolled,true,'a newly selected event scrolls into view');
});

test('batch preview resolves selected rows, reuses unchanged checks, toggles merges, and commits one plan', async () => {
  const fits=[event('fit-a',120,'Fit A',{verdict:'fits'}),event('fit-b',130,'Fit B',{verdict:'fits'})];
  const conflict=event('conflict',140,'Conflict',{verdict:'conflicts',conflictsWith:'anchor'});
  const history={id:'batch-history',events:[event('anchor',50,'Anchor')],suggestions:[...fits,conflict],suggestionWindows:[{window:{fromYear:100,toYear:199},status:'ready'}]};
  const state={questionId:'batch-question',question:{id:'batch-question',histories:[history]},history,histories:[history],historyId:history.id,date:150,window:{fromYear:100,toYear:199},suggestions:[...fits,conflict],windowCached:true};
  const calls=[], cachedPlans=new Map(); let checkCount=0;
  const plan={id:'plan-1',questionId:'batch-question',historyId:history.id,suggestionIds:['fit-a','fit-b'],
    existingEventIds:['anchor'],existingEvents:[{id:'anchor',year:50}],
    chain:[{...fits[0],causeEventId:'anchor'},{...fits[1],causeEventId:'fit-a'}],
    merges:[{id:'merge-ab',suggestionIds:['fit-a','fit-b'],title:'Combined possibility',summary:'Together'}],conflicts:[]};
  const session={checkWeaveBatch:async ids=>{const key=ids.join(',');if(!cachedPlans.has(key)){checkCount++;calls.push(['check',ids]);cachedPlans.set(key,plan);}return cachedPlans.get(key);},
    commitWeaveBatch:async body=>{calls.push(['commit',body]);return {history};},more:()=>calls.push(['more']),getState:()=>({status:''})};
  const root=new Element('main',document), mounted=mountHistoryTimeline(root,{getState:()=>state,session,document});
  const suggestions=mounted.element.children[2];
  const checks=()=>suggestions.queryAll('input').filter(input=>input.dataset.batchSuggestion);
  assert.deepEqual(checks().filter(input=>input.checked).map(input=>input.dataset.batchSuggestion),['fit-a','fit-b']);
  assert.equal(checks().find(input=>input.dataset.batchSuggestion==='conflict').checked,false);
  assert.equal(checks().find(input=>input.dataset.batchSuggestion==='conflict').disabled,true);
  let fitA=checks().find(input=>input.dataset.batchSuggestion==='fit-a'); fitA.checked=false;
  suggestions.listeners.change({target:fitA});
  mounted.render(state);
  assert.equal(checks().find(input=>input.dataset.batchSuggestion==='fit-a').checked,false,'refresh rendering preserves an explicit deselection');
  const selectNone=suggestions.querySelectorAll('button[data-action]').find(button=>button.dataset.action==='batch-select-none');
  await suggestions.listeners.click({target:{closest:()=>selectNone}});
  assert.equal(suggestions.querySelectorAll('button[data-action]').find(button=>button.dataset.action==='batch-preview').textContent,'Weave 0',
    'Select none updates the tray through the native querySelectorAll path');
  const selectAll=suggestions.querySelectorAll('button[data-action]').find(button=>button.dataset.action==='batch-select-all');
  await suggestions.listeners.click({target:{closest:()=>selectAll}});
  assert.equal(suggestions.querySelectorAll('button[data-action]').find(button=>button.dataset.action==='batch-preview').textContent,'Weave 2',
    'Select all updates the tray through the native querySelectorAll path');
  const preview=suggestions.querySelectorAll('button[data-action]').find(button=>button.dataset.action==='batch-preview');
  assert.equal(preview.textContent,'Weave 2');
  assert.equal(preview.getAttribute('aria-label'),'Weave 2 selected suggestions into history');
  await suggestions.listeners.click({target:{closest:()=>preview}});
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
  await suggestions.listeners.click({target:{closest:()=>reopen}});
  assert.equal(checkCount,1,'cancel and reopen with unchanged selection reuses the session plan');
  const merge=panel.querySelectorAll('button[data-action]').find(button=>button.dataset.action==='batch-merge-toggle');
  await panel.listeners.click({target:{closest:()=>merge}});
  const commit=panel.querySelectorAll('button[data-action]').find(button=>button.dataset.action==='batch-commit');
  await panel.listeners.click({target:{closest:()=>commit}});
  assert.deepEqual(calls.slice(0,2),[['check',['fit-a','fit-b']],['commit',{suggestionIds:['fit-a','fit-b'],planId:'plan-1',acceptedMergeIds:['merge-ab'],excludedSuggestionIds:[]}]]);
  const more=suggestions.queryAll('button').find(button=>button.dataset.action==='manual-more');
  assert.equal(more.getAttribute('aria-label'),'Find more suggestions around 150 CE');
  await suggestions.listeners.click({target:{closest:()=>more}});
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
  await suggestions.listeners.click({target:{closest:()=>preview}});
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
  const autoWeave=suggestions.queryAll('input').find(input=>input.dataset.autoWeave==='true');
  assert.equal(autoWeave.checked,false,'auto-weave is opt-in by default');
  autoWeave.checked=true; suggestions.listeners.change({target:autoWeave});
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
  assert.equal(action.textContent,'Weave 1');
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

test('multiple histories open an inline comparison with event-based distinctions and explicit selection', () => {
  const sharedOne=event('shared-one',1650,'Doggerland Plain Links Britain Europe');
  const sharedTwo=event('shared-two',1800,'Sundaland River Plain Unites Islands',{causeEventId:'shared-one'});
  const histories=Array.from({length:7},(_,index)=>({id:`h${index+1}`,events:[sharedOne,sharedTwo,event(`unique-${index+1}`,1840+index,`Timeline ${index+1} unique event`,{causeEventId:'shared-two'}),event(`latest-${index+1}`,1900+index,`Timeline ${index+1} latest event`)]}));
  const state={question:{...question,histories},history:histories[2],histories,historyId:'h3',date:1976,selectedEventId:'unique-3'},changes=[];
  const root=new Element('main',document), rail={scrollTop:83}; root.closest=selector=>selector==='.exploration-rail'?rail:null;
  const mounted=mountHistoryTimeline(root,{getState:()=>state,onHistoryChange:(id,index)=>changes.push([id,index]),document});
  mounted.element.closest=selector=>selector==='.exploration-rail'?rail:null;
  const tabs=mounted.element.children[0], timeline=mounted.element.children[1], suggestions=mounted.element.children[2], comparison=mounted.element.children[4];
  assert.match(tabs.textContent,/Timeline 3 of 7/); assert.match(tabs.textContent,/Timeline 3 unique event/); assert.match(tabs.textContent,/4 events/);
  assert.equal(tabs.queryAll('select').length,0); assert.equal(tabs.queryAll('button').length,1);
  const compare=tabs.queryAll('button')[0]; tabs.listeners.click({target:{closest:()=>compare}});
  assert.equal(rail.scrollTop,0,'opening comparison moves to the chooser heading');
  assert.equal(comparison.hidden,false); assert.equal(timeline.hidden,true); assert.equal(suggestions.hidden,true);
  const backOnOpen=comparison.queryAll('button').find(node=>node.dataset.action==='back-to-timeline');
  assert.equal(backOnOpen.focused,true,'opening comparison moves focus to Back');
  assert.deepEqual(backOnOpen.focusOptions,{preventScroll:true},'focus stays within the chooser without scrolling the outer rail');
  assert.match(comparison.textContent,/Events in one timeline happen together/);
  assert.match(comparison.textContent,/Suggestions are not a new timeline unless you fork one/);
  const cards=comparison.children[3]; assert.equal(cards.children.length,7);
  assert.equal(cards.children[2].scrolled,undefined,'the active card is scrolled inside the cards list, never with page-level scrollIntoView');
  assert.match(cards.children[2].children[1].className,/\bhistory-timeline-choice-open\b/,'the choice button uses the wrapping title/year layout');
  assert.equal(cards.children[2].children[1].children[0].className,'history-timeline-choice-title');
  assert.equal(cards.children[2].children[1].children[1].textContent,'1,842 CE','the distinguishing year has its own line');
  assert.match(cards.children[2].textContent,/Shares 2 opening events through 1,800 CE/);
  assert.match(cards.children[2].textContent,/Timeline 3 unique event.*1,842 CE/);
  assert.match(cards.children[2].textContent,/Latest: 1,902 CE.*Timeline 3 latest event/);
  assert.match(cards.children[2].textContent,/4 events/);
  assert.deepEqual(changes,[],'opening compare does not switch histories');
  const back=comparison.queryAll('button').find(node=>node.dataset.action==='back-to-timeline');
  comparison.listeners.click({target:{closest:()=>back}});
  assert.equal(comparison.hidden,true); assert.equal(timeline.hidden,false); assert.equal(suggestions.hidden,false);
  assert.equal(rail.scrollTop,83,'Back restores the timeline rail position');
  assert.equal(tabs.queryAll('button').find(node=>node.dataset.action==='compare-timelines').focused,true,'Back returns focus to Compare');
  const date=state.date, selected=state.selectedEventId;
  const compareAgain=tabs.queryAll('button').find(node=>node.dataset.action==='compare-timelines');
  tabs.listeners.click({target:{closest:()=>compareAgain}});
  const closedByEscape=mounted.element.keydown('Escape');
  assert.equal(closedByEscape.prevented,true); assert.equal(closedByEscape.stopped,true);
  assert.equal(state.date,date); assert.equal(state.selectedEventId,selected); assert.deepEqual(changes,[]);
  const compareFinal=tabs.queryAll('button').find(node=>node.dataset.action==='compare-timelines');
  tabs.listeners.click({target:{closest:()=>compareFinal}});
  const finalCards=comparison.children[3];
  const choose=finalCards.queryAll('button').find(node=>node.dataset.historyId==='h6');
  comparison.listeners.click({target:{closest:()=>choose}});
  assert.deepEqual(changes,[['h6','5']],'a card selects the canonical history ID and index');
  assert.equal(tabs.queryAll('button').find(node=>node.dataset.action==='compare-timelines').focused,true,'card selection returns focus to the updated timeline summary');
  assert.equal(state.date,date); assert.equal(state.selectedEventId,selected,'the chooser itself does not alter date or selected event');
});

test('a single history has no timeline comparison chooser', () => {
  const only={id:'only-history',events:[event('only-event',50,'One saved event')]};
  const state={question:{id:'only-question',histories:[only]},histories:[only],history:only,historyId:only.id,date:50,selectedEventId:'only-event'};
  const mounted=mountHistoryTimeline(new Element('main',document),{getState:()=>state,document});
  assert.equal(mounted.element.children[0].hidden,true);
  assert.equal(mounted.element.children[0].queryAll('button').length,0);
});

test('comparison cards distinguish histories from saved event paths instead of fork-year labels', () => {
  const histories = [
    { id:'root', events:[event('cause-1978',1978,'Root cause'),event('later',1994,'Later root event',{causeEventId:'cause-1978'})] },
    { id:'forked', forkEventId:'replaced-event', origin:{forkYear:1978}, events:[event('cause-1978',1978,'Shared cause')] },
  ];
  const state = { question:{id:'q',title:'Question',histories}, histories, history:histories[1], historyId:'forked', selectedEventId:'cause-1978', date:1978 };
  const root = new Element('main',document), mounted = mountHistoryTimeline(root,{getState:()=>state,document});
  assert.match(mounted.element.children[0].textContent,/Timeline 2 of 2/);
  assert.doesNotMatch(mounted.element.children[0].textContent,/from 1,978 CE/);
  mounted.element.children[0].listeners.click({target:{closest:()=>mounted.element.children[0].queryAll('button')[0]}});
  assert.match(mounted.element.children[4].textContent,/Shares 1 opening event through 1,978 CE/);
  state.date=2402; mounted.render(state);
  assert.match(mounted.element.children[4].textContent,/Shares 1 opening event through 1,978 CE/);
  assert.doesNotMatch(mounted.element.children[4].textContent,/from 2,402 CE/);
});

test('deck review keeps list selection separate, routes keyboard and button decisions, scopes held suggestions, and reviews kept IDs', async () => {
  const suggestions=[
    event('deck-a',110,'First deck source',{verdict:'fits'}),
    event('deck-b',120,'Second deck source',{verdict:'fits'}),
    event('deck-c',130,'Third deck source',{verdict:'conflicts',conflictsWith:'anchor'}),
  ];
  const history={id:'deck-history',events:[],suggestions};
  const state={questionId:'deck-question',question:{id:'deck-question',histories:[history]},history,histories:[history],historyId:history.id,suggestions};
  const calls=[], held=[];
  const plan={id:'deck-plan',questionId:state.questionId,historyId:history.id,suggestionIds:['deck-a','deck-b'],existingEventIds:[state.questionId],existingEvents:[],
    chain:[{...suggestions[0],causeEventId:state.questionId},{...suggestions[1],causeEventId:'deck-a'}],merges:[],conflicts:[]};
  const session={setHeldSuggestionIds(ids){state.heldSuggestionIds=[...ids];held.push([...ids]);},checkWeaveBatch:async ids=>{calls.push(['check',[...ids]]);return plan;},getState:()=>({status:''})};
  const root=new Element('main',document), mounted=mountHistoryTimeline(root,{getState:()=>state,session,document});
  const timeline=mounted.element.children[1], tray=mounted.element.children[2], portal=root.children.find(node=>node.className==='history-suggestion-deck-portal');
  const listChecks=()=>tray.queryAll('input').filter(input=>input.dataset.batchSuggestion);
  assert.deepEqual(listChecks().filter(input=>input.checked).map(input=>input.dataset.batchSuggestion),['deck-a','deck-b'],'conflicts remain excluded from the independent list batch selection');
  const mode=tray.queryAll('button').find(node=>node.dataset.action==='deck-mode-deck');
  await tray.listeners.click({target:{closest:()=>mode}});
  let card=portal.queryAll('article').find(node=>node.dataset.swipeCard==='true');
  assert.equal(card.dataset.suggestionId,'deck-a','the deck starts with the first chronological unreviewed source');
  assert.equal(card.queryAll('span').some(node=>String(node.className).includes('history-verdict')),false,'starting-point decks hide fit/conflict verdict labels');
  portal.listeners.keydown({key:'ArrowRight',target:card,preventDefault(){},stopPropagation(){}});
  assert.equal(state.heldSuggestionIds[0],'deck-a','right arrow keeps and synchronizes the active owner held set');
  card=portal.queryAll('article').find(node=>node.dataset.swipeCard==='true');
  assert.equal(card.dataset.suggestionId,'deck-b');
  portal.listeners.keydown({key:'ArrowLeft',target:card,preventDefault(){},stopPropagation(){}});
  assert.deepEqual(held.at(-1),['deck-a'],'passing a card does not add it to held suggestion IDs');
  const passedToggle=portal.queryAll('button').find(node=>node.dataset.action==='deck-passed-toggle');
  await portal.listeners.click({target:{closest:()=>passedToggle}});
  const passedRow=portal.queryAll('div').find(node=>node.className==='history-deck-passed-row');
  assert.ok(passedRow.queryAll('button').some(node=>node.dataset.action==='deck-weave'),'passed suggestions remain individually weaveable');
  assert.ok(passedRow.queryAll('button').some(node=>node.dataset.action==='deck-rekeep'),'a passed fitting suggestion can be re-kept');
  const undo=tray.queryAll('button').find(node=>node.dataset.action==='deck-undo');
  await tray.listeners.click({target:{closest:()=>undo}});
  card=portal.queryAll('article').find(node=>node.dataset.swipeCard==='true');
  assert.equal(card.dataset.suggestionId,'deck-b','Undo restores the prior card to the unreviewed deck');
  const keep=card.queryAll('button').find(node=>node.dataset.action==='deck-keep');
  await portal.listeners.click({target:{closest:()=>keep}});
  assert.deepEqual(state.heldSuggestionIds,['deck-a','deck-b'],'the card Keep button uses the same state decision path');
  assert.deepEqual(listChecks().filter(input=>input.checked).map(input=>input.dataset.batchSuggestion),['deck-a','deck-b'],'deck decisions do not rewrite the list checkbox selection');
  const review=tray.queryAll('button').find(node=>node.dataset.action==='deck-review-kept');
  await tray.listeners.click({target:{closest:()=>review}});
  assert.deepEqual(calls,[['check',['deck-a','deck-b']]],'Review kept checks kept deck IDs, not the current list selection set');
  assert.match(mounted.element.children[3].textContent,/2 selected suggestions/);
  const cancel=mounted.element.children[3].queryAll('button').find(node=>node.dataset.action==='batch-cancel');
  await mounted.element.children[3].listeners.click({target:{closest:()=>cancel}});
  assert.equal(mounted.element.children[3].hidden,true);
  assert.equal(portal.hidden,false,'cancel returns to the same deck without auto-opening another preview');
  assert.equal(portal.queryAll('article').find(node=>node.dataset.swipeCard==='true').dataset.suggestionId,'deck-c');
  assert.equal(timeline.queryAll('li').length,0);
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

test('deck portal keeps review shortcuts available, folds the compact rail, and does not repeat empty-deck preview after cancel', async () => {
  const doc={createElement(tag){return new Element(tag,doc);},createTextNode(text){return {textContent:String(text),queryAll:()=>[]};},defaultView:{innerWidth:375,innerHeight:812,addEventListener(){},removeEventListener(){}}};
  doc.body=new Element('body',doc);
  const sources=[event('fit-one',110,'First fit',{verdict:'fits'}),event('fit-two',120,'Second fit',{verdict:'fits'})];
  const history={id:'shortcut-history',events:[],suggestions:sources};
  const state={questionId:'shortcut-question',question:{id:'shortcut-question',histories:[history]},history,histories:[history],historyId:history.id,suggestions:sources};
  const plan={id:'shortcut-plan',questionId:state.questionId,historyId:history.id,suggestionIds:sources.map(item=>item.id),existingEventIds:[state.questionId],existingEvents:[],
    chain:sources.map((item,index)=>({...item,causeEventId:index?sources[index-1].id:state.questionId})),merges:[],conflicts:[]};
  const checked=[]; let cachedPlan=null;
  const session={setHeldSuggestionIds(ids){state.heldSuggestionIds=[...ids];},checkWeaveBatch:async ids=>{if(!cachedPlan){checked.push([...ids]);cachedPlan=plan;}return cachedPlan;},getState:()=>({status:''})};
  const root=new Element('main',doc), mounted=mountHistoryTimeline(root,{getState:()=>state,session,document:doc,isCompact:()=>true});
  const tray=mounted.element.children[2], portal=doc.body.children.find(node=>node.className==='history-suggestion-deck-portal');
  const mode=tray.queryAll('button').find(node=>node.dataset.action==='deck-mode-deck');
  const panel=mounted.element.children[3];
  await tray.listeners.click({target:{closest:()=>mode}});
  assert.equal(doc.body.classList.contains('history-phone-deck-active'),true,'compact deck mode folds the rail behind the globe');
  assert.equal(tray.queryAll('button').find(node=>node.dataset.action==='deck-keep-all-fits').hidden,true,'portal actions have no duplicate visible rail controls');
  for (let index=0;index<sources.length;index++) {
    const pass=portal.queryAll('button').find(node=>node.dataset.action==='deck-pass');
    assert.ok(pass);
    await portal.listeners.click({target:{closest:()=>pass}});
  }
  assert.equal(portal.queryAll('article').filter(node=>node.dataset.swipeCard==='true').length,0,'all fitting cards have been passed');
  assert.equal(tray.queryAll('button').find(node=>node.dataset.action==='deck-keep-all-fits').disabled,false,'list shortcut can recover fits when every card is passed');
  const keepAll=portal.queryAll('button').find(node=>node.dataset.action==='deck-keep-all-fits');
  assert.ok(keepAll,'Keep all fits remains available directly in the deck portal');
  assert.equal(keepAll.disabled,false,'portal shortcut can recover fits when every card is passed');
  await portal.listeners.click({target:{closest:()=>keepAll}});
  assert.deepEqual(checked,[['fit-one','fit-two']],'empty-deck transition previews only the newly kept IDs');
  assert.equal(panel.hidden,false);
  const cancel=panel.queryAll('button').find(node=>node.dataset.action==='batch-cancel');
  await panel.listeners.click({target:{closest:()=>cancel}});
  assert.equal(panel.hidden,true); assert.equal(portal.hidden,false);
  assert.equal(checked.length,1,'cancel does not automatically reopen an empty-deck preview');
  const review=portal.queryAll('button').find(node=>node.dataset.action==='deck-review-kept');
  await portal.listeners.click({target:{closest:()=>review}});
  assert.equal(checked.length,1,'explicit Review kept reuses the same selection check');
  const back=portal.queryAll('button').find(node=>node.dataset.action==='deck-list');
  await portal.listeners.click({target:{closest:()=>back}});
  assert.equal(doc.body.classList.contains('history-phone-deck-active'),false,'Back to list restores the phone history rail');
});

test('successful weave source removal clears held IDs after the outer render without duplicating the suggestion tray', async () => {
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
  const tray=mounted.element.children[2];
  assert.match(tray.queryAll('button').find(node=>node.dataset.action==='suggest-window').textContent,/1 · 100 CE to 199 CE/,'cached generation count does not inflate the visible unwoven count');
  const mode=tray.queryAll('button').find(node=>node.dataset.action==='deck-mode-deck');
  await tray.listeners.click({target:{closest:()=>mode}});
  const portal=root.children.find(node=>node.className==='history-suggestion-deck-portal');
  const keep=portal.queryAll('button').find(node=>node.dataset.action==='deck-keep');
  await portal.listeners.click({target:{closest:()=>keep}});
  assert.deepEqual(state.heldSuggestionIds,['emit-source']);
  const review=portal.queryAll('button').find(node=>node.dataset.action==='deck-review-kept');
  await portal.listeners.click({target:{closest:()=>review}});
  const panel=mounted.element.children[3];
  const commit=panel.queryAll('button').find(node=>node.dataset.action==='batch-commit');
  await panel.listeners.click({target:{closest:()=>commit}});
  assert.deepEqual(state.heldSuggestionIds,[],'commit source removal clears owner held IDs through the emitting session');
  assert.equal(heldUpdates,2,'one keep and one source-removal reconciliation each emit once');
  assert.equal(tray.queryAll('h3').filter(node=>node.textContent==='Saved suggestions · 0').length,1,'the finished render tree contains one heading');
  assert.equal(tray.queryAll('input').filter(node=>node.dataset.autoSuggest==='true').length,1,'auto-suggest control is not duplicated');
  assert.equal(tray.queryAll('input').filter(node=>node.dataset.autoWeave==='true').length,1,'auto-weave control is not duplicated');
  assert.equal(tray.queryAll('button').filter(node=>node.dataset.action==='batch-preview').length,1,'the weave tray is not duplicated');
  assert.equal(tray.queryAll('button').filter(node=>node.dataset.action==='suggest-window').length,0,'a cached window with no unwoven sources has no jump chip');
  assert.equal(portal.hidden,false,'the empty deck shows its quiet completion state');
  assert.match(portal.textContent,/No unwoven suggestions remain in this window/);
  assert.equal(portal.queryAll('button').find(node=>node.dataset.action==='deck-undo').disabled,true,'removed suggestions cannot be restored by stale deck undo');
});
