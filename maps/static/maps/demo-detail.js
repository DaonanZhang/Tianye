import {
  createDemoMap,
  metricsFromPayload,
  renderMetrics,
  renderRouteOnMap,
  renderStory,
  updateSparkline,
} from "./demo-common.js";

const page = document.querySelector(".detail-page");
const routeId = page?.dataset.routeId;
const subtitleElement = document.getElementById("route-subtitle");
const metricsElement = document.getElementById("metrics-grid");
const launchStatusElement = document.getElementById("launch-status");
const detailRatingElement = document.getElementById("detail-rating");
const detailReviewsElement = document.getElementById("detail-reviews");
const detailBadgesElement = document.getElementById("detail-badges");
const storyPanel = document.getElementById("story-panel");
const storyContent = document.getElementById("story-content");
const storyStatus = document.getElementById("story-status");
const cardPanel = document.getElementById("card-panel");
const startRouteButton = document.getElementById("start-route");
const generateStoryButton = document.getElementById("generate-story");
const generateCardButton = document.getElementById("generate-card");
const copyShareTextButton = document.getElementById("copy-share-text");
const cardTitle = document.getElementById("card-title");
const cardSummary = document.getElementById("card-summary");
const cardHighlights = document.getElementById("card-highlights");
const routeSparkline = document.getElementById("route-sparkline");
const sessionCard = document.getElementById("session-card");
const sessionTitle = document.getElementById("session-title");
const sessionCopy = document.getElementById("session-copy");
const sessionMeta = document.getElementById("session-meta");
const finishRouteButton = document.getElementById("finish-route");
const repeatRouteButton = document.getElementById("repeat-route");
const recentSessionsStatusElement = document.getElementById("recent-sessions-status");
const recentSessionsElement = document.getElementById("recent-sessions");
const startRouteModal = document.getElementById("start-route-modal");
const closeStartRouteModalButton = document.getElementById("close-start-route-modal");
const confirmStartRouteButton = document.getElementById("confirm-start-route");

let routePayload = null;
let map = null;
let currentSession = null;

function setStartModalVisible(isVisible) {
  if (!startRouteModal) {
    return;
  }
  startRouteModal.classList.toggle("hidden", !isVisible);
  startRouteModal.setAttribute("aria-hidden", String(!isVisible));
}

function getCookie(name) {
  const cookies = document.cookie ? document.cookie.split(";") : [];
  for (const chunk of cookies) {
    const item = chunk.trim();
    if (item.startsWith(`${name}=`)) {
      return decodeURIComponent(item.slice(name.length + 1));
    }
  }
  return "";
}

function formatStartTime(isoString) {
  return new Intl.DateTimeFormat("zh-Hans-CN", {
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(isoString));
}

function formatDurationMinutes(totalMinutes) {
  const minutes = Math.max(Math.round(totalMinutes || 0), 0);
  const hours = Math.floor(minutes / 60);
  const remainder = minutes % 60;
  if (hours === 0) {
    return `${remainder} min`;
  }
  if (remainder === 0) {
    return `${hours} h`;
  }
  return `${hours} h ${remainder} min`;
}

async function copyText(text) {
  try {
    await navigator.clipboard.writeText(text);
    storyStatus.textContent = "分享文案已复制";
  } catch (error) {
    storyStatus.textContent = "复制失败，请手动复制";
  }
}

function hydrateCard(payload) {
  cardTitle.textContent = payload.name;
  cardSummary.textContent = payload.card.summary;
  cardHighlights.innerHTML = payload.card.highlights.map((item) => `<li>${item}</li>`).join("");
  updateSparkline(routeSparkline, payload.geometry.coordinates);
}

function hydrateHeader(payload) {
  detailRatingElement.textContent = `${payload.social.rating.toFixed(1)} ★`;
  detailReviewsElement.textContent = `${payload.social.review_count.toLocaleString("en-US")} reviews`;
  detailBadgesElement.innerHTML = `
    <span class="detail-badge">${payload.analysis.difficulty.label}</span>
    <span class="detail-badge">${payload.social.route_type}</span>
    <span class="detail-badge">${payload.analysis.distance_km} km</span>
    <span class="detail-badge">${payload.dependency}</span>
  `;
}

function buildSessionPayload(payload) {
  return {
    route: {
      type: "Feature",
      properties: {
        name: payload.name,
        distance_meters: payload.analysis.distance_meters,
        ascent_meters: payload.analysis.ascent_meters,
        descent_meters: payload.analysis.descent_meters,
        start: [payload.analysis.start.longitude, payload.analysis.start.latitude],
        end: [payload.analysis.end.longitude, payload.analysis.end.latitude],
        estimated_time: {
          moving_minutes: payload.analysis.estimated_minutes,
          recommended_minutes: payload.analysis.display_duration_minutes,
        },
        source: "demo-route",
        dependency: payload.dependency,
        difficulty: payload.analysis.difficulty.code,
        route_id: payload.id,
      },
      geometry: payload.geometry,
    },
  };
}

function buildFinishPayload(payload) {
  const walkedDistance = payload.analysis.distance_meters;
  return {
    actual_track: {
      type: "Feature",
      properties: {
        source: "demo-finish",
      },
      geometry: payload.geometry,
    },
    summary: {
      walked_distance_meters: walkedDistance,
      walked_route_distance_meters: walkedDistance,
      completion_ratio: 1.0,
      deviation_count: 0,
    },
  };
}

async function postJson(url, payload) {
  const response = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-CSRFToken": getCookie("csrftoken"),
    },
    body: JSON.stringify(payload),
  });
  const data = await response.json();
  if (!response.ok) {
    throw new Error(data.error || "Request failed.");
  }
  return data;
}

