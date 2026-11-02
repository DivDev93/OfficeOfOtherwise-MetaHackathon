import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  composeGeography, deriveEras, migrateSavedTree, normalizeHistory, normalizeQuestionHistories,
} from '../web/historyModel.js';

const event = (id, year, title = id, extra = {}) => ({ id, year, title, summary: `${title} summary`, place: { name: 'Lake Chad', lat: 13, lon: 14 }, ...extra });

function saved(runId, branches, continuation = {}) {
  return { runId, run: { id: runId, divergence: 'What if the Sahara had stayed green?', branches, ...continuation } };
}

const branches = {
  a: { id: 'a', year: -5000, title: 'Grasslands spread', summary: 'Rain supports grasses.', place: { lat: 20, lon: 10 } },
  b: { id: 'b', year: -3000, title: 'Farmers settle', summary: 'Families plant grains.', place: { lat: 20, lon: 10 } },
  c: { id: 'c', year: -2800, title: 'Sailboats cross the lake', summary: 'Boats connect shores.', place: { lat: 13, lon: 14 } },
  d: { id: 'd', year: -2400, title: 'Channels water dry fields', summary: 'Channels guide seasonal water.', place: { lat: 13, lon: 14 } },
  e: { id: 'e', year: 200, title: 'River trade expands', summary: 'Boats carry goods.', place: { lat: 13, lon: 14 } },
};

test('legacy migration makes the deepest visited path H1 and shares only its pre-fork events', () => {
  const root = saved('root', [branches.a, branches.b, branches.c]);
  const left = saved('left', [branches.d], { continuation: { rootRunId: 'root', path: [
    { runId: 'root', branchId: 'a', ...branches.a }, { runId: 'root', branchId: 'b', ...branches.b },
  ] } });
  const right = saved('right', [branches.e], { continuation: { rootRunId: 'root', path: [
    { runId: 'root', branchId: 'a', ...branches.a }, { runId: 'root', branchId: 'c', ...branches.c },
  ] } });
  const source = [root, left, right];
  const before = structuredClone(source);
  const result = migrateSavedTree(source);
  const question = result.questions[0];
  assert.equal(question.id, 'root');
  assert.equal(question.histories.length, 2);
  const [h1, h2] = question.histories;
  assert.equal(h1.events[0].id, 'root:a');
  assert.equal(h1.events[1].id, 'root:b');
  assert.equal(h2.events[0].id, 'root:a');
  assert.equal(h2.events[1].id, 'root:c');
  assert.equal(h2.forkEventId, 'root:a');
  assert.equal(h1.events[0].causeEventId, 'root');
  assert.equal(h1.events[1].causeEventId, 'root:a');
  assert.deepEqual(h1.suggestions.map(item => item.suggestionForEventId), ['left:d']);
  assert.equal(h1.suggestions[0].verdict, 'fits');
  assert.equal(h1.suggestions[0].reason, 'migrated from earlier exploration');
  assert.equal(h2.suggestions[0].suggestionForEventId, 'right:e');
  assert.deepEqual(source, before, 'migration leaves saved records untouched');
  assert.deepEqual(result, migrateSavedTree(source), 'IDs and tie ordering are deterministic');
  assert.deepEqual(result.metadata.counts, { questions: 1, histories: 2, events: 4, suggestions: 2 });
});

test('legacy migration retains only explicit question title, divergence year, place, and origin metadata', () => {
  const record = saved('metadata-root',[branches.a]);
  record.run.questionAttachment = { mode:'present-day', divergenceYear:-4200, divergencePlace:{name:'Sahara',lat:24,lon:10}, origin:'user-written' };
  record.run.questionTitle = 'Water observatories';
  const question = migrateSavedTree([record]).questions[0];
  assert.equal(question.title,'Water observatories');
  assert.equal(question.divergenceYear,-4200);
  assert.deepEqual(question.place,{name:'Sahara',lat:24,lon:10});
  assert.equal(question.origin,'user-written');
  const without = migrateSavedTree([saved('plain-root',[branches.a])]).questions[0];
  assert.equal(Object.hasOwn(without,'divergenceYear'),false,'no year is invented from event or browser date');
  assert.equal(Object.hasOwn(without,'place'),false);
  assert.equal(Object.hasOwn(without,'origin'),false);
});

