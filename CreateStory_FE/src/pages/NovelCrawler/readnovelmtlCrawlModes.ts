export type CrawlMode = 'fast' | 'slow';

export const CRAWL_MODE_PRESETS = {
  fast: { workers: 4, delaySeconds: 1, label: 'Fast', detail: '4 workers · 1s delay' },
  slow: { workers: 2, delaySeconds: 2, label: 'Slow', detail: '2 workers · 2s delay' },
} as const;

export function resolveCrawlMode(workers: number, delaySeconds: number): CrawlMode {
  return workers >= CRAWL_MODE_PRESETS.fast.workers
    && delaySeconds <= CRAWL_MODE_PRESETS.fast.delaySeconds
    ? 'fast'
    : 'slow';
}
