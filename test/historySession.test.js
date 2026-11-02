import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createHistorySession } from '../web/historySession.js';

const suggestion = (id, window) => ({ id, year: -2400, title: id, summary: `${id} details`, verdict: 'fits', reason: 'Compatible.', window });
const history = (id, suggestions = []) => ({ id, events: [{ id: 'event-1', year: -3000, title: 'Anchor event', checkFlags: [] }], suggestions });
const response = value => ({ ok: true, json: async () => value });
const tick = async () => { await new Promise(resolve => setImmediate(resolve)); await new Promise(resolve => setImmediate(resolve)); };

function timers() {
  let next = 0; const jobs = new Map();
  return { setTimer(fn, ms) { const id = ++next; jobs.set(id, { fn, ms }); return id; }, clearTimer(id) { jobs.delete(id); },
    fire() { const job = [...jobs.values()].at(-1); if (!job) return false; jobs.clear(); job.fn(); return true; }, get size() { return jobs.size; }, get latestDelay() { return [...jobs.values()].at(-1)?.ms; } };
}

test('auto-suggest waits 800ms, reuses cached windows, and hover is inert', async () => {
  const clock = timers(), window = { fromYear: -2900, toYear: -1900 };
  const cached = suggestion('cached', window); let suggestions = 0;
  const session = createHistorySession({ setTimer: clock.setTimer, clearTimer: clock.clearTimer, fetchImpl: async (url, init) => {
    if (url === '/api/history/preferences') return response({ autoSuggest: true });
    if (url.startsWith('/api/histories')) return response({ questions: [{ id: 'q', histories: [history('h', [cached])] }] });
    if (url === '/api/history/suggest') { suggestions++; return response({ history: history('h', [cached]), suggestions: [cached] }); }
    throw new Error(url);
  } });
  session.setContext({ questionId: 'q', historyId: 'h', eventId: 'event-1', date: -2400 }); await tick();
  assert.equal(session.getState().suggestions[0].id, 'cached');
  assert.equal(clock.size, 0, 'a cached window does not regenerate');
  session.hover(); assert.equal(suggestions, 0);
  session.setContext({ questionId: 'q', historyId: 'h', eventId: 'later', date: -1000 });
  assert.equal(clock.latestDelay, 800);
  clock.fire(); await tick(); assert.equal(suggestions, 1, 'only an uncached window requests generation');
});

test('question and sibling-history selection preserve the global date and stay read-only', async () => {
  const clock = timers(), calls = [];
  const q1 = { id:'q1', histories:[history('h1'), history('h1-sibling', [{ id:'future', year:2003, title:'Future', window:{fromYear:1001,toYear:2000} }])] };
  const q2 = { id:'q2', histories:[{ id:'h2', events:[{ id:'older', year:100, title:'Older' }, { id:'latest', year:1500, title:'Latest' }] }] };
  const session = createHistorySession({ setTimer:clock.setTimer, clearTimer:clock.clearTimer, fetchImpl:async (url, init = {}) => {
    calls.push([url, init.method || 'GET']);
    if (url === '/api/history/preferences') return response({ autoSuggest:true });
    if (url.startsWith('/api/histories')) return response({ questions:[q1,q2] });
    throw new Error(`Unexpected request ${url}`);
  }});
  session.setContext({ questionId:'q1', historyId:'h1', eventId:'event-1', date:1978 }); await tick();
  session.selectHistory('h1-sibling'); await tick();
  assert.equal(session.getState().date,1978);
  session.selectQuestion('q2'); await tick();
  assert.equal(session.getState().questionId,'q2');
  assert.equal(session.getState().date,1978);
  assert.equal(session.getState().selectedEventId,'latest', 'select the latest event at or before the retained date');
  assert.equal(session.getState().questions.length,2);
  assert.equal(clock.size,0);
  assert.equal(calls.some(([url,method]) => url === '/api/history/suggest' || method === 'POST'), false);
});

