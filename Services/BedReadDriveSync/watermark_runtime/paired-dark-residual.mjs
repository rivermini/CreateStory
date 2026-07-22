const COARSE_STEP = 2;
const REFINE_RADIUS = 2;
const MAX_CLUSTER_DISTANCE_FACTOR = 2.25;
const MIN_SCORE = 0.38;
const MIN_LUMINANCE_SCORE = 0.22;
const MIN_GRADIENT_SCORE = 0.12;
const ALPHA_GAIN = 0.53;
const MAX_ALPHA = 0.99;
const MIN_ANCHOR_SCORE = 0.28;
const MIN_ANCHOR_LUMINANCE_SCORE = 0.3;
const CORE_ALPHA_START = 0.015;
const CORE_ALPHA_FULL = 0.18;
const CORE_DONOR_RADIUS = 40;
const CORE_DILATE_RADIUS = 3;
const CORE_TRANSLATION_RADIUS = 128;
const CORE_TRANSLATION_STEP = 8;
const CORE_FEATHER_RADIUS = 4;
const DISTANT_COARSE_STEP = 2;
const DISTANT_REFINE_RADIUS = 2;
const DISTANT_MIN_LUMINANCE_SCORE = 0.45;
const DISTANT_MIN_COMBINED_SCORE = 0.34;
const COMPACT_MIN_LUMINANCE_SCORE = 0.48;
const COMPACT_MIN_GRADIENT_SCORE = 0.34;
const COMPACT_MIN_COMBINED_SCORE = 0.5;

function createLuminance(pixels) {
  const output = new Float32Array(pixels.length / 4);
  for (let pixel = 0; pixel < output.length; pixel += 1) {
    const base = pixel * 4;
    output[pixel] = 0.2126 * pixels[base]
      + 0.7152 * pixels[base + 1]
      + 0.0722 * pixels[base + 2];
  }
  return output;
}

function createGradient(values, width, height) {
  const output = new Float32Array(values.length);
  for (let y = 1; y < height - 1; y += 1) {
    for (let x = 1; x < width - 1; x += 1) {
      const index = y * width + x;
      output[index] = Math.hypot(
        values[index + 1] - values[index - 1],
        values[index + width] - values[index - width],
      );
    }
  }
  return output;
}

function normalizedCorrelationAt(image, imageWidth, template, size, x, y) {
  const count = template.length;
  let imageSum = 0;
  let templateSum = 0;
  for (let row = 0; row < size; row += 1) {
    const imageOffset = (y + row) * imageWidth + x;
    const templateOffset = row * size;
    for (let column = 0; column < size; column += 1) {
      imageSum += image[imageOffset + column];
      templateSum += template[templateOffset + column];
    }
  }
  const imageMean = imageSum / count;
  const templateMean = templateSum / count;
  let numerator = 0;
  let imageVariance = 0;
  let templateVariance = 0;
  for (let row = 0; row < size; row += 1) {
    const imageOffset = (y + row) * imageWidth + x;
    const templateOffset = row * size;
    for (let column = 0; column < size; column += 1) {
      const imageDelta = image[imageOffset + column] - imageMean;
      const templateDelta = template[templateOffset + column] - templateMean;
      numerator += imageDelta * templateDelta;
      imageVariance += imageDelta * imageDelta;
      templateVariance += templateDelta * templateDelta;
    }
  }
  const denominator = Math.sqrt(imageVariance * templateVariance);
  return denominator > 1e-8 ? numerator / denominator : 0;
}

function scoreAt(luminance, gradient, width, alphaMap, alphaGradient, size, x, y, polarity = 'dark') {
  const rawLuminanceScore = normalizedCorrelationAt(luminance, width, alphaMap, size, x, y);
  const luminanceScore = polarity === 'dark' ? -rawLuminanceScore : rawLuminanceScore;
  const gradientScore = normalizedCorrelationAt(gradient, width, alphaGradient, size, x, y);
  return {
    gradientScore,
    luminanceScore,
    region: { x, y, width: size, height: size },
    polarity,
    score: 0.58 * luminanceScore + 0.42 * gradientScore,
  };
}

