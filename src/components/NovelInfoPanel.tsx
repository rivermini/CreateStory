import { useRef, useState } from 'react';
import type { ChapterEntry, NovelMetadata } from '../api/client';
import { formatNumber } from '../api/client';

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
          <svg className="w-4 h-4 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
          </svg>
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

  return (
    <div className="lg-glass-card flex flex-col overflow-hidden" style={{ maxHeight: 'calc(100vh - 6rem)' }}>
      {/* DEBUG */}
      {import.meta.env.DEV && novelMetadata && (
        <details className={`border-b shrink-0 ${isDark ? 'border-white/6' : 'border-black/6'}`}>
          <summary className={`px-4 py-1.5 text-[10px] cursor-pointer select-none hover:underline ${isDark ? 'text-white/30' : 'text-black/30'}`}>
            [DEBUG] Raw API metadata
          </summary>
          <pre className={`px-4 py-2 text-[10px] overflow-auto max-h-40 ${isDark ? 'text-white/30' : 'text-black/30'}`}>
            {JSON.stringify(novelMetadata, null, 2)}
          </pre>
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
                    <span className="inline-block w-3 h-3 border-2 rounded-full border-indigo-400 border-t-transparent animate-spin" />
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
            <svg className={`w-4 h-4 flex-shrink-0 ${isDark ? 'text-indigo-400' : 'text-indigo-600'}`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 11H5m14 0a2 2 0 012 2v6a2 2 0 01-2 2H5a2 2 0 01-2-2v-6a2 2 0 012-2m14 0V9a2 2 0 00-2-2M5 11V9a2 2 0 012-2m0 0V5a2 2 0 012-2h6a2 2 0 012 2v2M7 7h10" />
            </svg>
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
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2" />
            </svg>
            No chapters found
          </div>
        ) : (
          <table className="w-full text-sm">
            <thead className={`sticky top-0 ${isDark ? 'bg-black/30 border-b border-white/6' : 'bg-black/5 border-b border-black/6'}`}>
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
              <span className="lg-btn-primary text-xs font-semibold rounded-lg" style={{ padding: '3px 10px' }}>TXT</span>
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
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 10V3L4 14h7v7l9-11h-7z" />
              </svg>
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
      <td className={`px-4 py-2.5 text-xs font-mono whitespace-nowrap ${isDark ? 'text-white/35' : 'text-black/35'}`}>
        {chapter.chapter_number}
      </td>
      <td className={`px-4 py-2.5 text-xs leading-relaxed ${isDark ? 'text-white/65' : 'text-black/65'}`}>
        <span className="block truncate" title={chapter.title}>
          {chapter.title || <em className={`not-italic ${isDark ? 'text-white/35' : 'text-black/35'}`}>Untitled</em>}
        </span>
      </td>
    </tr>
  );
}

function BadgeCompleted() {
  return (
    <span className="lg-chip lg-chip-green">
      <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
      </svg>
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
  return (
    <svg className={`w-3.5 h-3.5 ${isDark ? 'text-white/35' : 'text-black/35'}`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z" />
    </svg>
  );
}

function StarIcon({ isDark }: { isDark: boolean }) {
  return (
    <svg className={`w-3.5 h-3.5 ${isDark ? 'text-white/35' : 'text-black/35'}`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11.049 2.927c.3-.921 1.603-.921 1.902 0l1.519 4.674a1 1 0 00.95.69h4.915c.969 0 1.371 1.24.588 1.81l-3.976 2.888a1 1 0 00-.363 1.118l1.518 4.674c.3.922-.755 1.688-1.538 1.118l-3.976-2.888a1 1 0 00-1.176 0l-3.976 2.888c-.783.57-1.838-.197-1.538-1.118l1.518-4.674a1 1 0 00-.363-1.118l-3.976-2.888c-.784-.57-.38-1.81.588-1.81h4.914a1 1 0 00.951-.69l1.519-4.674z" />
    </svg>
  );
}

function BookIcon({ isDark }: { isDark: boolean }) {
  return (
    <svg className={`w-3.5 h-3.5 ${isDark ? 'text-white/35' : 'text-black/35'}`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 6.253v13m0-13C10.832 5.477 9.246 5 7.5 5S4.168 5.477 3 6.253v13C4.168 18.477 5.754 18 7.5 18s3.332.477 4.5 1.253m0-13C13.168 5.477 14.754 5 16.5 5c1.747 0 3.332.477 4.5 1.253v13C19.832 18.477 18.247 18 16.5 18c-1.746 0-3.332.477-4.5 1.253" />
    </svg>
  );
}

function LockIcon() {
  return (
    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z" />
    </svg>
  );
}

function CommentIcon({ isDark }: { isDark: boolean }) {
  return (
    <svg className={`w-3.5 h-3.5 ${isDark ? 'text-white/35' : 'text-black/35'}`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z" />
    </svg>
  );
}

function InfoIcon() {
  return (
    <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
    </svg>
  );
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
              <svg className="w-4 h-4 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M5 13l4 4L19 7" />
              </svg>
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
              <svg className="animate-spin w-4 h-4 text-white" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
                <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
              </svg>
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
