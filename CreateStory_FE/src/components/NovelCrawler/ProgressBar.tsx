import { Icon, appIcons } from '../Shared/Icon';

export interface ProgressBarProps {
  readonly chaptersCrawled: number;
  readonly chaptersTotal: number;
  readonly currentTitle: string;
  readonly status: string;
  readonly isDark?: boolean;
}

export function ProgressBar({ chaptersCrawled, chaptersTotal, currentTitle, status, isDark = true }: Readonly<ProgressBarProps>) {
  const pct = chaptersTotal > 0 ? Math.min(chaptersCrawled / chaptersTotal, 1) : 0;
  const pctStr = (pct * 100).toFixed(0);
  const trackBackground = isDark ? 'rgba(255,255,255,0.08)' : 'rgba(55,53,47,0.08)';
  const trackBorder = isDark ? 'rgba(255,255,255,0.08)' : 'rgba(55,53,47,0.12)';

  const stateColors = {
    running: { fill: '#3b82f6', text: '#93c5fd', muted: '#60a5fa' },
    completed: { fill: '#22c55e', text: '#86efac', muted: '#4ade80' },
    failed: { fill: '#ef4444', text: '#fca5a5', muted: '#f87171' },
    cancelled: { fill: '#f59e0b', text: '#fcd34d', muted: '#fbbf24' },
  };
  const colorScheme = stateColors[status as keyof typeof stateColors] ?? stateColors.running;
  const progressFill = isDark ? colorScheme.fill : colorScheme.fill;
  const progressText = isDark ? colorScheme.text : colorScheme.text;

  if (status === 'completed') {
    return (
      <div className="space-y-1.5">
        <div className="flex items-center gap-2 text-sm font-medium" style={{ color: progressText }}>
          <Icon icon={appIcons.checkCircle} className="h-5 w-5" />
          Crawl complete — {chaptersCrawled} chapter(s) scraped
        </div>
        <div className="h-2.5 overflow-hidden rounded-full border" style={{ background: trackBackground, borderColor: trackBorder }}>
          <div className="h-full rounded-full transition-all duration-500" style={{ width: '100%', background: progressFill }} />
        </div>
      </div>
    );
  }

  if (status === 'failed') {
    return (
      <div className="space-y-1.5">
        <div className="flex items-center gap-2 text-sm font-medium" style={{ color: progressText }}>
          <Icon icon={appIcons.error} className="h-5 w-5" />
          Crawl failed
        </div>
        <div className="h-2.5 overflow-hidden rounded-full border" style={{ background: trackBackground, borderColor: trackBorder }}>
          <div className="h-full rounded-full" style={{ width: `${pctStr}%`, background: colorScheme.muted }} />
        </div>
      </div>
    );
  }

  if (status === 'cancelled') {
    return (
      <div className="space-y-1.5">
        <div className="flex items-center gap-2 text-sm font-medium" style={{ color: progressText }}>
          <Icon icon={appIcons.stop} className="h-5 w-5" />
          Crawl cancelled — {chaptersCrawled} chapter(s) scraped
        </div>
        <div className="h-2.5 overflow-hidden rounded-full border" style={{ background: trackBackground, borderColor: trackBorder }}>
          <div className="h-full rounded-full" style={{ width: `${pctStr}%`, background: colorScheme.muted }} />
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-1.5">
      <div className="flex items-center justify-between text-sm">
        <span style={{ color: progressText }}>
          Chapter {chaptersCrawled}
          {chaptersTotal > 0 ? ` / ${chaptersTotal}` : ''}
        </span>
        <span style={{ color: progressText, opacity: 0.7 }}>{pctStr}%</span>
      </div>
      <div className="h-2.5 overflow-hidden rounded-full border" style={{ background: trackBackground, borderColor: trackBorder }}>
        <div
          className="h-full rounded-full transition-all duration-300"
          style={{ width: `${pctStr}%`, background: progressFill }}
        />
      </div>
      {currentTitle && (
        <p className="truncate text-xs" style={{ color: progressText, opacity: 0.7 }}>
          Now: <span style={{ color: progressFill }}>{currentTitle}</span>
        </p>
      )}
      {!currentTitle && <p className="text-xs" style={{ color: progressText }} />}
    </div>
  );
}
