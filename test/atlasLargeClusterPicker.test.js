import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { needsPagedClusterPicker, createLargeClusterPicker, visibleKeyboardNeighborEntries } from '../web/atlas/largeClusterPicker.js';
import { nearestProjectedAnchorHit, projectedWorldTarget, targetOccludedByEarth } from '../web/atlasLayout.js';
import { planWorldClusters } from '../web/atlas/clusters.js';

class FakeElement {
  constructor(ownerDocument, tagName = 'div') {
    this.ownerDocument = ownerDocument;
    this.tagName = tagName;
    this.children = [];
    this.parentElement = null;
    this.attributes = new Map();
    this.listeners = new Map();
    this.style = {};
    this.dataset = {};
    this.clientWidth = 0;
    this.clientHeight = 0;
    this.hidden = false;
    this.disabled = false;
    this.textContent = '';
  }
  append(...items) {
    for (const item of items) { item.parentElement = this; this.children.push(item); }
  }
  replaceChildren(...items) {
    for (const item of this.children) item.parentElement = null;
    this.children = [];
    this.append(...items);
  }
  setAttribute(name, value) { this.attributes.set(name, String(value)); }
  getAttribute(name) { return this.attributes.get(name) ?? null; }
  addEventListener(type, listener) {
    const list = this.listeners.get(type) || [];
    list.push(listener); this.listeners.set(type, list);
  }
  removeEventListener(type, listener) {
    this.listeners.set(type, (this.listeners.get(type) || []).filter(item => item !== listener));
  }
  dispatch(type, values = {}) {
    const event = {
      type, target: this, currentTarget: this, detail: 0, defaultPrevented: false, stopped: false,
      preventDefault() { this.defaultPrevented = true; }, stopPropagation() { this.stopped = true; },
      ...values,
    };
    for (const listener of this.listeners.get(type) || []) listener(event);
    return event;
  }
  focus() { this.ownerDocument.activeElement = this; this.dispatch('focus'); }
  click(detail = 0) { return this.dispatch('click', { detail }); }
  contains(other) { return this === other || this.children.some(child => child.contains(other)); }
  getBoundingClientRect() { return this.rect || { left: 0, top: 0, width: this.clientWidth, height: this.clientHeight }; }
  remove() {
    if (!this.parentElement) return;
    this.parentElement.children = this.parentElement.children.filter(child => child !== this);
    this.parentElement = null;
  }
}

function fakeDocument() {
  const listeners = new Map();
  const document = {
    activeElement: null,
    defaultView: { innerWidth: 375, innerHeight: 812 },
    createElement(tag) { return new FakeElement(document, tag); },
    addEventListener(type, listener) { const list = listeners.get(type) || []; list.push(listener); listeners.set(type, list); },
    removeEventListener(type, listener) { listeners.set(type, (listeners.get(type) || []).filter(item => item !== listener)); },
    dispatch(type, values = {}) {
      const event = { type, target: document.activeElement, defaultPrevented: false, stopped: false,
        preventDefault() { this.defaultPrevented = true; }, stopPropagation() { this.stopped = true; }, ...values };
      for (const listener of listeners.get(type) || []) listener(event);
      return event;
    },
    listenerCount(type) { return (listeners.get(type) || []).length; },
  };
  document.body = document.createElement('body');
  return document;
}

function largeWorldFixture() {
  const parent = { id: 'saved::root', title: 'Root', year: 1900, parentId: null };
  const worlds = [parent, ...Array.from({ length: 31 }, (_, index) => ({
    id: `saved::child-${String(index + 1).padStart(2, '0')}`,
    parentId: parent.id,
    title: `Saved possibility ${index + 1}`,
    year: 1901 + index,
    explored: index < 2,
    selectable: true,
  }))];
  const plan = planWorldClusters(worlds, parent.id);
  return {
    parent, worlds, plan,
    cluster: plan.orbit.clusters.find(item => item.kind === 'orbit-overflow'),
    surfaceCluster: plan.surface.clusters.find(item => item.kind === 'surface-overflow'),
  };
}

function memberButtons(list) {
  return list.children.map(item => item.children[0]);
}

