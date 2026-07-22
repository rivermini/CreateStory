import { readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  createWatermarkEngine,
  removeWatermarkFromImageData,
} from '@pilio/gemini-watermark-remover/image-data';

import {
  findDistantSparkleCandidate,
  findPairedDarkResidualCandidate,
  scoreWatermarkPolarityAt,
} from './paired-dark-residual.mjs';

// A single SDK result is the only edit this runtime can commit. The previous
// three-pass loop re-detected artifacts created by its own preceding pass and
// could progressively turn a weak/false match into a visible dark hole.
const DEFAULT_MAX_PASSES = 1;
const MIN_GRADIENT_EVIDENCE = 0.12;
const MIN_LUMINANCE_EVIDENCE = 0.25;
const MIN_COMBINED_EVIDENCE = 0.2;
const MIN_SCORE_IMPROVEMENT = 0.1;
const MAX_REMAINING_SCORE_FACTOR = 0.55;
const MAX_OPPOSITE_POLARITY_SCORE = 0.18;
const CHANGE_BOUNDS_PADDING = 2;
const EXCEPTIONAL_AGGRESSIVE_MIN_SCORE = 0.56;
const EXCEPTIONAL_AGGRESSIVE_MIN_GRADIENT = 0.3;
const EXCEPTIONAL_AGGRESSIVE_MIN_LUMINANCE = 0.65;
const CORROBORATED_AGGRESSIVE_MIN_SCORE = 0.4;
const CORROBORATED_AGGRESSIVE_MIN_GRADIENT = 0.15;
const CORROBORATED_AGGRESSIVE_MIN_LUMINANCE = 0.55;
const CORROBORATING_PAIR_MIN_SCORE = 0.32;
const CORROBORATING_PAIR_MIN_GRADIENT = 0.2;
const CORROBORATING_PAIR_MIN_LUMINANCE = 0.4;

function parsePositiveInteger(value, label) {
  const parsed = Number.parseInt(value, 10);
  if (!Number.isInteger(parsed) || parsed <= 0) {
    throw new Error(`${label} must be a positive integer.`);
  }
  return parsed;
}

export function regionsOverlap(first, second) {
  if (!first || !second) return false;
  return first.x < second.x + second.width
    && first.x + first.width > second.x
    && first.y < second.y + second.height
    && first.y + first.height > second.y;
}

function isValidRegion(region, width, height) {
  return Boolean(
    region
    && Number.isInteger(region.x)
    && Number.isInteger(region.y)
    && Number.isInteger(region.width)
    && Number.isInteger(region.height)
    && region.x >= 0
    && region.y >= 0
    && region.width >= 16
    && region.height === region.width
    && region.x + region.width <= width
    && region.y + region.height <= height,
  );
}

function isExpectedBottomRightRegion(region, width, height) {
  if (!isValidRegion(region, width, height)) return false;
  const rightInset = width - region.x - region.width;
  const bottomInset = height - region.y - region.height;
  return region.x >= Math.floor(width * 0.7)
    && region.y >= Math.floor(height * 0.62)
    && rightInset <= Math.max(96, Math.round(width * 0.14))
    && bottomInset <= Math.max(96, Math.round(height * 0.22));
}

function changedPixelSummary(original, candidate, width, height, region) {
  if (original.length !== candidate.length) {
    return { changedCount: 0, changedOutsideCandidate: true };
  }
  const left = Math.max(0, region.x - CHANGE_BOUNDS_PADDING);
  const top = Math.max(0, region.y - CHANGE_BOUNDS_PADDING);
  const right = Math.min(width, region.x + region.width + CHANGE_BOUNDS_PADDING);
  const bottom = Math.min(height, region.y + region.height + CHANGE_BOUNDS_PADDING);
  let changedCount = 0;
  let changedOutsideCandidate = false;
  for (let pixel = 0; pixel < width * height; pixel += 1) {
    const offset = pixel * 4;
    if (original[offset] === candidate[offset]
      && original[offset + 1] === candidate[offset + 1]
      && original[offset + 2] === candidate[offset + 2]
      && original[offset + 3] === candidate[offset + 3]) continue;
    changedCount += 1;
    const x = pixel % width;
    const y = Math.floor(pixel / width);
    if (x < left || x >= right || y < top || y >= bottom) {
      changedOutsideCandidate = true;
    }
  }
  return { changedCount, changedOutsideCandidate };
}

function strongestOriginalEvidence(original, width, height, alphaMap, position) {
  const light = scoreWatermarkPolarityAt(
    original,
    width,
    height,
    alphaMap,
    position.x,
    position.y,
    'light',
  );
  const dark = scoreWatermarkPolarityAt(
    original,
    width,
    height,
    alphaMap,
    position.x,
    position.y,
    'dark',
  );
  if (!light || !dark) return null;
  return light.score >= dark.score ? light : dark;
}

function reject(reason, details = {}) {
  return { accepted: false, needsReview: true, reason, ...details };
}

