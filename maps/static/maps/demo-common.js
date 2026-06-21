const localDataLayers = [
  {
    id: "parks",
    url: "/static/maps/data/beijing-parks.geojson",
    type: "fill",
    paint: {
      "fill-color": "#d7ebd7",
      "fill-opacity": 0.75,
    },
  },
  {
    id: "water",
    url: "/static/maps/data/beijing-water.geojson",
    type: "line",
    paint: {
      "line-color": "#6f8fa8",
      "line-width": 1.5,
      "line-opacity": 0.85,
    },
  },
  {
    id: "walkways",
    url: "/static/maps/data/beijing-walkways.geojson",
    type: "line",
    paint: {
      "line-color": "#a7a391",
      "line-width": 0.8,
      "line-opacity": 0.45,
    },
  },
];

export function formatCoordinate(point) {
  if (!point) {
    return "未知";
  }
  return `${point.latitude.toFixed(5)}, ${point.longitude.toFixed(5)}`;
}

export function formatDistance(meters) {
  if (!Number.isFinite(meters)) {
    return "未知";
  }
  if (meters >= 1000) {
    return `${(meters / 1000).toFixed(2)} km`;
  }
  return `${Math.round(meters)} m`;
}

export function formatMinutes(minutes) {
  const value = Math.max(Math.round(minutes || 0), 0);
  const hours = Math.floor(value / 60);
  const remainder = value % 60;
  if (hours === 0) {
    return `${remainder} 分钟`;
  }
  if (remainder === 0) {
    return `${hours} 小时`;
  }
  return `${hours} 小时 ${remainder} 分钟`;
}

export function metricsFromPayload(payload) {
  return [
    ["总距离", formatDistance(payload.analysis.distance_meters)],
    ["预计/实际用时", formatMinutes(payload.analysis.display_duration_minutes)],
    ["起点坐标", formatCoordinate(payload.analysis.start)],
    ["终点坐标", formatCoordinate(payload.analysis.end)],
    ["路线类型", payload.analysis.is_loop ? "闭环路线" : "单程路线"],
    ["停留点数量", `${payload.analysis.stop_point_count}`],
    ["难度", payload.analysis.difficulty.label],
    ["时间来源", payload.analysis.duration_source === "gpx" ? "GPX 时间字段" : "估算值"],
  ];
}

export function renderMetrics(target, items) {
  target.innerHTML = items
    .map(
      ([label, value]) => `
        <div class="metric-item">
          <dt>${label}</dt>
          <dd>${value}</dd>
        </div>
      `,
    )
    .join("");
}

function boundsFromCoordinates(coordinates) {
  const bounds = new maplibregl.LngLatBounds();
  coordinates.forEach((coordinate) => bounds.extend(coordinate));
  return bounds;
}

export async function createDemoMap(containerId) {
  const map = new maplibregl.Map({
    container: containerId,
    style: {
      version: 8,
      sources: {},
      layers: [
        {
          id: "background",
          type: "background",
          paint: {
            "background-color": "#f0ead9",
          },
        },
      ],
    },
    center: [116.3975, 39.9185],
    zoom: 11,
    minZoom: 9,
    maxZoom: 16,
    renderWorldCopies: false,
  });

  map.addControl(new maplibregl.NavigationControl(), "top-right");

  await new Promise((resolve) => map.on("load", resolve));
  for (const layer of localDataLayers) {
    map.addSource(layer.id, {
      type: "geojson",
      data: layer.url,
    });
    map.addLayer({
      id: layer.id,
      source: layer.id,
      type: layer.type,
      paint: layer.paint,
    });
  }

  map.addSource("route", {
    type: "geojson",
    data: {
      type: "Feature",
      properties: {},
      geometry: {
        type: "LineString",
        coordinates: [],
      },
    },
  });
  map.addLayer({
    id: "route-line",
    source: "route",
    type: "line",
    paint: {
      "line-color": "#cb6d36",
      "line-width": 4.5,
      "line-opacity": 0.95,
    },
  });

  map.addSource("markers", {
    type: "geojson",
    data: {
      type: "FeatureCollection",
      features: [],
    },
  });
  map.addLayer({
    id: "markers-fill",
    source: "markers",
    type: "circle",
    paint: {
      "circle-radius": 6,
      "circle-color": ["match", ["get", "kind"], "start", "#2b5f4b", "#8e4b44"],
      "circle-stroke-width": 2,
      "circle-stroke-color": "#fff9f1",
    },
  });

  map.addSource("stops", {
    type: "geojson",
    data: {
      type: "FeatureCollection",
      features: [],
    },
  });
  map.addLayer({
    id: "stops-fill",
    source: "stops",
    type: "circle",
    paint: {
      "circle-radius": 5,
      "circle-color": "#ebb15a",
      "circle-stroke-width": 2,
      "circle-stroke-color": "#6a4529",
    },
  });

  return map;
}