test('large picker is limited to oversized selectable overflow; explored direct children stay visible', () => {
  const { parent, plan, cluster, surfaceCluster } = largeWorldFixture();
  assert.ok(cluster);
  assert.equal(cluster.memberIds.length, 27);
  assert.equal(needsPagedClusterPicker(cluster), true);
  assert.ok(surfaceCluster);
  assert.equal(surfaceCluster.memberIds.length, 28);
  assert.equal(needsPagedClusterPicker(surfaceCluster), true);
  assert.equal(needsPagedClusterPicker({ ...cluster, memberIds: cluster.memberIds.slice(0, 19) }), false);
  assert.equal(needsPagedClusterPicker({ ...cluster, kind: 'generation-pending' }), false);
  assert.ok(plan.orbit.visibleIds.includes('saved::child-01'));
  assert.ok(plan.orbit.visibleIds.includes('saved::child-02'));
  assert.equal(cluster.memberIds.includes('saved::child-01'), false);
  assert.equal(plan.parentId, parent.id);
});

test('equal-size Orbit and Surface triggers remain distinguishable by accessible name and tooltip', () => {
  const { worlds, cluster, surfaceCluster } = largeWorldFixture();
  const document = fakeDocument();
  const container = document.createElement('div');
  container.clientWidth = 375; container.clientHeight = 812;
  const picker = createLargeClusterPicker({ container, document });
  const equalSurface = { ...surfaceCluster, id: 'equal-surface', memberIds: [...cluster.memberIds] };
  picker.setClusters([cluster, equalSurface], worlds);

  const orbitTrigger = picker.getTrigger(cluster.id);
  const surfaceTrigger = picker.getTrigger(equalSurface.id);
  assert.match(orbitTrigger.getAttribute('aria-label'), /Browse Orbit cluster with 27 saved possibilities/);
  assert.match(surfaceTrigger.getAttribute('aria-label'), /Browse Surface cluster with 27 saved possibilities/);
  assert.notEqual(orbitTrigger.getAttribute('aria-label'), surfaceTrigger.getAttribute('aria-label'));

  orbitTrigger.dispatch('pointerenter', { pointerType: 'mouse' });
  const tooltip = picker.elements.triggerLayer.children.find(child => child.className === 'atlas-large-cluster-tooltip');
  assert.match(tooltip.textContent, /^Orbit · 27 saved possibilities/);
  surfaceTrigger.dispatch('pointerenter', { pointerType: 'mouse' });
  assert.match(tooltip.textContent, /^Surface · 27 saved possibilities/);
  picker.destroy();
});

test('large-cluster targets pass pointer gestures through to scene hit testing while remaining keyboard preview controls', () => {
  const { worlds, cluster } = largeWorldFixture();
  const document = fakeDocument();
  const container = document.createElement('div');
  container.clientWidth = 375; container.clientHeight = 812;
  const selections = [];
  const picker = createLargeClusterPicker({ container, document, onSelect: (...args) => selections.push(args) });
  picker.setClusters([cluster], worlds);
  const trigger = picker.getTrigger(cluster.id);
  picker.setPosition(cluster.id, { x: 180, y: 240, visible: true });

  assert.equal(trigger.tagName, 'button', 'pointer pass-through keeps the trigger keyboard focusable');
  assert.equal(picker.hitTest(151, 211)?.id, cluster.id, 'the 58px scene hit target includes its outer corner');
  assert.equal(picker.hitTest(209, 269)?.id, cluster.id, 'the 58px scene hit target includes its opposite outer corner');
  assert.equal(picker.hitTest(210, 269), null, 'points outside the 58px target do not hit the cluster');
  assert.equal(picker.hitTest(Number.NaN, 240), null);
  assert.equal(picker.preview(cluster.id), true);
  assert.equal(picker.isOpen(), false, 'pointer hover preview never opens the selector');
  assert.equal(picker.preview(null), false);
  assert.equal(picker.elements.triggerLayer.children.find(child => child.className === 'atlas-large-cluster-tooltip').hidden, true);
  assert.equal(selections.length, 0);

  const stylesheet = readFileSync(new URL('../web/style.css', import.meta.url), 'utf8');
  assert.match(stylesheet.match(/\.atlas-large-cluster-trigger\{[^}]*\}/s)?.[0] || '', /pointer-events:none/, 'the overlay must let canvas drag and touch events through');
  picker.destroy();
});

