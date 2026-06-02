import React, { useEffect, useRef, useState } from 'react';
import type { ChapterEntry, NovelMetadata } from '../api/client';
import { formatNumber } from '../api/client';

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
        : chapters.length > 0 ? Math.max(...chapters.map(c => c.chapter_number)) : 0;
    const estimatedMax = totalChapterCount ?? displayedTotal;
    const panelTitle = novelMetadata?.title || storyTitle || 'Novel Info';

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

    const handleTouchStart = (e: React.TouchEvent) => {
        startY.current = e.touches[0].clientY;
        currentY.current = e.touches[0].clientY;
    };

    const handleTouchMove = (e: React.TouchEvent) => {
        currentY.current = e.touches[0].clientY;
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
                    backdropFilter: 'blur(8px)',
                    opacity: isExpanded ? 1 : 0,
                    pointerEvents: isExpanded ? 'auto' : 'none',
                }}
                onClick={onClose}
            />

            <div
                ref={sheetRef}
                className="fixed left-0 right-0 z-50 shadow-2xl transition-transform duration-300 ease-out"
                style={{
                    background: isDark ? 'rgba(15,15,35,0.92)' : 'rgba(255,255,255,0.92)',
                    backdropFilter: 'blur(32px) saturate(180%)',
                    borderTop: `1px solid ${isDark ? 'rgba(255,255,255,0.08)' : 'rgba(0,0,0,0.08)'}`,
                    borderRadius: '24px 24px 0 0',
                    maxHeight: '85vh',
                    bottom: 0,
                    transform: isExpanded ? 'translateY(0)' : 'translateY(100%)',
                }}
                onTouchStart={handleTouchStart}
                onTouchMove={handleTouchMove}
                onTouchEnd={handleTouchEnd}
            >
                <div className="flex justify-center py-3 cursor-pointer" onClick={onClose}>
                    <div className="w-10 h-1 rounded-full" style={{ background: isDark ? 'rgba(255,255,255,0.2)' : 'rgba(0,0,0,0.2)' }} />
                </div>

                <div className="overflow-y-auto px-4 pb-8" style={{ maxHeight: 'calc(85vh - 40px)' }}>
                    <div className="flex items-start gap-3 mb-4">
                        {novelMetadata?.cover_url && (
                            <img
                                src={novelMetadata.cover_url}
                                alt={`Cover for ${panelTitle}`}
                                className="w-20 h-24 rounded-xl object-cover flex-shrink-0"
                                style={{ border: `1px solid ${isDark ? 'rgba(255,255,255,0.06)' : 'rgba(0,0,0,0.06)'}` }}
                                onError={(e) => e.currentTarget.style.display = 'none'}
                            />
                        )}
                        <div className="flex-1 min-w-0">
                            <h3 className={`text-base font-semibold leading-snug ${isDark ? 'text-white/85' : 'text-black/85'}`}>
                                {panelTitle}
                            </h3>
                            {novelMetadata?.author_fullname && (
                                <p className={`text-sm mt-0.5 ${isDark ? 'text-white/45' : 'text-black/45'}`}>
                                    by {novelMetadata.author_fullname}
                                </p>
                            )}
                            {displayedTotal > 0 && (
                                <div className="inline-flex items-center gap-1.5 mt-2 px-2.5 py-1 rounded-lg text-xs font-semibold" style={{ background: isDark ? 'rgba(99,102,241,0.15)' : 'rgba(99,102,241,0.08)', color: isDark ? '#818cf8' : '#6366f1', border: `1px solid ${isDark ? 'rgba(99,102,241,0.3)' : 'rgba(99,102,241,0.2)'}` }}>
                                    {displayedTotal.toLocaleString()} chapters
                                </div>
                            )}
                        </div>
                    </div>

                    {(novelMetadata?.views != null || novelMetadata?.stars != null || novelMetadata?.comment_count != null) && (
                        <div className={`flex flex-wrap items-center gap-x-4 gap-y-1 text-sm mb-4 ${isDark ? 'text-white/45' : 'text-black/45'}`}>
                            {novelMetadata?.views != null && <StatItem icon="eye" value={formatNumber(novelMetadata.views)} isDark={isDark} />}
                            {novelMetadata?.stars != null && <StatItem icon="star" value={formatNumber(novelMetadata.stars)} isDark={isDark} />}
                            {novelMetadata?.comment_count != null && <StatItem icon="comment" value={formatNumber(novelMetadata.comment_count)} isDark={isDark} />}
                        </div>
                    )}

                    {(novelMetadata?.completed != null || novelMetadata?.mature === true) && (
                        <div className="flex flex-wrap gap-2 mb-4">
                            {novelMetadata.completed === true && <span className="lg-chip lg-chip-green">Completed</span>}
                            {novelMetadata.completed === false && <span className="lg-chip lg-chip-amber">Ongoing</span>}
                            {novelMetadata.mature === true && <span className="lg-chip lg-chip-red">18+</span>}
                        </div>
                    )}

                    {novelMetadata?.description && (
                        <div className="mb-4">
                            <p className={`text-sm leading-relaxed ${descExpanded ? '' : 'line-clamp-3'} ${isDark ? 'text-white/45' : 'text-black/45'}`}>
                                {novelMetadata.description}
                            </p>
                            {novelMetadata.description.length > 200 && (
                                <button
                                    onClick={() => setDescExpanded(v => !v)}
                                    className={`text-sm mt-1 ${isDark ? 'text-indigo-400 hover:underline' : 'text-indigo-600 hover:underline'}`}
                                >
                                    {descExpanded ? 'Show less' : 'Show more'}
                                </button>
                            )}
                        </div>
                    )}

                    {novelMetadata?.tags && novelMetadata.tags.length > 0 && (
                        <div className="flex flex-wrap gap-2 mb-4">
                            {novelMetadata.tags.slice(0, 8).map(tag => (
                                <span key={tag} className="lg-chip" style={isDark ? { background: 'rgba(255,255,255,0.06)', borderColor: 'rgba(255,255,255,0.1)', color: 'rgba(255,255,255,0.5)' } : { background: 'rgba(0,0,0,0.04)', borderColor: 'rgba(0,0,0,0.08)', color: 'rgba(0,0,0,0.6)' }}>
                                    {tag}
                                </span>
                            ))}
                        </div>
                    )}

                    {isPaywalled && (
                        <div className="lg-glass p-4 mb-4" style={{ border: '1px solid rgba(251,191,36,0.25)', background: isDark ? 'rgba(251,191,36,0.08)' : 'rgba(251,191,36,0.05)' }}>
                            <div className={`flex items-center gap-2 font-semibold text-sm ${isDark ? 'text-amber-400' : 'text-amber-700'}`}>
                                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z" />
                                </svg>
                                Wattpad Original
                            </div>
                            <p className={`text-xs leading-relaxed mt-2 ${isDark ? 'text-amber-200/70' : 'text-amber-800/70'}`}>
                                Crawling disabled for Wattpad Original stories.
                            </p>
                        </div>
                    )}

                    {chapters.length > 0 && (
                        <div className="lg-glass-card mb-4" style={{ borderRadius: 16 }}>
                            <div className="px-4 py-3" style={{ borderBottom: `1px solid ${isDark ? 'rgba(255,255,255,0.06)' : 'rgba(0,0,0,0.06)'}` }}>
                                <h4 className={`text-sm font-semibold ${isDark ? 'text-white/85' : 'text-black/85'}`}>Chapters</h4>
                            </div>
                            <div className="max-h-60 overflow-y-auto">
                                {chapters.slice(0, 30).map(chapter => (
                                    <div key={chapter.url} className="px-4 py-2.5" style={{ borderBottom: `1px solid ${isDark ? 'rgba(255,255,255,0.06)' : 'rgba(0,0,0,0.06)'}` }}>
                                        <span className={`text-xs font-mono mr-2 ${isDark ? 'text-white/30' : 'text-black/30'}`}>{chapter.chapter_number}</span>
                                        <span className={`text-sm ${isDark ? 'text-white/65' : 'text-black/65'}`}>{chapter.title || 'Untitled'}</span>
                                    </div>
                                ))}
                                {chapters.length > 30 && (
                                    <div className={`px-4 py-2.5 text-center text-xs ${isDark ? 'text-white/30' : 'text-black/30'}`}>
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
                            className={estimatedMax === 0 && totalChapterCount == null ? 'lg-btn-ghost w-full opacity-50 cursor-not-allowed' : 'lg-btn-primary w-full'}
                            style={{ padding: '14px', fontSize: '1rem', justifyContent: 'center', display: 'flex', alignItems: 'center', gap: '8px', fontWeight: 600, borderRadius: '16px', border: 'none' }}
                        >
                            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 10V3L4 14h7v7l9-11h-7z" />
                            </svg>
                            Crawl All Chapters
                        </button>
                    )}
                </div>
            </div>
        </>
    );
}

function StatItem({ icon, value, isDark }: { icon: 'eye' | 'star' | 'comment'; value: string; isDark: boolean }) {
    const svgs = {
        eye: <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z" />,
        star: <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11.049 2.927c.3-.921 1.603-.921 1.902 0l1.519 4.674a1 1 0 00.95.69h4.915c.969 0 1.371 1.24.588 1.81l-3.976 2.888a1 1 0 00-.363 1.118l1.518 4.674c.3.922-.755 1.688-1.538 1.118l-3.976-2.888a1 1 0 00-1.176 0l-3.976 2.888c-.783.57-1.838-.197-1.538-1.118l1.518-4.674a1 1 0 00-.363-1.118l-3.976-2.888c-.784-.57-.38-1.81.588-1.81h4.914a1 1 0 00.951-.69l1.519-4.674z" />,
        comment: <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z" />,
    };
    return (
        <span className="flex items-center gap-1">
            <svg className={`w-4 h-4 ${isDark ? 'text-white/30' : 'text-black/30'}`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
                {svgs[icon]}
            </svg>
            {value}
        </span>
    );
}

export default MobileBottomSheet;
