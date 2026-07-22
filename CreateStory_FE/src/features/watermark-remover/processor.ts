import type { WatermarkMeta } from '@pilio/gemini-watermark-remover/image-data';
import type { BrowserRuntimeProcessor } from '@pilio/gemini-watermark-remover/runtime-browser';
import {
  processAutoDetectedWatermarksImage,
  type ManualWatermarkRegion,
  type ManualWatermarkTarget,
} from './manualRemoval';
import type { WatermarkDetectionCandidate } from './multiDetector';
import { BASE_URL, fetchWithAuth } from '../../api/client';
import { preserveSourceImageEncoding } from './outputEncoding';
import {
  canUseWatermarkWorker,
  processWatermarkBlobInWorker,
} from './workerProcessor';

export interface ProcessedWatermarkImage {
  appliedRegion: ManualWatermarkRegion | null;
  appliedRegions: ManualWatermarkRegion[];
  blob: Blob | null;
  detections: WatermarkDetectionCandidate[];
  height: number;
  manualTarget: ManualWatermarkTarget | null;
  meta: WatermarkMeta;
  method: 'automatic' | 'cropped-banner' | 'multi-instance' | 'none';
  processingMs: number;
  width: number;
}

let runtimePromise: Promise<BrowserRuntimeProcessor> | null = null;

function parseServerRegion(value: string | null): ManualWatermarkRegion | null {
  if (!value) return null;
  const parts = value.split(',').map(Number);
  if (parts.length !== 4 || parts.some((part) => !Number.isFinite(part))) return null;
  const [x0, y0, x1, y1] = parts;
  if (x1 <= x0 || y1 <= y0) return null;
  return { x: x0, y: y0, width: x1 - x0, height: y1 - y0 };
}

async function processWatermarkImageOnServer(
  file: File,
  width: number,
  height: number,
): Promise<ProcessedWatermarkImage> {
  const body = new FormData();
  body.append('file', file, file.name);
  const startedAt = performance.now();
  const response = await fetchWithAuth(`${BASE_URL}/api/drive-sync/watermark-process`, {
    method: 'POST',
    body,
  });
  if (!response.ok) throw new Error(`Server watermark processing failed (HTTP ${response.status}).`);
  const applied = response.headers.get('x-watermark-applied') === 'true';
  const needsReview = response.headers.get('x-watermark-needs-review') === 'true';
  const serverMethod = response.headers.get('x-watermark-method') ?? 'none';
  const region = parseServerRegion(response.headers.get('x-watermark-region'));
  const confidenceHeader = response.headers.get('x-watermark-confidence');
  const confidenceValue = confidenceHeader ? Number(confidenceHeader) : Number.NaN;
  const confidence = Number.isFinite(confidenceValue) ? confidenceValue : null;
  const passes = Math.max(0, Number(response.headers.get('x-watermark-passes')) || 0);
  const processingMs = Number(response.headers.get('x-watermark-processing-ms'))
    || performance.now() - startedAt;
  const method: ProcessedWatermarkImage['method'] = !applied
    ? 'none'
    : serverMethod === 'sparkle-pair'
      ? 'multi-instance'
      : 'automatic';
  const meta: WatermarkMeta = {
    applied,
    skipReason: applied ? null : response.headers.get('x-watermark-stop-reason') ?? 'server-no-match',
    size: region?.width ?? null,
    position: applied ? region : null,
    config: null,
    detection: {
      adaptiveConfidence: confidence,
      originalSpatialScore: null,
      originalGradientScore: null,
      processedSpatialScore: null,
      processedGradientScore: null,
      suppressionGain: null,
    },
    source: `server:${serverMethod}`,
    decisionTier: applied ? 'server-validated' : needsReview ? 'server-review-required' : 'server-no-match',
    alphaGain: 1,
    passCount: applied ? passes : 0,
    attemptedPassCount: 1,
    passStopReason: response.headers.get('x-watermark-stop-reason'),
  };
  return {
    appliedRegion: applied ? region : null,
    appliedRegions: applied && region ? [region] : [],
    blob: applied ? await response.blob() : null,
    detections: [],
    height,
    manualTarget: null,
    meta,
    method,
    processingMs,
    width,
  };
}

