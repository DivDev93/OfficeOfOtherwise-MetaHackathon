import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  ATLAS_REAL_SPHERE_LIMIT, AXIS_ANIMATION_MS, AXIS_MODES, ATLAS_TIME_SCALE_LABEL, FUTURE_EXTENSION_WIDTH, PRESENT_DAY_REFERENCE,
  atlasLOD, axisTransitionProgress, buildAtlasTimeline, formatHistoricalYear,
  focusContextTimeX, interpolateAtlasPoint, layoutLogTimeTicks, logDistanceX, planQuestionRootConnections, routeAtlasEdgePaths,
  questionStemPathKey, sampleAtlasEdgePath, transformAtlasEdgeShape, worldDistanceMap,
} from '../web/atlas/p2Atlas.js';

function sampleGraph() {
  const worlds = [
    { id: 'root', parentId: null, questionId: 'q-a', year: 1800, title: 'Sundaland', boldness: 0.3, theme: 'geography-ecology', provenance: { reviewScore: 9 } },
    { id: 'child-a', parentId: 'root', questionId: 'q-a', year: 1902, title: 'Kuching', boldness: 0.7, theme: 'science-medicine', provenance: { reviewScore: 8, sourceBranchId: 'b2' } },
    { id: 'sibling', parentId: 'root', questionId: 'q-a', year: 1850, title: 'Sibling branch', boldness: 0.4, theme: 'infrastructure-trade', provenance: { sourceBranchId: 'b1' } },
    { id: 'grandchild', parentId: 'child-a', questionId: 'q-a', year: 1930, title: 'Field notes', boldness: 0.55, theme: 'culture-daily-life', provenance: { reviewScore: 7 } },
    { id: 'far', parentId: 'grandchild', questionId: 'q-a', year: 2000, title: 'Later study', boldness: 0.2, theme: 'science-medicine' },
    { id: 'distant', parentId: 'far', questionId: 'q-a', year: 2020, title: 'Recent study', boldness: 0.1, theme: 'science-medicine' },
    { id: 'q-b-root', parentId: null, questionId: 'q-b', year: -5000, title: 'Sahara', boldness: 0.8, theme: 'geography-ecology' },
    { id: 'q-b-child', parentId: 'q-b-root', questionId: 'q-b', year: -3000, title: 'River gardens', boldness: 0.6, theme: 'culture-daily-life' },
  ];
  return { version: 1, worlds, questions: [
    { id: 'q-a', question: 'What if the Sunda Shelf stayed exposed?', divergenceYear: 1800 },
    { id: 'q-b', question: 'What if the Sahara remained green?', divergenceYear: -5000 },
  ] };
}

function properSegmentCrossing(a, b, c, d) {
  const orient = (p, q, r) => (q.x - p.x) * (r.y - p.y) - (q.y - p.y) * (r.x - p.x);
  const abC = orient(a, b, c), abD = orient(a, b, d);
  const cdA = orient(c, d, a), cdB = orient(c, d, b);
  return abC * abD < -1e-10 && cdA * cdB < -1e-10;
}

function edgeCrossings(paths, { includeIncident = false } = {}) {
  const crossings = [];
  for (let first = 0; first < paths.length; first++) for (let second = first + 1; second < paths.length; second++) {
    const a = paths[first], b = paths[second];
    if (!includeIncident && [a.parentId, a.childId].some(id => id === b.parentId || id === b.childId)) continue;
    let crossing = false;
    for (let left = 1; left < a.points.length && !crossing; left++) {
      for (let right = 1; right < b.points.length; right++) {
        if (properSegmentCrossing(a.points[left - 1], a.points[left], b.points[right - 1], b.points[right])) {
          crossing = true; break;
        }
      }
    }
    if (crossing) crossings.push([`${a.parentId}->${a.childId}`, `${b.parentId}->${b.childId}`]);
  }
  return crossings;
}

function unexpectedRouteOverlaps(paths) {
  const overlaps = [];
  for (let first = 0; first < paths.length; first++) for (let second = first + 1; second < paths.length; second++) {
    const a = paths[first], b = paths[second];
    let overlapOutsideParentStem = false;
    for (let left = 1; left < a.points.length; left++) for (let right = 1; right < b.points.length; right++) {
      const p = a.points[left - 1], q = a.points[left], r = b.points[right - 1], s = b.points[right];
      const dx = q.x - p.x, dy = q.y - p.y, ex = s.x - r.x, ey = s.y - r.y;
      if (Math.abs(dx * ey - dy * ex) > 1e-8 || Math.abs(dx * (r.y - p.y) - dy * (r.x - p.x)) > 1e-8) continue;
      const useX = Math.abs(dx) >= Math.abs(dy);
      const firstRange = [useX ? p.x : p.y, useX ? q.x : q.y].sort((x, y) => x - y);
      const secondRange = [useX ? r.x : r.y, useX ? s.x : s.y].sort((x, y) => x - y);
      const overlap = Math.min(firstRange[1], secondRange[1]) - Math.max(firstRange[0], secondRange[0]);
      if (overlap <= 1e-6) continue;
      const parentY = a.from.y;
      if (a.parentId !== b.parentId || Math.abs(b.from.y - parentY) > 1e-8
        || [p, q, r, s].some(point => Math.abs(point.y - parentY) > 1e-6)) overlapOutsideParentStem = true;
    }
    if (overlapOutsideParentStem) overlaps.push([`${a.parentId}->${a.childId}`, `${b.parentId}->${b.childId}`]);
  }
  return overlaps;
}