export function scoreWatermarkPolarityAt(pixels, width, height, alphaMap, x, y, polarity) {
  const size = Math.round(Math.sqrt(alphaMap.length));
  if (size * size !== alphaMap.length
    || pixels.length !== width * height * 4
    || x < 0
    || y < 0
    || x + size > width
    || y + size > height
    || !['dark', 'light'].includes(polarity)) return null;
  const luminance = createLuminance(pixels);
  const gradient = createGradient(luminance, width, height);
  const alphaMagnitude = Float32Array.from(alphaMap, (value) => Math.abs(value));
  const alphaGradient = createGradient(alphaMagnitude, size, size);
  return scoreAt(
    luminance,
    gradient,
    width,
    alphaMagnitude,
    alphaGradient,
    size,
    x,
    y,
    polarity,
  );
}

function distanceSquared(first, second) {
  const deltaX = first.x - second.x;
  const deltaY = first.y - second.y;
  return deltaX * deltaX + deltaY * deltaY;
}

function smoothstep(value) {
  const bounded = Math.max(0, Math.min(1, value));
  return bounded * bounded * (3 - 2 * bounded);
}

function targetAlphaAt(targets, x, y, dilateRadius = 0) {
  let alpha = 0;
  for (const target of targets) {
    for (let offsetY = -dilateRadius; offsetY <= dilateRadius; offsetY += 1) {
      for (let offsetX = -dilateRadius; offsetX <= dilateRadius; offsetX += 1) {
        if (offsetX * offsetX + offsetY * offsetY > dilateRadius * dilateRadius) continue;
        const localX = x + offsetX - target.region.x;
        const localY = y + offsetY - target.region.y;
        if (localX < 0
          || localY < 0
          || localX >= target.region.width
          || localY >= target.region.height) continue;
        alpha = Math.max(
          alpha,
          Math.abs(target.alphaMap[localY * target.region.width + localX]),
        );
      }
    }
  }
  return alpha;
}

export function findBestDonorTranslation(source, imageWidth, imageHeight, targets, bounds) {
  const ring = [];
  const ringRadius = 5;
  for (let y = Math.max(0, bounds.top - ringRadius); y < Math.min(imageHeight, bounds.bottom + ringRadius); y += 2) {
    for (let x = Math.max(0, bounds.left - ringRadius); x < Math.min(imageWidth, bounds.right + ringRadius); x += 2) {
      if (targetAlphaAt(targets, x, y, CORE_DILATE_RADIUS) >= CORE_ALPHA_START) continue;
      let bordersMask = false;
      for (let offsetY = -ringRadius; offsetY <= ringRadius && !bordersMask; offsetY += 1) {
        for (let offsetX = -ringRadius; offsetX <= ringRadius; offsetX += 1) {
          if (targetAlphaAt(
            targets,
            x + offsetX,
            y + offsetY,
            CORE_DILATE_RADIUS,
          ) >= CORE_ALPHA_START) {
            bordersMask = true;
            break;
          }
        }
      }
      if (bordersMask) ring.push({ x, y });
    }
  }
  if (ring.length < 8) return null;

  const regionWidth = bounds.right - bounds.left;
  const regionHeight = bounds.bottom - bounds.top;
  let best = null;
  let bestScore = Number.POSITIVE_INFINITY;
  for (let deltaY = -CORE_TRANSLATION_RADIUS; deltaY <= CORE_TRANSLATION_RADIUS; deltaY += CORE_TRANSLATION_STEP) {
    for (let deltaX = -CORE_TRANSLATION_RADIUS; deltaX <= CORE_TRANSLATION_RADIUS; deltaX += CORE_TRANSLATION_STEP) {
      if (Math.abs(deltaX) < regionWidth && Math.abs(deltaY) < regionHeight) continue;
      let offsetRed = 0;
      let offsetGreen = 0;
      let offsetBlue = 0;
      let valid = true;
      for (const sample of ring) {
        const donorX = sample.x + deltaX;
        const donorY = sample.y + deltaY;
        if (donorX < 0 || donorY < 0 || donorX >= imageWidth || donorY >= imageHeight
          || targetAlphaAt(targets, donorX, donorY, CORE_DILATE_RADIUS) >= CORE_ALPHA_START) {
          valid = false;
          break;
        }
        const target = (sample.y * imageWidth + sample.x) * 4;
        const donor = (donorY * imageWidth + donorX) * 4;
        offsetRed += source[target] - source[donor];
        offsetGreen += source[target + 1] - source[donor + 1];
        offsetBlue += source[target + 2] - source[donor + 2];
      }
      if (!valid) continue;
      offsetRed /= ring.length;
      offsetGreen /= ring.length;
      offsetBlue /= ring.length;
      let error = 0;
      for (const sample of ring) {
        const target = (sample.y * imageWidth + sample.x) * 4;
        const donor = ((sample.y + deltaY) * imageWidth + sample.x + deltaX) * 4;
        const red = source[target] - source[donor] - offsetRed;
        const green = source[target + 1] - source[donor + 1] - offsetGreen;
        const blue = source[target + 2] - source[donor + 2] - offsetBlue;
        error += red * red + green * green + blue * blue;
      }
      const score = error / ring.length + 0.003 * (deltaX * deltaX + deltaY * deltaY);
      if (score < bestScore) {
        bestScore = score;
        best = { deltaX, deltaY, offsetBlue, offsetGreen, offsetRed };
      }
    }
  }
  return best;
}

