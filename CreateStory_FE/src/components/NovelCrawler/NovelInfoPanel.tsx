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

  if (isChapterUrl) return null;

  if (isLoading || isDetecting) {
    return <NovelInfoPanelSkeleton isDetecting={isDetecting} />;
  }

  if (error) {
    return (
      <div className="rounded-xl border border-[var(--cs-border)] bg-[var(--cs-surface)] p-4 space-y-2">
        <div className="flex items-center gap-2 text-[var(--cs-danger)]">
          <Icon icon={appIcons.info} className="h-4 w-4 shrink-0" />
          <span className="text-sm font-medium">Could not load chapters</span>
        </div>
        <p className="pl-6 text-xs text-[var(--cs-text-faint)]">{error}</p>
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
    <div className="flex max-h-[calc(100vh-4.5rem)] flex-col overflow-hidden rounded-xl border border-[var(--cs-border)] bg-[var(--cs-surface)]">
      {/* Header: Cover + Title + Stats */}
      <div className="shrink-0 space-y-2.5 border-b border-[var(--cs-border)] px-4 py-3">
        <div className="flex items-start gap-2.5">
          <CoverImage url={novelMetadata?.cover_url} title={panelTitle} />
          <div className="min-w-0 flex-1">
            <h3 className="text-sm font-semibold leading-snug text-[var(--cs-text)]" title={panelTitle}>
              {panelTitle}
            </h3>
            {novelMetadata?.author_fullname && (
              <p className="mt-0.5 truncate text-xs text-[var(--cs-text-soft)]">by {novelMetadata.author_fullname}</p>
            )}
            {novelMetadata?.author && !novelMetadata.author_fullname && (
              <p className="mt-0.5 text-xs text-[var(--cs-text-faint)]">@{novelMetadata.author}</p>
            )}
            {!novelMetadata?.author_fullname && !novelMetadata?.author && siteName && (
              <p className="mt-0.5 text-xs text-[var(--cs-text-faint)]">{siteName}</p>
            )}
            {novelMetadata?.season_current != null && (
              <p className="mt-0.5 text-xs text-[var(--cs-text)]">
                Season {novelMetadata.season_current}
                {novelMetadata.season_total != null && ` of ${novelMetadata.season_total}`}
              </p>
            )}
          </div>
          {displayedTotal > 0 && (
            <div className="shrink-0 text-right">
              <div className="rounded-lg border border-[var(--cs-border)] bg-[var(--cs-surface-muted)] px-3 py-1">
                <p className="flex items-center justify-end gap-1 text-sm font-semibold leading-none text-[var(--cs-text)]">
                  {showPartial ? `${chapterCount} / ${totalChapterCount?.toLocaleString()}` : displayedTotal.toLocaleString()}
                </p>
                <p className="mt-0.5 text-[9px] leading-none text-center text-[var(--cs-text-muted)]">chapters</p>
              </div>
            </div>
          )}
        </div>

        {/* Stats row */}
        {(novelMetadata?.views != null || novelMetadata?.stars != null || novelMetadata?.comment_count != null || displayedTotal > 0) && (
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-[var(--cs-text-muted)]">
            {novelMetadata?.views != null && <StatItem icon={appIcons.eye} value={formatNumber(novelMetadata.views)} />}
            {novelMetadata?.stars != null && <StatItem icon={appIcons.checkCircle} value={formatNumber(novelMetadata.stars)} />}
            {novelMetadata?.comment_count != null && <StatItem icon={appIcons.comment} value={formatNumber(novelMetadata.comment_count)} />}
            {displayedTotal > 0 && <StatItem icon={appIcons.bookOpen} value={`${displayedTotal.toLocaleString()} parts`} />}
          </div>
        )}

        {/* Badges */}
        {(novelMetadata?.completed != null || novelMetadata?.mature === true) && (
          <div className="flex flex-wrap gap-1.5">
            {novelMetadata.completed === true && (
              <span className="inline-flex items-center gap-1.5 rounded-md border border-[var(--cs-border)] bg-[var(--cs-surface-muted)] px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-[var(--cs-text)]">
                <Icon icon={appIcons.check} className="h-2.5 w-2.5" /> Completed
              </span>
            )}
            {novelMetadata.completed === false && (
              <span className="inline-flex items-center rounded-md border border-[var(--cs-border)] bg-[var(--cs-surface-muted)] px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-[var(--cs-text)]">
                Ongoing
              </span>
            )}
            {novelMetadata.mature === true && (
              <span className="inline-flex items-center rounded-md border px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider" style={{ background: 'rgba(220,38,38,0.08)', borderColor: 'rgba(220,38,38,0.16)', color: 'var(--cs-danger)' }}>
                18+
              </span>
            )}
          </div>
        )}

        {/* Description */}
        {novelMetadata?.description && (
          <DescriptionBlock text={novelMetadata.description} expanded={descExpanded} onToggle={() => setDescExpanded((value) => !value)} />
        )}

        {/* Tags */}
        {novelMetadata?.tags && novelMetadata.tags.length > 0 && (
          <div className="flex flex-wrap gap-1.5">
            {novelMetadata.tags.slice(0, 12).map((tag) => (
              <span key={tag} className="rounded-md border border-[var(--cs-border)] bg-[var(--cs-surface-muted)] px-2 py-0.5 text-[11px] text-[var(--cs-text-muted)]">
                {tag}
              </span>
            ))}
            {novelMetadata.tags.length > 12 && (
              <span className="rounded-md border border-[var(--cs-border)] px-2 py-0.5 text-[11px] text-[var(--cs-text-faint)]">
                +{novelMetadata.tags.length - 12} more
              </span>
            )}
          </div>
        )}

        {/* Chapter summary */}
        {totalChapterCount != null && (
          <div className="flex items-center gap-1.5 rounded-lg border border-[var(--cs-border)] bg-[var(--cs-surface-muted)] px-3 py-2">
            <Icon icon={appIcons.book} className="h-4 w-4 shrink-0 text-[var(--cs-text)]" />
            <span className="text-xs text-[var(--cs-text)]">
              This novel has <span className="font-semibold">{totalChapterCount.toLocaleString()} chapters</span>
              {showPartial && <> — showing first {chapterCount}</>}
            </span>
          </div>
        )}

        {warning && <p className="text-xs text-[var(--cs-text-muted)]">{warning}</p>}
      </div>

      {/* Crawl blocked notice */}
      {crawlBlocked && (
        <div className="shrink-0 border-b border-[var(--cs-border)] px-3 py-2.5">
          <div className="rounded-lg border p-3" style={{ borderColor: 'rgba(251,191,36,0.24)', background: isDark ? 'rgba(251,191,36,0.08)' : 'rgba(251,191,36,0.05)' }}>
            <div className="flex items-center gap-2 text-sm font-semibold text-[var(--cs-text)]">
              <Icon icon={appIcons.paywall} className="h-4 w-4" />
              Wattpad Original
            </div>
            <p className="mt-2 text-xs leading-relaxed text-[var(--cs-text-muted)]">
              This story contains chapters locked behind Wattpad coins. Crawling is disabled to respect author monetization and Wattpad&apos;s terms of service.
            </p>
            <p className="mt-2 flex items-center gap-1 text-xs text-[var(--cs-text-faint)]">
              <Icon icon={appIcons.info} className="h-3.5 w-3.5" />
              Free chapters may be available on other sources.
            </p>
          </div>
        </div>
      )}

      {/* Partial paywall notice */}
      {hasPartialPaywall && (
        <div className="shrink-0 border-b border-[var(--cs-border)] px-3 py-2.5">
          <div className="rounded-lg border p-3" style={{ borderColor: 'rgba(251,191,36,0.24)', background: isDark ? 'rgba(251,191,36,0.08)' : 'rgba(251,191,36,0.05)' }}>
            <div className="flex items-center gap-2 text-sm font-semibold text-[var(--cs-text)]">
              <Icon icon={appIcons.paywall} className="h-4 w-4" />
              Some chapters are paywalled
            </div>
            <p className="mt-2 text-xs leading-relaxed text-[var(--cs-text-muted)]">
              <span className="font-semibold text-[var(--cs-success)]">{(freeChapterCount ?? 0).toLocaleString()} free</span>
              {' · '}
              <span className="font-semibold">{(paidChapterCount ?? 0).toLocaleString()} paid</span>
              {'. '}
              Crawling reads the free chapters and skips the locked ones.
            </p>
            <p className="mt-2 flex items-center gap-1 text-xs text-[var(--cs-text-faint)]">
              <Icon icon={appIcons.info} className="h-3.5 w-3.5" />
              {authenticated
                ? 'Using your saved login — chapters you have unlocked count as free.'
                : 'Tip: add your login cookies in Settings to unlock more chapters for free.'}
            </p>
          </div>
        </div>
      )}

      {/* Chapter table */}
      <div className="flex-1 overflow-y-auto" style={{ minHeight: '200px' }} ref={tocRef}>
        {chapters.length === 0 ? (
          <div className="flex items-center gap-2 p-4 text-sm text-[var(--cs-text-faint)]">
            <Icon icon={appIcons.file} className="h-4 w-4" />
            No chapters found
          </div>
        ) : (
          <table className="w-full text-sm">
            <thead className="sticky top-0 border-b border-[var(--cs-border)] bg-[var(--cs-surface)]">
              <tr>
                <th className="w-12 px-3 py-2 text-left text-[10px] font-bold uppercase tracking-wider text-[var(--cs-text-muted)]">#</th>
                <th className="px-3 py-2 text-left text-[10px] font-bold uppercase tracking-wider text-[var(--cs-text-muted)]">Chapter Title</th>
              </tr>
            </thead>
            <tbody>
              {chapters.map((chapter, index) => (
                <ChapterRow key={chapter.url} chapter={chapter} isLast={index === chapters.length - 1} />
              ))}
            </tbody>
          </table>
        )}
      </div>

      {/* Footer: Crawl action */}
      <div className="shrink-0 space-y-2 border-t border-[var(--cs-border)] px-4 py-3">
        {estimatedMax > 0 && (
          <p className="text-center text-xs text-[var(--cs-text-faint)]">
            Range: 1 &ndash; {estimatedMax.toLocaleString()}
          </p>
        )}
        {crawlBlocked ? (
          <p className="text-center text-xs text-[var(--cs-text-muted)]">
            Crawling unavailable for Wattpad Originals
          </p>
        ) : (
          <div className="flex flex-col gap-2.5">
            <div className="flex items-center gap-2 px-0.5">
              <span className="text-xs text-[var(--cs-text-muted)]">Format:</span>
              <span className="rounded-md border border-[var(--cs-border)] bg-[var(--cs-surface-muted)] px-2 py-0.5 text-xs font-semibold text-[var(--cs-text)]">
                MD
              </span>
            </div>
            <button
              onClick={() => {
                onCrawlNovel(estimatedMax > 0 ? estimatedMax : totalChapterCount ?? chapterCount);
              }}
              disabled={estimatedMax === 0 && totalChapterCount == null}
              className="flex w-full items-center justify-center gap-2 rounded-lg border border-[var(--cs-active)] bg-[var(--cs-active)] px-3 py-2 text-sm font-semibold text-[var(--cs-active-text)] transition-colors hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50"
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

function CoverImage({ url, title }: { readonly url?: string; readonly title: string }) {
  const [failed, setFailed] = useState(false);
  if (!url || failed) {
    return (
      <div className="flex h-20 w-16 shrink-0 items-center justify-center rounded-lg border border-[var(--cs-border)] bg-[var(--cs-surface-muted)]">
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
      className="h-20 w-16 shrink-0 rounded-lg border border-[var(--cs-border)] object-cover"
    />
  );
}

function DescriptionBlock({ text, expanded, onToggle }: { readonly text: string; readonly expanded: boolean; readonly onToggle: () => void }) {
  const [tooLong] = useState(text.length > 200);
  return (
    <div>
      <p className={`text-xs leading-relaxed text-[var(--cs-text-muted)] ${expanded ? '' : 'line-clamp-2'}`}>
        {text}
      </p>
      {tooLong && (
        <button onClick={onToggle} className="mt-1 text-xs text-[var(--cs-text)] hover:underline">
          {expanded ? 'Show less' : 'Show more'}
        </button>
      )}
    </div>
  );
}

function ChapterRow({ chapter, isLast }: { readonly chapter: ChapterEntry; readonly isLast: boolean }) {
  return (
    <tr className={`transition-colors hover:bg-[var(--cs-surface-muted)]/50 ${isLast ? '' : 'border-b border-[var(--cs-border)]'}`}>
      <td className="whitespace-nowrap px-4 py-2.5 align-top text-xs font-mono text-[var(--cs-text-faint)]">
        {chapter.chapter_number}
      </td>
      <td className="px-4 py-2.5 align-top text-xs leading-relaxed text-[var(--cs-text-soft)]">
        <div className="flex items-center gap-2">
          <span className="block min-w-0 flex-1 truncate" title={chapter.title}>
            {chapter.title || <em className="not-italic text-[var(--cs-text-faint)]">Untitled</em>}
          </span>
          {chapter.locked === true && (
            <span className="inline-flex shrink-0 items-center gap-1 rounded-md border px-1.5 py-0.5 text-[10px] font-medium" style={{ borderColor: 'rgba(251,191,36,0.3)', background: 'rgba(251,191,36,0.08)', color: 'var(--cs-warning, rgb(180 83 9))' }} title="Paywalled — skipped when crawling">
              <Icon icon={appIcons.paywall} className="h-2.5 w-2.5" />
              Paid
            </span>
          )}
          {chapter.locked === false && (
            <span className="inline-flex shrink-0 items-center rounded-md border px-1.5 py-0.5 text-[10px] font-medium text-[var(--cs-success)]" style={{ borderColor: 'rgba(21,128,61,0.25)', background: 'rgba(21,128,61,0.06)' }} title="Free to crawl">
              Free
            </span>
          )}
        </div>
      </td>
    </tr>
  );
}

function StatItem({ icon, value }: { readonly icon: typeof appIcons.eye; readonly value: string }) {
  return (
    <span className="inline-flex items-center gap-1.5">
      <Icon icon={icon} className="h-3.5 w-3.5 text-[var(--cs-text-faint)]" />
      {value}
    </span>
  );
}

function NovelInfoPanelSkeleton({ isDetecting }: { readonly isDetecting: boolean }) {
  return (
    <div className="overflow-hidden rounded-xl border border-[var(--cs-border)] bg-[var(--cs-surface)]">
      <div className="space-y-3 border-b border-[var(--cs-border)] px-4 py-4">
        <div className="flex items-start gap-3">
          <div className="h-20 w-16 animate-pulse rounded-lg bg-[var(--cs-surface-muted)]" />
          <div className="flex-1 space-y-2 pt-1">
            <div className="h-4 w-3/4 animate-pulse rounded bg-[var(--cs-surface-muted)]" />
            <div className="h-3 w-1/3 animate-pulse rounded bg-[var(--cs-surface-muted)]" />
          </div>
        </div>
      </div>
      <div className="space-y-4 px-4 py-5">
        <div className="flex items-start gap-3">
          <div className="flex flex-col items-center">
            <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-[var(--cs-success)]">
              <Icon icon={appIcons.check} className="h-4 w-4 text-white" />
            </div>
          </div>
          <div className="flex-1 pt-0.5">
            <p className="text-xs font-medium text-[var(--cs-text)]">Site detected</p>
            <p className="mt-0.5 text-[11px] text-[var(--cs-text-faint)]">URL is valid</p>
          </div>
        </div>
        <div className="flex items-start gap-3">
          <div className="flex flex-col items-center">
            <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-[var(--cs-text)]">
              <Icon icon={appIcons.spinner} className="h-4 w-4 animate-spin text-white" />
            </div>
          </div>
          <div className="flex-1 pt-0.5">
            <p className="text-xs font-medium text-[var(--cs-text)]">
              {isDetecting ? 'Detecting site...' : 'Fetching chapters...'}
            </p>
            <p className="mt-0.5 text-[11px] text-[var(--cs-text-faint)]">
              {isDetecting ? 'Checking URL...' : 'This may take up to 20 seconds'}
            </p>
          </div>
        </div>
      </div>
      <div className="space-y-2 px-4 pb-5">
        {(['skeleton-row-0', 'skeleton-row-1', 'skeleton-row-2', 'skeleton-row-3', 'skeleton-row-4', 'skeleton-row-5', 'skeleton-row-6', 'skeleton-row-7'] as const).map((key) => (
          <div key={key} className="flex items-center gap-3 animate-pulse">
            <div className="h-3 w-8 shrink-0 rounded bg-[var(--cs-surface-muted)]" />
            <div className={`h-3 rounded bg-[var(--cs-surface-muted)] ${key.endsWith('-0') ? 'w-full' : key.endsWith('-1') ? 'w-11/12' : 'w-10/12'}`} />
          </div>
        ))}
      </div>
    </div>
  );
}