test('overlapping paged-cluster and world targets resolve to the nearer projected anchor', () => {
  const { worlds, cluster } = largeWorldFixture();
  const document = fakeDocument();
  const container = document.createElement('div');
  container.clientWidth = 375; container.clientHeight = 812;
  const picker = createLargeClusterPicker({ container, document });
  picker.setClusters([cluster], worlds);
  picker.setPosition(cluster.id, { x: 180, y: 240, visible: true });

  // Synthetic projected location for a visible world marker overlaps the 58px
  // cluster square. It remains a 44px-radius world hit, represented by the
  // scene's projected-anchor distance record.
  const world = worlds.find(item => item.id === 'saved::child-03');
  const projectedWorld = { id: world.id, x: 200, y: 240 };
  const rawWorldHit = nearestProjectedAnchorHit([{ id: world.id, world, distanceSquared: 0, hitDistance: 1 }]);
  assert.equal(rawWorldHit.world, world, 'nearestProjectedAnchorHit returns the winning hit record directly');
  assert.equal(rawWorldHit.hit, undefined, 'the result is not wrapped in a `.hit` field');
  const worldAtMarker = projectedWorldTarget(rawWorldHit);
  assert.deepEqual(worldAtMarker, { world, distanceSquared: 0, hitDistance: 1 });
  const clusterAtWorld = picker.hitTestCandidate(projectedWorld.x, projectedWorld.y);
  assert.equal(clusterAtWorld.cluster.id, cluster.id);
  assert.equal(clusterAtWorld.distanceSquared, 20 ** 2);
  const clusterCandidate = { ...clusterAtWorld, id: `3:cluster:${cluster.id}`, kind: 'cluster', priority: 3, hitDistance: 2 };
  const worldCandidate = { ...worldAtMarker, id: `0:world:${world.id}`, kind: 'world', priority: 0 };
  assert.equal(nearestProjectedAnchorHit([clusterCandidate, worldCandidate]).kind, 'world',
    'the visible world wins when the pointer is closer to its projected anchor');

  const worldHitAtClusterCenter = { ...worldCandidate, distanceSquared: 20 ** 2 };
  const clusterAtCenter = picker.hitTestCandidate(180, 240);
  const clusterAtCenterCandidate = { ...clusterAtCenter, id: `3:cluster:${cluster.id}`, kind: 'cluster', priority: 3, hitDistance: 2 };
  assert.equal(nearestProjectedAnchorHit([clusterAtCenterCandidate, worldHitAtClusterCenter]).kind, 'cluster',
    'the cluster remains clickable when its own projected anchor is nearer');
  assert.equal(nearestProjectedAnchorHit([clusterAtCenterCandidate, { ...worldHitAtClusterCenter, distanceSquared: clusterAtCenter.distanceSquared }]).kind, 'world',
    'an exact projected tie follows the explicit world-first arbitration policy');
  assert.equal(nearestProjectedAnchorHit([clusterAtCenterCandidate]).kind, 'cluster',
    'the cluster remains pointer reachable outside the 44px world target');

  const question = { id: '1:question:q1', kind: 'question', priority: 1, distanceSquared: 4, hitDistance: 1 };
  const presentEarth = { id: '2:present-earth', kind: 'present', priority: 2, distanceSquared: 25, hitDistance: 1 };
  const ordinaryCluster = { id: '3:cluster:small', kind: 'cluster', priority: 3, distanceSquared: 100, hitDistance: 1 };
  assert.equal(nearestProjectedAnchorHit([clusterCandidate, question, presentEarth, ordinaryCluster]), question,
    'a closer question chip wins inside the paged square');
  assert.equal(nearestProjectedAnchorHit([clusterAtCenterCandidate, { ...question, distanceSquared: 4 ** 2 }]), clusterAtCenterCandidate,
    'a closer paged marker still wins when the chip is farther away');
  assert.equal(nearestProjectedAnchorHit([clusterCandidate, ordinaryCluster]).id, ordinaryCluster.id,
    'a closer nonpaged cluster remains selectable inside the paged square');

  assert.equal(targetOccludedByEarth(8, 4, 1), true, 'a far-side Surface cluster behind the globe is culled');
  assert.equal(targetOccludedByEarth(3, 4, 1), false, 'a front-side Surface cluster remains visible');
  assert.equal(targetOccludedByEarth(8, 4, 0), false, 'the globe does not occlude Orbit/Atlas targets when the surface is absent');
  picker.destroy();
});

