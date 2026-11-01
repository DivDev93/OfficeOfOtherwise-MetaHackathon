const labelPriority = (candidate, currentId, focusedId) => candidate.id === currentId ? 100 : candidate.id === focusedId ? 95 : candidate.foldedChip ? 80 : candidate.lineage ? 70 : 0;

export function worldLabelText(world = {}, { yearFirst = false } = {}) {
  const title = String(world.title || 'Untitled possibility').trim();
  const numericYear = Number(world.year);
  const year = Number.isSafeInteger(numericYear) && numericYear !== 0
    ? numericYear < 0 ? `${Math.abs(numericYear)} BCE` : String(numericYear)
    : 'Undated';
  return yearFirst ? `${year} · ${title}` : `${title} · ${year}`;
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
  const fallback = [];
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
    else if (candidate.edgeFallback) fallback.push({ candidate, width, height });
  }
  // Direct children get the original full-width edge label first. A compact
  // sidecar uses otherwise-unused row space when no full-width slot remains.
  // Slots remain finite and must still clear projected node hit areas.
  const laneWidth = safe.right - safe.left;
  const wideLaneWidth = Math.min(laneWidth - 4, Math.max(28, ...fallback.map(({ width }) => width)));
  const compactLaneWidth = Math.min(wideLaneWidth, Math.max(28, laneWidth - wideLaneWidth - 16));
  for (const { candidate, width, height } of fallback) {
    const fullWidth = Math.min(width, wideLaneWidth);
    const preferredSide = candidate.x >= (safe.left + safe.right) / 2 ? 'right' : 'left';
    const sides = preferredSide === 'right' ? ['right', 'left'] : ['left', 'right'];
    const firstY = safe.top + height / 2 + 2;
    const lastY = safe.bottom - height / 2 - 2;
    const rowStep = height + 6;
    const findSlot = (slotWidth, compact) => {
      for (let y = firstY; y <= lastY; y += rowStep) {
        for (const side of sides) {
          const x = side === 'left' ? safe.left + slotWidth / 2 + 2 : safe.right - slotWidth / 2 - 2;
          const arrowed = /^[←→↑↖↗↙↘]\s/.test(candidate.text)
            ? candidate.text
            : `${side === 'left' ? '→' : '←'} ${candidate.text}`;
          const maxChars = compact ? Math.max(8, Math.floor((slotWidth - 8) / 7.5)) : 32;
          const rect = {
            ...candidate,
            text: shortEdgeTitle(arrowed, maxChars), x, y,
            width: slotWidth, height, edgeFallbackPlacement:true,
            ...(compact ? { edgeFallbackCompact:true } : {}),
          };
          if (![ ...nodeRects, ...reservedRects, ...placed ].some(other => overlaps(rect, other, 3))) return rect;
        }
      }
      return null;
    };
    const chosen = findSlot(fullWidth, false) || findSlot(compactLaneWidth, true);
    if (chosen) placed.push(chosen);
  }
  return placed;
}

/**
 * Lay out every currently unfolded Orbit child in dedicated edge lanes.
 * Each lane is a scroll viewport; labels beyond its visible rows remain in
 * the returned data and can be rendered inside the lane's scroll content.
 * Reserved rectangles split lanes vertically, so no returned viewport covers
 * a control. If no usable row fits, identities are retained in an explicit
 * blocked overflow lane for the caller to surface elsewhere.
 */
