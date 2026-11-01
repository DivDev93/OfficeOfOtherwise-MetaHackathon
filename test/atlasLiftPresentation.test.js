import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { atlasZoomState } from '../web/atlasLayout.js';

const css = readFileSync(new URL('../web/style.css', import.meta.url), 'utf8');

function liftOpacity(selector) {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const rules = [...css.matchAll(new RegExp(`${escaped}\\{([^}]*)\\}`, 'g'))];
  const declarations = rules.map(([, block]) => block.match(/opacity:([^;]+)/)?.[1]).filter(Boolean);
  assert.equal(declarations.length, 1, `${selector} has one shared Lift opacity declaration`);
  return declarations[0];
}

function evaluateCssOpacity(expression, lift) {
  const js = expression
    .replace(/var\(--atlas-lift,0\)/g, String(lift))
    .replace(/calc\(([^()]*)\)/g, '($1)')
    .replace(/clamp\(0,\(([^()]*)\),1\)/g, 'min(1,max(0,($1)))');
  return Function('max', 'min', `return (${js});`)(Math.max, Math.min);
}

test('Atlas zoom sliders provide at least a 44 CSS pixel touch target', () => {
  assert.match(css, /\.atlas-quick-controls label input\[type=range\]\{[^}]*min-height:44px/);
  assert.match(css, /\.atlas-view-options-panel label input\[type=range\]\{[^}]*min-height:44px/);
});

