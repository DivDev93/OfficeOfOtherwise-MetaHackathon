#!/usr/bin/env python3
"""Build compact, reproducible terrain grids from NOAA ETOPO 2022 and Natural Earth.

Inputs are deliberately explicit because the NOAA source is a 466 MB download.
Only the derived height and landmass-ID rasters are written to the public assets
directory; the Natural Earth country attributes are used only during generation.

Dependencies: numpy, tifffile, imagecodecs, pyshp, Pillow, scipy.
"""

from __future__ import annotations

import argparse
import gzip
import hashlib
import json
import math
import shutil
import tempfile
from pathlib import Path

import numpy as np
import shapefile
import tifffile
from PIL import Image, ImageDraw
from scipy import ndimage


SOURCE_SHAPE = (10800, 21600)  # 60 arc-seconds, 180 x 360 degrees
GLOBAL_SHAPE = (2160, 4320)  # 5 arc-minutes
NODATA_SOURCE = -99999.0
NODATA_OUTPUT = -32768
NOAA_URL = (
    "https://www.ngdc.noaa.gov/mgg/global/relief/ETOPO2022/data/60s/"
    "60s_surface_elev_gtif/ETOPO_2022_v1_60s_N90W180_surface.tif"
)
COUNTRIES_URL = "https://naciscdn.org/naturalearth/10m/cultural/ne_10m_admin_0_countries.zip"
LAKES_URL = "https://naciscdn.org/naturalearth/10m/physical/ne_10m_lakes.zip"

LANDMASSES = {
    "AFRICA": 1,
    "EURASIA": 2,
    "N_AMERICA": 3,
    "S_AMERICA": 4,
    "AUSTRALIA": 5,
    "ANTARCTICA": 6,
}
CONTINENT_TO_ID = {
    "Africa": LANDMASSES["AFRICA"],
    "Asia": LANDMASSES["EURASIA"],
    "Europe": LANDMASSES["EURASIA"],
    "North America": LANDMASSES["N_AMERICA"],
    "South America": LANDMASSES["S_AMERICA"],
    "Oceania": LANDMASSES["AUSTRALIA"],
    "Antarctica": LANDMASSES["ANTARCTICA"],
}
# Natural Earth labels these remote islands "Seven seas (open ocean)". Assign
# them to their nearby named landmass; no country-level field is exported.
SEVEN_SEAS_ISLANDS = {
    "Fr. S. Antarctic Lands": "ANTARCTICA",
    "Seychelles": "AFRICA",
    "Heard I. and McDonald Is.": "ANTARCTICA",
    "Saint Helena": "AFRICA",
    "Mauritius": "AFRICA",
    "Br. Indian Ocean Ter.": "AFRICA",
    "Maldives": "EURASIA",
    "S. Geo. and the Is.": "S_AMERICA",
    "Clipperton I.": "N_AMERICA",
}


def sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as stream:
        for chunk in iter(lambda: stream.read(4 * 1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def write_gzip_array(array: np.ndarray, path: Path, *, level: int = 9) -> dict:
    """Write C-order, gzip-compressed, deterministic bytes and report hashes."""
    raw = np.ascontiguousarray(array)
    digest = hashlib.sha256()
    with path.open("wb") as output:
        with gzip.GzipFile(fileobj=output, mode="wb", filename="", mtime=0, compresslevel=level) as compressed:
            view = memoryview(raw).cast("B")
            for offset in range(0, len(view), 4 * 1024 * 1024):
                part = view[offset : offset + 4 * 1024 * 1024]
                digest.update(part)
                compressed.write(part)
    return {
        "file": f"/assets/terrain/{path.name}",
        "compressedBytes": path.stat().st_size,
        "compressedSha256": sha256(path),
        "uncompressedBytes": raw.nbytes,
        "uncompressedSha256": digest.hexdigest(),
    }


def ring_to_pixels(ring, width: int, height: int):
    # Coordinates are WGS84 lon/lat on cell edges; Pillow rasterizes the ring.
    points = []
    for lon, lat in ring:
        x = min(width, max(0, round((lon + 180.0) * width / 360.0)))
        y = min(height, max(0, round((90.0 - lat) * height / 180.0)))
        points.append((x, y))
    return points


def draw_geometry(draw: ImageDraw.ImageDraw, geometry, value: int, width: int, height: int):
    geometry_type = geometry["type"]
    coordinates = geometry["coordinates"]
    polygons = coordinates if geometry_type == "MultiPolygon" else [coordinates]
    for polygon in polygons:
        if not polygon:
            continue
        draw.polygon(ring_to_pixels(polygon[0], width, height), fill=value)
        for hole in polygon[1:]:
            draw.polygon(ring_to_pixels(hole, width, height), fill=0)


def fill_inland_water_holes(land: np.ndarray) -> np.ndarray:
    """Assign closed water holes to their surrounding landmass, keeping ocean 0."""
    water_labels, component_count = ndimage.label(land == 0, structure=np.array([[0, 1, 0], [1, 1, 1], [0, 1, 0]], dtype=np.uint8))
    border_labels = np.unique(np.concatenate((water_labels[0, :], water_labels[-1, :], water_labels[:, 0], water_labels[:, -1])))
    exterior = np.zeros(component_count + 1, dtype=bool)
    exterior[border_labels] = True

    # Count landmass IDs bordering each water component. The mode is the
    # deterministic owner for interior lake basins and rasterized polygon holes.
    bins = (component_count + 1) * (len(LANDMASSES) + 1)
    counts = np.zeros(bins, dtype=np.uint32)
    for labels, neighbors in (
        (water_labels[:, 1:], land[:, :-1]),
        (water_labels[:, :-1], land[:, 1:]),
        (water_labels[1:, :], land[:-1, :]),
        (water_labels[:-1, :], land[1:, :]),
    ):
        boundary = (labels > 0) & (neighbors > 0)
        keys = labels[boundary].astype(np.int64) * (len(LANDMASSES) + 1) + neighbors[boundary]
        counts += np.bincount(keys, minlength=bins).astype(np.uint32)
    counts = counts.reshape(component_count + 1, len(LANDMASSES) + 1)
    owner = np.argmax(counts, axis=1).astype(np.uint8)
    owner[counts.max(axis=1) == 0] = 0

    holes = (water_labels > 0) & ~exterior[water_labels]
    land[holes] = owner[water_labels[holes]]
    return land


def build_landmass_mask(countries_zip: Path, lakes_zip: Path) -> tuple[np.ndarray, dict]:
    width, height = GLOBAL_SHAPE[1], GLOBAL_SHAPE[0]
    image = Image.new("L", (width, height), 0)
    draw = ImageDraw.Draw(image)
    countries = shapefile.Reader(str(countries_zip), encoding="utf-8")
    fields = [field[0] for field in countries.fields[1:]]
    continent_index = fields.index("CONTINENT")
    name_index = fields.index("NAME")
    assigned = set()
    for shape, record in zip(countries.shapes(), countries.records()):
        continent = record[continent_index]
        name = record[name_index]
        if continent == "Seven seas (open ocean)":
            code = LANDMASSES[SEVEN_SEAS_ISLANDS[name]]
        else:
            code = CONTINENT_TO_ID.get(continent, 0)
        if code:
            assigned.add(code)
            draw_geometry(draw, shape.__geo_interface__, code, width, height)
    if assigned != set(LANDMASSES.values()):
        raise ValueError(f"Natural Earth continent grouping is incomplete: {assigned}")

    land = np.asarray(image, dtype=np.uint8).copy()
    land = fill_inland_water_holes(land)

    # Natural Earth lakes mark inland water basins that may connect to the sea
    # in this coarse grid. Give those pixels ownership from their nearest land.
    lake_image = Image.new("L", (width, height), 0)
    lake_draw = ImageDraw.Draw(lake_image)
    lakes = shapefile.Reader(str(lakes_zip), encoding="utf-8")
    for shape in lakes.shapes():
        draw_geometry(lake_draw, shape.__geo_interface__, 255, width, height)
    lake_mask = np.asarray(lake_image, dtype=np.uint8) > 0
    if np.any(lake_mask):
        nearest_indices = ndimage.distance_transform_edt(land == 0, return_distances=False, return_indices=True)
        nearest_owner = land[nearest_indices[0], nearest_indices[1]]
        land[lake_mask] = nearest_owner[lake_mask]

    # Any remaining interior water pixels outside the Natural Earth lake layer
    # still inherit the adjacent landmass from their closed-hole component.
    # Ocean-connected cells remain 0, regardless of elevation.
    counts = np.bincount(land.ravel(), minlength=len(LANDMASSES) + 1)
    if any(counts[code] == 0 for code in LANDMASSES.values()):
        raise ValueError(f"Output landmass raster lacks a landmass: {counts.tolist()}")
    return land, {
        "idLegend": {str(code): name for name, code in LANDMASSES.items()},
        "pixelCountsIncludingInteriorWater": {str(i): int(count) for i, count in enumerate(counts)},
        "sourceDataUsedOnlyForGeneration": "Natural Earth Admin 0 CONTINENT attribute plus lake polygon geometry; no country-level features or attributes are shipped.",
    }


def centroids(land: np.ndarray) -> dict:
    height, width = land.shape
    lon = np.deg2rad(-180.0 + (np.arange(width) + 0.5) * (360.0 / width))
    cos_lon, sin_lon = np.cos(lon), np.sin(lon)
    sums = {code: np.zeros(3, dtype=np.float64) for code in LANDMASSES.values()}
    for row in range(height):
        lat = math.radians(90.0 - (row + 0.5) * (180.0 / height))
        lat_cos, lat_sin = math.cos(lat), math.sin(lat)
        values = land[row]
        for code in sums:
            selected = values == code
            if selected.any():
                sums[code][0] += float(cos_lon[selected].sum()) * lat_cos
                sums[code][1] += float(sin_lon[selected].sum()) * lat_cos
                sums[code][2] += int(selected.sum()) * lat_cos * lat_sin
    result = {}
    for name, code in LANDMASSES.items():
        x, y, z = sums[code]
        horizontal = math.hypot(x, y)
        lon_deg = 0.0 if horizontal < abs(z) * 1e-6 else math.degrees(math.atan2(y, x))
        lat_deg = math.degrees(math.atan2(z, math.hypot(x, y)))
        result[name] = {"longitude": round(lon_deg, 5), "latitude": round(lat_deg, 5), "method": "area-weighted spherical centroid of owned cells, including interior water"}
    return result


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--etopo", required=True, type=Path, help="NOAA ETOPO 2022 60s global surface GeoTIFF")
    parser.add_argument("--countries", required=True, type=Path, help="Natural Earth 10m Admin 0 countries ZIP")
    parser.add_argument("--lakes", required=True, type=Path, help="Natural Earth 10m lakes ZIP")
    parser.add_argument("--output", type=Path, default=Path("web/assets/terrain"))
    parser.add_argument("--temp-dir", type=Path, help="Directory for a temporary ~933 MB float32 memory map")
    args = parser.parse_args()
    out_dir = args.output.resolve()
    out_dir.mkdir(parents=True, exist_ok=True)

    tif = tifffile.TiffFile(args.etopo)
    page = tif.pages[0]
    if tuple(page.shape) != SOURCE_SHAPE or page.dtype != np.dtype("float32"):
        raise ValueError(f"Unexpected ETOPO raster {page.shape} {page.dtype}; expected {SOURCE_SHAPE} float32")
    pixel_scale = page.tags[33550].value
    tiepoint = page.tags[33922].value
    geokeys = page.tags[34735].value
    if pixel_scale[:2] != (1 / 60, 1 / 60) or tiepoint[3:5] != (-180.0, 90.0) or 4326 not in geokeys or 3855 not in geokeys:
        raise ValueError("ETOPO GeoTIFF CRS/grid differs from expected WGS84/EPSG:4326 and EGM2008/EPSG:3855")
    if float(page.tags[42113].value) != NODATA_SOURCE:
        raise ValueError("ETOPO nodata sentinel changed")

    temp_root = args.temp_dir or Path(tempfile.gettempdir())
    temp_root.mkdir(parents=True, exist_ok=True)
    required = math.prod(SOURCE_SHAPE) * np.dtype("float32").itemsize
    if shutil.disk_usage(temp_root).free < required * 1.1:
        raise OSError(f"Insufficient free disk for temporary {required}-byte ETOPO memory map")
    temp_path = temp_root / "etopo-2022-60s-float32-memmap.tmp"
    if temp_path.exists():
        raise FileExistsError(f"Refusing to overwrite existing temporary memmap: {temp_path}")

    metadata = {
        "version": 1,
        "gridConvention": "WGS84 longitude/latitude, pixel centers, row-major north-to-south, columns west-to-east, longitude wraps at +/-180 degrees.",
        "verticalReference": "Meters relative to EGM2008 geoid (EPSG:3855); EGM2008 is an approximate mean-sea-level reference, and some shallow-water source areas may use different vertical datums.",
        "nodata": NODATA_OUTPUT,
        "encoding": "Gzip-compressed C-order binary; int16 is signed little-endian, u8 is unsigned; gzip header mtime is fixed to zero.",
        "sources": {
            "etopo2022": {
                "title": "NOAA National Centers for Environmental Information, ETOPO 2022 60 Arc-Second Global Relief Model, ice-surface elevation",
                "url": NOAA_URL,
                "citation": "NOAA National Centers for Environmental Information. 2022. ETOPO 2022 15 Arc-Second Global Relief Model. https://doi.org/10.25921/fd45-gt74 (60 arc-second supplied global extract).",
                "license": "CC0 1.0 Public Domain Dedication (NOAA metadata).",
                "sha256": sha256(args.etopo),
            },
            "naturalEarthAdmin0": {
                "title": "Natural Earth 1:10m Admin 0 Countries, v5.1.1",
                "url": COUNTRIES_URL,
                "license": "Public domain; attribution optional.",
                "sha256": sha256(args.countries),
            },
            "naturalEarthLakes": {
                "title": "Natural Earth 1:10m Lakes, v5.0.0",
                "url": LAKES_URL,
                "license": "Public domain; attribution optional.",
                "sha256": sha256(args.lakes),
            },
        },
    }
    source = None
    try:
        source = np.memmap(temp_path, mode="w+", dtype=np.float32, shape=SOURCE_SHAPE)
        print(f"Decoding NOAA TIFF into temporary memory map: {required:,} bytes", flush=True)
        page.asarray(out=source, squeeze=True, maxworkers=4, buffersize=64 * 1024 * 1024)
        source.flush()

        global_height = np.full(GLOBAL_SHAPE, NODATA_OUTPUT, dtype="<i2")
        height, width = GLOBAL_SHAPE
        source_nodata = NODATA_SOURCE
        for y0 in range(0, height, 64):
            y1 = min(height, y0 + 64)
            chunk = source[y0 * 5 : y1 * 5, :]
            shaped = chunk.reshape(y1 - y0, 5, width, 5)
            valid = shaped != source_nodata
            counts = valid.sum(axis=(1, 3), dtype=np.uint8)
            sums = np.where(valid, shaped, 0.0).sum(axis=(1, 3), dtype=np.float64)
            means = np.rint(sums / np.maximum(counts, 1)).clip(-32767, 32767).astype("<i2")
            means[counts == 0] = NODATA_OUTPUT
            global_height[y0:y1, :] = means
            print(f"Resampled global rows {y1}/{height}", flush=True)

        global_info = write_gzip_array(global_height, out_dir / "elevation-global-5min.i16.gz")
        # Source origin is the north-west outer edge (-180, 90); integer
        # degree bounds therefore map exactly to 1-minute pixel edges.
        x0 = int((-18.0 + 180.0) * 60)
        x1 = int((36.0 + 180.0) * 60)
        y0 = int((90.0 - 34.0) * 60)
        y1 = int((90.0 - 12.0) * 60)
        sahara = np.asarray(source[y0:y1, x0:x1], dtype=np.float32)
        sahara_out = np.where(sahara == source_nodata, NODATA_OUTPUT, np.rint(sahara).clip(-32767, 32767)).astype("<i2")
        sahara_info = write_gzip_array(sahara_out, out_dir / "elevation-sahara-1min.i16.gz")
        del sahara, sahara_out, global_height
        source.flush()
        source._mmap.close()
        source = None
        tif.close()
        temp_path.unlink()

        print("Building continent and interior-lake ownership mask", flush=True)
        land, land_info = build_landmass_mask(args.countries, args.lakes)
        land_info["centroids"] = centroids(land)
        land_info["ownershipSemantics"] = "Landmass ownership for transformations, not a dry-land mask. Interior lake pixels receive their surrounding/nearest landmass; height data determines elevation and water level. IDs do not represent political borders or tectonic plates."
        land_info["transformIds"] = LANDMASSES
        land_info["globalGrid"] = {"width": GLOBAL_SHAPE[1], "height": GLOBAL_SHAPE[0], "cellSizeDegrees": 5 / 60, "bounds": [-180, -90, 180, 90], "registration": "pixel-center"}
        land_info["fileInfo"] = write_gzip_array(land, out_dir / "landmass-global-5min.u8.gz")
        metadata["datasets"] = {
            "globalElevation": {
                **global_info,
                "width": 4320,
                "height": 2160,
                "cellSizeDegrees": 5 / 60,
                "bounds": [-180, -90, 180, 90],
                "encoding": "gzip + signed int16 little-endian meters; value is rounded arithmetic mean of valid 5x5 NOAA one-minute cells.",
                "registration": "pixel-center",
                "resolutionLimit": "Illustrative global sea-level threshold layer; 5 arc-minute aggregation is not a hydrological reconstruction and does not model barriers, drainage, tides, or local datum differences.",
            },
            "saharaElevation": {
                **sahara_info,
                "width": 3240,
                "height": 1320,
                "cellSizeDegrees": 1 / 60,
                "bounds": [-18, 12, 36, 34],
                "encoding": "gzip + signed int16 little-endian meters; NOAA one-minute values rounded to nearest meter.",
                "registration": "pixel-center",
                "resolutionLimit": "Coarse global-relief source; contours are illustrative, not a basin hydrology or lake reconstruction.",
            },
            "landmassIds": {
                **land_info["fileInfo"],
                "width": 4320,
                "height": 2160,
                "bounds": [-180, -90, 180, 90],
                "cellSizeDegrees": 5 / 60,
                "encoding": "gzip + unsigned byte IDs; 0 ocean/unknown, 1-6 per idLegend.",
                "registration": "pixel-center",
                "idLegend": land_info["idLegend"],
                "centroids": land_info["centroids"],
                "ownershipSemantics": land_info["ownershipSemantics"],
                "sourceDataUsedOnlyForGeneration": land_info["sourceDataUsedOnlyForGeneration"],
                "pixelCountsIncludingInteriorWater": land_info["pixelCountsIncludingInteriorWater"],
            },
        }
        metadata_path = out_dir / "terrain-metadata.json"
        metadata_path.write_text(json.dumps(metadata, indent=2, sort_keys=True) + "\n", encoding="utf-8")
        print(f"Wrote terrain data and metadata to {out_dir}", flush=True)
    finally:
        if source is not None:
            source._mmap.close()
        tif.close()
        if temp_path.exists():
            temp_path.unlink()


if __name__ == "__main__":
    main()
