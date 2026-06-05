import { useMemo, useRef, useState } from 'react';
import type { ChapterEntry, NovelMetadata } from '../api/client';
import { formatNumber } from '../api/client';
import { Icon, appIcons } from './Icon';

export interface NovelInfoPanelProps {
  storyTitle: string | null;
  siteName: string | null;
  chapters: ChapterEntry[];
  chapterCount: number;
  totalChapterCount: number | null;
  isLoading: boolean;
  isDetecting: boolean;
  error: string;
  warning: string | null;
  isChapterUrl: boolean;
  novelMetadata: NovelMetadata | null | undefined;
  onCrawlNovel: (toChapter: number) => void;
  isDark?: boolean;
  isResolvingTotal?: boolean;
}

export function NovelInfoPanel({
  storyTitle,
  siteName,
  chapters,
  chapterCount,
  totalChapterCount,
  isLoading,
  isDetecting,
  error,
  warning,
  isChapterUrl,
  novelMetadata,
  onCrawlNovel,
  isDark = true,
  isResolvingTotal = false,
}: NovelInfoPanelProps) {
  const tocRef = useRef<HTMLDivElement>(null);
  const [descExpanded, setDescExpanded] = useState(false);

  if (isChapterUrl) return null;

  if (isLoading || isDetecting) {
    return <NovelInfoPanelSkeleton isDetecting={isDetecting} isDark={isDark} />;
  }

  if (error) {
    return (
      <div className="lg-glass-card p-5 space-y-3">
        <div className={`flex items-center gap-2 ${isDark ? 'text-red-400' : 'text-red-600'}`}>
          <Icon icon={appIcons.info} className="w-4 h-4 flex-shrink-0" />
          <span className="text-sm font-medium">Could not load chapters</span>
        </div>
        <p className={`text-xs pl-6 ${isDark ? 'text-white/35' : 'text-black/35'}`}>{error}</p>
      </div>
    );
  }

  const isPaywalled = novelMetadata?.is_paywalled === true;
  const displayedTotal = totalChapterCount != null
    ? totalChapterCount
    : chapters.length > 0 ? Math.max(...chapters.map(c => c.chapter_number)) : 0;
  const estimatedMax = totalChapterCount ?? displayedTotal;
  const showPartial = totalChapterCount != null && chapterCount < totalChapterCount;
  const panelTitle = novelMetadata?.title || storyTitle || 'Novel Info';
  const showSpinner = showPartial || isResolvingTotal;
  const debugEntries = useMemo(() => {
    if (!novelMetadata) return [];

    return Object.entries(novelMetadata).filter(([, value]) => {
      if (value == null) return false;
      if (typeof value === 'string') return value.trim().length > 0;
      if (Array.isArray(value)) return value.length > 0;
      return true;
    });
  }, [novelMetadata]);

  return (
    <div className="lg-glass-card flex flex-col overflow-hidden" style={{ maxHeight: 'calc(100vh - 6rem)' }}>
      {/* DEBUG */}
      {import.meta.env.DEV && novelMetadata && (
        <details className={`border-b shrink-0 ${isDark ? 'border-white/6 bg-white/[0.02]' : 'border-black/6 bg-black/[0.02]'}`}>
          <summary className={`px-4 py-2 flex items-center justify-between gap-3 cursor-pointer select-none list-none ${isDark ? 'text-white/45' : 'text-black/45'}`}>
            <span className="text-[11px] font-medium tracking-wide uppercase">Debug metadata</span>
            <span className={`text-[10px] ${isDark ? 'text-white/30' : 'text-black/30'}`}>{debugEntries.length} fields</span>
          </summary>
          <div className="px-4 pb-3 space-y-3">
            {debugEntries.length > 0 && (
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                {debugEntries.map(([key, value]) => (
                  <div
                    key={key}
                    className={`rounded-xl border px-3 py-2 ${isDark ? 'border-white/8 bg-white/[0.03]' : 'border-black/8 bg-black/[0.03]'}`}
                  >
                    <p className={`text-[10px] uppercase tracking-wide mb-1 ${isDark ? 'text-white/30' : 'text-black/30'}`}>
                      {key}
                    </p>
                    <p className={`text-[11px] break-words ${isDark ? 'text-white/65' : 'text-black/65'}`}>
                      {formatDebugValue(value)}
                    </p>
                  </div>
                ))}
              </div>
            )}
            <pre className={`rounded-xl border px-3 py-3 text-[10px] overflow-auto max-h-40 ${isDark ? 'border-white/8 bg-black/20 text-white/35' : 'border-black/8 bg-black/[0.03] text-black/45'}`}>
              {JSON.stringify(novelMetadata, null, 2)}
            </pre>
          </div>
        </details>
      )}

      {/* ── Header ─────────────────────────────────────────────── */}
      <div className={`px-4 sm:px-5 py-4 space-y-3 shrink-0 ${isDark ? 'border-b border-white/6' : 'border-b border-black/6'}`}>

        {/* Title row + chapter badge */}
        <div className="flex items-start gap-3">
          <CoverImage url={novelMetadata?.cover_url} title={panelTitle} isDark={isDark} />
          <div className="flex-1 min-w-0">
            <h3
              className={`text-sm font-semibold leading-snug ${isDark ? 'text-white/85' : 'text-black/85'}`}
              title={panelTitle}
            >
              {panelTitle}
            </h3>
            {novelMetadata?.author_fullname && (
              <p className={`text-xs mt-0.5 truncate ${isDark ? 'text-white/45' : 'text-black/45'}`}>
                by {novelMetadata.author_fullname}
              </p>
            )}
            {novelMetadata?.author && !novelMetadata.author_fullname && (
              <p className={`text-xs mt-0.5 ${isDark ? 'text-white/35' : 'text-black/35'}`}>@{novelMetadata.author}</p>
            )}
            {!novelMetadata?.author_fullname && !novelMetadata?.author && siteName && (
              <p className={`text-xs mt-0.5 ${isDark ? 'text-white/35' : 'text-black/35'}`}>{siteName}</p>
            )}
            {novelMetadata?.season_current != null && (
              <p className={`text-xs mt-0.5 ${isDark ? 'text-indigo-400' : 'text-indigo-600'}`}>
                Season {novelMetadata.season_current}
                {novelMetadata.season_total != null && ` of ${novelMetadata.season_total}`}
              </p>
            )}
          </div>
          {displayedTotal > 0 && (
            <div className="flex-shrink-0 text-right">
              <div className="lg-glass px-3 py-1.5" style={{ border: `1px solid ${isDark ? 'rgba(99,102,241,0.3)' : 'rgba(99,102,241,0.3)'}`, background: isDark ? 'rgba(99,102,241,0.12)' : 'rgba(99,102,241,0.06)' }}>
                <p className={`text-sm font-bold leading-none flex items-center justify-end gap-1.5 ${isDark ? 'text-indigo-300' : 'text-indigo-700'}`}>
                  {showPartial
                    ? `${chapterCount} / ${totalChapterCount?.toLocaleString()}`
                    : displayedTotal.toLocaleString()}
                  {showSpinner && (
                    <Icon icon={appIcons.spinner} className="inline-block w-3 h-3 animate-spin" />
                  )}
                </p>
                <p className={`text-[10px] mt-0.5 leading-none ${isDark ? 'text-indigo-400/70' : 'text-indigo-500/70'}`}>chapters</p>
              </div>
            </div>
          )}
        </div>

        {/* Stats row */}
        {(novelMetadata?.views != null || novelMetadata?.stars != null || novelMetadata?.comment_count != null || displayedTotal > 0) && (
          <div className={`flex flex-wrap items-center gap-x-4 gap-y-1 text-xs ${isDark ? 'text-white/45' : 'text-black/45'}`}>
            {novelMetadata?.views != null && (
              <span className="flex items-center gap-1">
                <EyeIcon isDark={isDark} />
                {formatNumber(novelMetadata.views)}
              </span>
            )}
            {novelMetadata?.stars != null && (
              <span className="flex items-center gap-1">
                <StarIcon isDark={isDark} />
                {formatNumber(novelMetadata.stars)}
              </span>
            )}
            {novelMetadata?.comment_count != null && (
              <span className="flex items-center gap-1">
                <CommentIcon isDark={isDark} />
                {formatNumber(novelMetadata.comment_count)}
              </span>
            )}
            {displayedTotal > 0 && (
              <span className="flex items-center gap-1">
                <BookIcon isDark={isDark} />
                {displayedTotal.toLocaleString()} parts
              </span>
            )}
          </div>
        )}

        {/* Status badges */}
        {(novelMetadata?.completed != null || novelMetadata?.mature === true) && (
          <div className="flex flex-wrap gap-2">
            {novelMetadata.completed === true && (
              <BadgeCompleted />
            )}
            {novelMetadata.completed === false && (
              <BadgeOngoing />
            )}
            {novelMetadata.mature === true && (
              <BadgeMature />
            )}
          </div>
        )}

        {/* Description */}
        {novelMetadata?.description && (
          <DescriptionBlock
            text={novelMetadata.description}
            expanded={descExpanded}
            onToggle={() => setDescExpanded(v => !v)}
            isDark={isDark}
          />
        )}

        {/* Tags */}
        {novelMetadata?.tags && novelMetadata.tags.length > 0 && (
          <div className="flex flex-wrap gap-1.5">
            {novelMetadata.tags.slice(0, 12).map(tag => (
              <span
                key={tag}
                className={`lg-chip ${isDark ? 'lg-chip-neutral' : ''}`}
                style={isDark ? { background: 'rgba(255,255,255,0.06)', borderColor: 'rgba(255,255,255,0.1)', color: 'rgba(255,255,255,0.5)' } : { background: 'rgba(0,0,0,0.05)', borderColor: 'rgba(0,0,0,0.1)', color: 'rgba(0,0,0,0.6)' }}
              >
                {tag}
              </span>
            ))}
            {novelMetadata.tags.length > 12 && (
              <span className={`lg-chip ${isDark ? 'lg-chip-neutral' : ''}`} style={isDark ? { background: 'rgba(255,255,255,0.04)', borderColor: 'rgba(255,255,255,0.08)', color: 'rgba(255,255,255,0.35)' } : { background: 'rgba(0,0,0,0.04)', borderColor: 'rgba(0,0,0,0.08)', color: 'rgba(0,0,0,0.35)' }}>
                +{novelMetadata.tags.length - 12} more
              </span>
            )}
          </div>
        )}

        {/* Total chapters banner */}
        {totalChapterCount != null && (
          <div className="lg-glass px-3 py-2 flex items-center gap-2" style={{ border: `1px solid ${isDark ? 'rgba(99,102,241,0.3)' : 'rgba(99,102,241,0.3)'}`, background: isDark ? 'rgba(99,102,241,0.1)' : 'rgba(99,102,241,0.05)' }}>
            <Icon icon={appIcons.book} className={`w-4 h-4 flex-shrink-0 ${isDark ? 'text-indigo-400' : 'text-indigo-600'}`} />
            <span className={`text-xs ${isDark ? 'text-indigo-300' : 'text-indigo-700'}`}>
              This novel has <span className="font-semibold">{totalChapterCount.toLocaleString()} chapters</span>
              {showPartial && <> — showing first {chapterCount}</>}
            </span>
          </div>
        )}

        {warning && <p className={`text-xs ${isDark ? 'text-amber-400' : 'text-amber-600'}`}>{warning}</p>}
      </div>

      {/* ── Wattpad Original block ─────────────────────────────── */}
      {isPaywalled && (
        <div className={`px-4 py-3 shrink-0 ${isDark ? 'border-b border-white/6' : 'border-b border-black/6'}`}>
          <div className="lg-glass p-4" style={{ border: '1px solid rgba(251,191,36,0.25)', background: isDark ? 'rgba(251,191,36,0.08)' : 'rgba(251,191,36,0.05)' }}>
            <div className={`flex items-center gap-2 font-semibold text-sm ${isDark ? 'text-amber-400' : 'text-amber-700'}`}>
              <LockIcon />
              Wattpad Original
            </div>
            <p className={`text-xs leading-relaxed mt-2 ${isDark ? 'text-amber-200/70' : 'text-amber-800/70'}`}>
              This story contains chapters locked behind Wattpad coins.
              Crawling is disabled to respect author monetization and Wattpad's terms of service.
            </p>
            <p className={`text-xs mt-2 flex items-center gap-1 ${isDark ? 'text-amber-300/60' : 'text-amber-700/60'}`}>
              <InfoIcon />
              Free chapters may be available on other sources.
            </p>
          </div>
        </div>
      )}

      {/* ── TOC ───────────────────────────────────────────────── */}
      <div className="flex-1 overflow-y-auto min-h-0 min-h-[200px]" ref={tocRef}>
        {chapters.length === 0 ? (
          <div className={`flex items-center gap-2 p-5 text-sm ${isDark ? 'text-white/35' : 'text-black/35'}`}>
            <Icon icon={appIcons.file} className="w-4 h-4" />
            No chapters found
          </div>
        ) : (
          <table className="w-full text-sm">
            <thead className={`sticky top-0 border-b ${isDark ? 'bg-slate-950 border-white/6' : 'bg-white border-black/6'}`}>
              <tr>
                <th className={`px-4 py-2.5 text-left text-xs font-semibold uppercase tracking-wider w-12 ${isDark ? 'text-white/35' : 'text-black/35'}`}>#</th>
                <th className={`px-4 py-2.5 text-left text-xs font-semibold uppercase tracking-wider ${isDark ? 'text-white/35' : 'text-black/35'}`}>Chapter Title</th>
              </tr>
            </thead>
            <tbody className={`divide-y ${isDark ? 'divide-white/6' : 'divide-black/6'}`}>
              {chapters.map(chapter => (
                <ChapterRow key={chapter.url} chapter={chapter} isDark={isDark} />
              ))}
            </tbody>
          </table>
        )}
      </div>

      {/* ── Footer CTA ─────────────────────────────────────────── */}
      <div className={`px-4 sm:px-5 py-4 shrink-0 space-y-3 ${isDark ? 'border-t border-white/6' : 'border-t border-black/6'}`}>
        {estimatedMax > 0 && (
          <p className={`text-xs text-center ${isDark ? 'text-white/35' : 'text-black/35'}`}>
            Range: 1 &ndash; {estimatedMax.toLocaleString()}
          </p>
        )}
        {isPaywalled ? (
          <p className={`text-xs text-center ${isDark ? 'text-amber-400' : 'text-amber-600'}`}>
            Crawling unavailable for Wattpad Originals
          </p>
        ) : (
          <div className="flex flex-col gap-3">
            <div className="flex items-center gap-2 px-1">
              <span className={`text-xs ${isDark ? 'text-white/45' : 'text-black/45'}`}>Format:</span>
              <span className="lg-btn-primary text-xs font-semibold rounded-lg" style={{ padding: '3px 10px' }}>MD</span>
            </div>
            <button
              onClick={() => {
                onCrawlNovel(estimatedMax > 0 ? estimatedMax : totalChapterCount ?? chapterCount);
              }}
              disabled={estimatedMax === 0 && totalChapterCount == null}
              className={estimatedMax === 0 && totalChapterCount == null
                ? 'lg-btn-ghost w-full opacity-50 cursor-not-allowed'
                : 'lg-btn-primary w-full'}
              style={{ padding: '10px 16px', fontSize: '0.875rem', justifyContent: 'center', display: 'flex', alignItems: 'center', gap: '8px', fontWeight: 600, borderRadius: '14px', border: 'none' }}
            >
              <Icon icon={appIcons.trends} className="w-4 h-4" />
              Crawl All Chapters
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

// ─── Sub-components ──────────────────────────────────────────────────────────

function CoverImage({ url, title, isDark }: { url?: string; title: string; isDark: boolean }) {
  const [failed, setFailed] = useState(false);
  if (!url || failed) {
    return (
      <div className="lg-glass w-16 h-20 rounded-xl flex items-center justify-center flex-shrink-0" style={{ border: `1px solid ${isDark ? 'rgba(255,255,255,0.08)' : 'rgba(0,0,0,0.08)'}` }}>
        <span className="text-2xl">&#128214;</span>
      </div>
    );
  }
  return (
    <img
      src={url}
      alt={`Cover for ${title}`}
      loading="lazy"
      onError={() => setFailed(true)}
      className="w-16 h-20 rounded-xl object-cover flex-shrink-0"
      style={{ border: `1px solid ${isDark ? 'rgba(255,255,255,0.06)' : 'rgba(0,0,0,0.06)'}` }}
    />
  );
}

function DescriptionBlock({ text, expanded, onToggle, isDark }: { text: string; expanded: boolean; onToggle: () => void; isDark: boolean }) {
  const [tooLong] = useState(text.length > 200);
  return (
    <div>
      <p className={`text-xs leading-relaxed ${expanded ? '' : 'line-clamp-2'} ${isDark ? 'text-white/45' : 'text-black/45'}`}>
        {text}
      </p>
      {tooLong && (
        <button
          onClick={onToggle}
          className={`text-xs cursor-pointer mt-1 ${isDark ? 'text-indigo-400 hover:underline' : 'text-indigo-600 hover:underline'}`}
        >
          {expanded ? 'Show less' : 'Show more'}
        </button>
      )}
    </div>
  );
}

function ChapterRow({ chapter, isDark }: { chapter: ChapterEntry; isDark: boolean }) {
  return (
    <tr className={`transition-colors ${isDark ? 'hover:bg-white/5' : 'hover:bg-black/4'}`}>
      <td className={`px-4 py-2.5 text-xs font-mono whitespace-nowrap align-top ${isDark ? 'text-white/35' : 'text-black/35'}`}>
        {chapter.chapter_number}
      </td>
      <td className={`px-4 py-2.5 text-xs leading-relaxed align-top ${isDark ? 'text-white/65' : 'text-black/65'}`}>
        <span className="block truncate" title={chapter.title}>
          {chapter.title || <em className={`not-italic ${isDark ? 'text-white/35' : 'text-black/35'}`}>Untitled</em>}
        </span>
      </td>
    </tr>
  );
}

function formatDebugValue(value: unknown): string {
  if (Array.isArray(value)) {
    return value.join(', ');
  }

  if (typeof value === 'object' && value !== null) {
    return JSON.stringify(value);
  }

  return String(value);
}

function BadgeCompleted() {
  return (
    <span className="lg-chip lg-chip-green">
      <Icon icon={appIcons.check} className="w-3 h-3" />
      Completed
    </span>
  );
}

function BadgeOngoing() {
  return (
    <span className="lg-chip lg-chip-amber">Ongoing</span>
  );
}

function BadgeMature() {
  return (
    <span className="lg-chip lg-chip-red">18+</span>
  );
}

// ─── Icons ─────────────────────────────────────────────────────────────────

function EyeIcon({ isDark }: { isDark: boolean }) {
  return <Icon icon={appIcons.eye} className={`w-3.5 h-3.5 ${isDark ? 'text-white/35' : 'text-black/35'}`} />;
}

function StarIcon({ isDark }: { isDark: boolean }) {
  return <Icon icon={appIcons.checkCircle} className={`w-3.5 h-3.5 ${isDark ? 'text-white/35' : 'text-black/35'}`} />;
}

function BookIcon({ isDark }: { isDark: boolean }) {
  return <Icon icon={appIcons.bookOpen} className={`w-3.5 h-3.5 ${isDark ? 'text-white/35' : 'text-black/35'}`} />;
}

function LockIcon() {
  return <Icon icon={appIcons.paywall} className="w-4 h-4" />;
}

function CommentIcon({ isDark }: { isDark: boolean }) {
  return <Icon icon={appIcons.comment} className={`w-3.5 h-3.5 ${isDark ? 'text-white/35' : 'text-black/35'}`} />;
}

function InfoIcon() {
  return <Icon icon={appIcons.info} className="w-3.5 h-3.5" />;
}

// ─── Skeleton ──────────────────────────────────────────────────────────────

function NovelInfoPanelSkeleton({ isDetecting, isDark }: { isDetecting: boolean; isDark: boolean }) {
  const shimmer = isDark ? 'bg-white/8' : 'bg-black/8';
  return (
    <div className="lg-glass-card overflow-hidden">
      <div className={`px-4 py-4 space-y-3 border-b ${isDark ? 'border-white/6' : 'border-black/6'}`}>
        <div className="flex items-start gap-3">
          <div className={`w-16 h-20 rounded-xl ${shimmer} animate-pulse`} />
          <div className="flex-1 space-y-2 pt-1">
            <div className={`h-4 ${shimmer} rounded w-3/4 animate-pulse`} />
            <div className={`h-3 ${shimmer} rounded w-1/3 animate-pulse`} />
          </div>
        </div>
      </div>
      <div className="px-4 py-5 space-y-4">
        <div className="flex items-start gap-3">
          <div className="flex flex-col items-center">
            <div className="w-7 h-7 rounded-full bg-emerald-600 flex items-center justify-center flex-shrink-0">
              <Icon icon={appIcons.check} className="w-4 h-4 text-white" />
            </div>
          </div>
          <div className="flex-1 pt-0.5">
            <p className={`text-xs font-medium ${isDark ? 'text-emerald-400' : 'text-emerald-600'}`}>Site detected</p>
            <p className={`text-[11px] mt-0.5 ${isDark ? 'text-white/35' : 'text-black/35'}`}>URL is valid</p>
          </div>
        </div>
        <div className="flex items-start gap-3">
          <div className="flex flex-col items-center">
            <div className="w-7 h-7 rounded-full bg-indigo-600 flex items-center justify-center flex-shrink-0">
              <Icon icon={appIcons.spinner} className="animate-spin w-4 h-4 text-white" />
            </div>
          </div>
          <div className="flex-1 pt-0.5">
            <p className={`text-xs font-medium ${isDark ? 'text-indigo-300' : 'text-indigo-700'}`}>
              {isDetecting ? 'Detecting site...' : 'Fetching chapters...'}
            </p>
            <p className={`text-[11px] mt-0.5 ${isDark ? 'text-white/35' : 'text-black/35'}`}>
              {isDetecting ? 'Checking URL...' : 'This may take up to 20 seconds'}
            </p>
          </div>
        </div>
      </div>
      <div className="px-4 pb-5 space-y-2">
        {Array.from({ length: 8 }).map((_, i) => (
          <div key={i} className="flex items-center gap-3 animate-pulse">
            <div className={`w-8 h-3 ${shimmer} rounded flex-shrink-0`} />
            <div className={`h-3 ${shimmer} rounded ${i % 3 === 0 ? 'w-full' : i % 3 === 1 ? 'w-11/12' : 'w-10/12'}`} />
          </div>
        ))}
      </div>
    </div>
  );
}
