import test from 'node:test';
import assert from 'node:assert/strict';
import { createOrbitChildLabelLeader, createWorldLabelCandidates, edgeMarker, layoutOrbitChildLabelLanes, layoutOrbitChildLabels, placeOrbitFallbackDock, placeOrbitFallbackPanel, placeScreenLabels, projectedSphereDiameterPixels, resolveOrbitFallbackMount, shouldShowWorldLabel, visibleViewportObstacleRects, viewportObstacleRectsFromCenters, worldLabelText } from '../web/atlas/labels.js';

test('offscreen lineage has a directional marker and visible children can be labelled', () => {
  const bounds = { left: 0, right: 300, top: 0, bottom: 200 };
  assert.match(edgeMarker({ x: 130, y: -12 }, bounds, 'A long ancestor'), /^↑ /);
  assert.match(edgeMarker({ x: 130, y: 250 }, { left:250, right:250, top:130, bottom:130 }, 'Unknown root · Undated'), /^↙ /,
    'a shelf marker points down-left when its node is below and left of the placed label');
  const entries = [{ id: 'ancestor', lineage: true, world: { title: 'Ancestor' } }, { id: 'child', world: { title: 'Child' } }];
  const labels = createWorldLabelCandidates(entries, { currentId: 'current', bounds, include: e => e.id === 'child', project: e => ({ x: 100, y: e.id === 'ancestor' ? -5 : 100, visible: true }), measure: () => ({ width: 80, height: 18 }) });
  assert.match(labels[0].text, /^↑ /);
  assert.equal(labels[0].fullText, 'Ancestor · Undated');
  assert.equal(labels[1].text, 'Child · Undated');
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

test('labels avoid only the visible fading story sheet and preserve labels in clear canvas space', () => {
  const bounds = { left:0, top:0, right:375, bottom:812 };
  // At 375x812, the phone Lift sheet is about 260px high and sits 10px above
  // the bottom edge, so its top is approximately y=542.
  const fadingSheet = { x:187.5, y:672, width:357, height:260 };
  const labels = [
    { id:'under-sheet', text:'Canopy Walkway · 1978', x:187.5, y:610, width:180, height:20, priority:100 },
    { id:'near-sheet-edge', text:'Forest Pharmacy · 1902', x:187.5, y:480, width:180, height:20, priority:80 },
  ];

  const placed = placeScreenLabels(labels, bounds, [], [fadingSheet]);
  const clear = placed.find(label => label.id === 'near-sheet-edge');

  assert.equal(placed.length, 1, 'only the label with no clear placement is suppressed');
  assert.equal(placed.some(label => label.id === 'under-sheet'), false, 'the label under the story sheet cannot show through it');
  assert.ok(clear, 'the label just above the story sheet remains available');
  assert.equal(clear.x, 187.5);
  assert.ok(clear.y + clear.height / 2 < fadingSheet.y - fadingSheet.height / 2 - 3
    || clear.y - clear.height / 2 > fadingSheet.y + fadingSheet.height / 2 + 3,
  'the near-edge label remains outside the realistic fading sheet bounds');
});

test('Orbit child label lanes retain every child and scroll overflow around reserved controls', () => {
  const bounds = { left: 0, top: 0, right: 375, bottom: 190 };
  const toolbar = { x: 187.5, y: 90, width: 355, height: 90 };
  const children = Array.from({ length: 8 }, (_, index) => ({
    id: `child-${index}`, text: `200${index} · Canopy Child ${index}`,
    fullText: `Canopy Child ${index} full title`,
  }));
  const result = layoutOrbitChildLabelLanes(children, bounds, [toolbar]);

  assert.deepEqual(new Set(result.labels.map(label => label.id)), new Set(children.map(child => child.id)));
  assert.equal(result.labels.length, children.length);
  assert.equal(result.blocked, false);
  assert.ok(result.scrollable, 'labels beyond safe rows stay in scrollable lane content');
  assert.equal(result.overflowIds.length, children.length - result.lanes.reduce((sum, lane) => sum + lane.visibleCount, 0));
  assert.ok(result.lanes.length <= 2, 'children share at most two grouped edge rails');
  assert.ok(result.labels.every(label => label.fullText.endsWith('full title')));
  assert.ok(result.lanes.some(lane => lane.scrollable));
  for (const lane of result.lanes) {
    assert.ok(lane.x >= bounds.left && lane.x + lane.width <= bounds.right);
    assert.ok(lane.y >= bounds.top && lane.y + lane.height <= bounds.bottom);
    assert.ok(lane.y + lane.height <= toolbar.y - toolbar.height / 2 - 6
      || lane.y >= toolbar.y + toolbar.height / 2 + 6,
    'lane viewport clears reserved control bounds and its safety gap');
  }
  for (const label of result.labels.filter(item => item.visible)) {
    const lane = result.lanes.find(item => item.id === label.laneId);
    assert.ok(label.top + label.height <= lane.height - 2, 'visible rows fit inside the lane client area after its 1px borders');
  }
});

test('Orbit lane includes its borders around one 44px row and blocks when the outer box is too short', () => {
  const child = [{ id:'border-fit', text:'Canopy Child', fullText:'Canopy Child' }];
  const fits = layoutOrbitChildLabelLanes(child, { left:0, top:0, right:200, bottom:46 }, [], {
    rowHeight:44, laneBorder:2,
  });
  assert.equal(fits.blocked, false);
  assert.equal(fits.lanes[0].height, 46, 'the outer border-box adds 2px around the usable 44px row');
  assert.equal(fits.lanes[0].contentHeight, 44);
  assert.equal(fits.lanes[0].visibleCount, 1);

  const tooShort = layoutOrbitChildLabelLanes(child, { left:0, top:0, right:200, bottom:45 }, [], {
    rowHeight:44, laneBorder:2,
  });
  assert.equal(tooShort.blocked, true, 'a 45px region cannot contain a 44px row plus both lane borders');
  assert.equal(tooShort.lanes[0].reason, 'viewport-too-small');
  assert.deepEqual(tooShort.overflowIds, ['border-fit'], 'the identity remains available to the existing fallback');
});

test('normal Orbit density displays every child in two grouped lanes without covering its nodes', () => {
  const bounds = { left: 4, top: 4, right: 1436, bottom: 896 };
  const children = Array.from({ length: 6 }, (_, index) => ({ id:`normal-${index}`, text:`Child ${index}`, fullText:`Child ${index} complete identity` }));
  const controls = [{ x:720, y:72, width:560, height:88 }];
  const nodes = [{ x:80, y:350, width:52, height:52 }, { x:1360, y:610, width:52, height:52 }];
  const result = layoutOrbitChildLabelLanes(children, bounds, [...controls, ...nodes]);

  assert.equal(result.blocked, false);
  assert.equal(result.lanes.length, 2, 'labels stay grouped into one rail on each side');
  assert.equal(result.labels.length, children.length);
  assert.ok(result.labels.every(label => label.visible));
  assert.equal(result.scrollable, false);
  assert.ok(result.lanes.every(lane => lane.height === lane.contentHeight + 2 && lane.height < bounds.bottom - bounds.top),
    'non-overflow rails shrink to their rows plus the 1px borders');
  assert.ok(result.lanes.every(lane => lane.height - 2 >= 44), 'each 44px row remains fully inside the lane client height');
  assert.ok(result.lanes.every(lane => lane.width < 320), 'short identities use compact rail widths');
  for (const lane of result.lanes) {
    for (const blocker of [...controls, ...nodes]) {
      assert.ok(lane.x + lane.width <= blocker.x - blocker.width / 2 - 6
        || lane.x >= blocker.x + blocker.width / 2 + 6
        || lane.y + lane.height <= blocker.y - blocker.height / 2 - 6
        || lane.y >= blocker.y + blocker.height / 2 + 6,
      'each lane clears its controls and projected nodes');
    }
  }
});

test('Orbit labels stay near their own projected nodes when space allows and lane only the crowded remainder', () => {
  const bounds = { left:0, top:0, right:1200, bottom:760 };
  const children = [
    { id:'west', text:'West canopy · 1978', fullText:'West canopy', x:250, y:250, width:220, height:44 },
    { id:'east', text:'East canopy · 1992', fullText:'East canopy', x:940, y:520, width:220, height:44 },
    { id:'crowded-a', text:'Crowded A · 2001', fullText:'Crowded A', x:600, y:380, width:220, height:44 },
    { id:'crowded-b', text:'Crowded B · 2002', fullText:'Crowded B', x:600, y:380, width:220, height:44 },
    { id:'crowded-c', text:'Crowded C · 2003', fullText:'Crowded C', x:600, y:380, width:220, height:44 },
    { id:'crowded-d', text:'Crowded D · 2004', fullText:'Crowded D', x:600, y:380, width:220, height:44 },
    { id:'crowded-e', text:'Crowded E · 2005', fullText:'Crowded E', x:600, y:380, width:220, height:44 },
    { id:'crowded-f', text:'Crowded F · 2006', fullText:'Crowded F', x:600, y:380, width:220, height:44 },
  ];
  const nodes = children.map(child => ({ x:child.x, y:child.y, width:48, height:48 }));
  const controls = [{ x:970, y:130, width:300, height:72 }];
  const result = layoutOrbitChildLabels(children, bounds, nodes, controls, {
    rowHeight:44, rowGap:4, minLaneWidth:96, maxLaneWidth:320,
  });

  assert.ok(result.local.some(label => label.id === 'east') && result.local.some(label => label.id === 'west'));
  assert.ok(result.labels.length > 0, 'only the children that cannot fit near their crowded nodes fall back to edge lanes');
  assert.deepEqual(new Set([...result.local, ...result.labels].map(label => label.id)),
    new Set(children.map(child => child.id)), 'every direct child remains represented');
  assert.ok(result.local.every(label => label.height >= 44));
  assert.ok(result.local.every(label => Math.hypot(label.x - children.find(child => child.id === label.id).x,
    label.y - children.find(child => child.id === label.id).y) < 180),
  'labels that fit stay near their own projected nodes');
  for (const label of result.local) {
    for (const blocker of [...nodes, ...controls]) {
      assert.ok(Math.abs(label.x - blocker.x) >= (label.width + blocker.width) / 2 + 3
        || Math.abs(label.y - blocker.y) >= (label.height + blocker.height) / 2 + 3,
      'near-node label clears every node hit area and control');
    }
  }
});

test('Orbit child label lanes hand every identity to the visible fallback when the viewport cannot fit a lane', () => {
  const children = [{ id: 'a', text: 'A', fullText:'A complete title' }, { id: 'b', text: 'B', fullText:'B complete title' }];
  const result = layoutOrbitChildLabelLanes(children,
    { left: 0, top: 0, right: 80, bottom: 30 }, []);

  assert.equal(result.blocked, true);
  assert.equal(result.lanes[0].blocked, true);
  assert.equal(result.lanes[0].reason, 'viewport-too-small');
  assert.deepEqual(result.overflowIds, ['a', 'b']);
  assert.deepEqual(result.labels.map(label => label.id), ['a', 'b']);
  assert.deepEqual(result.labels.map(label => label.fullText), ['A complete title', 'B complete title']);
  assert.ok(result.labels.every(label => !label.visible && label.laneId === 'orbit-label-overflow'));
});

test('Orbit fallback drawer finds visible viewport space around controls and fits a heading plus a 44px row', () => {
  const bounds = { left:0, top:0, right:390, bottom:844 };
  const controls = [
    { left:8, top:8, right:180, bottom:72 },
    { left:8, top:110, right:382, bottom:190 },
    { left:10, top:760, right:380, bottom:834 },
  ];
  const panel = placeOrbitFallbackPanel(bounds, controls);
  assert.ok(panel, 'compact viewport has a control-free region for the fallback');
  assert.ok(panel.left >= bounds.left && panel.top >= bounds.top);
  assert.ok(panel.right <= bounds.right && panel.bottom <= bounds.bottom);
  assert.ok(panel.height >= 88, 'the viewport slot leaves room for the heading, padding, and one 44px child label');
  assert.ok(controls.every(control => panel.right <= control.left - 10 || panel.left >= control.right + 10
    || panel.bottom <= control.top - 10 || panel.top >= control.bottom + 10), 'drawer clears every reserved control');
  assert.equal(placeOrbitFallbackPanel({ left:0, top:0, right:80, bottom:54 }, []), null,
    'a viewport too short to show a 44px target is reported as physically too small');
});

test('compact Orbit fallback dock fits a 44px child label in a constrained 375px viewport', () => {
  const bounds = { left:0, top:0, right:375, bottom:812 };
  const controls = [
    { left:0, top:0, right:375, bottom:180 },
    { left:0, top:268, right:375, bottom:812 },
  ];
  assert.equal(placeOrbitFallbackPanel(bounds, controls), null,
    'the full panel with a heading does not fit the remaining 88px phone gap plus safety margins');
  const dock = placeOrbitFallbackDock(bounds, controls, { maxWidth:220 });
  assert.ok(dock?.compact, 'the compact panel is a visible portal candidate');
  assert.equal(dock.height, 62, '8px vertical padding and borders leave a complete 44px row');
  assert.ok(dock.left >= bounds.left && dock.right <= bounds.right
    && dock.top >= bounds.top && dock.bottom <= bounds.bottom);
  assert.ok(controls.every(control => dock.right <= control.left - 10 || dock.left >= control.right + 10
    || dock.bottom <= control.top - 10 || dock.top >= control.bottom + 10),
  'the dock clears phone controls');
  assert.deepEqual(resolveOrbitFallbackMount({ hasTree:true, portalRect:dock }),
    { mode:'portal', visible:true, hint:false }, 'blocked children stay labeled in Orbit without a tree-reopen action');
});

test('Orbit fallback never puts a dock over controls when every viewport slot is blocked', () => {
  const bounds = { left:0, top:0, right:375, bottom:812 };
  const controls = [{ left:0, top:0, right:375, bottom:812 }];

  assert.equal(placeOrbitFallbackPanel(bounds, controls), null,
    'the full fallback panel has no control-free slot');
  assert.equal(placeOrbitFallbackDock(bounds, controls), null,
    'the compact 44px dock also remains clear of controls');
  assert.deepEqual(resolveOrbitFallbackMount({ invitationVisible:true, hasTree:true, portalRect:null }),
    { mode:'invitation', visible:true, hint:false },
    'direct child labels fall back into an already visible host instead of covering a control');
});

test('compact Orbit dock may use projected globe space but stays clear of controls and existing labels', () => {
  const bounds = { left:0, top:0, right:1440, bottom:900 };
  const controls = [{ left:0, top:0, right:1440, bottom:180 }];
  const labels = [{ left:500, top:240, right:940, bottom:300 }];
  const nodeObstacles = [
    { left:0, top:190, right:1440, bottom:890 },
  ];
  const strict = placeOrbitFallbackDock(bounds, [...controls, ...labels, ...nodeObstacles]);
  assert.equal(strict, null, 'a dense projected sphere field blocks the strict placement');
  const dock = placeOrbitFallbackDock(bounds, [...controls, ...labels]);
  assert.ok(dock, 'the visible fallback can use globe space when every control and existing label stays reserved');
  assert.ok(controls.concat(labels).every(obstacle => dock.right <= obstacle.left - 10
    || dock.left >= obstacle.right + 10 || dock.bottom <= obstacle.top - 10 || dock.top >= obstacle.bottom + 10));
});

test('Orbit fallback converts projected node hit areas to viewport obstacles before portal placement', () => {
  const bounds = { left:0, top:0, right:500, bottom:400 };
  const projectedNodes = [
    { x:75, y:200, width:150, height:300 },
    { x:NaN, y:20, width:44, height:44 },
  ];
  const nodeObstacles = viewportObstacleRectsFromCenters(projectedNodes);

  assert.deepEqual(nodeObstacles, [{ left:0, top:50, right:150, bottom:350 }],
    'projectPoint coordinates are viewport centers and the helper produces viewport edges');
  const unguarded = placeOrbitFallbackPanel(bounds, []);
  const guarded = placeOrbitFallbackPanel(bounds, nodeObstacles);
  assert.ok(unguarded.left < nodeObstacles[0].right,
    'without projected-node obstacles, the first portal candidate overlaps the globe hit area');
  assert.ok(guarded.left >= nodeObstacles[0].right + 10
    || guarded.right <= nodeObstacles[0].left - 10
    || guarded.top >= nodeObstacles[0].bottom + 10
    || guarded.bottom <= nodeObstacles[0].top - 10,
  'the chosen fallback panel clears the projected globe and its 44px interaction region');

  const localLabelObstacles = viewportObstacleRectsFromCenters([
    { x:350, y:300, width:220, height:44 },
  ]);
  const localLabelPanel = placeOrbitFallbackPanel({ left:0, top:0, right:700, bottom:600 }, localLabelObstacles);
  assert.ok(localLabelPanel, 'the expanded viewport still has room for a fallback panel');
  assert.ok(localLabelPanel.right <= localLabelObstacles[0].left - 10
    || localLabelPanel.left >= localLabelObstacles[0].right + 10
    || localLabelPanel.bottom <= localLabelObstacles[0].top - 10
    || localLabelPanel.top >= localLabelObstacles[0].bottom + 10,
  'the fallback drawer clears labels already placed near their projected nodes');
});

test('Orbit child leaders stop at label and node hit-area edges and are suppressed when they cross blockers', () => {
  const label = { left:10, top:10, right:110, bottom:54 };
  const target = { left:330, top:10, right:374, bottom:54 };
  const clear = createOrbitChildLabelLeader(label, target, []);
  assert.deepEqual(clear, { x1:110, y1:32, x2:330, y2:32 },
    'the straight leader joins the hit-area edges without entering either target');
  assert.equal(createOrbitChildLabelLeader(label, target, [{ left:180, top:0, right:220, bottom:80 }]), null,
    'a leader crossing another node or control is omitted instead of rerouted across it');
  assert.equal(createOrbitChildLabelLeader(label, target, [{ left:180, top:70, right:220, bottom:110 }])?.x1, 110,
    'an unrelated nearby obstacle does not suppress a clear association');
  assert.equal(createOrbitChildLabelLeader(label, { left:60, top:18, right:100, bottom:50 }, []), null,
    'overlapping label and node hit areas do not get a misleading connector');
  const first = createOrbitChildLabelLeader(
    { left:10, top:10, right:50, bottom:50 }, { left:210, top:190, right:250, bottom:230 }, []);
  assert.ok(first);
  assert.equal(createOrbitChildLabelLeader(
    { left:10, top:190, right:50, bottom:230 }, { left:210, top:10, right:250, bottom:50 }, [first]), null,
  'a later association is omitted when it would cross an existing leader');
});

test('Orbit fallback prefers visible direct labels over a tree-reopen hint when a safe portal slot fits', () => {
  assert.deepEqual(resolveOrbitFallbackMount({ treeVisible:true, hasTree:true,
    portalRect:{ left:12, top:200, right:300, bottom:300 } }),
  { mode:'portal', visible:true, hint:false }, 'focused Atlas keeps direct child labels visible while the tree is open');
  assert.deepEqual(resolveOrbitFallbackMount({ treeVisible:true, hasTree:true, portalRect:null }),
    { mode:'tree', visible:true, hint:false }, 'an already visible tree can host labels if the viewport has no safe slot');
  assert.deepEqual(resolveOrbitFallbackMount({ hasTree:true, invitationVisible:false, portalRect:null }),
    { mode:'tree-reopen', visible:false, hint:true }, 'focused mode gets a visible Story tree action that reveals the list');
  assert.deepEqual(resolveOrbitFallbackMount({ hasTree:true, invitationVisible:true, portalRect:null }),
    { mode:'invitation', visible:true, hint:false }, 'invitation-open gets its labels in the visible invitation flow');
  assert.deepEqual(resolveOrbitFallbackMount({ hasTree:false, hasEmbeddedHost:true, portalRect:null }),
    { mode:'embedded-flow', visible:true, hint:false }, 'an embedded scene without application panels keeps labels in its host');
  assert.deepEqual(resolveOrbitFallbackMount({ hasTree:false, hasEmbeddedHost:false, portalRect:null }),
    { mode:'unavailable', visible:false, hint:false }, 'report when neither viewport space nor a visible host exists');
});

test('Orbit fallback measures visible rail and invitation DOM bounds before choosing portal placement', () => {
  const rail = { getBoundingClientRect:() => ({ left:0, top:90, right:120, bottom:844, width:120, height:754 }) };
  const invitation = { getBoundingClientRect:() => ({ left:12, top:590, right:378, bottom:832, width:366, height:242 }) };
  const hiddenTree = { getBoundingClientRect:() => ({ left:0, top:0, right:0, bottom:0, width:0, height:0 }) };
  const document = {
    querySelectorAll:() => [rail, invitation, hiddenTree],
    defaultView:{ getComputedStyle:element => element === hiddenTree
      ? { display:'none', visibility:'hidden', opacity:'0' }
      : { display:'block', visibility:'visible', opacity:'1' } },
  };
  const obstacles = visibleViewportObstacleRects(document, '.exploration-rail, #invitation, #exploration-tree');
  assert.deepEqual(obstacles, [
    { left:0, top:90, right:120, bottom:844 },
    { left:12, top:590, right:378, bottom:832 },
  ]);
  const panel = placeOrbitFallbackPanel({ left:0, top:0, right:390, bottom:844 }, obstacles);
  assert.ok(panel, 'a visible drawer can be placed outside the rail and invitation');
  assert.ok(obstacles.every(control => panel.right <= control.left - 10 || panel.left >= control.right + 10
    || panel.bottom <= control.top - 10 || panel.top >= control.bottom + 10));
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

test('world label text names valid years and clearly marks invalid or missing years as undated', () => {
  assert.equal(worldLabelText({ title: 'Green Sahara', year: 2100 }), 'Green Sahara · 2100');
  assert.equal(worldLabelText({ title: 'Green Sahara', year: -2800 }), 'Green Sahara · 2800 BCE');
  assert.equal(worldLabelText({ title: 'Sailboats Cross Megalake Chad', year: -2800 }, { yearFirst: true }), '2800 BCE · Sailboats Cross Megalake Chad');
  assert.equal(worldLabelText({ title: 'Unknown event' }), 'Unknown event · Undated');
  assert.equal(worldLabelText({ title: 'Year zero event', year: 0 }), 'Year zero event · Undated');
  assert.equal(worldLabelText({ title: 'Invalid event', year: 'unknown' }), 'Invalid event · Undated');
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

test('selected and ancestry labels reach safe phone edge slots when settled Atlas obstacles block local placement', () => {
  for (const width of [390, 375]) {
    const safe = { left:10, top:8, right:width - 10, bottom:560 };
    const controls = [
      { x:width / 2, y:48, width:width - 30, height:80 },
      { x:width / 2, y:290, width:160, height:300 },
    ];
    const nodes = [
      { x:width / 2, y:300, width:64, height:64 },
      { x:width / 2 + 62, y:264, width:44, height:44 },
    ];
    const candidates = createWorldLabelCandidates([
      { id:'selected', world:{ title:'Leaf possibility', year:1900 } },
      { id:'parent', world:{ title:'Parent possibility', year:1880 }, lineage:true },
    ], {
      currentId:'selected',
      project:entry => ({ x:entry.id === 'selected' ? width / 2 : width / 2 + 62,
        y:entry.id === 'selected' ? 300 : 264, visible:true }),
      measure:text => ({ width:190, height:18 }),
      bounds:safe,
    });
    assert.ok(candidates.every(candidate => candidate.edgeFallback), `${width}px marks the selected ancestry for fallback`);
    const placed = placeScreenLabels(candidates, safe, nodes, controls);
    assert.deepEqual(new Set(placed.map(label => label.id)), new Set(['selected', 'parent']), `${width}px keeps both selected lineage labels`);
    assert.ok(placed.every(label => label.edgeFallbackPlacement), `${width}px moves the blocked labels to a visible edge slot`);
    assert.ok(placed.every(label => label.x - label.width / 2 >= safe.left && label.x + label.width / 2 <= safe.right
      && label.y - label.height / 2 >= safe.top && label.y + label.height / 2 <= safe.bottom));
    for (const label of placed) {
      assert.ok(![...nodes, ...controls, ...placed.filter(other => other !== label)].some(other =>
        Math.abs(other.x - label.x) < (other.width + label.width) / 2 + 3
        && Math.abs(other.y - label.y) < (other.height + label.height) / 2 + 3), `${width}px label ${label.id} clears nodes, controls, and peer labels`);
    }
  }
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

test('mobile undated caption and undated ancestor label remain visible in clear non-overlapping slots', () => {
  const safe = { left:10, top:8, right:365, bottom:620 };
  const controls = [{ x:187.5, y:50, width:355, height:80 }];
  const nodes = [
    { x:268, y:272, width:44, height:44 },
    { x:188, y:408, width:56, height:56 },
  ];
  const placed = placeScreenLabels([
    { id:'axis:undated', text:'UNDATED', fullText:'UNDATED · NO TIME POSITION', x:56, y:132, width:88, height:18, priority:126 },
    { id:'dated-current', text:'1900 · Dated current world', x:188, y:408, width:220, height:18, priority:124 },
    { id:'undated-ancestor', text:'Undated · Unknown root', x:268, y:132, width:190, height:18, priority:122 },
    { id:'axis:vertical', text:'HISTORY DEPTH', x:88, y:34, width:116, height:18, priority:110 },
  ], safe, nodes, controls);
  const caption = placed.find(item => item.id === 'axis:undated');
  const current = placed.find(item => item.id === 'dated-current');
  const ancestor = placed.find(item => item.id === 'undated-ancestor');
  assert.ok(caption, 'the lane caption remains visible in the mobile safe viewport');
  assert.ok(current, 'the selected dated world label remains visible beside the lane caption');
  assert.ok(ancestor, 'the undated lineage world label remains available');
  for (const item of [caption, current, ancestor]) {
    assert.ok(item.x - item.width / 2 >= safe.left && item.x + item.width / 2 <= safe.right);
    assert.ok(item.y - item.height / 2 >= safe.top && item.y + item.height / 2 <= safe.bottom);
    assert.ok(![...nodes, ...controls].some(other =>
      Math.abs(other.x - item.x) < (other.width + item.width) / 2 + 3
      && Math.abs(other.y - item.y) < (other.height + item.height) / 2 + 3));
  }
  assert.ok(!(Math.abs(caption.x - ancestor.x) < (caption.width + ancestor.width) / 2 + 3
    && Math.abs(caption.y - ancestor.y) < (caption.height + ancestor.height) / 2 + 3));
  assert.ok(!(Math.abs(caption.x - current.x) < (caption.width + current.width) / 2 + 3
    && Math.abs(caption.y - current.y) < (caption.height + current.height) / 2 + 3));
});
