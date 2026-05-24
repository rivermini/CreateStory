import React, { useState } from 'react';
import { useLocation, Link, useNavigate } from 'react-router-dom';
import { AppIcon } from './AppIcon';

interface MobileNavProps {
    isDark: boolean;
}

function navActive(locationPath: string, expect: string) {
    if (expect === '/results/all') {
        return locationPath.startsWith('/results');
    }
    if (expect === '/') return locationPath === '/';
    return locationPath === expect || locationPath.startsWith(expect + '/') || locationPath.startsWith(expect + '?');
}

const MAIN_NAV_ITEMS = [
    { to: '/', label: 'New Crawl', icon: (
        <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M12 4v16m8-8H4" />
        </svg>
    )},
    { to: '/batch', label: 'Batch', icon: (
        <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M19 11H5m14 0a2 2 0 012 2v6a2 2 0 01-2 2H5a2 2 0 01-2-2v-6a2 2 0 012-2m14 0V9a2 2 0 00-2-2M5 11V9a2 2 0 012-2m0 0V5a2 2 0 012-2h6a2 2 0 012 2v2M7 7h10" />
        </svg>
    )},
    { to: '/results/all', label: 'History', icon: (
        <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
        </svg>
    )},
    { to: '/drive-sync', label: 'Drive', icon: (
        <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M7 16a4 4 0 01-.88-7.903A5 5 0 1115.9 6L16 6a5 5 0 011 9.9M9 19l3-3m0 0l3 3m-3-3v12" />
        </svg>
    )},
    { to: '/drive-sync/history', label: 'Sync', icon: (
        <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
        </svg>
    )},
    { to: '/story-mgmt', label: 'Stories', icon: (
        <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M12 6.253v13m0-13C10.832 5.477 9.246 5 7.5 5S4.168 5.477 3 6.253v13C4.168 18.477 5.754 18 7.5 18s3.332.477 4.5 1.253m0-13C13.168 5.477 14.754 5 16.5 5c1.747 0 3.332.477 4.5 1.253v13C19.832 18.477 18.247 18 16.5 18c-1.746 0-3.332.477-4.5 1.253" />
        </svg>
    )},
];

export function MobileNav({ isDark }: MobileNavProps) {
    const location = useLocation();

    return (
        <nav className={`lg:hidden fixed bottom-0 left-0 right-0 z-50 safe-area-bottom ${isDark
            ? 'bg-slate-900/95 border-t border-slate-800/80 backdrop-blur-xl'
            : 'bg-white/95 border-t border-gray-200/80 backdrop-blur-xl shadow-lg'
        }`}>
            <div className="flex items-center justify-around px-2 py-1">
                {MAIN_NAV_ITEMS.map((item) => {
                    const active = navActive(location.pathname, item.to);
                    return (
                        <Link
                            key={item.to}
                            to={item.to}
                            className={`flex flex-col items-center gap-0.5 px-3 py-2 min-w-[56px] transition-all duration-200 ${
                                active
                                    ? isDark
                                        ? 'text-indigo-400'
                                        : 'text-indigo-600'
                                    : isDark
                                        ? 'text-slate-500'
                                        : 'text-gray-500'
                            }`}
                        >
                            <span className="relative">
                                {item.icon}
                                {active && (
                                    <span className={`absolute -top-1 -right-1 w-1.5 h-1.5 rounded-full ${
                                        isDark ? 'bg-indigo-400' : 'bg-indigo-600'
                                    }`} />
                                )}
                            </span>
                            <span className="text-[10px] font-medium truncate max-w-full">{item.label}</span>
                        </Link>
                    );
                })}
            </div>
        </nav>
    );
}

interface MobileHeaderProps {
    isDark: boolean;
    onMenuOpen: () => void;
}

export function MobileHeader({ isDark, onMenuOpen }: MobileHeaderProps) {
    return (
        <header className={`lg:hidden fixed top-0 left-0 right-0 z-40 safe-area-top ${isDark
            ? 'bg-slate-900/95 border-b border-slate-800/80 backdrop-blur-xl'
            : 'bg-white/95 border-b border-gray-200/80 backdrop-blur-xl shadow-sm'
        }`}>
            <div className="flex items-center justify-between px-4 py-3">
                <div className="flex items-center gap-2">
                    <AppIcon size="md" className="flex-shrink-0" />
                    <div>
                        <h1 className={`text-base font-bold leading-tight ${isDark ? 'text-slate-100' : 'text-gray-900'}`}>
                            Novel Crawler
                        </h1>
                    </div>
                </div>
                <div className="flex items-center gap-2">
                    <Link
                        to="/settings"
                        className={`p-2 rounded-lg transition-colors ${isDark
                            ? 'text-slate-400 hover:text-slate-200 hover:bg-slate-800/60'
                            : 'text-gray-500 hover:text-gray-700 hover:bg-gray-100/80'
                        }`}
                    >
                        <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z" />
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
                        </svg>
                    </Link>
                </div>
            </div>
        </header>
    );
}

