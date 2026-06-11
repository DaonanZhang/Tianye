const beijingBounds = [
  [115.7, 39.5],
  [116.8, 40.1],
];
const statusElement = document.getElementById("route-status");
const currentLocationElement = document.getElementById("current-location");
const currentAltitudeElement = document.getElementById("current-altitude");
const walkedDistanceElement = document.getElementById("walked-distance");
const startTrackingButton = document.getElementById("start-tracking");
const stopTrackingButton = document.getElementById("stop-tracking");
const useCurrentLocationButton = document.getElementById("use-current-location");
const centerOnUserButton = document.getElementById("center-on-user");
const startHikeButton = document.getElementById("start-hike");
const stopHikeButton = document.getElementById("stop-hike");
const hikeSessionStatusElement = document.getElementById("hike-session-status");
const recentHikesElement = document.getElementById("recent-hikes");
const gpxStatusElement = document.getElementById("gpx-status");
const gpxFileInput = document.getElementById("gpx-file");
const uploadGpxButton = document.getElementById("upload-gpx");
const savedPathsSummaryElement = document.getElementById("saved-paths-summary");
const remainingDistanceElement = document.getElementById("remaining-distance");
const localNavigationStatusElement = document.getElementById("local-navigation-status");
const togglePanelsButton = document.getElementById("toggle-panels");
const selectedPoints = [];
const emptyLineFeature = {
  type: "Feature",
  properties: {},
  geometry: {
    type: "LineString",
    coordinates: [],
  },
};
const emptyFeatureCollection = {
  type: "FeatureCollection",
  features: [],
};
let scenicSpotPopup;
let userLocationMarker;
const localCacheKeys = {
  savedPaths: "tianye.saved-paths.v1",
  activeNavigation: "tianye.active-navigation.v1",
};
const trackingState = {
  watchId: null,
  currentPosition: null,
  rawTrack: [],
  routeCoordinates: [],
  routeDistances: [],
  lastMatchedRouteIndex: 0,
  isHikingActive: false,
  lastElevationLookupAt: 0,
  lastElevationLookupCoordinates: null,
  elevationLookupSerial: 0,
  latestHeading: 0,
  plannedRoutePayload: null,
  currentSessionId: null,
  deviationCount: 0,
  isOffRoute: false,
  startedHikingAt: null,
  consecutiveOffRouteCount: 0,
  offRouteThresholdMeters: 42,
  offRouteConsecutiveFixes: 3,
  orientationListenerAttached: false,
  deviceHeading: null,
  hasAutoCenteredOnUser: false,
  savedPathsFeatureCollection: emptyFeatureCollection,
  activeSavedPathId: null,
  hasAutoFramedSavedPaths: false,
};

const map = new maplibregl.Map({
  container: "map",
  style: {
    version: 8,
    sources: {},
    layers: [
      {
        id: "background",
        type: "background",
        paint: {
          "background-color": "#efe6d4",
        },
      },
    ],
  },
  center: [116.3975, 39.9185],
  zoom: 12,
  minZoom: 9,
  maxZoom: 17,
  maxBounds: beijingBounds,
  renderWorldCopies: false,
});

map.addControl(new maplibregl.NavigationControl(), "top-right");

async function loadGeoJson(url) {
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`Failed to load ${url}`);
  }
  return response.json();
}

async function loadScenicSpotsForViewport() {
  const bounds = map.getBounds();
  const query = new URLSearchParams({
    min_lng: bounds.getWest(),
    min_lat: bounds.getSouth(),
    max_lng: bounds.getEast(),
    max_lat: bounds.getNorth(),
    limit: 500,
  });

  const response = await fetch(`/api/scenic-spots/?${query.toString()}`);
  if (!response.ok) {
    throw new Error("Failed to load scenic spots.");
  }

  const payload = await response.json();
  map.getSource("scenic-spots")?.setData(payload);
}

async function loadSavedPaths() {
  try {
    const response = await fetch("/api/saved-paths/");
    if (!response.ok) {
      throw new Error("Failed to load saved paths.");
    }
    const payload = await response.json();
    trackingState.savedPathsFeatureCollection = payload;
    map.getSource("saved-paths")?.setData(payload);
    renderSavedPathsSummary(payload.features || []);
    if (
      (payload.features || []).length > 0 &&
      !trackingState.activeSavedPathId &&
      !trackingState.hasAutoFramedSavedPaths
    ) {
      const bounds = featureCollectionBounds(payload.features || []);
      if (!bounds.isEmpty()) {
        trackingState.hasAutoFramedSavedPaths = true;
        map.fitBounds(bounds, { padding: 80, duration: 900 });
        setStatus("已在地图上展示当前已导入的 trails。你可以点任意一条路径，把它设为当前导航路径。");
      }
    }
    writeJsonCache(localCacheKeys.savedPaths, payload);
    restoreActiveNavigationFromCache();
    return payload;
  } catch (error) {
    const cached = readJsonCache(localCacheKeys.savedPaths);
    if (!cached) {
      throw error;
    }
    trackingState.savedPathsFeatureCollection = cached;
    map.getSource("saved-paths")?.setData(cached);
    renderSavedPathsSummary(cached.features || []);
    if (
      (cached.features || []).length > 0 &&
      !trackingState.activeSavedPathId &&
      !trackingState.hasAutoFramedSavedPaths
    ) {
      const bounds = featureCollectionBounds(cached.features || []);
      if (!bounds.isEmpty()) {
        trackingState.hasAutoFramedSavedPaths = true;
        map.fitBounds(bounds, { padding: 80, duration: 0 });
      }
    }
    restoreActiveNavigationFromCache();
    setLocalNavigationStatus("已从手机本地缓存恢复已保存路径。当前可以离线导航，但新导入和同步仍需要网络。");
    return cached;
  }
}

function setStatus(message) {
  statusElement.textContent = message;
}

function setMetric(element, message) {
  element.textContent = message;
}

function setSessionStatus(message) {
  hikeSessionStatusElement.textContent = message;
}

function setGpxStatus(message) {
  gpxStatusElement.textContent = message;
}

function setLocalNavigationStatus(message) {
  localNavigationStatusElement.textContent = message;
}

