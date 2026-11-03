const clamp = (value, min, max) => Math.min(max, Math.max(min, value));
const ZOOM_MAX = 100;
const WHEEL_ZOOM_PER_PIXEL = 0.08;
const WHEEL_STEP_LIMIT = 16;
const ZOOM_INTERFACE_SELECTOR = '[data-atlas-zoom-ignore], #atlas-toolbar, #atlas-other-questions, #exploration-rail, #chronicle, .geography-panel, .hero-panel, .atlas-view-options, .atlas-screen-label, input, select, textarea, button, [role="slider"], [role="menu"], [role="dialog"]';

/** Hover follows the rendered marker; only explicit activation gets a larger target. */
export function atlasMarkerHitRadius(renderedRadius, activationRadius, activation = false) {
  const visible = Math.max(0, Number(renderedRadius) || 0);
  return activation ? Math.max(visible, Number(activationRadius) || 0) : visible;
}

/** Prevent canvas zoom gestures from consuming pointer/wheel input over page controls. */
export function atlasZoomGestureBlocked(event, canvas, documentObject) {
  const matchesControl = target => target && target !== canvas
    && typeof target.matches === 'function' && target.matches(ZOOM_INTERFACE_SELECTOR);
  const path = event?.composedPath?.() || [event?.target];
  if (path.some(matchesControl)) return true;
  return (documentObject?.elementsFromPoint?.(event?.clientX, event?.clientY) || []).some(matchesControl);
}

/** Apply a Surface drag while keeping the poles within reach. */
export function surfaceDragAngles(yawOffset, pitchOffset, facingPitch, dx, dy) {
  const facing = Number(facingPitch) || 0;
  const pitch = clamp(facing + (Number(pitchOffset) || 0) + (Number(dy) || 0) * 0.006, -Math.PI / 2, Math.PI / 2);
  return { yaw: (Number(yawOffset) || 0) + (Number(dx) || 0) * 0.006, pitch: pitch - facing };
}
export const SURFACE_DETAIL_MAX = 100;
const RESTING_LEVELS = [0, 57, 100];

function gentlyAttractToRestingLevel(current, value, delta) {
  // Fine trackpad deltas must accumulate freely, including when starting exactly on a stop.
  if (Math.abs(delta) < 0.25) return value;
  // A coarse wheel notch can otherwise skip straight across Orbit in either
  // direction. Catch that crossing once; the next notch leaves the stop.
  if ((current < 57 - 1e-6 && value > 57) || (current > 57 + 1e-6 && value < 57)) return 57;
  const restingLevel = RESTING_LEVELS.find(level => Math.abs(value - level) <= 3);
  if (restingLevel === undefined) return value;
  const beforeDistance = Math.abs(current - restingLevel);
  const afterDistance = Math.abs(value - restingLevel);
  if (afterDistance >= beforeDistance) return value;
  const distance = restingLevel - value;
  return Math.abs(distance) <= 0.25 ? restingLevel : value + distance * 0.18;
}

/** Wheel and trackpad deltas move outward toward the Atlas as deltaY grows. Zoom is 0–100. */
export function zoomFromWheel(zoom, deltaY, { deltaMode = 0, viewportHeight = 1 } = {}) {
  const unit = deltaMode === 1 ? 16 : deltaMode === 2 ? Math.max(1, viewportHeight) : 1;
  const current = clamp(Number(zoom) || 0, 0, ZOOM_MAX);
  const delta = clamp((Number(deltaY) || 0) * unit * WHEEL_ZOOM_PER_PIXEL, -WHEEL_STEP_LIMIT, WHEEL_STEP_LIMIT);
  return gentlyAttractToRestingLevel(current, clamp(current + delta, 0, ZOOM_MAX), delta);
}

/** Wheel zoom within the fitted Surface view, where negative deltas move closer. */
export function surfaceDetailFromWheel(detail, deltaY, { deltaMode = 0, viewportHeight = 1 } = {}) {
  const unit = deltaMode === 1 ? 16 : deltaMode === 2 ? Math.max(1, viewportHeight) : 1;
  const current = clamp(Number(detail) || 0, 0, SURFACE_DETAIL_MAX);
  const delta = clamp((Number(deltaY) || 0) * unit * WHEEL_ZOOM_PER_PIXEL, -WHEEL_STEP_LIMIT, WHEEL_STEP_LIMIT);
  return clamp(current - delta, 0, SURFACE_DETAIL_MAX);
}

/** A wider two-finger gap zooms closer while Surface is at its fitted level. */
export function surfaceDetailFromPinch(startDetail, startDistance, currentDistance) {
  const start = Math.max(1, Number(startDistance) || 1);
  const current = Math.max(1, Number(currentDistance) || 1);
  return clamp((Number(startDetail) || 0) + Math.log2(current / start) * 28, 0, SURFACE_DETAIL_MAX);
}

/** A wider two-finger gap zooms toward the surface; a narrower gap moves outward. */
export function zoomFromPinch(startZoom, startDistance, currentDistance) {
  const start = Math.max(1, Number(startDistance) || 1);
  const current = Math.max(1, Number(currentDistance) || 1);
  return clamp((Number(startZoom) || 0) - Math.log2(current / start) * 28, 0, ZOOM_MAX);
}

export function dragModeForZoom(zoom) {
  return Number(zoom) < 22 ? 'rotate' : 'pan';
}

/** Translate a screen drag into camera-plane world units. */
export function panDeltaForDrag(dx, dy, { cameraDistance, fovDegrees, viewportHeight }) {
  const height = Math.max(1, Number(viewportHeight) || 1);
  const distance = Math.max(0, Number(cameraDistance) || 0);
  const fovRadians = (Number(fovDegrees) || 0) * Math.PI / 180;
  const unitsPerPixel = 2 * distance * Math.tan(fovRadians / 2) / height;
  return { x: -(Number(dx) || 0) * unitsPerPixel, y: (Number(dy) || 0) * unitsPerPixel };
}
