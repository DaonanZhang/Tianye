from __future__ import annotations

import gzip
import heapq
import json
import math
from dataclasses import dataclass
from functools import lru_cache
from pathlib import Path

from .elevation import summarize_route_elevation


BASE_DIR = Path(__file__).resolve().parent.parent
GRAPH_PATH = BASE_DIR / "data" / "routing" / "beijing-core-routing.json.gz"
BEIJING_BOUNDS = (115.7, 39.5, 116.8, 40.1)
GRID_SIZE = 0.01


def in_bounds(lon: float, lat: float) -> bool:
    min_lon, min_lat, max_lon, max_lat = BEIJING_BOUNDS
    return min_lon <= lon <= max_lon and min_lat <= lat <= max_lat


def haversine_meters(point_a: tuple[float, float], point_b: tuple[float, float]) -> float:
    lon1, lat1 = point_a
    lon2, lat2 = point_b

    radius = 6_371_000
    phi1 = math.radians(lat1)
    phi2 = math.radians(lat2)
    delta_phi = math.radians(lat2 - lat1)
    delta_lambda = math.radians(lon2 - lon1)

    sin_phi = math.sin(delta_phi / 2)
    sin_lambda = math.sin(delta_lambda / 2)
    a = sin_phi * sin_phi + math.cos(phi1) * math.cos(phi2) * sin_lambda * sin_lambda
    return 2 * radius * math.atan2(math.sqrt(a), math.sqrt(1 - a))


def grid_key(lon: float, lat: float) -> tuple[int, int]:
    min_lon, min_lat, _, _ = BEIJING_BOUNDS
    x = int((lon - min_lon) / GRID_SIZE)
    y = int((lat - min_lat) / GRID_SIZE)
    return x, y


@dataclass(slots=True)
class RouteResult:
    coordinates: list[list[float]]
    distance_meters: float
    weighted_cost_meters: float
    start_anchor: list[float]
    end_anchor: list[float]
    ascent_meters: float
    descent_meters: float
    min_elevation_m: float | None
    max_elevation_m: float | None
    elevation_source: str
    elevation_sampled_points: int
    road_classes: list[str]


class RouteGraph:
    def __init__(self, payload: dict) -> None:
        self.nodes: list[list[float]] = payload["nodes"]
        self.neighbors: list[list[dict[str, object]]] = [
            [self._normalize_neighbor(entry) for entry in neighbor_list]
            for neighbor_list in payload["neighbors"]
        ]
        self.grid_index: dict[tuple[int, int], list[int]] = {
            tuple(map(int, key.split(":"))): node_ids
            for key, node_ids in payload["grid_index"].items()
        }

    @staticmethod
    def _normalize_neighbor(entry: list[float] | list[object]) -> dict[str, object]:
        if len(entry) >= 4:
            neighbor_id, cost, distance, road_class = entry[:4]
            return {
                "neighbor_id": int(neighbor_id),
                "cost": float(cost),
                "distance": float(distance),
                "road_class": str(road_class),
            }

        neighbor_id, distance = entry[:2]
        return {
            "neighbor_id": int(neighbor_id),
            "cost": float(distance),
            "distance": float(distance),
            "road_class": "",
        }

    def nearest_node(self, lon: float, lat: float) -> int:
        origin = (lon, lat)
        cell_x, cell_y = grid_key(lon, lat)
        best_node = None
        best_distance = float("inf")

        for radius in range(0, 8):
            candidates: list[int] = []
            for x in range(cell_x - radius, cell_x + radius + 1):
                for y in range(cell_y - radius, cell_y + radius + 1):
                    candidates.extend(self.grid_index.get((x, y), []))

            if not candidates:
                continue

            for node_id in candidates:
                node_lon, node_lat = self.nodes[node_id]
                distance = haversine_meters(origin, (node_lon, node_lat))
                if distance < best_distance:
                    best_distance = distance
                    best_node = node_id

            if best_node is not None:
                return best_node

        raise ValueError("No routing node found near the requested point.")

    def shortest_path(self, start_node: int, end_node: int) -> tuple[list[int], float, float, list[str]]:
        queue: list[tuple[float, int]] = [(0.0, start_node)]
        distances = {start_node: 0.0}
        weighted_costs = {start_node: 0.0}
        previous: dict[int, int | None] = {start_node: None}
        previous_road_class: dict[int, str] = {start_node: ""}
        visited: set[int] = set()

        while queue:
            current_distance, node_id = heapq.heappop(queue)
            if node_id in visited:
                continue
            visited.add(node_id)

            if node_id == end_node:
                break

            for neighbor in self.neighbors[node_id]:
                neighbor_id = int(neighbor["neighbor_id"])
                edge_distance = float(neighbor["distance"])
                edge_cost = float(neighbor["cost"])
                tentative_distance = current_distance + edge_distance
                if tentative_distance >= distances.get(neighbor_id, float("inf")):
                    continue
                distances[neighbor_id] = tentative_distance
                weighted_costs[neighbor_id] = weighted_costs[node_id] + edge_cost
                previous[neighbor_id] = node_id
                previous_road_class[neighbor_id] = str(neighbor["road_class"])
                heapq.heappush(queue, (tentative_distance, neighbor_id))

        if end_node not in previous:
            raise ValueError("No walkable route found between these points.")

        path: list[int] = []
        road_classes: list[str] = []
        cursor: int | None = end_node
        while cursor is not None:
            path.append(cursor)
            if cursor != start_node:
                road_classes.append(previous_road_class.get(cursor, ""))
            cursor = previous[cursor]
        path.reverse()
        road_classes.reverse()
        return path, distances[end_node], weighted_costs[end_node], road_classes

    def route_between(self, start: tuple[float, float], end: tuple[float, float]) -> RouteResult:
        start_node = self.nearest_node(*start)
        end_node = self.nearest_node(*end)
        path, distance_meters, weighted_cost_meters, road_classes = self.shortest_path(start_node, end_node)

        coordinates = [self.nodes[node_id] for node_id in path]
        elevation = summarize_route_elevation(coordinates)
        return RouteResult(
            coordinates=coordinates,
            distance_meters=distance_meters,
            weighted_cost_meters=weighted_cost_meters,
            start_anchor=self.nodes[start_node],
            end_anchor=self.nodes[end_node],
            ascent_meters=elevation.ascent_meters,
            descent_meters=elevation.descent_meters,
            min_elevation_m=elevation.min_elevation_m,
            max_elevation_m=elevation.max_elevation_m,
            elevation_source=elevation.source,
            elevation_sampled_points=elevation.sampled_points,
            road_classes=road_classes,
        )


@lru_cache(maxsize=1)
def get_route_graph() -> RouteGraph:
    if not GRAPH_PATH.exists():
        raise FileNotFoundError(
            f"Routing graph is missing: {GRAPH_PATH}. Run scripts/build_beijing_routing_graph.py first."
        )

    with gzip.open(GRAPH_PATH, "rt", encoding="utf-8") as graph_file:
        payload = json.load(graph_file)

    return RouteGraph(payload)