function coreFeatherBlend(targets, x, y) {
  if (targetAlphaAt(targets, x, y, CORE_DILATE_RADIUS) < CORE_ALPHA_START) return 0;
  let nearestOutside = CORE_FEATHER_RADIUS + 1;
  for (let offsetY = -CORE_FEATHER_RADIUS; offsetY <= CORE_FEATHER_RADIUS; offsetY += 1) {
    for (let offsetX = -CORE_FEATHER_RADIUS; offsetX <= CORE_FEATHER_RADIUS; offsetX += 1) {
      const distance = Math.hypot(offsetX, offsetY);
      if (distance >= nearestOutside) continue;
      if (targetAlphaAt(
        targets,
        x + offsetX,
        y + offsetY,
        CORE_DILATE_RADIUS,
      ) < CORE_ALPHA_START) nearestOutside = distance;
    }
  }
  return smoothstep(Math.min(1, nearestOutside / CORE_FEATHER_RADIUS));
}

export function findPairedResidualCandidate(
  pixels,
  width,
  height,
  alphaMap,
  anchor,
  polarity = 'dark',
  excludeAnchor = true,
) {
  const size = anchor?.width ?? 0;
  if (!anchor
    || anchor.width !== anchor.height
    || alphaMap.length !== size * size
    || pixels.length !== width * height * 4) return null;

  const luminance = createLuminance(pixels);
  const gradient = createGradient(luminance, width, height);
  const alphaMagnitude = Float32Array.from(alphaMap, (value) => Math.abs(value));
  const alphaGradient = createGradient(alphaMagnitude, size, size);
  const radius = Math.round(size * MAX_CLUSTER_DISTANCE_FACTOR);
  const left = Math.max(0, anchor.x - radius);
  const top = Math.max(0, anchor.y - radius);
  const right = Math.min(width - size, anchor.x + radius);
  const bottom = Math.min(height - size, anchor.y + radius);
  const sameInstanceRadius = size * 0.58;
  const sameInstanceRadiusSquared = sameInstanceRadius * sameInstanceRadius;
  let strongest = null;

  for (let y = top; y <= bottom; y += COARSE_STEP) {
    for (let x = left; x <= right; x += COARSE_STEP) {
      // The SDK may leave a strong inverted trace at the position it already
      // processed. Ignore that footprint while searching so it cannot hide a
      // genuinely separate, shifted dark watermark instance.
      if (excludeAnchor && distanceSquared(anchor, { x, y }) < sameInstanceRadiusSquared) continue;
      const candidate = scoreAt(
        luminance,
        gradient,
        width,
        alphaMagnitude,
        alphaGradient,
        size,
        x,
        y,
        polarity,
      );
      if (!strongest || candidate.score > strongest.score) strongest = candidate;
    }
  }
  if (!strongest) return null;

  let refined = strongest;
  for (let y = strongest.region.y - REFINE_RADIUS; y <= strongest.region.y + REFINE_RADIUS; y += 1) {
    for (let x = strongest.region.x - REFINE_RADIUS; x <= strongest.region.x + REFINE_RADIUS; x += 1) {
      if (x < left || y < top || x > right || y > bottom) continue;
      if (excludeAnchor && distanceSquared(anchor, { x, y }) < sameInstanceRadiusSquared) continue;
      const candidate = scoreAt(
        luminance,
        gradient,
        width,
        alphaMagnitude,
        alphaGradient,
        size,
        x,
        y,
        polarity,
      );
      if (candidate.score > refined.score) refined = candidate;
    }
  }

  return refined;
}

