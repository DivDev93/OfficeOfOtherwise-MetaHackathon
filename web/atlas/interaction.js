const clamp = (value, min, max) => Math.min(max, Math.max(min, value));

/** Wheel and trackpad deltas move outward toward the Atlas as deltaY grows. */
export function zoomFromWheel(zoom, deltaY, { deltaMode = 0, viewportHeight = 1 } = {}) {
  const unit = deltaMode === 1 ? 16 : deltaMode === 2 ? Math.max(1, viewportHeight) : 1;
  return clamp((Number(zoom) || 0) + clamp((Number(deltaY) || 0) * unit * 0.0008, -0.16, 0.16), 0, 1);
}

/** A wider two-finger gap zooms toward the surface; a narrower gap moves outward. */
export function zoomFromPinch(startZoom, startDistance, currentDistance) {
  const start = Math.max(1, Number(startDistance) || 1);
  const current = Math.max(1, Number(currentDistance) || 1);
  return clamp((Number(startZoom) || 0) - Math.log2(current / start) * 0.28, 0, 1);
}

export function dragModeForZoom(zoom) {
  return Number(zoom) < 0.22 ? 'rotate' : 'pan';
}

/** Translate a screen drag into camera-plane world units. */
export function panDeltaForDrag(dx, dy, { cameraDistance, fovDegrees, viewportHeight }) {
  const height = Math.max(1, Number(viewportHeight) || 1);
  const distance = Math.max(0, Number(cameraDistance) || 0);
  const fovRadians = (Number(fovDegrees) || 0) * Math.PI / 180;
  const unitsPerPixel = 2 * distance * Math.tan(fovRadians / 2) / height;
  return { x: -(Number(dx) || 0) * unitsPerPixel, y: (Number(dy) || 0) * unitsPerPixel };
}