export function layoutOrbitChildLabelLanes(candidates = [], bounds = {}, reservedRects = [], {
  rowHeight = 20,
  rowGap = 4,
  columnGap = 12,
  controlGap = 6,
  minLaneWidth = 96,
  maxLaneWidth = 320,
  maxLaneHeight = 240,
} = {}) {
  const left = Number(bounds?.left) || 0;
  const top = Number(bounds?.top) || 0;
  const right = Number(bounds?.right) || 0;
  const bottom = Number(bounds?.bottom) || 0;
  const width = right - left, height = bottom - top;
  const row = Math.max(12, Number(rowHeight) || 20);
  const gap = Math.max(0, Number(rowGap) || 0);
  const step = row + gap;
  const minimumWidth = Math.max(1, Number(minLaneWidth) || 96);
  const maximumWidth = Math.max(minimumWidth, Number(maxLaneWidth) || 320);
  const maximumHeight = Math.max(row, Number(maxLaneHeight) || 240);
  const items = (Array.isArray(candidates) ? candidates : []).map((candidate, index) => ({
    ...candidate,
    id: candidate?.id == null ? `orbit-child-${index}` : String(candidate.id),
    fullText: candidate?.fullText ?? candidate?.text ?? '',
    sourceIndex: index,
  }));
  const blocked = reason => ({
    lanes: [{ id: 'orbit-label-overflow', x: null, y: null, width: 0, height: 0,
      contentHeight: items.length * step, scrollable: true, blocked: true, reason,
      labelIds: items.map(item => item.id) }],
    labels: items.map((item, index) => ({ ...item, visible: false, blocked: true,
      laneId: 'orbit-label-overflow', laneIndex: null, scrollIndex: index,
      x: null, y: null, left: null, top: index * step, width: 0, height: row })),
    scrollable: items.length > 0,
    blocked: items.length > 0,
    overflowIds: items.map(item => item.id),
  });
  if (!items.length) return { lanes: [], labels: [], scrollable: false, blocked: false, overflowIds: [] };
  if (![left, top, right, bottom].every(Number.isFinite) || width <= 0 || height <= 0) return blocked('invalid-bounds');
  if (width < minimumWidth || height < row) return blocked('viewport-too-small');

  const colGap = Math.max(0, Number(columnGap) || 0);
  const columnCount = width >= minimumWidth * 2 + colGap ? 2 : 1;
  const textWidth = Math.max(minimumWidth, ...items.map(item => Math.min(maximumWidth, String(item.text || '').length * 6.4 + 20)));
  const laneWidth = Math.min(maximumWidth, textWidth, columnCount === 2 ? (width - colGap) / 2 : width);
  if (laneWidth < minimumWidth) return blocked('viewport-too-narrow');
  const columns = columnCount === 2
    ? [left, right - laneWidth]
    : [left, left + (width - laneWidth) / 2, right - laneWidth];

  const rects = (Array.isArray(reservedRects) ? reservedRects : []).map(rect => {
    const x = Number(rect?.x), y = Number(rect?.y), w = Number(rect?.width), h = Number(rect?.height);
    return [x, y, w, h].every(Number.isFinite) && w > 0 && h > 0
      ? { left: x - w / 2, right: x + w / 2, top: y - h / 2, bottom: y + h / 2 }
      : null;
  }).filter(Boolean);
  const laneCandidates = [];
  for (let columnIndex = 0; columnIndex < columns.length; columnIndex++) {
    const x = columns[columnIndex];
    const blockedY = rects.filter(rect => x < rect.right + controlGap && x + laneWidth > rect.left - controlGap)
      .map(rect => ({ top: Math.max(top, rect.top - controlGap), bottom: Math.min(bottom, rect.bottom + controlGap) }))
      .filter(rect => rect.bottom > rect.top)
      .sort((a, b) => a.top - b.top);
    const merged = [];
    for (const interval of blockedY) {
      const previous = merged.at(-1);
      if (previous && interval.top <= previous.bottom) previous.bottom = Math.max(previous.bottom, interval.bottom);
      else merged.push({ ...interval });
    }
    const free = [];
    let cursor = top;
    for (const interval of merged) {
      if (interval.top - cursor >= row) free.push({ top: cursor, bottom: interval.top });
      cursor = Math.max(cursor, interval.bottom);
    }
    if (bottom - cursor >= row) free.push({ top: cursor, bottom });
    // Keep the UI to one grouped rail per edge. Additional free gaps are not
    // promoted into more overlays; overflow stays in this rail's scroll area.
    const segment = [...free].sort((a, b) => (b.bottom - b.top) - (a.bottom - a.top) || a.top - b.top)[0];
    if (segment) {
      const segmentHeight = segment.bottom - segment.top;
      const viewportHeight = Math.min(segmentHeight, maximumHeight);
      const capacity = Math.max(1, Math.floor((viewportHeight + gap) / step));
      laneCandidates.push({
        id: `orbit-label-lane-${columnIndex}`,
        x, y: segment.top, width: laneWidth, height: viewportHeight,
        columnIndex, capacity, labelIds: [],
      });
    }
  }

  // For a narrow single-column viewport, use the horizontal position that
  // leaves the most safe vertical space around controls.
  if (columnCount === 1 && laneCandidates.length) {
    const candidatesByX = columns.map((_, index) => laneCandidates.filter(lane => lane.id === `orbit-label-lane-${index}`));
    const best = candidatesByX.map((lanes, index) => ({ index, lanes,
      capacity: lanes.reduce((sum, lane) => sum + lane.capacity, 0) }))
      .sort((a, b) => b.capacity - a.capacity || a.index - b.index)[0];
    laneCandidates.splice(0, laneCandidates.length, ...best.lanes);
  }
  if (!laneCandidates.length) return blocked('no-control-free-lane');

  const capacities = laneCandidates.map(lane => lane.capacity);
  const remaining = [...items];
  // Fill the visible rows across lanes first, balancing lanes by their
  // occupied fraction. Excess labels then stay in the largest scroll lane.
  while (remaining.length && laneCandidates.some((lane, index) => lane.labelIds.length < capacities[index])) {
    const available = laneCandidates.map((lane, index) => ({ lane, capacity: capacities[index] }))
      .filter(({ lane, capacity }) => lane.labelIds.length < capacity)
      .sort((a, b) => a.lane.labelIds.length / a.capacity - b.lane.labelIds.length / b.capacity
        || a.lane.columnIndex - b.lane.columnIndex || a.lane.y - b.lane.y);
    available[0].lane.labelIds.push(remaining.shift().id);
  }
  const overflowLane = [...laneCandidates].sort((a, b) => b.capacity - a.capacity
    || a.columnIndex - b.columnIndex || a.y - b.y)[0];
  for (const item of remaining) overflowLane.labelIds.push(item.id);

  const byId = new Map(items.map(item => [item.id, item]));
  const lanes = laneCandidates.map(lane => {
    const contentHeight = lane.labelIds.length ? lane.labelIds.length * step - gap : 0;
    const viewportHeight = lane.labelIds.length <= lane.capacity
      ? Math.min(lane.height, Math.max(row, contentHeight))
      : lane.height;
    return { ...lane, height:viewportHeight, contentHeight, scrollable: contentHeight > viewportHeight,
      visibleCount: Math.min(lane.labelIds.length, lane.capacity) };
  });
  const labels = [];
  for (const lane of lanes) lane.labelIds.forEach((id, scrollIndex) => {
    const item = byId.get(id);
    labels.push({ ...item, laneId: lane.id, laneIndex: lanes.indexOf(lane), scrollIndex,
      x: lane.x + lane.width / 2, y: lane.y + row / 2 + scrollIndex * step,
      left: 0, top: scrollIndex * step, width: lane.width, height: row,
      visible: scrollIndex < lane.capacity, blocked: false });
  });
  labels.sort((a, b) => a.sourceIndex - b.sourceIndex);
  const overflowIds = labels.filter(label => !label.visible).map(label => label.id);
  return { lanes, labels, scrollable: lanes.some(lane => lane.scrollable), blocked: false, overflowIds };
}

