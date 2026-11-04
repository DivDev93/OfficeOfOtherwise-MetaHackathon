import test from 'node:test';
import assert from 'node:assert/strict';
import { attachSwipeDeckInteractions } from '../web/historySwipeDeck.js';

class Element {
  constructor(doc, tag = 'div') {
    this.ownerDocument = doc; this.tagName = tag.toUpperCase(); this.children = []; this.parentElement = null;
    this.listeners = new Map(); this.attributes = new Map(); this.dataset = {}; this.style = {}; this.isContentEditable = false;
    this.capturedPointers = new Set(); this.captureCalls = []; this.releaseCalls = [];
  }
  appendChild(node) { node.parentElement = this; this.children.push(node); return node; }
  append(...nodes) { nodes.forEach(node => this.appendChild(node)); }
  replaceChildren(...nodes) { for (const child of this.children) child.parentElement = null; this.children = []; this.append(...nodes); }
  addEventListener(type, listener) { const list = this.listeners.get(type) || []; list.push(listener); this.listeners.set(type, list); }
  removeEventListener(type, listener) { this.listeners.set(type, (this.listeners.get(type) || []).filter(fn => fn !== listener)); }
  dispatch(type, values = {}) {
    const event = { type, target: this, currentTarget: this, defaultPrevented: false, stopped: false,
      preventDefault() { this.defaultPrevented = true; }, stopPropagation() { this.stopped = true; }, ...values };
    for (const listener of this.listeners.get(type) || []) listener(event);
    return event;
  }
  closest(selector) { return selector === '[data-swipe-card]' && this.dataset.swipeCard === 'true' ? this : this.parentElement?.closest(selector) ?? null; }
  contains(other) { return this === other || this.children.some(item => item.contains(other)); }
  setPointerCapture(id) { this.captureCalls.push(id); this.capturedPointers.add(id); }
  releasePointerCapture(id) { this.releaseCalls.push(id); this.capturedPointers.delete(id); }
  querySelectorAll(selector) {
    if (selector !== '[id]') return [];
    return this.children.flatMap(child => [...(child.hasAttribute('id') ? [child] : []), ...child.querySelectorAll(selector)]);
  }
  setAttribute(key, value) { this.attributes.set(key, String(value)); }
  removeAttribute(key) { this.attributes.delete(key); }
  getAttribute(key) { return this.attributes.get(key) ?? null; }
  hasAttribute(key) { return this.attributes.has(key); }
  getBoundingClientRect() { return { left: 20, top: 30, width: 260, height: 360 }; }
  cloneNode() { const clone = new Element(this.ownerDocument, this.tagName); clone.dataset = { ...this.dataset }; clone.attributes = new Map(this.attributes); return clone; }
  remove() { if (this.parentElement) this.parentElement.children = this.parentElement.children.filter(item => item !== this); this.parentElement = null; }
}

function setup(options = {}) {
  const { animationFactory, initialTouchAction, ...swipeOptions } = options;
  const doc = { createElement(tag) { return new Element(doc, tag); }, body: null };
  doc.body = doc.createElement('body');
  const root = doc.createElement('section'); doc.body.append(root);
  root.style.touchAction = initialTouchAction;
  const card = doc.createElement('article'); card.dataset.swipeCard = 'true'; root.append(card);
  card.animateClone = animationFactory;
  const decisions = [];
  const swipe = attachSwipeDeckInteractions(root, { onKeep: value => decisions.push(['keep', value]),
    onPass: value => decisions.push(['pass', value]), ...swipeOptions });
  const pointer = (type, x, y, extra = {}) => root.dispatch(type, { pointerId: 1, isPrimary: true, button: 0, clientX: x, clientY: y, ...extra, target: extra.target || card });
  return { doc, root, card, decisions, swipe, pointer };
}

test('horizontal movement beyond threshold keeps on right and suppresses the follow-up pointer click', t => {
  const { root, card, decisions, pointer, swipe } = setup(); t.after(swipe.destroy);
  pointer('pointerdown', 10, 10); pointer('pointermove', 24, 11); pointer('pointerup', 110, 12);
  assert.equal(decisions.length, 1); assert.equal(decisions[0][0], 'keep');
  assert.equal(decisions[0][1].card, card); assert.equal(decisions[0][1].source, 'pointer');
  const click = root.dispatch('click', { target: card, detail: 1 });
  assert.equal(click.defaultPrevented, true); assert.equal(decisions.length, 1);
});

test('vertical scrolling and horizontal movement under threshold do not decide', t => {
  const { decisions, pointer, swipe } = setup(); t.after(swipe.destroy);
  pointer('pointerdown', 10, 10); pointer('pointermove', 12, 32); pointer('pointerup', 12, 45);
  pointer('pointerdown', 10, 10); pointer('pointermove', 24, 11); pointer('pointerup', 54, 12);
  assert.equal(decisions.length, 0);
});

test('left swipe passes once; pointer cancel discards a gesture', t => {
  const { decisions, pointer, swipe } = setup(); t.after(swipe.destroy);
  pointer('pointerdown', 200, 10); pointer('pointermove', 180, 11); pointer('pointerup', 100, 12);
  assert.equal(decisions.length, 1); assert.equal(decisions[0][0], 'pass');
  pointer('pointerdown', 10, 10); pointer('pointermove', 0, 10); pointer('pointercancel', 0, 10);
  pointer('pointerup', -100, 10);
  assert.equal(decisions.length, 1);
});

