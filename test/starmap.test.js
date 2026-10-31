import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createStarMap, formatStarMapYear, getStarMapNodeState, layoutStarMap, parseStarMapYear, placeStarMapLabels, projectStarMap } from '../web/starmap.js';

class TestElement {
  constructor(ownerDocument, tagName) {
    this.ownerDocument = ownerDocument; this.tagName = tagName; this.children = []; this.parentElement = null;
    this.attributes = new Map(); this.listeners = new Map(); this.dataset = {}; this.style = {}; this.className = '';
    this.textContent = ''; this.hidden = false; this.width = 900; this.height = 540; this.scrollTop = 0;
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
    for (let node = this; node && !stopped; node = node.parentElement) { event.currentTarget = node; for (const listener of node.listeners.get(type) || []) listener(event); }
    return event;
  }
  closest(selectorList) {
    const selectors = selectorList.split(',').map(value => value.trim());
    for (let node = this; node; node = node.parentElement) if (selectors.some(selector => selector.startsWith('.') && node.classList.contains(selector.slice(1)))) return node;
    return null;
  }
  querySelectorAll(selector) {
    const result = [], matches = node => selector.startsWith('.') && node.classList.contains(selector.slice(1));
    const visit = node => { for (const child of node.children) { if (matches(child)) result.push(child); visit(child); } };
    visit(this); return result;
  }
  getBoundingClientRect() { return { left: 0, top: 0, width: this.width, height: this.height }; }
  remove() { if (this.parentElement) this.parentElement.children = this.parentElement.children.filter(child => child !== this); }
}
function makeStarMapDom() {
  const document = {
    defaultView: { addEventListener() {}, removeEventListener() {} },
    createElement(tag) { return new TestElement(this, tag); }, createElementNS(_namespace, tag) { return new TestElement(this, tag); },
    getElementById(id) { return this.head.children.find(node => node.getAttribute('id') === id) || null; },
  };
  document.head = new TestElement(document, 'head');
  const container = new TestElement(document, 'container');
  const find = (node, className) => node.querySelectorAll(`.${className}`)[0];
  return { container, find };
}

test('flat layout maps older to later horizontally and separates branches vertically', () => {
  const layout = layoutStarMap([
    { id: 'leaf-b', parentId: 'branch-b', year: 220 }, { id: 'root', year: 190 },
    { id: 'branch-a', parentId: 'root', branchId: 'a', year: 210 }, { id: 'branch-b', parentId: 'root', branchId: 'b', year: 210 },
    { id: 'leaf-a', parentId: 'branch-a', year: 230 },
  ]);
  const byId = new Map(layout.map(node => [node.id, node]));
  assert.ok(byId.get('root').x < byId.get('branch-a').x);
  assert.ok(byId.get('branch-a').x < byId.get('leaf-a').x);
  assert.notEqual(byId.get('branch-a').y, byId.get('branch-b').y);
  assert.equal(byId.get('leaf-a').y, byId.get('branch-a').y);
  assert.ok(layout.every(node => node.x >= 0 && node.x <= 900 && node.y < 482));
});

test('BCE and CE dates retain a continuous calendar order without year zero', () => {
  assert.equal(parseStarMapYear('1 BCE'), -1); assert.equal(parseStarMapYear('1 CE'), 1); assert.equal(parseStarMapYear(0), null);
  const positions = new Map(layoutStarMap([{ id: 'bce', year: -1 }, { id: 'ce', year: 1 }]).map(node => [node.id, node.x]));
  assert.ok(positions.get('bce') < positions.get('ce'));
  assert.equal(formatStarMapYear(-1), '1 BCE'); assert.equal(formatStarMapYear(1), '1 CE');
});

test('label layout avoids overlap and clips every visible label to the canvas', () => {
  const nodes = Array.from({ length: 14 }, (_, index) => ({ id: `n${index}`, title: `Possibility ${index} with a long title`, x: 430 + index % 2, y: 180 + Math.floor(index / 2) * 2, year: 100 + index }));
  const placed = [...placeStarMapLabels(nodes, 900, 540).values()].filter(label => !label.hidden);
  assert.ok(placed.length < nodes.length, 'crowded labels are omitted instead of colliding');
  for (let i = 0; i < placed.length; i++) {
    const a = placed[i].rect;
    assert.ok(a.left >= 4 && a.right <= 896 && a.top >= 56 && a.bottom <= 506, 'visible label stays on canvas');
    for (let j = i + 1; j < placed.length; j++) {
      const b = placed[j].rect;
      assert.ok(a.right + 5 <= b.left || b.right + 5 <= a.left || a.bottom + 4 <= b.top || b.bottom + 4 <= a.top, 'visible label boxes do not overlap');
    }
  }
});