function renderActiveSession(session) {
  currentSession = session;
  sessionCard.classList.remove("hidden");
  sessionTitle.textContent = "Route is live";
  sessionCopy.textContent = "The demo session has started from this trail detail page. You can now finish a lightweight walk result and keep a repeatable record on this route.";
  sessionMeta.innerHTML = `
    <span class="session-badge">Session #${session.id}</span>
    <span class="session-badge">Status: ${session.status}</span>
    <span class="session-badge">Started ${formatStartTime(session.started_at)}</span>
  `;
  launchStatusElement.textContent = "Route started successfully. The outer shell can stay mocked; the core action is now real.";
  startRouteButton.disabled = true;
  startRouteButton.textContent = "Route started";
  finishRouteButton.disabled = false;
  repeatRouteButton.classList.add("hidden");
  confirmStartRouteButton.disabled = false;
  setStartModalVisible(false);
}

function renderCompletedSession(session) {
  currentSession = null;
  sessionCard.classList.remove("hidden");
  sessionTitle.textContent = "Route completed";
  sessionCopy.textContent = "This route now has a walk record on its own detail page. That moves the demo closer to the BP's repeat-walk and reuse loop.";
  sessionMeta.innerHTML = `
    <span class="session-badge">Session #${session.id}</span>
    <span class="session-badge">Completed</span>
    <span class="session-badge">Duration ${formatDurationMinutes((session.actual_duration_seconds || 0) / 60)}</span>
  `;
  launchStatusElement.textContent = "Demo walk finished. This route now has a reusable walk record.";
  finishRouteButton.disabled = true;
  repeatRouteButton.classList.remove("hidden");
  startRouteButton.disabled = false;
  startRouteButton.textContent = "Hit the trail again";
}

function renderRecentSessions(sessions) {
  if (!sessions.length) {
    recentSessionsElement.innerHTML = "";
    recentSessionsStatusElement.textContent = "No walks yet";
    return;
  }

  recentSessionsStatusElement.textContent = `${sessions.length} recent walk${sessions.length > 1 ? "s" : ""}`;
  recentSessionsElement.innerHTML = sessions
    .map((session) => {
      const durationLabel = session.actual_duration_seconds > 0
        ? formatDurationMinutes(session.actual_duration_seconds / 60)
        : formatDurationMinutes(session.planned_recommended_minutes);
      const statusLabel = session.status === "completed" ? "Completed walk" : "Active walk";
      return `
        <article class="recent-session-item">
          <div>
            <strong>${statusLabel} · ${formatStartTime(session.started_at)}</strong>
            <p class="recent-session-copy">${session.route_name || routePayload?.name || "Trail"} · ${session.difficulty || "demo"} · ${session.dependency || "local-data"}</p>
          </div>
          <div class="recent-session-meta">
            <span class="session-badge">${(session.completion_ratio * 100).toFixed(0)}%</span>
            <span class="session-badge">${durationLabel}</span>
          </div>
        </article>
      `;
    })
    .join("");
}