function setPanelsCollapsed(isCollapsed) {
  document.body.classList.toggle("panels-collapsed", isCollapsed);
  if (togglePanelsButton) {
    togglePanelsButton.textContent = isCollapsed ? "展开面板" : "收起面板";
    togglePanelsButton.setAttribute("aria-expanded", String(!isCollapsed));
  }
}

function togglePanels() {
  setPanelsCollapsed(!document.body.classList.contains("panels-collapsed"));
}

function formatDistance(meters) {
  if (!Number.isFinite(meters)) {
    return "未知";
  }
  if (meters >= 1000) {
    return `${(meters / 1000).toFixed(2)} km`;
  }
  return `${Math.round(meters)} m`;
}

function readJsonCache(key) {
  try {
    const raw = window.localStorage.getItem(key);
    return raw ? JSON.parse(raw) : null;
  } catch (error) {
    return null;
  }
}

function writeJsonCache(key, value) {
  try {
    window.localStorage.setItem(key, JSON.stringify(value));
  } catch (error) {
    return;
  }
}

function formatMinutes(totalMinutes) {
  const minutes = Math.max(Math.round(totalMinutes), 0);
  const hoursPart = Math.floor(minutes / 60);
  const minutesPart = minutes % 60;

  if (hoursPart === 0) {
    return `${minutesPart} min`;
  }
  if (minutesPart === 0) {
    return `${hoursPart} h`;
  }
  return `${hoursPart} h ${minutesPart} min`;
}

function haversineMeters(pointA, pointB) {
  const [lon1, lat1] = pointA;
  const [lon2, lat2] = pointB;
  const radius = 6371000;
  const phi1 = (lat1 * Math.PI) / 180;
  const phi2 = (lat2 * Math.PI) / 180;
  const deltaPhi = ((lat2 - lat1) * Math.PI) / 180;
  const deltaLambda = ((lon2 - lon1) * Math.PI) / 180;

  const sinPhi = Math.sin(deltaPhi / 2);
  const sinLambda = Math.sin(deltaLambda / 2);
  const value = sinPhi * sinPhi + Math.cos(phi1) * Math.cos(phi2) * sinLambda * sinLambda;
  return 2 * radius * Math.atan2(Math.sqrt(value), Math.sqrt(1 - value));
}

function setTrackingButtons() {
  const isTracking = trackingState.watchId !== null;
  startTrackingButton.disabled = isTracking;
  stopTrackingButton.disabled = !isTracking;
}

function setHikingButtons() {
  startHikeButton.disabled = trackingState.isHikingActive;
  stopHikeButton.disabled = !trackingState.isHikingActive;
}

function getCookie(name) {
  const cookies = document.cookie ? document.cookie.split(";") : [];
  for (const cookieChunk of cookies) {
    const cookie = cookieChunk.trim();
    if (cookie.startsWith(`${name}=`)) {
      return decodeURIComponent(cookie.slice(name.length + 1));
    }
  }
  return null;
}

async function postJson(url, payload) {
  const response = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-CSRFToken": getCookie("csrftoken") || "",
    },
    body: JSON.stringify(payload),
  });

  const data = await response.json();
  if (!response.ok) {
    throw new Error(data.error || "Request failed.");
  }
  return data;
}

function formatTimestamp(isoString) {
  const date = new Date(isoString);
  return new Intl.DateTimeFormat("zh-Hans-CN", {
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  }).format(date);
}

function renderRecentHikes(sessions) {
  if (sessions.length === 0) {
    recentHikesElement.innerHTML = "";
    setSessionStatus("暂无记录。开始并结束一次徒步后，这里会显示最近保存的会话。");
    return;
  }

  setSessionStatus("最近保存的徒步会话如下。");
  recentHikesElement.innerHTML = sessions
    .map((session) => {
      const completion = `${Math.round(session.completion_ratio * 100)}%`;
      const duration = session.actual_duration_seconds > 0
        ? formatMinutes(session.actual_duration_seconds / 60)
        : "进行中";
      return `
        <article class="session-card">
          <h3 class="session-title">#${session.id} · ${formatTimestamp(session.started_at)}</h3>
          <p class="session-meta">
            计划 ${formatDistance(session.planned_distance_meters)} · 实走 ${formatDistance(session.walked_distance_meters)}<br>
            完成度 ${completion} · 偏航 ${session.deviation_count} 次 · 用时 ${duration}
          </p>
        </article>
      `;
    })
    .join("");
}

async function loadRecentHikes() {
  try {
    const response = await fetch("/api/hike-sessions/");
    if (!response.ok) {
      throw new Error("Failed to load hike sessions.");
    }
    const payload = await response.json();
    renderRecentHikes(payload.sessions || []);
  } catch (error) {
    setSessionStatus("最近徒步记录读取失败。");
  }
}

function renderSavedPathsSummary(features) {
  if (features.length === 0) {
    savedPathsSummaryElement.innerHTML = "";
    setLocalNavigationStatus("当前还没有已保存路径。导入 GPX 后，这里会出现可离线导航的本地路径。");
    return;
  }

  savedPathsSummaryElement.innerHTML = features.slice(0, 8).map((feature) => {
    const pathId = feature.properties.canonical_path_id || feature.properties.id;
    const isSelected = trackingState.activeSavedPathId === pathId;
    const statusLabel = isSelected ? "当前导航路径" : "设为导航路径";
    return `
      <button class="session-card session-card-button ${isSelected ? "is-selected" : ""}" type="button" data-path-id="${pathId}">
        <h3 class="session-title">${feature.properties.canonical_path_name || feature.properties.name}</h3>
        <p class="session-meta">
          ${formatDistance(feature.properties.distance_meters)} · 爬升 ${formatDistance(feature.properties.ascent_meters)}<br>
          ${statusLabel}
        </p>
      </button>
    `;
  }).join("");
}

function featureCoordinates(feature) {
  if (!feature?.geometry) {
    return [];
  }
  if (feature.geometry.type === "LineString") {
    return feature.geometry.coordinates || [];
  }
  if (feature.geometry.type === "MultiLineString") {
    return (feature.geometry.coordinates || []).flat();
  }
  return [];
}

function featureBounds(feature) {
  const bounds = new maplibregl.LngLatBounds();
  featureCoordinates(feature).forEach((coordinate) => bounds.extend(coordinate));
  return bounds;
}

function featureCollectionBounds(features) {
  const bounds = new maplibregl.LngLatBounds();
  features.forEach((feature) => {
    featureCoordinates(feature).forEach((coordinate) => bounds.extend(coordinate));
  });
  return bounds;
}

