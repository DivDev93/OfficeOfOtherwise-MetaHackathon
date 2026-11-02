import { test } from 'node:test';
import assert from 'node:assert/strict';
import { historyWindowForYear, layoutHistoryPins, projectHistoryAtlas } from '../web/historyAtlas.js';

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

test('Atlas suggestions stay within the active history and exact current window', () => {
  const projected = projectHistoryAtlas(question(), { historyId: 'history-main', asOfYear: -2500, window: { fromYear: -3000, toYear: -2001 } });
  assert.deepEqual(projected.suggestions.map(item => item.id), ['sug-in-window']);
  assert.equal(projected.suggestions[0].selectionEventId, 'event-channel');
  assert.deepEqual(projected.suggestions[0].sceneRef, { path: 'scenes/channel.png', status: 'complete' });
  assert.equal(projected.suggestions[0].visualKind, 'history-suggestion');
});

test('session-provided current-window suggestions are retained without a persisted window field', () => {
  const supplied = [event('session-suggestion', -2400, { suggestionForEventId: 'woven-event' })];
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
