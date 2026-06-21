export const EMPTY_LINE = {
  type: "Feature",
  properties: {},
  geometry: {
    type: "LineString",
    coordinates: [],
  },
};

export const EMPTY_COLLECTION = {
  type: "FeatureCollection",
  features: [],
};

export function haversineMeters(pointA, pointB) {
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

export function pointsToFeatureCollection(points) {
  return {
    type: "FeatureCollection",
    features: points.map((coordinates, index) => ({
      type: "Feature",
      properties: {
        label: index === 0 ? "A" : "B",
      },
      geometry: {
        type: "Point",
        coordinates,
      },
    })),
  };
}

export function buildCumulativeDistances(coordinates) {
  if (!Array.isArray(coordinates) || coordinates.length === 0) {
    return [0];
  }
  const cumulative = [0];
  for (let index = 1; index < coordinates.length; index += 1) {
    cumulative[index] =
      cumulative[index - 1] + haversineMeters(coordinates[index - 1], coordinates[index]);
  }
  return cumulative;
}

export function nearestRouteMatch(point, coordinates) {
  if (!Array.isArray(coordinates) || coordinates.length === 0) {
    return { index: 0, distanceMeters: Infinity };
  }

  let bestIndex = 0;
  let bestDistance = Infinity;
  for (let index = 0; index < coordinates.length; index += 1) {
    const distance = haversineMeters(point, coordinates[index]);
    if (distance < bestDistance) {
      bestDistance = distance;
      bestIndex = index;
    }
  }

  return {
    index: bestIndex,
    distanceMeters: bestDistance,
  };
}

export function sliceRouteToIndex(coordinates, index) {
  if (!Array.isArray(coordinates) || coordinates.length === 0) {
    return [];
  }
  return coordinates.slice(0, Math.max(index + 1, 1));
}
