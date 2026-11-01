export const ATLAS_THEMES = Object.freeze([
  'geography-ecology',
  'science-medicine',
  'infrastructure-trade',
  'culture-daily-life',
]);

const THEME_KEYWORDS = Object.freeze({
  'geography-ecology': /\b(geograph\w*|climate|ecosystem|ecolog\w*|environment|river|ocean|forest|desert|grassland|ice|coast|land bridge|animal|plant|species|migration|habitat|mammoth|reindeer)\b/i,
  'science-medicine': /\b(science|scient\w*|medic\w*|health|disease|doctor|anatom\w*|laboratory|research|astronom\w*|mathemat\w*|physics|chemistry|biology|invention|discovery|knowledge|university|scholar\w*|library|steam|engine|technology)\b/i,
  'infrastructure-trade': /\b(infrastructure|trade|trading|market|commerce|road|rail|railway|canal|port|harbou?r|bridge|transport|shipping|ship|caravan|workshop|industry|factory|power|grid|network|pump|mill)\b/i,
  'culture-daily-life': /\b(culture|cultural|community|communities|language|music|art|craft|clothing|food|daily life|tradition|festival|education|family|village|city|societ\w*|herder\w*|scribe\w*|farmer\w*)\b/i,
});

function text(value) { return typeof value === 'string' ? value.trim() : ''; }
function safeId(value) {
  return typeof value === 'string' && value.length > 0 && value.length <= 160
    && /^[A-Za-z0-9][A-Za-z0-9._:-]*$/.test(value);
}
function finiteCoordinate(value, min, max) { return Number.isFinite(value) && value >= min && value <= max; }

/** Deterministic legacy theme inference. Keyword group order is the tie breaker. */
export function deriveTheme(value) {
  const haystack = typeof value === 'string' ? value : [value?.title, value?.summary, value?.scene].map(text).join(' ');
  for (const theme of ATLAS_THEMES) if (THEME_KEYWORDS[theme].test(haystack)) return theme;
  return 'culture-daily-life';
}

