import test from 'node:test';
import assert from 'node:assert/strict';
import { buildHistorySceneRecords, buildHistorySpineLayout, projectHistorySpineGeometry } from '../web/historySpines.js';
import { projectHistoryAtlas } from '../web/historyAtlas.js';

const place = { name: 'Lake Chad', lat: 13, lon: 14 };
const event = (id, year, extra = {}) => ({ id, year, place, title: id, summary: `${id} summary`, ...extra });

function question() {
  return { id: 'q-sahara', question: 'What if the Sahara stayed green?', divergenceYear: -3000, histories: [
    { id: 'h-main', events: [
      event('shared-1', -5000, { sceneRef: { path: 'scenes/shared.png', status: 'complete' }, geography: { changes: [{ kind: 'lake', region: 'chad', intensity: 0.5 }] } }),
      event('fork-target', -3000, { causeEventId: 'shared-1', geography: { changes: [{ kind: 'lake', region: 'chad', intensity: 0.8 }] } }),
      event('main-future', -2000, { causeEventId: 'fork-target' }),
    ], suggestions: [{ id: 'current-window', year: -2500, title: 'Seasonal channels', window: { fromYear: -3000, toYear: -2001 } },
      { id: 'other-window', year: -1500, window: { fromYear: -2000, toYear: -1001 } }] },
    { id: 'h-fork', forkedFromHistoryId: 'h-main', forkEventId: 'fork-target', events: [
      event('shared-1', -5000, { sceneRef: { path: 'scenes/shared.png', status: 'complete' } }),
      event('alt-1', -3000, { causeEventId: 'shared-1', geography: { changes: [{ kind: 'lake', region: 'chad', intensity: 0.2 }] } }),
      event('alt-2', -1000, { causeEventId: 'alt-1' }),
    ], suggestions: [{ id: 'must-stay-hidden', year: -2500, window: { fromYear: -3000, toYear: -2001 } }] },
    { id: 'h-third', forkedFromHistoryId: 'h-fork', forkEventId: 'alt-1', events: [
      event('shared-1', -5000), event('third-1', -3000, { causeEventId: 'shared-1' }),
    ] },
  ] };
}

test('spine layout is deterministic, chronological, and shares each prefix node once', () => {
  const source = question();
  const options = { questions: [source], activeQuestionId: 'q-sahara', activeHistoryId: 'h-fork', asOfYear: -2500,
    window: { fromYear: -3000, toYear: -2001 } };
  const layout = buildHistorySpineLayout(options);
  assert.deepEqual(buildHistorySpineLayout(options), layout);
  assert.equal(layout.trunk.divergenceYear, -3000);
  assert.equal(layout.spines.find(spine => spine.historyId === 'h-fork').role, 'active');
  assert.equal(layout.spines.find(spine => spine.historyId === 'h-main').role, 'sibling');
  assert.equal(layout.nodes.filter(node => node.eventId === 'shared-1').length, 1);
  const fork = layout.spines.find(spine => spine.historyId === 'h-fork');
  assert.equal(fork.forkNodeId, 'event:q-sahara:fork-target', 'excluded replaced event is the real fork attachment');
  assert.equal(layout.nodes.find(node => node.eventId === 'shared-1').historyId, 'h-fork',
    'a canonical shared-prefix event resolves under the currently selected history');
  assert.deepEqual(fork.nodeIds, ['event:q-sahara:alt-1', 'event:q-sahara:alt-2']);
  assert.deepEqual(fork.suggestions.map(item => item.id), ['must-stay-hidden'], 'active history suggestions stay in the current date window');
  assert.deepEqual(layout.spines.find(spine => spine.historyId === 'h-main').suggestions, [], 'inactive history suggestions are hidden');
  const mainView = buildHistorySpineLayout({ ...options, activeHistoryId: 'h-main' });
  assert.deepEqual(mainView.spines.find(spine => spine.historyId === 'h-main').suggestions.map(item => item.id), ['current-window']);
  assert.deepEqual(layout.nodes.find(node => node.eventId === 'shared-1').sceneRef, { path: 'scenes/shared.png', status: 'complete' });
  assert.deepEqual(layout.nodes.find(node => node.eventId === 'alt-1').geography.changes,
    [{ kind: 'lake', region: 'chad', intensity: 0.2 }]);
  assert.ok(layout.nodes.every(node => Number.isFinite(node.x) && Number.isFinite(node.y)));
  for (const segment of layout.segments) {
    const from = layout.nodes.find(node => node.id === segment.fromNodeId);
    const to = layout.nodes.find(node => node.id === segment.toNodeId);
    assert.ok(from && to, 'segments resolve to explicit node IDs');
    assert.ok(to.year >= from.year, 'segment chronology is non-decreasing, including same-year forks');
  }
  assert.ok(layout.nodes.every(node => !('parentId' in node) && !('children' in node)), 'layout is not a routed parent graph');
  assert.deepEqual(source.histories[0].events[0].sceneRef, { path: 'scenes/shared.png', status: 'complete' });
  assert.deepEqual(layout.siblingEarths[0].events.map(item => item.id), ['shared-1', 'fork-target'], 'sibling Earth snapshot is filtered to the requested date');
  assert.equal(layout.siblingEarths[0].asOfYear, -2500);
  assert.equal(layout.siblingEarths[0].latestEvent.id, 'fork-target');
});

