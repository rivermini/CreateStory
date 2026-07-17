import type { ManualWatermarkRegion } from './manualRemoval';

// Adapted from the MIT-licensed upstream alpha-gradient and residual-edge cleanup.
// See THIRD_PARTY_NOTICES.md for attribution and license text.

export interface ResidualEdgeCleanupPreset {
  maxAlpha: number;
  minAlpha: number;
  outsideAlphaMax: number;
  radius: number;
  strength: number;
}

export const COMPLETE_RESIDUAL_EDGE_PRESET: Readonly<ResidualEdgeCleanupPreset> = {
  maxAlpha: 0.99,
  minAlpha: 0.02,
  outsideAlphaMax: 0.25,
  radius: 6,
  strength: 1.8,
};

const EPSILON = 1e-8;
const CORE_ALPHA_THRESHOLD = 0.25;
const CORE_EDGE_ALPHA_THRESHOLD = 0.02;
const CORE_DILATE_RADIUS = 2;
const CORE_FEATHER_WIDTH = 3;
const CORE_DONOR_RADIUS = 16;
const CORE_PATCH_RADIUS = 2;
const CORE_TRANSLATION_SEARCH_RADIUS = 128;
const CORE_TRANSLATION_STEP = 4;
const CORE_COMPARISON_RING_WIDTH = 4;
const CORE_TILE_PADDING = CORE_TRANSLATION_SEARCH_RADIUS
  + CORE_PATCH_RADIUS
  + CORE_COMPARISON_RING_WIDTH;
const CORE_TEXTURE_GAIN = 0.75;
const CORE_RANGE_PADDING = 4;

interface PixelOffset {
  distance: number;
  distanceSquared: number;
  x: number;
  y: number;
}

interface TileBounds {
  height: number;
  left: number;
  top: number;
  width: number;
}

interface LocalColorEstimate {
  blue: number;
  green: number;
  maxBlue: number;
  maxGreen: number;
  maxRed: number;
  minBlue: number;
  minGreen: number;
  minRed: number;
  red: number;
}

interface TextureTranslation {
  x: number;
  y: number;
}

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.max(minimum, Math.min(maximum, value));
}

function gaussianKernel1D(sigma: number): { kernel: Float32Array; radius: number } | null {
  if (!Number.isFinite(sigma) || sigma <= 0) return null;

  const radius = Math.max(1, Math.ceil(sigma * 3));
  const kernel = new Float32Array(radius * 2 + 1);
  let sum = 0;

  for (let index = -radius; index <= radius; index += 1) {
    const value = Math.exp(-(index * index) / (2 * sigma * sigma));
    kernel[index + radius] = value;
    sum += value;
  }

  if (sum <= EPSILON) return null;
  for (let index = 0; index < kernel.length; index += 1) kernel[index] /= sum;
  return { kernel, radius };
}

function blurHorizontal(
  values: Float32Array,
  width: number,
  height: number,
  kernelInfo: { kernel: Float32Array; radius: number },
): Float32Array {
  const output = new Float32Array(values.length);
  const { kernel, radius } = kernelInfo;

  for (let y = 0; y < height; y += 1) {
    const rowBase = y * width;
    for (let x = 0; x < width; x += 1) {
      let sum = 0;
      for (let offset = -radius; offset <= radius; offset += 1) {
        const sourceX = clamp(x + offset, 0, width - 1);
        sum += values[rowBase + sourceX] * kernel[offset + radius];
      }
      output[rowBase + x] = sum;
    }
  }

  return output;
}

function blurVertical(
  values: Float32Array,
  width: number,
  height: number,
  kernelInfo: { kernel: Float32Array; radius: number },
): Float32Array {
  const output = new Float32Array(values.length);
  const { kernel, radius } = kernelInfo;

  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      let sum = 0;
      for (let offset = -radius; offset <= radius; offset += 1) {
        const sourceY = clamp(y + offset, 0, height - 1);
        sum += values[sourceY * width + x] * kernel[offset + radius];
      }
      output[y * width + x] = sum;
    }
  }

  return output;
}

