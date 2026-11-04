import { mkdirSync, readFileSync, writeFileSync, renameSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import { migrateSavedTree, normalizeQuestionHistories } from '../../web/historyModel.js';

const USAGE_KINDS = new Set(['worldsEntered', 'suggestionWindowsGenerated', 'histories']);
const validId = value => typeof value === 'string' && value.trim().length > 0 && value.length <= 240;
const eventIds = history => history.events.map(event => event.id);

function prefixLength(left, right) {
  let index = 0;
  while (index < left.length && index < right.length && left[index] === right[index]) index++;
  return index;
}

function mergeHistory(existing, incoming) {
  const events = new Map(existing.events.map(event => [event.id, event]));
  for (const event of incoming.events) if (!events.has(event.id)) events.set(event.id, event);
  const suggestions = new Map((existing.suggestions ?? []).map(item => [item.id, item]));
  for (const suggestion of incoming.suggestions ?? []) if (!suggestions.has(suggestion.id)) suggestions.set(suggestion.id, suggestion);
  const visited = new Set(events.keys());
  for (const [id, suggestion] of suggestions) {
    if (visited.has(id) || visited.has(suggestion.suggestionForEventId)) suggestions.delete(id);
  }
  return { ...existing,
    events: [...events.values()].sort((a, b) => a.year - b.year || a.id.localeCompare(b.id)),
    ...(existing.forkEventId || incoming.forkEventId ? { forkEventId: existing.forkEventId ?? incoming.forkEventId } : {}),
    ...(suggestions.size ? { suggestions: [...suggestions.values()].sort((a, b) => a.year - b.year || a.id.localeCompare(b.id)) } : {}),
  };
}

function repairDuplicateHistoryIds(existing, source) {
  const counts = new Map();
  for (const history of existing.histories) counts.set(history.id, (counts.get(history.id) ?? 0) + 1);
  const duplicateIds = new Set([...counts].filter(([, count]) => count > 1).map(([id]) => id));
  if (!duplicateIds.size) return { question: existing, recoveredIds: [] };
  const sourceCounts = new Map();
  for (const history of source.histories) sourceCounts.set(history.id, (sourceCounts.get(history.id) ?? 0) + 1);
  if ([...sourceCounts.values()].some(count => count > 1)) throw new Error('Cannot safely recover duplicate history IDs while source migration IDs are still colliding');

  const sourceHistories = source.histories.map(history => structuredClone(history));
  const duplicateHistories = existing.histories.filter(history => duplicateIds.has(history.id));
  const signatures = new Set(duplicateHistories.map(history => JSON.stringify({
    events: history.events.map(event => event.id), suggestions: (history.suggestions ?? []).map(item => item.id).sort(),
  })));
  if (signatures.size !== 1) throw new Error('Cannot safely recover duplicate history IDs because the saved histories disagree');
  const saved = duplicateHistories[0];
  const sourceEventIds = new Set(sourceHistories.flatMap(history => history.events.map(event => event.id)));
  const extraEvents = new Map(saved.events.filter(event => !sourceEventIds.has(event.id)).map(event => [event.id, event]));
  const owners = new Set();
  for (const event of extraEvents.values()) {
    const matching = sourceHistories.map((history, index) => history.suggestions?.some(item => item.id === event.id) ? index : -1).filter(index => index >= 0);
    if (matching.length !== 1) throw new Error('Cannot safely recover duplicate history IDs because an added event has no unique legacy suggestion lineage');
    owners.add(matching[0]);
  }
  if (owners.size !== 1) throw new Error('Cannot safely recover duplicate history IDs because added events point to different histories');
  const targetIndex = [...owners][0];
  const target = sourceHistories[targetIndex];
  const persistedEvents = new Map(saved.events.map(event => [event.id, event]));
  target.events = target.events.map(event => persistedEvents.has(event.id) ? { ...event, ...structuredClone(persistedEvents.get(event.id)) } : event);
  for (const event of extraEvents.values()) if (!target.events.some(item => item.id === event.id)) target.events.push(structuredClone(event));
  target.events.sort((a, b) => a.year - b.year || a.id.localeCompare(b.id));
  target.suggestions = (target.suggestions ?? []).filter(item => !target.events.some(event => event.id === item.id || event.id === item.suggestionForEventId));
  for (const key of ['checkFlags', 'forkEventId', 'forkReason', 'origin']) if (saved[key] !== undefined) target[key] = structuredClone(saved[key]);
  const keep = existing.histories.filter(history => !duplicateIds.has(history.id));
  return { question: { ...existing, histories: [...keep, ...sourceHistories] }, recoveredIds: [...duplicateIds].sort() };
}

function mergeQuestion(existing, incoming) {
  const histories = [...existing.histories];
  for (const candidate of incoming.histories) {
    const candidateIds = eventIds(candidate);
    const exact = histories.findIndex(history => history.id === candidate.id);
    if (exact >= 0) {
      histories[exact] = mergeHistory(histories[exact], candidate);
      continue;
    }
    const matches = histories.map((history, index) => ({ index, ids: eventIds(history) }))
      .filter(item => item.ids.every((id, index) => candidateIds[index] === id) || candidateIds.every((id, index) => item.ids[index] === id))
      .sort((a, b) => Math.min(b.ids.length, candidateIds.length) - Math.min(a.ids.length, candidateIds.length) || b.ids.length - a.ids.length);
    if (matches.length) histories[matches[0].index] = mergeHistory(histories[matches[0].index], candidate);
    else histories.push(candidate);
  }
  return { ...existing, histories };
}

/** Durable, versioned history state kept separate from immutable legacy run files. */
export function createHistoryStore(root, now = Date.now) {
  const directory = join(root, '.history');
  const statePath = join(directory, 'state-v1.json');
  const usagePath = join(directory, 'usage-v1.json');
  const prepare = () => mkdirSync(directory, { recursive: true });
  const setQuestion = (questions, id, value) => Object.defineProperty(questions, id, {
    value, enumerable: true, configurable: true, writable: true,
  });
  function read(path, label) {
    if (!existsSync(path)) return null;
    let value;
    try { value = JSON.parse(readFileSync(path, 'utf8')); }
    catch (error) { throw new Error(`Cannot read durable ${label}: ${error.message}`); }
    return value;
  }
  function atomic(path, value) {
    prepare();
    const temporary = `${path}.${randomUUID()}.tmp`;
    writeFileSync(temporary, `${JSON.stringify(value)}\n`, { flag: 'wx', flush: true });
    renameSync(temporary, path);
  }
  function state() {
    const value = read(statePath, 'history state');
    if (value === null) return { schemaVersion: 1, questions: Object.create(null), windowBatches: {}, preferences: {}, updatedAt: new Date(now()).toISOString() };
    if (value.schemaVersion !== 1 || !value.questions || typeof value.questions !== 'object' || Array.isArray(value.questions)) {
      throw new Error('Unsupported or invalid durable history state');
    }
    value.batchPlans ??= {};
    return value;
  }
  const usageKey = (userId, sessionId) => createHash('sha256').update(JSON.stringify([String(userId ?? ''), String(sessionId ?? '')])).digest('hex');
  const windowKey = ({ questionId, historyId, window }) => createHash('sha256').update(JSON.stringify([questionId, historyId, window.fromYear, window.toYear])).digest('hex');
  function usageState() {
    const value = read(usagePath, 'history usage');
    if (value === null) return { schemaVersion: 1, counters: {}, worlds: {} };
    if (value.schemaVersion !== 1 || !value.counters || typeof value.counters !== 'object' || Array.isArray(value.counters)) {
      throw new Error('Unsupported or invalid durable history usage state');
    }
    value.worlds ??= {};
    if (!value.worlds || typeof value.worlds !== 'object' || Array.isArray(value.worlds)) throw new Error('Unsupported or invalid durable history world ledger');
    return value;
  }
  function save(question) {
    const normalized = normalizeQuestionHistories(question);
    const current = state();
    setQuestion(current.questions, normalized.id, normalized);
    syncWindowSuggestions(current, normalized);
    current.updatedAt = new Date(now()).toISOString();
    atomic(statePath, current);
    return normalized;
  }
  function saveState(current) {
    current.updatedAt = new Date(now()).toISOString();
    atomic(statePath, current);
  }
  function windowEntries(current, identity) {
    return Object.values(current.windowBatches ?? {}).filter(entry => entry.questionId === identity.questionId
      && entry.historyId === identity.historyId && entry.window?.fromYear === identity.window.fromYear
      && entry.window?.toYear === identity.window.toYear).sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  }
  function appendWindowSuggestions(current, questionId, historyId, suggestions) {
    const question = current.questions[questionId];
    if (!question) return null;
    const history = question.histories.find(item => item.id === historyId);
    if (!history) return null;
    const all = new Map((history.suggestions ?? []).map(item => [item.id, item]));
    for (const suggestion of suggestions) all.set(suggestion.id, suggestion);
    const updatedHistory = { ...history, suggestions: [...all.values()].sort((a, b) => a.year - b.year || a.id.localeCompare(b.id)) };
    const normalized = normalizeQuestionHistories({ ...question, histories: question.histories.map(item => item.id === historyId ? updatedHistory : item) });
    setQuestion(current.questions, questionId, normalized);
    return normalized;
  }
  function syncWindowSuggestions(current, question) {
    const available = new Map(question.histories.map(history => [history.id, new Map((history.suggestions ?? []).map(item => [item.id, item]))]));
    for (const entry of Object.values(current.windowBatches ?? {})) {
      if (entry.questionId !== question.id) continue;
      const suggestions = available.get(entry.historyId);
      if (suggestions) entry.suggestions = (entry.suggestions ?? []).filter(item => suggestions.has(item.id));
    }
  }
  function ensureMigratedWindowCaches(current, migratedQuestions) {
    current.windowBatches ??= {};
    for (const migrated of migratedQuestions) {
      const savedQuestion = current.questions[migrated.id];
      if (!savedQuestion) continue;
      for (const sourceHistory of migrated.histories) {
        const savedHistory = savedQuestion.histories.find(item => item.id === sourceHistory.id);
        if (!savedHistory) continue;
        const windows = new Map();
        for (const suggestion of sourceHistory.suggestions ?? []) {
          const window = suggestion.window;
          if (!Number.isSafeInteger(window?.fromYear) || !Number.isSafeInteger(window?.toYear)) continue;
          windows.set(`${window.fromYear}:${window.toYear}`, { fromYear: window.fromYear, toYear: window.toYear });
        }
        for (const window of windows.values()) {
          const identity = { questionId: migrated.id, historyId: sourceHistory.id, window };
          const baseKey = windowKey(identity);
          const available = (savedHistory.suggestions ?? []).filter(item => item.window?.fromYear === window.fromYear && item.window?.toYear === window.toYear);
          const existing = current.windowBatches[baseKey];
          if (!existing) current.windowBatches[baseKey] = { batchId: baseKey, questionId: migrated.id, historyId: sourceHistory.id,
            window, requestId: 'migration', more: false, status: 'ready', suggestions: available,
            createdAt: new Date(now()).toISOString(), source: 'legacy-migration' };
          else if (existing.status === 'ready') existing.suggestions = available;
        }
      }
      syncWindowSuggestions(current, savedQuestion);
    }
  }
  function recoverPendingWindows() {
    const current = state();
    let changed = false;
    for (const entry of Object.values(current.windowBatches ?? {})) {
      if (entry.status !== 'pending') continue;
      entry.status = 'unknown';
      entry.reason = 'server-restarted-during-generation';
      changed = true;
    }
    if (changed) saveState(current);
  }
  function recoverPendingBatchPlans() {
    const current = state();
    let changed = false;
    for (const entry of Object.values(current.batchPlans ?? {})) {
      if (entry.status !== 'pending') continue;
      entry.status = 'unknown';
      entry.reason = 'server-restarted-during-batch-check';
      entry.retryOf = randomUUID();
      changed = true;
    }
    if (changed) saveState(current);
  }
  function recalculateCounts(questions) {
    return {
      questions: questions.length,
      histories: questions.reduce((sum, question) => sum + question.histories.length, 0),
      events: questions.reduce((sum, question) => sum + question.histories.reduce((count, history) => count + history.events.length, 0), 0),
      suggestions: questions.reduce((sum, question) => sum + question.histories.reduce((count, history) => count + (history.suggestions?.length ?? 0), 0), 0),
    };
  }
  // A pending paid request cannot safely be retried after a process restart.
  try { recoverPendingWindows(); recoverPendingBatchPlans(); } catch { /* defer corrupt/unsupported state errors to the requested store operation */ }
  return {
    get(id) {
      const questions = validId(id) ? state().questions : null;
      if (!questions || !Object.hasOwn(questions, id)) return null;
      const question = questions[id], seen = new Set();
      for (const history of question.histories) {
        if (seen.has(history.id)) throw new Error('Duplicate history IDs require migration reconciliation before editing');
        seen.add(history.id);
      }
      return question;
    },
    list() { return Object.values(state().questions); },
    save,
    reserveWindow({ questionId, historyId, window, requestId, more = false, userId, sessionId, cap, now: reservedAt } = {}) {
      if (!validId(questionId) || !validId(historyId) || !validId(requestId) || !validId(userId) || !validId(sessionId)
          || !window || !Number.isSafeInteger(window.fromYear) || !Number.isSafeInteger(window.toYear) || window.fromYear > window.toYear
          || !Number.isSafeInteger(cap) || cap < 1) return { status: 'invalid' };
      const current = state();
      const identity = { questionId, historyId, window };
      const entries = windowEntries(current, identity);
      if (!more) {
        const original = entries.find(entry => !entry.more);
        if (original?.status === 'ready') return { status: 'cached', suggestions: [...original.suggestions], requestId: original.requestId };
        if (original?.status === 'pending') return { status: 'pending', requestId: original.requestId };
        if (original?.status === 'unknown') return { status: 'unknown', requestId: original.requestId };
        if (original?.status === 'failed') return { status: 'failed', requestId: original.requestId, reason: original.reason };
      }
      const userSessionKey = usageKey(userId, sessionId);
      const attempts = Object.values(current.windowBatches ?? {}).filter(entry => entry.userSessionKey === userSessionKey).length
        + Object.values(current.batchPlans ?? {}).filter(entry => entry.userSessionKey === userSessionKey).reduce((sum, entry) => sum + (entry.attempts ?? 1), 0);
      if (attempts >= cap) return { status: 'capped', used: attempts, limit: cap };
      const baseKey = windowKey(identity);
      const batchId = more ? `${baseKey}:${requestId}` : baseKey;
      if (current.windowBatches?.[batchId]) return { status: current.windowBatches[batchId].status, requestId: current.windowBatches[batchId].requestId };
      current.windowBatches ??= {};
      current.windowBatches[batchId] = { batchId, questionId, historyId, window: { ...window }, requestId, more,
        userSessionKey, status: 'pending', suggestions: [], createdAt: reservedAt ?? new Date(now()).toISOString() };
      saveState(current);
      return { status: 'reserved', requestId, windowKey: batchId, used: attempts + 1, limit: cap };
    },
    completeWindow({ questionId, historyId, window, requestId, more = false, suggestions = [] } = {}) {
      const current = state();
      const entry = Object.values(current.windowBatches ?? {}).find(item => item.questionId === questionId && item.historyId === historyId
        && item.requestId === requestId && item.more === more && item.window?.fromYear === window?.fromYear && item.window?.toYear === window?.toYear);
      if (!entry || entry.status !== 'pending') return { status: entry?.status ?? 'missing', suggestions: entry?.suggestions ?? [] };
      const cleanSuggestions = suggestions.map(item => ({ ...item }));
      const question = appendWindowSuggestions(current, questionId, historyId, cleanSuggestions);
      if (!question) return { status: 'missing', suggestions: [] };
      entry.status = 'ready';
      entry.suggestions = cleanSuggestions;
      entry.completedAt = new Date(now()).toISOString();
      saveState(current);
      return { status: 'ready', suggestions: cleanSuggestions, question };
    },
    failWindow({ questionId, historyId, window, requestId, more = false, uncertain = false, reason = 'generation-failed' } = {}) {
      const current = state();
      const entry = Object.values(current.windowBatches ?? {}).find(item => item.questionId === questionId && item.historyId === historyId
        && item.requestId === requestId && item.more === more && item.window?.fromYear === window?.fromYear && item.window?.toYear === window?.toYear);
      if (!entry || entry.status !== 'pending') return { status: entry?.status ?? 'missing' };
      entry.status = uncertain ? 'unknown' : 'failed';
      entry.reason = reason;
      entry.failedAt = new Date(now()).toISOString();
      saveState(current);
      return { status: entry.status };
    },
    reserveBatchPlan({ planKey, requestId, questionId, historyId, userId, sessionId, cap, retryOf, now: reservedAt } = {}) {
      if (!validId(planKey) || !validId(requestId) || !validId(questionId) || !validId(historyId)
          || !validId(userId) || !validId(sessionId) || !Number.isSafeInteger(cap) || cap < 1) return { status: 'invalid' };
      const current = state();
      current.batchPlans ??= {};
      const existing = current.batchPlans[planKey];
      if (existing && ['ready', 'committed'].includes(existing.status)) return { status: 'cached', plan: structuredClone(existing.plan), requestId: existing.requestId };
      if (existing && existing.status === 'pending') return { status: 'pending', requestId: existing.requestId };
      if (existing && existing.status === 'unknown' && (!retryOf || retryOf !== existing.retryOf)) {
        return { status: 'unknown', requestId: existing.requestId, retryOf: existing.retryOf };
      }
      if (existing?.status === 'unknown' && retryOf === existing.retryOf) existing.retryOf = undefined;
      const userSessionKey = usageKey(userId, sessionId);
      const windowAttempts = Object.values(current.windowBatches ?? {}).filter(entry => entry.userSessionKey === userSessionKey).length;
      const planAttempts = Object.values(current.batchPlans).filter(entry => entry.userSessionKey === userSessionKey)
        .reduce((sum, entry) => sum + (entry.attempts ?? 1), 0);
      const used = windowAttempts + planAttempts;
      if (used >= cap) return { status: 'capped', used, limit: cap };
      current.batchPlans[planKey] = { planKey, questionId, historyId, requestId, userSessionKey,
        attempts: (existing?.attempts ?? 0) + 1, status: 'pending', createdAt: reservedAt ?? new Date(now()).toISOString() };
      saveState(current);
      return { status: 'reserved', requestId, used: used + 1, limit: cap };
    },
    completeBatchPlan({ planKey, requestId, plan } = {}) {
      if (!validId(planKey) || !validId(requestId) || !plan || typeof plan !== 'object') return { status: 'invalid' };
      const current = state(), entry = current.batchPlans?.[planKey];
      if (!entry || entry.requestId !== requestId || entry.status !== 'pending') return { status: entry?.status ?? 'missing' };
      entry.status = 'ready';
      entry.plan = structuredClone(plan);
      entry.completedAt = new Date(now()).toISOString();
      saveState(current);
      return { status: 'ready', plan: structuredClone(entry.plan) };
    },
    failBatchPlan({ planKey, requestId, uncertain = false, reason = 'generation-failed' } = {}) {
      if (!validId(planKey) || !validId(requestId)) return { status: 'invalid' };
      const current = state(), entry = current.batchPlans?.[planKey];
      if (!entry || entry.requestId !== requestId || entry.status !== 'pending') return { status: entry?.status ?? 'missing' };
      entry.status = uncertain ? 'unknown' : 'failed';
      entry.reason = reason;
      entry.retryOf = randomUUID();
      entry.failedAt = new Date(now()).toISOString();
      saveState(current);
      return { status: entry.status, retryOf: entry.retryOf };
    },
    getBatchPlan(planKey) {
      if (!validId(planKey)) return { status: 'missing' };
      const entry = state().batchPlans?.[planKey];
      return entry ? { status: entry.status, requestId: entry.requestId,
        ...(['ready', 'committed'].includes(entry.status) ? { plan: structuredClone(entry.plan) } : {}),
        ...(entry.retryOf ? { retryOf: entry.retryOf } : {}),
        ...(entry.status === 'committed' ? { eventIds: [...(entry.eventIds ?? [])],
          acceptedMergeIds: [...(entry.acceptedMergeIds ?? [])], excludedSuggestionIds: [...(entry.excludedSuggestionIds ?? [])] } : {}) } : { status: 'missing' };
    },
    getBatchPlanById({ planId, questionId, historyId, userId, sessionId } = {}) {
      if (!validId(planId) || !validId(questionId) || !validId(historyId) || !validId(userId) || !validId(sessionId)) return { status: 'missing' };
      const userSessionKey = usageKey(userId, sessionId);
      const entry = Object.values(state().batchPlans ?? {}).find(item => item.plan?.id === planId && item.questionId === questionId
        && item.historyId === historyId && item.userSessionKey === userSessionKey);
      return entry ? { status: entry.status, requestId: entry.requestId,
        ...(['ready', 'committed'].includes(entry.status) ? { plan: structuredClone(entry.plan) } : {}),
        ...(entry.status === 'committed' ? { eventIds: [...(entry.eventIds ?? [])],
          acceptedMergeIds: [...(entry.acceptedMergeIds ?? [])], excludedSuggestionIds: [...(entry.excludedSuggestionIds ?? [])] } : {}) } : { status: 'missing' };
    },
    completeBatchCommit({ planKey, planId, requestId, eventIds = [] } = {}) {
      if (!validId(planKey) || !validId(planId) || !validId(requestId) || !Array.isArray(eventIds)) return { status: 'invalid' };
      const current = state(), entry = current.batchPlans?.[planKey];
      if (!entry || entry.requestId !== requestId || entry.plan?.id !== planId || !['ready', 'committed'].includes(entry.status)) return { status: entry?.status ?? 'missing' };
      entry.status = 'committed';
      entry.eventIds = [...eventIds];
      entry.committedAt ??= new Date(now()).toISOString();
      saveState(current);
      return { status: 'committed', eventIds: [...entry.eventIds] };
    },
    commitBatchHistory({ question, planKey, planId, requestId, eventIds = [], acceptedMergeIds = [], excludedSuggestionIds = [] } = {}) {
      if (!question || !validId(question.id) || !validId(planKey) || !validId(planId) || !validId(requestId)
          || !Array.isArray(eventIds) || eventIds.some(id => !validId(id))
          || !Array.isArray(acceptedMergeIds) || acceptedMergeIds.some(id => !validId(id))
          || !Array.isArray(excludedSuggestionIds) || excludedSuggestionIds.some(id => !validId(id))) return { status: 'invalid' };
      const normalized = normalizeQuestionHistories(question);
      const current = state(), entry = current.batchPlans?.[planKey];
      if (!entry || entry.requestId !== requestId || entry.plan?.id !== planId || entry.questionId !== normalized.id
          || !['ready', 'committed'].includes(entry.status)) return { status: entry?.status ?? 'missing' };
      if (entry.status === 'committed') {
        const sameChoices = (left = [], right = []) => JSON.stringify([...left].sort()) === JSON.stringify([...right].sort());
        if (!sameChoices(acceptedMergeIds, entry.acceptedMergeIds ?? [])
            || !sameChoices(excludedSuggestionIds, entry.excludedSuggestionIds ?? [])) return { status: 'choice-mismatch' };
        return { status: 'committed', alreadyCommitted: true, question: current.questions[normalized.id],
          eventIds: [...(entry.eventIds ?? [])], acceptedMergeIds: [...(entry.acceptedMergeIds ?? [])],
          excludedSuggestionIds: [...(entry.excludedSuggestionIds ?? [])] };
      }
      setQuestion(current.questions, normalized.id, normalized);
      syncWindowSuggestions(current, normalized);
      entry.status = 'committed';
      entry.eventIds = [...eventIds];
      entry.acceptedMergeIds = [...acceptedMergeIds];
      entry.excludedSuggestionIds = [...excludedSuggestionIds];
      entry.committedAt = new Date(now()).toISOString();
      saveState(current);
      return { status: 'committed', alreadyCommitted: false, question: normalized, eventIds: [...entry.eventIds],
        acceptedMergeIds: [...entry.acceptedMergeIds], excludedSuggestionIds: [...entry.excludedSuggestionIds] };
    },
    getWindow(identity) {
      if (!validId(identity?.questionId) || !validId(identity?.historyId) || !identity?.window) return { status: 'missing', suggestions: [] };
      const entries = windowEntries(state(), identity);
      const ready = entries.filter(entry => entry.status === 'ready');
      const defaultEntry = entries.find(entry => !entry.more);
      return { status: defaultEntry?.status ?? (ready.length ? 'ready' : 'missing'), suggestions: ready.flatMap(entry => entry.suggestions ?? []),
        batches: entries.map(({ batchId, requestId, more, status, createdAt }) => ({ batchId, requestId, more, status, createdAt })) };
    },
    windows(questionId, historyId) {
      if (!validId(questionId) || !validId(historyId)) return [];
      const current = state();
      const grouped = new Map();
      for (const entry of Object.values(current.windowBatches ?? {})) {
        if (entry.questionId !== questionId || entry.historyId !== historyId) continue;
        const key = `${entry.window.fromYear}:${entry.window.toYear}`;
        const group = grouped.get(key) ?? { window: { ...entry.window }, statuses: [], batches: 0, suggestionIds: new Set() };
        group.statuses.push(entry.status);
        group.batches++;
        for (const suggestion of entry.suggestions ?? []) group.suggestionIds.add(suggestion.id);
        grouped.set(key, group);
      }
      return [...grouped.values()].map(group => ({ window: group.window,
        status: group.statuses.includes('ready') ? 'ready' : group.statuses.at(-1), batches: group.batches, suggestionCount: group.suggestionIds.size }));
    },
    getPreference(userId, sessionId) {
      if (!validId(userId) || !validId(sessionId)) return { autoSuggest: true };
      return { autoSuggest: state().preferences?.[usageKey(userId, sessionId)]?.autoSuggest ?? true };
    },
    setPreference({ userId, sessionId, autoSuggest } = {}) {
      if (!validId(userId) || !validId(sessionId) || typeof autoSuggest !== 'boolean') throw new Error('Invalid history preference');
      const current = state();
      current.preferences ??= {};
      current.preferences[usageKey(userId, sessionId)] = { autoSuggest, updatedAt: new Date(now()).toISOString() };
      saveState(current);
      return { autoSuggest };
    },
    /** Merge newly discovered legacy paths without overwriting saved question/history edits. */
    migrateLegacy(records, options) {
      const migrated = migrateSavedTree(records, options);
      const current = state();
      const questions = { ...current.questions };
      current.recoveryReceipts ??= {};
      for (const question of migrated.questions) {
        if (Object.hasOwn(questions, question.id)) {
          const repair = repairDuplicateHistoryIds(questions[question.id], question);
          if (repair.recoveredIds.length) {
            const receiptId = createHash('sha256').update(JSON.stringify([question.id, repair.recoveredIds,
              repair.question.histories.map(history => history.id).sort()])).digest('hex');
            current.recoveryReceipts[receiptId] ??= { kind: 'duplicate-history-ids-recovered', questionId: question.id,
              previousHistoryIds: repair.recoveredIds, recoveredHistoryIds: repair.question.histories.map(history => history.id).sort(),
              recoveredAt: new Date(now()).toISOString() };
            setQuestion(questions, question.id, mergeQuestion(repair.question, question));
          } else setQuestion(questions, question.id, mergeQuestion(questions[question.id], question));
        }
        else setQuestion(questions, question.id, question);
      }
      current.questions = questions;
      ensureMigratedWindowCaches(current, migrated.questions);
      current.updatedAt = new Date(now()).toISOString();
      atomic(statePath, current);
      const saved = Object.values(questions);
      return { version: 1, questions: saved, metadata: { migration: 'history-v1-deterministic', counts: recalculateCounts(saved) } };
    },
    recordUsage({ userId, sessionId, kind, amount = 1 }) {
      if (!validId(userId) || !validId(sessionId)) throw new Error('Usage requires userId and sessionId');
      if (!USAGE_KINDS.has(kind) || !Number.isSafeInteger(amount) || amount < 1) throw new Error('Invalid history usage increment');
      const current = usageState(), key = usageKey(userId, sessionId);
      const counters = current.counters[key] ?? { worldsEntered: 0, suggestionWindowsGenerated: 0, histories: 0 };
      counters[kind] += amount;
      current.counters[key] = counters;
      current.updatedAt = new Date(now()).toISOString();
      atomic(usagePath, current);
      return { ...counters };
    },
    recordWorldEntered({ userId, sessionId, worldId } = {}) {
      if (!validId(userId) || !validId(sessionId) || !validId(worldId)) throw new Error('World entry requires userId, sessionId and worldId');
      const current = usageState(), key = usageKey(userId, sessionId);
      const worldHash = createHash('sha256').update(worldId).digest('hex');
      const worlds = current.worlds[key] ?? [];
      const counters = current.counters[key] ?? { worldsEntered: 0, suggestionWindowsGenerated: 0, histories: 0 };
      if (worlds.includes(worldHash)) return { counted: false, usage: { ...counters } };
      current.worlds[key] = [...worlds, worldHash];
      counters.worldsEntered++;
      current.counters[key] = counters;
      current.updatedAt = new Date(now()).toISOString();
      atomic(usagePath, current);
      return { counted: true, usage: { ...counters } };
    },
    usage(userId, sessionId) {
      if (!validId(userId) || !validId(sessionId)) return { worldsEntered: 0, suggestionWindowsGenerated: 0, histories: 0 };
      const key = usageKey(userId, sessionId);
      const counters = usageState().counters[key] ?? { worldsEntered: 0, suggestionWindowsGenerated: 0, histories: 0 };
      const generated = Object.values(state().windowBatches ?? {}).filter(entry => entry.userSessionKey === key && entry.status === 'ready').length;
      return { ...counters, suggestionWindowsGenerated: Math.max(counters.suggestionWindowsGenerated, generated) };
    },
  };
}
