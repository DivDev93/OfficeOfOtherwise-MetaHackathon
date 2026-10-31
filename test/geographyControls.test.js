import test from 'node:test';
import assert from 'node:assert/strict';
import { GEOGRAPHY_CONTINENTS, normalizeGeography } from '../web/geography.js';
import { CONTINENT_RANGES, WATER_LEVEL_MAX, WATER_LEVEL_MIN, controlsFromGeography, createGeographyPreviewStore, effectiveGeographyMode, geographyChangeLabel, geographyFromControls, geographyPreviewKey, presentDayGeography } from '../web/geographyControls.js';

const base = {
  version: 2, seaLevelMeters: 35, assumption: 'A hypothetical higher ocean.', uncertainty: 'The value is illustrative.',
  continentalTransforms: [{ continentId: 'africa', longitudeOffsetDeg: 12, latitudeOffsetDeg: -3, rotationDeg: 8,
    assumption: 'Africa moves in this scenario.', uncertainty: 'The placement is fictional.' }],
  changes: [{ id: 'green-sahara', region: 'sahara', kind: 'vegetation', intensity: 0.7,
    assumption: 'Vegetation expands.', uncertainty: 'Coverage is approximate.' }],
};

test('controls round-trip signed global water and full-range selected-continent transforms', () => {
  const controls = controlsFromGeography(base);
  assert.equal(controls.seaLevelMeters, 35);
  assert.deepEqual(controls.transforms.africa, { longitudeOffsetDeg: 12, latitudeOffsetDeg: -3, rotationDeg: 8 });
  controls.seaLevelMeters = -240;
  controls.continentId = 'antarctica';
  controls.transforms.antarctica = { longitudeOffsetDeg: -180, latitudeOffsetDeg: 90, rotationDeg: -180 };
  const preview = geographyFromControls(base, controls);
  assert.deepEqual(normalizeGeography(preview), preview);
  assert.equal(preview.seaLevelMeters, -240);
  assert.deepEqual(preview.continentalTransforms.find(item => item.continentId === 'antarctica'), {
    continentId: 'antarctica', longitudeOffsetDeg: -180, latitudeOffsetDeg: 90, rotationDeg: -180,
    assumption: 'Local illustrative what-if adjustment.', uncertainty: 'Display-only preview; not a physical reconstruction.',
  });
  assert.deepEqual(preview.changes, base.changes);
  assert.equal(base.seaLevelMeters, 35, 'saved branch input stays unchanged');
});

test('all registered continents and schema endpoints remain available to the controls', () => {
  assert.deepEqual(GEOGRAPHY_CONTINENTS, ['africa', 'eurasia', 'north-america', 'south-america', 'australia', 'antarctica']);
  assert.deepEqual(CONTINENT_RANGES, { longitudeOffsetDeg: [-180, 180], latitudeOffsetDeg: [-90, 90], rotationDeg: [-180, 180] });
  assert.equal(WATER_LEVEL_MIN, -11000);
  assert.equal(WATER_LEVEL_MAX, 9000);
  const controls = controlsFromGeography(undefined);
  controls.seaLevelMeters = WATER_LEVEL_MIN;
  controls.transforms.eurasia = { longitudeOffsetDeg: 180, latitudeOffsetDeg: -90, rotationDeg: 180 };
  const preview = geographyFromControls(undefined, controls);
  assert.equal(preview.seaLevelMeters, -11000);
  assert.deepEqual(preview.continentalTransforms.map(item => item.continentId), ['eurasia']);
  controls.seaLevelMeters = WATER_LEVEL_MAX;
  assert.equal(geographyFromControls(undefined, controls).seaLevelMeters, 9000);
});

test('event preview store isolates adjustments and reset restores the selected event defaults', () => {
  const previews = createGeographyPreviewStore();
  const eventA = geographyPreviewKey('run-1', 'branch-a'), eventB = geographyPreviewKey('run-1', 'branch-b');
  const controlsA = previews.get(eventA, base);
  controlsA.seaLevelMeters = -500;
  controlsA.transforms.africa.rotationDeg = 20;
  previews.set(eventA, controlsA);
  const controlsB = previews.get(eventB, { ...base, seaLevelMeters: -20, continentalTransforms: [] });
  assert.equal(controlsB.seaLevelMeters, -20);
  assert.equal(controlsB.transforms.africa, undefined);
  assert.equal(previews.get(eventA, base).seaLevelMeters, -500);
  const reset = previews.reset(eventA, base);
  assert.equal(reset.seaLevelMeters, 35);
  assert.deepEqual(reset.transforms.africa, { longitudeOffsetDeg: 12, latitudeOffsetDeg: -3, rotationDeg: 8 });
  assert.deepEqual(presentDayGeography(), { version: 2, seaLevelMeters: 0, continentalTransforms: [], changes: [] });
});

test('an initially empty map does not overwrite the requested scenario mode before geography arrives', () => {
  let requestedMode = 'scenario';
  assert.equal(effectiveGeographyMode(requestedMode, false), 'present');
  assert.equal(requestedMode, 'scenario');
  assert.equal(effectiveGeographyMode(requestedMode, true), 'scenario');
  requestedMode = 'present';
  assert.equal(effectiveGeographyMode(requestedMode, true), 'present');
});

test('generic bounded overlays have a useful legend label without a legacy region id', () => {
  assert.equal(geographyChangeLabel({ id: 'raised-plateau', bounds: [-8, 5, 14, 24] }), 'raised-plateau · -8.0, 5.0, 14.0, 24.0');
  assert.equal(geographyChangeLabel({ region: 'sahara' }, { sahara: { label: 'Sahara' } }), 'Sahara');
});
