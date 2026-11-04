const DEFAULT_CARD_SELECTOR = '[data-swipe-card]';
const DEFAULT_THRESHOLD = 72;
const AXIS_LOCK_THRESHOLD = 10;
const CLICK_SUPPRESSION_MS = 700;
const coordinate = (value, fallback = 0) => Number.isFinite(Number(value)) ? Number(value) : fallback;

function editableTarget(target, card) {
  let node = target;
  while (node && node !== card) {
    const tag = String(node.tagName || '').toLowerCase();
    if (['button', 'a', 'input', 'textarea', 'select', 'option', 'summary'].includes(tag)
        || node.isContentEditable || node.getAttribute?.('contenteditable') === 'true'
        || node.hasAttribute?.('data-swipe-ignore')) return true;
    node = node.parentElement;
  }
  return false;
}

function closestCard(target, root, selector) {
  const card = target?.closest?.(selector);
  return card && (card === root || root.contains?.(card)) ? card : null;
}

function actionableCard(card, root, selector) {
  return Boolean(card && !card.disabled && card.getAttribute?.('aria-disabled') !== 'true'
    && !card.hasAttribute?.('disabled') && root.contains?.(card) && closestCard(card, root, selector) === card);
}

function removeCloneIds(clone) {
  if (clone?.hasAttribute?.('id')) clone.removeAttribute('id');
  for (const node of clone?.querySelectorAll?.('[id]') || []) node.removeAttribute?.('id');
}

