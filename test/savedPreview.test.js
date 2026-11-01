import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createSavedPreviewPopover } from '../web/savedPreview.js';

class Element {
  constructor(ownerDocument, tagName = 'div') {
    this.ownerDocument = ownerDocument;
    this.tagName = tagName;
    this.children = [];
    this.attributes = new Map();
    this.listeners = new Map();
    this.style = {};
    this.hidden = false;
    this.textContent = '';
    this.scrollTop = 0;
    this._offsetHeight = 180;
    this.rect = { left: 40, top: 30, right: 60, bottom: 50, width: 20, height: 20 };
  }
  get offsetHeight() {
    const cap = Number.parseFloat(this.style.maxHeight);
    return Number.isFinite(cap) ? Math.min(this._offsetHeight, cap) : this._offsetHeight;
  }
  set offsetHeight(value) { this._offsetHeight = value; }
  append(...items) { this.children.push(...items); }
  replaceChildren(...items) { this.children = [...items]; }
  setAttribute(name, value) { this.attributes.set(name, String(value)); }
  getAttribute(name) { return this.attributes.get(name) ?? null; }
  removeAttribute(name) { this.attributes.delete(name); }
  addEventListener(type, listener) {
    const listeners = this.listeners.get(type) || [];
    listeners.push(listener); this.listeners.set(type, listeners);
  }
  dispatch(type, properties = {}) {
    const event = { type, target: this, relatedTarget: null, defaultPrevented: false, stopped: false, stopPropagation() { this.stopped = true; }, preventDefault() { this.defaultPrevented = true; }, ...properties };
    for (const listener of this.listeners.get(type) || []) listener(event);
    return event;
  }
  getBoundingClientRect() { return this.rect; }
  contains(node) { return node === this || this.children.some(child => child.contains?.(node)); }
}

function createHarness({ width = 1024, height = 768 } = {}) {
  let viewportSize = { width, height };
  const documentListeners = new Map();
  const viewListeners = new Map();
  const defaultView = {
    addEventListener(type, listener) {
      const listeners = viewListeners.get(type) || [];
      listeners.push(listener); viewListeners.set(type, listeners);
    },
    removeEventListener(type, listener) {
      viewListeners.set(type, (viewListeners.get(type) || []).filter(item => item !== listener));
    },
    dispatch(type) { for (const listener of viewListeners.get(type) || []) listener({ type }); },
    listenerCount(type) { return (viewListeners.get(type) || []).length; },
  };
  const document = {
    defaultView,
    createElement: tag => new Element(document, tag),
    addEventListener(type, listener) {
      const listeners = documentListeners.get(type) || [];
      listeners.push(listener); documentListeners.set(type, listeners);
    },
    dispatch(type, properties = {}) {
      const event = { type, ...properties };
      for (const listener of documentListeners.get(type) || []) listener(event);
    },
  };
  const host = new Element(document, 'body');
  const timers = [];
  const preview = createSavedPreviewPopover(host, {
    document,
    viewport: () => viewportSize,
    dismissDelayMs: 220,
    setTimer(callback, delay) { const timer = { callback, delay, cancelled: false }; timers.push(timer); return timer; },
    clearTimer(timer) { timer.cancelled = true; },
  });
  return {
    host, preview, timers,
    setViewport(nextWidth, nextHeight) { viewportSize = { width:nextWidth, height:nextHeight }; },
    defaultView,
    fire(timer = timers.at(-1)) { if (timer && !timer.cancelled) timer.callback(); },
  };
}

const savedEvent = {
  title: 'Canopy Walkway Exploration Network',
  yearLabel: '1978 CE',
  location: 'Kuching, Sarawak',
  summary: 'Naturalists build suspended walkways and observation towers to study pollinators and canopy medicines.',
  sceneStatus: 'Scene ready',
  sceneReference: '/event-scenes/0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef.png',
};

function cardParts(preview) {
  const [image, title, meta, summary, scene] = preview.element.children;
  return { image, title, meta, summary, scene };
}

test('saved preview renders the real saved scene thumbnail with event title, metadata, and summary', () => {
  const { preview } = createHarness();
  const anchor = new Element(preview.element.ownerDocument, 'button');
  assert.equal(preview.show(savedEvent, anchor), true);
  const { image, title, meta, summary, scene } = cardParts(preview);
  assert.equal(preview.element.hidden, false);
  assert.equal(image.hidden, false);
  assert.equal(image.src, savedEvent.sceneReference);
  assert.equal(image.alt, '', 'the thumbnail is decorative; event copy carries the useful text');
  assert.equal(title.textContent, savedEvent.title);
  assert.equal(meta.textContent, '1978 CE · Kuching, Sarawak · Scene ready');
  assert.equal(summary.textContent, savedEvent.summary);
  assert.equal(scene.textContent, 'Saved scene');
  assert.match(anchor.getAttribute('aria-describedby'), /saved-event-preview/);
});

