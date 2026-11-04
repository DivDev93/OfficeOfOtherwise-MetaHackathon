import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { afroEurasiaFacingVector, historyPinCentroid, historyPinColorRole, isHeldHistorySuggestion, isPendingHistoryEvent, layoutHistoryPins, shouldLabelHistoryWorld, shouldShowPossibilityOutline } from '../web/historyAtlas.js';

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

test('woven event feedback pulses only from its absolute expiry and respects reduced motion', () => {
  assert.match(scene, /historyWeaveFeedbackIntensity\(entry\.world\?\.wovenFeedbackExpiresAt, Date\.now\(\), motionReduced\)/,
    'each rendered event samples transient feedback against wall-clock expiry');
  assert.match(scene, /dummy\.scale\.multiplyScalar\(1 \+ weavePulse \* 0\.34\)/,
    'Surface pins receive the pulse scale');
  assert.match(scene, /\.lerp\(HISTORY_GOLD_LATEST, weavePulse \* 0\.55\)/,
    'both Surface and lifted pins brighten gold while pulsing');
});

test('surface history focus uses only canonical pin centroids and landing targets Afro-Eurasia', () => {
  const centroid = historyPinCentroid([
    { world:{ visualKind:'history-event' }, globe:{ x:1, y:0, z:0 } },
    { world:{ visualKind:'history-event' }, globe:{ x:0, y:0, z:1 } },
    { world:{ visualKind:'history-suggestion', historySurfacePin:true }, globe:{ x:-1, y:0, z:0 } },
  ]);
  assert.ok(Math.abs(centroid.x - Math.SQRT1_2) < 1e-9);
  assert.ok(Math.abs(centroid.z - Math.SQRT1_2) < 1e-9);
  assert.ok(afroEurasiaFacingVector().x > 0);
  assert.ok(afroEurasiaFacingVector().y > 0);
  assert.ok(afroEurasiaFacingVector().z < 0);
  const arabia = layoutHistoryPins([{ id:'arabia', lat:22, lon:40, visualKind:'history-event' }])[0].globe;
  assert.ok(arabia.x > 0 && arabia.z < 0, 'history longitude matches the renderer texture convention used by other Atlas worlds');
  assert.match(scene, /const canonicalSurfacePins = entries\.map\(entry =>[\s\S]*?historyPinCentroid\(canonicalSurfacePins/);
  assert.match(scene, /surfaceFacingOrientation\(afroEurasiaFacingVector\(\)\)/);
});

test('pending canonical events keep gold semantics and add a display-only dashed outline', () => {
  assert.equal(isPendingHistoryEvent({ visualKind:'history-event', pending:true }), true);
  assert.equal(isPendingHistoryEvent({ visualKind:'history-event', pending:false }), false);
  assert.equal(isPendingHistoryEvent({ visualKind:'history-suggestion', pending:true }), false,
    'held suggestions are not canonical pending events');
  assert.equal(historyPinColorRole({ visualKind:'history-event', pending:true }), 'gold');
  assert.equal(historyPinColorRole({ visualKind:'history-event', pending:true, highlighted:true }), 'gold-latest');
  assert.match(scene, /Pending canonical history event dashed outline/);
  assert.match(scene, /worldRecord\.label\.dataset\.historyPending = String\(isPendingHistoryEvent\(entry\.world\)\)/);
  assert.match(scene, /const diameter = \(entry\.world\.selected \? 22 : 18\) - 4 \* state\.atlas/,
    'the amber status ring is separate from the canonical pin');
  assert.match(scene, /pendingOutline\.position\.copy\(flatSurfacePinMode\s*\?\s*surfacePinAnchorPosition\(entry, state, timestamp\)\s*:\s*worldPosition\(entry, state, timestamp, markerRadius\)\)/,
    'the dashed outline follows the exact flat or lifted pin anchor');
  assert.match(scene, /const depth = -pendingOutline\.position\.clone\(\)\.applyMatrix4\(atlasGroup\.matrixWorld\)\.applyMatrix4\(camera\.matrixWorldInverse\)\.z/);
  assert.match(scene, /worldRadiusForScreenPixels\(Math\.max\(0\.01, depth\), camera\.fov, Math\.max\(1, renderer\.domElement\.clientHeight\), diameter\)/,
    'outline dimensions remain a CSS-pixel diameter as camera depth changes');
  assert.match(scene, /const renderedRadius = flatMarker \? worldRadiusForScreenPixels\(viewDepth, camera\.fov, Math\.max\(1, bounds\.height\), entry\.world\.selected \? 18 : 14\)/,
    'pending status does not resize the small 14/18px Surface pin');
  assert.match(scene, /atlasMarkerHitRadius\(renderedRadius \+ padding, activationRadius, activation\)/,
    'pending status does not enlarge pointer hit geometry');
});

test('held suggestions retain cyan selectable identity and add a CSS-sized display-only halo', () => {
  const held = { id:'held-suggestion', visualKind:'history-suggestion', held:true, selectionEventId:'event-source' };
  assert.equal(isHeldHistorySuggestion(held), true);
  assert.equal(isHeldHistorySuggestion({ ...held, held:false }), false);
  assert.equal(isHeldHistorySuggestion({ ...held, visualKind:'history-event' }), false);
  assert.equal(historyPinColorRole(held), 'cyan');
  assert.equal(held.id, 'held-suggestion');
  assert.equal(held.selectionEventId, 'event-source');
  assert.match(scene, /Held history suggestion dashed cyan outline/);
  assert.match(scene, /worldRecord\.label\.dataset\.historyHeld = String\(isHeldHistorySuggestion\(entry\.world\)\)/);
  assert.match(scene, /heldOutline\.position\.copy\(flatSurfacePinMode\s*\?\s*surfacePinAnchorPosition\(entry, state, timestamp\)\s*:\s*worldPosition\(entry, state, timestamp, markerRadius\)\)/,
    'the halo follows the exact surface or Atlas pin anchor');
  assert.match(scene, /const depth = -heldOutline\.position\.clone\(\)\.applyMatrix4\(atlasGroup\.matrixWorld\)\.applyMatrix4\(camera\.matrixWorldInverse\)\.z/);
  assert.match(scene, /worldRadiusForScreenPixels\(Math\.max\(0\.01, depth\), camera\.fov, Math\.max\(1, renderer\.domElement\.clientHeight\), diameter\)/,
    'halo diameter stays in CSS pixels at close and far camera depths');
  assert.match(scene, /const renderedRadius = flatMarker \? worldRadiusForScreenPixels\(viewDepth, camera\.fov, Math\.max\(1, bounds\.height\), entry\.world\.selected \? 18 : 14\)/,
    'held status leaves the small 14/18px pin unchanged');
  assert.match(scene, /atlasMarkerHitRadius\(renderedRadius \+ padding, activationRadius, activation\)/,
    'the separate halo does not enlarge hit geometry');
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