function assertPlanarAtlasRoutes(layout) {
  const paths = [...layout.parentChildPaths, ...(layout.questionRootPaths || []), ...(layout.questionStemPaths || [])];
  const nodes = [
    ...layout.worlds.filter(world => !layout.foldedIds.includes(world.id)).map(world => ({ id: world.id, x: world.x, y: world.y })),
    ...new Map((layout.questionRootPaths || []).map(path => [path.parentId,
      { id: path.parentId, x: path.from.x, y: path.from.y }])).values(),
    ...new Map((layout.questionStemPaths || []).map(path => [path.childId,
      { id: path.childId, x: path.to.x, y: path.to.y }])).values(),
  ];
  assert.deepEqual(edgeCrossings(paths, { includeIncident: true }), []);
  assert.deepEqual(unexpectedRouteOverlaps(paths), [], 'only sibling routes may share their parent stem');
  assert.ok(paths.every(path => path.unresolvedCrossings.length === 0 && path.unresolvedNodes.length === 0));
  for (const path of paths) {
    const decoded = transformAtlasEdgeShape(path.from, path.to, path.routeShape);
    assert.deepEqual(decoded, path.points, `${path.parentId}->${path.childId} retains every routeShape vertex`);
    assert.deepEqual(path.points[0], path.from);
    assert.deepEqual(path.points.at(-1), path.to);
    for (const node of nodes) {
      if (node.id === path.parentId || node.id === path.childId) continue;
      for (let index = 1; index < path.points.length; index++) {
        assert.ok(pointSegmentDistanceForTest(node, path.points[index - 1], path.points[index]) >= 0.16 - 1e-8,
          `${path.parentId}->${path.childId} clears ${node.id}`);
      }
    }
  }
}

test('same-year question roots route from virtual parents outside each subtree without hits or crossings', () => {
  const worlds = [
    ...Array.from({ length: 5 }, (_, index) => ({ id: `map-root-${index}`, parentId: null, questionId: 'q-map', year: 1800 })),
    ...Array.from({ length: 3 }, (_, index) => ({ id: `river-root-${index}`, parentId: null, questionId: 'q-river', year: 1800 })),
  ];
  const graph = { worlds, questions: [
    { id: 'q-map', divergenceYear: 1800 }, { id: 'q-river', divergenceYear: 1800 },
  ] };
  const layout = buildAtlasTimeline(graph, 'map-root-0', 'history-distance', { expandedQuestionIds: ['q-river'] });
  assert.equal(layout.questionRootPaths.length, 8);
  assertPlanarAtlasRoutes(layout);
  for (const branch of layout.questionBranches) {
    const roots = layout.worlds.filter(world => !layout.foldedIds.includes(world.id)
      && world.parentId == null && world.questionId === branch.questionId);
    assert.ok(roots.every(root => branch.y < root.y), `${branch.questionId} token sits above its root rows`);
    const rootPaths = layout.questionRootPaths.filter(path => path.questionId === branch.questionId);
    assert.ok(rootPaths.every(path => Math.abs(path.from.x - branch.x) < 1e-9 && Math.abs(path.from.y - branch.y) < 1e-9));
  }
  assert.ok(layout.questionRootPaths.some(path => path.color === 'lineage'));
  assert.ok(layout.questionRootPaths.some(path => path.color === 'proposed'));
});

test('question stems route around other question lineage while staying anchored to divergence time', () => {
  const worlds = [
    { id: 'a0', parentId: null, questionId: 'qa', year: 1000 },
    { id: 'a1', parentId: 'a0', questionId: 'qa', year: 1300 },
    { id: 'a2', parentId: 'a1', questionId: 'qa', year: 1800 },
    { id: 'b0', parentId: null, questionId: 'qb', year: 1050 },
    { id: 'b1', parentId: 'b0', questionId: 'qb', year: 1700 },
  ];
  const layout = buildAtlasTimeline({ worlds, questions: [
    { id: 'qa', divergenceYear: 1000 }, { id: 'qb', divergenceYear: 1050 },
  ] }, 'a2', 'history-distance', { expandedQuestionIds: ['qb'] });
  const stem = layout.questionStemPaths.find(path => path.questionId === 'qb');
  const branch = layout.questionBranches.find(item => item.questionId === 'qb');
  assert.ok(stem);
  assert.equal(stem.from.x, branch.x, 'stem remains anchored to its divergence-time point on the trunk');
  assert.equal(stem.from.y, layout.trunk.y);
  assert.equal(stem.to.x, branch.x);
  assert.equal(stem.to.y, branch.y);
  assert.ok(stem.routeBounds.right > Math.max(...layout.worlds.map(world => world.x)),
    'the crossing stem takes an outer gutter around the earlier gold lineage');
  assertPlanarAtlasRoutes(layout);

  const folded = buildAtlasTimeline({ worlds, questions: [
    { id: 'qa', divergenceYear: 1000 }, { id: 'qb', divergenceYear: 1050 },
  ] }, 'a2');
  assert.deepEqual(folded.questionStemPaths.map(path => [path.questionId, path.foldedChip]), [['qb', true], ['qa', false]],
    'folded questions keep a routed chip stem while omitting hidden root connectors');
  assert.ok(!folded.questionRootPaths.some(path => path.questionId === 'qb'));
  assertPlanarAtlasRoutes(folded);
});

test('partially folded question keeps distinct lineage-root and folded-chip stems', () => {
  const worlds = [
    { id: 'old-root', parentId: null, questionId: 'q-old', year: 1000 },
    { id: 'old-sibling', parentId: null, questionId: 'q-old', year: 1100 },
    { id: 'current', parentId: 'old-root', questionId: 'q-active', year: 1200 },
  ];
  const layout = buildAtlasTimeline({ worlds, questions: [
    { id: 'q-old', divergenceYear: 1000 }, { id: 'q-active', divergenceYear: 1200 },
  ] }, 'current');
  assert.ok(layout.lineageIds.includes('old-root'));
  assert.ok(layout.foldedIds.includes('old-sibling'));
  assert.ok(layout.questionRootPaths.some(path => path.questionId === 'q-old' && path.worldId === 'old-root'));
  assert.deepEqual(layout.questionStemPaths.filter(path => path.questionId === 'q-old')
    .map(path => [path.foldedChip, path.childId]).sort((a, b) => Number(a[0]) - Number(b[0])), [
    [false, '\u0000question-root:q-old'], [true, '\u0000question-chip:q-old'],
  ]);
  assert.notEqual(questionStemPathKey({ questionId: 'q-old' }),
    questionStemPathKey({ questionId: 'q-old', foldedChip: true }),
    'renderer and axis-bounds maps retain both route identities for the same question');
  assertPlanarAtlasRoutes(layout);
});

