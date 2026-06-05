import { useState } from 'react';
import React from 'react';
import { useLocation, Link } from 'react-router-dom';
import { AppIcon } from './AppIcon';
import type { ThemeMode } from '../types/theme';

interface SidebarProps {
    themeMode: ThemeMode;
    onThemeChange: (mode: ThemeMode) => void;
}

const PHASE_ACCENT = '#6366f1';

function navActive(locationPath: string, expect: string) {
    if (expect === '/results/all') {
        return locationPath.startsWith('/results');
    }
    if (expect === '/') return locationPath === '/';
    if (expect === '/bedread' && locationPath.startsWith('/bedread/')) return false;
    if (expect === '/drive-sync' && locationPath.startsWith('/drive-sync/')) return false;
    if (expect === '/auto-audio' && locationPath.startsWith('/auto-audio/')) return false;
    return locationPath === expect || locationPath.startsWith(expect + '/') || locationPath.startsWith(expect + '?');
}

interface NavItem {
    to: string;
    label: string;
    icon: React.ReactNode;
}

interface NavSection {
    label: string;
    items: NavItem[];
}

const navIcons: Record<string, React.ReactNode> = {
    '/': (
        <svg className="w-5 h-5 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M12 4v16m8-8H4" />
        </svg>
    ),
    '/batch': (
        <svg className="w-5 h-5 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M19 11H5m14 0a2 2 0 012 2v6a2 2 0 01-2 2H5a2 2 0 01-2-2v-6a2 2 0 012-2m14 0V9a2 2 0 00-2-2M5 11V9a2 2 0 012-2m0 0V5a2 2 0 012-2h6a2 2 0 012 2v2M7 7h10" />
        </svg>
    ),
    '/results/all': (
        <svg className="w-5 h-5 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
        </svg>
    ),
    '/bedread': (
        <svg className="w-5 h-5 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M12 6.253v13m0-13C10.832 5.477 9.246 5 7.5 5S4.168 5.477 3 6.253v13C4.168 18.477 5.754 18 7.5 18s3.332.477 4.5 1.253m0-13C13.168 5.477 14.754 5 16.5 5c1.747 0 3.332.477 4.5 1.253v13C19.832 18.477 18.247 18 16.5 18c-1.746 0-3.332.477-4.5 1.253" />
        </svg>
    ),
    '/bedread/jobs': (
        <svg className="w-5 h-5 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M15.536 8.464a5 5 0 010 7.072m2.828-9.9a9 9 0 010 12.728M5.586 15H4a1 1 0 01-1-1v-4a1 1 0 011-1h1.586l4.707-4.707C10.923 3.663 12 4.109 12 5v14c0 .891-1.077 1.337-1.707.707L5.586 15z" />
        </svg>
    ),
    '/drive-sync': (
        <svg className="w-5 h-5 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M7 16a4 4 0 01-.88-7.903A5 5 0 1115.9 6L16 6a5 5 0 011 9.9M9 19l3-3m0 0l3 3m-3-3v12" />
        </svg>
    ),
    '/drive-sync/history': (
        <svg className="w-5 h-5 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
        </svg>
    ),
    '/drive-sync/content-update': (
        <svg className="w-5 h-5 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M8 7h8M8 11h8m-8 4h5M5 5a2 2 0 012-2h7l5 5v11a2 2 0 01-2 2H7a2 2 0 01-2-2V5z" />
        </svg>
    ),
    '/auto-audio': (
        <svg className="w-5 h-5 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M15.536 8.464a5 5 0 010 7.072m2.828-9.9a9 9 0 010 12.728M5.586 15H4a1 1 0 01-1-1v-4a1 1 0 011-1h1.586l4.707-4.707C10.923 3.663 12 4.109 12 5v14c0 .891-1.077 1.337-1.707.707L5.586 15z" />
        </svg>
    ),
    '/auto-audio/history': (
        <svg className="w-5 h-5 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
        </svg>
    ),
    '/supported-sites': (
        <svg className="w-5 h-5 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M21 12a9 9 0 01-9 9m9-9a9 9 0 00-9-9m9 9H3m9 9a9 9 0 01-9-9m9 9c1.657 0 3-4.03 3-9s-1.343-9-3-9m0 18c-1.657 0 3-4.03 3-9s-1.343-9-3-9m-9 9a9 9 0 019-9" />
        </svg>
    ),
    '/settings': (
        <svg className="w-5 h-5 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z" />
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
        </svg>
    ),
};

