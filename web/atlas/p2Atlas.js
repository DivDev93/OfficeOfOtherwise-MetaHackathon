export const PRESENT_YEAR = 2026;
export const PRESENT_DAY_REFERENCE = Object.freeze({ id: 'present-day-earth', kind: 'present-day', year: PRESENT_YEAR, title: 'Present-day Earth' });
export const AXIS_MODES = Object.freeze(['history-distance', 'branch-order', 'theme']);
export const AXIS_MODE_LABELS = Object.freeze({
  'history-distance': 'Distance from history',
  'branch-order': 'Branch order',
  theme: 'Theme',
});
export const AXIS_ANIMATION_MS = 700;
export const REAL_SPHERE_STEP_LIMIT = 2;
export const ATLAS_REAL_SPHERE_LIMIT = 24;
export const ATLAS_TIME_SCALE_LABEL = 'Log distance back from present (2026)';
export const FUTURE_EXTENSION_WIDTH = 1;

const clamp = (value, min, max) => Math.min(max, Math.max(min, value));
const idOf = world => world?.id == null ? null : String(world.id);
const safeYear = value => Number.isSafeInteger(Number(value)) && Number(value) !== 0 ? Number(value) : null;
function proposedOrder(world) {
  const explicit = Number(world?.proposedOrder ?? world?.order);
  if (Number.isFinite(explicit)) return explicit;
  const source = String(world?.provenance?.sourceBranchId ?? '');
  const branch = /^b(\d+)$/i.exec(source);
  return branch ? Number(branch[1]) : Number.POSITIVE_INFINITY;
}

export function astronomicalYear(year) {
  const value = safeYear(year);
  return value == null ? null : value < 0 ? value + 1 : value;
}

export function historicalYear(astronomical) {
  const value = Math.round(Number(astronomical));
  return value <= 0 ? value - 1 : value;
}

export function formatHistoricalYear(year) {
  const value = safeYear(year);
  if (value == null) return 'Undated';
  return value < 0 ? `${Math.abs(value)} BCE` : `${value} CE`;
}

/**
 * Compress elapsed years with log1p; the present always anchors the trunk's right end.
 * This preserves one monotone continuous axis for zoom and branch attachment, unlike a broken-axis jump.
 */
export function logDistanceX(year, {
  presentYear = PRESENT_YEAR,
  earliestYear = presentYear - 1,
  left = -4.6,
  right = 3.8,
  latestYear = presentYear,
  futureWidth = FUTURE_EXTENSION_WIDTH,
} = {}) {
  const present = astronomicalYear(presentYear);
  const earliest = astronomicalYear(earliestYear);
  const event = astronomicalYear(year);
  if (present == null || earliest == null || event == null || !(right > left)) return null;
  if (event > present) {
    const latest = Math.max(present, astronomicalYear(latestYear) ?? present);
    const futureSpan = Math.max(1, latest - present);
    return right + clamp((event - present) / futureSpan, 0, 1) * Math.max(0, Number(futureWidth) || 0);
  }
  const span = Math.max(1, present - earliest);
  const distance = clamp(present - event, 0, span);
  const compressed = Math.log1p(distance) / Math.log1p(span);
  return right - compressed * (right - left);
}

function displayYearFromAstronomical(year) {
  return formatHistoricalYear(historicalYear(year));
}

/** Tick labels use a minimum projected gap, so the scale never paints overlapping text. */
export function layoutLogTimeTicks({ earliestYear, presentYear = PRESENT_YEAR, left = -4.6, right = 3.8, minGap = 0.78, yearToX = null } = {}) {
  const present = astronomicalYear(presentYear);
  const earliest = astronomicalYear(earliestYear);
  if (present == null || earliest == null || present < earliest) return [];
  const maxAge = present - earliest;
  const ages = [0, 1, 10, 100, 500, 1_000, 5_000, 10_000, 50_000, 100_000, 500_000, 1_000_000, 5_000_000, 10_000_000, 100_000_000, 1_000_000_000, 2_000_000_000]
    .filter(age => age <= maxAge || age === 0);
  const candidates = ages.map(age => {
    const year = present - age;
    const x = typeof yearToX === 'function'
      ? yearToX(historicalYear(year))
      : logDistanceX(historicalYear(year), { presentYear, earliestYear, left, right });
    return { age, year: historicalYear(year), x, label: age === 0 ? `PRESENT · ${presentYear}` : displayYearFromAstronomical(year) };
  }).sort((a, b) => a.x - b.x);
  const selected = [];
  for (const tick of candidates) {
    if (!selected.length || tick.x - selected.at(-1).x >= minGap || tick.age === 0) selected.push(tick);
  }
  if (selected.length > 1 && selected.at(-1).age === 0 && right - selected.at(-2).x < minGap) selected.splice(-2, 1);
  return selected;
}

