import { describe, expect, it } from 'vitest';

import {
  MAX_IMAGE_BYTES,
  MAX_QUEUE_LENGTH,
  buildOutputFilename,
  describeSkipReason,
  fileIdentity,
  formatBytes,
  formatDuration,
  formatTechnicalLabel,
  isSupportedImage,
  selectImageFiles,
} from './watermarkRemover';

interface FileOptions {
  type?: string;
  size?: number;
  lastModified?: number;
}

function makeFile(
  name: string,
  { type = 'image/png', size = 128, lastModified = 1_700_000_000_000 }: FileOptions = {},
): File {
  return { name, type, size, lastModified } as unknown as File;
}

describe('watermark remover file helpers', () => {
  it('builds a stable, case-insensitive identity from file metadata', () => {
    const original = makeFile('Gemini-Cover.PNG', { size: 2048, lastModified: 1234 });
    const sameMetadata = makeFile('gemini-cover.png', { size: 2048, lastModified: 1234 });

    expect(fileIdentity(original)).toBe('gemini-cover.png::2048::1234');
    expect(fileIdentity(sameMetadata)).toBe(fileIdentity(original));
    expect(fileIdentity(makeFile('gemini-cover.png', { size: 2049, lastModified: 1234 })))
      .not.toBe(fileIdentity(original));
    expect(fileIdentity(makeFile('gemini-cover.png', { size: 2048, lastModified: 1235 })))
      .not.toBe(fileIdentity(original));
  });

  it.each([
    ['image/png', 'not-an-image.txt'],
    ['IMAGE/JPEG', 'not-an-image.txt'],
    ['image/webp', 'not-an-image.txt'],
    ['', 'fallback.PNG'],
    ['application/octet-stream', 'fallback.jpeg'],
    ['text/plain', 'fallback.WeBp'],
  ])('accepts supported MIME or extension fallback: %s / %s', (type, name) => {
    expect(isSupportedImage(makeFile(name, { type }))).toBe(true);
  });

  it.each([
    ['', 'image'],
    ['', 'image.'],
    ['image/gif', 'image.gif'],
    ['image/svg+xml', 'image.svg'],
    ['application/pdf', 'image.pdf'],
  ])('rejects unsupported MIME and extension combinations: %s / %s', (type, name) => {
    expect(isSupportedImage(makeFile(name, { type }))).toBe(false);
  });

  it('deduplicates existing and newly accepted files before enforcing available slots', () => {
    const existing = makeFile('Existing.PNG', { size: 500, lastModified: 10 });
    const duplicateExisting = makeFile('existing.png', { size: 500, lastModified: 10 });
    const first = makeFile('first.webp', { size: 600, lastModified: 20 });
    const duplicateFirst = makeFile('FIRST.WEBP', { size: 600, lastModified: 20 });
    const second = makeFile('second.jpg', { size: 700, lastModified: 30 });
    const beyondCapacity = makeFile('third.png', { size: 800, lastModified: 40 });

    const result = selectImageFiles(
      [duplicateExisting, first, duplicateFirst, second, beyondCapacity],
      new Set([fileIdentity(existing)]),
      2,
    );

    expect(result.accepted).toEqual([first, second]);
    expect(result.rejected.map(({ file, reason }) => [file.name, reason])).toEqual([
      ['existing.png', 'duplicate'],
      ['FIRST.WEBP', 'duplicate'],
      ['third.png', 'queue-full'],
    ]);
    expect(result.rejected[0]?.message).toBe('This image is already in the queue.');
    expect(result.rejected[2]?.message).toBe(`The queue supports up to ${MAX_QUEUE_LENGTH} images.`);
  });

  it('accepts the exact size limit and rejects larger files without consuming a slot', () => {
    const tooLarge = makeFile('oversized.png', { size: MAX_IMAGE_BYTES + 1 });
    const atLimit = makeFile('at-limit.png', { size: MAX_IMAGE_BYTES });

    const result = selectImageFiles([tooLarge, atLimit], new Set(), 1);

    expect(result.accepted).toEqual([atLimit]);
    expect(result.rejected).toHaveLength(1);
    expect(result.rejected[0]).toMatchObject({
      file: tooLarge,
      reason: 'too-large',
      message: 'Image exceeds the 25 MB per-file limit.',
    });
  });

  it('rejects unsupported files without consuming a slot', () => {
    const unsupported = makeFile('animation.gif', { type: 'image/gif' });
    const supported = makeFile('cover.png');

    const result = selectImageFiles([unsupported, supported], new Set(), 1);

    expect(result.accepted).toEqual([supported]);
    expect(result.rejected).toEqual([
      {
        file: unsupported,
        reason: 'unsupported',
        message: 'Only PNG, JPEG, and WebP images are supported.',
      },
    ]);
  });

  it.each([0, -3])('clamps %s available slots to an empty queue', (availableSlots) => {
    const file = makeFile('cover.png');
    const result = selectImageFiles([file], new Set(), availableSlots);

    expect(result.accepted).toEqual([]);
    expect(result.rejected).toEqual([
      {
        file,
        reason: 'queue-full',
        message: `The queue supports up to ${MAX_QUEUE_LENGTH} images.`,
      },
    ]);
  });
});