function gaussianBlur(values: Float32Array, width: number, height: number, sigma: number): Float32Array {
  const kernelInfo = gaussianKernel1D(sigma);
  if (!kernelInfo) return new Float32Array(values);
  return blurVertical(
    blurHorizontal(values, width, height, kernelInfo),
    width,
    height,
    kernelInfo,
  );
}

function dilate(values: Float32Array, width: number, height: number, radius: number): Float32Array {
  if (!Number.isFinite(radius) || radius <= 0) return new Float32Array(values);

  const roundedRadius = Math.max(1, Math.round(radius));
  const radiusSquared = roundedRadius * roundedRadius;
  const output = new Float32Array(values.length);

  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      let maximum = 0;
      for (let offsetY = -roundedRadius; offsetY <= roundedRadius; offsetY += 1) {
        for (let offsetX = -roundedRadius; offsetX <= roundedRadius; offsetX += 1) {
          if (offsetX * offsetX + offsetY * offsetY > radiusSquared) continue;
          const sourceX = x + offsetX;
          const sourceY = y + offsetY;
          if (sourceX < 0 || sourceY < 0 || sourceX >= width || sourceY >= height) continue;
          maximum = Math.max(maximum, values[sourceY * width + sourceX]);
        }
      }
      output[y * width + x] = maximum;
    }
  }

  return output;
}

export function createAlphaGradientMask({
  alphaMap,
  blurSigma = 2,
  dilateRadius = 2,
  gamma = 0.5,
  height,
  strength = 1,
  width,
}: {
  alphaMap: Float32Array;
  blurSigma?: number;
  dilateRadius?: number;
  gamma?: number;
  height: number;
  strength?: number;
  width: number;
}): Float32Array {
  if (width <= 0 || height <= 0 || alphaMap.length < width * height) {
    return new Float32Array(0);
  }

  const gradient = new Float32Array(width * height);
  let minimumGradient = Number.POSITIVE_INFINITY;
  let maximumGradient = 0;

  for (let y = 1; y < height - 1; y += 1) {
    for (let x = 1; x < width - 1; x += 1) {
      const index = y * width + x;
      const gx = -alphaMap[index - width - 1]
        - 2 * alphaMap[index - 1]
        - alphaMap[index + width - 1]
        + alphaMap[index - width + 1]
        + 2 * alphaMap[index + 1]
        + alphaMap[index + width + 1];
      const gy = -alphaMap[index - width - 1]
        - 2 * alphaMap[index - width]
        - alphaMap[index - width + 1]
        + alphaMap[index + width - 1]
        + 2 * alphaMap[index + width]
        + alphaMap[index + width + 1];
      const value = Math.sqrt(gx * gx + gy * gy);
      gradient[index] = value;
      minimumGradient = Math.min(minimumGradient, value);
      maximumGradient = Math.max(maximumGradient, value);
    }
  }

  if (!Number.isFinite(minimumGradient) || maximumGradient <= minimumGradient + EPSILON) {
    return new Float32Array(width * height);
  }

  const normalized = new Float32Array(width * height);
  const exponent = Number.isFinite(gamma) && gamma > 0 ? gamma : 1;
  for (let index = 0; index < normalized.length; index += 1) {
    const value = (gradient[index] - minimumGradient) / (maximumGradient - minimumGradient);
    normalized[index] = Math.pow(clamp(value, 0, 1), exponent);
  }

  const expanded = dilate(normalized, width, height, dilateRadius);
  const blurred = gaussianBlur(expanded, width, height, blurSigma);
  const safeStrength = Number.isFinite(strength) ? Math.max(0, strength) : 1;
  for (let index = 0; index < blurred.length; index += 1) {
    blurred[index] = clamp(blurred[index] * safeStrength, 0, 1);
  }
  return blurred;
}

