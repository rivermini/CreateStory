const WIDE_IMAGE_RATIO = 1.4;

export function resolveMaximumPasses(width, height, requestedPasses) {
  if (!Number.isFinite(width)
    || !Number.isFinite(height)
    || width <= 0
    || height <= 0
    || !Number.isInteger(requestedPasses)
    || requestedPasses <= 0) {
    throw new Error('Invalid watermark pass policy input.');
  }
  return width / height >= WIDE_IMAGE_RATIO ? requestedPasses : 1;
}
