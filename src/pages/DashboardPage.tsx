import { Link, Navigate, Route, Routes, useLocation } from 'react-router-dom';
import { AppIcon } from '../components/AppIcon';
import { Icon, appIcons } from '../components/Icon';
import type { AuthUser } from '../api/client';
import type { ThemeMode } from '../types/theme';
import { AdminUsersPanel } from './AdminUsersPage';

interface DashboardPageProps {
  themeMode: ThemeMode;
  authUser: AuthUser;
}

const DASHBOARD_ACCENT = '#6366f1';

export function DashboardPage({ themeMode, authUser }: DashboardPageProps) {
  const isDark = themeMode === 'dark';
  const pageBackground = isDark
    ? 'linear-gradient(135deg, #0a0a14 0%, #0f0f1e 40%, #12101f 70%, #0e0f1c 100%)'
    : 'linear-gradient(135deg, #eef2ff 0%, #eef8f5 38%, #f8f0f4 72%, #f8fafc 100%)';

  return (
    <div className={`min-h-screen relative overflow-hidden ${isDark ? 'dark' : 'light'}`} style={{ background: pageBackground }}>
      <DashboardSidebar themeMode={themeMode} authUser={authUser} />
      <div className="min-h-screen pl-0 lg:pl-[248px] pt-14 lg:pt-0 transition-all duration-300">
        <Routes>
          <Route path="/" element={<Navigate to="/dashboard/users" replace />} />
          <Route path="/users" element={<AdminUsersPanel themeMode={themeMode} embedded />} />
          <Route path="*" element={<Navigate to="/dashboard/users" replace />} />
        </Routes>
      </div>
    </div>
  );
}

function DashboardSidebar({ themeMode, authUser }: { themeMode: ThemeMode; authUser: AuthUser }) {
  const location = useLocation();
  const isDark = themeMode === 'dark';
  const active = location.pathname === '/dashboard' || location.pathname.startsWith('/dashboard/users');

  return (
    <aside
      className="hidden lg:flex flex-col fixed left-0 top-0 h-screen z-50 transition-all duration-300"
      style={{
        width: 248,
        background: isDark ? 'rgba(15, 15, 35, 0.55)' : 'rgba(248, 250, 252, 0.9)',
        backdropFilter: 'blur(32px) saturate(180%)',
        WebkitBackdropFilter: 'blur(32px) saturate(180%)',
        borderRight: isDark ? '1px solid rgba(255,255,255,0.07)' : '1px solid rgba(15,23,42,0.12)',
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
          <h1 className="text-base font-bold truncate" style={{ color: isDark ? 'rgba(255,255,255,0.9)' : 'rgba(15,23,42,0.92)' }}>
            Dashboard
          </h1>
          <p className="text-xs truncate" style={{ color: isDark ? 'rgba(255,255,255,0.3)' : 'rgba(15,23,42,0.58)' }}>
            {authUser.email}
          </p>
        </div>
      </div>

      <nav className="flex-1 overflow-y-auto py-4 space-y-5" style={{ paddingLeft: 12, paddingRight: 12 }}>
        <div>
          <p
            className="px-3 pb-2 text-[0.65rem] font-semibold uppercase tracking-widest"
            style={{ color: isDark ? 'rgba(255,255,255,0.25)' : 'rgba(15,23,42,0.46)' }}
          >
            Admin
          </p>
          <Link to="/dashboard/users" className="group relative flex items-center gap-3 transition-all duration-200" style={{ textDecoration: 'none' }}>
            <span
              className="absolute left-0 top-1/2 -translate-y-1/2 rounded-r-full transition-all duration-300"
              style={{
                width: active ? 4 : 0,
                height: active ? 24 : 0,
                background: DASHBOARD_ACCENT,
                boxShadow: active ? `0 0 10px ${DASHBOARD_ACCENT}80` : 'none',
              }}
            />
            <span
              className="relative flex items-center gap-3 rounded-[14px] transition-all duration-200 w-full"
              style={{
                padding: '10px 14px',
                background: active ? `linear-gradient(135deg, ${DASHBOARD_ACCENT}18, ${DASHBOARD_ACCENT}10)` : 'transparent',
                border: active ? `1px solid ${DASHBOARD_ACCENT}30` : '1px solid transparent',
                boxShadow: active ? `0 2px 12px ${DASHBOARD_ACCENT}15, inset 0 1px 0 rgba(255,255,255,0.05)` : 'none',
              }}
            >
              <span className="flex-shrink-0 transition-colors duration-200" style={{ color: active ? DASHBOARD_ACCENT : isDark ? 'rgba(255,255,255,0.4)' : 'rgba(15,23,42,0.55)' }}>
                <Icon icon={appIcons.users} className="w-5 h-5 flex-shrink-0" />
              </span>
              <span
                className="text-sm font-medium truncate transition-colors duration-200"
                style={{ color: active ? isDark ? 'rgba(255,255,255,0.9)' : 'rgba(15,23,42,0.92)' : isDark ? 'rgba(255,255,255,0.45)' : 'rgba(15,23,42,0.66)' }}
              >
                Users
              </span>
              {active && (
                <span className="ml-auto">
                  <span className="block rounded-full" style={{ width: 6, height: 6, background: DASHBOARD_ACCENT, boxShadow: `0 0 6px ${DASHBOARD_ACCENT}80` }} />
                </span>
              )}
            </span>
          </Link>
        </div>
      </nav>

      <div
        style={{
          padding: '12px 12px',
          borderTop: isDark ? '1px solid rgba(255,255,255,0.06)' : '1px solid rgba(15,23,42,0.1)',
        }}
      >
        <Link
          to="/"
          className={`flex items-center gap-2 rounded-lg px-3 py-2 text-sm font-medium transition-colors ${
            isDark ? 'text-white/45 hover:bg-white/[0.06] hover:text-white/75' : 'text-black/45 hover:bg-black/[0.05] hover:text-black/70'
          }`}
          style={{ textDecoration: 'none' }}
        >
          <Icon icon={appIcons.back} className="w-4 h-4" />
          Back to app
        </Link>
      </div>
    </aside>
  );
}