describe('watermark remover output filenames', () => {
  it.each([
    ['cover.png', 'cover-watermark-removed.png'],
    ['cover.final.v2.JPEG', 'cover.final.v2-watermark-removed.png'],
    ['extensionless', 'extensionless-watermark-removed.png'],
    ['.hidden', '.hidden-watermark-removed.png'],
    ['draft.', 'draft-watermark-removed.png'],
    ['ảnh bìa.webp', 'ảnh bìa-watermark-removed.png'],
    ['', 'gemini-image-watermark-removed.png'],
  ])('maps %j to %j', (input, expected) => {
    expect(buildOutputFilename(input)).toBe(expected);
  });
});

describe('watermark remover display formatting', () => {
  it.each([
    [Number.NaN, '0 B'],
    [Number.POSITIVE_INFINITY, '0 B'],
    [-1, '0 B'],
    [0, '0 B'],
    [1, '1 B'],
    [1023, '1023 B'],
    [1024, '1.0 KB'],
    [1536, '1.5 KB'],
    [10 * 1024, '10 KB'],
    [MAX_IMAGE_BYTES, '25 MB'],
    [1024 ** 3, '1.0 GB'],
  ])('formats %s bytes as %s', (bytes, expected) => {
    expect(formatBytes(bytes)).toBe(expected);
  });

  it.each([
    [Number.NaN, '—'],
    [Number.POSITIVE_INFINITY, '—'],
    [-1, '—'],
    [0, '0 ms'],
    [999, '999 ms'],
    [1000, '1.0 s'],
    [1250, '1.3 s'],
    [9999, '10.0 s'],
    [10_000, '10 s'],
    [15_500, '16 s'],
  ])('formats %s milliseconds as %s', (milliseconds, expected) => {
    expect(formatDuration(milliseconds)).toBe(expected);
  });

  it.each([
    [null, 'Not available'],
    [undefined, 'Not available'],
    ['', 'Not available'],
    ['candidate-execution-failed', 'Candidate Execution Failed'],
    ['runtime_failure', 'Runtime Failure'],
    ['--main__thread--', 'Main Thread'],
    ['already readable', 'Already readable'],
  ])('formats the technical label %j as %j', (value, expected) => {
    expect(formatTechnicalLabel(value)).toBe(expected);
  });
});

describe('watermark remover skip descriptions', () => {
  it.each([null, undefined, ''])('uses the default description for %j', (reason) => {
    expect(describeSkipReason(reason)).toBe(
      'No supported visible Gemini watermark was detected.',
    );
  });

  it('describes the known runtime and safety skip reasons', () => {
    expect(describeSkipReason('candidate-execution-failed')).toBe(
      'A possible watermark region could not be processed safely.',
    );
    expect(describeSkipReason('unsafe-weak-shifted-candidate')).toBe(
      'A weak match was found, but changing it could damage the image.',
    );
  });

  it('falls back to a readable label for unknown reasons', () => {
    expect(describeSkipReason('catalog_match_rejected')).toBe(
      'No safe match was applied (Catalog Match Rejected).',
    );
  });
});
