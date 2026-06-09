import { useEffect, useRef, useState } from 'react';
import type { LogEntry } from '../../hooks/useCrawlStream';

export interface CrawlLogProps {
  lines: LogEntry[];
  maxLines?: number;
  isDark?: boolean;
}

const levelStylesDark: Record<string, string> = {
  error: 'rgba(255,255,255,0.78)',
  warning: 'rgba(255,255,255,0.62)',
  info: 'rgba(255,255,255,0.62)',
  debug: 'rgba(255,255,255,0.34)',
};

const levelStylesLight: Record<string, string> = {
  error: 'rgba(17,17,17,0.78)',
  warning: 'rgba(17,17,17,0.62)',
  info: 'rgba(55,53,47,0.72)',
  debug: 'rgba(55,53,47,0.42)',
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
  const levelStyles = isDark ? levelStylesDark : levelStylesLight;
  const panelBorder = isDark ? 'rgba(255,255,255,0.08)' : 'rgba(55,53,47,0.12)';
  const panelBackground = isDark ? 'rgba(255,255,255,0.03)' : '#ffffff';
  const logBackground = isDark ? 'rgba(255,255,255,0.03)' : 'rgba(55,53,47,0.03)';
  const pageText = isDark ? 'rgba(255,255,255,0.72)' : 'rgba(55,53,47,0.72)';
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
            {displayLines.map((entry, index) => (
              <div
                key={index}
                className="rounded-md px-2 py-1 font-mono text-[11px] leading-relaxed"
                style={{ background: isDark ? 'rgba(255,255,255,0.025)' : panelBackground, color: levelStyles[entry.level] ?? levelStyles.info }}
              >
                <span style={{ color: tertiaryText }}>[{entry.timestamp}]</span>{' '}
                <span style={{ color: levelStyles[entry.level] ?? pageText }}>{entry.message}</span>
              </div>
            ))}
          </div>
        )}
        <div ref={bottomRef} />
      </div>
    </div>
  );
}