export function isCorroboratedAggressiveCandidate(evidence, pairedCandidate) {
  if (!evidence) return false;
  const exceptionalPrimary = evidence.score >= EXCEPTIONAL_AGGRESSIVE_MIN_SCORE
    && evidence.gradientScore >= EXCEPTIONAL_AGGRESSIVE_MIN_GRADIENT
    && evidence.luminanceScore >= EXCEPTIONAL_AGGRESSIVE_MIN_LUMINANCE;
  if (exceptionalPrimary) return true;
  return evidence.score >= CORROBORATED_AGGRESSIVE_MIN_SCORE
    && evidence.gradientScore >= CORROBORATED_AGGRESSIVE_MIN_GRADIENT
    && evidence.luminanceScore >= CORROBORATED_AGGRESSIVE_MIN_LUMINANCE
    && pairedCandidate?.score >= CORROBORATING_PAIR_MIN_SCORE
    && pairedCandidate?.gradientScore >= CORROBORATING_PAIR_MIN_GRADIENT
    && pairedCandidate?.luminanceScore >= CORROBORATING_PAIR_MIN_LUMINANCE;
}

export function evaluateCandidate({
  allowAggressiveSource = false,
  alphaMap,
  height,
  meta,
  original,
  processed,
  previouslyAcceptedRegions = [],
  width,
}) {
  const position = meta?.position ?? null;
  if (!meta?.applied || !position) {
    return {
      accepted: false,
      needsReview: false,
      reason: meta?.skipReason || 'no-match',
    };
  }
  if (!isExpectedBottomRightRegion(position, width, height)) {
    return reject('candidate-outside-expected-corner');
  }
  if (previouslyAcceptedRegions.some((region) => regionsOverlap(region, position))) {
    return reject('duplicate-or-overlapping-candidate');
  }
  if (!alphaMap || alphaMap.length !== position.width * position.height) {
    return reject('missing-independent-template');
  }

  // This score is recomputed from the untouched input, independently of the
  // SDK detector. It prevents an SDK fallback from validating evidence that a
  // prior cleanup pass manufactured.
  const evidence = strongestOriginalEvidence(
    original,
    width,
    height,
    alphaMap,
    position,
  );
  if (!evidence
    || evidence.polarity !== 'light'
    || evidence.gradientScore < MIN_GRADIENT_EVIDENCE
    || evidence.luminanceScore < MIN_LUMINANCE_EVIDENCE
    || evidence.score < MIN_COMBINED_EVIDENCE) {
    return reject('insufficient-original-pixel-evidence', { evidence });
  }
  const source = String(meta?.source ?? '');
  if (!source.includes('standard')
    && !source.includes('preview-anchor')
    && !allowAggressiveSource) {
    return reject('unverified-aggressive-detector-source', { evidence });
  }

  const changes = changedPixelSummary(original, processed, width, height, position);
  if (changes.changedCount === 0 || changes.changedOutsideCandidate) {
    return reject(
      changes.changedCount === 0 ? 'empty-cleanup-result' : 'cleanup-escaped-candidate',
      { changes, evidence },
    );
  }

  const remaining = scoreWatermarkPolarityAt(
    processed,
    width,
    height,
    alphaMap,
    position.x,
    position.y,
    evidence.polarity,
  );
  const opposite = scoreWatermarkPolarityAt(
    processed,
    width,
    height,
    alphaMap,
    position.x,
    position.y,
    'dark',
  );
  const scoreImprovement = evidence.score - (remaining?.score ?? evidence.score);
  const allowedOppositeScore = Math.max(
    MAX_OPPOSITE_POLARITY_SCORE,
    evidence.score * 0.75,
  );
  if (!remaining
    || !opposite
    || scoreImprovement < MIN_SCORE_IMPROVEMENT
    || remaining.score > evidence.score * MAX_REMAINING_SCORE_FACTOR
    || opposite.score > allowedOppositeScore) {
    return reject('unsafe-post-cleanup-residual', {
      changes,
      evidence,
      opposite,
      remaining,
      scoreImprovement,
    });
  }

  // The SDK exposes its own artifact review. A visible residual or any damage
  // warning is a reason to preserve the source, even when correlation falls.
  if (meta.qualityStatus !== 'clean'
    || meta.qualitySignals?.residualVisible === true
    || meta.qualitySignals?.damageWarning === true) {
    return reject('sdk-quality-review-required', {
      changes,
      evidence,
      opposite,
      remaining,
      scoreImprovement,
    });
  }

  return {
    accepted: true,
    changes,
    evidence,
    needsReview: false,
    opposite,
    reason: 'validated-original-pixel-match',
    remaining,
    scoreImprovement,
  };
}

