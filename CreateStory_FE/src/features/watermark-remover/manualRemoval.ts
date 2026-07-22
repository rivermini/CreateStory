import {
  blendResidualEdgePixels,
  restoreResidualCorePixels,
} from './residualCleanup';
import {
  detectWatermarkInstances,
  scoreWatermarkCandidateAt,
  selectPairedMultiSizeDetections,
  type WatermarkDetectionCandidate,
} from './multiDetector';
import { restorePairedWatermarkPatch } from './pairedPatchRestore';
import {
  selectSafeAutomaticDetections,
  validateAutomaticCleanup,
} from './automaticSafety';

export interface ManualWatermarkTarget {
  alphaGain: number;
  bottomMargin: number;
  rightMargin: number;
  size: number;
}

export interface ManualWatermarkRegion {
  height: number;
  width: number;
  x: number;
  y: number;
}

export interface ManualWatermarkResult {
  blob: Blob;
  processingMs: number;
  region: ManualWatermarkRegion;
  target: ManualWatermarkTarget;
}

export interface WatermarkPixelCleanupTarget {
  alphaGain: number;
  alphaMap: Float32Array;
  region: ManualWatermarkRegion;
}

export interface AutoDetectedWatermarkResult {
  blob: Blob | null;
  detections: WatermarkDetectionCandidate[];
  processingMs: number;
  regions: ManualWatermarkRegion[];
}

export const DEFAULT_MANUAL_WATERMARK_TARGET: Readonly<ManualWatermarkTarget> = {
  alphaGain: 0.53,
  bottomMargin: 24,
  rightMargin: 32,
  size: 36,
};

export const MANUAL_WATERMARK_MIN_SIZE = 20;
export const MANUAL_WATERMARK_MAX_SIZE = 128;

const ALPHA_NOISE_FLOOR = 3 / 255;
const ALPHA_THRESHOLD = 0.002;
const MAX_ALPHA = 0.99;
const WHITE_LOGO_VALUE = 255;

interface ManualAlphaMapEngine {
  getAlphaMap: (size: number) => Promise<Float32Array>;
}

let alphaMapEnginePromise: Promise<ManualAlphaMapEngine> | null = null;

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.min(maximum, Math.max(minimum, value));
}

function finiteOr(value: number, fallback: number): number {
  return Number.isFinite(value) ? value : fallback;
}

export function resolveManualWatermarkTarget(
  target: ManualWatermarkTarget,
  imageWidth: number,
  imageHeight: number,
): { region: ManualWatermarkRegion; target: ManualWatermarkTarget } {
  if (!Number.isFinite(imageWidth) || !Number.isFinite(imageHeight) || imageWidth <= 0 || imageHeight <= 0) {
    throw new Error('The image has invalid dimensions.');
  }

  const width = Math.round(imageWidth);
  const height = Math.round(imageHeight);
  const maximumSize = Math.max(1, Math.min(MANUAL_WATERMARK_MAX_SIZE, width, height));
  const minimumSize = Math.min(MANUAL_WATERMARK_MIN_SIZE, maximumSize);
  const size = clamp(
    Math.round(finiteOr(target.size, DEFAULT_MANUAL_WATERMARK_TARGET.size)),
    minimumSize,
    maximumSize,
  );
  const rightMargin = clamp(
    Math.round(finiteOr(target.rightMargin, DEFAULT_MANUAL_WATERMARK_TARGET.rightMargin)),
    0,
    width - size,
  );
  const bottomMargin = clamp(
    Math.round(finiteOr(target.bottomMargin, DEFAULT_MANUAL_WATERMARK_TARGET.bottomMargin)),
    0,
    height - size,
  );
  const alphaGain = clamp(
    finiteOr(target.alphaGain, DEFAULT_MANUAL_WATERMARK_TARGET.alphaGain),
    0.25,
    1.25,
  );

  return {
    region: {
      height: size,
      width: size,
      x: width - rightMargin - size,
      y: height - bottomMargin - size,
    },
    target: { alphaGain, bottomMargin, rightMargin, size },
  };
}