test('long histories remain on bounded chronological lanes instead of expanding the camera frame per event', () => {
  const manyEvents = Array.from({ length:160 }, (_, index) => event(`long-${index}`, index + 1));
  const histories = [{ id:'long-history', events:manyEvents }];
  const layout = buildHistorySpineLayout({ questions:[{ id:'q-long', question:'Long chronology', histories }],
    activeQuestionId:'q-long', activeHistoryId:'long-history', asOfYear:160 });
  const geometry = projectHistorySpineGeometry(layout);
  const eventPoints = geometry.positions.filter(point => point.id.startsWith('event:'));
  assert.equal(eventPoints.length,160);
  assert.equal(Math.max(...eventPoints.map(point => point.y)), Math.min(...eventPoints.map(point => point.y)),
    'event count changes horizontal chronology, not vertical extent');
  assert.ok(Math.max(...eventPoints.map(point => point.x)) - Math.min(...eventPoints.map(point => point.x)) <= 7.2);
});

test('projected history geometry maps years monotonically and resolves real trunk and fork segments', () => {
  const layout = buildHistorySpineLayout({ questions: [question()], activeQuestionId: 'q-sahara', activeHistoryId: 'h-fork',
    asOfYear: -2500, window: { fromYear: -3000, toYear: -2001 } });
  const geometry = projectHistorySpineGeometry(layout);
  const byId = new Map(geometry.positions.map(item => [item.id, item]));
  assert.ok(byId.get('event:q-sahara:shared-1').x < byId.get('event:q-sahara:fork-target').x);
  assert.ok(geometry.segments.some(item => item.kind === 'trunk' && item.to.id === 'trunk:q-sahara'));
  assert.ok(geometry.segments.some(item => item.kind === 'spine-start' && item.from.id === 'event:q-sahara:fork-target'));
  assert.ok(geometry.segments.every(item => [item.from.x,item.from.y,item.to.x,item.to.y].every(Number.isFinite)));
});

test('real-history trunk spans the bounded time axis and count-chip anchors share its y=0 line', () => {
  const layout = buildHistorySpineLayout({ questions:[
    { id:'q-active', question:'Active history', divergenceYear:1800, histories:[{ id:'h-active', events:[event('event-1900',1900)] }] },
    { id:'q-other', question:'Earlier question', divergenceYear:-2800, histories:[{ id:'h-other', events:[event('other-1',-2800)] }] },
  ], activeQuestionId:'q-active', activeHistoryId:'h-active', asOfYear:1900 });
  const geometry = projectHistorySpineGeometry(layout);
  const trunk = geometry.segments.find(segment => segment.kind === 'real-history-trunk');
  assert.ok(trunk);
  assert.deepEqual([trunk.from.x, trunk.from.y, trunk.to.x, trunk.to.y], [-3.6,0,3.6,0]);
  assert.deepEqual(geometry.chips.map(chip => [chip.x, chip.y, chip.year]), [[-3.6,0,-2800]]);
});

test('other-question chip geometry clamps past and future divergence ticks without changing their saved years', () => {
  const layout = projectHistorySpineGeometry({ nodes:[
    { id:'first', year:1650, x:1650, y:0, kind:'event' },
    { id:'last', year:2003, x:2003, y:0, kind:'event' },
  ], segments:[], chips:[
    { id:'past-chip', questionId:'q-past', x:-2800, year:-2800 },
    { id:'future-chip', questionId:'q-future', x:2400, year:2400 },
  ] });
  assert.deepEqual(layout.chips.map(chip => [chip.edge, chip.x, chip.year]), [
    ['past', -3.6, -2800], ['future', 3.6, 2400],
  ]);
});