test('mobile labels are ellipsized to measured width and remain inside collision boxes', () => {
  const nodes = [
    { id: 'selected', title: 'Buried Oaks Architectural Traditions Along the Mountain Range', x: 270, y: 190, year: 1890 },
    { id: 'freshwater', title: 'Freshwater Agriculture Creates New Settlement Patterns', x: 118, y: 202, year: 1940 },
    { id: 'sundaland', title: 'Sundaland Coastal Exchange Networks', x: 345, y: 280, year: 1980 },
    { id: 'root', title: 'What if people follow a different route?', role: 'root-question', x: 22, y: 440 },
  ];
  const measureText = text => [...text].reduce((width, char) => width + (/[MW@]/.test(char) ? 10 : /[il .]/.test(char) ? 3.5 : 7), 0);
  const placed = [...placeStarMapLabels(nodes, 366, 844, { selectedId: 'selected', measureText }).values()].filter(label => !label.hidden);
  assert.ok(placed.find(label => label.text.includes('Buried'))?.text.endsWith('…'), 'selected long label is shortened to fit');
  for (let i = 0; i < placed.length; i++) {
    const a = placed[i].rect;
    assert.ok(a.left >= 4 && a.right <= 362 && a.top >= 56 && a.bottom <= 810, 'visible label bounds stay inside the narrow canvas');
    assert.ok(measureText(placed[i].text) + 5 <= a.right - a.left, 'rendered label text fits the measured width');
    assert.ok(measureText(placed[i].year, 11) + 5 <= a.right - a.left, 'year text fits the same box');
    for (let j = i + 1; j < placed.length; j++) {
      const b = placed[j].rect;
      assert.ok(a.right + 3 <= b.left || b.right + 3 <= a.left || a.bottom + 3 <= b.top || b.bottom + 3 <= a.top, 'visible label boxes do not overlap');
    }
  }
});

test('star labels reserve the calendar axis title rectangle', () => {
  const titleBounds = { left: 378, right: 522, top: 454, bottom: 477 };
  const labels = placeStarMapLabels([
    { id: 'late', title: 'Late event', year: 1824, x: 450, y: 455 },
  ], 900, 540, { selectedId: 'late', reservedRects: [titleBounds] });
  const label = labels.get('late');
  assert.ok(!label.hidden, 'selected label remains visible by moving to a free position');
  assert.ok(label.rect.right <= titleBounds.left || label.rect.left >= titleBounds.right || label.rect.bottom <= titleBounds.top || label.rect.top >= titleBounds.bottom,
    'event title and year cannot overlap the calendar axis title');
  assert.ok(label.rect.bottom <= titleBounds.top, 'selected label is positioned above the axis title when its node sits on the title lane');
});

test('map state encoding distinguishes root, explored, saved, generating, and unavailable', () => {
  assert.equal(getStarMapNodeState({ role: 'root-question' }), 'root-question');
  assert.equal(getStarMapNodeState({ mapState: 'explored' }), 'explored');
  assert.equal(getStarMapNodeState({ mapState: 'saved-unexplored' }), 'saved-unexplored');
  assert.equal(getStarMapNodeState({ mapState: 'generating' }), 'generating');
  assert.equal(getStarMapNodeState({ mapState: 'unavailable' }), 'unavailable');
});

test('root question starts in a distinct left lane without a fabricated calendar year', () => {
  const layout = new Map(layoutStarMap([
    { id: 'root', role: 'root-question', title: 'What if?' },
    { id: 'early', parentId: 'root', title: 'Earlier', year: -1200 },
    { id: 'later', parentId: 'root', title: 'Later', year: 400 },
  ], { width: 280, height: 400, rootNodeId: 'root' }).map(node => [node.id, node]));
  assert.equal(layout.get('root').yearCoordinate, null);
  assert.equal(layout.get('root').undated, true);
  assert.equal(layout.get('root').x, 22, 'root question stays in its left starting lane');
  assert.ok(layout.get('root').x < layout.get('early').x);
  assert.ok(layout.get('early').x < layout.get('later').x);
  assert.notEqual(layout.get('root').y, layout.get('early').y, 'root question has a distinct vertical lane');
});

