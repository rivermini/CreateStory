import type { ManualWatermarkRegion } from './manualRemoval';

export interface WatermarkDetectionCandidate {
  gradientScore: number;
  luminanceScore: number;
  region: ManualWatermarkRegion;
  score: number;
  source: 'local-scan' | 'sdk-seed';
}

export interface MultiDetectionOptions {
  maxDetections?: number;
  seedRegions?: readonly ManualWatermarkRegion[];
}

const COARSE_STEP = 2;
const COARSE_CANDIDATE_LIMIT = 32;
const DEFAULT_MAX_DETECTIONS = 4;
const MIN_PRIMARY_SCORE = 0.48;
const MIN_SECONDARY_SCORE = 0.38;
const MIN_SEEDED_SCORE = 0.26;

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.max(minimum, Math.min(maximum, value));
}

function createLuminance(pixels: Uint8ClampedArray): Float32Array {
  const luminance = new Float32Array(pixels.length / 4);
  for (let pixel = 0; pixel < luminance.length; pixel += 1) {
    const base = pixel * 4;
    luminance[pixel] = 0.2126 * pixels[base]
      + 0.7152 * pixels[base + 1]
      + 0.0722 * pixels[base + 2];
  }
  return luminance;
}

function createGradient(values: Float32Array, width: number, height: number): Float32Array {
  const gradient = new Float32Array(values.length);
  for (let y = 1; y < height - 1; y += 1) {
    for (let x = 1; x < width - 1; x += 1) {
      const index = y * width + x;
      const horizontal = values[index + 1] - values[index - 1];
      const vertical = values[index + width] - values[index - width];
      gradient[index] = Math.hypot(horizontal, vertical);
    }
  }
  return gradient;
}

function normalizedCorrelationAt(
  image: Float32Array,
  imageWidth: number,
  template: Float32Array,
  templateSize: number,
  x: number,
  y: number,
): number {
  const count = template.length;
  let imageSum = 0;
  let templateSum = 0;

  for (let row = 0; row < templateSize; row += 1) {
    const imageOffset = (y + row) * imageWidth + x;
    const templateOffset = row * templateSize;
    for (let column = 0; column < templateSize; column += 1) {
      imageSum += image[imageOffset + column];
      templateSum += template[templateOffset + column];
    }
  }

  const imageMean = imageSum / count;
  const templateMean = templateSum / count;
  let numerator = 0;
  let imageVariance = 0;
  let templateVariance = 0;

  for (let row = 0; row < templateSize; row += 1) {
    const imageOffset = (y + row) * imageWidth + x;
    const templateOffset = row * templateSize;
    for (let column = 0; column < templateSize; column += 1) {
      const imageDelta = image[imageOffset + column] - imageMean;
      const templateDelta = template[templateOffset + column] - templateMean;
      numerator += imageDelta * templateDelta;
      imageVariance += imageDelta * imageDelta;
      templateVariance += templateDelta * templateDelta;
    }
  }

  const denominator = Math.sqrt(imageVariance * templateVariance);
  return denominator > 1e-8 ? numerator / denominator : 0;
}

function scoreCandidate(
  luminance: Float32Array,
  imageGradient: Float32Array,
  imageWidth: number,
  alphaMap: Float32Array,
  alphaGradient: Float32Array,
  size: number,
  x: number,
  y: number,
  source: WatermarkDetectionCandidate['source'],
): WatermarkDetectionCandidate {
  const luminanceScore = normalizedCorrelationAt(
    luminance,
    imageWidth,
    alphaMap,
    size,
    x,
    y,
  );
  const gradientScore = normalizedCorrelationAt(
    imageGradient,
    imageWidth,
    alphaGradient,
    size,
    x,
    y,
  );
  return {
    gradientScore,
    luminanceScore,
    region: { height: size, width: size, x, y },
    score: 0.58 * luminanceScore + 0.42 * gradientScore,
    source,
  };
}

function centerDistanceSquared(
  first: ManualWatermarkRegion,
  second: ManualWatermarkRegion,
): number {
  const deltaX = first.x + first.width / 2 - second.x - second.width / 2;
  const deltaY = first.y + first.height / 2 - second.y - second.height / 2;
  return deltaX * deltaX + deltaY * deltaY;
}

