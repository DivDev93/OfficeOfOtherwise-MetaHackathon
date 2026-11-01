import test from 'node:test';
import assert from 'node:assert/strict';
import { containsFanRegion, createFanHitRegion, fanMemberOffsets, placeAtlasLabels } from '../web/atlas/screenLayout.js';

function assertWithin(rect, viewport) {
  assert.ok(rect.left >= viewport.left - 1e-7 && rect.top >= viewport.top - 1e-7);
  assert.ok(rect.right <= viewport.left + viewport.width + 1e-7 && rect.bottom <= viewport.top + viewport.height + 1e-7);
}

function assertSeparated(rects, gap = 8) {
  for (let i = 0; i < rects.length; i++) for (let j = i + 1; j < rects.length; j++) {
    const a = rects[i], b = rects[j];
    assert.ok(a.right + gap <= b.left || b.right + gap <= a.left || a.bottom + gap <= b.top || b.bottom + gap <= a.top,
      `${a.id} overlaps ${b.id}`);
  }
}

test('label placement favors current and arrived worlds, tries alternate sides, clamps, and separates visible boxes', () => {
  const viewport = { left: 12, top: 20, width: 390, height: 844 };
  const candidates = [
    { id: 'child-a', anchorX: 194, anchorY: 410, width: 220, height: 36, priority: 40 },
    { id: 'arrived-parent', anchorX: 194, anchorY: 376, width: 220, height: 36, priority: 90 },
    { id: 'child-b', anchorX: 196, anchorY: 412, width: 220, height: 36, priority: 40 },
    { id: 'current', anchorX: 194, anchorY: 410, width: 220, height: 36, priority: 100 },
    { id: 'child-c', anchorX: 195, anchorY: 414, width: 220, height: 36, priority: 40 },
    { id: 'edge-label', anchorX: 13, anchorY: 22, width: 220, height: 36, priority: 30 },
  ];
  const placed = placeAtlasLabels(candidates, { viewport });
  const byId = new Map(placed.map(label => [label.id, label]));
  assert.equal(byId.get('current').visible, true);
  assert.equal(byId.get('arrived-parent').visible, true);
  assert.equal(byId.get('edge-label').visible, true);
  const visible = placed.filter(label => label.visible);
  for (const label of visible) assertWithin(label, viewport);
  assertSeparated(visible);
  const narrow = placeAtlasLabels([{ id: 'narrow-label', anchorX: 90, anchorY: 40, width: 220, height: 36, priority: 1 }], {
    viewport: { left: 0, top: 0, width: 180, height: 80 },
  })[0];
  assert.equal(narrow.width, 180, 'labels shrink to the available viewport width after placement attempts');
});

test('fan offsets are stable by ID and keep seven hit targets at least 44 CSS pixels apart around a centered centroid', () => {
  const ids = ['world-g', 'world-a', 'world-f', 'world-b', 'world-e', 'world-c', 'world-d'];
  const first = fanMemberOffsets(ids, { spacing: 48, maxRadius: 120 });
  const same = fanMemberOffsets([...ids].reverse(), { spacing: 48, maxRadius: 120 });
  assert.deepEqual(first, same);
  assert.equal(first.length, 7);
  const centerX = first.reduce((sum, offset) => sum + offset.x, 0) / first.length;
  const centerY = first.reduce((sum, offset) => sum + offset.y, 0) / first.length;
  assert.ok(Math.abs(centerX) < 1e-9 && Math.abs(centerY) < 1e-9);
  assert.ok(first.every(offset => Math.hypot(offset.x, offset.y) <= 120));
  for (let i = 0; i < first.length; i++) for (let j = i + 1; j < first.length; j++) {
    assert.ok(Math.hypot(first[i].x - first[j].x, first[i].y - first[j].y) >= 44);
  }
});

test('fan transfer region covers the cluster-to-target pointer path and rejects distant points', () => {
  const offsets = fanMemberOffsets(['a', 'b', 'c', 'd', 'e', 'f', 'g']);
  const region = createFanHitRegion({ x: 100, y: 200 }, offsets, { hitRadius: 22, padding: 8 });
  assert.ok(containsFanRegion({ x: 100, y: 200 }, region));
  assert.ok(containsFanRegion({ x: 124, y: 200 }, region), 'pointer remains inside during transfer from cluster to a fanned node');
  assert.equal(containsFanRegion({ x: 100 + region.radius + 1, y: 200 }, region), false);
  assert.equal(containsFanRegion({ x: NaN, y: 0 }, region), false);
});