export function findPairedDarkResidualCandidate(pixels, width, height, alphaMap, anchor) {
  return findPairedResidualCandidate(pixels, width, height, alphaMap, anchor, 'dark');
}

/**
 * Find the smaller light sparkle that some Gemini exports place down-right of
 * the normal corner mark. The two silhouettes overlap, so a same-size global
 * companion search can mistake their shared edge for a dark residual. Search
 * only the expected down-right pocket with the compact mark's own alpha map.
 */
export function findCompactOffsetSparkleCandidate(
  pixels,
  width,
  height,
  alphaMap,
  anchor,
) {
  const size = Math.round(Math.sqrt(alphaMap.length));
  if (!anchor
    || size * size !== alphaMap.length
    || size < Math.round(anchor.width * 0.55)
    || size > Math.round(anchor.width * 0.8)
    || pixels.length !== width * height * 4) return null;

  const luminance = createLuminance(pixels);
  const gradient = createGradient(luminance, width, height);
  const alphaMagnitude = Float32Array.from(alphaMap, (value) => Math.abs(value));
  const alphaGradient = createGradient(alphaMagnitude, size, size);
  const left = Math.max(0, anchor.x + Math.round(anchor.width * 0.18));
  const top = Math.max(0, anchor.y + Math.round(anchor.height * 0.25));
  const right = Math.min(width - size, anchor.x + Math.round(anchor.width * 0.8));
  const bottom = Math.min(height - size, anchor.y + Math.round(anchor.height * 0.95));
  if (right < left || bottom < top) return null;

  let strongest = null;
  for (let y = top; y <= bottom; y += 1) {
    for (let x = left; x <= right; x += 1) {
      const candidate = scoreAt(
        luminance,
        gradient,
        width,
        alphaMagnitude,
        alphaGradient,
        size,
        x,
        y,
        'light',
      );
      if (!strongest || candidate.score > strongest.score) strongest = candidate;
    }
  }
  if (!strongest
    || strongest.score < COMPACT_MIN_COMBINED_SCORE
    || strongest.luminanceScore < COMPACT_MIN_LUMINANCE_SCORE
    || strongest.gradientScore < COMPACT_MIN_GRADIENT_SCORE) return null;
  strongest.alphaMask = Array.from(alphaMagnitude, (value) => (value >= 0.008 ? 1 : 0));
  return strongest;
}

/**
 * Find the larger companion sparkle used by some Gemini banner exports.
 *
 * Those exports contain a normal small corner sparkle plus a second, larger
 * neutral sparkle above-left of it. The larger mark can cross a foreground /
 * background boundary, so its luminance silhouette remains persuasive while
 * its full gradient correlation is intentionally allowed to be weak. This
 * search is only run after the normal corner mark has been independently
 * validated; a clean image never reaches this detector.
 */
