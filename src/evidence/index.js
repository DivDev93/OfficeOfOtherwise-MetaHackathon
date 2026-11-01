import { createHash } from 'node:crypto';
import { isIP } from 'node:net';

const REQUIRED_RUN_IDS = ['alexandria', 'beringia', 'green-sahara', 'mechanisms'];
const BRANCH_TEXT_FIELDS = ['changedAssumption', 'uncertainty', 'demonstrates', 'doesNotEstablish', 'discussionQuestion'];

export function stableJson(value) {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(',')}]`;
  if (value && typeof value === 'object') {
    return `{${Object.keys(value).sort().map(key => `${JSON.stringify(key)}:${stableJson(value[key])}`).join(',')}}`;
  }
  return JSON.stringify(value);
}

export function branchDigest(savedBranch) {
  return createHash('sha256').update(stableJson(savedBranch)).digest('hex');
}

function branchIds(branch) {
  return Array.isArray(branch?.branches) ? branch.branches.map(item => item?.id) : [];
}

function nonemptyString(value) {
  return typeof value === 'string' && value.trim().length > 0;
}

function validDate(value) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(`${value}T00:00:00.000Z`);
  return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value;
}

function safeSourceUrl(value) {
  try {
    const url = new URL(value);
    const host = url.hostname.toLowerCase();
    return url.protocol === 'https:'
      && !url.username && !url.password && !url.search && !url.hash
      && host.includes('.') && !host.endsWith('.')
      && host !== 'localhost' && !host.endsWith('.localhost')
      && !host.endsWith('.local') && !host.endsWith('.internal')
      && isIP(host) === 0;
  } catch { return false; }
}

function validSourceId(value) {
  return typeof value === 'string' && /^[a-z][a-z0-9-]{0,47}$/.test(value);
}

/** Return curation only when the dataset and exact saved branch artifact both match. */
export function selectRunEvidence(dataset, runId, savedBranch) {
  try {
    if (typeof runId !== 'string' || !savedBranch) return null;
    if (!validateEvidence(dataset).valid) return null;
    const run = dataset.runs.find(item => item.runId === runId);
    if (!run || run.branchSha256 !== branchDigest(savedBranch) || run.divergence !== savedBranch.divergence) return null;
    const savedIds = branchIds(savedBranch);
    const curatedIds = run.branches.map(item => item.branchId);
    if (savedBranch.status !== 'ok' || savedIds.length !== curatedIds.length || new Set(savedIds).size !== savedIds.length) return null;
    if (savedIds.some((id, index) => id !== curatedIds[index])) return null;
    const sourceIds = new Set(run.branches.flatMap(branch => branch.baselineSourceIds));
    const sources = dataset.sources.filter(source => sourceIds.has(source.id));
    if (sourceIds.size !== sources.length) return null;
    return { schemaVersion: dataset.schemaVersion, authoredAt: dataset.authoredAt, method: dataset.method, sources, run };
  } catch { return null; }
}

/** Validate data shape and optionally compare it with the current saved artifacts. */
export function validateEvidence(dataset, { readRun } = {}) {
  const errors = [];
  const error = message => errors.push(message);
  if (!dataset || typeof dataset !== 'object' || Array.isArray(dataset) || dataset.schemaVersion !== 1) return { valid: false, errors: ['schemaVersion must be 1'] };
  if (!validDate(dataset.authoredAt)) error('authoredAt must be a real ISO date');
  const method = dataset.method;
  if (!method || typeof method !== 'object' || Array.isArray(method)
    || !nonemptyString(method.label) || !nonemptyString(method.scope) || !nonemptyString(method.scoreDisclaimer)) {
    error('method must identify the curation scope and score disclaimer');
  }
  if (!Array.isArray(dataset.sources) || !Array.isArray(dataset.runs)) return { valid: false, errors: [...errors, 'sources and runs must be arrays'] };

  const sourcesById = new Map();
  for (const source of dataset.sources) {
    if (!source || typeof source !== 'object' || Array.isArray(source)) { error('source entries must be objects'); continue; }
    const id = source.id;
    if (!validSourceId(id) || sourcesById.has(id)) error('source IDs must be unique safe identifiers');
    else sourcesById.set(id, source);
    if (!safeSourceUrl(source.url) || !nonemptyString(source.title) || !nonemptyString(source.publisher)
      || !validDate(source.checkedDate) || !['full_text', 'abstract', 'search_excerpt'].includes(source.verificationMethod)
      || !nonemptyString(source.baselineParaphrase)) {
      error(`source ${id ?? '(unknown)'} has invalid or unsafe metadata`);
    }
  }

  const runsById = new Map();
  for (const run of dataset.runs) {
    if (!run || typeof run !== 'object' || Array.isArray(run)) { error('run entries must be objects'); continue; }
    const id = run.runId;
    if (!nonemptyString(id) || runsById.has(id)) error('run IDs must be unique nonempty strings');
    else runsById.set(id, run);
    if (!/^[a-f\d]{64}$/.test(run.branchSha256 ?? '') || !nonemptyString(run.divergence)
      || !Array.isArray(run.branches) || !run.branches.length) error(`run ${id ?? '(unknown)'} lacks branch identity data`);
    const branchIdSet = new Set();
    for (const branch of Array.isArray(run.branches) ? run.branches : []) {
      if (!branch || typeof branch !== 'object' || Array.isArray(branch)) { error(`run ${id ?? '(unknown)'} has a malformed branch record`); continue; }
      if (!nonemptyString(branch.branchId) || branchIdSet.has(branch.branchId)) error(`run ${id ?? '(unknown)'} has duplicate or invalid branch IDs`);
      else branchIdSet.add(branch.branchId);
      if (!nonemptyString(branch.title) || !Array.isArray(branch.baselineSourceIds) || !branch.baselineSourceIds.length
        || new Set(branch.baselineSourceIds).size !== branch.baselineSourceIds.length
        || branch.baselineSourceIds.some(sourceId => !sourcesById.has(sourceId))) {
        error(`${id ?? '(unknown)'}/${branch.branchId ?? '(unknown)'} has invalid baseline source links`);
      }
      for (const field of BRANCH_TEXT_FIELDS) if (!nonemptyString(branch[field])) error(`${id ?? '(unknown)'}/${branch.branchId ?? '(unknown)'} requires ${field}`);
      if (!Array.isArray(branch.unverifiedClaims) || !branch.unverifiedClaims.length || branch.unverifiedClaims.some(claim => !nonemptyString(claim))) {
        error(`${id ?? '(unknown)'}/${branch.branchId ?? '(unknown)'} requires explicit unverified claims`);
      }
      if (!Array.isArray(branch.causalSteps) || branch.causalSteps.length < 2 || branch.causalSteps.some(step => !nonemptyString(step))) {
        error(`${id ?? '(unknown)'}/${branch.branchId ?? '(unknown)'} requires at least two causal steps`);
      }
    }
  }
  if (dataset.runs.length !== REQUIRED_RUN_IDS.length || REQUIRED_RUN_IDS.some(id => !runsById.has(id))) error('evidence must cover exactly the four curated saved runs');

  if (typeof readRun === 'function') {
    for (const runId of REQUIRED_RUN_IDS) {
      let saved;
      try { saved = readRun(runId); } catch { error(`could not read saved run ${runId}`); continue; }
      if (!saved) { error(`missing saved run ${runId}`); continue; }
      const curated = runsById.get(runId);
      if (!curated) { error(`missing evidence for saved run ${runId}`); continue; }
      try {
        if (curated.branchSha256 !== branchDigest(saved) || curated.divergence !== saved.divergence) error(`${runId} evidence is stale for the saved branch artifact`);
      } catch { error(`${runId} saved branch artifact is malformed`); continue; }
      const actualIds = branchIds(saved), expectedIds = Array.isArray(curated.branches) ? curated.branches.map(branch => branch?.branchId) : [];
      if (saved.status !== 'ok' || actualIds.length !== expectedIds.length || actualIds.some((id, index) => id !== expectedIds[index])) error(`${runId} evidence does not cover the exact saved branches`);
      for (const record of Array.isArray(curated.branches) ? curated.branches : []) {
        const actual = saved.branches?.find(branch => branch?.id === record?.branchId);
        if (!actual || actual.title !== record?.title) error(`${runId}/${record?.branchId ?? '(unknown)'} title does not match saved branch`);
      }
    }
  }
  return { valid: errors.length === 0, errors };
}
