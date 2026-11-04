import test from 'node:test';
import assert from 'node:assert/strict';
import { createHistoryTimeScale, mountHistoryTimebar, collectHistoryEraTicks, eventTickPositions, historyEraTickSegments } from '../web/historyTimebar.js';

class Element {
  constructor(tag, document) { this.tagName = tag; this.ownerDocument = document; this.children = []; this.dataset = {}; this.listeners = {}; this.attributes = {}; this.style = {}; this.value = ''; this.hidden = false; }
  set textContent(value) { this._text = String(value); this.children = []; }
  get textContent() { return (this._text || '') + this.children.map(node => node.textContent || '').join(''); }
  append(...nodes) { this.children.push(...nodes); }
  replaceChildren(...nodes) { this.children = nodes; }
  setAttribute(key,value) { this.attributes[key] = String(value); }
  addEventListener(type,fn) { this.listeners[type]=fn; }
  queryAll(tag) { return [...(this.tagName===tag?[this]:[]),...this.children.flatMap(node=>node.queryAll?.(tag)||[])]; }
  closest(selector) { return selector === 'button[data-year]' && this.tagName==='button' && this.dataset.year ? this : null; }
}
const document = { createElement(tag) { return new Element(tag,document); } };
const events = [
  { id:'bce', year:-3000, title:'First event', era:'Green era' },
  { id:'ce', year:1500, title:'Later event', era:'Coastal era' },
  { id:'ce-2', year:2000, title:'Last event', era:'Coastal era' },
];

test('time scale skips year zero and maps BCE and CE dates back to exact slider indexes', () => {
  const scale = createHistoryTimeScale(events, -100);
  for (const year of [-3000,-1,1,1500,2000]) assert.equal(scale.yearAt(scale.indexAt(year)),year);
  assert.equal(scale.crossesZero,true);
  assert.equal(scale.yearAt(scale.indexAt(-1)+1),1);
  assert.deepEqual(collectHistoryEraTicks(events), [{ label:'Green era',year:-3000 },{ label:'Coastal era',year:1500 }]);
});

test('datebar era ticks use the timeline current gap-derived groups', () => {
  const staleGeneratedEras = [
    {id:'old',year:-1800,title:'First',era:'Era 1 · 1,800 BCE–1,400 BCE'},
    {id:'middle',year:-1400,title:'Middle',era:'Era 1 · 1,800 BCE–1,400 BCE'},
    {id:'inserted',year:-1000,title:'Inserted',era:'Era 1 · 1,000 BCE'},
  ];
  assert.deepEqual(collectHistoryEraTicks(staleGeneratedEras), [{label:'Era 1 · 1800 BCE–1000 BCE',year:-1800}]);
});

test('dense event dates keep separate tick targets while preserving their chronological order', () => {
  const dense = [{id:'1978',year:1978,title:'First'}, {id:'1994',year:1994,title:'Second'}, {id:'2003',year:2003,title:'Third'}];
  const scale = createHistoryTimeScale(dense,1978,{extraYears:[-3000,4000]});
  const positions = eventTickPositions(dense,scale,320);
  assert.ok(Math.abs(positions.get('1994') - positions.get('1978') - 32) < 1e-6);
  assert.ok(Math.abs(positions.get('2003') - positions.get('1994') - 32) < 1e-6);
});

test('canonical era labels each own a non-overlapping stretch across the date track', () => {
  const eras = [
    { id:'a', year:-3000, title:'A', era:'Era A' },
    { id:'b', year:-2990, title:'B', era:'Era A' },
    { id:'c', year:-1000, title:'C', era:'Era B' },
    { id:'d', year:100, title:'D', era:'Era C' },
  ];
  const scale = createHistoryTimeScale(eras);
  const segments = historyEraTickSegments(eras, scale);
  assert.equal(segments.length, 3);
  assert.equal(segments[0].left, scale.indexAt(eras[0].year) / scale.maxIndex * 100);
  assert.equal(segments.at(-1).left + segments.at(-1).width, scale.indexAt(eras.at(-1).year) / scale.maxIndex * 100);
  for (let index = 1; index < segments.length; index++) {
    assert.ok(segments[index - 1].left + segments[index - 1].width <= segments[index].left + 1e-9);
  }
});

test('a BCE history and its cached window never prevent scrubbing into the unwritten CE future', () => {
  const ancient = [{id:'first',year:-245,title:'First'},{id:'latest',year:-22,title:'Latest'}];
  const scale = createHistoryTimeScale(ancient,-1,{windows:[{fromYear:-1000,toYear:-1}]});
  assert.equal(scale.minYear,-10000);
  assert.equal(scale.maxYear,3000);
  for (const year of [-10000,-245,-1,1,1500,2500,3000]) assert.equal(scale.yearAt(scale.indexAt(year)),year);
  const expanded = createHistoryTimeScale([{id:'older',year:-20000}],5000);
  assert.equal(expanded.minYear,-20000); assert.equal(expanded.maxYear,5000);
});

test('timebar date scrub, event ticks and arrows notify selected as-of date without generating on hover', () => {
  const state={ questionId:'q', question:{ id:'q' }, history:{ id:'h', events }, selectedEventId:'bce', date:-100, window:{} };
  const root=new Element('main',document), dates=[], selected=[];
  const mounted=mountHistoryTimebar(root,{ getState:()=>state, document, onDateChange:(year,meta)=>dates.push([year,meta.source]), onEventSelect:id=>selected.push(id) });
  const slider=mounted.element.queryAll('input')[0];
  const stableSlider = slider;
  slider.value=String(createHistoryTimeScale(events,-100).indexAt(1)); slider.listeners.input();
  assert.equal(dates.at(-1)[0],1); assert.equal(dates.at(-1)[1],'scrub');
  slider.value=String(createHistoryTimeScale(events,-100).indexAt(2500)); slider.listeners.input();
  assert.equal(dates.at(-1)[0],2500,'future dates reach the existing context-aware suggestion flow');
  assert.match(mounted.element.textContent,/Unwritten future/);
  slider.value=String(createHistoryTimeScale(events,-100).indexAt(1000));
  slider.listeners.keydown({ key:'ArrowRight', preventDefault(){} });
  assert.equal(dates.at(-1)[0],1500); assert.equal(dates.at(-1)[1],'event-step');
  state.date = 1500; mounted.render(state);
  assert.equal(mounted.element.queryAll('input')[0], stableSlider, 'date updates preserve the native range node during a pointer drag');
  const tick=mounted.element.children[1].children[2].children.find(item=>item.dataset.eventId==='ce');
  mounted.element.children[1].children[2].listeners.click({ target:tick });
  assert.deepEqual(selected,['ce']); assert.equal(dates.at(-1)[0],1500); assert.equal(dates.at(-1)[1],'event-tick');
  assert.equal(mounted.element.queryAll('button').length,5, 'era and event ticks are available as direct date controls');
});
