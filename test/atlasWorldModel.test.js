import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ATLAS_THEMES, deriveTheme, migrateSavedRun, migrateSavedRuns, normalizeAssetRef } from '../web/atlas/worldModel.js';

const legacy = {
  status: 'ok',
  divergence: 'What if the Bering land bridge never flooded?',
  branches: [
    { id: 'b2', title: 'Reindeer Herders Cross Continents', year: 900, place: { name: 'Nome, Alaska', lat: 64.5011, lon: -165.4064 },
      summary: 'Northern communities exchange breeding animals and knowledge each year.', scene: 'Herders guide reindeer across a wind-packed plain.', score: 9, reviewNote: 'Clear mechanism.' },
    { id: 'b1', title: 'Mammoth Steppe Without End', year: -4500, place: { name: 'Yukon River Valley', lat: 64.06, lon: -139.43 },
      summary: 'Mammoths migrate through continuous grassland.', score: 7 },
  ],
  hero: { branchId: 'b2' },
};

test('v1 migration keeps the question separate and maps stable world IDs and legacy fields', () => {
  const migrated = migrateSavedRun(legacy, { runId: 'beringia', assetRefs: { cutoutRef: 'cutout.png', modelRef: 'model.meshopt.glb' } });
  assert.equal(migrated.questions[0].id, 'beringia');
  assert.equal(migrated.questions[0].question, legacy.divergence);
  assert.equal(migrated.worlds.length, 2);
  const herder = migrated.worlds.find(world => world.id === 'beringia:b2');
  assert.equal(herder.parentId, null);
  assert.equal(herder.questionId, 'beringia');
  assert.deepEqual([herder.year, herder.lat, herder.lon, herder.title, herder.summary], [900, 64.5011, -165.4064, legacy.branches[0].title, legacy.branches[0].summary]);
  assert.equal(herder.theme, 'geography-ecology');
  assert.equal(herder.boldness, 0.9);
  assert.equal(herder.cutoutRef, 'cutout.png');
  assert.equal(herder.modelRef, 'model.meshopt.glb');
  assert.equal(herder.sceneRef, null);
  assert.equal(herder.provenance.sceneImage, 'unavailable');
  assert.deepEqual(herder.provenance.flags, ['legacy-v1', 'theme-keyword-derived', 'boldness-from-review-score', 'scene-image-unavailable', 'selected-hero-image-unavailable']);
  const mammoth = migrated.worlds.find(world => world.id === 'beringia:b1');
  assert.equal(mammoth.boldness, 0.7);
  assert.equal(mammoth.theme, 'geography-ecology');
});

test('branch images attach only to their exact world; nonhero worlds never inherit the run hero', () => {
  const sceneRef = { path: 'candidate/live/.event-scenes/verified-event.png', status: 'complete' };
  const heroRef = { path: 'candidate/live/run/hero.png', status: 'complete' };
  const migrated = migrateSavedRun(legacy, {
    runId: 'beringia',
    assetRefsByBranch: { 'beringia:b1': { sceneRef, heroRef, cutoutRef: 'candidate/live/run/cutout.png', heroSelected: true } },
    assetRefs: { heroRef },
  });
  const heroWorld = migrated.worlds.find(world => world.id === 'beringia:b2');
  const otherWorld = migrated.worlds.find(world => world.id === 'beringia:b1');
  assert.deepEqual(heroWorld.heroRef, heroRef);
  assert.equal(heroWorld.sceneRef, null);
  assert.equal(heroWorld.provenance.sceneImage, 'unavailable');
  assert.deepEqual(otherWorld.sceneRef, sceneRef);
  assert.equal(otherWorld.heroRef, null);
  assert.equal(otherWorld.provenance.heroImage, 'not-selected');
  assert.equal(otherWorld.provenance.flags.includes('selected-hero-image-available'), false);
});

test('new theme values, boldness, and question divergence metadata are preserved', () => {
  const migrated = migrateSavedRun({
    ...legacy,
    divergenceYear: -3000,
    divergencePlace: { name: 'Beringia', lat: 65, lon: -170 },
    branches: [{ ...legacy.branches[0], theme: 'science-medicine', boldness: 0.62 }],
  }, { runId: 'new-run' });
  assert.deepEqual(migrated.questions[0], { id: 'new-run', rootRunId: 'new-run', question: legacy.divergence, divergenceYear: -3000, divergencePlace: { name: 'Beringia', lat: 65, lon: -170 } });
  assert.equal(migrated.worlds[0].theme, 'science-medicine');
  assert.equal(migrated.worlds[0].boldness, 0.9); // review score remains canonical
  assert.deepEqual(ATLAS_THEMES, ['geography-ecology', 'science-medicine', 'infrastructure-trade', 'culture-daily-life']);
});

test('deterministic migration preserves continuation ancestry and deduplicates saved roots', () => {
  const root = { ...legacy, runId: 'root' };
  const child = {
    runId: 'child',
    divergence: legacy.divergence,
    continuation: { rootRunId: 'root', parentRunId: 'root', parentBranchId: 'b2', path: [
      { runId: 'root', branchId: 'b2', ...legacy.branches[0] },
    ] },
    branches: [{ id: 'c1', title: 'Shared caravan routes', year: 1100, place: { lat: 65, lon: -165 }, summary: 'Caravans maintain a northern trade route.', score: 8 }],
  };
  const records = [{ runId: 'root', run: root }, { runId: 'child', run: child }];
  const a = migrateSavedRuns(records, { sources: [{ path: 'demo/runs/root/branch.json', sha256: 'a'.repeat(64) }] });
  const b = migrateSavedRuns(records, { sources: [{ path: 'demo/runs/root/branch.json', sha256: 'a'.repeat(64) }] });
  assert.deepEqual(a, b);
  assert.equal(a.worlds.filter(world => world.id === 'root:b2').length, 1);
  const descendant = a.worlds.find(world => world.id === 'child:c1');
  assert.equal(descendant.parentId, 'root:b2');
  assert.equal(descendant.questionId, 'root');
  assert.equal(descendant.provenance.reviewDepth, 1);
  assert.equal(a.metadata.counts.worlds, a.worlds.length);
});

test('asset refs reject URLs, absolute paths, traversal, and unsupported characters', () => {
  assert.equal(normalizeAssetRef('runs/beringia/model.glb'), 'runs/beringia/model.glb');
  for (const ref of ['https://example.com/model.glb', '/tmp/model.glb', '../secret.glb', 'C:/secret.glb', 'folder\\model.glb', 'model.glb?token=x']) {
    assert.equal(normalizeAssetRef(ref), undefined, ref);
  }
});

test('theme inference is deterministic and defaults to the public culture theme', () => {
  assert.equal(deriveTheme('A canal connects workshops and markets.'), 'infrastructure-trade');
  assert.equal(deriveTheme('A village shares seasonal music.'), 'culture-daily-life');
  assert.equal(deriveTheme('A new medicine improves health.'), 'science-medicine');
  assert.equal(deriveTheme('Unclassified title.'), 'culture-daily-life');
});
