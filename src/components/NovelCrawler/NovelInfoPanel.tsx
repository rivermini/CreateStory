import { useRef, useState } from 'react';
import type { ChapterEntry, NovelMetadata } from '../../api';
import { formatNumber } from '../../api';
import { Icon, appIcons } from '../Shared/Icon';

export interface NovelInfoPanelProps {
  readonly storyTitle: string | null;
  readonly siteName: string | null;
  readonly chapters: ChapterEntry[];
  readonly chapterCount: number;
  readonly totalChapterCount: number | null;
  readonly isLoading: boolean;
  readonly isDetecting: boolean;
  readonly error: string;
  readonly warning: string | null;
  readonly isChapterUrl: boolean;
  readonly novelMetadata: NovelMetadata | null | undefined;
  readonly onCrawlNovel: (toChapter: number) => void;
  /** When true, crawling is fully disabled (e.g. Wattpad Originals). */
  readonly crawlBlocked?: boolean;
  /** Chapters readable for free across the whole book (sites with a per-chapter paywall). */
  readonly freeChapterCount?: number | null;
  /** Paywalled/locked chapters across the whole book. */
  readonly paidChapterCount?: number | null;
  /** Whether saved login cookies were applied when computing the free/paid split. */
  readonly authenticated?: boolean | null;
  readonly isDark?: boolean;
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
  crawlBlocked = false,
  freeChapterCount = null,
  paidChapterCount = null,
  authenticated = null,
  isDark = true,
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
      <div className="space-y-2 rounded-xl border p-4" style={{ background: panelBackground, borderColor: panelBorder }}>
        <div className="flex items-center gap-2" style={{ color: isDark ? '#f87171' : '#dc2626' }}>
          <Icon icon={appIcons.info} className="h-4 w-4 shrink-0" />
          <span className="text-sm font-medium">Could not load chapters</span>
        </div>
        <p className="pl-6 text-xs" style={{ color: tertiaryText }}>{error}</p>
      </div>
    );
  }

  // A per-chapter paywall (some chapters paid, free ones still crawlable) — distinct from a
  // fully-blocked story (crawlBlocked, e.g. Wattpad Original).
  const hasPartialPaywall = !crawlBlocked && (paidChapterCount ?? 0) > 0;
  const displayedTotal = totalChapterCount ?? (chapters.length > 0 ? Math.max(...chapters.map((chapter) => chapter.chapter_number)) : 0);
  const estimatedMax = totalChapterCount ?? displayedTotal;
  const showPartial = totalChapterCount != null && chapterCount < totalChapterCount;
  const panelTitle = novelMetadata?.title || storyTitle || 'Novel Info';

  return (
    <div className="flex max-h-[calc(100vh-4.5rem)] flex-col overflow-hidden rounded-xl" style={{ background: panelBackground, borderColor: panelBorder }}>
      <div className="shrink-0 space-y-2.5 border-b px-3 py-3 sm:px-4" style={{ borderColor: panelBorder }}>
        <div className="flex items-start gap-2.5">
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
              <p className="mt-0.5 text-xs" style={{ color: isDark ? 'rgba(255,255,255,0.92)' : '#111111' }}>
                Season {novelMetadata.season_current}
                {novelMetadata.season_total != null && ` of ${novelMetadata.season_total}`}
              </p>
            )}
          </div>
          {displayedTotal > 0 && (
            <div className="shrink-0 text-right">
              <div className="rounded-lg border px-2.5 py-1" style={{ borderColor: isDark ? 'rgba(255,255,255,0.14)' : 'rgba(17,17,17,0.12)', background: isDark ? 'rgba(255,255,255,0.06)' : 'rgba(17,17,17,0.04)' }}>
                <p className="flex items-center justify-end gap-1 text-sm font-semibold leading-none" style={{ color: isDark ? 'rgba(255,255,255,0.92)' : '#111111' }}>
                  {showPartial ? `${chapterCount} / ${totalChapterCount?.toLocaleString()}` : displayedTotal.toLocaleString()}
                </p>
                <p className="mt-0.5 text-[10px] leading-none" style={{ color: isDark ? 'rgba(255,255,255,0.5)' : 'rgba(17,17,17,0.55)' }}>chapters</p>
              </div>
            </div>
          )}
        </div>

        {(novelMetadata?.views != null || novelMetadata?.stars != null || novelMetadata?.comment_count != null || displayedTotal > 0) && (
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs" style={{ color: secondaryText }}>
            {novelMetadata?.views != null && <StatPill icon={appIcons.eye} value={formatNumber(novelMetadata.views)} isDark={isDark} />}
            {novelMetadata?.stars != null && <StatPill icon={appIcons.checkCircle} value={formatNumber(novelMetadata.stars)} isDark={isDark} />}
            {novelMetadata?.comment_count != null && <StatPill icon={appIcons.comment} value={formatNumber(novelMetadata.comment_count)} isDark={isDark} />}
            {displayedTotal > 0 && <StatPill icon={appIcons.bookOpen} value={`${displayedTotal.toLocaleString()} parts`} isDark={isDark} />}
          </div>
        )}

        {(novelMetadata?.completed != null || novelMetadata?.mature === true) && (
          <div className="flex flex-wrap gap-1.5">
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
          <div className="flex items-center gap-1.5 rounded-lg border px-2.5 py-1.5" style={{ borderColor: isDark ? 'rgba(255,255,255,0.14)' : 'rgba(17,17,17,0.12)', background: isDark ? 'rgba(255,255,255,0.06)' : 'rgba(17,17,17,0.04)' }}>
            <Icon icon={appIcons.book} className="h-4 w-4 shrink-0" style={{ color: isDark ? 'rgba(255,255,255,0.92)' : '#111111' }} />
            <span className="text-xs" style={{ color: isDark ? 'rgba(255,255,255,0.92)' : '#111111' }}>
              This novel has <span className="font-semibold">{totalChapterCount.toLocaleString()} chapters</span>
              {showPartial && <> — showing first {chapterCount}</>}
            </span>
          </div>
        )}

        {warning && <p className="text-xs" style={{ color: isDark ? 'rgba(255,255,255,0.72)' : 'rgba(17,17,17,0.72)' }}>{warning}</p>}
      </div>

      {crawlBlocked && (
        <div className="shrink-0 border-b px-3 py-2.5" style={{ borderColor: panelBorder }}>
          <div className="rounded-lg border p-3" style={{ borderColor: 'rgba(251,191,36,0.24)', background: isDark ? 'rgba(251,191,36,0.08)' : 'rgba(251,191,36,0.05)' }}>
            <div className="flex items-center gap-2 text-sm font-semibold" style={{ color: isDark ? 'rgba(255,255,255,0.92)' : '#111111' }}>
              <LockIcon />
              Wattpad Original
            </div>
            <p className="mt-2 text-xs leading-relaxed" style={{ color: isDark ? 'rgba(255,255,255,0.72)' : 'rgba(17,17,17,0.72)' }}>
              This story contains chapters locked behind Wattpad coins. Crawling is disabled to respect author monetization and Wattpad&apos;s terms of service.
            </p>
            <p className="mt-2 flex items-center gap-1 text-xs" style={{ color: isDark ? 'rgba(255,255,255,0.56)' : 'rgba(17,17,17,0.56)' }}>
              <InfoIcon />
              Free chapters may be available on other sources.
            </p>
          </div>
        </div>
      )}

      {hasPartialPaywall && (
        <div className="shrink-0 border-b px-3 py-2.5" style={{ borderColor: panelBorder }}>
          <div className="rounded-lg border p-3" style={{ borderColor: 'rgba(251,191,36,0.24)', background: isDark ? 'rgba(251,191,36,0.08)' : 'rgba(251,191,36,0.05)' }}>
            <div className="flex items-center gap-2 text-sm font-semibold" style={{ color: isDark ? 'rgba(255,255,255,0.92)' : '#111111' }}>
              <LockIcon />
              Some chapters are paywalled
            </div>
            <p className="mt-2 text-xs leading-relaxed" style={{ color: isDark ? 'rgba(255,255,255,0.72)' : 'rgba(17,17,17,0.72)' }}>
              <span className="font-semibold" style={{ color: isDark ? 'rgb(74 222 128)' : 'rgb(21 128 61)' }}>{(freeChapterCount ?? 0).toLocaleString()} free</span>
              {' · '}
              <span className="font-semibold">{(paidChapterCount ?? 0).toLocaleString()} paid</span>
              {'. '}
              Crawling reads the free chapters and skips the locked ones.
            </p>
            <p className="mt-2 flex items-center gap-1 text-xs" style={{ color: isDark ? 'rgba(255,255,255,0.56)' : 'rgba(17,17,17,0.56)' }}>
              <InfoIcon />
              {authenticated
                ? 'Using your saved login — chapters you have unlocked count as free.'
                : 'Tip: add your login cookies in Settings to unlock more chapters for free.'}
            </p>
          </div>
        </div>
      )}

      <div className="flex-1 overflow-y-auto" style={{ minHeight: '200px' }} ref={tocRef}>
        {chapters.length === 0 ? (
          <div className="flex items-center gap-2 p-4 text-sm" style={{ color: tertiaryText }}>
            <Icon icon={appIcons.file} className="h-4 w-4" />
            No chapters found
          </div>
        ) : (
          <table className="w-full text-sm">
            <thead className="sticky top-0 border-b" style={{ background: panelBackground, borderColor: panelBorder }}>
              <tr>
                <th className="w-12 px-3 py-2 text-left text-[11px] font-semibold uppercase tracking-wide" style={{ color: tertiaryText }}>#</th>
                <th className="px-3 py-2 text-left text-[11px] font-semibold uppercase tracking-wide" style={{ color: tertiaryText }}>Chapter Title</th>
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

      <div className="shrink-0 space-y-2 border-t px-3 py-3 sm:px-4" style={{ borderColor: panelBorder }}>
        {estimatedMax > 0 && (
          <p className="text-center text-xs" style={{ color: tertiaryText }}>
            Range: 1 &ndash; {estimatedMax.toLocaleString()}
          </p>
        )}
        {crawlBlocked ? (
          <p className="text-center text-xs" style={{ color: isDark ? 'rgba(255,255,255,0.72)' : 'rgba(17,17,17,0.72)' }}>
            Crawling unavailable for Wattpad Originals
          </p>
        ) : (
          <div className="flex flex-col gap-2.5">
            <div className="flex items-center gap-2 px-0.5">
              <span className="text-xs" style={{ color: secondaryText }}>Format:</span>
              <span className="rounded-md border px-2 py-0.5 text-xs font-semibold" style={{ background: isDark ? 'rgba(255,255,255,0.08)' : 'rgba(17,17,17,0.05)', borderColor: isDark ? 'rgba(255,255,255,0.14)' : 'rgba(17,17,17,0.12)', color: isDark ? 'rgba(255,255,255,0.92)' : '#111111' }}>
                MD
              </span>
            </div>
            <button
              onClick={() => {
                onCrawlNovel(estimatedMax > 0 ? estimatedMax : totalChapterCount ?? chapterCount);
              }}
              disabled={estimatedMax === 0 && totalChapterCount == null}
              className="flex w-full items-center justify-center gap-2 rounded-lg border px-3 py-2 text-sm font-semibold transition-colors disabled:cursor-not-allowed"
              style={{
                background: estimatedMax === 0 && totalChapterCount == null ? mutedSurface : (isDark ? 'rgba(255,255,255,0.92)' : '#111111'),
                borderColor: estimatedMax === 0 && totalChapterCount == null ? panelBorder : (isDark ? 'rgba(255,255,255,0.92)' : '#111111'),
                color: estimatedMax === 0 && totalChapterCount == null ? secondaryText : (isDark ? '#111111' : '#ffffff'),
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

function CoverImage({ url, title, isDark }: { readonly url?: string; readonly title: string; readonly isDark: boolean }) {
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

function DescriptionBlock({ text, expanded, onToggle, isDark }: { readonly text: string; readonly expanded: boolean; readonly onToggle: () => void; readonly isDark: boolean }) {
  const [tooLong] = useState(text.length > 200);
  return (
    <div>
      <p className={`text-xs leading-relaxed ${expanded ? '' : 'line-clamp-2'}`} style={{ color: isDark ? 'rgba(255,255,255,0.5)' : 'rgba(55,53,47,0.62)' }}>
        {text}
      </p>
      {tooLong && (
        <button onClick={onToggle} className="mt-1 text-xs hover:underline" style={{ color: isDark ? 'rgba(255,255,255,0.92)' : '#111111' }}>
          {expanded ? 'Show less' : 'Show more'}
        </button>
      )}
    </div>
  );
}

function ChapterRow({ chapter, isDark, isLast }: { readonly chapter: ChapterEntry; readonly isDark: boolean; readonly isLast: boolean }) {
  return (
    <tr className="transition-colors" style={{ borderBottom: isLast ? 'none' : `1px solid ${isDark ? 'rgba(255,255,255,0.06)' : 'rgba(55,53,47,0.08)'}` }}>
      <td className="whitespace-nowrap px-4 py-2.5 align-top text-xs font-mono" style={{ color: isDark ? 'rgba(255,255,255,0.34)' : 'rgba(55,53,47,0.42)' }}>
        {chapter.chapter_number}
      </td>
      <td className="px-4 py-2.5 align-top text-xs leading-relaxed" style={{ color: isDark ? 'rgba(255,255,255,0.72)' : 'rgba(55,53,47,0.72)' }}>
        <div className="flex items-center gap-2">
          <span className="block min-w-0 flex-1 truncate" title={chapter.title}>
            {chapter.title || <em className="not-italic" style={{ color: isDark ? 'rgba(255,255,255,0.34)' : 'rgba(55,53,47,0.42)' }}>Untitled</em>}
          </span>
          {chapter.locked === true && (
            <span className="inline-flex shrink-0 items-center gap-1 rounded-md border px-1.5 py-0.5 text-[10px] font-medium" style={{ borderColor: 'rgba(251,191,36,0.3)', background: isDark ? 'rgba(251,191,36,0.1)' : 'rgba(251,191,36,0.08)', color: isDark ? 'rgb(252 211 77)' : 'rgb(180 83 9)' }} title="Paywalled — skipped when crawling">
              <Icon icon={appIcons.paywall} className="h-2.5 w-2.5" />
              Paid
            </span>
          )}
          {chapter.locked === false && (
            <span className="inline-flex shrink-0 items-center rounded-md border px-1.5 py-0.5 text-[10px] font-medium" style={{ borderColor: isDark ? 'rgba(74,222,128,0.28)' : 'rgba(21,128,61,0.25)', background: isDark ? 'rgba(74,222,128,0.1)' : 'rgba(21,128,61,0.06)', color: isDark ? 'rgb(74 222 128)' : 'rgb(21 128 61)' }} title="Free to crawl">
              Free
            </span>
          )}
        </div>
      </td>
    </tr>
  );
}

function StatPill({ icon, value, isDark }: { readonly icon: typeof appIcons.eye; readonly value: string; readonly isDark: boolean }) {
  return (
    <span className="inline-flex items-center gap-1.5 rounded-md border px-2 py-1" style={{ background: isDark ? 'rgba(255,255,255,0.04)' : 'rgba(55,53,47,0.04)', borderColor: isDark ? 'rgba(255,255,255,0.08)' : 'rgba(55,53,47,0.08)' }}>
      <Icon icon={icon} className="h-3.5 w-3.5" style={{ color: isDark ? 'rgba(255,255,255,0.34)' : 'rgba(55,53,47,0.42)' }} />
      {value}
    </span>
  );
}

function BadgeCompleted({ isDark }: { readonly isDark: boolean }) {
  return (
    <span className="inline-flex items-center gap-1.5 rounded-md border px-2.5 py-1 text-xs font-medium" style={{ background: isDark ? 'rgba(255,255,255,0.08)' : 'rgba(17,17,17,0.05)', borderColor: isDark ? 'rgba(255,255,255,0.14)' : 'rgba(17,17,17,0.12)', color: isDark ? 'rgba(255,255,255,0.92)' : '#111111' }}>
      <Icon icon={appIcons.check} className="h-3 w-3" />
      Completed
    </span>
  );
}

function BadgeOngoing({ isDark }: { readonly isDark: boolean }) {
  return <span className="inline-flex items-center rounded-md border px-2.5 py-1 text-xs font-medium" style={{ background: isDark ? 'rgba(255,255,255,0.08)' : 'rgba(17,17,17,0.05)', borderColor: isDark ? 'rgba(255,255,255,0.14)' : 'rgba(17,17,17,0.12)', color: isDark ? 'rgba(255,255,255,0.92)' : '#111111' }}>Ongoing</span>;
}

function BadgeMature({ isDark }: { readonly isDark: boolean }) {
  return <span className="inline-flex items-center rounded-md border px-2.5 py-1 text-xs font-medium" style={{ background: isDark ? 'rgba(239,68,68,0.12)' : 'rgba(239,68,68,0.08)', borderColor: isDark ? 'rgba(239,68,68,0.2)' : 'rgba(239,68,68,0.18)', color: isDark ? '#f87171' : '#dc2626' }}>18+</span>;
}

function LockIcon() {
  return <Icon icon={appIcons.paywall} className="h-4 w-4" />;
}

function InfoIcon() {
  return <Icon icon={appIcons.info} className="h-3.5 w-3.5" />;
}

function NovelInfoPanelSkeleton({ isDetecting, isDark }: { readonly isDetecting: boolean; readonly isDark: boolean }) {
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
            <p className="text-xs font-medium" style={{ color: isDark ? 'rgba(255,255,255,0.92)' : '#111111' }}>Site detected</p>
            <p className="mt-0.5 text-[11px]" style={{ color: secondaryText }}>URL is valid</p>
          </div>
        </div>
        <div className="flex items-start gap-3">
          <div className="flex flex-col items-center">
            <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full" style={{ background: isDark ? 'rgba(255,255,255,0.92)' : '#111111' }}>
              <Icon icon={appIcons.spinner} className="h-4 w-4 animate-spin text-white" />
            </div>
          </div>
          <div className="flex-1 pt-0.5">
            <p className="text-xs font-medium" style={{ color: isDark ? 'rgba(255,255,255,0.92)' : '#111111' }}>
              {isDetecting ? 'Detecting site...' : 'Fetching chapters...'}
            </p>
            <p className="mt-0.5 text-[11px]" style={{ color: secondaryText }}>
              {isDetecting ? 'Checking URL...' : 'This may take up to 20 seconds'}
            </p>
          </div>
        </div>
      </div>
      <div className="space-y-2 px-4 pb-5">
        {(['skeleton-row-0', 'skeleton-row-1', 'skeleton-row-2', 'skeleton-row-3', 'skeleton-row-4', 'skeleton-row-5', 'skeleton-row-6', 'skeleton-row-7'] as const).map((key) => (
          <div key={key} className="flex items-center gap-3 animate-pulse">
            <div className="h-3 w-8 shrink-0 rounded" style={{ background: shimmer }} />
            <div className={`h-3 rounded ${key.endsWith('-0') ? 'w-full' : key.endsWith('-1') ? 'w-11/12' : 'w-10/12'}`} style={{ background: shimmer }} />
          </div>
        ))}
      </div>
    </div>
  );
}
