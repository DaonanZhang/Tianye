from __future__ import annotations

from pathlib import Path

import osmium
from django.core.management.base import BaseCommand

from maps.models import ScenicSpot
from maps.routing import in_bounds


BASE_DIR = Path(__file__).resolve().parents[3]
SOURCE_PBF = BASE_DIR / "data" / "osm" / "beijing-latest.osm.pbf"

TOURISM_VALUES = {
    "attraction",
    "artwork",
    "gallery",
    "museum",
    "theme_park",
    "viewpoint",
    "zoo",
    "aquarium",
}
HISTORIC_VALUES = {
    "archaeological_site",
    "building",
    "castle",
    "city_gate",
    "fort",
    "memorial",
    "monument",
    "ruins",
    "site",
    "tomb",
}
LEISURE_VALUES = {
    "garden",
    "park",
}


def detect_category(tags: osmium.osm.TagList) -> tuple[str, str] | None:
    tourism = tags.get("tourism")
    if tourism in TOURISM_VALUES:
        return "tourism", tourism

    historic = tags.get("historic")
    if historic in HISTORIC_VALUES:
        return "historic", historic

    leisure = tags.get("leisure")
    if leisure in LEISURE_VALUES:
        return "leisure", leisure

    return None


def valid_name(tags: osmium.osm.TagList) -> str | None:
    for key in ("name", "name:zh", "name:en"):
        value = tags.get(key)
        if value:
            return value.strip()
    return None


def centroid_from_coords(coords: list[list[float]]) -> tuple[float, float] | None:
    if not coords:
        return None
    lon = sum(item[0] for item in coords) / len(coords)
    lat = sum(item[1] for item in coords) / len(coords)
    if not in_bounds(lon, lat):
        return None
    return lon, lat


class ScenicSpotCollector(osmium.SimpleHandler):
    def __init__(self) -> None:
        super().__init__()
        self.rows: list[ScenicSpot] = []

    def add_row(self, object_type: str, object_id: int, lon: float, lat: float, tags: osmium.osm.TagList) -> None:
        if not in_bounds(lon, lat):
            return

        category_info = detect_category(tags)
        name = valid_name(tags)
        if category_info is None or not name:
            return

        category, subcategory = category_info
        self.rows.append(
            ScenicSpot(
                source="osm",
                source_object_type=object_type,
                source_object_id=object_id,
                name=name,
                category=category,
                subcategory=subcategory,
                longitude=lon,
                latitude=lat,
                raw_tags=dict(tags),
            )
        )

    def node(self, node: osmium.osm.Node) -> None:
        if not node.location.valid():
            return
        self.add_row("node", node.id, node.location.lon, node.location.lat, node.tags)

    def way(self, way: osmium.osm.Way) -> None:
        coords = []
        for node_ref in way.nodes:
            if node_ref.location.valid():
                coords.append([node_ref.location.lon, node_ref.location.lat])
        centroid = centroid_from_coords(coords)
        if centroid is None:
            return
        self.add_row("way", way.id, centroid[0], centroid[1], way.tags)


class Command(BaseCommand):
    help = "Import scenic spots from the local Beijing OSM extract into the database."

    def add_arguments(self, parser):
        parser.add_argument(
            "--replace",
            action="store_true",
            help="Delete existing ScenicSpot records before import.",
        )

    def handle(self, *args, **options):
        if not SOURCE_PBF.exists():
            raise SystemExit(f"Missing source file: {SOURCE_PBF}")

        if options["replace"]:
            deleted_count, _ = ScenicSpot.objects.all().delete()
            self.stdout.write(self.style.WARNING(f"Deleted existing scenic spots: {deleted_count}"))

        collector = ScenicSpotCollector()
        collector.apply_file(str(SOURCE_PBF), locations=True)

        ScenicSpot.objects.bulk_create(
            collector.rows,
            batch_size=1000,
            update_conflicts=True,
            update_fields=[
                "name",
                "category",
                "subcategory",
                "longitude",
                "latitude",
                "raw_tags",
                "updated_at",
            ],
            unique_fields=["source", "source_object_type", "source_object_id"],
        )

        self.stdout.write(self.style.SUCCESS(f"Imported scenic spots: {len(collector.rows)}"))
