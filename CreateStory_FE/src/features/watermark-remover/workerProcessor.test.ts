import { describe, expect, it } from 'vitest';

import { canUseWatermarkWorker } from './workerProcessor';

describe('watermark worker capability detection', () => {
  it('requires Worker, OffscreenCanvas, and createImageBitmap together', () => {
    const supported = {
      Worker: class WorkerStub {},
      OffscreenCanvas: class OffscreenCanvasStub {},
      createImageBitmap: () => undefined,
    };

    expect(canUseWatermarkWorker(supported)).toBe(true);
    expect(canUseWatermarkWorker({ ...supported, Worker: undefined })).toBe(false);
    expect(canUseWatermarkWorker({ ...supported, OffscreenCanvas: undefined })).toBe(false);
    expect(canUseWatermarkWorker({ ...supported, createImageBitmap: undefined })).toBe(false);
  });
});
