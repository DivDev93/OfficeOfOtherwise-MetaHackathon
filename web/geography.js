// Shared by the browser and planner. These are curated display masks, not
// inferred coastlines or a physical climate simulation.
export const GEOGRAPHY_REGIONS = Object.freeze(['ram-setu', 'sahara', 'doggerland', 'beringia', 'sundaland', 'northern-europe-ice']);
export const GEOGRAPHY_KINDS = Object.freeze(['land', 'vegetation', 'lake', 'ice']);
export const GEOGRAPHY_REGION_KINDS = Object.freeze({
  'ram-setu': Object.freeze(['land']), sahara: Object.freeze(['vegetation', 'lake']), doggerland: Object.freeze(['land']),
  beringia: Object.freeze(['land']), sundaland: Object.freeze(['land']), 'northern-europe-ice': Object.freeze(['ice']),
});
const CONTINENTS = Object.freeze(['africa', 'eurasia', 'north-america', 'south-america', 'australia', 'antarctica']);
const record = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const exactKeys = (value, keys) => Object.keys(value).every(key => keys.includes(key));
const invalid = detail => { throw new Error(`Invalid geography: ${detail}`); };
function text(value, field) {
  if (typeof value !== 'string' || !value.trim() || value.length > 500 || /[\u0000-\u001f\u007f]/.test(value)) invalid(field);
  return value.trim();
}

/** Full effective state. Omission inherits; an explicit state cannot drop ancestors. */
export function normalizeGeography(value, { inherited } = {}) {
  const previous = inherited === undefined ? undefined : normalizeGeography(inherited);
  if (value === undefined) return previous;
  if (value?.version === 2) return normalizeV2(value, previous);
  if (previous?.version === 2) invalid('cannot downgrade geography state');
  if (!record(value) || !exactKeys(value, ['version', 'changes']) || value.version !== 1 || !Array.isArray(value.changes) || value.changes.length > 12) invalid('state');
  return normalizeV1(value, previous);
}

function normalizeLegacyChange(change, ids) {
  if (!record(change) || !exactKeys(change, ['id', 'kind', 'region', 'intensity', 'assumption', 'uncertainty'])) invalid('change');
  if (typeof change.id !== 'string' || !/^[a-z][a-z0-9-]{0,63}$/.test(change.id) || ids.has(change.id)) invalid('change id');
  ids.add(change.id);
  if (!GEOGRAPHY_KINDS.includes(change.kind) || !GEOGRAPHY_REGIONS.includes(change.region)) invalid('unsupported kind or region');
  if (!GEOGRAPHY_REGION_KINDS[change.region].includes(change.kind)) invalid('unsupported kind for region');
  if (!Number.isFinite(change.intensity) || change.intensity < 0 || change.intensity > 1) invalid('intensity');
  return { id: change.id, kind: change.kind, region: change.region, intensity: change.intensity,
    assumption: text(change.assumption, 'assumption'), uncertainty: text(change.uncertainty, 'uncertainty') };
}

function normalizeV1(value, previous) {
  if (!record(value) || !exactKeys(value, ['version', 'changes']) || value.version !== 1 || !Array.isArray(value.changes) || value.changes.length > 12) invalid('state');
  const ids = new Set();
  const changes = value.changes.map(change => normalizeLegacyChange(change, ids));
  for (const ancestor of previous?.changes ?? []) {
    const change = changes.find(item => item.id === ancestor.id);
    if (!change || change.kind !== ancestor.kind || change.region !== ancestor.region
      || change.assumption !== ancestor.assumption || change.uncertainty !== ancestor.uncertainty
      || change.intensity < ancestor.intensity) invalid('inherited condition was dropped or contradicted');
  }
  return { version: 1, changes };
}