export function resizeAlphaMap(
  source: Float32Array,
  sourceSize: number,
  targetSize: number,
): Float32Array {
  if (sourceSize <= 0 || targetSize <= 0 || source.length !== sourceSize * sourceSize) {
    throw new Error('The watermark alpha map is invalid.');
  }

  if (sourceSize === targetSize) return new Float32Array(source);

  const output = new Float32Array(targetSize * targetSize);
  const scale = (sourceSize - 1) / Math.max(1, targetSize - 1);

  for (let targetY = 0; targetY < targetSize; targetY += 1) {
    const sourceY = targetY * scale;
    const y0 = Math.floor(sourceY);
    const y1 = Math.min(sourceSize - 1, y0 + 1);
    const yFraction = sourceY - y0;

    for (let targetX = 0; targetX < targetSize; targetX += 1) {
      const sourceX = targetX * scale;
      const x0 = Math.floor(sourceX);
      const x1 = Math.min(sourceSize - 1, x0 + 1);
      const xFraction = sourceX - x0;
      const top = source[y0 * sourceSize + x0] * (1 - xFraction)
        + source[y0 * sourceSize + x1] * xFraction;
      const bottom = source[y1 * sourceSize + x0] * (1 - xFraction)
        + source[y1 * sourceSize + x1] * xFraction;
      output[targetY * targetSize + targetX] = top * (1 - yFraction) + bottom * yFraction;
    }
  }

  return output;
}

export function reverseBlendWatermarkPixels(
  pixels: Uint8ClampedArray,
  imageWidth: number,
  alphaMap: Float32Array,
  region: ManualWatermarkRegion,
  alphaGain = 1,
): void {
  const imageHeight = pixels.length / (imageWidth * 4);
  const validImage = Number.isInteger(imageWidth)
    && imageWidth > 0
    && Number.isInteger(imageHeight)
    && imageHeight > 0;
  const validRegion = Number.isInteger(region.x)
    && Number.isInteger(region.y)
    && Number.isInteger(region.width)
    && Number.isInteger(region.height)
    && region.x >= 0
    && region.y >= 0
    && region.width > 0
    && region.height > 0
    && region.x + region.width <= imageWidth
    && region.y + region.height <= imageHeight
    && alphaMap.length === region.width * region.height;

  if (!validImage || !validRegion) {
    throw new Error('The manual watermark target is outside the image.');
  }

  const gain = clamp(finiteOr(alphaGain, 1), 0.25, 1.25);

  for (let row = 0; row < region.height; row += 1) {
    for (let column = 0; column < region.width; column += 1) {
      const alphaIndex = row * region.width + column;
      const rawAlpha = alphaMap[alphaIndex];
      const alphaMagnitude = Math.abs(rawAlpha);
      const signalAlpha = Math.max(0, alphaMagnitude - ALPHA_NOISE_FLOOR) * gain;

      if (signalAlpha < ALPHA_THRESHOLD) continue;

      const alpha = Math.min(alphaMagnitude * gain, MAX_ALPHA);
      const logoValue = rawAlpha < 0 ? 0 : WHITE_LOGO_VALUE;
      const pixelIndex = ((region.y + row) * imageWidth + region.x + column) * 4;

      for (let channel = 0; channel < 3; channel += 1) {
        const restored = (pixels[pixelIndex + channel] - alpha * logoValue) / (1 - alpha);
        pixels[pixelIndex + channel] = Math.round(clamp(restored, 0, 255));
      }
    }
  }
}

export async function getStandardAlphaMap(size: number): Promise<Float32Array> {
  alphaMapEnginePromise ??= import('@pilio/gemini-watermark-remover/image-data')
    .then(({ createWatermarkEngine }) => createWatermarkEngine());

  try {
    const engine = await alphaMapEnginePromise;
    return engine.getAlphaMap(size);
  } catch (error) {
    alphaMapEnginePromise = null;
    throw error;
  }
}

export function cleanupWatermarkPixels(
  pixels: Uint8ClampedArray,
  imageWidth: number,
  targets: readonly WatermarkPixelCleanupTarget[],
): void {
  for (const target of targets) {
    reverseBlendWatermarkPixels(
      pixels,
      imageWidth,
      target.alphaMap,
      target.region,
      target.alphaGain,
    );
  }
  for (const target of targets) {
    blendResidualEdgePixels(pixels, imageWidth, target.alphaMap, target.region);
  }
  const exclusions = targets.map(({ alphaMap, region }) => ({ alphaMap, region }));
  for (const target of targets) {
    restoreResidualCorePixels(
      pixels,
      imageWidth,
      target.alphaMap,
      target.region,
      exclusions,
    );
  }
}

function loadImage(sourceUrl: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.decoding = 'async';
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error('The browser could not decode this image.'));
    image.src = sourceUrl;
  });
}

function createPngBlob(canvas: HTMLCanvasElement): Promise<Blob> {
  return new Promise((resolve, reject) => {
    canvas.toBlob((blob) => {
      if (blob) resolve(blob);
      else reject(new Error('The browser could not encode the corrected PNG.'));
    }, 'image/png');
  });
}