test('scene records stay independent and preserve event media while separating active pins and sibling Earths', () => {
  const source = question();
  const atlas = projectHistoryAtlas(source, { historyId:'h-fork', asOfYear:-2500,
    window:{ fromYear:-3000, toYear:-2001 }, suggestions:source.histories[1].suggestions });
  atlas.selectedEventId = 'alt-1'; atlas.selectedEventHistoryId = 'h-fork';
  atlas.spineLayout = buildHistorySpineLayout({ questions:[source], activeQuestionId:source.id, activeHistoryId:'h-fork',
    asOfYear:-2500, window:{ fromYear:-3000, toYear:-2001 } });
  atlas.siblingEarths = atlas.spineLayout.siblingEarths;
  const records = buildHistorySceneRecords(atlas);
  assert.ok(records.eventWorlds.length >= 5, 'active and sibling event nodes populate the Atlas spines');
  assert.ok(records.eventWorlds.every(item => item.parentId === null && !('children' in item)), 'spines do not become tree nodes');
  assert.equal(records.eventWorlds.find(item => item.id === 'shared-1').sceneRef.path, 'scenes/shared.png');
  assert.ok(records.eventWorlds.some(item => item.id === 'main-future' && item.visualKind === 'history-spine-sibling'));
  assert.equal(records.siblingEarths[0].asOfYear, -2500);
  assert.deepEqual(atlas.spineLayout.siblingEarths[0].events.map(item => item.id), ['shared-1','fork-target']);
  assert.ok(records.eventWorlds.some(item => item.historySurfacePin && item.id === 'shared-1'), 'only active as-of records become surface pins');
  assert.equal(records.eventWorlds.find(item => item.id === 'shared-1').historyId, 'h-fork',
    'materialized shared event retains active-history identity');
  assert.equal(records.eventWorlds.find(item => item.id === 'alt-1').selected, true,
    'selected event identity survives projection into the Atlas spine');
  assert.equal(records.eventWorlds.find(item => item.id === 'main-future').selectable, true,
    'sibling spine events remain explicitly selectable with their owner history');
  assert.equal(records.eventWorlds.find(item => item.id === 'main-future').historyId, 'h-main');
  assert.ok(records.suggestionWorlds.every(item => item.historySurfacePin && item.historyId === 'h-fork'));
});

test('nested forks attach to the excluded event and same-year branches remain finite', () => {
  const layout = buildHistorySpineLayout({ questions: [question()], activeQuestionId: 'q-sahara', activeHistoryId: 'h-third',
    asOfYear: -2500, window: { fromYear: -3000, toYear: -2001 } });
  const third = layout.spines.find(spine => spine.historyId === 'h-third');
  assert.equal(third.forkNodeId, 'event:q-sahara:alt-1');
  assert.deepEqual(third.nodeIds, ['event:q-sahara:third-1']);
  const branch = third.segments.find(segment => segment.kind === 'spine-start');
  assert.equal(branch.fromNodeId, 'event:q-sahara:alt-1');
  assert.equal(layout.nodes.find(node => node.id === branch.fromNodeId).year, layout.nodes.find(node => node.id === branch.toNodeId).year);
});

test('origin forkYear moves an early conflict fork before its replaced event and limits the shared prefix', () => {
  const source = { id: 'early-conflict', divergenceYear: -4000, histories: [
    { id: 'original', events: [
      event('shared-before', -3500, { geography: { changes: [{ kind: 'lake', region: 'chad', intensity: 0.5 }] } }),
      event('old-channels', -2400, { causeEventId: 'shared-before', geography: { changes: [{ kind: 'lake', region: 'chad', intensity: 0.8 }] } }),
      event('original-later', -1800, { causeEventId: 'old-channels' }),
    ] },
    { id: 'marsh-alternative', forkedFromHistoryId: 'original', forkEventId: 'old-channels',
      origin: { kind: 'conflicting-suggestion-fork', forkYear: -3000, replacedEvent: { id: 'old-channels', year: -2400 } },
      events: [
        event('shared-before', -3500),
        event('marsh', -3000, { causeEventId: 'q-early', geography: { changes: [{ kind: 'lake', region: 'chad', intensity: 0.2 }] } }),
        event('marsh-later', -1700, { causeEventId: 'marsh', geography: { changes: [{ kind: 'lake', region: 'chad', intensity: 0.9 }] } }),
      ] },
  ] };
  const layout = buildHistorySpineLayout({ questions: [source], activeQuestionId: source.id, activeHistoryId: 'marsh-alternative', asOfYear: -2500 });
  const spine = layout.spines.find(item => item.historyId === 'marsh-alternative');
  const forkNode = layout.nodes.find(node => node.id === spine.forkNodeId);
  assert.equal(spine.forkYear, -3000);
  assert.equal(forkNode.kind, 'history-fork');
  assert.equal(forkNode.year, -3000);
  assert.deepEqual(spine.sharedEventIds, ['shared-before'], 'events at and after forkYear are not shared prefix');
  assert.deepEqual(spine.nodeIds, ['event:early-conflict:marsh', 'event:early-conflict:marsh-later']);
  assert.ok(!spine.segments.some(segment => segment.fromNodeId === 'event:early-conflict:old-channels'),
    'the later replaced event is not used as the earlier branch attachment');
  assert.deepEqual(layout.nodes.find(node => node.eventId === 'marsh').geography.changes,
    [{ kind: 'lake', region: 'chad', intensity: 0.2 }], 'event mini-Earth geography is composed only through that event date');
  assert.ok(layout.nodes.every(node => Number.isFinite(node.x) && Number.isFinite(node.y)));
  for (const segment of layout.segments) {
    const from = layout.nodes.find(node => node.id === segment.fromNodeId);
    const to = layout.nodes.find(node => node.id === segment.toNodeId);
    assert.ok(to.year >= from.year, `segment ${segment.id} must stay chronological`);
  }
});

