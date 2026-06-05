export interface ProgressBarProps {
  chaptersCrawled: number;
  chaptersTotal: number;
  currentTitle: string;
  status: string;
  isDark?: boolean;
}

import { Icon, appIcons } from './Icon';

export function ProgressBar({ chaptersCrawled, chaptersTotal, currentTitle, status, isDark = true }: ProgressBarProps) {
  const pct = chaptersTotal > 0 ? Math.min(chaptersCrawled / chaptersTotal, 1) : 0;
  const pctStr = (pct * 100).toFixed(0);

  if (status === 'completed') {
    return (
      <div className="space-y-2">
        <div className={`flex items-center gap-2 text-sm font-medium ${isDark ? 'text-emerald-400' : 'text-emerald-600'}`}>
          <Icon icon={appIcons.checkCircle} className="w-5 h-5" />
          Crawl complete — {chaptersCrawled} chapter(s) scraped
        </div>
        <div className="lg-glass h-2.5 rounded-full overflow-hidden" style={{ padding: 0 }}>
          <div className="h-full rounded-full transition-all duration-500" style={{ width: '100%', background: 'linear-gradient(90deg, #34d399, #10b981)' }} />
        </div>
      </div>
    );
  }

  if (status === 'failed') {
    return (
      <div className="space-y-2">
        <div className={`flex items-center gap-2 text-sm font-medium ${isDark ? 'text-red-400' : 'text-red-600'}`}>
          <Icon icon={appIcons.error} className="w-5 h-5" />
          Crawl failed
        </div>
        <div className="lg-glass h-2.5 rounded-full overflow-hidden">
          <div className="h-full rounded-full" style={{ width: `${pctStr}%`, background: 'linear-gradient(90deg, #f87171, #ef4444)' }} />
        </div>
      </div>
    );
  }

  if (status === 'cancelled') {
    return (
      <div className="space-y-2">
        <div className={`flex items-center gap-2 text-sm font-medium ${isDark ? 'text-amber-400' : 'text-amber-600'}`}>
          <Icon icon={appIcons.stop} className="w-5 h-5" />
          Crawl cancelled — {chaptersCrawled} chapter(s) scraped
        </div>
        <div className="lg-glass h-2.5 rounded-full overflow-hidden">
          <div className="h-full rounded-full" style={{ width: `${pctStr}%`, background: 'linear-gradient(90deg, #fbbf24, #f59e0b)' }} />
        </div>
      </div>
    );
  }

  // Running or idle
  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between text-sm">
        <span className={isDark ? 'text-white/65' : 'text-black/65'}>
          Chapter {chaptersCrawled}
          {chaptersTotal > 0 ? ` / ${chaptersTotal}` : ''}
        </span>
        <span className={isDark ? 'text-white/30' : 'text-black/30'}>{pctStr}%</span>
      </div>
      <div className="lg-glass h-2.5 rounded-full overflow-hidden">
        <div
          className="h-full rounded-full transition-all duration-300"
          style={{ width: `${pctStr}%`, background: 'linear-gradient(90deg, #6366f1, #8b5cf6)', boxShadow: '0 0 12px rgba(99,102,241,0.4)' }}
        />
      </div>
      {currentTitle && (
        <p className={`text-xs truncate ${isDark ? 'text-white/35' : 'text-black/35'}`}>
          Now: <span className={isDark ? 'text-indigo-300' : 'text-indigo-600'}>{currentTitle}</span>
        </p>
      )}
    </div>
  );
}