test('opening an archived question without an active date uses only its stored divergence or event year', async () => {
  const session = createHistorySession({fetchImpl:async url=> url==='/api/history/preferences' ? response({autoSuggest:true}) : response({})});
  session.setQuestions([
    {id:'dated',divergenceYear:250,histories:[{id:'dated-h',events:[]}]},
    {id:'event-dated',histories:[{id:'event-h',events:[{id:'event',year:-900,title:'Saved event'}]}]},
    {id:'undated',histories:[{id:'empty-h',events:[]}]},
  ]);
  assert.equal(session.openQuestion('dated'),true); assert.equal(session.getState().date,250);
  session.clear(); session.setQuestions([
    {id:'dated',divergenceYear:250,histories:[{id:'dated-h',events:[]}]},
    {id:'event-dated',histories:[{id:'event-h',events:[{id:'event',year:-900,title:'Saved event'}]}]},
    {id:'undated',histories:[{id:'empty-h',events:[]}]},
  ]);
  assert.equal(session.openQuestion('event-dated'),true); assert.equal(session.getState().date,-900);
  session.clear(); session.setQuestions([{id:'undated',histories:[{id:'empty-h',events:[]}]}]);
  assert.equal(session.openQuestion('undated'),false,'the picker cannot invent a year for empty legacy data');
});

test('off preference exposes explicit Suggest and More is a separate metered request', async () => {
  const clock = timers(); const calls = [];
  const session = createHistorySession({ setTimer: clock.setTimer, clearTimer: clock.clearTimer, fetchImpl: async (url, init = {}) => {
    if (url === '/api/history/preferences') return response({ autoSuggest: false });
    if (url.startsWith('/api/histories')) return response({ questions: [{ id: 'q', histories: [history('h')] }] });
    if (url === '/api/history/suggest') {
      const body = JSON.parse(init.body); calls.push(body);
      const item = suggestion(`s${calls.length}`, body.window);
      return response({ history: history('h', [item]), suggestions: [item] });
    }
    throw new Error(url);
  } });
  session.setContext({ questionId: 'q', historyId: 'h', eventId: 'event-1', date: -2400 }); await tick();
  assert.equal(clock.size, 0);
  await session.suggest(); await session.more();
  assert.equal(calls.length, 2); assert.equal(calls[0].more, undefined); assert.equal(calls[1].more, true);
});

test('stale response from a prior history is ignored and session cap pauses auto-suggest', async () => {
  const clock = timers(); let releaseOld;
  const session = createHistorySession({ setTimer: clock.setTimer, clearTimer: clock.clearTimer, fetchImpl: async (url, init = {}) => {
    if (url === '/api/history/preferences') return response({ autoSuggest: true });
    if (url.startsWith('/api/histories')) {
      const q = new URL(`http://local${url}`).searchParams.get('asOfYear') === '-2400' ? 'q1' : 'q2';
      return response({ questions: [{ id: q, histories: [history(q === 'q1' ? 'h1' : 'h2')] }] });
    }
    if (url === '/api/history/suggest') {
      const body = JSON.parse(init.body);
      if (body.questionId === 'q1') return new Promise(resolve => { releaseOld = () => resolve(response({ history: history('h1', [suggestion('stale', body.window)]), suggestions: [suggestion('stale', body.window)] })); });
      return { ok: false, json: async () => ({ code: 'session_cap', error: 'Suggestion limit reached for this session' }) };
    }
    throw new Error(url);
  } });
  session.setContext({ questionId: 'q1', historyId: 'h1', eventId: 'event-1', date: -2400 }); await tick(); clock.fire(); await tick();
  session.setContext({ questionId: 'q2', historyId: 'h2', eventId: 'event-1', date: -1800 }); await tick(); clock.fire(); await tick();
  assert.equal(session.getState().paused, true); assert.match(session.getState().status, /limit/);
  releaseOld(); await tick(); assert.equal(session.getState().questionId, 'q2'); assert.equal(session.getState().suggestions.length, 0);
  assert.equal(clock.size, 0);
});

