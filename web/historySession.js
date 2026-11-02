// Browser-side history window/session state. Network and timers are injectable for tests.
const defaultFetch = (...args) => fetch(...args);
const windowFor = year => {
  const era = Math.floor((Math.abs(year) - 1) / 1000);
  return year < 0 ? { fromYear: -(era + 1) * 1000, toYear: -(era * 1000 + 1) }
    : { fromYear: era * 1000 + 1, toYear: (era + 1) * 1000 };
};

export function createHistorySession({ fetchImpl = defaultFetch, setTimer = setTimeout, clearTimer = clearTimeout,
  onChange = () => {}, debounceMs = 800 } = {}) {
  let context = null, timer = null, generation = 0, preferenceRequest = 0;
  const listeners = new Set();
  const state = { autoSuggest: true, questionId: '', historyId: '', selectedEventId: '', date: null, window: null, question: null, histories: [],
    suggestions: [], status: '', paused: false, loading: false, busyIds: new Set(), history: null, windowCached: false, windowStatus: '' };
  const emit = () => { const snapshot = { ...state, suggestions: [...state.suggestions], busyIds: new Set(state.busyIds) }; onChange(snapshot); for (const listener of listeners) listener(snapshot); };
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
    for (const item of [...(previous?.suggestions || []), ...(incoming?.suggestions || [])]) if (item.window) {
      const key = `${item.window.fromYear}:${item.window.toYear}`;
      const existing = byWindow.get(key);
      add({ window: item.window, status: 'ready', batches: 1, suggestionCount: (existing?.suggestionCount || 0) + 1 });
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
      state.autoSuggest = value.autoSuggest; emit();
      if (context && state.autoSuggest && !state.suggestions.length) scheduleSuggest();
    } catch { /* Preference loading must not block cached history. */ }
  }
  async function persistPreference(value) {
    state.autoSuggest = value; state.paused = false;
    if (timer !== null) { clearTimer(timer); timer = null; }
    emit();
    try {
      const response = await fetchImpl('/api/history/preferences', { method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ autoSuggest: value }) });
      if (!response.ok) state.status = 'Could not save the auto-suggest setting.';
    } catch { state.status = 'Could not save the auto-suggest setting.'; }
    emit();
    if (value && context && !state.suggestions.length) scheduleSuggest();
  }
  async function loadHistory(identity, token) {
    state.loading = true; state.status = 'Loading saved suggestions…'; emit();
    try {
      const response = await fetchImpl(`/api/histories?asOfYear=${encodeURIComponent(identity.date)}`);
      if (!response.ok) throw new Error('Could not load saved history.');
      const data = await response.json();
      if (!isCurrent(token, identity)) return;
      const question = data.questions?.find(item => item.id === identity.questionId);
      const history = question?.histories?.find(item => item.id === identity.historyId)
        || question?.histories?.find(item => item.events?.some(event => event.id === identity.eventId));
      if (!history) { state.history = null; state.suggestions = []; state.status = 'No saved history is available for this story.'; return; }
      context.historyId = history.id; state.question = question; state.histories = question.histories || [];
      state.historyId = history.id; state.history = history; state.window = windowFor(identity.date);
      updateWindowSuggestions(); state.status = state.windowStatus === 'pending' ? 'Suggestions for this window are still being prepared.' : state.windowStatus === 'unknown' ? 'A previous request may have completed; use More to check for another batch.' : '';
    } catch (error) {
      if (isCurrent(token, identity)) state.status = error.message || 'Could not load saved history.';
    } finally {
      if (isCurrent(token, identity)) { state.loading = false; emit(); if (state.autoSuggest && !state.windowCached && !state.suggestions.length) scheduleSuggest(); }
    }
  }
  function scheduleSuggest() {
    if (!context || !state.autoSuggest || state.paused || state.windowCached || state.suggestions.length || !state.history) return;
    if (timer !== null) clearTimer(timer);
    timer = setTimer(() => { timer = null; requestSuggestions(false); }, debounceMs);
  }
  async function requestSuggestions(more) {
    if (!context || state.loading || state.busyIds.size || (!more && state.suggestions.length)) return;
    const identity = { ...context }, token = generation;
    state.loading = true; state.status = more ? `Finding more events around ${identity.date}…` : `Finding events around ${identity.date}…`; emit();
    try {
      const response = await fetchImpl('/api/history/suggest', { method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ questionId: identity.questionId, historyId: identity.historyId, window: identity.window, ...(more ? { more: true } : {}) }) });
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
      if (state.question) state.histories = state.question.histories.map(item => item.id === state.history.id ? state.history : item);
      state.suggestions = (state.history?.suggestions || []).filter(item => item.window?.fromYear === identity.window.fromYear && item.window?.toYear === identity.window.toYear);
      if (Array.isArray(data.suggestions) && data.suggestions.length) state.suggestions = [...new Map([...state.suggestions, ...data.suggestions].map(item => [item.id, item])).values()];
      state.windowCached = true; state.windowStatus = 'ready';
      state.status = state.suggestions.length ? '' : 'No suggestions found for this date window.';
    } catch (error) { if (isCurrent(token, identity)) state.status = error.message || 'Could not suggest events.'; }
    finally { if (isCurrent(token, identity)) { state.loading = false; emit(); } }
  }
  async function mutate(path, payload, busyId) {
    if (!context || state.busyIds.has(busyId)) return null;
    const identity = { ...context, window: { ...state.window }, windowCached: state.windowCached }, token = generation;
    state.busyIds.add(busyId); state.status = 'Saving history…'; emit();
    try {
      const response = await fetchImpl(path, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({
        questionId: identity.questionId, historyId: identity.historyId, ...payload,
      }) });
      const data = await response.json().catch(() => ({}));
      if (!isCurrent(token, identity)) return null;
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
      const forkedHistory = !!(data.history?.id && data.history.id !== context.historyId && data.forkEventId);
      state.question = data.question || state.question;
      state.history = forkedHistory ? mergeWindows(data.history, null, null) : mergeWindows(data.history || state.history, priorHistory,
        identity.window, path === '/api/history/weave' || identity.windowCached ? 'ready' : '');
      if (state.question) state.histories = state.question.histories.map(item => item.id === state.history.id ? state.history : item);
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
      if (forkedHistory && state.autoSuggest && !state.windowCached && !state.suggestions.length) scheduleSuggest();
      return data;
    } catch (error) { if (isCurrent(token, identity)) state.status = error.message || 'Could not update history.'; return null; }
    finally { if (token === generation && context?.questionId === identity.questionId) { state.busyIds.delete(busyId); emit(); } }
  }
  function setContext({ questionId, historyId = '', eventId = '', date } = {}) {
    if (!questionId || !Number.isSafeInteger(date) || date === 0) { clear(); return; }
    if (!historyId && context?.questionId === questionId && state.history?.events?.some(event => event.id === eventId)) historyId = context.historyId;
    const next = { questionId, historyId, eventId, date, window: windowFor(date) };
    const sameHistory = context?.questionId === questionId && context?.historyId === historyId;
    const sameWindow = sameHistory && context.window.fromYear <= date && context.window.toYear >= date;
    if (sameWindow) {
      const changed = context.eventId !== eventId || context.date !== date;
      context.eventId = eventId; context.date = date; state.selectedEventId = eventId; state.date = date;
      if (changed) { emit(); if (state.autoSuggest && !state.windowCached && !state.suggestions.length) scheduleSuggest(); }
      return;
    }
    generation++;
    if (timer !== null) { clearTimer(timer); timer = null; }
    const savedQuestion = state.questionId === questionId ? state.question : null;
    const savedHistories = state.questionId === questionId ? state.histories : [];
    const cachedHistory = sameHistory ? state.history : savedHistories.find(item => item.id === historyId)
      || (!historyId ? savedHistories.find(item => item.events?.some(item => item.id === eventId)) : null);
    if (cachedHistory && !next.historyId) next.historyId = cachedHistory.id;
    context = next; state.questionId = questionId; state.historyId = next.historyId; state.selectedEventId = eventId; state.date = date; state.window = next.window;
    state.question = savedQuestion; state.histories = savedHistories;
    state.loading = false; state.busyIds.clear(); state.paused = false; state.history = cachedHistory || null;
    state.suggestions = [];
    state.windowCached = false; state.windowStatus = '';
    if (state.history) updateWindowSuggestions();
    state.status = '';
    if (state.history) { updateWindowSuggestions(); state.histories = state.histories.map(item => item.id === state.history.id ? state.history : item); emit(); scheduleSuggest(); }
    else { const token = generation; emit(); loadHistory(next, token); }
  }
  function selectHistory(historyId) {
    if (!state.questionId || !historyId || !Number.isSafeInteger(state.date)) return;
    const history = state.histories.find(item => item.id === historyId);
    const selectedExists = history?.events?.some(item => item.id === state.selectedEventId);
    const latest = [...(history?.events || [])].filter(item => item.year <= state.date).sort((a,b) => a.year-b.year).at(-1);
    setContext({ questionId: state.questionId, historyId, eventId: selectedExists ? state.selectedEventId : latest?.id || '', date: state.date });
  }
  function selectEvent(eventId) {
    if (!state.questionId || !state.historyId || !Number.isSafeInteger(state.date)) return;
    setContext({ questionId: state.questionId, historyId: state.historyId, eventId, date: state.date });
  }
  function setDate(date) {
    if (!state.questionId || !state.historyId || !Number.isSafeInteger(date) || date === 0) return;
    setContext({ questionId: state.questionId, historyId: state.historyId, eventId: state.selectedEventId, date });
  }
  function clear() {
    generation++; if (timer !== null) clearTimer(timer); timer = null; context = null;
    state.questionId = ''; state.historyId = ''; state.selectedEventId = ''; state.date = null; state.window = null; state.suggestions = [];
    state.status = ''; state.loading = false; state.paused = false; state.busyIds.clear(); state.history = null; state.question = null; state.histories = []; state.windowCached = false; state.windowStatus = ''; emit();
  }
  function hover() { /* Preview is deliberately inert: never generate from hover. */ }
  readPreferences();
  return { getState: () => ({ ...state, suggestions: [...state.suggestions], busyIds: new Set(state.busyIds) }),
    subscribe(listener) { listeners.add(listener); return () => listeners.delete(listener); },
    setContext, selectHistory, selectEvent, setDate, clear, hover, setAutoSuggest: persistPreference,
    suggest: () => requestSuggestions(false), more: () => requestSuggestions(true),
    weave: suggestionId => mutate('/api/history/weave', { suggestionId }, `suggestion:${suggestionId}`),
    forkSuggestion: suggestionId => mutate('/api/history/fork', { eventId: state.suggestions.find(item => item.id === suggestionId)?.conflictsWith, suggestionId }, `suggestion:${suggestionId}`),
    forkEvent: eventId => mutate('/api/history/fork', { eventId }, `event:${eventId}`),
    keep: (eventId, wovenEventId) => mutate('/api/history/keep', { eventId, wovenEventId }, `event:${eventId}:${wovenEventId || ''}`),
    regenerate: (eventId, wovenEventId) => mutate('/api/history/regenerate', { eventId, wovenEventId }, `event:${eventId}`),
    reload: () => context && loadHistory({ ...context }, generation), destroy: clear };
}
