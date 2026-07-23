export type CrawlMode = 'fast' | 'slow';

export const CRAWL_MODE_PRESETS = {
  fast: { workers: 2, delaySeconds: 0.3, label: 'Fast', detail: '2 workers · ~12k/h steady' },
  slow: { workers: 2, delaySeconds: 0.5, label: 'Slow', detail: '2 workers · ~7k/h gentle' },
} as const;

export function resolveCrawlMode(workers: number, delaySeconds: number): CrawlMode {
  return workers >= CRAWL_MODE_PRESETS.fast.workers
    && delaySeconds <= CRAWL_MODE_PRESETS.fast.delaySeconds
    ? 'fast'
    : 'slow';
}
