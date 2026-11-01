const labelPriority = (candidate, currentId, focusedId) => candidate.id === currentId ? 100 : candidate.id === focusedId ? 95 : candidate.foldedChip ? 80 : candidate.lineage ? 70 : 0;

export function worldLabelText(world = {}, { yearFirst = false } = {}) {
  const title = String(world.title || 'Untitled possibility').trim();
  const numericYear = Number(world.year);
  const year = world.year == null ? '' : Number.isFinite(numericYear) && numericYear < 0
    ? `${Math.abs(numericYear)} BCE` : String(world.year);
  return year ? (yearFirst ? `${year} · ${title}` : `${title} · ${year}`) : title;
}

export function shouldShowWorldLabel(entry, currentId, focusedId) {
  return Boolean(entry && (entry.id === currentId || entry.lineage || entry.id === focusedId));
}

/** Project a world-space sphere radius to its CSS-pixel diameter at the camera. */
export function projectedSphereDiameterPixels(distance, fovDegrees, viewportHeight, radius) {
  const d = Number(distance), fov = Number(fovDegrees), height = Number(viewportHeight), r = Number(radius);
  if (![d, fov, height, r].every(Number.isFinite) || d <= 0 || height <= 0 || r <= 0 || !(fov > 0 && fov < 180)) return 0;
  const ratio = Math.min(0.999, r / d);
  const projectedRadius = Math.tan(Math.asin(ratio));
  return Math.min(height * 2, height * projectedRadius / Math.tan(fov * Math.PI / 360));
}

function overlaps(a, b, gap = 0) {
  return Math.abs(a.x - b.x) < (a.width + b.width) / 2 + gap
    && Math.abs(a.y - b.y) < (a.height + b.height) / 2 + gap;
}

/** Place higher-priority labels first, avoiding visible nodes and already-placed labels. */
export function placeScreenLabels(candidates, bounds, nodeRects = [], reservedRects = []) {
  const safe = {
    left: Number(bounds?.left) || 0, top: Number(bounds?.top) || 0,
    right: Number(bounds?.right) || 0, bottom: Number(bounds?.bottom) || 0,
  };
  if (safe.right <= safe.left || safe.bottom <= safe.top) return [];
  const placed = [];
  const ordered = [...candidates].sort((a, b) => (b.priority || 0) - (a.priority || 0) || String(a.id).localeCompare(String(b.id)));
  for (const candidate of ordered) {
    const width = Math.min(Math.max(28, candidate.width || 0), safe.right - safe.left);
    const height = Math.min(Math.max(16, candidate.height || 0), safe.bottom - safe.top);
    const localNodes = nodeRects.filter(node => Math.abs(node.x - candidate.x) <= (node.width + width) / 2 + 12
      && Math.abs(node.y - candidate.y) <= (node.height + height) / 2 + 12);
    const clearance = Math.max(8, ...localNodes.map(node => Math.max(node.width || 0, node.height || 0) / 2 + 8));
    const alternatives = [
      [0, -(height / 2 + clearance)], [width / 2 + clearance, 0], [-width / 2 - clearance, 0],
      [0, height / 2 + clearance], [width / 2 + clearance, -(height / 2 + clearance)], [-width / 2 - clearance, -(height / 2 + clearance)],
      [width / 2 + clearance, height / 2 + clearance], [-width / 2 - clearance, height / 2 + clearance],
    ];
    let chosen = null;
    for (const [dx, dy] of alternatives) {
      const x = Math.max(safe.left + width / 2 + 2, Math.min(safe.right - width / 2 - 2, candidate.x + dx));
      const y = Math.max(safe.top + height / 2 + 2, Math.min(safe.bottom - height / 2 - 2, candidate.y + dy));
      const rect = { ...candidate, x, y, width, height };
      if ([...nodeRects, ...reservedRects, ...placed].some(other => overlaps(rect, other, 3))) continue;
      chosen = rect; break;
    }
    if (chosen) placed.push(chosen);
  }
  return placed;
}

export function edgeMarker(point, bounds, text) {
  if (!bounds || (point.x >= bounds.left && point.x <= bounds.right && point.y >= bounds.top && point.y <= bounds.bottom)) return null;
  const dx = point.x < bounds.left ? -1 : point.x > bounds.right ? 1 : 0;
  const dy = point.y < bounds.top ? -1 : point.y > bounds.bottom ? 1 : 0;
  const arrow = dy < 0 ? (dx < 0 ? '↖' : dx > 0 ? '↗' : '↑') : dy > 0 ? (dx < 0 ? '↙' : dx > 0 ? '↘' : '↓') : dx < 0 ? '←' : '→';
  return `${arrow} ${String(text).slice(0, 32)}`;
}

export function shortQuestionTitle(text, maxWords = 5) {
  const words = String(text || 'Saved question').replace(/^what if\s+/i, '').trim().split(/\s+/);
  return words.length > maxWords ? `${words.slice(0, maxWords).join(' ')}…` : words.join(' ');
}

export function createWorldLabelCandidates(entries, { currentId, focusedId, project, measure, yearFirst = false, include = () => false, bounds }) {
  const candidates = [];
  for (const entry of entries || []) {
    if (!shouldShowWorldLabel(entry, currentId, focusedId) && !include(entry)) continue;
    const point = project(entry);
    if (!point || point.visible === false) continue;
    const fullText = worldLabelText(entry.world, { yearFirst });
    const text = entry.lineage && entry.id !== currentId ? edgeMarker(point, bounds, fullText) || fullText : fullText;
    const size = measure(text);
    candidates.push({
      id: entry.id, text, x: point.x, y: point.y,
      width: size.width, height: size.height,
      priority: labelPriority({ id: entry.id, lineage: entry.lineage }, currentId, focusedId),
      kind: 'world', fullText,
    });
  }
  return candidates;
}