export function blendResidualEdgePixels(
  pixels: Uint8ClampedArray,
  imageWidth: number,
  alphaMap: Float32Array,
  region: ManualWatermarkRegion,
  preset: ResidualEdgeCleanupPreset = COMPLETE_RESIDUAL_EDGE_PRESET,
): void {
  const imageHeight = pixels.length / (imageWidth * 4);
  if (!Number.isInteger(imageWidth)
    || !Number.isInteger(imageHeight)
    || imageWidth <= 0
    || imageHeight <= 0
    || alphaMap.length !== region.width * region.height
    || region.width !== region.height
    || region.x < 0
    || region.y < 0
    || region.x + region.width > imageWidth
    || region.y + region.height > imageHeight) {
    throw new Error('The residual cleanup target is outside the image.');
  }

  const source = new Uint8ClampedArray(pixels);
  const edgeMask = createAlphaGradientMask({
    alphaMap,
    height: region.height,
    width: region.width,
  });
  const maximumAlpha = Math.max(preset.maxAlpha, 1e-6);

  for (let row = 0; row < region.height; row += 1) {
    for (let column = 0; column < region.width; column += 1) {
      const localIndex = row * region.width + column;
      const alpha = Math.abs(alphaMap[localIndex]);
      if (alpha < preset.minAlpha || alpha > preset.maxAlpha) continue;

      let red = 0;
      let green = 0;
      let blue = 0;
      let totalWeight = 0;

      for (let offsetY = -preset.radius; offsetY <= preset.radius; offsetY += 1) {
        for (let offsetX = -preset.radius; offsetX <= preset.radius; offsetX += 1) {
          if (offsetX === 0 && offsetY === 0) continue;
          const localY = row + offsetY;
          const localX = column + offsetX;
          const pixelX = region.x + localX;
          const pixelY = region.y + localY;
          if (pixelX < 0 || pixelY < 0 || pixelX >= imageWidth || pixelY >= imageHeight) continue;

          let neighborAlpha = 0;
          if (localY >= 0 && localX >= 0 && localY < region.height && localX < region.width) {
            neighborAlpha = Math.abs(alphaMap[localY * region.width + localX]);
          }
          if (neighborAlpha > preset.outsideAlphaMax) continue;

          const distance = Math.sqrt(offsetX * offsetX + offsetY * offsetY) || 1;
          const weight = 1 / distance;
          const pixelIndex = (pixelY * imageWidth + pixelX) * 4;
          red += source[pixelIndex] * weight;
          green += source[pixelIndex + 1] * weight;
          blue += source[pixelIndex + 2] * weight;
          totalWeight += weight;
        }
      }

      if (totalWeight <= 0) continue;
      const edgeWeight = Math.max(0.35, clamp(edgeMask[localIndex] ?? 0, 0, 1));
      const blend = clamp(preset.strength * alpha / maximumAlpha * edgeWeight, 0, 1);
      const pixelIndex = ((region.y + row) * imageWidth + region.x + column) * 4;
      pixels[pixelIndex] = Math.round(source[pixelIndex] * (1 - blend) + (red / totalWeight) * blend);
      pixels[pixelIndex + 1] = Math.round(source[pixelIndex + 1] * (1 - blend) + (green / totalWeight) * blend);
      pixels[pixelIndex + 2] = Math.round(source[pixelIndex + 2] * (1 - blend) + (blue / totalWeight) * blend);
    }
  }
}

function validateCoreCleanupGeometry(
  pixels: Uint8ClampedArray,
  imageWidth: number,
  alphaMap: Float32Array,
  region: ManualWatermarkRegion,
): number {
  const imageHeight = pixels.length / (imageWidth * 4);
  if (!Number.isInteger(imageWidth)
    || !Number.isInteger(imageHeight)
    || imageWidth <= 0
    || imageHeight <= 0
    || alphaMap.length !== region.width * region.height
    || region.width !== region.height
    || region.x < 0
    || region.y < 0
    || region.x + region.width > imageWidth
    || region.y + region.height > imageHeight) {
    throw new Error('The residual cleanup target is outside the image.');
  }
  return imageHeight;
}

