import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { historyPinColorRole } from '../web/historyAtlas.js';

const scene = readFileSync(new URL('../web/atlas/scene.js', import.meta.url), 'utf8');

test('history marker colors keep event and suggestion roles stable through hover', () => {
  assert.equal(historyPinColorRole({ visualKind:'history-event' }), 'gold');
  assert.equal(historyPinColorRole({ visualKind:'history-event', highlighted:true }), 'gold-latest');
  assert.equal(historyPinColorRole({ visualKind:'history-event' }, { hovered:true }), 'gold-hover');
  assert.equal(historyPinColorRole({ visualKind:'history-event', highlighted:true }, { hovered:true }), 'gold-latest-hover');
  assert.equal(historyPinColorRole({ visualKind:'history-suggestion' }), 'cyan');
  assert.equal(historyPinColorRole({ visualKind:'history-suggestion' }, { hovered:true }), 'cyan-hover');
  assert.match(scene, /historyPinColorRole\(world, \{ hovered: entry\.id === focusedId \}\)/,
    'renderer passes scene-local hover identity into the executable role helper');
});

test('history surface drops legacy cyan possibility halos and hides its synthetic current-world label', () => {
  assert.match(scene, /if \(historyProjection && worldRecord\.unenteredOutline\) \{\s*atlasGroup\.remove\(worldRecord\.unenteredOutline\);[\s\S]*?worldRecord\.unenteredOutline = null;/);
  assert.match(scene, /const labelEntries = historyProjection \? entries\.filter\(entry => !entry\.world\.historySurface\) : entries;/);
  assert.match(scene, /worldRecord\.label\.dataset\.historyPinRole = entry\.world\.visualKind === 'history-event'/);
});

test('history scene exposes as-of date and projected pin-role counts as data attributes', () => {
  assert.match(scene, /container\.dataset\.historyAsOfYear = String\(projection\.asOfYear\)/);
  assert.match(scene, /container\.dataset\.historyGoldPinCount = String\(projection\.pins\.length\)/);
  assert.match(scene, /container\.dataset\.historyCyanPinCount = String\(projection\.suggestions\.length\)/);
  assert.match(scene, /container\.dataset\.historyLatestEventId = String\(projection\.latestEvent\?\.id \|\| ''\)/);
});