function pointSegmentDistanceForTest(point, a, b) {
  const dx = b.x - a.x, dy = b.y - a.y;
  const lengthSquared = dx * dx + dy * dy;
  const t = lengthSquared ? Math.max(0, Math.min(1, ((point.x - a.x) * dx + (point.y - a.y) * dy) / lengthSquared)) : 0;
  return Math.hypot(point.x - (a.x + dx * t), point.y - (a.y + dy * t));
}

function seededRandom(seed) {
  let value = seed >>> 0;
  return () => { value = (1664525 * value + 1013904223) >>> 0; return value / 4294967296; };
}

function syntheticWorlds(count, seed, yearMode = 'independent') {
  const random = seededRandom(seed), worlds = [];
  for (let index = 0; index < count; index++) {
    const parentIndex = index === 0 ? null : Math.floor(random() * index);
    const parentYear = parentIndex == null ? 1500 : worlds[parentIndex].year;
    const year = index === 0 ? 1500
      : yearMode === 'later' ? parentYear + 1 + Math.floor(random() * 5000)
        : yearMode === 'earlier' ? parentYear - 1 - Math.floor(random() * 5000)
          : yearMode === 'ties' ? (index % 3 === 0 ? parentYear : parentYear + 1 + Math.floor(random() * 300))
            : yearMode === 'same-year' ? parentYear
              : Math.floor(1000 + random() * 12000);
    worlds.push({ id: `synthetic-${index}`, parentId: parentIndex == null ? null : `synthetic-${parentIndex}`,
      questionId: 'q', year, proposedOrder: Math.floor(random() * 16) });
  }
  return worlds;
}

test('log time scale anchors 2026 at the trunk end and compresses BCE distance', () => {
  assert.equal(ATLAS_TIME_SCALE_LABEL, 'Log distance back from present (2026)');
  const present = logDistanceX(2026, { earliestYear: -1000000 });
  const recent = logDistanceX(1902, { earliestYear: -1000000 });
  const old = logDistanceX(-5000, { earliestYear: -1000000 });
  const deep = logDistanceX(-1000000, { earliestYear: -1000000 });
  assert.equal(present, 3.8);
  assert.ok(present > recent && recent > old && old > deep);
  assert.ok(deep > -4.61);
  assert.equal(formatHistoricalYear(-1), '1 BCE');
  assert.equal(formatHistoricalYear(1), '1 CE');
  assert.ok(logDistanceX(-5000, { earliestYear: -1, left: -4.6, right: 3.8 }) > -4.6);
});

test('future events extend monotonically beyond the fixed 2026 trunk end in a bounded branch lane', () => {
  const options = { earliestYear: -5000, presentYear: 2026, latestYear: 2100, right: 3.8 };
  const x2026 = logDistanceX(2026, options);
  const x2034 = logDistanceX(2034, options);
  const x2100 = logDistanceX(2100, options);
  assert.equal(x2026, 3.8);
  assert.ok(x2034 > x2026 && x2034 < x2100);
  assert.equal(x2100, 3.8 + FUTURE_EXTENSION_WIDTH);
  const years = [-5000, -1, 1, 2026, 2034, 2100];
  const positions = years.map(year => logDistanceX(year, options));
  assert.ok(positions.every((x, index) => index === 0 || x > positions[index - 1]), 'BCE through future event coordinates stay strictly chronological');

  const timeline = buildAtlasTimeline({
    worlds: years.slice(3).map((year, index) => ({ id: `future-${year}`, parentId: index ? `future-${years[index + 2]}` : null, questionId: 'future-q', year })),
    questions: [{ id: 'future-q', question: 'A future chronology', divergenceYear: 2034 }],
  }, 'future-2026');
  assert.equal(timeline.trunk.right, 3.8);
  assert.equal(timeline.presentEarth.x, 3.8);
  assert.equal(timeline.positions.get('future-2026').x, 3.8);
  assert.equal(timeline.positions.get('future-2034').x, x2034);
  assert.equal(timeline.positions.get('future-2100').x, x2100);
  assert.deepEqual(timeline.futureExtension, { fromX: 3.8, toX: 3.8 + FUTURE_EXTENSION_WIDTH, latestYear: 2100, label: 'FUTURE · 2100 →' });
  assert.ok(timeline.visibleTicks.every(tick => tick.x <= timeline.trunk.right), 'calendar tick labels remain on the history trunk, away from future branch space');
});

test('log tick labels keep a minimum projected gap and retain the present label', () => {
  const ticks = layoutLogTimeTicks({ earliestYear: -1000000, presentYear: 2026, minGap: 0.7 });
  assert.equal(ticks.at(-1).label, 'PRESENT · 2026');
  for (let index = 1; index < ticks.length; index++) assert.ok(ticks[index].x - ticks[index - 1].x >= 0.7);
});

test('three axis modes keep chronological x and tidy branch slots while question divergence attaches to the trunk', () => {
  const graph = sampleGraph();
  const layouts = AXIS_MODES.map(mode => buildAtlasTimeline(graph, 'child-a', mode));
  for (const layout of layouts) {
    assert.ok(layout.positions.get('child-a').y < layout.positions.get('sibling').y,
      'the selected lineage subtree occupies the first branch slot');
    assert.ok(layout.positions.get('grandchild').x > layout.positions.get('child-a').x, 'time remains the horizontal axis');
    assert.ok(layout.parentChildPaths.some(path => path.parentId === 'child-a' && path.childId === 'grandchild'));
  }
  const inactive = layouts[0].questionBranches.find(branch => branch.questionId === 'q-b');
  assert.equal(inactive.divergenceYear, -5000);
  assert.match(inactive.label, /Sahara remained green/i);
  assert.equal(inactive.x, focusContextTimeX(-5000, { earliestYear: -5000, latestYear: 2026, focusStartYear: 1800, focusEndYear: 2020 }));
  assert.equal(layouts[0].timeScaleMode, 'focus-context');
  assert.equal(layouts[0].focusContext.questionId, 'q-a');
  assert.equal(layouts[0].focusContext.startYear, 1800);
  assert.equal(layouts[0].focusContext.endYear, 2020);
  assert.ok(Math.abs(layouts[0].focusContext.left - -2.752) < 1e-9);
  assert.ok(Math.abs(layouts[0].focusContext.right - 2.708) < 1e-9);
  assert.equal(layouts[0].questionBranches.find(branch => branch.questionId === 'q-a').active, true);
  assert.equal(layouts[0].presentEarth.year, 2026);
  const branch = layouts[1];
  assert.ok(branch.positions.get('child-a').y < branch.positions.get('sibling').y,
    'active lineage priority precedes branch order for unrelated siblings');
});

