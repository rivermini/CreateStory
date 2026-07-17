import { describe, expect, it } from 'vitest';

import {
  blendResidualEdgePixels,
  createAlphaGradientMask,
  restoreResidualCorePixels,
} from './residualCleanup';

describe('residual edge cleanup', () => {
  it('builds a bounded feathered edge mask', () => {
    const alphaMap = new Float32Array(25);
    alphaMap[12] = 0.5;

    const mask = createAlphaGradientMask({ alphaMap, height: 5, width: 5 });

    expect(mask).toHaveLength(25);
    expect(Math.max(...mask)).toBeLessThanOrEqual(1);
    expect(Math.min(...mask)).toBeGreaterThanOrEqual(0);
    expect(mask.some((value) => value > 0)).toBe(true);
  });

  it('reduces a dark residual using clean neighboring pixels without changing alpha', () => {
    const width = 15;
    const pixels = new Uint8ClampedArray(width * width * 4);
    for (let index = 0; index < pixels.length; index += 4) {
      pixels[index] = 100;
      pixels[index + 1] = 100;
      pixels[index + 2] = 100;
      pixels[index + 3] = 213;
    }

    const region = { height: 5, width: 5, x: 5, y: 5 };
    const alphaMap = new Float32Array(25);
    alphaMap[12] = 0.5;
    const centerIndex = ((region.y + 2) * width + region.x + 2) * 4;
    pixels[centerIndex] = 20;
    pixels[centerIndex + 1] = 30;
    pixels[centerIndex + 2] = 40;

    blendResidualEdgePixels(pixels, width, alphaMap, region);

    expect(pixels[centerIndex]).toBeGreaterThan(20);
    expect(pixels[centerIndex + 1]).toBeGreaterThan(30);
    expect(pixels[centerIndex + 2]).toBeGreaterThan(40);
    expect(pixels[centerIndex + 3]).toBe(213);
    expect(Array.from(pixels.slice(0, 4))).toEqual([100, 100, 100, 213]);
  });

  it('reconstructs a pale high-alpha core from clean pixels beyond the edge radius', () => {
    const width = 35;
    const pixels = new Uint8ClampedArray(width * width * 4);
    const original = new Uint8ClampedArray(width * width * 4);

    for (let y = 0; y < width; y += 1) {
      for (let x = 0; x < width; x += 1) {
        const index = (y * width + x) * 4;
        const value = 70 + x + y;
        pixels[index] = value;
        pixels[index + 1] = value + 4;
        pixels[index + 2] = value + 8;
        pixels[index + 3] = 213;
      }
    }
    original.set(pixels);

    const region = { height: 15, width: 15, x: 10, y: 10 };
    const alphaMap = new Float32Array(region.width * region.height);
    for (let y = 0; y < region.height; y += 1) {
      for (let x = 0; x < region.width; x += 1) {
        const distance = Math.abs(x - 7) + Math.abs(y - 7);
        if (distance <= 5) alphaMap[y * region.width + x] = 0.5;
      }
    }

    const centerIndex = ((region.y + 7) * width + region.x + 7) * 4;
    pixels[centerIndex] = 235;
    pixels[centerIndex + 1] = 239;
    pixels[centerIndex + 2] = 243;
    const beforeError = Math.abs(pixels[centerIndex] - original[centerIndex]);

    restoreResidualCorePixels(pixels, width, alphaMap, region);

    expect(Math.abs(pixels[centerIndex] - original[centerIndex])).toBeLessThan(beforeError);
    expect(Math.abs(pixels[centerIndex + 1] - original[centerIndex + 1])).toBeLessThan(beforeError);
    expect(Math.abs(pixels[centerIndex + 2] - original[centerIndex + 2])).toBeLessThan(beforeError);
    expect(pixels[centerIndex + 3]).toBe(213);
    expect(Array.from(pixels.slice(0, 4))).toEqual(Array.from(original.slice(0, 4)));
  });

  it('preserves local texture instead of replacing the core with a flat patch', () => {
    const width = 55;
    const pixels = new Uint8ClampedArray(width * width * 4);
    const original = new Uint8ClampedArray(width * width * 4);

    for (let y = 0; y < width; y += 1) {
      for (let x = 0; x < width; x += 1) {
        const index = (y * width + x) * 4;
        const texture = 72 + (x % 4) * 7 + (y % 3) * 5 + Math.floor(x / 8);
        pixels[index] = texture;
        pixels[index + 1] = texture + 8;
        pixels[index + 2] = texture + 15;
        pixels[index + 3] = 177;
      }
    }
    original.set(pixels);

    const region = { height: 15, width: 15, x: 20, y: 20 };
    const alphaMap = new Float32Array(region.width * region.height);
    const coreIndexes: number[] = [];
    for (let y = 0; y < region.height; y += 1) {
      for (let x = 0; x < region.width; x += 1) {
        if (Math.abs(x - 7) + Math.abs(y - 7) > 5) continue;
        alphaMap[y * region.width + x] = 0.5;
        const imageIndex = ((region.y + y) * width + region.x + x) * 4;
        coreIndexes.push(imageIndex);
        pixels[imageIndex] = 230;
        pixels[imageIndex + 1] = 234;
        pixels[imageIndex + 2] = 238;
      }
    }

    const beforeError = coreIndexes.reduce(
      (sum, index) => sum + Math.abs(pixels[index] - original[index]),
      0,
    );
    restoreResidualCorePixels(pixels, width, alphaMap, region);
    const afterError = coreIndexes.reduce(
      (sum, index) => sum + Math.abs(pixels[index] - original[index]),
      0,
    );
    const restoredValues = coreIndexes.map((index) => pixels[index]);

    expect(afterError).toBeLessThan(beforeError * 0.35);
    expect(new Set(restoredValues).size).toBeGreaterThan(4);
    expect(Math.max(...restoredValues) - Math.min(...restoredValues)).toBeGreaterThan(12);
    expect(coreIndexes.every((index) => pixels[index + 3] === 177)).toBe(true);
  });

  it('does nothing when the alpha map has no high-alpha residual core', () => {
    const pixels = new Uint8ClampedArray([
      10, 20, 30, 40,
      50, 60, 70, 80,
      90, 100, 110, 120,
      130, 140, 150, 160,
    ]);
    const original = new Uint8ClampedArray(pixels);

    restoreResidualCorePixels(
      pixels,
      2,
      new Float32Array([0.1]),
      { height: 1, width: 1, x: 0, y: 0 },
    );

    expect(pixels).toEqual(original);
  });

  it('rejects invalid cleanup geometry', () => {
    expect(() => blendResidualEdgePixels(
      new Uint8ClampedArray(4),
      1,
      new Float32Array(4),
      { height: 2, width: 2, x: 0, y: 0 },
    )).toThrow('outside the image');

    expect(() => restoreResidualCorePixels(
      new Uint8ClampedArray(4),
      1,
      new Float32Array(4),
      { height: 2, width: 2, x: 0, y: 0 },
    )).toThrow('outside the image');
  });
});
