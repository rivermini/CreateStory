import { describe, expect, it, vi } from 'vitest';

import { findClosestLossyEncoding } from './outputEncoding';

describe('lossy output size matching', () => {
  it('searches quality and returns the blob closest to the source size', async () => {
    const encode = vi.fn(async (quality: number) => new Blob([
      new Uint8Array(Math.round(quality * 1000)),
    ], { type: 'image/jpeg' }));

    const result = await findClosestLossyEncoding(760, encode);

    expect(encode).toHaveBeenCalledTimes(7);
    expect(result.type).toBe('image/jpeg');
    expect(Math.abs(result.size - 760)).toBeLessThanOrEqual(5);
  });

  it('returns the closest boundary encoding when the target is outside the quality range', async () => {
    const result = await findClosestLossyEncoding(
      10_000,
      async (quality) => new Blob([new Uint8Array(Math.round(quality * 1000))]),
    );

    expect(result.size).toBeGreaterThan(950);
  });
});
