import json

from django.core.exceptions import ValidationError
from django.http import JsonResponse
from django.utils.decorators import method_decorator
from django.utils import timezone
from django.views import View
from django.views.generic import TemplateView
from django.views.decorators.csrf import ensure_csrf_cookie

from .elevation import sample_elevation
from .elevation import summarize_route_elevation
from .gpx import bidirectional_polyline_distance_meters, parse_gpx_text
from .hiking_time import estimate_dav_hiking_time
from .models import HikeSession, SavedPath, ScenicSpot
from .routing import get_route_graph, in_bounds


@method_decorator(ensure_csrf_cookie, name="dispatch")
class MapPlaygroundView(TemplateView):
    template_name = "maps/playground.html"


class RoutePreviewView(View):
    def get(self, request, *args, **kwargs):
        try:
            start_lng = float(request.GET["start_lng"])
            start_lat = float(request.GET["start_lat"])
            end_lng = float(request.GET["end_lng"])
            end_lat = float(request.GET["end_lat"])
        except (KeyError, TypeError, ValueError):
            return JsonResponse({"error": "Invalid route parameters."}, status=400)

        if not in_bounds(start_lng, start_lat) or not in_bounds(end_lng, end_lat):
            return JsonResponse({"error": "Points must stay within the Beijing development bounds."}, status=400)

        try:
            route = get_route_graph().route_between((start_lng, start_lat), (end_lng, end_lat))
        except FileNotFoundError as exc:
            return JsonResponse({"error": str(exc)}, status=503)
        except ValueError as exc:
            return JsonResponse({"error": str(exc)}, status=422)

        hiking_time = estimate_dav_hiking_time(
            distance_meters=route.distance_meters,
            ascent_meters=route.ascent_meters,
            descent_meters=route.descent_meters,
        )

        payload = {
            "type": "Feature",
            "properties": {
                "distance_meters": round(route.distance_meters, 1),
                "weighted_cost_meters": round(route.weighted_cost_meters, 1),
                "start_anchor": route.start_anchor,
                "end_anchor": route.end_anchor,
                "ascent_meters": round(route.ascent_meters, 1),
                "descent_meters": round(route.descent_meters, 1),
                "min_elevation_m": route.min_elevation_m,
                "max_elevation_m": route.max_elevation_m,
                "elevation_source": route.elevation_source,
                "elevation_sampled_points": route.elevation_sampled_points,
                "road_classes": route.road_classes,
                "estimated_time": {
                    "standard": "DAV / DIN 33466",
                    "moving_minutes": round(hiking_time.moving_hours * 60),
                    "recommended_minutes": round(hiking_time.recommended_hours * 60),
                    "horizontal_minutes": round(hiking_time.horizontal_hours * 60),
                    "ascent_minutes": round(hiking_time.ascent_hours * 60),
                    "descent_minutes": round(hiking_time.descent_hours * 60),
                    "break_minutes": round(hiking_time.break_hours * 60),
                    "elevation_model": route.elevation_source,
                },
            },
            "geometry": {
                "type": "LineString",
                "coordinates": route.coordinates,
            },
        }
        return JsonResponse(payload)


class ElevationLookupView(View):
    def get(self, request, *args, **kwargs):
        try:
            lng = float(request.GET["lng"])
            lat = float(request.GET["lat"])
        except (KeyError, TypeError, ValueError):
            return JsonResponse({"error": "Invalid elevation parameters."}, status=400)

        point = sample_elevation(lng, lat)
        if point is None:
            return JsonResponse({"error": "No local elevation found for this point."}, status=404)

        return JsonResponse(
            {
                "lng": lng,
                "lat": lat,
                "elevation_m": round(point.elevation_m, 1),
                "source": point.source,
            }
        )


def parse_json_body(request):
    try:
        return json.loads(request.body.decode("utf-8"))
    except (UnicodeDecodeError, json.JSONDecodeError):
        raise ValidationError("Invalid JSON body.")


