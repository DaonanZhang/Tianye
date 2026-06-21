import {
  createDemoMap,
  metricsFromPayload,
  renderMetrics,
  renderRouteOnMap,
  renderStory,
} from "./demo-common.js";

const uploadForm = document.getElementById("upload-form");
const fileInput = document.getElementById("gpx-file");
const statusElement = document.getElementById("upload-status");
const metricsElement = document.getElementById("upload-metrics");
const storyPanel = document.getElementById("upload-story-panel");
const storyContent = document.getElementById("upload-story-content");
const copyShareTextButton = document.getElementById("upload-copy-share-text");

let map = null;
let currentPayload = null;

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

async function copyText(text) {
  try {
    await navigator.clipboard.writeText(text);
    statusElement.textContent = "Share text copied.";
  } catch (error) {
    statusElement.textContent = "Copy failed. Please copy manually.";
  }
}

async function analyzeFile(file) {
  const formData = new FormData();
  formData.append("gpx_file", file);
  const response = await fetch("/api/demo-upload-preview/", {
    method: "POST",
    headers: {
      "X-CSRFToken": getCookie("csrftoken"),
    },
    body: formData,
  });
  const payload = await response.json();
  if (!response.ok) {
    throw new Error(payload.error || "Failed to analyze uploaded GPX.");
  }
  return payload;
}

uploadForm?.addEventListener("submit", async (event) => {
  event.preventDefault();

  const file = fileInput.files?.[0];
  if (!file) {
    statusElement.textContent = "Please choose one `.gpx` file first.";
    return;
  }

  statusElement.textContent = "Parsing and analyzing the uploaded GPX.";
  try {
    currentPayload = await analyzeFile(file);
  } catch (error) {
    statusElement.textContent = error.message;
    return;
  }

  statusElement.textContent = `Preview ready: ${currentPayload.name}`;
  renderMetrics(metricsElement, metricsFromPayload(currentPayload));
  renderRouteOnMap(map, currentPayload);
  renderStory(storyContent, currentPayload.story);
  storyPanel.classList.remove("hidden");
  copyShareTextButton.disabled = false;
});

copyShareTextButton?.addEventListener("click", () => {
  if (!currentPayload) {
    return;
  }
  copyText(currentPayload.story.share_text);
});

async function initialize() {
  map = await createDemoMap("upload-map");
}

initialize();