export function findDistantSparkleCandidate(
  pixels,
  width,
  height,
  alphaMaps,
  anchor,
) {
  if (!anchor
    || anchor.width !== anchor.height
    || pixels.length !== width * height * 4
    || !Array.isArray(alphaMaps)
    || alphaMaps.length === 0) return null;

  const luminance = createLuminance(pixels);
  const gradient = createGradient(luminance, width, height);
  let strongest = null;

  for (const entry of alphaMaps) {
    const alphaMap = entry?.alphaMap;
    const size = entry?.size ?? Math.round(Math.sqrt(alphaMap?.length ?? 0));
    if (!(alphaMap instanceof Float32Array)
      || size * size !== alphaMap.length
      || size < Math.round(anchor.width * 1.45)
      || size > Math.round(anchor.width * 2.25)) continue;

    const alphaMagnitude = Float32Array.from(alphaMap, (value) => Math.abs(value));
    const alphaGradient = createGradient(alphaMagnitude, size, size);
    const left = Math.max(
      0,
      Math.floor(width * 0.68),
      anchor.x - Math.round(anchor.width * 4.5),
    );
    const right = Math.min(
      width - size,
      anchor.x - Math.round(anchor.width * 0.45),
    );
    const top = Math.max(
      0,
      Math.floor(height * 0.55),
      anchor.y - Math.round(anchor.height * 3.2),
    );
    const bottom = Math.min(
      height - size,
      anchor.y + Math.round(anchor.height * 0.25),
    );
    if (right < left || bottom < top) continue;

    let bestForSize = null;
    for (let y = top; y <= bottom; y += DISTANT_COARSE_STEP) {
      for (let x = left; x <= right; x += DISTANT_COARSE_STEP) {
        const centerDistance = Math.hypot(
          x + size / 2 - (anchor.x + anchor.width / 2),
          y + size / 2 - (anchor.y + anchor.height / 2),
        );
        if (centerDistance < anchor.width * 1.35) continue;
        for (const polarity of ['light', 'dark']) {
          const candidate = scoreAt(
            luminance,
            gradient,
            width,
            alphaMagnitude,
            alphaGradient,
            size,
            x,
            y,
            polarity,
          );
          candidate.score = 0.72 * candidate.luminanceScore
            + 0.28 * Math.max(0, candidate.gradientScore);
          if (!bestForSize || candidate.score > bestForSize.score) bestForSize = candidate;
        }
      }
    }
    if (!bestForSize) continue;

    let refined = bestForSize;
    for (let y = bestForSize.region.y - DISTANT_REFINE_RADIUS;
      y <= bestForSize.region.y + DISTANT_REFINE_RADIUS;
      y += 1) {
      for (let x = bestForSize.region.x - DISTANT_REFINE_RADIUS;
        x <= bestForSize.region.x + DISTANT_REFINE_RADIUS;
        x += 1) {
        if (x < left || y < top || x > right || y > bottom) continue;
        for (const polarity of ['light', 'dark']) {
          const candidate = scoreAt(
            luminance,
            gradient,
            width,
            alphaMagnitude,
            alphaGradient,
            size,
            x,
            y,
            polarity,
          );
          candidate.score = 0.72 * candidate.luminanceScore
            + 0.28 * Math.max(0, candidate.gradientScore);
          if (candidate.score > refined.score) refined = candidate;
        }
      }
    }
    refined.alphaMask = Array.from(
      alphaMagnitude,
      (value) => (value >= 0.008 ? 1 : 0),
    );
    if (!strongest || refined.score > strongest.score) strongest = refined;
  }

  if (!strongest
    || strongest.luminanceScore < DISTANT_MIN_LUMINANCE_SCORE
    || strongest.score < DISTANT_MIN_COMBINED_SCORE) return null;
  return strongest;
}