class HikeSessionStartView(View):
    def post(self, request, *args, **kwargs):
        try:
            payload = parse_json_body(request)
            route = payload["route"]
            properties = route["properties"]
            geometry = route["geometry"]
            start = properties["start"]
            end = properties["end"]
        except (KeyError, TypeError, ValidationError):
            return JsonResponse({"error": "Invalid hike start payload."}, status=400)

        session = HikeSession.objects.create(
            status=HikeSession.STATUS_ACTIVE,
            planned_route=route,
            actual_track={"type": "Feature", "properties": {}, "geometry": {"type": "LineString", "coordinates": []}},
            start_longitude=float(start[0]),
            start_latitude=float(start[1]),
            end_longitude=float(end[0]),
            end_latitude=float(end[1]),
            planned_distance_meters=float(properties.get("distance_meters", 0.0)),
            planned_ascent_meters=float(properties.get("ascent_meters", 0.0)),
            planned_descent_meters=float(properties.get("descent_meters", 0.0)),
            planned_moving_minutes=int(properties.get("estimated_time", {}).get("moving_minutes", 0)),
            planned_recommended_minutes=int(properties.get("estimated_time", {}).get("recommended_minutes", 0)),
            route_metadata={
                "start_anchor": properties.get("start_anchor"),
                "end_anchor": properties.get("end_anchor"),
                "elevation_source": properties.get("elevation_source"),
                "elevation_sampled_points": properties.get("elevation_sampled_points"),
                "min_elevation_m": properties.get("min_elevation_m"),
                "max_elevation_m": properties.get("max_elevation_m"),
                "route_coordinate_count": len(geometry.get("coordinates", [])),
            },
        )

        return JsonResponse(
            {
                "id": session.id,
                "status": session.status,
                "started_at": session.started_at.isoformat(),
            },
            status=201,
        )


class HikeSessionFinishView(View):
    def post(self, request, session_id, *args, **kwargs):
        try:
            session = HikeSession.objects.get(pk=session_id)
        except HikeSession.DoesNotExist:
            return JsonResponse({"error": "Hike session not found."}, status=404)

        if session.status != HikeSession.STATUS_ACTIVE:
            return JsonResponse({"error": "Hike session is already closed."}, status=409)

        try:
            payload = parse_json_body(request)
            actual_track = payload["actual_track"]
            summary = payload["summary"]
        except (KeyError, TypeError, ValidationError):
            return JsonResponse({"error": "Invalid hike finish payload."}, status=400)

        ended_at = timezone.now()
        actual_duration = max(int((ended_at - session.started_at).total_seconds()), 0)
        session.status = HikeSession.STATUS_COMPLETED
        session.ended_at = ended_at
        session.actual_track = actual_track
        session.walked_distance_meters = float(summary.get("walked_distance_meters", 0.0))
        session.walked_route_distance_meters = float(summary.get("walked_route_distance_meters", 0.0))
        session.completion_ratio = float(summary.get("completion_ratio", 0.0))
        session.deviation_count = int(summary.get("deviation_count", 0))
        session.actual_duration_seconds = actual_duration
        session.save(
            update_fields=[
                "status",
                "ended_at",
                "actual_track",
                "walked_distance_meters",
                "walked_route_distance_meters",
                "completion_ratio",
                "deviation_count",
                "actual_duration_seconds",
                "updated_at",
            ]
        )

        return JsonResponse(
            {
                "id": session.id,
                "status": session.status,
                "ended_at": session.ended_at.isoformat(),
                "actual_duration_seconds": session.actual_duration_seconds,
            }
        )


