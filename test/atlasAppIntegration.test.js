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
  assert.match(css, /width:238px;height:142px;min-height:142px;max-height:none/, 'the compact panel fits its selected-world card without a full-height details area');
  assert.match(css, /body:has\(#atlas-scene\[data-atlas-level="orbit"\]\) \.hero-panel>:not\(\.atlas-world-card\),\s*body:has\(#atlas-scene\[data-atlas-level="atlas"\]\) \.hero-panel>:not\(\.atlas-world-card\)\{display:block;position:absolute;inset:0;overflow:hidden;opacity:0;visibility:hidden/, 'the compact card removes full details from layout while keeping them transitionable');
  assert.match(css, /body\.atlas-details-open:has\(#atlas-scene\[data-atlas-level="orbit"\]\) \.hero-panel>:not\(\.atlas-world-card\):not\(\[hidden\]\),\s*body\.atlas-details-open:has\(#atlas-scene\[data-atlas-level="atlas"\]\) \.hero-panel>:not\(\.atlas-world-card\):not\(\[hidden\]\)\{display:block;position:relative;inset:auto;max-height:none;overflow:visible;opacity:1;visibility:visible/, 'Open details restores nonhidden chronicle content for a reverse transition');
  assert.match(css, /\.atlas-world-card\{display:grid;position:absolute;[\s\S]*?opacity:0;visibility:hidden/, 'the card stays renderable so Orbit can fade it in');
  assert.match(css, /\.atlas-world-card\{display:grid;position:absolute;[\s\S]*?transition:opacity \.12s ease \.12s,transform \.16s ease \.08s,visibility 0s linear \.08s/, 'the card appears after the full details fade away');
  assert.match(css, /width:min\(320px,max\(270px,calc\(34vw - 12px\)\)\)/, 'the clipped rail content matches the rail minimum width and does not reflow at its boundary');
  assert.match(css, /\.has-story \.hero-panel\{transition:width \.24s ease,top \.24s ease,right \.24s ease,bottom \.24s ease,left \.24s ease,height \.24s ease,opacity \.18s ease\}/, 'the panel geometry transition remains active when leaving Orbit');
  assert.match(css, /position:absolute;top:0;left:0;width:min\(320px,max\(270px,calc\(34vw - 12px\)\)\);height:100%;max-width:none;max-height:none/, 'the full-width rail content keeps its layout while the rail clips closed');
  assert.match(css, /transition:opacity \.16s ease \.12s,transform \.2s ease \.08s,visibility 0s linear \.08s/, 'rail content appears after the compact strip fades');
  assert.match(css, /transition:opacity \.12s ease \.2s,visibility 0s linear \.2s/, 'the compact strip returns after the rail closes');
  assert.match(css, /atlas-panels-open:has\(#atlas-scene\[data-atlas-level="orbit"\]\) \.atlas-world-card,[\s\S]*?visibility:hidden;pointer-events:none;transform:translateY\(6px\)/, 'the phone tree sheet clears the selected-world card before it appears');
  assert.match(css, /\.exploration-rail,\.exploration-rail>\*,\.atlas-compact-controls,\.atlas-compact-controls>\*,\.hero-panel,\.hero-panel>\*,\.geography-panel,\.map-panel>#atlas-scene,\.atlas-toolbar\{transition:none!important;animation:none!important\}/, 'reduced-motion users get immediate panel changes');
  assert.match(css, /prefers-reduced-motion:reduce/);
});

test('New exploration toggles a blank focused prompt without resetting the saved Atlas graph', () => {
  assert.match(app, /function openNewExploration\(\) \{\s*const opening = !document\.body\.classList\.contains\('invitation-open'\);\s*if \(opening\) \$\('prompt'\)\.value = '';\s*setInvitationOpen\(opening\);\s*if \(opening\) \$\('prompt'\)\.focus\(\{ preventScroll:true \}\);\s*\}/);
  assert.match(app, /\$\('show-invitation'\)\.addEventListener\('click', openNewExploration\)/);
  assert.match(app, /onEnter:\(world, detail\) => handleAtlasWorldEnter\(world, detail\)/);
  assert.match(app, /source === 'present-day-question'/);
  assert.match(app, /\$\('prompt-form'\)\.addEventListener\('submit'/);
});

test('small phones keep Surface usable, zoom to Orbit on first zoom-out, and gate other questions to Atlas view', () => {
  assert.match(html, /id="atlas-other-questions"[^>]*aria-pressed="false"[^>]*hidden/);
  assert.doesNotMatch(app, /if \(isAtlasPhone\(\)\) controller\.scene\?\.setZoom/ , 'phones still start at Surface');
  assert.match(app, /\$\('focus-atlas'\)\?\.addEventListener\('click', \(\) => \{ setAtlasFocused\(true\); atlasController\?\.scene\?\.setZoom\?\.\(0\.78\)/, 'Focus atlas opens at Orbit');
  assert.match(app, /getZoomOutTarget:zoom => isAtlasPhone\(\) && zoom < 0\.22 \? 0\.68 : null/, 'the first small-phone zoom-out targets Orbit');
  assert.match(app, /function isAtlasPhone\(\) \{ return window\.matchMedia\?\.\('\(max-width: 430px\)'\)\.matches === true; \}/);
  assert.match(app, /worlds\.filter\(world => String\(world\.questionId\) === atlasActiveQuestionId\)/, 'the collapsed phone Atlas contains the active question');
  assert.match(app, /const atlasOnlyView = isAtlasPhone\(\) && atlasController\?\.scene\?\.getLevel\?\.\(\) === 'atlas'/, 'question filtering is disabled in Surface, Lift, and Orbit');
  assert.match(app, /atlasController\.scene\?\.setWorlds\?\.\(/, 'the renderer receives the currently visible question set');
  assert.match(app, /if \(signature !== atlasVisibleGraphSignature\)/, 'unchanged renders do not reset scene navigation or hover');
  assert.match(app, /\$\('atlas-other-questions'\)\?\.addEventListener\('click'/);
  assert.match(css, /@media\(max-width:430px\)[\s\S]*\.atlas-other-questions-toggle\{position:absolute/);
  assert.match(css, /\.map-panel\{[^}]*pointer-events:none/);
  assert.match(css, /\.atlas-other-questions-toggle\{[^}]*pointer-events:auto/, 'the toggle opts back into hit testing inside the noninteractive map panel');
  assert.match(css, /body\.has-story \.atlas-toolbar\{z-index:11\}/, 'phone zoom buttons stack above the story rail');
  assert.match(css, /\.atlas-other-questions-toggle\{position:absolute;z-index:11;/, 'the question toggle stacks above the story rail too');
  assert.match(css, /\.map-panel>#atlas-scene\{inset:0;width:100%;\}/, 'the active Atlas remains full width on phones');
});

test('Atlas graph signatures are recorded only after a controller receives the graph', () => {
  assert.match(app, /function sendAtlasGraph\(graph\) \{\s*if \(!atlasController\) return false;\s*const sourceGraphSignature = JSON\.stringify\(graph\);\s*if \(sourceGraphSignature === atlasSourceGraphSignature\) return false;\s*atlasController\.setGraph\(graph\);\s*atlasSourceGraphSignature = sourceGraphSignature;/);
  assert.match(app, /const graph = \{ mapNodes, questions:\[\.\.\.questions\.values\(\)\][\s\S]*?\};\s*sendAtlasGraph\(graph\);/);
  assert.match(app, /renderStarMap\(continuation\.rootRunId \? knownRunManifests\.get\(continuation\.rootRunId\) \|\| currentManifest : currentManifest\);/);
});

test('background question hydration keeps the active question root stable', () => {
  const helper = app.match(/function activeAtlasRootId\(manifest\) \{[\s\S]*?\n\}/)?.[0];
  assert.ok(helper, 'active question root resolver exists');
  const activeRootId = new Function(`${helper}; return activeAtlasRootId;`)();
  assert.equal(activeRootId({ questionAttachment:{ questionId:'attached-question' }, continuation:{ rootRunId:'continuation-root' }, id:'manifest' }), 'attached-question');
  assert.equal(activeRootId({ continuation:{ rootRunId:'continuation-root' }, id:'manifest' }), 'continuation-root');
  assert.match(app, /const activeQuestionId = activeAtlasRootId\(currentManifest\) \|\| activeAtlasRootId\(rootManifest\);/);
  assert.match(app, /const activeRootId = activeAtlasRootId\(currentManifest\);\s*const activeRoot = knownRunManifests\.get\(activeRootId\) \|\| currentManifest;/, 'hydration refreshes the same question root used by the Atlas toggle');
  assert.match(app, /if \(atlasActiveQuestionId && nextActiveQuestionId !== atlasActiveQuestionId\) atlasOtherQuestionsOpen = false;/, 'the toggle closes only when the selected question actually changes');
});
