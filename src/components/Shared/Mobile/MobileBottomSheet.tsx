import React, { useEffect, useRef, useState } from 'react';
import type { ChapterEntry, NovelMetadata } from '../../../api/client';
import { formatNumber } from '../../../api/client';
import { Icon, appIcons } from '../Icon';

interface MobileBottomSheetProps {
  isOpen: boolean;
  onClose: () => void;
  storyTitle: string | null;
  chapters: ChapterEntry[];
  chapterCount: number;
  totalChapterCount: number | null;
  novelMetadata: NovelMetadata | null | undefined;
  onCrawlNovel: (toChapter: number) => void;
  isDark: boolean;
}

export function MobileBottomSheet({
  isOpen,
  onClose,
  storyTitle,
  chapters,
  chapterCount,
  totalChapterCount,
  novelMetadata,
  onCrawlNovel,
  isDark,
}: MobileBottomSheetProps) {
  const [isExpanded, setIsExpanded] = useState(false);
  const [descExpanded, setDescExpanded] = useState(false);
  const sheetRef = useRef<HTMLDivElement>(null);
  const startY = useRef<number>(0);
  const currentY = useRef<number>(0);

  const isPaywalled = novelMetadata?.is_paywalled === true;
  const displayedTotal = totalChapterCount != null
    ? totalChapterCount
    : chapters.length > 0
      ? Math.max(...chapters.map((chapter) => chapter.chapter_number))
      : 0;
  const estimatedMax = totalChapterCount ?? displayedTotal;
  const panelTitle = novelMetadata?.title || storyTitle || 'Novel Info';
  const panelBackground = isDark ? '#202020' : '#ffffff';
  const panelBorder = isDark ? 'rgba(255,255,255,0.08)' : 'rgba(55,53,47,0.12)';
  const mutedSurface = isDark ? 'rgba(255,255,255,0.05)' : 'rgba(55,53,47,0.05)';
  const subtleSurface = isDark ? 'rgba(255,255,255,0.03)' : 'rgba(55,53,47,0.03)';
  const pageText = isDark ? 'rgba(255,255,255,0.92)' : '#37352f';
  const secondaryText = isDark ? 'rgba(255,255,255,0.5)' : 'rgba(55,53,47,0.62)';
  const tertiaryText = isDark ? 'rgba(255,255,255,0.34)' : 'rgba(55,53,47,0.42)';

  useEffect(() => {
    if (!isOpen) {
      setIsExpanded(false);
      setDescExpanded(false);
    }
  }, [isOpen]);

  useEffect(() => {
    if (isOpen && !isExpanded) {
      const timer = setTimeout(() => setIsExpanded(true), 50);
      return () => clearTimeout(timer);
    }
  }, [isOpen, isExpanded]);

  const handleTouchStart = (event: React.TouchEvent) => {
    startY.current = event.touches[0].clientY;
    currentY.current = event.touches[0].clientY;
  };

  const handleTouchMove = (event: React.TouchEvent) => {
    currentY.current = event.touches[0].clientY;
  };

  const handleTouchEnd = () => {
    const diff = currentY.current - startY.current;
    if (diff > 100) {
      onClose();
    }
  };

  if (!isOpen) return null;

  return (
    <>
      <div
        className="fixed inset-0 z-40 transition-opacity duration-300"
        style={{
          backgroundColor: 'rgba(0,0,0,0.4)',
          backdropFilter: 'blur(6px)',
          opacity: isExpanded ? 1 : 0,
          pointerEvents: isExpanded ? 'auto' : 'none',
        }}
        onClick={onClose}
      />

      <div
        ref={sheetRef}
        className="fixed bottom-0 left-0 right-0 z-50 transition-transform duration-300 ease-out"
        style={{
          background: panelBackground,
          borderTop: `1px solid ${panelBorder}`,
          borderRadius: '24px 24px 0 0',
          maxHeight: '85vh',
          transform: isExpanded ? 'translateY(0)' : 'translateY(100%)',
          boxShadow: isDark ? '0 -24px 64px rgba(0,0,0,0.55)' : '0 -24px 64px rgba(0,0,0,0.16)',
        }}
        onTouchStart={handleTouchStart}
        onTouchMove={handleTouchMove}
        onTouchEnd={handleTouchEnd}
      >
        <div className="flex cursor-pointer justify-center py-3" onClick={onClose}>
          <div className="h-1 w-10 rounded-full" style={{ background: isDark ? 'rgba(255,255,255,0.2)' : 'rgba(55,53,47,0.2)' }} />
        </div>

        <div className="overflow-y-auto px-4 pb-8" style={{ maxHeight: 'calc(85vh - 40px)' }}>
          <div className="mb-4 flex items-start gap-3">
            <MobileCoverImage url={novelMetadata?.cover_url} title={panelTitle} isDark={isDark} />
            <div className="min-w-0 flex-1">
              <h3 className="text-base font-semibold leading-snug" style={{ color: pageText }}>
                {panelTitle}
              </h3>
              {novelMetadata?.author_fullname && (
                <p className="mt-0.5 text-sm" style={{ color: secondaryText }}>by {novelMetadata.author_fullname}</p>
              )}
              {displayedTotal > 0 && (
                <div className="mt-2 inline-flex items-center gap-1.5 rounded-lg border px-2.5 py-1 text-xs font-semibold" style={{ background: isDark ? 'rgba(99,102,241,0.12)' : 'rgba(99,102,241,0.06)', color: isDark ? '#a5b4fc' : '#4338ca', borderColor: isDark ? 'rgba(99,102,241,0.22)' : 'rgba(99,102,241,0.18)' }}>
                  {displayedTotal.toLocaleString()} chapters
                </div>
              )}
            </div>
          </div>

          {(novelMetadata?.views != null || novelMetadata?.stars != null || novelMetadata?.comment_count != null) && (
            <div className="mb-4 flex flex-wrap items-center gap-x-4 gap-y-1 text-sm" style={{ color: secondaryText }}>
              {novelMetadata?.views != null && <StatItem icon={appIcons.eye} value={formatNumber(novelMetadata.views)} isDark={isDark} />}
              {novelMetadata?.stars != null && <StatItem icon={appIcons.checkCircle} value={formatNumber(novelMetadata.stars)} isDark={isDark} />}
              {novelMetadata?.comment_count != null && <StatItem icon={appIcons.comment} value={formatNumber(novelMetadata.comment_count)} isDark={isDark} />}
            </div>
          )}

          {(novelMetadata?.completed != null || novelMetadata?.mature === true) && (
            <div className="mb-4 flex flex-wrap gap-2">
              {novelMetadata.completed === true && <span className="inline-flex items-center gap-1.5 rounded-md border px-2.5 py-1 text-xs font-medium" style={{ background: isDark ? 'rgba(52,211,153,0.14)' : 'rgba(5,150,105,0.08)', borderColor: isDark ? 'rgba(52,211,153,0.24)' : 'rgba(5,150,105,0.18)', color: isDark ? '#34d399' : '#059669' }}>Completed</span>}
              {novelMetadata.completed === false && <span className="inline-flex items-center rounded-md border px-2.5 py-1 text-xs font-medium" style={{ background: 'rgba(245,158,11,0.12)', borderColor: 'rgba(245,158,11,0.2)', color: isDark ? '#fbbf24' : '#b45309' }}>Ongoing</span>}
              {novelMetadata.mature === true && <span className="inline-flex items-center rounded-md border px-2.5 py-1 text-xs font-medium" style={{ background: isDark ? 'rgba(239,68,68,0.12)' : 'rgba(239,68,68,0.08)', borderColor: isDark ? 'rgba(239,68,68,0.2)' : 'rgba(239,68,68,0.18)', color: isDark ? '#f87171' : '#dc2626' }}>18+</span>}
            </div>
          )}

          {novelMetadata?.description && (
            <div className="mb-4">
              <p className={`text-sm leading-relaxed ${descExpanded ? '' : 'line-clamp-3'}`} style={{ color: secondaryText }}>
                {novelMetadata.description}
              </p>
              {novelMetadata.description.length > 200 && (
                <button onClick={() => setDescExpanded((value) => !value)} className="mt-1 text-sm hover:underline" style={{ color: isDark ? '#818cf8' : '#4f46e5' }}>
                  {descExpanded ? 'Show less' : 'Show more'}
                </button>
              )}
            </div>
          )}

          {novelMetadata?.tags && novelMetadata.tags.length > 0 && (
            <div className="mb-4 flex flex-wrap gap-2">
              {novelMetadata.tags.slice(0, 8).map((tag) => (
                <span key={tag} className="rounded-md border px-2 py-0.5 text-xs" style={{ background: mutedSurface, borderColor: panelBorder, color: secondaryText }}>
                  {tag}
                </span>
              ))}
            </div>
          )}

          {isPaywalled && (
            <div className="mb-4 rounded-xl border p-4" style={{ borderColor: 'rgba(251,191,36,0.24)', background: isDark ? 'rgba(251,191,36,0.08)' : 'rgba(251,191,36,0.05)' }}>
              <div className="flex items-center gap-2 text-sm font-semibold" style={{ color: isDark ? '#fbbf24' : '#b45309' }}>
                <Icon icon={appIcons.paywall} className="h-4 w-4" />
                Wattpad Original
              </div>
              <p className="mt-2 text-xs leading-relaxed" style={{ color: isDark ? 'rgba(253,230,138,0.78)' : 'rgba(146,64,14,0.78)' }}>
                Crawling disabled for Wattpad Original stories.
              </p>
            </div>
          )}

          {chapters.length > 0 && (
            <div className="mb-4 overflow-hidden rounded-2xl border" style={{ background: subtleSurface, borderColor: panelBorder }}>
              <div className="border-b px-4 py-3" style={{ borderColor: panelBorder }}>
                <h4 className="text-sm font-semibold" style={{ color: pageText }}>Chapters</h4>
              </div>
              <div className="max-h-60 overflow-y-auto">
                {chapters.slice(0, 30).map((chapter, index) => (
                  <div key={chapter.url} className="px-4 py-2.5" style={{ borderBottom: index === Math.min(chapters.length, 30) - 1 ? 'none' : `1px solid ${panelBorder}` }}>
                    <span className="mr-2 text-xs font-mono" style={{ color: tertiaryText }}>{chapter.chapter_number}</span>
                    <span className="text-sm" style={{ color: secondaryText }}>{chapter.title || 'Untitled'}</span>
                  </div>
                ))}
                {chapters.length > 30 && (
                  <div className="px-4 py-2.5 text-center text-xs" style={{ color: tertiaryText }}>
                    + {chapters.length - 30} more chapters
                  </div>
                )}
              </div>
            </div>
          )}

          {!isPaywalled && (
            <button
              onClick={() => {
                onCrawlNovel(estimatedMax > 0 ? estimatedMax : totalChapterCount ?? chapterCount);
                onClose();
              }}
              disabled={estimatedMax === 0 && totalChapterCount == null}
              className="flex w-full items-center justify-center gap-2 rounded-2xl border px-4 py-3.5 text-base font-semibold transition-colors disabled:cursor-not-allowed"
              style={{
                background: estimatedMax === 0 && totalChapterCount == null ? mutedSurface : '#4f46e5',
                borderColor: estimatedMax === 0 && totalChapterCount == null ? panelBorder : '#4f46e5',
                color: estimatedMax === 0 && totalChapterCount == null ? secondaryText : '#ffffff',
                opacity: estimatedMax === 0 && totalChapterCount == null ? 0.5 : 1,
              }}
            >
              <Icon icon={appIcons.trends} className="h-5 w-5" />
              Crawl All Chapters
            </button>
          )}
        </div>
      </div>
    </>
  );
}

