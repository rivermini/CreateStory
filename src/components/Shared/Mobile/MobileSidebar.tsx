import { useState } from 'react';
import { useLocation, Link } from 'react-router-dom';
import { AppIcon } from '../AppIcon';
import { Icon, appIcons } from '../Icon';
import type { ThemeMode } from '../../../types/theme';

interface MobileSidebarProps {
    themeMode: ThemeMode;
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
    iconKey: keyof typeof appIcons;
}

interface NavSection {
    label: string;
    items: NavItem[];
}

const NAV_ICONS_MOBILE: Record<string, keyof typeof appIcons> = {
    '/': 'add',
    '/results/all': 'crawlHistory',
    '/bedread': 'bookOpen',
    '/bedread/jobs': 'audioJobs',
    '/drive-sync': 'sync',
    '/drive-sync/history': 'syncHistory',
    '/drive-sync/content-update': 'contentUpdate',
    '/drive-sync/cover-update': 'image',
    '/drive-sync/metadata-update': 'info',
    '/auto-audio': 'autoAudio',
    '/auto-audio/history': 'syncHistory',
    '/supported-sites': 'supportedSites',
};

const NAV_ITEMS_CRAWL: NavItem[] = [
    { to: '/', label: 'New Crawl', iconKey: NAV_ICONS_MOBILE['/'] },
    { to: '/results/all', label: 'Crawl History', iconKey: NAV_ICONS_MOBILE['/results/all'] },
];

const NAV_ITEMS_AUDIO: NavItem[] = [
    { to: '/bedread', label: 'BedReads', iconKey: NAV_ICONS_MOBILE['/bedread'] },
    { to: '/bedread/jobs', label: 'Audio Jobs', iconKey: NAV_ICONS_MOBILE['/bedread/jobs'] },
];

const NAV_ITEMS_BEDREADS: NavItem[] = [
    { to: '/drive-sync', label: 'Drive Sync', iconKey: NAV_ICONS_MOBILE['/drive-sync'] },
    { to: '/drive-sync/cover-update', label: 'Cover Update', iconKey: NAV_ICONS_MOBILE['/drive-sync/cover-update'] },
    { to: '/drive-sync/metadata-update', label: 'Metadata Update', iconKey: NAV_ICONS_MOBILE['/drive-sync/metadata-update'] },
    { to: '/drive-sync/content-update', label: 'Content Update', iconKey: NAV_ICONS_MOBILE['/drive-sync/content-update'] },
    { to: '/drive-sync/history', label: 'Sync History', iconKey: NAV_ICONS_MOBILE['/drive-sync/history'] },
];

const NAV_ITEMS_AUTO_AUDIO: NavItem[] = [
    { to: '/auto-audio', label: 'Auto Audio', iconKey: NAV_ICONS_MOBILE['/auto-audio'] },
    { to: '/auto-audio/history', label: 'Auto History', iconKey: NAV_ICONS_MOBILE['/auto-audio/history'] },
];

const NAV_ITEMS_SYSTEM: NavItem[] = [
    { to: '/supported-sites', label: 'Supported Sites', iconKey: NAV_ICONS_MOBILE['/supported-sites'] },
];

const NAV_SECTIONS: NavSection[] = [
    { label: 'Novel Crawler', items: NAV_ITEMS_CRAWL },
    { label: 'Audio', items: NAV_ITEMS_AUDIO },
    { label: 'DriveSync', items: NAV_ITEMS_BEDREADS },
    { label: 'Auto Audio', items: NAV_ITEMS_AUTO_AUDIO },
    { label: 'System', items: NAV_ITEMS_SYSTEM },
];

