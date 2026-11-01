const clamp = (value, min, max) => Math.min(max, Math.max(min, value));

/** Morph an edge from its source chord to the exact Atlas route while keeping its live endpoints attached. */
export function interpolateAttachedAtlasEdgeRoute(sourceFrom, sourceTo, targetRoute, progress, attachedEndpoints = {}) {
  if (!sourceFrom || !sourceTo || !Array.isArray(targetRoute) || targetRoute.length < 2) return [];
  const amount = clamp(Number(progress) || 0, 0, 1);
  const targetFrom = targetRoute[0], targetTo = targetRoute.at(-1);
  const lerpPoint = (a, b, t) => ({
    x:Number(a?.x || 0) + (Number(b?.x || 0) - Number(a?.x || 0)) * t,
    y:Number(a?.y || 0) + (Number(b?.y || 0) - Number(a?.y || 0)) * t,
    z:Number(a?.z || 0) + (Number(b?.z || 0) - Number(a?.z || 0)) * t,
  });
  const naturalFrom = lerpPoint(sourceFrom, targetFrom, amount);
  const naturalTo = lerpPoint(sourceTo, targetTo, amount);
  const attachedFrom = attachedEndpoints.from || naturalFrom;
  const attachedTo = attachedEndpoints.to || naturalTo;
  const startCorrection = {
    x:attachedFrom.x - naturalFrom.x, y:attachedFrom.y - naturalFrom.y, z:attachedFrom.z - naturalFrom.z,
  };
  const endCorrection = {
    x:attachedTo.x - naturalTo.x, y:attachedTo.y - naturalTo.y, z:attachedTo.z - naturalTo.z,
  };
  const segments = targetRoute.length - 1;
  if (amount === 1) {
    const samePoint = (a, b) => a.x === b.x && a.y === b.y && (a.z || 0) === (b.z || 0);
    if (samePoint(attachedFrom, targetFrom) && samePoint(attachedTo, targetTo)) {
      return targetRoute.map((point, index) => index === 0 ? { ...attachedFrom }
        : index === targetRoute.length - 1 ? { ...attachedTo } : { ...point });
    }
    const points = targetRoute.map((target, index) => {
      const fraction = index / segments;
      const correction = lerpPoint(startCorrection, endCorrection, fraction);
      return { x:target.x + correction.x, y:target.y + correction.y, z:target.z + correction.z };
    });
    points[0] = { x:attachedFrom.x, y:attachedFrom.y, z:attachedFrom.z };
    points[points.length - 1] = { x:attachedTo.x, y:attachedTo.y, z:attachedTo.z };
    return points;
  }
  const points = targetRoute.map((target, index) => {
    const fraction = index / segments;
    const source = lerpPoint(sourceFrom, sourceTo, fraction);
    const point = lerpPoint(source, target, amount);
    const correction = lerpPoint(startCorrection, endCorrection, fraction);
    return { x:point.x + correction.x, y:point.y + correction.y, z:point.z + correction.z };
  });
  points[0] = { x:attachedFrom.x, y:attachedFrom.y, z:attachedFrom.z };
  points[points.length - 1] = { x:attachedTo.x, y:attachedTo.y, z:attachedTo.z };
  return points;
}