test('unvisited root candidates become cached suggestions with media refs and no synthetic event history', () => {
  const run = saved('solo', [{ ...branches.a, scene: 'A painted wetland', geography: { version: 1, changes: [] } }]);
  run.assetRefsByBranch = { 'solo:a': { sceneRef: { path: 'scenes/a.png', status: 'complete' }, modelRef: '../private.glb' } };
  const migrated = migrateSavedTree([run]);
  const history = migrated.questions[0].histories[0];
  assert.equal(history.events.length, 0);
  assert.equal(history.suggestions.length, 1);
  assert.equal(history.suggestions[0].sceneRef.path, 'scenes/a.png');
  assert.equal(history.suggestions[0].modelRef, undefined);
  assert.deepEqual(history.suggestions[0].geography, { version: 1, changes: [] });
  assert.deepEqual(history.suggestions[0].window, { fromYear: -5500, toYear: -4500 });
});

test('migration includes the selected root hero and preserves event and history metadata', () => {
  const hero = { ...branches.a, causeEventId: 'hero-run', checkFlags: { ripple: true, reviewed: false },
    origin: { type: 'saved-run', runId: 'hero-run' }, forkEventId: 'prior-event', forkReason: 'deliberate alternative' };
  const record = saved('hero-run', [hero, branches.b], { hero: { branchId: 'a' } });
  record.assetRefsByBranch = { a: {
    heroRef: { status: 'complete', url: '/runs/hero-run/hero.png', path: 'hero-run/hero.png', runId: 'hero-run', branchId: 'a' },
    sceneRef: { status: 'complete', url: 'https://evil.example/scene.png', runId: 'hero-run', branchId: 'a' },
    cutoutRef: { status: 'complete', url: '/event-cutouts/' + 'a'.repeat(64) + '.png', runId: 'hero-run', branchId: 'a' },
  } };
  const history = migrateSavedTree([record]).questions[0].histories[0];
  assert.deepEqual(history.events.map(item => item.id), ['hero-run:a']);
  const migrated = history.events[0];
  assert.equal(migrated.causeEventId, 'hero-run');
  assert.deepEqual(migrated.checkFlags, { ripple: true, reviewed: false });
  assert.deepEqual(migrated.origin, { type: 'saved-run', runId: 'hero-run' });
  assert.equal(migrated.forkEventId, 'prior-event');
  assert.equal(migrated.forkReason, 'deliberate alternative');
  assert.deepEqual(migrated.heroRef, { path: 'hero-run/hero.png', status: 'complete', url: '/runs/hero-run/hero.png', runId: 'hero-run', branchId: 'a' });
  assert.equal(migrated.sceneRef, undefined, 'external media URLs are rejected');
  assert.equal(migrated.cutoutRef.url, '/event-cutouts/' + 'a'.repeat(64) + '.png');
  assert.equal(history.suggestions[0].suggestionForEventId, 'hero-run:b');
});

test('history ID stays stable when an existing selected-hero path is extended', () => {
  const root = saved('stable-root', [branches.a], { hero: { branchId: 'a' } });
  const before = migrateSavedTree([root]).questions[0].histories[0];
  const child = saved('stable-child', [branches.d], { continuation: { rootRunId: 'stable-root', path: [
    { runId: 'stable-root', branchId: 'a', ...branches.a },
    { runId: 'stable-child', branchId: 'd', ...branches.d },
  ] } });
  const after = migrateSavedTree([root, child]).questions[0].histories[0];
  assert.equal(after.id, before.id);
  assert.deepEqual(after.events.map(item => item.id), ['stable-root:a', 'stable-child:d']);
});

test('migration assigns unique bounded IDs to four leaves sharing the same divergent root', () => {
  const a = { ...branches.a, id: 'a' }, b = { ...branches.b, id: 'b' };
  const root = saved('deep-root', [a], { hero: { branchId: 'a' } });
  const middle = saved('deep-middle', [b], { continuation: { rootRunId: 'deep-root', path: [
    { runId: 'deep-root', branchId: 'a', ...a },
  ] }, hero: { branchId: 'b' } });
  const leaves = ['c1', 'c2', 'c3', 'c4'].map((branchId, index) => {
    const leaf = { id: branchId, year: -2700 + index, title: `Leaf ${branchId}`, summary: `Visited ${branchId}.`, place: { lat: 13, lon: 14 } };
    return saved(`deep-leaf-${branchId}`, [], { continuation: { rootRunId: 'deep-root', path: [
      { runId: 'deep-root', branchId: 'a', ...a },
      { runId: 'deep-middle', branchId: 'b', ...b },
      { runId: `deep-leaf-${branchId}`, branchId, ...leaf },
    ] } });
  });
  const histories = migrateSavedTree([root, middle, ...leaves]).questions[0].histories;
  assert.equal(histories.length, 4);
  assert.equal(new Set(histories.map(history => history.id)).size, 4);
  assert.ok(histories.every(history => history.id.length <= 240));
  assert.ok(histories.every(history => history.events[0].id === 'deep-root:a' && history.events[1].id === 'deep-middle:b'),
    'each sibling keeps the full shared visited prefix');
  assert.deepEqual(histories.map(history => history.events.at(-1).id).sort(), leaves.map((_, index) => `deep-leaf-c${index + 1}:c${index + 1}`).sort());
});

