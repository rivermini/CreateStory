import type { WatermarkMeta } from '@pilio/gemini-watermark-remover/image-data';
import type { BrowserRuntimeProcessor } from '@pilio/gemini-watermark-remover/runtime-browser';
import {
  DEFAULT_MANUAL_WATERMARK_TARGET,
  processAutoDetectedWatermarksImage,
  processManualWatermarkImage,
  type ManualWatermarkRegion,
  type ManualWatermarkTarget,
} from './manualRemoval';
import type { WatermarkDetectionCandidate } from './multiDetector';
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

  const startedAt = performance.now();
  const result = canUseWatermarkWorker()
    ? await processWatermarkBlobInWorker(file)
    : await (await getSharedRuntime()).processWatermarkBlob(file);

  if (!result.processedMeta) {
    throw new Error('The image processor returned no verification details.');
  }

  if (result.processedMeta.applied && !result.processedBlob) {
    throw new Error('The image processor returned no output PNG.');
  }

  let blob = result.processedMeta.applied ? result.processedBlob : null;
  let appliedRegion = result.processedMeta.applied ? result.processedMeta.position : null;
  let appliedRegions = appliedRegion ? [appliedRegion] : [];
  let detections: WatermarkDetectionCandidate[] = [];
  let manualTarget: ManualWatermarkTarget | null = null;
  let method: ProcessedWatermarkImage['method'] = result.processedMeta.applied ? 'automatic' : 'none';
  const preferredSize = result.processedMeta.position?.width
    ?? result.processedMeta.size
    ?? DEFAULT_MANUAL_WATERMARK_TARGET.size;
  const canScanLocally = width / height >= 1.4
    && preferredSize >= 28
    && preferredSize <= 48;
  const useCroppedBannerCleanup = shouldUseCroppedBannerCleanup(
    result.processedMeta,
    width,
    height,
  );

  if (canScanLocally) {
    try {
      const seedRegions = result.processedMeta.applied && result.processedMeta.position
        ? [result.processedMeta.position]
        : [];
      const local = await processAutoDetectedWatermarksImage(
        sourceUrl,
        preferredSize,
        seedRegions,
      );
      const shouldUseLocalResult = Boolean(local.blob)
        && (local.detections.length > 1 || !result.processedMeta.applied || useCroppedBannerCleanup);
      if (shouldUseLocalResult) {
        blob = local.blob;
        appliedRegions = local.regions;
        appliedRegion = local.regions[0] ?? null;
        detections = local.detections;
        method = local.regions.length > 1 ? 'multi-instance' : 'cropped-banner';
      }
    } catch {
      // Preserve the SDK result and allow the calibrated fallback below to run.
    }
  }

  if (useCroppedBannerCleanup && method === 'automatic') {
    const target: ManualWatermarkTarget = {
      ...DEFAULT_MANUAL_WATERMARK_TARGET,
      size: result.processedMeta.position?.width ?? DEFAULT_MANUAL_WATERMARK_TARGET.size,
    };

    try {
      const cleanup = await processManualWatermarkImage(sourceUrl, target);
      blob = cleanup.blob;
      appliedRegion = cleanup.region;
      appliedRegions = [cleanup.region];
      manualTarget = cleanup.target;
      method = 'cropped-banner';
    } catch {
      // Preserve the SDK result and expose manual targeting if the optional fallback fails.
    }
  }

  if (blob) blob = await preserveSourceImageEncoding(blob, file);

  return {
    appliedRegion,
    appliedRegions,
    blob,
    detections,
    height,
    manualTarget,
    meta: result.processedMeta,
    method,
    processingMs: performance.now() - startedAt,
    width,
  };
}
