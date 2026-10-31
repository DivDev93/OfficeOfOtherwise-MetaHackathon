import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { causalArcAltitude, greatCircleAngle } from '../web/globeArc.js';

const source = readFileSync(new URL('../web/visuals.js', import.meta.url), 'utf8');

test('causal connections use directed, dashed gentle arcs with reduced-motion support', () => {
  assert.match(source, /\.arcsData\(\[\]\)/);
  assert.match(source, /\.arcAltitude\(d => causalArcAltitude\(d\.startLat, d\.startLng, d\.endLat, d\.endLng\)\)/);
  assert.match(source, /\.arcStroke\(null\)/);
  assert.match(source, /\.arcDashLength\(0\.14\)/);
  assert.match(source, /\.arcDashGap\(0\.12\)/);
  assert.match(source, /\.arcDashAnimateTime\(reducedMotion\.matches \? 0 : 2400\)/);
  assert.match(source, /startLat: from\.place\.lat, startLng: from\.place\.lon,[\s\S]*?endLat: to\.place\.lat, endLng: to\.place\.lon/);
  assert.match(source, /globe\.arcDashAnimateTime\(reducedMotion\.matches \? 0 : 2400\)/);
});

test('causal arc lift follows great-circle distance with a small clearance and capped antipodal height', () => {
  const clearance = causalArcAltitude(45, 20, 45, 20);
  const oneKmAngle = greatCircleAngle(45, 20, 45 + (1 / 6371) * 180 / Math.PI, 20);
  const oneKm = causalArcAltitude(45, 20, 45 + (1 / 6371) * 180 / Math.PI, 20);
  const hundredKm = causalArcAltitude(45, 20, 45 + (100 / 6371) * 180 / Math.PI, 20);
  const neighbor = causalArcAltitude(45, 20, 45, 21);
  const dateline = causalArcAltitude(10, 179, 10, -179);
  const antipodal = causalArcAltitude(0, 0, 0, 180);

  assert.equal(clearance, 0.00002);
  assert.ok(greatCircleAngle(45, 20, 45, 20) < 1e-7);
  assert.ok(oneKm > clearance && oneKm < 0.000022);
  assert.ok((oneKm - clearance) / oneKmAngle <= 0.01);
  assert.ok(hundredKm > oneKm && hundredKm < 0.001);
  assert.ok(neighbor > clearance && neighbor < 0.0002);
  assert.ok(neighbor < 0.05 / 100, 'nearby links are dramatically shallower than the old fixed lift');
  assert.ok(dateline > clearance && dateline < 0.001);
  assert.ok(Number.isFinite(antipodal));
  assert.equal(antipodal, 0.02);
  assert.ok(causalArcAltitude(90, 0, -90, 0) <= 0.02);
});

test('3D model viewer guards against hidden zero-dimension resize and resets camera direction across story switches', () => {
  assert.match(source, /if \(el\.clientWidth <= 0 \|\| el\.clientHeight <= 0\) return;/);
  assert.match(source, /clear\(\)\s*\{[\s\S]*?loadedUrl = '';[\s\S]*?frameAspect = null;/);
  assert.match(source, /refresh\(\)\s*\{[\s\S]*?fitCamera\(\);/);
  assert.match(source, /camera\.position\.copy\(homeDirection\)\.multiplyScalar\(fitDistance\(\)\);/);
});
