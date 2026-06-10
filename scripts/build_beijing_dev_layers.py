from __future__ import annotations

import json
from pathlib import Path

import osmium


BASE_DIR = Path(__file__).resolve().parent.parent
SOURCE_PBF = BASE_DIR / "data" / "osm" / "beijing-latest.osm.pbf"
OUTPUT_DIR = BASE_DIR / "maps" / "static" / "maps" / "data"

# Development bounds for the current Beijing demo, expanded to include
# Fangshan while keeping the dataset smaller than a whole-region build.
BEIJING_BOUNDS = (115.7, 39.5, 116.8, 40.1)

WALKABLE_HIGHWAYS = {
    "footway",
    "pedestrian",
    "path",
    "living_street",
    "residential",
    "service",
    "unclassified",
    "tertiary",
    "secondary",
    "primary",
    "track",
    "steps",
    "cycleway",
}

PARK_TAGS = {
    ("leisure", "park"),
    ("leisure", "garden"),
    ("landuse", "forest"),
    ("landuse", "grass"),
    ("natural", "wood"),
    ("natural", "grassland"),
}

WATER_AREA_TAGS = {
    ("natural", "water"),
    ("landuse", "reservoir"),
    ("water", "lake"),
    ("water", "reservoir"),
    ("waterway", "riverbank"),
}

WATER_LINE_VALUES = {"river", "stream", "canal", "ditch"}
PLACE_VALUES = {"city", "town", "suburb", "neighbourhood"}


def in_bounds(lon: float, lat: float) -> bool:
    min_lon, min_lat, max_lon, max_lat = BEIJING_BOUNDS
    return min_lon <= lon <= max_lon and min_lat <= lat <= max_lat


def is_closed_polygon(coords: list[list[float]]) -> bool:
    return len(coords) >= 4 and coords[0] == coords[-1]


class BeijingLayerExtractor(osmium.SimpleHandler):
    def __init__(self) -> None:
        super().__init__()
        self.walkways: list[dict] = []
        self.parks: list[dict] = []
        self.water: list[dict] = []
        self.places: list[dict] = []

    def node(self, n: osmium.osm.Node) -> None:
        place = n.tags.get("place")
        name = n.tags.get("name")
        if not place or place not in PLACE_VALUES or not name:
            return
        if not n.location.valid() or not in_bounds(n.location.lon, n.location.lat):
            return

        self.places.append(
            {
                "type": "Feature",
                "properties": {
                    "name": name,
                    "class": place,
                },
                "geometry": {
                    "type": "Point",
                    "coordinates": [n.location.lon, n.location.lat],
                },
            }
        )

    def way(self, w: osmium.osm.Way) -> None:
        coords: list[list[float]] = []
        for node in w.nodes:
            if node.location.valid():
                coords.append([node.location.lon, node.location.lat])

        if len(coords) < 2:
            return
        if not any(in_bounds(lon, lat) for lon, lat in coords):
            return

        tags = w.tags
        highway = tags.get("highway")
        if highway in WALKABLE_HIGHWAYS:
            self.walkways.append(
                {
                    "type": "Feature",
                    "properties": {
                        "name": tags.get("name", ""),
                        "class": highway,
                    },
                    "geometry": {
                        "type": "LineString",
                        "coordinates": coords,
                    },
                }
            )

        if is_closed_polygon(coords) and any(tags.get(key) == value for key, value in PARK_TAGS):
            self.parks.append(
                {
                    "type": "Feature",
                    "properties": {
                        "name": tags.get("name", ""),
                    },
                    "geometry": {
                        "type": "Polygon",
                        "coordinates": [coords],
                    },
                }
            )

        waterway = tags.get("waterway")
        if is_closed_polygon(coords) and any(tags.get(key) == value for key, value in WATER_AREA_TAGS):
            self.water.append(
                {
                    "type": "Feature",
                    "properties": {
                        "name": tags.get("name", ""),
                        "class": "water",
                    },
                    "geometry": {
                        "type": "Polygon",
                        "coordinates": [coords],
                    },
                }
            )
        elif waterway in WATER_LINE_VALUES:
            self.water.append(
                {
                    "type": "Feature",
                    "properties": {
                        "name": tags.get("name", ""),
                        "class": waterway,
                    },
                    "geometry": {
                        "type": "LineString",
                        "coordinates": coords,
                    },
                }
            )


def write_feature_collection(path: Path, features: list[dict]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    payload = {
        "type": "FeatureCollection",
        "features": features,
    }
    path.write_text(json.dumps(payload, ensure_ascii=False, separators=(",", ":")))


def main() -> None:
    if not SOURCE_PBF.exists():
        raise SystemExit(f"Missing source file: {SOURCE_PBF}")

    extractor = BeijingLayerExtractor()
    extractor.apply_file(str(SOURCE_PBF), locations=True)

    write_feature_collection(OUTPUT_DIR / "beijing-walkways.geojson", extractor.walkways)
    write_feature_collection(OUTPUT_DIR / "beijing-parks.geojson", extractor.parks)
    write_feature_collection(OUTPUT_DIR / "beijing-water.geojson", extractor.water)
    write_feature_collection(OUTPUT_DIR / "beijing-places.geojson", extractor.places)

    print(f"Walkways: {len(extractor.walkways)}")
    print(f"Parks: {len(extractor.parks)}")
    print(f"Water: {len(extractor.water)}")
    print(f"Places: {len(extractor.places)}")


if __name__ == "__main__":
    main()
