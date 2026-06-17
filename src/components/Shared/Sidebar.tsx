import { useState } from 'react';
import { useLocation, Link } from 'react-router-dom';
import type { AuthUser } from '../../api';
import { AppIcon } from './AppIcon';
import { AccountMenu } from './AccountMenu';
import { Icon, appIcons } from './Icon';
import type { ThemeMode } from '../../types/theme';
import { navActive, NAV_SECTIONS } from '../../utils/navigation';

interface SidebarProps {
    themeMode: ThemeMode;
    onOpenSettings: () => void;
    authUser: AuthUser;
    onLogout: () => void;
}

const NAV_ICONS = {
    '/': 'add',
    '/results/all': 'crawlHistory',
    '/bedread': 'bookOpen',
    '/bedread/jobs': 'audioJobs',
    '/drive-sync': 'sync',
    '/drive-sync/history': 'syncHistory',
    '/drive-sync/content-update': 'contentUpdate',
    '/drive-sync/cover-update': 'image',
    '/drive-sync/banner-update': 'flag',
    '/drive-sync/metadata-update': 'info',
    '/drive-sync/title-update': 'edit',
    '/auto-audio': 'autoAudio',
    '/auto-audio/history': 'syncHistory',
    '/supported-sites': 'supportedSites',
} as const;

export function Sidebar({
    themeMode,
    onOpenSettings,
    authUser,
    onLogout,
}: Readonly<SidebarProps>) {
    const location = useLocation();
    const isDark = themeMode === 'dark';
    const [hoveredItem, setHoveredItem] = useState<string | null>(null);
    const [accountOpen, setAccountOpen] = useState(false);

    const asideBackground = isDark ? '#191919' : '#fbfbfa';
    const asideBorder = isDark ? 'rgba(255,255,255,0.06)' : 'rgba(15,23,42,0.08)';
    const headerText = isDark ? 'rgba(255,255,255,0.92)' : '#37352f';
    const mutedText = isDark ? 'rgba(255,255,255,0.42)' : 'rgba(55,53,47,0.58)';
    const sectionText = isDark ? 'rgba(255,255,255,0.34)' : 'rgba(55,53,47,0.52)';
    const itemText = isDark ? 'rgba(255,255,255,0.74)' : 'rgba(55,53,47,0.84)';
    const itemMuted = isDark ? 'rgba(255,255,255,0.44)' : 'rgba(55,53,47,0.58)';
    const hoverBackground = isDark ? 'rgba(255,255,255,0.08)' : 'rgba(55,53,47,0.08)';
    const activeBackground = isDark ? 'rgba(255,255,255,0.12)' : 'rgba(55,53,47,0.1)';

    const makeNavItem = (item: { to: string; label: string; iconKey: string }) => {
        const active = navActive(location.pathname, item.to);
        const hovered = hoveredItem === item.to;
        const background = active ? activeBackground : hovered ? hoverBackground : 'transparent';
        const color = active ? headerText : hovered ? itemText : itemMuted;
        const iconKey = item.iconKey as keyof typeof NAV_ICONS;
        const resolvedIcon = NAV_ICONS[iconKey] as keyof typeof appIcons;

        return (
            <Link
                key={item.to}
                to={item.to}
                className="group relative flex items-center gap-2.5 rounded-md transition-colors duration-150"
                style={{
                    textDecoration: 'none',
                    padding: '6px 10px',
                    background,
                }}
                onMouseEnter={() => setHoveredItem(item.to)}
                onMouseLeave={() => setHoveredItem(null)}
            >
                <span
                    className="flex h-5 w-5 items-center justify-center flex-shrink-0 transition-colors duration-150"
                    style={{ color }}
                >
                    <Icon icon={appIcons[resolvedIcon]} className="w-4 h-4" />
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
        <aside
            className="hidden lg:flex flex-col fixed left-0 top-0 h-screen z-50 transition-colors duration-200"
            style={{
                width: 248,
                background: asideBackground,
                borderRight: `1px solid ${asideBorder}`,
            }}
        >
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
                    <h1
                        className="text-sm font-semibold truncate"
                        style={{ color: headerText }}
                    >
                        Novel Crawler
                    </h1>
                    <p className="text-xs truncate" style={{ color: mutedText }}>
                        Workspace
                    </p>
                </div>
                <button
                    type="button"
                    className="flex h-8 w-8 items-center justify-center rounded-md flex-shrink-0 transition-colors duration-150"
                    style={{ background: hoveredItem === '/settings' ? hoverBackground : 'transparent', color: mutedText }}
                    onClick={onOpenSettings}
                    onMouseEnter={() => setHoveredItem('/settings')}
                    onMouseLeave={() => setHoveredItem(null)}
                    aria-label="Open settings"
                >
                    <Icon icon={appIcons.settings} className="w-4 h-4" />
                </button>
            </div>

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

            <div
                className="px-3 pb-3 pt-3"
                style={{ borderTop: `1px solid ${asideBorder}` }}
            >
                <AccountMenu
                    authUser={authUser}
                    isDark={isDark}
                    isOpen={accountOpen}
                    onToggle={() => setAccountOpen((open) => !open)}
                    onClose={() => setAccountOpen(false)}
                    onLogout={onLogout}
                    placement="sidebar"
                />
            </div>
        </aside>
    );
}

export default Sidebar;
