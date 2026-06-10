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
  const progressFill = isDark ? 'rgba(255,255,255,0.92)' : '#111111';
  const mutedFill = isDark ? 'rgba(255,255,255,0.72)' : 'rgba(17,17,17,0.72)';

  if (status === 'completed') {
    return (
      <div className="space-y-1.5">
        <div className="flex items-center gap-2 text-sm font-medium" style={{ color: progressFill }}>
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
        <div className="flex items-center gap-2 text-sm font-medium" style={{ color: mutedFill }}>
          <Icon icon={appIcons.error} className="h-5 w-5" />
          Crawl failed
        </div>
        <div className="h-2.5 overflow-hidden rounded-full border" style={{ background: trackBackground, borderColor: trackBorder }}>
          <div className="h-full rounded-full" style={{ width: `${pctStr}%`, background: mutedFill }} />
        </div>
      </div>
    );
  }

  if (status === 'cancelled') {
    return (
      <div className="space-y-1.5">
        <div className="flex items-center gap-2 text-sm font-medium" style={{ color: mutedFill }}>
          <Icon icon={appIcons.stop} className="h-5 w-5" />
          Crawl cancelled — {chaptersCrawled} chapter(s) scraped
        </div>
        <div className="h-2.5 overflow-hidden rounded-full border" style={{ background: trackBackground, borderColor: trackBorder }}>
          <div className="h-full rounded-full" style={{ width: `${pctStr}%`, background: mutedFill }} />
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-1.5">
      <div className="flex items-center justify-between text-sm">
        <span style={{ color: isDark ? 'rgba(255,255,255,0.5)' : 'rgba(55,53,47,0.62)' }}>
          Chapter {chaptersCrawled}
          {chaptersTotal > 0 ? ` / ${chaptersTotal}` : ''}
        </span>
        <span style={{ color: isDark ? 'rgba(255,255,255,0.34)' : 'rgba(55,53,47,0.42)' }}>{pctStr}%</span>
      </div>
      <div className="h-2.5 overflow-hidden rounded-full border" style={{ background: trackBackground, borderColor: trackBorder }}>
        <div
          className="h-full rounded-full transition-all duration-300"
          style={{ width: `${pctStr}%`, background: progressFill }}
        />
      </div>
      {currentTitle && (
        <p className="truncate text-xs" style={{ color: isDark ? 'rgba(255,255,255,0.34)' : 'rgba(55,53,47,0.42)' }}>
          Now: <span style={{ color: progressFill }}>{currentTitle}</span>
        </p>
      )}
      {!currentTitle && <p className="text-xs" style={{ color: progressFill }} />}
    </div>
  );
}