/** Give the active question a readable linear span while compressing surrounding years. */
export function focusContextTimeX(year, {
  presentYear = PRESENT_YEAR, earliestYear = presentYear - 1, latestYear = presentYear,
  focusStartYear, focusEndYear, left = -4.6, right = 3.8,
} = {}) {
  const value = astronomicalYear(year), earliest = astronomicalYear(earliestYear);
  const domainEnd = astronomicalYear(presentYear) ?? PRESENT_YEAR;
  let start = astronomicalYear(focusStartYear), end = astronomicalYear(focusEndYear);
  if ([value, earliest, start, end].some(item => item == null) || !(right > left)) return null;
  if (end < start) [start, end] = [end, start];
  const domainStart = Math.min(earliest, start);
  const hasOlder = start > domainStart, hasNewer = end < domainEnd;
  const width = right - left;
  let olderWidth = hasOlder ? width * 0.22 : 0;
  let newerWidth = hasNewer ? width * 0.13 : 0;
  const focusWidth = width - olderWidth - newerWidth;
  if (value < start && hasOlder) {
    const span = start - domainStart, distance = Math.min(span, start - value);
    return left + olderWidth * (1 - Math.log1p(distance) / Math.log1p(Math.max(1, span)));
  }
  if (value <= end || !hasNewer) {
    const span = Math.max(1, end - start);
    return left + olderWidth + Math.max(0, Math.min(1, (value - start) / span)) * focusWidth;
  }
  const span = domainEnd - end, distance = Math.min(span, value - end);
  return left + olderWidth + focusWidth + newerWidth * Math.log1p(distance) / Math.log1p(Math.max(1, span));
}

function ancestry(worlds, currentId) {
  const byId = new Map(worlds.map(world => [idOf(world), world]).filter(([id]) => id));
  const result = new Set();
  let cursor = String(currentId ?? ''), guard = 0;
  while (cursor && byId.has(cursor) && guard++ <= byId.size && !result.has(cursor)) {
    result.add(cursor);
    const parentId = byId.get(cursor)?.parentId;
    cursor = parentId == null ? '' : String(parentId);
  }
  return { byId, lineage: result };
}

function depthById(worlds) {
  const byId = new Map(worlds.map(world => [idOf(world), world]).filter(([id]) => id));
  const memo = new Map();
  function depth(id, visiting = new Set()) {
    if (memo.has(id)) return memo.get(id);
    const parent = byId.get(id)?.parentId;
    if (parent == null || !byId.has(String(parent)) || visiting.has(id)) { memo.set(id, 0); return 0; }
    const next = new Set(visiting); next.add(id);
    const value = depth(String(parent), next) + 1;
    memo.set(id, value); return value;
  }
  for (const id of byId.keys()) depth(id);
  return memo;
}

