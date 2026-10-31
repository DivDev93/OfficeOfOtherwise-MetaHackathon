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