function buildNavigationPayloadFromFeature(feature) {
  const coordinates = featureCoordinates(feature);
  if (coordinates.length < 2) {
    return null;
  }

  return {
    type: "Feature",
    properties: {
      ...feature.properties,
      start: feature.properties.start || coordinates[0],
      end: feature.properties.end || coordinates[coordinates.length - 1],
      estimated_time: null,
      route_origin: "saved-path",
    },
    geometry: {
      type: "LineString",
      coordinates,
    },
  };
}

function updateRemainingDistanceDisplay(distanceMeters) {
  if (trackingState.routeCoordinates.length < 2) {
    setMetric(remainingDistanceElement, "未选择路径");
    return;
  }
  setMetric(remainingDistanceElement, formatDistance(Math.max(distanceMeters, 0)));
}

function cacheActiveNavigationState() {
  if (!trackingState.activeSavedPathId || !trackingState.plannedRoutePayload) {
    writeJsonCache(localCacheKeys.activeNavigation, null);
    return;
  }

  writeJsonCache(localCacheKeys.activeNavigation, {
    savedPathId: trackingState.activeSavedPathId,
    route: trackingState.plannedRoutePayload,
  });
}

function setActiveNavigationFeature(feature, { fitBounds = false, fromCache = false } = {}) {
  const payload = buildNavigationPayloadFromFeature(feature);
  if (!payload) {
    setLocalNavigationStatus("这条路径还不能作为导航路径，因为几何点不足。");
    return;
  }

  trackingState.activeSavedPathId = feature.properties.canonical_path_id || feature.properties.id;
  trackingState.routeCoordinates = payload.geometry.coordinates;
  trackingState.routeDistances = buildRouteDistances(trackingState.routeCoordinates);
  trackingState.lastMatchedRouteIndex = 0;
  trackingState.plannedRoutePayload = payload;
  trackingState.isOffRoute = false;
  trackingState.consecutiveOffRouteCount = 0;
  map.getSource("preview-route")?.setData(payload);
  map.getSource("route-connectors")?.setData(emptyFeatureCollection);
  map.getSource("walked-route")?.setData(emptyLineFeature);
  setMetric(walkedDistanceElement, "0 m");
  updateRemainingDistanceDisplay(trackingState.routeDistances[trackingState.routeDistances.length - 1] || 0);
  renderSavedPathsSummary(trackingState.savedPathsFeatureCollection.features || []);
  cacheActiveNavigationState();

  const totalDistance = trackingState.routeDistances[trackingState.routeDistances.length - 1] || 0;
  setLocalNavigationStatus(
    `已将“${feature.properties.canonical_path_name || feature.properties.name}”设为当前本地导航路径。后续已走/剩余距离都在手机本地计算。`,
  );
  setStatus(
    `当前导航路径来自已导入 GPX，长度约 ${formatDistance(totalDistance)}。点击“开始徒步”后会按这条本地路径计算进度。`,
  );

  if (fitBounds) {
    const bounds = featureBounds(feature);
    if (!bounds.isEmpty()) {
      map.fitBounds(bounds, { padding: 70, duration: fromCache ? 0 : 900 });
    }
  }
}

function restoreActiveNavigationFromCache() {
  const cached = readJsonCache(localCacheKeys.activeNavigation);
  if (!cached?.savedPathId) {
    return;
  }

  if (trackingState.activeSavedPathId === cached.savedPathId) {
    return;
  }

  const feature = (trackingState.savedPathsFeatureCollection.features || []).find(
    (item) => (item.properties.canonical_path_id || item.properties.id) === cached.savedPathId,
  );
  if (!feature) {
    return;
  }

  setActiveNavigationFeature(feature, { fromCache: true });
}

async function uploadGpxFile() {
  const file = gpxFileInput.files?.[0];
  if (!file) {
    setGpxStatus("请先选择一个 GPX 文件。");
    return;
  }

  const formData = new FormData();
  formData.append("gpx_file", file);
  const response = await fetch("/api/gpx-import/", {
    method: "POST",
    headers: {
      "X-CSRFToken": getCookie("csrftoken") || "",
    },
    body: formData,
  });
  const payload = await response.json();
  if (!response.ok) {
    throw new Error(payload.error || "GPX import failed.");
  }

  const feature = payload.mode === "merged" ? payload.canonical_path : payload.saved_path;
  await loadSavedPaths();
  const canonicalId = feature.properties.canonical_path_id || feature.properties.id;
  const canonicalFeature = (trackingState.savedPathsFeatureCollection.features || []).find(
    (item) => (item.properties.canonical_path_id || item.properties.id) === canonicalId,
  );
  if (canonicalFeature) {
    setActiveNavigationFeature(canonicalFeature, { fitBounds: true });
  }

  if (payload.mode === "merged") {
    setGpxStatus(`GPX 已归并到旧路“${payload.canonical_path.properties.name}”，因为两条路径的最大偏差没有超过 1 m。`);
  } else {
    setGpxStatus(`GPX 已保存为新路径“${payload.saved_path.properties.name}”。`);
  }
}

function updateSelectionSource() {
  const source = map.getSource("selected-points");
  if (!source) {
    return;
  }

  source.setData({
    type: "FeatureCollection",
    features: selectedPoints.map((coordinates, index) => ({
      type: "Feature",
      properties: {
        label: index === 0 ? "A" : "B",
      },
      geometry: {
        type: "Point",
        coordinates,
      },
    })),
  });
}

function resetPreviewLayers() {
  map.getSource("preview-route")?.setData(emptyLineFeature);
  map.getSource("route-connectors")?.setData(emptyFeatureCollection);
  map.getSource("walked-route")?.setData(emptyLineFeature);
  map.getSource("raw-track")?.setData(emptyLineFeature);
  trackingState.rawTrack = [];
  trackingState.routeCoordinates = [];
  trackingState.routeDistances = [];
  trackingState.lastMatchedRouteIndex = 0;
  trackingState.isHikingActive = false;
  trackingState.plannedRoutePayload = null;
  trackingState.currentSessionId = null;
  trackingState.deviationCount = 0;
  trackingState.isOffRoute = false;
  trackingState.startedHikingAt = null;
  trackingState.activeSavedPathId = null;
  setMetric(walkedDistanceElement, "0 m");
  setMetric(remainingDistanceElement, "未选择路径");
  cacheActiveNavigationState();
  renderSavedPathsSummary(trackingState.savedPathsFeatureCollection.features || []);
  setHikingButtons();
}