/** Undirected parent/child distance, used to choose atlas sphere versus point LOD. */
export function worldDistanceMap(worlds = [], currentId) {
  const byId = new Map((Array.isArray(worlds) ? worlds : []).map(world => [idOf(world), world]).filter(([id]) => id));
  const rootsByQuestion = new Map();
  for (const world of byId.values()) if (world.parentId == null && world.questionId != null) {
    const questionId = String(world.questionId);
    if (!rootsByQuestion.has(questionId)) rootsByQuestion.set(questionId, []);
    rootsByQuestion.get(questionId).push(idOf(world));
  }
  const distance = new Map();
  const start = String(currentId ?? '');
  if (!byId.has(start)) return distance;
  const queue = [start]; distance.set(start, 0);
  for (let head = 0; head < queue.length; head++) {
    const id = queue[head], world = byId.get(id), nextDistance = distance.get(id) + 1;
    const neighbors = [];
    if (world?.parentId != null) neighbors.push(String(world.parentId));
    for (const child of byId.values()) if (child.parentId != null && String(child.parentId) === id) neighbors.push(idOf(child));
    for (const neighbor of neighbors) if (byId.has(neighbor) && (!distance.has(neighbor) || nextDistance < distance.get(neighbor))) {
      distance.set(neighbor, nextDistance); queue.push(neighbor);
    }
    // Root possibilities share their question as a virtual parent: siblings
    // are two steps apart even though that parent is not a persisted world.
    if (world?.parentId == null && world?.questionId != null) {
      for (const sibling of rootsByQuestion.get(String(world.questionId)) || []) {
        const siblingDistance = nextDistance + 1;
        if (!distance.has(sibling) || siblingDistance < distance.get(sibling)) {
          distance.set(sibling, siblingDistance); queue.push(sibling);
        }
      }
    }
  }
  return distance;
}

/** Deterministic visible sphere/point/fold membership for Atlas LOD. */
export function atlasLOD(worlds = [], currentId, currentQuestionId, {
  sphereStepLimit = REAL_SPHERE_STEP_LIMIT,
  sphereLimit = ATLAS_REAL_SPHERE_LIMIT,
  questions = [],
  expandedQuestionIds = [],
} = {}) {
  const items = (Array.isArray(worlds) ? worlds : []).filter(world => idOf(world));
  const { lineage } = ancestry(items, currentId);
  const distances = worldDistanceMap(items, currentId);
  const current = items.find(world => idOf(world) === String(currentId));
  const activeQuestionId = String(currentQuestionId ?? current?.questionId ?? '');
  const expanded = new Set((Array.isArray(expandedQuestionIds) ? expandedQuestionIds : []).map(String));
  const questionWorlds = new Map();
  for (const world of items) {
    const key = String(world.questionId ?? '');
    if (!questionWorlds.has(key)) questionWorlds.set(key, []);
    questionWorlds.get(key).push(world);
  }
  const questionById = new Map((Array.isArray(questions) ? questions : []).map(question => [String(question.id), question]));
  const foldedIds = new Set(), chips = [];
  for (const [questionId, members] of questionWorlds) {
    if (!questionId || questionId === activeQuestionId || expanded.has(questionId)) continue;
    const foldable = members.filter(world => !lineage.has(idOf(world)));
    if (!foldable.length) continue;
    for (const world of foldable) foldedIds.add(idOf(world));
    const question = questionById.get(questionId);
    const divergenceYear = safeYear(question?.divergenceYear) ?? Math.min(...members.map(world => safeYear(world.year)).filter(year => year != null));
    const label = String(question?.label || question?.title || question?.question || questionId).replace(/^what if\s+/i, '').trim();
    const possibilityCount = `${foldable.length} ${foldable.length === 1 ? 'possibility' : 'possibilities'}`;
    chips.push({ questionId, count: foldable.length, divergenceYear: Number.isFinite(divergenceYear) ? divergenceYear : null, label: `${label} · ${possibilityCount}` });
  }
  const lineageIds = items.filter(world => lineage.has(idOf(world))).map(idOf);
  const nearIds = items.filter(world => !foldedIds.has(idOf(world)) && (distances.get(idOf(world)) ?? Number.POSITIVE_INFINITY) <= sphereStepLimit)
    .sort((a, b) => (distances.get(idOf(a)) ?? 99) - (distances.get(idOf(b)) ?? 99)
      || (Number(b.provenance?.reviewScore) || 0) - (Number(a.provenance?.reviewScore) || 0)
      || idOf(a).localeCompare(idOf(b))).map(idOf);
  const requested = [...new Set([...lineageIds, ...nearIds])];
  const mandatory = new Set(lineageIds);
  const realSphereIds = requested.filter(id => mandatory.has(id) || requested.indexOf(id) < Math.max(sphereLimit, mandatory.size));
  const pointIds = items.map(idOf).filter(id => !foldedIds.has(id) && !realSphereIds.includes(id));
  return { activeQuestionId, lineageIds, distances, realSphereIds, pointIds, foldedIds: [...foldedIds], chips };
}

