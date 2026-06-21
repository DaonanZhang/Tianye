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
