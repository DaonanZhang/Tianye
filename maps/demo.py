from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime
import math
import xml.etree.ElementTree as ET

from .gpx import haversine_meters
from .hiking_time import estimate_dav_hiking_time


@dataclass(slots=True)
class DemoGpxPoint:
    longitude: float
    latitude: float
    elevation_m: float | None
    timestamp: datetime | None

    @property
    def coordinate(self) -> list[float]:
        return [self.longitude, self.latitude]


@dataclass(slots=True)
class ParsedDemoGpx:
    name: str
    points: list[DemoGpxPoint]
    coordinates: list[list[float]]
    segment_count: int


def _parse_float(value: str | None) -> float | None:
    try:
        return float(value) if value is not None else None
    except (TypeError, ValueError):
        return None


def _parse_timestamp(value: str | None) -> datetime | None:
    if not value:
        return None

    normalized = value.strip()
    if not normalized:
        return None

    if normalized.endswith("Z"):
        normalized = normalized[:-1] + "+00:00"

    try:
        return datetime.fromisoformat(normalized)
    except ValueError:
        return None


def _normalize_points(points: list[DemoGpxPoint], *, dedupe_threshold_meters: float = 1.0) -> list[DemoGpxPoint]:
    if not points:
        return []

    normalized = [points[0]]
    for point in points[1:]:
        previous = normalized[-1]
        if haversine_meters((previous.longitude, previous.latitude), (point.longitude, point.latitude)) < dedupe_threshold_meters:
            continue
        normalized.append(point)
    return normalized


def parse_demo_gpx(xml_text: str, fallback_name: str = "Imported GPX") -> ParsedDemoGpx:
    """Parse a GPX document while keeping elevation and timestamp fields when present."""
    try:
        root = ET.fromstring(xml_text)
    except ET.ParseError as exc:
        raise ValueError("Invalid GPX XML document.") from exc
    namespace = ""
    if root.tag.startswith("{"):
        namespace = root.tag.split("}", 1)[0] + "}"

    def tag(name: str) -> str:
        return f"{namespace}{name}"

    segments: list[list[DemoGpxPoint]] = []
    for segment_node in root.findall(f".//{tag('trkseg')}"):
        segment_points: list[DemoGpxPoint] = []
        for point_node in segment_node.findall(tag("trkpt")):
            latitude = _parse_float(point_node.attrib.get("lat"))
            longitude = _parse_float(point_node.attrib.get("lon"))
            if latitude is None or longitude is None:
                continue

            elevation_node = point_node.find(tag("ele"))
            time_node = point_node.find(tag("time"))
            segment_points.append(
                DemoGpxPoint(
                    longitude=longitude,
                    latitude=latitude,
                    elevation_m=_parse_float(elevation_node.text if elevation_node is not None else None),
                    timestamp=_parse_timestamp(time_node.text if time_node is not None else None),
                )
            )

        if len(segment_points) >= 2:
            segments.append(segment_points)

    if not segments:
        route_points: list[DemoGpxPoint] = []
        for point_node in root.findall(f".//{tag('rtept')}"):
            latitude = _parse_float(point_node.attrib.get("lat"))
            longitude = _parse_float(point_node.attrib.get("lon"))
            if latitude is None or longitude is None:
                continue

            elevation_node = point_node.find(tag("ele"))
            time_node = point_node.find(tag("time"))
            route_points.append(
                DemoGpxPoint(
                    longitude=longitude,
                    latitude=latitude,
                    elevation_m=_parse_float(elevation_node.text if elevation_node is not None else None),
                    timestamp=_parse_timestamp(time_node.text if time_node is not None else None),
                )
            )

        if len(route_points) >= 2:
            segments.append(route_points)

    if not segments:
        raise ValueError("GPX file does not contain a usable track or route.")

    name_node = root.find(f".//{tag('name')}")
    parsed_name = (name_node.text or "").strip() if name_node is not None else ""

    flattened: list[DemoGpxPoint] = []
    for segment in segments:
        flattened.extend(segment)

    normalized = _normalize_points(flattened)
    if len(normalized) < 2:
        raise ValueError("GPX path became too short after normalization.")

    return ParsedDemoGpx(
        name=parsed_name or fallback_name,
        points=normalized,
        coordinates=[point.coordinate for point in normalized],
        segment_count=len(segments),
    )


def _sum_distance_meters(points: list[DemoGpxPoint]) -> float:
    distance_meters = 0.0
    for index in range(1, len(points)):
        previous = points[index - 1]
        current = points[index]
        distance_meters += haversine_meters(
            (previous.longitude, previous.latitude),
            (current.longitude, current.latitude),
        )
    return distance_meters