const THEME_LANES = Object.freeze({
  'geography-ecology': 1.35,
  'science-medicine': 0.45,
  'infrastructure-trade': -0.45,
  'culture-daily-life': -1.35,
});

const TREE_ROW_GAP = 0.72;
const TREE_SUBTREE_GAP = 0.46;
const TREE_ROOT_GAP = 0.72;
const TREE_QUESTION_GAP = 1.1;
const TREE_BASELINE = 0.9;

function compareBranchOrder(a, b, mode = 'history-distance') {
  const themeOrder = (THEME_LANES[a.theme] ?? 0) - (THEME_LANES[b.theme] ?? 0);
  return (mode === 'theme' ? themeOrder : 0)
    || (mode === 'branch-order' ? proposedOrder(a) - proposedOrder(b) : 0)
    || (safeYear(a.year) ?? Number.POSITIVE_INFINITY) - (safeYear(b.year) ?? Number.POSITIVE_INFINITY)
    || idOf(a).localeCompare(idOf(b));
}

/** Give every node its own row while keeping each ordered subtree contiguous. */
function tidyTreeRows(worlds, childrenByParent, mode) {
  const byId = new Map(worlds.map(world => [idOf(world), world]));
  const children = new Map();
  for (const [parentId, members] of childrenByParent) {
    if (parentId && byId.has(parentId)) children.set(parentId, members.filter(member => idOf(member) !== parentId));
  }
  for (const members of children.values()) members.sort((a, b) => compareBranchOrder(a, b, mode));

  const roots = worlds.filter(world => world.parentId == null || !byId.has(String(world.parentId)))
    .sort((a, b) => String(a.questionId ?? '').localeCompare(String(b.questionId ?? '')) || compareBranchOrder(a, b, mode));
  const rows = new Map(), visiting = new Set(), placed = new Set();
  let cursor = 0;
  function place(world) {
    const id = idOf(world);
    if (placed.has(id) || visiting.has(id)) return rows.get(id) ?? cursor * TREE_ROW_GAP;
    visiting.add(id);
    const y = cursor * TREE_ROW_GAP;
    cursor++;
    rows.set(id, y);
    placed.add(id);
    const descendants = (children.get(id) || []).filter(child => !placed.has(idOf(child)) && !visiting.has(idOf(child)));
    for (let index = 0; index < descendants.length; index++) {
      place(descendants[index]);
      if (index < descendants.length - 1) cursor += TREE_SUBTREE_GAP / TREE_ROW_GAP;
    }
    visiting.delete(id);
    return y;
  }
  for (let index = 0; index < roots.length; index++) {
    place(roots[index]);
    if (index < roots.length - 1) {
      const sameQuestion = String(roots[index].questionId ?? '') === String(roots[index + 1].questionId ?? '');
      cursor += (sameQuestion ? TREE_ROOT_GAP : TREE_QUESTION_GAP) / TREE_ROW_GAP;
    }
  }
  // Malformed or cyclic components remain visible and deterministic.
  for (const world of [...worlds].sort((a, b) => compareBranchOrder(a, b, mode))) if (!placed.has(idOf(world))) place(world);
  for (const [id, y] of rows) rows.set(id, y + TREE_BASELINE);
  return rows;
}

function properSegmentCrossing(a, b, c, d) {
  const orient = (p, q, r) => (q.x - p.x) * (r.y - p.y) - (q.y - p.y) * (r.x - p.x);
  const abC = orient(a, b, c), abD = orient(a, b, d);
  const cdA = orient(c, d, a), cdB = orient(c, d, b);
  return abC * abD < -1e-10 && cdA * cdB < -1e-10;
}

function pointSegmentDistance(point, a, b) {
  const dx = b.x - a.x, dy = b.y - a.y;
  const lengthSquared = dx * dx + dy * dy;
  const t = lengthSquared ? clamp(((point.x - a.x) * dx + (point.y - a.y) * dy) / lengthSquared, 0, 1) : 0;
  return Math.hypot(point.x - (a.x + dx * t), point.y - (a.y + dy * t));
}

function pathsCross(a, b) {
  for (let first = 1; first < a.length; first++) for (let second = 1; second < b.length; second++) {
    if (properSegmentCrossing(a[first - 1], a[first], b[second - 1], b[second])) return true;
  }
  return false;
}