test('root alternatives are two steps apart through their shared question', () => {
  const roots = [
    { id: 'a', questionId: 'q', parentId: null },
    { id: 'b', questionId: 'q', parentId: null },
    { id: 'other', questionId: 'other', parentId: null },
  ];
  const distance = worldDistanceMap(roots, 'a');
  assert.equal(distance.get('b'), 2);
  assert.equal(distance.has('other'), false);
  assert.ok(atlasLOD(roots, 'a', 'q').realSphereIds.includes('b'));
});

test('a future descendant does not collapse the active historical span back to logarithmic time', () => {
  const worlds = [1650, 1800, 1978, 2034].map((year, index) => ({ id: `w${year}`, questionId: 'q', parentId: index ? `w${[1650, 1800, 1978][index - 1]}` : null, year }));
  const layout = buildAtlasTimeline({ worlds, questions: [{ id: 'q', divergenceYear: 1650 }] }, 'w1978');
  assert.equal(layout.timeScaleMode, 'focus-context');
  assert.equal(layout.focusContext.endYear, 2026);
  assert.ok(layout.positions.get('w2034').x > layout.trunk.right);
  const p = years => years.map(year => layout.positions.get(`w${year}`).x);
  const [a, b, c] = p([1650, 1800, 1978]);
  assert.ok(Math.abs((b - a) / 150 - (c - b) / 178) < 1e-9);
});

test('equal semantic distances receive deterministic small vertical sub-lanes without changing time order', () => {
  const worlds = [
    { id: 'tied-a', parentId: null, questionId: 'q', year: 1800, boldness: .5, theme: 'geography-ecology' },
    { id: 'tied-b', parentId: null, questionId: 'q', year: 1850, boldness: .5, theme: 'geography-ecology' },
    { id: 'tied-c', parentId: null, questionId: 'q', year: 1900, boldness: .5, theme: 'geography-ecology' },
  ];
  for (const mode of ['history-distance', 'theme']) {
    const layout = buildAtlasTimeline({ worlds }, 'tied-a', mode);
    const points = worlds.map(world => layout.positions.get(world.id));
    assert.ok(new Set(points.map(point => point.y)).size === 3, `${mode} breaks ties into sub-lanes`);
    assert.ok(points[0].x < points[1].x && points[1].x < points[2].x, 'time coordinates stay strictly ordered');
    const repeated = buildAtlasTimeline({ worlds }, 'tied-a', mode);
    assert.deepEqual(points.map(point => point.y), worlds.map(world => repeated.positions.get(world.id).y), 'tie lanes are deterministic');
  }
});

test('large root groups receive deterministic separate branch slots while preserving time positions', () => {
  const worlds = Array.from({ length: 30 }, (_, index) => ({
    id: `tied-${index}`, parentId: null, questionId: 'q', year: 1900 + index, boldness: .5,
  }));
  const layout = buildAtlasTimeline({ worlds }, 'tied-0');
  const points = worlds.map(world => layout.positions.get(world.id));
  assert.equal(new Set(points.map(point => point.y)).size, 30);
  assert.ok(Math.max(...points.map(point => point.y)) - Math.min(...points.map(point => point.y)) > 20);
  const expected = worlds.map(world => focusContextTimeX(world.year, { earliestYear: 1900, latestYear: 2026, focusStartYear: 1900, focusEndYear: 1929 }));
  points.forEach((point, index) => assert.ok(Math.abs(point.x - expected[index]) < 1e-9));
});

test('a long active chain gives every world its own row instead of stacking ancestors together', () => {
  const worlds = Array.from({ length: 30 }, (_, index) => ({
    id: `chain-${index}`, parentId: index ? `chain-${index - 1}` : null, questionId: 'active', year: 1800 + index,
  }));
  const layout = buildAtlasTimeline({ worlds, questions: [{ id: 'active', divergenceYear: 1800 }] }, 'chain-29');
  const rows = worlds.map(world => layout.positions.get(world.id).y);
  assert.equal(new Set(rows).size, worlds.length, 'ancestors and descendants never share a slot');
  assert.ok(rows.every((row, index) => index === 0 || row > rows[index - 1]));
  assert.ok(rows.at(-1) - rows[0] > 20, 'the full active tree receives meaningful vertical span');
  for (const path of layout.parentChildPaths) {
    assert.ok(Math.abs(path.to.y - path.from.y) >= 0.71, 'parent and child rows have visible separation');
  }
});

test('folded worlds do not consume active tree rows or alter its vertical span', () => {
  const active = [
    { id: 'active-root', parentId: null, questionId: 'active', year: 1800 },
    { id: 'active-child', parentId: 'active-root', questionId: 'active', year: 1810 },
  ];
  const crowded = Array.from({ length: 20 }, (_, index) => ({
    id: `folded-${index}`, parentId: index ? `folded-${index - 1}` : null,
    questionId: 'inactive', year: 500 + index,
  }));
  const questions = [
    { id: 'active', divergenceYear: 1800 },
    { id: 'inactive', divergenceYear: 500 },
  ];
  const compact = buildAtlasTimeline({ worlds: active, questions }, 'active-child');
  const withFolded = buildAtlasTimeline({ worlds: [...active, ...crowded], questions }, 'active-child');
  assert.equal(withFolded.foldedIds.length, 20);
  assert.equal(withFolded.treeSpan, compact.treeSpan);
  assert.deepEqual(active.map(world => withFolded.positions.get(world.id).y), active.map(world => compact.positions.get(world.id).y));
  assert.equal(withFolded.parentChildPaths.length, 1, 'folded parent-child edges are not laid out');
});

