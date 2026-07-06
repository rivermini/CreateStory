import { useEffect, useRef, useState } from 'react';
import type { LogEntry } from '../../hooks/useCrawlStream';

export interface CrawlLogProps {
  readonly lines: LogEntry[];
  readonly maxLines?: number;
  readonly isDark?: boolean;
}

const levelColorsDark: Record<string, { color: string; bg: string }> = {
  error: { color: '#fca5a5', bg: 'rgba(239,68,68,0.08)' },
  warning: { color: '#fcd34d', bg: 'rgba(245,158,11,0.08)' },
  info: { color: '#93c5fd', bg: 'rgba(59,130,246,0.06)' },
  debug: { color: 'rgba(255,255,255,0.34)', bg: 'rgba(255,255,255,0.015)' },
};

const levelColorsLight: Record<string, { color: string; bg: string }> = {
  error: { color: '#dc2626', bg: 'rgba(220,38,38,0.07)' },
  warning: { color: '#d97706', bg: 'rgba(217,119,6,0.07)' },
  info: { color: '#2563eb', bg: 'rgba(37,99,235,0.06)' },
  debug: { color: 'rgba(55,53,47,0.42)', bg: 'rgba(55,53,47,0.03)' },
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
    const element = containerRef.current;
    if (!element) return;
    const atBottom = element.scrollHeight - element.scrollTop - element.clientHeight < 40;
    setUserScrolledUp(!atBottom);
  };

  const displayLines = lines.slice(-maxLines);
  const levelColors = isDark ? levelColorsDark : levelColorsLight;
  const panelBorder = isDark ? 'rgba(255,255,255,0.08)' : 'rgba(55,53,47,0.12)';
  const logBackground = isDark ? 'rgba(255,255,255,0.03)' : 'rgba(55,53,47,0.03)';
  const secondaryText = isDark ? 'rgba(255,255,255,0.5)' : 'rgba(55,53,47,0.62)';
  const tertiaryText = isDark ? 'rgba(255,255,255,0.34)' : 'rgba(55,53,47,0.42)';

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between">
        <h3 className="text-xs font-semibold uppercase tracking-[0.14em]" style={{ color: secondaryText }}>Crawl Log</h3>
        <span className="rounded-md border px-2 py-0.5 text-[11px]" style={{ background: isDark ? 'rgba(255,255,255,0.04)' : 'rgba(55,53,47,0.04)', borderColor: panelBorder, color: tertiaryText }}>
          {displayLines.length} lines
        </span>
      </div>
      <div
        ref={containerRef}
        onScroll={handleScroll}
        className="overflow-y-auto rounded-xl border p-3"
        style={{
          maxHeight: 'min(400px, 40vh)',
          background: logBackground,
          borderColor: panelBorder,
          boxShadow: `inset 0 1px 0 ${isDark ? 'rgba(255,255,255,0.03)' : 'rgba(255,255,255,0.6)'}`,
        }}
      >
        {displayLines.length === 0 ? (
          <p className="text-sm italic" style={{ color: tertiaryText }}>Waiting for output...</p>
        ) : (
          <div className="space-y-1">
            {displayLines.map((entry, index) => {
              const lc = levelColors[entry.level] ?? levelColors.info;
              return (
                <div
                  key={`${entry.timestamp}-${index}`}
                  className="rounded-md px-2 py-1 font-mono text-[11px] leading-relaxed"
                  style={{ background: lc.bg, color: lc.color }}
                >
                  <span style={{ color: tertiaryText }}>[{entry.timestamp}]</span>{' '}
                  {entry.message}
                </div>
              );
            })}
          </div>
        )}
        <div ref={bottomRef} />
      </div>
    </div>
  );
}
