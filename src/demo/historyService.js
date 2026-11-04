// Application rules for cached suggestion windows, weaving, ripple flags and forks.
// The durable store owns generation reservations so crashes cannot silently
// redispatch an uncertain paid Meta request.
import { createHash, randomUUID } from 'node:crypto';
import { normalizeHistory, normalizeQuestionHistories } from '../../web/historyModel.js';

const validId = value => typeof value === 'string' && value.trim().length > 0 && value.length <= 240;
const isYear = value => Number.isSafeInteger(value) && value !== 0;
const sameWindow = (left, right) => left?.fromYear === right?.fromYear && left?.toYear === right?.toYear;
const sorted = events => [...events].sort((a, b) => a.year - b.year || a.id.localeCompare(b.id));
const windowKey = (questionId, historyId, window) => createHash('sha256').update(JSON.stringify([questionId, historyId, window.fromYear, window.toYear])).digest('hex');
const historyRevision = history => createHash('sha256').update(JSON.stringify(history.events.map(({ id, year, place, title, summary, causeEventId, era, geography }) =>
  ({ id, year, place, title, summary, causeEventId, era, geography })))).digest('hex');
const eventRevision = event => {
  const content = Object.fromEntries(Object.entries(event).filter(([key]) => key !== 'checkFlags').sort(([a], [b]) => a.localeCompare(b)));
  return createHash('sha256').update(JSON.stringify(content)).digest('hex');
};
const suggestionRevision = suggestion => {
  const content = Object.fromEntries(Object.entries(suggestion).filter(([key]) =>
    !['historyRevision', 'recheckStatus', 'recheckReason'].includes(key)).sort(([a], [b]) => a.localeCompare(b)));
  return createHash('sha256').update(JSON.stringify(content)).digest('hex');
};

export class HistoryServiceError extends Error {
  constructor(code, message, status = 400, details = {}) { super(message); this.name = 'HistoryServiceError'; Object.assign(this, { code, status, ...details }); }
}

function resolve(store, questionId, historyId) {
  const question = store.get(questionId);
  if (!question) throw new HistoryServiceError('not_found', 'Question not found', 404);
  const history = question.histories.find(item => item.id === historyId);
  if (!history) throw new HistoryServiceError('not_found', 'History not found', 404);
  return { question, history };
}

function appendSuggestions(history, suggestions) {
  const all = new Map((history.suggestions ?? []).map(item => [item.id, item]));
  for (const item of suggestions) all.set(item.id, { ...item });
  return { ...history, suggestions: [...all.values()].sort((a, b) => a.year - b.year || a.id.localeCompare(b.id)) };
}

function saveHistory(store, question, history) {
  const updated = normalizeQuestionHistories({ ...question, histories: question.histories.map(item => item.id === history.id ? history : item) });
  store.save(updated);
  return updated;
}

function resultFor(question, history, { suggestions = [], generated = false, cached = false, usage, event } = {}) {
  return { question, history, suggestions, generated, cached, ...(event ? { event } : {}), ...(usage ? { usage } : {}) };
}

