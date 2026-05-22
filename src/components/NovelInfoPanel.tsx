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
}: NovelInfoPanelProps) {
  const tocRef = useRef<HTMLDivElement>(null);
  const [descExpanded, setDescExpanded] = useState(false);

  if (isChapterUrl) return null;

  if (isLoading || isDetecting) {
    return <NovelInfoPanelSkeleton isDetecting={isDetecting} isDark={isDark} />;
  }

  if (error) {
    return (
      <div className={`rounded-xl p-5 space-y-3 border ${isDark
        ? 'bg-slate-800 border-slate-700'
        : 'bg-white border-gray-200'
      }`}>
        <div className={`flex items-center gap-2 ${isDark ? 'text-red-400' : 'text-red-600'}`}>
          <svg className="w-4 h-4 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
          </svg>
          <span className="text-sm font-medium">Could not load chapters</span>
        </div>
        <p className={`text-xs pl-6 ${isDark ? 'text-slate-500' : 'text-gray-500'}`}>{error}</p>
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

  return (
    <div className={`rounded-xl overflow-hidden flex flex-col max-h-[calc(100vh-6rem)] lg:max-h-[calc(100vh-5rem)] border ${isDark
      ? 'bg-slate-800 border-slate-700'
      : 'bg-white border-gray-200'
    }`}>
      {/* DEBUG */}
      {import.meta.env.DEV && novelMetadata && (
        <details className={`border-b ${isDark ? 'bg-slate-900 border-slate-700' : 'bg-gray-50 border-gray-200'}`}>
          <summary className={`px-4 py-1.5 text-[10px] cursor-pointer select-none hover:underline ${isDark ? 'text-slate-600' : 'text-gray-400'}`}>
            [DEBUG] Raw API metadata
          </summary>
          <pre className={`px-4 py-2 text-[10px] overflow-auto max-h-40 ${isDark ? 'text-slate-500' : 'text-gray-500'}`}>
            {JSON.stringify(novelMetadata, null, 2)}
          </pre>
        </details>
      )}

      {/* ── Header ─────────────────────────────────────────────── */}
      <div className={`px-4 sm:px-4 py-3 space-y-3 flex-shrink-0 ${isDark ? 'border-slate-700' : 'border-gray-200'} border-b`}>

        {/* Title row + chapter badge */}
        <div className="flex items-start gap-3">
          {/* Cover image */}
          <CoverImage url={novelMetadata?.cover_url} title={panelTitle} isDark={isDark} />
          {/* Title + author */}
          <div className="flex-1 min-w-0">
            <h3
              className={`text-sm font-semibold leading-snug ${isDark ? 'text-slate-100' : 'text-gray-900'}`}
              title={panelTitle}
            >
              {panelTitle}
            </h3>
            {novelMetadata?.author_fullname && (
              <p className={`text-xs mt-0.5 truncate ${isDark ? 'text-slate-400' : 'text-gray-600'}`}>
                by {novelMetadata.author_fullname}
              </p>
            )}
            {novelMetadata?.author && !novelMetadata.author_fullname && (
              <p className={`text-xs mt-0.5 ${isDark ? 'text-slate-500' : 'text-gray-500'}`}>@{novelMetadata.author}</p>
            )}
            {!novelMetadata?.author_fullname && !novelMetadata?.author && siteName && (
              <p className={`text-xs mt-0.5 ${isDark ? 'text-slate-500' : 'text-gray-500'}`}>{siteName}</p>
            )}
            {novelMetadata?.season_current != null && (
              <p className={`text-xs mt-0.5 ${isDark ? 'text-indigo-400' : 'text-indigo-600'}`}>
                Season {novelMetadata.season_current}
                {novelMetadata.season_total != null && ` of ${novelMetadata.season_total}`}
              </p>
            )}
          </div>
          {/* Chapter count badge */}
          {displayedTotal > 0 && (
            <div className="flex-shrink-0 text-right">
              <div className={`px-2.5 py-1 rounded-lg border ${isDark
                ? 'bg-indigo-900/30 border-indigo-800/40'
                : 'bg-indigo-50 border-indigo-200'
              }`}>
                <p className={`text-xs font-semibold leading-none ${isDark ? 'text-indigo-300' : 'text-indigo-700'}`}>
                  {showPartial
                    ? `${chapterCount} / ${totalChapterCount?.toLocaleString()}`
                    : displayedTotal.toLocaleString()}
                </p>
                <p className={`text-[10px] mt-0.5 leading-none ${isDark ? 'text-indigo-400/70' : 'text-indigo-500/70'}`}>chapters</p>
              </div>
            </div>
          )}
        </div>

        {/* Stats row */}
        {(novelMetadata?.views != null || novelMetadata?.stars != null || novelMetadata?.comment_count != null || displayedTotal > 0) && (
          <div className={`flex flex-wrap items-center gap-x-4 gap-y-1 text-xs ${isDark ? 'text-slate-300' : 'text-gray-700'}`}>
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
              <BadgeCompleted isDark={isDark} />
            )}
            {novelMetadata.completed === false && (
              <BadgeOngoing isDark={isDark} />
            )}
            {novelMetadata.mature === true && (
              <BadgeMature isDark={isDark} />
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
                className={`px-2 py-0.5 text-xs rounded ${isDark
                  ? 'bg-slate-700 text-slate-300'
                  : 'bg-gray-200 text-gray-700'
                }`}
              >
                {tag}
              </span>
            ))}
            {novelMetadata.tags.length > 12 && (
              <span className={`px-2 py-0.5 text-xs rounded ${isDark ? 'bg-slate-700 text-slate-500' : 'bg-gray-200 text-gray-400'}`}>
                +{novelMetadata.tags.length - 12} more
              </span>
            )}
          </div>
        )}

        {/* Total chapters banner */}
        {totalChapterCount != null && (
          <div className={`flex items-center gap-2 px-2 py-1.5 rounded-lg border ${isDark
            ? 'bg-indigo-900/30 border-indigo-800/40'
            : 'bg-indigo-50 border-indigo-200'
          }`}>
            <svg className={`w-3.5 h-3.5 flex-shrink-0 ${isDark ? 'text-indigo-400' : 'text-indigo-600'}`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
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
        <div className={`px-4 py-3 border-b flex-shrink-0 ${isDark
          ? 'border-slate-700 bg-amber-950/30'
          : 'border-gray-200 bg-amber-50'
        }`}>
          <div className={`rounded-lg p-3 border ${isDark
            ? 'bg-amber-900/40 border-amber-700'
            : 'bg-amber-100 border-amber-200'
          }`}>
            <div className={`flex items-center gap-2 font-semibold text-sm ${isDark ? 'text-amber-400' : 'text-amber-700'}`}>
              <LockIcon />
              Wattpad Original
            </div>
            <p className={`text-xs leading-relaxed mt-1 ${isDark ? 'text-amber-200/70' : 'text-amber-800/70'}`}>
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
          <div className={`flex items-center gap-2 p-5 text-sm ${isDark ? 'text-slate-500' : 'text-gray-500'}`}>
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2" />
            </svg>
            No chapters found
          </div>
        ) : (
          <table className="w-full text-sm">
            <thead className={`sticky top-0 ${isDark ? 'bg-slate-800 border-slate-700' : 'bg-white border-gray-200'} border-b`}>
              <tr>
                <th className={`px-3 py-2 text-left text-xs font-semibold uppercase tracking-wider w-12 ${isDark ? 'text-slate-500' : 'text-gray-500'}`}>#</th>
                <th className={`px-3 py-2 text-left text-xs font-semibold uppercase tracking-wider ${isDark ? 'text-slate-500' : 'text-gray-500'}`}>Chapter Title</th>
              </tr>
            </thead>
            <tbody className={`divide-y ${isDark ? 'divide-slate-700/50' : 'divide-gray-200'}`}>
              {chapters.map(chapter => (
                <ChapterRow key={chapter.url} chapter={chapter} isDark={isDark} />
              ))}
            </tbody>
          </table>
        )}
      </div>

      {/* ── Footer CTA ─────────────────────────────────────────── */}
      <div className={`px-4 sm:px-4 py-3 flex-shrink-0 space-y-2 ${isDark ? 'border-slate-700' : 'border-gray-200'} border-t`}>
        {estimatedMax > 0 && (
          <p className={`text-xs text-center ${isDark ? 'text-slate-500' : 'text-gray-500'}`}>
            Range: 1 &ndash; {estimatedMax.toLocaleString()}
          </p>
        )}
        {isPaywalled ? (
          <p className={`text-xs text-center ${isDark ? 'text-amber-400' : 'text-amber-600'}`}>
            Crawling unavailable for Wattpad Originals
          </p>
        ) : (
          <div className="flex flex-col gap-2">
            {/* Format row */}
            <div className="flex items-center gap-2 px-1">
              <span className={`text-xs ${isDark ? 'text-slate-400' : 'text-gray-600'}`}>Format:</span>
              <span className="px-2 py-0.5 text-xs rounded bg-indigo-600 text-white">TXT</span>
            </div>
            <button
              onClick={() => {
                onCrawlNovel(estimatedMax > 0 ? estimatedMax : totalChapterCount ?? chapterCount);
              }}
              disabled={estimatedMax === 0 && totalChapterCount == null}
              className={`w-full py-2 px-4 rounded-lg transition-colors flex items-center justify-center gap-2 ${estimatedMax === 0 && totalChapterCount == null
                ? isDark
                  ? 'bg-slate-700 text-slate-500 cursor-not-allowed'
                  : 'bg-gray-200 text-gray-500 cursor-not-allowed'
                : isDark
                  ? 'bg-emerald-600 hover:bg-emerald-500 text-white'
                  : 'bg-emerald-600 hover:bg-emerald-500 text-white'
                } text-sm font-semibold`}
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
      <div className={`w-16 h-20 rounded-lg flex items-center justify-center flex-shrink-0 ${isDark ? 'bg-slate-700' : 'bg-gray-200'}`}>
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
      className="w-16 h-20 rounded-lg object-cover flex-shrink-0"
    />
  );
}

function DescriptionBlock({ text, expanded, onToggle, isDark }: { text: string; expanded: boolean; onToggle: () => void; isDark: boolean }) {
  const [tooLong] = useState(text.length > 200);
  return (
    <div>
      <p className={`text-xs leading-relaxed ${expanded ? '' : 'line-clamp-2'} ${isDark ? 'text-slate-400' : 'text-gray-600'}`}>
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
    <tr className={`transition-colors ${isDark ? 'hover:bg-slate-700/40' : 'hover:bg-gray-50'}`}>
      <td className={`px-3 py-2 text-xs font-mono whitespace-nowrap ${isDark ? 'text-slate-500' : 'text-gray-500'}`}>
        {chapter.chapter_number}
      </td>
      <td className={`px-3 py-2 text-xs leading-relaxed ${isDark ? 'text-slate-300' : 'text-gray-700'}`}>
        <span className="block truncate" title={chapter.title}>
          {chapter.title || <em className={`not-italic ${isDark ? 'text-slate-500' : 'text-gray-400'}`}>Untitled</em>}
        </span>
      </td>
    </tr>
  );
}

function BadgeCompleted({ isDark }: { isDark: boolean }) {
  return (
    <span className={`flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium border ${isDark
      ? 'bg-emerald-900/60 text-emerald-300 border-emerald-700'
      : 'bg-emerald-100 text-emerald-700 border-emerald-200'
    }`}>
      <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
      </svg>
      Completed
    </span>
  );
}

function BadgeOngoing({ isDark }: { isDark: boolean }) {
  return (
    <span className={`flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium border ${isDark
      ? 'bg-amber-900/60 text-amber-300 border-amber-700'
      : 'bg-amber-100 text-amber-700 border-amber-200'
    }`}>
      Ongoing
    </span>
  );
}

function BadgeMature({ isDark }: { isDark: boolean }) {
  return (
    <span className={`px-2 py-0.5 rounded-full text-xs font-medium border ${isDark
      ? 'bg-red-900/60 text-red-300 border-red-700'
      : 'bg-red-100 text-red-700 border-red-200'
    }`}>
      18+
    </span>
  );
}

// ─── Icons ─────────────────────────────────────────────────────────────────

function EyeIcon({ isDark }: { isDark: boolean }) {
  return (
    <svg className={`w-3.5 h-3.5 ${isDark ? 'text-slate-500' : 'text-gray-400'}`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z" />
    </svg>
  );
}

function StarIcon({ isDark }: { isDark: boolean }) {
  return (
    <svg className={`w-3.5 h-3.5 ${isDark ? 'text-slate-500' : 'text-gray-400'}`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11.049 2.927c.3-.921 1.603-.921 1.902 0l1.519 4.674a1 1 0 00.95.69h4.915c.969 0 1.371 1.24.588 1.81l-3.976 2.888a1 1 0 00-.363 1.118l1.518 4.674c.3.922-.755 1.688-1.538 1.118l-3.976-2.888a1 1 0 00-1.176 0l-3.976 2.888c-.783.57-1.838-.197-1.538-1.118l1.518-4.674a1 1 0 00-.363-1.118l-3.976-2.888c-.784-.57-.38-1.81.588-1.81h4.914a1 1 0 00.951-.69l1.519-4.674z" />
    </svg>
  );
}

function BookIcon({ isDark }: { isDark: boolean }) {
  return (
    <svg className={`w-3.5 h-3.5 ${isDark ? 'text-slate-500' : 'text-gray-400'}`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
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
    <svg className={`w-3.5 h-3.5 ${isDark ? 'text-slate-500' : 'text-gray-400'}`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
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
  const shimmer = isDark ? 'bg-slate-700' : 'bg-gray-200';
  return (
    <div className={`rounded-xl overflow-hidden border ${isDark ? 'bg-slate-800 border-slate-700' : 'bg-white border-gray-200'}`}>
      <div className={`px-4 py-3 space-y-2 border-b ${isDark ? 'border-slate-700' : 'border-gray-200'}`}>
        <div className={`h-4 ${shimmer} rounded w-3/4 animate-pulse`} />
        <div className={`h-3 ${shimmer} rounded w-1/4 animate-pulse`} />
      </div>
      <div className="px-4 py-4 space-y-4">
        <div className="flex items-start gap-3">
          <div className="flex flex-col items-center">
            <div className="w-6 h-6 rounded-full bg-emerald-600 flex items-center justify-center flex-shrink-0">
              <svg className="w-3.5 h-3.5 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M5 13l4 4L19 7" />
              </svg>
            </div>
          </div>
          <div className="flex-1 pt-0.5">
            <p className={`text-xs font-medium ${isDark ? 'text-emerald-400' : 'text-emerald-600'}`}>Site detected</p>
            <p className={`text-[11px] mt-0.5 ${isDark ? 'text-slate-500' : 'text-gray-400'}`}>URL is valid</p>
          </div>
        </div>
        <div className="flex items-start gap-3">
          <div className="flex flex-col items-center">
            <div className="w-6 h-6 rounded-full bg-indigo-600 flex items-center justify-center flex-shrink-0">
              <svg className="animate-spin w-3.5 h-3.5 text-white" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
                <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
              </svg>
            </div>
          </div>
          <div className="flex-1 pt-0.5">
            <p className={`text-xs font-medium ${isDark ? 'text-indigo-300' : 'text-indigo-700'}`}>
              {isDetecting ? 'Detecting site...' : 'Fetching chapters...'}
            </p>
            <p className={`text-[11px] mt-0.5 ${isDark ? 'text-slate-500' : 'text-gray-400'}`}>
              {isDetecting ? 'Checking URL...' : 'This may take up to 20 seconds'}
            </p>
          </div>
        </div>
      </div>
      <div className="px-4 pb-4 space-y-2">
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