export async function processManualWatermarkImage(
  sourceUrl: string,
  requestedTarget: ManualWatermarkTarget,
): Promise<ManualWatermarkResult> {
  const image = await loadImage(sourceUrl);
  const width = image.naturalWidth;
  const height = image.naturalHeight;
  const resolved = resolveManualWatermarkTarget(requestedTarget, width, height);
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext('2d', { willReadFrequently: true });

  if (!context) throw new Error('This browser does not support local image processing.');

  context.drawImage(image, 0, 0);
  const imageData = context.getImageData(0, 0, width, height);
  const startedAt = performance.now();
  const alphaMap = await getStandardAlphaMap(resolved.target.size);
  cleanupWatermarkPixels(imageData.data, width, [{
    alphaGain: resolved.target.alphaGain,
    alphaMap,
    region: resolved.region,
  }]);
  context.putImageData(imageData, 0, 0);
  const blob = await createPngBlob(canvas);

  return {
    blob,
    processingMs: performance.now() - startedAt,
    region: resolved.region,
    target: resolved.target,
  };
}

export async function processAutoDetectedWatermarksImage(
  sourceUrl: string,
  preferredSize: number,
): Promise<AutoDetectedWatermarkResult> {
  const image = await loadImage(sourceUrl);
  const width = image.naturalWidth;
  const height = image.naturalHeight;
  const size = clamp(Math.round(preferredSize), 20, Math.min(128, width, height));
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext('2d', { willReadFrequently: true });

  if (!context) throw new Error('This browser does not support local image processing.');

  context.drawImage(image, 0, 0);
  const imageData = context.getImageData(0, 0, width, height);
  const originalPixels = new Uint8ClampedArray(imageData.data);
  const startedAt = performance.now();
  const sizes = [...new Set([0.88, 1, 1.12].map((factor) => (
    clamp(Math.round(size * factor / 4) * 4, 20, Math.min(128, width, height))
  )))];
  type DetectionWithAlphaMap = WatermarkDetectionCandidate & { alphaMap: Float32Array };
  const scanned: DetectionWithAlphaMap[] = [];
  for (const candidateSize of sizes) {
    const alphaMap = await getStandardAlphaMap(candidateSize);
    scanned.push(...detectWatermarkInstances(
      imageData.data,
      width,
      height,
      alphaMap,
      candidateSize,
    ).map((detection) => ({ ...detection, alphaMap })));
  }
  const selected = selectPairedMultiSizeDetections(scanned) as DetectionWithAlphaMap[];
  const detections = selectSafeAutomaticDetections(
    selected,
    originalPixels,
    width,
    height,
  ) as DetectionWithAlphaMap[];

  if (detections.length === 0) {
    return { blob: null, detections, processingMs: performance.now() - startedAt, regions: [] };
  }

  const isOppositePolarityPair = detections.length === 2
    && detections[0].polarity !== detections[1].polarity;
  const restoredPair = isOppositePolarityPair && restorePairedWatermarkPatch(
    imageData.data,
    width,
    height,
    detections.map(({ alphaMap, region }) => ({ alphaMap, region })),
  );
  if (!restoredPair) {
    cleanupWatermarkPixels(
      imageData.data,
      width,
      detections.map(({ alphaMap, polarity, region }) => ({
        alphaGain: DEFAULT_MANUAL_WATERMARK_TARGET.alphaGain,
        alphaMap: polarity === 'dark'
          ? Float32Array.from(alphaMap, (value) => -Math.abs(value))
          : alphaMap,
        region,
      })),
    );
  }

  const validation = validateAutomaticCleanup(
    originalPixels,
    imageData.data,
    width,
    detections.map((detection) => {
      const oppositePolarity = detection.polarity === 'light' ? 'dark' : 'light';
      return {
        afterOppositePolarityScore: scoreWatermarkCandidateAt(
          imageData.data,
          width,
          height,
          detection.alphaMap,
          detection.region,
          oppositePolarity,
        ).score,
        afterSamePolarityScore: scoreWatermarkCandidateAt(
          imageData.data,
          width,
          height,
          detection.alphaMap,
          detection.region,
          detection.polarity,
        ).score,
        before: detection,
      };
    }),
  );
  if (!validation.accepted) {
    return {
      blob: null,
      detections: [],
      processingMs: performance.now() - startedAt,
      regions: [],
    };
  }
  context.putImageData(imageData, 0, 0);
  const blob = await createPngBlob(canvas);

  return {
    blob,
    detections,
    processingMs: performance.now() - startedAt,
    regions: detections.map(({ region }) => region),
  };
}
