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
  for (const [id, suggestion] of suggestions) if (visited.has(suggestion.suggestionForEventId)) suggestions.delete(id);
  return { ...existing,
    events: [...events.values()].sort((a, b) => a.year - b.year || a.id.localeCompare(b.id)),
    ...(existing.forkEventId || incoming.forkEventId ? { forkEventId: existing.forkEventId ?? incoming.forkEventId } : {}),
    ...(suggestions.size ? { suggestions: [...suggestions.values()].sort((a, b) => a.year - b.year || a.id.localeCompare(b.id)) } : {}),
  };
}

function mergeQuestion(existing, incoming) {
  const histories = [...existing.histories];
  for (const candidate of incoming.histories) {
    const candidateIds = eventIds(candidate);
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
    if (value === null) return { schemaVersion: 1, questions: Object.create(null), updatedAt: new Date(now()).toISOString() };
    if (value.schemaVersion !== 1 || !value.questions || typeof value.questions !== 'object' || Array.isArray(value.questions)) {
      throw new Error('Unsupported or invalid durable history state');
    }
    return value;
  }
  const usageKey = (userId, sessionId) => createHash('sha256').update(JSON.stringify([String(userId ?? ''), String(sessionId ?? '')])).digest('hex');
  function usageState() {
    const value = read(usagePath, 'history usage');
    if (value === null) return { schemaVersion: 1, counters: {} };
    if (value.schemaVersion !== 1 || !value.counters || typeof value.counters !== 'object' || Array.isArray(value.counters)) {
      throw new Error('Unsupported or invalid durable history usage state');
    }
    return value;
  }
  function save(question) {
    const normalized = normalizeQuestionHistories(question);
    const current = state();
    setQuestion(current.questions, normalized.id, normalized);
    current.updatedAt = new Date(now()).toISOString();
    atomic(statePath, current);
    return normalized;
  }
  function recalculateCounts(questions) {
    return {
      questions: questions.length,
      histories: questions.reduce((sum, question) => sum + question.histories.length, 0),
      events: questions.reduce((sum, question) => sum + question.histories.reduce((count, history) => count + history.events.length, 0), 0),
      suggestions: questions.reduce((sum, question) => sum + question.histories.reduce((count, history) => count + (history.suggestions?.length ?? 0), 0), 0),
    };
  }
  return {
    get(id) { const questions = validId(id) ? state().questions : null; return questions && Object.hasOwn(questions, id) ? questions[id] : null; },
    list() { return Object.values(state().questions); },
    save,
    /** Merge newly discovered legacy paths without overwriting saved question/history edits. */
    migrateLegacy(records, options) {
      const migrated = migrateSavedTree(records, options);
      const current = state();
      const questions = { ...current.questions };
      for (const question of migrated.questions) {
        if (Object.hasOwn(questions, question.id)) setQuestion(questions, question.id, mergeQuestion(questions[question.id], question));
        else setQuestion(questions, question.id, question);
      }
      current.questions = questions;
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
    usage(userId, sessionId) {
      if (!validId(userId) || !validId(sessionId)) return { worldsEntered: 0, suggestionWindowsGenerated: 0, histories: 0 };
      const counters = usageState().counters[usageKey(userId, sessionId)];
      return counters ? { ...counters } : { worldsEntered: 0, suggestionWindowsGenerated: 0, histories: 0 };
    },
  };
}