test('a visible child whose parent is folded becomes a layout root without a dangling edge', () => {
  const graph = {
    worlds: [
      { id: 'current-root', parentId: null, questionId: 'active', year: 1800 },
      { id: 'folded-parent', parentId: null, questionId: 'inactive', year: 1700 },
      { id: 'visible-child', parentId: 'folded-parent', questionId: 'active', year: 1850 },
    ],
    questions: [{ id: 'active', divergenceYear: 1800 }, { id: 'inactive', divergenceYear: 1700 }],
  };
  const layout = buildAtlasTimeline(graph, 'current-root');
  assert.ok(layout.foldedIds.includes('folded-parent'));
  assert.ok(Number.isFinite(layout.positions.get('visible-child').y));
  assert.ok(!layout.parentChildPaths.some(path => path.childId === 'visible-child'));
});

test('optional frame aspect widens time coordinates in proportion without changing focus/context ratios', () => {
  const worlds = Array.from({ length: 30 }, (_, index) => ({
    id: `aspect-${index}`, parentId: index ? `aspect-${index - 1}` : null, questionId: 'active', year: 1800 + index * 8,
  }));
  const graph = { worlds, questions: [{ id: 'active', divergenceYear: 1800 }] };
  const base = buildAtlasTimeline(graph, 'aspect-29');
  const aspect = 1.6;
  const framed = buildAtlasTimeline(graph, 'aspect-29', 'history-distance', { frameAspect: aspect });
  assert.ok(framed.horizontalScale > 1);
  assert.equal(framed.frameAspect, aspect);
  assert.ok(Math.abs((framed.trunk.right - framed.trunk.left) / (base.trunk.right - base.trunk.left) - framed.horizontalScale) < 1e-12);
  const baseFocusWidth = base.focusContext.right - base.focusContext.left;
  const framedFocusWidth = framed.focusContext.right - framed.focusContext.left;
  assert.ok(Math.abs(framedFocusWidth / baseFocusWidth - framed.horizontalScale) < 1e-12);
  const baseInterval = base.positions.get('aspect-20').x - base.positions.get('aspect-10').x;
  const framedInterval = framed.positions.get('aspect-20').x - framed.positions.get('aspect-10').x;
  assert.ok(Math.abs(framedInterval / baseInterval - framed.horizontalScale) < 1e-12);
  assert.ok(framed.positions.get('aspect-10').x < framed.positions.get('aspect-20').x, 'chronological order is retained');
  assert.equal(buildAtlasTimeline(graph, 'aspect-29').horizontalScale, 1, 'default layout keeps its established time width');
});

test('tree rows keep sibling subtrees ordered and parent-child curves are smooth and bounded', () => {
  const layout = buildAtlasTimeline(sampleGraph(), 'child-a', 'branch-order');
  const y = id => layout.positions.get(id).y;
  assert.ok(y('child-a') < y('grandchild') && y('grandchild') < y('sibling'));
  const path = layout.parentChildPaths.find(edge => edge.parentId === 'child-a' && edge.childId === 'grandchild');
  assert.ok(path.points.length >= 2);
  assert.deepEqual(path.points[0], path.from);
  assert.deepEqual(path.points.at(-1), path.to);
  const adapted = sampleAtlasEdgePath({ x: 0, y: 0 }, { x: 4, y: 2 }, 8, { routeShape: path.routeShape });
  assert.equal(adapted.length, 9);
  assert.deepEqual(adapted[0], { x: 0, y: 0, z: 0 });
  assert.deepEqual(adapted.at(-1), { x: 4, y: 2, z: 0 });
  const sampled = sampleAtlasEdgePath({ x: 0, y: 0 }, { x: 2, y: 1 }, 4);
  assert.equal(sampled.length, 5);
  assert.ok(sampled[1].x > sampled[0].x && sampled[1].x < sampled.at(-1).x);
});

test('uneven chronological branches use a deterministic lane to avoid their crossing', () => {
  const worlds = [
    { id: 'root', parentId: null, questionId: 'q', year: 1000 },
    { id: 'early-branch', parentId: 'root', questionId: 'q', year: 1020 },
    { id: 'early-descendant', parentId: 'early-branch', questionId: 'q', year: 1100 },
    { id: 'early-late-study', parentId: 'early-descendant', questionId: 'q', year: 1500 },
    { id: 'late-branch', parentId: 'root', questionId: 'q', year: 1200 },
    { id: 'late-descendant', parentId: 'late-branch', questionId: 'q', year: 1250 },
    { id: 'late-future-study', parentId: 'late-descendant', questionId: 'q', year: 1800 },
  ];
  const layout = buildAtlasTimeline({ worlds, questions: [{ id: 'q', divergenceYear: 1000 }] }, 'late-future-study');
  assert.deepEqual(edgeCrossings(layout.parentChildPaths, { includeIncident: true }), []);
  assert.equal(layout.parentChildPaths.find(path => path.parentId === 'root' && path.childId === 'late-branch').routeType,
    'validated-direct-cubic', 'the selected lineage uses a direct cubic when its exact geometry is clear');
  assert.ok(layout.parentChildPaths.every(path => path.unresolvedCrossings.length === 0));
  assert.ok(layout.parentChildPaths.every(path => path.unresolvedNodes.length === 0));
});

