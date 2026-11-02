import { composeGeography } from './historyModel.js';
import { atlasZoomState } from './atlasLayout.js';

const isYear = value => Number.isSafeInteger(value) && value !== 0;
const byYearAndId = (a, b) => a.year - b.year || String(a.id).localeCompare(String(b.id));

/** Stable semantic pin role; hover changes brightness while preserving event/suggestion identity. */
export function historyPinColorRole(world = {}, { hovered = false } = {}) {
  if (world.visualKind === 'history-sibling') return hovered ? 'spine-sibling-hover' : 'spine-sibling';
  if (world.historySpineRole === 'sibling') return hovered ? 'spine-sibling-hover' : 'spine-sibling';
  if (world.historySpineRole === 'trunk' && world.highlighted) return hovered ? 'gold-latest-hover' : 'gold-latest';
  if (world.historySpineRole === 'trunk') return hovered ? 'spine-trunk-hover' : 'spine-trunk';
  if (world.visualKind === 'history-spine-event') return hovered ? 'gold-hover' : 'gold';
  if (world.visualKind === 'history-event') return world.highlighted
    ? hovered ? 'gold-latest-hover' : 'gold-latest'
    : hovered ? 'gold-hover' : 'gold';
  if (world.visualKind === 'history-suggestion') return hovered ? 'cyan-hover' : 'cyan';
  return null;
}

/** Skip the optional one-history Orbit tier while keeping direct surface-to-Atlas interpolation. */
export function historyZoomPresentation(value, orbitEnabled = false) {
  const zoom = Math.min(1, Math.max(0, Number(value) || 0));
  const raw = atlasZoomState(zoom);
  if (orbitEnabled) {
    // Let the view options stage transition fill the Orbit→Atlas interval so
    // the Atlas label never appears while its spine is still nearly invisible.
    const amount = Math.min(1, Math.max(0, (zoom - 0.72) / (0.84 - 0.72)));
    const progress = amount * amount * (3 - 2 * amount);
    return { rawZoom:zoom, opacity:1, state:{ ...raw, surface:1 - raw.lift, atlas:progress,
      orbit:raw.lift * (1 - progress), earthScale:1 - 0.66 * raw.lift, earthX:-1.9 * raw.lift } };
  }
  const amount = Math.min(1, Math.max(0, (zoom - 0.22) / 0.78));
  const progress = amount * amount * (3 - 2 * amount);
  return { rawZoom:zoom, opacity:1, state:{ ...raw, surface:1 - progress, lift:progress, orbit:0, atlas:progress,
    earthScale:1 - 0.66 * progress, earthX:-1.9 * progress } };
}

/** Match the history session's year window when a caller has not supplied its cached window. */
export function historyWindowForYear(year) {
  if (!isYear(year)) throw new Error('Atlas date must be a nonzero integer year');
  const era = Math.floor((Math.abs(year) - 1) / 1000);
  return year < 0
    ? { fromYear: -(era + 1) * 1000, toYear: -(era * 1000 + 1) }
    : { fromYear: era * 1000 + 1, toYear: (era + 1) * 1000 };
}

/** Compact history badge text always follows the current Surface/Orbit/Atlas zoom stage. */
export function historyAtlasStatus(level, eventCount) {
  const labels = { surface:'SURFACE · HISTORY', lift:'LIFT · HISTORY SPINES', orbit:'ORBIT · SIBLING HISTORIES', atlas:'ATLAS · HISTORY SPINES' };
  const count = Math.max(0, Math.trunc(Number(eventCount) || 0));
  return `${labels[level] || labels.surface} · ${count} ${count === 1 ? 'EVENT' : 'EVENTS'}`;
}

/** Preserve the precomputed sibling ring when constructing the history Orbit snapshot. */
export function historyOrbitPositions(entries = []) {
  return new Map((Array.isArray(entries) ? entries : []).map(entry => [String(entry.id),
    { ...(entry.orbit || entry.atlas || { x:0, y:0, z:0 }) }]));
}

/** Orbit siblings are mini-Earths; give them Earth-like size instead of event-pin scale. */
export function historyOrbitMarkerScale(markerScale, world = {}) {
  return Math.max(0, Number(markerScale) || 0) * (world.visualKind === 'history-sibling' ? 4.5 : 1);
}

/** Cyan dashed possibility halos belong to legacy speculative worlds, never saved history records. */
export function shouldShowPossibilityOutline({ historyMode = false, isCurrent = false, selectable = true } = {}) {
  return !historyMode && !isCurrent && selectable;
}

/** Fade the synthetic current-world Earth out as the Atlas becomes the focus. */
export function historySurfaceVisibility(atlas) {
  return Math.max(0, Math.min(1, 1 - (Number(atlas) || 0)));
}

/** Keep the history count visible even when a narrow chip truncates its title. */
export function formatHistoryQuestionChip({ title = '', historyCount = 0, year = null } = {}) {
  const count = Math.max(0, Math.trunc(Number(historyCount) || 0));
  const countLabel = `${count} ${count === 1 ? 'history' : 'histories'}`;
  const fullTitle = String(title || 'Other question').trim();
  const words = fullTitle.replace(/^what if\s+/i, '').split(/\s+/).filter(Boolean);
  const shortTitle = words.length > 5 ? `${words.slice(0, 5).join(' ')}…` : words.join(' ');
  const numericYear = Number(year);
  const yearLabel = Number.isSafeInteger(numericYear) && numericYear !== 0
    ? numericYear < 0 ? `${Math.abs(numericYear)} BCE` : `${numericYear} CE`
    : 'Year unknown';
  return {
    text:`${countLabel} · ${shortTitle}`,
    fullText:`${countLabel} · ${fullTitle} · divergence ${yearLabel}`,
  };
}

/** Frame only the composed history geometry and its active pins in Atlas world units. */
export function historyAtlasFrameBounds(geometry = {}, entries = [], currentId = null) {
  const points = [
    ...(Array.isArray(geometry.positions) ? geometry.positions : []),
    ...(Array.isArray(geometry.chips) ? geometry.chips : []),
    ...(Array.isArray(entries) ? entries.filter(entry => String(entry.id) === String(currentId)
      || entry.world?.historySpineNodeId || entry.world?.visualKind === 'history-suggestion').map(entry => entry.atlas) : []),
  ].filter(point => Number.isFinite(point?.x) && Number.isFinite(point?.y));
  const xs = points.map(point => Number(point.x)), ys = points.map(point => Number(point.y));
  return {
    left:Math.min(-1.5, ...xs) - 0.65,
    right:Math.max(1.5, ...xs) + 0.65,
    bottom:Math.min(-1.8, ...ys) - 0.55,
    top:Math.max(1.2, ...ys) + 0.8,
  };
}

/** Project out-of-range suggestion years to a bounded time-axis edge, preserving their saved year. */
export function historyYearToAtlasX(year, minimum, maximum, width = 7.2) {
  const min = Number(minimum), max = Number(maximum), date = Number(year);
  const halfWidth = Math.max(0.5, Math.abs(Number(width) || 7.2) / 2);
  if (![min, max, date].every(Number.isFinite)) return halfWidth;
  if (max <= min) return date < min ? -halfWidth : date > max ? halfWidth : 0;
  const span = Math.max(1, max - min);
  const projected = ((date - min) / span - 0.5) * width;
  return Math.max(-halfWidth, Math.min(halfWidth, projected));
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
    .filter(item => (item?.historyId == null || String(item.historyId) === String(activeHistory.id))
      && exactWindowSuggestion(item, dateWindow, suppliedSuggestions))
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
