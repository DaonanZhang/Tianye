from __future__ import annotations

from functools import lru_cache
from pathlib import Path

from .demo import build_demo_route_payload, parse_demo_gpx


PROJECT_ROOT = Path(__file__).resolve().parent.parent
GPX_FIXTURE_DIR = PROJECT_ROOT / "beijing_test_gpx_routes"

DEMO_ROUTE_DEFINITIONS = [
    {
        "id": "forbidden-city-outer-walk",
        "name": "故宫外环步行线",
        "city": "北京",
        "description": "沿皇城外围慢慢走，适合把城市核心景观压缩成一次短时步行体验。",
        "tags": ["历史中轴", "城市漫游", "游客友好"],
        "filename": "beijing_forbidden_city_outer_walk.gpx",
        "rating": 4.7,
        "review_count": 842,
        "route_type": "Point to point",
        "cover_variant": "city-wall",
    },
    {
        "id": "shichahai-houhai-walk",
        "name": "什刹海后海步行线",
        "city": "北京",
        "description": "水岸与胡同交替出现，节奏轻，适合黄昏散步和拍照。",
        "tags": ["胡同", "水岸", "夜景"],
        "filename": "beijing_shichahai_houhai_walk.gpx",
        "rating": 4.8,
        "review_count": 1261,
        "route_type": "Loop",
        "cover_variant": "waterside",
    },
    {
        "id": "temple-of-heaven-loop",
        "name": "天坛环线",
        "city": "北京",
        "description": "典型的城市公园闭环路线，适合第一次体验本 demo。",
        "tags": ["公园", "闭环", "轻徒步"],
        "filename": "beijing_temple_of_heaven_loop.gpx",
        "rating": 4.6,
        "review_count": 679,
        "route_type": "Loop",
        "cover_variant": "temple",
    },
    {
        "id": "olympic-forest-park-loop",
        "name": "奥森公园环线",
        "city": "北京",
        "description": "大绿地与长距离步道结合，适合完整地展示路线分析和 AI 卡片。",
        "tags": ["奥森", "公园", "周末"],
        "filename": "beijing_olympic_forest_park_loop.gpx",
        "rating": 4.9,
        "review_count": 1912,
        "route_type": "Loop",
        "cover_variant": "forest",
    },
    {
        "id": "chaoyang-park-west-loop",
        "name": "朝阳公园西环线",
        "city": "北京",
        "description": "更接近日常城市轻运动场景，路线平稳，进入门槛低。",
        "tags": ["日常锻炼", "平缓", "公园"],
        "filename": "beijing_chaoyang_park_west_loop.gpx",
        "rating": 4.5,
        "review_count": 534,
        "route_type": "Loop",
        "cover_variant": "park",
    },
    {
        "id": "pause-and-wrong-turn-test",
        "name": "停留与偏航测试线",
        "city": "北京",
        "description": "用于展示系统如何在含停留与偏航行为的 GPX 上保持稳定分析。",
        "tags": ["行为测试", "停留点", "容错"],
        "filename": "beijing_location_pause_and_wrong_turn_test.gpx",
        "rating": 4.4,
        "review_count": 208,
        "route_type": "Demo trace",
        "cover_variant": "night",
    },
]


def list_demo_routes() -> list[dict]:
    return [
        {
            "id": item["id"],
            "name": item["name"],
            "city": item["city"],
            "description": item["description"],
            "tags": item["tags"],
            "rating": item["rating"],
            "review_count": item["review_count"],
            "route_type": item["route_type"],
            "cover_variant": item["cover_variant"],
        }
        for item in DEMO_ROUTE_DEFINITIONS
    ]


def get_demo_route_definition(route_id: str) -> dict | None:
    for item in DEMO_ROUTE_DEFINITIONS:
        if item["id"] == route_id:
            return item
    return None


@lru_cache(maxsize=16)
def load_demo_route_payload(route_id: str) -> dict:
    definition = get_demo_route_definition(route_id)
    if definition is None:
        raise KeyError(route_id)

    file_path = GPX_FIXTURE_DIR / definition["filename"]
    xml_text = file_path.read_text(encoding="utf-8")
    parsed = parse_demo_gpx(xml_text, fallback_name=definition["name"])
    return build_demo_route_payload(
        route_id=definition["id"],
        parsed_gpx=parsed,
        city=definition["city"],
        title=definition["name"],
        description=definition["description"],
        tags=definition["tags"],
        dependency="local-data",
        rating=definition["rating"],
        review_count=definition["review_count"],
        route_type=definition["route_type"],
        cover_variant=definition["cover_variant"],
    )