test('undated generation placeholders branch beside their parent without invented years', () => {
  const nodes = [
    { id: 'active', title: 'Current world', year: 2040, mapState: 'explored' },
    ...[1, 2, 3].map(index => ({ id: `placeholder:${index}`, parentId: 'active', title: `Generating possibility ${index}`, role: 'generation-placeholder', isExpansionPlaceholder: true, mapState: 'generating', year: null, selectable: false })),
  ];
  const layout = new Map(layoutStarMap(nodes, { width: 390, height: 500 }).map(node => [node.id, node]));
  const parent = layout.get('active'), placeholders = nodes.slice(1).map(node => layout.get(node.id));
  for (const node of placeholders) {
    assert.equal(node.parentId, 'active'); assert.equal(node.yearCoordinate, null); assert.equal(node.yearLabel, 'Time unknown');
    assert.equal(Math.abs(node.x - parent.x), 56, 'unknown-time placeholder sits beside its parent without overlapping its hit circle');
    assert.equal(getStarMapNodeState(node), 'generating');
  }
  assert.equal(new Set(placeholders.map(node => node.y)).size, 3, 'each placeholder gets a distinct branch lane');
  const { container, find } = makeStarMapDom();
  createStarMap(container, { selectedId: 'active', nodes });
  const root = find(container, 'otherwise-starmap'), active = root.querySelectorAll('.map-star').find(star => star.dataset.nodeId === 'active');
  assert.match(active.className, /is-selected/);
  for (const placeholder of root.querySelectorAll('.map-star').filter(star => star.dataset.nodeId.startsWith('placeholder:'))) {
    assert.match(placeholder.className, /is-generating/); assert.equal(placeholder.getAttribute('aria-disabled'), 'true');
  }
});

test('six map states render distinctly and selected lineage stays gold from root through depth six', () => {
  const { container, find } = makeStarMapDom();
  const chain = Array.from({ length: 6 }, (_, index) => ({
    id: `event-${index + 1}`, parentId: index ? `event-${index}` : 'root', title: `Event ${index + 1}`, year: 100 + index * 100,
    mapState: ['explored', 'saved-unexplored', 'generating', 'unavailable', 'explored', 'explored'][index], rootNodeId: 'root',
    lineageIds: ['root', ...Array.from({ length: index + 1 }, (_unused, parentIndex) => `event-${parentIndex + 1}`)],
  }));
  createStarMap(container, { rootNodeId: 'root', selectedId: 'event-6', nodes: [
    { id: 'root', title: 'What if?', role: 'root-question', summary: 'Root prompt' },
    ...chain,
    { id: 'sibling', title: 'Same question sibling', year: 250, mapState: 'saved-unexplored', otherTree: false },
    { id: 'other', title: 'Other tree', year: 250, mapState: 'explored', otherTree: true },
  ] });
  const root = find(container, 'otherwise-starmap'), stars = root.querySelectorAll('.map-star'), edges = root.querySelectorAll('.map-edge');
  const stateClass = id => stars.find(star => star.dataset.nodeId === id).className;
  assert.match(stateClass('root'), /is-root-question/);
  assert.match(stateClass('event-1'), /is-explored/);
  assert.match(stateClass('event-2'), /is-saved-unexplored/);
  assert.match(stateClass('event-3'), /is-generating/);
  assert.match(stateClass('event-4'), /is-unavailable/);
  assert.ok(stars.find(star => star.dataset.nodeId === 'other').classList.contains('is-other-tree'));
  assert.ok(!stars.find(star => star.dataset.nodeId === 'sibling').classList.contains('is-other-tree'), 'same-question nodes stay bright outside the selected ancestry');
  assert.match(stateClass('event-6'), /is-selected.*is-lineage/);
  assert.equal(edges.filter(edge => edge.className.includes('is-selected-lineage')).length, 6);
  assert.equal(find(root, 'map-popup').hidden, true, 'opening a map with a selected node does not open a preview before hover');
  stars.find(star => star.dataset.nodeId === 'event-6').dispatch('pointerenter');
  assert.equal(find(root, 'map-popup-title').textContent, 'Event 6');
  stars.find(star => star.dataset.nodeId === 'root').dispatch('pointerenter');
  assert.match(find(root, 'map-popup-meta').textContent, /^Root question/);
  assert.equal(find(root, 'map-popup-summary').textContent, 'Root prompt');
});