def _sum_elevation_gain(points: list[DemoGpxPoint]) -> tuple[float, float]:
    ascent_meters = 0.0
    descent_meters = 0.0

    for index in range(1, len(points)):
        previous_elevation = points[index - 1].elevation_m
        current_elevation = points[index].elevation_m
        if previous_elevation is None or current_elevation is None:
            continue

        delta = current_elevation - previous_elevation
        if delta > 0:
            ascent_meters += delta
        elif delta < 0:
            descent_meters += abs(delta)

    return ascent_meters, descent_meters


def _duration_seconds(points: list[DemoGpxPoint]) -> int | None:
    timestamps = [point.timestamp for point in points if point.timestamp is not None]
    if len(timestamps) < 2:
        return None

    duration_seconds = int((timestamps[-1] - timestamps[0]).total_seconds())
    return duration_seconds if duration_seconds > 0 else None


def _difficulty_label(distance_meters: float) -> tuple[str, str]:
    if distance_meters < 5_000:
        return "easy", "轻松"
    if distance_meters <= 10_000:
        return "medium", "适中"
    return "hard", "较难"


def _detect_stops(points: list[DemoGpxPoint], *, radius_meters: float = 35.0, min_stop_seconds: int = 180) -> list[dict]:
    """Detect coarse stop areas from timestamped GPX points."""
    stops: list[dict] = []
    if len(points) < 2 or any(point.timestamp is None for point in points):
        return stops

    start_index = 0
    while start_index < len(points) - 1:
        anchor = points[start_index]
        if anchor.timestamp is None:
            start_index += 1
            continue

        end_index = start_index + 1
        while end_index < len(points):
            current = points[end_index]
            if current.timestamp is None:
                break

            traveled = haversine_meters(
                (anchor.longitude, anchor.latitude),
                (current.longitude, current.latitude),
            )
            if traveled > radius_meters:
                break
            end_index += 1

        candidate = points[end_index - 1]
        if candidate.timestamp is not None:
            duration_seconds = int((candidate.timestamp - anchor.timestamp).total_seconds())
            if duration_seconds >= min_stop_seconds:
                cluster = points[start_index:end_index]
                mean_longitude = sum(point.longitude for point in cluster) / len(cluster)
                mean_latitude = sum(point.latitude for point in cluster) / len(cluster)
                stops.append(
                    {
                        "longitude": round(mean_longitude, 6),
                        "latitude": round(mean_latitude, 6),
                        "duration_seconds": duration_seconds,
                    }
                )
                start_index = end_index
                continue

        start_index += 1

    return stops


def _format_duration(minutes: int) -> str:
    hours = minutes // 60
    remainder = minutes % 60
    if hours == 0:
        return f"{remainder} 分钟"
    if remainder == 0:
        return f"{hours} 小时"
    return f"{hours} 小时 {remainder} 分钟"


def _duration_bucket(minutes: int) -> str:
    if minutes <= 90:
        return "半天轻徒步"
    if minutes <= 180:
        return "周末慢走线"
    return "需要预留完整时段"


def _build_story(
    *,
    route_name: str,
    distance_meters: float,
    duration_minutes: int,
    duration_source: str,
    is_loop: bool,
    difficulty_label: str,
    stop_count: int,
    tags: list[str],
    description: str,
) -> dict:
    distance_km = distance_meters / 1000
    loop_label = "闭环" if is_loop else "单程"
    suitable_for = "第一次尝试城市徒步的人" if difficulty_label == "轻松" else "想把周末散步升级成完整路线的人"
    summary = (
        f"{route_name}是一条约 {distance_km:.1f} 公里的{loop_label}城市步行线，"
        f"整体节奏偏{difficulty_label}，适合用 {_format_duration(duration_minutes)} 完成。"
    )
    if description:
        summary = f"{description} {summary}"

    highlights = [
        f"全程约 {distance_km:.1f} 公里，适合 {_duration_bucket(duration_minutes)}。",
        f"{loop_label}路线，起终点{'接近' if is_loop else '分离'}，更适合{'无压力返回' if is_loop else '边走边换景'}。",
    ]
    if stop_count > 0:
        highlights.append(f"轨迹中识别到 {stop_count} 个可能停留点，适合串联拍照或短暂停留。")
    if tags:
        highlights.append(f"路线气质偏向：{' / '.join(tags[:3])}。")

    cautions = [
        "出发前确认手机电量与补水，城市步行也要留意返程时间。",
        "地图与路线分析基于 local-data，本页不依赖实时外部路线 API。",
    ]
    if duration_source != "gpx":
        cautions.append("当前用时为估算值，因为原始 GPX 未提供完整时间信息。")

    share_text = (
        f"{route_name} | 北京城市徒步路线 AI Demo\n"
        f"{distance_km:.1f} km · {difficulty_label} · {_format_duration(duration_minutes)}\n"
        f"{summary}"
    )

    return {
        "title": route_name,
        "summary": summary,
        "best_for": suitable_for,
        "highlights": highlights,
        "difficulty_text": f"这条路线整体属于“{difficulty_label}”，距离与节奏都比较适合先看风景、再慢慢走完。",
        "cautions": cautions,
        "share_text": share_text,
    }