/** Keep child labels close to their own visible node when a collision-free slot fits. */
export function layoutOrbitChildLabels(candidates = [], bounds = {}, nodeRects = [], reservedRects = [], laneOptions = {}) {
  const items = (Array.isArray(candidates) ? candidates : []).map((candidate, index) => ({
    ...candidate,
    id:candidate?.id == null ? `orbit-child-${index}` : String(candidate.id),
    fullText:candidate?.fullText ?? candidate?.text ?? '',
    height:Math.max(44, Number(candidate?.height) || 44),
    priority:Number(candidate?.priority) || 85,
  }));
  const nearNode = items.filter(item => item.visible !== false
    && Number.isFinite(Number(item.x)) && Number.isFinite(Number(item.y))
    && Number(item.x) >= (Number(bounds?.left) || 0) && Number(item.x) <= (Number(bounds?.right) || 0)
    && Number(item.y) >= (Number(bounds?.top) || 0) && Number(item.y) <= (Number(bounds?.bottom) || 0));
  const local = placeScreenLabels(nearNode, bounds, nodeRects, reservedRects)
    .map(placement => ({ ...placement, local:true }));
  const localIds = new Set(local.map(placement => placement.id));
  const localRects = local.map(({ x, y, width, height }) => ({ x, y, width, height }));
  const remaining = items.filter(item => !localIds.has(item.id));
  const lanes = layoutOrbitChildLabelLanes(remaining, bounds,
    [...nodeRects, ...reservedRects, ...localRects], laneOptions);
  return { local, ...lanes };
}