export function detectPairedWatermarkLayers(pixels, width, height, alphaMap, anchor) {
  const lightAnchor = scoreWatermarkPolarityAt(
    pixels,
    width,
    height,
    alphaMap,
    anchor.x,
    anchor.y,
    'light',
  );
  const darkAnchor = scoreWatermarkPolarityAt(
    pixels,
    width,
    height,
    alphaMap,
    anchor.x,
    anchor.y,
    'dark',
  );
  const anchorCandidate = lightAnchor.score >= darkAnchor.score ? lightAnchor : darkAnchor;
  if (anchorCandidate.score < MIN_ANCHOR_SCORE
    || anchorCandidate.luminanceScore < MIN_ANCHOR_LUMINANCE_SCORE
    || anchorCandidate.gradientScore < MIN_GRADIENT_SCORE) return null;

  const companionPolarity = anchorCandidate.polarity === 'light' ? 'dark' : 'light';
  const companion = findPairedResidualCandidate(
    pixels,
    width,
    height,
    alphaMap,
    anchor,
    companionPolarity,
  );
  if (!companion
    || companion.score < MIN_SCORE
    || companion.luminanceScore < MIN_LUMINANCE_SCORE
    || companion.gradientScore < MIN_GRADIENT_SCORE) return null;
  return { anchor: anchorCandidate, companion };
}

export function detectPairedDarkResidual(pixels, width, height, alphaMap, anchor) {
  const refined = findPairedDarkResidualCandidate(pixels, width, height, alphaMap, anchor);
  if (!refined
    || refined.score < MIN_SCORE
    || refined.luminanceScore < MIN_LUMINANCE_SCORE
    || refined.gradientScore < MIN_GRADIENT_SCORE) return null;
  return refined;
}

export function removePairedWatermarkLayer(
  pixels,
  imageWidth,
  alphaMap,
  region,
  polarity,
  alphaGain = polarity === 'light' ? 0.8 : ALPHA_GAIN,
) {
  for (let row = 0; row < region.height; row += 1) {
    for (let column = 0; column < region.width; column += 1) {
      const alpha = Math.min(
        Math.abs(alphaMap[row * region.width + column]) * alphaGain,
        MAX_ALPHA,
      );
      if (alpha < 0.002) continue;
      const pixel = ((region.y + row) * imageWidth + region.x + column) * 4;
      for (let channel = 0; channel < 3; channel += 1) {
        const value = polarity === 'light'
          ? (pixels[pixel + channel] - 255 * alpha) / (1 - alpha)
          : pixels[pixel + channel] / (1 - alpha);
        pixels[pixel + channel] = Math.round(Math.max(0, Math.min(255, value)));
      }
    }
  }
}

