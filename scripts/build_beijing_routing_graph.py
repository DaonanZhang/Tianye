from __future__ import annotations

import gzip
import json
import sys
from collections import defaultdict
from pathlib import Path

BASE_DIR = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(BASE_DIR))

from maps.routing import BEIJING_BOUNDS, GRID_SIZE, haversine_meters, in_bounds


SOURCE_PATH = BASE_DIR / "maps" / "static" / "maps" / "data" / "beijing-walkways.geojson"
OUTPUT_PATH = BASE_DIR / "data" / "routing" / "beijing-core-routing.json.gz"

ROAD_CLASS_COST_FACTOR = {
    "path": 0.84,
    "footway": 0.86,
    "pedestrian": 0.88,
    "living_street": 0.92,
    "track": 0.96,
    "cycleway": 0.98,
    "steps": 1.08,
    "service": 1.14,
    "residential": 1.2,
    "unclassified": 1.24,
    "tertiary": 1.34,
    "secondary": 1.52,
    "primary": 1.82,
}


def rounded_coord(raw_coord: list[float]) -> tuple[float, float]:
    lon, lat = raw_coord
    return round(lon, 7), round(lat, 7)


def grid_key(lon: float, lat: float) -> str:
    min_lon, min_lat, _, _ = BEIJING_BOUNDS
    x = int((lon - min_lon) / GRID_SIZE)
    y = int((lat - min_lat) / GRID_SIZE)
    return f"{x}:{y}"


def main() -> None:
    if not SOURCE_PATH.exists():
        raise SystemExit(f"Missing source file: {SOURCE_PATH}")

    payload = json.loads(SOURCE_PATH.read_text())
    features = payload["features"]

    node_lookup: dict[tuple[float, float], int] = {}
    nodes: list[list[float]] = []
    adjacency: dict[int, dict[int, tuple[float, float, str]]] = defaultdict(dict)

    def node_id_for(coord: tuple[float, float]) -> int:
        existing = node_lookup.get(coord)
        if existing is not None:
            return existing
        new_id = len(nodes)
        node_lookup[coord] = new_id
        nodes.append([coord[0], coord[1]])
        return new_id

    for feature in features:
        coordinates = feature["geometry"]["coordinates"]
        road_class = feature.get("properties", {}).get("class", "")
        factor = ROAD_CLASS_COST_FACTOR.get(road_class, 1.25)
        if len(coordinates) < 2:
            continue

        previous_coord = None
        previous_id = None
        for raw_coord in coordinates:
            coord = rounded_coord(raw_coord)
            if not in_bounds(*coord):
                previous_coord = None
                previous_id = None
                continue

            current_id = node_id_for(coord)
            if previous_coord is not None and previous_id is not None and previous_id != current_id:
                distance = haversine_meters(previous_coord, coord)
                weighted_cost = distance * factor
                old_forward = adjacency[previous_id].get(current_id)
                old_backward = adjacency[current_id].get(previous_id)
                if old_forward is None or weighted_cost < old_forward[0]:
                    adjacency[previous_id][current_id] = (weighted_cost, distance, road_class)
                if old_backward is None or weighted_cost < old_backward[0]:
                    adjacency[current_id][previous_id] = (weighted_cost, distance, road_class)

            previous_coord = coord
            previous_id = current_id

    neighbors = []
    grid_index: dict[str, list[int]] = defaultdict(list)
    for node_id, coord in enumerate(nodes):
        neighbor_pairs = [
            [neighbor_id, round(cost, 2), round(distance, 2), road_class]
            for neighbor_id, (cost, distance, road_class) in adjacency[node_id].items()
        ]
        neighbors.append(neighbor_pairs)
        grid_index[grid_key(coord[0], coord[1])].append(node_id)

    OUTPUT_PATH.parent.mkdir(parents=True, exist_ok=True)
    output_payload = {
        "nodes": nodes,
        "neighbors": neighbors,
        "grid_index": grid_index,
    }

    with gzip.open(OUTPUT_PATH, "wt", encoding="utf-8") as output_file:
        json.dump(output_payload, output_file, ensure_ascii=False, separators=(",", ":"))

    edge_count = sum(len(node_neighbors) for node_neighbors in neighbors)
    print(f"Nodes: {len(nodes)}")
    print(f"Directed edges: {edge_count}")
    print(f"Grid buckets: {len(grid_index)}")
    print(f"Weight factors: {ROAD_CLASS_COST_FACTOR}")
    print(f"Graph: {OUTPUT_PATH}")


if __name__ == "__main__":
    main()
