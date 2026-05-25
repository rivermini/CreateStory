import { useEffect, useRef, useState } from 'react';
import type { LogEntry } from '../hooks/useCrawlStream';

export interface CrawlLogProps {
  lines: LogEntry[];
  maxLines?: number;
  isDark?: boolean;
}

const levelStylesDark: Record<string, string> = {
  error:   'text-red-400',
  warning: 'text-amber-400',
  info:    'text-slate-300',
  debug:   'text-slate-500',
};

const levelStylesLight: Record<string, string> = {
  error:   'text-red-600',
  warning: 'text-amber-600',
  info:    'text-gray-700',
  debug:   'text-gray-400',
};

export function CrawlLog({ lines, maxLines = 200, isDark = true }: CrawlLogProps) {
  const bottomRef = useRef<HTMLDivElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  // Track whether the user has manually scrolled away from the bottom.
  // When true, stop auto-scrolling so reading position is preserved.
  const [userScrolledUp, setUserScrolledUp] = useState(false);

  useEffect(() => {
    if (!userScrolledUp) {
      bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
    }
  }, [lines, userScrolledUp]);

  const handleScroll = () => {
    const el = containerRef.current;
    if (!el) return;
    // Snap to bottom if within ~40px, otherwise flag that user scrolled up
    const atBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 40;
    setUserScrolledUp(!atBottom);
  };

  const displayLines = lines.slice(-maxLines);
  const levelStyles = isDark ? levelStylesDark : levelStylesLight;

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <h3 className={`text-sm font-semibold ${isDark ? 'text-slate-300' : 'text-gray-700'}`}>Crawl Log</h3>
        <span className={`text-xs px-2 py-1 rounded-lg ${isDark ? 'bg-slate-800/60 text-slate-500' : 'bg-gray-100 text-gray-500'}`}>
          {displayLines.length} lines
        </span>
      </div>
      <div
        ref={containerRef}
        onScroll={handleScroll}
        className={`border rounded-2xl p-4 overflow-y-auto ${isDark
          ? 'bg-slate-950 border-slate-800/60'
          : 'bg-gray-50 border-gray-200'
        }`}
        style={{ maxHeight: 'min(400px, 40vh)' }}
      >
        {displayLines.length === 0 ? (
          <p className={`text-sm italic ${isDark ? 'text-slate-500' : 'text-gray-400'}`}>Waiting for output...</p>
        ) : (
          displayLines.map((entry, idx) => (
            <div key={idx} className={`font-mono text-xs leading-relaxed ${levelStyles[entry.level] ?? levelStyles.info}`}>
              <span className={isDark ? 'text-slate-700' : 'text-gray-400'}>[{entry.timestamp}]</span>{' '}
              <span>{entry.message}</span>
            </div>
          ))
        )}
        <div ref={bottomRef} />
      </div>
    </div>
  );
}
