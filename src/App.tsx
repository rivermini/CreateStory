import { lazy, Suspense, useCallback, useEffect, useState } from 'react';
import { BrowserRouter, Link, Navigate, Route, Routes, useLocation } from 'react-router-dom';
import { Sidebar } from './components/Sidebar';
import { MobileSidebar } from './components/MobileSidebar';
import { ToastContainer } from './components/Toast';
import { clearAuth, getCurrentUser, getStoredAuthUser, logout, type AuthUser } from './api/client';
import { type ThemeMode } from './types/theme';

const LoginPage = lazy(() => import('./pages/LoginPage').then(m => ({ default: m.LoginPage })));
const HomePage = lazy(() => import('./pages/HomePage').then(m => ({ default: m.HomePage })));
const CrawlPage = lazy(() => import('./pages/CrawlPage').then(m => ({ default: m.CrawlPage })));
const ResultPage = lazy(() => import('./pages/ResultPage').then(m => ({ default: m.ResultPage })));
const CrawlHistory = lazy(() => import('./pages/CrawlHistoryPage'));
const BatchPage = lazy(() => import('./pages/BatchPage').then(m => ({ default: m.BatchPage })));
const BedReadPage = lazy(() => import('./pages/BedReadPage').then(m => ({ default: m.BedReadPage })));
const BedReadJobsPage = lazy(() => import('./pages/BedReadJobsPage').then(m => ({ default: m.default })));
const DriveSyncPage = lazy(() => import('./pages/DriveSyncPage').then(m => ({ default: m.DriveSyncPage })));
const DriveSyncHistoryPage = lazy(() => import('./pages/DriveSyncHistoryPage').then(m => ({ default: m.DriveSyncHistoryPage })));
const ChapterContentUpdatePage = lazy(() => import('./pages/ChapterContentUpdatePage').then(m => ({ default: m.ChapterContentUpdatePage })));
const AutoAudioPage = lazy(() => import('./pages/AutoAudioPage').then(m => ({ default: m.AutoAudioPage })));
const AutoAudioHistoryPage = lazy(() => import('./pages/AutoAudioHistoryPage').then(m => ({ default: m.AutoAudioHistoryPage })));
const SupportedSitesPage = lazy(() => import('./pages/SupportedSitesPage').then(m => ({ default: m.SupportedSitesPage })));
const SettingsPage = lazy(() => import('./pages/SettingsPage').then(m => ({ default: m.SettingsPage })));
const DashboardPage = lazy(() => import('./pages/DashboardPage').then(m => ({ default: m.DashboardPage })));

const THEME_COOKIE = 'novel_crawler_theme';

function readThemeCookie(): ThemeMode | null {
  const match = document.cookie.match(new RegExp(`(?:^|; )${THEME_COOKIE}=([^;]*)`));
  if (!match) return null;
  const value = decodeURIComponent(match[1]);
  return value === 'light' || value === 'dark' ? value : null;
}

function writeThemeCookie(mode: ThemeMode) {
  const maxAge = 60 * 60 * 24 * 365;
  document.cookie = `${THEME_COOKIE}=${encodeURIComponent(mode)}; path=/; max-age=${maxAge}; samesite=lax`;
}

