import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { astronomicalYear, createStarMap, formatStarMapYear, getStarMapNodeState, layoutStarMap, parseStarMapYear, projectStarMap } from '../web/starmap.js';

class TestElement {
  constructor(ownerDocument, tagName) {
    this.ownerDocument = ownerDocument; this.tagName = tagName; this.children = []; this.parentElement = null;
    this.attributes = new Map(); this.listeners = new Map(); this.dataset = {}; this.style = {};
    this.className = ''; this.textContent = ''; this.hidden = false; this.width = 900; this.height = 540;
    this.classList = {
      add: name => { if (!this.className.split(/\s+/).includes(name)) this.className = `${this.className} ${name}`.trim(); },
      remove: name => { this.className = this.className.split(/\s+/).filter(item => item !== name).join(' '); },
      contains: name => this.className.split(/\s+/).includes(name),
    };
  }
  append(...nodes) { for (const node of nodes) { node.parentElement = this; this.children.push(node); } }
  replaceChildren(...nodes) { this.children = []; this.append(...nodes); }
  setAttribute(name, value) { this.attributes.set(name, String(value)); if (name === 'class') this.className = String(value); }
  getAttribute(name) { return this.attributes.get(name) ?? null; }
  removeAttribute(name) { this.attributes.delete(name); }
  addEventListener(type, listener) { if (!this.listeners.has(type)) this.listeners.set(type, []); this.listeners.get(type).push(listener); }
  dispatch(type, values = {}) {
    let stopped = false;
    const event = { type, target: this, currentTarget: this, defaultPrevented: false, preventDefault() { this.defaultPrevented = true; }, stopPropagation() { stopped = true; }, ...values };
    for (let node = this; node && !stopped; node = node.parentElement) {
      event.currentTarget = node;
      for (const listener of node.listeners.get(type) || []) listener(event);
    }
    return event;
  }
  closest(selectorList) {
    const selectors = selectorList.split(',').map(value => value.trim());
    for (let node = this; node; node = node.parentElement) {
      if (selectors.some(selector => selector.startsWith('.') && node.classList.contains(selector.slice(1)))) return node;
    }
    return null;
  }
  querySelectorAll(selector) {
    const result = [];
    const matches = node => selector.startsWith('.') && node.classList.contains(selector.slice(1));
    const visit = node => { for (const child of node.children) { if (matches(child)) result.push(child); visit(child); } };
    visit(this); return result;
  }
  setPointerCapture() {}
  getBoundingClientRect() { return { left: 0, top: 0, width: this.width, height: this.height }; }
  remove() { if (this.parentElement) this.parentElement.children = this.parentElement.children.filter(child => child !== this); }
  focus() {}
}

function makeStarMapDom() {
  const document = {
    defaultView: { addEventListener() {}, removeEventListener() {} },
    createElement(tag) { return new TestElement(this, tag); },
    createElementNS(_namespace, tag) { return new TestElement(this, tag); },
    getElementById(id) { return this.head.children.find(node => node.getAttribute('id') === id) || null; },
  };
  document.head = new TestElement(document, 'head');
  const container = new TestElement(document, 'container');
  const find = (node, className) => node.querySelectorAll(`.${className}`)[0];
  return { document, container, find };
}

test('star map lays events on a linear chronological axis with deterministic branch lanes', () => {
  const nodes = [
    { id: 'child-b', parentId: 'root', year: 220, title: 'Later' },
    { id: 'grandchild', parentId: 'child-a', year: 240, title: 'Deep' },
    { id: 'root', year: 190, title: 'Origin' },
    { id: 'child-a', parentId: 'root', year: 210, title: 'Earlier' },
  ];
  const layout = layoutStarMap(nodes);
  const byId = new Map(layout.map(node => [node.id, node]));
  assert.equal(byId.get('root').depth, 0);
  assert.equal(byId.get('child-a').depth, 1);
  assert.equal(byId.get('grandchild').depth, 2);
  assert.ok(byId.get('root').x < byId.get('child-a').x);
  assert.ok(byId.get('child-a').x < byId.get('grandchild').x);
  assert.ok(byId.get('child-a').y < byId.get('child-b').y);
  const signature = result => result.map(({ id, x, y }) => [id, x, y]).sort(([a], [b]) => a.localeCompare(b));
  assert.deepEqual(signature(layout), signature(layoutStarMap([...nodes].reverse())));
});

