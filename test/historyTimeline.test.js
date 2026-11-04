import test from 'node:test';
import assert from 'node:assert/strict';
import { mountHistoryTimeline, groupHistoryEras } from '../web/historyTimeline.js';

class Element {
  constructor(tag, document) { this.tagName = tag; this.ownerDocument = document; this.children = []; this.dataset = {}; this.listeners = {}; this.attributes = {}; this.style = {}; this.hidden = false; this.selected = false; this.value = ''; }
  set textContent(value) { this._text = String(value); this.children = []; }
  get textContent() { return (this._text || '') + this.children.map(node => node.textContent || '').join(''); }
  append(...nodes) { for (const node of nodes) { node.parentNode?.children?.splice(node.parentNode.children.indexOf(node),1); node.parentNode=this; this.children.push(node); } }
  replaceChildren(...nodes) { for (const child of this.children) if (child.parentNode===this) child.parentNode=null; this.children=[]; this.append(...nodes); }
  insertBefore(node, reference) { node.parentNode?.children?.splice(node.parentNode.children.indexOf(node),1); const index=this.children.indexOf(reference); node.parentNode=this; this.children.splice(index<0?this.children.length:index,0,node); return node; }
  setAttribute(key, value) { this.attributes[key] = String(value); }
  getAttribute(key) { return this.attributes[key] ?? null; }
  addEventListener(type, fn) { this.listeners[type] = fn; }
  matches(selector) { return selector === 'select[data-history-select]' && this.tagName === 'select' && this.dataset.historySelect === 'true'; }
  queryAll(tag) { return [...(this.tagName === tag ? [this] : []), ...this.children.flatMap(node => node.queryAll?.(tag) || [])]; }
  querySelectorAll(selector) { return selector === 'input[data-batch-suggestion]'
    ? this.queryAll('input').filter(input => input.dataset.batchSuggestion)
    : selector === 'input[data-preview-exclude]' ? this.queryAll('input').filter(input => input.dataset.previewExclude)
    : selector === 'button[data-action]' ? this.queryAll('button').filter(button => button.dataset.action) : []; }
  closest(selector) { return selector === 'button[data-action]' && this.tagName === 'button' && this.dataset.action || selector === 'button[data-history-id]' && this.tagName === 'button' && this.dataset.historyId ? this : null; }
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

test('all saved suggestion windows stay visible, window controls jump without moving date, and expanded board flattens chronologically', () => {
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
  assert.equal(suggestions.querySelectorAll('button[data-action]').find(button=>button.dataset.action==='batch-preview').textContent,'Weave 0 into history',
    'Select none updates the tray through the native querySelectorAll path');
  const selectAll=suggestions.querySelectorAll('button[data-action]').find(button=>button.dataset.action==='batch-select-all');
  await suggestions.listeners.click({target:{closest:()=>selectAll}});
  assert.equal(suggestions.querySelectorAll('button[data-action]').find(button=>button.dataset.action==='batch-preview').textContent,'Weave 2 into history',
    'Select all updates the tray through the native querySelectorAll path');
  const preview=suggestions.querySelectorAll('button[data-action]').find(button=>button.dataset.action==='batch-preview');
  assert.equal(preview.textContent,'Weave 2 into history');
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
