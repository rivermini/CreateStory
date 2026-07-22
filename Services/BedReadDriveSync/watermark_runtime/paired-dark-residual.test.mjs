import assert from 'node:assert/strict';
import test from 'node:test';

import {
  detectPairedDarkResidual,
  findCompactOffsetSparkleCandidate,
  findDistantSparkleCandidate,
  removePairedDarkResidual,
  restorePairedWatermarkPatch,
} from './paired-dark-residual.mjs';

function diamond(size) {
  const map = new Float32Array(size * size);
  const center = (size - 1) / 2;
  for (let y = 0; y < size; y += 1) {
    for (let x = 0; x < size; x += 1) {
      map[y * size + x] = Math.max(0, 0.72 - (Math.abs(x - center) + Math.abs(y - center)) * 0.14);
    }
  }
  return map;
}

function image(width, height) {
  const pixels = new Uint8ClampedArray(width * height * 4);
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const pixel = (y * width + x) * 4;
      pixels[pixel] = 80 + x;
      pixels[pixel + 1] = 90 + x;
      pixels[pixel + 2] = 100 + x;
      pixels[pixel + 3] = 255;
    }
  }
  return pixels;
}

function applyLayer(pixels, width, alphaMap, region, value) {
  const output = new Uint8ClampedArray(pixels);
  for (let y = 0; y < region.height; y += 1) {
    for (let x = 0; x < region.width; x += 1) {
      const alpha = alphaMap[y * region.width + x];
      const pixel = ((region.y + y) * width + region.x + x) * 4;
      for (let channel = 0; channel < 3; channel += 1) {
        output[pixel + channel] = Math.round(
          output[pixel + channel] * (1 - alpha) + value * alpha,
        );
      }
    }
  }
  return output;
}

test('detects and reduces a shifted dark residual beside the light anchor', () => {
  const width = 120;
  const height = 90;
  const size = 9;
  const alphaMap = diamond(size);
  const pixels = image(width, height);
  const original = new Uint8ClampedArray(pixels);
  const darkX = 104;
  const darkY = 77;
  for (let y = 0; y < size; y += 1) {
    for (let x = 0; x < size; x += 1) {
      const alpha = alphaMap[y * size + x] * 0.7;
      const pixel = ((darkY + y) * width + darkX + x) * 4;
      for (let channel = 0; channel < 3; channel += 1) {
        pixels[pixel + channel] = Math.round(pixels[pixel + channel] * (1 - alpha));
      }
    }
  }

  const detected = detectPairedDarkResidual(
    pixels,
    width,
    height,
    alphaMap,
    { x: 92, y: 66, width: size, height: size },
  );
  assert.deepEqual(
    { x: detected?.region.x, y: detected?.region.y },
    { x: darkX, y: darkY },
  );
  const center = ((darkY + 4) * width + darkX + 4) * 4;
  const beforeError = Math.abs(pixels[center] - original[center]);
  removePairedDarkResidual(pixels, width, alphaMap, detected.region);
  assert.ok(Math.abs(pixels[center] - original[center]) < beforeError);
});

test('does not invent a dark pair on a clean neighborhood', () => {
  const width = 120;
  const height = 90;
  const size = 9;
  assert.equal(detectPairedDarkResidual(
    image(width, height),
    width,
    height,
    diamond(size),
    { x: 92, y: 66, width: size, height: size },
  ), null);
});

test('finds an overlapping smaller light sparkle down-right of the anchor', () => {
  const width = 180;
  const height = 130;
  const anchor = { x: 135, y: 90, width: 24, height: 24 };
  const compact = { x: 144, y: 102, width: 16, height: 16 };
  const clean = new Uint8ClampedArray(width * height * 4);
  for (let pixel = 0; pixel < width * height; pixel += 1) {
    clean[pixel * 4] = 24;
    clean[pixel * 4 + 1] = 31;
    clean[pixel * 4 + 2] = 38;
    clean[pixel * 4 + 3] = 255;
  }
  const withAnchor = applyLayer(clean, width, diamond(anchor.width), anchor, 220);
  const pixels = applyLayer(withAnchor, width, diamond(compact.width), compact, 220);

  const detected = findCompactOffsetSparkleCandidate(
    pixels,
    width,
    height,
    diamond(compact.width),
    anchor,
  );

  assert.deepEqual(
    { x: detected?.region.x, y: detected?.region.y, size: detected?.region.width },
    { x: compact.x, y: compact.y, size: compact.width },
  );
  assert.equal(detected?.polarity, 'light');
  assert.equal(detected?.alphaMask.length, compact.width * compact.height);
});

test('does not reinterpret the lower arm of one sparkle as a compact companion', () => {
  const width = 180;
  const height = 130;
  const anchor = { x: 135, y: 90, width: 24, height: 24 };
  const pixels = applyLayer(image(width, height), width, diamond(anchor.width), anchor, 255);

  assert.equal(findCompactOffsetSparkleCandidate(
    pixels,
    width,
    height,
    diamond(16),
    anchor,
  ), null);
});

test('finds a larger sparkle above-left of a validated corner anchor', () => {
  const width = 220;
  const height = 150;
  const anchor = { x: 180, y: 115, width: 20, height: 20 };
  const region = { x: 150, y: 83, width: 32, height: 32 };
  const alphaMap = diamond(region.width);
  const clean = new Uint8ClampedArray(width * height * 4);
  for (let pixel = 0; pixel < width * height; pixel += 1) {
    clean[pixel * 4] = 45;
    clean[pixel * 4 + 1] = 55;
    clean[pixel * 4 + 2] = 65;
    clean[pixel * 4 + 3] = 255;
  }
  const pixels = applyLayer(clean, width, alphaMap, region, 255);

  const detected = findDistantSparkleCandidate(
    pixels,
    width,
    height,
    [{ alphaMap, size: region.width }],
    anchor,
  );

  assert.deepEqual(
    { x: detected?.region.x, y: detected?.region.y, size: detected?.region.width },
    { x: region.x, y: region.y, size: region.width },
  );
  assert.equal(detected?.polarity, 'light');
});

test('does not invent a distant companion on clean artwork', () => {
  const size = 32;
  assert.equal(findDistantSparkleCandidate(
    image(220, 150),
    220,
    150,
    [{ alphaMap: diamond(size), size }],
    { x: 180, y: 115, width: 20, height: 20 },
  ), null);
});

test('restores overlapping light and dark layers with different sizes in one patch', () => {
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
  const lightMap = diamond(20);
  const darkMap = diamond(12);
  const targets = [
    { alphaMap: lightMap, region: { x: 145, y: 82, width: 20, height: 20 } },
    { alphaMap: darkMap, region: { x: 160, y: 98, width: 12, height: 12 } },
  ];
  for (const [target, logoValue] of [[targets[0], 255], [targets[1], 0]]) {
    for (let y = 0; y < target.region.height; y += 1) {
      for (let x = 0; x < target.region.width; x += 1) {
        const alpha = target.alphaMap[y * target.region.width + x] * 0.8;
        const pixel = ((target.region.y + y) * width + target.region.x + x) * 4;
        for (let channel = 0; channel < 3; channel += 1) {
          pixels[pixel + channel] = Math.round(
            pixels[pixel + channel] * (1 - alpha) + logoValue * alpha,
          );
        }
      }
    }
  }
  const error = () => pixels.reduce((sum, value, index) => (
    index % 4 === 3 ? sum : sum + Math.abs(value - original[index])
  ), 0);
  const before = error();
  assert.equal(restorePairedWatermarkPatch(pixels, width, height, targets), true);
  assert.ok(error() < before * 0.08);
});