test('unwoven suggestions survive date changes and a different history gets its own cached state', async () => {
  const clock = timers(); const aWindow = { fromYear: -2900, toYear: -1900 };
  const existing = suggestion('unwoven', aWindow); const requests = [];
  const session = createHistorySession({ setTimer: clock.setTimer, clearTimer: clock.clearTimer, fetchImpl: async (url, init = {}) => {
    if (url === '/api/history/preferences') return response({ autoSuggest: true });
    if (url.startsWith('/api/histories')) { const id = new URL(`http://local${url}`).searchParams.get('asOfYear') === '-2400' ? 'h1' : 'h2'; return response({ questions: [{ id: 'q', histories: [history(id, id === 'h1' ? [existing] : [])] }] }); }
    if (url === '/api/history/suggest') { requests.push(JSON.parse(init.body)); return response({ history: history('h2'), suggestions: [] }); }
    throw new Error(url);
  } });
  session.setContext({ questionId: 'q', historyId: 'h1', eventId: 'event-1', date: -2400 }); await tick();
  assert.equal(session.getState().suggestions[0].id, 'unwoven');
  session.setContext({ questionId: 'q', historyId: 'h2', eventId: 'event-2', date: -1800 }); await tick();
  assert.equal(session.getState().suggestions.length, 0); assert.equal(clock.size, 1);
  clock.fire(); await tick(); assert.equal(requests[0].historyId, 'h2');
  session.setContext({ questionId: 'q', historyId: 'h1', eventId: 'event-1', date: -2400 }); await tick();
  assert.deepEqual(session.getState().suggestions.map(item => item.id), ['unwoven']);
});

test('P1 migrated suggestions cache by their recorded window when the selected date is nearby', async () => {
  const snapshot = JSON.parse(readFileSync(new URL('./fixtures/history-migrated-window.json', import.meta.url), 'utf8'));
  const clock = timers(); let generated = 0;
  const session = createHistorySession({ setTimer: clock.setTimer, clearTimer: clock.clearTimer, fetchImpl: async url => {
    if (url === '/api/history/preferences') return response({ autoSuggest: true });
    if (url.startsWith('/api/histories')) return response({ questions: [{ id: snapshot.questionId, histories: [snapshot.history] }] });
    if (url === '/api/history/suggest') { generated++; return response({ history: snapshot.history, suggestions: [] }); }
    throw new Error(url);
  } });
  session.setContext({ questionId:snapshot.questionId, eventId:snapshot.history.events[0].id, date:2000 }); await tick();
  assert.equal(session.getState().window.fromYear, 1347);
  assert.equal(session.getState().window.toYear, 2347);
  assert.equal(session.getState().suggestions[0].reason, 'migrated from earlier exploration');
  assert.equal(clock.size, 0, 'migration windows are cached despite having no generated-window ledger');
  assert.equal(generated, 0);
});

test('ripple actions address the specific woven event when an event has multiple flags', async () => {
  const clock = timers(), requests = [];
  const current = { ...history('h'), events:[{ id:'later-event', year:-1800, title:'Later event', checkFlags:[
    { kind:'weave-ripple', wovenEventId:'woven-a', status:'review' }, { kind:'weave-ripple', wovenEventId:'woven-b', status:'review' },
  ] }] };
  const session = createHistorySession({ setTimer:clock.setTimer, clearTimer:clock.clearTimer, fetchImpl:async (url, init = {}) => {
    if (url === '/api/history/preferences') return response({ autoSuggest:false });
    if (url.startsWith('/api/histories')) return response({ questions:[{ id:'q', histories:[current] }] });
    if (url === '/api/history/keep' || url === '/api/history/regenerate') { requests.push([url, JSON.parse(init.body)]); return response({ history:current }); }
    throw new Error(url);
  } });
  session.setContext({ questionId:'q', historyId:'h', eventId:'later-event', date:-1800 }); await tick();
  await session.keep('later-event', 'woven-a'); await session.regenerate('later-event', 'woven-b');
  assert.deepEqual(requests.map(([path, body]) => [path, body.eventId, body.wovenEventId]), [
    ['/api/history/keep', 'later-event', 'woven-a'], ['/api/history/regenerate', 'later-event', 'woven-b'],
  ]);
});

