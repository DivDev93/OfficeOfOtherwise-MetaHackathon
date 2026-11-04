import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const html = readFileSync(new URL('../web/index.html', import.meta.url), 'utf8');
const scene = readFileSync(new URL('../web/atlas/scene.js', import.meta.url), 'utf8');

test('bare entry opens the saved starting questions', () => {
  assert.match(html, /<details class="starter-block" open>/);
  assert.equal((html.match(/data-run="(?:alexandria|beringia|green-sahara|mechanisms)"/g) || []).length, 4);
});

test('the landing voice action is a mic inside the question composer with starters immediately after it', () => {
  assert.match(html, /class="prompt-composer">[\s\S]*?id="prompt"[\s\S]*?id="voice-disclosure"[\s\S]*?id="voice-record"[\s\S]*?aria-label="Record a voice question"/);
  assert.match(html, /<\/form>\s*<details class="starter-block" open>/);
  assert.equal((html.match(/id="voice-record"/g) || []).length,1,'the existing microphone control ID remains unique for voice wiring');
});

test('empty Atlas entry uses the loaded basemap before any world is selected', () => {
  assert.match(scene, /if \(!currentEntry\(\)\) \{ currentEarthTexture\.image = basemapImage; currentEarthTexture\.needsUpdate = true; \}/);
  assert.match(scene, /if \(!currentEntry\(\)\)[\s\S]{0,120}currentEarthTexture\.image = basemapImage[\s\S]{0,500}drawCurrentMarker\(\)/);
});