class HikeSessionListView(View):
    def get(self, request, *args, **kwargs):
        sessions = HikeSession.objects.all()[:10]
        return JsonResponse(
            {
                "sessions": [
                    {
                        "id": session.id,
                        "status": session.status,
                        "started_at": session.started_at.isoformat(),
                        "ended_at": session.ended_at.isoformat() if session.ended_at else None,
                        "planned_distance_meters": round(session.planned_distance_meters, 1),
                        "walked_distance_meters": round(session.walked_distance_meters, 1),
                        "completion_ratio": round(session.completion_ratio, 4),
                        "deviation_count": session.deviation_count,
                        "planned_moving_minutes": session.planned_moving_minutes,
                        "planned_recommended_minutes": session.planned_recommended_minutes,
                        "actual_duration_seconds": session.actual_duration_seconds,
                    }
                    for session in sessions
                ]
            }
        )


def feature_from_saved_path(path: SavedPath, *, canonical_for: SavedPath | None = None) -> dict:
    canonical = canonical_for or path
    coordinates = flatten_geometry_coordinates(canonical.geometry)
    start = coordinates[0] if coordinates else None
    end = coordinates[-1] if coordinates else None
    return {
        "type": "Feature",
        "properties": {
            "id": path.id,
            "name": path.name,
            "status": path.status,
            "source": path.source,
            "distance_meters": round(path.distance_meters, 1),
            "ascent_meters": round(path.ascent_meters, 1),
            "descent_meters": round(path.descent_meters, 1),
            "canonical_path_id": canonical.id,
            "canonical_path_name": canonical.name,
            "merged_into_id": path.merged_into_id,
            "start": start,
            "end": end,
            "coordinate_count": len(coordinates),
            "navigation_ready": len(coordinates) >= 2,
            "min_elevation_m": canonical.metadata.get("min_elevation_m"),
            "max_elevation_m": canonical.metadata.get("max_elevation_m"),
            "elevation_sampled_points": canonical.metadata.get("elevation_sampled_points", 0),
            "elevation_source": canonical.metadata.get("elevation_source"),
            "source_filename": path.metadata.get("import_filename"),
        },
        "geometry": path.geometry,
    }


def flatten_geometry_coordinates(geometry: dict) -> list[list[float]]:
    geometry_type = geometry.get("type")
    coordinates = geometry.get("coordinates", [])
    if geometry_type == "LineString":
        return coordinates
    if geometry_type == "MultiLineString":
        flattened: list[list[float]] = []
        for segment in coordinates:
            flattened.extend(segment)
        return flattened
    return []


class SavedPathGeoJsonView(View):
    def get(self, request, *args, **kwargs):
        queryset = SavedPath.objects.filter(status=SavedPath.STATUS_CANONICAL)
        features = [feature_from_saved_path(path) for path in queryset[:500]]
        return JsonResponse({"type": "FeatureCollection", "features": features})


