import test from 'node:test';
import assert from 'node:assert/strict';
import { dragModeForZoom, panDeltaForDrag, zoomFromPinch, zoomFromWheel } from '../web/atlas/interaction.js';

test('wheel and trackpad cover the full 0–100 range with continuous outward and inward motion', () => {
  assert.ok(zoomFromWheel(40, 1) > 40, 'positive scroll moves outward');
  assert.ok(zoomFromWheel(40, -1) < 40, 'negative scroll moves inward');
  assert.equal(zoomFromWheel(99, 100), 100);
  assert.equal(zoomFromWheel(1, -100), 0);
  assert.ok(zoomFromWheel(40, 1, { deltaMode: 1 }) > zoomFromWheel(40, 1));

  let zoom = 40;
  let previous = zoom;
  for (let index = 0; index < 20; index += 1) {
    zoom = zoomFromWheel(zoom, 4);
    assert.ok(zoom > previous, 'small trackpad deltas keep moving outward');
    assert.ok(zoom - previous < 1, 'small trackpad deltas stay smooth');
    previous = zoom;
  }
  assert.ok(zoom > 40 && zoom < 50, 'a trackpad gesture can scrub through intermediate zoom levels');
});

test('wheel gently settles on surface, orbit, and Atlas resting levels', () => {
  assert.equal(zoomFromWheel(0.1, -3), 0);
  assert.equal(zoomFromWheel(56.5, 4), 57);
  assert.equal(zoomFromWheel(99.9, 4), 100);
  const nearOrbit = zoomFromWheel(55, 20);
  assert.ok(nearOrbit > 55 && nearOrbit < 57, 'approach to orbit is attracted without jumping');
});

test('repeated tiny trackpad deltas accumulate away from surface and pass orbit in either direction', () => {
  let fromSurface = 0;
  for (let index = 0; index < 10; index += 1) fromSurface = zoomFromWheel(fromSurface, 1);
  assert.ok(fromSurface > 0.5, 'tiny outward deltas escape the surface stop');

  let outwardAcrossOrbit = 56.6;
  for (let index = 0; index < 10; index += 1) outwardAcrossOrbit = zoomFromWheel(outwardAcrossOrbit, 1);
  assert.ok(outwardAcrossOrbit > 57, 'tiny outward deltas pass the orbit stop');

  let inwardAcrossOrbit = 57.4;
  for (let index = 0; index < 10; index += 1) inwardAcrossOrbit = zoomFromWheel(inwardAcrossOrbit, -1);
  assert.ok(inwardAcrossOrbit < 57, 'tiny inward deltas pass the orbit stop');
});

test('pinch apart moves toward surface and pinch together moves toward Atlas', () => {
  assert.ok(zoomFromPinch(50, 100, 200) < 50);
  assert.ok(zoomFromPinch(50, 100, 50) > 50);
  assert.equal(zoomFromPinch(10, 100, 1000), 0);
  assert.equal(zoomFromPinch(90, 100, 1), 100);

  let previous = zoomFromPinch(50, 100, 100);
  for (const distance of [102, 104, 106, 108, 110]) {
    const zoom = zoomFromPinch(50, 100, distance);
    assert.ok(zoom < previous, 'pinching apart moves smoothly toward the surface');
    assert.ok(previous - zoom < 1, 'small pinch changes stay smooth');
    previous = zoom;
  }
});

test('surface drags rotate while lift, orbit, and Atlas drags pan with viewport-scaled offsets', () => {
  assert.equal(dragModeForZoom(0), 'rotate');
  assert.equal(dragModeForZoom(21), 'rotate');
  for (const zoom of [22, 57, 84, 100]) assert.equal(dragModeForZoom(zoom), 'pan');
  const delta = panDeltaForDrag(100, 50, { cameraDistance: 10, fovDegrees: 38, viewportHeight: 500 });
  assert.ok(delta.x < 0, 'dragging right moves the camera focus left');
  assert.ok(delta.y > 0, 'dragging down moves the camera focus up');
  const doubled = panDeltaForDrag(100, 50, { cameraDistance: 10, fovDegrees: 38, viewportHeight: 250 });
  assert.ok(Math.abs(doubled.x - delta.x * 2) < 1e-12, 'pan speed scales with viewport height');
});