function isSameInstance(
  first: ManualWatermarkRegion,
  second: ManualWatermarkRegion,
): boolean {
  const radius = Math.min(first.width, second.width) * 0.58;
  return centerDistanceSquared(first, second) < radius * radius;
}

function isRegionInsideImage(
  region: ManualWatermarkRegion,
  width: number,
  height: number,
  size: number,
): boolean {
  return region.width === size
    && region.height === size
    && Number.isInteger(region.x)
    && Number.isInteger(region.y)
    && region.x >= 0
    && region.y >= 0
    && region.x + size <= width
    && region.y + size <= height;
}

export function detectWatermarkInstances(
  pixels: Uint8ClampedArray,
  width: number,
  height: number,
  alphaMap: Float32Array,
  size: number,
  options: MultiDetectionOptions = {},
): WatermarkDetectionCandidate[] {
  if (!Number.isInteger(width)
    || !Number.isInteger(height)
    || width <= 0
    || height <= 0
    || pixels.length !== width * height * 4
    || alphaMap.length !== size * size
    || size <= 0
    || size > width
    || size > height) {
    throw new Error('The watermark detector received invalid image geometry.');
  }

  const luminance = createLuminance(pixels);
  const imageGradient = createGradient(luminance, width, height);
  const alphaGradient = createGradient(alphaMap, size, size);
  const searchWidth = Math.max(160, Math.round(width * 0.26));
  const searchHeight = Math.max(112, Math.round(height * 0.34));
  const left = Math.max(0, width - searchWidth);
  const top = Math.max(0, height - searchHeight);
  const right = width - size;
  const bottom = height - size;
  const coarse: WatermarkDetectionCandidate[] = [];

  for (let y = top; y <= bottom; y += COARSE_STEP) {
    for (let x = left; x <= right; x += COARSE_STEP) {
      coarse.push(scoreCandidate(
        luminance,
        imageGradient,
        width,
        alphaMap,
        alphaGradient,
        size,
        x,
        y,
        'local-scan',
      ));
    }
  }
  coarse.sort((first, second) => second.score - first.score);

  const refined: WatermarkDetectionCandidate[] = [];
  for (const candidate of coarse.slice(0, COARSE_CANDIDATE_LIMIT)) {
    for (let y = candidate.region.y - 2; y <= candidate.region.y + 2; y += 1) {
      for (let x = candidate.region.x - 2; x <= candidate.region.x + 2; x += 1) {
        if (x < left || y < top || x > right || y > bottom) continue;
        refined.push(scoreCandidate(
          luminance,
          imageGradient,
          width,
          alphaMap,
          alphaGradient,
          size,
          x,
          y,
          'local-scan',
        ));
      }
    }
  }

  const seeded = (options.seedRegions ?? [])
    .filter((region) => isRegionInsideImage(region, width, height, size))
    .map((region) => scoreCandidate(
      luminance,
      imageGradient,
      width,
      alphaMap,
      alphaGradient,
      size,
      region.x,
      region.y,
      'sdk-seed',
    ));
  const ranked = [...seeded, ...refined]
    .sort((first, second) => second.score - first.score);
  const strongest = ranked[0]?.score ?? 0;
  if (strongest < MIN_PRIMARY_SCORE) return [];

  const accepted: WatermarkDetectionCandidate[] = [];
  for (const candidate of ranked) {
    if (accepted.some((existing) => isSameInstance(existing.region, candidate.region))) continue;
    const minimumScore = candidate.source === 'sdk-seed'
      ? MIN_SEEDED_SCORE
      : Math.max(MIN_SECONDARY_SCORE, strongest * 0.52);
    if (candidate.score < minimumScore) continue;
    if (candidate.luminanceScore < 0.22 || candidate.gradientScore < 0.12) continue;
    accepted.push(candidate);
    if (accepted.length >= (options.maxDetections ?? DEFAULT_MAX_DETECTIONS)) break;
  }

  return accepted.map((candidate) => ({
    ...candidate,
    gradientScore: clamp(candidate.gradientScore, -1, 1),
    luminanceScore: clamp(candidate.luminanceScore, -1, 1),
    score: clamp(candidate.score, -1, 1),
  }));
}
