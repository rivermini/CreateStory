import React, { useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { AppIcon } from './AppIcon';
import { ThemeToggle, type ThemeMode } from './ThemeToggle';

interface HeaderProps {
    themeMode: ThemeMode;
    onThemeChange: (mode: ThemeMode) => void;
    rightActions?: React.ReactNode;
    title?: React.ReactNode;
    subtitle?: React.ReactNode;
}

function navActive(locationPath: string, expect: string) {
    // Results stays active for any /results/* route
    if (expect === '/results/all') {
        return locationPath.startsWith('/results');
    }
    if (expect === '/') return locationPath === '/';
    return locationPath === expect || locationPath.startsWith(expect + '/') || locationPath.startsWith(expect + '?');
}

interface NavItem {
    to: string;
    label: string;
    icon?: React.ReactNode;
}

const NAV_ITEMS: NavItem[] = [
    { to: '/', label: 'New Crawl' },
    { to: '/batch', label: 'Batch' },
    { to: '/results/all', label: 'Results' },
    {
        to: '/drive-sync',
        label: 'Drive Sync',
    },
    {
        to: '/drive-sync/history',
        label: 'Sync History',
    },
    {
        to: '/story-mgmt',
        label: 'Story Mgmt',
    },
];

export function Header({ themeMode, onThemeChange, rightActions, title, subtitle }: HeaderProps) {
    const navigate = useNavigate();
    const location = useLocation();
    const [mobileMenuOpen, setMobileMenuOpen] = useState(false);

    const makeBtn = (item: NavItem) => {
        const active = navActive(location.pathname, item.to);
        return (
            <button
                key={item.to}
                onClick={() => {
                    navigate(item.to);
                    setMobileMenuOpen(false);
                }}
                className={
                    'w-full sm:w-auto px-3 py-2 text-sm rounded-lg transition-colors text-left sm:text-center ' +
                    (active
                        ? 'bg-indigo-600 text-white'
                        : 'text-slate-300 md:bg-slate-600/30 hover:bg-slate-700')
                }
            >
                <span className="flex items-center gap-2">
                    {item.icon}
                    {item.label}
                </span>
            </button>
        );
    };

    return (
        <header className="border-b border-slate-800 bg-slate-950 sticky top-0 z-50">
            <div className="w-full max-w-none mx-auto px-4 sm:px-6 py-3 sm:py-4">
                <div className="flex items-center justify-between gap-3">
                    {/* Left: Logo + Title */}
                    <div className="flex items-center gap-3 min-w-0">
                        <AppIcon size="lg" className="flex-shrink-0" />
                        <div className="min-w-0">
                            {title ? (
                                <h1 className="text-base sm:text-lg font-semibold text-slate-100">{title}</h1>
                            ) : (
                                <h1 className="text-base sm:text-lg font-semibold text-slate-100">Novel Crawler</h1>
                            )}
                            {subtitle && <p className="text-xs text-slate-500 hidden sm:block">{subtitle}</p>}
                        </div>
                    </div>

                    {/* Right: Desktop nav + actions */}
                    <div className="hidden md:flex items-center gap-2 flex-shrink-0">
                        {NAV_ITEMS.map(makeBtn)}
                        {rightActions}
                        <ThemeToggle mode={themeMode} onChange={onThemeChange} />
                    </div>

                    {/* Mobile: Theme toggle + hamburger */}
                    <div className="flex md:hidden items-center gap-2 flex-shrink-0">
                        <ThemeToggle mode={themeMode} onChange={onThemeChange} />
                        <button
                            onClick={() => setMobileMenuOpen(!mobileMenuOpen)}
                            className="p-2 text-slate-400 hover:text-slate-200 hover:bg-slate-800 rounded-lg transition-colors"
                            aria-label="Toggle menu"
                        >
                            {mobileMenuOpen ? (
                                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                                </svg>
                            ) : (
                                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 6h16M4 12h16M4 18h16" />
                                </svg>
                            )}
                        </button>
                    </div>
                </div>

                {/* Mobile dropdown menu */}
                {mobileMenuOpen && (
                    <div className="md:hidden pt-3 pb-2 border-t border-slate-800 mt-3 space-y-1">
                        {NAV_ITEMS.map(makeBtn)}
                        {rightActions && (
                            <div className="pt-2 border-t border-slate-800">
                                {rightActions}
                            </div>
                        )}
                    </div>
                )}
            </div>
        </header>
    );
}

export default Header;
