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

test('ancestors behind top chrome use a short edge marker while Orbit children keep full labels', () => {
  const bounds = { left: 0, top: 4, right: 300, bottom: 220 };
  const lineageBounds = { ...bounds, top: 84 };
  const header = { x: 150, y: 38, width: 300, height: 76 };
  const candidates = createWorldLabelCandidates([
    { id: 'ancestor', lineage: true, world: { title: 'Sundaland River Plain Unites Islands', year: 1800 } },
    { id: 'child', world: { title: 'Canopy Walkway Network', year: 1978 } },
  ], {
    currentId: 'current', bounds, lineageBounds, reservedRects: [header],
    include: entry => entry.id === 'child',
    project: () => ({ x: 150, y: 10, visible: true }),
    measure: text => ({ width: Math.min(220, text.length * 7.5 + 8), height: 18 }),
  });
  const ancestor = candidates.find(candidate => candidate.id === 'ancestor');
  const child = candidates.find(candidate => candidate.id === 'child');
  assert.match(ancestor.text, /^↑ Sundaland River Plain Unites…$/);
  assert.ok(ancestor.y >= lineageBounds.top + ancestor.height / 2, 'the edge marker is repositioned below the top chrome band');
  assert.equal(child.text, 'Canopy Walkway Network · 1978', 'direct-child labels do not become edge markers');
  const placed = placeScreenLabels([ancestor], bounds, [], [header]);
  assert.equal(placed.length, 1);
  assert.ok(placed[0].y - placed[0].height / 2 > header.y + header.height / 2,
    'the marker clears the header instead of clipping under it');
});

test('admitted direct children get compact edge markers when partially or fully offscreen', () => {
  const bounds = { left: 10, top: 8, right: 365, bottom: 802 };
  const entries = [
    { id: 'right-child', parentId: 'current', world: { title: 'River Canopy School Ferries', year: 2003 } },
    { id: 'left-child', parentId: 'current', world: { title: 'Coastal Seed Archive', year: 1998 } },
    { id: 'folded-child', parentId: 'current', world: { title: 'Folded Canopy Branch', year: 2010 } },
  ];
  const candidates = createWorldLabelCandidates(entries, {
    currentId: 'current', bounds, edgeMarkerIncluded: true, yearFirst: true,
    include: entry => entry.id !== 'folded-child',
    project: entry => entry.id === 'right-child'
      ? { x: 412, y: 386, visible: false }
      : { x: -18, y: 300, visible: false },
    measure: text => ({ width: Math.min(220, text.length * 7.5 + 8), height: 18 }),
  });

  assert.deepEqual(candidates.map(candidate => candidate.id), ['right-child', 'left-child']);
  const right = candidates[0];
  assert.match(right.text, /^→ 2003 · River Canopy School…$/);
  assert.equal(right.fullText, '2003 · River Canopy School Ferries');
  assert.ok(right.x + right.width / 2 <= bounds.right, 'right marker stays inside the mobile viewport');
  assert.ok(right.x - right.width / 2 >= bounds.left, 'right marker has a fully visible title');
  assert.match(candidates[1].text, /^← 1998 · Coastal Seed Archive$/);
  assert.equal(candidates[1].fullText, '1998 · Coastal Seed Archive');
});

test('direct-child edge markers are opt-in and still obey the Unfolded inclusion filter', () => {
  const bounds = { left: 10, top: 8, right: 365, bottom: 802 };
  const child = { id: 'child', world: { title: 'River Canopy', year: 2003 } };
  const project = () => ({ x: 412, y: 386, visible: false });
  const measure = text => ({ width: Math.min(220, text.length * 7.5 + 8), height: 18 });
  assert.deepEqual(createWorldLabelCandidates([child], {
    bounds, project, measure, include: () => true,
  }), [], 'existing callers do not opt into offscreen included labels implicitly');
  assert.deepEqual(createWorldLabelCandidates([child], {
    bounds, edgeMarkerIncluded: true, project, measure, include: () => false,
  }), [], 'folded/excluded children do not receive edge markers');
  assert.deepEqual(createWorldLabelCandidates([child], {
    bounds, edgeMarkerIncluded: true, project: () => ({ x: 180, y: 200, visible: false }), measure, include: () => true,
  }), [], 'an in-bounds point hidden by depth or another visibility rule is still omitted');
  const [candidate] = createWorldLabelCandidates([child], {
    bounds, edgeMarkerIncluded: true, yearFirst: true, project, measure, include: () => true,
  });
  assert.equal(candidate.text, '→ 2003 · River Canopy');
});

