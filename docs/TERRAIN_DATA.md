# Terrain data

The shared terrain assets provide numeric elevation and stable landmass ownership grids for illustrative geography changes. They are source data for browser rendering, not a coastal inundation or hydrology model.

## Bundled assets

| File | Grid | Bounds | Values |
|---|---:|---|---|
| `web/assets/terrain/elevation-global-5min.i16.gz` | 4320 × 2160, 5 arc-minutes | `[-180, -90, 180, 90]` | Signed little-endian int16 meters; each cell is the rounded mean of its valid 5 × 5 NOAA one-minute cells. |
| `web/assets/terrain/elevation-sahara-1min.i16.gz` | 3240 × 1320, 1 arc-minute | `[-18, 12, 36, 34]` | Signed little-endian int16 meters; NOAA one-minute values rounded to meters. |
| `web/assets/terrain/landmass-global-5min.u8.gz` | 4320 × 2160, 5 arc-minutes | `[-180, -90, 180, 90]` | Unsigned byte ownership IDs: 0 ocean/unassigned; 1 Africa; 2 Eurasia; 3 North America; 4 South America; 5 Australia/Oceania; 6 Antarctica. |

All rasters use WGS84 longitude/latitude (EPSG:4326), pixel-center registration, north-to-south row order, west-to-east columns, and longitude wrapping at ±180°. Elevation `-32768` is nodata; no elevation is fabricated. The landmass layer is an ownership mask for transformations, not a dry-land mask. Interior lake cells are assigned to their surrounding or nearest landmass so they can move with it; the elevation layer independently determines terrain and water-level thresholds. IDs identify broad geographic landmasses, not political borders or tectonic plates. `terrain-metadata.json` records dimensions, encodings, bounds, checksums, vertical reference, IDs, and computed area-weighted spherical centroids for transforms.

ETOPO 2022 elevations are meters relative to the EGM2008 geoid (EPSG:3855). EGM2008 approximates mean sea level for most uses, but some source areas in shallow water can use different vertical datums. The 5 arc-minute global grid is suitable for broad illustrative sea-level thresholds, not detailed shoreline predictions. It does not model drainage, barriers, tides, local datum differences, or basin hydrology. The 1 arc-minute Sahara crop can support coarse terrain contours, not a Lake Chad reconstruction.

## Rebuilding

The NOAA source file is intentionally not bundled. It is a 466 MB download; keep it outside the repository. The script processes it into a temporary 933 MB float32 memory map and removes that file when complete. Required Python packages are `numpy`, `tifffile`, `imagecodecs`, `pyshp`, `Pillow`, and `scipy`.

```powershell
python -m pip install numpy tifffile imagecodecs pyshp Pillow scipy
curl.exe --fail --location --output ETOPO_2022_v1_60s_N90W180_surface.tif https://www.ngdc.noaa.gov/mgg/global/relief/ETOPO2022/data/60s/60s_surface_elev_gtif/ETOPO_2022_v1_60s_N90W180_surface.tif
curl.exe --fail --location --output ne_10m_admin_0_countries.zip https://naciscdn.org/naturalearth/10m/cultural/ne_10m_admin_0_countries.zip
curl.exe --fail --location --output ne_10m_lakes.zip https://naciscdn.org/naturalearth/10m/physical/ne_10m_lakes.zip
python scripts/build-terrain-data.py --etopo ETOPO_2022_v1_60s_N90W180_surface.tif --countries ne_10m_admin_0_countries.zip --lakes ne_10m_lakes.zip --output web/assets/terrain
```

The script checks source raster dimensions, CRS, grid spacing, vertical key, and nodata value before processing. It emits deterministic gzip files (gzip timestamp zero) and source/output SHA-256 values. Natural Earth Admin 0 continent attributes and lake polygons are read only while producing the landmass-ID raster; country data and attributes are not copied into the app.

## Sources and terms

- NOAA National Centers for Environmental Information, [ETOPO 2022 Global Relief Model](https://www.ncei.noaa.gov/products/etopo-global-relief-model), DOI [10.25921/fd45-gt74](https://doi.org/10.25921/fd45-gt74). NOAA's [user guide](https://www.ngdc.noaa.gov/mgg/global/relief/ETOPO2022/docs/1.2%20ETOPO%202022%20User%20Guide.pdf) documents EPSG:4326 horizontal coordinates, meter values relative to EGM2008/EPSG:3855, and `-99999` source nodata. NOAA's [dataset metadata](https://www.ncei.noaa.gov/access/metadata/landing-page/bin/iso?id=gov.noaa.ngdc.mgg.dem%3Aetopo_2022) dedicates the data to the public domain under CC0 1.0.
- [Natural Earth 1:10m Admin 0 Countries](https://www.naturalearthdata.com/downloads/10m-cultural-vectors/) v5.1.1 and [Lakes + Reservoirs](https://www.naturalearthdata.com/downloads/10m-physical-vectors/) v5.0.0. Natural Earth states its raster and vector data are public domain in its [terms of use](https://www.naturalearthdata.com/about/terms-of-use/).
