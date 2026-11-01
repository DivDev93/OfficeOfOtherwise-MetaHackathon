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
  let pointerInside = false, focusInside = false, pointerInCorridor = false, transferCorridor = null, lastPointerPoint = null;
  const resizeTarget = document.defaultView;
  let resizeListenerAttached = false;
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
  function repositionOpenPreview() {
    if (owner && !popup.hidden) position(owner);
  }
  function trackResize(enabled) {
    if (!resizeTarget?.addEventListener || resizeListenerAttached === enabled) return;
    if (enabled) resizeTarget.addEventListener('resize', repositionOpenPreview);
    else resizeTarget.removeEventListener?.('resize', repositionOpenPreview);
    resizeListenerAttached = enabled;
  }
  function pointInside(point, rect) {
    return Boolean(point && rect && point.x >= rect.left && point.x <= rect.right
      && point.y >= rect.top && point.y <= rect.bottom);
  }
  function refreshPointerRegion() {
    if (!lastPointerPoint || !owner || popup.hidden) return;
    const wasProtected = pointerInside || pointerInCorridor;
    const left = Number.parseFloat(popup.style.left), top = Number.parseFloat(popup.style.top);
    const width = Number.parseFloat(popup.style.width), height = popup.offsetHeight;
    pointerInside = pointInside(lastPointerPoint, { left, right:left + width, top, bottom:top + height });
    pointerInCorridor = !pointerInside && pointInside(lastPointerPoint, transferCorridor);
    if (pointerInside || pointerInCorridor) cancelDismiss();
    else if (wasProtected && !focusInside) scheduleDismiss();
  }
  function hide() {
    cancelDismiss();
    trackResize(false);
    link(owner, false);
    owner = null;
    activePreview = null;
    pointerInside = false;
    focusInside = false;
    pointerInCorridor = false;
    transferCorridor = null;
    lastPointerPoint = null;
    popup.hidden = true;
    image.hidden = true;
    image.removeAttribute?.('src');
    imageReference = '';
  }
  function scheduleDismiss() {
    cancelDismiss();
    if (pointerInside || focusInside || pointerInCorridor) return;
    dismissTimer = setTimer(() => {
      dismissTimer = null;
      if (!pointerInside && !focusInside && !pointerInCorridor) hide();
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
    let margin = 8;
    const anchorHeight = Math.max(0, Number(rect.height) || Number(rect.bottom) - Number(rect.top) || 0);
    const anchorTop = Number(rect.top);
    const anchorCenterY = anchorTop + anchorHeight / 2;
    const hitHalfHeight = Math.max(22, anchorHeight / 2);
    let gap = 28;
    let aboveRoom = anchorCenterY - hitHalfHeight - margin - gap;
    let belowRoom = viewportHeight - margin - (anchorCenterY + hitHalfHeight + gap);
    if (Math.max(aboveRoom, belowRoom) < 1) {
      margin = 0;
      gap = 0;
      aboveRoom = anchorCenterY - hitHalfHeight;
      belowRoom = viewportHeight - (anchorCenterY + hitHalfHeight);
    }
    const width = Math.max(1, Math.min(340, viewportWidth - margin * 2));
    popup.style.maxHeight = '';
    const desiredHeight = Math.min(popup.offsetHeight || 180, viewportHeight - margin * 2);
    const belowTop = anchorCenterY + hitHalfHeight + gap;
    const aboveBottom = anchorCenterY - hitHalfHeight - gap;
    const placeBelow = belowRoom >= desiredHeight || (aboveRoom < desiredHeight && belowRoom >= aboveRoom);
    const availableHeight = Math.max(1, Math.min(desiredHeight, placeBelow ? belowRoom : aboveRoom));
    popup.style.maxHeight = `${availableHeight}px`;
    const height = availableHeight;
    let left = rect.left + (rect.width || 0) / 2 - width / 2;
    let top = placeBelow ? belowTop : aboveBottom - height;
    left = Math.max(margin, Math.min(left, viewportWidth - width - margin));
    top = Math.max(margin, Math.min(top, viewportHeight - height - margin));
    popup.style.left = `${left}px`;
    popup.style.top = `${top}px`;
    popup.style.width = `${width}px`;
    const anchorCenterX = Number(rect.left) + (Number(rect.width) || 0) / 2;
    const hitHalfWidth = Math.max(22, (Number(rect.width) || 0) / 2);
    const corridorLeft = Math.max(left, anchorCenterX - hitHalfWidth - 36);
    const corridorRight = Math.min(left + width, anchorCenterX + hitHalfWidth + 36);
    const hitTop = anchorCenterY - hitHalfHeight;
    const hitBottom = anchorCenterY + hitHalfHeight;
    const gapTop = placeBelow ? hitBottom : top + height;
    const gapBottom = placeBelow ? top : hitTop;
    transferCorridor = corridorRight > corridorLeft && gapBottom > gapTop
      ? { left:corridorLeft, right:corridorRight, top:gapTop, bottom:gapBottom }
      : null;
    refreshPointerRegion();
  }
  function show(data, anchor) {
    if (!data || !anchor) return clear();
    cancelDismiss();
    if (owner && owner !== anchor) {
      link(owner, false);
      pointerInCorridor = false;
      transferCorridor = null;
    }
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
    trackResize(true);
    position(anchor);
    return true;
  }

  popup.addEventListener('pointerenter', () => { pointerInside = true; pointerInCorridor = false; cancelDismiss(); });
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

  document.addEventListener?.('pointermove', event => {
    if (!Number.isFinite(event.clientX) || !Number.isFinite(event.clientY)) return;
    lastPointerPoint = { x:event.clientX, y:event.clientY };
    refreshPointerRegion();
  });

  return { show, clear, get activePreview() { return activePreview; }, get element() { return popup; } };
}