test('BCE and CE years map continuously across the no-year-zero boundary', () => {
  assert.equal(parseStarMapYear(-1), -1);
  assert.equal(parseStarMapYear('1 BCE'), -1);
  assert.equal(parseStarMapYear('1 CE'), 1);
  assert.equal(parseStarMapYear(0), null);
  assert.equal(parseStarMapYear('0'), null);
  assert.equal(astronomicalYear(-1), 0);
  assert.equal(astronomicalYear(1), 1);
  assert.equal(astronomicalYear(-2), -1);
  const boundary = new Map(layoutStarMap([{ id: 'bce', year: -1 }, { id: 'ce', year: 1 }]).map(node => [node.id, node]));
  assert.equal(boundary.get('ce').x - boundary.get('bce').x, 48, '1 BCE to 1 CE spans exactly one elapsed year');
  assert.equal(formatStarMapYear(-1), '1 BCE');
  assert.equal(formatStarMapYear(1), '1 CE');
  assert.equal(formatStarMapYear(0), 'Undated');
});

test('equal-year events overlap on time but get stable subtree lanes independent of input order', () => {
  const nodes = [
    { id: 'root', year: -1 },
    { id: 'branch-b', parentId: 'root', branchId: 'b', year: 1 },
    { id: 'branch-a', parentId: 'root', branchId: 'a', year: 1 },
    { id: 'leaf-b', parentId: 'branch-b', year: 2 },
    { id: 'leaf-a', parentId: 'branch-a', year: 2 },
  ];
  const layout = layoutStarMap(nodes);
  const byId = new Map(layout.map(node => [node.id, node]));
  const reversed = new Map(layoutStarMap([...nodes].reverse()).map(node => [node.id, node]));
  assert.ok(byId.get('root').x < byId.get('branch-a').x);
  assert.equal(byId.get('branch-a').x, byId.get('branch-b').x);
  assert.notEqual(byId.get('branch-a').y, byId.get('branch-b').y);
  assert.equal(byId.get('leaf-a').y, byId.get('branch-a').y);
  assert.equal(byId.get('leaf-b').y, byId.get('branch-b').y);
  for (const id of byId.keys()) assert.deepEqual([byId.get(id).x, byId.get(id).y, byId.get(id).z], [reversed.get(id).x, reversed.get(id).y, reversed.get(id).z]);
});

test('elapsed-time gaps remain proportional and unknown years stay explicit on a separate rail', () => {
  const layout = layoutStarMap([
    { id: 'old', year: -1000 },
    { id: 'near', year: -900 },
    { id: 'new', year: 1000 },
    { id: 'unknown', year: 0 },
  ]);
  const byId = new Map(layout.map(node => [node.id, node]));
  const nearGap = byId.get('near').x - byId.get('old').x;
  const farGap = byId.get('new').x - byId.get('near').x;
  assert.ok(Math.abs(farGap / nearGap - 18.99) < 1e-9);
  assert.equal(byId.get('unknown').yearCoordinate, null);
  assert.equal(byId.get('unknown').yearLabel, 'Undated');
  assert.equal(byId.get('unknown').undated, true);
  assert.ok(byId.get('unknown').x > byId.get('new').x);
});

test('star map tolerates absent parents and cyclic ancestry without losing nodes', () => {
  const layout = layoutStarMap([
    { id: 'orphan', parentId: 'missing', title: 'Orphan' },
    { id: 'cycle-a', parentId: 'cycle-b', title: 'A' },
    { id: 'cycle-b', parentId: 'cycle-a', title: 'B' },
  ]);
  assert.equal(layout.length, 3);
  assert.ok(layout.every(node => Number.isFinite(node.x) && Number.isFinite(node.y)));
});

