import { groupHistoryEras } from './historyTimeline.js';

const labelYear = year => `${Math.abs(year).toLocaleString()} ${year < 0 ? 'BCE' : 'CE'}`;
const make = (document, tag, text = null, className = '') => {
  const node = document.createElement(tag);
  if (text !== null) node.textContent = String(text);
  if (className) node.className = className;
  return node;
};
const ordered = events => [...(events || [])].sort((a, b) => a.year - b.year || String(a.id).localeCompare(String(b.id)));

/** Keep same-pixel event dates individually targetable without moving the time slider. */
export function eventTickPositions(events, scale, width, minGapPx = 32) {
  const items = ordered(events).map(event => ({ event, natural:scale.maxIndex ? scale.indexAt(event.year) / scale.maxIndex * width : width / 2 }));
  const positions = new Map();
  for (let index = 0; index < items.length;) {
    const group = [items[index++]];
    while (index < items.length && items[index].natural - group.at(-1).natural < minGapPx) group.push(items[index++]);
    const span = minGapPx * (group.length - 1);
    const center = group.reduce((sum, item) => sum + item.natural, 0) / group.length;
    const start = Math.max(0, Math.min(Math.max(0, width - span), center - span / 2));
    group.forEach((item, offset) => positions.set(item.event.id, start + offset * minGapPx));
  }
  return positions;
}

/** Map the integer slider domain to nonzero years, skipping year zero when crossing eras. */
export function createHistoryTimeScale(events = [], currentDate = null, { extraYears = [], windows = [] } = {}) {
  const years = [...new Set([...events.map(item => item.year), ...extraYears,
    ...windows.flatMap(item => [item.fromYear ?? item.window?.fromYear, item.toYear ?? item.window?.toYear]),
    ...(Number.isSafeInteger(currentDate) && currentDate !== 0 ? [currentDate] : [])].filter(year => Number.isSafeInteger(year) && year !== 0))];
  let minYear = years.length ? Math.min(...years) : -500;
  let maxYear = years.length ? Math.max(...years) : 500;
  if (minYear === maxYear) { minYear -= 500; maxYear += 500; }
  const crossesZero = minYear < 0 && maxYear > 0;
  const maxIndex = maxYear - minYear - (crossesZero ? 1 : 0);
  const yearAt = index => {
    const bounded = Math.max(0, Math.min(maxIndex, Math.round(index)));
    const raw = minYear + bounded;
    return crossesZero && raw >= 0 ? raw + 1 : raw;
  };
  const indexAt = year => {
    const safeYear = year === 0 ? -1 : Math.max(minYear, Math.min(maxYear, year));
    return safeYear - minYear - (crossesZero && safeYear > 0 ? 1 : 0);
  };
  return { minYear, maxYear, minIndex: 0, maxIndex, crossesZero, yearAt, indexAt };
}

function eraTicks(events) {
  return groupHistoryEras(ordered(events)).map(group => ({ label:group.label, year:group.events[0].year }));
}

/** Give every canonical era one non-overlapping stretch of the date track. */
export function historyEraTickSegments(events, scale) {
  const eras = eraTicks(events);
  return eras.map((era, index) => {
    const start = scale.maxIndex ? scale.indexAt(era.year) / scale.maxIndex * 100 : 0;
    const next = eras[index + 1];
    const end = next && scale.maxIndex ? scale.indexAt(next.year) / scale.maxIndex * 100 : 100;
    return { ...era, left:Math.max(0, Math.min(100, start)), width:Math.max(0, Math.min(100, end) - Math.max(0, start)) };
  });
}

