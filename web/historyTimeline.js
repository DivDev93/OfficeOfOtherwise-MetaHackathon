import { deriveEras } from './historyModel.js';
import { projectBatchPlan } from './historyBatch.js';

const labelYear = year => `${Math.abs(year).toLocaleString()} ${year < 0 ? 'BCE' : 'CE'}`;
const isEmptyHistoryBoilerplateReason = reason => /\b(?:the )?(?:supplied )?history (?:contains|has|includes) no (?:prior |existing )?events\b|\bno (?:prior|existing|canonical|saved) events\b|\bthere (?:are|were) no (?:prior |existing )?events\b|\bempty history\b/i.test(reason);
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
  const batchPreview = make(document,'section',null,'history-batch-preview'); batchPreview.hidden = true;
  batchPreview.id = 'history-batch-preview';
  batchPreview.tabIndex = -1; batchPreview.setAttribute('role','dialog'); batchPreview.setAttribute('aria-modal','true'); batchPreview.setAttribute('aria-label','Preview selected suggestions before weaving');
  const comparison = make(document, 'section', null, 'history-timeline-comparison'); comparison.hidden = true;
  comparison.setAttribute('aria-label','Compare saved timelines');
  host.append(tabs, timeline, suggestions, batchPreview, comparison, status);
  const openEras = new Map();
  const suggestionDetailOpen = new Map();
  const batchSelections = new Map();
  const seenBatchSuggestions = new Map();
  let batchScope = '', batchNotice = '';
  const batchPreviewState = { open:false, loading:false, error:'', plan:null, scope:'', selectionKey:'', selectedIds:[], acceptedMergeIds:new Set(), excludedSuggestionIds:new Set(), focusAction:'batch-cancel', focusId:'', requestId:0 };
  let galleryExpanded = false, lastRenderedHistoryId = '', lastRenderedSelectionId = '';
  const suggestionDetailKey = (historyId,suggestionId) => `${String(historyId || '')}:${String(suggestionId || '')}`;
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
    else if (node.dataset.action === 'retry-ripple-batch') {
      await session?.retryRippleBatch?.(JSON.parse(node.dataset.eventIds || '[]'),JSON.parse(node.dataset.wovenEventIds || '[]'));
    }
    else if (node.dataset.action === 'select-event') onEventSelect(node.dataset.id);
    else if (node.dataset.action === 'select-suggestion') onEventSelect(node.dataset.id);
    else if (node.dataset.action === 'remove-pending-event') await session?.removePendingEvent?.(node.dataset.batchId,node.dataset.id);
    else if (node.dataset.action === 'finalize-pending-batch') await session?.finalizePendingBatch?.(node.dataset.id);
  });
  suggestions.addEventListener('click', async event => {
    if (event.target?.dataset?.batchSuggestion) return;
    if (event.target.closest?.('details.history-suggestion-details')?.tagName?.toLowerCase() === 'details') return;
    const node = event.target.closest?.('button[data-action]');
    if (!node) {
      const card = event.target.closest?.('article.history-timeline-suggestion');
      if (card?.dataset.suggestionId) inspectSuggestion(card.dataset.suggestionId);
      return;
    }
    if (node.dataset.action === 'select-suggestion') inspectSuggestion(node.dataset.id);
    else if (node.dataset.action === 'toggle-suggestion-details') {
      const card = node.closest?.('article.history-timeline-suggestion');
      const nativeCandidates = card?.querySelectorAll?.('[data-suggestion-details]');
      const candidates = [...(nativeCandidates?.length ? nativeCandidates : card?.queryAll?.('div') || [])];
      const panel = candidates.find(item => item.dataset?.suggestionDetails === node.dataset.id);
      if (panel) {
        const open = node.getAttribute('aria-expanded') !== 'true';
        panel.hidden = !open; node.setAttribute('aria-expanded',String(open));
        node.setAttribute('aria-label',`${open ? 'Hide' : 'Show'} summary and reason for ${node.dataset.title || 'suggestion'}`);
        suggestionDetailOpen.set(suggestionDetailKey(node.dataset.historyId,node.dataset.id),open);
      }
    }
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
      const eligible = [...(suggestions.querySelectorAll?.('input[data-batch-suggestion]') || suggestions.queryAll?.('input') || [])]
        .filter(input => input.dataset?.batchSuggestion && !input.disabled);
      for (const [index,input] of eligible.entries()) {
        input.checked = node.dataset.action === 'batch-select-all' && index < 32;
        if (input.checked) selected.add(input.dataset.batchSuggestion); else selected.delete(input.dataset.batchSuggestion);
      }
      batchSelections.set(batchScope, selected); batchNotice = node.dataset.action === 'batch-select-all' && eligible.length > 32 ? 'Select up to 32 suggestions to weave at once.' : '';
      render(getState?.() || {});
    }
    else if (node.dataset.action === 'batch-preview') await openBatchPreview();
  });
  suggestions.addEventListener('change', event => {
    const target = event.target;
    if (target?.dataset?.autoSuggest === 'true') session?.setAutoSuggest?.(target.checked);
    else if (target?.dataset?.autoWeave === 'true') session?.setAutoWeave?.(target.checked);
    else if (target?.dataset?.batchSuggestion) {
      const selected = batchSelections.get(batchScope) || new Set();
      if (target.checked && selected.size >= 32) { target.checked = false; batchNotice = 'Select up to 32 suggestions to weave at once.'; }
      else { if (target.checked) selected.add(target.dataset.batchSuggestion); else selected.delete(target.dataset.batchSuggestion); batchNotice = ''; }
      batchSelections.set(batchScope, selected); render(getState?.() || {});
    }
  });
  batchPreview.addEventListener('click', async event => {
    const node = event.target.closest?.('button[data-action]'); if (!node) return;
    if (node.dataset.action === 'batch-cancel') { closeBatchPreview(); return; }
    if (node.dataset.action === 'batch-retry') {
      const retryOf = session?.getState?.().batchCheckUncertain?.retryOf || '';
      await openBatchPreview(retryOf); return;
    }
    if (node.dataset.action === 'batch-preview-cause') { onEventSelect(node.dataset.id); return; }
    if (node.dataset.action === 'batch-merge-toggle') {
      if (batchPreviewState.acceptedMergeIds.has(node.dataset.id)) batchPreviewState.acceptedMergeIds.delete(node.dataset.id);
      else {
        const merge = (batchPreviewState.plan?.merges || []).find(item => String(item.id) === String(node.dataset.id));
        const members = new Set((merge?.suggestionIds || []).map(String));
        for (const other of batchPreviewState.plan?.merges || []) if (other.id !== merge?.id
          && other.suggestionIds?.some(id => members.has(String(id)))) batchPreviewState.acceptedMergeIds.delete(String(other.id));
        batchPreviewState.acceptedMergeIds.add(node.dataset.id);
      }
      batchPreviewState.focusAction = node.dataset.action; batchPreviewState.focusId = node.dataset.id; batchPreviewState.focusPending = true;
      render(getState?.() || {}); return;
    }
    if (node.dataset.action === 'batch-commit') { await commitBatchPreview(); return; }
  });
  batchPreview.addEventListener('change', event => {
    const target = event.target;
    if (target?.dataset?.previewExclude) {
      if (target.checked) batchPreviewState.excludedSuggestionIds.add(target.dataset.previewExclude);
      else batchPreviewState.excludedSuggestionIds.delete(target.dataset.previewExclude);
      if (target.checked) for (const merge of batchPreviewState.plan?.merges || []) {
        if (merge.suggestionIds?.some(id => String(id) === target.dataset.previewExclude)) batchPreviewState.acceptedMergeIds.delete(String(merge.id));
      }
      batchPreviewState.focusAction = 'batch-exclude'; batchPreviewState.focusId = target.dataset.previewExclude; batchPreviewState.focusPending = true;
      batchPreviewState.error = ''; render(getState?.() || {});
    }
  });
  batchPreview.addEventListener('keydown', event => {
    if (event.key === 'Escape') { event.preventDefault?.(); if (batchPreviewState.operation !== 'commit') closeBatchPreview(); }
  });

  async function openBatchPreview(retryOf = '') {
    const selectedIds = [...(batchSelections.get(batchScope) || [])].sort();
    if (!selectedIds.length || selectedIds.length > 32 || batchPreviewState.loading) return;
    const requestId = ++batchPreviewState.requestId, scope = batchScope;
    batchPreviewState.open = true; batchPreviewState.loading = true; batchPreviewState.operation = 'check'; batchPreviewState.error = '';
    batchPreviewState.plan = null; batchPreviewState.scope = scope; batchPreviewState.selectedIds = selectedIds;
    batchPreviewState.retryOf = retryOf;
    batchPreviewState.selectionKey = `${scope}\u0000${selectedIds.join('\u0000')}`;
    batchPreviewState.acceptedMergeIds = new Set(); batchPreviewState.excludedSuggestionIds = new Set();
    batchPreviewState.focusAction = 'batch-cancel'; batchPreviewState.focusId = ''; batchPreviewState.focusPending = true;
    portalBatchPreview(true);
    render(getState?.() || {});
    const plan = await session?.checkWeaveBatch?.(selectedIds,retryOf ? {retryOf} : {});
    const currentIds = [...(batchSelections.get(batchScope) || [])].sort();
    const currentKey = `${batchScope}\u0000${currentIds.join('\u0000')}`;
    if (requestId !== batchPreviewState.requestId || scope !== batchScope || currentKey !== batchPreviewState.selectionKey) return;
    batchPreviewState.loading = false; batchPreviewState.operation = '';
    if (plan) { batchPreviewState.plan = plan; batchPreviewState.retryOf = ''; }
    else {
      const sessionState = session?.getState?.() || {}, uncertain = sessionState.batchCheckUncertain;
      batchPreviewState.retryOf = uncertain?.retryOf || '';
      batchPreviewState.error = `${sessionState.status || 'Could not prepare this preview.'}${uncertain?.possibleCharge ? ' A previous check may have incurred a charge; use Retry batch check to reconcile it.' : ''}`;
    }
    render(getState?.() || {});
  }
  function closeBatchPreview() {
    if (!batchPreviewState.open) return;
    batchPreviewState.requestId++;
    batchPreviewState.open = false; batchPreviewState.loading = false; batchPreviewState.operation = '';
    batchPreviewState.plan = null; batchPreviewState.error = '';
    portalBatchPreview(false);
    render(getState?.() || {});
    findAction(suggestions,'batch-preview')?.focus?.({preventScroll:true});
  }
  async function commitBatchPreview() {
    const plan = batchPreviewState.plan;
    if (!plan || batchPreviewState.loading) return;
    const acceptedMergeIds = [...batchPreviewState.acceptedMergeIds];
    const excludedSuggestionIds = [...batchPreviewState.excludedSuggestionIds];
    const projection = projectBatchPlan(plan,{acceptedMergeIds,excludedSuggestionIds});
    if (projection.unresolvedConflicts?.length) {
      batchPreviewState.error = 'Resolve each conflict by excluding one of its suggestions before weaving.';
      render(getState?.() || {}); return;
    }
    batchPreviewState.loading = true; batchPreviewState.operation = 'commit'; batchPreviewState.error = '';
    render(getState?.() || {});
    const result = await session?.commitWeaveBatch?.({ suggestionIds:batchPreviewState.selectedIds, planId:plan.id, acceptedMergeIds, excludedSuggestionIds });
    if (result) {
      const scope = batchPreviewState.scope;
      for (const id of batchPreviewState.selectedIds) batchSelections.get(scope)?.delete(id);
      batchPreviewState.open = false; batchPreviewState.loading = false; batchPreviewState.operation = ''; batchPreviewState.plan = null;
      portalBatchPreview(false);
      render(getState?.() || {}); suggestions.focus?.({preventScroll:true});
    } else {
      batchPreviewState.loading = false; batchPreviewState.operation = '';
      batchPreviewState.error = session?.getState?.().status || 'Could not weave this preview. Review the history and retry.';
      render(getState?.() || {});
    }
  }
  function portalBatchPreview(open) {
    if (open && document.body && batchPreview.parentNode !== document.body) document.body.append(batchPreview);
    else if (!open && batchPreview.parentNode && batchPreview.parentNode !== host) host.insertBefore(batchPreview,comparison);
  }
  function renderBatchPreview(state, active) {
    batchPreview.setAttribute('aria-busy',String(batchPreviewState.loading));
    const plan = batchPreviewState.plan;
    const heading = make(document,'h3',plan ? `Preview ${batchPreviewState.selectedIds.length} selected suggestions` : 'Prepare selected suggestions');
    heading.id = 'history-batch-preview-title';
    const cancel = button('Cancel','batch-cancel','cancel'); cancel.disabled = batchPreviewState.operation === 'commit';
    const panelHeader = make(document,'header',null,'history-batch-preview-header'); panelHeader.append(heading,cancel);
    const body = make(document,'div',null,'history-batch-preview-body');
    batchPreview.append(panelHeader,body); batchPreview.setAttribute('aria-labelledby',heading.id);
    if (batchPreviewState.loading) {
      const progress=make(document,'p',batchPreviewState.operation === 'commit' ? 'Saving the planned changes…' : 'Checking the selected possibilities…','history-batch-preview-progress');
      progress.setAttribute('role','status'); body.append(progress);
    }
    if (batchPreviewState.error) {
      const error = make(document,'p',batchPreviewState.error,'history-batch-preview-error'); error.setAttribute('role','alert'); body.append(error);
    }
    if (!plan) {
      if (!batchPreviewState.loading) body.append(button(batchPreviewState.retryOf ? 'Retry batch check' : 'Retry check','batch-retry','retry'));
      if (batchPreviewState.focusPending) { focusBatchPreviewAction(); }
      return;
    }
    const acceptedMergeIds = [...batchPreviewState.acceptedMergeIds];
    const excludedSuggestionIds = [...batchPreviewState.excludedSuggestionIds];
    const projection = projectBatchPlan(plan,{acceptedMergeIds,excludedSuggestionIds});
    const merges = plan.merges || [], conflicts = plan.conflicts || [];
    const summary = make(document,'p',`${projection.events.length} resulting events · ${acceptedMergeIds.length} accepted merge${acceptedMergeIds.length === 1 ? '' : 's'} · ${projection.unresolvedConflicts?.length || 0} unresolved conflict${(projection.unresolvedConflicts?.length || 0) === 1 ? '' : 's'}`,'history-batch-preview-summary');
    body.append(summary);
    const historyEvents = new Map((active.events || []).map(item => [String(item.id),item]));
    const chainEvents = new Map((plan.chain || []).map(item => [String(item.id),item]));
    const projectedEvents = new Map((projection.events || []).map(item => [String(item.id),item]));
    const question = state.question || state.questions?.find(item => String(item.id) === String(plan.questionId));
    const questionId = String(state.questionId || question?.id || plan.questionId || '');
    const list = make(document,'ol',null,'history-batch-preview-chain');
    for (const item of projection.events || []) {
      const row = make(document,'li',null,'history-batch-preview-event');
      row.dataset.eventId = String(item.id);
      const eventHead = make(document,'div',null,'history-batch-preview-event-head');
      eventHead.append(make(document,'div',`${item.year ? labelYear(item.year) : 'Year not saved'} · ${item.title || 'Untitled event'}`,'history-batch-preview-event-title'));
      if (item.summary) {
        const summaryDetails = make(document,'details',null,'history-batch-preview-event-summary');
        summaryDetails.append(make(document,'summary','Summary'),make(document,'p',item.summary)); eventHead.append(summaryDetails);
      }
      row.append(eventHead);
      const causeId = item.causeEventId;
      if (causeId) {
        const cause = projectedEvents.get(String(causeId)) || chainEvents.get(String(causeId)) || historyEvents.get(String(causeId));
        if (String(causeId) === questionId) row.append(make(document,'span',`because ← ${question?.title || question?.question || 'Starting question'}`,'history-batch-preview-cause-root'));
        else if (cause) row.append(button(`because ← ${cause.title || 'Untitled event'} · ${labelYear(cause.year)}`,'batch-preview-cause',causeId));
        else row.append(make(document,'span','because ← Earlier event','history-batch-preview-cause-root'));
      }
      list.append(row);
    }
    body.append(list);
    if (merges.length) {
      const mergeSection = make(document,'section',null,'history-batch-preview-merges');
      mergeSection.append(make(document,'h4','Proposed merges'));
      for (const merge of merges) {
        const accepted = batchPreviewState.acceptedMergeIds.has(String(merge.id));
        const memberTitles = (merge.suggestionIds || []).map(id => chainEvents.get(String(id))?.title || String(id)).join(' + ');
        const row = make(document,'article',null,'history-batch-preview-merge');
        const mergeHead = make(document,'div',null,'history-batch-preview-merge-head');
        mergeHead.append(make(document,'h5',merge.title || memberTitles || 'Combined event'));
        if (merge.summary) {
          const summaryDetails=make(document,'details',null,'history-batch-preview-merge-summary');
          summaryDetails.append(make(document,'summary','Summary'),make(document,'p',merge.summary)); mergeHead.append(summaryDetails);
        }
        const toggle = button(accepted ? 'Keep separate' : 'Accept merge','batch-merge-toggle',String(merge.id));
        toggle.setAttribute('aria-pressed',String(accepted)); mergeHead.append(toggle); row.append(mergeHead);
        mergeSection.append(row);
      }
      body.append(mergeSection);
    }
    if (conflicts.length) {
      const conflictSection = make(document,'section',null,'history-batch-preview-conflicts');
      conflictSection.append(make(document,'h4',`Conflicts · ${projection.unresolvedConflicts?.length || 0} unresolved`));
      const affected = new Set();
      for (const conflict of conflicts) {
        affected.add(String(conflict.suggestionId));
        if (chainEvents.has(String(conflict.conflictsWith))) affected.add(String(conflict.conflictsWith));
        const suggestion = chainEvents.get(String(conflict.suggestionId));
        const other = chainEvents.get(String(conflict.conflictsWith)) || historyEvents.get(String(conflict.conflictsWith));
        conflictSection.append(make(document,'p',`${suggestion?.title || conflict.suggestionId} conflicts with ${other?.title || conflict.conflictsWith || 'another event'}${conflict.reason ? ` · ${conflict.reason}` : ''}`,'history-batch-preview-conflict'));
      }
      for (const id of affected) {
        const suggestion = chainEvents.get(id);
        const label = make(document,'label',null,'history-batch-preview-exclude');
        const checkbox = make(document,'input'); checkbox.type = 'checkbox'; checkbox.dataset.previewExclude = id;
        checkbox.checked = batchPreviewState.excludedSuggestionIds.has(id);
        checkbox.setAttribute('aria-label',`Exclude ${suggestion?.title || id} from this weave`);
        label.append(checkbox,document.createTextNode(` Exclude ${suggestion?.title || id}`)); conflictSection.append(label);
      }
      body.append(conflictSection);
    }
    if (projection.unresolvedConflicts?.length) {
      const unresolved = make(document,'p','Unresolved conflicts must be removed from the preview before weaving.','history-batch-preview-unresolved');
      unresolved.setAttribute('role','status'); body.append(unresolved);
    }
    const busy = batchPreviewState.loading || state.busyIds?.has?.('weave-batch');
    const commit = button(busy ? 'Weaving…' : `Weave ${projection.events.length} events into history`,'batch-commit','commit');
    commit.disabled = !!busy || !!projection.unresolvedConflicts?.length;
    batchPreview.append(commit);
    if (batchPreviewState.focusPending) focusBatchPreviewAction();
  }
  function focusBatchPreviewAction() {
    let target = null;
    if (batchPreviewState.focusAction === 'batch-exclude') {
      target = [...(batchPreview.querySelectorAll?.('input[data-preview-exclude]') || batchPreview.queryAll?.('input') || [])]
        .find(input => input.dataset?.previewExclude === batchPreviewState.focusId);
    } else target = findAction(batchPreview,batchPreviewState.focusAction,batchPreviewState.focusId);
    target?.focus?.({preventScroll:true}); batchPreviewState.focusPending = false;
  }

  function render(state = getState?.() || {}) {
    const focusedPreviewNode = batchPreview.contains?.(document.activeElement) ? document.activeElement : null;
    if (focusedPreviewNode) {
      batchPreviewState.focusAction = focusedPreviewNode.dataset?.previewExclude ? 'batch-exclude' : focusedPreviewNode.dataset?.action || batchPreviewState.focusAction;
      batchPreviewState.focusId = focusedPreviewNode.dataset?.previewExclude || focusedPreviewNode.dataset?.id || batchPreviewState.focusId;
      batchPreviewState.focusPending = true;
    }
    const question = state.question || null;
    const histories = state.histories || question?.histories || [];
    const active = state.history || state.activeHistory || histories.find(item => item.id === state.historyId) || histories[0] || null;
    for (const details of suggestions.queryAll?.('details') || []) {
      if (details.className?.split?.(/\s+/).includes('history-suggestion-details') && details.open) {
        suggestionDetailOpen.set(suggestionDetailKey(details.dataset.historyId,details.dataset.suggestionId),true);
      }
    }
    const nextBatchScope = `${String(state.questionId || question?.id || '')}\u0000${String(active?.id || '')}`;
    if (nextBatchScope !== batchScope) { batchScope = nextBatchScope; batchNotice = ''; }
    if (batchPreviewState.open && batchPreviewState.scope !== nextBatchScope) {
      batchPreviewState.requestId++; batchPreviewState.open = false; batchPreviewState.loading = false; batchPreviewState.operation = '';
      batchPreviewState.plan = null; batchPreviewState.error = '';
      portalBatchPreview(false);
    }
    const activeDate = state.date ?? state.asOfYear;
    if (active && lastRenderedHistoryId && lastRenderedHistoryId !== String(active.id)) galleryExpanded = false;
    host.classList?.toggle('history-gallery-expanded',galleryExpanded);
    host.hidden = !state.questionId;
    tabs.replaceChildren(); timeline.replaceChildren(); suggestions.replaceChildren(); batchPreview.replaceChildren(); batchPreview.hidden = true; comparison.replaceChildren(); comparison.hidden = true; tabs.hidden = true;
    status.hidden = !!active || !state.questionId || !state.status;
    status.textContent = state.status || (state.loading ? 'Loading saved histories…' : '');
    if (!active) return;
    if (batchPreviewState.open) {
      tabs.hidden = true; timeline.hidden = true; suggestions.hidden = true; batchPreview.hidden = false;
      renderBatchPreview(state, active);
      return;
    }
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
    const retryableRippleFlags = (active.events || []).flatMap(item => (item.checkFlags || [])
      .filter(flag => flag?.kind === 'weave-ripple' && ['pending','unavailable','unknown'].includes(flag.status) && flag.wovenEventId)
      .map(flag => ({eventId:String(item.id),wovenEventId:String(flag.wovenEventId)})));
    if (retryableRippleFlags.length) {
      const eventIds = [...new Set(retryableRippleFlags.map(item => item.eventId))];
      const wovenEventIds = [...new Set(retryableRippleFlags.map(item => item.wovenEventId))];
      const retryBatch = button(state.busyIds?.has?.('ripple-check-batch') ? `Re-checking ${retryableRippleFlags.length} ripple flags…` : `Retry combined re-check · ${retryableRippleFlags.length}`,
        'retry-ripple-batch','retry-ripple-batch',{eventIds:JSON.stringify(eventIds),wovenEventIds:JSON.stringify(wovenEventIds)});
      retryBatch.disabled = !!state.busyIds?.size;
      timeline.append(retryBatch);
    }
    const pendingEvents = (active.events || []).filter(item => item.pending === true && item.pendingBatchId);
    const pendingBatches = new Map();
    for (const item of pendingEvents) {
      const key = String(item.pendingBatchId), current = pendingBatches.get(key) || [];
      current.push(item); pendingBatches.set(key,current);
    }
    for (const [batchId,events] of pendingBatches) {
      const keepAll = button(`Keep all pending · ${events.length}`,'finalize-pending-batch',batchId);
      keepAll.setAttribute('aria-label',`Keep all ${events.length} pending event${events.length === 1 ? '' : 's'}`);
      keepAll.disabled = !!state.autoWeaveRunning || !!state.busyIds?.has?.('weave-batch') || !!state.busyIds?.has?.(`pending-finalize:${batchId}`);
      timeline.append(keepAll);
    }
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
        if (item.pending === true) { row.dataset.pending = 'true'; row.className += ' history-event-pending'; }
        if (item.id === selected) row.dataset.selected = 'true';
        const select = button(`${labelYear(item.year)} · ${item.title}`, 'select-event', item.id); select.setAttribute('aria-current', String(item.id === selected));
        row.append(select);
        if (item.pending === true) {
          const pendingWindows = [...new Map((item.pendingWindows || []).filter(window => Number.isSafeInteger(window.fromYear) && Number.isSafeInteger(window.toYear))
            .map(window => [`${window.fromYear}:${window.toYear}`,window])).values()];
          const windowLabels = pendingWindows.map(window => `${labelYear(window.fromYear)} to ${labelYear(window.toYear)}`);
          const pendingTag = make(document,'span',`Pending · Auto-weave${windowLabels.length ? ` · ${windowLabels.join(', ')}` : ''}`,'history-event-pending-tag');
          if (windowLabels.length) pendingTag.setAttribute('title',`Pending for ${windowLabels.join('; ')}`);
          row.append(pendingTag);
        }
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
        if (item.pending === true && item.pendingBatchId) {
          const removePending = button('Remove','remove-pending-event',item.id,{batchId:String(item.pendingBatchId)});
          removePending.setAttribute('aria-label',`Remove pending event ${item.title || ''}`.trim());
          removePending.disabled = !!state.autoWeaveRunning || !!state.busyIds?.has?.('weave-batch')
            || !!state.busyIds?.has?.(`pending-remove:${item.pendingBatchId}:${item.id}`)
            || !!state.busyIds?.has?.(`pending-finalize:${item.pendingBatchId}`);
          row.append(removePending);
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
    const startingPoints = !active.events.length;
    const heading = make(document, 'h3', `${startingPoints ? 'Starting points' : 'Saved suggestions'} · ${savedSuggestions.length}`);
    const subheading = make(document,'p',`Browse every saved suggestion in this timeline. The date remains ${dateText} until you move the timebar.`,'history-timeline-suggestions-context');
    suggestions.setAttribute('aria-label', startingPoints ? `Starting points · ${savedSuggestions.length} in this timeline` : `All ${savedSuggestions.length} saved suggestions in this timeline`); suggestions.append(heading,subheading);
    const controls = make(document, 'div', null, 'history-suggestion-controls');
    const autoLabel = make(document, 'label', null, 'history-auto-label');
    const autoToggle = make(document, 'input'); autoToggle.type = 'checkbox'; autoToggle.checked = state.autoSuggest !== false; autoToggle.dataset.autoSuggest = 'true';
    autoToggle.setAttribute('aria-label', 'Automatically suggest events after changing date');
    autoLabel.append(autoToggle, document.createTextNode(' Auto-suggest')); controls.append(autoLabel);
    const autoWeaveLabel = make(document,'label',null,'history-auto-label');
    const autoWeaveToggle = make(document,'input'); autoWeaveToggle.type = 'checkbox'; autoWeaveToggle.checked = state.autoWeave === true; autoWeaveToggle.dataset.autoWeave = 'true';
    autoWeaveToggle.setAttribute('aria-label','Automatically weave new fitting suggestions after they are checked');
    autoWeaveLabel.append(autoWeaveToggle,document.createTextNode(' Auto-weave')); controls.append(autoWeaveLabel);
    if (!state.windowCached && !(state.suggestions || []).length) controls.append(button(state.autoSuggest === false ? `Suggest events around ${dateText}` : `Suggest events now around ${dateText}`, 'manual-suggest', 'current-window'));
    controls.queryAll?.('button').forEach(node => { node.disabled = !!state.loading || !!state.paused; });
    suggestions.append(controls);
    const batchBusy = (state.busyIds?.size || 0) > 0;
    const batchChecking = state.busyIds?.has?.('batch-check') || false;
    const batchWeaving = state.busyIds?.has?.('weave-batch') || false;
    const selectedCount = selectedSuggestionIds.size;
    const tray = make(document,'div',null,'history-weave-tray');
    const selectAll = button('Select all','batch-select-all','batch-all');
    const selectNone = button('Select none','batch-select-none','batch-none');
    selectAll.disabled = !!state.loading || !!state.paused || !!batchBusy || selectedCount >= 32;
    selectNone.disabled = !!state.loading || !!state.paused || !!batchBusy || selectedCount === 0;
    tray.append(selectAll,selectNone);
    const weaveBatch = button(batchChecking ? 'Checking…' : batchWeaving ? 'Weaving…' : `Weave ${selectedCount} into history`,'batch-preview','batch-weave');
    weaveBatch.setAttribute('aria-controls',batchPreview.id); weaveBatch.setAttribute('aria-expanded',String(batchPreviewState.open));
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
    if (startingPoints) groupList.setAttribute('aria-label','Starting points');
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
        const head = make(document,'div',null,'history-timeline-suggestion-head');
        const main = make(document,'div',null,'history-timeline-suggestion-main');
        const tools = make(document,'div',null,'history-timeline-suggestion-tools');
        const status = make(document,'div',null,'history-timeline-suggestion-status');
        const actions = make(document,'div',null,'history-timeline-suggestion-actions');
        const startingPoint = !active.events.length;
        main.append(make(document,'span',labelYear(item.year),'history-timeline-suggestion-year'));
        const title = button(item.id === state.selectedEventId ? `Selected · ${item.title || 'Untitled possibility'}` : item.title || 'Untitled possibility','select-suggestion',item.id);
        title.className += ' history-timeline-suggestion-title'; title.setAttribute('aria-pressed',String(item.id === state.selectedEventId));
        title.setAttribute('aria-label',`${item.id === state.selectedEventId ? 'Selected suggestion' : 'Inspect suggestion'}: ${item.title || 'Untitled possibility'}, ${labelYear(item.year)}`);
        main.append(title);
        status.append(batchChoice);
        if (!startingPoint) {
          const verdict = make(document,'span',null,`history-verdict-dot ${item.verdict === 'conflicts' ? 'conflicts' : 'fits'}`);
          verdict.setAttribute('aria-label',item.verdict === 'conflicts' ? 'Conflicts with this history' : 'Fits this history');
          verdict.setAttribute('title',item.verdict === 'conflicts' ? 'Conflicts with this history' : 'Fits this history');
          status.append(verdict);
        }
        const reason = typeof item.reason === 'string' ? item.reason.trim() : '';
        const meaningfulReason = reason && !/^migrated from (?:an )?earlier exploration\.?$/i.test(reason)
          && !(startingPoint && isEmptyHistoryBoilerplateReason(reason));
        const detailKey = suggestionDetailKey(active.id,item.id);
        const detailsOpen = suggestionDetailOpen.get(detailKey) === true;
        const detailsButton = button('Details','toggle-suggestion-details',item.id,{historyId:String(active.id),title:item.title || 'untitled possibility'});
        detailsButton.setAttribute('aria-expanded',String(detailsOpen));
        detailsButton.setAttribute('aria-label',`${detailsOpen ? 'Hide' : 'Show'} summary and reason for ${item.title || 'untitled possibility'}`);
        const detailPanel = make(document,'div',null,'history-timeline-suggestion-details-body');
        detailPanel.dataset.suggestionDetails = String(item.id);
        detailPanel.hidden = !detailsOpen;
        detailPanel.id = `history-suggestion-details-${encodeURIComponent(String(active.id))}-${encodeURIComponent(String(item.id))}`;
        detailsButton.setAttribute('aria-controls',detailPanel.id);
        if (item.summary) detailPanel.append(make(document,'p',item.summary,'history-suggestion-summary'));
        if (meaningfulReason) detailPanel.append(make(document,'p',reason,'history-suggestion-reason'));
        if (item.summary || meaningfulReason) actions.append(detailsButton);
        const action = item.verdict === 'conflicts'
          ? button('What if', 'fork-suggestion', item.id)
          : button('Weave', 'weave', item.id);
        action.setAttribute('aria-label',item.verdict === 'conflicts'
          ? `Explore what if ${item.title || 'untitled possibility'} instead`
          : `Weave ${item.title || 'untitled possibility'} into history`);
        actions.append(action);
        tools.append(status,actions);
        head.append(main,tools);
        content.append(head);
        if (item.summary || meaningfulReason) content.append(detailPanel);
        card.append(content); groupNode.append(card);
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
  return { element: host, render, destroy() { unsubscribe?.(); portalBatchPreview(false); root.replaceChildren(); } };
}

export { erasFor as groupHistoryEras, historyForkYear, isEmptyHistoryBoilerplateReason };
