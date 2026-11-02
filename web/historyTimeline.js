import { deriveEras } from './historyModel.js';

const labelYear = year => `${Math.abs(year).toLocaleString()} ${year < 0 ? 'BCE' : 'CE'}`;
const make = (document, tag, text = null, className = '') => {
  const node = document.createElement(tag);
  if (text !== null) node.textContent = String(text);
  if (className) node.className = className;
  return node;
};
const ordered = events => [...(events || [])].sort((a, b) => a.year - b.year || String(a.id).localeCompare(String(b.id)));
function historyForkYear(history, histories, question) {
  const stored = history?.origin?.forkYear ?? history?.forkYear ?? history?.fork?.year;
  if (Number.isSafeInteger(stored) && stored !== 0) return stored;
  const forkEvent = (histories || []).flatMap(item => item.events || []).find(item => item.id === history?.forkEventId);
  if (Number.isSafeInteger(forkEvent?.year) && forkEvent.year !== 0) return forkEvent.year;
  const first = (histories || [])[0]?.events?.[0]?.year;
  const fallback = question?.divergenceYear ?? first;
  return Number.isSafeInteger(fallback) && fallback !== 0 ? fallback : 1;
}

function erasFor(events) {
  const labels = deriveEras(events.map(event => { const item = { ...event }; delete item.era; return item; }));
  const groups = [];
  for (const event of ordered(events)) {
    const namedEra = typeof event.era === 'string' && event.era.trim() && !/^Era(?: \d+ · |$)/.test(event.era.trim());
    const label = namedEra ? event.era.trim() : labels.get(event.id) || 'Era';
    let group = groups.at(-1);
    if (!group || group.label !== label) groups.push(group = { label, events: [] });
    group.events.push(event);
  }
  return groups;
}