export function MobileSidebar({
    themeMode,
    onOpenSettings,
    isOpen,
    onClose,
}: Readonly<MobileSidebarProps>) {
    const location = useLocation();
    const isDark = themeMode === 'dark';
    const [hoveredItem, setHoveredItem] = useState<string | null>(null);

    const asideBackground = isDark ? '#191919' : '#fbfbfa';
    const asideBorder = isDark ? 'rgba(255,255,255,0.06)' : 'rgba(15,23,42,0.08)';
    const headerText = isDark ? 'rgba(255,255,255,0.92)' : '#37352f';
    const mutedText = isDark ? 'rgba(255,255,255,0.42)' : 'rgba(55,53,47,0.58)';
    const sectionText = isDark ? 'rgba(255,255,255,0.34)' : 'rgba(55,53,47,0.52)';
    const itemText = isDark ? 'rgba(255,255,255,0.74)' : 'rgba(55,53,47,0.84)';
    const itemMuted = isDark ? 'rgba(255,255,255,0.44)' : 'rgba(55,53,47,0.58)';
    const hoverBackground = isDark ? 'rgba(255,255,255,0.08)' : 'rgba(55,53,47,0.08)';
    const activeBackground = isDark ? 'rgba(255,255,255,0.12)' : 'rgba(55,53,47,0.1)';

    const makeNavItem = (item: NavItem) => {
        const active = navActive(location.pathname, item.to);
        const hovered = hoveredItem === item.to;
        const background = active ? activeBackground : hovered ? hoverBackground : 'transparent';
        const color = active ? headerText : hovered ? itemText : itemMuted;

        return (
            <Link
                key={item.to}
                to={item.to}
                onClick={onClose}
                onMouseEnter={() => setHoveredItem(item.to)}
                onMouseLeave={() => setHoveredItem(null)}
                className="group relative flex items-center gap-2.5 rounded-md transition-colors duration-150"
                style={{
                    textDecoration: 'none',
                    padding: '10px 10px',
                    background,
                }}
            >
                <span
                    className="flex h-5 w-5 items-center justify-center flex-shrink-0 transition-colors duration-150"
                    style={{ color }}
                >
                    <Icon icon={appIcons[item.iconKey]} className="w-4 h-4" />
                </span>
                <span
                    className="min-w-0 flex-1 truncate text-sm font-medium transition-colors duration-150"
                    style={{ color }}
                >
                    {item.label}
                </span>
            </Link>
        );
    };

    return (
        <>
            {/* Backdrop */}
            <button
                type="button"
                className={`fixed inset-0 z-40 transition-opacity duration-200 cursor-default ${isOpen ? 'pointer-events-auto opacity-100' : 'pointer-events-none opacity-0'}`}
                style={{
                    background: isDark ? 'rgba(0,0,0,0.42)' : 'rgba(17,17,17,0.18)',
                }}
                onClick={onClose}
                aria-label="Close sidebar"
            />

            {/* Sidebar panel */}
            <aside
                className="fixed inset-0 z-50 flex flex-col transition-transform duration-200 ease-out"
                style={{
                    width: 272,
                    background: asideBackground,
                    borderRight: `1px solid ${asideBorder}`,
                    transform: isOpen ? 'translateX(0)' : 'translateX(-100%)',
                }}
            >
                {/* Brand */}
                <div
                    className="flex items-center gap-3"
                    style={{
                        padding: '14px 14px 12px',
                    }}
                >
                    <div
                        className="flex h-8 w-8 items-center justify-center rounded-md overflow-hidden flex-shrink-0"
                        style={{ background: isDark ? 'rgba(255,255,255,0.06)' : 'rgba(55,53,47,0.06)' }}
                    >
                        <AppIcon size="md" className="flex-shrink-0" />
                    </div>
                    <div className="flex-1 min-w-0">
                        <h1 className="text-sm font-semibold truncate" style={{ color: headerText }}>
                            Novel Crawler
                        </h1>
                        <p className="text-xs truncate" style={{ color: mutedText }}>
                            Workspace
                        </p>
                    </div>
                    <button
                        type="button"
                        onClick={onOpenSettings}
                        className="flex h-10 w-10 items-center justify-center rounded-md flex-shrink-0 transition-colors duration-150 touch-manipulation"
                        style={{ background: hoveredItem === '/settings' ? hoverBackground : 'transparent', color: mutedText }}
                        onMouseEnter={() => setHoveredItem('/settings')}
                        onMouseLeave={() => setHoveredItem(null)}
                        aria-label="Open settings"
                    >
                        <Icon icon={appIcons.settings} className="w-4 h-4" />
                    </button>
                </div>

                {/* Nav */}
                <nav
                    className="flex-1 overflow-y-auto"
                    style={{
                        padding: '4px 8px 16px',
                    }}
                >
                    {NAV_SECTIONS.map((section) => (
                        <div key={section.label} style={{ marginTop: 14 }}>
                            <p
                                className="px-2 pb-1 text-[11px] font-medium"
                                style={{ color: sectionText }}
                            >
                                {section.label}
                            </p>
                            <div className="space-y-0.5">
                                {section.items.map((item) => makeNavItem(item))}
                            </div>
                        </div>
                    ))}
                </nav>
            </aside>
        </>
    );
}

export default MobileSidebar;
