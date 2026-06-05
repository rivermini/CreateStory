import { useState } from 'react';
import { useLocation, Link } from 'react-router-dom';
import { AppIcon } from './AppIcon';
import { Icon, appIcons } from './Icon';
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
    iconKey: (typeof NAV_ICONS)[keyof typeof NAV_ICONS];
}

interface NavSection {
    label: string;
    items: NavItem[];
}

const NAV_ICONS = {
    '/': 'add',
    '/batch': 'batch',
    '/results/all': 'crawlHistory',
    '/bedread': 'bookOpen',
    '/bedread/jobs': 'audioJobs',
    '/drive-sync': 'sync',
    '/drive-sync/history': 'syncHistory',
    '/drive-sync/content-update': 'contentUpdate',
    '/auto-audio': 'autoAudio',
    '/auto-audio/history': 'syncHistory',
    '/supported-sites': 'supportedSites',
    '/settings': 'settings',
} as const;

const NAV_ITEMS_CRAWL: NavItem[] = [
    { to: '/', label: 'New Crawl', iconKey: NAV_ICONS['/'] },
    { to: '/batch', label: 'Batch', iconKey: NAV_ICONS['/batch'] },
    { to: '/results/all', label: 'Crawl History', iconKey: NAV_ICONS['/results/all'] },
];

const NAV_ITEMS_AUDIO: NavItem[] = [
    { to: '/bedread', label: 'BedReads', iconKey: NAV_ICONS['/bedread'] },
    { to: '/bedread/jobs', label: 'Audio Jobs', iconKey: NAV_ICONS['/bedread/jobs'] },
];

const NAV_ITEMS_BEDREADS: NavItem[] = [
    { to: '/drive-sync', label: 'Drive Sync', iconKey: NAV_ICONS['/drive-sync'] },
    { to: '/drive-sync/content-update', label: 'Content Update', iconKey: NAV_ICONS['/drive-sync/content-update'] },
    { to: '/drive-sync/history', label: 'Sync History', iconKey: NAV_ICONS['/drive-sync/history'] },
];

const NAV_ITEMS_AUTO_AUDIO: NavItem[] = [
    { to: '/auto-audio', label: 'Auto Audio', iconKey: NAV_ICONS['/auto-audio'] },
    { to: '/auto-audio/history', label: 'Auto History', iconKey: NAV_ICONS['/auto-audio/history'] },
];

const NAV_ITEMS_SYSTEM: NavItem[] = [
    { to: '/supported-sites', label: 'Supported Sites', iconKey: NAV_ICONS['/supported-sites'] },
    { to: '/settings', label: 'Settings', iconKey: NAV_ICONS['/settings'] },
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
                        <Icon icon={appIcons[item.iconKey as keyof typeof appIcons]} className="w-5 h-5 flex-shrink-0" />
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
