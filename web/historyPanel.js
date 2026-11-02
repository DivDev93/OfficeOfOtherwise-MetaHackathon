const yearLabel = year => `${Math.abs(year).toLocaleString()} ${year < 0 ? 'BCE' : 'CE'}`;
const element = (document, tag, text, className) => { const node = document.createElement(tag); if (text != null) node.textContent = text; if (className) node.className = className; return node; };

/** Accessible, text-only renderer for cached and newly suggested history events. */
export function mountHistoryPanel(root, session, { document = globalThis.document } = {}) {
  const create = (tag, text, className) => element(document, tag, text, className);
  const panel = document.createElement('section'); panel.className = 'history-suggestions'; panel.setAttribute('aria-label', 'History suggestions');
  const heading = create('div', null, 'history-suggestions-heading');
  const title = create('strong', 'Could slot into this history');
  const toggleLabel = create('label', null, 'history-auto-label');
  const toggle = document.createElement('input'); toggle.type = 'checkbox'; toggle.setAttribute('aria-label', 'Automatically suggest events after changing date');
  toggleLabel.append(toggle, document.createTextNode(' Auto-suggest'));
  heading.append(title, toggleLabel);
  const date = create('p', '', 'history-window-date'); date.setAttribute('aria-live', 'polite');
  const status = create('p', '', 'history-session-status'); status.setAttribute('role', 'status'); status.setAttribute('aria-live', 'polite');
  const list = create('div', null, 'history-suggestion-list');
  const actions = create('div', null, 'history-session-actions');
  const suggest = create('button', '', 'outline'); suggest.type = 'button';
  const more = create('button', '', 'outline'); more.type = 'button';
  actions.append(suggest, more); panel.append(heading, date, status, list, actions); root.replaceChildren(panel);
  toggle.addEventListener('change', () => session.setAutoSuggest(toggle.checked));
  suggest.addEventListener('click', () => session.suggest());
  more.addEventListener('click', () => session.more());
  list.addEventListener('click', async event => {
    const button = event.target.closest('button[data-action]'); if (!button) return;
    const { action, id, wovenId } = button.dataset;
    if (action === 'weave') await session.weave(id);
    else if (action === 'fork-suggestion') await session.forkSuggestion(id);
    else if (action === 'fork-event') await session.forkEvent(id);
    else if (action === 'keep') await session.keep(id, wovenId);
    else if (action === 'regenerate') await session.regenerate(id, wovenId);
  });
  const actionButton = (label, action, id, extra = {}) => {
    const button = create('button', label, 'outline'); button.type = 'button'; button.dataset.action = action; button.dataset.id = id;
    for (const [key, value] of Object.entries(extra)) if (value != null) button.dataset[key] = value;
    return button;
  };
  function render(state) {
    panel.hidden = !state.questionId;
    toggle.checked = state.autoSuggest;
    toggle.disabled = state.loading;
    date.textContent = state.date ? `Around ${yearLabel(state.date)} · ${yearLabel(state.window.fromYear)}–${yearLabel(state.window.toYear)}${state.suggestions.length ? ` · ${state.suggestions.length} suggestion${state.suggestions.length === 1 ? '' : 's'}` : ''}` : '';
    status.textContent = state.status || (state.loading ? 'Working…' : '');
    suggest.hidden = state.autoSuggest || !state.questionId || state.loading || state.windowCached;
    suggest.textContent = `Suggest events around ${state.date ? yearLabel(state.date) : 'this date'}`;
    more.hidden = !state.questionId || state.loading || !state.windowCached;
    more.textContent = `More around ${state.date ? yearLabel(state.date) : 'this date'}`;
    more.disabled = state.paused;
    list.replaceChildren();
    const selectedEvent = state.history?.events?.find(event => event.id === state.selectedEventId);
    if (selectedEvent) {
      const selected = create('article', null, 'history-selected-event');
      selected.append(create('strong', 'Selected event'), create('p', `${yearLabel(selectedEvent.year)} · ${selectedEvent.title}`),
        actionButton('What if instead…', 'fork-event', selectedEvent.id));
      list.append(selected);
    }
    for (const item of state.suggestions) {
      const card = create('article', null, 'history-suggestion');
      const metadata = create('div', null, 'history-suggestion-meta');
      const verdict = create('span', item.verdict === 'conflicts' ? 'Conflicts' : 'Fits', `history-verdict ${item.verdict === 'conflicts' ? 'conflicts' : 'fits'}`);
      metadata.append(verdict, create('span', yearLabel(item.year)));
      const h = create('h4', item.title || 'Untitled event');
      const summary = create('p', item.summary || '');
      const reason = create('p', item.reason || '', 'history-suggestion-reason');
      card.append(metadata, h, summary, reason);
      if (item.verdict === 'conflicts') {
        const conflictEvent = state.history?.events?.find(event => event.id === item.conflictsWith);
        const conflict = create('small', conflictEvent ? `Conflicts with ${yearLabel(conflictEvent.year)} · ${conflictEvent.title}` : 'Conflicts with an event in this history.', 'history-conflict-link');
        card.append(conflict, actionButton('What if instead…', 'fork-suggestion', item.id));
      } else card.append(actionButton('Weave into history', 'weave', item.id));
      list.append(card);
    }
    for (const event of state.history?.events || []) for (const flag of event.checkFlags || []) {
      if (flag.kind !== 'weave-ripple' || flag.status === 'kept') continue;
      const card = create('article', null, 'history-ripple-flag');
      card.append(create('strong', event.title || 'Later event'), create('p', flag.message || 'This event may need a re-check after a new event was woven in.'));
      card.append(actionButton('Keep', 'keep', event.id), actionButton('Regenerate this event', 'regenerate', event.id, { wovenId: flag.wovenEventId }));
      list.append(card);
    }
  }
  const unsubscribeSession = session.subscribe ? session.subscribe(render) : null;
  render(session.getState());
  return { element: panel, render, destroy() { unsubscribeSession?.(); root.replaceChildren(); } };
}
