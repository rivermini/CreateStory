export type InkittLogTone =
  | 'error'
  | 'warning'
  | 'success'
  | 'progress'
  | 'fallback'
  | 'discovery'
  | 'system'
  | 'neutral';

export function getInkittLogTone(line: string): InkittLogTone {
  const lower = line.toLowerCase();
  if (/\b(429|403|failed|failure|error|exception|blocked)\b/.test(lower)) return 'error';
  if (/\b(pause|paused|restart|retry|page cap|rate)\b/.test(lower)) return 'warning';
  if (/\b(rendered fallback|fallback)\b/.test(lower)) return 'fallback';
  if (/\b(discovery|discover|scanning page|api rows|candidate)\b/.test(lower)) return 'discovery';
  if (/\b(crawled \d+\/\d+|started crawl run|chapter\(s\))\b/.test(lower)) return 'progress';
  if (/\b(completed|finished|exported|download|skipped \d+ story)\b/.test(lower)) return 'success';
  if (/\b(system catalog|catalog updated|started inkitt)\b/.test(lower)) return 'system';
  return 'neutral';
}

export function splitInkittLogLine(line: string): { time: string; message: string } {
  const match = /^(\d{2}:\d{2}:\d{2})\s+(.*)$/.exec(line);
  if (!match) return { time: '', message: line };
  return { time: match[1], message: match[2] };
}

export function inkittLogToneClass(tone: InkittLogTone): string {
  switch (tone) {
    case 'error':
      return 'border-red-500/70 bg-red-500/10 text-red-700 dark:text-red-200';
    case 'warning':
      return 'border-amber-400/70 bg-amber-400/10 text-amber-800 dark:text-amber-100';
    case 'success':
      return 'border-emerald-400/70 bg-emerald-400/10 text-emerald-700 dark:text-emerald-100';
    case 'progress':
      return 'border-sky-400/70 bg-sky-400/10 text-sky-700 dark:text-sky-100';
    case 'fallback':
      return 'border-orange-400/70 bg-orange-400/10 text-orange-700 dark:text-orange-100';
    case 'discovery':
      return 'border-violet-400/70 bg-violet-400/10 text-violet-700 dark:text-violet-100';
    case 'system':
      return 'border-cyan-400/70 bg-cyan-400/10 text-cyan-700 dark:text-cyan-100';
    default:
      return 'border-transparent text-[color:var(--cs-text-soft)]';
  }
}