function createCircularOffsets(radius: number, includeCenter = false): PixelOffset[] {
  const offsets: PixelOffset[] = [];
  const radiusSquared = radius * radius;

  for (let y = -radius; y <= radius; y += 1) {
    for (let x = -radius; x <= radius; x += 1) {
      const distanceSquared = x * x + y * y;
      if (distanceSquared > radiusSquared || (!includeCenter && distanceSquared === 0)) continue;
      offsets.push({
        distance: Math.sqrt(distanceSquared),
        distanceSquared,
        x,
        y,
      });
    }
  }

  return offsets.sort((left, right) => left.distanceSquared - right.distanceSquared);
}

function createPatchOffsets(radius: number): PixelOffset[] {
  const offsets: PixelOffset[] = [];
  for (let y = -radius; y <= radius; y += 1) {
    for (let x = -radius; x <= radius; x += 1) {
      if (x === 0 && y === 0) continue;
      const distanceSquared = x * x + y * y;
      offsets.push({ distance: Math.sqrt(distanceSquared), distanceSquared, x, y });
    }
  }
  return offsets;
}

function dilateBinaryMask(
  values: Uint8Array,
  width: number,
  height: number,
  radius: number,
): Uint8Array {
  if (radius <= 0) return new Uint8Array(values);

  const output = new Uint8Array(values.length);
  const offsets = createCircularOffsets(radius, true);
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      if (values[y * width + x] === 0) continue;
      for (const offset of offsets) {
        const targetX = x + offset.x;
        const targetY = y + offset.y;
        if (targetX < 0 || targetY < 0 || targetX >= width || targetY >= height) continue;
        output[targetY * width + targetX] = 1;
      }
    }
  }
  return output;
}

function createInsideDistance(mask: Uint8Array, width: number, height: number): Float32Array {
  const diagonal = Math.SQRT2;
  const distance = new Float32Array(mask.length);
  for (let index = 0; index < mask.length; index += 1) {
    distance[index] = mask[index] === 0 ? 0 : Number.POSITIVE_INFINITY;
  }

  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const index = y * width + x;
      if (mask[index] === 0) continue;
      let best = distance[index];
      if (x > 0) best = Math.min(best, distance[index - 1] + 1);
      if (y > 0) best = Math.min(best, distance[index - width] + 1);
      if (x > 0 && y > 0) best = Math.min(best, distance[index - width - 1] + diagonal);
      if (x + 1 < width && y > 0) best = Math.min(best, distance[index - width + 1] + diagonal);
      distance[index] = best;
    }
  }

  for (let y = height - 1; y >= 0; y -= 1) {
    for (let x = width - 1; x >= 0; x -= 1) {
      const index = y * width + x;
      if (mask[index] === 0) continue;
      let best = distance[index];
      if (x + 1 < width) best = Math.min(best, distance[index + 1] + 1);
      if (y + 1 < height) best = Math.min(best, distance[index + width] + 1);
      if (x + 1 < width && y + 1 < height) {
        best = Math.min(best, distance[index + width + 1] + diagonal);
      }
      if (x > 0 && y + 1 < height) best = Math.min(best, distance[index + width - 1] + diagonal);
      distance[index] = best;
    }
  }

  return distance;
}

function createTileBounds(
  imageWidth: number,
  imageHeight: number,
  region: ManualWatermarkRegion,
): TileBounds {
  const left = Math.max(0, region.x - CORE_TILE_PADDING);
  const top = Math.max(0, region.y - CORE_TILE_PADDING);
  const right = Math.min(imageWidth, region.x + region.width + CORE_TILE_PADDING);
  const bottom = Math.min(imageHeight, region.y + region.height + CORE_TILE_PADDING);
  return { height: bottom - top, left, top, width: right - left };
}