test('card stays inside a small viewport and flips above a lower-right anchor', () => {
  const { preview, setViewport } = createHarness({ width: 320, height: 220 });
  const anchor = new Element(preview.element.ownerDocument, 'button');
  anchor.rect = { left: 295, top: 190, right: 315, bottom: 210, width: 20, height: 20 };
  preview.element.offsetHeight = 300;
  preview.show(savedEvent, anchor);
  assert.equal(preview.element.style.width, '304px');
  assert.equal(preview.element.style.left, '8px');
  assert.equal(preview.element.style.top, '8px');
  assert.equal(preview.element.style.maxHeight, '142px', 'a compact viewport keeps the card scrollable beyond the complete anchor hit area');
  const css = readFileSync(new URL('../web/style.css', import.meta.url), 'utf8');
  assert.match(css, /\.saved-event-preview\{[^}]*max-height:min\(320px,calc\(100vh - 16px\)\)/);
  assert.match(css, /\.saved-event-preview\{[^}]*overflow-y:auto/);
  assert.match(css, /\.saved-event-preview\{[^}]*overscroll-behavior:contain/);
  assert.match(css, /\.saved-event-preview\{[^}]*touch-action:pan-y/);
  assert.equal(preview.element.offsetHeight, 142, 'the test element models the inline height cap');
  setViewport(375, 812);
  preview.show(savedEvent, anchor);
  assert.equal(preview.element.style.maxHeight, '300px', 'resizing clears the old cap before measuring the natural card height');
  assert.equal(preview.element.offsetHeight, 300, 'the card can grow after the viewport gets taller');
});

test('mobile preview leaves the hovered Atlas hit area clickable and remains reachable for scroll transfer', () => {
  const { preview, timers, fire, host } = createHarness({ width:375, height:812 });
  const canvas = new Element(preview.element.ownerDocument, 'canvas');
  const anchor = new Element(preview.element.ownerDocument, 'div');
  anchor.rect = { left:80, top:393, right:80, bottom:393, width:0, height:0 };
  preview.element.offsetHeight = 320;
  let selected = 0;
  canvas.addEventListener('click', () => { selected++; });

  preview.show(savedEvent, anchor);
  const card = preview.element;
  const box = {
    left:Number.parseFloat(card.style.left), top:Number.parseFloat(card.style.top),
    right:Number.parseFloat(card.style.left) + Number.parseFloat(card.style.width),
    bottom:Number.parseFloat(card.style.top) + card.offsetHeight,
  };
  const pointInsideCard = (x, y) => x >= box.left && x <= box.right && y >= box.top && y <= box.bottom;
  assert.equal(pointInsideCard(80, 393), false, 'the panel does not take the pointer position that opened it');
  assert.equal(box.top, 443, 'the panel clears the 44px Atlas target by a 28px hit-area-to-card gap');
  assert.ok(box.bottom <= 804, 'the full preview fits below this mid-screen anchor');
  const hitTarget = pointInsideCard(80, 393) ? card : canvas;
  hitTarget.dispatch('click');
  assert.equal(selected, 1, 'clicking the original node hit point still reaches the Atlas canvas');

  preview.clear(anchor);
  const transferTimer = timers.at(-1);
  host.ownerDocument.dispatch('pointermove', { clientX:80, clientY:417 });
  fire(transferTimer);
  assert.equal(card.hidden, false, 'a slow pointer pause in the narrow gap keeps the preview open');
  assert.equal(transferTimer.cancelled, true, 'entering the bridge corridor cancels delayed dismissal');
  host.ownerDocument.dispatch('pointermove', { clientX:180, clientY:417 });
  const exitTimer = timers.at(-1);
  assert.notEqual(exitTimer, transferTimer, 'leaving the bounded corridor resumes dismissal');
  fire(exitTimer);
  assert.equal(card.hidden, true, 'the preview still closes after the pointer leaves the transfer corridor');

  preview.show(savedEvent, anchor);
  preview.clear(anchor);
  host.ownerDocument.dispatch('pointermove', { clientX:80, clientY:417 });
  card.dispatch('pointerenter');
  fire(timers.at(-1));
  assert.equal(card.hidden, false, 'moving into the visible card cancels delayed dismissal');
  card.dispatch('wheel', { deltaY:80 });
  assert.equal(card.hidden, false, 'the pointer can remain over the scrollable preview');
});

