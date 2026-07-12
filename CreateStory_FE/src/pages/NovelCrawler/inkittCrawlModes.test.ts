import { describe, expect, it } from 'vitest';

import { CRAWL_MODE_PRESETS, resolveCrawlMode } from './inkittCrawlModes';

describe('Inkitt crawl mode presets', () => {
  it('maps fast and slow modes to the intended safety settings', () => {
    expect(CRAWL_MODE_PRESETS.fast).toMatchObject({ workers: 4, delaySeconds: 1 });
    expect(CRAWL_MODE_PRESETS.slow).toMatchObject({ workers: 2, delaySeconds: 2 });
  });

  it('derives the mode when an existing batch is loaded', () => {
    expect(resolveCrawlMode(4, 1)).toBe('fast');
    expect(resolveCrawlMode(4, 2)).toBe('slow');
    expect(resolveCrawlMode(2, 1)).toBe('slow');
  });
});
