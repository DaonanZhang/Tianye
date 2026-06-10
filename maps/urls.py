from django.urls import path

from .views import (
    ElevationLookupView,
    GpxImportView,
    HikeSessionFinishView,
    HikeSessionListView,
    HikeSessionStartView,
    MapPlaygroundView,
    RoutePreviewView,
    SavedPathGeoJsonView,
    ScenicSpotGeoJsonView,
)


app_name = "maps"

urlpatterns = [
    path("", MapPlaygroundView.as_view(), name="playground"),
    path("api/route-preview/", RoutePreviewView.as_view(), name="route-preview"),
    path("api/elevation/", ElevationLookupView.as_view(), name="elevation"),
    path("api/gpx-import/", GpxImportView.as_view(), name="gpx-import"),
    path("api/hike-sessions/", HikeSessionListView.as_view(), name="hike-sessions"),
    path("api/hike-sessions/start/", HikeSessionStartView.as_view(), name="hike-session-start"),
    path("api/hike-sessions/<int:session_id>/finish/", HikeSessionFinishView.as_view(), name="hike-session-finish"),
    path("api/saved-paths/", SavedPathGeoJsonView.as_view(), name="saved-paths"),
    path("api/scenic-spots/", ScenicSpotGeoJsonView.as_view(), name="scenic-spots"),
]