function connectorFeature(fromCoordinates, toCoordinates, role) {
  return {
    type: "Feature",
    properties: { role },
    geometry: {
      type: "LineString",
      coordinates: [fromCoordinates, toCoordinates],
    },
  };
}

function sameCoordinatePair(pointA, pointB) {
  return (
    Math.abs(pointA[0] - pointB[0]) < 0.000001 &&
    Math.abs(pointA[1] - pointB[1]) < 0.000001
  );
}

function updateConnectorSource(payload) {
  const source = map.getSource("route-connectors");
  if (!source) {
    return;
  }

  const connectors = [];
  const startAnchor = payload.properties.start_anchor;
  const endAnchor = payload.properties.end_anchor;

  if (selectedPoints[0] && startAnchor && !sameCoordinatePair(selectedPoints[0], startAnchor)) {
    connectors.push(connectorFeature(selectedPoints[0], startAnchor, "start"));
  }
  if (selectedPoints[1] && endAnchor && !sameCoordinatePair(selectedPoints[1], endAnchor)) {
    connectors.push(connectorFeature(selectedPoints[1], endAnchor, "end"));
  }

  source.setData({
    type: "FeatureCollection",
    features: connectors,
  });
}

async function requestRoutePreview() {
  const [start, end] = selectedPoints;
  setStatus("正在根据北京本地步行路网计算路线...");

  const query = new URLSearchParams({
    start_lng: start[0],
    start_lat: start[1],
    end_lng: end[0],
    end_lat: end[1],
  });

  const response = await fetch(`/api/route-preview/?${query.toString()}`);
  const payload = await response.json();
  if (!response.ok) {
    throw new Error(payload.error || "Route preview failed.");
  }

  map.getSource("preview-route").setData(payload);
  updateConnectorSource(payload);
  trackingState.routeCoordinates = payload.geometry.coordinates;
  trackingState.routeDistances = buildRouteDistances(trackingState.routeCoordinates);
  trackingState.lastMatchedRouteIndex = 0;
  trackingState.plannedRoutePayload = {
    type: payload.type,
    properties: {
      ...payload.properties,
      start,
      end,
    },
    geometry: payload.geometry,
  };
  trackingState.activeSavedPathId = null;
  cacheActiveNavigationState();
  map.getSource("walked-route")?.setData(emptyLineFeature);
  renderSavedPathsSummary(trackingState.savedPathsFeatureCollection.features || []);

  const lineBounds = new maplibregl.LngLatBounds();
  payload.geometry.coordinates.forEach((coordinate) => lineBounds.extend(coordinate));
  lineBounds.extend(start);
  lineBounds.extend(end);
  map.fitBounds(lineBounds, { padding: 70, duration: 700 });

  const distanceKm = (payload.properties.distance_meters / 1000).toFixed(2);
  const timeEstimate = payload.properties.estimated_time;
  const movingTime = formatMinutes(timeEstimate.moving_minutes);
  const planningTime = formatMinutes(timeEstimate.recommended_minutes);
  const ascentText = formatDistance(payload.properties.ascent_meters);
  const descentText = formatDistance(payload.properties.descent_meters);
  setStatus(
    `已生成贴路路线，长度约 ${distanceKm} km，累计爬升约 ${ascentText}，下降约 ${descentText}。按 DAV 标准估算纯行走约 ${movingTime}，含基础缓冲建议按 ${planningTime} 规划。点击“开始徒步”后才会记录已走路段。`,
  );
  updateRemainingDistanceDisplay(payload.properties.distance_meters);
}

function buildRouteDistances(coordinates) {
  const cumulative = [0];
  for (let index = 1; index < coordinates.length; index += 1) {
    cumulative.push(cumulative[index - 1] + haversineMeters(coordinates[index - 1], coordinates[index]));
  }
  return cumulative;
}

function toLocalXY(referenceLat, point) {
  const [lon, lat] = point;
  const latRad = (referenceLat * Math.PI) / 180;
  const x = lon * 111320 * Math.cos(latRad);
  const y = lat * 110540;
  return [x, y];
}

function distancePointToSegmentMeters(point, segmentStart, segmentEnd) {
  const referenceLat = (point[1] + segmentStart[1] + segmentEnd[1]) / 3;
  const [px, py] = toLocalXY(referenceLat, point);
  const [ax, ay] = toLocalXY(referenceLat, segmentStart);
  const [bx, by] = toLocalXY(referenceLat, segmentEnd);
  const abx = bx - ax;
  const aby = by - ay;
  const apx = px - ax;
  const apy = py - ay;
  const denominator = (abx * abx) + (aby * aby);

  if (denominator === 0) {
    return Math.hypot(px - ax, py - ay);
  }

  const t = Math.max(0, Math.min(1, ((apx * abx) + (apy * aby)) / denominator));
  const closestX = ax + (abx * t);
  const closestY = ay + (aby * t);
  return Math.hypot(px - closestX, py - closestY);
}

function updateUserLocationSource(coordinates) {
  const source = map.getSource("user-location");
  if (!source) {
    return;
  }
  source.setData({
    type: "FeatureCollection",
    features: [
      {
        type: "Feature",
        properties: {},
        geometry: {
          type: "Point",
          coordinates,
        },
      },
    ],
  });

  if (userLocationMarker) {
    userLocationMarker.setLngLat(coordinates);
    userLocationMarker.getElement().classList.remove("is-hidden");
  }
}

function normalizedHeadingDegrees(rawHeading) {
  if (rawHeading === null || rawHeading === undefined || Number.isNaN(rawHeading)) {
    return null;
  }
  const normalized = rawHeading % 360;
  return normalized >= 0 ? normalized : normalized + 360;
}

function getEffectiveHeading() {
  const positionHeading = normalizedHeadingDegrees(trackingState.latestHeading);
  if (positionHeading !== null) {
    return positionHeading;
  }
  return normalizedHeadingDegrees(trackingState.deviceHeading);
}

function updateUserMarkerRotation() {
  if (!userLocationMarker) {
    return;
  }
  const heading = getEffectiveHeading() ?? 0;
  userLocationMarker.setRotation(heading);
}

