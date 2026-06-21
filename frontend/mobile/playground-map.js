map.on("load", async () => {
  const [walkways, parks, water, places] = await Promise.all([
    loadGeoJson("/static/maps/data/beijing-walkways.geojson"),
    loadGeoJson("/static/maps/data/beijing-parks.geojson"),
    loadGeoJson("/static/maps/data/beijing-water.geojson"),
    loadGeoJson("/static/maps/data/beijing-places.geojson"),
  ]);

  map.addSource("beijing-water", { type: "geojson", data: water });
  map.addSource("beijing-parks", { type: "geojson", data: parks });
  map.addSource("beijing-walkways", { type: "geojson", data: walkways });
  map.addSource("beijing-places", { type: "geojson", data: places });

  map.addLayer({
    id: "beijing-water-fill",
    type: "fill",
    source: "beijing-water",
    filter: ["==", ["geometry-type"], "Polygon"],
    paint: { "fill-color": "#9bc9dc", "fill-opacity": 0.9 },
  });

  map.addLayer({
    id: "beijing-water-line",
    type: "line",
    source: "beijing-water",
    filter: ["==", ["geometry-type"], "LineString"],
    paint: { "line-color": "#87b8cd", "line-width": 1.8, "line-opacity": 0.85 },
  });

  map.addLayer({
    id: "beijing-parks-fill",
    type: "fill",
    source: "beijing-parks",
    paint: { "fill-color": "#cddfbf", "fill-opacity": 0.78 },
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
      "circle-radius": ["match", ["get", "class"], "city", 5, "town", 4, 3],
      "circle-color": "#3b3429",
      "circle-opacity": 0.75,
    },
  });

  map.addSource("scenic-spots", { type: "geojson", data: emptyFeatureCollection });
  map.addSource("saved-paths", { type: "geojson", data: emptyFeatureCollection });

  map.addLayer({
    id: "scenic-spots-leisure",
    type: "circle",
    source: "scenic-spots",
    filter: ["==", ["get", "category"], "leisure"],
    paint: {
      "circle-radius": ["interpolate", ["linear"], ["zoom"], 10, 4, 13, 6, 16, 8],
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
      "circle-radius": ["interpolate", ["linear"], ["zoom"], 10, 4, 13, 6.5, 16, 9],
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
      "circle-radius": ["interpolate", ["linear"], ["zoom"], 10, 4.5, 13, 6.8, 16, 9.5],
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
      "text-size": ["interpolate", ["linear"], ["zoom"], 13, 10, 16, 12],
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

  map.addSource("preview-route", { type: "geojson", data: emptyLineFeature });
  map.addLayer({
    id: "preview-route-glow",
    type: "line",
    source: "preview-route",
    layout: { "line-cap": "round", "line-join": "round" },
    paint: { "line-color": "#7bc4a6", "line-width": 14, "line-opacity": 0.28 },
  });
  map.addLayer({
    id: "preview-route-line",
    type: "line",
    source: "preview-route",
    layout: { "line-cap": "round", "line-join": "round" },
    paint: { "line-color": "#1e6b52", "line-width": 7, "line-opacity": 0.42 },
  });

  map.addLayer({
    id: "saved-paths-glow",
    type: "line",
    source: "saved-paths",
    layout: { "line-cap": "round", "line-join": "round" },
    paint: { "line-color": "#f4b261", "line-width": 9, "line-opacity": 0.18 },
  });
  map.addLayer({
    id: "saved-paths-line",
    type: "line",
    source: "saved-paths",
    layout: { "line-cap": "round", "line-join": "round" },
    paint: { "line-color": "#e67e22", "line-width": 4, "line-opacity": 0.95 },
  });

  map.addSource("walked-route", { type: "geojson", data: emptyLineFeature });
  map.addLayer({
    id: "walked-route-glow",
    type: "line",
    source: "walked-route",
    layout: { "line-cap": "round", "line-join": "round" },
    paint: { "line-color": "#f09a4a", "line-width": 14, "line-opacity": 0.28 },
  });
  map.addLayer({
    id: "walked-route-line",
    type: "line",
    source: "walked-route",
    layout: { "line-cap": "round", "line-join": "round" },
    paint: { "line-color": "#d96521", "line-width": 7, "line-opacity": 0.96 },
  });

  map.addSource("raw-track", { type: "geojson", data: emptyLineFeature });
  map.addLayer({
    id: "raw-track-line",
    type: "line",
    source: "raw-track",
    layout: { "line-cap": "round", "line-join": "round" },
    paint: {
      "line-color": "#2f6fa3",
      "line-width": 4,
      "line-opacity": 0.55,
      "line-dasharray": [1, 1.5],
    },
  });

  map.addSource("route-connectors", { type: "geojson", data: emptyFeatureCollection });
  map.addLayer({
    id: "route-connectors",
    type: "line",
    source: "route-connectors",
    layout: { "line-cap": "round", "line-join": "round" },
    paint: {
      "line-color": "#1e6b52",
      "line-width": 3,
      "line-opacity": 0.7,
      "line-dasharray": [2, 2],
    },
  });

  map.addSource("selected-points", { type: "geojson", data: emptyFeatureCollection });
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

  map.addSource("user-location", { type: "geojson", data: emptyFeatureCollection });
  map.addLayer({
    id: "user-location-accuracy",
    type: "circle",
    source: "user-location",
    paint: { "circle-radius": 18, "circle-color": "#4ea7d8", "circle-opacity": 0.18 },
  });
  map.addLayer({
    id: "user-location",
    type: "circle",
    source: "user-location",
    paint: { "circle-radius": 0.1, "circle-color": "#1173b6", "circle-opacity": 0 },
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
  const interactiveLayers = [...scenicSpotLayers, ...savedPathLayers]
    .filter((layerId) => map.getLayer(layerId));
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
