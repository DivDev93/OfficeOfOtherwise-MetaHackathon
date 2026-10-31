import { REGIONS, GEOGRAPHY_STYLES } from './geographyRegions.js';

// Names are editorial labels for illustrative masks, not geographic measurements.
const CURATED_LABELS = Object.freeze({
  'ram-setu:land': 'Ram Setu / Palk Strait',
  'sahara:vegetation': 'Green Sahara',
  'sahara:lake': 'Sahara inland lakes',
  'sahara:land': 'Sahara land',
  'doggerland:land': 'Doggerland lowland',
  'beringia:land': 'Beringia land bridge',
  'sundaland:land': 'Sundaland lowland forest',
  'northern-europe-ice:ice': 'Northern Europe ice sheet',
});

const humanize = value => typeof value === 'string'
  ? value.replace(/([a-z])([A-Z])/g, '$1 $2').replace(/[_-]+/g, ' ').trim().replace(/\b\w/g, letter => letter.toUpperCase())
  : '';

/** Display label from curated v1 geography or read-only labels on future event objects. */
export function geographyLabel(value) {
  if (!value || typeof value !== 'object') return 'Unspecified geographic change';
  const region = typeof value.region === 'string' ? value.region : '';
  const kind = typeof value.kind === 'string' ? value.kind : '';
  const curated = CURATED_LABELS[`${region}:${kind}`];
  if (curated) return curated;

  // Future event records may carry presentation metadata; never require a schema or mutate it.
  const placeName = typeof value.place?.name === 'string' ? value.place.name.trim() : '';
  const label = [value.displayLabel, value.label, value.title, placeName].find(item => typeof item === 'string' && item.trim());
  if (label) return label.trim();
  if (region && REGIONS[region]) return REGIONS[region].label;
  return humanize(region || value.id) || 'Unspecified geographic change';
}

/** Optional technical provenance kept behind a Details disclosure in the UI. */
export function geographyTechnicalDetails(value) {
  if (!value || typeof value !== 'object') return {};
  const result = {};
  if (typeof value.id === 'string' && value.id.trim()) result.id = value.id;
  const bounds = value.bbox ?? value.bounds ?? value.place?.bbox ?? value.place?.bounds;
  if (Array.isArray(bounds) && bounds.length === 4 && bounds.every(Number.isFinite)) {
    result.bbox = bounds.map(number => Number(number.toFixed(4)));
  }
  return result;
}

export function geographyKindLabel(value) {
  return GEOGRAPHY_STYLES[value?.kind]?.label || humanize(value?.kind) || 'Geographic change';
}

/** Read-only, bounded legend metadata for future geography versions the atlas cannot render. */
export function geographyDisplayChanges(value) {
  if (!value || typeof value !== 'object' || !Array.isArray(value.changes) || value.changes.length > 32) return [];
  return value.changes.flatMap(change => {
    if (!change || typeof change !== 'object' || Array.isArray(change)
        || typeof change.id !== 'string' || change.id.length > 128
        || typeof change.kind !== 'string' || change.kind.length > 64
        || !Number.isFinite(change.intensity) || change.intensity < 0 || change.intensity > 1
        || typeof change.assumption !== 'string' || change.assumption.length > 1000
        || typeof change.uncertainty !== 'string' || change.uncertainty.length > 1000
        || !Array.isArray(change.bounds) || change.bounds.length !== 4 || !change.bounds.every(Number.isFinite)) return [];
    const [west, south, east, north] = change.bounds;
    if (west < -180 || west > 180 || east < -180 || east > 180 || south < -90 || south > 90 || north < -90 || north > 90 || west > east || south > north) return [];
    return [{ id:change.id, kind:change.kind, intensity:change.intensity, assumption:change.assumption, uncertainty:change.uncertainty, bounds:[west,south,east,north] }];
  });
}