/** Place the blocked-label drawer in an unoccupied viewport rectangle. */
export function placeOrbitFallbackPanel(bounds = {}, reservedRects = [], {
  gap = 10,
  maxWidth = 320,
  maxHeight = 240,
  minWidth = 96,
  // The fallback includes a heading and one 44px child button. Reserving only
  // one row can produce a panel where the heading consumes the whole viewport.
  minHeight = 88,
} = {}) {
  const left = Number(bounds?.left) || 0, top = Number(bounds?.top) || 0;
  const right = Number(bounds?.right) || 0, bottom = Number(bounds?.bottom) || 0;
  const viewportWidth = right - left, viewportHeight = bottom - top;
  if (![left, top, right, bottom].every(Number.isFinite) || viewportWidth < minWidth + gap * 2 || viewportHeight < minHeight + gap * 2) return null;
  const obstacles = (Array.isArray(reservedRects) ? reservedRects : []).map(rect => ({
    left:Number(rect?.left), right:Number(rect?.right), top:Number(rect?.top), bottom:Number(rect?.bottom),
  })).filter(rect => [rect.left, rect.right, rect.top, rect.bottom].every(Number.isFinite)
    && rect.right > rect.left && rect.bottom > rect.top);
  const widthOptions = [...new Set([maxWidth, 260, 220, 180, 140, minWidth]
    .map(width => Math.min(viewportWidth - gap * 2, Math.max(minWidth, Number(width) || minWidth)))
    .filter(width => width >= minWidth))].sort((a, b) => b - a);
  const heightOptions = [...new Set([maxHeight, 200, 160, 120, 88, minHeight]
    .map(height => Math.min(viewportHeight - gap * 2, Math.max(minHeight, Number(height) || minHeight)))
    .filter(height => height >= minHeight))].sort((a, b) => b - a);
  for (const width of widthOptions) for (const height of heightOptions) {
    const xs = new Set([left + gap, right - gap - width]);
    const ys = new Set([top + gap, bottom - gap - height]);
    for (const obstacle of obstacles) {
      xs.add(obstacle.left - gap - width);
      xs.add(obstacle.right + gap);
      ys.add(obstacle.top - gap - height);
      ys.add(obstacle.bottom + gap);
    }
    const candidates = [];
    for (const x of xs) for (const y of ys) {
      if (x < left + gap || y < top + gap || x + width > right - gap || y + height > bottom - gap) continue;
      const rect = { left:x, top:y, right:x + width, bottom:y + height, width, height };
      if (obstacles.some(obstacle => rect.left < obstacle.right + gap && rect.right > obstacle.left - gap
        && rect.top < obstacle.bottom + gap && rect.bottom > obstacle.top - gap)) continue;
      candidates.push(rect);
    }
    if (candidates.length) return candidates.sort((a, b) => a.top - b.top || a.left - b.left)[0];
  }
  return null;
}

export function resolveOrbitFallbackMount({ treeVisible = false, hasTree = false, invitationVisible = false, hasEmbeddedHost = false, portalRect = null } = {}) {
  // Prefer a directly visible viewport panel when one can clear the controls.
  // The story tree remains a last-resort visible host when it is already open.
  if (portalRect) return { mode:'portal', visible:true, hint:false };
  if (invitationVisible) return { mode:'invitation', visible:true, hint:false };
  if (treeVisible) return { mode:'tree', visible:true, hint:false };
  if (hasTree) return { mode:'tree-reopen', visible:false, hint:true };
  if (hasEmbeddedHost) return { mode:'embedded-flow', visible:true, hint:false };
  return { mode:'unavailable', visible:false, hint:false };
}

export function visibleViewportObstacleRects(document, selector, excluded = []) {
  const excludedElements = new Set(excluded);
  const elements = document?.querySelectorAll?.(selector) || [];
  const result = [];
  for (const element of elements) {
    if (!element || excludedElements.has(element)) continue;
    const styles = document.defaultView?.getComputedStyle?.(element);
    if (styles?.display === 'none' || styles?.visibility === 'hidden' || Number(styles?.opacity) <= 0.05) continue;
    const rect = element.getBoundingClientRect?.();
    if (rect?.width > 0 && rect?.height > 0 && [rect.left, rect.top, rect.right, rect.bottom].every(Number.isFinite)) {
      result.push({ left:rect.left, top:rect.top, right:rect.right, bottom:rect.bottom });
    }
  }
  return result;
}

