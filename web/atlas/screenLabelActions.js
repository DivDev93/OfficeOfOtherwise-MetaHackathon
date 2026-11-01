/** Screen-space world/question titles are controls; timeline captions stay static labels. */
export function isAtlasScreenLabelAction(kind) {
  return kind === 'world' || kind === 'question' || kind === 'chip' || kind === 'present';
}

/** Bind hover/focus preview and native button activation without coupling to scene state. */
export function bindAtlasScreenLabelButton(button, { onPreview = () => {}, onActivate = () => {} } = {}) {
  let pointerInside = false;
  button.type = 'button';
  button.tabIndex = 0;
  button.addEventListener('pointerenter', event => {
    pointerInside = true;
    onPreview('pointer', event);
  });
  button.addEventListener('pointerleave', event => {
    pointerInside = false;
    if (!button.matches?.(':focus')) onPreview(null, event);
  });
  button.addEventListener('focus', event => onPreview('keyboard', event));
  button.addEventListener('blur', event => {
    if (!pointerInside) onPreview(null, event);
  });
  button.addEventListener('click', event => onActivate(event));
  button.addEventListener('keydown', event => {
    if (event.key !== 'Escape') return;
    event.preventDefault();
    onPreview(null, event);
  });
  return button;
}