def build_demo_route_payload(
    *,
    route_id: str,
    parsed_gpx: ParsedDemoGpx,
    city: str,
    title: str,
    description: str,
    tags: list[str],
    dependency: str,
    rating: float = 4.8,
    review_count: int = 1200,
    route_type: str = "Point to point",
    cover_variant: str = "forest",
) -> dict:
    """Build one JSON-serializable route payload for the web demo."""
    distance_meters = _sum_distance_meters(parsed_gpx.points)
    ascent_meters, descent_meters = _sum_elevation_gain(parsed_gpx.points)
    duration_seconds = _duration_seconds(parsed_gpx.points)
    estimated_time = estimate_dav_hiking_time(
        distance_meters=distance_meters,
        ascent_meters=ascent_meters,
        descent_meters=descent_meters,
    )
    estimated_minutes = max(round(estimated_time.recommended_hours * 60), 1)
    actual_minutes = math.ceil(duration_seconds / 60) if duration_seconds is not None else None
    display_minutes = actual_minutes or estimated_minutes
    duration_source = "gpx" if actual_minutes is not None else "estimated"
    difficulty_code, difficulty_label = _difficulty_label(distance_meters)

    start = parsed_gpx.points[0]
    end = parsed_gpx.points[-1]
    loop_distance_meters = haversine_meters(
        (start.longitude, start.latitude),
        (end.longitude, end.latitude),
    )
    is_loop = loop_distance_meters < 300
    stop_points = _detect_stops(parsed_gpx.points)

    story = _build_story(
        route_name=title,
        distance_meters=distance_meters,
        duration_minutes=display_minutes,
        duration_source=duration_source,
        is_loop=is_loop,
        difficulty_label=difficulty_label,
        stop_count=len(stop_points),
        tags=tags,
        description=description,
    )

    elevations = [point.elevation_m for point in parsed_gpx.points if point.elevation_m is not None]
    return {
        "id": route_id,
        "name": title,
        "city": city,
        "description": description,
        "tags": tags,
        "dependency": dependency,
        "social": {
            "rating": rating,
            "review_count": review_count,
            "route_type": route_type,
            "cover_variant": cover_variant,
        },
        "gpx": {
            "track_name": parsed_gpx.name,
            "segment_count": parsed_gpx.segment_count,
            "coordinate_count": len(parsed_gpx.coordinates),
            "has_elevation": bool(elevations),
            "has_timestamps": duration_seconds is not None,
        },
        "geometry": {
            "type": "LineString",
            "coordinates": parsed_gpx.coordinates,
        },
        "analysis": {
            "distance_meters": round(distance_meters, 1),
            "distance_km": round(distance_meters / 1000, 2),
            "display_duration_minutes": display_minutes,
            "estimated_minutes": estimated_minutes,
            "actual_minutes": actual_minutes,
            "duration_source": duration_source,
            "start": {"longitude": round(start.longitude, 6), "latitude": round(start.latitude, 6)},
            "end": {"longitude": round(end.longitude, 6), "latitude": round(end.latitude, 6)},
            "is_loop": is_loop,
            "loop_distance_meters": round(loop_distance_meters, 1),
            "difficulty": {"code": difficulty_code, "label": difficulty_label},
            "stop_points": stop_points,
            "stop_point_count": len(stop_points),
            "ascent_meters": round(ascent_meters, 1),
            "descent_meters": round(descent_meters, 1),
            "min_elevation_m": round(min(elevations), 1) if elevations else None,
            "max_elevation_m": round(max(elevations), 1) if elevations else None,
        },
        "story": story,
        "card": {
            "eyebrow": "AI 生成路线卡片",
            "summary": story["summary"],
            "share_text": story["share_text"],
            "highlights": story["highlights"][:3],
        },
    }