export function createHistoryService({ store, agent, perSessionWindowCap = 20, now = Date.now } = {}) {
  if (!store || typeof store.get !== 'function' || typeof store.save !== 'function') throw new Error('History service requires a durable history store');
  if (!agent || typeof agent.suggest !== 'function') throw new Error('History service requires a history agent');
  if (!Number.isSafeInteger(perSessionWindowCap) || perSessionWindowCap < 1) throw new Error('Invalid per-session history window cap');
  const inFlight = new Map();
  const localLedger = new Map();
  const mutationTails = new Map();
  const recheckFlights = new Map();

  // Stamp migrated suggestions against their initial durable histories without
  // model calls. Later event changes make that snapshot stale and trigger a
  // Spark check only when the user explicitly weaves or forks the suggestion.
  for (const question of store.list?.() ?? []) {
    let changed = false;
    const histories = question.histories.map(history => {
      const revision = historyRevision(history);
      let historyChanged = false;
      const suggestions = (history.suggestions ?? []).map(item => {
        if (item.historyRevision) return item;
        historyChanged = true;
        return { ...item, historyRevision: revision };
      });
      if (historyChanged) changed = true;
      return historyChanged ? { ...history, suggestions } : history;
    });
    if (changed) store.save({ ...question, histories });
  }

  async function mutateQuestion(questionId, operation) {
    const previous = mutationTails.get(questionId) ?? Promise.resolve();
    let release;
    const current = new Promise(resolve => { release = resolve; });
    mutationTails.set(questionId, current);
    await previous;
    try { return operation(); }
    finally { release(); if (mutationTails.get(questionId) === current) mutationTails.delete(questionId); }
  }

  async function suggest({ questionId, historyId, window, userId, sessionId, signal, more = false } = {}) {
    if (!validId(questionId) || !validId(historyId)) throw new HistoryServiceError('invalid_request', 'Question and history are required');
    if (!window || !Number.isSafeInteger(window.fromYear) || !Number.isSafeInteger(window.toYear) || window.fromYear > window.toYear || window.toYear - window.fromYear > 100_000) {
      throw new HistoryServiceError('invalid_window', 'Invalid suggestion window');
    }
    const { question, history } = resolve(store, questionId, historyId);
    const key = `${windowKey(questionId, historyId, window)}:${more ? 'more' : 'initial'}`;
    if (inFlight.has(key)) return inFlight.get(key);
    const task = (async () => {
      const localMatches = (history.suggestions ?? []).filter(item => sameWindow(item.window, window));
      if (!more && localMatches.length) return resultFor(question, history, { suggestions: localMatches, cached: true, usage: store.usage?.(userId, sessionId) });

      let reservation;
      if (typeof store.reserveWindow === 'function') {
        reservation = store.reserveWindow({ questionId, historyId, window, requestId: randomUUID(), more,
          userId, sessionId, cap: perSessionWindowCap, now: new Date(now()).toISOString() });
        if (reservation.status === 'cached') return resultFor(question, history, { suggestions: reservation.suggestions ?? localMatches, cached: true, usage: store.usage?.(userId, sessionId) });
        if (reservation.status === 'capped') throw new HistoryServiceError('session_cap', 'Suggestion limit reached for this session', 429,
          { used: reservation.used, limit: reservation.limit });
        if (reservation.status === 'pending') throw new HistoryServiceError('generation_pending', 'Suggestions for this window are still being generated', 409);
        if (reservation.status === 'unknown') throw new HistoryServiceError('generation_uncertain', 'The previous suggestion request may have reached the model. Use More to request another batch.', 409);
        if (reservation.status === 'failed') throw new HistoryServiceError('generation_failed', 'The previous request did not reach the model. Use More to request another batch.', 409);
        if (reservation.status !== 'reserved') throw new HistoryServiceError('generation_unavailable', 'Suggestion request could not be reserved', 409);
      } else {
        const count = localLedger.get(String(sessionId)) ?? 0;
        if (validId(sessionId) && count >= perSessionWindowCap) throw new HistoryServiceError('session_cap', 'Suggestion limit reached for this session', 429,
          { used: count, limit: perSessionWindowCap });
        localLedger.set(String(sessionId), count + 1);
        reservation = { status: 'reserved', requestId: randomUUID() };
      }
      const dispatchStart = agent.client?.dispatchCount?.();
      try {
        const generated = await agent.suggest({ question, history, window, signal });
        const revision = historyRevision(history);
        const suggestions = generated.map(item => ({ ...item, window: { ...window }, historyRevision: revision, generatedAt: new Date(now()).toISOString() }));
        let completed = { status: 'ready', suggestions };
        if (typeof store.completeWindow === 'function') completed = store.completeWindow({ questionId, historyId, window,
          requestId: reservation.requestId, more, suggestions });
        const saved = await mutateQuestion(questionId, () => {
          const latestQuestion = store.get(questionId);
          if (!latestQuestion) throw new HistoryServiceError('not_found', 'Question was removed while suggestions were generated', 404);
          const latestHistory = latestQuestion.histories.find(item => item.id === historyId);
          if (!latestHistory) throw new HistoryServiceError('not_found', 'History was removed while suggestions were generated', 404);
          const nextHistory = appendSuggestions(latestHistory, completed.suggestions ?? suggestions);
          const savedQuestion = saveHistory(store, latestQuestion, nextHistory);
          return { question: savedQuestion, history: savedQuestion.histories.find(item => item.id === historyId) };
        });
        return resultFor(saved.question, saved.history, { suggestions: completed.suggestions ?? suggestions, generated: true,
          usage: completed.usage ?? store.usage?.(userId, sessionId) });
      } catch (error) {
        const dispatched = Number.isSafeInteger(dispatchStart) && typeof agent.client?.dispatchCount === 'function'
          ? agent.client.dispatchCount() > dispatchStart : true;
        if (typeof store.failWindow === 'function') store.failWindow({ questionId, historyId, window, requestId: reservation.requestId,
          more, uncertain: dispatched, reason: error?.code === 'spend_cap' || error?.name === 'SpendCapError' ? 'spend-cap' : 'generation-failed' });
        if (error?.name === 'SpendCapError') throw new HistoryServiceError('spend_cap', error.message, 429, { cause: error });
        if (dispatched) throw new HistoryServiceError('generation_uncertain', 'The suggestion request may have reached the model. Use More to request another batch.', 409, { cause: error });
        throw error;
      }
    })();
    inFlight.set(key, task);
    try { return await task; } finally { if (inFlight.get(key) === task) inFlight.delete(key); }
  }

  function pendingRecheck(suggestion, message = 'This saved suggestion needs a fresh compatibility check. It remains available; retry this action when checking is available.') {
    throw new HistoryServiceError('suggestion_recheck_pending', message, 409, { suggestion,
      conflictsWith: suggestion?.conflictsWith ?? undefined, reason: suggestion?.reason ?? undefined });
  }

  async function ensureCurrentSuggestion({ questionId, historyId, suggestionId, signal } = {}) {
    const initial = resolve(store, questionId, historyId);
    const original = initial.history.suggestions?.find(item => item.id === suggestionId);
    if (!original) throw new HistoryServiceError('not_found', 'Suggestion not found', 404);
    const observedHistoryRevision = historyRevision(initial.history);
    if (original.historyRevision === observedHistoryRevision) return { ...initial, suggestion: original };
    const observedSuggestionRevision = suggestionRevision(original);
    const key = JSON.stringify([questionId, historyId, suggestionId, observedHistoryRevision]);
    if (recheckFlights.has(key)) return recheckFlights.get(key);
    const task = (async () => {
      const prepared = await mutateQuestion(questionId, () => {
        const { question, history } = resolve(store, questionId, historyId);
        const current = history.suggestions?.find(item => item.id === suggestionId);
        if (!current) throw new HistoryServiceError('not_found', 'Suggestion not found', 404);
        const latestRevision = historyRevision(history);
        if (current.historyRevision === latestRevision && !current.recheckStatus) return { question, history, suggestion: current, fresh: true };
        const pending = { ...current, recheckStatus: 'pending', recheckReason: 'history-changed' };
        const saved = saveHistory(store, question, { ...history, suggestions: history.suggestions.map(item => item.id === suggestionId ? pending : item) });
        const suggestion = saved.histories.find(item => item.id === historyId).suggestions.find(item => item.id === suggestionId);
        return { question: saved, history: saved.histories.find(item => item.id === historyId), suggestion,
          staleDuringPrepare: latestRevision !== observedHistoryRevision || suggestionRevision(current) !== observedSuggestionRevision };
      });
      if (prepared.fresh) return prepared;
      if (prepared.staleDuringPrepare) return pendingRecheck(prepared.suggestion, 'The history changed before the cached suggestion could be checked. It remains saved; retry Weave or What-if to re-check it.');
      if (typeof agent.checkSuggestion !== 'function') return pendingRecheck(prepared.suggestion,
        'The compatibility check is unavailable in replay mode. The saved suggestion remains available; retry when live checking is available.');
      let verdict;
      try { verdict = await agent.checkSuggestion({ question: prepared.question, history: prepared.history, suggestion: original, signal }); }
      catch (error) {
        const message = error?.code === 'suggestion_recheck_unavailable'
          ? 'Live compatibility checking is disabled in replay mode. The saved suggestion remains available; switch to live mode to re-check it.'
          : 'The compatibility check did not complete. The suggestion remains saved; retry Weave or What-if when checking is available.';
        return pendingRecheck(prepared.suggestion, message);
      }
      return mutateQuestion(questionId, () => {
        const { question, history } = resolve(store, questionId, historyId);
        const current = history.suggestions?.find(item => item.id === suggestionId);
        if (!current) throw new HistoryServiceError('not_found', 'Suggestion was removed during its compatibility check', 404);
        const latestRevision = historyRevision(history);
        if (current.historyRevision === latestRevision && !current.recheckStatus) return { question, history, suggestion: current };
        if (latestRevision !== observedHistoryRevision || suggestionRevision(current) !== observedSuggestionRevision) {
          const pending = { ...current, recheckStatus: 'pending', recheckReason: 'history-changed-during-check' };
          const saved = saveHistory(store, question, { ...history, suggestions: history.suggestions.map(item => item.id === suggestionId ? pending : item) });
          const savedHistory = saved.histories.find(item => item.id === historyId);
          return pendingRecheck(savedHistory.suggestions.find(item => item.id === suggestionId),
            'The history changed while the suggestion was being checked. The suggestion remains saved; retry Weave or What-if to check the new version.');
        }
        const updated = { ...current, ...verdict, historyRevision: observedHistoryRevision };
        delete updated.recheckStatus;
        delete updated.recheckReason;
        const saved = saveHistory(store, question, { ...history, suggestions: history.suggestions.map(item => item.id === suggestionId ? updated : item) });
        const savedHistory = saved.histories.find(item => item.id === historyId);
        return { question: saved, history: savedHistory, suggestion: savedHistory.suggestions.find(item => item.id === suggestionId) };
      });
    })();
    recheckFlights.set(key, task);
    try { return await task; } finally { if (recheckFlights.get(key) === task) recheckFlights.delete(key); }
  }

  async function weave({ questionId, historyId, suggestionId } = {}) {
    const initial = resolve(store, questionId, historyId);
    const alreadyWoven = initial.history.events.find(item => item.id === suggestionId);
    if (alreadyWoven) return { ...resultFor(initial.question, initial.history, { event: alreadyWoven, cached: true }), ripple: [] };
    await ensureCurrentSuggestion({ questionId, historyId, suggestionId });
    const started = await mutateQuestion(questionId, () => {
      const { question, history } = resolve(store, questionId, historyId);
      const existing = history.events.find(item => item.id === suggestionId);
      if (existing) return { question, history, event: existing, alreadyWoven: true, later: [] };
      const suggestion = history.suggestions?.find(item => item.id === suggestionId);
      if (!suggestion) throw new HistoryServiceError('not_found', 'Suggestion not found', 404);
      if (suggestion.historyRevision !== historyRevision(history)) {
        const pending = { ...suggestion, recheckStatus: 'pending', recheckReason: 'history-changed-before-weave' };
        const saved = saveHistory(store, question, { ...history, suggestions: history.suggestions.map(item => item.id === suggestionId ? pending : item) });
        return pendingRecheck(saved.histories.find(item => item.id === historyId).suggestions.find(item => item.id === suggestionId),
          'The history changed after checking. The suggestion remains saved; retry Weave to check the new version.');
      }
      if (suggestion.verdict !== 'fits') {
        if (suggestion.verdict === 'conflicts') throw new HistoryServiceError('suggestion_became_conflict', 'This saved suggestion conflicts with the current history. It remains available for What-if.', 409,
          { conflictsWith: suggestion.conflictsWith, reason: suggestion.reason, suggestion });
        throw new HistoryServiceError('invalid_suggestion', 'Suggestion verdict is unavailable', 409, { suggestion });
      }
      if (!isYear(suggestion.year) || !validId(suggestion.causeEventId)) throw new HistoryServiceError('invalid_suggestion', 'Suggestion cannot be woven');
      const cause = suggestion.causeEventId === question.id ? null : history.events.find(event => event.id === suggestion.causeEventId);
      if (suggestion.causeEventId !== question.id && (!cause || cause.year >= suggestion.year)) throw new HistoryServiceError('invalid_cause', 'Suggestion cause is not earlier in this history', 409);
      const event = { ...suggestion, id: suggestion.id };
      delete event.window; delete event.verdict; delete event.conflictsWith; delete event.reason; delete event.generatedAt; delete event.historyRevision;
      const later = history.events.filter(item => item.id !== event.id && item.year > event.year);
      const eventDisplayDate = event.year < 0 ? `${Math.abs(event.year)} BCE` : `${event.year} CE`;
      const flaggedLater = new Map(later.map(item => [item.id, { ...item, checkFlags: [...(item.checkFlags ?? []).filter(flag =>
        !(flag?.kind === 'weave-ripple' && flag.wovenEventId === event.id)), {
        kind: 'weave-ripple', eventId: item.id, wovenEventId: event.id, year: item.year, status: 'pending',
        message: `Written before ${eventDisplayDate} was woven in. Re-check pending.`, actions: ['keep', 'regenerate'],
      }] }]));
      const nextHistory = { ...history, events: sorted([...history.events.filter(item => !flaggedLater.has(item.id)), ...flaggedLater.values(), event]),
        suggestions: (history.suggestions ?? []).filter(item => item.id !== suggestionId) };
      const savedQuestion = saveHistory(store, question, nextHistory);
      const savedHistory = savedQuestion.histories.find(item => item.id === historyId);
      return { question: savedQuestion, history: savedHistory, event: savedHistory.events.find(item => item.id === event.id),
        alreadyWoven: false, later: savedHistory.events.filter(item => flaggedLater.has(item.id)) };
    });
    if (started.alreadyWoven) return { ...resultFor(started.question, started.history, { event: started.event, cached: true }), ripple: [] };
    // Review-needed flags are durable before any Spark call, so interruption or
    // uncertainty cannot silently leave later events looking fully checked.
    const checks = await Promise.all(started.later.map(async laterEvent => {
      try {
        const result = await agent.checkRipple({ question: started.question, event: laterEvent, history: started.history, wovenEvent: started.event });
        return { eventId: laterEvent.id, wovenEventId: started.event.id, result };
      } catch (error) { return { eventId: laterEvent.id, wovenEventId: started.event.id, error: error.message }; }
    }));
    const final = await mutateQuestion(questionId, () => {
      const { question, history } = resolve(store, questionId, historyId);
      const byEvent = new Map(checks.map(item => [item.eventId, item]));
      const flags = [];
      const nextHistory = { ...history, events: history.events.map(item => {
        const checked = byEvent.get(item.id);
        if (!checked) return item;
        const currentFlag = (item.checkFlags ?? []).find(flag => flag?.kind === 'weave-ripple' && flag.wovenEventId === started.event.id);
        if (!currentFlag || currentFlag.status === 'kept') return item;
        if (checked.result && !checked.result.inconsistent) return { ...item, checkFlags: item.checkFlags.filter(flag => flag !== currentFlag) };
        const needsReview = { ...currentFlag, status: checked.error ? 'unavailable' : 'review',
          message: `Written before ${started.event.year < 0 ? `${Math.abs(started.event.year)} BCE` : `${started.event.year} CE`} was woven in. Re-check suggested.`,
          ...(checked.error ? { error: checked.error } : { reason: checked.result.reason }), actions: ['keep', 'regenerate'] };
        flags.push({ ...needsReview, eventId: item.id });
        return { ...item, checkFlags: item.checkFlags.map(flag => flag === currentFlag ? needsReview : flag) };
      }) };
      const savedQuestion = saveHistory(store, question, nextHistory);
      return { question: savedQuestion, history: savedQuestion.histories.find(item => item.id === historyId),
        event: savedQuestion.histories.find(item => item.id === historyId).events.find(item => item.id === started.event.id), flags };
    });
    return { ...resultFor(final.question, final.history, { event: final.event }), ripple: final.flags };
  }

  async function weaveBatch({ questionId, historyId, suggestionIds, userId, sessionId, signal } = {}) {
    if (!validId(questionId) || !validId(historyId) || !Array.isArray(suggestionIds)
        || suggestionIds.length < 1 || suggestionIds.length > 32
        || suggestionIds.some(id => !validId(id)) || new Set(suggestionIds).size !== suggestionIds.length) {
      throw new HistoryServiceError('invalid_batch', 'Select between 1 and 32 unique suggestions.', 400);
    }

    // A replay of the same request is a read: it does not duplicate events or
    // dispatch another compatibility check.
    const initial = resolve(store, questionId, historyId);
    const existingEvents = new Map(initial.history.events.map(item => [item.id, item]));
    if (suggestionIds.every(id => existingEvents.has(id))) {
      return { ...resultFor(initial.question, initial.history, { cached: true }),
        events: suggestionIds.map(id => existingEvents.get(id)), ripple: [] };
    }

    // Refresh every selected suggestion before making any timeline change.
    // This may update stale suggestion verdict metadata, but never inserts a
    // subset of the requested events.
    for (const suggestionId of suggestionIds) {
      if (!existingEvents.has(suggestionId)) await ensureCurrentSuggestion({ questionId, historyId, suggestionId, signal });
    }

    const started = await mutateQuestion(questionId, () => {
      const { question, history } = resolve(store, questionId, historyId);
      const alreadyWoven = new Map(history.events.map(item => [item.id, item]));
      const selected = [];
      for (const suggestionId of suggestionIds) {
        if (alreadyWoven.has(suggestionId)) continue;
        const suggestion = history.suggestions?.find(item => item.id === suggestionId);
        if (!suggestion) throw new HistoryServiceError('not_found', 'Suggestion not found', 404);
        if (suggestion.historyRevision !== historyRevision(history)) {
          throw new HistoryServiceError('suggestion_recheck_pending', 'A selected suggestion changed during batch validation. Retry the batch.', 409, { suggestion });
        }
        if (suggestion.verdict !== 'fits') {
          const conflict = suggestion.verdict === 'conflicts';
          throw new HistoryServiceError(conflict ? 'suggestion_became_conflict' : 'invalid_suggestion',
            conflict ? 'A selected suggestion conflicts with the current history. It remains available for What-if.' : 'A selected suggestion is not confirmed to fit.',
            409, { ...(suggestion.conflictsWith ? { conflictsWith: suggestion.conflictsWith } : {}), reason: suggestion.reason, suggestion });
        }
        if (!isYear(suggestion.year) || !validId(suggestion.causeEventId)) throw new HistoryServiceError('invalid_suggestion', 'A selected suggestion cannot be woven', 409, { suggestion });
        selected.push(suggestion);
      }
      const selectedById = new Map(selected.map(item => [item.id, item]));
      for (const suggestion of selected) {
        const cause = suggestion.causeEventId === question.id ? null
          : history.events.find(event => event.id === suggestion.causeEventId) ?? selectedById.get(suggestion.causeEventId);
        if (suggestion.causeEventId !== question.id && (!cause || cause.year >= suggestion.year)) {
          throw new HistoryServiceError('invalid_cause', 'A selected suggestion cause is not earlier in this history or batch.', 409, { suggestion });
        }
      }
      if (!selected.length) return { question, history, events: suggestionIds.map(id => alreadyWoven.get(id)), later: [], cached: true };

      const wovenEvents = selected.map(suggestion => {
        const event = { ...suggestion, id: suggestion.id };
        for (const key of ['window', 'verdict', 'conflictsWith', 'reason', 'generatedAt', 'historyRevision', 'recheckStatus', 'recheckReason']) delete event[key];
        return event;
      });
      const allEvents = sorted([...history.events, ...wovenEvents]);
      const laterEvents = allEvents.filter(item => !selectedById.has(item.id) && wovenEvents.some(event => item.year > event.year));
      const withPending = allEvents.map(item => {
        if (selectedById.has(item.id)) return item;
        const newlyEarlier = wovenEvents.filter(event => item.year > event.year);
        if (!newlyEarlier.length) return item;
        const flags = (item.checkFlags ?? []).filter(flag => !(flag?.kind === 'weave-ripple' && newlyEarlier.some(event => flag.wovenEventId === event.id)));
        for (const wovenEvent of newlyEarlier) {
          const date = wovenEvent.year < 0 ? `${Math.abs(wovenEvent.year)} BCE` : `${wovenEvent.year} CE`;
          flags.push({ kind: 'weave-ripple', eventId: item.id, wovenEventId: wovenEvent.id, year: item.year, status: 'pending',
            message: `Written before ${date} was woven in. Re-check pending.`, actions: ['keep', 'regenerate'] });
        }
        return { ...item, checkFlags: flags };
      });
      const nextHistory = { ...history, events: withPending,
        suggestions: (history.suggestions ?? []).filter(item => !selectedById.has(item.id)) };
      const savedQuestion = saveHistory(store, question, nextHistory);
      const savedHistory = savedQuestion.histories.find(item => item.id === historyId);
      return { question: savedQuestion, history: savedHistory,
        events: wovenEvents.map(event => savedHistory.events.find(item => item.id === event.id)),
        wovenEvents, later: laterEvents.map(event => savedHistory.events.find(item => item.id === event.id)), cached: false };
    });
    if (started.cached) return { ...resultFor(started.question, started.history, { cached: true }), events: started.events, ripple: [] };

    let checks, checkError;
    if (started.later.length) {
      try {
        if (typeof agent.checkRippleBatch !== 'function') throw new Error('Combined ripple checking is unavailable');
        checks = await agent.checkRippleBatch({ question: started.question, events: started.later, history: started.history,
          wovenEvents: started.wovenEvents, signal });
      } catch (error) { checkError = error; }
    } else checks = [];
    const final = await mutateQuestion(questionId, () => {
      const { question, history } = resolve(store, questionId, historyId);
      const checkByEvent = new Map((checks ?? []).map(item => [item.eventId, item]));
      const ripple = [];
      const updated = { ...history, events: history.events.map(event => {
        const earlier = started.wovenEvents.filter(item => event.year > item.year && !started.wovenEvents.some(other => other.id === event.id));
        if (!earlier.length) return event;
        const result = checkByEvent.get(event.id);
        const flags = (event.checkFlags ?? []).map(flag => {
          if (flag?.kind !== 'weave-ripple' || !earlier.some(item => item.id === flag.wovenEventId) || flag.status === 'kept') return flag;
          if (!checkError && result && !result.inconsistent) return null;
          const failed = { ...flag, status: checkError || !result ? 'unavailable' : 'review',
            message: `Written before ${earlier.map(item => item.year < 0 ? `${Math.abs(item.year)} BCE` : `${item.year} CE`).join(', ')} was woven in. Re-check suggested.`,
            ...(checkError || !result ? { error: checkError?.message ?? 'No ripple result was returned.' } : { reason: result.reason }), actions: ['keep', 'regenerate'] };
          ripple.push(failed);
          return failed;
        }).filter(Boolean);
        return { ...event, checkFlags: flags };
      }) };
      const saved = saveHistory(store, question, updated);
      const savedHistory = saved.histories.find(item => item.id === historyId);
      return { question: saved, history: savedHistory, events: started.events.map(item => savedHistory.events.find(event => event.id === item.id)), ripple };
    });
    return { ...resultFor(final.question, final.history), events: final.events, ripple: final.ripple,
      usage: store.usage?.(userId, sessionId) };
  }

  async function fork({ questionId, historyId, eventId, suggestionId, userId, sessionId } = {}) {
    if (suggestionId) await ensureCurrentSuggestion({ questionId, historyId, suggestionId });
    return mutateQuestion(questionId, () => {
    const { question, history } = resolve(store, questionId, historyId);
    const point = history.events.find(event => event.id === eventId);
    if (!point) throw new HistoryServiceError('not_found', 'Fork event not found', 404);
    const suggestion = suggestionId ? history.suggestions?.find(item => item.id === suggestionId) : null;
    if (suggestionId && !suggestion) throw new HistoryServiceError('not_found', 'Fork suggestion not found', 404);
    if (suggestion && suggestion.historyRevision !== historyRevision(history)) {
      const pending = { ...suggestion, recheckStatus: 'pending', recheckReason: 'history-changed-before-fork' };
      const saved = saveHistory(store, question, { ...history, suggestions: history.suggestions.map(item => item.id === suggestionId ? pending : item) });
      return pendingRecheck(saved.histories.find(item => item.id === historyId).suggestions.find(item => item.id === suggestionId),
        'The history changed after checking. The suggestion remains saved; retry What-if to check the new version.');
    }
    if (suggestion && suggestion.verdict !== 'conflicts') throw new HistoryServiceError('invalid_fork', 'This suggestion still fits the current history and cannot be forked.', 409, { suggestion });
    if (suggestion && suggestion.conflictsWith !== eventId) throw new HistoryServiceError('suggestion_became_conflict', 'The suggestion now conflicts with a different event. Its updated verdict remains saved.', 409,
      { conflictsWith: suggestion.conflictsWith, reason: suggestion.reason, suggestion });
    const forkYear = suggestion ? Math.min(point.year, suggestion.year) : point.year;
    const prefix = sorted(history.events.filter(event => event.year < forkYear));
    const replacedEvent = Object.fromEntries(['id', 'year', 'place', 'title', 'summary', 'causeEventId', 'era', 'geography']
      .filter(key => point[key] !== undefined).map(key => [key, structuredClone(point[key])]));
    const forked = { id: `history-fork-${randomUUID()}`,
      events: prefix, forkEventId: eventId, forkedFromHistoryId: history.id,
      forkReason: suggestion?.reason ?? `What if instead of ${point.title}?`,
      origin: { kind: suggestion ? 'conflicting-suggestion-fork' : 'deliberate-what-if', forkYear, replacedEvent } };
    if (suggestion) {
      const alternative = { ...suggestion, id: suggestion.id };
      delete alternative.window; delete alternative.verdict; delete alternative.conflictsWith; delete alternative.reason; delete alternative.generatedAt; delete alternative.historyRevision;
      if (alternative.causeEventId !== question.id && !prefix.some(event => event.id === alternative.causeEventId)) {
        const excludedCause = history.events.find(event => event.id === alternative.causeEventId);
        alternative.causeEventId = question.id;
        forked.forkReason += ` Its original cause${excludedCause ? `, ${excludedCause.title},` : ''} falls after fork year ${forkYear}; the question is used as the cause instead.`;
      }
      forked.events = sorted([...prefix, alternative]);
    }
    const normalizedFork = normalizeHistory(forked, { questionId });
    const savedQuestion = normalizeQuestionHistories({ ...question, histories: [...question.histories, normalizedFork] });
    store.save(savedQuestion);
    if (validId(userId) && validId(sessionId)) store.recordUsage?.({ userId, sessionId, kind: 'histories' });
    return { question: savedQuestion, history: savedQuestion.histories.find(item => item.id === normalizedFork.id), forkedHistory: normalizedFork,
      sharedEventIds: prefix.map(event => event.id), forkEventId: eventId, readyForAlternative: !suggestion };
    });
  }

  async function rippleCheck({ questionId, historyId, eventId, wovenEventId, signal } = {}) {
    const started = await mutateQuestion(questionId, () => {
      const { question, history } = resolve(store, questionId, historyId);
      const event = history.events.find(item => item.id === eventId), wovenEvent = history.events.find(item => item.id === wovenEventId);
      if (!event || !wovenEvent) throw new HistoryServiceError('not_found', 'Ripple-check event not found', 404);
      if (event.year <= wovenEvent.year) throw new HistoryServiceError('invalid_ripple', 'Ripple check requires a later event', 400);
      const pending = { kind: 'weave-ripple', eventId, wovenEventId, year: event.year, status: 'pending',
        message: `Written before ${wovenEvent.year < 0 ? `${Math.abs(wovenEvent.year)} BCE` : `${wovenEvent.year} CE`} was woven in. Re-check pending.`, actions: ['keep', 'regenerate'] };
      const next = { ...history, events: history.events.map(item => item.id === eventId
        ? { ...item, checkFlags: [...(item.checkFlags ?? []).filter(flag => !(flag?.kind === 'weave-ripple' && flag.wovenEventId === wovenEventId)), pending] } : item) };
      const saved = saveHistory(store, question, next);
      return { question: saved, history: saved.histories.find(item => item.id === historyId),
        event: saved.histories.find(item => item.id === historyId).events.find(item => item.id === eventId), wovenEvent };
    });
    let result, error;
    try { result = await agent.checkRipple({ question: started.question, event: started.event, history: started.history, wovenEvent: started.wovenEvent, signal }); }
    catch (caught) { error = caught; }
    const final = await mutateQuestion(questionId, () => {
      const { question, history } = resolve(store, questionId, historyId);
      const event = history.events.find(item => item.id === eventId);
      const current = event?.checkFlags?.find(flag => flag?.kind === 'weave-ripple' && flag.wovenEventId === wovenEventId);
      if (!event || !current || current.status === 'kept') return { question, history, event, flag: current };
      if (result && !result.inconsistent) {
        const next = { ...history, events: history.events.map(item => item.id === eventId
          ? { ...item, checkFlags: item.checkFlags.filter(flag => flag !== current) } : item) };
        const saved = saveHistory(store, question, next);
        return { question: saved, history: saved.histories.find(item => item.id === historyId), event: undefined, flag: null };
      }
      const flag = { ...current, status: error ? 'unavailable' : 'review',
        message: `Written before ${started.wovenEvent.year < 0 ? `${Math.abs(started.wovenEvent.year)} BCE` : `${started.wovenEvent.year} CE`} was woven in. Re-check suggested.`,
        ...(error ? { error: error.message } : { reason: result.reason }), actions: ['keep', 'regenerate'] };
      const next = { ...history, events: history.events.map(item => item.id === eventId
        ? { ...item, checkFlags: item.checkFlags.map(value => value === current ? flag : value) } : item) };
      const saved = saveHistory(store, question, next);
      return { question: saved, history: saved.histories.find(item => item.id === historyId),
        event: saved.histories.find(item => item.id === historyId).events.find(item => item.id === eventId), flag };
    });
    if (error) throw new HistoryServiceError('ripple_uncertain', 'The ripple check did not complete. Review the event or request a fresh check.', 409, { cause: error });
    return { ...resultFor(final.question, final.history, { event: final.event }), flag: final.flag, result };
  }

  async function regenerateEvent({ questionId, historyId, eventId, wovenEventId, userId, sessionId, signal } = {}) {
    const started = await mutateQuestion(questionId, () => {
      const { question, history } = resolve(store, questionId, historyId);
      const event = history.events.find(item => item.id === eventId);
      if (!event) throw new HistoryServiceError('not_found', 'Event not found', 404);
      const unresolved = (event.checkFlags ?? []).filter(flag => flag?.kind === 'weave-ripple' && flag.status !== 'kept');
      const rippleFlag = wovenEventId ? unresolved.find(flag => flag.wovenEventId === wovenEventId)
        : unresolved.length === 1 ? unresolved[0] : null;
      if (unresolved.length > 1 && !wovenEventId) throw new HistoryServiceError('ambiguous_ripple_flag', 'Select the specific woven event this flag belongs to.', 409,
        { wovenEventIds: unresolved.map(flag => flag.wovenEventId) });
      if (!rippleFlag) throw new HistoryServiceError('no_ripple_flag', 'This event has no unresolved weave re-check flag', 409);
      const wovenEvent = history.events.find(item => item.id === rippleFlag.wovenEventId);
      if (!wovenEvent) throw new HistoryServiceError('not_found', 'Woven event for this re-check is no longer in the history', 409);
      if (rippleFlag.regeneration?.status === 'pending') throw new HistoryServiceError('regeneration_pending', 'This event is already being regenerated', 409);
      if (typeof agent.regenerateEvent !== 'function') throw new HistoryServiceError('regeneration_unavailable', 'Event regeneration is unavailable', 501);
      const pendingFlag = { ...rippleFlag, regeneration: { status: 'pending', startedAt: new Date(now()).toISOString() } };
      const pendingEvent = { ...event, checkFlags: (event.checkFlags ?? []).map(flag => flag === rippleFlag ? pendingFlag : flag) };
      const saved = saveHistory(store, question, { ...history, events: history.events.map(item => item.id === eventId ? pendingEvent : item) });
      return { question: saved, history: saved.histories.find(item => item.id === historyId), event: pendingEvent, wovenEvent, rippleFlag, pendingFlag };
    });
    const dispatchStart = agent.client?.dispatchCount?.();
    try {
      const replacement = await agent.regenerateEvent({ question: started.question, event: started.event, history: started.history, wovenEvent: started.wovenEvent, signal });
      const final = await mutateQuestion(questionId, () => {
        const { question, history } = resolve(store, questionId, historyId);
        const current = history.events.find(item => item.id === eventId);
        if (!current) throw new HistoryServiceError('not_found', 'Event was removed during regeneration', 404);
        const currentFlag = (current.checkFlags ?? []).find(flag => flag?.kind === 'weave-ripple' && flag.wovenEventId === started.wovenEvent.id);
        if (!currentFlag || currentFlag.status === 'kept') throw new HistoryServiceError('event_changed', 'The event was resolved while regeneration was in progress; its current state was preserved.', 409);
        if (eventRevision(current) !== eventRevision(started.event)) {
          throw new HistoryServiceError('event_changed', 'The event changed while regeneration was in progress; request a fresh review.', 409);
        }
        const updatedEvent = { ...current, ...replacement, id: current.id, year: current.year, place: current.place,
          checkFlags: current.checkFlags.filter(flag => !(flag.kind === 'weave-ripple' && flag.wovenEventId === started.wovenEvent.id)) };
        for (const key of ['scene', 'sceneRef', 'heroRef', 'cutoutRef', 'modelRef']) delete updatedEvent[key];
        const saved = saveHistory(store, question, { ...history, events: history.events.map(item => item.id === eventId ? updatedEvent : item) });
        return { question: saved, history: saved.histories.find(item => item.id === historyId), event: updatedEvent };
      });
      return resultFor(final.question, final.history, { event: final.event, usage: store.usage?.(userId, sessionId) });
    } catch (error) {
      const dispatched = Number.isSafeInteger(dispatchStart) && typeof agent.client?.dispatchCount === 'function'
        ? agent.client.dispatchCount() > dispatchStart : true;
      await mutateQuestion(questionId, () => {
        const { question, history } = resolve(store, questionId, historyId);
        const current = history.events.find(item => item.id === eventId);
        if (!current) return;
        const currentFlag = (current.checkFlags ?? []).find(flag => flag?.kind === 'weave-ripple' && flag.wovenEventId === started.wovenEvent.id);
        if (!currentFlag || currentFlag.status === 'kept') return;
        const uncertainFlag = { ...currentFlag, regeneration: { status: dispatched ? 'unknown' : 'failed', updatedAt: new Date(now()).toISOString() } };
        saveHistory(store, question, { ...history, events: history.events.map(item => item.id === eventId
          ? { ...item, checkFlags: item.checkFlags.map(flag => flag === currentFlag ? uncertainFlag : flag) } : item) });
      });
      if (dispatched) throw new HistoryServiceError('regeneration_uncertain', 'Regeneration may have reached the model. A new explicit Regenerate request can try again.', 409, { cause: error });
      if (error?.name === 'SpendCapError') throw new HistoryServiceError('spend_cap', error.message, 429, { cause: error });
      throw error;
    }
  }

  async function keepEvent({ questionId, historyId, eventId, wovenEventId } = {}) {
    return mutateQuestion(questionId, () => {
    const { question, history } = resolve(store, questionId, historyId);
    const event = history.events.find(item => item.id === eventId);
    if (!event) throw new HistoryServiceError('not_found', 'Event not found', 404);
    const flags = (event.checkFlags ?? []).filter(flag => flag?.kind === 'weave-ripple');
    const selected = wovenEventId ? flags.find(flag => flag.wovenEventId === wovenEventId) : flags.length === 1 ? flags[0] : null;
    if (flags.length > 1 && !wovenEventId) throw new HistoryServiceError('ambiguous_ripple_flag', 'Select the specific woven event this flag belongs to.', 409,
      { wovenEventIds: flags.map(flag => flag.wovenEventId) });
    if (!selected) throw new HistoryServiceError('no_ripple_flag', 'This event has no matching weave re-check flag', 409);
    if (selected.status === 'kept') return resultFor(question, history, { event, cached: true });
    const updatedEvent = { ...event, checkFlags: event.checkFlags.map(flag => flag === selected
      ? { ...flag, status: 'kept', keptAt: new Date(now()).toISOString() } : flag) };
    const savedQuestion = saveHistory(store, question, { ...history, events: history.events.map(item => item.id === eventId ? updatedEvent : item) });
    return resultFor(savedQuestion, savedQuestion.histories.find(item => item.id === historyId), { event: updatedEvent });
    });
  }

  function preference(userId, sessionId) { return store.getPreference?.(userId, sessionId) ?? { autoSuggest: true }; }
  function setPreference({ userId, sessionId, autoSuggest } = {}) {
    if (!validId(userId) || !validId(sessionId) || typeof autoSuggest !== 'boolean') throw new HistoryServiceError('invalid_preference', 'Valid user, session and autoSuggest setting are required');
    if (!store.setPreference) throw new HistoryServiceError('preference_unavailable', 'Preference storage is unavailable', 501);
    return store.setPreference({ userId, sessionId, autoSuggest });
  }

  return { suggest, weave, weaveBatch, fork, rippleCheck, regenerateEvent, keepEvent, preference, setPreference };
}
