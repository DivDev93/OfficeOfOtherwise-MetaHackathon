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

test('media reconciliation updates the active suggestion without changing its date or selection and dedupes window counts', async () => {
  const window = { fromYear:1,toYear:1000 };
  const items = [suggestion('s1',window),suggestion('s2',window),suggestion('s3',window)];
  const saved = { ...history('h',items), suggestionWindows:[{window,status:'ready',batches:1,suggestionCount:3}] };
  const question = {id:'q',title:'A question',histories:[saved]};
  const session = createHistorySession({ fetchImpl:async (url,init={}) => {
    if (url === '/api/history/preferences') return response({autoSuggest:false});
    if (url.startsWith('/api/histories')) return response({questions:[question]});
    if (url === '/api/history/suggest') return response({question,history:saved,suggestions:items});
    throw new Error(url);
  }});
  session.setContext({questionId:'q',historyId:'h',eventId:'s2',date:250}); await tick();
  await session.more();
  const before = session.getState();
  const updated = session.updateMediaReference({questionId:'q',historyId:'h',eventId:'s2'},'sceneRef',{status:'complete',url:'/history-media/'+'a'.repeat(64)+'.png'});
  const state = session.getState();
  assert.equal(updated,true);
  assert.equal(state.date,before.date);
  assert.equal(state.selectedEventId,before.selectedEventId);
  assert.equal(state.suggestions.find(item=>item.id==='s2').sceneRef.url,'/history-media/'+'a'.repeat(64)+'.png');
  assert.equal(state.history.suggestions.find(item=>item.id==='s2').sceneRef.url,'/history-media/'+'a'.repeat(64)+'.png');
  assert.equal(state.questions[0].histories[0].suggestions.find(item=>item.id==='s2').sceneRef.url,'/history-media/'+'a'.repeat(64)+'.png');
  assert.equal(state.history.suggestionWindows[0].suggestionCount,3,'previous and incoming copies of the same three suggestions count once');
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

test('an explicit batch check from a reopened read-only history is cached and commit applies its resolved plan', async () => {
  const clock=timers(), window={fromYear:1503,toYear:2503};
  const first=suggestion('batch-a',window), second=suggestion('batch-b',window);
  const original={...history('h',[first,second]),suggestionWindows:[{window,status:'ready',batches:1,suggestionCount:2}]};
  const updated={...original,suggestions:[],events:[...original.events,{id:'woven-batch',year:1978,title:'Combined event',checkFlags:[]}]};
  const requests=[], plan={id:'plan-1',questionId:'q',historyId:'h',suggestionIds:['batch-a','batch-b'],chain:[],merges:[],conflicts:[]};
  const session=createHistorySession({setTimer:clock.setTimer,clearTimer:clock.clearTimer,fetchImpl:async(url,init={})=>{
    if(url==='/api/history/preferences')return response({autoSuggest:false});
    if(url.startsWith('/api/histories'))return response({questions:[{id:'q',histories:[original]}]});
    if(url==='/api/history/batch-check'){requests.push([url,JSON.parse(init.body)]);return response({plan});}
    if(url==='/api/history/weave-batch'){requests.push([url,JSON.parse(init.body)]);return response({question:{id:'q',histories:[updated]},history:updated,events:[updated.events.at(-1)],ripple:[],cached:false});}
    throw new Error(url);
  }});
  session.setContext({questionId:'q',historyId:'h',eventId:'event-1',date:1978,readOnly:true}); await tick();
  session.hover('batch-a');
  assert.equal(requests.length,0,'passive reopen and hover do not run a batch check');
  assert.equal(clock.size,0,'passive reopen does not schedule suggestion generation');
  const prepared=await session.checkWeaveBatch(['batch-a','batch-b']);
  assert.equal(prepared.id,'plan-1');
  assert.equal((await session.checkWeaveBatch(['batch-a','batch-b'])).id,'plan-1');
  assert.deepEqual(requests,[['/api/history/batch-check',{questionId:'q',historyId:'h',suggestionIds:['batch-a','batch-b']}]],'cancel/reopen with the same selection reuses the cached plan');
  await session.commitWeaveBatch({suggestionIds:['batch-a','batch-b'],planId:'plan-1',acceptedMergeIds:[],excludedSuggestionIds:[]});
  assert.deepEqual(requests.at(-1),['/api/history/weave-batch',{questionId:'q',historyId:'h',planId:'plan-1',acceptedMergeIds:[],excludedSuggestionIds:[]}]);
  assert.equal(session.getState().history.events.at(-1).id,'woven-batch');
  assert.equal(session.getState().busyIds.size,0);
});

test('batch-check response from a changed history cannot become the active cached plan', async () => {
  const clock=timers(), firstWindow={fromYear:1503,toYear:2503}, secondWindow={fromYear:2504,toYear:3504};
  const first={...history('h1',[suggestion('first-suggestion',firstWindow)]),suggestionWindows:[{window:firstWindow,status:'ready'}]};
  const second={...history('h2',[suggestion('second-suggestion',secondWindow)]),suggestionWindows:[{window:secondWindow,status:'ready'}]};
  let finishCheck;
  const session=createHistorySession({setTimer:clock.setTimer,clearTimer:clock.clearTimer,fetchImpl:async(url,init={})=>{
    if(url==='/api/history/preferences')return response({autoSuggest:false});
    if(url.startsWith('/api/histories'))return response({questions:[{id:'q',histories:[first,second]}]});
    if(url==='/api/history/batch-check')return new Promise(resolve=>{finishCheck=()=>resolve(response({plan:{id:'stale-plan',questionId:'q',historyId:'h1',suggestionIds:['first-suggestion'],chain:[],merges:[],conflicts:[]}}));});
    throw new Error(url);
  }});
  session.setContext({questionId:'q',historyId:'h1',eventId:'event-1',date:1978}); await tick();
  const pending=session.checkWeaveBatch(['first-suggestion']); await tick();
  session.setContext({questionId:'q',historyId:'h2',eventId:'event-1',date:2600}); await tick();
  finishCheck();
  assert.equal(await pending,null);
  assert.equal(session.getState().history.id,'h2');
  assert.equal(session.getState().busyIds.has('batch-check'),false);
});

test('cancel and reopen can share the same in-flight batch check without a second request', async () => {
  const clock=timers(), window={fromYear:1503,toYear:2503}, candidate=suggestion('flight-suggestion',window);
  const original={...history('h',[candidate]),suggestionWindows:[{window,status:'ready'}]};
  let resolveCheck, requests=0;
  const plan={id:'flight-plan',questionId:'q',historyId:'h',suggestionIds:[candidate.id],chain:[],merges:[],conflicts:[]};
  const session=createHistorySession({setTimer:clock.setTimer,clearTimer:clock.clearTimer,fetchImpl:async(url)=>{
    if(url==='/api/history/preferences')return response({autoSuggest:false});
    if(url.startsWith('/api/histories'))return response({questions:[{id:'q',histories:[original]}]});
    if(url==='/api/history/batch-check'){requests++;return new Promise(resolve=>{resolveCheck=()=>resolve(response({plan}));});}
    throw new Error(url);
  }});
  session.setContext({questionId:'q',historyId:'h',eventId:'event-1',date:1978,readOnly:true});await tick();
  const firstOpen=session.checkWeaveBatch([candidate.id]);await tick();
  const reopened=session.checkWeaveBatch([candidate.id]);
  assert.equal(requests,1,'reopen joins the existing plan request instead of starting another');
  resolveCheck();
  assert.equal((await firstOpen).id,'flight-plan');
  assert.equal((await reopened).id,'flight-plan');
  assert.equal(session.getState().busyIds.has('batch-check'),false);
});

test('uncertain batch-checks require an explicit receipt retry and do not redispatch on reopen', async () => {
  const clock=timers(), window={fromYear:1503,toYear:2503}, candidate=suggestion('uncertain-candidate',window);
  const original={...history('h',[candidate]),suggestionWindows:[{window,status:'ready'}]}, requests=[];
  const plan={id:'resolved-plan',questionId:'q',historyId:'h',suggestionIds:[candidate.id],chain:[],merges:[],conflicts:[]};
  const session=createHistorySession({setTimer:clock.setTimer,clearTimer:clock.clearTimer,fetchImpl:async(url,init={})=>{
    if(url==='/api/history/preferences')return response({autoSuggest:false});
    if(url.startsWith('/api/histories'))return response({questions:[{id:'q',histories:[original]}]});
    if(url==='/api/history/batch-check'){
      const body=JSON.parse(init.body);requests.push(body);
      if(!body.retryOf)return {ok:false,status:409,json:async()=>({code:'batch_plan_uncertain',retryOf:'receipt-1',possibleCharge:true,error:'Prior batch check may have completed.'})};
      return response({plan});
    }
    throw new Error(url);
  }});
  session.setContext({questionId:'q',historyId:'h',eventId:'event-1',date:1978});await tick();
  assert.equal(await session.checkWeaveBatch([candidate.id]),null);
  assert.equal(session.getState().batchCheckUncertain.retryOf,'receipt-1');
  assert.equal(await session.checkWeaveBatch([candidate.id]),null,'reopening without explicit retry does not redispatch');
  assert.equal(requests.length,1);
  assert.equal((await session.checkWeaveBatch([candidate.id],{retryOf:'receipt-1'})).id,'resolved-plan');
  assert.deepEqual(requests,[{questionId:'q',historyId:'h',suggestionIds:[candidate.id]},{questionId:'q',historyId:'h',suggestionIds:[candidate.id],retryOf:'receipt-1'}]);
});

test('combined ripple retry sends selected event pairs through one history-scoped request', async () => {
  const clock=timers(), window={fromYear:1503,toYear:2503};
  const original={...history('h'),events:[{id:'event-1',year:100,title:'Anchor',checkFlags:[]},{id:'later',year:200,title:'Later',checkFlags:[
    {kind:'weave-ripple',wovenEventId:'woven',status:'unavailable'}]}],suggestionWindows:[{window,status:'ready'}]};
  const updated={...original,events:[original.events[0],{...original.events[1],checkFlags:[]} ]};
  const requests=[];
  const session=createHistorySession({setTimer:clock.setTimer,clearTimer:clock.clearTimer,fetchImpl:async(url,init={})=>{
    if(url==='/api/history/preferences')return response({autoSuggest:false});
    if(url.startsWith('/api/histories'))return response({questions:[{id:'q',histories:[original]}]});
    if(url==='/api/history/ripple-check-batch'){
      requests.push([url,JSON.parse(init.body)]);
      return response({question:{id:'q',histories:[updated]},history:updated,events:[updated.events[1]],ripple:[]});
    }
    throw new Error(url);
  }});
  session.setContext({questionId:'q',historyId:'h',eventId:'event-1',date:100});await tick();
  await session.retryRippleBatch(['later'],['woven']);
  assert.deepEqual(requests,[['/api/history/ripple-check-batch',{questionId:'q',historyId:'h',eventIds:['later'],wovenEventIds:['woven']}]]);
  assert.equal(session.getState().history.events[1].checkFlags.length,0);
  assert.equal(session.getState().busyIds.size,0);
});

test('forking a conflicting suggestion outside the current window uses its canonical conflict target', async () => {
  const clock=timers(), currentWindow={fromYear:1503,toYear:2503}, otherWindow={fromYear:2504,toYear:3504};
  const current=suggestion('current-window-suggestion',currentWindow);
  const conflict={...suggestion('inactive-window-conflict',otherWindow),verdict:'conflicts',conflictsWith:'event-1'};
  const original={...history('h',[current,conflict]),suggestionWindows:[
    {window:currentWindow,status:'ready',suggestionCount:1},{window:otherWindow,status:'ready',suggestionCount:1},
  ]};
  const calls=[];
  const session=createHistorySession({setTimer:clock.setTimer,clearTimer:clock.clearTimer,fetchImpl:async(url,init={})=>{
    if(url==='/api/history/preferences')return response({autoSuggest:false});
    if(url.startsWith('/api/histories'))return response({questions:[{id:'q',histories:[original]}]});
    if(url==='/api/history/fork'){calls.push([url,JSON.parse(init.body)]);return response({history:{id:'h-fork',events:original.events}});}
    throw new Error(url);
  }});
  session.setContext({questionId:'q',historyId:'h',eventId:'event-1',date:1978});await tick();
  assert.deepEqual(session.getState().suggestions.map(item=>item.id),[current.id],'only the active window is in the request scope');
  await session.forkSuggestion(conflict.id);
  assert.deepEqual(calls,[['/api/history/fork',{questionId:'q',historyId:'h',eventId:'event-1',suggestionId:conflict.id}]],'the inactive gallery card still sends its canonical conflict target');
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