function centerMapOnCurrentUser(options = {}) {
  if (!trackingState.currentPosition) {
    return;
  }

  const {
    zoom = 15,
    duration = 900,
    essential = true,
  } = options;

  map.flyTo({
    center: trackingState.currentPosition,
    zoom: Math.max(map.getZoom(), zoom),
    duration,
    essential,
  });
}

function handleDeviceOrientation(event) {
  if (typeof event.webkitCompassHeading === "number") {
    trackingState.deviceHeading = event.webkitCompassHeading;
  } else if (typeof event.alpha === "number") {
    trackingState.deviceHeading = 360 - event.alpha;
  } else {
    return;
  }

  updateUserMarkerRotation();
}

async function ensureOrientationTracking() {
  if (trackingState.orientationListenerAttached) {
    return;
  }

  if (typeof window === "undefined" || typeof window.DeviceOrientationEvent === "undefined") {
    return;
  }

  const requestPermission = window.DeviceOrientationEvent.requestPermission;
  if (typeof requestPermission === "function") {
    try {
      const result = await requestPermission();
      if (result !== "granted") {
        return;
      }
    } catch (error) {
      return;
    }
  }

  window.addEventListener("deviceorientationabsolute", handleDeviceOrientation, true);
  window.addEventListener("deviceorientation", handleDeviceOrientation, true);
  trackingState.orientationListenerAttached = true;
}

function updateRawTrackSource() {
  const source = map.getSource("raw-track");
  if (!source) {
    return;
  }
  source.setData({
    type: "Feature",
    properties: {},
    geometry: {
      type: "LineString",
      coordinates: trackingState.rawTrack,
    },
  });
}

function findNearestRouteMatch(positionCoordinates) {
  if (trackingState.routeCoordinates.length === 0) {
    return null;
  }

  let bestIndex = null;
  let bestDistance = Number.POSITIVE_INFINITY;
  const startIndex = Math.max(trackingState.lastMatchedRouteIndex - 6, 0);

  for (let index = startIndex; index < trackingState.routeCoordinates.length - 1; index += 1) {
    const distance = distancePointToSegmentMeters(
      positionCoordinates,
      trackingState.routeCoordinates[index],
      trackingState.routeCoordinates[index + 1],
    );
    if (distance < bestDistance) {
      bestDistance = distance;
      bestIndex = index;
    }
  }

  return {
    index: bestIndex === null ? 0 : bestIndex + 1,
    distance: bestDistance,
  };
}

function updateWalkedRouteFromPosition(positionCoordinates) {
  const matchedPoint = findNearestRouteMatch(positionCoordinates);
  if (!matchedPoint || matchedPoint.distance > trackingState.offRouteThresholdMeters) {
    trackingState.consecutiveOffRouteCount += 1;
    if (
      trackingState.consecutiveOffRouteCount >= trackingState.offRouteConsecutiveFixes &&
      !trackingState.isOffRoute
    ) {
      trackingState.deviationCount += 1;
      trackingState.isOffRoute = true;
      setStatus("检测到你已连续偏离规划路线，已记为一次偏航。可以继续前进，或重新选终点再规划。");
    }
    return;
  }

  trackingState.consecutiveOffRouteCount = 0;
  if (trackingState.isOffRoute) {
    setStatus("已重新回到规划路线，继续记录已走路段。");
  }
  trackingState.isOffRoute = false;
  trackingState.lastMatchedRouteIndex = Math.max(trackingState.lastMatchedRouteIndex, matchedPoint.index);
  const walkedCoordinates = trackingState.routeCoordinates.slice(0, matchedPoint.index + 1);
  map.getSource("walked-route")?.setData({
    type: "Feature",
    properties: {
      distance_meters: trackingState.routeDistances[matchedPoint.index] || 0,
    },
    geometry: {
      type: "LineString",
      coordinates: walkedCoordinates,
    },
  });

  setMetric(
    walkedDistanceElement,
    formatDistance(trackingState.routeDistances[matchedPoint.index] || 0),
  );
  const totalDistance = trackingState.routeDistances[trackingState.routeDistances.length - 1] || 0;
  updateRemainingDistanceDisplay(totalDistance - (trackingState.routeDistances[matchedPoint.index] || 0));
}

async function refreshCurrentElevation(positionCoordinates, deviceAltitude) {
  const now = Date.now();
  const movedEnough =
    !trackingState.lastElevationLookupCoordinates ||
    haversineMeters(trackingState.lastElevationLookupCoordinates, positionCoordinates) >= 12;
  const waitedEnough = now - trackingState.lastElevationLookupAt >= 2000;

  if (!movedEnough && !waitedEnough) {
    return;
  }

  trackingState.lastElevationLookupAt = now;
  trackingState.lastElevationLookupCoordinates = positionCoordinates;
  trackingState.elevationLookupSerial += 1;
  const serial = trackingState.elevationLookupSerial;

  try {
    const query = new URLSearchParams({
      lng: positionCoordinates[0],
      lat: positionCoordinates[1],
    });
    const response = await fetch(`/api/elevation/?${query.toString()}`);
    if (!response.ok) {
      throw new Error("Elevation lookup failed.");
    }
    const payload = await response.json();
    if (serial !== trackingState.elevationLookupSerial) {
      return;
    }

    if (deviceAltitude === null) {
      setMetric(currentAltitudeElement, `${Math.round(payload.elevation_m)} m (DEM)`);
      return;
    }

    setMetric(
      currentAltitudeElement,
      `${Math.round(payload.elevation_m)} m (DEM) / ${Math.round(deviceAltitude)} m (设备)`,
    );
  } catch (error) {
    if (deviceAltitude !== null) {
      setMetric(currentAltitudeElement, `${Math.round(deviceAltitude)} m (设备)`);
    } else {
      setMetric(currentAltitudeElement, "本地 DEM 未命中");
    }
  }
}

