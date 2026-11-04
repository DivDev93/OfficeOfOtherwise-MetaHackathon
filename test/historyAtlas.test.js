import { test } from 'node:test';
import assert from 'node:assert/strict';
import { formatHistoryQuestionChip, historyAtlasFrameBounds, historyAtlasStatus, historyOrbitMarkerScale, historyOrbitPositions, historySurfaceVisibility, historyWindowForYear, historyYearToAtlasX, historyZoomPresentation, historyZoomStage, layoutHistoryPins, projectHistoryAtlas, shouldLabelHistoryWorld, shouldShowPossibilityOutline } from '../web/historyAtlas.js';
import { fitCenteredCameraDistance } from '../web/atlasLayout.js';

const place = { name: 'Lake Chad', lat: 13, lon: 14 };
const event = (id, year, extra = {}) => ({ id, year, place, title: id, summary: `${id} summary`, ...extra });

const question = () => ({
  id: 'q-green-sahara',
  question: 'What if the Sahara had stayed green?',
  histories: [
    {
      id: 'history-main',
      events: [
        event('wetlands', -5000, { geography: { version: 1, changes: [
          { id: 'green', kind: 'vegetation', region: 'sahara', intensity: 0.8 },
          { id: 'lake', kind: 'lake', region: 'chad', intensity: 0.7 },
        ] } }),
        event('marsh', -3000, { causeEventId: 'wetlands', geography: { version: 1, changes: [
          { id: 'dry', kind: 'vegetation', region: 'sahara', intensity: 0.2 },
          { id: 'remove-lake', kind: 'lake', region: 'chad', intensity: 0 },
        ] } }),
        event('future', -2000),
      ],
      suggestions: [
        { id: 'sug-in-window', year: -2400, title: 'Seasonal channels', summary: 'Water fields.', place, suggestionForEventId: 'event-channel', window: { fromYear: -3000, toYear: -2001 }, sceneRef: { path: 'scenes/channel.png', status: 'complete' } },
        { id: 'sug-wrong-history', year: -2400, title: 'Other history idea', summary: 'Not active.', place, historyId:'history-sibling', window: { fromYear: -3000, toYear: -2001 } },
        { id: 'sug-overlap-only', year: -2500, title: 'Old cache', summary: 'Old cache.', place, window: { fromYear: -4000, toYear: -3001 } },
        { id: 'sug-outside-date-window', year: -1800, title: 'Later idea', summary: 'Later.', place, window: { fromYear: -2000, toYear: -1001 } },
      ],
    },
    {
      id: 'history-sibling', forkEventId: 'wetlands',
      events: [
        event('wetlands', -5000, { geography: { version: 1, changes: [{ id: 'green', kind: 'vegetation', region: 'sahara', intensity: 0.8 }] } }),
        event('desert', -3200, { geography: { version: 1, changes: [{ id: 'desert', kind: 'vegetation', region: 'sahara', intensity: 0.1 }] } }),
        event('sibling-future', -1000),
      ],
    },
  ],
});

test('Atlas projection shows stable gold event pins through the date and highlights the latest', () => {
  const source = question();
  const projected = projectHistoryAtlas(source, { historyId: 'history-main', asOfYear: -2500, window: { fromYear: -3000, toYear: -2001 } });
  assert.deepEqual(projected.events.map(item => item.id), ['wetlands', 'marsh']);
  assert.deepEqual(projected.pins.map(({ id, visualKind, highlighted, selectionEventId }) => ({ id, visualKind, highlighted, selectionEventId })), [
    { id: 'wetlands', visualKind: 'history-event', highlighted: false, selectionEventId: 'wetlands' },
    { id: 'marsh', visualKind: 'history-event', highlighted: true, selectionEventId: 'marsh' },
  ]);
  assert.equal(projected.latestEvent, source.histories[0].events[1]);
});

