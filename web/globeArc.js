const MIN_SURFACE_CLEARANCE = 0.00002;
const ALTITUDE_PER_RADIAN = 0.008;
const MAX_ARC_ALTITUDE = 0.02;

function unitVector(latDegrees, lngDegrees) {
  const latitude = Math.max(-90, Math.min(90, latDegrees)) * Math.PI / 180;
  const longitude = lngDegrees * Math.PI / 180;
  return [
    Math.cos(latitude) * Math.cos(longitude),
    Math.cos(latitude) * Math.sin(longitude),
    Math.sin(latitude),
  ];
}

export function greatCircleAngle(startLat, startLng, endLat, endLng) {
  const coordinates = [startLat, startLng, endLat, endLng];
  if (!coordinates.every(Number.isFinite)) return 0;
  const [x1, y1, z1] = unitVector(startLat, startLng);
  const [x2, y2, z2] = unitVector(endLat, endLng);
  const dot = x1 * x2 + y1 * y2 + z1 * z2;
  const crossMagnitude = Math.hypot(y1 * z2 - z1 * y2, z1 * x2 - x1 * z2, x1 * y2 - y1 * x2);
  return Math.atan2(crossMagnitude, Math.max(-1, Math.min(1, dot)));
}

// Keep local connections close to the globe and cap long diagrammatic links.
// The arc shows causal order; it does not claim an exact path across geography.
export function causalArcAltitude(startLat, startLng, endLat, endLng) {
  const angle = greatCircleAngle(startLat, startLng, endLat, endLng);
  return Math.min(MAX_ARC_ALTITUDE, MIN_SURFACE_CLEARANCE + ALTITUDE_PER_RADIAN * angle);
}
