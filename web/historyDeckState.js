const MAX_KEPT_SUGGESTIONS = 32;
const validId = value => typeof value === 'string' && value.trim().length > 0 && value.length <= 240;
const ownerKey = (questionId, historyId) => {
  if (!validId(questionId) || !validId(historyId)) throw new Error('History deck state requires a question and history ID');
  return JSON.stringify([questionId, historyId]);
};
const ordered = suggestions => [...new Map((Array.isArray(suggestions) ? suggestions : [])
  .filter(item => item && validId(item.id))
  .map(item => [item.id, item])).values()]
  .sort((a, b) => (Number.isSafeInteger(a.year) ? a.year : Number.MAX_SAFE_INTEGER)
    - (Number.isSafeInteger(b.year) ? b.year : Number.MAX_SAFE_INTEGER) || a.id.localeCompare(b.id));

/** In-memory review dispositions for each saved question/history deck. */
export function createHistoryDeckState({ snapshot = {}, maxKept = MAX_KEPT_SUGGESTIONS } = {}) {
  if (!Number.isSafeInteger(maxKept) || maxKept < 1 || maxKept > MAX_KEPT_SUGGESTIONS) {
    throw new Error(`History deck keep limit must be between 1 and ${MAX_KEPT_SUGGESTIONS}`);
  }
  const owners = new Map();
  for (const [key, records] of Object.entries(snapshot || {})) {
    if (!records || typeof records !== 'object' || Array.isArray(records)) continue;
    const saved = new Map(Object.entries(records).filter(([id, disposition]) => validId(id) && ['kept', 'passed'].includes(disposition)));
    if (saved.size) owners.set(key, saved);
  }
  const undoStack = [];
  const dispositionsFor = (questionId, historyId) => owners.get(ownerKey(questionId, historyId)) ?? new Map();

  function review({ questionId, historyId, suggestions = [] } = {}) {
    const current = dispositionsFor(questionId, historyId);
    const unreviewedIds = [], keptIds = [], passedIds = [];
    for (const suggestion of ordered(suggestions)) {
      const id = suggestion.id, disposition = current.get(id);
      if (disposition === 'kept') keptIds.push(id);
      else if (disposition === 'passed') passedIds.push(id);
      else unreviewedIds.push(id);
    }
    return { unreviewedIds, keptIds, passedIds,
      dispositions: Object.fromEntries([...keptIds.map(id => [id, 'kept']), ...passedIds.map(id => [id, 'passed'])]) };
  }

  function decide({ questionId, historyId, suggestionId, suggestions = [], disposition } = {}) {
    const key = ownerKey(questionId, historyId);
    if (!validId(suggestionId) || !['kept', 'passed'].includes(disposition)) throw new Error('History deck decision is invalid');
    if (!ordered(suggestions).some(item => item.id === suggestionId)) return { status: 'not-found', suggestionId };
    const current = owners.get(key) ?? new Map();
    const previous = current.get(suggestionId) ?? null;
    if (previous === disposition) return { status: 'unchanged', suggestionId, disposition };
    if (disposition === 'kept' && previous !== 'kept'
        && [...current.values()].filter(item => item === 'kept').length >= maxKept) {
      return { status: 'limit', suggestionId, limit: maxKept };
    }
    if (!owners.has(key)) owners.set(key, current);
    current.set(suggestionId, disposition);
    undoStack.push({ key, changes: [{ suggestionId, previous, next: disposition }] });
    return { status: 'changed', suggestionId, disposition };
  }

  function keepAllFits({ questionId, historyId, suggestions = [] } = {}) {
    const key = ownerKey(questionId, historyId), current = owners.get(key) ?? new Map();
    const eligible = ordered(suggestions).filter(item => item.verdict === 'fits' && !item.conflictsWith
      && current.get(item.id) !== 'kept');
    const slots = Math.max(0, maxKept - [...current.values()].filter(item => item === 'kept').length);
    const keptIds = eligible.slice(0, slots).map(item => item.id);
    const skippedIds = eligible.slice(slots).map(item => item.id);
    if (keptIds.length) {
      if (!owners.has(key)) owners.set(key, current);
      const changes = keptIds.map(suggestionId => {
        const previous = current.get(suggestionId) ?? null;
        current.set(suggestionId, 'kept');
        return { suggestionId, previous, next: 'kept' };
      });
      undoStack.push({ key, changes });
    }
    return { keptIds, skippedIds, limit: maxKept };
  }

  function canUndo({ questionId, historyId } = {}) {
    const action = undoStack.at(-1);
    if (!action) return false;
    if (questionId == null && historyId == null) return true;
    return action.key === ownerKey(questionId, historyId);
  }

  function undoLast({ questionId, historyId } = {}) {
    if (!undoStack.length) return { status: 'empty' };
    if (!canUndo({ questionId, historyId })) return { status: 'owner-mismatch' };
    const action = undoStack.pop();
    const current = owners.get(action.key);
    for (const change of [...action.changes].reverse()) {
      if (!current || current.get(change.suggestionId) !== change.next) continue;
      if (change.previous === null) current.delete(change.suggestionId);
      else current.set(change.suggestionId, change.previous);
    }
    if (current?.size === 0) owners.delete(action.key);
    return { status: 'undone', count: action.changes.length };
  }

  function getDisposition(questionId, historyId, suggestionId) {
    if (!validId(suggestionId)) return null;
    return dispositionsFor(questionId, historyId).get(suggestionId) ?? null;
  }

  function toSnapshot() {
    return Object.fromEntries([...owners].map(([key, records]) => [key, Object.fromEntries(records)]));
  }

  return { review, keep: options => decide({ ...options, disposition: 'kept' }),
    pass: options => decide({ ...options, disposition: 'passed' }), keepAllFits, canUndo, undoLast, getDisposition, toSnapshot,
    maxKept };
}

export { MAX_KEPT_SUGGESTIONS };