const NAV_ITEMS_CRAWL: NavItem[] = [
    { to: '/', label: 'New Crawl', icon: navIcons['/'] },
    { to: '/batch', label: 'Batch', icon: navIcons['/batch'] },
    { to: '/results/all', label: 'Crawl History', icon: navIcons['/results/all'] },
];

const NAV_ITEMS_AUDIO: NavItem[] = [
    { to: '/bedread', label: 'BedReads', icon: navIcons['/bedread'] },
    { to: '/bedread/jobs', label: 'Audio Jobs', icon: navIcons['/bedread/jobs'] },
];

const NAV_ITEMS_BEDREADS: NavItem[] = [
    { to: '/drive-sync', label: 'Drive Sync', icon: navIcons['/drive-sync'] },
    { to: '/drive-sync/content-update', label: 'Content Update', icon: navIcons['/drive-sync/content-update'] },
    { to: '/drive-sync/history', label: 'Sync History', icon: navIcons['/drive-sync/history'] },
];

const NAV_ITEMS_AUTO_AUDIO: NavItem[] = [
    { to: '/auto-audio', label: 'Auto Audio', icon: navIcons['/auto-audio'] },
    { to: '/auto-audio/history', label: 'Auto History', icon: navIcons['/auto-audio/history'] },
];

const NAV_ITEMS_SYSTEM: NavItem[] = [
    { to: '/supported-sites', label: 'Supported Sites', icon: navIcons['/supported-sites'] },
    { to: '/settings', label: 'Settings', icon: navIcons['/settings'] },
];

const NAV_SECTIONS: NavSection[] = [
    { label: 'Novel Crawler', items: NAV_ITEMS_CRAWL },
    { label: 'Audio', items: NAV_ITEMS_AUDIO },
    { label: 'DriveSync', items: NAV_ITEMS_BEDREADS },
    { label: 'Auto Audio', items: NAV_ITEMS_AUTO_AUDIO },
    { label: 'System', items: NAV_ITEMS_SYSTEM },
];