test('pending canonical events retain provenance and use normal as-of date and geography', () => {
  const source = question();
  const pending = event('woven-provisional', -2600, {
    pending: true, pendingBatchId: 'batch-1', pendingWindows: [{ fromYear: -3000, toYear: -2001 }],
    causeEventId: 'marsh', sceneRef: { path: 'scenes/pending.png', status: 'complete' },
    geography: { version: 1, changes: [{ id: 'pending-lake', kind: 'lake', region: 'chad', intensity: 0.9 }] },
  });
  source.histories[0].events.push(pending);
  const before = structuredClone(source);
  const projected = projectHistoryAtlas(source, { historyId: 'history-main', asOfYear: -2500,
    window: { fromYear: -3000, toYear: -2001 } });
  const pin = projected.pins.find(item => item.id === pending.id);
  assert.equal(pin.pending, true);
  assert.equal(pin.pendingBatchId, 'batch-1');
  assert.deepEqual(pin.pendingWindows, [{ fromYear: -3000, toYear: -2001 }]);
  assert.equal(pin.causeEventId, 'marsh');
  assert.deepEqual(pin.sceneRef, pending.sceneRef);
  assert.equal(projected.latestEvent.id, pending.id);
  assert.deepEqual(projected.composedGeography.changes, [
    { id: 'dry', kind: 'vegetation', region: 'sahara', intensity: 0.2 },
    ...pending.geography.changes,
  ],
    'pending is a review marker; its canonical event and geography still obey the selected as-of date');
  assert.deepEqual(source, before, 'projection preserves the stored pending event unchanged');
  const beforeDate = projectHistoryAtlas(source, { historyId: 'history-main', asOfYear: -2601,
    window: { fromYear: -3000, toYear: -2001 } });
  assert.ok(!beforeDate.pins.some(item => item.id === pending.id), 'the date does not advance to include pending events');
});

test('held suggestions stay selectable cyan ideas across cache windows without changing history data', () => {
  const source = question();
  const held = { id:'held-old-window', year:-4200, title:'Held lake study', summary:'Still an idea.', place,
    window:{ fromYear:-5000, toYear:-4001 }, sceneRef:{ path:'scenes/held.png', status:'complete' } };
  const heldInCurrentWindow = { ...source.histories[0].suggestions[0], id:'held-current-window' };
  const before = structuredClone(source);
  const projected = projectHistoryAtlas(source, { historyId:'history-main', asOfYear:-2500,
    window:{ fromYear:-3000, toYear:-2001 }, suggestions:[...source.histories[0].suggestions, held, heldInCurrentWindow],
    heldSuggestionIds:[held.id, heldInCurrentWindow.id] });
  const oldIdea = projected.suggestions.find(item => item.id === held.id);
  assert.ok(oldIdea, 'held ideas from other cache windows remain visible');
  assert.equal(oldIdea.held, true);
  assert.equal(oldIdea.visualKind, 'history-suggestion');
  assert.equal(oldIdea.selectionEventId, held.id);
  assert.equal(oldIdea.sceneRef, held.sceneRef);
  const currentIdea = projected.suggestions.find(item => item.id === heldInCurrentWindow.id);
  assert.equal(currentIdea.held, true, 'current-window held ideas use the same selectable pin');
  assert.equal(currentIdea.visualKind, 'history-suggestion');
  assert.equal(projected.heldSuggestionIds.includes(held.id), true);
  assert.equal(projected.suggestions.some(item => item.id === 'sug-overlap-only'), false,
    'unheld ideas from an older overlapping cache stay hidden');
  assert.deepEqual(source, before, 'projection does not mutate source suggestions or history');
});

test('Atlas suggestions stay within the active history and exact current window', () => {
  const projected = projectHistoryAtlas(question(), { historyId: 'history-main', asOfYear: -2500, window: { fromYear: -3000, toYear: -2001 } });
  assert.deepEqual(projected.suggestions.map(item => item.id), ['sug-in-window']);
  assert.equal(projected.suggestions[0].selectionEventId, 'event-channel');
  assert.deepEqual(projected.suggestions[0].sceneRef, { path: 'scenes/channel.png', status: 'complete' });
  assert.equal(projected.suggestions[0].visualKind, 'history-suggestion');
});

test('session-provided current-window suggestions are retained without a persisted window field', () => {
  const supplied = [event('session-suggestion', -2400, { suggestionForEventId: 'woven-event' }),
    event('session-other-history', -2400, { historyId:'history-sibling' })];
  const projected = projectHistoryAtlas(question(), { historyId: 'history-main', asOfYear: -2500,
    window: { fromYear: -3000, toYear: -2001 }, suggestions: supplied });
  assert.deepEqual(projected.suggestions.map(item => item.id), ['session-suggestion']);
});

test('surface geography composes only active-history changes through the selected date', () => {
  const source = question();
  const before = structuredClone(source);
  const projected = projectHistoryAtlas(source, { historyId: 'history-main', asOfYear: -2500, window: { fromYear: -3000, toYear: -2001 } });
  assert.deepEqual(projected.composedGeography, { version: 1, changes: [
    { id: 'dry', kind: 'vegetation', region: 'sahara', intensity: 0.2 },
  ] });
  assert.equal(projected.surface.latestEvent.id, 'marsh');
  assert.equal(projected.surface.geography, projected.composedGeography);
  assert.deepEqual(source, before, 'projection does not alter stored events or media refs');
});