test('generation-pending clusters remain hover targets but never win activation arbitration', () => {
  const pending = {
    id: '3:cluster:generation-pending',
    kind: 'cluster',
    cluster: { id: 'generation-pending', kind: 'generation-pending', selectable: false },
    distanceSquared: 0,
    hitDistance: 1,
  };
  const pageTarget = {
    id: '3:cluster:orbit-overflow',
    kind: 'cluster',
    cluster: { id: 'orbit-overflow', kind: 'orbit-overflow', selectable: true },
    distanceSquared: 16,
    hitDistance: 2,
  };

  assert.equal(nearestProjectedAnchorHit([pageTarget, pending]), pending,
    'hover arbitration can keep the nearer pending cloud for fan expansion');
  assert.equal(nearestProjectedAnchorHit([pageTarget, pending], { excludeUnselectableClusters: true }), pageTarget,
    'activation arbitration ignores pending clusters and keeps the selectable target');
  assert.equal(nearestProjectedAnchorHit([pending], { excludeUnselectableClusters: true }), null,
    'a pending-only hit cannot activate anything');
});

test('keyboard graph candidates omit hidden clustered worlds while retaining visible children', () => {
  const entries = [
    { id: 'parent' },
    { id: 'visible-child', parentId: 'parent' },
    { id: 'clustered-child', parentId: 'parent' },
    { id: 'sibling', parentId: 'grandparent' },
  ];
  const origin = entries[0];
  const candidates = visibleKeyboardNeighborEntries(entries, origin, new Set(['parent', 'visible-child', 'sibling']));
  assert.deepEqual(candidates.map(entry => entry.id), ['visible-child']);
});

test('Surface overflow hover/focus stays preview-only and explicit activation selects a saved member', () => {
  const { worlds, surfaceCluster } = largeWorldFixture();
  const document = fakeDocument();
  const container = document.createElement('div');
  container.clientWidth = 375; container.clientHeight = 500;
  const selections = [];
  const picker = createLargeClusterPicker({ container, document, onSelect: (world, context) => selections.push({ world, context }) });
  picker.setClusters([surfaceCluster], worlds);
  const trigger = picker.getTrigger(surfaceCluster.id);
  assert.equal(trigger.tagName, 'button', 'Surface overflow has a native keyboard-focusable trigger');
  assert.match(trigger.getAttribute('aria-label'), /Browse Surface cluster with 28 saved possibilities/);
  picker.setPosition(surfaceCluster.id, { x: 180, y: 240, visible: true });
  trigger.dispatch('pointerenter', { pointerType: 'mouse' });
  assert.equal(picker.isOpen(), false);
  assert.match(picker.elements.triggerLayer.children.find(child => child.className === 'atlas-large-cluster-tooltip').textContent, /28 saved possibilities/);
  trigger.focus();
  assert.equal(picker.isOpen(), false, 'Surface keyboard focus does not enter or select the cluster');
  assert.equal(selections.length, 0);
  trigger.click(0);
  assert.equal(picker.isOpen(), true, 'Enter-equivalent activation opens the Surface choices');
  assert.match(picker.elements.pageStatus.textContent, /1–8 of 28/);
  const firstId = surfaceCluster.memberIds[0];
  memberButtons(picker.elements.list)[0].click(1);
  assert.equal(selections.length, 1);
  assert.equal(selections[0].world.id, firstId);
  assert.equal(selections[0].context.source, 'pointer');
  picker.destroy();
});

