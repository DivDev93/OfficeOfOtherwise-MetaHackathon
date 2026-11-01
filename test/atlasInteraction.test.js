import test from 'node:test';
import assert from 'node:assert/strict';
import { dragModeForZoom, panDeltaForDrag, zoomFromPinch, zoomFromWheel } from '../web/atlas/interaction.js';

test('wheel and trackpad deltas move continuously outward and clamp at the Atlas end', () => {
  assert.ok(zoomFromWheel(0.4, 1) > 0.4, 'positive scroll moves outward');
  assert.ok(zoomFromWheel(0.4, -1) < 0.4, 'negative scroll moves inward');
  assert.equal(zoomFromWheel(0.99, 100), 1);
  assert.equal(zoomFromWheel(0.01, -100), 0);
  assert.ok(zoomFromWheel(0.4, 1, { deltaMode: 1 }) > zoomFromWheel(0.4, 1));
});

test('pinch apart moves toward surface and pinch together moves toward Atlas', () => {
  assert.ok(zoomFromPinch(0.5, 100, 200) < 0.5);
  assert.ok(zoomFromPinch(0.5, 100, 50) > 0.5);
  assert.equal(zoomFromPinch(0.1, 100, 1000), 0);
  assert.equal(zoomFromPinch(0.9, 100, 1), 1);
});

test('surface drags rotate while lift, orbit, and Atlas drags pan with viewport-scaled offsets', () => {
  assert.equal(dragModeForZoom(0), 'rotate');
  assert.equal(dragModeForZoom(0.21), 'rotate');
  for (const zoom of [0.22, 0.57, 0.84, 1]) assert.equal(dragModeForZoom(zoom), 'pan');
  const delta = panDeltaForDrag(100, 50, { cameraDistance: 10, fovDegrees: 38, viewportHeight: 500 });
  assert.ok(delta.x < 0, 'dragging right moves the camera focus left');
  assert.ok(delta.y > 0, 'dragging down moves the camera focus up');
  const doubled = panDeltaForDrag(100, 50, { cameraDistance: 10, fovDegrees: 38, viewportHeight: 250 });
  assert.ok(Math.abs(doubled.x - delta.x * 2) < 1e-12, 'pan speed scales with viewport height');
});
