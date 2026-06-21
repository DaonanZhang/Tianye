from django.urls import path

from .views import (
    CsrfCookieView,
    DemoHomeView,
    DemoRouteDataView,
    DemoRouteDetailView,
    DemoUploadPreviewView,
    DemoUploadView,
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
    path("", DemoHomeView.as_view(), name="demo-home"),
    path("routes/<slug:route_id>/", DemoRouteDetailView.as_view(), name="demo-route-detail"),
    path("upload/", DemoUploadView.as_view(), name="demo-upload"),
    path("playground/", MapPlaygroundView.as_view(), name="playground"),
    path("api/csrf/", CsrfCookieView.as_view(), name="csrf-cookie"),
    path("api/demo-routes/<slug:route_id>/", DemoRouteDataView.as_view(), name="demo-route-data"),
    path("api/demo-upload-preview/", DemoUploadPreviewView.as_view(), name="demo-upload-preview"),
    path("api/route-preview/", RoutePreviewView.as_view(), name="route-preview"),
    path("api/elevation/", ElevationLookupView.as_view(), name="elevation"),
    path("api/gpx-import/", GpxImportView.as_view(), name="gpx-import"),
    path("api/hike-sessions/", HikeSessionListView.as_view(), name="hike-sessions"),
    path("api/hike-sessions/start/", HikeSessionStartView.as_view(), name="hike-session-start"),
    path("api/hike-sessions/<int:session_id>/finish/", HikeSessionFinishView.as_view(), name="hike-session-finish"),
    path("api/saved-paths/", SavedPathGeoJsonView.as_view(), name="saved-paths"),
    path("api/scenic-spots/", ScenicSpotGeoJsonView.as_view(), name="scenic-spots"),
]
