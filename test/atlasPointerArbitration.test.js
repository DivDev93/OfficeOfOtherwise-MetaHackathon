import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { nearestProjectedAnchorHit } from '../web/atlasLayout.js';

const scene = readFileSync(new URL('../web/atlas/scene.js', import.meta.url), 'utf8');

test('regular Atlas hover and activation share nearest projected-anchor arbitration', () => {
  const resolver = scene.match(/function nearestPointerTarget\(event, pagedClusterHit, \{ activation = false \} = \{\}\) \{([\s\S]*?)\n  \}/)?.[1];
  assert.ok(resolver, 'the scene exposes one resolver for pointer targets');
  assert.match(resolver, /hitWorldTarget\(event, \{ activation \}\)/,
    'hover and activation share ordering while preserving distinct marker footprints');
  assert.match(resolver, /hitQuestionChip\(event\)/);
  assert.match(resolver, /hitPresentEarth\(event\)/);
  assert.match(resolver, /hitClusterTarget\(event, \{ excludePaged: true \}\)/);
  assert.match(resolver, /nearestProjectedAnchorHit\(candidates, \{ excludeUnselectableClusters: activation \}\)/);

  const pointerMove = scene.slice(
    scene.indexOf("listen(renderer.domElement, 'pointermove'"),
    scene.indexOf("listen(renderer.domElement, 'pointerup'"),
  );
  const pointerUp = scene.slice(
    scene.indexOf("listen(renderer.domElement, 'pointerup'"),
    scene.indexOf("listen(renderer.domElement, 'pointercancel'"),
  );
  assert.match(pointerMove, /nearestPointerTarget\(event, pagedClusterHit\)/,
    'hover chooses between visible target kinds by projected-anchor distance');
  assert.match(pointerUp, /nearestPointerTarget\(event, pagedClusterHit, \{ activation: true \}\)/,
    'activation uses the same distance ordering and excludes unselectable clusters');
  assert.doesNotMatch(pointerMove, /reference = hitPresentEarth\(event\)|chipHit = reference \? null/,
    'hover no longer gives Present-day Earth a hard-coded first refusal');
  assert.doesNotMatch(pointerUp, /if \(hitPresentEarth\(event\)\)/,
    'activation no longer gives Present-day Earth a hard-coded first refusal');

  const world = {
    id: '0:world:fixture-atlas-world', kind: 'world', priority: 0,
    distanceSquared: 19.2 ** 2, hitDistance: 3,
  };
  const presentEarth = {
    id: '2:present-earth', kind: 'present', priority: 2,
    distanceSquared: 21.9 ** 2, hitDistance: 2,
  };
  assert.equal(nearestProjectedAnchorHit([presentEarth, world]), world,
    'in the measured phone overlap, the closer 44px world target wins over Present-day Earth');
});
