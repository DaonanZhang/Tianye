import { useEffect, useMemo, useRef, useState } from "react";
import maplibregl from "maplibre-gl";
import { ensureCsrfCookie, fetchJson, postFormData, postJson } from "./lib/api.js";
import { loadDemoUserState, saveDemoUserState, createDemoUser } from "./lib/demo-user.js";
import { downloadRouteAsGpx } from "./lib/gpx.js";
import { formatDateTime, formatDistance, formatMinutes } from "./lib/format.js";
import {
  EMPTY_COLLECTION,
  EMPTY_LINE,
  buildCumulativeDistances,
  haversineMeters,
  nearestRouteMatch,
  pointsToFeatureCollection,
  sliceRouteToIndex,
} from "./lib/geo.js";
import { getMockRoutes } from "./lib/mockRoutes.js";

const BEIJING_BOUNDS = [
  [115.7, 39.5],
  [116.8, 40.1],
];

const TAB_ITEMS = [
  { id: "explore", label: "发现", icon: "search" },
  { id: "saved", label: "收藏", icon: "heart" },
  { id: "navigate", label: "导航", icon: "location" },
  { id: "activity", label: "记录", icon: "activity" },
  { id: "profile", label: "我的", icon: "user" },
];

const FILTERS = ["全部", "轻松", "中等", "环线"];
const ENABLE_CUSTOM_ROUTE_PICKER = false;

function featureLineBounds(feature) {
  const bounds = new maplibregl.LngLatBounds();
  const coordinates = feature?.geometry?.coordinates || [];
  coordinates.forEach((coordinate) => bounds.extend(coordinate));
  const start = feature?.properties?.start;
  const end = feature?.properties?.end;
  if (start) {
    bounds.extend(start);
  }
  if (end) {
    bounds.extend(end);
  }
  return bounds;
}

function flattenPreviewCoordinates(geometry) {
  if (!geometry) {
    return [];
  }
  if (geometry.type === "LineString") {
    return geometry.coordinates || [];
  }
  if (geometry.type === "MultiLineString") {
    return (geometry.coordinates || []).flat();
  }
  return [];
}

function buildRouteFeature(routePayload, start, end, overrides = {}) {
  return {
    ...routePayload,
    properties: {
      ...routePayload.properties,
      ...overrides,
      route_id: overrides.route_id || routePayload.properties?.route_id || `preview-${Date.now()}`,
      start,
      end,
      name: overrides.name || routePayload.properties?.name || "北京徒步路线",
      dependency: overrides.dependency || routePayload.properties?.dependency || "local-service",
      source: overrides.source || routePayload.properties?.source || "route-preview",
    },
  };
}

function RoutePreview({ coordinates }) {
  const points = coordinates || [];
  if (points.length < 2) {
    return <div className="route-preview route-preview-empty" />;
  }

  const lons = points.map((point) => point[0]);
  const lats = points.map((point) => point[1]);
  const minLon = Math.min(...lons);
  const maxLon = Math.max(...lons);
  const minLat = Math.min(...lats);
  const maxLat = Math.max(...lats);
  const lonSpan = Math.max(maxLon - minLon, 0.0001);
  const latSpan = Math.max(maxLat - minLat, 0.0001);

  const path = points
    .map(([lon, lat], index) => {
      const x = 18 + ((lon - minLon) / lonSpan) * 324;
      const y = 18 + (1 - (lat - minLat) / latSpan) * 154;
      return `${index === 0 ? "M" : "L"} ${x.toFixed(1)} ${y.toFixed(1)}`;
    })
    .join(" ");

  return (
    <div className="route-preview">
      <svg viewBox="0 0 360 190" aria-hidden="true">
        <defs>
          <linearGradient id="routeBg" x1="0%" y1="0%" x2="100%" y2="100%">
            <stop offset="0%" stopColor="#dcefd6" />
            <stop offset="48%" stopColor="#c5e4f4" />
            <stop offset="100%" stopColor="#eef2e8" />
          </linearGradient>
        </defs>
        <rect x="0" y="0" width="360" height="190" rx="28" fill="url(#routeBg)" />
        <path d="M 28 28 L 95 24 L 164 48 L 210 38 L 268 52 L 334 40" stroke="#ffffff" strokeWidth="7" opacity="0.75" fill="none" />
        <path d="M 24 112 L 108 76 L 196 118 L 330 156" stroke="#ffffff" strokeWidth="5" opacity="0.62" fill="none" />
        <path d="M 232 14 C 194 58 196 132 236 174" stroke="#a9d1eb" strokeWidth="50" opacity="0.72" fill="none" />
        <path d={path} stroke="#0f2d17" strokeWidth="10" strokeLinecap="round" strokeLinejoin="round" fill="none" opacity="0.92" />
        <path d={path} stroke="#41c557" strokeWidth="6" strokeLinecap="round" strokeLinejoin="round" fill="none" />
        <circle cx={18 + ((points[0][0] - minLon) / lonSpan) * 324} cy={18 + (1 - (points[0][1] - minLat) / latSpan) * 154} r="7" fill="#ffffff" stroke="#0f2d17" strokeWidth="3" />
        <circle cx={18 + ((points[points.length - 1][0] - minLon) / lonSpan) * 324} cy={18 + (1 - (points[points.length - 1][1] - minLat) / latSpan) * 154} r="9" fill="#111111" stroke="#ffffff" strokeWidth="4" />
      </svg>
    </div>
  );
}

function Icon({ name, className = "" }) {
  const common = { viewBox: "0 0 24 24", fill: "currentColor", "aria-hidden": "true", className };

  switch (name) {
    case "search":
      return <svg {...common}><path d="M10.5 3a7.5 7.5 0 1 0 4.72 13.33l4.22 4.23 1.06-1.06-4.23-4.22A7.5 7.5 0 0 0 10.5 3Zm0 1.5a6 6 0 1 1 0 12 6 6 0 0 1 0-12Z" /></svg>;
    case "heart":
      return <svg {...common}><path d="M12 20.4 10.95 19.45C5.1 14.14 2 11.32 2 7.86 2 5.04 4.2 3 7 3c1.58 0 3.09.74 4 1.9A5.2 5.2 0 0 1 15 3c2.8 0 5 2.04 5 4.86 0 3.46-3.1 6.28-8.95 11.59L12 20.4Z" /></svg>;
    case "location":
      return <svg {...common}><path d="m20.7 3.3-17 7a.75.75 0 0 0 .07 1.42l6.38 2.05 2.04 6.39a.75.75 0 0 0 1.42.06l7.09-16.97a.75.75 0 0 0-.98-.98Z" /></svg>;
    case "activity":
      return <svg {...common}><path d="M3 17.25h18v1.5H3v-1.5Zm1.5-2.5 4.65-5.53 3.1 3.34 4.34-6.06 1.22.88-5.43 7.57-3.17-3.42-3.56 4.22-1.15-1Z" /></svg>;
    case "user":
      return <svg {...common}><path d="M12 12a4.5 4.5 0 1 0-4.5-4.5A4.5 4.5 0 0 0 12 12Zm0-7.5A3 3 0 1 1 9 7.5a3 3 0 0 1 3-3Zm0 9c-4.3 0-7.8 2.2-7.8 4.9v.6h15.6v-.6c0-2.7-3.5-4.9-7.8-4.9Z" /></svg>;
    case "download":
      return <svg {...common}><path d="M11.25 3h1.5v9.19l2.97-2.97 1.06 1.06-4.78 4.78-4.78-4.78 1.06-1.06 2.97 2.97V3ZM4 18.75h16v1.5H4v-1.5Z" /></svg>;
    case "back":
      return <svg {...common}><path d="m12.72 4.22-1.06-1.06L3.81 11l7.85 7.84 1.06-1.06L6.69 11l6.03-6.78Z" /></svg>;
    case "more":
      return <svg {...common}><path d="M5.5 10.5A1.5 1.5 0 1 0 7 12a1.5 1.5 0 0 0-1.5-1.5Zm6.5 0a1.5 1.5 0 1 0 1.5 1.5 1.5 1.5 0 0 0-1.5-1.5Zm6.5 0A1.5 1.5 0 1 0 20 12a1.5 1.5 0 0 0-1.5-1.5Z" /></svg>;
    case "import":
      return <svg {...common}><path d="M11.25 21h1.5v-9.19l2.97 2.97 1.06-1.06-4.78-4.78-4.78 4.78 1.06 1.06 2.97-2.97V21ZM4 3.75h16v1.5H4v-1.5Z" /></svg>;
    case "play":
      return <svg {...common}><path d="M7 5.5v13l10-6.5-10-6.5Z" /></svg>;
    case "map":
      return <svg {...common}><path d="M15.5 4 9 6.2 3.5 4v16l5.5 2.2 6.5-2.2 5.5 2.2V6L15.5 4Z" /></svg>;
    default:
      return null;
  }
}

