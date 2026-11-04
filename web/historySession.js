// Browser-side history window/session state. Network and timers are injectable for tests.
const defaultFetch = (...args) => fetch(...args);
const windowFor = year => {
  const era = Math.floor((Math.abs(year) - 1) / 1000);
  return year < 0 ? { fromYear: -(era + 1) * 1000, toYear: -(era * 1000 + 1) }
    : { fromYear: era * 1000 + 1, toYear: (era + 1) * 1000 };
};
const canonicalEvents = history => (history?.events || [])
  .filter(event => event?.id != null && Number.isSafeInteger(event.year) && event.year !== 0)
  .slice().sort((a, b) => a.year - b.year);
const eventAtOrBefore = (history, year) => {
  const events = canonicalEvents(history);
  return events.filter(event => event.year <= year).at(-1) || events[0] || null;
};

export function createHistorySession({ fetchImpl = defaultFetch, setTimer = setTimeout, clearTimer = clearTimeout,
  onChange = () => {}, debounceMs = 800 } = {}) {
  let context = null, timer = null, generation = 0, preferenceRequest = 0, heldOwnerKey = '';
  const preferenceWriteVersion = { autoSuggest: 0, autoWeave: 0 };
  let batchCheckOwner = 0;
  let autoWeaveTask = null;
  const pendingFinalizeFlights = new Set();
  const batchPlanCache = new Map();
  const batchPlanFlights = new Map();
  const batchCheckUncertainCache = new Map();
  const listeners = new Set();
  const state = { autoSuggest: true, autoWeave: false, autoWeaveRunning: false, questionId: '', historyId: '', selectedEventId: '', heldSuggestionIds: [], date: null, window: null, question: null, questions: [], histories: [],
    suggestions: [], status: '', paused: false, loading: false, busyIds: new Set(), history: null, windowCached: false, windowStatus: '', batchCheckUncertain:null };
  const emit = () => { const snapshot = { ...state, suggestions: [...state.suggestions], heldSuggestionIds: [...state.heldSuggestionIds], busyIds: new Set(state.busyIds) }; onChange(snapshot); for (const listener of listeners) listener(snapshot); };
  const isCurrent = (token, identity) => token === generation && context?.questionId === identity.questionId
    && (!identity.historyId || context?.historyId === identity.historyId);
  function cachedEntry(history, year) {
    const entries = [...(history?.suggestionWindows || [])];
    for (const item of history?.suggestions || []) if (item.window && !entries.some(entry => entry.window?.fromYear === item.window.fromYear && entry.window?.toYear === item.window.toYear)) {
      entries.push({ window: item.window, status: 'ready', suggestionCount: 1, migrated: item.origin === 'migration' });
    }
    return entries.filter(entry => entry.window?.fromYear <= year && entry.window?.toYear >= year)
      .sort((a, b) => (a.window.toYear - a.window.fromYear) - (b.window.toYear - b.window.fromYear))[0] || null;
  }
  function mergeWindows(incoming, previous, activeWindow, activeStatus = '') {
    const byWindow = new Map();
    const add = (entry, replace = false) => {
      const window = entry?.window;
      if (!Number.isSafeInteger(window?.fromYear) || !Number.isSafeInteger(window?.toYear)) return;
      const key = `${window.fromYear}:${window.toYear}`;
      const old = byWindow.get(key);
      byWindow.set(key, { ...old, ...entry, window: { fromYear: window.fromYear, toYear: window.toYear },
        ...(replace ? { status: entry.status } : {}) });
    };
    for (const entry of previous?.suggestionWindows || []) add(entry);
    for (const entry of incoming?.suggestionWindows || []) add(entry);
    const suggestionsByWindow = new Map();
    for (const item of [...(previous?.suggestions || []), ...(incoming?.suggestions || [])]) if (item?.id != null && item.window) {
      const key = `${item.window.fromYear}:${item.window.toYear}`;
      const ids = suggestionsByWindow.get(key) || new Set();
      ids.add(String(item.id)); suggestionsByWindow.set(key, ids);
    }
    for (const [key, ids] of suggestionsByWindow) {
      const separator = key.indexOf(':');
      const window = { fromYear:Number(key.slice(0, separator)), toYear:Number(key.slice(separator + 1)) };
      add({ window, status: 'ready', batches: 1, suggestionCount: ids.size });
    }
    if (activeWindow && activeStatus) {
      const key = `${activeWindow.fromYear}:${activeWindow.toYear}`;
      add({ window: activeWindow, status: activeStatus, batches: 1, suggestionCount: byWindow.get(key)?.suggestionCount || 0 }, true);
    }
    return { ...(incoming || previous), suggestionWindows: [...byWindow.values()].sort((a, b) => a.window.fromYear - b.window.fromYear || a.window.toYear - b.window.toYear) };
  }
  function updateWindowSuggestions() {
    const entry = cachedEntry(state.history, state.date);
    if (entry) state.window = { ...entry.window };
    if (context && state.window) context.window = { ...state.window };
    state.windowStatus = entry?.status || '';
    state.windowCached = entry?.status === 'ready' || entry?.status === 'unknown' || entry?.status === 'pending' || false;
    state.suggestions = (state.history?.suggestions || []).filter(item => item.window?.fromYear === state.window.fromYear && item.window?.toYear === state.window.toYear);
  }
  async function readPreferences() {
    const request = ++preferenceRequest;
    try {
      const response = await fetchImpl('/api/history/preferences');
      if (!response.ok) return;
      const value = await response.json();
      if (request !== preferenceRequest || typeof value.autoSuggest !== 'boolean') return;
      state.autoSuggest = value.autoSuggest;
      state.autoWeave = value.autoWeave === true;
      emit();
      if (context && !context.readOnly && state.autoSuggest && !state.suggestions.length) scheduleSuggest();
    } catch { /* Preference loading must not block cached history. */ }
  }
  async function persistPreference(value) {
    const previous = state.autoSuggest, writeVersion = ++preferenceWriteVersion.autoSuggest;
    preferenceRequest++;
    state.autoSuggest = value; state.paused = false;
    if (timer !== null) { clearTimer(timer); timer = null; }
    emit();
    try {
      const response = await fetchImpl('/api/history/preferences', { method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ autoSuggest: value }) });
      if (!response.ok && writeVersion === preferenceWriteVersion.autoSuggest) {
        state.autoSuggest = previous; state.status = 'Could not save the auto-suggest setting.';
      }
    } catch {
      if (writeVersion === preferenceWriteVersion.autoSuggest) {
        state.autoSuggest = previous; state.status = 'Could not save the auto-suggest setting.';
      }
    }
    if (writeVersion === preferenceWriteVersion.autoSuggest) {
      emit();
      if (value && context && !context.readOnly && !state.suggestions.length) scheduleSuggest();
    }
  }
  async function persistAutoWeave(value) {
    if (typeof value !== 'boolean') return false;
    const previous = state.autoWeave, writeVersion = ++preferenceWriteVersion.autoWeave;
    preferenceRequest++;
    state.autoWeave = value; emit();
    try {
      const response = await fetchImpl('/api/history/preferences', { method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ autoWeave: value }) });
      if (!response.ok) {
        if (writeVersion === preferenceWriteVersion.autoWeave) {
          state.autoWeave = previous; state.status = 'Could not save the auto-weave setting.'; emit();
        }
        return false;
      }
      const saved = await response.json().catch(() => ({}));
      if (writeVersion === preferenceWriteVersion.autoWeave) {
        if (typeof saved.autoWeave === 'boolean') state.autoWeave = saved.autoWeave;
        emit();
      }
      return true;
    } catch {
      if (writeVersion === preferenceWriteVersion.autoWeave) {
        state.autoWeave = previous; state.status = 'Could not save the auto-weave setting.'; emit();
      }
      return false;
    }
  }
  async function loadHistory(identity, token) {
    state.loading = true; state.status = 'Loading saved suggestions…'; emit();
    try {
      const response = await fetchImpl(`/api/histories?asOfYear=${encodeURIComponent(identity.date)}`);
      if (!response.ok) throw new Error('Could not load saved history.');
      const data = await response.json();
      if (!isCurrent(token, identity)) return;
      batchPlanCache.clear(); batchCheckUncertainCache.clear(); state.batchCheckUncertain = null;
      if (Array.isArray(data.questions)) state.questions = data.questions;
      const question = data.questions?.find(item => item.id === identity.questionId);
      const history = question?.histories?.find(item => item.id === identity.historyId)
        || question?.histories?.find(item => item.events?.some(event => event.id === identity.eventId));
      if (!history) { state.history = null; state.suggestions = []; state.status = 'No saved history is available for this story.'; return; }
      context.historyId = history.id;
      const ownerKey = `${identity.questionId}:${history.id}`;
      if (heldOwnerKey !== ownerKey) state.heldSuggestionIds = [];
      heldOwnerKey = ownerKey; state.question = question; state.histories = question.histories || [];
      state.historyId = history.id; state.history = history; state.window = windowFor(identity.date);
      updateWindowSuggestions(); state.status = state.windowStatus === 'pending' ? 'Suggestions for this window are still being prepared.' : state.windowStatus === 'unknown' ? 'A previous request may have completed; use More to check for another batch.' : '';
    } catch (error) {
      if (isCurrent(token, identity)) state.status = error.message || 'Could not load saved history.';
    } finally {
      if (isCurrent(token, identity)) { state.loading = false; emit(); if (!context?.readOnly && state.autoSuggest && !state.windowCached && !state.suggestions.length) scheduleSuggest(); }
    }
  }
  function scheduleSuggest() {
    if (!context || context.readOnly || !state.autoSuggest || state.paused || state.windowCached || state.suggestions.length || !state.history) return;
    if (timer !== null) clearTimer(timer);
    timer = setTimer(() => { timer = null; requestSuggestions(false); }, debounceMs);
  }
  async function requestSuggestions(more) {
    if (!context || state.loading || state.busyIds.size || state.autoWeaveRunning || (!more && state.suggestions.length)) return;
    const identity = { ...context }, token = generation;
    let autoWeaveIds = [];
    state.loading = true; state.status = more ? `Finding more events around ${identity.date}…` : `Finding events around ${identity.date}…`; emit();
    try {
      const canonicalSelection = state.history?.events?.find(event => String(event.id) === String(state.selectedEventId));
      const requestBody = { questionId: identity.questionId, historyId: identity.historyId, window: identity.window,
        ...(more ? { more: true } : {}), ...(canonicalSelection?.id != null ? { inspiredByEventId: String(canonicalSelection.id) } : {}) };
      const response = await fetchImpl('/api/history/suggest', { method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify(requestBody) });
      const data = await response.json().catch(() => ({}));
      if (!isCurrent(token, identity)) return;
      if (!response.ok) {
        if (['session_cap', 'session_window_limit', 'suggestion_window_cap', 'spend_cap'].includes(data.code)) {
          state.paused = true; state.status = data.error || 'Auto-suggest paused because a suggestion limit was reached.';
        } else state.status = data.error || 'Could not suggest events.';
        return;
      }
      const previousHistory = state.history;
      state.question = data.question || state.question;
      state.history = mergeWindows(data.history || state.history, previousHistory, identity.window, 'ready');
      if (state.question) {
        state.histories = state.question.histories.map(item => item.id === state.history.id ? state.history : item);
        state.question = { ...state.question, histories: state.histories };
        state.questions = state.questions.map(item => item.id === state.question.id ? state.question : item);
      }
      state.suggestions = (state.history?.suggestions || []).filter(item => item.window?.fromYear === identity.window.fromYear && item.window?.toYear === identity.window.toYear);
      if (Array.isArray(data.suggestions) && data.suggestions.length) state.suggestions = [...new Map([...state.suggestions, ...data.suggestions].map(item => [item.id, item])).values()];
      state.windowCached = true; state.windowStatus = 'ready';
      state.status = state.suggestions.length ? '' : 'No suggestions found for this date window.';
      if (state.autoWeave && data.generated === true && data.cached !== true && Array.isArray(data.generatedSuggestionIds)) {
        const freshIds = new Set(data.generatedSuggestionIds.map(String));
        autoWeaveIds = state.suggestions.filter(item => freshIds.has(String(item.id)) && item.verdict === 'fits').map(item => String(item.id));
        state.autoWeaveRunning = autoWeaveIds.length > 0;
      }
    } catch (error) { if (isCurrent(token, identity)) state.status = error.message || 'Could not suggest events.'; }
    finally { if (isCurrent(token, identity)) { state.loading = false; emit(); } }
    if (autoWeaveIds.length) {
      const task = runAutoWeave(autoWeaveIds, identity, token);
      autoWeaveTask = task;
      try { await task; } finally { if (autoWeaveTask === task) autoWeaveTask = null; }
    }
  }
  async function runAutoWeave(suggestionIds, identity, token) {
    try {
      if (!isCurrent(token, identity) || !state.autoWeave) return;
      const plan = await checkWeaveBatch(suggestionIds, { automatic: true });
      if (!plan || !isCurrent(token, identity) || !state.autoWeave) return;
      if (Array.isArray(plan.conflicts) && plan.conflicts.length) {
        state.status = 'Auto-weave paused because the checked batch needs conflict review.'; return;
      }
      const result = await commitWeaveBatch({ suggestionIds, planId: plan.id, acceptedMergeIds: [],
        excludedSuggestionIds: [], pending: true, automatic: true, returnStaleData: true });
      if (result?.pendingBatchId && !isCurrent(token, identity)) {
        const batch = result.history?.weaveBatches?.find(item => item.id === result.pendingBatchId);
        await finalizePendingForIdentity(identity, result.pendingBatchId, batch);
      }
    } finally {
      if (isCurrent(token, identity)) { state.autoWeaveRunning = false; emit(); }
    }
  }
  async function mutate(path, payload, busyId, { returnStaleData = false } = {}) {
    if (!context || state.busyIds.has(busyId)) return null;
    const identity = { ...context, window: { ...state.window }, windowCached: state.windowCached }, token = generation;
    state.busyIds.add(busyId); state.status = 'Saving history…'; emit();
    try {
      const response = await fetchImpl(path, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({
        questionId: identity.questionId, historyId: identity.historyId, ...payload,
      }) });
      const data = await response.json().catch(() => ({}));
      if (!isCurrent(token, identity)) return returnStaleData ? data : null;
      if (!response.ok) {
        if (data.code === 'suggestion_became_conflict' && data.suggestion) {
          const refreshed = { ...data.suggestion, window:data.suggestion.window || identity.window };
          state.history = { ...state.history, suggestions:(state.history.suggestions || []).map(item => item.id === refreshed.id ? refreshed : item) };
          state.history = mergeWindows(state.history, state.history, identity.window, 'ready');
          state.suggestions = state.suggestions.map(item => item.id === refreshed.id ? refreshed : item);
          state.window = identity.window; state.windowCached = true; state.windowStatus = 'ready';
          state.status = data.error || 'This suggestion now conflicts with the selected history.';
          if (state.question) state.histories = state.histories.map(item => item.id === state.history.id ? state.history : item);
          emit();
        } else if (data.code === 'suggestion_recheck_pending') state.status = data.error || 'This suggestion is being checked again; retry the action shortly.';
        else state.status = data.error || 'Could not update history.';
        return null;
      }
      const priorHistory = state.history;
      batchPlanCache.clear(); batchCheckUncertainCache.clear(); state.batchCheckUncertain = null;
      const forkedHistory = !!(data.history?.id && data.history.id !== context.historyId && data.forkEventId);
      state.question = data.question || state.question;
      state.history = forkedHistory ? mergeWindows(data.history, null, null) : mergeWindows(data.history || state.history, priorHistory,
        identity.window, path === '/api/history/weave' || path === '/api/history/weave-batch' || identity.windowCached ? 'ready' : '');
      if (state.question) {
        state.histories = state.question.histories.map(item => item.id === state.history.id ? state.history : item);
        state.question = { ...state.question, histories: state.histories };
        state.questions = state.questions.map(item => item.id === state.question.id ? state.question : item);
      }
      else if (forkedHistory) state.histories = [...state.histories, state.history];
      if (context && forkedHistory) {
        const forkPoint = priorHistory?.events?.find(item => item.id === data.forkEventId);
        context.historyId = data.history.id; context.date = forkPoint?.year ?? context.date;
        context.eventId = data.history.events.at(-1)?.id || '';
        state.historyId = data.history.id; state.date = context.date; state.selectedEventId = context.eventId;
        state.window = windowFor(state.date); context.window = { ...state.window };
        state.suggestions = (state.history.suggestions || []).filter(item => item.window?.fromYear === state.window.fromYear && item.window?.toYear === state.window.toYear);
        state.windowStatus = state.history.suggestionWindows?.find(entry => entry.window?.fromYear === state.window.fromYear && entry.window?.toYear === state.window.toYear)?.status || '';
        state.windowCached = ['ready', 'unknown', 'pending'].includes(state.windowStatus);
        state.status = 'New history created.';
      } else {
        state.window = identity.window;
        state.windowStatus = state.history.suggestionWindows?.find(entry => entry.window?.fromYear === identity.window.fromYear && entry.window?.toYear === identity.window.toYear)?.status || '';
        state.windowCached = ['ready', 'unknown', 'pending'].includes(state.windowStatus);
        state.suggestions = (state.history.suggestions || []).filter(item => item.window?.fromYear === identity.window.fromYear && item.window?.toYear === identity.window.toYear);
        state.status = '';
      }
      if (!forkedHistory && data.cached !== true && ['/api/history/weave', '/api/history/weave-batch'].includes(path)) {
        const previousEventIds = new Set((priorHistory?.events || []).map(event => String(event.id)));
        const newestWoven = canonicalEvents(state.history).filter(event => !previousEventIds.has(String(event.id))).at(-1);
        if (newestWoven && newestWoven.year > state.date) {
          state.date = newestWoven.year;
          state.selectedEventId = newestWoven.id;
          context.date = newestWoven.year;
          context.eventId = newestWoven.id;
          context.window = windowFor(newestWoven.year);
          state.window = { ...context.window };
          updateWindowSuggestions();
        }
      }
      if (forkedHistory && state.autoSuggest && !state.windowCached && !state.suggestions.length) scheduleSuggest();
      return data;
    } catch (error) { if (isCurrent(token, identity)) state.status = error.message || 'Could not update history.'; return null; }
    finally { if (token === generation && context?.questionId === identity.questionId) { state.busyIds.delete(busyId); emit(); } }
  }
  async function checkWeaveBatch(suggestionIds = [], { retryOf = '', automatic = false } = {}) {
    if (!context || !Array.isArray(suggestionIds) || !suggestionIds.length) return null;
    if (state.autoWeaveRunning && !automatic) return null;
    const ids = [...new Set(suggestionIds.map(String))];
    if (!ids.length || ids.length > 32) return null;
    const identity = { ...context, window:{ ...state.window } }, token = generation;
    const key = JSON.stringify([identity.questionId, identity.historyId, [...ids].sort()]);
    if (!retryOf && batchPlanCache.has(key)) { state.batchCheckUncertain = null; return batchPlanCache.get(key); }
    const uncertain = batchCheckUncertainCache.get(key);
    if (uncertain && retryOf !== uncertain.retryOf) {
      state.batchCheckUncertain = uncertain; state.status = uncertain.error || 'The batch check may have completed. Retry explicitly to reconcile its receipt.'; emit(); return null;
    }
    if (retryOf && (!uncertain || retryOf !== uncertain.retryOf)) return null;
    const flight = batchPlanFlights.get(key);
    if (flight?.token === token) return flight.promise;
    if (state.busyIds.size) return null;
    const promise = performWeaveBatchCheck(ids, identity, token, key, retryOf);
    const ownerFlight = { token, promise }; batchPlanFlights.set(key, ownerFlight);
    try { return await promise; }
    finally { if (batchPlanFlights.get(key) === ownerFlight) batchPlanFlights.delete(key); }
  }
  async function performWeaveBatchCheck(ids, identity, token, key, retryOf) {
    state.batchCheckUncertain = null;
    const owner = ++batchCheckOwner;
    state.busyIds.add('batch-check'); state.status = 'Checking selected suggestions…'; emit();
    try {
      const response = await fetchImpl('/api/history/batch-check', { method:'POST', headers:{'content-type':'application/json'},
        body:JSON.stringify({ questionId:identity.questionId, historyId:identity.historyId, suggestionIds:ids, ...(retryOf ? {retryOf} : {}) }) });
      const data = await response.json().catch(() => ({}));
      if (!isCurrent(token, identity) || owner !== batchCheckOwner) return null;
      if (!response.ok || !data.plan) {
        if (data.code === 'batch_plan_uncertain' && typeof data.retryOf === 'string') {
          const uncertainState = { key, retryOf:data.retryOf, possibleCharge:data.possibleCharge === true, error:data.error || '' };
          batchCheckUncertainCache.set(key,uncertainState); state.batchCheckUncertain = uncertainState;
        }
        state.status = data.error || 'Could not prepare the selected suggestions.'; return null;
      }
      batchPlanCache.set(key, data.plan);
      batchCheckUncertainCache.delete(key);
      state.status = '';
      return data.plan;
    } catch (error) {
      if (isCurrent(token, identity) && owner === batchCheckOwner) state.status = error.message || 'Could not prepare the selected suggestions.';
      return null;
    } finally {
      if (owner === batchCheckOwner) { state.busyIds.delete('batch-check'); if (isCurrent(token, identity)) emit(); }
    }
  }
  function commitWeaveBatch({ suggestionIds = [], planId, acceptedMergeIds = [], excludedSuggestionIds = [], pending = false,
    automatic = false, returnStaleData = false } = {}) {
    if (state.autoWeaveRunning && !automatic) return Promise.resolve(null);
    const key = context && JSON.stringify([context.questionId, context.historyId, [...new Set(suggestionIds.map(String))].sort()]);
    const result = mutate('/api/history/weave-batch', { planId, acceptedMergeIds, excludedSuggestionIds, ...(pending ? { pending: true } : {}) },
      'weave-batch', { returnStaleData });
    return Promise.resolve(result).then(data => {
      if (data && key) batchPlanCache.delete(key);
      return data;
    });
  }
  function reconcileFinalizedBatch(identity, pendingBatchId, batch, responseHistory) {
    const finalizedBatch = batch || responseHistory?.weaveBatches?.find(item => item.id === pendingBatchId);
    const reconcileHistory = cached => {
      if (!cached || String(cached.id) !== String(identity.historyId)) return cached;
      const finalizedEvents = new Set((responseHistory?.events || [])
        .filter(event => event?.pendingBatchId !== pendingBatchId && event?.pending !== true)
        .map(event => String(event.id)));
      for (const id of finalizedBatch?.eventIds || []) finalizedEvents.add(String(id));
      const events = (cached.events || []).map(event => {
        if (!finalizedEvents.has(String(event.id)) || (event.pendingBatchId && event.pendingBatchId !== pendingBatchId)) return event;
        const next = { ...event };
        delete next.pending;
        delete next.pendingBatchId;
        delete next.pendingWindows;
        return next;
      });
      const weaveBatches = (cached.weaveBatches || []).map(item => item.id === pendingBatchId
        ? { ...item, status: 'kept', ...(responseHistory?.weaveBatches?.find(saved => saved.id === pendingBatchId)?.updatedAt
          ? { updatedAt: responseHistory.weaveBatches.find(saved => saved.id === pendingBatchId).updatedAt } : {}) }
        : item);
      return { ...cached, events, weaveBatches };
    };
    const reconcileQuestion = question => {
      if (!question || String(question.id) !== String(identity.questionId)) return question;
      return { ...question, histories: (question.histories || []).map(reconcileHistory) };
    };
    state.questions = state.questions.map(reconcileQuestion);
    state.question = reconcileQuestion(state.question);
    if (state.questionId === identity.questionId) state.histories = state.histories.map(reconcileHistory);
    if (state.questionId === identity.questionId && state.historyId === identity.historyId) {
      state.history = reconcileHistory(state.history);
      state.histories = state.histories.map(item => item.id === state.historyId ? state.history : item);
      if (state.question) {
        state.question = { ...state.question, histories: state.histories };
        state.questions = state.questions.map(item => item.id === state.questionId ? state.question : item);
      }
    }
  }
  async function finalizePendingForIdentity(identity, pendingBatchId, batch = null) {
    try {
      const response = await fetchImpl('/api/history/pending-weave/finalize', { method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ questionId: identity.questionId, historyId: identity.historyId, pendingBatchId }) });
      if (!response.ok) return false;
      const data = await response.json().catch(() => ({}));
      const responseHistory = data.history || data.question?.histories?.find(item => String(item.id) === String(identity.historyId));
      reconcileFinalizedBatch(identity, pendingBatchId, batch, responseHistory);
      if (state.questionId === identity.questionId && state.historyId === identity.historyId) emit();
      return true;
    } catch { return false; }
  }
  function finalizePendingBeforeNavigation(oldContext = context, history = state.history) {
    if (!oldContext || !history?.weaveBatches) return;
    for (const batch of history.weaveBatches.filter(item => item.status === 'pending' && item.id)) {
      const key = JSON.stringify([oldContext.questionId, oldContext.historyId, batch.id]);
      if (pendingFinalizeFlights.has(key)) continue;
      const task = finalizePendingForIdentity(oldContext, batch.id, batch).finally(() => pendingFinalizeFlights.delete(key));
      pendingFinalizeFlights.add(key);
    }
  }
  function finalizePendingBatch(pendingBatchId) {
    if (!pendingBatchId) return Promise.resolve(null);
    return mutate('/api/history/pending-weave/finalize', { pendingBatchId }, `pending-finalize:${pendingBatchId}`);
  }
  function removePendingEvent(pendingBatchId, eventId) {
    if (!pendingBatchId || !eventId) return Promise.resolve(null);
    return mutate('/api/history/pending-weave/remove', { pendingBatchId, eventId }, `pending-remove:${pendingBatchId}:${eventId}`);
  }
  function setContext({ questionId, historyId = '', eventId = '', date, readOnly = false } = {}) {
    if (!questionId || !Number.isSafeInteger(date) || date === 0) { clear(); return; }
    if (!historyId && context?.questionId === questionId && state.history?.events?.some(event => event.id === eventId)) historyId = context.historyId;
    const next = { questionId, historyId, eventId, date, window: windowFor(date), readOnly };
    const sameHistory = context?.questionId === questionId && context?.historyId === historyId;
    const sameWindow = sameHistory && context.window.fromYear <= date && context.window.toYear >= date;
    if (sameWindow) {
      const changed = context.eventId !== eventId || context.date !== date;
      context.eventId = eventId; context.date = date; context.readOnly = readOnly; state.selectedEventId = eventId; state.date = date;
      if (changed) { emit(); if (!readOnly && state.autoSuggest && !state.windowCached && !state.suggestions.length) scheduleSuggest(); }
      return;
    }
    if (context && (!sameHistory || !sameWindow)) finalizePendingBeforeNavigation(context, state.history);
    generation++;
    if (timer !== null) { clearTimer(timer); timer = null; }
    const savedQuestion = state.questions.find(item => item.id === questionId) || (state.questionId === questionId ? state.question : null);
    const savedHistories = savedQuestion?.histories || (state.questionId === questionId ? state.histories : []);
    const cachedHistory = sameHistory ? state.history : savedHistories.find(item => item.id === historyId)
      || (!historyId ? savedHistories.find(item => item.events?.some(item => item.id === eventId)) : null);
    if (cachedHistory && !next.historyId) next.historyId = cachedHistory.id;
    const ownerKey = `${questionId}:${next.historyId || ''}`;
    if (heldOwnerKey !== ownerKey) state.heldSuggestionIds = [];
    heldOwnerKey = ownerKey;
    context = next; state.questionId = questionId; state.historyId = next.historyId; state.selectedEventId = eventId; state.date = date; state.window = next.window;
    state.question = savedQuestion; state.histories = savedHistories;
    state.loading = false; state.busyIds.clear(); state.paused = false; state.autoWeaveRunning = false; state.history = cachedHistory || null;
    state.suggestions = [];
    state.windowCached = false; state.windowStatus = '';
    if (state.history) updateWindowSuggestions();
    state.status = '';
    if (state.history) { updateWindowSuggestions(); state.histories = state.histories.map(item => item.id === state.history.id ? state.history : item); emit(); if (!readOnly) scheduleSuggest(); }
    else { const token = generation; emit(); loadHistory(next, token); }
  }
  function selectHistory(historyId) {
    if (!state.questionId || !historyId) return;
    if (String(historyId) === String(state.historyId)) return;
    openHistory(state.questionId, historyId);
  }
  function selectQuestion(questionId) {
    if (!questionId || questionId === state.questionId) return;
    openQuestion(questionId);
  }
  function openHistory(questionId, historyId) {
    const question = state.questions.find(item => String(item.id) === String(questionId));
    const history = question?.histories?.find(item => String(item.id) === String(historyId));
    if (!question || !history) return false;
    const events = canonicalEvents(history);
    const date = events.at(-1)?.year
      ?? (!history.events?.length && Number.isSafeInteger(question.divergenceYear) && question.divergenceYear !== 0 ? question.divergenceYear : null);
    if (!Number.isSafeInteger(date) || date === 0) return false;
    setContext({ questionId:question.id, historyId:history.id, eventId:events.at(-1)?.id || '', date, readOnly:true });
    return true;
  }
  function openQuestion(questionId) {
    const question = state.questions.find(item => item.id === questionId);
    const histories = question?.histories || [];
    if (!question || !histories.length) return false;
    return openHistory(questionId, histories[0].id);
  }
  function setQuestions(questions) {
    if (!Array.isArray(questions)) return;
    state.questions = questions; emit();
  }
  function updateMediaReference(identity, field, reference) {
    if (!context || identity?.questionId !== state.questionId || identity?.historyId !== state.historyId
        || !['sceneRef','heroRef','cutoutRef','modelRef'].includes(field) || !reference
        || (typeof reference !== 'object' && typeof reference !== 'string')) return false;
    const mediaReference = typeof reference === 'string' ? { status:'complete', url:reference } : reference;
    let found = false;
    const updateRecords = records => (records || []).map(record => {
      if (String(record.id) !== String(identity.eventId)) return record;
      found = true; return { ...record, [field]:mediaReference };
    });
    const events = updateRecords(state.history?.events), suggestions = updateRecords(state.history?.suggestions);
    if (!found) return false;
    state.history = { ...state.history, events, suggestions };
    state.histories = state.histories.map(item => item.id === state.history.id ? state.history : item);
    if (state.question) {
      state.question = { ...state.question, histories:state.histories };
      state.questions = state.questions.map(item => item.id === state.question.id ? state.question : item);
    }
    state.suggestions = (state.history.suggestions || []).filter(item => item.window?.fromYear === state.window?.fromYear && item.window?.toYear === state.window?.toYear);
    emit();
    return true;
  }
  function selectEvent(eventId) {
    if (!state.questionId || !state.historyId || !Number.isSafeInteger(state.date)) return;
    setContext({ questionId: state.questionId, historyId: state.historyId, eventId, date: state.date });
  }
  function selectRecord({ questionId = state.questionId, historyId = state.historyId, eventId, date = state.date, readOnly = true } = {}) {
    if (!questionId || !historyId || !eventId || !Number.isSafeInteger(date)) return false;
    const question = state.questions.find(item => String(item.id) === String(questionId))
      || (String(state.questionId) === String(questionId) ? state.question : null);
    const history = (question?.histories || state.histories || []).find(item => String(item.id) === String(historyId))
      || (String(state.historyId) === String(historyId) ? state.history : null);
    const isEvent = history?.events?.some(item => String(item.id) === String(eventId));
    const isSuggestion = history?.suggestions?.some(item => String(item.id) === String(eventId))
      || (String(state.historyId) === String(historyId) && state.suggestions.some(item => String(item.id) === String(eventId)));
    if (!isEvent && !isSuggestion) return false;
    setContext({ questionId, historyId, eventId, date, readOnly });
    return true;
  }
  function selectSuggestion(suggestionId) { return selectRecord({ eventId:suggestionId }); }
  function selectSuggestionWindow(window) {
    const fromYear = Number(window?.fromYear), toYear = Number(window?.toYear);
    if (!context || !state.history || !Number.isSafeInteger(fromYear) || !Number.isSafeInteger(toYear) || fromYear === 0 || toYear === 0 || fromYear > toYear) return false;
    const exactWindow = { fromYear, toYear };
    const entry = (state.history.suggestionWindows || []).find(item => item.window?.fromYear === fromYear && item.window?.toYear === toYear)
      || ((state.history.suggestions || []).some(item => item.window?.fromYear === fromYear && item.window?.toYear === toYear) ? { window:exactWindow, status:'ready' } : null);
    if (!entry) return false;
    if (state.window?.fromYear === fromYear && state.window?.toYear === toYear) return false;
    if (state.busyIds.size) return false;
    finalizePendingBeforeNavigation(context, state.history);
    let date = Math.trunc((fromYear + toYear) / 2);
    if (date === 0) date = fromYear === 0 ? toYear : fromYear;
    if (date < fromYear || date > toYear) date = fromYear;
    if (date === 0) date = toYear;
    generation++;
    if (timer !== null) { clearTimer(timer); timer = null; }
    context = { ...context, date, window:exactWindow, readOnly:true };
    state.date = date; state.window = exactWindow; state.loading = false;
    state.suggestions = (state.history.suggestions || []).filter(item => item.window?.fromYear === fromYear && item.window?.toYear === toYear);
    state.windowStatus = entry.status || 'ready';
    state.windowCached = ['ready','unknown','pending'].includes(state.windowStatus);
    state.status = state.windowStatus === 'pending' ? 'Suggestions for this saved window are still being prepared.'
      : state.suggestions.length ? '' : 'No saved suggestions in this window.';
    emit();
    return true;
  }
  function setDate(date) {
    if (!state.questionId || !state.historyId || !Number.isSafeInteger(date) || date === 0) return;
    const event = eventAtOrBefore(state.history, date);
    setContext({ questionId: state.questionId, historyId: state.historyId, eventId: event?.id || '', date });
  }
  function setHeldSuggestionIds(ids = []) {
    if (!Array.isArray(ids) && !(ids instanceof Set)) return false;
    const ownerKey = context ? `${context.questionId}:${context.historyId}` : '';
    if (!ownerKey || ownerKey !== heldOwnerKey || !state.history) {
      state.heldSuggestionIds = [];
      emit();
      return [];
    }
    const validIds = new Set([...(state.history.suggestions || []), ...state.suggestions]
      .filter(item => item?.id != null && (item.historyId == null || String(item.historyId) === String(state.historyId)))
      .map(item => String(item.id)));
    state.heldSuggestionIds = [...new Set([...ids].map(String).filter(id => validIds.has(id)))];
    emit();
    return [...state.heldSuggestionIds];
  }
  function clear() {
    finalizePendingBeforeNavigation(context, state.history);
    generation++; if (timer !== null) clearTimer(timer); timer = null; context = null;
    batchCheckOwner++; batchPlanCache.clear(); batchPlanFlights.clear(); batchCheckUncertainCache.clear(); state.batchCheckUncertain = null;
    heldOwnerKey = ''; state.questionId = ''; state.historyId = ''; state.selectedEventId = ''; state.heldSuggestionIds = []; state.date = null; state.window = null; state.suggestions = [];
    state.status = ''; state.loading = false; state.paused = false; state.autoWeaveRunning = false; state.busyIds.clear(); state.history = null; state.question = null; state.histories = []; state.questions = []; state.windowCached = false; state.windowStatus = ''; emit();
  }
  function hover() { /* Preview is deliberately inert: never generate from hover. */ }
  readPreferences();
  return { getState: () => ({ ...state, suggestions: [...state.suggestions], heldSuggestionIds: [...state.heldSuggestionIds], busyIds: new Set(state.busyIds) }),
    subscribe(listener) { listeners.add(listener); return () => listeners.delete(listener); },
    setContext, selectHistory, selectQuestion, openHistory, openQuestion, setQuestions, updateMediaReference, selectEvent, selectSuggestion, selectRecord, selectSuggestionWindow, setDate, setHeldSuggestionIds, clear, hover,
    setAutoSuggest: persistPreference, setAutoWeave: persistAutoWeave, finalizePendingBatch, removePendingEvent,
    suggest: () => requestSuggestions(false), more: () => requestSuggestions(true),
    weave: suggestionId => mutate('/api/history/weave', { suggestionId }, `suggestion:${suggestionId}`),
    checkWeaveBatch, commitWeaveBatch,
    retryRippleBatch: (eventIds, wovenEventIds) => mutate('/api/history/ripple-check-batch', { eventIds, wovenEventIds }, 'ripple-check-batch'),
    forkSuggestion: suggestionId => {
      const suggestion = [...(state.history?.suggestions || []),...(state.suggestions || [])].find(item => String(item.id) === String(suggestionId));
      return mutate('/api/history/fork', { eventId:suggestion?.conflictsWith, suggestionId }, `suggestion:${suggestionId}`);
    },
    forkEvent: eventId => mutate('/api/history/fork', { eventId }, `event:${eventId}`),
    keep: (eventId, wovenEventId) => mutate('/api/history/keep', { eventId, wovenEventId }, `event:${eventId}:${wovenEventId || ''}`),
    regenerate: (eventId, wovenEventId) => mutate('/api/history/regenerate', { eventId, wovenEventId }, `event:${eventId}`),
    reload: () => context && loadHistory({ ...context }, generation), destroy: clear };
}
