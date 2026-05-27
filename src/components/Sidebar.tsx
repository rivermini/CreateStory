import React from 'react';
import { useLocation, Link } from 'react-router-dom';
import { AppIcon } from './AppIcon';
import { ThemeToggle, type ThemeMode } from './ThemeToggle';

interface SidebarProps {
    themeMode: ThemeMode;
    onThemeChange: (mode: ThemeMode) => void;
    rightActions?: React.ReactNode;
}

function navActive(locationPath: string, expect: string) {
    if (expect === '/results/all') {
        return locationPath.startsWith('/results');
    }
    if (expect === '/') return locationPath === '/';
    // Prevent parent routes from matching their child routes
    if (expect === '/bedread' && locationPath.startsWith('/bedread/')) return false;
    if (expect === '/drive-sync' && locationPath.startsWith('/drive-sync/')) return false;
    if (expect === '/auto-audio' && locationPath.startsWith('/auto-audio/')) return false;
    return locationPath === expect || locationPath.startsWith(expect + '/') || locationPath.startsWith(expect + '?');
}

interface NavItem {
    to: string;
    label: string;
    icon: React.ReactNode;
    section?: string;
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
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M21 12a9 9 0 01-9 9m9-9a9 9 0 00-9-9m9 9H3m9 9a9 9 0 01-9-9m9 9c1.657 0 3-4.03 3-9s-1.343-9-3-9m0 18c-1.657 0-3-4.03-3-9s1.343-9 3-9m-9 9a9 9 0 019-9" />
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
    { to: '/drive-sync/history', label: 'Sync History', icon: navIcons['/drive-sync/history'] },
];

const NAV_ITEMS_AUTO_AUDIO: NavItem[] = [
    { to: '/auto-audio', label: 'Auto Audio', icon: navIcons['/auto-audio'] },
    { to: '/auto-audio/history', label: 'Audio History', icon: navIcons['/auto-audio/history'] },
];

const NAV_ITEMS_SYSTEM: NavItem[] = [
    { to: '/supported-sites', label: 'Supported Sites', icon: navIcons['/supported-sites'] },
    { to: '/settings', label: 'Settings', icon: (
        <svg className="w-5 h-5 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z" />
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
        </svg>
    )},
];

const NAV_SECTIONS = [
    { label: 'Crawl', items: NAV_ITEMS_CRAWL },
    { label: 'Audio', items: NAV_ITEMS_AUDIO },
    { label: 'BedReads', items: NAV_ITEMS_BEDREADS },
    { label: 'Auto Audio', items: NAV_ITEMS_AUTO_AUDIO },
    { label: 'System', items: NAV_ITEMS_SYSTEM },
] as const;

export function Sidebar({ themeMode, onThemeChange, rightActions }: SidebarProps) {
    const location = useLocation();
    const isDark = themeMode === 'dark';

    const makeNavItem = (item: NavItem) => {
        const active = navActive(location.pathname, item.to);
        const baseClass = 'group flex items-center gap-3 rounded-xl transition-all duration-200';

        return (
            <Link
                key={item.to}
                to={item.to}
                className={`${baseClass} ${
                    active
                        ? isDark
                            ? 'bg-indigo-600/20 text-indigo-400'
                            : 'bg-indigo-50 text-indigo-700'
                        : isDark
                            ? 'text-slate-400 hover:text-slate-100 hover:bg-slate-800/60'
                            : 'text-gray-500 hover:text-gray-900 hover:bg-gray-100/80'
                } ${'px-4 py-2.5'}`}
                title={undefined}
            >
                <span className="flex-shrink-0">{item.icon}</span>
                <span className="text-sm font-medium truncate">{item.label}</span>
                {active && (
                    <span className="ml-auto w-1.5 h-1.5 rounded-full bg-indigo-500" />
                )}
            </Link>
        );
    };

    return (
        <aside
            className={`hidden lg:flex flex-col fixed left-0 top-0 h-screen z-50 transition-all duration-300 w-64 ${
                isDark
                    ? 'bg-slate-900/80 border-r border-slate-800/80'
                    : 'bg-white/80 border-r border-gray-200/80 backdrop-blur-xl'
            }`}
        >
            {/* Brand */}
            <div className={`flex items-center gap-3 px-4 py-5 border-b ${
                isDark ? 'border-slate-800' : 'border-gray-200'
            }`}>
                <AppIcon size="xl" className="flex-shrink-0" />
                <div className="min-w-0">
                        <h1 className={`text-lg font-bold truncate ${
                            isDark ? 'text-slate-100' : 'text-gray-900'
                        }`}>
                            Novel Crawler
                        </h1>
                        <p className={`text-xs truncate ${
                            isDark ? 'text-slate-500' : 'text-gray-400'
                        }`}>
                            Content Fetcher
                        </p>
                    </div>
            </div>

            {/* Nav */}
            <nav className={`flex-1 overflow-y-auto py-4 px-3 space-y-4 scrollbar-thin ${
                isDark ? 'scrollbar-slate-700' : 'scrollbar-gray-300'
            }`}>
                {NAV_SECTIONS.map((section) => (
                    <div key={section.label}>
                        <p className={`px-4 pb-2 text-xs font-semibold uppercase tracking-wider ${
                            isDark ? 'text-slate-600' : 'text-gray-400'
                        }`}>
                            {section.label}
                        </p>
                        <div className="space-y-1">
                            {section.items.map((item) => makeNavItem(item))}
                        </div>
                    </div>
                ))}
            </nav>

            {/* Bottom: Theme */}
            <div className={`border-t px-3 py-4 ${
                isDark ? 'border-slate-800' : 'border-gray-200'
            }`}>
                {rightActions && (
                    <div className="mb-2">{rightActions}</div>
                )}
                <ThemeToggle mode={themeMode} onChange={onThemeChange} />
            </div>
        </aside>
    );
}

export default Sidebar;