function pathHitsNode(path, nodes, endpointIds, clearance) {
  for (const node of nodes) {
    if (endpointIds.has(String(node.id))) continue;
    for (let index = 1; index < path.length; index++) {
      if (pointSegmentDistance(node, path[index - 1], path[index]) < clearance) return true;
    }
  }
  return false;
}

function nodesHitByPath(path, nodes, endpointIds, clearance) {
  return nodes.filter(node => !endpointIds.has(String(node.id))
    && pathHitsNode(path, [node], endpointIds, clearance)).map(node => String(node.id));
}

/** Sample a smooth cubic parent-child edge; offset bends it around a routing lane. */
export function sampleAtlasEdgePath(from, to, segments = 12, { offset = 0 } = {}) {
  const count = Math.max(2, Math.floor(Number(segments) || 12));
  const dx = to.x - from.x, dy = to.y - from.y;
  const direction = Math.sign(dx) || 1;
  const bend = Math.min(0.85, Math.abs(dx) * 0.42);
  const length = Math.hypot(dx, dy) || 1;
  const normal = { x: -dy / length, y: dx / length };
  const lane = Number(offset) || 0;
  const control1 = { x: from.x + direction * bend + normal.x * lane, y: from.y + normal.y * lane };
  const control2 = { x: to.x - direction * bend + normal.x * lane, y: to.y + normal.y * lane };
  const points = [];
  for (let index = 0; index <= count; index++) {
    const t = index / count, u = 1 - t;
    points.push({
      x: u ** 3 * from.x + 3 * u ** 2 * t * control1.x + 3 * u * t ** 2 * control2.x + t ** 3 * to.x,
      y: u ** 3 * from.y + 3 * u ** 2 * t * control1.y + 3 * u * t ** 2 * control2.y + t ** 3 * to.y,
      z: (Number(from.z) || 0) * u + (Number(to.z) || 0) * t,
    });
  }
  return points;
}

/** Route a visible forest deterministically, bending conflicting edges into separate lanes. */
export function routeAtlasEdgePaths(edges = [], {
  segments = 16, laneGap = 0.5, maxAttempts = 512, nodeClearance = 0.16, nodes = [],
} = {}) {
  const ordered = (Array.isArray(edges) ? edges : []).filter(edge => edge?.from && edge?.to)
    .slice().sort((a, b) => String(a.parentId).localeCompare(String(b.parentId)) || String(a.childId).localeCompare(String(b.childId)));
  const routed = [];
  for (const edge of ordered) {
    const endpointIds = new Set([String(edge.parentId), String(edge.childId)]);
    let chosen = null, offset = 0;
    for (let attempt = 0; attempt <= maxAttempts; attempt++) {
      offset = attempt === 0 ? 0 : Math.ceil(attempt / 2) * laneGap * (attempt % 2 ? 1 : -1);
      const points = sampleAtlasEdgePath(edge.from, edge.to, segments, { offset });
      if (routed.every(other => !pathsCross(points, other.points))
        && !pathHitsNode(points, nodes, endpointIds, nodeClearance)) {
        chosen = points; break;
      }
    }
    if (!chosen) chosen = sampleAtlasEdgePath(edge.from, edge.to, segments, { offset });
    const unresolvedCrossings = routed.filter(other => pathsCross(chosen, other.points))
      .map(other => `${other.parentId}->${other.childId}`);
    routed.push({ ...edge, points: chosen, routeOffset: offset,
      unresolvedCrossings,
      unresolvedNodes: nodesHitByPath(chosen, nodes, endpointIds, nodeClearance) });
  }
  return routed;
}

function occupied(label, labels, width, height) {
  return labels.some(existing => Math.abs(existing.x - label.x) < width && Math.abs(existing.y - label.y) < height);
}

