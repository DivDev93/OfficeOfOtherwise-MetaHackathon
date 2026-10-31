import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizeGeography, geographyText, withGeographyPrompt } from '../web/geography.js';
import { continuationFor } from '../src/demo/continuation.js';

export const GREEN = { version: 1, changes: [{ id: 'green-sahara', kind: 'vegetation', region: 'sahara', intensity: 0.7,
  assumption: 'The Sahara retains extensive grassland.', uncertainty: 'Rainfall and exact vegetation boundaries are hypothetical.' }] };

test('geography validates bounded complete schema and copies model data', () => {
  assert.equal(normalizeGeography(undefined), undefined);
  assert.deepEqual(normalizeGeography({ version: 1, changes: [] }), { version: 1, changes: [] });
  const normalized = normalizeGeography(GREEN);
  assert.deepEqual(normalized, GREEN);
  normalized.changes[0].intensity = 1;
  assert.equal(GREEN.changes[0].intensity, 0.7);
  for (const state of [null, [], {}, { ...GREEN, version: 2 }, { ...GREEN, extra: 'hidden' }, { ...GREEN, changes: Array(13).fill(GREEN.changes[0]) },
    { ...GREEN, changes: [GREEN.changes[0], GREEN.changes[0]] }]) assert.throws(() => normalizeGeography(state), /Invalid geography/);
  for (const field of [{ id: '../secret' }, { id: 'x'.repeat(65) }, { kind: 'coastline' }, { kind: 'land' }, { region: 'atlantis' }, { intensity: NaN }, { intensity: Infinity },
    { intensity: -0.1 }, { intensity: 1.1 }, { intensity: '1' }, { assumption: '' }, { uncertainty: 'x'.repeat(501) }, { assumption: 'hidden\ntext' }, { extra: true }]) {
    assert.throws(() => normalizeGeography({ version: 1, changes: [{ ...GREEN.changes[0], ...field }] }), /Invalid geography/);
  }
});

test('effective geography inherits all conditions and forbids loss, replacement or weakening', () => {
  assert.deepEqual(normalizeGeography(undefined, { inherited: GREEN }), GREEN);
  const refined = { version: 1, changes: [{ ...GREEN.changes[0], intensity: 0.9 }, { id: 'lake-sahara', kind: 'lake', region: 'sahara', intensity: 0.2,
    assumption: 'Seasonal lakes persist.', uncertainty: 'Lake extents are illustrative.' }] };
  assert.deepEqual(normalizeGeography(refined, { inherited: GREEN }), refined);
  for (const state of [{ version: 1, changes: [] }, ...[{ id: 'renamed' }, { region: 'beringia' }, { kind: 'land' }, { intensity: 0.1 },
    { assumption: `Not ${GREEN.changes[0].assumption}` }, { uncertainty: 'Certain.' }].map(field => ({ version: 1, changes: [{ ...GREEN.changes[0], ...field }] }))]) {
    assert.throws(() => normalizeGeography(state, { inherited: GREEN }), /Invalid geography/);
  }
});

test('bounded v2 geography normalizes, contributes policy text, and remains a full inherited state', () => {
  const state = { version:2, seaLevelMeters:-120, continentalTransforms:[], changes:[{ id:'doggerland-wetland-plain', kind:'vegetation', intensity:0.75,
    bounds:[-2,50,8,58.5], assumption:'Exposed shelf supports marsh, grassland, and mixed woodland.', uncertainty:'Vegetation density varies locally with rivers, soils, and climate.' }] };
  assert.deepEqual(normalizeGeography(state), state);
  assert.match(geographyText(state), /Global sea level relative to present day: -120 m/);
  assert.match(geographyText(state), /within \[-2, 50, 8, 58\.5\]/);
  const continuation = { version:2, seaLevelMeters:-120, continentalTransforms:[], changes:[...state.changes,
    { id:'doggerland-wetland-expansion', kind:'vegetation', intensity:0.8, bounds:[-2,50,8,58.5], assumption:'The exposed shelf remains productive.', uncertainty:'Vegetation density varies locally with rivers, soils, and climate.' }] };
  assert.deepEqual(normalizeGeography(continuation,{inherited:state}),continuation);
  assert.throws(()=>normalizeGeography({version:1,changes:[]},{inherited:state}),/cannot downgrade/);
  assert.throws(()=>normalizeGeography({...continuation,seaLevelMeters:-115},{inherited:state}),/inherited global state/);
});

test('bounded v2 lake parameters preserve an in-bounds saved seed while rejecting out-of-bounds inputs', () => {
  const lake = { id:'doggerland-reserve-lake', bounds:[1,52,4,54], kind:'lake', intensity:0.8,
    waterLevelMeters:-70, seed:[2.5,53],
    assumption:'Low embankments retain river water in a shallow basin above the lowered global sea level.',
    uncertainty:'Lake extent varies with rainfall, river inflow, embankment maintenance, and sedimentation.' };
  const state = { version:2, seaLevelMeters:-120, continentalTransforms:[], changes:[lake],
    assumption:'Global sea level remains approximately 120 metres below present day.',
    uncertainty:'Exact coastlines and lake extents are approximate.' };
  assert.deepEqual(normalizeGeography(state), state, 'the recorded 1968 lake change remains valid');
  assert.match(geographyText(state), /doggerland-reserve-lake: lake within \[1, 52, 4, 54\]/);
  assert.throws(() => normalizeGeography({ ...state, changes:[{ ...lake, seed:[4.5,53] }] }), /lake seed outside bounds/);
  assert.throws(() => normalizeGeography({ ...state, changes:[{ ...lake, waterLevelMeters:-11001 }] }), /water level/);
  assert.throws(() => normalizeGeography({ ...state, changes:[{ ...lake, elevationDeltaMeters:12 }] }), /lake parameters/);
});

test('geography prompt is explicit about illustrative masks and keeps all uncertainty without duplication', () => {
  const prompt = withGeographyPrompt('A research pavilion.', GREEN);
  assert.match(prompt, /illustrative regional masks, not measured terrain/);
  assert.ok(prompt.includes(GREEN.changes[0].assumption));
  assert.ok(prompt.includes(GREEN.changes[0].uncertainty));
  assert.equal(withGeographyPrompt(prompt, GREEN), prompt);
  assert.equal(withGeographyPrompt('A book.', undefined), 'A book.');
  assert.ok(geographyText(GREEN).includes('vegetation in sahara'));
});

test('saved continuation retains full geography and inherited conditions when a later old branch omits it', () => {
  const parent = { id: 'root', divergence: 'What if the Sahara stayed green?', branch: { status: 'ok', branches: [{ id: 'b1', title: 'Grasslands persist', summary: 'A wetter climate sustains grasslands.', year: 300, place: { name: 'Sahara', lat: 24, lon: 12 }, geography: GREEN }] } };
  const first = continuationFor(parent, 'b1');
  assert.deepEqual(first.path[0].geography, GREEN);
  const later = { ...parent, id: 'later', branch: { status: 'ok', branches: [{ ...parent.branch.branches[0], geography: undefined, year: 400 }] } };
  const second = continuationFor(later, 'b1', { status: 'complete', rootDivergence: parent.divergence, continuation: first });
  assert.deepEqual(second.path.map(event => event.geography), [GREEN, GREEN]);
  const prohibited = structuredClone(parent);
  prohibited.branch.branches[0].geography.changes[0].uncertainty = 'An army controls the grassland.';
  assert.throws(() => continuationFor(prohibited, 'b1'), /topic policy/);
});