test('nested gutters preserve the equal-year and backward-time 20-world fixture', () => {
  const worlds = [
    ['n0', null, 1800], ['n1', 'n0', 1850], ['n2', 'n0', 1900], ['n3', 'n2', 1950],
    ['n4', 'n0', 1800], ['n5', 'n4', 1638], ['n6', 'n5', 1850], ['n7', 'n4', 1757],
    ['n8', 'n6', 1869], ['n9', 'n8', 1718], ['n10', 'n2', 1306], ['n11', 'n5', 1950],
    ['n12', 'n0', 1603], ['n13', 'n11', 1775], ['n14', 'n9', 1950], ['n15', 'n0', 1850],
    ['n16', 'n5', 1687], ['n17', 'n5', 1519], ['n18', 'n3', 1825], ['n19', 'n5', 1551],
  ].map(([id, parentId, year]) => ({ id, parentId, questionId: 'q', year }));
  const layout = buildAtlasTimeline({ worlds, questions: [{ id: 'q', divergenceYear: 1800 }] }, 'n19');
  assert.equal(layout.parentChildPaths.length, 19);
  assertPlanarAtlasRoutes(layout);
  assert.equal(layout.parentChildPaths.filter(path => ['nested-prefix-gutter', 'validated-direct-cubic'].includes(path.routeType)).length, 19);
  assert.ok(layout.parentChildPaths.some(path => path.routeType === 'validated-direct-cubic'),
    'safe edges use smoother direct cubics');
  assert.ok(layout.parentChildPaths.some(path => path.routeCornerRadius > 0.22),
    'remaining gutter routes use a larger safe corner radius where spacing permits');
  assert.ok(layout.routeBounds.left < Math.min(...layout.worlds.map(world => world.x)));
  assert.ok(layout.routeBounds.right > Math.max(...layout.worlds.map(world => world.x)));
});

test('42-world nested-gutter routing removes crossings without runaway detours', () => {
  const worlds = [{ id: 'world-0', parentId: null, questionId: 'q', year: 700 }];
  for (let index = 1; index < 42; index++) {
    const parentIndex = Math.floor((index - 1) / 3);
    worlds.push({
      id: `world-${index}`, parentId: `world-${parentIndex}`, questionId: 'q',
      year: worlds[parentIndex].year + 1 + ((index * 137) % 900),
      proposedOrder: (index * 17) % 13,
    });
  }
  const started = performance.now();
  const layout = buildAtlasTimeline({ worlds, questions: [{ id: 'q', divergenceYear: 700 }] }, 'world-41');
  const duration = performance.now() - started;
  assertPlanarAtlasRoutes(layout);
  assert.equal(layout.parentChildPaths.length, worlds.length - 1);
  const lineagePaths = layout.parentChildPaths.filter(path => path.lineage);
  assert.ok(lineagePaths.length > 0 && lineagePaths.every(path => Math.abs(Math.abs(path.to.y - path.from.y) - 0.72) < 1e-8),
    'selected lineage parent-child nodes occupy adjacent rows');
  assert.ok(layout.parentChildPaths.some(path => path.routeType === 'validated-direct-cubic'),
    'safe 42-world branches use direct curves instead of bus detours');
  const crossingPairs = edgeCrossings(layout.parentChildPaths, { includeIncident: true });
  const unresolvedCrossings = layout.parentChildPaths.reduce((total, path) => total + path.unresolvedCrossings.length, 0);
  const unresolvedNodes = layout.parentChildPaths.reduce((total, path) => total + path.unresolvedNodes.length, 0);
  assert.deepEqual(crossingPairs, [], 'nested prefix gutters keep this deterministic fixture planar');
  assert.equal(unresolvedCrossings, 0);
  assert.equal(unresolvedNodes, 0);
  assert.ok(layout.parentChildPaths.every(path => Math.abs(path.routeOffset) <= 4), 'fallbacks do not create runaway lanes');
  assert.ok(layout.parentChildPaths.every(path => path.routeVisited <= 18_000), 'each route obeys the combined two-attempt search budget');
  assert.ok(duration < 3_000, `42-world routing stays under three seconds (observed ${duration.toFixed(1)} ms)`);
  const nodes = layout.worlds.map(world => ({ id: world.id, x: world.x, y: world.y }));
  const repeatedRoutes = routeAtlasEdgePaths(layout.parentChildPaths, { nodes });
  assert.deepEqual(repeatedRoutes.map(path => path.routeOffset), layout.parentChildPaths.map(path => path.routeOffset));
  const nodeBounds = {
    left: Math.min(...nodes.map(node => node.x)), right: Math.max(...nodes.map(node => node.x)),
    bottom: Math.min(...nodes.map(node => node.y)), top: Math.max(...nodes.map(node => node.y)),
  };
  assert.ok(layout.routeBounds.left >= nodeBounds.left - 5 && layout.routeBounds.right <= nodeBounds.right + 5);
  assert.ok(layout.routeBounds.bottom >= nodeBounds.bottom - 5 && layout.routeBounds.top <= nodeBounds.top + 5,
    'reported route bounds keep detours within the documented frame expansion');
  for (const path of layout.parentChildPaths) {
    for (const node of nodes) {
      if (node.id === path.parentId || node.id === path.childId) continue;
      if (path.unresolvedNodes.includes(node.id)) continue;
      for (let index = 1; index < path.points.length; index++) {
        assert.ok(Math.hypot(path.points[index].x - path.points[index - 1].x, path.points[index].y - path.points[index - 1].y) > 0);
        assert.ok(pointSegmentDistanceForTest(node, path.points[index - 1], path.points[index]) >= 0.16 - 1e-9,
          `edge ${path.parentId}->${path.childId} clears node ${node.id}`);
      }
    }
  }
});