function copyTilePixels(
  pixels: Uint8ClampedArray,
  imageWidth: number,
  bounds: TileBounds,
): Float32Array {
  const output = new Float32Array(bounds.width * bounds.height * 3);
  for (let y = 0; y < bounds.height; y += 1) {
    for (let x = 0; x < bounds.width; x += 1) {
      const imageIndex = ((bounds.top + y) * imageWidth + bounds.left + x) * 4;
      const tileIndex = (y * bounds.width + x) * 3;
      output[tileIndex] = pixels[imageIndex];
      output[tileIndex + 1] = pixels[imageIndex + 1];
      output[tileIndex + 2] = pixels[imageIndex + 2];
    }
  }
  return output;
}

function estimateLocalColor({
  donorSafe,
  height,
  index,
  offsets,
  source,
  width,
}: {
  donorSafe: Uint8Array;
  height: number;
  index: number;
  offsets: PixelOffset[];
  source: Float32Array;
  width: number;
}): LocalColorEstimate | null {
  const x = index % width;
  const y = Math.floor(index / width);
  let red = 0;
  let green = 0;
  let blue = 0;
  let totalWeight = 0;
  let minRed = Number.POSITIVE_INFINITY;
  let minGreen = Number.POSITIVE_INFINITY;
  let minBlue = Number.POSITIVE_INFINITY;
  let maxRed = Number.NEGATIVE_INFINITY;
  let maxGreen = Number.NEGATIVE_INFINITY;
  let maxBlue = Number.NEGATIVE_INFINITY;

  for (const offset of offsets) {
    const neighborX = x + offset.x;
    const neighborY = y + offset.y;
    if (neighborX < 0 || neighborY < 0 || neighborX >= width || neighborY >= height) continue;
    const neighborIndex = neighborY * width + neighborX;
    if (donorSafe[neighborIndex] === 0) continue;

    const weight = 1 / offset.distance;
    const baseIndex = neighborIndex * 3;
    const neighborRed = source[baseIndex];
    const neighborGreen = source[baseIndex + 1];
    const neighborBlue = source[baseIndex + 2];
    red += neighborRed * weight;
    green += neighborGreen * weight;
    blue += neighborBlue * weight;
    minRed = Math.min(minRed, neighborRed);
    minGreen = Math.min(minGreen, neighborGreen);
    minBlue = Math.min(minBlue, neighborBlue);
    maxRed = Math.max(maxRed, neighborRed);
    maxGreen = Math.max(maxGreen, neighborGreen);
    maxBlue = Math.max(maxBlue, neighborBlue);
    totalWeight += weight;
  }

  if (totalWeight <= EPSILON) return null;
  return {
    blue: blue / totalWeight,
    green: green / totalWeight,
    maxBlue,
    maxGreen,
    maxRed,
    minBlue,
    minGreen,
    minRed,
    red: red / totalWeight,
  };
}

function collectComparisonRing(
  fillMask: Uint8Array,
  blocked: Uint8Array,
  width: number,
  height: number,
): number[] {
  const expanded = dilateBinaryMask(fillMask, width, height, CORE_COMPARISON_RING_WIDTH);
  const samples: number[] = [];
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const index = y * width + x;
      if (expanded[index] !== 0
        && fillMask[index] === 0
        && blocked[index] === 0
        && (x + y) % 2 === 0) {
        samples.push(index);
      }
    }
  }
  return samples;
}

