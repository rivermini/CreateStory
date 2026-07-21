export const SUPPORTED_IMAGE_TYPES = ['image/jpeg', 'image/png', 'image/webp'] as const;
export const ACCEPTED_IMAGE_TYPES = SUPPORTED_IMAGE_TYPES.join(',');
export const MAX_IMAGE_BYTES = 25 * 1024 * 1024;
export const MAX_QUEUE_LENGTH = 50;

export type FileRejectionReason = 'duplicate' | 'queue-full' | 'too-large' | 'unsupported';

export interface FileRejection {
  file: File;
  reason: FileRejectionReason;
  message: string;
}

export interface FileSelectionResult {
  accepted: File[];
  rejected: FileRejection[];
}

const SUPPORTED_TYPE_SET = new Set<string>(SUPPORTED_IMAGE_TYPES);
const SUPPORTED_EXTENSIONS = new Set(['jpg', 'jpeg', 'png', 'webp']);

export interface SourceImageFormat {
  extension: 'jpeg' | 'jpg' | 'png' | 'webp';
  mimeType: (typeof SUPPORTED_IMAGE_TYPES)[number];
}

export function resolveSourceImageFormat(
  file: Pick<File, 'name' | 'type'>,
): SourceImageFormat {
  const requestedExtension = file.name.split('.').pop()?.toLocaleLowerCase();
  const extension = SUPPORTED_EXTENSIONS.has(requestedExtension ?? '')
    ? requestedExtension as SourceImageFormat['extension']
    : null;
  const mimeType = file.type.toLocaleLowerCase();

  if (mimeType === 'image/jpeg') {
    return { extension: extension === 'jpeg' ? 'jpeg' : 'jpg', mimeType };
  }
  if (mimeType === 'image/webp') return { extension: 'webp', mimeType };
  if (mimeType === 'image/png') return { extension: 'png', mimeType };
  if (extension === 'jpg' || extension === 'jpeg') {
    return { extension, mimeType: 'image/jpeg' };
  }
  if (extension === 'webp') return { extension, mimeType: 'image/webp' };
  return { extension: 'png', mimeType: 'image/png' };
}

export function fileIdentity(file: Pick<File, 'lastModified' | 'name' | 'size'>): string {
  return `${file.name.toLocaleLowerCase()}::${file.size}::${file.lastModified}`;
}

export function isSupportedImage(file: Pick<File, 'name' | 'type'>): boolean {
  if (SUPPORTED_TYPE_SET.has(file.type.toLocaleLowerCase())) return true;

  const extension = file.name.split('.').pop()?.toLocaleLowerCase();
  return extension !== undefined && SUPPORTED_EXTENSIONS.has(extension);
}

export function selectImageFiles(
  files: Iterable<File>,
  existingIdentities: ReadonlySet<string>,
  availableSlots: number,
): FileSelectionResult {
  const accepted: File[] = [];
  const rejected: FileRejection[] = [];
  const seen = new Set(existingIdentities);
  const slots = Math.max(0, availableSlots);

  for (const file of files) {
    const identity = fileIdentity(file);

    if (!isSupportedImage(file)) {
      rejected.push({
        file,
        reason: 'unsupported',
        message: 'Only PNG, JPEG, and WebP images are supported.',
      });
      continue;
    }

    if (file.size > MAX_IMAGE_BYTES) {
      rejected.push({
        file,
        reason: 'too-large',
        message: `Image exceeds the ${formatBytes(MAX_IMAGE_BYTES)} per-file limit.`,
      });
      continue;
    }

    if (seen.has(identity)) {
      rejected.push({
        file,
        reason: 'duplicate',
        message: 'This image is already in the queue.',
      });
      continue;
    }

    if (accepted.length >= slots) {
      rejected.push({
        file,
        reason: 'queue-full',
        message: `The queue supports up to ${MAX_QUEUE_LENGTH} images.`,
      });
      continue;
    }

    accepted.push(file);
    seen.add(identity);
  }

  return { accepted, rejected };
}

export function buildOutputFilename(filename: string, mimeType = ''): string {
  const lastDot = filename.lastIndexOf('.');
  const base = lastDot > 0 ? filename.slice(0, lastDot) : filename;
  const format = resolveSourceImageFormat({ name: filename, type: mimeType });
  return `${base || 'gemini-image'}-watermark-removed.${format.extension}`;
}

export function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return '0 B';

  const units = ['B', 'KB', 'MB', 'GB'];
  const unitIndex = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), units.length - 1);
  const value = bytes / 1024 ** unitIndex;
  const digits = unitIndex === 0 || value >= 10 ? 0 : 1;

  return `${value.toFixed(digits)} ${units[unitIndex]}`;
}

export function formatDuration(milliseconds: number): string {
  if (!Number.isFinite(milliseconds) || milliseconds < 0) return '—';
  if (milliseconds < 1000) return `${Math.round(milliseconds)} ms`;
  return `${(milliseconds / 1000).toFixed(milliseconds < 10_000 ? 1 : 0)} s`;
}

export function formatTechnicalLabel(value: string | null | undefined): string {
  if (!value) return 'Not available';
  return value
    .split(/[-_]/u)
    .filter(Boolean)
    .map((part) => `${part.charAt(0).toLocaleUpperCase()}${part.slice(1)}`)
    .join(' ');
}

export function describeSkipReason(reason: string | null | undefined): string {
  if (!reason) return 'No supported visible Gemini watermark was detected.';

  const descriptions: Record<string, string> = {
    'candidate-execution-failed': 'A possible watermark region could not be processed safely.',
    'unsafe-weak-shifted-candidate': 'A weak match was found, but changing it could damage the image.',
  };

  return descriptions[reason] ?? `No safe match was applied (${formatTechnicalLabel(reason)}).`;
}
