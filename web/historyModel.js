// Pure, deterministic history normalization and legacy tree migration.
// This module intentionally has no filesystem, browser, or model-client dependencies.

const text = value => typeof value === 'string' ? value.trim() : '';
const isYear = value => Number.isSafeInteger(value) && value !== 0;
const finite = value => typeof value === 'number' && Number.isFinite(value);

export function normalizeAssetRef(value) {
  if (typeof value !== 'string' || !value.trim() || value.length > 500) return undefined;
  const raw = value.trim();
  if (/^(?:[a-z][a-z\d+.-]*:|\/|\\|[A-Za-z]:)/i.test(raw) || raw.includes('\\') || /[?#]/.test(raw)) return undefined;
  const segments = raw.split('/');
  if (segments.some(segment => !segment || segment === '.' || segment === '..' || /[\u0000-\u001f]/.test(segment) || /%(?:2e|2f|5c)/i.test(segment))) return undefined;
  return raw;
}

function safeMediaUrl(value, runId, branchId) {
  if (typeof value !== 'string' || value.length > 500) return undefined;
  let url;
  try { url = new URL(value, 'https://history.local'); } catch { return undefined; }
  if (url.origin !== 'https://history.local' || url.search || url.hash || !value.startsWith('/')) return undefined;
  const path = url.pathname;
  if (/^\/history-media\/[a-f\d]{64}\.png$/i.test(path)) return value;
  if (!runId || !branchId) return undefined;
  const runFile = path.match(/^\/runs\/([^/]+)\/(hero\.png|cutout\.png|model\.glb|model\.meshopt\.glb)$/);
  if (runFile) {
    let decoded;
    try { decoded = decodeURIComponent(runFile[1]); } catch { return undefined; }
    if (decoded !== runId || encodeURIComponent(decoded) !== runFile[1]) return undefined;
    return value;
  }
  if (/^\/event-scenes\/[a-f\d]{64}\.png$/i.test(path) || /^\/event-cutouts\/[a-f\d]{64}\.png$/i.test(path)) return value;
  return undefined;
}

function normalizeMediaRefs(source = {}, exactRefs = {}, identity = {}) {
  const scene = exactRefs.sceneRef ?? source.sceneRef;
  const hero = exactRefs.heroRef ?? source.heroRef;
  const cutout = exactRefs.cutoutRef ?? exactRefs.cutoutRefPath ?? source.cutoutRef;
  const model = exactRefs.modelRef ?? exactRefs.modelRefPath ?? source.modelRef;
  const ref = value => {
    if (typeof value === 'string') return normalizeAssetRef(value);
    if (value && typeof value === 'object' && value.status === 'complete') {
      const path = normalizeAssetRef(value.path);
      const runId = identity.runId, branchId = identity.branchId;
      const hasIdentity = value.runId !== undefined || value.branchId !== undefined;
      if (hasIdentity && (value.runId !== runId || value.branchId !== branchId)) return undefined;
      const exactIdentity = value.runId === runId && value.branchId === branchId;
      const url = exactIdentity ? safeMediaUrl(value.url, runId, branchId) : undefined;
      if (!path && !url) return undefined;
      return { ...(path ? { path } : {}), status: 'complete', ...(url ? { url } : {}),
        ...(exactIdentity ? { runId, branchId } : {}) };
    }
    return undefined;
  };
  const result = {};
  for (const [key, value] of [['sceneRef', scene], ['heroRef', hero], ['cutoutRef', cutout], ['modelRef', model]]) {
    const normalized = ref(value);
    if (normalized !== undefined) result[key] = normalized;
  }
  return result;
}

function normalizePlace(place) {
  if (!place || !finite(place.lat) || place.lat < -90 || place.lat > 90 || !finite(place.lon) || place.lon < -180 || place.lon > 180) {
    throw new Error('History event requires a valid place');
  }
  return { ...(text(place.name) ? { name: text(place.name) } : {}), lat: place.lat, lon: place.lon };
}

function eraYear(year) {
  const magnitude = Math.abs(year);
  return `${magnitude} ${year < 0 ? 'BCE' : 'CE'}`;
}

/** Deterministic gap-based era labels; a later model may replace labels without changing events. */
export function deriveEras(events = [], { maxGapYears = 500 } = {}) {
  if (!Number.isSafeInteger(maxGapYears) || maxGapYears < 1) throw new Error('maxGapYears must be a positive integer');
  const ordered = [...events].sort((a, b) => a.year - b.year || String(a.id).localeCompare(String(b.id)));
  const groups = [];
  for (const event of ordered) {
    const group = groups.at(-1);
    if (!group || event.year - group.events.at(-1).year > maxGapYears) groups.push({ events: [event] });
    else group.events.push(event);
  }
  return new Map(groups.flatMap((group, index) => {
    const first = group.events[0].year, last = group.events.at(-1).year;
    const label = `Era ${index + 1} · ${eraYear(first)}${first === last ? '' : `–${eraYear(last)}`}`;
    return group.events.map(event => [event.id, event.era || label]);
  }));
}

function normalizeEvent(event, { questionId, previousEventId, fallbackId, identity } = {}) {
  if (!event || typeof event !== 'object' || !isYear(event.year)) throw new Error('History event requires a nonzero integer year');
  const id = text(event.id ?? fallbackId);
  if (!id || id.length > 240) throw new Error('History event requires a stable id');
  const title = text(event.title), summary = text(event.summary);
  if (!title || !summary) throw new Error('History event requires a title and summary');
  const causeEventId = text(event.causeEventId) || previousEventId || questionId;
  if (!causeEventId) throw new Error('History event requires a causeEventId');
  const sourceSuggestionIds = event.sourceSuggestionIds;
  if (sourceSuggestionIds !== undefined && (!Array.isArray(sourceSuggestionIds) || sourceSuggestionIds.length > 32
      || sourceSuggestionIds.some(value => !text(value) || text(value).length > 240)
      || new Set(sourceSuggestionIds.map(text)).size !== sourceSuggestionIds.length)) throw new Error('Invalid history event source suggestion IDs');
  const sourcePlaces = event.sourcePlaces;
  if (sourcePlaces !== undefined && (!Array.isArray(sourcePlaces) || sourcePlaces.length > 32
      || sourcePlaces.some(item => !item || !text(item.suggestionId) || item.suggestionId.length > 240))) throw new Error('Invalid history event source places');
  const sourceMediaRefs = event.sourceMediaRefs;
  if (sourceMediaRefs !== undefined && (!Array.isArray(sourceMediaRefs) || sourceMediaRefs.length > 32
      || sourceMediaRefs.some(item => !item || !text(item.suggestionId) || item.suggestionId.length > 240))) throw new Error('Invalid history event source media refs');
  return {
    id, year: event.year, place: normalizePlace(event.place), title, summary,
    causeEventId,
    ...(text(event.era) ? { era: text(event.era) } : {}),
    ...(event.geography && typeof event.geography === 'object' ? { geography: structuredClone(event.geography) } : {}),
    ...normalizeMediaRefs(event, {}, identity),
    ...(text(event.scene) ? { scene: text(event.scene) } : {}),
    ...(sourceSuggestionIds ? { sourceSuggestionIds: [...new Set(sourceSuggestionIds.map(text))] } : {}),
    ...(sourcePlaces ? { sourcePlaces: sourcePlaces.map(item => ({ suggestionId: text(item.suggestionId), place: normalizePlace(item.place) })) } : {}),
    ...(sourceMediaRefs ? { sourceMediaRefs: sourceMediaRefs.map(item => ({ suggestionId: text(item.suggestionId),
      ...normalizeMediaRefs(item, {}, identity) })) } : {}),
    ...Object.fromEntries(['checkFlags', 'checks', 'origin', 'forkEventId', 'forkedFromEventId', 'forkReason']
      .filter(key => event[key] !== undefined).map(key => [key, structuredClone(event[key])])),
  };
}

export function normalizeHistory(history, { questionId, maxEraGapYears = 500 } = {}) {
  if (!history || typeof history !== 'object' || !Array.isArray(history.events)) throw new Error('History requires an events array');
  const events = history.events.map(event => normalizeEvent(event, { questionId }));
  const explicitCauses = new Set(history.events.filter(event => text(event?.causeEventId)).map(event => text(event.id)));
  events.sort((a, b) => a.year - b.year || a.id.localeCompare(b.id));
  const ids = new Set();
  for (const [index, event] of events.entries()) {
    if (ids.has(event.id)) throw new Error(`Duplicate history event ${event.id}`);
    ids.add(event.id);
    if (index && event.year < events[index - 1].year) throw new Error('History events must be ordered by year');
  }
  const prior = new Map();
  for (const [index, event] of events.entries()) {
    if (!explicitCauses.has(event.id)) event.causeEventId = index ? events[index - 1].id : questionId;
    if (event.causeEventId === event.id) throw new Error('An event cannot cause itself');
    if (index === 0) {
      if (event.causeEventId !== questionId) throw new Error(`First event must follow question ${questionId}`);
    } else if (event.causeEventId !== questionId) {
      const cause = prior.get(event.causeEventId);
      if (!cause) throw new Error(`Cause event ${event.causeEventId} must precede ${event.id}`);
      if (cause.year > event.year) throw new Error(`Cause event ${event.causeEventId} is later than ${event.id}`);
    }
    prior.set(event.id, event);
  }
  const eras = deriveEras(events, { maxGapYears: maxEraGapYears });
  for (const event of events) event.era = eras.get(event.id);
  const result = { id: text(history.id) || 'history-1', events };
  if (text(history.forkEventId)) result.forkEventId = text(history.forkEventId);
  for (const key of ['forkedFromHistoryId', 'forkReason', 'origin']) if (history[key] !== undefined) result[key] = structuredClone(history[key]);
  if (history.checkFlags !== undefined) result.checkFlags = structuredClone(history.checkFlags);
  if (Array.isArray(history.suggestions)) result.suggestions = history.suggestions.map(item => ({ ...item }));
  return result;
}

export function normalizeQuestionHistories(question) {
  if (!question || typeof question !== 'object') throw new Error('Question is required');
  const id = text(question.id);
  if (!id) throw new Error('Question requires an id');
  const histories = Array.isArray(question.histories) ? question.histories : [];
  const normalized = histories.map(history => normalizeHistory(history, { questionId: id }));
  const ids = new Set();
  for (const history of normalized) {
    if (ids.has(history.id)) throw new Error(`Duplicate history ${history.id}`);
    ids.add(history.id);
  }
  return { ...question, id, histories: normalized };
}

function unwrap(item) {
  const run = item?.run ?? item?.manifest ?? item;
  const runId = item?.runId ?? run?.runId ?? run?.id;
  if (!run || typeof run !== 'object' || !Array.isArray(run.branches) || typeof runId !== 'string' || !runId) return null;
  return { item, run, runId };
}

function questionKey(run, runId) {
  return run.questionAttachment?.questionId ?? run.continuation?.rootRunId ?? run.rootRunId ?? runId;
}

function eventFromBranch(runId, branch, refs = {}, questionId) {
  const event = normalizeEvent({ ...branch, id: `${runId}:${branch.id}` }, { fallbackId: `${runId}:${branch.id}`, questionId });
  const media = normalizeMediaRefs(branch, refs, { runId, branchId: String(branch.id) });
  for (const key of ['sceneRef', 'heroRef', 'cutoutRef', 'modelRef']) {
    if (media[key] !== undefined) event[key] = media[key];
    else delete event[key];
  }
  return event;
}

function pathEvents(record, eventIndex, questionId) {
  const path = Array.isArray(record.run.continuation?.path) ? [...record.run.continuation.path] : [];
  const hero = record.run.hero?.branchId ?? record.run.hero?.id ?? record.run.heroId
    ?? record.run.branch?.hero?.branchId ?? record.run.branch?.hero?.id ?? record.run.branch?.heroId;
  if (hero && !path.some(item => item.runId === record.runId && item.branchId === hero)
    && record.run.branches.some(branch => String(branch.id) === String(hero))) {
    const branch = record.run.branches.find(item => String(item.id) === String(hero));
    path.push({ runId: record.runId, branchId: String(hero), ...branch });
  }
  return path.map(item => {
    const id = `${item.runId}:${item.branchId}`;
    const source = eventIndex.get(id) ?? item;
    const normalized = normalizeEvent({ ...source, id, year: source.year ?? item.year, causeEventId: text(item.causeEventId) || undefined }, { questionId,
      identity: { runId: String(item.runId), branchId: String(item.branchId) } });
    return { ...normalized, _explicitCause: Boolean(text(item.causeEventId)) };
  });
}

function samePathPrefix(path, prefix) { return prefix.length <= path.length && prefix.every((event, index) => event.id === path[index].id); }
function stableHistoryId(events, index = 0, primary = []) {
  const divergence = index ? events.find((event, eventIndex) => primary[eventIndex]?.id !== event.id) : events[0];
  const key = encodeURIComponent((divergence ?? events[0])?.id ?? 'empty');
  const id = `history-${key}`;
  return id.length <= 240 ? id : `history-${hashPath([divergence ?? events[0]])}`;
}

function hashPath(events) {
  const source = events.map(event => event.id).join('\u0000') || 'empty';
  let hash = 0xcbf29ce484222325n;
  for (let index = 0; index < source.length; index++) {
    hash ^= BigInt(source.charCodeAt(index));
    hash = BigInt.asUintN(64, hash * 0x100000001b3n);
  }
  return `${hash.toString(16).padStart(16, '0')}-${events.length}`;
}

/** Migrate saved run/continuation records without model calls or modifying their source data. */
export function migrateSavedTree(records, { windowRadiusYears = 500, maxEraGapYears = 500 } = {}) {
  if (!Array.isArray(records)) throw new Error('records must be an array');
  if (!Number.isSafeInteger(windowRadiusYears) || windowRadiusYears < 0) throw new Error('windowRadiusYears must be a nonnegative integer');
  const normalized = records.map(unwrap).filter(Boolean);
  const grouped = new Map();
  for (const record of normalized) {
    const qid = questionKey(record.run, record.runId);
    if (!grouped.has(qid)) grouped.set(qid, []);
    grouped.get(qid).push(record);
  }
  const questions = [];
  for (const [questionId, group] of [...grouped].sort(([a], [b]) => String(a).localeCompare(String(b)))) {
    const eventIndex = new Map();
    for (const record of group) for (const branch of record.run.branches) {
      if (!branch?.id) continue;
      const eventId = `${record.runId}:${branch.id}`;
      const refs = record.item?.assetRefsByBranch?.[eventId] ?? record.item?.assetRefsByBranch?.[String(branch.id)] ?? {};
      const parent = record.run.continuation?.path?.at(-1);
      const event = eventFromBranch(record.runId, { ...branch, causeEventId: branch.causeEventId ?? (parent ? `${parent.runId}:${parent.branchId}` : questionId) }, refs, questionId);
      const prior = eventIndex.get(eventId);
      if (prior && JSON.stringify(prior) !== JSON.stringify(event)) throw new Error(`Conflicting saved event ${eventId}`);
      eventIndex.set(eventId, event);
    }
    const paths = group.map(record => pathEvents(record, eventIndex, questionId))
      .filter(path => path.length)
      .map(path => path.sort((a, b) => a.year - b.year || a.id.localeCompare(b.id)));
    const leaves = paths.filter((path, index) => !paths.some((other, otherIndex) => index !== otherIndex && other.length > path.length && samePathPrefix(other, path)));
    const unique = new Map(leaves.map(path => [path.map(event => event.id).join('\u0000'), path]));
    let visitedPaths = [...unique.values()].sort((a, b) => b.length - a.length || a.map(event => event.id).join('|').localeCompare(b.map(event => event.id).join('|')));
    if (!visitedPaths.length) visitedPaths = [[]];

    const historyPaths = visitedPaths.map((path, index) => {
      const forkIndex = index ? path.findIndex((event, i) => visitedPaths[0][i]?.id !== event.id) : -1;
      const prefixEnd = forkIndex < 0 ? 0 : forkIndex;
      const events = path.map((event, eventIndexInPath) => {
        const { _explicitCause, ...clean } = event;
        return { ...clean, causeEventId: _explicitCause ? event.causeEventId : (eventIndexInPath ? path[eventIndexInPath - 1].id : questionId) };
      });
      const forkEventId = index ? (prefixEnd > 0 ? path[prefixEnd - 1].id : questionId) : undefined;
      const existingForkEventId = path.find(event => event.forkEventId)?.forkEventId;
      return { id: stableHistoryId(events, index, visitedPaths[0]), events, ...((existingForkEventId || forkEventId) ? { forkEventId: existingForkEventId || forkEventId } : {}) };
    });
    const idCounts = new Map();
    for (const history of historyPaths) idCounts.set(history.id, (idCounts.get(history.id) ?? 0) + 1);
    const assignedIds = new Set();
    for (const history of historyPaths) {
      if (idCounts.get(history.id) > 1) history.id = `history-${hashPath(history.events)}`;
      const base = history.id;
      let suffix = 2;
      while (assignedIds.has(history.id)) history.id = `${base.slice(0, 230)}-${suffix++}`;
      assignedIds.add(history.id);
    }
    const visitedIds = new Set(visitedPaths.flatMap(path => path.map(event => event.id)));
    for (const record of group) {
      const path = pathEvents(record, eventIndex, questionId);
      const owner = historyPaths.find(history => samePathPrefix(history.events, path)) ?? historyPaths[0];
      for (const branch of record.run.branches) {
        const eventId = `${record.runId}:${branch.id}`;
        if (visitedIds.has(eventId)) continue;
        const candidate = eventIndex.get(eventId);
        if (!candidate) continue;
        const suggestion = {
          ...candidate,
          id: `suggestion:${eventId}`,
          suggestionForEventId: eventId,
          window: { fromYear: candidate.year - windowRadiusYears, toYear: candidate.year + windowRadiusYears },
          verdict: 'fits', reason: 'migrated from earlier exploration', conflictsWith: null,
        };
        if (!owner.suggestions) owner.suggestions = [];
        if (!owner.suggestions.some(item => item.id === suggestion.id)) owner.suggestions.push(suggestion);
      }
    }
    for (const history of historyPaths) {
      history.events.sort((a, b) => a.year - b.year || a.id.localeCompare(b.id));
      const eras = deriveEras(history.events, { maxGapYears: maxEraGapYears });
      for (const event of history.events) event.era = eras.get(event.id);
      history.suggestions?.sort((a, b) => a.year - b.year || a.id.localeCompare(b.id));
    }
    const first = group[0].run;
    const attachment = first.questionAttachment && typeof first.questionAttachment === 'object' ? first.questionAttachment : {};
    const questionText = text(first.divergence ?? first.rootDivergence ?? first.continuation?.rootDivergence ?? attachment.question);
    const title = text(first.questionTitle ?? attachment.title);
    const divergenceYear = [attachment.divergenceYear, first.divergenceYear].find(isYear);
    const place = attachment.divergencePlace ?? attachment.place ?? first.divergencePlace;
    const origin = text(first.questionOrigin ?? attachment.origin);
    questions.push({ id:String(questionId), question:questionText,
      ...(title ? { title } : {}), ...(divergenceYear !== undefined ? { divergenceYear } : {}),
      ...(place && typeof place === 'object' ? { place:structuredClone(place) } : {}), ...(origin ? { origin } : {}), histories:historyPaths });
  }
  return { version: 1, questions, metadata: { migration: 'history-v1-deterministic', counts: {
    questions: questions.length,
    histories: questions.reduce((count, question) => count + question.histories.length, 0),
    events: questions.reduce((count, question) => count + question.histories.reduce((sum, history) => sum + history.events.length, 0), 0),
    suggestions: questions.reduce((count, question) => count + question.histories.reduce((sum, history) => sum + (history.suggestions?.length ?? 0), 0), 0),
  } } };
}

/** Compose per-event geography as of a date; later changes replace the same region/kind. */
export function composeGeography(events = [], asOfYear = Number.POSITIVE_INFINITY) {
  const ordered = [...events].filter(event => isYear(event.year) && event.year <= asOfYear)
    .sort((a, b) => a.year - b.year || String(a.id).localeCompare(String(b.id)));
  const changes = new Map();
  let template = null;
  const globals = {};
  for (const event of ordered) {
    const geography = event.geography;
    if (!geography || !Array.isArray(geography.changes)) continue;
    template = geography;
    if (geography.version === 2) {
      globals.version = 2;
      for (const key of ['seaLevelMeters', 'continentalTransforms', 'assumption', 'uncertainty']) {
        if (geography[key] !== undefined) globals[key] = structuredClone(geography[key]);
      }
    }
    for (const change of geography.changes) {
      if (!change || typeof change !== 'object') continue;
      const target = change.region != null ? `region:${change.region}` : `bounds:${JSON.stringify(change.bounds ?? [])}`;
      const key = `${target}|${change.kind ?? ''}`;
      changes.set(key, structuredClone(change));
    }
  }
  const composed = [...changes.values()].filter(change => change.intensity !== 0);
  const base = globals.version === 2
    ? { version: 2, seaLevelMeters: 0, continentalTransforms: [], ...globals }
    : template ? Object.fromEntries(Object.entries(template).filter(([key]) => key !== 'changes')) : { version: 1 };
  return { ...base, changes: composed };
}
