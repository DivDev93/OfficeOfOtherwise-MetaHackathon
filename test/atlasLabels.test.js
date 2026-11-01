import test from 'node:test';
import assert from 'node:assert/strict';
import { createWorldLabelCandidates, edgeMarker, placeScreenLabels, projectedSphereDiameterPixels, shouldShowWorldLabel, worldLabelText } from '../web/atlas/labels.js';

test('offscreen lineage has a directional marker and visible children can be labelled', () => {
  const bounds = { left: 0, right: 300, top: 0, bottom: 200 };
  assert.match(edgeMarker({ x: 130, y: -12 }, bounds, 'A long ancestor'), /^↑ /);
  const entries = [{ id: 'ancestor', lineage: true, world: { title: 'Ancestor' } }, { id: 'child', world: { title: 'Child' } }];
  const labels = createWorldLabelCandidates(entries, { currentId: 'current', bounds, include: e => e.id === 'child', project: e => ({ x: 100, y: e.id === 'ancestor' ? -5 : 100, visible: true }), measure: () => ({ width: 80, height: 18 }) });
  assert.match(labels[0].text, /^↑ /);
  assert.equal(labels[0].fullText, 'Ancestor');
  assert.equal(labels[1].text, 'Child');
  assert.ok(labels[1].priority > labels[0].priority, 'visible Orbit children take precedence over less immediate lineage labels');
});

test('world label text is concise and names the year when present', () => {
  assert.equal(worldLabelText({ title: 'Green Sahara', year: 2100 }), 'Green Sahara · 2100');
  assert.equal(worldLabelText({ title: 'Green Sahara', year: -2800 }), 'Green Sahara · 2800 BCE');
  assert.equal(worldLabelText({ title: 'Sailboats Cross Megalake Chad', year: -2800 }, { yearFirst: true }), '2800 BCE · Sailboats Cross Megalake Chad');
  assert.equal(worldLabelText({ title: 'Present Earth' }), 'Present Earth');
});

test('projected sphere bounds use perspective size for large globe collision regions', () => {
  const diameter = projectedSphereDiameterPixels(25.4, 38, 900, 1.45);
  assert.ok(diameter > 148 && diameter < 152, `expected a roughly 150px projected globe, got ${diameter}px`);
});

test('only the current world, its gold lineage, and a focused world receive world labels', () => {
  const entries = [
    { id: 'current', world: { title: 'Current', year: -2800 }, lineage: true },
    { id: 'ancestor', world: { title: 'Ancestor' }, lineage: true },
    { id: 'focused', world: { title: 'Focused' } },
    { id: 'other', world: { title: 'Other' } },
  ];
  assert.equal(shouldShowWorldLabel(entries[0], 'current', 'focused'), true);
  const candidates = createWorldLabelCandidates(entries, {
    currentId: 'current', focusedId: 'focused',
    project: entry => ({ x: 100, y: 100, visible: true }),
    measure: text => ({ width: text.length * 6.4, height: 16 }),
    yearFirst: true,
  });
  assert.deepEqual(candidates.map(item => item.id), ['current', 'ancestor', 'focused']);
  assert.equal(candidates[0].text, '2800 BCE · Current', 'the year stays visible at the start of a narrow label');
});

test('overlay labels avoid node hit areas and each other, hiding a lower-priority collision', () => {
  const bounds = { left: 0, top: 0, right: 300, bottom: 200 };
  const nodeRects = [{ x: 150, y: 100, width: 48, height: 48 }];
  const placed = placeScreenLabels([
    { id: 'current', text: 'Current · 2026', x: 150, y: 100, width: 100, height: 18, priority: 100 },
  ], bounds, nodeRects);
  assert.ok(placed.every(label => !nodeRects.some(node =>
    Math.abs(node.x - label.x) < (node.width + label.width) / 2
    && Math.abs(node.y - label.y) < (node.height + label.height) / 2)));
  assert.ok(placed.some(label => label.id === 'current'));
  assert.ok(placed.every(label => label.x - label.width / 2 >= 0 && label.x + label.width / 2 <= 300));

  const crowded = placeScreenLabels([
    { id: 'current', x: 30, y: 20, width: 60, height: 18, priority: 100 },
    { id: 'lineage', x: 30, y: 20, width: 60, height: 18, priority: 70 },
  ], { left: 0, top: 0, right: 60, bottom: 40 });
  assert.deepEqual(crowded.map(label => label.id), ['current'], 'the lower-priority label yields when no collision-free placement remains');
});

test('current world label clears the projected globe radius and prefers an open position above it', () => {
  const globe = { x: 720, y: 450, width: 150, height: 150 };
  const [label] = placeScreenLabels([
    { id: 'sahara', text: 'Green Sahara · 2800 BCE', x: 720, y: 410, width: 160, height: 18, priority: 100 },
  ], { left: 0, top: 0, right: 1440, bottom: 900 }, [globe]);
  assert.ok(label, 'the label remains visible when room is available');
  assert.ok(label.y + label.height / 2 < globe.y - globe.height / 2, 'the label sits above the globe silhouette');
});

test('390x844 labels stay inside the mobile safe viewport above a bottom sheet and axis controls', () => {
  const safeBounds = { left: 10, top: 8, right: 380, bottom: 560 };
  const bottomSheet = { x: 195, y: 707, width: 390, height: 274 };
  const compactControls = { x: 195, y: 805, width: 370, height: 58 };
  const [label] = placeScreenLabels([
    { id: 'long-world', text: 'A long mobile title that must not clip past the Atlas edge', x: 386, y: 820, width: 220, height: 18, priority: 100 },
  ], safeBounds, [], [bottomSheet, compactControls]);
  assert.ok(label);
  assert.ok(label.x - label.width / 2 >= safeBounds.left);
  assert.ok(label.x + label.width / 2 <= safeBounds.right);
  assert.ok(label.y - label.height / 2 >= safeBounds.top);
  assert.ok(label.y + label.height / 2 <= safeBounds.bottom);
  assert.ok(![bottomSheet, compactControls].some(rect =>
    Math.abs(rect.x - label.x) < (rect.width + label.width) / 2
    && Math.abs(rect.y - label.y) < (rect.height + label.height) / 2));
});
