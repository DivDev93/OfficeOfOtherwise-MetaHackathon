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
function timelineIdentity(history, histories) {
  const events = ordered(history?.events);
  const peers = (histories || []).filter(item => String(item.id) !== String(history?.id));
  let sharedPrefixLength = 0;
  for (const peer of peers) {
    const otherEvents = ordered(peer.events);
    let length = 0;
    while (length < events.length && length < otherEvents.length && String(events[length].id) === String(otherEvents[length].id)) length++;
    sharedPrefixLength = Math.max(sharedPrefixLength,length);
  }
  const first = events[0] || null;
  const firstEventId = String(first?.id || '');
  const sharedStartCount = firstEventId ? (histories || []).filter(item => String(ordered(item.events)[0]?.id || '') === firstEventId).length : 0;
  return { events, first, sharedStartCount, sharedPrefixLength, sharedThrough:sharedPrefixLength ? events[sharedPrefixLength - 1] : null,
    distinguishing:events[sharedPrefixLength] || null, latest:events.at(-1) || null };
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
export function mountHistoryTimeline(root, { getState, subscribe, session, onHistoryChange = () => {}, onEventSelect = () => {}, onWindowSelect = () => {}, isCompact = () => false, onCompactInspect = () => {}, document = globalThis.document } = {}) {
  const host = make(document, 'section', null, 'history-timeline');
  host.setAttribute('aria-label', 'History timeline'); root.replaceChildren(host);
  const status = make(document, 'p', null, 'history-timeline-status'); status.setAttribute('role', 'status'); status.setAttribute('aria-live', 'polite');
  const tabs = make(document, 'div', null, 'history-timeline-histories');
  const timeline = make(document, 'div', null, 'history-timeline-events');
  const suggestions = make(document, 'section', null, 'history-timeline-suggestions');
  suggestions.tabIndex = -1; suggestions.setAttribute('role','region'); suggestions.setAttribute('aria-label','Saved suggestions for the selected window');
  const comparison = make(document, 'section', null, 'history-timeline-comparison'); comparison.hidden = true;
  comparison.setAttribute('aria-label','Compare saved timelines');
  host.append(tabs, timeline, suggestions, comparison, status);
  const openEras = new Map();
  const batchSelections = new Map();
  const seenBatchSuggestions = new Map();
  let batchScope = '', batchNotice = '';
  let galleryExpanded = false, lastRenderedHistoryId = '', lastRenderedSelectionId = '';
  let comparisonOpen = false, comparisonHasFocus = false, comparisonFocusAction = 'back-to-timeline', comparisonFocusHistoryId = '', comparisonCards = null, comparisonPreviousRail = null, comparisonPreviousScrollTop = null;
  const button = (label, action, id, extra = {}) => {
    const node = make(document, 'button', label, 'outline'); node.type = 'button'; node.dataset.action = action; node.dataset.id = id;
    for (const [key, value] of Object.entries(extra)) if (value != null) node.dataset[key] = value;
    return node;
  };
  const findAction = (root, action, historyId = '') => {
    const nativeNodes = [...(root.querySelectorAll?.('button[data-action]') || [])];
    const nodes = nativeNodes.length ? nativeNodes : [...(root.queryAll?.('button') || [])];
    return nodes.find(node => node.dataset?.action === action && (!historyId || node.dataset?.historyId === historyId));
  };
  tabs.addEventListener('click', event => {
    const action = event.target.closest?.('button[data-action]');
    if (action?.dataset.action === 'compare-timelines') { openComparison(); return; }
    const target = event.target.closest?.('button[data-history-id]');
    if (target) onHistoryChange(target.dataset.historyId, target.dataset.historyIndex);
  });
  const setGalleryExpanded = open => {
    galleryExpanded = open;
    render(getState?.() || {});
    if (open) suggestions.scrollIntoView?.({block:'nearest'});
    findAction(suggestions,'toggle-gallery')?.focus?.({preventScroll:true});
  };
  const inspectSuggestion = id => {
    onEventSelect(id);
    if (galleryExpanded && isCompact()) {
      setGalleryExpanded(false);
      onCompactInspect(id);
    }
  };
  tabs.addEventListener('change', event => {
    const target = event.target;
    if (target?.matches?.('select[data-history-select]')) onHistoryChange(target.value, target.selectedOptions?.[0]?.dataset.index);
  });
  function focusCompareButton() { findAction(tabs,'compare-timelines')?.focus?.({preventScroll:true}); }
  function closeComparison({ focus = true } = {}) {
    if (!comparisonOpen) return;
    comparisonOpen = false; comparisonHasFocus = false;
    render(getState?.() || {});
    if (comparisonPreviousRail && comparisonPreviousScrollTop != null) comparisonPreviousRail.scrollTop = comparisonPreviousScrollTop;
    comparisonPreviousRail = null; comparisonPreviousScrollTop = null;
    if (focus) focusCompareButton();
  }
  function openComparison() {
    comparisonOpen = true; comparisonHasFocus = true; comparisonFocusAction = 'back-to-timeline'; comparisonFocusHistoryId = '';
    const rail = host.closest?.('.exploration-rail'); comparisonPreviousRail = rail || null; comparisonPreviousScrollTop = rail?.scrollTop ?? null;
    if (rail) rail.scrollTop = 0;
    render(getState?.() || {});
    const activeCard = [...(comparison.querySelectorAll?.('article')?.length ? comparison.querySelectorAll('article') : comparison.queryAll?.('article') || [])]
      .find(node => node.getAttribute?.('aria-current') === 'true');
    const listRect = comparisonCards?.getBoundingClientRect?.(), cardRect = activeCard?.getBoundingClientRect?.();
    if (listRect && cardRect) {
      if (cardRect.top < listRect.top) comparisonCards.scrollTop += cardRect.top - listRect.top;
      else if (cardRect.bottom > listRect.bottom) comparisonCards.scrollTop += cardRect.bottom - listRect.bottom;
    } else if (activeCard && Number.isFinite(activeCard.offsetTop) && Number.isFinite(comparisonCards?.clientHeight) && comparisonCards.clientHeight > 0) {
      comparisonCards.scrollTop = Math.max(0,activeCard.offsetTop - comparisonCards.clientHeight + activeCard.offsetHeight);
    }
    findAction(comparison,'back-to-timeline')?.focus?.({ preventScroll:true });
  }
  comparison.addEventListener('click', event => {
    const target = event.target.closest?.('button[data-action]'); if (!target) return;
    if (target.dataset.action === 'back-to-timeline') { closeComparison(); return; }
    if (target.dataset.action === 'choose-history') {
      const id = target.dataset.historyId, index = target.dataset.historyIndex;
      comparisonOpen = false; comparisonHasFocus = false;
      comparisonPreviousRail = null; comparisonPreviousScrollTop = null;
      onHistoryChange(id,index);
      render(getState?.() || {});
      focusCompareButton();
    }
  });
  comparison.addEventListener('focusin', event => {
    comparisonHasFocus = true;
    const target = event.target.closest?.('button[data-action]');
    if (target) { comparisonFocusAction = target.dataset.action; comparisonFocusHistoryId = target.dataset.historyId || ''; }
  });
  comparison.addEventListener('focusout', event => {
    if (!event.relatedTarget || !comparison.contains?.(event.relatedTarget)) comparisonHasFocus = false;
  });
  host.addEventListener('keydown', event => {
    if (comparisonOpen && event.key === 'Escape') { event.preventDefault?.(); event.stopPropagation?.(); closeComparison(); }
    else if (galleryExpanded && event.key === 'Escape') { event.preventDefault?.(); event.stopPropagation?.(); setGalleryExpanded(false); }
  });
  timeline.addEventListener('click', async event => {
    const node = event.target.closest?.('button[data-action]'); if (!node) return;
    if (node.dataset.action === 'jump-suggestions') { setGalleryExpanded(true); return; }
    if (node.dataset.action === 'cause') onEventSelect(node.dataset.id);
    else if (node.dataset.action === 'fork-event') await session?.forkEvent?.(node.dataset.id);
    else if (node.dataset.action === 'keep') await session?.keep?.(node.dataset.id, node.dataset.wovenId);
    else if (node.dataset.action === 'regenerate') await session?.regenerate?.(node.dataset.id, node.dataset.wovenId);
    else if (node.dataset.action === 'select-event') onEventSelect(node.dataset.id);
    else if (node.dataset.action === 'select-suggestion') onEventSelect(node.dataset.id);
  });
  suggestions.addEventListener('click', async event => {
    if (event.target?.dataset?.batchSuggestion) return;
    const node = event.target.closest?.('button[data-action]');
    if (!node) {
      const card = event.target.closest?.('article.history-timeline-suggestion');
      if (card?.dataset.suggestionId) inspectSuggestion(card.dataset.suggestionId);
      return;
    }
    if (node.dataset.action === 'select-suggestion') inspectSuggestion(node.dataset.id);
    else if (node.dataset.action === 'weave') await session?.weave?.(node.dataset.id);
    else if (node.dataset.action === 'fork-suggestion') await session?.forkSuggestion?.(node.dataset.id);
    else if (node.dataset.action === 'suggest-window') {
      const group = (suggestions.queryAll?.('section') || []).find(item => item.dataset.windowKey === `${node.dataset.fromYear}:${node.dataset.toYear}`);
      group?.scrollIntoView?.({block:'nearest'}); group?.focus?.({preventScroll:true});
    }
    else if (node.dataset.action === 'toggle-gallery') setGalleryExpanded(!galleryExpanded);
    else if (node.dataset.action === 'manual-suggest') await session?.suggest?.();
    else if (node.dataset.action === 'manual-more') await session?.more?.();
    else if (node.dataset.action === 'batch-select-all' || node.dataset.action === 'batch-select-none') {
      const selected = batchSelections.get(batchScope) || new Set();
      const eligible = [...(suggestions.queryAll?.('input') || [])].filter(input => input.dataset?.batchSuggestion && !input.disabled);
      for (const [index,input] of eligible.entries()) {
        input.checked = node.dataset.action === 'batch-select-all' && index < 32;
        if (input.checked) selected.add(input.dataset.batchSuggestion); else selected.delete(input.dataset.batchSuggestion);
      }
      batchSelections.set(batchScope, selected); batchNotice = node.dataset.action === 'batch-select-all' && eligible.length > 32 ? 'Select up to 32 suggestions to weave at once.' : '';
      render(getState?.() || {});
    }
    else if (node.dataset.action === 'weave-batch') {
      const scope = batchScope, selected = [...(batchSelections.get(scope) || [])];
      if (selected.length && selected.length <= 32) {
        batchNotice = '';
        const result = await session?.weaveBatch?.(selected);
        if (result) for (const id of selected) batchSelections.get(scope)?.delete(id);
      }
    }
  });
  suggestions.addEventListener('change', event => {
    const target = event.target;
    if (target?.dataset?.autoSuggest === 'true') session?.setAutoSuggest?.(target.checked);
    else if (target?.dataset?.batchSuggestion) {
      const selected = batchSelections.get(batchScope) || new Set();
      if (target.checked && selected.size >= 32) { target.checked = false; batchNotice = 'Select up to 32 suggestions to weave at once.'; }
      else { if (target.checked) selected.add(target.dataset.batchSuggestion); else selected.delete(target.dataset.batchSuggestion); batchNotice = ''; }
      batchSelections.set(batchScope, selected); render(getState?.() || {});
    }
  });

  function render(state = getState?.() || {}) {
    const question = state.question || null;
    const histories = state.histories || question?.histories || [];
    const active = state.history || state.activeHistory || histories.find(item => item.id === state.historyId) || histories[0] || null;
    const nextBatchScope = `${String(state.questionId || question?.id || '')}\u0000${String(active?.id || '')}`;
    if (nextBatchScope !== batchScope) { batchScope = nextBatchScope; batchNotice = ''; }
    const activeDate = state.date ?? state.asOfYear;
    if (active && lastRenderedHistoryId && lastRenderedHistoryId !== String(active.id)) galleryExpanded = false;
    host.classList?.toggle('history-gallery-expanded',galleryExpanded);
    host.hidden = !state.questionId;
    tabs.replaceChildren(); timeline.replaceChildren(); suggestions.replaceChildren(); comparison.replaceChildren(); comparison.hidden = true; tabs.hidden = true;
    status.hidden = !!active || !state.questionId || !state.status;
    status.textContent = state.status || (state.loading ? 'Loading saved histories…' : '');
    if (!active) return;
    if (histories.length > 1) {
      tabs.hidden = false;
      const activeIndex = Math.max(0,histories.findIndex(item => String(item.id) === String(active.id)));
      const identity = timelineIdentity(active,histories);
      const summary = make(document,'div',null,'history-timeline-current');
      const primaryEvent = identity.distinguishing || identity.latest;
      const primaryName = primaryEvent?.title || 'No saved events yet';
      const year = primaryEvent ? `${labelYear(primaryEvent.year)} · ` : '';
      summary.append(make(document,'strong',primaryName,'history-timeline-current-title'),
        make(document,'span',`Timeline ${activeIndex + 1} of ${histories.length} · ${year}${identity.events.length} event${identity.events.length === 1 ? '' : 's'}`,'history-timeline-current-meta'));
      const compare = button(`Compare ${histories.length} timelines`,'compare-timelines','compare');
      compare.setAttribute('aria-expanded',String(comparisonOpen)); compare.setAttribute('aria-controls','history-timeline-comparison');
      tabs.append(summary,compare);
    }
    if (comparisonOpen && histories.length > 1) {
      galleryExpanded = false; host.classList?.remove('history-gallery-expanded');
      tabs.hidden = true; timeline.hidden = true; suggestions.hidden = true; comparison.hidden = false;
      comparison.replaceChildren();
      const heading = make(document,'h3',`Compare ${histories.length} timelines`); heading.id = 'history-timeline-comparison-title';
      const help = make(document,'p','Each timeline is a different version of this history. Events in one timeline happen together. Suggestions are not a new timeline unless you fork one.','history-timeline-comparison-help');
      const back = button('Back to timeline','back-to-timeline','back');
      const cards = make(document,'div',null,'history-timeline-comparison-cards');
      comparisonCards = cards;
      comparison.append(heading,help,back,cards); comparison.setAttribute('aria-labelledby',heading.id);
      histories.forEach((history,index) => {
        const identity = timelineIdentity(history,histories);
        const card = make(document,'article',null,'history-timeline-choice');
        const isCurrent = String(history.id) === String(active.id), primaryEvent = identity.distinguishing || identity.latest;
        card.setAttribute('aria-current',String(isCurrent));
        card.append(make(document,'h4',`Timeline ${index + 1}${isCurrent ? ' · Current' : ''}`));
        const choose = button('', 'choose-history', history.id, {historyId:history.id,historyIndex:String(index)});
        choose.className += ' history-timeline-choice-open';
        choose.setAttribute('aria-label',`Open timeline ${index + 1}${primaryEvent ? `: ${primaryEvent.title}, ${labelYear(primaryEvent.year)}` : ''}`);
        choose.setAttribute('aria-current',String(isCurrent));
        choose.append(make(document,'strong',primaryEvent?.title || 'No saved event title','history-timeline-choice-title'),
          make(document,'span',primaryEvent ? labelYear(primaryEvent.year) : 'Year not saved','history-timeline-choice-open-hint'));
        card.append(choose);
        const shared = identity.sharedPrefixLength
          ? `Shares ${identity.sharedPrefixLength} opening event${identity.sharedPrefixLength === 1 ? '' : 's'} through ${labelYear(identity.sharedThrough.year)}`
          : 'No shared opening event recorded';
        card.append(make(document,'p',`${identity.events.length} event${identity.events.length === 1 ? '' : 's'} · ${shared}`,'history-timeline-choice-meta'));
        if (identity.latest && identity.latest !== primaryEvent) card.append(make(document,'p',`Latest: ${labelYear(identity.latest.year)} · ${identity.latest.title}`,'history-timeline-choice-latest'));
        cards.append(card);
      });
      timeline.hidden = true; suggestions.hidden = true;
      if (comparisonHasFocus) findAction(comparison,comparisonFocusAction,comparisonFocusHistoryId)?.focus?.();
      return;
    }
    comparison.hidden = true; tabs.hidden = histories.length <= 1; timeline.hidden = false; suggestions.hidden = false;
    const causes = new Map(active.events.map(item => [item.id, item]));
    const selected = state.selectedEventId;
    const selectionChanged = String(active.id) !== lastRenderedHistoryId || String(selected ?? '') !== lastRenderedSelectionId;
    const wovenSuggestionIds = new Set((active.events || []).map(item=>String(item.id)));
    const timelineSuggestionCount = new Set([...(active.suggestions || []),...(state.suggestions || [])]
      .filter(item=>item?.id!=null&&!wovenSuggestionIds.has(String(item.id))).map(item => String(item.id))).size;
    if (timelineSuggestionCount) timeline.append(button(`View all suggestions · ${timelineSuggestionCount}`,'jump-suggestions','suggestions'));
    for (const era of erasFor(active.events)) {
      const eraKey = `${active.id}:${era.events[0]?.id || era.label}`;
      const details = make(document, 'details', null, 'history-era');
      if (selectionChanged && era.events.some(item => String(item.id) === String(selected))) openEras.set(eraKey,true);
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
    const wovenIds = wovenSuggestionIds;
    const selectedForScope = batchSelections.get(batchScope);
    if (selectedForScope) for (const id of wovenIds) selectedForScope.delete(String(id));
    const savedById = new Map();
    for (const item of active.suggestions || []) if (item?.id != null && !wovenIds.has(String(item.id))) savedById.set(String(item.id), item);
    for (const item of state.suggestions || []) if (item?.id != null && !wovenIds.has(String(item.id))) savedById.set(String(item.id), { ...savedById.get(String(item.id)), ...item });
    const savedSuggestions = [...savedById.values()].sort((a,b) => a.year - b.year || String(a.id).localeCompare(String(b.id)));
    let selectedSuggestionIds = batchSelections.get(batchScope);
    if (!selectedSuggestionIds) { selectedSuggestionIds = new Set(); batchSelections.set(batchScope, selectedSuggestionIds); }
    let seenSuggestionIds = seenBatchSuggestions.get(batchScope);
    if (!seenSuggestionIds) { seenSuggestionIds = new Set(); seenBatchSuggestions.set(batchScope, seenSuggestionIds); }
    for (const item of savedSuggestions) {
      const id = String(item.id);
      if (!seenSuggestionIds.has(id) && item.verdict === 'fits' && !item.conflictsWith) selectedSuggestionIds.add(id);
      seenSuggestionIds.add(id);
      if (item.verdict !== 'fits' || item.conflictsWith) selectedSuggestionIds.delete(id);
    }
    const heading = make(document, 'h3', `Saved suggestions · ${savedSuggestions.length}`);
    const subheading = make(document,'p',`Browse every saved suggestion in this timeline. The date remains ${dateText} until you move the timebar.`,'history-timeline-suggestions-context');
    suggestions.setAttribute('aria-label', `All ${savedSuggestions.length} saved suggestions in this timeline`); suggestions.append(heading,subheading);
    const controls = make(document, 'div', null, 'history-suggestion-controls');
    const autoLabel = make(document, 'label', null, 'history-auto-label');
    const autoToggle = make(document, 'input'); autoToggle.type = 'checkbox'; autoToggle.checked = state.autoSuggest !== false; autoToggle.dataset.autoSuggest = 'true';
    autoToggle.setAttribute('aria-label', 'Automatically suggest events after changing date');
    autoLabel.append(autoToggle, document.createTextNode(' Auto-suggest')); controls.append(autoLabel);
    if (!state.windowCached && !(state.suggestions || []).length) controls.append(button(state.autoSuggest === false ? `Suggest events around ${dateText}` : `Suggest events now around ${dateText}`, 'manual-suggest', 'current-window'));
    controls.queryAll?.('button').forEach(node => { node.disabled = !!state.loading || !!state.paused; });
    suggestions.append(controls);
    const batchBusy = state.busyIds?.has?.('weave-batch') || false;
    const selectedCount = selectedSuggestionIds.size;
    const tray = make(document,'div',null,'history-weave-tray');
    const selectAll = button('Select all','batch-select-all','batch-all');
    const selectNone = button('Select none','batch-select-none','batch-none');
    selectAll.disabled = !!state.loading || !!state.paused || !!batchBusy || selectedCount >= 32;
    selectNone.disabled = !!state.loading || !!state.paused || !!batchBusy || selectedCount === 0;
    tray.append(selectAll,selectNone);
    const weaveBatch = button(batchBusy ? 'Weaving…' : `Weave ${selectedCount} into history`,'weave-batch','batch-weave');
    weaveBatch.disabled = !!state.loading || !!state.paused || !!batchBusy || selectedCount === 0;
    tray.append(weaveBatch);
    if (state.windowCached) {
      const more = button(`More around ${dateText}`,'manual-more','current-window');
      more.disabled = !!state.loading || !!state.paused || !!batchBusy;
      tray.append(more);
    }
    if (batchNotice) tray.append(make(document,'span',batchNotice,'history-weave-tray-notice'));
    suggestions.append(tray);
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
    if (cachedWindows.size && !galleryExpanded) {
      const jumps = make(document, 'div', null, 'history-window-jumps');
      for (const item of [...cachedWindows.values()].sort((a,b) => a.window.fromYear - b.window.fromYear || a.window.toYear - b.window.toYear)) {
        const from = item.window.fromYear, to = item.window.toYear;
        const currentWindow = state.window?.fromYear === from && state.window?.toYear === to;
        const chip = button(`${currentWindow ? 'Current date · ' : ''}${item.count} · ${labelYear(from)} to ${labelYear(to)}`, 'suggest-window', `${from}:${to}`, { fromYear:String(from), toYear:String(to) });
        chip.setAttribute('aria-pressed','false'); chip.setAttribute('aria-current',currentWindow ? 'true' : 'false');
        chip.setAttribute('aria-label', `Jump to ${currentWindow ? 'current preparation window' : 'saved suggestions'}: ${item.count} for ${labelYear(from)} to ${labelYear(to)}`);
        if (currentWindow) chip.className += ' is-active-window';
        jumps.append(chip);
      }
      suggestions.append(jumps);
    }
    const visibleSuggestions = savedSuggestions;
    if (!visibleSuggestions.length) suggestions.append(make(document, 'p', savedSuggestions.length ? 'No saved suggestions in this window.' : state.status || (state.autoSuggest ? 'No saved suggestions yet.' : `Use “Suggest events around ${dateText}” to explore this timeline.`), 'history-session-status'));
    else if (state.status) suggestions.append(make(document, 'p', state.status, 'history-session-status'));
    const galleryActions = make(document,'div',null,'history-gallery-actions');
    const expandGallery = button(galleryExpanded ? 'Close expanded gallery' : 'Expand gallery','toggle-gallery','gallery');
    expandGallery.setAttribute('aria-expanded',String(galleryExpanded));
    expandGallery.setAttribute('aria-label',galleryExpanded ? 'Close expanded suggestion gallery' : 'Expand suggestions into a comparison board');
    galleryActions.append(expandGallery); suggestions.append(galleryActions);
    const groups = new Map();
    for (const item of cachedWindows.values()) groups.set(`${item.window.fromYear}:${item.window.toYear}`,{window:item.window,items:[]});
    for (const item of visibleSuggestions) {
      const key = item.window ? `${item.window.fromYear}:${item.window.toYear}` : 'unwindowed';
      if (!groups.has(key)) groups.set(key,{ window:item.window || null, items:[] });
      groups.get(key).items.push(item);
    }
    const orderedGroups = galleryExpanded ? [['all',{window:null,items:visibleSuggestions}]]
      : [...groups.entries()].sort((a,b) => (a[1].window?.fromYear ?? a[1].items[0]?.year ?? 0) - (b[1].window?.fromYear ?? b[1].items[0]?.year ?? 0));
    const groupList = make(document,'div',null,'history-timeline-suggestion-groups');
    for (const [,group] of orderedGroups) {
      const groupNode = make(document,'section',null,'history-timeline-suggestion-group');
      const groupWindow = group.window;
      const isCurrent = groupWindow && state.window?.fromYear === groupWindow.fromYear && state.window?.toYear === groupWindow.toYear;
      groupNode.dataset.windowKey = groupWindow ? `${groupWindow.fromYear}:${groupWindow.toYear}` : 'unwindowed';
      groupNode.tabIndex = -1;
      const groupTitle = galleryExpanded ? 'All saved suggestions · oldest first' : groupWindow ? `${labelYear(groupWindow.fromYear)} to ${labelYear(groupWindow.toYear)}${isCurrent ? ' · Current date window' : ''}` : 'Other saved suggestions';
      groupNode.append(make(document,'h4',groupTitle,'history-timeline-suggestion-group-title'));
      if (!group.items.length) groupNode.append(make(document,'p','No saved suggestions in this window yet.','history-session-status'));
      for (const item of group.items) {
        const card = make(document, 'article', null, 'history-timeline-suggestion'); card.dataset.suggestionId = item.id;
        const sceneStatus = [item.sceneRef?.status,item.heroRef?.status].find(status => ['queued','pending','unknown','empty'].includes(status));
        const imageUrl = [item.sceneRef,item.heroRef].map(ref => typeof ref === 'string' ? ref : ref?.url).find(url => typeof url === 'string' && url.startsWith('/') && !url.startsWith('//'));
        if (imageUrl) { const image = make(document,'img',null,'history-timeline-suggestion-image'); image.src = imageUrl; image.alt = ''; image.loading = 'lazy'; card.append(image); }
        else card.append(make(document,'span',sceneStatus === 'pending' || sceneStatus === 'queued' ? 'Image preparing' : sceneStatus === 'unknown' ? 'Image status uncertain' : 'No saved image','history-timeline-suggestion-image-placeholder'));
        const content = make(document,'div',null,'history-timeline-suggestion-content');
        const batchChoice = make(document,'input'); batchChoice.type = 'checkbox'; batchChoice.dataset.batchSuggestion = String(item.id);
        batchChoice.checked = selectedSuggestionIds.has(String(item.id));
        batchChoice.disabled = item.verdict !== 'fits' || !!item.conflictsWith || !!state.loading || !!state.paused || batchBusy;
        batchChoice.setAttribute('aria-label',`Select ${item.title || 'untitled possibility'} for batch weave`);
        content.append(batchChoice);
        const currentDateWindow = item.window?.fromYear === state.window?.fromYear && item.window?.toYear === state.window?.toYear;
        const windowText = galleryExpanded ? currentDateWindow ? ' · Current date window' : ''
          : item.window ? ` · ${labelYear(item.window.fromYear)}–${labelYear(item.window.toYear)}${currentDateWindow ? ' · Current date window' : ''}` : '';
        content.append(make(document, 'div', `${labelYear(item.year)} · ${item.verdict === 'conflicts' ? 'Conflicts' : 'Fits'}${windowText}`, `history-verdict ${item.verdict === 'conflicts' ? 'conflicts' : 'fits'}`));
        const title = button(item.id === state.selectedEventId ? `Selected · ${item.title || 'Untitled possibility'}` : item.title || 'Untitled possibility','select-suggestion',item.id);
        title.className += ' history-timeline-suggestion-title'; title.setAttribute('aria-pressed',String(item.id === state.selectedEventId));
        title.setAttribute('aria-label',`${item.id === state.selectedEventId ? 'Selected suggestion' : 'Inspect suggestion'}: ${item.title || 'Untitled possibility'}, ${labelYear(item.year)}`);
        content.append(title,make(document, 'p', item.summary || ''));
        const reason = typeof item.reason === 'string' ? item.reason.trim() : '';
        if (reason && !/^migrated from (?:an )?earlier exploration\.?$/i.test(reason)) content.append(make(document, 'p', reason, 'history-suggestion-reason'));
        const actions = make(document,'div',null,'history-timeline-suggestion-actions');
        if (item.id === state.selectedEventId) actions.append(make(document,'span','Selected','history-timeline-suggestion-selected'));
        if (item.verdict === 'conflicts') actions.append(button('What if instead…', 'fork-suggestion', item.id));
        else actions.append(button('Weave into history', 'weave', item.id));
        content.append(actions); card.append(content); groupNode.append(card);
      }
      groupList.append(groupNode);
    }
    if (orderedGroups.length) suggestions.append(groupList);
    if (selectionChanged) {
      const selectedEra = timeline.queryAll?.('details').find(details => details.queryAll?.('button').some(button => button.dataset.action === 'select-event' && button.dataset.id === state.selectedEventId));
      if (selectedEra) {
        selectedEra.open = true;
        const row = selectedEra.queryAll?.('li').find(item => item.dataset.eventId === state.selectedEventId);
        row?.scrollIntoView?.({block:'nearest'});
      } else {
        const card = suggestions.queryAll?.('article').find(item => item.dataset.suggestionId === state.selectedEventId);
        card?.scrollIntoView?.({block:'nearest'});
      }
      lastRenderedSelectionId = String(state.selectedEventId ?? '');
      lastRenderedHistoryId = String(active.id);
    }
  }
  const unsubscribe = subscribe?.(render);
  render();
  return { element: host, render, destroy() { unsubscribe?.(); root.replaceChildren(); } };
}

export { erasFor as groupHistoryEras, historyForkYear };