test('sibling Earth snapshots use the same date and keep fork and event metadata', () => {
  const projected = projectHistoryAtlas(question(), { historyId: 'history-main', asOfYear: -2500, window: { fromYear: -3000, toYear: -2001 } });
  assert.equal(projected.siblingEarths.length, 1);
  assert.equal(projected.siblingEarths[0].historyId, 'history-sibling');
  assert.equal(projected.siblingEarths[0].forkEventId, 'wetlands');
  assert.deepEqual(projected.siblingEarths[0].events.map(item => item.id), ['wetlands', 'desert']);
  assert.deepEqual(projected.siblingEarths[0].geography.changes, [
    { id: 'desert', kind: 'vegetation', region: 'sahara', intensity: 0.1 },
  ]);
});

test('Atlas projection derives BCE/CE session windows and rejects invalid context', () => {
  assert.deepEqual(historyWindowForYear(-2400), { fromYear: -3000, toYear: -2001 });
  assert.deepEqual(historyWindowForYear(2026), { fromYear: 2001, toYear: 3000 });
  const source = question();
  assert.equal(projectHistoryAtlas(source, { asOfYear: -2500 }).historyId, 'history-main');
  assert.throws(() => projectHistoryAtlas(source, { historyId: 'missing', asOfYear: -2500 }), /was not found/);
  assert.throws(() => projectHistoryAtlas(source, { asOfYear: 0 }), /nonzero integer/);
  assert.throws(() => projectHistoryAtlas(source, { asOfYear: -2500, window: { fromYear: -2000, toYear: -1001 } }), /contain the selected date/);
});

test('history pin layout keeps every marker as an independent geographic entry beyond the legacy sphere cap', () => {
  const worlds = Array.from({ length: 40 }, (_, index) => ({ id:`event-${index}`, year:-5000 + index,
    lat:index - 20, lon:index * 7 - 100, visualKind:'history-event' }));
  const entries = layoutHistoryPins(worlds, 'surface-world');
  assert.equal(entries.length, 40);
  assert.deepEqual(entries.map(entry => entry.id), worlds.map(world => world.id));
  assert.ok(entries.every(entry => entry.parentId === null && entry.child === false && entry.lineage === false));
  assert.deepEqual(entries[0].world, worlds[0], 'visual records and saved asset references remain attached to their IDs');
});

test('history zoom skips Orbit when optional or ineligible while preserving continuous direct Atlas transition', () => {
  const surface = historyZoomPresentation(0.22, false).state;
  const middle = historyZoomPresentation(0.61, false).state;
  const atlas = historyZoomPresentation(1, false).state;
  const orbitStart = historyZoomPresentation(0.72, true).state;
  const atlasStage = historyZoomPresentation(0.84, true).state;
  const atlasTransition = historyZoomPresentation(0.78, true).state;
  const directTransition = historyZoomPresentation(0.45, false).state;
  assert.equal(surface.orbit, 0);
  assert.equal(middle.orbit, 0);
  assert.equal(atlas.orbit, 0);
  assert.equal(atlas.lift, atlas.atlas);
  assert.ok(surface.atlas < middle.atlas && middle.atlas < atlas.atlas);
  assert.ok(historyZoomPresentation(0.5, true).state.orbit > 0, 'eligible and enabled Orbit retains sibling snapshot stage');
  assert.equal(orbitStart.atlas, 0);
  assert.ok(atlasTransition.atlas > 0 && atlasTransition.atlas < 1, 'Orbit-to-Atlas remains continuous');
  assert.equal(atlasStage.atlas, 1, 'Atlas presentation is fully unfolded when the stage badge changes');
  assert.equal(atlasStage.orbit, 0);
  assert.equal(historyZoomStage(0.25, false), 'surface', 'no-Orbit UI remains Surface while the direct view transition is incomplete');
  assert.equal(historyZoomStage(0.68, false), 'atlas');
  assert.equal(historyZoomPresentation(0.68, false).state.atlas, 1);
  assert.ok(directTransition.atlas > 0 && directTransition.atlas < 1, 'no-Orbit path stays continuous before its Atlas stage');
});

test('history labels follow selectable event records at each representation level', () => {
  const event = { historySurfacePin:true, historySpineNodeId:'event:q:e', visualKind:'history-event' };
  const suggestion = { historySurfacePin:true, visualKind:'history-suggestion' };
  const siblingEarth = { visualKind:'history-sibling' };
  const siblingSpineNode = { historySpineNodeId:'event:q:sibling', visualKind:'history-spine-sibling' };
  assert.equal(shouldLabelHistoryWorld(event, { surface:1, orbit:0, atlas:0 }), true);
  assert.equal(shouldLabelHistoryWorld(suggestion, { surface:1, orbit:0, atlas:0 }), true);
  assert.equal(shouldLabelHistoryWorld(siblingEarth, { surface:0, orbit:1, atlas:0 }), true);
  assert.equal(shouldLabelHistoryWorld(siblingSpineNode, { surface:0, orbit:0, atlas:1 }), true);
});