test('120-world interleaved-date routing bounds conflicts, detours, and search work', () => {
  const worlds = syntheticWorlds(120, 120 * 1009 + 120);
  const started = performance.now();
  const layout = buildAtlasTimeline({ worlds, questions: [{ id: 'q', divergenceYear: 1500 }] }, 'synthetic-119');
  const duration = performance.now() - started;
  const paths = layout.parentChildPaths;
  const unresolved = paths.filter(path => path.unresolvedCrossings.length || path.unresolvedNodes.length).length;
  const crossingTotal = paths.reduce((total, path) => total + path.unresolvedCrossings.length, 0);
  const nodeTotal = paths.reduce((total, path) => total + path.unresolvedNodes.length, 0);
  assert.equal(unresolved, 0);
  assert.equal(crossingTotal, 0);
  assert.equal(nodeTotal, 0);
  assertPlanarAtlasRoutes(layout);
  assert.ok(paths.every(path => Math.abs(path.routeOffset) <= 4));
  assert.ok(paths.every(path => path.routeVisited <= 18_000));
  assert.ok(duration < 3_000, `120-world routing stays under three seconds (observed ${duration.toFixed(1)} ms)`);
});

test('nested gutters handle backward, tied, and larger interleaved date trees', () => {
  for (const [count, mode, seed] of [
    [42, 'later', 4242], [42, 'earlier', 4243], [80, 'ties', 8081], [80, 'same-year', 8083],
    [200, 'independent', 20200],
  ]) {
    const worlds = syntheticWorlds(count, seed, mode);
    const layout = buildAtlasTimeline({ worlds, questions: [{ id: 'q', divergenceYear: worlds[0].year }] }, `synthetic-${count - 1}`);
    assertPlanarAtlasRoutes(layout);
    assert.equal(layout.parentChildPaths.length, count - 1);
    if (count === 80 && mode === 'ties') {
      assert.ok(layout.parentChildPaths.some(path => path.routeType === 'validated-direct-cubic'),
        'safe 80-world branches use direct curves while tied-date routes retain clearance');
    }
  }
});

test('current-world question metadata attaches a parchment question branch to its declared parent', () => {
  const graph = {
    worlds: [
      { id: 'origin', parentId: null, questionId: 'q-root', year: 1800, title: 'Origin' },
      { id: 'what-if', parentId: 'origin', questionId: 'q-new', year: 1850, title: 'What if' },
    ],
    questions: [
      { id: 'q-root', question: 'Root question', divergenceYear: 1800 },
      { id: 'q-new', mode: 'current-world', parentWorldId: 'origin', question: 'New question', divergenceYear: 1850 },
    ],
  };
  const layout = buildAtlasTimeline(graph, 'origin');
  const branch = layout.questionBranches.find(item => item.questionId === 'q-new');
  assert.equal(branch.attachmentMode, 'current-world');
  assert.equal(branch.attachment.fromWorldId, 'origin');
  assert.equal(branch.attachment.toWorldId, 'what-if');
  assert.deepEqual(layout.questionAttachments.map(item => item.questionId), ['q-new']);
});

test('question tokens connect every spatial root without inventing root-question worlds', () => {
  const worlds = [
    { id: 'sundaland', parentId: null, questionId: 'q-map' },
    { id: 'north-shelf', parentId: null, questionId: 'q-map' },
    { id: 'river-delta', parentId: null, questionId: 'q-map' },
    { id: 'descendant', parentId: 'sundaland', questionId: 'q-map' },
    { id: 'other-root', parentId: null, questionId: 'q-other' },
  ];
  const branches = [{ questionId: 'q-map', x: 1.2, y: 0.7 }, { questionId: 'q-other', x: -1, y: -0.7 }];
  const connections = planQuestionRootConnections(worlds, branches, new Set(['north-shelf']));
  assert.deepEqual(connections, [
    { questionId: 'q-map', worldId: 'sundaland', color: 'proposed' },
    { questionId: 'q-map', worldId: 'north-shelf', color: 'lineage' },
    { questionId: 'q-map', worldId: 'river-delta', color: 'proposed' },
    { questionId: 'q-other', worldId: 'other-root', color: 'proposed' },
  ]);
  assert.equal(worlds.length, 5, 'question tokens are not inserted as fake world nodes');
});

test('inactive questions fold into chips while the current question and gold lineage stay expanded', () => {
  const graph = sampleGraph();
  const layout = buildAtlasTimeline(graph, 'child-a');
  assert.deepEqual(new Set(layout.foldedIds), new Set(['q-b-root', 'q-b-child']));
  assert.deepEqual(new Set(layout.lineageIds), new Set(['root', 'child-a']));
  assert.equal(layout.chips.length, 1);
  assert.equal(layout.chips[0].count, 2);
  assert.match(layout.chips[0].label, /Sahara.*2/);
  assert.equal(layout.chips[0].x, layout.questionBranches.find(branch => branch.questionId === 'q-b').x, 'folded question chip sits at its divergence year on the trunk');
  assert.equal(layout.chips[0].trunkY, layout.trunk.y);
  assert.equal(layout.chips[0].y, 0);
});

test('focus-context scale gives the active question a wider linear segment and keeps chronology monotone', () => {
  const graph = {
    worlds: [
      { id: 'old', parentId: null, questionId: 'old-q', year: 1000 },
      { id: 'root', parentId: null, questionId: 'active-q', year: 1650 },
      { id: 'late', parentId: 'root', questionId: 'active-q', year: 1978 },
      { id: 'recent', parentId: null, questionId: 'recent-q', year: 2020 },
    ],
    questions: [
      { id: 'old-q', divergenceYear: 1000 },
      { id: 'active-q', divergenceYear: 1650 },
      { id: 'recent-q', divergenceYear: 2020 },
    ],
  };
  const layout = buildAtlasTimeline(graph, 'root');
  const x = year => layout.positions.get(({ 1000: 'old', 1650: 'root', 1978: 'late', 2020: 'recent' })[year]).x;
  assert.ok(x(1000) < x(1650) && x(1650) < x(1978) && x(1978) < x(2020));
  const focusWidth = x(1978) - x(1650);
  assert.ok(focusWidth > x(1650) - x(1000) && focusWidth > x(2020) - x(1978));
  assert.ok(layout.focusContext.left < layout.focusContext.right);
});

