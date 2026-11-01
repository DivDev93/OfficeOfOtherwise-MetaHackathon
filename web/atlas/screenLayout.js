const finite = value => Number.isFinite(Number(value));
const clamp = (value, low, high) => Math.min(high, Math.max(low, value));

function normalizeViewport(viewport = {}) {
  const left = Number(viewport.left ?? viewport.x ?? 0), top = Number(viewport.top ?? viewport.y ?? 0);
  const width = Number(viewport.width ?? (Number(viewport.right) - left));
  const height = Number(viewport.height ?? (Number(viewport.bottom) - top));
  if (![left, top, width, height].every(Number.isFinite) || width <= 0 || height <= 0) throw new TypeError('A positive viewport is required');
  return { left, top, right: left + width, bottom: top + height, width, height };
}

function overlaps(rect, other, gap) {
  return !(rect.right + gap <= other.left || other.right + gap <= rect.left
    || rect.bottom + gap <= other.top || other.bottom + gap <= rect.top);
}

function rectAt(candidate, width, height, placement, offset = 10) {
  const { anchorX, anchorY } = candidate;
  const halfWidth = width / 2, halfHeight = height / 2;
  const gap = offset;
  const centers = {
    above: [anchorX, anchorY - halfHeight - gap],
    right: [anchorX + halfWidth + gap, anchorY],
    left: [anchorX - halfWidth - gap, anchorY],
    below: [anchorX, anchorY + halfHeight + gap],
    'above-right': [anchorX + halfWidth * 0.55, anchorY - halfHeight - gap],
    'above-left': [anchorX - halfWidth * 0.55, anchorY - halfHeight - gap],
    'below-right': [anchorX + halfWidth * 0.55, anchorY + halfHeight + gap],
    'below-left': [anchorX - halfWidth * 0.55, anchorY + halfHeight + gap],
  }[placement];
  return { left: centers[0] - halfWidth, top: centers[1] - halfHeight, right: centers[0] + halfWidth, bottom: centers[1] + halfHeight };
}

/** Place high-priority labels first, trying anchor sides before narrowing the box. */
export function placeAtlasLabels(candidates = [], {
  viewport: viewportInput,
  minGap = 8,
  minWidth = 104,
  widthSteps = [1, .88, .76, .64, .52],
} = {}) {
  const sourceCandidates = Array.isArray(candidates) ? candidates : [];
  const viewport = normalizeViewport(viewportInput);
  const gap = Math.max(0, Number(minGap) || 0);
  const placements = [
    ...['above', 'right', 'left', 'below', 'above-right', 'above-left', 'below-right', 'below-left'].map(name => ({ name, offset: 10 })),
    ...['above', 'right', 'left', 'below'].map(name => ({ name, offset: 22 })),
  ];
  const ordered = sourceCandidates.filter(candidate => candidate?.id != null
    && finite(candidate.anchorX) && finite(candidate.anchorY) && finite(candidate.width) && finite(candidate.height))
    .map(candidate => ({ ...candidate, id: String(candidate.id), priority: Number(candidate.priority) || 0 }))
    .sort((a, b) => b.priority - a.priority || a.id.localeCompare(b.id));
  const accepted = [];
  const output = new Map();

  for (const candidate of ordered) {
    const requestedWidth = Math.max(1, Number(candidate.width));
    const requestedHeight = Math.max(1, Number(candidate.height));
    const maxWidth = Math.min(requestedWidth, viewport.width);
    const maxHeight = Math.min(requestedHeight, viewport.height);
    let placed = null;
    for (const scale of widthSteps) {
      const width = Math.min(maxWidth, Math.max(Math.min(minWidth, maxWidth), maxWidth * Number(scale)));
      const height = maxHeight;
      for (const { name: placement, offset } of placements) {
        const proposed = rectAt(candidate, width, height, placement, offset);
        const left = clamp(proposed.left, viewport.left, viewport.right - width);
        const top = clamp(proposed.top, viewport.top, viewport.bottom - height);
        const rect = { left, top, right: left + width, bottom: top + height };
        if (accepted.some(other => overlaps(rect, other, gap))) continue;
        placed = {
          ...candidate, visible: true, placement, left, top, x: left, y: top, width, height,
          right: rect.right, bottom: rect.bottom,
          anchorX: Number(candidate.anchorX), anchorY: Number(candidate.anchorY),
        };
        accepted.push(rect);
        break;
      }
      if (placed) break;
    }
    output.set(candidate.id, placed || { ...candidate, visible: false, left: null, top: null, x: null, y: null, width: 0, height: 0 });
  }
  return sourceCandidates.map(candidate => output.get(String(candidate?.id)) || { ...candidate, visible: false, left: null, top: null, x: null, y: null, width: 0, height: 0 });
}

function hexRing(radius, spacing) {
  const coordinates = [];
  const directions = [[1, 0], [0, 1], [-1, 1], [-1, 0], [0, -1], [1, -1]];
  let q = 0, r = -radius;
  for (const [dq, dr] of directions) {
    for (let step = 0; step < radius; step++) {
      coordinates.push({ x: spacing * (q + r / 2), y: spacing * (Math.sqrt(3) / 2 * r) });
      q += dq; r += dr;
    }
  }
  return coordinates.sort((a, b) => Math.atan2(a.y, a.x) - Math.atan2(b.y, b.x) || a.x - b.x || a.y - b.y);
}

/** Stable ID-to-screen offsets; caller uses one shared transform for render and hit testing. */
export function fanMemberOffsets(ids = [], { spacing = 48, maxRadius = 120 } = {}) {
  const members = [...new Set((Array.isArray(ids) ? ids : []).filter(id => id != null).map(String))].sort();
  if (!members.length) return [];
  const separation = Math.max(44, Number(spacing) || 48);
  const radiusLimit = Math.max(separation, Number(maxRadius) || 120);
  const slots = [{ x: 0, y: 0 }];
  for (let ring = 1; slots.length < members.length; ring++) {
    const radius = ring * separation;
    if (radius > radiusLimit + 1e-7) throw new RangeError(`Fan supports at most ${slots.length} members within maxRadius`);
    slots.push(...hexRing(ring, separation));
  }
  const selected = slots.slice(0, members.length);
  const centerX = selected.reduce((sum, point) => sum + point.x, 0) / selected.length;
  const centerY = selected.reduce((sum, point) => sum + point.y, 0) / selected.length;
  return members.map((id, index) => ({ id, x: selected[index].x - centerX, y: selected[index].y - centerY }));
}

/** Circle covering the cluster and its fan targets, for pointer-transfer retention. */
export function createFanHitRegion(center, offsets = [], { hitRadius = 22, padding = 8 } = {}) {
  const x = Number(center?.x), y = Number(center?.y);
  if (!Number.isFinite(x) || !Number.isFinite(y)) throw new TypeError('A finite fan center is required');
  const reach = (Array.isArray(offsets) ? offsets : []).reduce((max, point) => Math.max(max, Math.hypot(Number(point.x) || 0, Number(point.y) || 0)), 0);
  return { x, y, radius: reach + Math.max(0, Number(hitRadius) || 0) + Math.max(0, Number(padding) || 0) };
}

export function containsFanRegion(point, region) {
  const x = Number(point?.x), y = Number(point?.y), centerX = Number(region?.x), centerY = Number(region?.y), radius = Number(region?.radius);
  if (![x, y, centerX, centerY, radius].every(Number.isFinite) || radius < 0) return false;
  return Math.hypot(x - centerX, y - centerY) <= radius;
}
