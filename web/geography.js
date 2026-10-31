// Shared by the browser and planner. These are curated display masks, not
// inferred coastlines or a physical climate simulation.
export const GEOGRAPHY_REGIONS = Object.freeze(['ram-setu', 'sahara', 'doggerland', 'beringia', 'sundaland', 'northern-europe-ice']);
export const GEOGRAPHY_KINDS = Object.freeze(['land', 'vegetation', 'lake', 'ice']);
export const GEOGRAPHY_REGION_KINDS = Object.freeze({
  'ram-setu': Object.freeze(['land']), sahara: Object.freeze(['vegetation', 'lake']), doggerland: Object.freeze(['land']),
  beringia: Object.freeze(['land']), sundaland: Object.freeze(['land']), 'northern-europe-ice': Object.freeze(['ice']),
});
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
  if (!record(value) || !exactKeys(value, ['version', 'changes']) || value.version !== 1 || !Array.isArray(value.changes) || value.changes.length > 12) invalid('state');
  const ids = new Set();
  const changes = value.changes.map(change => {
    if (!record(change) || !exactKeys(change, ['id', 'kind', 'region', 'intensity', 'assumption', 'uncertainty'])) invalid('change');
    if (typeof change.id !== 'string' || !/^[a-z][a-z0-9-]{0,63}$/.test(change.id) || ids.has(change.id)) invalid('change id');
    ids.add(change.id);
    if (!GEOGRAPHY_KINDS.includes(change.kind) || !GEOGRAPHY_REGIONS.includes(change.region)) invalid('unsupported kind or region');
    if (!GEOGRAPHY_REGION_KINDS[change.region].includes(change.kind)) invalid('unsupported kind for region');
    if (!Number.isFinite(change.intensity) || change.intensity < 0 || change.intensity > 1) invalid('intensity');
    return { id: change.id, kind: change.kind, region: change.region, intensity: change.intensity,
      assumption: text(change.assumption, 'assumption'), uncertainty: text(change.uncertainty, 'uncertainty') };
  });
  for (const ancestor of previous?.changes ?? []) {
    const change = changes.find(item => item.id === ancestor.id);
    if (!change || change.kind !== ancestor.kind || change.region !== ancestor.region
      || change.assumption !== ancestor.assumption || change.uncertainty !== ancestor.uncertainty
      || change.intensity < ancestor.intensity) invalid('inherited condition was dropped or contradicted');
  }
  return { version: 1, changes };
}

export function geographyText(value) {
  const state = normalizeGeography(value);
  return (state?.changes ?? []).map(change => `${change.id}: ${change.kind} in ${change.region}; display intensity ${change.intensity}; assumption: ${change.assumption}; uncertainty: ${change.uncertainty}`).join('\n');
}

export function withGeographyPrompt(prompt, value) {
  const context = geographyText(value);
  if (!context) return prompt;
  const suffix = `Scenario geography (illustrative regional masks, not measured terrain; preserve these hypothetical conditions):\n${context}`;
  return prompt.endsWith(suffix) ? prompt : `${prompt}\n\n${suffix}`;
}
