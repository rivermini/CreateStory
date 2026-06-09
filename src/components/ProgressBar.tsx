import { Icon, appIcons } from './Icon';

export interface ProgressBarProps {
  chaptersCrawled: number;
  chaptersTotal: number;
  currentTitle: string;
  status: string;
  isDark?: boolean;
}

export function ProgressBar({ chaptersCrawled, chaptersTotal, currentTitle, status, isDark = true }: ProgressBarProps) {
  const pct = chaptersTotal > 0 ? Math.min(chaptersCrawled / chaptersTotal, 1) : 0;
  const pctStr = (pct * 100).toFixed(0);
  const trackBackground = isDark ? 'rgba(255,255,255,0.08)' : 'rgba(55,53,47,0.08)';
  const trackBorder = isDark ? 'rgba(255,255,255,0.08)' : 'rgba(55,53,47,0.12)';
  const primaryText = isDark ? 'rgba(255,255,255,0.92)' : '#37352f';
  const secondaryText = isDark ? 'rgba(255,255,255,0.5)' : 'rgba(55,53,47,0.62)';
  const tertiaryText = isDark ? 'rgba(255,255,255,0.34)' : 'rgba(55,53,47,0.42)';

  if (status === 'completed') {
    return (
      <div className="space-y-2">
        <div className="flex items-center gap-2 text-sm font-medium" style={{ color: isDark ? '#34d399' : '#059669' }}>
          <Icon icon={appIcons.checkCircle} className="h-5 w-5" />
          Crawl complete — {chaptersCrawled} chapter(s) scraped
        </div>
        <div className="h-2.5 overflow-hidden rounded-full border" style={{ background: trackBackground, borderColor: trackBorder }}>
          <div className="h-full rounded-full transition-all duration-500" style={{ width: '100%', background: 'linear-gradient(90deg, #34d399, #10b981)' }} />
        </div>
      </div>
    );
  }

  if (status === 'failed') {
    return (
      <div className="space-y-2">
        <div className="flex items-center gap-2 text-sm font-medium" style={{ color: isDark ? '#f87171' : '#dc2626' }}>
          <Icon icon={appIcons.error} className="h-5 w-5" />
          Crawl failed
        </div>
        <div className="h-2.5 overflow-hidden rounded-full border" style={{ background: trackBackground, borderColor: trackBorder }}>
          <div className="h-full rounded-full" style={{ width: `${pctStr}%`, background: 'linear-gradient(90deg, #f87171, #ef4444)' }} />
        </div>
      </div>
    );
  }

  if (status === 'cancelled') {
    return (
      <div className="space-y-2">
        <div className="flex items-center gap-2 text-sm font-medium" style={{ color: '#f59e0b' }}>
          <Icon icon={appIcons.stop} className="h-5 w-5" />
          Crawl cancelled — {chaptersCrawled} chapter(s) scraped
        </div>
        <div className="h-2.5 overflow-hidden rounded-full border" style={{ background: trackBackground, borderColor: trackBorder }}>
          <div className="h-full rounded-full" style={{ width: `${pctStr}%`, background: 'linear-gradient(90deg, #fbbf24, #f59e0b)' }} />
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between text-sm">
        <span style={{ color: secondaryText }}>
          Chapter {chaptersCrawled}
          {chaptersTotal > 0 ? ` / ${chaptersTotal}` : ''}
        </span>
        <span style={{ color: tertiaryText }}>{pctStr}%</span>
      </div>
      <div className="h-2.5 overflow-hidden rounded-full border" style={{ background: trackBackground, borderColor: trackBorder }}>
        <div
          className="h-full rounded-full transition-all duration-300"
          style={{ width: `${pctStr}%`, background: 'linear-gradient(90deg, #6366f1, #8b5cf6)', boxShadow: '0 0 12px rgba(99,102,241,0.35)' }}
        />
      </div>
      {currentTitle && (
        <p className="truncate text-xs" style={{ color: tertiaryText }}>
          Now: <span style={{ color: isDark ? '#818cf8' : '#4f46e5' }}>{currentTitle}</span>
        </p>
      )}
      {!currentTitle && <p className="text-xs" style={{ color: primaryText }} />}
    </div>
  );
}