test('history status badge reports the current presentation stage and active as-of event count', () => {
  assert.equal(historyAtlasStatus('surface', 1), 'SURFACE · HISTORY · 1 EVENT');
  assert.equal(historyAtlasStatus('orbit', 3), 'ORBIT · SIBLING HISTORIES · 3 EVENTS');
  assert.equal(historyAtlasStatus('atlas', 0), 'ATLAS · HISTORY SPINES · 0 EVENTS');
});

test('history Orbit keeps sibling Earths on their ring positions instead of collapsing them onto the Atlas spine', () => {
  const positions = historyOrbitPositions([
    { id:'active', atlas:{ x:-2, y:0, z:0 }, orbit:{ x:-2, y:0, z:0 } },
    { id:'sibling-a', atlas:{ x:-3.6, y:-1.7, z:0 }, orbit:{ x:1.45, y:0, z:0 } },
    { id:'sibling-b', atlas:{ x:-2.95, y:-1.7, z:0 }, orbit:{ x:-1.45, y:0, z:0 } },
  ]);
  assert.deepEqual(positions.get('sibling-a'), { x:1.45, y:0, z:0 });
  assert.deepEqual(positions.get('sibling-b'), { x:-1.45, y:0, z:0 });
});

test('history siblings render as larger muted Earths without legacy cyan possibility halos', () => {
  assert.equal(historyOrbitMarkerScale(1, { visualKind:'history-sibling' }), 4.5);
  assert.equal(historyOrbitMarkerScale(1, { visualKind:'history-suggestion' }), 1);
  assert.equal(shouldShowPossibilityOutline({ historyMode:true, selectable:true }), false);
  assert.equal(shouldShowPossibilityOutline({ historyMode:false, selectable:true }), true);
});

test('synthetic current Earth stays visible on Surface and Orbit, then fades out across Atlas', () => {
  assert.equal(historySurfaceVisibility(0), 1);
  assert.equal(historySurfaceVisibility(0.5), 0.5);
  assert.equal(historySurfaceVisibility(1), 0);
});

test('other-question chip count leads the visible label while full text retains question and divergence year', () => {
  const label = formatHistoryQuestionChip({ title:'What if the Sahara had stayed green through winter?', historyCount:7, year:-2800 });
  assert.match(label.text, /^7 histories · /);
  assert.match(label.fullText, /What if the Sahara had stayed green through winter\?/);
  assert.match(label.fullText, /divergence 2800 BCE/);
  assert.equal(formatHistoryQuestionChip({ title:'Single fork', historyCount:1, year:2400 }).text, '1 history · Single fork');
});

test('history camera frame and phone fit stay tied to bounded spine geometry', () => {
  const bounds = historyAtlasFrameBounds({ positions:[
    { id:'oldest', x:-3.6, y:0 }, { id:'fork', x:0, y:3 }, { id:'latest', x:3.6, y:6 },
  ], chips:[] }, [
    { id:'surface', atlas:{ x:-0.15, y:-1.45 }, world:{ historySurface:true } },
    { id:'pin', atlas:{ x:3.6, y:6 }, world:{ historySpineNodeId:'latest' } },
  ], 'surface');
  assert.deepEqual(bounds, { left:-4.25, right:4.25, bottom:-2.35, top:6.8 });
  const phoneDistance = fitCenteredCameraDistance(bounds, 375 / 812, 38, 1.08);
  assert.ok(phoneDistance < 35, `bounded history frame should fit a phone at close scale, got ${phoneDistance}`);
});

test('one-event history with a distant cached suggestion window keeps all pins inside the Atlas frame', () => {
  const minimum = -2800, maximum = -2800;
  const eventX = historyYearToAtlasX(-2800, minimum, maximum);
  const suggestionXs = [550, 1550].map(year => historyYearToAtlasX(year, minimum, maximum));
  assert.equal(eventX, 0);
  assert.deepEqual(suggestionXs, [3.6, 3.6]);
  const frame = historyAtlasFrameBounds({ positions:[{ id:'only-event', x:eventX, y:0 }], chips:[] }, [
    { id:'event', atlas:{ x:eventX, y:0 }, world:{ historySpineNodeId:'only-event' } },
    ...suggestionXs.map((x, index) => ({ id:`suggestion-${index}`, atlas:{ x, y:0.7 + index * 0.12 }, world:{ visualKind:'history-suggestion' } })),
  ], null);
  assert.ok(frame.right - frame.left < 10, `suggestion years must not expand the camera frame: ${JSON.stringify(frame)}`);
  assert.ok(frame.top < 3, `suggestion lanes remain close to the trunk: ${frame.top}`);
});