test('normalization sorts events, validates causal references, and derives stable gap eras', () => {
  const history = normalizeHistory({ id: 'h', events: [event('later', 1000), event('early', -1000)] }, { questionId: 'q', maxEraGapYears: 500 });
  assert.deepEqual(history.events.map(item => item.id), ['early', 'later']);
  assert.equal(history.events[0].causeEventId, 'q');
  assert.equal(history.events[1].causeEventId, 'early');
  assert.notEqual(history.events[0].era, history.events[1].era);
  assert.equal(deriveEras([event('b', 0 + 1), event('a', -100)], { maxGapYears: 200 }).get('a'), 'Era 1 · 100 BCE–1 CE');
  assert.throws(() => normalizeHistory({ events: [event('x', 10, 'x', { causeEventId: 'missing' })] }, { questionId: 'q' }), /Cause event|First event/);
  assert.throws(() => normalizeQuestionHistories({ id: 'q', histories: [{ events: [event('x', 10), event('x', 11)] }] }), /Duplicate/);
  assert.throws(() => normalizeQuestionHistories({ id: 'q', histories: [{ id: 'same', events: [] }, { id: 'same', events: [] }] }), /Duplicate history/);
});

test('normalization keeps explicit question causes on later events and preserves history metadata', () => {
  const history = normalizeHistory({ id: 'h', origin: { source: 'saved' }, forkedFromHistoryId: 'h0', checkFlags: ['reviewed'], events: [
    event('first', -100, 'First'), event('later', 100, 'Later', { causeEventId: 'q', checkFlags: { verified: true } }),
  ] }, { questionId: 'q' });
  assert.equal(history.events[0].causeEventId, 'q');
  assert.equal(history.events[1].causeEventId, 'q');
  assert.deepEqual(history.events[1].checkFlags, { verified: true });
  assert.deepEqual(history.origin, { source: 'saved' });
  assert.equal(history.forkedFromHistoryId, 'h0');
  assert.deepEqual(history.checkFlags, ['reviewed']);
});

test('composed geography uses date cutoff, later same-region/kind override, and zero intensity removal', () => {
  const early = { version: 1, changes: [
    { id: 'green-sahara', kind: 'vegetation', region: 'sahara', intensity: 0.8, assumption: 'Earlier state', uncertainty: 'Illustrative' },
    { id: 'lake-chad', kind: 'lake', region: 'sahara', intensity: 0.7, assumption: 'Lake remains', uncertainty: 'Illustrative' },
  ] };
  const later = { version: 1, changes: [
    { id: 'dry-sahara', kind: 'vegetation', region: 'sahara', intensity: 0.2, assumption: 'Later state', uncertainty: 'Illustrative' },
    { id: 'remove-lake', kind: 'lake', region: 'sahara', intensity: 0, assumption: 'Lake is removed', uncertainty: 'Illustrative' },
  ] };
  const events = [event('early', -3000, 'Early', { geography: early }), event('late', -2400, 'Late', { geography: later })];
  assert.deepEqual(composeGeography(events, -2500), early);
  assert.deepEqual(composeGeography(events, -2000), { version: 1, changes: [later.changes[0]] });
  assert.deepEqual(composeGeography([], 0), { version: 1, changes: [] });
});

test('composed v2 geography retains global sea-level and continent fields with regional overrides', () => {
  const early = { version: 2, seaLevelMeters: -120, continentalTransforms: [{ continentId: 'africa', longitudeOffsetDeg: 12, latitudeOffsetDeg: 0, rotationDeg: 0 }], changes: [
    { id: 'green', kind: 'vegetation', region: 'sahara', intensity: .8 },
    { id: 'lake', kind: 'lake', region: 'sahara', intensity: .7 },
  ] };
  const later = { version: 2, seaLevelMeters: -80, continentalTransforms: early.continentalTransforms, changes: [
    { id: 'dry', kind: 'vegetation', region: 'sahara', intensity: .2 },
    { id: 'remove-lake', kind: 'lake', region: 'sahara', intensity: 0 },
  ] };
  assert.deepEqual(composeGeography([event('a', -3000, 'A', { geography: early }), event('b', -2400, 'B', { geography: later })], -2000), {
    version: 2, seaLevelMeters: -80, continentalTransforms: early.continentalTransforms, changes: [later.changes[0]],
  });
});