function buildRouteRecord(route) {
  const coordinates = route.coordinates || flattenPreviewCoordinates(route.geometry);
  const distanceMeters = route.distanceMeters || route.properties?.distance_meters || 0;
  const ascentMeters = route.ascentMeters || route.properties?.ascent_meters || 0;
  const estimatedMinutes =
    route.estimatedMinutes || route.properties?.estimated_time?.recommended_minutes || Math.round(distanceMeters / 70);

  return {
    ...route,
    type: "Feature",
    id: route.id || route.properties?.route_id,
    name: route.name || route.properties?.name || "未命名路线",
    titleNative: route.titleNative || route.name || route.properties?.name || "未命名路线",
    location: route.location || "北京，中国",
    difficulty: route.difficulty || "中等",
    rating: route.rating || 4.0,
    downloads: route.downloads || 0,
    estimatedMinutes,
    ascentMeters,
    distanceMeters,
    routeType: route.routeType || "往返",
    description:
      route.description ||
      "这条路线当前以演示数据方式展示，使用本地几何路径和示例文案，让详情页、收藏和 GPX 下载流程都可以完整跑通。",
    tags: route.tags || ["演示路线"],
    coordinates,
    geometry: route.geometry || { type: "LineString", coordinates },
    properties: {
      ...route.properties,
      route_id: route.id || route.properties?.route_id,
      name: route.name || route.properties?.name || "未命名路线",
      start: route.properties?.start || coordinates[0],
      end: route.properties?.end || coordinates[coordinates.length - 1],
      distance_meters: distanceMeters,
      ascent_meters: ascentMeters,
      estimated_time: { recommended_minutes: estimatedMinutes },
      dependency: route.properties?.dependency || route.dependency || "dummy-local-data",
      source: route.properties?.source || route.source || "mock-route",
    },
  };
}