test('slow transfer corridor begins outside a full-size 44px anchor hit area', () => {
  const { preview, host, timers, fire } = createHarness({ width:375, height:812 });
  const anchor = new Element(preview.element.ownerDocument, 'button');
  anchor.rect = { left:58, top:371, right:102, bottom:415, width:44, height:44 };
  preview.element.offsetHeight = 320;
  preview.show(savedEvent, anchor);
  assert.equal(preview.element.style.top, '443px');
  preview.clear(anchor);
  const dismissTimer = timers.at(-1);
  host.ownerDocument.dispatch('pointermove', { clientX:80, clientY:417 });
  fire(dismissTimer);
  assert.equal(dismissTimer.cancelled, true, 'the corridor includes the space immediately outside the full 44px target');
  assert.equal(preview.element.hidden, false, 'a slow transfer does not dismiss the preview before pointer entry');
});

test('an open preview repositions and rebuilds its transfer corridor on viewport resize', () => {
  const { preview, host, setViewport, defaultView, timers, fire } = createHarness({ width:375, height:812 });
  const anchor = new Element(preview.element.ownerDocument, 'div');
  anchor.rect = { left:80, top:393, right:80, bottom:393, width:0, height:0 };
  preview.element.offsetHeight = 320;
  preview.show(savedEvent, anchor);
  assert.equal(preview.element.style.top, '443px');
  assert.equal(defaultView.listenerCount('resize'), 1, 'resize work is scoped to an open preview');

  setViewport(375, 400);
  defaultView.dispatch('resize');
  assert.equal(preview.element.style.top, '23px', 'the open card flips above the anchor after the viewport shrinks');
  assert.equal(preview.element.style.maxHeight, '320px');

  setViewport(812, 375);
  anchor.rect = { left:478, top:158, right:522, bottom:202, width:44, height:44 };
  defaultView.dispatch('resize');
  assert.equal(preview.element.style.left, '330px', 'the open card follows the anchor after rotation');
  assert.equal(preview.element.style.top, '230px');
  assert.equal(preview.element.style.maxHeight, '137px', 'the rotated viewport gets a fresh available-height measurement');
  preview.clear(anchor);
  const dismissTimer = timers.at(-1);
  host.ownerDocument.dispatch('pointermove', { clientX:500, clientY:215 });
  fire(dismissTimer);
  assert.equal(dismissTimer.cancelled, true, 'pointer transfer uses the resized corridor above the node');
  assert.equal(preview.element.hidden, false);

  preview.clear(anchor, { delay:false });
  assert.equal(defaultView.listenerCount('resize'), 0, 'hiding the card removes the resize listener');
  const oldTop = preview.element.style.top;
  setViewport(375, 812);
  defaultView.dispatch('resize');
  assert.equal(preview.element.style.top, oldTop, 'closed previews do no resize work');
});

test('resizing away from a paused transfer corridor resumes dismissal without another pointer move', () => {
  const { preview, host, setViewport, defaultView, timers, fire } = createHarness({ width:375, height:812 });
  const anchor = new Element(preview.element.ownerDocument, 'div');
  anchor.rect = { left:80, top:393, right:80, bottom:393, width:0, height:0 };
  preview.element.offsetHeight = 320;
  preview.show(savedEvent, anchor);
  preview.clear(anchor);
  const oldTimer = timers.at(-1);
  host.ownerDocument.dispatch('pointermove', { clientX:80, clientY:430 });
  assert.equal(oldTimer.cancelled, true, 'the pointer is protected in the first corridor');

  setViewport(812, 375);
  anchor.rect = { left:478, top:158, right:522, bottom:202, width:44, height:44 };
  defaultView.dispatch('resize');
  const resumedTimer = timers.at(-1);
  assert.notEqual(resumedTimer, oldTimer, 'the pointer no longer lies in the resized corridor');
  assert.equal(resumedTimer.cancelled, false);
  fire(resumedTimer);
  assert.equal(preview.element.hidden, true, 'dismissal resumes after resize with no follow-up pointer event');
});

