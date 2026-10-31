/** One read-only saved-event preview shared by the tree and Atlas. */
export function createSavedPreviewPopover(host, {
  document: doc = globalThis.document,
  viewport = () => ({ width: 1024, height: 768 }),
  dismissDelayMs = 220,
  setTimer = globalThis.setTimeout,
  clearTimer = globalThis.clearTimeout,
} = {}) {
  if (!host?.append) throw new Error('A preview host is required');
  const document = host.ownerDocument || doc;
  const popup = document.createElement('aside');
  popup.id = 'saved-event-preview';
  popup.className = 'saved-event-preview';
  popup.hidden = true;
  popup.tabIndex = 0;
  popup.setAttribute('role', 'region');
  popup.setAttribute('aria-live', 'polite');
  popup.setAttribute('aria-label', 'Saved event preview');

  const image = document.createElement('img');
  image.className = 'saved-preview-image';
  image.alt = '';
  image.hidden = true;
  const title = document.createElement('strong');
  title.className = 'saved-preview-title';
  const meta = document.createElement('small');
  meta.className = 'saved-preview-meta';
  const summary = document.createElement('p');
  summary.className = 'saved-preview-summary';
  const scene = document.createElement('small');
  scene.className = 'saved-preview-scene';
  popup.append(image, title, meta, summary, scene);
  host.append(popup);

  let owner = null, activePreview = null, dismissTimer = null, imageReference = '';
  let pointerInside = false, focusInside = false;
  const link = (anchor, enabled) => {
    if (!anchor?.getAttribute || !anchor?.setAttribute) return;
    const ids = (anchor.getAttribute('aria-describedby') || '').split(/\s+/).filter(id => id && id !== popup.id);
    if (enabled) ids.push(popup.id);
    if (ids.length) anchor.setAttribute('aria-describedby', [...new Set(ids)].join(' '));
    else anchor.removeAttribute?.('aria-describedby');
  };
  function cancelDismiss() {
    if (dismissTimer != null) clearTimer(dismissTimer);
    dismissTimer = null;
  }
  function hide() {
    cancelDismiss();
    link(owner, false);
    owner = null;
    activePreview = null;
    pointerInside = false;
    focusInside = false;
    popup.hidden = true;
    image.hidden = true;
    image.removeAttribute?.('src');
    imageReference = '';
  }
  function scheduleDismiss() {
    cancelDismiss();
    if (pointerInside || focusInside) return;
    dismissTimer = setTimer(() => {
      dismissTimer = null;
      if (!pointerInside && !focusInside) hide();
    }, dismissDelayMs);
  }
  function clear(anchor, { delay = Boolean(anchor) } = {}) {
    if (anchor && owner !== anchor) return false;
    if (!owner && !activePreview) return true;
    if (delay) scheduleDismiss();
    else hide();
    return true;
  }
  function position(anchor) {
    const rect = anchor?.getBoundingClientRect?.() || { left: 8, top: 8, right: 8, bottom: 8, width: 0, height: 0 };
    const size = viewport() || {};
    const viewportWidth = Math.max(1, Number(size.width) || 1024);
    const viewportHeight = Math.max(1, Number(size.height) || 768);
    const margin = 8;
    const width = Math.max(1, Math.min(340, viewportWidth - margin * 2));
    const height = Math.min(popup.offsetHeight || 180, viewportHeight - margin * 2);
    let left = rect.left + (rect.width || 0) / 2 - width / 2;
    let top = rect.bottom + 8;
    if (top + height > viewportHeight - margin) top = rect.top - height - 8;
    left = Math.max(margin, Math.min(left, viewportWidth - width - margin));
    top = Math.max(margin, Math.min(top, viewportHeight - height - margin));
    popup.style.left = `${left}px`;
    popup.style.top = `${top}px`;
    popup.style.width = `${width}px`;
  }
  function show(data, anchor) {
    if (!data || !anchor) return clear();
    cancelDismiss();
    if (owner && owner !== anchor) link(owner, false);
    owner = anchor;
    link(owner, true);
    activePreview = { ...data };
    title.textContent = data.title || 'Saved possibility';
    meta.textContent = [data.yearLabel, data.location, data.sceneStatus].filter(Boolean).join(' · ');
    summary.textContent = data.summary || 'No saved summary is available.';
    const sceneReference = typeof data.sceneReference === 'string' ? data.sceneReference.trim() : '';
    if (sceneReference) {
      if (sceneReference !== imageReference) image.src = sceneReference;
      imageReference = sceneReference;
      image.hidden = false;
    } else {
      image.removeAttribute?.('src');
      imageReference = '';
      image.hidden = true;
    }
    scene.textContent = sceneReference ? 'Saved scene' : (data.sceneStatus || 'No saved scene is confirmed.');
    popup.hidden = false;
    position(anchor);
    return true;
  }

  popup.addEventListener('pointerenter', () => { pointerInside = true; cancelDismiss(); });
  popup.addEventListener('pointerleave', () => { pointerInside = false; scheduleDismiss(); });
  popup.addEventListener('focusin', () => { focusInside = true; cancelDismiss(); });
  popup.addEventListener('focusout', event => {
    if (popup.contains?.(event.relatedTarget)) return;
    focusInside = false;
    scheduleDismiss();
  });
  popup.addEventListener('wheel', event => event.stopPropagation(), { passive: true });
  popup.addEventListener('pointerdown', event => {
    if (event.pointerType === 'touch') popup._previewTouchY = event.clientY;
  });
  popup.addEventListener('pointermove', event => {
    if (event.pointerType !== 'touch' || !Number.isFinite(popup._previewTouchY)) return;
    popup.scrollTop += popup._previewTouchY - event.clientY;
    popup._previewTouchY = event.clientY;
    event.preventDefault?.();
  });
  for (const type of ['pointerup', 'pointercancel']) popup.addEventListener(type, () => { popup._previewTouchY = null; });

  return { show, clear, get activePreview() { return activePreview; }, get element() { return popup; } };
}
