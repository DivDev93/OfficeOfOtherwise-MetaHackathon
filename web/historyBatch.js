const suggestionOnly = new Set(['verdict', 'conflictsWith', 'reason', 'window', 'generatedAt', 'historyRevision', 'recheckStatus', 'recheckReason']);
const compareEvents = (a, b) => a.year - b.year || a.id.localeCompare(b.id);

/** Project a trusted batch plan into the exact event list a commit will save. */
export function projectBatchPlan(plan, { acceptedMergeIds = [], excludedSuggestionIds = [] } = {}) {
  if (!plan || typeof plan !== 'object' || typeof plan.questionId !== 'string' || !Array.isArray(plan.chain)
      || !Array.isArray(plan.merges) || !Array.isArray(plan.conflicts)) throw new Error('Invalid batch plan');
  if (!Array.isArray(acceptedMergeIds) || !Array.isArray(excludedSuggestionIds)) throw new Error('Invalid batch projection choices');
  const chain = [...plan.chain].sort(compareEvents);
  const sourceById = new Map(chain.map(item => [item.id, item]));
  if (sourceById.size !== chain.length || chain.some(item => !item || typeof item.id !== 'string' || !Number.isSafeInteger(item.year) || item.year === 0)) {
    throw new Error('Invalid batch plan chain');
  }
  const excluded = new Set(excludedSuggestionIds);
  if (excluded.size !== excludedSuggestionIds.length || [...excluded].some(id => !sourceById.has(id))) throw new Error('Invalid excluded suggestion selection');
  const accepted = new Set(acceptedMergeIds);
  if (accepted.size !== acceptedMergeIds.length) throw new Error('Invalid accepted merge selection');
  const mergeById = new Map(plan.merges.map(merge => [merge.id, merge]));
  if (mergeById.size !== plan.merges.length || [...accepted].some(id => !mergeById.has(id))) throw new Error('Invalid accepted merge selection');

  const mergeForSuggestion = new Map();
  for (const id of accepted) {
    const merge = mergeById.get(id);
    if (!Array.isArray(merge.suggestionIds) || merge.suggestionIds.length < 2 || typeof merge.title !== 'string' || typeof merge.summary !== 'string') {
      throw new Error('Invalid batch merge');
    }
    for (const suggestionId of merge.suggestionIds) {
      if (!sourceById.has(suggestionId) || excluded.has(suggestionId) || mergeForSuggestion.has(suggestionId)) throw new Error('Overlapping or invalid batch merge');
      mergeForSuggestion.set(suggestionId, merge);
    }
  }

  const finalIdBySuggestion = new Map();
  for (const source of chain) {
    if (excluded.has(source.id)) continue;
    finalIdBySuggestion.set(source.id, mergeForSuggestion.get(source.id)?.id ?? source.id);
  }
  const finalEvents = new Map();
  for (const source of chain) {
    if (excluded.has(source.id)) continue;
    const merge = mergeForSuggestion.get(source.id);
    const representative = merge
      ? merge.suggestionIds.map(id => sourceById.get(id)).sort(compareEvents)[0]
      : source;
    if (merge && finalEvents.has(merge.id)) continue;
    const event = Object.fromEntries(Object.entries(representative).filter(([key]) => !suggestionOnly.has(key)));
    event.id = merge?.id ?? source.id;
    if (merge) {
      event.title = merge.title;
      event.summary = merge.summary;
      event.causeEventId = representative.causeEventId;
      event.sourceSuggestionIds = [...merge.suggestionIds].sort((a, b) => compareEvents(sourceById.get(a), sourceById.get(b)));
      event.sourcePlaces = event.sourceSuggestionIds.map(suggestionId => ({ suggestionId, place: sourceById.get(suggestionId).place }));
      event.sourceMediaRefs = event.sourceSuggestionIds.map(suggestionId => {
        const source = sourceById.get(suggestionId);
        const refs = Object.fromEntries(['sceneRef', 'heroRef', 'cutoutRef', 'modelRef'].filter(key => source[key] !== undefined)
          .map(key => [key, source[key]]));
        return { suggestionId, ...refs };
      }).filter(item => Object.keys(item).length > 1);
    } else {
      event.sourceSuggestionIds = [source.id];
      event.sourcePlaces = [{ suggestionId: source.id, place: source.place }];
      const refs = Object.fromEntries(['sceneRef', 'heroRef', 'cutoutRef', 'modelRef'].filter(key => source[key] !== undefined)
        .map(key => [key, source[key]]));
      event.sourceMediaRefs = Object.keys(refs).length ? [{ suggestionId: source.id, ...refs }] : [];
    }
    finalEvents.set(event.id, event);
  }

  const existingEvents = new Map((plan.existingEvents ?? []).map(item => [item.id, item]));
  const existingIds = new Set(plan.existingEventIds ?? existingEvents.keys());
  function resolveCause(source, ownerFinalId, ownerYear, seen = new Set()) {
    let causeId = source.causeEventId;
    while (sourceById.has(causeId)) {
      if (seen.has(causeId)) throw new Error('Cyclic batch cause chain');
      seen.add(causeId);
      const target = sourceById.get(causeId);
      const finalId = finalIdBySuggestion.get(causeId);
      const finalTarget = finalId && finalEvents.get(finalId);
      if (finalTarget && finalTarget.id !== ownerFinalId && finalTarget.year < source.year) return finalTarget.id;
      source = target;
      causeId = source.causeEventId;
    }
    if (causeId === plan.questionId) return causeId;
    const existing = existingEvents.get(causeId);
    if (!existingIds.has(causeId) || (existing && existing.year >= ownerYear)) throw new Error('Batch cause must resolve to an earlier retained event or the question');
    return causeId;
  }

  for (const event of finalEvents.values()) {
    const source = sourceById.get(mergeById.has(event.id) ? mergeById.get(event.id).suggestionIds.map(id => sourceById.get(id)).sort(compareEvents)[0].id : event.id);
    event.causeEventId = resolveCause(source, event.id, event.year);
  }

  const unresolvedConflicts = plan.conflicts.filter(item => !excluded.has(item.suggestionId)
    && (!sourceById.has(item.conflictsWith) || !excluded.has(item.conflictsWith)));
  return { events: [...finalEvents.values()].sort(compareEvents), unresolvedConflicts,
    excludedSuggestionIds: [...excluded], acceptedMergeIds: [...accepted] };
}