interface MobileDrawerProps {
    isOpen: boolean;
    onClose: () => void;
    isDark: boolean;
}

export function MobileDrawer({ isOpen, onClose, isDark }: MobileDrawerProps) {
    const location = useLocation();

    if (!isOpen) return null;

    const SECONDARY_NAV_ITEMS = [
        { to: '/drive-sync', label: 'Drive Sync', icon: (
            <svg className="w-5 h-5 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M7 16a4 4 0 01-.88-7.903A5 5 0 1115.9 6L16 6a5 5 0 011 9.9M9 19l3-3m0 0l3 3m-3-3v12" />
            </svg>
        )},
        { to: '/drive-sync/history', label: 'Sync History', icon: (
            <svg className="w-5 h-5 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
            </svg>
        )},
        { to: '/settings', label: 'Settings', icon: (
            <svg className="w-5 h-5 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z" />
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
            </svg>
        )},
        { to: '/supported-sites', label: 'Supported Sites', icon: (
            <svg className="w-5 h-5 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M21 12a9 9 0 01-9 9m9-9a9 9 0 00-9-9m9 9H3m9 9a9 9 0 01-9-9m9 9c1.657 0 3-4.03 3-9s-1.343-9-3-9m0 18c-1.657 0-3-4.03-3-9s1.343-9 3-9m-9 9a9 9 0 019-9" />
            </svg>
        )},
    ];

    return (
        <>
            {/* Backdrop */}
            <div
                className="lg:hidden fixed inset-0 z-40 bg-black/50 backdrop-blur-sm transition-opacity"
                onClick={onClose}
            />

            {/* Drawer */}
            <div className={`lg:hidden fixed top-0 right-0 h-full w-72 z-50 shadow-2xl transform transition-transform duration-300 ease-out ${
                isOpen ? 'translate-x-0' : 'translate-x-full'
            } ${isDark
                ? 'bg-slate-900/95 border-l border-slate-800/80'
                : 'bg-white/95 border-l border-gray-200/80'
            }`}>
                {/* Header */}
                <div className={`flex items-center justify-between px-4 py-4 border-b ${isDark ? 'border-slate-800' : 'border-gray-200'}`}>
                    <div className="flex items-center gap-3">
                        <AppIcon size="lg" className="flex-shrink-0" />
                        <div>
                            <h2 className={`text-lg font-bold ${isDark ? 'text-slate-100' : 'text-gray-900'}`}>
                                Menu
                            </h2>
                        </div>
                    </div>
                    <button
                        onClick={onClose}
                        className={`p-2 rounded-lg transition-colors ${isDark
                            ? 'text-slate-400 hover:text-slate-200 hover:bg-slate-800/60'
                            : 'text-gray-500 hover:text-gray-700 hover:bg-gray-100'
                        }`}
                    >
                        <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                        </svg>
                    </button>
                </div>

                {/* Nav Items */}
                <nav className={`p-4 space-y-1`}>
                    <p className={`px-3 pb-2 text-xs font-semibold uppercase tracking-wider ${isDark ? 'text-slate-600' : 'text-gray-400'}`}>
                        More
                    </p>
                    {SECONDARY_NAV_ITEMS.map((item) => {
                        const active = navActive(location.pathname, item.to);
                        return (
                            <Link
                                key={item.to}
                                to={item.to}
                                onClick={onClose}
                                className={`flex items-center gap-3 px-3 py-3 rounded-xl transition-all duration-200 ${
                                    active
                                        ? isDark
                                            ? 'bg-indigo-600/20 text-indigo-400'
                                            : 'bg-indigo-50 text-indigo-700'
                                        : isDark
                                            ? 'text-slate-400 hover:text-slate-100 hover:bg-slate-800/60'
                                            : 'text-gray-500 hover:text-gray-900 hover:bg-gray-100/80'
                                }`}
                            >
                                {item.icon}
                                <span className="text-sm font-medium">{item.label}</span>
                                {active && (
                                    <span className="ml-auto w-1.5 h-1.5 rounded-full bg-indigo-500" />
                                )}
                            </Link>
                        );
                    })}
                </nav>
            </div>
        </>
    );
}

export default MobileNav;