function MobileCoverImage({ url, title, isDark }: { url?: string; title: string; isDark: boolean }) {
  const [hidden, setHidden] = useState(false);

  if (!url || hidden) {
    return (
      <div className="flex h-24 w-20 shrink-0 items-center justify-center rounded-xl border" style={{ background: isDark ? 'rgba(255,255,255,0.05)' : 'rgba(55,53,47,0.05)', borderColor: isDark ? 'rgba(255,255,255,0.08)' : 'rgba(55,53,47,0.12)' }}>
        <span className="text-2xl">&#128214;</span>
      </div>
    );
  }

  return (
    <img
      src={url}
      alt={`Cover for ${title}`}
      className="h-24 w-20 shrink-0 rounded-xl object-cover"
      style={{ border: `1px solid ${isDark ? 'rgba(255,255,255,0.08)' : 'rgba(55,53,47,0.12)'}` }}
      onError={() => setHidden(true)}
    />
  );
}

function StatItem({ icon, value, isDark }: { icon: typeof appIcons.eye; value: string; isDark: boolean }) {
  return (
    <span className="inline-flex items-center gap-1.5 rounded-md border px-2 py-1" style={{ background: isDark ? 'rgba(255,255,255,0.04)' : 'rgba(55,53,47,0.04)', borderColor: isDark ? 'rgba(255,255,255,0.08)' : 'rgba(55,53,47,0.08)' }}>
      <Icon icon={icon} className="h-4 w-4" style={{ color: isDark ? 'rgba(255,255,255,0.34)' : 'rgba(55,53,47,0.42)' }} />
      {value}
    </span>
  );
}

export default MobileBottomSheet;
