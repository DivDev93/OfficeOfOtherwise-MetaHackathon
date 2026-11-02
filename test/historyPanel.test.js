import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { mountHistoryPanel } from '../web/historyPanel.js';

class Element {
  constructor(tagName, ownerDocument) { this.tagName = tagName; this.ownerDocument = ownerDocument; this.children = []; this.dataset = {}; this.listeners = {}; this.attributes = {}; this.hidden = false; this.disabled = false; this.checked = false; }
  set textContent(value) { this._text = String(value); this.children = []; }
  get textContent() { return (this._text || '') + this.children.map(item => item.textContent || '').join(''); }
  append(...nodes) { this.children.push(...nodes); }
  replaceChildren(...nodes) { this.children = nodes; }
  setAttribute(key, value) { this.attributes[key] = String(value); }
  addEventListener(type, fn) { this.listeners[type] = fn; }
  queryAll(tag) { return [...(this.tagName === tag ? [this] : []), ...this.children.flatMap(child => child.queryAll?.(tag) || [])]; }
  closest(selector) { return selector === 'button[data-action]' && this.tagName === 'button' && this.dataset.action ? this : null; }
}
const document = { createElement(tag) { return new Element(tag, document); }, createTextNode(text) { return { textContent: String(text), queryAll: () => [] }; } };
const app = readFileSync(new URL('../web/app.js', import.meta.url), 'utf8');
const html = readFileSync(new URL('../web/index.html', import.meta.url), 'utf8');

test('history session is wired to selected-event changes and rendered in the timeline and timebar, not hover previews', () => {
  assert.match(html, /id="history-timeline-host"/);
  assert.match(html, /id="history-timebar-host"/);
  assert.match(app, /import \{ createHistorySession \} from '\.\/historySession\.js'/);
  assert.match(app, /mountHistoryTimeline\(\$\('history-timeline-host'\)/);
  assert.match(app, /mountHistoryTimebar\(\$\('history-timebar-host'\)/);
  assert.match(app, /onHistoryChange:id => historySession\.selectHistory\(id\)/);
  assert.match(app, /historySession\.subscribe\(syncHistoryUi\)/);
  assert.match(app, /historySession\.setContext\(\{ questionId:activeAtlasRootId\(selectedManifest\) \|\| runId, eventId:`\$\{runId\}:\$\{branch\.id\}`, date:branch\.year \}\)/);
  const preview = app.slice(app.indexOf('function showBranchPreview'), app.indexOf('function renderStarMap'));
  assert.doesNotMatch(preview, /historySession\.(?:suggest|more|setContext)/, 'hover previews never schedule suggestion generation');
});

test('history panel uses text nodes for model content and wires weave, fork, Keep and regeneration actions', async () => {
  const root = new Element('main', document), calls = [];
  let listener;
  const state = { questionId:'q', historyId:'h', selectedEventId:'event-1', date:-2400, window:{ fromYear:-2900, toYear:-1900 },
    autoSuggest:true, loading:false, paused:false, status:'', busyIds:new Set(),
    history:{ events:[{ id:'event-1', year:-3000, title:'Anchor <img onerror=x>', checkFlags:[{ kind:'weave-ripple', message:'Review a later event.', wovenEventId:'event-2' }] }], suggestions:[] },
    suggestions:[{ id:'suggestion-1', year:-2200, title:'<script>alert(1)</script>', summary:'A possible result.', reason:'It fits.', verdict:'fits' }] };
  const session = { getState:() => state, subscribe(fn) { listener = fn; return () => {}; }, setAutoSuggest:value => calls.push(['pref', value]),
    suggest:() => calls.push(['suggest']), more:() => calls.push(['more']), weave:id => calls.push(['weave', id]), forkSuggestion:id => calls.push(['fork-suggestion', id]),
    forkEvent:id => calls.push(['fork-event', id]), keep:id => calls.push(['keep', id]), regenerate:(id, wovenId) => calls.push(['regenerate', id, wovenId]) };
  const mounted = mountHistoryPanel(root, session, { document });
  assert.match(mounted.element.textContent, /<script>alert\(1\)<\/script>/);
  assert.equal(mounted.element.queryAll('script').length, 0, 'untrusted content is only assigned as text');
  const actionButtons = mounted.element.queryAll('button').filter(button => button.dataset.action);
  for (const button of actionButtons) mounted.element.children[3].listeners.click({ target:button });
  await Promise.resolve();
  assert.ok(calls.some(call => call[0] === 'weave'));
  assert.ok(calls.some(call => call[0] === 'fork-event'));
  assert.ok(calls.some(call => call[0] === 'keep'));
  assert.ok(calls.some(call => call[0] === 'regenerate'));
  state.status = 'Updated'; listener(state); assert.match(mounted.element.textContent, /Updated/);
});
