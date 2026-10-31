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
    this.offsetHeight = 180;
    this.rect = { left: 40, top: 30, right: 60, bottom: 50, width: 20, height: 20 };
  }
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
  const document = { createElement: tag => new Element(document, tag) };
  const host = new Element(document, 'body');
  const timers = [];
  const preview = createSavedPreviewPopover(host, {
    document,
    viewport: () => ({ width, height }),
    dismissDelayMs: 220,
    setTimer(callback, delay) { const timer = { callback, delay, cancelled: false }; timers.push(timer); return timer; },
    clearTimer(timer) { timer.cancelled = true; },
  });
  return {
    host, preview, timers,
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
  const { preview } = createHarness({ width: 320, height: 220 });
  const anchor = new Element(preview.element.ownerDocument, 'button');
  anchor.rect = { left: 295, top: 190, right: 315, bottom: 210, width: 20, height: 20 };
  preview.element.offsetHeight = 300;
  preview.show(savedEvent, anchor);
  assert.equal(preview.element.style.width, '304px');
  assert.equal(preview.element.style.left, '8px');
  assert.equal(preview.element.style.top, '8px');
  const css = readFileSync(new URL('../web/style.css', import.meta.url), 'utf8');
  assert.match(css, /\.saved-event-preview\{[^}]*max-height:min\(320px,calc\(100vh - 16px\)\)/);
  assert.match(css, /\.saved-event-preview\{[^}]*overflow-y:auto/);
  assert.match(css, /\.saved-event-preview\{[^}]*overscroll-behavior:contain/);
  assert.match(css, /\.saved-event-preview\{[^}]*touch-action:pan-y/);
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
