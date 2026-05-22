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

  const trackBg = isDark ? 'bg-slate-800' : 'bg-gray-200';

  if (status === 'completed') {
    return (
      <div className="space-y-1">
        <div className={`flex items-center gap-2 text-sm font-medium ${isDark ? 'text-emerald-400' : 'text-emerald-600'}`}>
          <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
          </svg>
          Crawl complete — {chaptersCrawled} chapter(s) scraped
        </div>
        <div className={`h-2 ${trackBg} rounded-full overflow-hidden`}>
          <div className="h-full bg-emerald-500 rounded-full transition-all duration-500" style={{ width: '100%' }} />
        </div>
      </div>
    );
  }

  if (status === 'failed') {
    return (
      <div className="space-y-1">
        <div className={`flex items-center gap-2 text-sm font-medium ${isDark ? 'text-red-400' : 'text-red-600'}`}>
          <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 14l2-2m0 0l2-2m-2 2l-2-2m2 2l2 2m7-2a9 9 0 11-18 0 9 9 0 0118 0z" />
          </svg>
          Crawl failed
        </div>
        <div className={`h-2 ${trackBg} rounded-full overflow-hidden`}>
          <div className={`h-full rounded-full ${isDark ? 'bg-red-500' : 'bg-red-500'}`} style={{ width: `${pctStr}%` }} />
        </div>
      </div>
    );
  }

  if (status === 'cancelled') {
    return (
      <div className="space-y-1">
        <div className={`flex items-center gap-2 text-sm font-medium ${isDark ? 'text-amber-400' : 'text-amber-600'}`}>
          <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 10a1 1 0 011-1h4a1 1 0 011 1v4a1 1 0 01-1 1h-4a1 1 0 01-1-1v-4z" />
          </svg>
          Crawl cancelled — {chaptersCrawled} chapter(s) scraped
        </div>
        <div className={`h-2 ${trackBg} rounded-full overflow-hidden`}>
          <div className={`h-full rounded-full ${isDark ? 'bg-amber-500' : 'bg-amber-500'}`} style={{ width: `${pctStr}%` }} />
        </div>
      </div>
    );
  }

  // Running or idle
  return (
    <div className="space-y-1">
      <div className="flex items-center justify-between text-sm">
        <span className={isDark ? 'text-slate-300' : 'text-gray-700'}>
          Chapter {chaptersCrawled}
          {chaptersTotal > 0 ? ` / ${chaptersTotal}` : ''}
        </span>
        <span className={isDark ? 'text-slate-500' : 'text-gray-500'}>{pctStr}%</span>
      </div>
      <div className={`h-2.5 ${trackBg} rounded-full overflow-hidden`}>
        <div
          className="h-full bg-indigo-500 rounded-full transition-all duration-300"
          style={{ width: `${pctStr}%` }}
        />
      </div>
      {currentTitle && (
        <p className={`text-xs truncate ${isDark ? 'text-slate-400' : 'text-gray-500'}`}>
          Now: <span className={isDark ? 'text-indigo-300' : 'text-indigo-600'}>{currentTitle}</span>
        </p>
      )}
    </div>
  );
}
