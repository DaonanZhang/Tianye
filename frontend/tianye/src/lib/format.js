export function formatDistance(meters) {
  if (!Number.isFinite(meters)) {
    return "未生成";
  }
  if (meters >= 1000) {
    return `${(meters / 1000).toFixed(2)} km`;
  }
  return `${Math.round(meters)} m`;
}

export function formatMinutes(totalMinutes) {
  if (!Number.isFinite(totalMinutes) || totalMinutes <= 0) {
    return "未生成";
  }
  const minutes = Math.round(totalMinutes);
  const hours = Math.floor(minutes / 60);
  const remainder = minutes % 60;
  if (!hours) {
    return `${remainder} min`;
  }
  if (!remainder) {
    return `${hours} h`;
  }
  return `${hours} h ${remainder} min`;
}

export function formatDateTime(isoString) {
  if (!isoString) {
    return "未知";
  }
  const date = new Date(isoString);
  return new Intl.DateTimeFormat("zh-Hans-CN", {
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  }).format(date);
}

export function deriveDifficultyLabel(distanceMeters) {
  if (!Number.isFinite(distanceMeters)) {
    return "unknown";
  }
  if (distanceMeters < 5000) {
    return "easy";
  }
  if (distanceMeters < 12000) {
    return "moderate";
  }
  return "hard";
}