/** Convert projected center-based hit rectangles to viewport edge rectangles. */
export function viewportObstacleRectsFromCenters(rects = []) {
  return (Array.isArray(rects) ? rects : []).map(rect => {
    const x = Number(rect?.x), y = Number(rect?.y);
    const width = Number(rect?.width), height = Number(rect?.height);
    if (![x, y, width, height].every(Number.isFinite) || width <= 0 || height <= 0) return null;
    return { left:x - width / 2, top:y - height / 2, right:x + width / 2, bottom:y + height / 2 };
  }).filter(Boolean);
}

/** Return a short straight leader only when it clears every supplied obstacle. */
export function createOrbitChildLabelLeader(labelRect, targetRect, obstacles = [], { clearance = 3 } = {}) {
  const label = { left:Number(labelRect?.left), top:Number(labelRect?.top), right:Number(labelRect?.right), bottom:Number(labelRect?.bottom) };
  const target = { left:Number(targetRect?.left), top:Number(targetRect?.top), right:Number(targetRect?.right), bottom:Number(targetRect?.bottom) };
  if (![...Object.values(label), ...Object.values(target)].every(Number.isFinite)
    || label.right <= label.left || label.bottom <= label.top || target.right <= target.left || target.bottom <= target.top) return null;
  if (label.left < target.right && label.right > target.left && label.top < target.bottom && label.bottom > target.top) return null;
  const labelCenter = { x:(label.left + label.right) / 2, y:(label.top + label.bottom) / 2 };
  const targetCenter = { x:(target.left + target.right) / 2, y:(target.top + target.bottom) / 2 };
  const dx = targetCenter.x - labelCenter.x, dy = targetCenter.y - labelCenter.y;
  if (Math.hypot(dx, dy) < 1) return null;
  const edgePoint = (rect, vx, vy) => {
    const halfWidth = (rect.right - rect.left) / 2, halfHeight = (rect.bottom - rect.top) / 2;
    const scale = 1 / Math.max(Math.abs(vx) / halfWidth, Math.abs(vy) / halfHeight);
    return { x:(rect.left + rect.right) / 2 + vx * scale, y:(rect.top + rect.bottom) / 2 + vy * scale };
  };
  const from = edgePoint(label, dx, dy), to = edgePoint(target, -dx, -dy);
  const pad = Math.max(0, Number(clearance) || 0);
  const intersects = rect => {
    const segment = [Number(rect?.x1), Number(rect?.y1), Number(rect?.x2), Number(rect?.y2)];
    if (segment.every(Number.isFinite)) {
      const [x1, y1, x2, y2] = segment;
      const cross = (ax, ay, bx, by) => ax * by - ay * bx;
      const orient = (ax, ay, bx, by, cx, cy) => cross(bx - ax, by - ay, cx - ax, cy - ay);
      const a = orient(from.x, from.y, to.x, to.y, x1, y1);
      const b = orient(from.x, from.y, to.x, to.y, x2, y2);
      const c = orient(x1, y1, x2, y2, from.x, from.y);
      const d = orient(x1, y1, x2, y2, to.x, to.y);
      const onSegment = (ax, ay, bx, by, px, py) => px >= Math.min(ax, bx) && px <= Math.max(ax, bx)
        && py >= Math.min(ay, by) && py <= Math.max(ay, by);
      const epsilon = 1e-9;
      const zero = value => Math.abs(value) <= epsilon;
      return (Math.sign(a) !== Math.sign(b) && Math.sign(c) !== Math.sign(d))
        || (zero(a) && onSegment(from.x, from.y, to.x, to.y, x1, y1))
        || (zero(b) && onSegment(from.x, from.y, to.x, to.y, x2, y2))
        || (zero(c) && onSegment(x1, y1, x2, y2, from.x, from.y))
        || (zero(d) && onSegment(x1, y1, x2, y2, to.x, to.y));
    }
    const left = Number(rect?.left) - pad, right = Number(rect?.right) + pad;
    const top = Number(rect?.top) - pad, bottom = Number(rect?.bottom) + pad;
    if (![left, right, top, bottom].every(Number.isFinite) || right <= left || bottom <= top) return false;
    let start = 0, end = 1;
    const segmentX = to.x - from.x, segmentY = to.y - from.y;
    for (const [p, q] of [[-segmentX, from.x - left], [segmentX, right - from.x], [-segmentY, from.y - top], [segmentY, bottom - from.y]]) {
      if (p === 0) { if (q < 0) return false; continue; }
      const ratio = q / p;
      if (p < 0) start = Math.max(start, ratio);
      else end = Math.min(end, ratio);
      if (start > end) return false;
    }
    return end >= 0 && start <= 1;
  };
  if ((Array.isArray(obstacles) ? obstacles : []).some(intersects)) return null;
  return { x1:from.x, y1:from.y, x2:to.x, y2:to.y };
}