function normalizeV2Change(change, ids) {
  if (!record(change) || !GEOGRAPHY_KINDS.includes(change.kind) || !Number.isFinite(change.intensity) || change.intensity < 0 || change.intensity > 1) invalid('change');
  if (Object.hasOwn(change, 'region')) return normalizeLegacyChange(change, ids);
  const keys = ['id', 'bounds', 'kind', 'intensity', 'waterLevelMeters', 'elevationDeltaMeters', 'seed', 'assumption', 'uncertainty'];
  if (!exactKeys(change, keys)) invalid('change');
  if (change.id !== undefined) {
    if (typeof change.id !== 'string' || !/^[a-z][a-z0-9-]{0,63}$/.test(change.id) || ids.has(change.id)) invalid('change id');
    ids.add(change.id);
  }
  if (!Array.isArray(change.bounds) || change.bounds.length !== 4 || !change.bounds.every(Number.isFinite)) invalid('bounds');
  const [west, south, east, north] = change.bounds;
  if (west < -180 || west > 180 || east < -180 || east > 180 || west === east || south < -90 || south > 90 || north < -90 || north > 90 || south >= north) invalid('bounds');
  if (change.kind === 'lake') {
    if (change.waterLevelMeters !== undefined && (!Number.isFinite(change.waterLevelMeters) || change.waterLevelMeters < -11000 || change.waterLevelMeters > 9000)) invalid('water level');
    if (change.elevationDeltaMeters !== undefined) invalid('lake parameters');
  } else if (change.kind === 'land') {
    if (change.elevationDeltaMeters !== undefined && (!Number.isFinite(change.elevationDeltaMeters) || change.elevationDeltaMeters < -9000 || change.elevationDeltaMeters > 9000)) invalid('elevation delta');
    if (change.waterLevelMeters !== undefined || change.seed !== undefined) invalid('land parameters');
  } else if (change.waterLevelMeters !== undefined || change.elevationDeltaMeters !== undefined || change.seed !== undefined) invalid('overlay parameters');
  if (change.seed !== undefined) {
    if (!Array.isArray(change.seed) || change.seed.length !== 2 || !change.seed.every(Number.isFinite)
      || change.seed[0] < -180 || change.seed[0] > 180 || change.seed[1] < -90 || change.seed[1] > 90) invalid('lake seed');
    const [lon, lat] = change.seed;
    const inLongitude = west < east ? lon >= west && lon <= east : lon >= west || lon <= east;
    if (change.kind !== 'lake' || !inLongitude || lat < south || lat > north) invalid('lake seed outside bounds');
  }
  return { ...(change.id !== undefined ? { id: change.id } : {}), bounds: [...change.bounds], kind: change.kind, intensity: change.intensity,
    ...(change.waterLevelMeters !== undefined ? { waterLevelMeters: change.waterLevelMeters } : {}),
    ...(change.elevationDeltaMeters !== undefined ? { elevationDeltaMeters: change.elevationDeltaMeters } : {}),
    ...(change.seed !== undefined ? { seed: [...change.seed] } : {}),
    assumption: text(change.assumption, 'assumption'), uncertainty: text(change.uncertainty, 'uncertainty') };
}