test('generating nodes show particles while unavailable story data can remain actionable', () => {
  const { container, find } = makeStarMapDom();
  let selected = 0;
  createStarMap(container, { nodes: [
    { id: 'busy', title: 'Busy', mapState: 'generating' },
    { id: 'missing', title: 'Missing scene', mapState: 'unavailable', ready: false },
    { id: 'absent', title: 'Missing story data', mapState: 'unavailable', selectable: false },
  ], onSelect: () => { selected++; } });
  const root = find(container, 'otherwise-starmap'), stars = root.querySelectorAll('.map-star');
  const busy = stars.find(star => star.dataset.nodeId === 'busy'), missing = stars.find(star => star.dataset.nodeId === 'missing'), absent = stars.find(star => star.dataset.nodeId === 'absent');
  assert.ok(busy.classList.contains('is-generating')); assert.equal(busy.querySelectorAll('.cloud-particle').length, 6);
  assert.ok(missing.classList.contains('is-unavailable')); assert.equal(missing.getAttribute('aria-disabled'), 'false', 'missing scene imagery does not disable the story node');
  missing.dispatch('click'); assert.equal(selected, 1, 'explicit click still enters the story node');
  missing.dispatch('keydown', { key: 'Enter' }); assert.equal(selected, 2, 'explicit Enter still enters the story node');
  assert.equal(absent.getAttribute('aria-disabled'), 'true');
  absent.dispatch('click'); absent.dispatch('keydown', { key: 'Enter' }); assert.equal(selected, 2, 'actual unavailable data is not selectable');
});

test('44px SVG hit targets remain 44 CSS pixels at 280px and 390px wide containers', () => {
  for (const width of [280, 390]) {
    const { container, find } = makeStarMapDom(); const map = createStarMap(container, { nodes: [{ id: 'hit', title: 'Hit area' }] });
    const root = find(container, 'otherwise-starmap'); root.width = width; root.height = 500;
    const svg = root.children[0]; svg.width = width - 2; svg.height = 498; map.setData({});
    const hit = find(root, 'map-hit'), viewBox = svg.getAttribute('viewBox').split(' ').map(Number);
    assert.equal(viewBox[2], width - 2); assert.equal(viewBox[3], 498);
    assert.equal(Number(hit.getAttribute('r')) * 2 * svg.width / viewBox[2], 44);
    assert.equal(Number(hit.getAttribute('r')) * 2 * svg.height / viewBox[3], 44);
    map.destroy();
  }
});

test('hover and focus only preview; click and Enter select explicitly', () => {
  const { container, find } = makeStarMapDom(); let selections = 0;
  createStarMap(container, { nodes: [{ id: 'one', title: 'An event', year: 1200, location: 'Upper Valley', summary: 'A short account.', mapState: 'explored' }], onSelect: () => { selections++; } });
  const root = find(container, 'otherwise-starmap'), popup = find(root, 'map-popup'), star = root.querySelectorAll('.map-star')[0];
  star.dispatch('pointerenter');
  assert.equal(popup.hidden, false); assert.equal(find(popup, 'map-popup-title').textContent, 'An event');
  assert.equal(find(popup, 'map-popup-meta').textContent, '1200 CE · Upper Valley · explored');
  assert.equal(selections, 0, 'hover is preview only');
  star.dispatch('focus'); assert.equal(selections, 0, 'focus is preview only');
  star.dispatch('keydown', { key: 'Enter', preventDefault() { this.defaultPrevented = true; } });
  assert.equal(selections, 1);
  star.dispatch('click'); assert.equal(selections, 2);
});

test('popup keeps pointer transfer, consumes wheel without map zoom, and dismisses after leaving', async () => {
  const { container, find } = makeStarMapDom();
  createStarMap(container, { nodes: [{ id: 'one', title: 'Long event', mapState: 'explored', summary: 'Detail. '.repeat(30) }] });
  const root = find(container, 'otherwise-starmap'), popup = find(root, 'map-popup'), star = root.querySelectorAll('.map-star')[0];
  star.dispatch('pointerenter'); star.dispatch('pointerleave'); popup.dispatch('pointerenter');
  assert.equal(popup.hidden, false, 'moving into the preview keeps it open');
  const wheel = popup.dispatch('wheel', { deltaY: 80 }); assert.equal(wheel.defaultPrevented, false);
  popup.scrollTop = 25; popup.dispatch('pointerdown', { pointerType: 'touch', pointerId: 8, clientY: 100 }); popup.dispatch('pointermove', { pointerType: 'touch', pointerId: 8, clientY: 60 });
  assert.equal(popup.scrollTop, 65);
  popup.dispatch('pointerleave'); await new Promise(resolve => setTimeout(resolve, 240)); assert.equal(popup.hidden, true);
});

