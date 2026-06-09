import { useState } from 'react';
import { useLocation, Link } from 'react-router-dom';
import { AppIcon } from '../AppIcon';
import { Icon, appIcons } from '../Icon';
import type { ThemeMode } from '../../../types/theme';

interface MobileSidebarProps {
    themeMode: ThemeMode;
    onThemeChange: (mode: ThemeMode) => void;
    isSettingsOpen: boolean;
    onOpenSettings: () => void;
    isOpen: boolean;
    onClose: () => void;
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
    iconKey: (typeof NAV_ICONS_MOBILE)[keyof typeof NAV_ICONS_MOBILE];
}

interface NavSection {
    label: string;
    items: NavItem[];
}

const NAV_ICONS_MOBILE = {
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

const NAV_SECTIONS: NavSection[] = [
    {
        label: 'Crawl',
        items: [
            { to: '/', label: 'New Crawl', iconKey: NAV_ICONS_MOBILE['/'] },
            { to: '/batch', label: 'Batch', iconKey: NAV_ICONS_MOBILE['/batch'] },
            { to: '/results/all', label: 'Crawl History', iconKey: NAV_ICONS_MOBILE['/results/all'] },
        ],
    },
    {
        label: 'Audio',
        items: [
            { to: '/bedread', label: 'BedReads', iconKey: NAV_ICONS_MOBILE['/bedread'] },
            { to: '/bedread/jobs', label: 'Audio Jobs', iconKey: NAV_ICONS_MOBILE['/bedread/jobs'] },
        ],
    },
    {
        label: 'BedReads',
        items: [
            { to: '/drive-sync', label: 'Drive Sync', iconKey: NAV_ICONS_MOBILE['/drive-sync'] },
            { to: '/drive-sync/content-update', label: 'Content Update', iconKey: NAV_ICONS_MOBILE['/drive-sync/content-update'] },
            { to: '/drive-sync/history', label: 'Sync History', iconKey: NAV_ICONS_MOBILE['/drive-sync/history'] },
        ],
    },
    {
        label: 'Auto Audio',
        items: [
            { to: '/auto-audio', label: 'Auto Audio', iconKey: NAV_ICONS_MOBILE['/auto-audio'] },
            { to: '/auto-audio/history', label: 'Audio History', iconKey: NAV_ICONS_MOBILE['/auto-audio/history'] },
        ],
    },
    {
        label: 'System',
        items: [
            { to: '/supported-sites', label: 'Supported Sites', iconKey: NAV_ICONS_MOBILE['/supported-sites'] },
            { to: '/settings', label: 'Settings', iconKey: NAV_ICONS_MOBILE['/settings'] },
        ],
    },
];

export function MobileSidebar({ themeMode, onThemeChange: _onThemeChange, isSettingsOpen, onOpenSettings, isOpen, onClose }: MobileSidebarProps) {
    const location = useLocation();
    const isDark = themeMode === 'dark';

    const activeAccent = PHASE_ACCENT;

    const [hoveredItem, setHoveredItem] = useState<string | null>(null);

    const makeNavItem = (item: NavItem) => {
        const active = item.to === '/settings' ? isSettingsOpen : navActive(location.pathname, item.to);
        const hovered = hoveredItem === item.to;

        const showHover = hovered && !active;
        const hoverBg = isDark ? 'rgba(255,255,255,0.05)' : 'rgba(15,23,42,0.07)';
        const hoverIconColor = isDark ? 'rgba(255,255,255,0.7)' : 'rgba(15,23,42,0.72)';
        const hoverTextColor = isDark ? 'rgba(255,255,255,0.8)' : 'rgba(15,23,42,0.86)';

        if (item.to === '/settings') {
            return (
                <button
                    key={item.to}
                    type="button"
                    onClick={() => {
                        onClose();
                        onOpenSettings();
                    }}
                    className="group relative flex items-center gap-3 transition-all duration-200 w-full"
                    style={{ textDecoration: 'none' }}
                    onMouseEnter={() => setHoveredItem(item.to)}
                    onMouseLeave={() => setHoveredItem(null)}
                >
                    <span
                        className="absolute left-0 top-1/2 -translate-y-1/2 rounded-r-full transition-all duration-300"
                        style={{
                            width: active ? 4 : 0,
                            height: active ? 24 : 0,
                            background: activeAccent,
                            boxShadow: active ? `0 0 10px ${activeAccent}80` : 'none',
                        }}
                    />
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
                                ? isDark ? '1px solid rgba(255,255,255,0.08)' : '1px solid rgba(15,23,42,0.14)'
                                : '1px solid transparent',
                            boxShadow: active
                                ? `0 2px 12px ${activeAccent}15, inset 0 1px 0 rgba(255,255,255,0.05)`
                                : showHover
                                ? 'inset 0 1px 0 rgba(255,255,255,0.04)'
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
                            className="text-sm font-medium truncate transition-colors duration-200 text-left"
                            style={{ color: active ? (isDark ? 'rgba(255,255,255,0.9)' : 'rgba(15,23,42,0.92)') : showHover ? hoverTextColor : (isDark ? 'rgba(255,255,255,0.45)' : 'rgba(15,23,42,0.66)') }}
                        >
                            {item.label}
                        </span>

                        {active && (
                            <span className="ml-auto">
                                <span className="block rounded-full" style={{ width: 6, height: 6, background: activeAccent, boxShadow: `0 0 6px ${activeAccent}80` }} />
                            </span>
                        )}
                    </span>
                </button>
            );
        }

        return (
            <Link
                key={item.to}
                to={item.to}
                onClick={onClose}
                className="group relative flex items-center gap-3 transition-all duration-200"
                style={{ textDecoration: 'none' }}
                onMouseEnter={() => setHoveredItem(item.to)}
                onMouseLeave={() => setHoveredItem(null)}
            >
                <span
                    className="absolute left-0 top-1/2 -translate-y-1/2 rounded-r-full transition-all duration-300"
                    style={{
                        width: active ? 4 : 0,
                        height: active ? 24 : 0,
                        background: activeAccent,
                        boxShadow: active ? `0 0 10px ${activeAccent}80` : 'none',
                    }}
                />
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
                            ? isDark ? '1px solid rgba(255,255,255,0.08)' : '1px solid rgba(15,23,42,0.14)'
                            : '1px solid transparent',
                        boxShadow: active
                            ? `0 2px 12px ${activeAccent}15, inset 0 1px 0 rgba(255,255,255,0.05)`
                            : showHover
                            ? 'inset 0 1px 0 rgba(255,255,255,0.04)'
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

                    {/* Active dot */}
                    {active && (
                        <span className="ml-auto">
                            <span className="block rounded-full" style={{ width: 6, height: 6, background: activeAccent, boxShadow: `0 0 6px ${activeAccent}80` }} />
                        </span>
                    )}
                </span>
            </Link>
        );
    };

    return (
        <>
            {/* Backdrop */}
            <div
                className={`lg:hidden fixed inset-0 z-40 transition-opacity duration-300 ${isOpen ? 'opacity-100 pointer-events-auto' : 'opacity-0 pointer-events-none'}`}
                style={{
                    background: 'rgba(0,0,0,0.5)',
                    backdropFilter: 'blur(8px)',
                    WebkitBackdropFilter: 'blur(8px)',
                }}
                onClick={onClose}
            />

            {/* Sidebar panel */}
            <aside
                className={`lg:hidden fixed inset-0 z-50 flex flex-col transition-transform duration-300 ease-out`}
                style={{
                    width: 280,
                    background: isDark
                        ? 'rgba(15, 15, 35, 0.82)'
                        : 'rgba(248, 250, 252, 0.92)',
                    backdropFilter: 'blur(40px) saturate(200%)',
                    WebkitBackdropFilter: 'blur(40px) saturate(200%)',
                    borderRight: isDark ? '1px solid rgba(255,255,255,0.07)' : '1px solid rgba(15,23,42,0.12)',
                    boxShadow: isDark
                        ? '0 32px 64px rgba(0,0,0,0.6), inset 0 1px 0 rgba(255,255,255,0.05)'
                        : '0 32px 64px rgba(15,23,42,0.16), inset 0 1px 0 rgba(255,255,255,0.95)',
                    transform: isOpen ? 'translateX(0)' : 'translateX(-100%)',
                }}
            >
                {/* Brand */}
                <div
                    className="flex items-center gap-3 shrink-0"
                    style={{
                        padding: '20px 16px',
                        borderBottom: isDark ? '1px solid rgba(255,255,255,0.06)' : '1px solid rgba(15,23,42,0.1)',
                    }}
                >
                    <AppIcon size="xl" className="flex-shrink-0" />
                    <div className="min-w-0 flex-1">
                        <h1 className="text-base font-bold truncate" style={{ color: isDark ? 'rgba(255,255,255,0.9)' : 'rgba(15,23,42,0.92)' }}>
                            Novel Crawler
                        </h1>
                        <p className="text-xs truncate" style={{ color: isDark ? 'rgba(255,255,255,0.3)' : 'rgba(15,23,42,0.58)' }}>
                            Content Fetcher
                        </p>
                    </div>
                    <button
                        onClick={onClose}
                        className="lg-icon-btn flex-shrink-0"
                        title="Close sidebar"
                    >
                        <Icon icon={appIcons.close} className="" style={{ width: 14, height: 14, color: isDark ? 'rgba(255,255,255,0.4)' : 'rgba(15,23,42,0.55)' }} />
                    </button>
                </div>

                {/* Nav */}
                <nav className="flex-1 overflow-y-auto py-4 px-3 space-y-5">
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

                {/* Bottom: Theme */}
                <div
                    style={{
                        padding: '12px 12px',
                        borderTop: isDark ? '1px solid rgba(255,255,255,0.06)' : '1px solid rgba(15,23,42,0.1)',
                    }}
                />
            </aside>
        </>
    );
}

export default MobileSidebar;