export function shouldUseCroppedBannerCleanup(
  meta: WatermarkMeta,
  width: number,
  height: number,
): boolean {
  const position = meta.position;
  const confidence = meta.detection.adaptiveConfidence;
  if (!meta.applied
    || !position
    || confidence === null
    || confidence === undefined
    || confidence >= 0.55
    || width / height < 1.6
    || position.width < 28
    || position.width > 48) {
    return false;
  }

  const rightMargin = width - position.x - position.width;
  const bottomMargin = height - position.y - position.height;
  const suspiciousMargin = Math.max(48, position.width * 1.4);
  return rightMargin >= suspiciousMargin && bottomMargin >= suspiciousMargin;
}


async function getSharedRuntime(): Promise<BrowserRuntimeProcessor> {
  runtimePromise ??= import('@pilio/gemini-watermark-remover/runtime-browser')
    .then(({ createBrowserRuntimeProcessor }) => createBrowserRuntimeProcessor({
      defaultOptions: { adaptiveMode: 'auto' },
    }));

  try {
    return await runtimePromise;
  } catch (error) {
    runtimePromise = null;
    throw error;
  }
}

function loadImage(sourceUrl: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.decoding = 'async';
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error('The browser could not decode this image.'));
    image.src = sourceUrl;
  });
}

export async function processWatermarkImage(file: File, sourceUrl: string): Promise<ProcessedWatermarkImage> {
  const image = await loadImage(sourceUrl);
  const width = image.naturalWidth;
  const height = image.naturalHeight;

  if (width <= 0 || height <= 0) {
    throw new Error('The image has invalid dimensions.');
  }

  try {
    return await processWatermarkImageOnServer(file, width, height);
  } catch {
    // The maintenance processor may be offline during local-only use. Retain
    // the browser's strict, fail-closed detector as a non-blocking fallback.
  }

  const startedAt = performance.now();
  const result = canUseWatermarkWorker()
    ? await processWatermarkBlobInWorker(file)
    : await (await getSharedRuntime()).processWatermarkBlob(file);

  if (!result.processedMeta) {
    throw new Error('The image processor returned no verification details.');
  }

  let blob: Blob | null = null;
  let appliedRegion: ManualWatermarkRegion | null = null;
  let appliedRegions: ManualWatermarkRegion[] = [];
  let detections: WatermarkDetectionCandidate[] = [];
  const manualTarget: ManualWatermarkTarget | null = null;
  let method: ProcessedWatermarkImage['method'] = 'none';
  const preferredSize = result.processedMeta.position?.width
    ?? result.processedMeta.size
    ?? 36;
  const canScanLocally = width / height >= 1.4
    && preferredSize >= 20
    && preferredSize <= 96;

  if (canScanLocally) {
    try {
      const local = await processAutoDetectedWatermarksImage(
        sourceUrl,
        preferredSize,
      );
      if (local.blob) {
        blob = local.blob;
        appliedRegions = local.regions;
        appliedRegion = local.regions[0] ?? null;
        detections = local.detections;
        method = local.regions.length > 1 ? 'multi-instance' : 'automatic';
      }
    } catch {
      // Fail closed: an unverified SDK result must never replace the original.
    }
  }

  // Encoding happens only after a cleanup passes every safety gate. On rejection,
  // the caller retains the original File object byte-for-byte.
  if (blob) blob = await preserveSourceImageEncoding(blob, file);

  const meta: WatermarkMeta = blob
    ? {
      ...result.processedMeta,
      applied: true,
      position: appliedRegion,
      size: appliedRegion?.width ?? result.processedMeta.size,
      skipReason: null,
    }
    : {
      ...result.processedMeta,
      applied: false,
      decisionTier: 'safety-rejected',
      passCount: 0,
      position: null,
      skipReason: 'unsafe-weak-shifted-candidate',
    };

  return {
    appliedRegion,
    appliedRegions,
    blob,
    detections,
    height,
    manualTarget,
    meta,
    method,
    processingMs: performance.now() - startedAt,
    width,
  };
}
