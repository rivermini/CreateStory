import { resolveSourceImageFormat } from './watermarkRemover';

const LOSSY_MIN_QUALITY = 0.5;
const LOSSY_MAX_QUALITY = 0.98;
const LOSSY_SEARCH_STEPS = 7;

export interface SourceEncodingFile {
  name: string;
  size: number;
  type: string;
}

function loadBlobImage(blob: Blob): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const sourceUrl = URL.createObjectURL(blob);
    const image = new Image();
    image.decoding = 'async';
    image.onload = () => {
      URL.revokeObjectURL(sourceUrl);
      resolve(image);
    };
    image.onerror = () => {
      URL.revokeObjectURL(sourceUrl);
      reject(new Error('The browser could not decode the processed image.'));
    };
    image.src = sourceUrl;
  });
}

function encodeCanvas(
  canvas: HTMLCanvasElement,
  mimeType: string,
  quality?: number,
): Promise<Blob> {
  return new Promise((resolve, reject) => {
    canvas.toBlob((blob) => {
      if (blob) resolve(blob);
      else reject(new Error(`The browser could not encode ${mimeType}.`));
    }, mimeType, quality);
  });
}

export async function findClosestLossyEncoding(
  targetBytes: number,
  encode: (quality: number) => Promise<Blob>,
): Promise<Blob> {
  let lowerQuality = LOSSY_MIN_QUALITY;
  let upperQuality = LOSSY_MAX_QUALITY;
  let closest: Blob | null = null;
  let closestDifference = Number.POSITIVE_INFINITY;

  for (let step = 0; step < LOSSY_SEARCH_STEPS; step += 1) {
    const quality = (lowerQuality + upperQuality) / 2;
    const candidate = await encode(quality);
    const difference = Math.abs(candidate.size - targetBytes);
    if (difference < closestDifference) {
      closest = candidate;
      closestDifference = difference;
    }

    if (candidate.size > targetBytes) upperQuality = quality;
    else lowerQuality = quality;
  }

  if (!closest) throw new Error('The browser could not encode the processed image.');
  return closest;
}

export async function preserveSourceImageEncoding(
  processedBlob: Blob,
  sourceFile: SourceEncodingFile,
): Promise<Blob> {
  const format = resolveSourceImageFormat(sourceFile);
  if (format.mimeType === 'image/png' && processedBlob.type === 'image/png') {
    return processedBlob;
  }

  const image = await loadBlobImage(processedBlob);
  const canvas = document.createElement('canvas');
  canvas.width = image.naturalWidth;
  canvas.height = image.naturalHeight;
  const context = canvas.getContext('2d');
  if (!context) throw new Error('This browser does not support local image encoding.');
  context.drawImage(image, 0, 0);

  if (format.mimeType === 'image/png') return encodeCanvas(canvas, format.mimeType);
  return findClosestLossyEncoding(
    sourceFile.size,
    (quality) => encodeCanvas(canvas, format.mimeType, quality),
  );
}
