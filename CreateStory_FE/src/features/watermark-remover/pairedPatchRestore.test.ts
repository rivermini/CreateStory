import { describe, expect, it } from 'vitest';

import { restorePairedWatermarkPatch } from './pairedPatchRestore';

function diamond(size: number): Float32Array {
  const map = new Float32Array(size * size);
  const center = (size - 1) / 2;
  for (let y = 0; y < size; y += 1) {
    for (let x = 0; x < size; x += 1) {
      map[y * size + x] = Math.max(
        0,
        0.72 - (Math.abs(x - center) + Math.abs(y - center)) * 0.14,
      );
    }
  }
  return map;
}

describe('paired watermark patch restoration', () => {
  it('restores different-size light and dark layers together', () => {
    const width = 220;
    const height = 150;
    const pixels = new Uint8ClampedArray(width * height * 4);
    for (let pixel = 0; pixel < width * height; pixel += 1) {
      pixels[pixel * 4] = 31;
      pixels[pixel * 4 + 1] = 37;
      pixels[pixel * 4 + 2] = 43;
      pixels[pixel * 4 + 3] = 255;
    }
    const original = new Uint8ClampedArray(pixels);
    const targets = [
      { alphaMap: diamond(20), region: { height: 20, width: 20, x: 145, y: 82 } },
      { alphaMap: diamond(12), region: { height: 12, width: 12, x: 160, y: 98 } },
    ];
    for (const [target, logo] of [[targets[0], 255], [targets[1], 0]] as const) {
      for (let y = 0; y < target.region.height; y += 1) {
        for (let x = 0; x < target.region.width; x += 1) {
          const alpha = target.alphaMap[y * target.region.width + x] * 0.8;
          const pixel = ((target.region.y + y) * width + target.region.x + x) * 4;
          for (let channel = 0; channel < 3; channel += 1) {
            pixels[pixel + channel] = Math.round(
              pixels[pixel + channel] * (1 - alpha) + logo * alpha,
            );
          }
        }
      }
    }
    const error = (): number => pixels.reduce((sum, value, index) => (
      index % 4 === 3 ? sum : sum + Math.abs(value - original[index])
    ), 0);
    const before = error();

    expect(restorePairedWatermarkPatch(pixels, width, height, targets)).toBe(true);
    expect(error()).toBeLessThan(before * 0.08);
  });
});
