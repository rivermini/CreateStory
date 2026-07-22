import type { WatermarkMeta } from '@pilio/gemini-watermark-remover/image-data';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  encode: vi.fn(),
  localProcess: vi.fn(),
  workerProcess: vi.fn(),
}));

vi.mock('./workerProcessor', () => ({
  canUseWatermarkWorker: () => true,
  processWatermarkBlobInWorker: mocks.workerProcess,
}));

vi.mock('./manualRemoval', () => ({
  processAutoDetectedWatermarksImage: mocks.localProcess,
}));

vi.mock('./outputEncoding', () => ({
  preserveSourceImageEncoding: mocks.encode,
}));

import { processWatermarkImage } from './processor';

function meta(): WatermarkMeta {
  return {
    alphaGain: 1,
    applied: true,
    attemptedPassCount: 1,
    config: null,
    decisionTier: 'validated-match',
    detection: { adaptiveConfidence: 0.8 } as WatermarkMeta['detection'],
    passCount: 1,
    passStopReason: null,
    position: { height: 32, width: 32, x: 160, y: 100 },
    size: 32,
    skipReason: null,
    source: 'adaptive',
  };
}

class LoadedImage {
  decoding = '';

  naturalHeight = 140;

  naturalWidth = 200;

  onerror: (() => void) | null = null;

  onload: (() => void) | null = null;

  set src(_value: string) {
    queueMicrotask(() => this.onload?.());
  }
}

describe('automatic processor safety boundary', () => {
  beforeEach(() => {
    vi.stubGlobal('Image', LoadedImage);
    mocks.encode.mockReset();
    mocks.localProcess.mockReset();
    mocks.workerProcess.mockReset();
    mocks.workerProcess.mockResolvedValue({
      processedBlob: new Blob(['unsafe-sdk-output'], { type: 'image/png' }),
      processedMeta: meta(),
    });
  });

  afterEach(() => vi.unstubAllGlobals());

  it('discards an SDK edit when original-only validation finds no safe target', async () => {
    mocks.localProcess.mockResolvedValue({
      blob: null,
      detections: [],
      processingMs: 1,
      regions: [],
    });
    const source = new File(['original-bytes'], 'sample.jpg', { type: 'image/jpeg' });

    const result = await processWatermarkImage(source, 'blob:source');

    expect(result.blob).toBeNull();
    expect(result.method).toBe('none');
    expect(result.meta).toMatchObject({
      applied: false,
      decisionTier: 'safety-rejected',
      passCount: 0,
      position: null,
      skipReason: 'unsafe-weak-shifted-candidate',
    });
    expect(mocks.encode).not.toHaveBeenCalled();
    expect(await source.text()).toBe('original-bytes');
  });

  it('encodes only a cleanup accepted from original-image evidence', async () => {
    const cleanup = new Blob(['verified-cleanup'], { type: 'image/png' });
    const encoded = new Blob(['encoded'], { type: 'image/jpeg' });
    mocks.localProcess.mockResolvedValue({
      blob: cleanup,
      detections: [{
        gradientScore: 0.4,
        luminanceScore: 0.7,
        polarity: 'light',
        region: { height: 32, width: 32, x: 160, y: 100 },
        score: 0.6,
        source: 'local-scan',
      }],
      processingMs: 1,
      regions: [{ height: 32, width: 32, x: 160, y: 100 }],
    });
    mocks.encode.mockResolvedValue(encoded);
    const source = new File(['original-bytes'], 'sample.jpg', { type: 'image/jpeg' });

    const result = await processWatermarkImage(source, 'blob:source');

    expect(result.blob).toBe(encoded);
    expect(result.method).toBe('automatic');
    expect(mocks.encode).toHaveBeenCalledWith(cleanup, source);
  });
});