test('missing divergence metadata falls back to earliest fork year and other questions become history chips', () => {
  const active = question(); delete active.divergenceYear;
  const other = { id: 'q-river', title: 'River engineering', origin:'user-written', divergencePlace:{ name:'River delta', lat:3, lon:102 }, histories: [
    { id: 'r1', events: [event('river-event', 1200)] }, { id: 'r2', events: [event('river-alt', 1300)] },
  ] };
  const layout = buildHistorySpineLayout({ questions: [active, other], activeQuestionId: active.id, activeHistoryId: 'h-main' });
  assert.equal(layout.trunk.divergenceYear, -3000);
  assert.deepEqual(layout.chips, [{ id: 'question-chip:q-river', questionId: 'q-river', title:'River engineering', origin:'user-written',
    place:{ name:'River delta', lat:3, lon:102 }, label: 'River engineering · 2 histories', historyCount: 2, year: 1200, x: 1200, y: 0 }]);
  assert.ok(layout.spines.every(spine => spine.questionId === 'q-sahara'));
  const duplicatedActive = { ...active };
  const duplicateQuestionLayout = buildHistorySpineLayout({ questions:[active,duplicatedActive,other], activeQuestionId:active.id,
    activeHistoryId:'h-main', asOfYear:-2500 });
  assert.deepEqual(duplicateQuestionLayout.chips.map(chip => chip.questionId), ['q-river'],
    'duplicate active-question records never become an other-question count chip');
});

test('spine suggestions require the exact active window unless supplied by the already-filtered current session', () => {
  const source = question();
  source.histories[1].suggestions = [
    { id:'missing-window', year:-2500 },
    { id:'wrong-history', historyId:'h-main', year:-2500 },
  ];
  const options = { questions:[source], activeQuestionId:source.id, activeHistoryId:'h-fork', asOfYear:-2500,
    window:{ fromYear:-3000, toYear:-2001 } };
  assert.deepEqual(buildHistorySpineLayout(options).spines.find(item => item.historyId === 'h-fork').suggestions, [],
    'persisted suggestions without exact window identity or belonging to another history are excluded');
  const sessionSuggestions = [{ id:'session-current', year:-2500 }, { id:'wrong-history', historyId:'h-main', year:-2500 }];
  assert.deepEqual(buildHistorySpineLayout({ ...options, suggestions:sessionSuggestions }).spines.find(item => item.historyId === 'h-fork')
    .suggestions.map(item => item.id), ['session-current'], 'session-prefiltered suggestions are supported but still history-scoped');
});

test('empty histories retain a finite question divergence anchor', () => {
  const layout = buildHistorySpineLayout({ questions: [{ id: 'empty', divergenceYear: 50, histories: [{ id: 'empty-history', events: [] }] }],
    activeQuestionId: 'empty', activeHistoryId: 'empty-history' });
  assert.equal(layout.trunk.divergenceYear, 50);
  assert.equal(layout.nodes.find(node => node.kind === 'question-divergence').x, 50);
  assert.equal(layout.spines[0].nodeIds.length, 0);
});

test('empty fork histories keep a bounded synthetic fork position', () => {
  const source = { id: 'empty-child', divergenceYear: -5000, histories: [
    { id: 'root', events: [event('before-fork', -4000), event('replaced', -2000)] },
    { id: 'empty-fork', forkedFromHistoryId: 'root', forkEventId: 'replaced',
      origin: { forkYear: -3000 }, events: [] },
  ] };
  const layout = buildHistorySpineLayout({ questions: [source], activeQuestionId: source.id, activeHistoryId: 'empty-fork' });
  const spine = layout.spines.find(item => item.historyId === 'empty-fork');
  const fork = layout.nodes.find(node => node.id === spine.forkNodeId);
  assert.equal(fork.kind, 'history-fork');
  assert.equal(fork.year, -3000);
  assert.equal(spine.nodeIds.length, 0);
  assert.ok(layout.nodes.every(node => Number.isFinite(node.x) && Number.isFinite(node.y)));
});
