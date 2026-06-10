from __future__ import annotations

import math
import xml.etree.ElementTree as ET
from dataclasses import dataclass


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
    value = sin_phi * sin_phi + math.cos(phi1) * math.cos(phi2) * sin_lambda * sin_lambda
    return 2 * radius * math.atan2(math.sqrt(value), math.sqrt(1 - value))


def to_local_xy(reference_lat: float, point: tuple[float, float]) -> tuple[float, float]:
    lon, lat = point
    lat_rad = math.radians(reference_lat)
    x = lon * 111_320 * math.cos(lat_rad)
    y = lat * 110_540
    return x, y


def distance_point_to_segment_meters(
    point: tuple[float, float],
    segment_start: tuple[float, float],
    segment_end: tuple[float, float],
) -> float:
    reference_lat = (point[1] + segment_start[1] + segment_end[1]) / 3
    px, py = to_local_xy(reference_lat, point)
    ax, ay = to_local_xy(reference_lat, segment_start)
    bx, by = to_local_xy(reference_lat, segment_end)
    abx = bx - ax
    aby = by - ay
    apx = px - ax
    apy = py - ay
    denominator = (abx * abx) + (aby * aby)

    if denominator == 0:
        return math.hypot(px - ax, py - ay)

    t = max(0.0, min(1.0, ((apx * abx) + (apy * aby)) / denominator))
    closest_x = ax + (abx * t)
    closest_y = ay + (aby * t)
    return math.hypot(px - closest_x, py - closest_y)


@dataclass(slots=True)
class ParsedGpx:
    name: str
    geometry: dict
    coordinates: list[list[float]]
    distance_meters: float
    raw_point_count: int
    normalized_point_count: int
    segment_count: int


def _parse_float(value: str | None) -> float | None:
    try:
        return float(value) if value is not None else None
    except (TypeError, ValueError):
        return None


def normalize_path_coordinates(
    coordinates: list[list[float]],
    *,
    dedupe_threshold_meters: float = 1.0,
) -> list[list[float]]:
    if not coordinates:
        return []

    normalized = [coordinates[0]]
    for coordinate in coordinates[1:]:
        if haversine_meters(tuple(normalized[-1]), tuple(coordinate)) < dedupe_threshold_meters:
            continue
        normalized.append(coordinate)

    return normalized


def parse_gpx_text(xml_text: str, fallback_name: str = "Imported GPX") -> ParsedGpx:
    root = ET.fromstring(xml_text)
    namespace = ""
    if root.tag.startswith("{"):
        namespace = root.tag.split("}", 1)[0] + "}"

    def tag(name: str) -> str:
        return f"{namespace}{name}"

    segments: list[list[list[float]]] = []
    for segment in root.findall(f".//{tag('trkseg')}"):
        points: list[list[float]] = []
        for point in segment.findall(tag("trkpt")):
            lat = _parse_float(point.attrib.get("lat"))
            lon = _parse_float(point.attrib.get("lon"))
            if lat is None or lon is None:
                continue
            points.append([lon, lat])
        if len(points) >= 2:
            segments.append(points)

    if not segments:
        route_points: list[list[float]] = []
        for point in root.findall(f".//{tag('rtept')}"):
            lat = _parse_float(point.attrib.get("lat"))
            lon = _parse_float(point.attrib.get("lon"))
            if lat is None or lon is None:
                continue
            route_points.append([lon, lat])
        if len(route_points) >= 2:
            segments.append(route_points)

    if not segments:
        raise ValueError("GPX file does not contain a usable track or route.")

    name_node = root.find(f".//{tag('name')}")
    name = (name_node.text or "").strip() if name_node is not None else ""
    final_name = name or fallback_name

    flattened: list[list[float]] = []
    for segment in segments:
        flattened.extend(segment)

    normalized = normalize_path_coordinates(flattened)
    if len(normalized) < 2:
        raise ValueError("GPX path became too short after normalization.")

    distance_meters = 0.0
    for index in range(1, len(normalized)):
        distance_meters += haversine_meters(tuple(normalized[index - 1]), tuple(normalized[index]))

    geometry = {"type": "LineString", "coordinates": normalized}
    return ParsedGpx(
        name=final_name,
        geometry=geometry,
        coordinates=normalized,
        distance_meters=distance_meters,
        raw_point_count=len(flattened),
        normalized_point_count=len(normalized),
        segment_count=len(segments),
    )


def densify_coordinates(coordinates: list[list[float]], step_meters: float = 1.0) -> list[tuple[float, float]]:
    if not coordinates:
        return []

    dense: list[tuple[float, float]] = [tuple(coordinates[0])]
    for index in range(1, len(coordinates)):
        start = tuple(coordinates[index - 1])
        end = tuple(coordinates[index])
        segment_distance = haversine_meters(start, end)
        if segment_distance == 0:
            continue

        steps = max(int(segment_distance // step_meters), 1)
        for step_index in range(1, steps + 1):
            ratio = min(step_index * step_meters / segment_distance, 1.0)
            lon = start[0] + ((end[0] - start[0]) * ratio)
            lat = start[1] + ((end[1] - start[1]) * ratio)
            dense.append((lon, lat))
    return dense


def max_distance_to_polyline(sampled_points: list[tuple[float, float]], polyline: list[list[float]]) -> float:
    if len(polyline) < 2:
        return float("inf")

    segments = [
        (tuple(polyline[index - 1]), tuple(polyline[index]))
        for index in range(1, len(polyline))
    ]
    max_distance = 0.0
    for point in sampled_points:
        best = min(
            distance_point_to_segment_meters(point, segment_start, segment_end)
            for segment_start, segment_end in segments
        )
        if best > max_distance:
            max_distance = best
    return max_distance


def bidirectional_polyline_distance_meters(
    coordinates_a: list[list[float]],
    coordinates_b: list[list[float]],
    *,
    sampling_step_meters: float = 1.0,
) -> float:
    if len(coordinates_a) < 2 or len(coordinates_b) < 2:
        return float("inf")

    sampled_a = densify_coordinates(coordinates_a, step_meters=sampling_step_meters)
    sampled_b = densify_coordinates(coordinates_b, step_meters=sampling_step_meters)
    return max(
        max_distance_to_polyline(sampled_a, coordinates_b),
        max_distance_to_polyline(sampled_b, coordinates_a),
    )