function scoreTextureTranslation({
  comparisonRing,
  deltaX,
  deltaY,
  donorSafe,
  height,
  source,
  width,
}: {
  comparisonRing: number[];
  deltaX: number;
  deltaY: number;
  donorSafe: Uint8Array;
  height: number;
  source: Float32Array;
  width: number;
}): number {
  if (comparisonRing.length === 0) return Number.POSITIVE_INFINITY;

  let luminanceOffset = 0;
  for (const targetIndex of comparisonRing) {
    const targetX = targetIndex % width;
    const targetY = Math.floor(targetIndex / width);
    const donorX = targetX + deltaX;
    const donorY = targetY + deltaY;
    if (donorX < 0 || donorY < 0 || donorX >= width || donorY >= height) {
      return Number.POSITIVE_INFINITY;
    }
    const donorIndex = donorY * width + donorX;
    if (donorSafe[donorIndex] === 0) return Number.POSITIVE_INFINITY;
    const targetBase = targetIndex * 3;
    const sourceBase = donorIndex * 3;
    const targetLuminance = 0.2126 * source[targetBase]
      + 0.7152 * source[targetBase + 1]
      + 0.0722 * source[targetBase + 2];
    const sourceLuminance = 0.2126 * source[sourceBase]
      + 0.7152 * source[sourceBase + 1]
      + 0.0722 * source[sourceBase + 2];
    luminanceOffset += targetLuminance - sourceLuminance;
  }
  luminanceOffset /= comparisonRing.length;

  let error = 0;
  for (const targetIndex of comparisonRing) {
    const targetX = targetIndex % width;
    const targetY = Math.floor(targetIndex / width);
    const donorIndex = (targetY + deltaY) * width + targetX + deltaX;
    const targetBase = targetIndex * 3;
    const sourceBase = donorIndex * 3;
    const targetRed = source[targetBase];
    const targetGreen = source[targetBase + 1];
    const targetBlue = source[targetBase + 2];
    const sourceRed = source[sourceBase];
    const sourceGreen = source[sourceBase + 1];
    const sourceBlue = source[sourceBase + 2];
    const targetLuminance = 0.2126 * targetRed + 0.7152 * targetGreen + 0.0722 * targetBlue;
    const sourceLuminance = 0.2126 * sourceRed + 0.7152 * sourceGreen + 0.0722 * sourceBlue;
    const luminanceError = targetLuminance - sourceLuminance - luminanceOffset;
    const blueChromaError = (targetBlue - targetLuminance) - (sourceBlue - sourceLuminance);
    const redChromaError = (targetRed - targetLuminance) - (sourceRed - sourceLuminance);
    error += luminanceError * luminanceError
      + 0.15 * (blueChromaError * blueChromaError + redChromaError * redChromaError);
  }

  return error / comparisonRing.length
    + 0.2 * luminanceOffset * luminanceOffset
    + 0.002 * (deltaX * deltaX + deltaY * deltaY);
}

function findTextureTranslation({
  comparisonRing,
  donorSafe,
  fillMask,
  height,
  regionSize,
  source,
  width,
}: {
  comparisonRing: number[];
  donorSafe: Uint8Array;
  fillMask: Uint8Array;
  height: number;
  regionSize: number;
  source: Float32Array;
  width: number;
}): TextureTranslation | null {
  if (comparisonRing.length < 8) return null;

  let maskLeft = width;
  let maskRight = 0;
  let maskTop = height;
  let maskBottom = 0;
  for (let index = 0; index < fillMask.length; index += 1) {
    if (fillMask[index] === 0) continue;
    const x = index % width;
    const y = Math.floor(index / width);
    maskLeft = Math.min(maskLeft, x);
    maskRight = Math.max(maskRight, x);
    maskTop = Math.min(maskTop, y);
    maskBottom = Math.max(maskBottom, y);
  }

  const minimumSeparation = regionSize + CORE_DILATE_RADIUS * 2 + CORE_PATCH_RADIUS;
  let bestScore = Number.POSITIVE_INFINITY;
  let best: TextureTranslation | null = null;
  const evaluate = (deltaX: number, deltaY: number): void => {
    if (Math.abs(deltaX) < minimumSeparation && Math.abs(deltaY) < minimumSeparation) return;
    if (maskLeft + deltaX < CORE_PATCH_RADIUS
      || maskRight + deltaX >= width - CORE_PATCH_RADIUS
      || maskTop + deltaY < CORE_PATCH_RADIUS
      || maskBottom + deltaY >= height - CORE_PATCH_RADIUS) return;
    const score = scoreTextureTranslation({
      comparisonRing,
      deltaX,
      deltaY,
      donorSafe,
      height,
      source,
      width,
    });
    if (score < bestScore) {
      best = { x: deltaX, y: deltaY };
      bestScore = score;
    }
  };

  for (
    let deltaY = -CORE_TRANSLATION_SEARCH_RADIUS;
    deltaY <= CORE_TRANSLATION_SEARCH_RADIUS;
    deltaY += CORE_TRANSLATION_STEP
  ) {
    for (
      let deltaX = -CORE_TRANSLATION_SEARCH_RADIUS;
      deltaX <= CORE_TRANSLATION_SEARCH_RADIUS;
      deltaX += CORE_TRANSLATION_STEP
    ) {
      evaluate(deltaX, deltaY);
    }
  }

  if (!best) return null;
  const coarseBest = best as TextureTranslation;
  for (let deltaY = coarseBest.y - 3; deltaY <= coarseBest.y + 3; deltaY += 1) {
    for (let deltaX = coarseBest.x - 3; deltaX <= coarseBest.x + 3; deltaX += 1) {
      evaluate(deltaX, deltaY);
    }
  }
  return best;
}