function handleTrackingUpdate(position) {
  const coordinates = [position.coords.longitude, position.coords.latitude];
  trackingState.currentPosition = coordinates;
  trackingState.latestHeading = normalizedHeadingDegrees(position.coords.heading);
  updateUserLocationSource(coordinates);
  updateUserMarkerRotation();

  if (!trackingState.hasAutoCenteredOnUser) {
    trackingState.hasAutoCenteredOnUser = true;
    centerMapOnCurrentUser({ zoom: 15, duration: 1100 });
    setStatus("已获取你的当前位置，地图已自动居中到“我的位置”。");
  }

  setMetric(
    currentLocationElement,
    `${coordinates[1].toFixed(6)}, ${coordinates[0].toFixed(6)}`,
  );

  refreshCurrentElevation(coordinates, position.coords.altitude);

  if (!trackingState.isHikingActive) {
    return;
  }

  const lastTrackPoint = trackingState.rawTrack[trackingState.rawTrack.length - 1];
  if (!lastTrackPoint || haversineMeters(lastTrackPoint, coordinates) >= 5) {
    trackingState.rawTrack.push(coordinates);
    updateRawTrackSource();
  }

  if (trackingState.routeCoordinates.length > 1) {
    updateWalkedRouteFromPosition(coordinates);
  }
}

function handleTrackingError(error) {
  setStatus(`定位失败：${error.message}`);
}

function startTrackingInternal({ silent = false } = {}) {
  if (!navigator.geolocation) {
    setStatus("当前浏览器不支持 Geolocation API。");
    return false;
  }
  if (trackingState.watchId !== null) {
    return true;
  }

  trackingState.watchId = navigator.geolocation.watchPosition(handleTrackingUpdate, handleTrackingError, {
    enableHighAccuracy: true,
    maximumAge: 1000,
    timeout: 15000,
  });
  ensureOrientationTracking();
  setTrackingButtons();
  if (!silent) {
    setStatus("正在读取手机当前位置。首次授权后，会持续记录移动位置。");
  }
  return true;
}

function startTracking() {
  startTrackingInternal();
}

function stopTracking() {
  if (trackingState.watchId === null) {
    return;
  }
  if (trackingState.isHikingActive) {
    stopHiking(true);
  }
  navigator.geolocation.clearWatch(trackingState.watchId);
  trackingState.watchId = null;
  setTrackingButtons();
  setStatus("已停止定位。路线和轨迹保留在地图上。");
}

function useCurrentLocationAsStart() {
  if (!trackingState.currentPosition) {
    setStatus("请先开始定位，拿到当前位置后再设为起点。");
    return;
  }

  if (selectedPoints.length === 2) {
    selectedPoints.length = 0;
    resetPreviewLayers();
  }

  selectedPoints.length = 0;
  selectedPoints.push(trackingState.currentPosition);
  updateSelectionSource();
  map.flyTo({ center: trackingState.currentPosition, zoom: Math.max(map.getZoom(), 14) });
  setStatus("已将当前位置设为起点。请在地图上点击终点，生成贴路路线。");
}

function centerOnUser() {
  if (!trackingState.currentPosition) {
    setStatus("当前位置尚未可用。");
    return;
  }
  centerMapOnCurrentUser({ zoom: 15, duration: 700 });
}

function startHiking() {
  if (trackingState.watchId === null) {
    setStatus("请先开始定位。");
    return;
  }
  if (!trackingState.currentPosition) {
    setStatus("请先拿到当前位置。");
    return;
  }
  if (trackingState.routeCoordinates.length < 2) {
    setStatus("请先生成一条路线，再开始徒步。");
    return;
  }

  startHikingSession().catch((error) => {
    setStatus(`开始徒步失败：${error.message}`);
  });
}

function stopHiking(silent = false) {
  if (!trackingState.isHikingActive) {
    return;
  }
  finishHikingSession(silent).catch((error) => {
    setStatus(`结束徒步失败：${error.message}`);
  });
}

async function startHikingSession() {
  const payload = await postJson("/api/hike-sessions/start/", {
    route: trackingState.plannedRoutePayload,
  });

  trackingState.currentSessionId = payload.id;
  trackingState.isHikingActive = true;
  trackingState.rawTrack = [trackingState.currentPosition];
  trackingState.lastMatchedRouteIndex = 0;
  trackingState.deviationCount = 0;
  trackingState.isOffRoute = false;
  trackingState.consecutiveOffRouteCount = 0;
  trackingState.startedHikingAt = Date.now();
  map.getSource("raw-track")?.setData(emptyLineFeature);
  map.getSource("walked-route")?.setData(emptyLineFeature);
  updateRawTrackSource();
  updateWalkedRouteFromPosition(trackingState.currentPosition);
  setHikingButtons();
  setSessionStatus(`徒步会话 #${payload.id} 已开始，结束后会自动保存。`);
  setStatus("已开始徒步记录。后续定位更新会把已走路线高亮出来。");
}

async function finishHikingSession(silent) {
  const walkedRouteDistance = trackingState.routeDistances[trackingState.lastMatchedRouteIndex] || 0;
  const plannedDistance = trackingState.plannedRoutePayload?.properties?.distance_meters || 0;
  const completionRatio = plannedDistance > 0 ? Math.min(walkedRouteDistance / plannedDistance, 1) : 0;

  if (trackingState.currentSessionId) {
    await postJson(`/api/hike-sessions/${trackingState.currentSessionId}/finish/`, {
      actual_track: {
        type: "Feature",
        properties: {},
        geometry: {
          type: "LineString",
          coordinates: trackingState.rawTrack,
        },
      },
      summary: {
        walked_distance_meters: trackingState.rawTrack.reduce((total, point, index, points) => {
          if (index === 0) {
            return 0;
          }
          return total + haversineMeters(points[index - 1], point);
        }, 0),
        walked_route_distance_meters: walkedRouteDistance,
        completion_ratio: completionRatio,
        deviation_count: trackingState.deviationCount,
      },
    });
  }

  trackingState.isHikingActive = false;
  trackingState.consecutiveOffRouteCount = 0;
  setHikingButtons();
  await loadRecentHikes();
  if (!silent) {
    setStatus("已结束徒步记录，并保存本次计划路线、实际轨迹和统计结果。");
  }
}

