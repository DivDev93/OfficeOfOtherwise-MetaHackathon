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

test('New exploration toggles a blank focused prompt without resetting the saved Atlas graph', () => {
  assert.match(app, /function openNewExploration\(\) \{\s*const opening = !document\.body\.classList\.contains\('invitation-open'\);\s*if \(opening\) \$\('prompt'\)\.value = '';\s*setInvitationOpen\(opening\);\s*if \(opening\) \$\('prompt'\)\.focus\(\{ preventScroll:true \}\);\s*\}/);
  assert.match(app, /\$\('show-invitation'\)\.addEventListener\('click', openNewExploration\)/);
  assert.match(app, /onEnter:\(world, detail\) => handleAtlasWorldEnter\(world, detail\)/);
  assert.match(app, /source === 'present-day-question'/);
  assert.match(app, /\$\('prompt-form'\)\.addEventListener\('submit'/);
});
