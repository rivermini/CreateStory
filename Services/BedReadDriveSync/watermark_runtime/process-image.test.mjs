import assert from 'node:assert/strict';
import test from 'node:test';

import {
  evaluateCandidate,
  isCorroboratedAggressiveCandidate,
  processImagePixels,
  regionsOverlap,
} from './process-image.mjs';

function diamond(size) {
  const output = new Float32Array(size * size);
  const center = (size - 1) / 2;
  const radius = size * 0.42;
  for (let y = 0; y < size; y += 1) {
    for (let x = 0; x < size; x += 1) {
      output[y * size + x] = Math.max(
        0,
        0.72 - (Math.abs(x - center) + Math.abs(y - center)) / radius,
      );
    }
  }
  return output;
}

function background(width, height) {
  const output = new Uint8ClampedArray(width * height * 4);
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const pixel = (y * width + x) * 4;
      output[pixel] = 55 + Math.round(x * 0.15);
      output[pixel + 1] = 70 + Math.round(y * 0.12);
      output[pixel + 2] = 85 + Math.round((x + y) * 0.08);
      output[pixel + 3] = 255;
    }
  }
  return output;
}

function applyLayer(pixels, width, alphaMap, position, value) {
  const output = new Uint8ClampedArray(pixels);
  for (let y = 0; y < position.height; y += 1) {
    for (let x = 0; x < position.width; x += 1) {
      const alpha = alphaMap[y * position.width + x];
      const pixel = ((position.y + y) * width + position.x + x) * 4;
      for (let channel = 0; channel < 3; channel += 1) {
        output[pixel + channel] = Math.round(
          output[pixel + channel] * (1 - alpha) + value * alpha,
        );
      }
    }
  }
  return output;
}

function sdkMeta(position, overrides = {}) {
  return {
    applied: true,
    decisionTier: 'validated-match',
    position,
    qualitySignals: { damageWarning: false, residualVisible: false },
    qualityStatus: 'clean',
    source: 'standard+preview-anchor',
    ...overrides,
  };
}

test('rejects an aggressive-only detector source even when its pixel score is persuasive', () => {
  const width = 128;
  const height = 96;
  const position = { x: 96, y: 64, width: 20, height: 20 };
  const alphaMap = diamond(position.width);
  const clean = background(width, height);
  const original = applyLayer(clean, width, alphaMap, position, 255);
  const validation = evaluateCandidate({
    alphaMap,
    height,
    meta: sdkMeta(position, { source: 'adaptive+aggressive-located+gain' }),
    original,
    processed: clean,
    width,
  });

  assert.equal(validation.accepted, false);
  assert.equal(validation.reason, 'unverified-aggressive-detector-source');
});

test('allows an aggressive source only with exceptional or paired independent evidence', () => {
  assert.equal(isCorroboratedAggressiveCandidate({
    gradientScore: 0.43,
    luminanceScore: 0.76,
    score: 0.62,
  }, null), true);
  assert.equal(isCorroboratedAggressiveCandidate({
    gradientScore: 0.16,
    luminanceScore: 0.60,
    score: 0.42,
  }, {
    gradientScore: 0.22,
    luminanceScore: 0.42,
    score: 0.34,
  }), true);
  assert.equal(isCorroboratedAggressiveCandidate({
    gradientScore: 0.04,
    luminanceScore: 0.41,
    score: 0.26,
  }, {
    gradientScore: 0.34,
    luminanceScore: 0.40,
    score: 0.37,
  }), false);
});

test('commits at most one candidate and validates it against original pixels', async () => {
  const width = 128;
  const height = 96;
  const position = { x: 96, y: 64, width: 20, height: 20 };
  const alphaMap = diamond(position.width);
  const clean = background(width, height);
  const input = applyLayer(clean, width, alphaMap, position, 255);
  let calls = 0;
  const result = await processImagePixels({
    engine: { getAlphaMap: async () => alphaMap },
    height,
    pixels: input,
    removeWatermark: async () => {
      calls += 1;
      return { imageData: { data: clean, height, width }, meta: sdkMeta(position) };
    },
    requestedMaxPasses: 5,
    width,
  });

  assert.equal(calls, 1);
  assert.equal(result.metadata.applied, true);
  assert.equal(result.metadata.appliedPassCount, 1);
  assert.equal(result.metadata.effectiveMaxPasses, 1);
  assert.equal(result.metadata.requestedMaxPasses, 5);
  assert.deepEqual(result.data, clean);
});

