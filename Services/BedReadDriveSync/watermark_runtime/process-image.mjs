import { readFile, writeFile } from 'node:fs/promises';
import {
  createWatermarkEngine,
  removeWatermarkFromImageData,
} from '@pilio/gemini-watermark-remover/image-data';
import { positionsWithinCluster } from './position-cluster.mjs';
import { resolveMaximumPasses } from './pass-policy.mjs';
import {
  detectPairedDarkResidual,
  findPairedResidualCandidate,
  removePairedDarkResidual,
  restorePairedWatermarkPatch,
} from './paired-dark-residual.mjs';

const DEFAULT_MAX_PASSES = 3;
const PAIR_SIZE_FACTORS = [0.83, 1, 1.17, 1.33, 1.5];

function center(region) {
  return {
    x: region.x + region.width / 2,
    y: region.y + region.height / 2,
  };
}

function distance(first, second) {
  return Math.hypot(first.x - second.x, first.y - second.y);
}

function qualifiesPairCandidate(candidate) {
  if (!candidate) return false;
  const minimumScore = candidate.polarity === 'light' ? 0.42 : 0.38;
  const minimumLuminance = candidate.polarity === 'light' ? 0.45 : 0.35;
  return candidate.score >= minimumScore
    && candidate.luminanceScore >= minimumLuminance
    && candidate.gradientScore >= 0.1;
}

async function detectMultiSizePair(engine, pixels, width, height, sdkAnchor) {
  const sizes = [...new Set(PAIR_SIZE_FACTORS.map((factor) => (
    Math.max(20, Math.round(sdkAnchor.width * factor / 4) * 4)
  )))];
  const candidates = [];
  const sdkCenter = center(sdkAnchor);

  for (const size of sizes) {
    if (size > width || size > height) continue;
    const alphaMap = await engine.getAlphaMap(size);
    const searchAnchor = {
      height: size,
      width: size,
      x: Math.max(0, Math.min(width - size, Math.round(sdkCenter.x - size / 2))),
      y: Math.max(0, Math.min(height - size, Math.round(sdkCenter.y - size / 2))),
    };
    for (const polarity of ['light', 'dark']) {
      const candidate = findPairedResidualCandidate(
        pixels,
        width,
        height,
        alphaMap,
        searchAnchor,
        polarity,
        false,
      );
      if (qualifiesPairCandidate(candidate)) candidates.push({ ...candidate, alphaMap });
    }
  }

  const lights = candidates.filter(({ polarity }) => polarity === 'light');
  const darks = candidates.filter(({ polarity }) => polarity === 'dark');
  let bestPair = null;
  for (const light of lights) {
    for (const dark of darks) {
      const separation = distance(center(light.region), center(dark.region));
      const minimumSeparation = Math.min(light.region.width, dark.region.width) * 0.35;
      const maximumSeparation = Math.max(light.region.width, dark.region.width) * 1.5;
      if (separation < minimumSeparation || separation > maximumSeparation) continue;
      const pairScore = light.score + dark.score;
      if (!bestPair || pairScore > bestPair.score) {
        bestPair = { dark, light, score: pairScore };
      }
    }
  }
  return bestPair;
}

function parsePositiveInteger(value, label) {
  const parsed = Number.parseInt(value, 10);
  if (!Number.isInteger(parsed) || parsed <= 0) {
    throw new Error(`${label} must be a positive integer.`);
  }
  return parsed;
}

function positionsEqual(first, second) {
  if (!first || !second) return false;
  return first.x === second.x
    && first.y === second.y
    && first.width === second.width
    && first.height === second.height;
}

