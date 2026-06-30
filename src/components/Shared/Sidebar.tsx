import { useState } from 'react';
import { useLocation, Link } from 'react-router-dom';
import type { AuthUser } from '../../api';
import { AppIcon } from './AppIcon';
import { Icon, appIcons } from './Icon';
import type { ThemeMode } from '../../types/theme';
import { navActive, NAV_SECTIONS } from '../../utils/navigation';
import { getThemeTokens } from './design';

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
    '/drive-sync/banner-update': 'image',
    '/drive-sync/intro-update': 'image',
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
    const tokens = getThemeTokens(themeMode);
    const isDark = tokens.isDark;
    const [hoveredItem, setHoveredItem] = useState<string | null>(null);

    const makeNavItem = (item: { to: string; label: string; iconKey: string }) => {
        const resolvedIcon = NAV_ICONS[item.iconKey as keyof typeof NAV_ICONS] as keyof typeof appIcons;
        const active = navActive(location.pathname, item.to);

        if (item.to === '/') {
            return (
                <Link
                    key={item.to}
                    to={item.to}
                    className="group relative my-2 flex min-h-10 items-center justify-center gap-2 rounded-full border px-3 py-2 text-xs font-bold transition-all duration-150"
                    style={{
                        textDecoration: 'none',
                        background: active ? tokens.colors.primary : tokens.colors.primarySoft,
                        borderColor: active ? tokens.colors.primary : isDark ? 'rgba(255,91,0,0.25)' : 'rgba(255,91,0,0.18)',
                        color: active ? '#ffffff' : tokens.colors.primary,
                        boxShadow: active ? '0 12px 28px rgba(255,91,0,0.22)' : 'none',
                    }}
                >
                    <span className="flex h-4.5 w-4.5 flex-shrink-0 items-center justify-center">
                        <Icon icon={appIcons[resolvedIcon]} className="w-3.5 h-3.5" />
                    </span>
                    <span>{item.label}</span>
                </Link>
            );
        }

        const hovered = hoveredItem === item.to;
        const background = active ? tokens.colors.active : hovered ? tokens.colors.surfaceMuted : 'transparent';
        const color = active ? tokens.colors.activeText : hovered ? tokens.colors.text : tokens.colors.textSoft;

        let badgeText: string | null = null;
        let badgeColor = 'transparent';
        let badgeTextColor = tokens.colors.textMuted;

        if (item.to === '/supported-sites') {
            badgeText = '10+';
            badgeColor = isDark ? 'rgba(52,211,153,0.12)' : 'rgba(21,128,61,0.08)';
            badgeTextColor = isDark ? '#34d399' : '#15803d';
        } else if (item.to === '/auto-audio') {
            badgeText = 'AI';
            badgeColor = isDark ? 'rgba(255,91,0,0.12)' : 'rgba(255,91,0,0.08)';
            badgeTextColor = '#ff5b00';
        } else if (item.to === '/drive-sync') {
            badgeText = 'Cloud';
            badgeColor = isDark ? 'rgba(59,130,246,0.12)' : 'rgba(29,78,216,0.08)';
            badgeTextColor = isDark ? '#60a5fa' : '#1d4ed8';
        }

        return (
            <Link
                key={item.to}
                to={item.to}
                className="group relative flex min-h-9 items-center gap-2 rounded-full px-3 py-2 transition-all duration-150"
                style={{
                    textDecoration: 'none',
                    background,
                    color,
                }}
                onMouseEnter={() => setHoveredItem(item.to)}
                onMouseLeave={() => setHoveredItem(null)}
            >
                <span
                    className="flex h-5 w-5 flex-shrink-0 items-center justify-center transition-colors duration-150"
                    style={{ color }}
                >
                    <Icon icon={appIcons[resolvedIcon]} className="w-3.5 h-3.5" />
                </span>

                <span
                    className="min-w-0 flex-1 whitespace-normal break-words text-xs font-semibold tracking-[0.01em] transition-colors duration-150"
                    style={{ color }}
                >
                    {item.label}
                </span>

                {badgeText && (
                    <span 
                        className="rounded-full px-1.5 py-0.5 text-[9px] font-bold leading-none scale-90"
                        style={{ background: badgeColor, color: badgeTextColor }}
                    >
                        {badgeText}
                    </span>
                )}
            </Link>
        );
    };

    return (
        <aside
            className="hidden lg:flex fixed bottom-4 left-4 top-4 z-40 flex-col overflow-hidden rounded-[22px] border transition-colors duration-200"
            style={{
                width: 248,
                background: tokens.colors.surfaceElevated,
                borderColor: tokens.colors.border,
                boxShadow: tokens.shadows.soft,
                backdropFilter: 'blur(18px)',
            }}
        >
            <div
                className="flex items-center gap-3 border-b"
                style={{
                    padding: '14px 14px 12px',
                    borderColor: tokens.colors.border,
                }}
            >
                <div
                    className="flex h-8 w-8 flex-shrink-0 items-center justify-center overflow-hidden rounded-lg"
                >
                    <AppIcon size="md" className="flex-shrink-0" />
                </div>
                <div className="flex-1 min-w-0">
                    <h1
                        className="text-sm font-semibold"
                        style={{ color: tokens.colors.text }}
                    >
                        CreateStory
                    </h1>
                    <p className="text-xs" style={{ color: tokens.colors.textMuted }}>
                        Workspace
                    </p>
                </div>
                <button
                    type="button"
                    className="cs-icon-button flex-shrink-0"
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
                    padding: '8px 8px 16px',
                }}
            >
                {NAV_SECTIONS.map((section) => (
                    <div key={section.label} style={{ marginTop: 12 }}>
                        <p
                            className="px-3 pb-1 text-[10px] font-bold uppercase tracking-[0.16em]"
                            style={{ color: tokens.colors.textFaint }}
                        >
                            {section.label}
                        </p>
                        <div className="space-y-1">
                            {section.items.map((item) => makeNavItem(item))}
                        </div>
                    </div>
                ))}
            </nav>

            <div
                className="border-t px-3 py-3"
                style={{ borderColor: tokens.colors.border }}
            >
                <div className="mb-2 min-w-0 rounded-2xl border px-3 py-2" style={{ borderColor: tokens.colors.border, background: tokens.colors.surfaceMuted }}>
                    <p className="break-words text-[11px] font-semibold leading-4" style={{ color: tokens.colors.text }}>
                        {authUser.email}
                    </p>
                    <p className="text-[10px] capitalize" style={{ color: tokens.colors.textMuted }}>
                        {authUser.role}
                    </p>
                </div>
                <button
                    type="button"
                    onClick={onLogout}
                    className="cs-btn-logout flex w-full items-center justify-center gap-2 rounded-full px-3 py-2 text-xs font-semibold"
                >
                    <Icon icon={appIcons.logout} className="h-3.5 w-3.5" />
                    Sign out
                </button>
            </div>
        </aside>
    );
}

export default Sidebar;