map.on("load", async () => {
  const [walkways, parks, water, places] = await Promise.all([
    loadGeoJson("/static/maps/data/beijing-walkways.geojson"),
    loadGeoJson("/static/maps/data/beijing-parks.geojson"),
    loadGeoJson("/static/maps/data/beijing-water.geojson"),
    loadGeoJson("/static/maps/data/beijing-places.geojson"),
  ]);

  map.addSource("beijing-water", {
    type: "geojson",
    data: water,
  });
  map.addSource("beijing-parks", {
    type: "geojson",
    data: parks,
  });
  map.addSource("beijing-walkways", {
    type: "geojson",
    data: walkways,
  });
  map.addSource("beijing-places", {
    type: "geojson",
    data: places,
  });

  map.addLayer({
    id: "beijing-water-fill",
    type: "fill",
    source: "beijing-water",
    filter: ["==", ["geometry-type"], "Polygon"],
    paint: {
      "fill-color": "#9bc9dc",
      "fill-opacity": 0.9,
    },
  });

  map.addLayer({
    id: "beijing-water-line",
    type: "line",
    source: "beijing-water",
    filter: ["==", ["geometry-type"], "LineString"],
    paint: {
      "line-color": "#87b8cd",
      "line-width": 1.8,
      "line-opacity": 0.85,
    },
  });

  map.addLayer({
    id: "beijing-parks-fill",
    type: "fill",
    source: "beijing-parks",
    paint: {
      "fill-color": "#cddfbf",
      "fill-opacity": 0.78,
    },
  });

  map.addLayer({
    id: "beijing-walkways-line",
    type: "line",
    source: "beijing-walkways",
    paint: {
      "line-color": [
        "match",
        ["get", "class"],
        ["primary", "secondary"], "#8a7b65",
        ["tertiary", "residential"], "#9b8d78",
        ["pedestrian", "footway", "living_street"], "#675b49",
        "#ad9f88",
      ],
      "line-width": [
        "interpolate",
        ["linear"],
        ["zoom"],
        9, 0.4,
        12, 1.3,
        15, 3.4,
      ],
      "line-opacity": 0.92,
    },
  });

  map.addLayer({
    id: "beijing-places-circle",
    type: "circle",
    source: "beijing-places",
    paint: {
      "circle-radius": [
        "match",
        ["get", "class"],
        "city", 5,
        "town", 4,
        3,
      ],
      "circle-color": "#3b3429",
      "circle-opacity": 0.75,
    },
  });

  map.addSource("scenic-spots", {
    type: "geojson",
    data: emptyFeatureCollection,
  });

  map.addSource("saved-paths", {
    type: "geojson",
    data: emptyFeatureCollection,
  });

  map.addLayer({
    id: "scenic-spots-leisure",
    type: "circle",
    source: "scenic-spots",
    filter: ["==", ["get", "category"], "leisure"],
    paint: {
      "circle-radius": [
        "interpolate",
        ["linear"],
        ["zoom"],
        10, 4,
        13, 6,
        16, 8,
      ],
      "circle-color": "#2f855a",
      "circle-stroke-color": "#fff9f1",
      "circle-stroke-width": 2,
      "circle-opacity": 0.78,
    },
  });

  map.addLayer({
    id: "scenic-spots-tourism",
    type: "circle",
    source: "scenic-spots",
    filter: ["==", ["get", "category"], "tourism"],
    paint: {
      "circle-radius": [
        "interpolate",
        ["linear"],
        ["zoom"],
        10, 4,
        13, 6.5,
        16, 9,
      ],
      "circle-color": "#cb5f3c",
      "circle-stroke-color": "#fff4ed",
      "circle-stroke-width": 2.4,
      "circle-opacity": 0.94,
    },
  });

  map.addLayer({
    id: "scenic-spots-historic",
    type: "circle",
    source: "scenic-spots",
    filter: ["==", ["get", "category"], "historic"],
    paint: {
      "circle-radius": [
        "interpolate",
        ["linear"],
        ["zoom"],
        10, 4.5,
        13, 6.8,
        16, 9.5,
      ],
      "circle-color": "#9b5de5",
      "circle-stroke-color": "#f6f0ff",
      "circle-stroke-width": 2.2,
      "circle-opacity": 0.9,
    },
  });

  map.addLayer({
    id: "scenic-spot-labels",
    type: "symbol",
    source: "scenic-spots",
    minzoom: 13,
    layout: {
      "text-field": ["get", "name"],
      "text-font": ["Open Sans Semibold"],
      "text-size": [
        "interpolate",
        ["linear"],
        ["zoom"],
        13, 10,
        16, 12,
      ],
      "text-offset": [0, 1.2],
      "text-anchor": "top",
      "text-allow-overlap": false,
    },
    paint: {
      "text-color": "#30291f",
      "text-halo-color": "#fffaf0",
      "text-halo-width": 1.2,
      "text-opacity": 0.88,
    },
  });

  map.addSource("preview-route", {
    type: "geojson",
    data: emptyLineFeature,
  });

  map.addLayer({
    id: "preview-route-glow",
    type: "line",
    source: "preview-route",
    layout: {
      "line-cap": "round",
      "line-join": "round",
    },
    paint: {
      "line-color": "#7bc4a6",
      "line-width": 14,
      "line-opacity": 0.28,
    },
  });

  map.addLayer({
    id: "preview-route-line",
    type: "line",
    source: "preview-route",
    layout: {
      "line-cap": "round",
      "line-join": "round",
    },
    paint: {
      "line-color": "#1e6b52",
      "line-width": 7,
      "line-opacity": 0.42,
    },
  });

  map.addLayer({
    id: "saved-paths-glow",
    type: "line",
    source: "saved-paths",
    layout: {
      "line-cap": "round",
      "line-join": "round",
    },
    paint: {
      "line-color": "#f4b261",
      "line-width": 9,
      "line-opacity": 0.18,
    },
  });

  map.addLayer({
    id: "saved-paths-line",
    type: "line",
    source: "saved-paths",
    layout: {
      "line-cap": "round",
      "line-join": "round",
    },
    paint: {
      "line-color": "#e67e22",
      "line-width": 4,
      "line-opacity": 0.95,
    },
  });

  map.addSource("walked-route", {
    type: "geojson",
    data: emptyLineFeature,
  });

  map.addLayer({
    id: "walked-route-glow",
    type: "line",
    source: "walked-route",
    layout: {
      "line-cap": "round",
      "line-join": "round",
    },
    paint: {
      "line-color": "#f09a4a",
      "line-width": 14,
      "line-opacity": 0.28,
    },
  });

  map.addLayer({
    id: "walked-route-line",
    type: "line",
    source: "walked-route",
    layout: {
      "line-cap": "round",
      "line-join": "round",
    },
    paint: {
      "line-color": "#d96521",
      "line-width": 7,
      "line-opacity": 0.96,
    },
  });

  map.addSource("raw-track", {
    type: "geojson",
    data: emptyLineFeature,
  });

  map.addLayer({
    id: "raw-track-line",
    type: "line",
    source: "raw-track",
    layout: {
      "line-cap": "round",
      "line-join": "round",
    },
    paint: {
      "line-color": "#2f6fa3",
      "line-width": 4,
      "line-opacity": 0.55,
      "line-dasharray": [1, 1.5],
    },
  });

  map.addSource("route-connectors", {
    type: "geojson",
    data: emptyFeatureCollection,
  });

  map.addLayer({
    id: "route-connectors",
    type: "line",
    source: "route-connectors",
    layout: {
      "line-cap": "round",
      "line-join": "round",
    },
    paint: {
      "line-color": "#1e6b52",
      "line-width": 3,
      "line-opacity": 0.7,
      "line-dasharray": [2, 2],
    },
  });

  map.addSource("selected-points", {
    type: "geojson",
    data: emptyFeatureCollection,
  });

  map.addLayer({
    id: "selected-points",
    type: "circle",
    source: "selected-points",
    paint: {
      "circle-radius": 8,
      "circle-color": "#f8f4ea",
      "circle-stroke-width": 3,
      "circle-stroke-color": "#1e6b52",
    },
  });

  map.addSource("user-location", {
    type: "geojson",
    data: emptyFeatureCollection,
  });

  map.addLayer({
    id: "user-location-accuracy",
    type: "circle",
    source: "user-location",
    paint: {
      "circle-radius": 18,
      "circle-color": "#4ea7d8",
      "circle-opacity": 0.18,
    },
  });

  map.addLayer({
    id: "user-location",
    type: "circle",
    source: "user-location",
    paint: {
      "circle-radius": 0.1,
      "circle-color": "#1173b6",
      "circle-opacity": 0,
    },
  });

  const markerElement = document.createElement("div");
  markerElement.className = "user-location-marker is-hidden";
  userLocationMarker = new maplibregl.Marker({
    element: markerElement,
    rotationAlignment: "map",
    pitchAlignment: "map",
  })
    .setLngLat(map.getCenter())
    .addTo(map);

  await loadScenicSpotsForViewport();
  await loadRecentHikes();
  await loadSavedPaths();
  startTrackingInternal({ silent: true });
});