async function loadRoute() {
  const response = await fetch(`/api/demo-routes/${routeId}/`);
  const payload = await response.json();
  if (!response.ok) {
    throw new Error(payload.error || "Failed to load route.");
  }
  return payload;
}

async function loadRecentSessions() {
  if (!routeId) {
    return;
  }

  recentSessionsStatusElement.textContent = "Loading";
  const response = await fetch(`/api/hike-sessions/?route_id=${encodeURIComponent(routeId)}`);
  const payload = await response.json();
  if (!response.ok) {
    throw new Error(payload.error || "Failed to load recent sessions.");
  }
  renderRecentSessions(payload.sessions || []);
}

async function initialize() {
  if (!routeId) {
    return;
  }

  map = await createDemoMap("detail-map");

  try {
    routePayload = await loadRoute();
    await loadRecentSessions();
  } catch (error) {
    subtitleElement.textContent = error.message;
    recentSessionsStatusElement.textContent = "Load failed";
    return;
  }

  subtitleElement.textContent = `${routePayload.description} 当前路线共 ${routePayload.analysis.distance_km} km，适合用于 3-5 分钟产品演示。`;
  hydrateHeader(routePayload);
  renderMetrics(metricsElement, metricsFromPayload(routePayload));
  renderRouteOnMap(map, routePayload);
  generateCardButton.disabled = false;
  copyShareTextButton.disabled = false;
}

async function startCurrentRoute() {
  if (!routePayload || currentSession) {
    return;
  }

  startRouteButton.disabled = true;
  confirmStartRouteButton.disabled = true;
  startRouteButton.textContent = "Starting";
  launchStatusElement.textContent = "Creating a real demo hike session for this route.";

  try {
    const session = await postJson("/api/hike-sessions/start/", buildSessionPayload(routePayload));
    renderActiveSession(session);
    await loadRecentSessions();
  } catch (error) {
    launchStatusElement.textContent = error.message;
    startRouteButton.disabled = false;
    confirmStartRouteButton.disabled = false;
    startRouteButton.textContent = "Hit the trail";
  }
}

async function finishCurrentRoute() {
  if (!routePayload || !currentSession) {
    return;
  }

  finishRouteButton.disabled = true;
  launchStatusElement.textContent = "Finishing the current demo walk.";

  try {
    const session = await postJson(`/api/hike-sessions/${currentSession.id}/finish/`, buildFinishPayload(routePayload));
    renderCompletedSession(session);
    await loadRecentSessions();
  } catch (error) {
    launchStatusElement.textContent = error.message;
    finishRouteButton.disabled = false;
  }
}

startRouteButton?.addEventListener("click", () => {
  if (!routePayload || currentSession) {
    return;
  }
  setStartModalVisible(true);
});

confirmStartRouteButton?.addEventListener("click", startCurrentRoute);
finishRouteButton?.addEventListener("click", finishCurrentRoute);

repeatRouteButton?.addEventListener("click", () => {
  currentSession = null;
  repeatRouteButton.classList.add("hidden");
  finishRouteButton.disabled = true;
  sessionTitle.textContent = "Trail ready again";
  sessionCopy.textContent = "You can start the same route again to demonstrate repeatability.";
  launchStatusElement.textContent = "The route is ready to be started again.";
  startRouteButton.disabled = false;
  startRouteButton.textContent = "Hit the trail";
});

closeStartRouteModalButton?.addEventListener("click", () => setStartModalVisible(false));
startRouteModal?.addEventListener("click", (event) => {
  if (event.target.dataset.closeStartModal === "true") {
    setStartModalVisible(false);
  }
});

generateStoryButton?.addEventListener("click", () => {
  if (!routePayload) {
    return;
  }

  storyPanel.classList.remove("hidden");
  storyStatus.textContent = "Generating";
  storyContent.innerHTML = "<p>Generating a lightweight trail overview from distance, difficulty, loop status, and stop points.</p>";

  window.setTimeout(() => {
    renderStory(storyContent, routePayload.story);
    storyStatus.textContent = "Generated";
  }, 320);
});

generateCardButton?.addEventListener("click", () => {
  if (!routePayload) {
    return;
  }

  cardPanel.classList.remove("hidden");
  hydrateCard(routePayload);
});

copyShareTextButton?.addEventListener("click", () => {
  if (!routePayload) {
    return;
  }
  copyText(routePayload.story.share_text);
});

initialize();
