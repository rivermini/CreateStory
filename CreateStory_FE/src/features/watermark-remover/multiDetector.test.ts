import { describe, expect, it } from 'vitest';

import { detectWatermarkInstances } from './multiDetector';

function makeDiamondTemplate(size: number): Float32Array {
  const result = new Float32Array(size * size);
  const center = (size - 1) / 2;
  for (let y = 0; y < size; y += 1) {
    for (let x = 0; x < size; x += 1) {
      const distance = Math.abs(x - center) + Math.abs(y - center);
      result[y * size + x] = Math.max(0, 0.72 - distance * 0.14);
    }
  }
  return result;
}

function makeImage(width: number, height: number): Uint8ClampedArray {
  const pixels = new Uint8ClampedArray(width * height * 4);
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const index = (y * width + x) * 4;
      pixels[index] = 48 + x + Math.round(y * 0.3);
      pixels[index + 1] = 66 + x + Math.round(y * 0.25);
      pixels[index + 2] = 82 + x + Math.round(y * 0.2);
      pixels[index + 3] = 255;
    }
  }
  return pixels;
}

function overlayWhiteWatermark(
  pixels: Uint8ClampedArray,
  width: number,
  alphaMap: Float32Array,
  size: number,
  x: number,
  y: number,
  strength: number,
): void {
  for (let row = 0; row < size; row += 1) {
    for (let column = 0; column < size; column += 1) {
      const alpha = alphaMap[row * size + column] * strength;
      const pixel = ((y + row) * width + x + column) * 4;
      for (let channel = 0; channel < 3; channel += 1) {
        pixels[pixel + channel] = Math.round(pixels[pixel + channel] * (1 - alpha) + 255 * alpha);
      }
    }
  }
}

describe('multi-instance watermark detection', () => {
  it('finds a strong and a faint nearby watermark in one scan', () => {
    const width = 96;
    const height = 72;
    const size = 9;
    const alphaMap = makeDiamondTemplate(size);
    const pixels = makeImage(width, height);
    overlayWhiteWatermark(pixels, width, alphaMap, size, 68, 39, 0.62);
    overlayWhiteWatermark(pixels, width, alphaMap, size, 80, 54, 1);

    const detections = detectWatermarkInstances(
      pixels,
      width,
      height,
      alphaMap,
      size,
      { seedRegions: [{ height: size, width: size, x: 68, y: 39 }] },
    );

    expect(detections).toHaveLength(2);
    expect(detections.map(({ region }) => [region.x, region.y])).toEqual(expect.arrayContaining([
      [68, 39],
      [80, 54],
    ]));
  });

  it('does not turn a seed on a smooth image into a detection', () => {
    const width = 80;
    const height = 60;
    const size = 9;
    const detections = detectWatermarkInstances(
      makeImage(width, height),
      width,
      height,
      makeDiamondTemplate(size),
      size,
      { seedRegions: [{ height: size, width: size, x: 60, y: 40 }] },
    );

    expect(detections).toEqual([]);
  });
});