test('star map branches occupy stable z-depth and perspective projection responds to depth and orbit', () => {
  const layout = layoutStarMap([
    { id: 'root', title: 'Origin' },
    { id: 'branch-a', parentId: 'root', title: 'A', year: 210 },
    { id: 'branch-b', parentId: 'root', title: 'B', year: 220 },
    { id: 'deep-a', parentId: 'branch-a', title: 'A2', year: 230 },
  ]);
  const byId = new Map(layout.map(node => [node.id, node]));
  assert.notEqual(byId.get('branch-a').z, byId.get('branch-b').z);
  assert.equal(byId.get('deep-a').z, byId.get('branch-a').z);

  const near = { id: 'near', x: 3, y: 0, z: 5 };
  const far = { id: 'far', x: 3, y: 0, z: -5 };
  const projected = projectStarMap([near, far], { yaw: 0, pitch: 0, distance: 20, focalLength: 100 });
  assert.ok(projected[0].perspective > projected[1].perspective);
  const frontView = projectStarMap([{ id: 'x', x: 10, y: 0, z: 0 }], { yaw: 0, pitch: 0, distance: 30, focalLength: 100 })[0];
  const orbited = projectStarMap([{ id: 'x', x: 10, y: 0, z: 0 }], { yaw: Math.PI / 2, pitch: 0, distance: 30, focalLength: 100 })[0];
  assert.ok(frontView.screenX > orbited.screenX);
  assert.ok(frontView.cameraZ !== orbited.cameraZ);
});

test('map pointer gestures orbit in 3D, pan with right or Shift drag, and scope context menus to the map', () => {
  const { document, container, find } = makeStarMapDom();
  const map = createStarMap(container, { nodes: [
    { id: 'event-a', title: 'Earlier', year: 100 },
    { id: 'event-b', title: 'Later', year: 200 },
  ] });
  const mapRoot = find(container, 'otherwise-starmap');
  const starPositions = () => mapRoot.querySelectorAll('.map-star').map(star => {
    const match = /^translate\(([-\d.]+) ([-\d.]+)\)$/.exec(star.getAttribute('transform'));
    return { x: Number(match[1]), y: Number(match[2]) };
  });
  const initial = starPositions();

  mapRoot.dispatch('pointerdown', { pointerId: 1, button: 0, clientX: 10, clientY: 10, shiftKey: false });
  mapRoot.dispatch('pointermove', { pointerId: 1, button: 0, clientX: 30, clientY: 25, shiftKey: false });
  mapRoot.dispatch('pointerup', { pointerId: 1, button: 0 });
  const orbited = starPositions();
  assert.ok(orbited.some((point, index) => Math.hypot(point.x - initial[index].x, point.y - initial[index].y) > 0.1));
  const initialDistance = Math.hypot(initial[1].x - initial[0].x, initial[1].y - initial[0].y);
  const orbitDistance = Math.hypot(orbited[1].x - orbited[0].x, orbited[1].y - orbited[0].y);
  assert.notEqual(orbitDistance, initialDistance, 'left drag changes the projected 3D relationship, not just the viewport offset');

  const rightPanStart = starPositions();
  const mapStar = mapRoot.querySelectorAll('.map-star')[0];
  const rightDown = mapStar.dispatch('pointerdown', { pointerId: 2, button: 2, clientX: 10, clientY: 10, shiftKey: false });
  mapRoot.dispatch('pointermove', { pointerId: 2, button: 2, clientX: 35, clientY: 30, shiftKey: false });
  mapRoot.dispatch('pointerup', { pointerId: 2, button: 2 });
  const rightPanned = starPositions();
  assert.equal(rightDown.defaultPrevented, true);
  rightPanned.forEach((point, index) => {
    assert.ok(Math.abs(point.x - rightPanStart[index].x - 25) < 1e-8);
    assert.ok(Math.abs(point.y - rightPanStart[index].y - 20) < 1e-8);
  });

  const shiftPanStart = starPositions();
  mapRoot.dispatch('pointerdown', { pointerId: 3, button: 0, clientX: 10, clientY: 10, shiftKey: true });
  mapRoot.dispatch('pointermove', { pointerId: 3, button: 0, clientX: 18, clientY: 14, shiftKey: true });
  mapRoot.dispatch('pointerup', { pointerId: 3, button: 0 });
  const shiftPanned = starPositions();
  shiftPanned.forEach((point, index) => {
    assert.ok(Math.abs(point.x - shiftPanStart[index].x - 8) < 1e-8);
    assert.ok(Math.abs(point.y - shiftPanStart[index].y - 4) < 1e-8);
  });

  assert.equal(mapRoot.dispatch('contextmenu').defaultPrevented, true);
  assert.equal(container.dispatch('contextmenu').defaultPrevented, false, 'the surrounding page keeps its native context menu');
  map.destroy();
  void document;
});