test('card arrows decide once, ignore repeat and editable or button targets', t => {
  const { root, card, decisions, swipe } = setup(); t.after(swipe.destroy);
  const right = root.dispatch('keydown', { target: card, key: 'ArrowRight', repeat: false });
  assert.equal(right.defaultPrevented, true); assert.equal(decisions[0][0], 'keep');
  root.dispatch('keydown', { target: card, key: 'ArrowLeft', repeat: true });
  const input = new Element(root.ownerDocument, 'input'); input.parentElement = card;
  root.dispatch('keydown', { target: input, key: 'ArrowLeft', repeat: false });
  const button = new Element(root.ownerDocument, 'button'); button.parentElement = card;
  const down = root.dispatch('pointerdown', { target: button, pointerId: 2, clientX: 0, clientY: 0, isPrimary: true, button: 0 });
  root.dispatch('pointermove', { target: button, pointerId: 2, clientX: -100, clientY: 0 });
  root.dispatch('pointerup', { target: button, pointerId: 2, clientX: -100, clientY: 0 });
  assert.equal(down.defaultPrevented, false); assert.equal(decisions.length, 1);
});

test('reduced motion skips clone animation; reset and destroy clean listeners and restore touch behavior', () => {
  const { doc, root, card, decisions, pointer, swipe } = setup({ reducedMotion: true, initialTouchAction: 'manipulation' });
  pointer('pointerdown', 0, 0); pointer('pointermove', 20, 0); pointer('pointerup', 120, 0);
  assert.equal(doc.body.children.length, 1, 'reduced motion does not append an animation clone');
  swipe.reset(); swipe.destroy(); swipe.destroy();
  assert.equal(root.style.touchAction, 'manipulation');
  assert.equal((root.listeners.get('keydown') || []).length, 0);
  root.dispatch('keydown', { target: card, key: 'ArrowLeft' });
  assert.equal(decisions.length, 1);
});

test('fly-out clone survives parent rerender and is removed when its animation finishes', async t => {
  let finish;
  const { doc, root, pointer, swipe } = setup({ animationFactory() {
    return { finished: new Promise(resolve => { finish = resolve; }), cancel() {} };
  }, onKeep() { root.replaceChildren(); } });
  t.after(swipe.destroy);
  pointer('pointerdown', 0, 0); pointer('pointermove', 20, 0); pointer('pointerup', 100, 0);
  assert.equal(root.children.length, 0, 'the owner can rerender during the decision callback');
  assert.equal(doc.body.children.length, 2, 'the independent fly-out clone remains mounted');
  finish(); await Promise.resolve(); await Promise.resolve();
  assert.equal(doc.body.children.length, 1, 'the finished animation removes its clone');
});

test('captured pointer continues a drag released outside the card and releases capture once', t => {
  const { root, card, decisions, pointer, swipe } = setup(); t.after(swipe.destroy);
  pointer('pointerdown', 0, 0);
  assert.deepEqual(card.captureCalls, [1], 'the card captures the active pointer at gesture start');
  const outside = new Element(root.ownerDocument, 'aside');
  root.dispatch('pointermove', { target:outside, pointerId:1, clientX:24, clientY:0 });
  root.dispatch('pointerup', { target:outside, pointerId:1, clientX:110, clientY:0 });
  assert.equal(decisions.length, 1);
  assert.equal(decisions[0][0], 'keep', 'the captured card decides even when release leaves its bounds');
  assert.deepEqual(card.releaseCalls, [1]);
  assert.equal(card.capturedPointers.size, 0);
});

test('pointer capture is released for vertical scroll, cancel, reset and destroy without deciding', () => {
  const { card, decisions, pointer, swipe } = setup();
  pointer('pointerdown', 0, 0); pointer('pointermove', 1, 20);
  assert.equal(card.capturedPointers.size, 0, 'vertical scrolling releases capture immediately');
  pointer('pointerdown', 0, 0); pointer('pointermove', 20, 0); pointer('pointercancel', 30, 0);
  assert.equal(card.capturedPointers.size, 0, 'pointercancel releases the captured pointer');
  pointer('pointerdown', 0, 0); swipe.reset();
  assert.equal(card.capturedPointers.size, 0, 'reset releases an active gesture capture');
  pointer('pointerdown', 0, 0); swipe.destroy();
  assert.equal(card.capturedPointers.size, 0, 'destroy releases an active gesture capture');
  assert.equal(decisions.length, 0);
});

test('public keep/pass helpers animate and report button decisions; absent and disabled cards are ignored', t => {
  let finish;
  const { doc, root, card, decisions, swipe } = setup({ animationFactory() {
    return { finished:new Promise(resolve => { finish = resolve; }), cancel() {} };
  } });
  t.after(swipe.destroy);
  card.setAttribute('id', 'interactive-card');
  assert.equal(swipe.keep(card, { type:'click' }), true);
  assert.equal(decisions[0][0], 'keep');
  assert.equal(decisions[0][1].source, 'button');
  assert.equal(decisions[0][1].event.type, 'click');
  assert.equal(doc.body.children.length, 2, 'button decisions use the same detached fly-out clone');
  assert.equal(doc.body.children[1].getAttribute('id'), null, 'the inert clone cannot duplicate interactive IDs');
  finish();
  card.setAttribute('aria-disabled', 'true');
  assert.equal(swipe.pass(card), false);
  const absent = new Element(root.ownerDocument, 'article'); absent.dataset.swipeCard = 'true';
  assert.equal(swipe.keep(absent), false);
  assert.equal(swipe.decide(card, -1, null, 'button'), false);
  assert.equal(decisions.length, 1);
});

test('reduced-motion button decisions still fire without creating an animation clone', t => {
  const { doc, card, decisions, swipe } = setup({ reducedMotion:true }); t.after(swipe.destroy);
  assert.equal(swipe.pass(card), true);
  assert.equal(decisions.length, 1);
  assert.equal(decisions[0][0], 'pass');
  assert.equal(decisions[0][1].source, 'button');
  assert.equal(doc.body.children.length, 1);
});
