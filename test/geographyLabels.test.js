import test from 'node:test';
import assert from 'node:assert/strict';
import { geographyLabel, geographyKindLabel, geographyTechnicalDetails, geographyDisplayChanges } from '../web/geographyLabels.js';

test('curated surface names replace raw region ids with human labels', () => {
  assert.equal(geographyLabel({ id: 'sundaland-land', region: 'sundaland', kind: 'land' }), 'Sundaland lowland forest');
  assert.equal(geographyLabel({ region: 'sahara', kind: 'vegetation' }), 'Green Sahara');
  assert.equal(geographyKindLabel({ kind: 'land' }), 'Exposed / connected land');
});

test('future event display metadata is read without changing the object', () => {
  const event = { id: 'event-7', title: 'A river changes course', place: { name: 'Sundaland', bbox: [98.123456, -9, 120, 12] } };
  assert.equal(geographyLabel(event), 'A river changes course');
  assert.deepEqual(geographyTechnicalDetails(event), { id: 'event-7', bbox: [98.1235, -9, 120, 12] });
  assert.equal(event.place.bbox[0], 98.123456);
});

test('technical identifiers and bounds are omitted unless valid and are never used as default labels', () => {
  assert.equal(geographyLabel({ id: 'green-sahara', region: 'sahara' }), 'Sahara');
  assert.deepEqual(geographyTechnicalDetails({ id: 'green-sahara', bbox: [1, 2, Infinity, 4] }), { id: 'green-sahara' });
  assert.deepEqual(geographyTechnicalDetails({ id: 42, bounds: 'hidden' }), {});
});

test('bounded future geography metadata stays displayable without claiming atlas support', () => {
  const data = { version:2, seaLevelMeters:-115, changes:[
    { id:'sundaland-forest-plain', kind:'forest', intensity:.9, bounds:[95,-8,120,7], assumption:'A tropical forest spreads across the exposed shelf.', uncertainty:'Vegetation varies locally.' },
    { id:'coastal-mangrove-fringe', kind:'mangrove', intensity:.6, bounds:[100,-5,118,3], assumption:'Mangroves extend inland.', uncertainty:'Coastal extent is hypothetical.' },
  ] };
  const changes = geographyDisplayChanges(data);
  assert.equal(changes.length, 2);
  assert.equal(geographyLabel(changes[0]), 'Sundaland Forest Plain');
  assert.equal(geographyKindLabel(changes[0]), 'Forest');
  assert.deepEqual(geographyTechnicalDetails(changes[0]), { id:'sundaland-forest-plain', bbox:[95,-8,120,7] });
  assert.equal(data.version, 2, 'display extraction does not mutate or normalize scenario data');
  assert.deepEqual(geographyDisplayChanges({ changes:[{ ...data.changes[0], bounds:[0,91,10,95] }] }), []);
  assert.deepEqual(geographyDisplayChanges({ changes:Array(33).fill(data.changes[0]) }), []);
});
