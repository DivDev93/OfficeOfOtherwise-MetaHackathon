import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { layoutOrbitChildLabels } from '../web/atlas/labels.js';

const scene = readFileSync(new URL('../web/atlas/scene.js', import.meta.url), 'utf8');

function sceneHelpers(...names) {
  const declarations = names.map(name => {
    const declaration = scene.match(new RegExp(`export function ${name}\\([\\s\\S]*?\\n\\}`))?.[0];
    assert.ok(declaration, `scene exposes ${name}`);
    return declaration.replace(/^export /, '');
  });
  return new Function(`${declarations.join('\n')}; return { ${names.join(', ')} };`)();
}

test('focused Orbit label is restored before measuring and revealed inside the 44px scrollport', () => {
  const { restoreFocusedOrbitChildInLane:restore } = sceneHelpers(
    'revealFocusedOrbitChildInLane', 'restoreFocusedOrbitChildInLane');
  const page = { scrollY: 380 };
  const order = [];
  let activeElement = { id: 'body' };
  const lane = {
    scrollTop: 9,
    clientTop: 2,
    clientHeight: 44,
    classList: { contains: name => name === 'atlas-orbit-child-label-lane' },
    getBoundingClientRect() {
      order.push('lane-rect');
      return { top: 100, bottom: 148 };
    },
  };
  const button = {
    parentElement: { parentElement: lane },
    focus(options) {
      order.push('focus');
      assert.deepEqual(options, { preventScroll:true });
      activeElement = button;
    },
    getBoundingClientRect() {
      order.push('button-rect');
      assert.equal(activeElement, button, 'geometry is read after focus has been restored');
      assert.equal(button.parentElement.parentElement, lane, 'the focused button has been reparented into its new lane');
      // Post-reflow, the 44px button reaches the outer border edge. The 2px
      // lane border leaves only the client scrollport from y=102 through 146.
      return { top: 104, bottom: 148 };
    },
  };

  assert.equal(restore(lane, button, activeElement), true);
  assert.deepEqual(order, ['focus', 'lane-rect', 'button-rect']);
  assert.equal(lane.scrollTop, 11, 'the two pixel correction accounts for the inner scrollport border');
  assert.equal(page.scrollY, 380, 'focus and reveal do not move the document');
  assert.equal(activeElement, button, 'the child label remains focused');
});

test('already visible focus and a missing client-box measurement cause no unnecessary lane movement', () => {
  const { revealFocusedOrbitChildInLane:reveal } = sceneHelpers('revealFocusedOrbitChildInLane');
  const lane = { scrollTop: 17, getBoundingClientRect: () => ({ top: 20, bottom: 120 }) };
  const button = { getBoundingClientRect: () => ({ top: 60, bottom: 104 }) };
  assert.equal(reveal(lane, button), false);
  assert.equal(lane.scrollTop, 17);

  const buttonBelow = { getBoundingClientRect: () => ({ top: 110, bottom: 154 }) };
  assert.equal(reveal(lane, buttonBelow), true, 'outer-rect fallback works when the mock has no client box');
  assert.equal(lane.scrollTop, 51);
});

test('lane scroll survives resize and focused-label restoration is used after reparenting', () => {
  assert.match(scene, /const focusedOrbitChildId = \[[\s\S]*?const orbitLaneScrollTops = new Map\(\[\.\.\.orbitLabelLanes\]\.map\(\(\[id, lane\]\) => \[id, lane\.scrollTop\]\)\)/,
    'the current focused child and existing lane offsets are captured before buttons are reparented');
  assert.match(scene, /element\.style\.height = `\$\{lane\.height\}px`;[\s\S]*?content\.style\.height = `\$\{lane\.contentHeight\}px`;\s*element\.scrollTop = orbitLaneScrollTops\.get\(lane\.id\) \|\| 0;/,
    'a surviving lane restores its prior scroll offset after the resized viewport and content dimensions are applied');
  assert.match(scene, /restoreFocusedOrbitChildInLane\(focusedLane, focusedButton, document\.activeElement\)/,
    'the post-reparent focus and lane reveal helper runs for the containing scroll lane');
});

test('Orbit lane placements carry their world record for direct lookup during reparenting', () => {
  const world = { id: 'child-a', title: 'River Canopy Exchange' };
  const result = layoutOrbitChildLabels([
    { id: 'child-a', world, text: 'River Canopy Exchange', fullText: 'River Canopy Exchange', visible: false },
  ], { left: 0, top: 0, right: 260, bottom: 220 }, [], []);
  assert.equal(result.labels[0].world, world, 'layout output retains the candidate world record');
  assert.match(scene, /const world = placement\.world;/,
    'scene updates each label from the record already carried by its placement instead of rescanning all worlds');
  assert.doesNotMatch(scene, /const world = worlds\.find\(item => stableWorldId\(item\) === placement\.id\)/,
    'per-placement reparenting does not perform a linear search through worlds');
});
