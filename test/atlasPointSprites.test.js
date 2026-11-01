import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const sceneSource = readFileSync(new URL('../web/atlas/scene.js', import.meta.url), 'utf8');
const pureHelpers = [
  sceneSource.match(/export function orthographicEarthTextureUv\([\s\S]*?\n}/)?.[0],
  sceneSource.match(/export function isGenerationPlaceholderWorld\([\s\S]*?\n}/)?.[0],
].filter(Boolean).join('\n').replaceAll('export function', 'function');
const { isGenerationPlaceholderWorld, orthographicEarthTextureUv } = new Function(`${pureHelpers}\nreturn { isGenerationPlaceholderWorld, orthographicEarthTextureUv };`)();

test('far Earth sprite UVs are orthographic, centered and bounded to a circular globe', () => {
  assert.deepEqual(orthographicEarthTextureUv(0, 0), { u: 0.25, v: 0.5 });
  assert.equal(orthographicEarthTextureUv(0.8, 0.8), null);
  const east = orthographicEarthTextureUv(0.5, 0);
  const west = orthographicEarthTextureUv(-0.5, 0);
  assert.ok(Math.abs((east.u - 0.25) - (0.25 - west.u)) < 1e-12);
  const north = orthographicEarthTextureUv(0, 0.5);
  const south = orthographicEarthTextureUv(0, -0.5);
  assert.ok(Math.abs((0.5 - north.v) - (south.v - 0.5)) < 1e-12);
});

test('generation placeholders cannot be rendered as mini-Earths', () => {
  assert.equal(isGenerationPlaceholderWorld({ isExpansionPlaceholder: true }), true);
  assert.equal(isGenerationPlaceholderWorld({ role: 'generation-placeholder' }), true);
  assert.equal(isGenerationPlaceholderWorld({ mapState: 'generating', selectable: false }), true);
  assert.equal(isGenerationPlaceholderWorld({ mapState: 'saved', selectable: true }), false);
  assert.equal(isGenerationPlaceholderWorld({}), false);
  assert.match(sceneSource, /visibleEntries\.filter\(entry => entry\.id !== currentId\s*&& !isGenerationPlaceholderWorld\(entry\.world\)/);
  assert.match(sceneSource, /visibleEntries\.filter\(entry => entry\.id !== currentId && !isGenerationPlaceholderWorld\(entry\.world\)/);
});