/** Build Atlas coordinates, trunk question stubs, folded-question chips, labels and LOD. */
export function buildAtlasTimeline(graph, currentId, axisMode = 'history-distance', {
  presentYear = PRESENT_YEAR,
  left = -4.6,
  right = 3.8,
  labelWidth = 1.55,
  labelHeight = 0.42,
  frameAspect = null,
  ...lodOptions
} = {}) {
  if (!AXIS_MODES.includes(axisMode)) throw new RangeError(`Unknown atlas axis mode: ${axisMode}`);
  const worlds = Array.isArray(graph?.worlds) ? graph.worlds.filter(world => idOf(world)) : [];
  const questions = Array.isArray(graph?.questions) ? graph.questions : [];
  const current = worlds.find(world => idOf(world) === String(currentId));
  const currentQuestionId = String(current?.questionId ?? '');
  const { lineage } = ancestry(worlds, currentId);
  const lod = atlasLOD(worlds, currentId, currentQuestionId, { ...lodOptions, questions });
  const folded = new Set(lod.foldedIds);
  const layoutWorlds = worlds.filter(world => !folded.has(idOf(world)));
  const depth = depthById(worlds);
  const years = worlds.map(world => safeYear(world.year)).filter(year => year != null);
  for (const question of questions) {
    const explicit = safeYear(question.divergenceYear);
    const members = worlds.filter(world => String(world.questionId ?? '') === String(question.id));
    const derived = members.map(world => safeYear(world.year)).filter(year => year != null);
    const year = explicit ?? (derived.length ? Math.min(...derived) : null);
    if (year != null) years.push(year);
  }
  const pastYears = years.filter(year => year <= presentYear);
  const earliestYear = pastYears.length ? Math.min(...pastYears) : presentYear - 1;
  const latestYear = years.length ? Math.max(presentYear, ...years) : presentYear;
  const activeQuestion = questions.find(question => String(question.id) === currentQuestionId);
  const activeYears = worlds.filter(world => String(world.questionId ?? '') === currentQuestionId)
    .map(world => safeYear(world.year)).filter(year => year != null);
  const explicitFocusStart = safeYear(activeQuestion?.divergenceYear);
  const focusStartYear = explicitFocusStart ?? (activeYears.length ? Math.min(...activeYears) : null);
  // Future descendants use the existing bounded extension, but must not
  // disable the linear focus on the active question's historical span.
  const latestActiveYear = activeYears.length ? Math.max(...activeYears) : focusStartYear;
  const focusEndYear = latestActiveYear == null ? null : Math.min(presentYear, latestActiveYear);
  const useFocusContext = focusStartYear != null && focusEndYear != null && focusEndYear > focusStartYear;
  const qs = [...new Set(worlds.map(world => String(world.questionId ?? '')).filter(Boolean))].sort();
  const childrenByParent = new Map();
  for (const world of layoutWorlds) {
    const parent = world.parentId == null ? '' : String(world.parentId);
    if (!childrenByParent.has(parent)) childrenByParent.set(parent, []);
    childrenByParent.get(parent).push(world);
  }
  const treeRows = tidyTreeRows(layoutWorlds, childrenByParent, axisMode);
  const rowValues = [...treeRows.values()];
  const treeSpan = rowValues.length > 1 ? Math.max(...rowValues) - Math.min(...rowValues) : 0;
  const aspect = Number(frameAspect);
  const horizontalScale = Number.isFinite(aspect) && aspect > 0 && treeSpan > 0
    ? Math.max(1, treeSpan * aspect / (right - left)) : 1;
  const baseMidpoint = (left + right) / 2;
  const scaleX = x => horizontalScale === 1 ? x : baseMidpoint + (x - baseMidpoint) * horizontalScale;
  const layoutLeft = scaleX(left), layoutRight = scaleX(right);
  const timeOptions = { presentYear, earliestYear, latestYear, left, right, focusStartYear, focusEndYear };
  const baseYearToX = year => astronomicalYear(year) > astronomicalYear(presentYear)
    ? logDistanceX(year, { presentYear, earliestYear, latestYear, left, right })
    : useFocusContext ? focusContextTimeX(year, timeOptions) : logDistanceX(year, { presentYear, earliestYear, latestYear, left, right });
  const yearToX = year => scaleX(baseYearToX(year));
  const futureExtension = latestYear > presentYear ? {
    fromX: layoutRight,
    toX: layoutRight + FUTURE_EXTENSION_WIDTH * horizontalScale,
    latestYear,
    label: `FUTURE · ${latestYear} →`,
  } : null;
  const positions = new Map();
  const occupiedLabels = [];
  const preliminaryWorlds = worlds.map(world => {
    const id = idOf(world), questionId = String(world.questionId ?? '');
    const x = yearToX(world.year);
    const y = treeRows.get(id) ?? TREE_BASELINE;
    return { id, world, x, y, z: 0, lineage: lineage.has(id), questionId, depth: depth.get(id) || 0 };
  });
  const laidOutWorlds = preliminaryWorlds;
  for (const item of laidOutWorlds) positions.set(item.id, item);

  const tickLayout = layoutLogTimeTicks({ earliestYear, presentYear, left: layoutLeft, right: layoutRight, yearToX });
  const tickLabels = [];
  for (const tick of tickLayout) {
    const candidate = { ...tick, y: -0.35 };
    if (!occupied(candidate, tickLabels, 0.78, 0.32)) tickLabels.push(candidate);
  }

  const byQuestion = new Map(questions.map(question => [String(question.id), question]));
  const visibleWorlds = laidOutWorlds.filter(world => !folded.has(world.id));
  const visibleWorldById = new Map(visibleWorlds.map(world => [world.id, world]));
  const worldById = new Map(laidOutWorlds.map(world => [world.id, world]));
  const parentChildEdges = visibleWorlds.flatMap(child => {
    const parent = child.world.parentId == null ? null : visibleWorldById.get(String(child.world.parentId));
    if (!parent) return [];
    const from = { x: parent.x, y: parent.y, z: parent.z };
    const to = { x: child.x, y: child.y, z: child.z };
    return [{ parentId: parent.id, childId: child.id, from, to, lineage: parent.lineage && child.lineage }];
  });
  const parentChildPaths = routeAtlasEdgePaths(parentChildEdges, {
    nodes: visibleWorlds.map(world => ({ id: world.id, x: world.x, y: world.y })),
  });
  const questionBranches = qs.map(questionId => {
    const members = worlds.filter(world => String(world.questionId ?? '') === questionId);
    const question = byQuestion.get(questionId);
    const divergenceYear = safeYear(question?.divergenceYear) ?? (members.length ? Math.min(...members.map(world => safeYear(world.year)).filter(year => year != null)) : null);
    const x = divergenceYear == null ? right : yearToX(divergenceYear);
    const questionRows = visibleWorlds.filter(world => world.questionId === questionId).map(world => world.y);
    const y = questionRows.length ? (Math.min(...questionRows) + Math.max(...questionRows)) / 2 : 0;
    const label = String(question?.label || question?.title || question?.question || questionId).replace(/^what if\s+/i, '').trim();
    const attachmentMode = String(question?.attachmentMode || question?.mode || 'trunk');
    const parentWorldId = question?.parentWorldId == null ? null : String(question.parentWorldId);
    const firstWorld = members.find(world => parentWorldId != null && String(world.parentId ?? '') === parentWorldId) || members[0] || null;
    const attachmentTarget = firstWorld ? worldById.get(idOf(firstWorld)) : null;
    const attachmentParent = parentWorldId ? worldById.get(parentWorldId) : null;
    const attached = attachmentMode === 'current-world' && attachmentParent && attachmentTarget;
    return {
      questionId, x, y, divergenceYear, label, attachmentMode, parentWorldId,
      attachment: attached ? {
        from: { x: attachmentParent.x, y: attachmentParent.y, z: attachmentParent.z },
        to: { x: attachmentTarget.x, y: attachmentTarget.y, z: attachmentTarget.z },
        fromWorldId: parentWorldId, toWorldId: attachmentTarget.id,
      } : null,
      labelX: attached ? (attachmentParent.x + attachmentTarget.x) / 2 : x,
      labelY: attached ? (attachmentParent.y + attachmentTarget.y) / 2 + 0.34 : y + 0.34,
      active: questionId === currentQuestionId,
    };
  });
  const questionAttachments = questionBranches.filter(branch => branch.attachment).map(branch => ({
    questionId: branch.questionId, ...branch.attachment, label: branch.label, active: branch.active,
  }));

  const labelPositions = tickLabels.map(tick => ({ x: tick.x, y: tick.y }));
  const worldLabels = new Map();
  for (const entry of [...laidOutWorlds].sort((a, b) => Number(b.id === String(currentId)) - Number(a.id === String(currentId))
    || Number(b.lineage) - Number(a.lineage) || a.x - b.x || a.y - b.y || a.id.localeCompare(b.id))) {
    if (folded.has(entry.id)) { worldLabels.set(entry.id, false); continue; }
    const candidate = { x: entry.x + 0.14, y: entry.y + 0.27 };
    const visible = entry.id === String(currentId) || !occupied(candidate, labelPositions, labelWidth, labelHeight);
    if (visible) labelPositions.push(candidate);
    worldLabels.set(entry.id, visible);
  }

  const chipPlacements = [];
  const chips = lod.chips.map((chip, index) => {
    const x = chip.divergenceYear == null ? layoutLeft + index * 0.9 * horizontalScale : yearToX(chip.divergenceYear);
    let stack = 0;
    const width = Math.min(2.2, Math.max(0.82, chip.label.length * 0.035));
    while (chipPlacements.some(other => Math.abs(other.x - x) < (other.width + width) / 2 + 0.12 && other.stack === stack)) stack++;
    const placement = { ...chip, x, y: stack * 0.38, trunkY: 0, stack, width };
    chipPlacements.push(placement);
    return { ...placement, color: 'parchment' };
  });
  const presentEarth = { x: layoutRight, y: 0, year: presentYear, label: 'PRESENT-DAY EARTH · 2026' };
  return {
    ...lod,
    presentYear,
    earliestYear,
    latestYear,
    timeScaleLabel: useFocusContext
      ? `Linear focus ${focusStartYear}–${focusEndYear}; compressed context`
      : `Log distance back from present (${presentYear})`,
    timeScaleMode: useFocusContext ? 'focus-context' : 'log',
    focusContext: useFocusContext ? { questionId: currentQuestionId, startYear: focusStartYear, endYear: focusEndYear,
      olderContext: focusStartYear > earliestYear, newerContext: focusEndYear < presentYear,
      left: scaleX(left + (focusStartYear > earliestYear ? (right - left) * 0.22 : 0)),
      right: scaleX(left + (focusStartYear > earliestYear ? (right - left) * 0.22 : 0)
        + (right - left) * (1 - (focusStartYear > earliestYear ? 0.22 : 0) - (focusEndYear < presentYear ? 0.13 : 0))) } : null,
    frameAspect: Number.isFinite(aspect) && aspect > 0 ? aspect : null,
    horizontalScale,
    treeSpan,
    trunk: { left: layoutLeft, right: layoutRight, y: 0 },
    futureExtension,
    presentEarth,
    ticks: tickLayout,
    visibleTicks: tickLabels,
    worlds: laidOutWorlds.map(entry => ({ ...entry, labelVisible: worldLabels.get(entry.id) })),
    positions,
    parentChildPaths,
    questionBranches,
    questionAttachments,
    chips,
  };
}