export function renderRouteOnMap(map, payload) {
  map.getSource("route").setData({
    type: "Feature",
    properties: {},
    geometry: payload.geometry,
  });

  map.getSource("markers").setData({
    type: "FeatureCollection",
    features: [
      {
        type: "Feature",
        properties: { kind: "start", label: "起点" },
        geometry: {
          type: "Point",
          coordinates: [payload.analysis.start.longitude, payload.analysis.start.latitude],
        },
      },
      {
        type: "Feature",
        properties: { kind: "end", label: "终点" },
        geometry: {
          type: "Point",
          coordinates: [payload.analysis.end.longitude, payload.analysis.end.latitude],
        },
      },
    ],
  });

  map.getSource("stops").setData({
    type: "FeatureCollection",
    features: (payload.analysis.stop_points || []).map((stop, index) => ({
      type: "Feature",
      properties: {
        label: `停留点 ${index + 1}`,
        duration_seconds: stop.duration_seconds,
      },
      geometry: {
        type: "Point",
        coordinates: [stop.longitude, stop.latitude],
      },
    })),
  });

  if ((payload.geometry.coordinates || []).length > 1) {
    map.fitBounds(boundsFromCoordinates(payload.geometry.coordinates), {
      padding: 48,
      duration: 0,
    });
  }

  if (!map.__tianyeStopPopupBound) {
    const popup = new maplibregl.Popup({
      closeButton: false,
      closeOnClick: false,
    });

    map.on("mouseenter", "stops-fill", (event) => {
      map.getCanvas().style.cursor = "pointer";
      const feature = event.features?.[0];
      if (!feature) {
        return;
      }
      const coordinates = feature.geometry.coordinates.slice();
      const minutes = Math.round((feature.properties.duration_seconds || 0) / 60);
      popup
        .setLngLat(coordinates)
        .setHTML(`<strong>${feature.properties.label}</strong><br>约停留 ${minutes} 分钟`)
        .addTo(map);
    });

    map.on("mouseleave", "stops-fill", () => {
      map.getCanvas().style.cursor = "";
      popup.remove();
    });

    map.__tianyeStopPopupBound = true;
  }
}

export function renderStory(target, story) {
  target.innerHTML = `
    <h3>${story.title}</h3>
    <p>${story.summary}</p>
    <h3>适合人群</h3>
    <p>${story.best_for}</p>
    <h3>路线亮点</h3>
    <ul>${story.highlights.map((item) => `<li>${item}</li>`).join("")}</ul>
    <h3>难度描述</h3>
    <p>${story.difficulty_text}</p>
    <h3>注意事项</h3>
    <ul>${story.cautions.map((item) => `<li>${item}</li>`).join("")}</ul>
  `;
}

export function updateSparkline(target, coordinates) {
  if (!coordinates || coordinates.length < 2) {
    target.innerHTML = "";
    return;
  }

  const longitudes = coordinates.map((item) => item[0]);
  const latitudes = coordinates.map((item) => item[1]);
  const minLng = Math.min(...longitudes);
  const maxLng = Math.max(...longitudes);
  const minLat = Math.min(...latitudes);
  const maxLat = Math.max(...latitudes);
  const width = 220;
  const height = 160;
  const padding = 16;
  const lngSpan = maxLng - minLng || 1;
  const latSpan = maxLat - minLat || 1;
  const path = coordinates
    .map((coordinate, index) => {
      const x = padding + ((coordinate[0] - minLng) / lngSpan) * (width - padding * 2);
      const y = height - padding - ((coordinate[1] - minLat) / latSpan) * (height - padding * 2);
      return `${index === 0 ? "M" : "L"} ${x.toFixed(1)} ${y.toFixed(1)}`;
    })
    .join(" ");

  target.innerHTML = `
    <rect x="0" y="0" width="${width}" height="${height}" rx="18" fill="rgba(255,255,255,0.06)"></rect>
    <path d="${path}" fill="none" stroke="#f1c373" stroke-width="5" stroke-linecap="round" stroke-linejoin="round"></path>
  `;
}