test('large picker previews on hover/focus, opens only on explicit activation, pages all children and returns focus', () => {
  const { worlds, cluster, surfaceCluster } = largeWorldFixture();
  const document = fakeDocument();
  const container = document.createElement('div');
  container.clientWidth = 375; container.clientHeight = 500;
  const canvas = document.createElement('canvas');
  const selections = [];
  const picker = createLargeClusterPicker({
    container, document, focusFallback: canvas, pageSize: 8,
    onSelect: (world, context) => selections.push({ world, context }),
  });
  const secondCluster = surfaceCluster;
  picker.setClusters([cluster, secondCluster], worlds);
  const trigger = picker.getTrigger(cluster.id);
  assert.ok(trigger);
  assert.equal(trigger.getAttribute('aria-haspopup'), 'dialog');
  assert.equal(trigger.getAttribute('aria-expanded'), 'false');
  picker.setPosition(cluster.id, { x: 180, y: 260, visible: true });
  assert.equal(trigger.style.left, '151px');
  assert.equal(trigger.style.top, '231px');
  assert.equal(Number.parseFloat(trigger.style.left) + 29, 180, 'trigger CSS left is its true top-left, so the 58px target centers on x=180');
  assert.equal(Number.parseFloat(trigger.style.top) + 29, 260, 'trigger CSS top is its true top-left, so the 58px target centers on y=260');

  trigger.dispatch('pointerenter', { pointerType: 'mouse' });
  assert.equal(picker.isOpen(), false, 'hover exposes the cluster tooltip without opening the selector');
  assert.equal(selections.length, 0, 'hover does not select or call app actions');
  const tooltip = picker.elements.triggerLayer.children.find(child => child.className === 'atlas-large-cluster-tooltip');
  assert.equal(tooltip.hidden, false);
  assert.match(tooltip.textContent, /27 saved possibilities/);
  const tooltipPosition = [tooltip.style.left, tooltip.style.top];
  picker.setPosition(secondCluster.id, { x: 60, y: 90, visible: true });
  assert.deepEqual([tooltip.style.left, tooltip.style.top], tooltipPosition, 'unhovered clusters do not move the hovered trigger tooltip');
  picker.setPosition(secondCluster.id, { x: 370, y: 490, visible: true });
  picker.getTrigger(secondCluster.id).dispatch('pointerenter', { pointerType: 'mouse' });
  assert.ok(Number.parseFloat(tooltip.style.left) >= 8);
  assert.ok(Number.parseFloat(tooltip.style.left) + 240 <= 367, 'edge tooltip is clamped inside the scene width');
  assert.ok(Number.parseFloat(tooltip.style.top) >= 8);
  assert.ok(Number.parseFloat(tooltip.style.top) + 42 <= 492, 'edge tooltip flips above its trigger and stays inside the scene height');

  trigger.focus();
  assert.equal(picker.isOpen(), false, 'keyboard focus alone does not open the selector');
  assert.equal(selections.length, 0);
  trigger.click(0);
  assert.equal(picker.isOpen(), true);
  assert.equal(picker.elements.dialog.getAttribute('aria-modal'), 'true');
  assert.equal(picker.elements.dialog.getAttribute('role'), 'dialog');
  assert.equal(document.activeElement, memberButtons(picker.elements.list)[0]);
  assert.equal(memberButtons(picker.elements.list).length, 8);
  assert.match(picker.elements.pageStatus.textContent, /1–8 of 27/);
  assert.equal(selections.length, 0, 'opening the menu never selects or invokes generation');
  picker.elements.next.focus();
  document.dispatch('keydown', { key: 'Tab' });
  assert.equal(document.activeElement, picker.elements.closeButton, 'Tab wraps at the end of the accessible dialog');
  document.dispatch('keydown', { key: 'Tab', shiftKey: true });
  assert.equal(document.activeElement, picker.elements.next, 'Shift+Tab wraps to the last available dialog control');
  document.dispatch('keydown', { key: 'PageDown' });
  assert.match(picker.elements.pageStatus.textContent, /9–16 of 27/);
  assert.equal(document.activeElement, memberButtons(picker.elements.list)[0]);
  document.dispatch('keydown', { key: 'PageUp' });
  assert.match(picker.elements.pageStatus.textContent, /1–8 of 27/);

  const pages = [];
  while (true) {
    pages.push(...memberButtons(picker.elements.list).map(button => button.dataset.worldId));
    if (picker.elements.next.disabled) break;
    picker.elements.next.click(0);
    assert.equal(document.activeElement, memberButtons(picker.elements.list)[0], 'keyboard pagination focuses the first item on the new page');
  }
  assert.equal(new Set(pages).size, 27);
  assert.equal(pages.length, 27);
  assert.equal(pages.at(-1), 'saved::child-31');
  const chooseLast = memberButtons(picker.elements.list).at(-1);
  chooseLast.click(0);
  assert.equal(picker.isOpen(), false);
  assert.equal(document.activeElement, trigger, 'selection returns focus to its cluster control');
  assert.deepEqual(selections.map(({ world, context }) => [world.id, context.source]), [['saved::child-31', 'keyboard']]);

  trigger.click(0);
  const reopenedFirst = memberButtons(picker.elements.list)[0];
  const expectedFirst = worlds.find(world => world.id === cluster.memberIds[0]);
  assert.equal(reopenedFirst.getAttribute('aria-label'), `${expectedFirst.year} · ${expectedFirst.title}`, 'reopening after selection retains current world titles');
  document.dispatch('keydown', { key: 'Escape' });
  assert.equal(picker.isOpen(), false);
  assert.equal(document.activeElement, trigger, 'Escape returns focus to the cluster control');
  trigger.click(0);
  const outside = document.createElement('button');
  document.dispatch('pointerdown', { target: outside });
  assert.equal(picker.isOpen(), false, 'outside interaction closes the selector');
  assert.equal(document.activeElement, canvas, 'outside dismissal moves focus out of the now-hidden picker');

  trigger.click(0);
  for (let index = 0; index < 3; index++) picker.elements.next.click(0);
  assert.match(picker.elements.pageStatus.textContent, /25–27 of 27/);
  memberButtons(picker.elements.list)[2].focus();
  const smallerCluster = { ...cluster, memberIds: cluster.memberIds.slice(0, 21) };
  picker.setClusters([smallerCluster], worlds);
  assert.match(picker.elements.pageStatus.textContent, /17–21 of 21 · page 3 of 3/);
  assert.equal(memberButtons(picker.elements.list).length, 5);
  assert.equal(document.activeElement, memberButtons(picker.elements.list)[0], 'membership changes clamp the page and restore focus into the remaining list');
  picker.close({ restoreFocus: true });

  trigger.click(1);
  memberButtons(picker.elements.list)[0].click(1);
  assert.equal(selections.at(-1).context.source, 'pointer', 'pointer selection is explicit and carries its pointer source');
  assert.equal(picker.isOpen(), false);
  assert.equal(document.activeElement, canvas, 'pointer selection leaves focus on the Atlas canvas');

  trigger.focus();
  picker.setPosition(cluster.id, { visible: false });
  assert.equal(document.activeElement, canvas, 'hiding a focused cluster control transfers focus to the canvas');

  const stylesheet = readFileSync(new URL('../web/style.css', import.meta.url), 'utf8');
  assert.match(stylesheet, /\.atlas-large-cluster-member\{[^}]*height:44px;min-height:44px/s);
  assert.match(stylesheet, /\.atlas-large-cluster-trigger\{[^}]*width:58px;height:58px/s);
  assert.doesNotMatch(stylesheet.match(/\.atlas-large-cluster-trigger\{[^}]*\}/s)?.[0] || '', /transform:/, 'trigger CSS must not apply a second center translation');
  assert.match(stylesheet, /@media\(max-width:700px\)\{\s*\.atlas-large-cluster-picker\{[^}]*top:max\(218px/s);
  assert.match(stylesheet, /\.atlas-large-cluster-footer button\{[^}]*flex:0 0 44px/s);

  picker.destroy();
  assert.equal(container.children.length, 0);
  assert.equal(document.body.children.length, 0);
  assert.equal(document.listenerCount('keydown'), 0);
  assert.equal(document.listenerCount('pointerdown'), 0);
});

test('paged Orbit target stays fully inside the phone viewport when its scene extends past the right edge', () => {
  const { worlds, cluster } = largeWorldFixture();
  const document = fakeDocument();
  const container = document.createElement('div');
  container.clientWidth = 400; container.clientHeight = 812;
  container.rect = { left: -18, top: 0, width: 400, height: 812, right: 382, bottom: 812 };
  const picker = createLargeClusterPicker({ container, document });
  picker.setClusters([cluster], worlds);
  const projectedAnchor = { x: 384, y: 260 };
  picker.setPosition(cluster.id, { ...projectedAnchor, visible: true });

  const trigger = picker.getTrigger(cluster.id);
  const left = Number.parseFloat(trigger.style.left);
  const top = Number.parseFloat(trigger.style.top);
  const viewportLeft = container.rect.left + left;
  const viewportTop = container.rect.top + top;
  assert.equal(left + 29, 364, 'the hit target is translated into the visible container/viewport intersection');
  assert.ok(viewportLeft >= 0 && viewportLeft + 58 <= document.defaultView.innerWidth);
  assert.ok(viewportTop >= 0 && viewportTop + 58 <= document.defaultView.innerHeight);
  assert.equal(picker.hitTestCandidate(left + 29, top + 29)?.cluster.id, cluster.id,
    'the clamped screen target still resolves to the original cluster');
  assert.deepEqual(projectedAnchor, { x: 384, y: 260 }, 'the projected scene anchor is not rewritten by target clamping');
  picker.destroy();
});
