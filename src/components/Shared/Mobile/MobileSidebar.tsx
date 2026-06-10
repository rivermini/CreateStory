import { useLocation, Link } from 'react-router-dom';
import { AppIcon } from '../AppIcon';
import { Icon, appIcons } from '../Icon';
import type { ThemeMode } from '../../../types/theme';

interface MobileSidebarProps {
    themeMode: ThemeMode;
    isSettingsOpen: boolean;
    onOpenSettings: () => void;
    isOpen: boolean;
    onClose: () => void;
}

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

function MobileNavItem({
    item,
    active,
    isDark,
    onClick,
    asButton = false,
}: Readonly<{
    item: NavItem;
    active: boolean;
    isDark: boolean;
    onClick: () => void;
    asButton?: boolean;
}>) {
    const panelBackground = isDark ? 'rgba(255,255,255,0.05)' : 'rgba(17,17,17,0.04)';
    const panelBorder = isDark ? 'rgba(255,255,255,0.08)' : 'rgba(17,17,17,0.08)';
    const activeBackground = isDark ? 'rgba(255,255,255,0.10)' : 'rgba(17,17,17,0.08)';
    const activeBorder = isDark ? 'rgba(255,255,255,0.14)' : 'rgba(17,17,17,0.14)';
    const baseIcon = isDark ? 'rgba(255,255,255,0.42)' : 'rgba(17,17,17,0.48)';
    const activeIcon = isDark ? 'rgba(255,255,255,0.9)' : '#111111';
    const baseText = isDark ? 'rgba(255,255,255,0.56)' : 'rgba(17,17,17,0.68)';
    const activeText = isDark ? 'rgba(255,255,255,0.92)' : '#111111';

    const content = (
        <span
            className="flex w-full items-center gap-3 rounded-xl border px-3 py-2.5 transition-colors duration-200"
            style={{
                background: active ? activeBackground : panelBackground,
                borderColor: active ? activeBorder : panelBorder,
            }}
        >
            <span
                className="flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-lg"
                style={{
                    background: active ? (isDark ? 'rgba(255,255,255,0.08)' : 'rgba(17,17,17,0.06)') : 'transparent',
                    color: active ? activeIcon : baseIcon,
                }}
            >
                <Icon icon={appIcons[item.iconKey as keyof typeof appIcons]} className="h-4 w-4 flex-shrink-0" />
            </span>
            <span
                className="min-w-0 truncate text-sm font-medium"
                style={{ color: active ? activeText : baseText }}
            >
                {item.label}
            </span>
            {active && <span className="h-1.5 w-1.5 rounded-full" style={{ background: activeIcon }} />}
        </span>
    );

    if (asButton) {
        return (
            <button
                key={item.to}
                type="button"
                onClick={onClick}
                className="block w-full"
                style={{ textDecoration: 'none' }}
            >
                {content}
            </button>
        );
    }

    return (
        <Link
            key={item.to}
            to={item.to}
            onClick={onClick}
            className="block"
            style={{ textDecoration: 'none' }}
        >
            {content}
        </Link>
    );
}

export function MobileSidebar({
    themeMode,
    isSettingsOpen,
    onOpenSettings,
    isOpen,
    onClose,
}: Readonly<MobileSidebarProps>) {
    const location = useLocation();
    const isDark = themeMode === 'dark';

    const makeNavItem = (item: NavItem) => {
        const active = item.to === '/settings' ? isSettingsOpen : navActive(location.pathname, item.to);

        if (item.to === '/settings') {
            return (
                <MobileNavItem
                    key={item.to}
                    item={item}
                    active={active}
                    isDark={isDark}
                    asButton
                    onClick={() => {
                        onClose();
                        onOpenSettings();
                    }}
                />
            );
        }

        return <MobileNavItem key={item.to} item={item} active={active} isDark={isDark} onClick={onClose} />;
    };

    return (
        <>
            {/* Backdrop */}
            <button
                type="button"
                className={`fixed inset-0 z-40 transition-opacity duration-200 lg:hidden cursor-default ${isOpen ? 'pointer-events-auto opacity-100' : 'pointer-events-none opacity-0'}`}
                style={{
                    background: isDark ? 'rgba(0,0,0,0.42)' : 'rgba(17,17,17,0.18)',
                }}
                onClick={onClose}
                aria-label="Close sidebar"
            />

            {/* Sidebar panel */}
            <aside
                className="fixed inset-0 z-50 flex flex-col transition-transform duration-200 ease-out lg:hidden"
                style={{
                    width: 272,
                    background: isDark ? '#111111' : '#fafafa',
                    borderRight: isDark ? '1px solid rgba(255,255,255,0.08)' : '1px solid rgba(17,17,17,0.08)',
                    boxShadow: isDark ? '0 18px 40px rgba(0,0,0,0.38)' : '0 18px 40px rgba(17,17,17,0.08)',
                    transform: isOpen ? 'translateX(0)' : 'translateX(-100%)',
                }}
            >
                {/* Brand */}
                <div
                    className="flex shrink-0 items-center gap-3"
                    style={{
                        padding: '16px 14px',
                        borderBottom: isDark ? '1px solid rgba(255,255,255,0.08)' : '1px solid rgba(17,17,17,0.08)',
                    }}
                >
                    <AppIcon size="xl" className="flex-shrink-0" />
                    <div className="min-w-0 flex-1">
                        <h1 className="truncate text-sm font-semibold" style={{ color: isDark ? 'rgba(255,255,255,0.92)' : '#111111' }}>
                            Novel Crawler
                        </h1>
                        <p className="truncate text-[11px] uppercase tracking-[0.14em]" style={{ color: isDark ? 'rgba(255,255,255,0.34)' : 'rgba(17,17,17,0.42)' }}>
                            Content Fetcher
                        </p>
                    </div>
                    <button
                        onClick={onClose}
                        className="lg-icon-btn flex-shrink-0"
                        title="Close sidebar"
                    >
                        <Icon icon={appIcons.close} className="" style={{ width: 14, height: 14, color: isDark ? 'rgba(255,255,255,0.5)' : 'rgba(17,17,17,0.56)' }} />
                    </button>
                </div>

                {/* Nav */}
                <nav className="flex-1 space-y-4 overflow-y-auto px-3 py-3">
                    {NAV_SECTIONS.map((section) => (
                        <div key={section.label}>
                            <p
                                className="px-2 pb-2 text-[10px] font-semibold uppercase tracking-[0.18em]"
                                style={{ color: isDark ? 'rgba(255,255,255,0.28)' : 'rgba(17,17,17,0.4)' }}
                            >
                                {section.label}
                            </p>
                            <div className="space-y-1">
                                {section.items.map((item) => makeNavItem(item))}
                            </div>
                        </div>
                    ))}
                </nav>

                {/* Bottom: Theme */}
                <div
                    style={{
                        padding: '10px 12px',
                        borderTop: isDark ? '1px solid rgba(255,255,255,0.08)' : '1px solid rgba(17,17,17,0.08)',
                    }}
                />
            </aside>
        </>
    );
}

export default MobileSidebar;
