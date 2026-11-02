import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { historyPinColorRole, shouldShowPossibilityOutline } from '../web/historyAtlas.js';

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
  assert.match(scene, /const labelEntries = historyProjection[\s\S]*?entry\.world\.historySurfacePin/,
    'Surface labels stay limited to active as-of pins');
  assert.match(scene, /entry\.world\.historySpineNodeId[\s\S]*?entry\.world\.historySurfacePin/,
    'Atlas labels use spine nodes and Surface labels use current pins');
  assert.match(scene, /worldRecord\.label\.dataset\.historyPinRole = entry\.world\.visualKind === 'history-event'/);
});

test('history scene exposes as-of date and projected pin-role counts as data attributes', () => {
  assert.match(scene, /container\.dataset\.historyAsOfYear = String\(projection\.asOfYear\)/);
  assert.match(scene, /container\.dataset\.historyGoldPinCount = String\(projection\.pins\.length\)/);
  assert.match(scene, /container\.dataset\.historyCyanPinCount = String\(projection\.suggestions\.length\)/);
  assert.match(scene, /container\.dataset\.historyLatestEventId = String\(projection\.latestEvent\?\.id \|\| ''\)/);
});