test('external selection updates recenter an active focus window so the selected event remains visible', () => {
  const { container, find } = makeStarMapDom();
  const map = createStarMap(container, { selectedId: 'older', nodes: [
    { id: 'older', title: 'Older era', year: -3000 },
    { id: 'later', title: 'Later era', year: 3000 },
  ] });
  const mapRoot = find(container, 'otherwise-starmap');
  assert.deepEqual(mapRoot.querySelectorAll('.map-star').map(star => star.dataset.nodeId), ['older']);
  map.setData({ selectedId: 'later' });
  assert.deepEqual(mapRoot.querySelectorAll('.map-star').map(star => star.dataset.nodeId), ['later']);
  assert.equal(mapRoot.querySelectorAll('.map-star')[0].getAttribute('aria-pressed'), 'true');
  map.destroy();
});

test('scene readiness is explicit, preparing scenes animate, and missing or failed scenes stay unavailable', () => {
  assert.equal(getStarMapNodeState({ ready: true, status: 'Preparing scene' }), 'ready');
  assert.equal(getStarMapNodeState({ ready: false, status: 'Preparing scene' }), 'preparing');
  assert.equal(getStarMapNodeState({ ready: false, status: 'Scene unavailable' }), 'unavailable');
  assert.equal(getStarMapNodeState({ ready: false, status: 'Scene failed' }), 'unavailable');
  assert.equal(getStarMapNodeState({ ready: false, status: 'Consequences failed' }), 'unavailable');
  assert.equal(getStarMapNodeState({ status: 'Scene unavailable' }), 'unavailable');
  assert.equal(getStarMapNodeState({ status: 'queued' }), 'preparing');
  assert.equal(getStarMapNodeState({ status: 'complete' }), 'ready');
});

test('node hover and keyboard focus show a rich local preview without selecting or fetching', () => {
  const { container, find } = makeStarMapDom();
  let selected = 0;
  const map = createStarMap(container, { nodes: [{
    id: 'preview-event', title: 'A new river course', year: '1200 BCE', status: 'Scene ready', ready: true,
    scene: '/scene.png', summary: 'Floodwaters reshape settlements along the valley.',
    causalLink: 'A sequence of unusually wet seasons.', location: { name: 'Upper Valley' }, consequencesStatus: 'Preparing',
  }], onSelect: () => { selected++; } });
  const mapRoot = find(container, 'otherwise-starmap');
  const popup = find(mapRoot, 'map-popup');
  const star = mapRoot.querySelectorAll('.map-star')[0];
  star.dispatch('pointerenter');
  assert.equal(popup.hidden, false);
  assert.equal(find(popup, 'map-popup-title').textContent, 'A new river course');
  assert.equal(find(popup, 'map-popup-meta').textContent, '1200 BCE · Upper Valley · Scene ready · Consequences: Preparing');
  assert.equal(find(popup, 'map-popup-summary').textContent, 'Floodwaters reshape settlements along the valley.');
  assert.equal(find(popup, 'map-popup-context').textContent, 'Speculative cause: A sequence of unusually wet seasons. · Consequences: Preparing');
  assert.equal(find(popup, 'map-popup-summary').className, 'map-popup-summary');
  star.dispatch('focus');
  assert.equal(selected, 0, 'focus only previews');
  assert.equal(find(popup, 'map-popup-summary').textContent, 'Floodwaters reshape settlements along the valley.');
  assert.equal(popup.hidden, false);
  map.destroy();
});

test('preview supports pointer transfer and scrolling, then dismisses after pointer or focus leaves', async () => {
  const { container, find } = makeStarMapDom();
  const map = createStarMap(container, { nodes: [{
    id: 'long-preview', title: 'Long event', year: 500, ready: true,
    summary: 'A detailed narrative. '.repeat(100), scene: '/scene.png',
  }] });
  const mapRoot = find(container, 'otherwise-starmap');
  const popup = find(mapRoot, 'map-popup');
  const star = mapRoot.querySelectorAll('.map-star')[0];
  star.dispatch('pointerenter');
  star.dispatch('pointerleave');
  popup.dispatch('pointerenter');
  assert.equal(popup.hidden, false, 'moving from the node into the card keeps it open');
  assert.equal(popup.dispatch('wheel', { deltaY: 80 }).defaultPrevented, false, 'wheel input scrolls the card instead of zooming the map');
  popup.scrollTop = 25;
  popup.dispatch('pointerdown', { pointerType: 'touch', pointerId: 8, clientY: 100 });
  popup.dispatch('pointermove', { pointerType: 'touch', pointerId: 8, clientY: 60 });
  assert.equal(popup.scrollTop, 65, 'touch drag scrolls card content even with touch-action disabled on an ancestor');
  popup.dispatch('pointerup', { pointerType: 'touch', pointerId: 8 });
  popup.dispatch('pointerleave');
  await new Promise(resolve => setTimeout(resolve, 270));
  assert.equal(popup.hidden, true, 'the card dismisses after the pointer leaves it');

  star.dispatch('focus');
  popup.dispatch('focus');
  star.dispatch('blur');
  assert.equal(popup.hidden, false, 'tabbing from a focused node into the card preserves the preview');
  popup.dispatch('blur');
  await new Promise(resolve => setTimeout(resolve, 5));
  assert.equal(popup.hidden, true, 'the keyboard preview dismisses after focus leaves');
  map.destroy();
});

