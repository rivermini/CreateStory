export interface PairedPatchTarget {
  alphaMap: Float32Array;
  region: { height: number; width: number; x: number; y: number };
}

const ALPHA_THRESHOLD = 0.015;
const DILATE_RADIUS = 3;
const SEARCH_RADIUS = 128;
const SEARCH_STEP = 8;

function smoothstep(value: number): number {
  const bounded = Math.max(0, Math.min(1, value));
  return bounded * bounded * (3 - 2 * bounded);
}

function alphaAt(targets: readonly PairedPatchTarget[], x: number, y: number): number {
  let alpha = 0;
  for (const target of targets) {
    for (let offsetY = -DILATE_RADIUS; offsetY <= DILATE_RADIUS; offsetY += 1) {
      for (let offsetX = -DILATE_RADIUS; offsetX <= DILATE_RADIUS; offsetX += 1) {
        if (offsetX * offsetX + offsetY * offsetY > DILATE_RADIUS * DILATE_RADIUS) continue;
        const localX = x + offsetX - target.region.x;
        const localY = y + offsetY - target.region.y;
        if (localX < 0
          || localY < 0
          || localX >= target.region.width
          || localY >= target.region.height) continue;
        alpha = Math.max(
          alpha,
          Math.abs(target.alphaMap[localY * target.region.width + localX]),
        );
      }
    }
  }
  return alpha;
}

function findTranslation(
  pixels: Uint8ClampedArray,
  imageWidth: number,
  imageHeight: number,
  targets: readonly PairedPatchTarget[],
  bounds: { bottom: number; left: number; right: number; top: number },
): { x: number; y: number } | null {
  const ring: Array<{ x: number; y: number }> = [];
  const ringRadius = 5;
  for (let y = Math.max(0, bounds.top - ringRadius); y < Math.min(imageHeight, bounds.bottom + ringRadius); y += 2) {
    for (let x = Math.max(0, bounds.left - ringRadius); x < Math.min(imageWidth, bounds.right + ringRadius); x += 2) {
      if (alphaAt(targets, x, y) >= ALPHA_THRESHOLD) continue;
      let bordersMask = false;
      for (let offsetY = -ringRadius; offsetY <= ringRadius && !bordersMask; offsetY += 1) {
        for (let offsetX = -ringRadius; offsetX <= ringRadius; offsetX += 1) {
          if (alphaAt(targets, x + offsetX, y + offsetY) >= ALPHA_THRESHOLD) {
            bordersMask = true;
            break;
          }
        }
      }
      if (bordersMask) ring.push({ x, y });
    }
  }
  if (ring.length < 8) return null;

  const regionWidth = bounds.right - bounds.left;
  const regionHeight = bounds.bottom - bounds.top;
  let best: { x: number; y: number } | null = null;
  let bestScore = Number.POSITIVE_INFINITY;
  for (let deltaY = -SEARCH_RADIUS; deltaY <= SEARCH_RADIUS; deltaY += SEARCH_STEP) {
    for (let deltaX = -SEARCH_RADIUS; deltaX <= SEARCH_RADIUS; deltaX += SEARCH_STEP) {
      if (Math.abs(deltaX) < regionWidth && Math.abs(deltaY) < regionHeight) continue;
      let redOffset = 0;
      let greenOffset = 0;
      let blueOffset = 0;
      let valid = true;
      for (const sample of ring) {
        const donorX = sample.x + deltaX;
        const donorY = sample.y + deltaY;
        if (donorX < 0 || donorY < 0 || donorX >= imageWidth || donorY >= imageHeight
          || alphaAt(targets, donorX, donorY) >= ALPHA_THRESHOLD) {
          valid = false;
          break;
        }
        const target = (sample.y * imageWidth + sample.x) * 4;
        const donor = (donorY * imageWidth + donorX) * 4;
        redOffset += pixels[target] - pixels[donor];
        greenOffset += pixels[target + 1] - pixels[donor + 1];
        blueOffset += pixels[target + 2] - pixels[donor + 2];
      }
      if (!valid) continue;
      redOffset /= ring.length;
      greenOffset /= ring.length;
      blueOffset /= ring.length;
      let error = 0;
      for (const sample of ring) {
        const target = (sample.y * imageWidth + sample.x) * 4;
        const donor = ((sample.y + deltaY) * imageWidth + sample.x + deltaX) * 4;
        const red = pixels[target] - pixels[donor] - redOffset;
        const green = pixels[target + 1] - pixels[donor + 1] - greenOffset;
        const blue = pixels[target + 2] - pixels[donor + 2] - blueOffset;
        error += red * red + green * green + blue * blue;
      }
      const score = error / ring.length + 0.003 * (deltaX * deltaX + deltaY * deltaY);
      if (score < bestScore) {
        best = { x: deltaX, y: deltaY };
        bestScore = score;
      }
    }
  }
  return best;
}

export function restorePairedWatermarkPatch(
  pixels: Uint8ClampedArray,
  imageWidth: number,
  imageHeight: number,
  targets: readonly PairedPatchTarget[],
): boolean {
  if (targets.length < 2) return false;
  const source = new Uint8ClampedArray(pixels);
  const largestSize = Math.max(...targets.map(({ region }) => region.width));
  const padding = Math.max(4, Math.round(largestSize * 0.1));
  const feather = Math.max(6, Math.round(largestSize * 0.16));
  const bounds = {
    bottom: Math.min(imageHeight, Math.max(...targets.map(({ region }) => region.y + region.height)) + padding),
    left: Math.max(0, Math.min(...targets.map(({ region }) => region.x)) - padding),
    right: Math.min(imageWidth, Math.max(...targets.map(({ region }) => region.x + region.width)) + padding),
    top: Math.max(0, Math.min(...targets.map(({ region }) => region.y)) - padding),
  };
  const translation = findTranslation(source, imageWidth, imageHeight, targets, bounds);
  if (!translation) return false;

  for (let y = bounds.top; y < bounds.bottom; y += 1) {
    for (let x = bounds.left; x < bounds.right; x += 1) {
      const donorX = x + translation.x;
      const donorY = y + translation.y;
      if (donorX < 0 || donorY < 0 || donorX >= imageWidth || donorY >= imageHeight) continue;
      const edgeDistance = Math.min(
        x - bounds.left,
        bounds.right - 1 - x,
        y - bounds.top,
        bounds.bottom - 1 - y,
      );
      const blend = smoothstep(Math.min(1, edgeDistance / feather));
      const pixel = (y * imageWidth + x) * 4;
      const donor = (donorY * imageWidth + donorX) * 4;
      for (let channel = 0; channel < 3; channel += 1) {
        pixels[pixel + channel] = Math.round(
          source[pixel + channel] * (1 - blend) + source[donor + channel] * blend,
        );
      }
    }
  }
  return true;
}
