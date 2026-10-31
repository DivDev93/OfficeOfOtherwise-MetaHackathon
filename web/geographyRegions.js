// Curated, deliberately coarse lon/lat masks. These are drawing guides, not
// reconstructions of past or future coastlines; model output never supplies geometry.
export const REGIONS = Object.freeze({
  'ram-setu': { label: 'Ram Setu / Palk Strait', bounds: [78.7, 8.7, 80.5, 10.5], polygons: [[[79.30,9.28],[79.39,9.25],[79.50,9.18],[79.62,9.12],[79.73,9.08],[79.79,9.04],[79.76,9.00],[79.65,9.04],[79.54,9.10],[79.43,9.17],[79.33,9.22]]] },
  sahara: { label: 'Sahara', bounds: [-18, 12, 36, 34], polygons: [[[-17,21],[-12,28],[-4,31],[8,31],[14,29],[25,31],[34,27],[32,18],[23,15],[11,14],[0,15],[-9,17]]], kindPolygons: { lake: [[[13.0,13.0],[13.1,16.1],[14.3,17.2],[16.2,16.8],[16.8,14.9],[15.5,13.3]],[[6.8,24.7],[7.2,26.4],[8.0,26.9],[8.8,25.8],[8.2,24.6]]] } },
  doggerland: { label: 'Doggerland / southern North Sea', bounds: [-3, 50, 10, 58], polygons: [[[0.5,52],[1,54],[0,55.5],[2,56.5],[5,56],[7,54.5],[6.5,53.4],[4,52.5],[2,51.5]]] },
  beringia: { label: 'Beringia', bounds: [160, 60, 200, 72], polygons: [[[170,66],[177,69],[-172,69],[-164,66],[-166,62],[-177,61],[174,62]]] },
  sundaland: { label: 'Sunda shelf', bounds: [98, -9, 120, 12], polygons: [[[101,7],[105,6],[109,8],[114,7],[117,2],[114,-4],[109,-6],[105,-6],[102,-2],[103,2]]] },
  'northern-europe-ice': { label: 'Northern Europe', bounds: [-10, 48, 44, 73], polygons: [[[-7,56],[-3,61],[7,70],[19,72],[31,69],[39,61],[31,55],[20,52],[9,53],[3,56]]] },
});
export const GEOGRAPHY_STYLES = Object.freeze({
  land: { label: 'Exposed / connected land', color: '#b2a16e' },
  vegetation: { label: 'Vegetation', color: '#2c9d52' },
  lake: { label: 'Inland water', color: '#348cc2' },
  ice: { label: 'Ice cover', color: '#e0f4fa' },
});