test('pointer dismissal restores the keyboard-focused node preview', async () => {
  const { container, find } = makeStarMapDom();
  const map = createStarMap(container, { nodes: [
    { id: 'keyboard-node', title: 'Keyboard event', year: 100 },
    { id: 'pointer-node', title: 'Pointer event', year: 200 },
  ] });
  const root = find(container, 'otherwise-starmap');
  const popup = find(root, 'map-popup');
  const [keyboardStar, pointerStar] = root.querySelectorAll('.map-star');
  keyboardStar.dispatch('focus');
  pointerStar.dispatch('pointerenter');
  assert.equal(find(popup, 'map-popup-title').textContent, 'Pointer event');
  pointerStar.dispatch('pointerleave');
  await new Promise(resolve => setTimeout(resolve, 270));
  assert.equal(find(popup, 'map-popup-title').textContent, 'Keyboard event', 'leaving another node restores the focused node instead of stale hover content');
  map.destroy();
});

test('star map exposes the documented update and teardown contract with accessible interaction and reduced motion', () => {
  const source = readFileSync(new URL('../web/starmap.js', import.meta.url), 'utf8');
  assert.match(source, /export function createStarMap\(container, \{ nodes = \[\], selectedId = null, onSelect = \(\) => \{\} \} = \{\}\)/);
  assert.match(source, /setData\(next = \{\}\)/);
  assert.match(source, /destroy\(\) \{ if \(destroyed\) return; destroyed = true; clearPopupDismiss\(\); resizeObserver\?\.disconnect\(\)/);
  assert.match(source, /role: 'button'/);
  assert.match(source, /event\.key === 'Enter' \|\| event\.key === ' '/);
  assert.match(source, /export function projectStarMap/);
  assert.match(source, /export function formatStarMapYear/);
  assert.match(source, /OLDER → LATER/);
  assert.match(source, /Focus selected era/);
  assert.match(source, /OTHER EVENTS HIDDEN/);
  assert.match(source, /viewMode === 'focus' \? 36 : 12/);
  assert.match(source, /const displayX = x => viewMode === 'focus'/);
  assert.match(source, /LOCAL SCALE ×/);
  assert.match(source, /autoFocusSelectedIfWide\(\)/);
  assert.match(source, /autoFocusConsumed \|\| userInteracted/);
  assert.match(source, /aria-label', 'Reset the star map to the full timeline overview'/);
  assert.match(source, /yearCoordinate/);
  assert.match(source, /const panGesture = event\.button === 2 \|\| event\.shiftKey/);
  assert.match(source, /mode: panGesture \? 'pan' : 'orbit'/);
  assert.match(source, /root\.addEventListener\('contextmenu', event => event\.preventDefault\(\)\)/);
  assert.match(source, /Left-drag to orbit · Right-drag or Shift-drag to pan/);
  assert.match(source, /Left-drag to orbit; right-drag or Shift-drag to pan/);
  assert.match(source, /cameraZ - b\.cameraZ/);
  assert.match(source, /ArrowLeft.*yaw/s);
  assert.match(source, /if \(!node \|\| !isNodeReady\(node\)\) return/);
  assert.match(source, /aria-live', 'polite'/);
  assert.match(source, /getScreenCTM\?\.\(\)/);
  assert.match(source, /is-preparing/);
  assert.match(source, /is-unavailable/);
  assert.match(source, /map-star \.star-label,\.otherwise-starmap \.map-star \.star-year\{display:none\}/);
  assert.match(source, /group\.classList\.add\('is-labelled'\)/);
  assert.match(source, /Consequences: \$\{node\.consequencesStatus\}/);
  assert.match(source, /Only events with a ready scene can be selected/);
  assert.match(source, /prefers-reduced-motion:reduce/);
});
