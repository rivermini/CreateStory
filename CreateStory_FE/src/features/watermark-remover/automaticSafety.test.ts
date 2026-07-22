import { describe, expect, it } from 'vitest';

import {
  selectSafeAutomaticDetections,
  validateAutomaticCleanup,
} from './automaticSafety';
import type { WatermarkDetectionCandidate } from './multiDetector';

function candidate(
  overrides: Partial<WatermarkDetectionCandidate> = {},
): WatermarkDetectionCandidate {
  return {
    gradientScore: 0.32,
    luminanceScore: 0.72,
    polarity: 'light',
    region: { height: 32, width: 32, x: 156, y: 96 },
    score: 0.62,
    source: 'local-scan',
    ...overrides,
  };
}

function pixels(width = 200, height = 140, value = 90): Uint8ClampedArray {
  const result = new Uint8ClampedArray(width * height * 4);
  for (let index = 0; index < result.length; index += 4) {
    result[index] = value;
    result[index + 1] = value;
    result[index + 2] = value;
    result[index + 3] = 255;
  }
  return result;
}

describe('fail-closed automatic detection', () => {
  it('accepts only strong original-image evidence in the canonical corner', () => {
    const original = pixels();
    expect(selectSafeAutomaticDetections([candidate()], original, 200, 140)).toHaveLength(1);
    expect(selectSafeAutomaticDetections([
      candidate({ source: 'sdk-seed' }),
    ], original, 200, 140)).toEqual([]);
    expect(selectSafeAutomaticDetections([
      candidate({ region: { height: 32, width: 32, x: 80, y: 50 } }),
    ], original, 200, 140)).toEqual([]);
  });

  it('rejects an opaque white badge and arbitrary multiple matches', () => {
    const whiteBadge = pixels(200, 140, 245);
    expect(selectSafeAutomaticDetections([candidate()], whiteBadge, 200, 140)).toEqual([]);
    expect(selectSafeAutomaticDetections([
      candidate(),
      candidate({ region: { height: 32, width: 32, x: 164, y: 102 }, polarity: 'light' }),
    ], pixels(), 200, 140)).toEqual([]);
  });

  it('permits only a strict opposite-polarity two-layer pair', () => {
    const pair = [
      candidate(),
      candidate({
        polarity: 'dark',
        region: { height: 32, width: 32, x: 164, y: 102 },
      }),
    ];
    expect(selectSafeAutomaticDetections(pair, pixels(), 200, 140)).toEqual(pair);
  });
});

describe('post-cleanup validation', () => {
  it('rejects a cleanup that creates an opposite-polarity ghost', () => {
    const original = pixels();
    const processed = new Uint8ClampedArray(original);
    expect(validateAutomaticCleanup(original, processed, 200, [{
      afterOppositePolarityScore: 0.7,
      afterSamePolarityScore: 0.2,
      before: candidate(),
    }])).toMatchObject({ accepted: false, reason: 'polarity-reversal' });
  });

  it('rejects ineffective and destructive cleanups', () => {
    const original = pixels();
    expect(validateAutomaticCleanup(original, new Uint8ClampedArray(original), 200, [{
      afterOppositePolarityScore: 0.1,
      afterSamePolarityScore: 0.59,
      before: candidate(),
    }])).toMatchObject({ accepted: false, reason: 'watermark-score-not-reduced' });

    const processed = new Uint8ClampedArray(original);
    const region = candidate().region;
    for (let row = 0; row < region.height; row += 1) {
      for (let column = 0; column < region.width; column += 1) {
        const base = ((region.y + row) * 200 + region.x + column) * 4;
        processed[base] = 180;
        processed[base + 1] = 180;
        processed[base + 2] = 180;
      }
    }
    expect(validateAutomaticCleanup(original, processed, 200, [{
      afterOppositePolarityScore: 0.1,
      afterSamePolarityScore: 0.2,
      before: candidate(),
    }])).toMatchObject({ accepted: false, reason: 'cleanup-too-destructive' });
  });

  it('accepts a localized cleanup that reduces the matched pattern without reversing it', () => {
    const original = pixels();
    const processed = new Uint8ClampedArray(original);
    const region = candidate().region;
    for (let row = 0; row < 4; row += 1) {
      for (let column = 0; column < 4; column += 1) {
        const base = ((region.y + row) * 200 + region.x + column) * 4;
        processed[base] = 100;
      }
    }
    expect(validateAutomaticCleanup(original, processed, 200, [{
      afterOppositePolarityScore: 0.1,
      afterSamePolarityScore: 0.35,
      before: candidate(),
    }])).toEqual({ accepted: true, reason: null });
  });
});
