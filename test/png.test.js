import test from 'node:test';
import assert from 'node:assert/strict';
import { applyMask, decodePng, writeMaskPng, writeCutoutPng } from '../src/lib/png.js';

test('mask and cutout PNGs round-trip dimensions and alpha', () => {
  const raster = Uint8Array.of(1, 0, 0, 1);
  const pixels = Uint8Array.of(1, 2, 3, 255, 4, 5, 6, 255, 7, 8, 9, 128, 10, 11, 12, 200);
  const mask = decodePng(writeMaskPng(raster, 2, 2));
  assert.equal(mask.width, 2); assert.equal(mask.height, 2);
  assert.deepEqual([...mask.data].filter((_, i) => i % 4 === 0), [255, 0, 0, 255]);
  const cutout = decodePng(writeCutoutPng(applyMask(pixels, raster, 2, 2), 2, 2));
  assert.equal(cutout.width, 2); assert.equal(cutout.height, 2);
  assert.deepEqual([...cutout.data].filter((_, i) => i % 4 === 3), [255, 0, 0, 200]);
});
test('PNG helpers reject invalid dimensions and lengths', () => {
  assert.throws(() => writeMaskPng(new Uint8Array(1), 0, 1));
  assert.throws(() => writeCutoutPng(new Uint8Array(3), 1, 1));
  assert.throws(() => applyMask(new Uint8Array(4), new Uint8Array(2), 1, 1));
});
