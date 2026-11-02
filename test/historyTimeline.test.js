import test from 'node:test';
import assert from 'node:assert/strict';
import { mountHistoryTimeline, groupHistoryEras } from '../web/historyTimeline.js';

class Element {
  constructor(tag, document) { this.tagName = tag; this.ownerDocument = document; this.children = []; this.dataset = {}; this.listeners = {}; this.attributes = {}; this.style = {}; this.hidden = false; this.selected = false; this.value = ''; }
  set textContent(value) { this._text = String(value); this.children = []; }
  get textContent() { return (this._text || '') + this.children.map(node => node.textContent || '').join(''); }
  append(...nodes) { this.children.push(...nodes); }
  replaceChildren(...nodes) { this.children = nodes; }
  setAttribute(key, value) { this.attributes[key] = String(value); }
  addEventListener(type, fn) { this.listeners[type] = fn; }
  matches(selector) { return selector === 'select[data-history-select]' && this.tagName === 'select' && this.dataset.historySelect === 'true'; }
  queryAll(tag) { return [...(this.tagName === tag ? [this] : []), ...this.children.flatMap(node => node.queryAll?.(tag) || [])]; }
  closest(selector) { return selector === 'button[data-action]' && this.tagName === 'button' && this.dataset.action || selector === 'button[data-history-id]' && this.tagName === 'button' && this.dataset.historyId ? this : null; }
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
  assert.match(mounted.element.textContent, /Could slot in around 1,000 BCE/);
  assert.match(mounted.element.textContent, /Fits beside the dry season/);
  assert.match(mounted.element.textContent, /Would reverse the dry spell/);
  const timeline = mounted.element.children[1], suggestions = mounted.element.children[2];
  const details = timeline.children[1]; assert.equal(details.open, true, 'the selected event era opens on first view');
  details.open = false; details.listeners.toggle(); state.date = -950; mounted.render(state);
  assert.equal(timeline.children[1].open, false, 'manual era folding is preserved across date changes');
  const click = async (container, action, id) => container.listeners.click({ target:{ closest:() => ({ dataset:{ action, id, wovenId:'woven-1' } }) } });
  await click(timeline,'keep','e3'); await click(timeline,'regenerate','e3'); await click(timeline,'fork-event','e3');
  await click(suggestions,'weave','s1'); await click(suggestions,'fork-suggestion','s2');
  assert.deepEqual(calls, [['keep','e3','woven-1'],['regenerate','e3','woven-1'],['forkEvent','e3'],['weave','s1'],['forkSuggestion','s2']]);
  const tabs = mounted.element.children[0]; assert.equal(tabs.queryAll('button').length, 2); assert.equal(tabs.queryAll('select').length, 0);
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

test('more than four histories use a dropdown; callbacks preserve explicit history ids', () => {
  const histories = Array.from({ length:5 }, (_, index) => ({ id:`h${index + 1}`, events:[event(`e${index}`,index + 1,`Event ${index}`)] }));
  const state = { question:{ ...question, histories }, history:histories[2], historyId:'h3', date:3, selectedEventId:'e2' }, changes = [];
  const root = new Element('main', document);
  mountHistoryTimeline(root, { getState:() => state, onHistoryChange:(id,index) => changes.push([id,index]), document });
  const select = root.children[0].children[0].queryAll('select')[0];
  assert.ok(select); select.value='h5'; select.selectedOptions=[{ dataset:{ index:'4' } }]; root.children[0].children[0].listeners.change({ target:select });
  assert.deepEqual(changes, [['h5','4']]);
});

test('fork tab dates stay at the original fork year as the selected date moves', () => {
  const histories = [
    { id:'root', events:[event('cause-1978',1978,'Root cause'),event('later',1994,'Later root event',{causeEventId:'cause-1978'})] },
    { id:'forked', forkEventId:'replaced-event', origin:{forkYear:1978}, events:[event('cause-1978',1978,'Shared cause')] },
  ];
  const state = { question:{id:'q',title:'Question',histories}, histories, history:histories[1], historyId:'forked', selectedEventId:'cause-1978', date:1978 };
  const root = new Element('main',document), mounted = mountHistoryTimeline(root,{getState:()=>state,document});
  assert.match(mounted.element.children[0].children[1].textContent,/from 1,978 CE/);
  state.date=2402; mounted.render(state);
  assert.match(mounted.element.children[0].children[1].textContent,/from 1,978 CE/);
  assert.doesNotMatch(mounted.element.children[0].children[1].textContent,/from 2,402 CE/);
});
