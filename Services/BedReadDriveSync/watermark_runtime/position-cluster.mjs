const DEFAULT_MAX_DISTANCE_FACTOR = 2.75;

function center(region) {
  return {
    x: region.x + region.width / 2,
    y: region.y + region.height / 2,
  };
}

export function positionsWithinCluster(
  anchor,
  candidate,
  maxDistanceFactor = DEFAULT_MAX_DISTANCE_FACTOR,
) {
  if (!anchor || !candidate) return false;
  const first = center(anchor);
  const second = center(candidate);
  const deltaX = first.x - second.x;
  const deltaY = first.y - second.y;
  const size = Math.min(anchor.width, anchor.height, candidate.width, candidate.height);
  const radius = size * maxDistanceFactor;
  return deltaX * deltaX + deltaY * deltaY <= radius * radius;
}