/** Bottom-of-globe as-of date control; hover is inert and keyboard steps by event. */
export function mountHistoryTimebar(root, { getState, subscribe, onDateChange = () => {}, onEventSelect = () => {}, document = globalThis.document } = {}) {
  const host = make(document, 'section', null, 'history-timebar'); host.setAttribute('aria-label', 'History time bar'); root.replaceChildren(host);
  const readout = make(document, 'output', '', 'history-timebar-readout'); readout.setAttribute('aria-live', 'polite');
  const track = make(document, 'div', null, 'history-timebar-track');
  const range = make(document, 'input', null, 'history-timebar-range'); range.type = 'range'; range.step = '1'; range.setAttribute('aria-label', 'History as of date');
  const eraLayer = make(document, 'div', null, 'history-timebar-eras');
  const eventLayer = make(document, 'div', null, 'history-timebar-events');
  track.append(range, eraLayer, eventLayer); host.append(readout, track);
  let current = null, scale = null, events = [];
  const selectYear = (year, source = 'tick') => {
    if (!Number.isSafeInteger(year) || year === 0) return;
    range.value = String(scale.indexAt(year)); updateReadout(year);
    onDateChange(year, { source });
  };
  const updateReadout = year => {
    const count = events.filter(item => item.year <= year).length;
    readout.value = `History as of ${labelYear(year)} · ${count} event${count === 1 ? '' : 's'}`; readout.textContent = readout.value;
  };
  range.addEventListener('input', () => selectYear(scale.yearAt(Number(range.value)), 'scrub'));
  range.addEventListener('change', () => selectYear(scale.yearAt(Number(range.value)), 'scrub-end'));
  range.addEventListener('keydown', event => {
    if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return;
    event.preventDefault();
    const date = scale.yearAt(Number(range.value));
    const points = [...new Set(events.map(item => item.year))].sort((a, b) => a - b);
    const next = event.key === 'ArrowRight'
      ? points.find(year => year > date) ?? scale.maxYear
      : [...points].reverse().find(year => year < date) ?? scale.minYear;
    selectYear(next, 'event-step');
  });
  eventLayer.addEventListener('click', event => {
    const tick = event.target.closest?.('button[data-year]'); if (!tick) return;
    selectYear(Number(tick.dataset.year), 'event-tick');
    onEventSelect(tick.dataset.eventId);
  });
  eraLayer.addEventListener('click', event => {
    const tick = event.target.closest?.('button[data-year]'); if (tick) selectYear(Number(tick.dataset.year), 'era-tick');
  });
  function render(state = getState?.() || {}) {
    current = state; const active = state.history || state.activeHistory;
    const date = state.date ?? state.asOfYear;
    events = ordered(active?.events || []);
    const allEvents = (state.histories || state.question?.histories || [active]).flatMap(item => item?.events || []);
    const allWindows = (state.histories || state.question?.histories || [active]).flatMap(item => [
      ...(item?.suggestionWindows || []).map(entry => entry.window), ...(item?.suggestions || []).map(entry => entry.window),
    ]).filter(Boolean);
    const extraYears = [state.question?.divergenceYear, ...(state.suggestions || []).map(item => item.year), ...(state.history?.suggestions || []).map(item => item.year)];
    const selectedWindow = state.window;
    if (selectedWindow) allWindows.push(selectedWindow);
    host.hidden = !state.questionId || !active;
    scale = createHistoryTimeScale(allEvents.length ? allEvents : events, date, { extraYears, windows:allWindows });
    const eventWidth = eventLayer.getBoundingClientRect?.().width || 320;
    const eventPositions = eventTickPositions(events, scale, eventWidth);
    range.min = String(scale.minIndex); range.max = String(scale.maxIndex); range.value = String(scale.indexAt(date || events.at(-1)?.year || 1));
    range.setAttribute('aria-valuetext', `History as of ${labelYear(scale.yearAt(Number(range.value)))}`);
    const selectedYear = scale.yearAt(Number(range.value));
    updateReadout(selectedYear);
    eraLayer.replaceChildren(); eventLayer.replaceChildren();
    for (const era of historyEraTickSegments(events, scale)) {
      const tick = make(document, 'button', era.label, 'history-timebar-era-tick'); tick.type = 'button'; tick.dataset.year = String(era.year);
      tick.style.left = `${era.left}%`; tick.style.width = `${era.width}%`; tick.title = `${era.label} · ${labelYear(era.year)}`;
      eraLayer.append(tick);
    }
    for (const event of events) {
      const tick = make(document, 'button', '', `history-timebar-event-tick${event.id === state.selectedEventId ? ' is-selected' : ''}`); tick.type = 'button';
      tick.dataset.year = String(event.year); tick.dataset.eventId = event.id; tick.setAttribute('aria-label', `${labelYear(event.year)} · ${event.title}`);
      tick.title = `${labelYear(event.year)} · ${event.title}`; tick.style.left = `${eventPositions.get(event.id) || 0}px`;
      eventLayer.append(tick);
    }
  }
  const unsubscribe = subscribe?.(render); render();
  return { element: host, render, setDate(year) { selectYear(year, 'external'); }, destroy() { unsubscribe?.(); root.replaceChildren(); } };
}

export { eraTicks as collectHistoryEraTicks };
