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

  async function weave({ questionId, historyId, suggestionId } = {}) {
    const started = await mutateQuestion(questionId, () => {
      const { question, history } = resolve(store, questionId, historyId);
      const existing = history.events.find(item => item.id === suggestionId);
      if (existing) return { question, history, event: existing, alreadyWoven: true, later: [] };
      const suggestion = history.suggestions?.find(item => item.id === suggestionId);
      if (!suggestion) throw new HistoryServiceError('not_found', 'Suggestion not found', 404);
      if (suggestion.historyRevision && suggestion.historyRevision !== historyRevision(history)) {
        throw new HistoryServiceError('stale_suggestion', 'This suggestion was checked against an older version of the history. Request More around this window before adding it.', 409);
      }
      if (suggestion.verdict !== 'fits') throw new HistoryServiceError('conflict_requires_fork', 'A conflicting suggestion must be forked', 409,
        { conflictsWith: suggestion.conflictsWith, reason: suggestion.reason });
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

  async function fork({ questionId, historyId, eventId, suggestionId, userId, sessionId } = {}) {
    return mutateQuestion(questionId, () => {
    const { question, history } = resolve(store, questionId, historyId);
    const point = history.events.find(event => event.id === eventId);
    if (!point) throw new HistoryServiceError('not_found', 'Fork event not found', 404);
    const suggestion = suggestionId ? history.suggestions?.find(item => item.id === suggestionId) : null;
    if (suggestionId && !suggestion) throw new HistoryServiceError('not_found', 'Fork suggestion not found', 404);
    if (suggestion?.historyRevision && suggestion.historyRevision !== historyRevision(history)) {
      throw new HistoryServiceError('stale_suggestion', 'This suggestion was checked against an older version of the history. Request More before forking from it.', 409);
    }
    if (suggestion && (suggestion.verdict !== 'conflicts' || suggestion.conflictsWith !== eventId)) throw new HistoryServiceError('invalid_fork', 'Fork suggestion must conflict with the selected event', 409);
    const prefix = sorted(history.events.filter(event => event.year < point.year || (event.year === point.year && event.id.localeCompare(point.id) < 0)));
    const replacedEvent = Object.fromEntries(['id', 'year', 'place', 'title', 'summary', 'causeEventId', 'era', 'geography']
      .filter(key => point[key] !== undefined).map(key => [key, structuredClone(point[key])]));
    const forked = { id: `history-fork-${randomUUID()}`,
      events: prefix, forkEventId: eventId, forkedFromHistoryId: history.id,
      forkReason: suggestion?.reason ?? `What if instead of ${point.title}?`,
      origin: { kind: suggestion ? 'conflicting-suggestion-fork' : 'deliberate-what-if', replacedEvent } };
    if (suggestion) {
      const alternative = { ...suggestion, id: suggestion.id };
      delete alternative.window; delete alternative.verdict; delete alternative.conflictsWith; delete alternative.reason; delete alternative.generatedAt; delete alternative.historyRevision;
      if (alternative.causeEventId !== question.id && !prefix.some(event => event.id === alternative.causeEventId)) {
        alternative.causeEventId = prefix.at(-1)?.id ?? question.id;
      }
      forked.events = sorted([...prefix, alternative]);
      forked.forkReason = suggestion.reason;
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

  return { suggest, weave, fork, rippleCheck, regenerateEvent, keepEvent, preference, setPreference };
}
