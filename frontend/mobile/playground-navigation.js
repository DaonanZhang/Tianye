function updateRemainingDistanceDisplay(distanceMeters) {
  if (trackingState.routeCoordinates.length < 2) {
    setMetric(remainingDistanceElement, "未选择路径");
    return;
  }
  setMetric(remainingDistanceElement, formatDistance(Math.max(distanceMeters, 0)));
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
  activateTab("navigate-panel");

  if (fitBounds) {
    const bounds = featureBounds(feature);
    if (!bounds.isEmpty()) {
      map.fitBounds(bounds, { padding: 70, duration: fromCache ? 0 : 900 });
    }
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
  activateTab("navigate-panel");
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
    setStatus("当前位置尚未可用。");
    return;
  }
  map.easeTo({
    center: trackingState.currentPosition,
    zoom: options.zoom || Math.max(map.getZoom(), 15),
    duration: options.duration || 700,
  });
}

function handleDeviceOrientation(event) {
  const alpha = event.webkitCompassHeading ?? event.alpha;
  if (typeof alpha !== "number") {
    return;
  }
  trackingState.deviceHeading = normalizedHeadingDegrees(alpha);
  updateUserMarkerRotation();
}

async function ensureOrientationTracking() {
  if (trackingState.orientationListenerAttached) {
    return;
  }

  const requestPermission = window.DeviceOrientationEvent?.requestPermission;
  if (typeof requestPermission === "function") {
    try {
      const permission = await requestPermission();
      if (permission !== "granted") {
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
  map.getSource("raw-track")?.setData({
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

  let best = null;
  const startIndex = Math.max(trackingState.lastMatchedRouteIndex - 20, 0);
  for (let index = startIndex; index < trackingState.routeCoordinates.length - 1; index += 1) {
    const distance = distancePointToSegmentMeters(
      positionCoordinates,
      trackingState.routeCoordinates[index],
      trackingState.routeCoordinates[index + 1],
    );

    if (!best || distance < best.distance) {
      best = { index, distance };
    }
  }
  return best;
}

function updateWalkedRouteFromPosition(positionCoordinates) {
  if (trackingState.routeCoordinates.length < 2) {
    return;
  }

  const matchedPoint = findNearestRouteMatch(positionCoordinates);
  if (!matchedPoint) {
    return;
  }

  if (matchedPoint.distance > trackingState.offRouteThresholdMeters) {
    trackingState.consecutiveOffRouteCount += 1;
    if (trackingState.consecutiveOffRouteCount >= trackingState.offRouteConsecutiveFixes && !trackingState.isOffRoute) {
      trackingState.isOffRoute = true;
      trackingState.deviationCount += 1;
      setStatus("检测到你已连续偏离规划路线，已记为一次偏航。可以继续前进，或重新选终点再规划。");
    }
    return;
  }

  if (trackingState.isOffRoute) {
    setStatus("已重新回到规划路线，继续记录已走路段。");
  }
  trackingState.consecutiveOffRouteCount = 0;
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

  updateWalkedRouteFromPosition(coordinates);
}

function handleTrackingError(error) {
  setStatus(`定位失败：${error.message}`);
}

function startTrackingInternal({ silent = false } = {}) {
  if (!navigator.geolocation) {
    setStatus("当前浏览器不支持 Geolocation API。");
    return;
  }

  if (trackingState.watchId !== null) {
    return;
  }

  ensureOrientationTracking();
  trackingState.watchId = navigator.geolocation.watchPosition(handleTrackingUpdate, handleTrackingError, {
    enableHighAccuracy: true,
    maximumAge: 1000,
    timeout: 15000,
  });
  setTrackingButtons();
  if (!silent) {
    setStatus("正在读取手机当前位置。首次授权后，会持续记录移动位置。");
  }
}

function startTracking() {
  startTrackingInternal({ silent: false });
}

function stopTracking() {
  if (trackingState.watchId !== null) {
    navigator.geolocation.clearWatch(trackingState.watchId);
    trackingState.watchId = null;
  }
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
  activateTab("navigate-panel");
  setStatus("已将当前位置设为起点。请在地图上点击终点，生成贴路路线。");
}

function centerOnUser() {
  if (!trackingState.currentPosition) {
    setStatus("当前位置尚未可用。");
    return;
  }
  centerMapOnCurrentUser();
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
