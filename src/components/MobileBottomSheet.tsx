import React, { useEffect, useRef, useState } from 'react';
import type { ChapterEntry, NovelMetadata } from '../api/client';
import { formatNumber } from '../api/client';

interface MobileBottomSheetProps {
    isOpen: boolean;
    onClose: () => void;
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
    isDark: boolean;
}

export function MobileBottomSheet({
    isOpen,
    onClose,
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
            {/* Backdrop */}
            <div
                className={`fixed inset-0 z-40 bg-black/40 backdrop-blur-sm transition-opacity duration-300 ${
                    isExpanded ? 'opacity-100' : 'opacity-0 pointer-events-none'
                }`}
                onClick={onClose}
            />

            {/* Sheet */}
            <div
                ref={sheetRef}
                className={`fixed left-0 right-0 z-50 rounded-t-2xl shadow-2xl transition-transform duration-300 ease-out ${
                    isExpanded ? 'translate-y-0' : 'translate-y-full'
                } ${isDark
                    ? 'bg-slate-900/98 border-t border-slate-800/80'
                    : 'bg-white/98 border-t border-gray-200/80'
                }`}
                style={{ maxHeight: '85vh', bottom: 0 }}
                onTouchStart={handleTouchStart}
                onTouchMove={handleTouchMove}
                onTouchEnd={handleTouchEnd}
            >
                {/* Drag Handle */}
                <div className="flex justify-center py-3 cursor-pointer" onClick={onClose}>
                    <div className={`w-10 h-1 rounded-full ${isDark ? 'bg-slate-700' : 'bg-gray-300'}`} />
                </div>

                {/* Content */}
                <div className="overflow-y-auto px-4 pb-8" style={{ maxHeight: 'calc(85vh - 40px)' }}>
                    {/* Header */}
                    <div className="flex items-start gap-3 mb-4">
                        {/* Cover image */}
                        {novelMetadata?.cover_url && (
                            <img
                                src={novelMetadata.cover_url}
                                alt={`Cover for ${panelTitle}`}
                                className="w-20 h-24 rounded-xl object-cover flex-shrink-0 border border-transparent"
                                onError={(e) => e.currentTarget.style.display = 'none'}
                            />
                        )}
                        <div className="flex-1 min-w-0">
                            <h3 className={`text-base font-semibold leading-snug ${isDark ? 'text-slate-100' : 'text-gray-900'}`}>
                                {panelTitle}
                            </h3>
                            {novelMetadata?.author_fullname && (
                                <p className={`text-sm mt-0.5 ${isDark ? 'text-slate-400' : 'text-gray-600'}`}>
                                    by {novelMetadata.author_fullname}
                                </p>
                            )}
                            {displayedTotal > 0 && (
                                <div className={`inline-flex items-center gap-1.5 mt-2 px-2.5 py-1 rounded-lg text-xs font-semibold ${isDark
                                    ? 'bg-indigo-900/30 text-indigo-300 border border-indigo-800/40'
                                    : 'bg-indigo-50 text-indigo-700 border border-indigo-200'
                                }`}>
                                    {displayedTotal.toLocaleString()} chapters
                                </div>
                            )}
                        </div>
                    </div>

                    {/* Stats row */}
                    {(novelMetadata?.views != null || novelMetadata?.stars != null || novelMetadata?.comment_count != null) && (
                        <div className={`flex flex-wrap items-center gap-x-4 gap-y-1 text-sm mb-4 ${isDark ? 'text-slate-400' : 'text-gray-600'}`}>
                            {novelMetadata?.views != null && (
                                <span className="flex items-center gap-1">
                                    <svg className={`w-4 h-4 ${isDark ? 'text-slate-500' : 'text-gray-400'}`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
                                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z" />
                                    </svg>
                                    {formatNumber(novelMetadata.views)}
                                </span>
                            )}
                            {novelMetadata?.stars != null && (
                                <span className="flex items-center gap-1">
                                    <svg className={`w-4 h-4 ${isDark ? 'text-slate-500' : 'text-gray-400'}`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11.049 2.927c.3-.921 1.603-.921 1.902 0l1.519 4.674a1 1 0 00.95.69h4.915c.969 0 1.371 1.24.588 1.81l-3.976 2.888a1 1 0 00-.363 1.118l1.518 4.674c.3.922-.755 1.688-1.538 1.118l-3.976-2.888a1 1 0 00-1.176 0l-3.976 2.888c-.783.57-1.838-.197-1.538-1.118l1.518-4.674a1 1 0 00-.363-1.118l-3.976-2.888c-.784-.57-.38-1.81.588-1.81h4.914a1 1 0 00.951-.69l1.519-4.674z" />
                                    </svg>
                                    {formatNumber(novelMetadata.stars)}
                                </span>
                            )}
                            {novelMetadata?.comment_count != null && (
                                <span className="flex items-center gap-1">
                                    <svg className={`w-4 h-4 ${isDark ? 'text-slate-500' : 'text-gray-400'}`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z" />
                                    </svg>
                                    {formatNumber(novelMetadata.comment_count)}
                                </span>
                            )}
                        </div>
                    )}

                    {/* Status badges */}
                    {(novelMetadata?.completed != null || novelMetadata?.mature === true) && (
                        <div className="flex flex-wrap gap-2 mb-4">
                            {novelMetadata.completed === true && (
                                <span className={`flex items-center gap-1 px-2.5 py-1 rounded-lg text-xs font-medium ${isDark
                                    ? 'bg-emerald-900/30 text-emerald-400 border border-emerald-800/40'
                                    : 'bg-emerald-100 text-emerald-700 border border-emerald-200'
                                }`}>
                                    Completed
                                </span>
                            )}
                            {novelMetadata.completed === false && (
                                <span className={`flex items-center gap-1 px-2.5 py-1 rounded-lg text-xs font-medium ${isDark
                                    ? 'bg-amber-900/30 text-amber-400 border border-amber-800/40'
                                    : 'bg-amber-100 text-amber-700 border border-amber-200'
                                }`}>
                                    Ongoing
                                </span>
                            )}
                            {novelMetadata.mature === true && (
                                <span className={`px-2.5 py-1 rounded-lg text-xs font-medium ${isDark
                                    ? 'bg-red-900/30 text-red-400 border border-red-800/40'
                                    : 'bg-red-100 text-red-700 border border-red-200'
                                }`}>
                                    18+
                                </span>
                            )}
                        </div>
                    )}

                    {/* Description */}
                    {novelMetadata?.description && (
                        <div className="mb-4">
                            <p className={`text-sm leading-relaxed ${descExpanded ? '' : 'line-clamp-3'} ${isDark ? 'text-slate-400' : 'text-gray-600'}`}>
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

                    {/* Tags */}
                    {novelMetadata?.tags && novelMetadata.tags.length > 0 && (
                        <div className="flex flex-wrap gap-2 mb-4">
                            {novelMetadata.tags.slice(0, 8).map(tag => (
                                <span
                                    key={tag}
                                    className={`px-2 py-1 text-xs rounded-lg ${isDark
                                        ? 'bg-slate-800/60 text-slate-300 border border-slate-700/50'
                                        : 'bg-gray-100 text-gray-700'
                                    }`}
                                >
                                    {tag}
                                </span>
                            ))}
                        </div>
                    )}

                    {/* Paywall warning */}
                    {isPaywalled && (
                        <div className={`rounded-xl p-4 mb-4 ${isDark
                            ? 'bg-amber-900/30 border border-amber-800/40'
                            : 'bg-amber-100 border border-amber-200'
                        }`}>
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

                    {/* Chapters list */}
                    {chapters.length > 0 && (
                        <div className={`rounded-xl border mb-4 ${isDark ? 'border-slate-800/60' : 'border-gray-200'}`}>
                            <div className={`px-4 py-3 border-b ${isDark ? 'border-slate-800/60' : 'border-gray-200'}`}>
                                <h4 className={`text-sm font-semibold ${isDark ? 'text-slate-200' : 'text-gray-900'}`}>
                                    Chapters
                                </h4>
                            </div>
                            <div className="max-h-60 overflow-y-auto">
                                {chapters.slice(0, 30).map(chapter => (
                                    <div
                                        key={chapter.url}
                                        className={`px-4 py-2.5 border-b last:border-b-0 ${isDark
                                            ? 'border-slate-800/60'
                                            : 'border-gray-200'
                                        }`}
                                    >
                                        <span className={`text-xs font-mono mr-2 ${isDark ? 'text-slate-500' : 'text-gray-500'}`}>
                                            {chapter.chapter_number}
                                        </span>
                                        <span className={`text-sm ${isDark ? 'text-slate-300' : 'text-gray-700'}`}>
                                            {chapter.title || 'Untitled'}
                                        </span>
                                    </div>
                                ))}
                                {chapters.length > 30 && (
                                    <div className={`px-4 py-2.5 text-center text-xs ${isDark ? 'text-slate-500' : 'text-gray-500'}`}>
                                        + {chapters.length - 30} more chapters
                                    </div>
                                )}
                            </div>
                        </div>
                    )}

                    {/* Action Button */}
                    {!isPaywalled && (
                        <button
                            onClick={() => {
                                onCrawlNovel(estimatedMax > 0 ? estimatedMax : totalChapterCount ?? chapterCount);
                                onClose();
                            }}
                            disabled={estimatedMax === 0 && totalChapterCount == null}
                            className={`w-full py-4 rounded-xl transition-all duration-200 flex items-center justify-center gap-2 font-semibold text-base shadow-lg ${
                                estimatedMax === 0 && totalChapterCount == null
                                    ? isDark
                                        ? 'bg-slate-800 text-slate-500 cursor-not-allowed shadow-none'
                                        : 'bg-gray-200 text-gray-500 cursor-not-allowed shadow-none'
                                    : 'bg-emerald-600 hover:bg-emerald-500 text-white shadow-lg shadow-emerald-600/30'
                            }`}
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

export default MobileBottomSheet;
