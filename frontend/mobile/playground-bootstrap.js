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

tabButtons.forEach((button) => {
  button.addEventListener("click", () => {
    activateTab(button.dataset.tabTarget);
  });
});

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

activateTab("navigate-panel");
setTrackingButtons();
setHikingButtons();
updateRemainingDistanceDisplay(NaN);
