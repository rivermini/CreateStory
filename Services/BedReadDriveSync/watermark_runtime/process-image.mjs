import { readFile, writeFile } from 'node:fs/promises';
import {
  createWatermarkEngine,
  removeWatermarkFromImageData,
} from '@pilio/gemini-watermark-remover/image-data';

const DEFAULT_MAX_PASSES = 3;

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

  for (let index = 0; index < maxPasses; index += 1) {
    const result = await removeWatermarkFromImageData(imageData, {
      adaptiveMode: 'auto',
      engine,
    });
    const meta = result.meta;
    passes.push({
      applied: meta.applied,
      confidence: meta.detection?.adaptiveConfidence ?? null,
      decisionTier: meta.decisionTier ?? null,
      passCount: meta.passCount ?? 0,
      position: meta.position ?? null,
      skipReason: meta.skipReason ?? null,
      source: meta.source ?? null,
    });

    if (!meta.applied) {
      stopReason = meta.skipReason || 'no-match';
      break;
    }

    imageData = result.imageData;
    if (positionsEqual(lastAppliedPosition, meta.position) && index + 1 >= maxPasses) {
      stopReason = 'max-passes-same-position';
    }
    lastAppliedPosition = meta.position;
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