function normalizeV2(value, previous) {
  if (!record(value) || !exactKeys(value, ['version', 'seaLevelMeters', 'continentalTransforms', 'changes', 'assumption', 'uncertainty'])
    || value.version !== 2 || !Number.isFinite(value.seaLevelMeters) || value.seaLevelMeters < -11000 || value.seaLevelMeters > 9000
    || !Array.isArray(value.continentalTransforms) || value.continentalTransforms.length > CONTINENTS.length
    || !Array.isArray(value.changes) || value.changes.length > 12) invalid('v2 state');
  const assumption = value.assumption === undefined ? undefined : text(value.assumption, 'global assumption');
  const uncertainty = value.uncertainty === undefined ? undefined : text(value.uncertainty, 'global uncertainty');
  if ((assumption === undefined) !== (uncertainty === undefined)) invalid('global assumption and uncertainty');
  const continentIds = new Set();
  const continentalTransforms = value.continentalTransforms.map(item => {
    if (!record(item) || !exactKeys(item, ['continentId', 'longitudeOffsetDeg', 'latitudeOffsetDeg', 'rotationDeg', 'assumption', 'uncertainty'])
      || !CONTINENTS.includes(item.continentId) || continentIds.has(item.continentId)) invalid('continental transform');
    continentIds.add(item.continentId);
    if (!Number.isFinite(item.longitudeOffsetDeg) || item.longitudeOffsetDeg < -180 || item.longitudeOffsetDeg > 180
      || !Number.isFinite(item.latitudeOffsetDeg) || item.latitudeOffsetDeg < -90 || item.latitudeOffsetDeg > 90
      || !Number.isFinite(item.rotationDeg) || item.rotationDeg < -180 || item.rotationDeg > 180) invalid('continental transform bounds');
    return { continentId:item.continentId, longitudeOffsetDeg:item.longitudeOffsetDeg, latitudeOffsetDeg:item.latitudeOffsetDeg,
      rotationDeg:item.rotationDeg, assumption:text(item.assumption, 'transform assumption'), uncertainty:text(item.uncertainty, 'transform uncertainty') };
  });
  const ids = new Set(), selectors = new Set();
  const changes = value.changes.map(change => {
    const normalized = normalizeV2Change(change, ids);
    const selector = normalized.id !== undefined ? `id:${normalized.id}` : `bounds:${normalized.kind}:${normalized.bounds.join(',')}`;
    if (selectors.has(selector)) invalid('duplicate change selector');
    selectors.add(selector); return normalized;
  });
  for (const ancestor of previous?.changes ?? []) {
    const change = changes.find(item => ancestor.id !== undefined ? item.id === ancestor.id
      : item.id === undefined && item.kind === ancestor.kind && JSON.stringify(item.bounds) === JSON.stringify(ancestor.bounds));
    if (!change || change.kind !== ancestor.kind || change.assumption !== ancestor.assumption || change.uncertainty !== ancestor.uncertainty
      || (ancestor.region !== undefined && change.region !== ancestor.region)
      || (ancestor.bounds !== undefined && JSON.stringify(change.bounds) !== JSON.stringify(ancestor.bounds))
      || change.intensity < ancestor.intensity) invalid('inherited condition was dropped or contradicted');
  }
  for (const ancestor of previous?.continentalTransforms ?? []) {
    const item = continentalTransforms.find(candidate => candidate.continentId === ancestor.continentId);
    if (!item || item.longitudeOffsetDeg !== ancestor.longitudeOffsetDeg || item.latitudeOffsetDeg !== ancestor.latitudeOffsetDeg
      || item.rotationDeg !== ancestor.rotationDeg || item.assumption !== ancestor.assumption || item.uncertainty !== ancestor.uncertainty) invalid('inherited continent transform was dropped or changed');
  }
  if (previous?.version === 2 && (value.seaLevelMeters !== previous.seaLevelMeters || assumption !== previous.assumption || uncertainty !== previous.uncertainty)) invalid('inherited global state was dropped or changed');
  return { version:2, seaLevelMeters:value.seaLevelMeters, continentalTransforms, changes,
    ...(assumption !== undefined ? { assumption } : {}), ...(uncertainty !== undefined ? { uncertainty } : {}) };
}

export function geographyText(value) {
  const state = normalizeGeography(value);
  if (!state) return '';
  const lines = state.changes.map(change => `${change.id ?? 'regional-overlay'}: ${change.kind} ${change.region ? `in ${change.region}` : `within [${change.bounds.join(', ')}]`}; display intensity ${change.intensity}; assumption: ${change.assumption}; uncertainty: ${change.uncertainty}`);
  if (state.version === 2) {
    lines.unshift(`Global sea level relative to present day: ${state.seaLevelMeters} m${state.assumption ? `; assumption: ${state.assumption}; uncertainty: ${state.uncertainty}` : ''}`);
    for (const item of state.continentalTransforms) lines.push(`${item.continentId}: coordinate transform offsets ${item.longitudeOffsetDeg}° longitude, ${item.latitudeOffsetDeg}° latitude, ${item.rotationDeg}° rotation; assumption: ${item.assumption}; uncertainty: ${item.uncertainty}`);
  }
  return lines.join('\n');
}

export function withGeographyPrompt(prompt, value) {
  const context = geographyText(value);
  if (!context) return prompt;
  const state = normalizeGeography(value);
  const heading = state.version === 1
    ? 'Scenario geography (illustrative regional masks, not measured terrain; preserve these hypothetical conditions):'
    : 'Scenario geography (saved hypothetical state; preserve these conditions and uncertainty; this text does not imply rendered terrain):';
  const suffix = `${heading}\n${context}`;
  return prompt.endsWith(suffix) ? prompt : `${prompt}\n\n${suffix}`;
}