test('rejects an SDK fallback without strong evidence in the original pixels', async () => {
  const width = 128;
  const height = 96;
  const position = { x: 96, y: 64, width: 20, height: 20 };
  const alphaMap = diamond(position.width);
  const input = background(width, height);
  const unsafeSdkOutput = new Uint8ClampedArray(input);
  unsafeSdkOutput[((position.y + 8) * width + position.x + 8) * 4] = 255;
  const result = await processImagePixels({
    engine: { getAlphaMap: async () => alphaMap },
    height,
    pixels: input,
    removeWatermark: async () => ({
      imageData: { data: unsafeSdkOutput, height, width },
      meta: sdkMeta(position),
    }),
    requestedMaxPasses: 3,
    width,
  });

  assert.equal(result.metadata.applied, false);
  assert.equal(result.metadata.needsReview, true);
  assert.equal(result.metadata.stopReason, 'insufficient-original-pixel-evidence');
  assert.deepEqual(result.data, input);
});

test('rejects cleanup that creates an inverted dark residual', () => {
  const width = 128;
  const height = 96;
  const position = { x: 96, y: 64, width: 20, height: 20 };
  const alphaMap = diamond(position.width);
  const clean = background(width, height);
  const original = applyLayer(clean, width, alphaMap, position, 255);
  const darkHole = applyLayer(clean, width, alphaMap, position, 0);
  const validation = evaluateCandidate({
    alphaMap,
    height,
    meta: sdkMeta(position),
    original,
    processed: darkHole,
    width,
  });

  assert.equal(validation.accepted, false);
  assert.equal(validation.reason, 'unsafe-post-cleanup-residual');
});

test('preserves the source when the SDK itself requests quality review', () => {
  const width = 128;
  const height = 96;
  const position = { x: 96, y: 64, width: 20, height: 20 };
  const alphaMap = diamond(position.width);
  const clean = background(width, height);
  const original = applyLayer(clean, width, alphaMap, position, 255);
  const validation = evaluateCandidate({
    alphaMap,
    height,
    meta: sdkMeta(position, {
      qualitySignals: { damageWarning: false, residualVisible: true },
      qualityStatus: 'visible-residual',
    }),
    original,
    processed: clean,
    width,
  });

  assert.equal(validation.accepted, false);
  assert.equal(validation.needsReview, true);
  assert.equal(validation.reason, 'sdk-quality-review-required');
});

test('rejects duplicate or overlapping candidates before commit', () => {
  const existing = { x: 90, y: 60, width: 24, height: 24 };
  const overlap = { x: 105, y: 70, width: 20, height: 20 };
  const separate = { x: 60, y: 30, width: 20, height: 20 };
  assert.equal(regionsOverlap(existing, overlap), true);
  assert.equal(regionsOverlap(existing, separate), false);

  const width = 140;
  const height = 100;
  const alphaMap = diamond(overlap.width);
  const clean = background(width, height);
  const original = applyLayer(clean, width, alphaMap, overlap, 255);
  const validation = evaluateCandidate({
    alphaMap,
    height,
    meta: sdkMeta(overlap),
    original,
    previouslyAcceptedRegions: [existing],
    processed: clean,
    width,
  });
  assert.equal(validation.accepted, false);
  assert.equal(validation.reason, 'duplicate-or-overlapping-candidate');
});

test('no match is a byte-identical no-op and does not request review', async () => {
  const width = 64;
  const height = 48;
  const input = background(width, height);
  const result = await processImagePixels({
    engine: { getAlphaMap: async () => diamond(20) },
    height,
    pixels: input,
    removeWatermark: async ({ data }) => ({
      imageData: { data, height, width },
      meta: { applied: false, skipReason: 'no-match' },
    }),
    width,
  });
  assert.equal(result.metadata.applied, false);
  assert.equal(result.metadata.needsReview, false);
  assert.deepEqual(result.data, input);
});
