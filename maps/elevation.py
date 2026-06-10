from __future__ import annotations

import math
from dataclasses import dataclass
from functools import lru_cache
from pathlib import Path

import tifffile


BASE_DIR = Path(__file__).resolve().parent.parent
COPERNICUS_DEM_DIR = BASE_DIR / "data" / "elevation" / "raw" / "copernicus-glo30"
NO_DATA_THRESHOLD = -1000


@dataclass(slots=True)
class ElevationPoint:
    elevation_m: float
    source: str


@dataclass(slots=True)
class RouteElevationSummary:
    ascent_meters: float
    descent_meters: float
    min_elevation_m: float | None
    max_elevation_m: float | None
    sampled_points: int
    source: str


@dataclass(slots=True)
class DemTile:
    data: object
    west: float
    south: float
    east: float
    north: float
    width: int
    height: int
    source: str


def _tile_name(tile_lat: int, tile_lon: int) -> str:
    lat_prefix = "N" if tile_lat >= 0 else "S"
    lon_prefix = "E" if tile_lon >= 0 else "W"
    return f"Copernicus_DSM_COG_10_{lat_prefix}{abs(tile_lat):02d}_00_{lon_prefix}{abs(tile_lon):03d}_00_DEM"


def _tile_path(tile_lat: int, tile_lon: int) -> Path:
    return COPERNICUS_DEM_DIR / f"{_tile_name(tile_lat, tile_lon)}.tif"


@lru_cache(maxsize=8)
def _load_dem_tile(tile_lat: int, tile_lon: int) -> DemTile | None:
    path = _tile_path(tile_lat, tile_lon)
    if not path.exists():
        return None

    data = tifffile.imread(path)
    if getattr(data, "ndim", 2) == 3:
        if data.shape[0] == 1:
            data = data[0]
        else:
            data = data[:, :, 0]

    height, width = data.shape
    return DemTile(
        data=data,
        west=float(tile_lon),
        south=float(tile_lat),
        east=float(tile_lon + 1),
        north=float(tile_lat + 1),
        width=width,
        height=height,
        source="copernicus-glo30",
    )


def sample_elevation(lon: float, lat: float) -> ElevationPoint | None:
    tile_lon = math.floor(lon)
    tile_lat = math.floor(lat)
    tile = _load_dem_tile(tile_lat, tile_lon)
    if tile is None:
        return None

    x_ratio = (lon - tile.west) / (tile.east - tile.west)
    y_ratio = (tile.north - lat) / (tile.north - tile.south)

    col = min(max(int(round(x_ratio * (tile.width - 1))), 0), tile.width - 1)
    row = min(max(int(round(y_ratio * (tile.height - 1))), 0), tile.height - 1)

    value = float(tile.data[row, col])
    if not math.isfinite(value) or value <= NO_DATA_THRESHOLD:
        return None

    return ElevationPoint(elevation_m=value, source=tile.source)


def summarize_route_elevation(
    coordinates: list[list[float]],
    *,
    min_change_meters: float = 2.0,
) -> RouteElevationSummary:
    ascent = 0.0
    descent = 0.0
    sampled_points = 0
    previous_elevation = None
    min_elevation = None
    max_elevation = None
    source = "missing-local-dem"

    for lon, lat in coordinates:
        point = sample_elevation(lon, lat)
        if point is None:
            continue

        sampled_points += 1
        source = point.source
        elevation = point.elevation_m
        min_elevation = elevation if min_elevation is None else min(min_elevation, elevation)
        max_elevation = elevation if max_elevation is None else max(max_elevation, elevation)

        if previous_elevation is not None:
            delta = elevation - previous_elevation
            if delta >= min_change_meters:
                ascent += delta
            elif delta <= -min_change_meters:
                descent += -delta
        previous_elevation = elevation

    return RouteElevationSummary(
        ascent_meters=round(ascent, 1),
        descent_meters=round(descent, 1),
        min_elevation_m=round(min_elevation, 1) if min_elevation is not None else None,
        max_elevation_m=round(max_elevation, 1) if max_elevation is not None else None,
        sampled_points=sampled_points,
        source=source,
    )