function shortEdgeTitle(text, maxLength = 32) {
  const title = String(text || '').replace(/\s+/g, ' ').trim();
  if (title.length <= maxLength) return title;
  const prefix = title.slice(0, maxLength - 1);
  const wordBoundary = prefix.lastIndexOf(' ');
  return `${prefix.slice(0, wordBoundary > maxLength * 0.55 ? wordBoundary : maxLength - 1).trimEnd()}…`;
}

export function edgeMarker(point, bounds, text) {
  if (!bounds) return null;
  const dx = point.x < bounds.left ? -1 : point.x > bounds.right ? 1 : 0;
  const dy = point.y < bounds.top ? -1 : point.y > bounds.bottom ? 1 : 0;
  if (dx === 0 && dy === 0) return null;
  const arrow = dy < 0 ? (dx < 0 ? '↖' : dx > 0 ? '↗' : '↑')
    : dy > 0 ? (dx < 0 ? '↙' : dx > 0 ? '↘' : '↓')
      : dx < 0 ? '←' : '→';
  return `${arrow} ${shortEdgeTitle(text)}`;
}

export function shortQuestionTitle(text, maxWords = 5) {
  const words = String(text || 'Saved question').replace(/^what if\s+/i, '').trim().split(/\s+/);
  return words.length > maxWords ? `${words.slice(0, maxWords).join(' ')}…` : words.join(' ');
}

export function createWorldLabelCandidates(entries, { currentId, focusedId, project, measure, yearFirst = false, include = () => false, edgeMarkerIncluded = false, bounds, lineageBounds = bounds, reservedRects = [] }) {
  const candidates = [];
  for (const entry of entries || []) {
    const included = include(entry);
    if (!shouldShowWorldLabel(entry, currentId, focusedId) && !included) continue;
    const point = project(entry);
    if (!point) continue;
    const canMarkIncludedEdge = edgeMarkerIncluded && included && bounds
      && Number.isFinite(point.x) && Number.isFinite(point.y)
      && (point.x < bounds.left || point.x > bounds.right || point.y < bounds.top || point.y > bounds.bottom);
    if (point.visible === false && !canMarkIncludedEdge) continue;
    const fullText = worldLabelText(entry.world, { yearFirst });
    const lineageMarker = entry.lineage && entry.id !== currentId ? edgeMarker(point, lineageBounds, fullText) : null;
    const includedEdgeMarker = canMarkIncludedEdge ? edgeMarker(point, bounds, fullText) : null;
    const marker = lineageMarker || includedEdgeMarker;
    const text = marker || fullText;
    const size = measure(text);
    const markerBounds = lineageMarker ? lineageBounds : includedEdgeMarker ? bounds : null;
    const markerPoint = marker && markerBounds ? {
      x: Math.max(markerBounds.left + size.width / 2 + 2, Math.min(markerBounds.right - size.width / 2 - 2, point.x)),
      y: Math.max(markerBounds.top + size.height / 2 + 2, Math.min(markerBounds.bottom - size.height / 2 - 2, point.y)),
    } : point;
    candidates.push({
      id: entry.id, text, x: markerPoint.x, y: markerPoint.y,
      width: size.width, height: size.height,
      priority: Math.max(included ? 85 : 0, labelPriority({ id: entry.id, lineage: entry.lineage }, currentId, focusedId)),
      kind: 'world', fullText,
      edgeFallback: Boolean(edgeMarkerIncluded && included),
    });
  }
  return candidates;
}