export function restorePairedWatermarkCores(pixels, imageWidth, imageHeight, targets) {
  if (targets.length === 0) return;
  const source = new Uint8ClampedArray(pixels);
  const left = Math.max(
    0,
    Math.min(...targets.map(({ region }) => region.x)) - CORE_DILATE_RADIUS,
  );
  const top = Math.max(
    0,
    Math.min(...targets.map(({ region }) => region.y)) - CORE_DILATE_RADIUS,
  );
  const right = Math.min(
    imageWidth,
    Math.max(...targets.map(({ region }) => region.x + region.width)) + CORE_DILATE_RADIUS,
  );
  const bottom = Math.min(
    imageHeight,
    Math.max(...targets.map(({ region }) => region.y + region.height)) + CORE_DILATE_RADIUS,
  );
  findBestDonorTranslation(source, imageWidth, imageHeight, targets, {
    bottom, left, right, top,
  });

  for (let y = top; y < bottom; y += 1) {
    for (let x = left; x < right; x += 1) {
      const alpha = targetAlphaAt(targets, x, y, CORE_DILATE_RADIUS);
      if (alpha < CORE_ALPHA_START) continue;
      let red = 0;
      let green = 0;
      let blue = 0;
      let totalWeight = 0;

      for (let offsetY = -CORE_DONOR_RADIUS; offsetY <= CORE_DONOR_RADIUS; offsetY += 2) {
        for (let offsetX = -CORE_DONOR_RADIUS; offsetX <= CORE_DONOR_RADIUS; offsetX += 2) {
          const distance2 = offsetX * offsetX + offsetY * offsetY;
          if (distance2 < 36 || distance2 > CORE_DONOR_RADIUS * CORE_DONOR_RADIUS) continue;
          const donorX = x + offsetX;
          const donorY = y + offsetY;
          if (donorX < 0 || donorY < 0 || donorX >= imageWidth || donorY >= imageHeight) continue;
          if (targetAlphaAt(targets, donorX, donorY, CORE_DILATE_RADIUS) >= CORE_ALPHA_START) continue;
          const donor = (donorY * imageWidth + donorX) * 4;
          const weight = 1 / Math.pow(distance2, 0.75);
          red += source[donor] * weight;
          green += source[donor + 1] * weight;
          blue += source[donor + 2] * weight;
          totalWeight += weight;
        }
      }
      if (totalWeight <= 0) continue;
      const pixel = (y * imageWidth + x) * 4;
      const blend = coreFeatherBlend(targets, x, y);
      pixels[pixel] = Math.round(source[pixel] * (1 - blend) + (red / totalWeight) * blend);
      pixels[pixel + 1] = Math.round(
        source[pixel + 1] * (1 - blend) + (green / totalWeight) * blend,
      );
      pixels[pixel + 2] = Math.round(
        source[pixel + 2] * (1 - blend) + (blue / totalWeight) * blend,
      );
    }
  }
}

export function restorePairedWatermarkPatch(pixels, imageWidth, imageHeight, targets) {
  if (targets.length < 2) return false;
  const source = new Uint8ClampedArray(pixels);
  const largestSize = Math.max(...targets.map(({ region }) => region.width));
  const padding = Math.max(4, Math.round(largestSize * 0.1));
  const feather = Math.max(6, Math.round(largestSize * 0.16));
  const bounds = {
    bottom: Math.min(
      imageHeight,
      Math.max(...targets.map(({ region }) => region.y + region.height)) + padding,
    ),
    left: Math.max(0, Math.min(...targets.map(({ region }) => region.x)) - padding),
    right: Math.min(
      imageWidth,
      Math.max(...targets.map(({ region }) => region.x + region.width)) + padding,
    ),
    top: Math.max(0, Math.min(...targets.map(({ region }) => region.y)) - padding),
  };
  const translation = findBestDonorTranslation(
    source,
    imageWidth,
    imageHeight,
    targets,
    bounds,
  );
  if (!translation) return false;

  for (let y = bounds.top; y < bounds.bottom; y += 1) {
    for (let x = bounds.left; x < bounds.right; x += 1) {
      const donorX = x + translation.deltaX;
      const donorY = y + translation.deltaY;
      if (donorX < 0 || donorY < 0 || donorX >= imageWidth || donorY >= imageHeight) continue;
      const edgeDistance = Math.min(
        x - bounds.left,
        bounds.right - 1 - x,
        y - bounds.top,
        bounds.bottom - 1 - y,
      );
      const blend = smoothstep(Math.min(1, edgeDistance / feather));
      const pixel = (y * imageWidth + x) * 4;
      const donor = (donorY * imageWidth + donorX) * 4;
      for (let channel = 0; channel < 3; channel += 1) {
        pixels[pixel + channel] = Math.round(
          source[pixel + channel] * (1 - blend) + source[donor + channel] * blend,
        );
      }
    }
  }
  return true;
}

export function removePairedDarkResidual(pixels, imageWidth, alphaMap, region) {
  removePairedWatermarkLayer(pixels, imageWidth, alphaMap, region, 'dark', ALPHA_GAIN);
}
