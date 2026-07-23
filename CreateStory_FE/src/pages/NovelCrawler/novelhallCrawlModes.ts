export type CrawlMode = 'fast' | 'slow';

export const CRAWL_MODE_PRESETS = {
  fast: { workers: 4, delaySeconds: 0.15, label: 'Fast', detail: '4 workers · fast' },
  slow: { workers: 2, delaySeconds: 1, label: 'Slow', detail: '2 workers · 1s delay' },
} as const;

export function resolveCrawlMode(workers: number, delaySeconds: number): CrawlMode {
  return workers >= CRAWL_MODE_PRESETS.fast.workers
    && delaySeconds <= CRAWL_MODE_PRESETS.fast.delaySeconds
    ? 'fast'
    : 'slow';
}