test('very short viewports keep the anchor center clear when the preview must shrink', () => {
  const { preview } = createHarness({ width:100, height:50 });
  const anchor = new Element(preview.element.ownerDocument, 'div');
  anchor.rect = { left:50, top:25, right:50, bottom:25, width:0, height:0 };
  preview.show(savedEvent, anchor);
  const top = Number.parseFloat(preview.element.style.top);
  const height = preview.element.offsetHeight;
  assert.ok(height > 0 && height <= 3, 'the scrollable card is reduced to the available region outside the target hit area');
  assert.ok(!(top <= 25 && top + height >= 25), 'even an extremely short viewport leaves the anchor center unobscured');
});

test('pointer transfer into the card cancels delayed dismissal; leaving the card closes it', () => {
  const { preview, timers, fire } = createHarness();
  const anchor = new Element(preview.element.ownerDocument, 'button');
  preview.show(savedEvent, anchor);
  preview.clear(anchor);
  const transferTimer = timers.at(-1);
  assert.equal(transferTimer.delay, 220);
  preview.element.dispatch('pointerenter');
  fire(transferTimer);
  assert.equal(preview.element.hidden, false, 'the preview stays open while the pointer is over it');
  preview.element.dispatch('pointerleave');
  const leaveTimer = timers.at(-1);
  fire(leaveTimer);
  assert.equal(preview.element.hidden, true, 'the preview closes after pointer leaves both anchor and card');
  assert.equal(anchor.getAttribute('aria-describedby'), null);
});

test('switching preview anchors clears the old pointer corridor before keyboard focus leaves', () => {
  const { preview, host, timers, fire } = createHarness({ width:375, height:812 });
  const firstAnchor = new Element(preview.element.ownerDocument, 'div');
  firstAnchor.rect = { left:80, top:393, right:80, bottom:393, width:0, height:0 };
  const secondAnchor = new Element(preview.element.ownerDocument, 'button');
  secondAnchor.rect = { left:250, top:680, right:280, bottom:710, width:30, height:30 };
  preview.show(savedEvent, firstAnchor);
  preview.clear(firstAnchor);
  host.ownerDocument.dispatch('pointermove', { clientX:80, clientY:417 });
  assert.equal(timers.at(-1).cancelled, true, 'the first owner has an active transfer corridor');

  preview.show(savedEvent, secondAnchor);
  preview.element.dispatch('focusin');
  preview.element.dispatch('focusout');
  const focusExitTimer = timers.at(-1);
  assert.ok(focusExitTimer && !focusExitTimer.cancelled, 'focusout schedules dismissal after the owner switch');
  fire(focusExitTimer);
  assert.equal(preview.element.hidden, true, 'focus leaving a new owner dismisses instead of inheriting the previous corridor');
});

test('focus transfer retains the card and wheel/touch input scrolls it without zooming the Atlas', () => {
  const { preview, timers, fire } = createHarness();
  const anchor = new Element(preview.element.ownerDocument, 'button');
  preview.show(savedEvent, anchor);
  preview.clear(anchor);
  const transferTimer = timers.at(-1);
  preview.element.dispatch('focusin');
  fire(transferTimer);
  assert.equal(preview.element.hidden, false, 'keyboard focus keeps the preview open');

  let canvasWheel = 0;
  const canvas = new Element(preview.element.ownerDocument, 'canvas');
  canvas.addEventListener('wheel', () => { canvasWheel++; });
  const wheel = preview.element.dispatch('wheel', { deltaY: 80 });
  if (!wheel.stopped) canvas.dispatch('wheel', { deltaY: 80 });
  assert.equal(wheel.stopped, true);
  assert.equal(wheel.defaultPrevented, false, 'the browser can scroll the card normally');
  assert.equal(canvasWheel, 0, 'wheel input cannot reach Atlas zoom');

  preview.element.scrollTop = 25;
  preview.element.dispatch('pointerdown', { pointerType: 'touch', clientY: 100 });
  const touchMove = preview.element.dispatch('pointermove', { pointerType: 'touch', clientY: 60 });
  assert.equal(preview.element.scrollTop, 65);
  assert.equal(touchMove.defaultPrevented, true);
  preview.element.dispatch('focusout');
  fire(timers.at(-1));
  assert.equal(preview.element.hidden, true, 'focus leaving the card dismisses it');
});

test('scene-less events keep the compact text preview without a broken image', () => {
  const { preview } = createHarness();
  const anchor = new Element(preview.element.ownerDocument, 'button');
  preview.show({ ...savedEvent, sceneReference: null, sceneStatus: 'No saved scene is confirmed.' }, anchor);
  const { image, scene } = cardParts(preview);
  assert.equal(image.hidden, true);
  assert.equal(image.getAttribute('src'), null);
  assert.equal(scene.textContent, 'No saved scene is confirmed.');
});