function sourcePatchMean(
  source: Float32Array,
  width: number,
  donorIndex: number,
  channel: number,
  patchOffsets: PixelOffset[],
): number {
  let sum = source[donorIndex * 3 + channel];
  for (const offset of patchOffsets) {
    sum += source[(donorIndex + offset.y * width + offset.x) * 3 + channel];
  }
  return sum / (patchOffsets.length + 1);
}

function smoothstep(value: number): number {
  const bounded = clamp(value, 0, 1);
  return bounded * bounded * (3 - 2 * bounded);
}

export function restoreResidualCorePixels(
  pixels: Uint8ClampedArray,
  imageWidth: number,
  alphaMap: Float32Array,
  region: ManualWatermarkRegion,
): void {
  const imageHeight = validateCoreCleanupGeometry(pixels, imageWidth, alphaMap, region);
  const bounds = createTileBounds(imageWidth, imageHeight, region);
  const tileWidth = bounds.width;
  const tileHeight = bounds.height;
  const source = copyTilePixels(pixels, imageWidth, bounds);
  const work = new Float32Array(source);
  const coreSeed = new Uint8Array(tileWidth * tileHeight);
  const blockedSeed = new Uint8Array(tileWidth * tileHeight);
  const regionOffsetX = region.x - bounds.left;
  const regionOffsetY = region.y - bounds.top;

  let corePixelCount = 0;
  for (let y = 0; y < region.height; y += 1) {
    for (let x = 0; x < region.width; x += 1) {
      const alpha = Math.abs(alphaMap[y * region.width + x]);
      const tileIndex = (regionOffsetY + y) * tileWidth + regionOffsetX + x;
      if (alpha >= CORE_EDGE_ALPHA_THRESHOLD) blockedSeed[tileIndex] = 1;
      if (alpha >= CORE_ALPHA_THRESHOLD) {
        coreSeed[tileIndex] = 1;
        corePixelCount += 1;
      }
    }
  }
  if (corePixelCount === 0) return;

  const fillMask = dilateBinaryMask(
    coreSeed,
    tileWidth,
    tileHeight,
    CORE_DILATE_RADIUS,
  );
  const blocked = dilateBinaryMask(
    blockedSeed,
    tileWidth,
    tileHeight,
    CORE_DILATE_RADIUS,
  );
  const unsafeDonorCenters = dilateBinaryMask(
    blocked,
    tileWidth,
    tileHeight,
    CORE_PATCH_RADIUS,
  );
  const donorSafe = new Uint8Array(fillMask.length);
  for (let y = CORE_PATCH_RADIUS; y < tileHeight - CORE_PATCH_RADIUS; y += 1) {
    for (let x = CORE_PATCH_RADIUS; x < tileWidth - CORE_PATCH_RADIUS; x += 1) {
      const index = y * tileWidth + x;
      donorSafe[index] = unsafeDonorCenters[index] === 0 ? 1 : 0;
    }
  }

  const distance = createInsideDistance(fillMask, tileWidth, tileHeight);
  const comparisonRing = collectComparisonRing(fillMask, blocked, tileWidth, tileHeight);
  const translation = findTextureTranslation({
    comparisonRing,
    donorSafe,
    fillMask,
    height: tileHeight,
    regionSize: region.width,
    source,
    width: tileWidth,
  });
  const localDonorOffsets = createCircularOffsets(CORE_DONOR_RADIUS);
  const patchOffsets = createPatchOffsets(CORE_PATCH_RADIUS);

  for (let index = 0; index < fillMask.length; index += 1) {
    if (fillMask[index] === 0) continue;
    const estimate = estimateLocalColor({
      donorSafe,
      height: tileHeight,
      index,
      offsets: localDonorOffsets,
      source,
      width: tileWidth,
    });
    if (!estimate) continue;

    let textureRed = 0;
    let textureGreen = 0;
    let textureBlue = 0;
    if (translation) {
      const donorIndex = index + translation.y * tileWidth + translation.x;
      if (donorSafe[donorIndex] !== 0) {
        const donorBase = donorIndex * 3;
        textureRed = source[donorBase]
          - sourcePatchMean(source, tileWidth, donorIndex, 0, patchOffsets);
        textureGreen = source[donorBase + 1]
          - sourcePatchMean(source, tileWidth, donorIndex, 1, patchOffsets);
        textureBlue = source[donorBase + 2]
          - sourcePatchMean(source, tileWidth, donorIndex, 2, patchOffsets);
      }
    }

    const workBase = index * 3;
    work[workBase] = clamp(
      estimate.red + CORE_TEXTURE_GAIN * textureRed,
      estimate.minRed - CORE_RANGE_PADDING,
      estimate.maxRed + CORE_RANGE_PADDING,
    );
    work[workBase + 1] = clamp(
      estimate.green + CORE_TEXTURE_GAIN * textureGreen,
      estimate.minGreen - CORE_RANGE_PADDING,
      estimate.maxGreen + CORE_RANGE_PADDING,
    );
    work[workBase + 2] = clamp(
      estimate.blue + CORE_TEXTURE_GAIN * textureBlue,
      estimate.minBlue - CORE_RANGE_PADDING,
      estimate.maxBlue + CORE_RANGE_PADDING,
    );
  }

  for (let tileIndex = 0; tileIndex < fillMask.length; tileIndex += 1) {
    if (fillMask[tileIndex] === 0) continue;
    const x = tileIndex % tileWidth;
    const y = Math.floor(tileIndex / tileWidth);
    const imageIndex = ((bounds.top + y) * imageWidth + bounds.left + x) * 4;
    const tileBase = tileIndex * 3;
    const blend = smoothstep(distance[tileIndex] / CORE_FEATHER_WIDTH);
    const restoredRed = Number.isFinite(work[tileBase]) ? work[tileBase] : source[tileBase];
    const restoredGreen = Number.isFinite(work[tileBase + 1])
      ? work[tileBase + 1]
      : source[tileBase + 1];
    const restoredBlue = Number.isFinite(work[tileBase + 2])
      ? work[tileBase + 2]
      : source[tileBase + 2];
    pixels[imageIndex] = Math.round(source[tileBase] * (1 - blend) + restoredRed * blend);
    pixels[imageIndex + 1] = Math.round(
      source[tileBase + 1] * (1 - blend) + restoredGreen * blend,
    );
    pixels[imageIndex + 2] = Math.round(
      source[tileBase + 2] * (1 - blend) + restoredBlue * blend,
    );
  }
}