export async function processImagePixels({
  engine,
  height,
  pixels,
  removeWatermark = removeWatermarkFromImageData,
  requestedMaxPasses = DEFAULT_MAX_PASSES,
  width,
}) {
  const original = new Uint8ClampedArray(pixels);
  const activeEngine = engine ?? await createWatermarkEngine();
  const result = await removeWatermark({
    data: new Uint8ClampedArray(original),
    height,
    width,
  }, {
    adaptiveMode: 'auto',
    engine: activeEngine,
  });
  const meta = result.meta ?? {};
  let validation = {
    accepted: false,
    needsReview: false,
    reason: meta.skipReason || 'no-match',
  };
  let pairedCandidate = null;
  let primaryAlphaMask = null;
  let secondaryCandidate = null;
  if (meta.applied && meta.position) {
    let alphaMap = null;
    try {
      alphaMap = await activeEngine.getAlphaMap(meta.position.width);
    } catch {
      // A missing independent template is handled as a review rejection.
    }
    if (alphaMap) {
      primaryAlphaMask = Array.from(alphaMap, (value) => (value >= 0.008 ? 1 : 0));
      pairedCandidate = findPairedDarkResidualCandidate(
        original,
        width,
        height,
        alphaMap,
        meta.position,
      );
      const originalEvidence = strongestOriginalEvidence(
        original,
        width,
        height,
        alphaMap,
        meta.position,
      );
      validation = evaluateCandidate({
        allowAggressiveSource: isCorroboratedAggressiveCandidate(
          originalEvidence,
          pairedCandidate,
        ),
        alphaMap,
        height,
        meta,
        original,
        processed: result.imageData?.data ?? new Uint8ClampedArray(),
        width,
      });
      if (validation.accepted === true) {
        const secondaryMaps = [];
        const secondarySizes = [
          Math.round(meta.position.width * 1.6),
          Math.round(meta.position.width * 1.92),
        ];
        for (const size of secondarySizes) {
          try {
            const secondaryMap = await activeEngine.getAlphaMap(size);
            secondaryMaps.push({ alphaMap: secondaryMap, size });
          } catch {
            // A missing optional scale simply removes it from the companion search.
          }
        }
        secondaryCandidate = findDistantSparkleCandidate(
          original,
          width,
          height,
          secondaryMaps,
          meta.position,
        );
      }
    } else {
      validation = evaluateCandidate({
        alphaMap,
        height,
        meta,
        original,
        processed: result.imageData?.data ?? new Uint8ClampedArray(),
        width,
      });
    }
  }

  const applied = validation.accepted === true;
  const pass = {
    applied,
    confidence: validation.evidence?.score ?? meta.detection?.adaptiveConfidence ?? null,
    decisionTier: meta.decisionTier ?? null,
    detectedApplied: Boolean(meta.applied),
    passCount: applied ? 1 : 0,
    position: meta.position ?? null,
    skipReason: applied ? null : validation.reason,
    source: meta.source ?? null,
    validation,
  };
  return {
    data: applied ? result.imageData.data : original,
    metadata: {
      applied,
      appliedPassCount: applied ? 1 : 0,
      effectiveMaxPasses: DEFAULT_MAX_PASSES,
      needsReview: validation.needsReview === true,
      passes: [pass],
      pairedCandidate,
      primaryAlphaMask,
      secondaryCandidate,
      requestedMaxPasses,
      stopReason: validation.reason,
    },
  };
}

async function main() {
  const [inputPath, outputPath, resultPath, widthValue, heightValue, maxPassesValue] = process.argv.slice(2);
  if (!inputPath || !outputPath || !resultPath) {
    throw new Error('Usage: process-image.mjs <input.raw> <output.raw> <result.json> <width> <height> [max-passes]');
  }

  const width = parsePositiveInteger(widthValue, 'width');
  const height = parsePositiveInteger(heightValue, 'height');
  const requestedMaxPasses = maxPassesValue
    ? parsePositiveInteger(maxPassesValue, 'max-passes')
    : DEFAULT_MAX_PASSES;
  const input = await readFile(inputPath);
  const expectedBytes = width * height * 4;
  if (input.byteLength !== expectedBytes) {
    throw new Error(`Expected ${expectedBytes} RGBA bytes, received ${input.byteLength}.`);
  }

  const processed = await processImagePixels({
    height,
    pixels: input,
    requestedMaxPasses,
    width,
  });
  // Always materialize output data. Rejected candidates deliberately write an
  // exact byte copy of the input so direct callers cannot accidentally consume
  // an unsafe SDK result.
  await writeFile(outputPath, Buffer.from(processed.data));
  await writeFile(resultPath, JSON.stringify(processed.metadata));
}

const isEntrypoint = Boolean(
  process.argv[1]
  && resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url)),
);
if (isEntrypoint) {
  main().catch(async (error) => {
    const resultPath = process.argv[4];
    const message = error instanceof Error ? error.message : String(error);
    if (resultPath) {
      try {
        await writeFile(resultPath, JSON.stringify({ applied: false, error: message }));
      } catch {
        // The Python caller also checks the process exit status.
      }
    }
    process.stderr.write(`${message}\n`);
    process.exitCode = 1;
  });
}