async function main() {
  const [inputPath, outputPath, resultPath, widthValue, heightValue, maxPassesValue] = process.argv.slice(2);
  if (!inputPath || !outputPath || !resultPath) {
    throw new Error('Usage: process-image.mjs <input.raw> <output.raw> <result.json> <width> <height> [max-passes]');
  }

  const width = parsePositiveInteger(widthValue, 'width');
  const height = parsePositiveInteger(heightValue, 'height');
  const maxPasses = maxPassesValue
    ? parsePositiveInteger(maxPassesValue, 'max-passes')
    : DEFAULT_MAX_PASSES;
  const effectiveMaxPasses = resolveMaximumPasses(width, height, maxPasses);
  const allowMultiSizePairCleanup = width / height >= 1.4;
  const input = await readFile(inputPath);
  const expectedBytes = width * height * 4;
  if (input.byteLength !== expectedBytes) {
    throw new Error(`Expected ${expectedBytes} RGBA bytes, received ${input.byteLength}.`);
  }

  const engine = await createWatermarkEngine();
  let imageData = {
    data: new Uint8ClampedArray(input),
    height,
    width,
  };
  const passes = [];
  let stopReason = 'max-passes';
  let lastAppliedPosition = null;
  let anchorPosition = null;
  let multiSizePairApplied = false;

  for (let index = 0; index < effectiveMaxPasses; index += 1) {
    const result = await removeWatermarkFromImageData(imageData, {
      adaptiveMode: 'auto',
      engine,
    });
    const meta = result.meta;
    if (allowMultiSizePairCleanup && index === 0 && meta.applied && meta.position) {
      const pair = await detectMultiSizePair(
        engine,
        imageData.data,
        width,
        height,
        meta.position,
      );
      if (pair && restorePairedWatermarkPatch(imageData.data, width, height, [
        { alphaMap: pair.light.alphaMap, region: pair.light.region },
        { alphaMap: pair.dark.alphaMap, region: pair.dark.region },
      ])) {
        for (const candidate of [pair.light, pair.dark]) {
          passes.push({
            applied: true,
            detectedApplied: true,
            confidence: candidate.score,
            decisionTier: 'paired-multi-size-cleanup',
            passCount: 1,
            polarity: candidate.polarity,
            position: candidate.region,
            skipReason: null,
            source: 'paired-multi-size-detector',
          });
        }
        anchorPosition = meta.position;
        multiSizePairApplied = true;
        stopReason = 'paired-multi-size-cleanup';
        break;
      }
    }
    const isSpatialOutlier = Boolean(
      meta.applied
      && anchorPosition
      && !positionsWithinCluster(anchorPosition, meta.position),
    );
    passes.push({
      applied: meta.applied && !isSpatialOutlier,
      detectedApplied: meta.applied,
      confidence: meta.detection?.adaptiveConfidence ?? null,
      decisionTier: meta.decisionTier ?? null,
      passCount: meta.passCount ?? 0,
      position: meta.position ?? null,
      skipReason: isSpatialOutlier ? 'spatial-outlier' : (meta.skipReason ?? null),
      source: meta.source ?? null,
    });

    if (isSpatialOutlier) {
      stopReason = 'spatial-outlier';
      break;
    }

    if (!meta.applied) {
      stopReason = meta.skipReason || 'no-match';
      break;
    }

    imageData = result.imageData;
    anchorPosition ??= meta.position ?? null;
    if (positionsEqual(lastAppliedPosition, meta.position) && index + 1 >= effectiveMaxPasses) {
      stopReason = 'max-passes-same-position';
    }
    lastAppliedPosition = meta.position;
  }

  if (anchorPosition && !multiSizePairApplied) {
    const alphaMap = await engine.getAlphaMap(anchorPosition.width);
    const darkResidual = detectPairedDarkResidual(
      imageData.data,
      width,
      height,
      alphaMap,
      anchorPosition,
    );
    if (darkResidual) {
      removePairedDarkResidual(
        imageData.data,
        width,
        alphaMap,
        darkResidual.region,
      );
      passes.push({
        applied: true,
        detectedApplied: true,
        confidence: darkResidual.score,
        decisionTier: 'paired-dark-residual',
        passCount: 1,
        polarity: 'dark',
        position: darkResidual.region,
        skipReason: null,
        source: 'paired-dark-residual',
      });
      stopReason = 'paired-dark-residual';
    }
  }

  const appliedPasses = passes.filter((pass) => pass.applied);
  if (appliedPasses.length > 0) {
    await writeFile(outputPath, Buffer.from(imageData.data));
  }
  await writeFile(resultPath, JSON.stringify({
    applied: appliedPasses.length > 0,
    appliedPassCount: appliedPasses.length,
    passes,
    stopReason,
  }));
}

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
