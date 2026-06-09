import { lazy, Suspense, useCallback, useEffect, useState } from 'react';
import { BrowserRouter, Navigate, Route, Routes, useLocation } from 'react-router-dom';
import faviconLightUrl from './assets/favicon.svg';
import faviconDarkUrl from './assets/favicon-dark.svg';
import { Sidebar } from './components/Shared/Sidebar';
import { MobileSidebar } from './components/Shared/Mobile/MobileSidebar';
import { ToastContainer } from './components/Shared/Toast';
import { clearAuth, getCurrentUser, getStoredAuthUser, logout, type AuthUser } from './api/client';
import { Icon, appIcons } from './components/Shared/Icon';
import { type ThemeMode } from './types/theme';

const LoginPage = lazy(() => import('./pages/Shared/LoginPage').then(m => ({ default: m.LoginPage })));
const HomePage = lazy(() => import('./pages/NovelCrawler/HomePage').then(m => ({ default: m.HomePage })));
const CrawlPage = lazy(() => import('./pages/NovelCrawler/CrawlPage').then(m => ({ default: m.CrawlPage })));
const ResultPage = lazy(() => import('./pages/NovelCrawler/ResultPage').then(m => ({ default: m.ResultPage })));
const CrawlHistory = lazy(() => import('./pages/NovelCrawler/CrawlHistoryPage').then(m => ({ default: m.default })));
const BatchPage = lazy(() => import('./pages/NovelCrawler/BatchPage').then(m => ({ default: m.BatchPage })));
const BedReadPage = lazy(() => import('./pages/BedReadVoices/BedReadPage').then(m => ({ default: m.BedReadPage })));
const BedReadJobsPage = lazy(() => import('./pages/BedReadVoices/BedReadJobsPage').then(m => ({ default: m.default })));
const DriveSyncPage = lazy(() => import('./pages/BedReadDriveSync/DriveSyncPage').then(m => ({ default: m.DriveSyncPage })));
const DriveSyncHistoryPage = lazy(() => import('./pages/BedReadDriveSync/DriveSyncHistoryPage').then(m => ({ default: m.DriveSyncHistoryPage })));
const ChapterContentUpdatePage = lazy(() => import('./pages/Admin/ChapterContentUpdatePage').then(m => ({ default: m.ChapterContentUpdatePage })));
const CoverUpdatePage = lazy(() => import('./pages/BedReadDriveSync/CoverUpdatePage').then(m => ({ default: m.CoverUpdatePage })));
const AutoAudioPage = lazy(() => import('./pages/AutoAudio/AutoAudioPage').then(m => ({ default: m.AutoAudioPage })));
const AutoAudioHistoryPage = lazy(() => import('./pages/AutoAudio/AutoAudioHistoryPage').then(m => ({ default: m.AutoAudioHistoryPage })));
const SupportedSitesPage = lazy(() => import('./pages/Shared/SupportedSitesPage').then(m => ({ default: m.SupportedSitesPage })));
const SettingsPage = lazy(() => import('./pages/Shared/SettingsPage').then(m => ({ default: m.SettingsPage })));
const DashboardPage = lazy(() => import('./pages/Admin/DashboardPage').then(m => ({ default: m.DashboardPage })));

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

    const favicon = document.querySelector<HTMLLinkElement>("link[rel='icon']");
    if (favicon) {
      favicon.href = themeMode === 'dark' ? faviconDarkUrl : faviconLightUrl;
    }
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
  const [settingsOpen, setSettingsOpen] = useState(false);
  const location = useLocation();
  const isDashboard = location.pathname.startsWith('/dashboard');

  const handleOpenSettings = useCallback(() => {
    setSettingsOpen(true);
    setMobileSidebarOpen(false);
  }, []);

  const handleCloseSettings = useCallback(() => {
    setSettingsOpen(false);
  }, []);

  return (
    <>
      {!isDashboard && (
        <Sidebar
          themeMode={themeMode}
          onThemeChange={onThemeChange}
          isSettingsOpen={settingsOpen}
          onOpenSettings={handleOpenSettings}
          authUser={authUser}
          onLogout={onLogout}
        />
      )}

      {!isDashboard && (
        <MobileSidebar
          themeMode={themeMode}
          onThemeChange={onThemeChange}
          isSettingsOpen={settingsOpen}
          onOpenSettings={handleOpenSettings}
          isOpen={mobileSidebarOpen}
          onClose={() => setMobileSidebarOpen(false)}
        />
      )}

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
            <Icon icon={appIcons.menu} className="w-5 h-5" />
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
              <Route path="/drive-sync/cover-update" element={<CoverUpdatePage themeMode={themeMode} onThemeChange={onThemeChange} />} />
              <Route path="/drive-sync/history" element={<DriveSyncHistoryPage themeMode={themeMode} onThemeChange={onThemeChange} />} />
              <Route path="/auto-audio" element={<AutoAudioPage themeMode={themeMode} onThemeChange={onThemeChange} />} />
              <Route path="/auto-audio/history" element={<AutoAudioHistoryPage themeMode={themeMode} onThemeChange={onThemeChange} />} />
              <Route path="/settings" element={<Navigate to="/" replace />} />
              <Route path="/supported-sites" element={<SupportedSitesPage themeMode={themeMode} onThemeChange={onThemeChange} />} />
              <Route path="/dashboard/*" element={authUser.role === 'admin' ? <DashboardPage themeMode={themeMode} authUser={authUser} /> : <Navigate to="/" replace />} />
              <Route path="/admin/users" element={<Navigate to="/dashboard/users" replace />} />
              <Route path="*" element={<Navigate to="/" replace />} />
            </Routes>
          </Suspense>
        </div>
      </div>

      {settingsOpen && (
        <SettingsPage themeMode={themeMode} onThemeChange={onThemeChange} onClose={handleCloseSettings} onLogout={onLogout} />
      )}

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

export default App;
