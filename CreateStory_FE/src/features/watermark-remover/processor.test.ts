import type { WatermarkMeta } from '@pilio/gemini-watermark-remover/image-data';
import { describe, expect, it } from 'vitest';

import { shouldUseCroppedBannerCleanup } from './processor';

function makeMeta(overrides: Partial<WatermarkMeta> = {}): WatermarkMeta {
  return {
    alphaGain: 1,
    applied: true,
    attemptedPassCount: 2,
    config: null,
    decisionTier: 'validated-match',
    detection: {
      adaptiveConfidence: 0.41,
    } as WatermarkMeta['detection'],
    passCount: 2,
    passStopReason: null,
    position: { height: 35, width: 35, x: 927, y: 362 },
    size: 35,
    skipReason: null,
    source: 'adaptive',
    ...overrides,
  };
}

describe('cropped banner one-click fallback', () => {
  it('recognizes the false catalog target reported for banner6', () => {
    expect(shouldUseCroppedBannerCleanup(makeMeta(), 1024, 459)).toBe(true);
  });

  it('keeps high-confidence and correctly located SDK results unchanged', () => {
    expect(shouldUseCroppedBannerCleanup(makeMeta({
      detection: { adaptiveConfidence: 0.8 } as WatermarkMeta['detection'],
    }), 1024, 459)).toBe(false);
    expect(shouldUseCroppedBannerCleanup(makeMeta({
      position: { height: 35, width: 35, x: 957, y: 400 },
    }), 1024, 459)).toBe(false);
  });

  it('does not apply the banner fallback to non-wide images or skipped results', () => {
    expect(shouldUseCroppedBannerCleanup(makeMeta(), 800, 800)).toBe(false);
    expect(shouldUseCroppedBannerCleanup(makeMeta({ applied: false }), 1024, 459)).toBe(false);
  });
});