class GpxImportView(View):
    SAME_PATH_THRESHOLD_METERS = 1.0

    def post(self, request, *args, **kwargs):
        uploaded_file = request.FILES.get("gpx_file")
        if uploaded_file is None:
            return JsonResponse({"error": "Missing GPX file."}, status=400)

        try:
            xml_text = uploaded_file.read().decode("utf-8")
        except UnicodeDecodeError:
            return JsonResponse({"error": "GPX file must be UTF-8 decodable."}, status=400)

        try:
            parsed = parse_gpx_text(xml_text, fallback_name=uploaded_file.name.rsplit(".", 1)[0])
        except ValueError as exc:
            return JsonResponse({"error": str(exc)}, status=422)

        elevation_summary = summarize_route_elevation(parsed.coordinates)
        best_match: SavedPath | None = None
        best_distance = float("inf")

        for candidate in SavedPath.objects.filter(status=SavedPath.STATUS_CANONICAL):
            candidate_coordinates = flatten_geometry_coordinates(candidate.geometry)
            distance = bidirectional_polyline_distance_meters(parsed.coordinates, candidate_coordinates)
            if distance < best_distance:
                best_distance = distance
                best_match = candidate

        if best_match is not None and best_distance <= self.SAME_PATH_THRESHOLD_METERS:
            saved_path = SavedPath.objects.create(
                name=parsed.name,
                source="gpx",
                status=SavedPath.STATUS_MERGED,
                geometry=parsed.geometry,
                original_gpx=xml_text,
                distance_meters=parsed.distance_meters,
                ascent_meters=elevation_summary.ascent_meters,
                descent_meters=elevation_summary.descent_meters,
                merged_into=best_match,
                metadata={
                    "merge_distance_meters": round(best_distance, 3),
                    "import_filename": uploaded_file.name,
                    "raw_point_count": parsed.raw_point_count,
                    "normalized_point_count": parsed.normalized_point_count,
                    "segment_count": parsed.segment_count,
                    "min_elevation_m": elevation_summary.min_elevation_m,
                    "max_elevation_m": elevation_summary.max_elevation_m,
                    "elevation_sampled_points": elevation_summary.sampled_points,
                    "elevation_source": elevation_summary.source,
                    "navigation_ready": True,
                },
            )
            return JsonResponse(
                {
                    "mode": "merged",
                    "saved_path": feature_from_saved_path(saved_path, canonical_for=best_match),
                    "canonical_path": feature_from_saved_path(best_match),
                },
                status=201,
            )

        saved_path = SavedPath.objects.create(
            name=parsed.name,
            source="gpx",
            status=SavedPath.STATUS_CANONICAL,
            geometry=parsed.geometry,
            original_gpx=xml_text,
            distance_meters=parsed.distance_meters,
            ascent_meters=elevation_summary.ascent_meters,
            descent_meters=elevation_summary.descent_meters,
            metadata={
                "import_filename": uploaded_file.name,
                "raw_point_count": parsed.raw_point_count,
                "normalized_point_count": parsed.normalized_point_count,
                "segment_count": parsed.segment_count,
                "min_elevation_m": elevation_summary.min_elevation_m,
                "max_elevation_m": elevation_summary.max_elevation_m,
                "elevation_sampled_points": elevation_summary.sampled_points,
                "elevation_source": elevation_summary.source,
                "navigation_ready": True,
            },
        )
        return JsonResponse(
            {
                "mode": "new",
                "saved_path": feature_from_saved_path(saved_path),
            },
            status=201,
        )


class ScenicSpotGeoJsonView(View):
    def get(self, request, *args, **kwargs):
        queryset = ScenicSpot.objects.all()

        min_lng = request.GET.get("min_lng")
        min_lat = request.GET.get("min_lat")
        max_lng = request.GET.get("max_lng")
        max_lat = request.GET.get("max_lat")
        category = request.GET.get("category")
        limit = request.GET.get("limit", "300")

        try:
            limit_value = min(max(int(limit), 1), 1000)
        except ValueError:
            return JsonResponse({"error": "Invalid limit."}, status=400)

        if category:
            queryset = queryset.filter(category=category)

        bbox_params = [min_lng, min_lat, max_lng, max_lat]
        if any(value is not None for value in bbox_params):
            try:
                if None in bbox_params:
                    raise ValidationError("Incomplete bounding box.")
                bbox = [float(value) for value in bbox_params]
            except (TypeError, ValueError, ValidationError):
                return JsonResponse({"error": "Invalid bounding box."}, status=400)

            queryset = queryset.filter(
                longitude__gte=bbox[0],
                latitude__gte=bbox[1],
                longitude__lte=bbox[2],
                latitude__lte=bbox[3],
            )

        features = []
        for spot in queryset[:limit_value]:
            features.append(
                {
                    "type": "Feature",
                    "properties": {
                        "id": spot.id,
                        "name": spot.name,
                        "category": spot.category,
                        "subcategory": spot.subcategory,
                    },
                    "geometry": {
                        "type": "Point",
                        "coordinates": [spot.longitude, spot.latitude],
                    },
                }
            )

        return JsonResponse({"type": "FeatureCollection", "features": features})