test('last-suggestion weave preserves its cached window and never auto-generates a follow-up', async () => {
  const clock = timers(), cachedWindow = { fromYear:1503,toYear:2503 }, candidate = suggestion('only-one', cachedWindow);
  const original = { ...history('h',[candidate]), suggestionWindows:[{ window:cachedWindow,status:'ready',batches:1,suggestionCount:1 }] };
  const updated = { ...history('h'), events:[...original.events,{ id:'only-one',year:1978,title:'Woven event',checkFlags:[] }] };
  const session = createHistorySession({ setTimer:clock.setTimer, clearTimer:clock.clearTimer, fetchImpl:async (url,init={}) => {
    if (url === '/api/history/preferences') return response({ autoSuggest:true });
    if (url.startsWith('/api/histories')) return response({ questions:[{ id:'q',histories:[original] }] });
    if (url === '/api/history/weave') return response({ history:updated,event:updated.events.at(-1) });
    throw new Error(url);
  } });
  session.setContext({ questionId:'q',historyId:'h',eventId:'event-1',date:1978 }); await tick();
  assert.deepEqual(session.getState().window,cachedWindow);
  await session.weave('only-one');
  assert.deepEqual(session.getState().window,cachedWindow);
  assert.equal(session.getState().windowCached,true);
  assert.equal(session.getState().suggestions.length,0);
  assert.equal(session.getState().history.suggestionWindows.find(item=>item.window.fromYear===1503)?.status,'ready');
  assert.equal(clock.size,0);
  session.setContext({ questionId:'q',historyId:'h',eventId:'only-one',date:1978 });
  assert.deepEqual(session.getState().window,cachedWindow); assert.equal(clock.size,0);
});

test('Keep and Regenerate retain the selected cached window; a fork selects its new history and may auto-suggest', async () => {
  const clock = timers(), cachedWindow={fromYear:1503,toYear:2503};
  const original={ ...history('h',[suggestion('s',cachedWindow)]),suggestionWindows:[{window:cachedWindow,status:'ready',batches:1,suggestionCount:1}] };
  const requests=[];
  const session=createHistorySession({setTimer:clock.setTimer,clearTimer:clock.clearTimer,fetchImpl:async(url,init={})=>{
    if(url==='/api/history/preferences')return response({autoSuggest:true});
    if(url.startsWith('/api/histories'))return response({questions:[{id:'q',histories:[original]}]});
    if(url==='/api/history/keep'||url==='/api/history/regenerate'){requests.push(url);return response({history:{...original,events:original.events.map(item=>({...item,checkFlags:[]}))}});}
    if(url==='/api/history/fork')return response({history:{id:'h-fork',events:[{id:'prefix',year:-3000,title:'Prefix event'}]},forkedHistory:{id:'h-fork',events:[{id:'prefix',year:-3000,title:'Prefix event'}]},forkEventId:'event-1'});
    if(url==='/api/history/suggest')return response({history:{id:'h-fork',events:[{id:'prefix',year:-3000,title:'Prefix event'}]},suggestions:[]});
    throw new Error(url);
  }});
  session.setContext({questionId:'q',historyId:'h',eventId:'event-1',date:1978});await tick();
  await session.keep('event-1','woven-a');assert.deepEqual(session.getState().window,cachedWindow);assert.equal(clock.size,0);
  await session.regenerate('event-1','woven-b');assert.deepEqual(session.getState().window,cachedWindow);assert.equal(clock.size,0);
  await session.forkEvent('event-1');
  assert.equal(session.getState().historyId,'h-fork');assert.equal(session.getState().date,-3000);
  assert.equal(clock.size,1,'the deliberate fork can auto-suggest its new history window');
  assert.deepEqual(requests,['/api/history/keep','/api/history/regenerate']);
});
