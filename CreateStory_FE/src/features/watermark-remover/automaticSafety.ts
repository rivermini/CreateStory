import type { WatermarkDetectionCandidate } from './multiDetector';

const MIN_AUTOMATIC_SCORE = 0.52;
const MIN_AUTOMATIC_LUMINANCE_SCORE = 0.30;
const MIN_AUTOMATIC_GRADIENT_SCORE = 0.16;
const MAX_EDGE_MARGIN_FACTOR = 1.75;
const MAX_NEAR_WHITE_FRACTION = 0.35;
const MIN_SCORE_DROP = 0.08;
const MIN_RELATIVE_SCORE_DROP = 0.16;
const MAX_REVERSED_POLARITY_SCORE = 0.24;
const MAX_CHANGED_CHANNEL_FRACTION = 0.40;

export interface CleanupValidationTarget {
  afterOppositePolarityScore: number;
  afterSamePolarityScore: number;
  before: WatermarkDetectionCandidate;
}

export interface CleanupValidationResult {
  accepted: boolean;
  reason: string | null;
}

function luminanceAt(pixels: Uint8ClampedArray, pixelIndex: number): number {
  const base = pixelIndex * 4;
  return 0.2126 * pixels[base]
    + 0.7152 * pixels[base + 1]
    + 0.0722 * pixels[base + 2];
}

function isCanonicalCornerCandidate(
  candidate: WatermarkDetectionCandidate,
  width: number,
  height: number,
): boolean {
  const { region } = candidate;
  const rightMargin = width - region.x - region.width;
  const bottomMargin = height - region.y - region.height;
  const allowedRightMargin = Math.max(8, region.width * MAX_EDGE_MARGIN_FACTOR);
  const allowedBottomMargin = Math.max(8, region.height * MAX_EDGE_MARGIN_FACTOR);
  return rightMargin >= 0
    && bottomMargin >= 0
    && rightMargin <= allowedRightMargin
    && bottomMargin <= allowedBottomMargin;
}

function nearWhiteFraction(
  pixels: Uint8ClampedArray,
  width: number,
  candidate: WatermarkDetectionCandidate,
): number {
  const { region } = candidate;
  let nearWhite = 0;
  const pixelCount = region.width * region.height;
  for (let row = 0; row < region.height; row += 1) {
    for (let column = 0; column < region.width; column += 1) {
      const pixelIndex = (region.y + row) * width + region.x + column;
      if (luminanceAt(pixels, pixelIndex) >= 230) nearWhite += 1;
    }
  }
  return pixelCount > 0 ? nearWhite / pixelCount : 1;
}

export function selectSafeAutomaticDetections(
  candidates: readonly WatermarkDetectionCandidate[],
  originalPixels: Uint8ClampedArray,
  width: number,
  height: number,
): WatermarkDetectionCandidate[] {
  const safe = candidates.filter((candidate) => (
    candidate.source === 'local-scan'
    && candidate.score >= MIN_AUTOMATIC_SCORE
    && candidate.luminanceScore >= MIN_AUTOMATIC_LUMINANCE_SCORE
    && candidate.gradientScore >= MIN_AUTOMATIC_GRADIENT_SCORE
    && isCanonicalCornerCandidate(candidate, width, height)
    && nearWhiteFraction(originalPixels, width, candidate) <= MAX_NEAR_WHITE_FRACTION
  ));

  if (safe.length === 1) return safe;
  if (safe.length !== 2 || safe[0].polarity === safe[1].polarity) return [];

  // Multiple edits are allowed only for the known bright-layer/dark-residual pair.
  // An arbitrary count of plausible-looking regions is not proof of multiple logos.
  return safe;
}

function changedChannelFraction(
  originalPixels: Uint8ClampedArray,
  processedPixels: Uint8ClampedArray,
  targets: readonly CleanupValidationTarget[],
  width: number,
): number {
  let changedChannels = 0;
  let channels = 0;
  const visited = new Set<number>();
  for (const { before: { region } } of targets) {
    for (let row = 0; row < region.height; row += 1) {
      for (let column = 0; column < region.width; column += 1) {
        const pixelIndex = (region.y + row) * width + region.x + column;
        if (visited.has(pixelIndex)) continue;
        visited.add(pixelIndex);
        const base = pixelIndex * 4;
        for (let channel = 0; channel < 3; channel += 1) {
          channels += 1;
          if (Math.abs(processedPixels[base + channel] - originalPixels[base + channel]) >= 3) {
            changedChannels += 1;
          }
        }
      }
    }
  }
  return channels > 0 ? changedChannels / channels : 1;
}

export function validateAutomaticCleanup(
  originalPixels: Uint8ClampedArray,
  processedPixels: Uint8ClampedArray,
  width: number,
  targets: readonly CleanupValidationTarget[],
): CleanupValidationResult {
  if (originalPixels.length !== processedPixels.length || targets.length === 0) {
    return { accepted: false, reason: 'invalid-cleanup-evidence' };
  }

  for (const target of targets) {
    const requiredDrop = Math.max(
      MIN_SCORE_DROP,
      target.before.score * MIN_RELATIVE_SCORE_DROP,
    );
    if (target.before.score - target.afterSamePolarityScore < requiredDrop) {
      return { accepted: false, reason: 'watermark-score-not-reduced' };
    }
    if (target.afterOppositePolarityScore >= MAX_REVERSED_POLARITY_SCORE) {
      return { accepted: false, reason: 'polarity-reversal' };
    }
  }

  if (changedChannelFraction(originalPixels, processedPixels, targets, width)
    > MAX_CHANGED_CHANNEL_FRACTION) {
    return { accepted: false, reason: 'cleanup-too-destructive' };
  }

  return { accepted: true, reason: null };
}