/** Render the event timeline and current suggestion window without owning app navigation. */
export function mountHistoryTimeline(root, { getState, subscribe, session, onHistoryChange = () => {}, onEventSelect = () => {}, onWindowSelect = () => {}, document = globalThis.document } = {}) {
  const host = make(document, 'section', null, 'history-timeline');
  host.setAttribute('aria-label', 'History timeline'); root.replaceChildren(host);
  const status = make(document, 'p', null, 'history-timeline-status'); status.setAttribute('role', 'status'); status.setAttribute('aria-live', 'polite');
  const tabs = make(document, 'div', null, 'history-timeline-histories');
  const timeline = make(document, 'div', null, 'history-timeline-events');
  const suggestions = make(document, 'section', null, 'history-timeline-suggestions');
  host.append(tabs, timeline, suggestions, status);
  const openEras = new Map();
  const button = (label, action, id, extra = {}) => {
    const node = make(document, 'button', label, 'outline'); node.type = 'button'; node.dataset.action = action; node.dataset.id = id;
    for (const [key, value] of Object.entries(extra)) if (value != null) node.dataset[key] = value;
    return node;
  };
  tabs.addEventListener('click', event => {
    const target = event.target.closest?.('button[data-history-id]');
    if (target) onHistoryChange(target.dataset.historyId, target.dataset.historyIndex);
  });
  tabs.addEventListener('change', event => {
    const target = event.target;
    if (target?.matches?.('select[data-history-select]')) onHistoryChange(target.value, target.selectedOptions?.[0]?.dataset.index);
  });
  timeline.addEventListener('click', async event => {
    const node = event.target.closest?.('button[data-action]'); if (!node) return;
    if (node.dataset.action === 'cause') onEventSelect(node.dataset.id);
    else if (node.dataset.action === 'fork-event') await session?.forkEvent?.(node.dataset.id);
    else if (node.dataset.action === 'keep') await session?.keep?.(node.dataset.id, node.dataset.wovenId);
    else if (node.dataset.action === 'regenerate') await session?.regenerate?.(node.dataset.id, node.dataset.wovenId);
    else if (node.dataset.action === 'select-event') onEventSelect(node.dataset.id);
  });
  suggestions.addEventListener('click', async event => {
    const node = event.target.closest?.('button[data-action]'); if (!node) return;
    if (node.dataset.action === 'weave') await session?.weave?.(node.dataset.id);
    else if (node.dataset.action === 'fork-suggestion') await session?.forkSuggestion?.(node.dataset.id);
    else if (node.dataset.action === 'suggest-window') onWindowSelect(Number(node.dataset.year));
    else if (node.dataset.action === 'manual-suggest') await session?.suggest?.();
    else if (node.dataset.action === 'manual-more') await session?.more?.();
  });
  suggestions.addEventListener('change', event => { if (event.target?.dataset?.autoSuggest === 'true') session?.setAutoSuggest?.(event.target.checked); });

  function render(state = getState?.() || {}) {
    const question = state.question || null;
    const histories = state.histories || question?.histories || [];
    const active = state.history || state.activeHistory || histories.find(item => item.id === state.historyId) || histories[0] || null;
    const activeDate = state.date ?? state.asOfYear;
    host.hidden = !state.questionId;
    tabs.replaceChildren(); timeline.replaceChildren(); suggestions.replaceChildren();
    status.hidden = !!active || !state.questionId || !state.status;
    status.textContent = state.status || (state.loading ? 'Loading saved histories…' : '');
    if (!active) return;
    if (histories.length > 1) {
      if (histories.length <= 4) {
        for (const [index, history] of histories.entries()) {
          const forkYear = history.forkEventId || history.origin?.forkYear || history.forkYear || history.fork?.year
            ? historyForkYear(history, histories, question) : null;
          const tab = button(`History ${index + 1}${forkYear !== null ? ` · from ${labelYear(forkYear)}` : ''}`,
            'history', history.id, { historyId: history.id, historyIndex: String(index) });
          tab.dataset.historyId = history.id; tab.setAttribute('role', 'tab'); tab.setAttribute('aria-selected', String(history.id === active.id)); tabs.append(tab);
        }
        tabs.setAttribute('role', 'tablist'); tabs.setAttribute('aria-label', 'Histories');
      } else {
        const label = make(document, 'label', 'Choose a history'); label.setAttribute('for', 'history-timeline-select');
        const select = make(document, 'select'); select.id = 'history-timeline-select'; select.dataset.historySelect = 'true'; select.setAttribute('aria-label', 'Choose a history');
        histories.forEach((history, index) => {
          const forkYear = history.forkEventId || history.origin?.forkYear || history.forkYear || history.fork?.year
            ? historyForkYear(history, histories, question) : null;
          const option = make(document, 'option', `History ${index + 1}${forkYear !== null ? ` · from ${labelYear(forkYear)}` : ''}`);
          option.value = history.id; option.dataset.index = String(index); option.selected = history.id === active.id; select.append(option);
        });
        tabs.append(label, select);
      }
    }
    const causes = new Map(active.events.map(item => [item.id, item]));
    const selected = state.selectedEventId;
    for (const era of erasFor(active.events)) {
      const eraKey = `${active.id}:${era.events[0]?.id || era.label}`;
      const details = make(document, 'details', null, 'history-era');
      details.open = openEras.has(eraKey) ? openEras.get(eraKey) : era.events.some(item => item.id === selected);
      details.addEventListener('toggle', () => openEras.set(eraKey, details.open));
      const summary = make(document, 'summary');
      summary.append(make(document, 'strong', era.label), make(document, 'small', `${labelYear(era.events[0].year)}–${labelYear(era.events.at(-1).year)} · ${era.events.length} event${era.events.length === 1 ? '' : 's'}`));
      details.append(summary);
      const list = make(document, 'ol', null, 'history-era-events');
      for (const item of era.events) {
        const row = make(document, 'li', null, 'history-event-row'); row.dataset.eventId = item.id;
        if (item.id === selected) row.dataset.selected = 'true';
        const select = button(`${labelYear(item.year)} · ${item.title}`, 'select-event', item.id); select.setAttribute('aria-current', String(item.id === selected));
        row.append(select);
        const cause = causes.get(item.causeEventId);
        const because = make(document, 'div', null, 'history-event-cause');
        because.append(document.createTextNode('because ← '));
        if (cause) because.append(button(`${labelYear(cause.year)} · ${cause.title}`, 'cause', cause.id));
        else because.append(make(document, 'span', question?.title || question?.question || 'the question'));
        row.append(because);
        for (const flag of item.checkFlags || []) {
          if (flag.kind !== 'weave-ripple' || flag.status === 'kept') continue;
          const flagNode = make(document, 'div', null, 'history-event-flag');
          flagNode.append(make(document, 'p', flag.message || 'This event may need a re-check after another event was woven in.'),
            button('Keep', 'keep', item.id, { wovenId: flag.wovenEventId }),
            button('Regenerate this event', 'regenerate', item.id, { wovenId: flag.wovenEventId }));
          row.append(flagNode);
        }
        row.append(button('What if instead…', 'fork-event', item.id)); list.append(row);
      }
      details.append(list); timeline.append(details);
    }
    const dateText = activeDate ? labelYear(activeDate) : 'this date';
    const heading = make(document, 'h3', `Could slot in around ${dateText}`);
    suggestions.setAttribute('aria-label', `Suggestions around ${dateText}`); suggestions.append(heading);
    const controls = make(document, 'div', null, 'history-suggestion-controls');
    const autoLabel = make(document, 'label', null, 'history-auto-label');
    const autoToggle = make(document, 'input'); autoToggle.type = 'checkbox'; autoToggle.checked = state.autoSuggest !== false; autoToggle.dataset.autoSuggest = 'true';
    autoToggle.setAttribute('aria-label', 'Automatically suggest events after changing date');
    autoLabel.append(autoToggle, document.createTextNode(' Auto-suggest')); controls.append(autoLabel);
    if (!state.windowCached && !(state.suggestions || []).length) controls.append(button(state.autoSuggest === false ? `Suggest events around ${dateText}` : `Suggest events now around ${dateText}`, 'manual-suggest', 'current-window'));
    if (state.windowCached) controls.append(button(`More around ${dateText}`, 'manual-more', 'current-window'));
    controls.queryAll?.('button').forEach(node => { node.disabled = !!state.loading || !!state.paused; });
    suggestions.append(controls);
    const cachedWindows = new Map();
    for (const item of active.suggestionWindows || []) {
      const key = `${item.window.fromYear}:${item.window.toYear}`; cachedWindows.set(key, { ...item, count:item.suggestionCount || 0 });
    }
    for (const item of active.suggestions || []) if (item.window) {
      const key = `${item.window.fromYear}:${item.window.toYear}`;
      const cached = cachedWindows.get(key) || { window:item.window, status:'ready', count:0 };
      if (!cached.count) cached.count = (active.suggestions || []).filter(value => value.window?.fromYear === item.window.fromYear && value.window?.toYear === item.window.toYear).length;
      cachedWindows.set(key, cached);
    }
    if (cachedWindows.size) {
      const jumps = make(document, 'div', null, 'history-window-jumps');
      for (const item of cachedWindows.values()) {
        const from = item.window.fromYear, to = item.window.toYear;
        const chip = button(`+${item.count} suggestions · ${labelYear(from)} to ${labelYear(to)}`, 'suggest-window', `${from}:${to}`, { year:String(from) });
        chip.setAttribute('aria-label', `Show ${item.count} suggestions for ${labelYear(from)} to ${labelYear(to)}`); jumps.append(chip);
      }
      suggestions.append(jumps);
    }
    const activeWindow = state.window;
    const available = state.suggestions || active.suggestions?.filter(item => !activeWindow || item.window?.fromYear === activeWindow.fromYear && item.window?.toYear === activeWindow.toYear) || [];
    if (!available.length) suggestions.append(make(document, 'p', state.status || (state.autoSuggest ? 'No suggestions in this window yet.' : `Use “Suggest events around ${dateText}” to explore this window.`), 'history-session-status'));
    else if (state.status) suggestions.append(make(document, 'p', state.status, 'history-session-status'));
    for (const item of available) {
      const card = make(document, 'article', null, 'history-timeline-suggestion');
      card.append(make(document, 'div', `${labelYear(item.year)} · ${item.verdict === 'conflicts' ? 'Conflicts' : 'Fits'}`, `history-verdict ${item.verdict === 'conflicts' ? 'conflicts' : 'fits'}`),
        make(document, 'h4', item.title || 'Untitled possibility'), make(document, 'p', item.summary || ''), make(document, 'p', item.reason || '', 'history-suggestion-reason'));
      if (item.verdict === 'conflicts') card.append(button('What if instead…', 'fork-suggestion', item.id));
      else card.append(button('Weave into history', 'weave', item.id));
      suggestions.append(card);
    }
  }
  const unsubscribe = subscribe?.(render);
  render();
  return { element: host, render, destroy() { unsubscribe?.(); root.replaceChildren(); } };
}

export { erasFor as groupHistoryEras, historyForkYear };
