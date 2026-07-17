import { describe, expect, it } from 'vitest';

import {
  DEFAULT_MANUAL_WATERMARK_TARGET,
  resizeAlphaMap,
  resolveManualWatermarkTarget,
  reverseBlendWatermarkPixels,
} from './manualRemoval';

describe('manual watermark target geometry', () => {
  it('places an explicit target at its requested edge margins', () => {
    const result = resolveManualWatermarkTarget({
      alphaGain: 1,
      bottomMargin: 20,
      rightMargin: 20,
      size: 36,
    }, 1024, 459);

    expect(result).toEqual({
      region: { height: 36, width: 36, x: 968, y: 403 },
      target: { alphaGain: 1, bottomMargin: 20, rightMargin: 20, size: 36 },
    });
  });

  it('uses the calibrated banner6 target in one click', () => {
    const result = resolveManualWatermarkTarget({
      ...DEFAULT_MANUAL_WATERMARK_TARGET,
      size: 35,
    }, 1024, 459);

    expect(result).toEqual({
      region: { height: 35, width: 35, x: 957, y: 400 },
      target: { alphaGain: 0.53, bottomMargin: 24, rightMargin: 32, size: 35 },
    });
  });

  it('clamps non-finite and out-of-bounds controls inside the image', () => {
    const result = resolveManualWatermarkTarget({
      alphaGain: Number.POSITIVE_INFINITY,
      bottomMargin: 999,
      rightMargin: -12,
      size: 500,
    }, 80, 60);

    expect(result).toEqual({
      region: { height: 60, width: 60, x: 20, y: 0 },
      target: { alphaGain: 0.53, bottomMargin: 0, rightMargin: 0, size: 60 },
    });
  });
});

describe('manual watermark alpha map resizing', () => {
  it('preserves corners and bilinearly interpolates the center', () => {
    const resized = resizeAlphaMap(new Float32Array([
      1, 2,
      3, 4,
    ]), 2, 3);

    expect(Array.from(resized)).toEqual([
      1, 1.5, 2,
      2, 2.5, 3,
      3, 3.5, 4,
    ]);
  });

  it('returns a copy when the size is unchanged', () => {
    const source = new Float32Array([0.1, 0.2, 0.3, 0.4]);
    const resized = resizeAlphaMap(source, 2, 2);

    expect(resized).not.toBe(source);
    expect(resized).toEqual(source);
  });
});

describe('manual reverse alpha blending', () => {
  it('restores a white watermark while preserving pixels outside the target and alpha', () => {
    const pixels = new Uint8ClampedArray([
      8, 9, 10, 11,
      139, 154, 169, 201,
    ]);

    reverseBlendWatermarkPixels(
      pixels,
      2,
      new Float32Array([0.25]),
      { height: 1, width: 1, x: 1, y: 0 },
    );

    expect(Array.from(pixels)).toEqual([
      8, 9, 10, 11,
      100, 120, 140, 201,
    ]);
  });

  it('supports the SDK dark-polarity alpha convention', () => {
    const pixels = new Uint8ClampedArray([75, 90, 105, 255]);

    reverseBlendWatermarkPixels(
      pixels,
      1,
      new Float32Array([-0.25]),
      { height: 1, width: 1, x: 0, y: 0 },
    );

    expect(Array.from(pixels)).toEqual([100, 120, 140, 255]);
  });

  it('ignores alpha-map quantization noise', () => {
    const pixels = new Uint8ClampedArray([90, 100, 110, 120]);

    reverseBlendWatermarkPixels(
      pixels,
      1,
      new Float32Array([0.01]),
      { height: 1, width: 1, x: 0, y: 0 },
    );

    expect(Array.from(pixels)).toEqual([90, 100, 110, 120]);
  });

  it('rejects a target outside the source pixels', () => {
    expect(() => reverseBlendWatermarkPixels(
      new Uint8ClampedArray(4),
      1,
      new Float32Array(4),
      { height: 2, width: 2, x: 0, y: 0 },
    )).toThrow('outside the image');
  });
});