export function Sidebar({ themeMode, onThemeChange: _onThemeChange }: SidebarProps) {
    const location = useLocation();
    const isDark = themeMode === 'dark';

    const activeAccent = PHASE_ACCENT;

    const [hoveredItem, setHoveredItem] = useState<string | null>(null);

    const makeNavItem = (item: NavItem) => {
        const active = navActive(location.pathname, item.to);
        const hovered = hoveredItem === item.to;

        const showHover = hovered && !active;
        const hoverBg = isDark ? 'rgba(255,255,255,0.05)' : 'rgba(15,23,42,0.07)';
        const hoverIconColor = isDark ? 'rgba(255,255,255,0.7)' : 'rgba(15,23,42,0.72)';
        const hoverTextColor = isDark ? 'rgba(255,255,255,0.8)' : 'rgba(15,23,42,0.86)';
        const hoverBorderColor = isDark ? 'rgba(255,255,255,0.08)' : 'rgba(15,23,42,0.14)';

        return (
            <Link
                key={item.to}
                to={item.to}
                className="group relative flex items-center gap-3 transition-all duration-200"
                style={{ textDecoration: 'none' }}
                onMouseEnter={() => setHoveredItem(item.to)}
                onMouseLeave={() => setHoveredItem(null)}
            >
                {/* Active indicator bar */}
                <span
                    className="absolute left-0 top-1/2 -translate-y-1/2 rounded-r-full transition-all duration-300"
                    style={{
                        width: active ? 4 : 0,
                        height: active ? 24 : 0,
                        background: activeAccent,
                        boxShadow: active ? `0 0 10px ${activeAccent}80` : 'none',
                    }}
                />

                {/* Glass card for active / badge state */}
                <span
                    className="relative flex items-center gap-3 rounded-[14px] transition-all duration-200 w-full"
                    style={{
                        padding: '10px 14px',
                        background: active
                            ? `linear-gradient(135deg, ${activeAccent}18, ${activeAccent}10)`
                            : showHover
                            ? hoverBg
                            : 'transparent',
                        border: active
                            ? `1px solid ${activeAccent}30`
                            : showHover
                            ? `1px solid ${hoverBorderColor}`
                            : '1px solid transparent',
                        boxShadow: active
                            ? `0 2px 12px ${activeAccent}15, inset 0 1px 0 rgba(255,255,255,0.05)`
                            : showHover
                            ? `inset 0 1px 0 rgba(255,255,255,0.04)`
                            : 'none',
                    }}
                >
                    <span
                        className="flex-shrink-0 transition-colors duration-200"
                        style={{ color: active ? activeAccent : showHover ? hoverIconColor : (isDark ? 'rgba(255,255,255,0.4)' : 'rgba(15,23,42,0.55)') }}
                    >
                        {item.icon}
                    </span>

                    <span
                        className="text-sm font-medium truncate transition-colors duration-200"
                        style={{ color: active ? (isDark ? 'rgba(255,255,255,0.9)' : 'rgba(15,23,42,0.92)') : showHover ? hoverTextColor : (isDark ? 'rgba(255,255,255,0.45)' : 'rgba(15,23,42,0.66)') }}
                    >
                        {item.label}
                    </span>

                    {active && (
                        <span className="ml-auto">
                            <span
                                className="block rounded-full"
                                style={{ width: 6, height: 6, background: activeAccent, boxShadow: `0 0 6px ${activeAccent}80` }}
                            />
                        </span>
                    )}
                </span>
            </Link>
        );
    };

    return (
        <aside
            className="hidden lg:flex flex-col fixed left-0 top-0 h-screen z-50 transition-all duration-300"
            style={{
                width: 248,
                background: isDark
                    ? 'rgba(15, 15, 35, 0.55)'
                    : 'rgba(248, 250, 252, 0.9)',
                backdropFilter: 'blur(32px) saturate(180%)',
                WebkitBackdropFilter: 'blur(32px) saturate(180%)',
                borderRight: isDark
                    ? '1px solid rgba(255,255,255,0.07)'
                    : '1px solid rgba(15,23,42,0.12)',
                boxShadow: isDark
                    ? '0 16px 48px rgba(0,0,0,0.5), inset 0 1px 0 rgba(255,255,255,0.04)'
                    : '0 18px 48px rgba(15,23,42,0.13), inset 0 1px 0 rgba(255,255,255,0.9)',
            }}
        >
            <div
                className="flex items-center gap-3"
                style={{
                    padding: '20px 16px',
                    borderBottom: isDark ? '1px solid rgba(255,255,255,0.06)' : '1px solid rgba(15,23,42,0.1)',
                }}
            >
                <AppIcon size="xl" className="flex-shrink-0" />
                <div className="flex-1 min-w-0">
                    <h1
                        className="text-base font-bold truncate"
                        style={{ color: isDark ? 'rgba(255,255,255,0.9)' : 'rgba(15,23,42,0.92)' }}
                    >
                        Novel Crawler
                    </h1>
                    <p className="text-xs truncate" style={{ color: isDark ? 'rgba(255,255,255,0.3)' : 'rgba(15,23,42,0.58)' }}>
                        Content Fetcher
                    </p>
                </div>
            </div>

            <nav
                className="flex-1 overflow-y-auto py-4 space-y-5"
                style={{
                    paddingLeft: 12,
                    paddingRight: 12,
                }}
            >
                {NAV_SECTIONS.map((section) => (
                    <div key={section.label}>
                        <p
                            className="px-3 pb-2 text-[0.65rem] font-semibold uppercase tracking-widest"
                            style={{ color: isDark ? 'rgba(255,255,255,0.25)' : 'rgba(15,23,42,0.46)' }}
                        >
                            {section.label}
                        </p>
                        <div className="space-y-0.5">
                            {section.items.map((item) => makeNavItem(item))}
                        </div>
                    </div>
                ))}
            </nav>
{/* 
            <div
                style={{
                    padding: '12px 12px',
                    borderTop: isDark ? '1px solid rgba(255,255,255,0.06)' : '1px solid rgba(15,23,42,0.1)',
                }}
            /> */}
        </aside>
    );
}

export default Sidebar;
