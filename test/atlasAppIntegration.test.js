import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const html = readFileSync(new URL('../web/index.html', import.meta.url), 'utf8');
const app = readFileSync(new URL('../web/app.js', import.meta.url), 'utf8');
const css = readFileSync(new URL('../web/style.css', import.meta.url), 'utf8');

test('page uses one persistent Atlas canvas and keeps the complete text exploration tree', () => {
  assert.match(html, /id="atlas-scene"/);
  assert.match(html, /id="atlas-toolbar"/);
  assert.match(html, /id="branch-list"/);
  assert.match(html, /id="world-navigation"/);
  assert.doesNotMatch(html, /id="exploration-map-panel"|id="starmap"|id="globe"/);
  assert.doesNotMatch(html, /popover="manual"/);
});

test('Atlas controller is the only spatial entry surface and previews stay separate from explicit entry', () => {
  assert.match(app, /import \{ createAtlasController \} from '\.\/atlas\/controller\.js'/);
  assert.doesNotMatch(app, /createStarMap|createGlobe/);
  assert.match(app, /onPreview:\(world, anchor\) => showAtlasPreview\(world, anchor\)/);
  assert.match(app, /onEnter:\(world, detail\) => handleAtlasWorldEnter\(world, detail\)/);
  assert.match(app, /onQuestionPreview:\(question, anchor\) => showAtlasPreview/);
  assert.match(app, /onQuestionEnter:\(\) => \{\}/);
  assert.match(app, /const intent = atlasController\?\.getAttachmentIntent/);
  assert.match(app, /await streamRun\('\/api\/run', \{ divergence:prompt, attachment \}/);
  assert.match(app, /setGraph\(graph\)/);
});

test('geography controls preview locally per selected event and restore its scenario on reset', () => {
  for (const id of ['geography-adjustments', 'geography-water-range', 'geography-water-number', 'geography-continent', 'geography-longitude-range', 'geography-latitude-range', 'geography-rotation-range', 'geography-reset-adjustments']) {
    assert.match(html, new RegExp(`id="${id}"`));
  }
  assert.match(app, /geographyPreviewKey\(currentRunId, branch\?\.id\)/);
  assert.match(app, /geographyPreviewControls\.get\(surfacePreviewKey, surfaceGeography\)/);
  assert.match(app, /geographyPreviewControls\.reset\(surfacePreviewKey, surfaceGeography\)/);
  assert.match(app, /atlasController\?\.setGeography\(surfaceGeography, mode, renderState\)/);
  assert.match(css, /\.geography-adjustment-fields/);
});

test('Atlas keeps quick zoom visible, moves real view controls into a disclosure, and offers a clear full-map return path', () => {
  assert.match(app, /function compactAtlasToolbar\(toolbar\)/);
  assert.match(app, /controls\.slice\(0, 3\)/);
  assert.match(app, /controls\.slice\(3\)/);
  assert.match(html, /id="atlas-reopen-controls"[\s\S]*id="atlas-show-tree"[\s\S]*id="atlas-show-selected"/);
  assert.match(css, /\.atlas-view-options-panel/);
  assert.match(css, /\.atlas-focused \.exploration-rail,\.atlas-focused \.hero-panel\{display:none!important\}/);
  assert.match(css, /max\(410px,calc\(50vw - 310px\)\)/, 'desktop canvas avoids the selected-world panel');
  assert.match(app, /atlas-geography-toggle/);
  assert.match(app, /applyAtlasGeographyLevel\(level\?\.level\)/);
  assert.match(app, /enterWorld\?\.\(starNodeId\(atlasCurrentWorldRunId, branch\.id\), \{ zoom:0 \}\)/, 'explicit story entry returns to the Surface level using the selected event owner');
});

test('Orbit compact panels expose a selected-world card and accessible controls', () => {
  for (const id of ['atlas-compact-controls', 'atlas-compact-tree', 'atlas-compact-new', 'atlas-world-card', 'atlas-world-title', 'atlas-world-year', 'atlas-world-thumbnail', 'atlas-open-details']) {
    assert.match(html, new RegExp(`id="${id}"`));
  }
  assert.match(app, /function syncAtlasWorldCard\(/);
  assert.match(app, /formatYear\(world\.year\)/);
  assert.match(app, /atlas-panels-open/);
  assert.match(app, /atlas-details-open/);
  assert.match(css, /var\(--atlas-rail-width,320px\)/);
  assert.match(css, /var\(--atlas-lift,0\)/);
  assert.match(css, /@media\(max-width:700px\)[\s\S]*atlas-compact-controls/);
  assert.match(css, /grid-template-columns:54px minmax\(0,1fr\) minmax\(92px,auto\)/, 'the 390px card reserves at least 92px for its action');
  assert.match(css, /atlas-compact-controls button\{[^}]*min-height:48px/);
  assert.match(css, /atlas-world-card button\{[^}]*min-height:44px/);
  assert.match(css, /body\.atlas-panels-open:has\([^}]+\.atlas-compact-controls\{opacity:1;visibility:visible;pointer-events:auto\}/, 'the tree toggle stays available to close its sheet');
  assert.match(css, /body\.invitation-open:has\([^}]+\.exploration-rail>#invitation\{[^}]*pointer-events:auto\}/, 'New exploration reveals an interactive prompt at Orbit');
  assert.match(css, /width:238px;height:fit-content;min-height:0;max-height:none/, 'compact details have no empty full-height area');
  assert.match(css, /body:has\(#atlas-scene\[data-atlas-level="orbit"\]\) \.hero-panel>:not\(\.atlas-world-card\),\s*body:has\(#atlas-scene\[data-atlas-level="atlas"\]\) \.hero-panel>:not\(\.atlas-world-card\)\{display:none\}/, 'the closed card removes the stage and status rows from layout');
  assert.match(css, /body\.atlas-details-open:has\(#atlas-scene\[data-atlas-level="orbit"\]\) \.hero-panel>:not\(\.atlas-world-card\):not\(\[hidden\]\),\s*body\.atlas-details-open:has\(#atlas-scene\[data-atlas-level="atlas"\]\) \.hero-panel>:not\(\.atlas-world-card\):not\(\[hidden\]\)\{display:block/, 'Open details restores nonhidden chronicle content');
  assert.match(css, /prefers-reduced-motion:reduce/);
});

test('New exploration toggles a blank focused prompt without resetting the saved Atlas graph', () => {
  assert.match(app, /function openNewExploration\(\) \{\s*const opening = !document\.body\.classList\.contains\('invitation-open'\);\s*if \(opening\) \$\('prompt'\)\.value = '';\s*setInvitationOpen\(opening\);\s*if \(opening\) \$\('prompt'\)\.focus\(\{ preventScroll:true \}\);\s*\}/);
  assert.match(app, /\$\('show-invitation'\)\.addEventListener\('click', openNewExploration\)/);
  assert.match(app, /onEnter:\(world, detail\) => handleAtlasWorldEnter\(world, detail\)/);
  assert.match(app, /source === 'present-day-question'/);
  assert.match(app, /\$\('prompt-form'\)\.addEventListener\('submit'/);
});
