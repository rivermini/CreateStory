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
  info:    'text-white/55',
  debug:   'text-white/30',
};

const levelStylesLight: Record<string, string> = {
  error:   'text-red-600',
  warning: 'text-amber-600',
  info:    'text-black/65',
  debug:   'text-black/30',
};

export function CrawlLog({ lines, maxLines = 200, isDark = true }: CrawlLogProps) {
  const bottomRef = useRef<HTMLDivElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const [userScrolledUp, setUserScrolledUp] = useState(false);

  useEffect(() => {
    if (!userScrolledUp) {
      bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
    }
  }, [lines, userScrolledUp]);

  const handleScroll = () => {
    const el = containerRef.current;
    if (!el) return;
    const atBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 40;
    setUserScrolledUp(!atBottom);
  };

  const displayLines = lines.slice(-maxLines);
  const levelStyles = isDark ? levelStylesDark : levelStylesLight;

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <h3 className={`text-sm font-semibold ${isDark ? 'text-white/65' : 'text-black/65'}`}>Crawl Log</h3>
        <span className="lg-chip" style={{ background: 'rgba(255,255,255,0.06)', borderColor: 'rgba(255,255,255,0.08)', color: isDark ? 'rgba(255,255,255,0.3)' : 'rgba(0,0,0,0.3)' }}>
          {displayLines.length} lines
        </span>
      </div>
      <div
        ref={containerRef}
        onScroll={handleScroll}
        className="lg-log-container"
        style={{ maxHeight: 'min(400px, 40vh)' }}
      >
        {displayLines.length === 0 ? (
          <p className={`text-sm italic ${isDark ? 'text-white/30' : 'text-black/30'}`}>Waiting for output...</p>
        ) : (
          displayLines.map((entry, idx) => (
            <div key={idx} className={`font-mono text-xs leading-relaxed ${levelStyles[entry.level] ?? levelStyles.info}`}>
              <span className={isDark ? 'text-white/15' : 'text-black/15'}>[{entry.timestamp}]</span>{' '}
              <span>{entry.message}</span>
            </div>
          ))
        )}
        <div ref={bottomRef} />
      </div>
    </div>
  );
}