test('map text uses high-contrast parchment tokens and touch targets meet 44px minimum', () => {
  const source = readFileSync(new URL('../web/starmap.js', import.meta.url), 'utf8');
  const paper = '#ece4d4', background = '#100e0d';
  const luminance = hex => { const rgb = hex.match(/[\da-f]{2}/gi).map(value => parseInt(value, 16) / 255).map(value => value <= .04045 ? value / 12.92 : ((value + .055) / 1.055) ** 2.4); return .2126 * rgb[0] + .7152 * rgb[1] + .0722 * rgb[2]; };
  const ratio = (a, b) => { const [high, low] = [luminance(a), luminance(b)].sort((x, y) => y - x); return (high + .05) / (low + .05); };
  assert.ok(ratio(paper, background) >= 4.5);
  assert.ok(ratio('#d6cabb', '#1d1915') >= 4.5, 'muted popup metadata and helper text retain readable contrast');
  assert.ok(ratio('#e5c07b', background) >= 4.5, 'selected gold remains distinct against the map');
  assert.ok(source.includes('min-width:44px;min-height:44px'));
  assert.match(source, /--map-serif:var\(--serif,'Cormorant Garamond',Georgia,serif\)/);
  assert.match(source, /TIME · OLDER  ←  EARLIER  →  LATER/);
  assert.match(source, /map-star\.is-other-tree \.star-halo,\.otherwise-starmap \.map-star\.is-other-tree \.star-core\{opacity:\.42\}/);
  assert.doesNotMatch(source, /map-star\.is-other-tree\{opacity:/, 'other-tree dimming must not reduce parchment label opacity');
});

test('optional orbit changes projection and Flat restores the chronological baseline', () => {
  const source = readFileSync(new URL('../web/starmap.js', import.meta.url), 'utf8');
  const page = readFileSync(new URL('../web/index.html', import.meta.url), 'utf8');
  assert.equal(typeof projectStarMap, 'function');
  const sample = [{ id: 'a', x: 90, y: 100, lane: 0 }, { id: 'b', x: 810, y: 200, lane: 4 }];
  const flat = sample.map(node => ({ screenX: node.x, screenY: node.y }));
  const orbit = projectStarMap(sample, { yaw: .42, pitch: .3, width: 900, height: 540 });
  assert.notDeepEqual(orbit.map(({ screenX, screenY }) => ({ screenX, screenY })), flat, 'orbit rotates the event projection');
  assert.ok(orbit.every(node => node.screenX >= 30 && node.screenX <= 870 && node.screenY >= 56 && node.screenY <= 484), 'orbit remains bounded to the canvas');
  assert.ok(projectStarMap(sample, { yaw: .42, zoom: 1.35, width: 900, height: 540 }).every(node => Number.isFinite(node.screenX) && Number.isFinite(node.screenY)));
  assert.match(source, /setData\(next = \{\}\)/); assert.match(source, /destroy\(\)/);
  assert.match(source, /setAttribute\('aria-label', 'Use optional orbit layout'\)/);
  const { container, find } = makeStarMapDom();
  createStarMap(container, { nodes: sample });
  const root = find(container, 'otherwise-starmap'), controls = root.children[3], flatButton = controls.children[0], orbitButton = controls.children[1];
  const star = () => root.querySelectorAll('.map-star').find(node => node.dataset.nodeId === 'a');
  const flatTransform = star().getAttribute('transform');
  orbitButton.dispatch('click');
  const orbitTransform = star().getAttribute('transform');
  assert.notEqual(orbitTransform, flatTransform, 'Orbit button activates the rotated projection');
  root.dispatch('keydown', { key: 'ArrowRight', preventDefault() {} });
  assert.notEqual(star().getAttribute('transform'), orbitTransform, 'keyboard arrows rotate the orbit');
  const keyboardTransform = star().getAttribute('transform');
  root.dispatch('pointerdown', { button: 0, pointerId: 3, clientX: 10, clientY: 10 });
  root.dispatch('pointermove', { pointerId: 3, clientX: 70, clientY: 24 });
  root.dispatch('pointerup', { pointerId: 3 });
  assert.notEqual(star().getAttribute('transform'), keyboardTransform, 'pointer drag rotates the orbit');
  const beforeZoom = star().getAttribute('transform');
  root.dispatch('wheel', { deltaY: -100 });
  assert.notEqual(star().getAttribute('transform'), beforeZoom, 'wheel zoom changes the projection');
  flatButton.dispatch('click');
  assert.equal(star().getAttribute('transform'), flatTransform, 'Flat restores the left-to-right timeline');
  assert.match(page, /flat timeline.*older.*left.*later.*right/i);
  const mapInstructions = [
    page.match(/<p class="exploration-map-help">([^<]*)<\/p>/)?.[1] || '',
    page.match(/<p id="exploration-map-instructions"[^>]*>([^<]*)<\/p>/)?.[1] || '',
  ].join(' ');
  assert.match(mapInstructions, /orbit/i);
});
