import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { historyPinColorRole, shouldLabelHistoryWorld, shouldShowPossibilityOutline } from '../web/historyAtlas.js';

const scene = readFileSync(new URL('../web/atlas/scene.js', import.meta.url), 'utf8');

test('history marker colors keep event and suggestion roles stable through hover', () => {
  assert.equal(historyPinColorRole({ visualKind:'history-event' }), 'gold');
  assert.equal(historyPinColorRole({ visualKind:'history-event', highlighted:true }), 'gold-latest');
  assert.equal(historyPinColorRole({ visualKind:'history-event' }, { hovered:true }), 'gold-hover');
  assert.equal(historyPinColorRole({ visualKind:'history-event', highlighted:true }, { hovered:true }), 'gold-latest-hover');
  assert.equal(historyPinColorRole({ visualKind:'history-suggestion' }), 'cyan');
  assert.equal(historyPinColorRole({ visualKind:'history-suggestion' }, { hovered:true }), 'cyan-hover');
  assert.equal(historyPinColorRole({ visualKind:'history-spine-event' }), 'gold');
  assert.equal(historyPinColorRole({ visualKind:'history-sibling' }), 'spine-sibling');
  assert.equal(historyPinColorRole({ historySpineRole:'trunk' }), 'spine-trunk');
  assert.equal(historyPinColorRole({ historySpineRole:'trunk', highlighted:true }), 'gold-latest');
  assert.equal(historyPinColorRole({ historySpineRole:'sibling' }), 'spine-sibling');
  assert.equal(historyPinColorRole({ historySpineRole:'sibling' }, { hovered:true }), 'spine-sibling-hover');
  assert.match(scene, /historyPinColorRole\(world, \{ hovered: entry\.id === focusedId \}\)/,
    'renderer passes scene-local hover identity into the executable role helper');
});

test('history surface drops legacy cyan possibility halos and hides its synthetic current-world label', () => {
  assert.equal(shouldShowPossibilityOutline({ historyMode:true, selectable:true }), false,
    'saved history nodes never receive cyan legacy possibility halos');
  assert.equal(shouldShowPossibilityOutline({ historyMode:false, selectable:true }), true,
    'legacy Atlas possibilities keep their established halo');
  assert.equal(shouldLabelHistoryWorld({ historySurfacePin:true }, { atlas:0, orbit:0 }), true,
    'Surface labels include current as-of event pins');
  assert.equal(shouldLabelHistoryWorld({ historySurfacePin:false, historySpineNodeId:'spine:event' }, { atlas:0, orbit:0 }), false,
    'Surface labels exclude off-history spine events');
  assert.equal(shouldLabelHistoryWorld({ historySurfacePin:false, historySpineNodeId:'spine:event' }, { atlas:1, orbit:1 }), true,
    'Atlas labels include spine event targets');
  assert.match(scene, /worldRecord\.label\.dataset\.historyPinRole = entry\.world\.visualKind === 'history-event'/);
});

test('history scene exposes as-of date and projected pin-role counts as data attributes', () => {
  assert.match(scene, /container\.dataset\.historyAsOfYear = String\(projection\.asOfYear\)/);
  assert.match(scene, /container\.dataset\.historyGoldPinCount = String\(projection\.pins\.length\)/);
  assert.match(scene, /container\.dataset\.historyCyanPinCount = String\(projection\.suggestions\.length\)/);
  assert.match(scene, /container\.dataset\.historyLatestEventId = String\(projection\.latestEvent\?\.id \|\| ''\)/);
});

test('pointer hover uses rendered pin geometry while activation retains a larger target', () => {
  assert.match(scene, /hitWorldTarget\(event, \{ activation \}\)/);
  assert.match(scene, /atlasMarkerHitRadius\(renderedRadius \+ padding, activationRadius, activation\)/);
  assert.match(scene, /new THREE\.RingGeometry\(0\.014, SURFACE_PIN_OUTER_RADIUS, 24\)/,
    'flat Surface markers render a thin tangent-plane ring');
  assert.match(scene, /function surfacePinInstanceScale\(entry, position\)[\s\S]*?-position\.clone\(\)\.applyMatrix4\(atlasGroup\.matrixWorld\)\.applyMatrix4\(camera\.matrixWorldInverse\)\.z[\s\S]*?surfacePinScaleForPixels\(/,
    'the rendered ring size uses its actual transformed camera depth');
  assert.match(scene, /if \(!activation && flatMarker\)[\s\S]*?intersectPlane[\s\S]*?const outer = renderedRadius \+ padding[\s\S]*?const inner = Math\.max\(0, renderedRadius \* \(0\.014 \/ SURFACE_PIN_OUTER_RADIUS\) - padding\)[\s\S]*?const dotRadius = renderedRadius \* \(0\.0035 \/ SURFACE_PIN_OUTER_RADIUS\) \+ padding[\s\S]*?distanceSquared < inner \* inner && distanceSquared > dotRadius \* dotRadius/,
    'Surface hover tests the visible annulus and center dot on the tangent plane, excluding the empty ring interior');
  assert.match(scene, /if \(activation && allowEarthBodySelection/,
    'the background Earth is not a hover target when the pointer leaves a pin');
});