test('Lift preserves separate panel bands, fades them monotonically, then reveals compact controls', () => {
  const panelRule = css.match(/body:has\(#atlas-scene\[data-atlas-level="lift"\]\) \.hero-panel\{([^}]*)\}/)?.[1];
  const railRule = css.match(/body:has\(#atlas-scene\[data-atlas-level="lift"\]\) \.exploration-rail\{([^}]*)\}/)?.[1];
  const railContentRule = css.match(/body:has\(#atlas-scene\[data-atlas-level="lift"\]\) \.exploration-rail>:not\(\.atlas-compact-controls\)\{([^}]*)\}/)?.[1];
  const detailsRule = css.match(/body:has\(#atlas-scene\[data-atlas-level="lift"\]\) \.atlas-world-details\{([^}]*)\}/)?.[1];
  const cardRule = css.match(/body:has\(#atlas-scene\[data-atlas-level="lift"\]\) \.atlas-world-card\{([^}]*)\}/)?.[1];
  assert.ok(railRule, 'Lift keeps the canvas-aligned rail container');
  assert.match(railRule, /width:min\(320px,calc\(34vw - 12px\)\);min-width:270px;overflow:visible/);
  assert.doesNotMatch(railRule, /--atlas-rail-width/, 'the desktop rail remains full width independently from the canvas inset');
  assert.ok(railContentRule, 'Lift gives fading rail content its independent full width');
  assert.match(railContentRule, /width:min\(320px,max\(270px,calc\(34vw - 12px\)\)\)/);
  assert.match(railContentRule, /transform:translateX\(calc\(-266px \* var\(--atlas-lift,0\)\)\)/, 'the full rail slides left at the same rate that the canvas inset contracts');
  assert.ok(panelRule, 'Lift defines fixed hero panel geometry');
  assert.match(panelRule, /width:238px;height:142px;min-height:142px/);
  assert.match(panelRule, /transition:none/);
  assert.ok(detailsRule, 'normal hero content stays in one full-size sheet');
  assert.match(detailsRule, /position:fixed;z-index:1;top:101px;right:22px;bottom:20px/);
  assert.match(detailsRule, /background:linear-gradient\(150deg,rgba\(24,19,19,\.98\),rgba\(9,7,9,\.98\)\)/);
  assert.match(detailsRule, /opacity:max\(0,calc\(1 - var\(--atlas-lift,0\) - var\(--atlas-lift,0\)\)\)/);
  assert.equal((detailsRule.match(/opacity:[^;]+/)?.[0].match(/var\(--atlas-lift,0\)/g) || []).length, 2, 'story sheet shares a simple monotonic fade');
  assert.match(detailsRule, /pointer-events:none/);
  assert.match(detailsRule, /transform:translateX\(calc\(-12px \* var\(--atlas-lift,0\)\)\)/, 'story sheet slides with its continuous fade');
  assert.ok(cardRule, 'the selected world card fades over the same fixed panel');
  assert.match(cardRule, /opacity:clamp\(0,calc\(/);
  assert.match(cardRule, /transform:translateX\(calc\(12px \* \(1 - var\(--atlas-lift,0\)\)\)\)/, 'compact card slides into position with its fade');
  assert.match(cardRule, /visibility:visible/, 'the zero-opacity card remains renderable for a no-snap Lift fade');
  assert.match(css, /not\(:has\(#atlas-scene\[data-atlas-level="lift"\]\)\) \.atlas-world-card\{opacity:0;visibility:hidden/, 'the higher-specificity default-hidden rule excludes Lift so its visible fade rule wins');

  const treeOpacity = liftOpacity('body:has(#atlas-scene[data-atlas-level="lift"]) .exploration-rail>:not(.atlas-compact-controls)');
  const geographyOpacity = liftOpacity('body:has(#atlas-scene[data-atlas-level="lift"]) .geography-panel');
  const sheetOpacity = liftOpacity('body:has(#atlas-scene[data-atlas-level="lift"]) .atlas-world-details');
  const compactOpacity = liftOpacity('body:has(#atlas-scene[data-atlas-level="lift"]) .atlas-world-card');
  const controlsOpacity = liftOpacity('body:has(#atlas-scene[data-atlas-level="lift"]) .atlas-compact-controls');
  let previousOldOpacity = 1, previousCompactOpacity = 0;
  for (let zoom = 0; zoom <= 1; zoom += 0.001) {
    const lift = atlasZoomState(zoom).lift;
    const oldLayerValues = [treeOpacity, geographyOpacity, sheetOpacity].map(expression => evaluateCssOpacity(expression, lift));
    const newLayerValues = [compactOpacity, controlsOpacity].map(expression => evaluateCssOpacity(expression, lift));
    assert.ok(oldLayerValues.every(opacity => opacity === oldLayerValues[0]), `old panels fade together at zoom=${zoom.toFixed(2)}`);
    const oldOpacity = oldLayerValues[0], nextOpacity = Math.max(...newLayerValues);
    assert.ok(oldOpacity <= previousOldOpacity + 1e-12, `old panels fade monotonically at zoom=${zoom.toFixed(2)}`);
    assert.ok(nextOpacity + 1e-12 >= previousCompactOpacity, `compact panels fade in monotonically at zoom=${zoom.toFixed(2)}`);
    assert.equal(oldOpacity > 0 && nextOpacity > 0, false, `old and compact panels do not overlap at zoom=${zoom.toFixed(2)}`);
    previousOldOpacity = oldOpacity;
    previousCompactOpacity = nextOpacity;
  }
  const at30 = atlasZoomState(0.30).lift;
  assert.ok(evaluateCssOpacity(treeOpacity, at30) > 0, 'the original story tree remains in its own band at 30% raw zoom');
  assert.ok(evaluateCssOpacity(geographyOpacity, at30) > 0, 'the original geography panel remains in its own band at 30% raw zoom');
  assert.ok(evaluateCssOpacity(sheetOpacity, at30) > 0, 'the original hero sheet remains in its own band at 30% raw zoom');
  assert.equal(evaluateCssOpacity(compactOpacity, at30), 0, 'compact card is not visible at 30% raw zoom');
  assert.ok(evaluateCssOpacity(compactOpacity, atlasZoomState(0.40).lift) > 0, 'compact card begins fading in by 40% raw zoom');
});

test('phone Lift fixes the compact card height and disables its transitions for reduced motion', () => {
  assert.match(css, /@media\(max-width:700px\)\{[\s\S]*?body:has\(#atlas-scene\[data-atlas-level="lift"\]\) \.hero-panel\{[^}]*height:74px;min-height:74px/);
  assert.match(css, /body:has\(#atlas-scene\[data-atlas-level="lift"\]\) \.exploration-rail>:not\(\.atlas-compact-controls\)\{width:100%;min-width:0;transform:translateX\(calc\(-12px \* var\(--atlas-lift,0\)\)\)\}/, 'phone Lift content continues to fill its full-width band');
  const liftRailRule = css.match(/body:has\(#atlas-scene\[data-atlas-level="lift"\]\) \.exploration-rail>:not\(\.atlas-compact-controls\)\{([^}]*)\}/)?.[1];
  assert.ok(liftRailRule, 'Lift fades the rail content');
  assert.match(liftRailRule, /width:min\(320px,max\(270px,calc\(34vw - 12px\)\)\)/, 'desktop Lift retains the initial rail content width');
  assert.match(liftRailRule, /transform:translateX\(calc\(-266px \* var\(--atlas-lift,0\)\)\)/, 'desktop Lift slides the rail as a full-width unit');
  assert.match(css, /\.has-story:not\(\.invitation-open\) \.exploration-rail \.exploration-tree\{max-height:33dvh;overflow:auto\}/, 'the saved story tree retains its bounded, scrollable phone height during Lift');
  assert.match(css, /\.has-story:not\(\.invitation-open\) \.exploration-rail\{top:118px;right:9px;bottom:auto;left:9px;display:block;width:auto;max-height:33dvh\}/, 'the story tree stays in its original top band');
  assert.match(css, /\.has-story:not\(\.invitation-open\) \.geography-panel\{top:calc\(118px \+ 33dvh \+ 8px\);right:9px;bottom:auto;left:9px;width:auto;max-height:16dvh;overflow:auto\}/, 'geography stays below the story tree');
  assert.match(css, /body:has\(#atlas-scene\[data-atlas-level="lift"\]\) \.atlas-world-details\{top:auto;right:9px;bottom:10px;left:9px;width:auto;max-height:calc\(100dvh - 118px - 33dvh - 16dvh - 36px\)/, 'the hero sheet stays below geography in the original bottom band');
  assert.match(css, /body:has\(#atlas-scene\[data-atlas-level="lift"\]\) \.atlas-world-card\{top:0;right:0;left:0\}/, 'phone card fills the fixed hero panel without changing its layout');
  assert.match(css, /@media\(prefers-reduced-motion:reduce\)\{\s*body:has\(#atlas-scene\[data-atlas-level="lift"\]\) \.exploration-rail>:not\(\.atlas-compact-controls\),[\s\S]*?\.atlas-world-card\{transition:none!important;animation:none!important;transform:none!important\}/);
});
