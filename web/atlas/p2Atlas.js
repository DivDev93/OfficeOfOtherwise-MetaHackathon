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
export function layoutLogTimeTicks({ earliestYear, presentYear = PRESENT_YEAR, left = -4.6, right = 3.8, minGap = 0.78 } = {}) {
  const present = astronomicalYear(presentYear);
  const earliest = astronomicalYear(earliestYear);
  if (present == null || earliest == null || present < earliest) return [];
  const maxAge = present - earliest;
  const ages = [0, 1, 10, 100, 500, 1_000, 5_000, 10_000, 50_000, 100_000, 500_000, 1_000_000, 5_000_000, 10_000_000, 100_000_000, 1_000_000_000, 2_000_000_000]
    .filter(age => age <= maxAge || age === 0);
  const candidates = ages.map(age => {
    const year = present - age;
    const x = logDistanceX(historicalYear(year), { presentYear, earliestYear, left, right });
    return { age, year: historicalYear(year), x, label: age === 0 ? `PRESENT · ${presentYear}` : displayYearFromAstronomical(year) };
  }).sort((a, b) => a.x - b.x);
  const selected = [];
  for (const tick of candidates) {
    if (!selected.length || tick.x - selected.at(-1).x >= minGap || tick.age === 0) selected.push(tick);
  }
  if (selected.length > 1 && selected.at(-1).age === 0 && right - selected.at(-2).x < minGap) selected.splice(-2, 1);
  return selected;
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
  const distance = new Map();
  const start = String(currentId ?? '');
  if (!byId.has(start)) return distance;
  const queue = [start]; distance.set(start, 0);
  for (let head = 0; head < queue.length; head++) {
    const id = queue[head], world = byId.get(id), nextDistance = distance.get(id) + 1;
    const neighbors = [];
    if (world?.parentId != null) neighbors.push(String(world.parentId));
    for (const child of byId.values()) if (child.parentId != null && String(child.parentId) === id) neighbors.push(idOf(child));
    for (const neighbor of neighbors) if (byId.has(neighbor) && !distance.has(neighbor)) {
      distance.set(neighbor, nextDistance); queue.push(neighbor);
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
    chips.push({ questionId, count: foldable.length, divergenceYear: Number.isFinite(divergenceYear) ? divergenceYear : null, label: `${label} · ${foldable.length}` });
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

function questionLaneY(questionId, questionIndex, mode) {
  if (mode === 'theme') return 0;
  if (mode === 'branch-order') return questionIndex;
  return 0.55;
}

function nodeAxisY(world, mode, questionIndex, siblingOrder, depth) {
  if (mode === 'history-distance') return 0.55 + clamp(Number(world.boldness) || 0, 0, 1) * 2.3;
  if (mode === 'branch-order') return questionIndex + (siblingOrder - 0.5) * 0.3 + Math.min(depth, 8) * 0.08;
  return (THEME_LANES[world.theme] ?? 0) + Math.min(depth, 8) * 0.075;
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
  ...lodOptions
} = {}) {
  if (!AXIS_MODES.includes(axisMode)) throw new RangeError(`Unknown atlas axis mode: ${axisMode}`);
  const worlds = Array.isArray(graph?.worlds) ? graph.worlds.filter(world => idOf(world)) : [];
  const questions = Array.isArray(graph?.questions) ? graph.questions : [];
  const current = worlds.find(world => idOf(world) === String(currentId));
  const currentQuestionId = String(current?.questionId ?? '');
  const { lineage } = ancestry(worlds, currentId);
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
  const yearToX = year => logDistanceX(year, { presentYear, earliestYear, latestYear, left, right });
  const futureExtension = latestYear > presentYear ? {
    fromX: right,
    toX: right + FUTURE_EXTENSION_WIDTH,
    latestYear,
    label: `FUTURE · ${latestYear} →`,
  } : null;
  const qs = [...new Set(worlds.map(world => String(world.questionId ?? '')).filter(Boolean))].sort();
  const qIndex = new Map(qs.map((id, index) => [id, (index - (qs.length - 1) / 2) * 0.85]));
  const siblingOrder = new Map();
  const childrenByParent = new Map();
  for (const world of worlds) {
    const parent = world.parentId == null ? '' : String(world.parentId);
    if (!childrenByParent.has(parent)) childrenByParent.set(parent, []);
    childrenByParent.get(parent).push(world);
  }
  for (const siblings of childrenByParent.values()) {
    siblings.sort((a, b) => proposedOrder(a) - proposedOrder(b) || Number(a.year) - Number(b.year) || idOf(a).localeCompare(idOf(b)));
    siblings.forEach((world, index) => siblingOrder.set(idOf(world), siblings.length > 1 ? index / (siblings.length - 1) : 0.5));
  }
  const positions = new Map();
  const occupiedLabels = [];
  const preliminaryWorlds = worlds.map(world => {
    const id = idOf(world), questionId = String(world.questionId ?? '');
    const x = yearToX(world.year);
    const laneIndex = qIndex.get(questionId) ?? 0;
    const y = nodeAxisY(world, axisMode, laneIndex, siblingOrder.get(id) || 0, depth.get(id) || 0);
    return { id, world, x, y, z: 0, lineage: lineage.has(id), questionId, depth: depth.get(id) || 0 };
  });
  const tiedRows = new Map();
  for (const item of preliminaryWorlds) {
    const key = item.y.toFixed(4);
    if (!tiedRows.has(key)) tiedRows.set(key, []);
    tiedRows.get(key).push(item);
  }
  for (const row of tiedRows.values()) {
    if (row.length < 2) continue;
    row.sort((a, b) => proposedOrder(a.world) - proposedOrder(b.world)
      || Number(a.world.year) - Number(b.world.year) || a.id.localeCompare(b.id));
    for (let index = 0; index < row.length; index++) row[index].y += ((index % 4) - 1.5) * 0.48;
  }
  const laidOutWorlds = preliminaryWorlds;
  for (const item of laidOutWorlds) positions.set(item.id, item);

  const tickLayout = layoutLogTimeTicks({ earliestYear, presentYear, left, right });
  const tickLabels = [];
  for (const tick of tickLayout) {
    const candidate = { ...tick, y: -0.35 };
    if (!occupied(candidate, tickLabels, 0.78, 0.32)) tickLabels.push(candidate);
  }

  const byQuestion = new Map(questions.map(question => [String(question.id), question]));
  const worldById = new Map(laidOutWorlds.map(world => [world.id, world]));
  const questionBranches = qs.map((questionId, index) => {
    const members = worlds.filter(world => String(world.questionId ?? '') === questionId);
    const question = byQuestion.get(questionId);
    const divergenceYear = safeYear(question?.divergenceYear) ?? (members.length ? Math.min(...members.map(world => safeYear(world.year)).filter(year => year != null)) : null);
    const x = divergenceYear == null ? right : yearToX(divergenceYear);
    const y = axisMode === 'theme' ? 0 : questionLaneY(questionId, index, axisMode);
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

  const lod = atlasLOD(worlds, currentId, currentQuestionId, { ...lodOptions, questions });
  const folded = new Set(lod.foldedIds);
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

  const chipLabels = [...labelPositions];
  const chips = lod.chips.map((chip, index) => {
    const x = chip.divergenceYear == null ? left + index * 0.9 : yearToX(chip.divergenceYear);
    let y = -1.05 - index * 0.36;
    while (occupied({ x, y }, chipLabels, 2.2, 0.38)) y -= 0.4;
    chipLabels.push({ x, y });
    return { ...chip, x, y, color: 'parchment' };
  });
  const presentEarth = { x: right, y: 0, year: presentYear, label: 'PRESENT-DAY EARTH · 2026' };
  return {
    ...lod,
    presentYear,
    earliestYear,
    latestYear,
    timeScaleLabel: `Log distance back from present (${presentYear})`,
    trunk: { left, right, y: 0 },
    futureExtension,
    presentEarth,
    ticks: tickLayout,
    visibleTicks: tickLabels,
    worlds: laidOutWorlds.map(entry => ({ ...entry, labelVisible: worldLabels.get(entry.id) })),
    positions,
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