test('switching active questions produces distinct focus layouts that interpolate existing worlds', () => {
  const graph = sampleGraph();
  const before = buildAtlasTimeline(graph, 'child-a');
  const after = buildAtlasTimeline(graph, 'q-b-child');
  assert.equal(before.focusContext.questionId, 'q-a');
  assert.equal(after.focusContext.questionId, 'q-b');
  assert.deepEqual([before.focusContext.startYear, before.focusContext.endYear], [1800, 2020]);
  assert.deepEqual([after.focusContext.startYear, after.focusContext.endYear], [-5000, -3000]);

  const id = 'sibling';
  const from = before.positions.get(id), to = after.positions.get(id);
  assert.notEqual(from.x, to.x, 'the same saved world is remapped around the newly active question');
  const halfway = interpolateAtlasPoint(from, to, axisTransitionProgress(350));
  assert.ok(halfway.x > Math.min(from.x, to.x) && halfway.x < Math.max(from.x, to.x));
  for (const axis of ['x', 'y', 'z']) {
    assert.ok(Math.abs(interpolateAtlasPoint(from, to, axisTransitionProgress(0))[axis] - from[axis]) < 1e-12);
    assert.ok(Math.abs(interpolateAtlasPoint(from, to, axisTransitionProgress(AXIS_ANIMATION_MS))[axis] - to[axis]) < 1e-12);
  }
});

test('activating an inactive question chip expands its worlds without changing the current world', () => {
  const graph = sampleGraph();
  const folded = buildAtlasTimeline(graph, 'child-a');
  const expanded = buildAtlasTimeline(graph, 'child-a', 'history-distance', { expandedQuestionIds: ['q-b'] });
  assert.deepEqual(folded.chips.map(chip => chip.questionId), ['q-b']);
  assert.deepEqual(expanded.chips, []);
  assert.ok(expanded.realSphereIds.includes('q-b-root') || expanded.pointIds.includes('q-b-root'));
  assert.ok(expanded.realSphereIds.includes('q-b-child') || expanded.pointIds.includes('q-b-child'));
  assert.equal(expanded.activeQuestionId, 'q-a', 'unfolding the question does not select an arbitrary event or switch current question');
});

test('Present-day Earth is a virtual reference token, not a persisted event world', () => {
  assert.deepEqual(PRESENT_DAY_REFERENCE, { id: 'present-day-earth', kind: 'present-day', year: 2026, title: 'Present-day Earth' });
});

test('worlds two steps from current remain spheres, farther active nodes use points, and lineage is mandatory', () => {
  const graph = sampleGraph();
  const layout = buildAtlasTimeline(graph, 'child-a');
  const spheres = new Set(layout.realSphereIds);
  const points = new Set(layout.pointIds);
  assert.ok(spheres.has('root') && spheres.has('child-a') && spheres.has('grandchild'));
  assert.ok(spheres.has('far'));
  assert.ok(points.has('distant'));
  assert.ok(!spheres.has('q-b-root') && !points.has('q-b-root'));
  assert.ok(layout.realSphereIds.length <= ATLAS_REAL_SPHERE_LIMIT);
  const distances = worldDistanceMap(graph.worlds, 'child-a');
  assert.equal(distances.get('grandchild'), 1);
  assert.equal(distances.get('far'), 2);
  assert.equal(distances.get('distant'), 3);
});

test('far LOD is capped without folding any member of a long gold lineage', () => {
  const worlds = Array.from({ length: 32 }, (_, index) => ({ id: `w${index}`, parentId: index ? `w${index - 1}` : null, questionId: 'q', year: 1900 + index }));
  const lod = atlasLOD(worlds, 'w31', 'q', { sphereLimit: 24 });
  assert.equal(lod.lineageIds.length, 32);
  assert.equal(lod.realSphereIds.length, 32);
  assert.equal(lod.pointIds.length, 0);
  assert.equal(lod.foldedIds.length, 0);
});

test('700 ms axis transition is ease-out and interpolates all coordinates', () => {
  assert.equal(AXIS_ANIMATION_MS, 700);
  assert.equal(axisTransitionProgress(0), 0);
  assert.equal(axisTransitionProgress(700), 1);
  assert.ok(axisTransitionProgress(350) > 0.8);
  assert.deepEqual(interpolateAtlasPoint({ x: 0, y: 2, z: 0 }, { x: 10, y: -2, z: 4 }, 0.25), { x: 2.5, y: 1, z: 1 });
});

test('world labels are greedily deconflicted by both horizontal and vertical boxes', () => {
  const layout = buildAtlasTimeline(sampleGraph(), 'child-a');
  assert.equal(layout.worlds.find(world => world.id === 'child-a').labelVisible, true, 'current world label has priority');
  const labels = layout.worlds.filter(world => world.labelVisible).map(world => ({ x: world.x + 0.14, y: world.y + 0.27 }));
  for (let left = 0; left < labels.length; left++) for (let right = left + 1; right < labels.length; right++) {
    assert.ok(Math.abs(labels[left].x - labels[right].x) >= 1.55 || Math.abs(labels[left].y - labels[right].y) >= 0.42);
  }
  for (const node of labels) for (const tick of layout.visibleTicks) {
    assert.ok(Math.abs(node.x - tick.x) >= 1.55 || Math.abs(node.y - tick.y) >= 0.42, 'world labels do not overlap the trunk tick labels');
  }
  for (const chip of layout.chips) for (const node of labels) {
    assert.ok(Math.abs(node.x - chip.x) >= 2.2 || Math.abs(node.y - chip.y) >= 0.38, 'question chips do not overlap world labels');
  }
});

test('P2 trunk renderer attaches to the P1 scene and adds no scene, camera, or renderer', () => {
  const source = readFileSync(new URL('../web/atlas/p2Renderer.js', import.meta.url), 'utf8');
  assert.match(source, /createAtlasP2Renderer\(scene/);
  assert.match(source, /scene\.add\(group\)/);
  assert.match(source, /foldedQuestionIds/);
  assert.match(source, /layoutLabels\(camera, viewport, reservedRects/);
  assert.doesNotMatch(source, /new THREE\.(?:Scene|PerspectiveCamera|WebGLRenderer)\s*\(/);
});