function App() {
  const [themeMode, setThemeMode] = useState<ThemeMode>(() => readThemeCookie() ?? 'light');
  const [authUser, setAuthUser] = useState<AuthUser | null>(() => getStoredAuthUser());
  const [authChecked, setAuthChecked] = useState(false);
  const loginThemeMode: ThemeMode = 'light';

  useEffect(() => {
    const root = document.documentElement;
    root.dataset.theme = themeMode;
    root.dataset.themeMode = themeMode;
    root.style.colorScheme = themeMode;
  }, [themeMode]);

  useEffect(() => {
    let cancelled = false;
    getCurrentUser()
      .then((user) => {
        if (!cancelled) setAuthUser(user);
      })
      .catch(() => {
        clearAuth();
        if (!cancelled) setAuthUser(null);
      })
      .finally(() => {
        if (!cancelled) setAuthChecked(true);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const handleThemeChange = useCallback((mode: ThemeMode) => {
    setThemeMode(mode);
    writeThemeCookie(mode);
  }, []);

  const handleLogout = useCallback(async () => {
    await logout();
    setAuthUser(null);
  }, []);

  return (
    <BrowserRouter
      future={{
        v7_startTransition: true,
        v7_relativeSplatPath: true,
      }}
    >
      {!authChecked ? (
        <AuthLoading themeMode={themeMode} />
      ) : authUser ? (
        <Shell
          themeMode={themeMode}
          onThemeChange={handleThemeChange}
          authUser={authUser}
          onLogout={handleLogout}
        />
      ) : (
        <Suspense fallback={<AuthLoading themeMode={loginThemeMode} />}>
          <LoginPage
            themeMode={loginThemeMode}
            onThemeChange={handleThemeChange}
            onAuthenticated={(user) => setAuthUser(user)}
          />
        </Suspense>
      )}
    </BrowserRouter>
  );
}

function Shell({
  themeMode,
  onThemeChange,
  authUser,
  onLogout,
}: {
  themeMode: ThemeMode;
  onThemeChange: (mode: ThemeMode) => void;
  authUser: AuthUser;
  onLogout: () => void;
}) {
  const isDark = themeMode === 'dark';
  const [mobileSidebarOpen, setMobileSidebarOpen] = useState(false);
  const [accountOpen, setAccountOpen] = useState(false);
  const location = useLocation();
  const isDashboard = location.pathname.startsWith('/dashboard');

  return (
    <>
      {!isDashboard && (
        <Sidebar
          themeMode={themeMode}
          onThemeChange={onThemeChange}
        />
      )}

      {!isDashboard && (
        <MobileSidebar
          themeMode={themeMode}
          onThemeChange={onThemeChange}
          isOpen={mobileSidebarOpen}
          onClose={() => setMobileSidebarOpen(false)}
        />
      )}

      <AccountMenu
        authUser={authUser}
        isDark={isDark}
        isOpen={accountOpen}
        onToggle={() => setAccountOpen(open => !open)}
        onClose={() => setAccountOpen(false)}
        onLogout={onLogout}
      />

      {!isDashboard && (
      <header className={`lg:hidden fixed top-0 left-0 right-0 z-30 safe-area-top ${
        isDark
          ? 'bg-slate-950/95 border-b border-slate-800/80 backdrop-blur-xl'
          : 'bg-gray-50/95 border-b border-gray-200/80 backdrop-blur-xl shadow-sm'
      }`}>
        <div className="flex items-center gap-3 px-4 py-3">
          <button
            onClick={() => setMobileSidebarOpen(true)}
            className={`p-2 rounded-lg transition-colors ${
              isDark
                ? 'text-slate-400 hover:text-slate-200 hover:bg-slate-800/60'
                : 'text-gray-500 hover:text-gray-700 hover:bg-gray-100/80'
            }`}
            title="Open menu"
          >
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 6h16M4 12h16M4 18h16" />
            </svg>
          </button>
          <h1 className={`text-base font-bold ${isDark ? 'text-slate-100' : 'text-gray-900'}`}>
            Novel Crawler
          </h1>
          <div className="ml-auto w-10" />
        </div>
      </header>
      )}

      <div
        className={`min-h-screen transition-colors duration-300 ${
          isDark ? 'bg-slate-950' : 'bg-gray-50'
        }`}
      >
        <div className={`${isDashboard ? 'pt-0 pl-0' : 'pt-14 lg:pt-0 pl-0 lg:pl-[248px]'} min-h-screen transition-all duration-300`}>
          <Suspense fallback={
            <div className={`flex items-center justify-center h-screen ${isDark ? 'bg-slate-950 text-slate-400' : 'bg-gray-50 text-gray-500'}`}>
              Loading...
            </div>
          }>
            <Routes>
              <Route path="/" element={<HomePage themeMode={themeMode} onThemeChange={onThemeChange} />} />
              <Route path="/batch" element={<BatchPage themeMode={themeMode} onThemeChange={onThemeChange} />} />
              <Route path="/crawl" element={<CrawlPage themeMode={themeMode} onThemeChange={onThemeChange} />} />
              <Route path="/results" element={<ResultPage themeMode={themeMode} />} />
              <Route path="/results/all" element={<CrawlHistory themeMode={themeMode} />} />
              <Route path="/bedread" element={<BedReadPage themeMode={themeMode} onThemeChange={onThemeChange} />} />
              <Route path="/bedread/jobs" element={<BedReadJobsPage themeMode={themeMode} onThemeChange={onThemeChange} />} />
              <Route path="/drive-sync" element={<DriveSyncPage themeMode={themeMode} onThemeChange={onThemeChange} />} />
              <Route path="/drive-sync/content-update" element={<ChapterContentUpdatePage themeMode={themeMode} onThemeChange={onThemeChange} />} />
              <Route path="/drive-sync/history" element={<DriveSyncHistoryPage themeMode={themeMode} onThemeChange={onThemeChange} />} />
              <Route path="/auto-audio" element={<AutoAudioPage themeMode={themeMode} onThemeChange={onThemeChange} />} />
              <Route path="/auto-audio/history" element={<AutoAudioHistoryPage themeMode={themeMode} onThemeChange={onThemeChange} />} />
              <Route path="/settings" element={<SettingsPage themeMode={themeMode} onThemeChange={onThemeChange} />} />
              <Route path="/supported-sites" element={<SupportedSitesPage themeMode={themeMode} onThemeChange={onThemeChange} />} />
              <Route path="/dashboard/*" element={authUser.role === 'admin' ? <DashboardPage themeMode={themeMode} authUser={authUser} /> : <Navigate to="/" replace />} />
              <Route path="/admin/users" element={<Navigate to="/dashboard/users" replace />} />
              <Route path="*" element={<Navigate to="/" replace />} />
            </Routes>
          </Suspense>
        </div>
      </div>

      {/* Global Toast Notifications */}
      <ToastContainer />
    </>
  );
}

function AuthLoading({ themeMode }: { themeMode: ThemeMode }) {
  const isDark = themeMode === 'dark';
  return (
    <div className={`min-h-screen flex items-center justify-center ${isDark ? 'bg-slate-950 text-slate-300' : 'bg-gray-50 text-gray-600'}`}>
      Loading...
    </div>
  );
}

function AccountMenu({
  authUser,
  isDark,
  isOpen,
  onToggle,
  onClose,
  onLogout,
}: {
  authUser: AuthUser;
  isDark: boolean;
  isOpen: boolean;
  onToggle: () => void;
  onClose: () => void;
  onLogout: () => void;
}) {
  return (
    <div className="fixed right-4 top-3 z-[70]">
      <button
        type="button"
        onClick={onToggle}
        className={`relative w-10 h-10 rounded-xl border inline-flex items-center justify-center transition-colors ${
          isDark
            ? 'border-white/[0.08] bg-slate-950/80 text-slate-200 hover:bg-slate-900'
            : 'border-black/10 bg-white/90 text-slate-700 hover:bg-slate-50 shadow-sm'
        }`}
        title="Account"
        aria-label="Account menu"
      >
        <span className={`absolute -top-1.5 -right-1.5 rounded px-1.5 py-0.5 text-[0.6rem] font-bold uppercase tracking-wide ${
          authUser.role === 'admin'
            ? 'bg-indigo-600 text-white'
            : isDark ? 'bg-slate-700 text-slate-200' : 'bg-slate-200 text-slate-700'
        }`}>
          {authUser.role}
        </span>
        <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.8} d="M15.75 7.5a3.75 3.75 0 11-7.5 0 3.75 3.75 0 017.5 0zM4.5 20.25a7.5 7.5 0 0115 0" />
        </svg>
      </button>

      {isOpen && (
        <>
          <button
            type="button"
            aria-label="Close account menu"
            className="fixed inset-0 -z-10 cursor-default"
            onClick={onClose}
          />
          <div className={`absolute right-0 mt-2 w-72 rounded-xl border p-3 shadow-2xl ${
            isDark
              ? 'border-white/[0.08] bg-slate-950/95 text-slate-200'
              : 'border-black/10 bg-white/95 text-slate-800'
          }`}>
            <div className={`px-3 py-2 rounded-lg ${isDark ? 'bg-white/[0.04]' : 'bg-black/[0.03]'}`}>
              <div className="truncate text-sm font-semibold">{authUser.email}</div>
              <div className={`mt-1 text-xs uppercase ${isDark ? 'text-slate-400' : 'text-slate-500'}`}>{authUser.role}</div>
            </div>
            <div className="mt-2 space-y-1">
              {authUser.role === 'admin' && (
                <Link
                  to="/dashboard"
                  onClick={onClose}
                  className={`flex items-center gap-2 rounded-lg px-3 py-2 text-sm font-medium transition-colors ${
                    isDark ? 'text-slate-300 hover:bg-white/[0.06]' : 'text-slate-700 hover:bg-black/[0.05]'
                  }`}
                  style={{ textDecoration: 'none' }}
                >
                  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.8} d="M4 5a2 2 0 012-2h5v8H4V5zm9-2h5a2 2 0 012 2v3h-7V3zM4 13h7v8H6a2 2 0 01-2-2v-6zm9-3h7v9a2 2 0 01-2 2h-5V10z" />
                  </svg>
                  Dashboard
                </Link>
              )}
              <button
                type="button"
                onClick={() => {
                  onClose();
                  void onLogout();
                }}
                className={`w-full flex items-center gap-2 rounded-lg px-3 py-2 text-sm font-medium transition-colors ${
                  isDark ? 'text-red-300 hover:bg-red-500/10' : 'text-red-600 hover:bg-red-50'
                }`}
              >
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.8} d="M15.75 9V5.25A2.25 2.25 0 0013.5 3h-6A2.25 2.25 0 005.25 5.25v13.5A2.25 2.25 0 007.5 21h6a2.25 2.25 0 002.25-2.25V15m3-3h-9m9 0l-3-3m3 3l-3 3" />
                </svg>
                Sign out
              </button>
            </div>
          </div>
        </>
      )}
    </div>
  );
}

export default App;
