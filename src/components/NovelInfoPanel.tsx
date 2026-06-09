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

  const panelBackground = isDark ? '#202020' : '#ffffff';
  const panelBorder = isDark ? 'rgba(255,255,255,0.08)' : 'rgba(55,53,47,0.12)';
  const mutedSurface = isDark ? 'rgba(255,255,255,0.05)' : 'rgba(55,53,47,0.05)';
  const subtleSurface = isDark ? 'rgba(255,255,255,0.03)' : 'rgba(55,53,47,0.03)';
  const pageText = isDark ? 'rgba(255,255,255,0.92)' : '#37352f';
  const secondaryText = isDark ? 'rgba(255,255,255,0.5)' : 'rgba(55,53,47,0.62)';
  const tertiaryText = isDark ? 'rgba(255,255,255,0.34)' : 'rgba(55,53,47,0.42)';

  if (isChapterUrl) return null;

  if (isLoading || isDetecting) {
    return <NovelInfoPanelSkeleton isDetecting={isDetecting} isDark={isDark} />;
  }

  if (error) {
    return (
      <div className="space-y-3 rounded-2xl border p-5" style={{ background: panelBackground, borderColor: panelBorder }}>
        <div className="flex items-center gap-2" style={{ color: isDark ? '#f87171' : '#dc2626' }}>
          <Icon icon={appIcons.info} className="h-4 w-4 shrink-0" />
          <span className="text-sm font-medium">Could not load chapters</span>
        </div>
        <p className="pl-6 text-xs" style={{ color: tertiaryText }}>{error}</p>
      </div>
    );
  }

  const isPaywalled = novelMetadata?.is_paywalled === true;
  const displayedTotal = totalChapterCount != null
    ? totalChapterCount
    : chapters.length > 0
      ? Math.max(...chapters.map((chapter) => chapter.chapter_number))
      : 0;
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
    <div className="flex max-h-[calc(100vh-6rem)] flex-col overflow-hidden rounded-2xl border" style={{ background: panelBackground, borderColor: panelBorder }}>
      {import.meta.env.DEV && novelMetadata && (
        <details className="shrink-0 border-b" style={{ borderColor: panelBorder, background: subtleSurface }}>
          <summary className="flex cursor-pointer list-none items-center justify-between gap-3 px-4 py-2 select-none" style={{ color: secondaryText }}>
            <span className="text-[11px] font-medium uppercase tracking-wide">Debug metadata</span>
            <span className="text-[10px]" style={{ color: tertiaryText }}>{debugEntries.length} fields</span>
          </summary>
          <div className="space-y-3 px-4 pb-3">
            {debugEntries.length > 0 && (
              <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                {debugEntries.map(([key, value]) => (
                  <div key={key} className="rounded-xl border px-3 py-2" style={{ borderColor: panelBorder, background: subtleSurface }}>
                    <p className="mb-1 text-[10px] uppercase tracking-wide" style={{ color: tertiaryText }}>{key}</p>
                    <p className="break-words text-[11px]" style={{ color: secondaryText }}>{formatDebugValue(value)}</p>
                  </div>
                ))}
              </div>
            )}
            <pre className="max-h-40 overflow-auto rounded-xl border px-3 py-3 text-[10px]" style={{ borderColor: panelBorder, background: isDark ? 'rgba(0,0,0,0.18)' : 'rgba(55,53,47,0.03)', color: tertiaryText }}>
              {JSON.stringify(novelMetadata, null, 2)}
            </pre>
          </div>
        </details>
      )}

      <div className="shrink-0 space-y-3 border-b px-4 py-4 sm:px-5" style={{ borderColor: panelBorder }}>
        <div className="flex items-start gap-3">
          <CoverImage url={novelMetadata?.cover_url} title={panelTitle} isDark={isDark} />
          <div className="min-w-0 flex-1">
            <h3 className="text-sm font-semibold leading-snug" style={{ color: pageText }} title={panelTitle}>
              {panelTitle}
            </h3>
            {novelMetadata?.author_fullname && (
              <p className="mt-0.5 truncate text-xs" style={{ color: secondaryText }}>by {novelMetadata.author_fullname}</p>
            )}
            {novelMetadata?.author && !novelMetadata.author_fullname && (
              <p className="mt-0.5 text-xs" style={{ color: tertiaryText }}>@{novelMetadata.author}</p>
            )}
            {!novelMetadata?.author_fullname && !novelMetadata?.author && siteName && (
              <p className="mt-0.5 text-xs" style={{ color: tertiaryText }}>{siteName}</p>
            )}
            {novelMetadata?.season_current != null && (
              <p className="mt-0.5 text-xs" style={{ color: isDark ? '#818cf8' : '#4f46e5' }}>
                Season {novelMetadata.season_current}
                {novelMetadata.season_total != null && ` of ${novelMetadata.season_total}`}
              </p>
            )}
          </div>
          {displayedTotal > 0 && (
            <div className="shrink-0 text-right">
              <div className="rounded-xl border px-3 py-1.5" style={{ borderColor: isDark ? 'rgba(99,102,241,0.22)' : 'rgba(99,102,241,0.18)', background: isDark ? 'rgba(99,102,241,0.12)' : 'rgba(99,102,241,0.06)' }}>
                <p className="flex items-center justify-end gap-1.5 text-sm font-bold leading-none" style={{ color: isDark ? '#a5b4fc' : '#4338ca' }}>
                  {showPartial ? `${chapterCount} / ${totalChapterCount?.toLocaleString()}` : displayedTotal.toLocaleString()}
                  {showSpinner && <Icon icon={appIcons.spinner} className="inline-block h-3 w-3 animate-spin" />}
                </p>
                <p className="mt-0.5 text-[10px] leading-none" style={{ color: isDark ? 'rgba(165,180,252,0.72)' : 'rgba(67,56,202,0.72)' }}>chapters</p>
              </div>
            </div>
          )}
        </div>

        {(novelMetadata?.views != null || novelMetadata?.stars != null || novelMetadata?.comment_count != null || displayedTotal > 0) && (
          <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs" style={{ color: secondaryText }}>
            {novelMetadata?.views != null && <StatPill icon={appIcons.eye} value={formatNumber(novelMetadata.views)} isDark={isDark} />}
            {novelMetadata?.stars != null && <StatPill icon={appIcons.checkCircle} value={formatNumber(novelMetadata.stars)} isDark={isDark} />}
            {novelMetadata?.comment_count != null && <StatPill icon={appIcons.comment} value={formatNumber(novelMetadata.comment_count)} isDark={isDark} />}
            {displayedTotal > 0 && <StatPill icon={appIcons.bookOpen} value={`${displayedTotal.toLocaleString()} parts`} isDark={isDark} />}
          </div>
        )}

        {(novelMetadata?.completed != null || novelMetadata?.mature === true) && (
          <div className="flex flex-wrap gap-2">
            {novelMetadata.completed === true && <BadgeCompleted isDark={isDark} />}
            {novelMetadata.completed === false && <BadgeOngoing isDark={isDark} />}
            {novelMetadata.mature === true && <BadgeMature isDark={isDark} />}
          </div>
        )}

        {novelMetadata?.description && (
          <DescriptionBlock text={novelMetadata.description} expanded={descExpanded} onToggle={() => setDescExpanded((value) => !value)} isDark={isDark} />
        )}

        {novelMetadata?.tags && novelMetadata.tags.length > 0 && (
          <div className="flex flex-wrap gap-1.5">
            {novelMetadata.tags.slice(0, 12).map((tag) => (
              <span key={tag} className="rounded-md border px-2 py-0.5 text-[11px]" style={{ background: mutedSurface, borderColor: panelBorder, color: secondaryText }}>
                {tag}
              </span>
            ))}
            {novelMetadata.tags.length > 12 && (
              <span className="rounded-md border px-2 py-0.5 text-[11px]" style={{ background: subtleSurface, borderColor: panelBorder, color: tertiaryText }}>
                +{novelMetadata.tags.length - 12} more
              </span>
            )}
          </div>
        )}

        {totalChapterCount != null && (
          <div className="flex items-center gap-2 rounded-xl border px-3 py-2" style={{ borderColor: isDark ? 'rgba(99,102,241,0.22)' : 'rgba(99,102,241,0.18)', background: isDark ? 'rgba(99,102,241,0.08)' : 'rgba(99,102,241,0.05)' }}>
            <Icon icon={appIcons.book} className="h-4 w-4 shrink-0" style={{ color: isDark ? '#818cf8' : '#4f46e5' }} />
            <span className="text-xs" style={{ color: isDark ? '#c7d2fe' : '#4338ca' }}>
              This novel has <span className="font-semibold">{totalChapterCount.toLocaleString()} chapters</span>
              {showPartial && <> — showing first {chapterCount}</>}
            </span>
          </div>
        )}

        {warning && <p className="text-xs" style={{ color: '#f59e0b' }}>{warning}</p>}
      </div>

      {isPaywalled && (
        <div className="shrink-0 border-b px-4 py-3" style={{ borderColor: panelBorder }}>
          <div className="rounded-xl border p-4" style={{ borderColor: 'rgba(251,191,36,0.24)', background: isDark ? 'rgba(251,191,36,0.08)' : 'rgba(251,191,36,0.05)' }}>
            <div className="flex items-center gap-2 text-sm font-semibold" style={{ color: isDark ? '#fbbf24' : '#b45309' }}>
              <LockIcon />
              Wattpad Original
            </div>
            <p className="mt-2 text-xs leading-relaxed" style={{ color: isDark ? 'rgba(253,230,138,0.78)' : 'rgba(146,64,14,0.78)' }}>
              This story contains chapters locked behind Wattpad coins. Crawling is disabled to respect author monetization and Wattpad&apos;s terms of service.
            </p>
            <p className="mt-2 flex items-center gap-1 text-xs" style={{ color: isDark ? 'rgba(253,230,138,0.62)' : 'rgba(146,64,14,0.62)' }}>
              <InfoIcon />
              Free chapters may be available on other sources.
            </p>
          </div>
        </div>
      )}

      <div className="min-h-0 min-h-[200px] flex-1 overflow-y-auto" ref={tocRef}>
        {chapters.length === 0 ? (
          <div className="flex items-center gap-2 p-5 text-sm" style={{ color: tertiaryText }}>
            <Icon icon={appIcons.file} className="h-4 w-4" />
            No chapters found
          </div>
        ) : (
          <table className="w-full text-sm">
            <thead className="sticky top-0 border-b" style={{ background: panelBackground, borderColor: panelBorder }}>
              <tr>
                <th className="w-12 px-4 py-2.5 text-left text-xs font-semibold uppercase tracking-wider" style={{ color: tertiaryText }}>#</th>
                <th className="px-4 py-2.5 text-left text-xs font-semibold uppercase tracking-wider" style={{ color: tertiaryText }}>Chapter Title</th>
              </tr>
            </thead>
            <tbody>
              {chapters.map((chapter, index) => (
                <ChapterRow key={chapter.url} chapter={chapter} isDark={isDark} isLast={index === chapters.length - 1} />
              ))}
            </tbody>
          </table>
        )}
      </div>

      <div className="shrink-0 space-y-3 border-t px-4 py-4 sm:px-5" style={{ borderColor: panelBorder }}>
        {estimatedMax > 0 && (
          <p className="text-center text-xs" style={{ color: tertiaryText }}>
            Range: 1 &ndash; {estimatedMax.toLocaleString()}
          </p>
        )}
        {isPaywalled ? (
          <p className="text-center text-xs" style={{ color: '#f59e0b' }}>
            Crawling unavailable for Wattpad Originals
          </p>
        ) : (
          <div className="flex flex-col gap-3">
            <div className="flex items-center gap-2 px-1">
              <span className="text-xs" style={{ color: secondaryText }}>Format:</span>
              <span className="rounded-md border px-2.5 py-1 text-xs font-semibold" style={{ background: isDark ? 'rgba(99,102,241,0.12)' : 'rgba(99,102,241,0.06)', borderColor: isDark ? 'rgba(99,102,241,0.22)' : 'rgba(99,102,241,0.18)', color: isDark ? '#a5b4fc' : '#4338ca' }}>
                MD
              </span>
            </div>
            <button
              onClick={() => {
                onCrawlNovel(estimatedMax > 0 ? estimatedMax : totalChapterCount ?? chapterCount);
              }}
              disabled={estimatedMax === 0 && totalChapterCount == null}
              className="flex w-full items-center justify-center gap-2 rounded-xl border px-4 py-2.5 text-sm font-semibold transition-colors disabled:cursor-not-allowed"
              style={{
                background: estimatedMax === 0 && totalChapterCount == null ? mutedSurface : '#4f46e5',
                borderColor: estimatedMax === 0 && totalChapterCount == null ? panelBorder : '#4f46e5',
                color: estimatedMax === 0 && totalChapterCount == null ? secondaryText : '#ffffff',
                opacity: estimatedMax === 0 && totalChapterCount == null ? 0.5 : 1,
              }}
            >
              <Icon icon={appIcons.trends} className="h-4 w-4" />
              Crawl All Chapters
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

function CoverImage({ url, title, isDark }: { url?: string; title: string; isDark: boolean }) {
  const [failed, setFailed] = useState(false);
  if (!url || failed) {
    return (
      <div className="flex h-20 w-16 shrink-0 items-center justify-center rounded-xl border" style={{ background: isDark ? 'rgba(255,255,255,0.05)' : 'rgba(55,53,47,0.05)', borderColor: isDark ? 'rgba(255,255,255,0.08)' : 'rgba(55,53,47,0.12)' }}>
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
      className="h-20 w-16 shrink-0 rounded-xl object-cover"
      style={{ border: `1px solid ${isDark ? 'rgba(255,255,255,0.08)' : 'rgba(55,53,47,0.12)'}` }}
    />
  );
}

function DescriptionBlock({ text, expanded, onToggle, isDark }: { text: string; expanded: boolean; onToggle: () => void; isDark: boolean }) {
  const [tooLong] = useState(text.length > 200);
  return (
    <div>
      <p className={`text-xs leading-relaxed ${expanded ? '' : 'line-clamp-2'}`} style={{ color: isDark ? 'rgba(255,255,255,0.5)' : 'rgba(55,53,47,0.62)' }}>
        {text}
      </p>
      {tooLong && (
        <button onClick={onToggle} className="mt-1 text-xs hover:underline" style={{ color: isDark ? '#818cf8' : '#4f46e5' }}>
          {expanded ? 'Show less' : 'Show more'}
        </button>
      )}
    </div>
  );
}

function ChapterRow({ chapter, isDark, isLast }: { chapter: ChapterEntry; isDark: boolean; isLast: boolean }) {
  return (
    <tr className="transition-colors" style={{ borderBottom: isLast ? 'none' : `1px solid ${isDark ? 'rgba(255,255,255,0.06)' : 'rgba(55,53,47,0.08)'}` }}>
      <td className="whitespace-nowrap px-4 py-2.5 align-top text-xs font-mono" style={{ color: isDark ? 'rgba(255,255,255,0.34)' : 'rgba(55,53,47,0.42)' }}>
        {chapter.chapter_number}
      </td>
      <td className="px-4 py-2.5 align-top text-xs leading-relaxed" style={{ color: isDark ? 'rgba(255,255,255,0.72)' : 'rgba(55,53,47,0.72)' }}>
        <span className="block truncate" title={chapter.title}>
          {chapter.title || <em className="not-italic" style={{ color: isDark ? 'rgba(255,255,255,0.34)' : 'rgba(55,53,47,0.42)' }}>Untitled</em>}
        </span>
      </td>
    </tr>
  );
}

function StatPill({ icon, value, isDark }: { icon: typeof appIcons.eye; value: string; isDark: boolean }) {
  return (
    <span className="inline-flex items-center gap-1.5 rounded-md border px-2 py-1" style={{ background: isDark ? 'rgba(255,255,255,0.04)' : 'rgba(55,53,47,0.04)', borderColor: isDark ? 'rgba(255,255,255,0.08)' : 'rgba(55,53,47,0.08)' }}>
      <Icon icon={icon} className="h-3.5 w-3.5" style={{ color: isDark ? 'rgba(255,255,255,0.34)' : 'rgba(55,53,47,0.42)' }} />
      {value}
    </span>
  );
}

function formatDebugValue(value: unknown): string {
  if (Array.isArray(value)) return value.join(', ');
  if (typeof value === 'object' && value !== null) return JSON.stringify(value);
  return String(value);
}

function BadgeCompleted({ isDark }: { isDark: boolean }) {
  return (
    <span className="inline-flex items-center gap-1.5 rounded-md border px-2.5 py-1 text-xs font-medium" style={{ background: isDark ? 'rgba(52,211,153,0.14)' : 'rgba(5,150,105,0.08)', borderColor: isDark ? 'rgba(52,211,153,0.24)' : 'rgba(5,150,105,0.18)', color: isDark ? '#34d399' : '#059669' }}>
      <Icon icon={appIcons.check} className="h-3 w-3" />
      Completed
    </span>
  );
}

function BadgeOngoing({ isDark }: { isDark: boolean }) {
  return <span className="inline-flex items-center rounded-md border px-2.5 py-1 text-xs font-medium" style={{ background: 'rgba(245,158,11,0.12)', borderColor: 'rgba(245,158,11,0.2)', color: isDark ? '#fbbf24' : '#b45309' }}>Ongoing</span>;
}

function BadgeMature({ isDark }: { isDark: boolean }) {
  return <span className="inline-flex items-center rounded-md border px-2.5 py-1 text-xs font-medium" style={{ background: isDark ? 'rgba(239,68,68,0.12)' : 'rgba(239,68,68,0.08)', borderColor: isDark ? 'rgba(239,68,68,0.2)' : 'rgba(239,68,68,0.18)', color: isDark ? '#f87171' : '#dc2626' }}>18+</span>;
}

function LockIcon() {
  return <Icon icon={appIcons.paywall} className="h-4 w-4" />;
}

function InfoIcon() {
  return <Icon icon={appIcons.info} className="h-3.5 w-3.5" />;
}

function NovelInfoPanelSkeleton({ isDetecting, isDark }: { isDetecting: boolean; isDark: boolean }) {
  const shimmer = isDark ? 'rgba(255,255,255,0.08)' : 'rgba(55,53,47,0.08)';
  const panelBorder = isDark ? 'rgba(255,255,255,0.08)' : 'rgba(55,53,47,0.12)';
  const secondaryText = isDark ? 'rgba(255,255,255,0.34)' : 'rgba(55,53,47,0.42)';

  return (
    <div className="overflow-hidden rounded-2xl border" style={{ background: isDark ? '#202020' : '#ffffff', borderColor: panelBorder }}>
      <div className="space-y-3 border-b px-4 py-4" style={{ borderColor: panelBorder }}>
        <div className="flex items-start gap-3">
          <div className="h-20 w-16 animate-pulse rounded-xl" style={{ background: shimmer }} />
          <div className="flex-1 space-y-2 pt-1">
            <div className="h-4 w-3/4 animate-pulse rounded" style={{ background: shimmer }} />
            <div className="h-3 w-1/3 animate-pulse rounded" style={{ background: shimmer }} />
          </div>
        </div>
      </div>
      <div className="space-y-4 px-4 py-5">
        <div className="flex items-start gap-3">
          <div className="flex flex-col items-center">
            <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-emerald-600">
              <Icon icon={appIcons.check} className="h-4 w-4 text-white" />
            </div>
          </div>
          <div className="flex-1 pt-0.5">
            <p className="text-xs font-medium" style={{ color: isDark ? '#34d399' : '#059669' }}>Site detected</p>
            <p className="mt-0.5 text-[11px]" style={{ color: secondaryText }}>URL is valid</p>
          </div>
        </div>
        <div className="flex items-start gap-3">
          <div className="flex flex-col items-center">
            <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-indigo-600">
              <Icon icon={appIcons.spinner} className="h-4 w-4 animate-spin text-white" />
            </div>
          </div>
          <div className="flex-1 pt-0.5">
            <p className="text-xs font-medium" style={{ color: isDark ? '#a5b4fc' : '#4338ca' }}>
              {isDetecting ? 'Detecting site...' : 'Fetching chapters...'}
            </p>
            <p className="mt-0.5 text-[11px]" style={{ color: secondaryText }}>
              {isDetecting ? 'Checking URL...' : 'This may take up to 20 seconds'}
            </p>
          </div>
        </div>
      </div>
      <div className="space-y-2 px-4 pb-5">
        {Array.from({ length: 8 }).map((_, index) => (
          <div key={index} className="flex items-center gap-3 animate-pulse">
            <div className="h-3 w-8 shrink-0 rounded" style={{ background: shimmer }} />
            <div className={`h-3 rounded ${index % 3 === 0 ? 'w-full' : index % 3 === 1 ? 'w-11/12' : 'w-10/12'}`} style={{ background: shimmer }} />
          </div>
        ))}
      </div>
    </div>
  );
}