/** Accept only safe relative asset paths; URLs, traversal, and platform paths are rejected. */
export function normalizeAssetRef(value) {
  if (typeof value !== 'string' || !value.trim() || value.length > 500) return undefined;
  const raw = value.trim();
  if (/^(?:[a-z][a-z\d+.-]*:|\/|\\|[A-Za-z]:)/i.test(raw) || raw.includes('\\') || /[?#]/.test(raw)) return undefined;
  const segments = raw.split('/');
  if (segments.some(segment => !segment || segment === '.' || segment === '..' || /[\u0000-\u001f]/.test(segment) || /%(?:2e|2f|5c)/i.test(segment))) return undefined;
  return raw;
}

/** Scene media is accepted only as a relative file reference with verified availability. */
export function normalizeSceneRef(value) {
  if (!value || typeof value !== 'object' || value.status !== 'complete') return undefined;
  const path = normalizeAssetRef(value.path);
  return path ? { path, status: 'complete' } : undefined;
}

function normalizePlace(place) {
  if (!place || !finiteCoordinate(place.lat, -90, 90) || !finiteCoordinate(place.lon, -180, 180)) return undefined;
  return { ...(text(place.name) ? { name: text(place.name) } : {}), lat: place.lat, lon: place.lon };
}

function normalizeDivergencePlace(value) {
  if (typeof value === 'string' && text(value)) return text(value).slice(0, 240);
  const place = normalizePlace(value);
  return place ? place : undefined;
}

function normalizedQuestion({ rootRunId, rootRun, run, fallbackDivergenceYear }) {
  const attachment = run?.questionAttachment ?? rootRun?.questionAttachment;
  const questionId = safeId(attachment?.questionId) ? attachment.questionId : rootRunId;
  const divergence = text(run?.divergence ?? rootRun?.divergence ?? rootRun?.rootDivergence ?? run?.rootDivergence);
  if (!divergence) throw new Error(`Missing divergence for root run ${questionId}`);
  const savedDivergenceYear = attachment?.divergenceYear ?? rootRun?.divergenceYear ?? rootRun?.question?.divergenceYear ?? run?.divergenceYear ?? run?.question?.divergenceYear;
  const divergenceYear = Number.isSafeInteger(savedDivergenceYear) && savedDivergenceYear !== 0
    ? savedDivergenceYear
    : Number.isSafeInteger(fallbackDivergenceYear) && fallbackDivergenceYear !== 0 ? fallbackDivergenceYear : undefined;
  const divergencePlace = attachment?.divergencePlace ?? rootRun?.divergencePlace ?? rootRun?.question?.divergencePlace ?? run?.divergencePlace ?? run?.question?.divergencePlace;
  const parentRunId = safeId(attachment?.parentRunId) ? attachment.parentRunId : undefined;
  const parentBranchId = safeId(attachment?.parentBranchId) ? attachment.parentBranchId : undefined;
  const parentWorldId = parentRunId && parentBranchId ? `${parentRunId}:${parentBranchId}`
    : safeId(attachment?.parentWorldId) ? attachment.parentWorldId : undefined;
  return {
    id: questionId,
    rootRunId: questionId,
    question: divergence,
    ...(Number.isSafeInteger(divergenceYear) && divergenceYear !== 0 ? { divergenceYear } : {}),
    ...(normalizeDivergencePlace(divergencePlace) !== undefined ? { divergencePlace: normalizeDivergencePlace(divergencePlace) } : {}),
    ...(attachment?.mode === 'current-world' || attachment?.mode === 'present-day' ? { attachmentMode: attachment.mode } : {}),
    ...(parentWorldId ? { parentWorldId } : {}),
    ...(parentRunId ? { parentRunId } : {}),
    ...(parentBranchId ? { parentBranchId } : {}),
  };
}

function branchWorld({ runId, branch, questionId, parentId, depth, assetRefs = {}, legacy = true }) {
  if (!branch || !safeId(branch.id)) throw new Error(`Invalid branch id in run ${runId}`);
  if (!Number.isSafeInteger(branch.year) || branch.year === 0) throw new Error(`Invalid year for ${runId}:${branch.id}`);
  const place = normalizePlace(branch.place);
  if (!place) throw new Error(`Invalid coordinates for ${runId}:${branch.id}`);
  const title = text(branch.title);
  const summary = text(branch.summary);
  if (!title || !summary) throw new Error(`Missing title or summary for ${runId}:${branch.id}`);
  const reviewScore = Number.isFinite(branch.score) && branch.score >= 0 && branch.score <= 10 ? branch.score : undefined;
  const modelTheme = ATLAS_THEMES.includes(branch.theme) ? branch.theme : undefined;
  const theme = modelTheme ?? deriveTheme(branch);
  const sceneRef = normalizeSceneRef(assetRefs.sceneRef);
  const heroSelected = assetRefs.heroSelected === true;
  const heroRef = heroSelected ? normalizeSceneRef(assetRefs.heroRef) : undefined;
  const cutoutRef = heroSelected ? normalizeAssetRef(assetRefs.cutoutRef ?? assetRefs.cutout) : undefined;
  const modelRef = heroSelected ? normalizeAssetRef(assetRefs.modelRef ?? assetRefs.model) : undefined;
  const flags = [];
  if (legacy) flags.push('legacy-v1');
  flags.push(modelTheme ? 'theme-model-output' : 'theme-keyword-derived');
  if (reviewScore !== undefined) flags.push('boldness-from-review-score');
  else flags.push('boldness-defaulted');
  if (depth > 0) flags.push('continuation-ancestry');
  flags.push(sceneRef ? 'scene-image-available' : 'scene-image-unavailable');
  if (heroRef) flags.push('selected-hero-image-available');
  else if (heroSelected) flags.push('selected-hero-image-unavailable');
  return {
    id: `${runId}:${branch.id}`,
    parentId: parentId ?? null,
    questionId,
    year: branch.year,
    lat: place.lat,
    lon: place.lon,
    title,
    summary,
    ...(text(branch.scene) ? { scene: text(branch.scene) } : {}),
    sceneRef: sceneRef ?? null,
    heroRef: heroRef ?? null,
    ...(cutoutRef ? { cutoutRef } : {}),
    ...(modelRef ? { modelRef } : {}),
    ...(branch.geography && typeof branch.geography === 'object' ? { geography: branch.geography } : {}),
    theme,
    boldness: reviewScore === undefined ? 0.5 : reviewScore / 10,
    provenance: {
      sourceRunId: runId,
      sourceBranchId: branch.id,
      ...(reviewScore !== undefined ? { reviewScore } : {}),
      reviewDepth: depth,
      sceneImage: sceneRef ? 'available' : 'unavailable',
      heroImage: heroRef ? 'available' : assetRefs.heroSelected ? 'unavailable' : 'not-selected',
      flags,
    },
  };
}

/** Convert a saved v1 run record into canonical world and question records. */
export function migrateSavedRun(run, { runId = run?.runId ?? run?.id, assetRefsByBranch = {}, assetRefs = {}, questionIdByRun = new Map(), questionDivergenceYearById = new Map() } = {}) {
  if (!run || typeof run !== 'object' || !Array.isArray(run.branches)) throw new Error('Expected a saved run with a branches array');
  if (!safeId(runId)) throw new Error('A stable runId is required');
  const continuation = run.continuation;
  const ancestryRootRunId = continuation?.rootRunId ?? run.rootRunId ?? runId;
  const rootRunId = safeId(run.questionAttachment?.questionId) ? run.questionAttachment.questionId : ancestryRootRunId;
  if (!safeId(rootRunId) || !safeId(ancestryRootRunId)) throw new Error(`Invalid rootRunId for run ${runId}`);
  const runEventYears = (run.branches ?? []).map(branch => branch?.year).filter(year => Number.isSafeInteger(year) && year !== 0);
  const question = normalizedQuestion({ rootRunId, rootRun: run.rootQuestion, run,
    fallbackDivergenceYear: questionDivergenceYearById.get(rootRunId) ?? (runEventYears.length ? Math.min(...runEventYears) : undefined) });
  const worlds = [];
  const path = Array.isArray(continuation?.path) ? continuation.path : [];
  let parentId = null;
  for (const [index, event] of path.entries()) {
    if (!event || !safeId(event.runId) || !safeId(event.branchId)) throw new Error(`Invalid continuation event ${index} in run ${runId}`);
    const id = `${event.runId}:${event.branchId}`;
    const branch = { ...event, id: event.branchId };
    const ancestryQuestionId = questionIdByRun.get(event.runId) ?? ancestryRootRunId;
    worlds.push(branchWorld({ runId: event.runId, branch, questionId: ancestryQuestionId, parentId, depth: index, assetRefs: assetRefsByBranch[id] ?? {}, legacy: true }));
    parentId = id;
  }
  const depth = path.length;
  const currentParentId = depth ? parentId : null;
  for (const branch of run.branches) {
    const exactRefs = assetRefsByBranch[`${runId}:${branch?.id}`] ?? {};
    const heroSelected = run.hero?.branchId === branch?.id;
    const refs = heroSelected
      ? { ...exactRefs, ...assetRefs, heroSelected: true }
      : { sceneRef: exactRefs.sceneRef };
    worlds.push(branchWorld({ runId, branch, questionId: rootRunId, parentId: currentParentId, depth, assetRefs: refs, legacy: true }));
  }
  return { worlds, questions: [question] };
}

function validSourcePath(value) {
  const normalized = normalizeAssetRef(value);
  if (!normalized || normalized !== value.replaceAll('\\', '/')) throw new Error('Source record path must be relative and traversal-free');
  return normalized;
}

function runForRecord(item) {
  const run = item?.run ?? item?.manifest ?? item;
  return item?.questionAttachment && !run?.questionAttachment ? { ...run, questionAttachment: item.questionAttachment } : run;
}

/** Build a deterministic v1 graph from saved runs; duplicate ancestor nodes are deduplicated by canonical id. */
export function migrateSavedRuns(records, { sources = [] } = {}) {
  if (!Array.isArray(records)) throw new Error('records must be an array');
  const worlds = new Map();
  const questions = new Map();
  const questionIdByRun = new Map();
  const questionDivergenceYearById = new Map();
  for (const item of records) {
    const run = runForRecord(item);
    const runId = item?.runId ?? run?.runId ?? run?.id;
    if (!safeId(runId)) continue;
    const questionId = safeId(run?.questionAttachment?.questionId)
      ? run.questionAttachment.questionId : run?.continuation?.rootRunId ?? run?.rootRunId ?? runId;
    if (safeId(questionId)) questionIdByRun.set(runId, questionId);
    if (safeId(questionId)) {
      const years = (run?.branches ?? []).map(branch => branch?.year).filter(year => Number.isSafeInteger(year) && year !== 0);
      if (years.length) {
        const earliest = Math.min(...years);
        questionDivergenceYearById.set(questionId, Math.min(questionDivergenceYearById.get(questionId) ?? earliest, earliest));
      }
    }
  }
  for (const item of records) {
    const run = runForRecord(item);
    const runId = item?.runId ?? run?.runId ?? run?.id;
    const migrated = migrateSavedRun(run, { runId, assetRefsByBranch: item?.assetRefsByBranch ?? {}, assetRefs: item?.assetRefs ?? {}, questionIdByRun, questionDivergenceYearById });
    for (const world of migrated.worlds) {
      const existing = worlds.get(world.id);
      if (existing) {
        const core = value => JSON.stringify([value.id, value.parentId, value.questionId, value.year, value.lat, value.lon, value.title, value.summary]);
        if (core(existing) !== core(world)) throw new Error(`Conflicting saved world ${world.id}`);
        const richness = value => Object.keys(value).length + Object.keys(value.provenance ?? {}).length
          + Number(Boolean(value.sceneRef)) + Number(Boolean(value.heroRef)) + Number(Boolean(value.cutoutRef)) + Number(Boolean(value.modelRef))
          + (value.scene ? 1 : 0) + (value.geography ? 1 : 0);
        if (richness(world) > richness(existing)) worlds.set(world.id, world);
      } else worlds.set(world.id, world);
    }
    for (const question of migrated.questions) {
      const existing = questions.get(question.id);
      if (existing && JSON.stringify(existing) !== JSON.stringify(question)) throw new Error(`Conflicting saved question ${question.id}`);
      questions.set(question.id, question);
    }
  }
  const sortedWorlds = [...worlds.values()].sort((a, b) => a.id.localeCompare(b.id));
  const sortedQuestions = [...questions.values()].sort((a, b) => a.id.localeCompare(b.id));
  const normalizedSources = sources.map(source => ({
    path: validSourcePath(source.path),
    ...(typeof source.sha256 === 'string' && /^[a-f\d]{64}$/i.test(source.sha256) ? { sha256: source.sha256.toLowerCase() } : {}),
  })).sort((a, b) => a.path.localeCompare(b.path));
  return {
    version: 1,
    worlds: sortedWorlds,
    questions: sortedQuestions,
    metadata: {
      migration: 'atlas-v1-deterministic',
      provenance: 'Legacy saved run records; no model calls were made.',
      sourceRecords: normalizedSources,
      counts: {
        runs: records.length,
        worlds: sortedWorlds.length,
        questions: sortedQuestions.length,
        sceneRefs: sortedWorlds.filter(world => world.sceneRef).length,
        heroRefs: sortedWorlds.filter(world => world.heroRef).length,
        scenesUnavailable: sortedWorlds.filter(world => !world.sceneRef).length,
      },
    },
  };
}
