const beijingBounds = [
  [115.7, 39.5],
  [116.8, 40.1],
];

const statusElement = document.getElementById("route-status");
const currentLocationElement = [
  document.getElementById("current-location"),
  document.getElementById("current-location-panel"),
].filter(Boolean);
const currentAltitudeElement = [
  document.getElementById("current-altitude"),
  document.getElementById("current-altitude-panel"),
].filter(Boolean);
const walkedDistanceElement = [
  document.getElementById("walked-distance"),
  document.getElementById("walked-distance-panel"),
].filter(Boolean);
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
const remainingDistanceElement = [
  document.getElementById("remaining-distance"),
  document.getElementById("remaining-distance-panel"),
].filter(Boolean);
const localNavigationStatusElement = document.getElementById("local-navigation-status");
const togglePanelsButton = document.getElementById("toggle-panels");
const tabButtons = Array.from(document.querySelectorAll("[data-tab-target]"));
const tabPanels = Array.from(document.querySelectorAll("[data-tab-panel]"));

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

function setStatus(message) {
  statusElement.textContent = message;
}

function setMetric(element, message) {
  const elements = Array.isArray(element) ? element : [element];
  elements.filter(Boolean).forEach((item) => {
    item.textContent = message;
  });
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

function activateTab(tabId) {
  tabButtons.forEach((button) => {
    const isActive = button.dataset.tabTarget === tabId;
    button.classList.toggle("is-active", isActive);
    button.setAttribute("aria-selected", String(isActive));
  });

  tabPanels.forEach((panel) => {
    const isActive = panel.id === tabId;
    panel.classList.toggle("is-active", isActive);
    panel.hidden = !isActive;
  });
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