export default function App() {
  const mapContainerRef = useRef(null);
  const mapRef = useRef(null);
  const popupRef = useRef(null);
  const userMarkerRef = useRef(null);
  const userMarkerElementRef = useRef(null);
  const selectedPointsRef = useRef([]);
  const routeFeatureRef = useRef(null);
  const routeMetricsRef = useRef({ totalDistance: 0, cumulativeDistances: [0] });
  const currentLocationRef = useRef(null);
  const routeInteractionLockedRef = useRef(false);
  const shouldFitRouteWithUserRef = useRef(false);
  const rawTrackRef = useRef([]);
  const walkedDistanceRef = useRef(0);
  const deviationCountRef = useRef(0);
  const offRouteRef = useRef(false);
  const watchIdRef = useRef(null);
  const activeSessionIdRef = useRef(null);
  const activeRouteIdRef = useRef(null);
  const scenicRequestRef = useRef(null);
  const routeCatalogRef = useRef(new Map());
  const lastElevationFetchAtRef = useRef(0);
  const headingRef = useRef(0);
  const headingSourceRef = useRef("none");
  const orientationCleanupRef = useRef(null);
  const trackingReadyWaitersRef = useRef([]);
  const fileInputRef = useRef(null);
  const mockRoutes = useMemo(() => getMockRoutes().map(buildRouteRecord), []);
  const initialUserState = useMemo(() => loadDemoUserState(), []);

  const [status, setStatus] = useState("地图加载中。");
  const [searchTerm, setSearchTerm] = useState("");
  const [activeTab, setActiveTab] = useState("explore");
  const [activeFilter, setActiveFilter] = useState("全部");
  const [isSheetExpanded, setIsSheetExpanded] = useState(true);
  const [routeDistance, setRouteDistance] = useState("未生成");
  const [routeAscent, setRouteAscent] = useState("未生成");
  const [routeDuration, setRouteDuration] = useState("未生成");
  const [walkedDistance, setWalkedDistance] = useState("0 m");
  const [remainingDistance, setRemainingDistance] = useState("未选择路径");
  const [currentLocationLabel, setCurrentLocationLabel] = useState("未获取");
  const [currentAltitude, setCurrentAltitude] = useState("未知");
  const [savedPaths, setSavedPaths] = useState([]);
  const [recentHikes, setRecentHikes] = useState([]);
  const [gpxStatus, setGpxStatus] = useState("导入 GPX 后会生成一条本地路线并进入当前列表。");
  const [sessionStatus, setSessionStatus] = useState("最近徒步记录会显示在这里。");
  const [isTracking, setIsTracking] = useState(false);
  const [hasLocationFix, setHasLocationFix] = useState(false);
  const [isHiking, setIsHiking] = useState(false);
  const [isUploading, setIsUploading] = useState(false);
  const [isStartingHike, setIsStartingHike] = useState(false);
  const [isFinishingHike, setIsFinishingHike] = useState(false);
  const [activeDetailRoute, setActiveDetailRoute] = useState(null);
  const [users, setUsers] = useState(initialUserState.users);
  const [currentUserId, setCurrentUserId] = useState(initialUserState.currentUserId);
  const [favoritesByUser, setFavoritesByUser] = useState(initialUserState.favoritesByUser);
  const [downloadsByUser, setDownloadsByUser] = useState(initialUserState.downloadsByUser);
  const [newUserName, setNewUserName] = useState("");

  const currentUser = users.find((user) => user.id === currentUserId) || users[0];
  const favoriteIds = new Set(favoritesByUser[currentUserId] || []);
  const downloadedIds = new Set(downloadsByUser[currentUserId] || []);

  useEffect(() => {
    saveDemoUserState({
      currentUserId,
      users,
      favoritesByUser,
      downloadsByUser,
    });
  }, [currentUserId, users, favoritesByUser, downloadsByUser]);

  function setSourceData(sourceId, data) {
    mapRef.current?.getSource(sourceId)?.setData(data);
  }

  function updateUserMarkerRotation() {
    const markerElement = userMarkerElementRef.current;
    if (!markerElement) {
      return;
    }
    markerElement.style.setProperty("--bearing", `${headingRef.current}deg`);
  }

  function createUserMarker() {
    if (userMarkerElementRef.current) {
      return userMarkerElementRef.current;
    }

    const element = document.createElement("div");
    element.className = "user-nav-marker";
    element.innerHTML = `
      <div class="user-nav-marker-core">
        <svg viewBox="0 0 24 24" class="user-nav-marker-svg" aria-hidden="true">
          <path fill="currentColor" d="m20.7 3.3-17 7a.75.75 0 0 0 .07 1.42l6.38 2.05 2.04 6.39a.75.75 0 0 0 1.42.06l7.09-16.97a.75.75 0 0 0-.98-.98Z"/>
        </svg>
      </div>
    `;
    userMarkerElementRef.current = element;
    updateUserMarkerRotation();
    return element;
  }

  function ensureUserMarker(coordinates) {
    const map = mapRef.current;
    if (!map) {
      return;
    }

    if (!userMarkerRef.current) {
      userMarkerRef.current = new maplibregl.Marker({
        element: createUserMarker(),
        anchor: "center",
        rotationAlignment: "map",
        pitchAlignment: "map",
      })
        .setLngLat(coordinates)
        .addTo(map);
      return;
    }

    userMarkerRef.current.setLngLat(coordinates);
  }

  async function ensureDeviceOrientationTracking() {
    if (orientationCleanupRef.current) {
      return;
    }
    if (typeof window === "undefined" || typeof window.addEventListener !== "function") {
      return;
    }
    if (typeof DeviceOrientationEvent === "undefined") {
      return;
    }

    try {
      if (typeof DeviceOrientationEvent.requestPermission === "function") {
        const permission = await DeviceOrientationEvent.requestPermission();
        if (permission !== "granted") {
          return;
        }
      }
    } catch {
      return;
    }

    const handleOrientation = (event) => {
      const alpha = typeof event.alpha === "number" ? event.alpha : null;
      if (alpha === null) {
        return;
      }

      const webkitHeading = typeof event.webkitCompassHeading === "number" ? event.webkitCompassHeading : null;
      const heading = webkitHeading ?? (360 - alpha);
      headingRef.current = ((heading % 360) + 360) % 360;
      headingSourceRef.current = "deviceorientation";
      updateUserMarkerRotation();
    };

    window.addEventListener("deviceorientation", handleOrientation, true);
    orientationCleanupRef.current = () => {
      window.removeEventListener("deviceorientation", handleOrientation, true);
      orientationCleanupRef.current = null;
    };
  }

  function syncSelectedPoints() {
    setSourceData("selected-points", pointsToFeatureCollection(selectedPointsRef.current));
  }

  function resetTrackingVisuals() {
    rawTrackRef.current = [];
    walkedDistanceRef.current = 0;
    deviationCountRef.current = 0;
    offRouteRef.current = false;
    setHasLocationFix(false);
    setSourceData("walked-route", EMPTY_LINE);
    setSourceData("raw-track", EMPTY_LINE);
    setWalkedDistance("0 m");
    const total = routeMetricsRef.current.totalDistance;
    setRemainingDistance(total > 0 ? formatDistance(total) : "未选择路径");
  }

  function applyRouteFeature(feature, { fitBounds = true, statusText } = {}) {
    routeFeatureRef.current = feature;
    activeRouteIdRef.current = feature?.properties?.route_id || null;
    const coordinates = feature?.geometry?.coordinates || [];
    const cumulativeDistances = buildCumulativeDistances(coordinates);
    const totalDistance = cumulativeDistances[cumulativeDistances.length - 1] || 0;
    routeMetricsRef.current = { totalDistance, cumulativeDistances };
    setSourceData("preview-route", feature || EMPTY_LINE);
    setRouteDistance(formatDistance(feature?.properties?.distance_meters ?? totalDistance));
    setRouteAscent(Number.isFinite(feature?.properties?.ascent_meters) ? `${Math.round(feature.properties.ascent_meters)} m` : "未生成");
    setRouteDuration(formatMinutes(feature?.properties?.estimated_time?.recommended_minutes));
    setRemainingDistance(totalDistance > 0 ? formatDistance(totalDistance) : "未选择路径");
    resetTrackingVisuals();
    selectedPointsRef.current = [feature?.properties?.start, feature?.properties?.end].filter(Boolean);
    syncSelectedPoints();

    if (fitBounds && coordinates.length > 1) {
      const bounds = featureLineBounds(feature);
      if (!bounds.isEmpty()) {
        mapRef.current?.fitBounds(bounds, { padding: 72, duration: 700 });
      }
    }

    if (statusText) {
      setStatus(statusText);
    }
  }

  function fitRouteWithCurrentLocation() {
    const map = mapRef.current;
    const routeFeature = routeFeatureRef.current;
    const currentLocation = currentLocationRef.current;
    if (!map || !routeFeature) {
      return;
    }

    const bounds = featureLineBounds(routeFeature);
    if (currentLocation) {
      bounds.extend(currentLocation);
    }

    if (!bounds.isEmpty()) {
      map.fitBounds(bounds, {
        padding: { top: 92, right: 48, bottom: 240, left: 48 },
        duration: 700,
      });
    }
  }

  function openRouteDetail(route) {
    const record = buildRouteRecord(route);
    routeInteractionLockedRef.current = true;
    setActiveDetailRoute(record);
    selectRoute(record, { statusText: `已打开“${record.name}”详情。`, fitBounds: true });
  }

  function closeRouteDetail() {
    setActiveDetailRoute(null);
  }

  function requestInitialLocation() {
    if (!("geolocation" in navigator)) {
      return;
    }

    navigator.geolocation.getCurrentPosition(
      (position) => {
        const coordinates = [position.coords.longitude, position.coords.latitude];
        updateLivePosition(coordinates);
        mapRef.current?.easeTo({
          center: coordinates,
          zoom: 13.5,
          duration: 900,
        });
        setStatus("已定位到当前位置。请选择一条路线，或在允许时开始自定义路线。");
      },
      () => {
        setStatus("未获取到当前位置。你可以先浏览路线，稍后再开始定位。");
      },
      {
        enableHighAccuracy: true,
        maximumAge: 60000,
        timeout: 8000,
      },
    );
  }

  async function loadSavedPaths() {
    try {
      const payload = await fetchJson("/api/saved-paths/");
      const features = (payload.features || []).map((feature) =>
        buildRouteRecord({
          ...feature,
          id: `saved-${feature.properties.canonical_path_id || feature.properties.id}`,
          name: feature.properties.name,
          titleNative: feature.properties.name,
          location: "本地已保存路线",
          difficulty: "已保存",
          rating: 4.0,
          downloads: 0,
          routeType: "本地路线",
        }),
      );
      setSavedPaths(features);
      setSourceData("saved-paths", {
        type: "FeatureCollection",
        features,
      });
    } catch (error) {
      setStatus(`本地路径读取失败：${error.message}`);
    }
  }

  async function loadRecentHikes() {
    try {
      const payload = await fetchJson("/api/hike-sessions/");
      const sessions = payload.sessions || [];
      setRecentHikes(sessions);
      setSessionStatus(sessions.length ? "最近徒步记录已更新。" : "暂无徒步记录。");
    } catch (error) {
      setSessionStatus(`最近徒步记录读取失败：${error.message}`);
    }
  }

  async function loadScenicSpots() {
    const map = mapRef.current;
    if (!map) {
      return;
    }
    const bounds = map.getBounds();
    const query = new URLSearchParams({
      min_lng: bounds.getWest(),
      min_lat: bounds.getSouth(),
      max_lng: bounds.getEast(),
      max_lat: bounds.getNorth(),
      limit: "250",
    });
    scenicRequestRef.current = query.toString();
    try {
      const payload = await fetchJson(`/api/scenic-spots/?${query.toString()}`);
      if (scenicRequestRef.current === query.toString()) {
        setSourceData("scenic-spots", payload);
      }
    } catch (error) {
      setStatus(`景点图层读取失败：${error.message}`);
    }
  }

  async function refreshElevation(lng, lat) {
    const now = Date.now();
    if (now - lastElevationFetchAtRef.current < 15000) {
      return;
    }
    lastElevationFetchAtRef.current = now;
    try {
      const payload = await fetchJson(`/api/elevation/?lng=${lng}&lat=${lat}`);
      setCurrentAltitude(`${Math.round(payload.elevation_m)} m`);
    } catch {
      setCurrentAltitude("未知");
    }
  }

  function updateLivePosition(coordinates) {
    const [lng, lat] = coordinates;
    currentLocationRef.current = coordinates;
    setHasLocationFix(true);
    if (trackingReadyWaitersRef.current.length) {
      trackingReadyWaitersRef.current.forEach(({ resolve }) => resolve(coordinates));
      trackingReadyWaitersRef.current = [];
    }
    setCurrentLocationLabel(`${lng.toFixed(5)}, ${lat.toFixed(5)}`);
    ensureUserMarker(coordinates);
    setSourceData("user-location", {
      type: "FeatureCollection",
      features: [{ type: "Feature", properties: {}, geometry: { type: "Point", coordinates } }],
    });
    refreshElevation(lng, lat);

    if (activeTab === "navigate" && routeInteractionLockedRef.current && shouldFitRouteWithUserRef.current) {
      fitRouteWithCurrentLocation();
      shouldFitRouteWithUserRef.current = false;
    }
  }

  function updateTrackingMetrics(coordinates) {
    const routeFeature = routeFeatureRef.current;
    if (!routeFeature) {
      return;
    }
    const routeCoordinates = routeFeature.geometry.coordinates || [];
    const metrics = routeMetricsRef.current;
    const match = nearestRouteMatch(coordinates, routeCoordinates);
    const matchedDistance = metrics.cumulativeDistances[match.index] || 0;
    const remaining = Math.max(metrics.totalDistance - matchedDistance, 0);
    setSourceData("walked-route", {
      type: "Feature",
      properties: {},
      geometry: { type: "LineString", coordinates: sliceRouteToIndex(routeCoordinates, match.index) },
    });
    setRemainingDistance(formatDistance(remaining));
    const wasOffRoute = offRouteRef.current;
    const isOffRouteNow = match.distanceMeters > 60;
    if (!wasOffRoute && isOffRouteNow) {
      deviationCountRef.current += 1;
    }
    offRouteRef.current = isOffRouteNow;
  }

  function appendTrackPoint(coordinates) {
    const track = rawTrackRef.current;
    if (track.length > 0) {
      walkedDistanceRef.current += haversineMeters(track[track.length - 1], coordinates);
    }
    track.push(coordinates);
    setWalkedDistance(formatDistance(walkedDistanceRef.current));
    setSourceData("raw-track", {
      type: "Feature",
      properties: {},
      geometry: { type: "LineString", coordinates: track },
    });
    updateTrackingMetrics(coordinates);
  }

  async function requestRoutePreview(start, end) {
    setStatus("正在根据本地路网计算路线。");
    const query = new URLSearchParams({
      start_lng: start[0],
      start_lat: start[1],
      end_lng: end[0],
      end_lat: end[1],
    });
    const payload = await fetchJson(`/api/route-preview/?${query.toString()}`);
    const feature = buildRouteFeature(payload, start, end, {
      routeType: "路线预览",
    });
    routeInteractionLockedRef.current = false;
    shouldFitRouteWithUserRef.current = false;
    applyRouteFeature(feature, {
      fitBounds: true,
      statusText: "路线已生成。现在可以导航或开始徒步。",
    });
    setActiveTab("navigate");
    setIsSheetExpanded(false);
  }

  function selectRoute(route, options = {}) {
    const feature = buildRouteRecord(route);
    routeInteractionLockedRef.current = true;
    shouldFitRouteWithUserRef.current = true;
    applyRouteFeature(feature, {
      fitBounds: true,
      statusText: `已切换到“${feature.name}”。`,
      ...options,
    });
  }

  async function handleMapClick(event) {
    if (!ENABLE_CUSTOM_ROUTE_PICKER) {
      return;
    }

    if (routeInteractionLockedRef.current) {
      return;
    }

    const map = mapRef.current;
    if (!map) {
      return;
    }
    const activeLayers = ["saved-paths-hit", "scenic-spots-circle"].filter((id) => map.getLayer(id));
    if (activeLayers.length > 0) {
      const hits = map.queryRenderedFeatures(event.point, { layers: activeLayers });
      if (hits.length > 0) {
        return;
      }
    }
    if (selectedPointsRef.current.length === 2) {
      selectedPointsRef.current = [];
      setSourceData("preview-route", EMPTY_LINE);
      resetTrackingVisuals();
    }
    selectedPointsRef.current.push([event.lngLat.lng, event.lngLat.lat]);
    syncSelectedPoints();
    if (selectedPointsRef.current.length === 1) {
      setStatus("已选择起点。请再点一个终点。");
      return;
    }
    try {
      await requestRoutePreview(selectedPointsRef.current[0], selectedPointsRef.current[1]);
    } catch (error) {
      setStatus(`路线计算失败：${error.message}`);
      setSourceData("preview-route", EMPTY_LINE);
    }
  }

  function startTracking({ pendingStatus = "正在获取定位...", activeStatus = "定位已开始。" } = {}) {
    if (!("geolocation" in navigator)) {
      const error = new Error("当前浏览器不支持定位。");
      setStatus(error.message);
      return Promise.reject(error);
    }

    if (watchIdRef.current !== null && hasLocationFix && currentLocationRef.current) {
      return Promise.resolve(currentLocationRef.current);
    }

    const readyPromise = new Promise((resolve, reject) => {
      trackingReadyWaitersRef.current.push({ resolve, reject });
    });

    if (watchIdRef.current !== null) {
      return readyPromise;
    }

    ensureDeviceOrientationTracking();
    const watchId = navigator.geolocation.watchPosition(
      (position) => {
        const coordinates = [position.coords.longitude, position.coords.latitude];
        if (typeof position.coords.heading === "number" && !Number.isNaN(position.coords.heading) && headingSourceRef.current !== "deviceorientation") {
          headingRef.current = position.coords.heading;
          headingSourceRef.current = "geolocation";
          updateUserMarkerRotation();
        }
        updateLivePosition(coordinates);
        appendTrackPoint(coordinates);
        setStatus(activeStatus);
        if (activeTab === "navigate") {
          mapRef.current?.easeTo({ center: coordinates, duration: 600 });
        }
      },
      (error) => {
        if (watchIdRef.current !== null) {
          navigator.geolocation.clearWatch(watchIdRef.current);
          watchIdRef.current = null;
        }
        trackingReadyWaitersRef.current.forEach(({ reject }) => reject(error));
        trackingReadyWaitersRef.current = [];
        setIsTracking(false);
        setHasLocationFix(false);
        setStatus(`定位失败：${error.message}`);
      },
      { enableHighAccuracy: true, maximumAge: 3000, timeout: 10000 },
    );
    watchIdRef.current = watchId;
    setIsTracking(true);
    setStatus(pendingStatus);
    return readyPromise;
  }

  function stopTracking({ statusText = "定位已停止。", keepLastFix = true } = {}) {
    if (watchIdRef.current !== null) {
      navigator.geolocation.clearWatch(watchIdRef.current);
      watchIdRef.current = null;
    }
    trackingReadyWaitersRef.current.forEach(({ reject }) => reject(new Error("定位已停止。")));
    trackingReadyWaitersRef.current = [];
    setIsTracking(false);
    setHasLocationFix(keepLastFix ? Boolean(currentLocationRef.current) : false);
    if (statusText) {
      setStatus(statusText);
    }
  }

  async function startHike() {
    const routeFeature = routeFeatureRef.current;
    if (!routeFeature) {
      setStatus("请先选择一条路线。");
      return;
    }
    setIsStartingHike(true);
    try {
      await startTracking({
        pendingStatus: "开始徒步前正在获取定位...",
        activeStatus: "定位已开始，准备启动徒步。",
      });
      await ensureCsrfCookie();
      const payload = await postJson("/api/hike-sessions/start/", { route: routeFeature });
      activeSessionIdRef.current = payload.id;
      setIsHiking(true);
      setStatus("徒步已开始，正在持续记录位置。");
      setSessionStatus(`当前会话 #${payload.id}。`);
      setActiveTab("navigate");
      setIsSheetExpanded(false);
    } catch (error) {
      setStatus(`开始徒步失败：${error.message}`);
    } finally {
      setIsStartingHike(false);
    }
  }

  async function finishHike() {
    if (!activeSessionIdRef.current) {
      setStatus("当前没有进行中的会话。");
      return;
    }
    setIsFinishingHike(true);
    try {
      await ensureCsrfCookie();
      const routeMetrics = routeMetricsRef.current;
      const routeCoordinates = routeFeatureRef.current?.geometry?.coordinates || [];
      const lastPoint = rawTrackRef.current[rawTrackRef.current.length - 1];
      let walkedRouteDistance = 0;
      if (lastPoint && routeCoordinates.length) {
        const match = nearestRouteMatch(lastPoint, routeCoordinates);
        walkedRouteDistance = routeMetrics.cumulativeDistances[match.index] || 0;
      }
      await postJson(`/api/hike-sessions/${activeSessionIdRef.current}/finish/`, {
        actual_track: {
          type: "Feature",
          properties: {},
          geometry: { type: "LineString", coordinates: rawTrackRef.current },
        },
        summary: {
          walked_distance_meters: walkedDistanceRef.current,
          walked_route_distance_meters: walkedRouteDistance,
          completion_ratio: routeMetrics.totalDistance > 0 ? walkedRouteDistance / routeMetrics.totalDistance : 0,
          deviation_count: deviationCountRef.current,
        },
      });
      activeSessionIdRef.current = null;
      setIsHiking(false);
      stopTracking({ statusText: null, keepLastFix: true });
      setStatus("徒步会话已完成。");
      await loadRecentHikes();
    } catch (error) {
      setStatus(`结束徒步失败：${error.message}`);
    } finally {
      setIsFinishingHike(false);
    }
  }

  async function uploadGpx() {
    const file = fileInputRef.current?.files?.[0];
    if (!file) {
      setGpxStatus("请先选择一个 GPX 文件。");
      return;
    }
    setIsUploading(true);
    try {
      const formData = new FormData();
      formData.append("gpx_file", file);
      const payload = await postFormData("/api/gpx-import/", formData);
      const feature = buildRouteRecord(payload.mode === "merged" ? payload.canonical_path : payload.saved_path);
      await loadSavedPaths();
      openRouteDetail(feature);
      setGpxStatus(payload.mode === "merged" ? "GPX 已归并到已有路径。" : "GPX 已保存为新路径。");
      setActiveTab("saved");
      if (fileInputRef.current) {
        fileInputRef.current.value = "";
      }
    } catch (error) {
      setGpxStatus(`GPX 导入失败：${error.message}`);
    } finally {
      setIsUploading(false);
    }
  }

  function centerOnUser() {
    if (!currentLocationRef.current) {
      shouldFitRouteWithUserRef.current = true;
      startTracking().catch(() => {});
      setStatus("正在请求定位。");
      return;
    }

    if (routeInteractionLockedRef.current && routeFeatureRef.current) {
      fitRouteWithCurrentLocation();
      shouldFitRouteWithUserRef.current = false;
      setStatus("地图已调整为同时显示当前位置和整条路线。");
      return;
    }

    mapRef.current?.easeTo({ center: currentLocationRef.current, zoom: 15, duration: 700 });
    setStatus("地图已切到当前位置。");
  }

  function toggleFavorite(routeId) {
    setFavoritesByUser((current) => {
      const currentIds = new Set(current[currentUserId] || []);
      if (currentIds.has(routeId)) {
        currentIds.delete(routeId);
      } else {
        currentIds.add(routeId);
      }
      return {
        ...current,
        [currentUserId]: [...currentIds],
      };
    });
  }

  function handleDownloadRoute(route) {
    downloadRouteAsGpx(route);
    setDownloadsByUser((current) => {
      const currentIds = new Set(current[currentUserId] || []);
      currentIds.add(route.id);
      return {
        ...current,
        [currentUserId]: [...currentIds],
      };
    });
    setGpxStatus(`已为 ${currentUser.name} 下载 “${route.name}” 的 GPX。`);
  }

  function createUserAndSwitch() {
    const trimmed = newUserName.trim();
    if (!trimmed) {
      return;
    }
    const user = createDemoUser(trimmed);
    setUsers((current) => [...current, user]);
    setCurrentUserId(user.id);
    setNewUserName("");
  }

  useEffect(() => {
    if (!mapContainerRef.current || mapRef.current) {
      return undefined;
    }

    const map = new maplibregl.Map({
      container: mapContainerRef.current,
      style: {
        version: 8,
        sources: {
          "osm-raster": {
            type: "raster",
            tiles: ["https://tile.openstreetmap.org/{z}/{x}/{y}.png"],
            tileSize: 256,
            attribution: "OpenStreetMap",
          },
        },
        layers: [
          { id: "background", type: "background", paint: { "background-color": "#eaf0e4" } },
          { id: "osm-raster", type: "raster", source: "osm-raster", paint: { "raster-opacity": 0.8, "raster-saturation": -0.16 } },
        ],
      },
      center: [116.281, 40.018],
      zoom: 11.8,
      minZoom: 9,
      maxZoom: 17,
      maxBounds: BEIJING_BOUNDS,
      renderWorldCopies: false,
    });
    mapRef.current = map;
    popupRef.current = new maplibregl.Popup({ closeButton: false, closeOnClick: false, offset: 14 });
    map.addControl(new maplibregl.NavigationControl(), "top-right");

    const handleLoad = async () => {
      try {
        const [walkways, parks, water, places] = await Promise.all([
          fetchJson("/data/beijing-walkways.geojson"),
          fetchJson("/data/beijing-parks.geojson"),
          fetchJson("/data/beijing-water.geojson"),
          fetchJson("/data/beijing-places.geojson"),
        ]);
        map.addSource("beijing-water", { type: "geojson", data: water });
        map.addSource("beijing-parks", { type: "geojson", data: parks });
        map.addSource("beijing-walkways", { type: "geojson", data: walkways });
        map.addSource("beijing-places", { type: "geojson", data: places });
        map.addSource("scenic-spots", { type: "geojson", data: EMPTY_COLLECTION });
        map.addSource("discover-routes", { type: "geojson", data: EMPTY_COLLECTION });
        map.addSource("saved-paths", { type: "geojson", data: EMPTY_COLLECTION });
        map.addSource("selected-points", { type: "geojson", data: EMPTY_COLLECTION });
        map.addSource("preview-route", { type: "geojson", data: EMPTY_LINE });
        map.addSource("walked-route", { type: "geojson", data: EMPTY_LINE });
        map.addSource("raw-track", { type: "geojson", data: EMPTY_LINE });
        map.addSource("user-location", { type: "geojson", data: EMPTY_COLLECTION });

        map.addLayer({ id: "beijing-water-fill", type: "fill", source: "beijing-water", filter: ["==", ["geometry-type"], "Polygon"], paint: { "fill-color": "#b7d9eb", "fill-opacity": 0.56 } });
        map.addLayer({ id: "beijing-water-line", type: "line", source: "beijing-water", filter: ["==", ["geometry-type"], "LineString"], paint: { "line-color": "#78aec8", "line-width": 1.7, "line-opacity": 0.88 } });
        map.addLayer({ id: "beijing-parks-fill", type: "fill", source: "beijing-parks", paint: { "fill-color": "#d1e7c6", "fill-opacity": 0.42 } });
        map.addLayer({
          id: "beijing-walkways-line",
          type: "line",
          source: "beijing-walkways",
          paint: {
            "line-color": ["match", ["get", "class"], ["pedestrian", "footway", "living_street"], "#645743", ["primary", "secondary"], "#8b7d68", "#a39782"],
            "line-width": ["interpolate", ["linear"], ["zoom"], 9, 0.8, 12, 1.9, 15, 3.1],
            "line-opacity": 0.78,
          },
        });
        map.addLayer({
          id: "discover-routes-line",
          type: "line",
          source: "discover-routes",
          layout: { "line-cap": "round", "line-join": "round" },
          paint: {
            "line-color": "#1a8f43",
            "line-width": ["interpolate", ["linear"], ["zoom"], 10, 2.4, 13, 4.2, 15, 6.2],
            "line-opacity": 0.72,
          },
        });
        map.addLayer({
          id: "discover-routes-hit",
          type: "line",
          source: "discover-routes",
          layout: { "line-cap": "round", "line-join": "round" },
          paint: { "line-color": "#000000", "line-width": 20, "line-opacity": 0 },
        });
        map.addLayer({ id: "saved-paths-line", type: "line", source: "saved-paths", layout: { "line-cap": "round", "line-join": "round" }, paint: { "line-color": "#63bc71", "line-width": ["interpolate", ["linear"], ["zoom"], 10, 1.3, 14, 3.4], "line-opacity": 0.34 } });
        map.addLayer({ id: "saved-paths-hit", type: "line", source: "saved-paths", layout: { "line-cap": "round", "line-join": "round" }, paint: { "line-color": "#000000", "line-width": 16, "line-opacity": 0 } });
        map.addLayer({ id: "preview-route-glow", type: "line", source: "preview-route", layout: { "line-cap": "round", "line-join": "round" }, paint: { "line-color": "#89e094", "line-width": 14, "line-opacity": 0.24 } });
        map.addLayer({ id: "preview-route-line", type: "line", source: "preview-route", layout: { "line-cap": "round", "line-join": "round" }, paint: { "line-color": "#1aaa3f", "line-width": 6, "line-opacity": 0.97 } });
        map.addLayer({ id: "walked-route-line", type: "line", source: "walked-route", layout: { "line-cap": "round", "line-join": "round" }, paint: { "line-color": "#0f5630", "line-width": 7, "line-opacity": 0.9 } });
        map.addLayer({ id: "raw-track-line", type: "line", source: "raw-track", layout: { "line-cap": "round", "line-join": "round" }, paint: { "line-color": "#173628", "line-width": 2.8, "line-dasharray": [1, 1.5], "line-opacity": 0.62 } });
        map.addLayer({ id: "scenic-spots-circle", type: "circle", source: "scenic-spots", paint: { "circle-radius": ["interpolate", ["linear"], ["zoom"], 10, 4, 14, 7], "circle-color": ["match", ["get", "category"], "viewpoint", "#f28b3a", "attraction", "#e0564a", "park", "#2b8a57", "#6a735f"], "circle-stroke-width": 1.5, "circle-stroke-color": "#ffffff" } });
        map.addLayer({ id: "selected-points", type: "circle", source: "selected-points", paint: { "circle-radius": 8, "circle-color": "#fffdf6", "circle-stroke-width": 3, "circle-stroke-color": "#16803c" } });
        map.on("click", handleMapClick);
        map.on("mouseenter", "discover-routes-hit", () => {
          map.getCanvas().style.cursor = "pointer";
        });
        map.on("mousemove", "discover-routes-hit", (event) => {
          const feature = event.features?.[0];
          const routeId = feature?.properties?.route_id;
          const route = routeCatalogRef.current.get(routeId);
          if (!feature || !route) {
            return;
          }
          popupRef.current?.setLngLat(event.lngLat).setHTML(
            `<div class="map-route-popup"><strong>${route.name}</strong><span>${route.location}</span><em>${route.difficulty} · ${formatDistance(route.distanceMeters)} · 点击查看详情</em></div>`,
          ).addTo(map);
        });
        map.on("mouseleave", "discover-routes-hit", () => {
          map.getCanvas().style.cursor = "";
          popupRef.current?.remove();
        });
        map.on("click", "discover-routes-hit", (event) => {
          const feature = event.features?.[0];
          const routeId = feature?.properties?.route_id;
          const route = routeCatalogRef.current.get(routeId);
          if (route) {
            openRouteDetail(route);
          }
        });
        map.on("click", "saved-paths-hit", (event) => {
          const feature = event.features?.[0];
          if (feature) {
            openRouteDetail(feature);
          }
        });
        map.on("click", "scenic-spots-circle", (event) => {
          const feature = event.features?.[0];
          if (!feature) {
            return;
          }
          popupRef.current?.setLngLat(feature.geometry.coordinates).setHTML(`<strong>${feature.properties.name}</strong><br>${feature.properties.category || "景点"}`).addTo(map);
        });
        map.on("moveend", loadScenicSpots);

        await Promise.all([ensureCsrfCookie(), loadSavedPaths(), loadRecentHikes(), loadScenicSpots()]);
        routeInteractionLockedRef.current = false;
        shouldFitRouteWithUserRef.current = false;
        setStatus("首页已就绪。上拉查看路线列表，或先定位到你的位置。");
        requestInitialLocation();
      } catch (error) {
        setStatus(`地图加载失败：${error.message}`);
      }
    };

    map.on("load", handleLoad);

    return () => {
      if (watchIdRef.current !== null) {
        navigator.geolocation.clearWatch(watchIdRef.current);
      }
      orientationCleanupRef.current?.();
      userMarkerRef.current?.remove();
      userMarkerRef.current = null;
      userMarkerElementRef.current = null;
      popupRef.current?.remove();
      map.remove();
      mapRef.current = null;
    };
  }, [mockRoutes]);

  const allRoutes = useMemo(() => [...mockRoutes, ...savedPaths], [mockRoutes, savedPaths]);

  const exploreRoutes = useMemo(
    () =>
      allRoutes.filter((route) => {
        const matchesSearch =
          !searchTerm ||
          route.name.toLowerCase().includes(searchTerm.toLowerCase()) ||
          route.location.toLowerCase().includes(searchTerm.toLowerCase());
        const matchesFilter =
          activeFilter === "全部" ||
          route.difficulty === activeFilter ||
          (activeFilter === "环线" && route.routeType === "环线");
        return matchesSearch && matchesFilter;
      }),
    [activeFilter, allRoutes, searchTerm],
  );

  const favoriteRoutes = useMemo(() => allRoutes.filter((route) => favoriteIds.has(route.id)), [allRoutes, favoriteIds]);
  const downloadedRoutes = useMemo(() => allRoutes.filter((route) => downloadedIds.has(route.id)), [allRoutes, downloadedIds]);
  const activeRouteName = routeFeatureRef.current?.properties?.name || "尚未选择路线";

  useEffect(() => {
    const nextRoutes = allRoutes.map((route) => buildRouteRecord(route));
    routeCatalogRef.current = new Map(
      nextRoutes.map((route) => [route.properties?.route_id || route.id, route]),
    );
    setSourceData("discover-routes", {
      type: "FeatureCollection",
      features: nextRoutes,
    });
  }, [allRoutes]);

  function handleTabChange(tabId) {
    setActiveTab(tabId);
    if (tabId === "navigate") {
      setIsSheetExpanded(false);
      centerOnUser();
    } else {
      setIsSheetExpanded(true);
    }
  }

  function renderRouteCard(route) {
    const isFavorite = favoriteIds.has(route.id);
    const isDownloaded = downloadedIds.has(route.id);
    const isActive = activeRouteIdRef.current === route.properties?.route_id;
    return (
      <article
        key={route.id}
        className={`trail-card${isActive ? " trail-card-active" : ""}`}
        onClick={() => openRouteDetail(route)}
        role="button"
        tabIndex={0}
        onKeyDown={(event) => {
          if (event.key === "Enter" || event.key === " ") {
            event.preventDefault();
            openRouteDetail(route);
          }
        }}
      >
        <div className="trail-card-media">
          <RoutePreview coordinates={route.coordinates} />
          <div className="media-actions">
            <button
              type="button"
              className="media-icon"
              onClick={(event) => {
                event.stopPropagation();
                handleDownloadRoute(route);
              }}
              aria-label="下载 GPX"
            >
              <Icon name="download" className="media-icon-svg" />
            </button>
            <button
              type="button"
              className="media-icon"
              onClick={(event) => {
                event.stopPropagation();
                toggleFavorite(route.id);
              }}
              aria-label="收藏路线"
            >
              <Icon name="heart" className="media-icon-svg" />
            </button>
          </div>
        </div>
        <div className="trail-card-body">
          <h3>{route.name}</h3>
          <p className="trail-location">{route.location}</p>
          <div className="trail-meta">
            <span>★ {route.rating.toFixed(1)}</span>
            <span>{route.difficulty}</span>
            <span>{formatDistance(route.distanceMeters)}</span>
            <span>{formatMinutes(route.estimatedMinutes)}</span>
          </div>
          <div className="trail-tags">
            {route.tags.map((tag) => <span key={tag}>{tag}</span>)}
          </div>
        </div>
      </article>
    );
  }

  function renderSheetContent() {
    if (activeTab === "saved") {
      return (
        <div className="sheet-scroll">
          <section className="compact-section">
            <h2>{currentUser.name} 的收藏</h2>
            {favoriteRoutes.length === 0 ? <p className="empty-copy">还没有收藏路线。</p> : favoriteRoutes.map(renderRouteCard)}
          </section>
          <section className="compact-section">
            <h2>已下载 GPX</h2>
            {downloadedRoutes.length === 0 ? <p className="empty-copy">还没有下载记录。</p> : downloadedRoutes.map(renderRouteCard)}
          </section>
          <section className="compact-section">
            <h2>导入 GPX</h2>
            <p className="support-copy">{gpxStatus}</p>
            <div className="upload-row">
              <input ref={fileInputRef} className="file-input" type="file" accept=".gpx,application/gpx+xml,application/xml,text/xml" />
              <button className="primary-pill" type="button" onClick={uploadGpx} disabled={isUploading}>
                <Icon name="import" className="button-icon" />
                <span>{isUploading ? "导入中..." : "导入"}</span>
              </button>
            </div>
          </section>
        </div>
      );
    }

    if (activeTab === "navigate") {
      return (
        <div className="sheet-scroll">
          <section className="navigate-panel">
            <p className="eyebrow">当前路线</p>
            <h2>{activeRouteName}</h2>
            <div className="navigate-grid">
              <div><span>路线长度</span><strong>{routeDistance}</strong></div>
              <div><span>预计时间</span><strong>{routeDuration}</strong></div>
              <div><span>累计爬升</span><strong>{routeAscent}</strong></div>
              <div><span>剩余距离</span><strong>{remainingDistance}</strong></div>
              <div><span>当前位置</span><strong>{currentLocationLabel}</strong></div>
              <div><span>当前海拔</span><strong>{currentAltitude}</strong></div>
            </div>
            <div className="navigate-actions">
              <span className="navigate-helper-copy">{isHiking ? "徒步进行中，正在自动持续定位。" : "点击“开始徒步”后会自动开启持续定位。"}</span>
              <button className="ghost-action" type="button" onClick={centerOnUser}><Icon name="map" className="button-icon" /><span>回到我</span></button>
            </div>
            <div className="navigate-actions">
              <button
                className="primary-pill"
                type="button"
                onClick={startHike}
                disabled={isHiking || isStartingHike || !routeFeatureRef.current}
              >
                <Icon name="play" className="button-icon" />
                <span>{isStartingHike ? "启动中..." : "开始徒步"}</span>
              </button>
              <button className="ghost-action" type="button" onClick={finishHike} disabled={!isHiking || isFinishingHike}>
                <Icon name="activity" className="button-icon" />
                <span>{isFinishingHike ? "结束中..." : "结束徒步"}</span>
              </button>
            </div>
          </section>
        </div>
      );
    }

    if (activeTab === "activity") {
      return (
        <div className="sheet-scroll">
          <section className="compact-section">
            <h2>最近活动</h2>
            <p className="support-copy">{sessionStatus}</p>
            <div className="session-list">
              {recentHikes.length === 0 ? (
                <p className="empty-copy">暂无记录。</p>
              ) : (
                recentHikes.map((session) => (
                  <article key={session.id} className="session-card">
                    <h3>#{session.id} · {formatDateTime(session.started_at)}</h3>
                    <p>{session.route_name || "未命名路线"}</p>
                    <p>实走 {formatDistance(session.walked_distance_meters)} · 完成度 {Math.round(session.completion_ratio * 100)}%</p>
                  </article>
                ))
              )}
            </div>
          </section>
        </div>
      );
    }

    if (activeTab === "profile") {
      return (
        <div className="sheet-scroll">
          <section className="compact-section">
            <h2>演示用户</h2>
            <p className="support-copy">收藏和下载 GPX 都会按当前演示用户本地持久化。</p>
            <div className="user-list">
              {users.map((user) => (
                <button
                  key={user.id}
                  type="button"
                  className={`user-chip${user.id === currentUserId ? " user-chip-active" : ""}`}
                  onClick={() => setCurrentUserId(user.id)}
                >
                  {user.name}
                </button>
              ))}
            </div>
            <div className="upload-row">
              <input className="file-input" value={newUserName} onChange={(event) => setNewUserName(event.target.value)} placeholder="新增演示用户" />
              <button className="primary-pill" type="button" onClick={createUserAndSwitch}><Icon name="user" className="button-icon" /><span>创建</span></button>
            </div>
          </section>
        </div>
      );
    }

    return (
      <div className="sheet-scroll">
        <section className="search-section">
          <div className="search-pill">
            <span className="search-icon"><Icon name="search" className="search-icon-svg" /></span>
            <input value={searchTerm} onChange={(event) => setSearchTerm(event.target.value)} placeholder="搜索路线" />
          </div>
          <div className="filter-row">
            {FILTERS.map((filter) => (
              <button key={filter} type="button" className={`filter-chip${activeFilter === filter ? " filter-chip-active" : ""}`} onClick={() => setActiveFilter(filter)}>
                {filter}
              </button>
            ))}
          </div>
          <div className="results-head">
            <strong>{exploreRoutes.length} 条路线</strong>
            <span>{currentUser.name}</span>
          </div>
        </section>
        <section className="route-list">{exploreRoutes.map(renderRouteCard)}</section>
      </div>
    );
  }

  const detailRoute = activeDetailRoute ? buildRouteRecord(activeDetailRoute) : null;

  return (
    <main className="phone-shell">
      <div ref={mapContainerRef} className="map-canvas" />

      <section className="map-topbar">
        <div className="map-pill">
          <span className="map-pill-title">实时地图</span>
          <strong>{status}</strong>
        </div>
      </section>

      {!isSheetExpanded && !detailRoute && (
        <button className="floating-map-button" type="button" onClick={() => setIsSheetExpanded(true)}>
          <Icon name="map" className="button-icon button-icon-large" />
          <strong>路线</strong>
        </button>
      )}

      {!detailRoute && (
        <>
          {isSheetExpanded && (
            <section className="mobile-sheet mobile-sheet-expanded">
              <button className="sheet-handle" type="button" onClick={() => setIsSheetExpanded(false)}>
                <span />
                <strong>{activeRouteName}</strong>
              </button>
              {renderSheetContent()}
            </section>
          )}

          <nav className="bottom-nav" aria-label="主导航">
            {TAB_ITEMS.map((item) => (
              <button
                key={item.id}
                type="button"
                className={`bottom-nav-item${activeTab === item.id ? " bottom-nav-item-active" : ""}`}
                onClick={() => handleTabChange(item.id)}
              >
                <span><Icon name={item.icon} className="nav-icon" /></span>
                <strong>{item.label}</strong>
              </button>
            ))}
          </nav>
        </>
      )}

      {detailRoute && (
        <section className="detail-overlay">
          <header className="detail-header">
            <button type="button" className="detail-icon" onClick={closeRouteDetail}><Icon name="back" className="detail-icon-svg" /></button>
            <div className="detail-header-actions">
              <button type="button" className="detail-icon" onClick={() => handleDownloadRoute(detailRoute)}><Icon name="download" className="detail-icon-svg" /></button>
              <button type="button" className="detail-icon" onClick={() => toggleFavorite(detailRoute.id)}><Icon name="heart" className="detail-icon-svg" /></button>
              <button type="button" className="detail-icon"><Icon name="more" className="detail-icon-svg" /></button>
            </div>
          </header>

          <div className="detail-body">
            <section className="detail-copy">
              <h1>{detailRoute.name}</h1>
              <p className="detail-subline">
                <span>★ {detailRoute.rating.toFixed(1)}</span>
                <span>{detailRoute.difficulty}</span>
                <span>{detailRoute.location}</span>
              </p>
              <div className="detail-stats">
                <div><strong>{formatDistance(detailRoute.distanceMeters)}</strong><span>路线长度</span></div>
                <div><strong>{Math.round(detailRoute.ascentMeters)} m</strong><span>累计爬升</span></div>
                <div><strong>{formatMinutes(detailRoute.estimatedMinutes)}</strong><span>预计时间</span></div>
                <div><strong>{detailRoute.routeType}</strong><span>路线类型</span></div>
              </div>
              <h2>{detailRoute.titleNative}</h2>
              <p className="detail-description">{detailRoute.description}</p>
            </section>

            <button type="button" className="detail-map-card" onClick={() => openRouteDetail(detailRoute)}>
              <RoutePreview coordinates={detailRoute.coordinates} />
            </button>
          </div>

          <footer className="detail-footer">
            <button type="button" className="detail-download" onClick={() => handleDownloadRoute(detailRoute)}>
              <Icon name="download" className="button-icon" />
              <span>下载 GPX</span>
            </button>
            <button
              type="button"
              className="detail-start"
              onClick={() => {
                selectRoute(detailRoute, { statusText: `已进入“${detailRoute.name}”导航视图。` });
                closeRouteDetail();
                setActiveTab("navigate");
                setIsSheetExpanded(false);
                centerOnUser();
              }}
            >
              <Icon name="play" className="button-icon" />
              <span>开始</span>
            </button>
          </footer>
        </section>
      )}
    </main>
  );
}