/** Attach inert, local swipe decisions to cards owned by a deck renderer. */
export function attachSwipeDeckInteractions(element, {
  onKeep = () => {}, onPass = () => {}, reducedMotion = false,
  cardSelector = DEFAULT_CARD_SELECTOR, threshold = DEFAULT_THRESHOLD,
} = {}) {
  if (!element?.addEventListener || !element?.removeEventListener) throw new TypeError('A swipe deck element is required');
  if (typeof onKeep !== 'function' || typeof onPass !== 'function') throw new TypeError('Swipe decisions must be callbacks');
  if (!Number.isFinite(threshold) || threshold < 1) throw new TypeError('Swipe threshold must be positive');

  const doc = element.ownerDocument;
  const previousTouchAction = element.style?.touchAction;
  if (element.style) element.style.touchAction = 'pan-y';
  let gesture = null, destroyed = false, clickTimer = null, clickSuppression = null;
  let animations = new Set();

  const isReducedMotion = () => typeof reducedMotion === 'function' ? Boolean(reducedMotion()) : Boolean(reducedMotion);
  const clearGesture = () => {
    const current = gesture; gesture = null;
    if (current?.pointerId != null) {
      try { current.card?.releasePointerCapture?.(current.pointerId); } catch { /* Capture may already be lost during native scrolling. */ }
    }
  };
  const clearClickSuppression = () => {
    if (clickTimer !== null) clearTimeout(clickTimer);
    clickTimer = null; clickSuppression = null;
  };
  const removeAnimation = record => {
    if (!record) return;
    if (record.timer !== undefined) clearTimeout(record.timer);
    if (record.startTimer !== undefined) clearTimeout(record.startTimer);
    record.animation?.cancel?.();
    record.clone?.remove?.();
    if (record.clone?.parentNode && !record.clone.remove) record.clone.parentNode.removeChild(record.clone);
    animations.delete(record);
  };

  function animateExit(card, direction) {
    if (isReducedMotion() || typeof card?.cloneNode !== 'function' || !doc?.body?.appendChild) return null;
    const rect = card.getBoundingClientRect?.();
    if (!rect || ![rect.left, rect.top, rect.width, rect.height].every(Number.isFinite)) return null;
    const clone = card.cloneNode(true);
    if (!clone?.style) return null;
    removeCloneIds(clone);
    clone.inert = true;
    clone.setAttribute?.('aria-hidden', 'true');
    clone.style.position = 'fixed'; clone.style.left = `${rect.left}px`; clone.style.top = `${rect.top}px`;
    clone.style.width = `${rect.width}px`; clone.style.height = `${rect.height}px`; clone.style.margin = '0';
    clone.style.pointerEvents = 'none'; clone.style.zIndex = '2147483000'; clone.style.transform = 'none';
    doc.body.appendChild(clone);
    const record = { clone, animation: null, timer: undefined }; animations.add(record);
    if (typeof card.animateClone === 'function') clone.animate = card.animateClone;
    if (typeof clone.animate === 'function') {
      try {
        record.animation = clone.animate([
          { transform: 'translateX(0)', opacity: 1 },
          { transform: `translateX(${direction * Math.max(240, rect.width + 80)}px)`, opacity: 0 },
        ], { duration: 220, easing: 'cubic-bezier(.2,.7,.3,1)', fill: 'forwards' });
        Promise.resolve(record.animation.finished).then(() => removeAnimation(record), () => removeAnimation(record));
      } catch { removeAnimation(record); return null; }
    } else {
      clone.style.transition = 'transform 220ms cubic-bezier(.2,.7,.3,1), opacity 220ms ease';
      record.startTimer = setTimeout(() => { clone.style.transform = `translateX(${direction * Math.max(240, rect.width + 80)}px)`; clone.style.opacity = '0'; }, 0);
      record.timer = setTimeout(() => removeAnimation(record), 260);
    }
    return record;
  }

  function decide(card, direction, event, source) {
    if (destroyed || !actionableCard(card, element, cardSelector)) return false;
    animateExit(card, direction);
    const callback = direction > 0 ? onKeep : onPass;
    callback({ card, direction: direction > 0 ? 'right' : 'left', event, source });
    return true;
  }

  function onPointerDown(event) {
    if (destroyed || gesture || event.isPrimary === false || (event.button != null && event.button !== 0)) return;
    const card = closestCard(event.target, element, cardSelector);
    if (!actionableCard(card, element, cardSelector) || editableTarget(event.target, card)) return;
    clearClickSuppression();
    const x = coordinate(event.clientX), y = coordinate(event.clientY);
    gesture = { card, pointerId: event.pointerId, x, y, lastX: x, lastY: y, axis: null, dragged: false };
    if (event.pointerId != null) { try { card.setPointerCapture?.(event.pointerId); } catch { /* Some synthetic and detached targets cannot capture. */ } }
  }

  function onPointerMove(event) {
    if (!gesture || (gesture.pointerId != null && event.pointerId !== gesture.pointerId)) return;
    const x = coordinate(event.clientX, gesture.lastX), y = coordinate(event.clientY, gesture.lastY);
    const dx = x - gesture.x, dy = y - gesture.y;
    gesture.lastX = x; gesture.lastY = y;
    if (!gesture.axis && Math.max(Math.abs(dx), Math.abs(dy)) >= AXIS_LOCK_THRESHOLD) {
      gesture.axis = Math.abs(dx) > Math.abs(dy) * 1.15 ? 'horizontal' : 'vertical';
    }
    if (gesture.axis === 'vertical') { clearGesture(); return; }
    if (gesture.axis === 'horizontal') {
      gesture.dragged = true;
      event.preventDefault?.();
    }
  }

  function onPointerUp(event) {
    if (!gesture || (gesture.pointerId != null && event.pointerId !== gesture.pointerId)) return;
    const current = gesture; clearGesture();
    const dx = coordinate(event.clientX, current.lastX) - current.x;
    if (current.axis !== 'horizontal' || Math.abs(dx) < threshold) return;
    const direction = dx > 0 ? 1 : -1;
    clickSuppression = { card: current.card, until: Date.now() + CLICK_SUPPRESSION_MS };
    clickTimer = setTimeout(clearClickSuppression, CLICK_SUPPRESSION_MS);
    event.preventDefault?.();
    decide(current.card, direction, event, 'pointer');
  }

  function onPointerCancel(event) {
    if (!gesture || (gesture.pointerId != null && event.pointerId !== gesture.pointerId)) return;
    clearGesture();
  }

  function onClick(event) {
    if (!clickSuppression || event.detail === 0 || Date.now() > clickSuppression.until) return;
    const card = closestCard(event.target, element, cardSelector);
    if (card !== clickSuppression.card) return;
    event.preventDefault?.(); event.stopPropagation?.(); clearClickSuppression();
  }

  function onKeyDown(event) {
    if (destroyed || event.repeat || !['ArrowRight', 'ArrowLeft'].includes(event.key)) return;
    const card = closestCard(event.target, element, cardSelector);
    if (!actionableCard(card, element, cardSelector) || editableTarget(event.target, card)) return;
    event.preventDefault?.(); event.stopPropagation?.();
    decide(card, event.key === 'ArrowRight' ? 1 : -1, event, 'keyboard');
  }

  element.addEventListener('pointerdown', onPointerDown);
  element.addEventListener('pointermove', onPointerMove, { passive: false });
  element.addEventListener('pointerup', onPointerUp);
  element.addEventListener('pointercancel', onPointerCancel);
  element.addEventListener('click', onClick, true);
  element.addEventListener('keydown', onKeyDown);

  function reset() {
    clearGesture(); clearClickSuppression();
    for (const animation of [...animations]) removeAnimation(animation);
  }

  function cancelGesture() { clearGesture(); clearClickSuppression(); }

  function destroy() {
    if (destroyed) return;
    destroyed = true; reset();
    element.removeEventListener('pointerdown', onPointerDown);
    element.removeEventListener('pointermove', onPointerMove, { passive: false });
    element.removeEventListener('pointerup', onPointerUp);
    element.removeEventListener('pointercancel', onPointerCancel);
    element.removeEventListener('click', onClick, true);
    element.removeEventListener('keydown', onKeyDown);
    if (element.style) element.style.touchAction = previousTouchAction ?? '';
  }

  return { destroy, reset, cancelGesture,
    decide: (card,direction,event,source='button') => decide(card,Number(direction)<0?-1:1,event,source),
    keep: (card,event) => decide(card,1,event,'button'),
    pass: (card,event) => decide(card,-1,event,'button') };
}