const scenicSpotLayers = [
  "scenic-spots-leisure",
  "scenic-spots-tourism",
  "scenic-spots-historic",
];
const savedPathLayers = ["saved-paths-line", "saved-paths-glow"];

scenicSpotLayers.forEach((layerId) => map.on("mouseenter", layerId, () => {
  map.getCanvas().style.cursor = "pointer";
}));

scenicSpotLayers.forEach((layerId) => map.on("mouseleave", layerId, () => {
  map.getCanvas().style.cursor = "";
}));

savedPathLayers.forEach((layerId) => map.on("mouseenter", layerId, () => {
  map.getCanvas().style.cursor = "pointer";
}));

savedPathLayers.forEach((layerId) => map.on("mouseleave", layerId, () => {
  map.getCanvas().style.cursor = "";
}));

scenicSpotLayers.forEach((layerId) => map.on("click", layerId, (event) => {
  const feature = event.features?.[0];
  if (!feature) {
    return;
  }

  const coordinates = feature.geometry.coordinates.slice();
  const { name, category, subcategory } = feature.properties;

  scenicSpotPopup?.remove();
  scenicSpotPopup = new maplibregl.Popup({ offset: 18 })
    .setLngLat(coordinates)
    .setHTML(`
      <span class="spot-pill" data-category="${category}">${category}</span>
      <h3 class="popup-title">${name}</h3>
      <p class="popup-body">${subcategory || "spot"}</p>
    `)
    .addTo(map);
}));

savedPathLayers.forEach((layerId) => map.on("click", layerId, (event) => {
  const feature = event.features?.[0];
  if (!feature) {
    return;
  }

  setActiveNavigationFeature(feature, { fitBounds: false });
}));

map.on("moveend", async () => {
  try {
    await loadScenicSpotsForViewport();
  } catch (error) {
    console.error(error);
  }
});

map.on("click", async (event) => {
  const interactiveLayers = [...scenicSpotLayers, ...savedPathLayers];
  const renderedFeatures = map.queryRenderedFeatures(event.point, { layers: interactiveLayers });
  if (renderedFeatures.length > 0) {
    return;
  }

  const coordinates = [event.lngLat.lng, event.lngLat.lat];
  if (selectedPoints.length === 2) {
    selectedPoints.length = 0;
    resetPreviewLayers();
  }

  selectedPoints.push(coordinates);
  updateSelectionSource();

  if (selectedPoints.length === 1) {
    setStatus("已选择起点。请再点击一个终点，系统会按道路网络计算路线。");
    return;
  }

  try {
    await requestRoutePreview();
  } catch (error) {
    resetPreviewLayers();
    setStatus(`路线计算失败：${error.message}`);
  }
});

startTrackingButton.addEventListener("click", startTracking);
stopTrackingButton.addEventListener("click", stopTracking);
useCurrentLocationButton.addEventListener("click", useCurrentLocationAsStart);
centerOnUserButton.addEventListener("click", centerOnUser);
startHikeButton.addEventListener("click", startHiking);
stopHikeButton.addEventListener("click", () => stopHiking(false));
uploadGpxButton.addEventListener("click", () => {
  uploadGpxFile().catch((error) => {
    setGpxStatus(`GPX 导入失败：${error.message}`);
  });
});
togglePanelsButton?.addEventListener("click", togglePanels);
savedPathsSummaryElement.addEventListener("click", (event) => {
  const button = event.target.closest("[data-path-id]");
  if (!button) {
    return;
  }

  const pathId = Number(button.dataset.pathId);
  const feature = (trackingState.savedPathsFeatureCollection.features || []).find(
    (item) => (item.properties.canonical_path_id || item.properties.id) === pathId,
  );
  if (!feature) {
    setLocalNavigationStatus("未找到对应的本地路径，请重新读取路径列表。");
    return;
  }

  setActiveNavigationFeature(feature, { fitBounds: true });
});
setTrackingButtons();
setHikingButtons();
updateRemainingDistanceDisplay(NaN);
