import { composeGeography } from './historyModel.js';

const isYear = value => Number.isSafeInteger(value) && value !== 0;
const byYearAndId = (a, b) => a.year - b.year || String(a.id).localeCompare(String(b.id));

/** Stable semantic pin role; hover changes brightness while preserving event/suggestion identity. */
export function historyPinColorRole(world = {}, { hovered = false } = {}) {
  if (world.visualKind === 'history-event') return world.highlighted
    ? hovered ? 'gold-latest-hover' : 'gold-latest'
    : hovered ? 'gold-hover' : 'gold';
  if (world.visualKind === 'history-suggestion') return hovered ? 'cyan-hover' : 'cyan';
  return null;
}

/** Match the history session's year window when a caller has not supplied its cached window. */
export function historyWindowForYear(year) {
  if (!isYear(year)) throw new Error('Atlas date must be a nonzero integer year');
  const era = Math.floor((Math.abs(year) - 1) / 1000);
  return year < 0
    ? { fromYear: -(era + 1) * 1000, toYear: -(era * 1000 + 1) }
    : { fromYear: era * 1000 + 1, toYear: (era + 1) * 1000 };
}

/** Build independent spatial entries for active-history pins without parent/child tree links. */
export function layoutHistoryPins(worlds = [], currentId = null) {
  const items = Array.isArray(worlds) ? worlds.filter(world => typeof world?.id === 'string' && world.id) : [];
  const total = Math.max(1, items.length);
  return items.map((world, index) => {
    const id = world.id;
    const lat = Number(world.lat ?? world.place?.lat);
    const lon = Number(world.lon ?? world.place?.lon);
    const hasGeo = Number.isFinite(lat) && Number.isFinite(lon);
    const phi = (90 - (hasGeo ? lat : 0)) * Math.PI / 180;
    const theta = (hasGeo ? lon : (index - (total - 1) / 2) * 12) * Math.PI / 180;
    const globe = { x: -Math.sin(phi) * Math.cos(theta), y: Math.cos(phi), z: Math.sin(phi) * Math.sin(theta) };
    const isCurrent = id === currentId;
    const spread = (index - (total - 1) / 2) * 0.28;
    return {
      id, parentId:null, world, depth:0, lane:index,
      current:isCurrent, lineage:false, child:false, sibling:false,
      globe,
      atlas:isCurrent ? { x:-1.9, y:0, z:0 } : { x:spread, y:(hasGeo ? lat / 90 : 0) * 1.35, z:(hasGeo ? lon / 180 : 0) * 0.2 },
    };
  });
}

function checkedWindow(window, asOfYear) {
  const value = window ?? historyWindowForYear(asOfYear);
  if (!isYear(value?.fromYear) || !isYear(value?.toYear) || value.fromYear > value.toYear
    || asOfYear < value.fromYear || asOfYear > value.toYear) {
    throw new Error('Atlas window must contain the selected date');
  }
  return { fromYear: value.fromYear, toYear: value.toYear };
}

function eventsAsOf(history, asOfYear) {
  return [...(history.events || [])].filter(event => isYear(event?.year) && event.year <= asOfYear).sort(byYearAndId);
}

function exactWindowSuggestion(item, window, explicitWindowList) {
  if (!isYear(item?.year) || item.year < window.fromYear || item.year > window.toYear) return false;
  // Session suggestions are already selected from the active cache window. Persisted suggestions
  // must carry the exact window identity so overlapping historical caches cannot leak into it.
  if (explicitWindowList && item.window == null) return true;
  return item.window?.fromYear === window.fromYear && item.window?.toYear === window.toYear;
}

function siblingSnapshot(history, asOfYear) {
  const events = eventsAsOf(history, asOfYear);
  return {
    historyId: history.id,
    forkEventId: history.forkEventId ?? null,
    events,
    latestEvent: events.at(-1) ?? null,
    geography: composeGeography(events, asOfYear),
  };
}

/**
 * Project one normalized question/history into the as-of-date Atlas view.
 * Event and suggestion records are copied only to add presentation metadata; their IDs and
 * saved scene/cutout/model refs remain intact for the event sheet and media loaders.
 */
export function projectHistoryAtlas(question, {
  historyId = question?.histories?.[0]?.id,
  asOfYear,
  window = null,
  suggestions,
} = {}) {
  if (!question || typeof question !== 'object' || !Array.isArray(question.histories)) {
    throw new Error('Atlas projection requires a question with histories');
  }
  if (!isYear(asOfYear)) throw new Error('Atlas date must be a nonzero integer year');
  const activeHistory = question.histories.find(history => String(history.id) === String(historyId));
  if (!activeHistory) throw new Error(`Atlas history ${historyId ?? ''} was not found`);
  if (!Array.isArray(activeHistory.events)) throw new Error('Atlas history requires an events array');

  const dateWindow = checkedWindow(window, asOfYear);
  const pastEvents = eventsAsOf(activeHistory, asOfYear);
  const latestEvent = pastEvents.at(-1) ?? null;
  const pins = pastEvents.map(event => ({
    ...event,
    historyId: activeHistory.id,
    visualKind: 'history-event',
    highlighted: event.id === latestEvent?.id,
    selectionEventId: event.id,
  }));
  const suppliedSuggestions = Array.isArray(suggestions);
  const suggestionRecords = suppliedSuggestions ? suggestions : (activeHistory.suggestions || []);
  const visibleSuggestions = suggestionRecords
    .filter(item => exactWindowSuggestion(item, dateWindow, suppliedSuggestions))
    .sort(byYearAndId)
    .map(item => ({
      ...item,
      historyId: activeHistory.id,
      visualKind: 'history-suggestion',
      highlighted: false,
      selectionEventId: item.suggestionForEventId || item.id,
    }));
  const composedGeography = composeGeography(pastEvents, asOfYear);
  const siblingEarths = question.histories
    .filter(history => history !== activeHistory && String(history.id) !== String(activeHistory.id))
    .map(history => siblingSnapshot(history, asOfYear));

  return {
    questionId: String(question.id),
    question: question.question || question.prompt || question.title || '',
    historyId: activeHistory.id,
    asOfYear,
    window: dateWindow,
    activeHistory,
    events: pastEvents,
    latestEvent,
    pins,
    suggestions: visibleSuggestions,
    composedGeography,
    surface: { historyId: activeHistory.id, asOfYear, latestEvent, geography: composedGeography },
    siblingEarths,
  };
}