/** Cubic ease-out sample for the required 700 ms axis realignment. */
/** Link each first-generation spatial root to its separate parchment question token. */
export function planQuestionRootConnections(worlds = [], questionBranches = [], lineageIds = []) {
  const lineage = new Set((lineageIds && typeof lineageIds[Symbol.iterator] === 'function' ? [...lineageIds] : []).map(String));
  const roots = (Array.isArray(worlds) ? worlds : []).filter(world => idOf(world) && world.parentId == null);
  const connections = [];
  for (const branch of Array.isArray(questionBranches) ? questionBranches : []) {
    for (const world of roots) {
      if (String(world.questionId ?? '') !== String(branch.questionId ?? '')) continue;
      connections.push({ questionId: String(branch.questionId), worldId: idOf(world), color: lineage.has(idOf(world)) ? 'lineage' : 'proposed' });
    }
  }
  return connections;
}

export function axisTransitionProgress(elapsedMs, durationMs = AXIS_ANIMATION_MS) {
  const t = clamp(Number(elapsedMs) / Math.max(1, Number(durationMs)), 0, 1);
  return 1 - (1 - t) ** 3;
}

export function interpolateAtlasPoint(from, to, progress) {
  const t = clamp(Number(progress), 0, 1);
  return {
    x: Number(from.x) + (Number(to.x) - Number(from.x)) * t,
    y: Number(from.y) + (Number(to.y) - Number(from.y)) * t,
    z: Number(from.z || 0) + (Number(to.z || 0) - Number(from.z || 0)) * t,
  };
}
