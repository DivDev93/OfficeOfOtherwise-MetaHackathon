import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { placeScreenLabels } from '../web/atlas/labels.js';
import { timeAxisTitleX } from '../web/atlas/p2Atlas.js';

const overlaps = (a, b, gap = 3) => Math.abs(a.x - b.x) < (a.width + b.width) / 2 + gap
  && Math.abs(a.y - b.y) < (a.height + b.height) / 2 + gap;

test('screen-space YEAR is centered on the trunk and clears any nearby tick labels', async () => {
  const scene = await readFile(new URL('../web/atlas/scene.js', import.meta.url), 'utf8');
  assert.match(scene, /timeAxisTitleX\(atlasTimeline\?\.trunk\)/,
    'the screen-space axis overlay uses the shared horizontal-axis anchor');

  for (const { width, height } of [{ width:375, height:812 }, { width:1440, height:900 }]) {
    const safe = { left:8, top:8, right:width - 8, bottom:height - 8 };
    const trunk = { left:32, right:width - 32 };
    const y = Math.round(height * 0.68);
    const tickSpecs = [
      [0.03, '2,975 BCE'],
      [0.23, '1,800 BCE'],
      [0.5, '500 BCE'],
      [0.79, '1,800 CE'],
      [0.96, '1,926 CE'],
    ];
    const labels = [{
      id:'axis:time', text:'YEAR', x:timeAxisTitleX(trunk), y, width:46, height:18, priority:110,
    }, ...tickSpecs.map(([fraction, text], index) => ({
      id:`tick:${index}`, text,
      x:trunk.left + (trunk.right - trunk.left) * fraction,
      y, width:Math.max(46, text.length * 7.5 + 8), height:18, priority:30,
    }))];
    const placed = placeScreenLabels(labels, safe);
    const title = placed.find(item => item.id === 'axis:time');
    const ticks = placed.filter(item => item.id.startsWith('tick:'));
    assert.ok(title, `${width}px keeps the YEAR title visible`);
    assert.equal(title.x, timeAxisTitleX(trunk), `${width}px centers YEAR below the trunk`);
    assert.equal(ticks.length, tickSpecs.length, `${width}px keeps every visible tick label`);
    assert.ok(ticks.every(tick => !overlaps(title, tick)), `${width}px separates YEAR from all tick labels`);
  }
});
