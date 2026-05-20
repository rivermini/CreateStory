export interface ProgressBarProps {
  chaptersCrawled: number;
  chaptersTotal: number;
  currentTitle: string;
  status: string;
}

export function ProgressBar({ chaptersCrawled, chaptersTotal, currentTitle, status }: ProgressBarProps) {
  const pct = chaptersTotal > 0 ? Math.min(chaptersCrawled / chaptersTotal, 1) : 0;
  const pctStr = (pct * 100).toFixed(0);

  if (status === 'completed') {
    return (
      <div className="space-y-1">
        <div className="flex items-center gap-2 text-emerald-400 text-sm font-medium">
          <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
          </svg>
          Crawl complete — {chaptersCrawled} chapter(s) scraped
        </div>
        <div className="h-2 bg-slate-800 rounded-full overflow-hidden">
          <div className="h-full bg-emerald-500 rounded-full transition-all duration-500" style={{ width: '100%' }} />
        </div>
      </div>
    );
  }

  if (status === 'failed') {
    return (
      <div className="space-y-1">
        <div className="flex items-center gap-2 text-red-400 text-sm font-medium">
          <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 14l2-2m0 0l2-2m-2 2l-2-2m2 2l2 2m7-2a9 9 0 11-18 0 9 9 0 0118 0z" />
          </svg>
          Crawl failed
        </div>
        <div className="h-2 bg-slate-800 rounded-full overflow-hidden">
          <div className="h-full bg-red-500 rounded-full" style={{ width: `${pctStr}%` }} />
        </div>
      </div>
    );
  }

  if (status === 'cancelled') {
    return (
      <div className="space-y-1">
        <div className="flex items-center gap-2 text-amber-400 text-sm font-medium">
          <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 10a1 1 0 011-1h4a1 1 0 011 1v4a1 1 0 01-1 1h-4a1 1 0 01-1-1v-4z" />
          </svg>
          Crawl cancelled — {chaptersCrawled} chapter(s) scraped
        </div>
        <div className="h-2 bg-slate-800 rounded-full overflow-hidden">
          <div className="h-full bg-amber-500 rounded-full" style={{ width: `${pctStr}%` }} />
        </div>
      </div>
    );
  }

  // Running or idle
  return (
    <div className="space-y-1">
      <div className="flex items-center justify-between text-sm">
        <span className="text-slate-300">
          Chapter {chaptersCrawled}
          {chaptersTotal > 0 ? ` / ${chaptersTotal}` : ''}
        </span>
        <span className="text-slate-500">{pctStr}%</span>
      </div>
      <div className="h-2.5 bg-slate-800 rounded-full overflow-hidden">
        <div
          className="h-full bg-indigo-500 rounded-full transition-all duration-300"
          style={{ width: `${pctStr}%` }}
        />
      </div>
      {currentTitle && (
        <p className="text-xs text-slate-400 truncate">
          Now: <span className="text-indigo-300">{currentTitle}</span>
        </p>
      )}
    </div>
  );
}