test('crowded direct-child labels use compact collision-free edge slots', () => {
  const bounds = { left: 10, top: 8, right: 365, bottom: 220 };
  const centerControls = { x: 187.5, y: 108, width: 355, height: 112 };
  const children = ['a', 'b', 'c'].map(id => ({
    id, text: `200${id === 'a' ? 1 : id === 'b' ? 2 : 3} · ${id.toUpperCase()} Canopy Branch`,
    fullText: `${id.toUpperCase()} Canopy Branch`, x: 187.5, y: 108,
    width: 220, height: 18, priority: 85, kind: 'world', edgeFallback: true,
  }));
  const placed = placeScreenLabels(children, bounds, [], [centerControls]);

  assert.equal(placed.length, 3, 'each direct child fits in a compact edge lane outside the reserved controls');
  assert.ok(placed.every(label => label.edgeFallbackPlacement));
  assert.equal(placed.find(label => label.id === 'a').width, 220, 'the first available fallback retains its full-width title');
  assert.equal(placed.find(label => label.id === 'b').width, 220, 'later rows keep full-width titles while any full slot remains');
  assert.equal(placed.find(label => label.id === 'c').width, 119, 'a half-width sidecar is used only after no full-width slot remains');
  assert.ok(placed.every(label => label.y < centerControls.y - centerControls.height / 2
    || label.y > centerControls.y + centerControls.height / 2));
  assert.ok(placed.every(label => label.text.length <= 32 && label.fullText));
  for (let i = 0; i < placed.length; i++) {
    assert.ok(![centerControls, ...placed.filter((_, j) => i !== j)].some(other =>
      Math.abs(other.x - placed[i].x) < (other.width + placed[i].width) / 2 + 3
      && Math.abs(other.y - placed[i].y) < (other.height + placed[i].height) / 2 + 3));
  }
});

test('direct-child labels clear the visible phone Other questions control', () => {
  const bounds = { left: 0, top: 0, right: 375, bottom: 812 };
  const toggle = { x: 187.5, y: 188, width: 116, height: 38 };
  const [label] = placeScreenLabels([{
    id:'child', text:'2003 · Canopy School', fullText:'2003 · River Canopy School Ferries',
    x:187.5, y:188, width:220, height:18, priority:85, kind:'world', edgeFallback:true,
  }], bounds, [], [toggle]);

  assert.ok(label, 'the direct child remains labelled in the rest of the phone viewport');
  assert.ok(label.y + label.height / 2 < toggle.y - toggle.height / 2 - 3
    || label.y - label.height / 2 > toggle.y + toggle.height / 2 + 3
    || label.x + label.width / 2 < toggle.x - toggle.width / 2 - 3
    || label.x - label.width / 2 > toggle.x + toggle.width / 2 + 3,
  'the label avoids the actual control rectangle with the normal placement gap');
});

test('42 admitted direct children fit when mobile edge lanes have no node blockers', () => {
  const bounds = { left: 10, top: 8, right: 365, bottom: 802 };
  const headerAndToolbar = { x: 187.5, y: 85, width: 355, height: 154 };
  const bottomControls = { x: 187.5, y: 780, width: 355, height: 44 };
  const children = Array.from({ length:42 }, (_, index) => ({
    id: `child-${index}`, text: `→ ${1980 + index} · Canopy Child ${index}`,
    fullText: `Canopy Child ${index}`, x:187.5, y:405, width:220, height:18,
    priority:85, kind:'world', edgeFallback:true,
  }));
  const placed = placeScreenLabels(children, bounds, [], [headerAndToolbar, bottomControls]);

  assert.equal(placed.length, children.length, 'none of the admitted direct children loses its label');
  assert.deepEqual(new Set(placed.map(label => label.id)), new Set(children.map(child => child.id)));
  assert.ok(placed.every(label => label.fullText), 'ellipsized labels retain the complete title for assistive technology and title hover');
  for (let i = 0; i < placed.length; i++) {
    assert.ok(placed[i].x - placed[i].width / 2 >= bounds.left);
    assert.ok(placed[i].x + placed[i].width / 2 <= bounds.right);
    assert.ok(placed[i].y - placed[i].height / 2 >= bounds.top);
    assert.ok(placed[i].y + placed[i].height / 2 <= bounds.bottom);
    assert.ok(![headerAndToolbar, bottomControls, ...placed.filter((_, j) => j !== i)].some(other =>
      Math.abs(other.x - placed[i].x) < (other.width + placed[i].width) / 2 + 3
      && Math.abs(other.y - placed[i].y) < (other.height + placed[i].height) / 2 + 3));
  }
});

test('mobile edge labels route around projected node hit areas when enough slots remain', () => {
  const bounds = { left: 10, top: 8, right: 365, bottom: 802 };
  const headerAndToolbar = { x: 187.5, y: 85, width: 355, height: 154 };
  const bottomControls = { x: 187.5, y: 780, width: 355, height: 44 };
  const nodeRects = [
    { x:28, y:220, width:44, height:44 },
    { x:347, y:470, width:44, height:44 },
    { x:30, y:640, width:44, height:44 },
  ];
  const children = Array.from({ length:32 }, (_, index) => ({
    id: `blocked-child-${index}`, text: `→ ${1980 + index} · Canopy Child ${index}`,
    fullText: `Canopy Child ${index}`, x:187.5, y:405, width:220, height:18,
    priority:85, kind:'world', edgeFallback:true,
  }));
  const placed = placeScreenLabels(children, bounds, nodeRects, [headerAndToolbar, bottomControls]);

  assert.equal(placed.length, children.length, 'labels still fit despite representative left/right projected node blockers');
  for (let i = 0; i < placed.length; i++) {
    assert.ok(![...nodeRects, headerAndToolbar, bottomControls, ...placed.filter((_, j) => j !== i)].some(other =>
      Math.abs(other.x - placed[i].x) < (other.width + placed[i].width) / 2 + 3
      && Math.abs(other.y - placed[i].y) < (other.height + placed[i].height) / 2 + 3));
  }
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
