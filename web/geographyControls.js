import { GEOGRAPHY_CONTINENTS, normalizeGeography, upgradeGeographyV1ToV2 } from './geography.js';

export const WATER_LEVEL_MIN = -11000;
export const WATER_LEVEL_MAX = 9000;
export const CONTINENT_RANGES = Object.freeze({ longitudeOffsetDeg: [-180, 180], latitudeOffsetDeg: [-90, 90], rotationDeg: [-180, 180] });
const EMPTY_GEOGRAPHY = Object.freeze({ version: 2, seaLevelMeters: 0, continentalTransforms: [], changes: [] });
const assumption = 'Local illustrative what-if adjustment.';
const uncertainty = 'Display-only preview; not a physical reconstruction.';

export function geographyPreviewKey(runId, branchId) {
  return `${runId || 'current'}:${branchId || 'selected'}`;
}

function toV2(value) {
  if (value == null) return { ...EMPTY_GEOGRAPHY, continentalTransforms: [], changes: [] };
  const state = normalizeGeography(value);
  return state.version === 1 ? upgradeGeographyV1ToV2(state) : state;
}

export function controlsFromGeography(value) {
  const state = toV2(value);
  const transforms = Object.fromEntries(state.continentalTransforms.map(item => [item.continentId, {
    longitudeOffsetDeg: item.longitudeOffsetDeg,
    latitudeOffsetDeg: item.latitudeOffsetDeg,
    rotationDeg: item.rotationDeg,
  }]));
  return { seaLevelMeters: state.seaLevelMeters, continentId: GEOGRAPHY_CONTINENTS[0], transforms };
}

function clamp(value, [minimum, maximum]) {
  const number = Number(value);
  if (!Number.isFinite(number)) return 0;
  return Math.min(maximum, Math.max(minimum, number));
}

export function geographyFromControls(value, controls) {
  const state = toV2(value);
  const transforms = [];
  for (const continentId of GEOGRAPHY_CONTINENTS) {
    const current = controls.transforms?.[continentId] || {};
    const longitudeOffsetDeg = clamp(current.longitudeOffsetDeg, CONTINENT_RANGES.longitudeOffsetDeg);
    const latitudeOffsetDeg = clamp(current.latitudeOffsetDeg, CONTINENT_RANGES.latitudeOffsetDeg);
    const rotationDeg = clamp(current.rotationDeg, CONTINENT_RANGES.rotationDeg);
    if (longitudeOffsetDeg === 0 && latitudeOffsetDeg === 0 && rotationDeg === 0) continue;
    transforms.push({ continentId, longitudeOffsetDeg, latitudeOffsetDeg, rotationDeg, assumption, uncertainty });
  }
  const seaLevelMeters = clamp(controls.seaLevelMeters, [WATER_LEVEL_MIN, WATER_LEVEL_MAX]);
  const preview = {
    version: 2,
    seaLevelMeters,
    continentalTransforms: transforms,
    changes: state.changes.map(change => ({ ...change, ...(change.bounds ? { bounds: [...change.bounds] } : {}) })),
    ...(seaLevelMeters !== 0 ? { assumption: `Global water level set to ${seaLevelMeters} m for this local preview.`, uncertainty } : {}),
  };
  return normalizeGeography(preview);
}

export function presentDayGeography() {
  return { version: 2, seaLevelMeters: 0, continentalTransforms: [], changes: [] };
}

export function effectiveGeographyMode(requestedMode, hasScenario) {
  return hasScenario && requestedMode === 'scenario' ? 'scenario' : 'present';
}

export function geographyChangeLabel(change, regions = {}) {
  if (change.region) return regions[change.region]?.label || `Region ${change.region}`;
  if (change.bounds) return `${change.id || 'Custom area'} · ${change.bounds.map(value => Number(value).toFixed(1)).join(', ')}`;
  return change.id || 'Scenario area';
}

export function createGeographyPreviewStore() {
  const states = new Map();
  return {
    get(key, base) {
      if (!states.has(key)) states.set(key, controlsFromGeography(base));
      return states.get(key);
    },
    set(key, controls) { states.set(key, controls); },
    reset(key, base) { const controls = controlsFromGeography(base); states.set(key, controls); return controls; },
    clear() { states.clear(); },
  };
}
