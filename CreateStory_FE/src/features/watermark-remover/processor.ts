import type { WatermarkMeta } from '@pilio/gemini-watermark-remover/image-data';
import type { BrowserRuntimeProcessor } from '@pilio/gemini-watermark-remover/runtime-browser';
import {
  DEFAULT_MANUAL_WATERMARK_TARGET,
  processManualWatermarkImage,
  type ManualWatermarkRegion,
  type ManualWatermarkTarget,
} from './manualRemoval';

export interface ProcessedWatermarkImage {
  appliedRegion: ManualWatermarkRegion | null;
  blob: Blob | null;
  height: number;
  manualTarget: ManualWatermarkTarget | null;
  meta: WatermarkMeta;
  method: 'automatic' | 'cropped-banner' | 'none';
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

  const runtime = await getSharedRuntime();
  const startedAt = performance.now();
  const result = await runtime.processWatermarkBlob(file);

  if (!result.processedMeta) {
    throw new Error('The image processor returned no verification details.');
  }

  if (result.processedMeta.applied && !result.processedBlob) {
    throw new Error('The image processor returned no output PNG.');
  }

  let blob = result.processedMeta.applied ? result.processedBlob : null;
  let appliedRegion = result.processedMeta.applied ? result.processedMeta.position : null;
  let manualTarget: ManualWatermarkTarget | null = null;
  let method: ProcessedWatermarkImage['method'] = result.processedMeta.applied ? 'automatic' : 'none';

  if (shouldUseCroppedBannerCleanup(result.processedMeta, width, height)) {
    const target: ManualWatermarkTarget = {
      ...DEFAULT_MANUAL_WATERMARK_TARGET,
      size: result.processedMeta.position?.width ?? DEFAULT_MANUAL_WATERMARK_TARGET.size,
    };

    try {
      const cleanup = await processManualWatermarkImage(sourceUrl, target);
      blob = cleanup.blob;
      appliedRegion = cleanup.region;
      manualTarget = cleanup.target;
      method = 'cropped-banner';
    } catch {
      // Preserve the SDK result and expose manual targeting if the optional fallback fails.
    }
  }

  return {
    appliedRegion,
    blob,
    height,
    manualTarget,
    meta: result.processedMeta,
    method,
    processingMs: performance.now() - startedAt,
    width,
  };
}

