import { lazy, Suspense, useCallback, useEffect, useState } from 'react';
import { BrowserRouter, Navigate, Route, Routes, useLocation } from 'react-router-dom';
import faviconLightUrl from './assets/favicon.svg';
import faviconDarkUrl from './assets/favicon-dark.svg';
import { Sidebar } from './components/Shared/Sidebar';
import { MobileSidebar } from './components/Shared/Mobile/MobileSidebar';
import { ToastContainer } from './components/Shared/Toast';
import { clearAuth, getCurrentUser, getStoredAuthUser, logout, type AuthUser } from './api';
import { Icon, appIcons } from './components/Shared/Icon';
import { type ThemeMode } from './types/theme';

const LoginPage = lazy(() => import('./pages/Shared/LoginPage').then(m => ({ default: m.LoginPage })));
const HomePage = lazy(() => import('./pages/NovelCrawler/HomePage').then(m => ({ default: m.HomePage })));
const CrawlPage = lazy(() => import('./pages/NovelCrawler/CrawlPage').then(m => ({ default: m.CrawlPage })));
const ResultPage = lazy(() => import('./pages/NovelCrawler/ResultPage').then(m => ({ default: m.ResultPage })));
const CrawlHistory = lazy(() => import('./pages/NovelCrawler/CrawlHistoryPage').then(m => ({ default: m.default })));
const BedReadPage = lazy(() => import('./pages/BedReadVoices/BedReadPage').then(m => ({ default: m.BedReadPage })));
const BedReadJobsPage = lazy(() => import('./pages/BedReadVoices/BedReadJobsPage').then(m => ({ default: m.default })));
const DriveSyncPage = lazy(() => import('./pages/BedReadDriveSync/DriveSyncPage').then(m => ({ default: m.DriveSyncPage })));
const DriveSyncHistoryPage = lazy(() => import('./pages/BedReadDriveSync/DriveSyncHistoryPage').then(m => ({ default: m.DriveSyncHistoryPage })));
const ChapterContentUpdatePage = lazy(() => import('./pages/BedReadDriveSync/ChapterContentUpdatePage').then(m => ({ default: m.ChapterContentUpdatePage })));
const CoverUpdatePage = lazy(() => import('./pages/BedReadDriveSync/CoverUpdatePage').then(m => ({ default: m.CoverUpdatePage })));
const AutoAudioPage = lazy(() => import('./pages/AutoAudio/AutoAudioPage').then(m => ({ default: m.AutoAudioPage })));
const AutoAudioHistoryPage = lazy(() => import('./pages/AutoAudio/AutoAudioHistoryPage').then(m => ({ default: m.AutoAudioHistoryPage })));
const SupportedSitesPage = lazy(() => import('./pages/Shared/SupportedSitesPage').then(m => ({ default: m.SupportedSitesPage })));
const SettingsPage = lazy(() => import('./pages/Shared/SettingsPage').then(m => ({ default: m.SettingsPage })));
const DashboardPage = lazy(() => import('./pages/Admin/DashboardPage').then(m => ({ default: m.DashboardPage })));

const THEME_COOKIE = 'novel_crawler_theme';

function readThemeCookie(): ThemeMode | null {
  const re = new RegExp(`(?:^|; )${THEME_COOKIE}=([^;]*)`);
  const match = re.exec(document.cookie);
  if (!match) return null;
  const value = decodeURIComponent(match[1]);
  return value === 'light' || value === 'dark' ? value : null;
}

function writeThemeCookie(mode: ThemeMode) {
  const maxAge = 60 * 60 * 24 * 365;
  document.cookie = `${THEME_COOKIE}=${encodeURIComponent(mode)}; path=/; max-age=${maxAge}; samesite=lax`;
}

function App() {
  const [themeMode, setThemeMode] = useState<ThemeMode>(() => readThemeCookie() ?? 'dark');
  const [authUser, setAuthUser] = useState<AuthUser | null>(() => getStoredAuthUser());
  const [authChecked, setAuthChecked] = useState(false);
  const loginThemeMode: ThemeMode = 'dark';

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
      {authChecked === false ? (
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
}: Readonly<{
  themeMode: ThemeMode;
  onThemeChange: (mode: ThemeMode) => void;
  authUser: AuthUser;
  onLogout: () => void;
}>) {
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
          
          isSettingsOpen={settingsOpen}
          onOpenSettings={handleOpenSettings}
          authUser={authUser}
          onLogout={onLogout}
        />
      )}

      {!isDashboard && (
        <MobileSidebar
          themeMode={themeMode}
          
          isSettingsOpen={settingsOpen}
          onOpenSettings={handleOpenSettings}
          isOpen={mobileSidebarOpen}
          onClose={() => setMobileSidebarOpen(false)}
        />
      )}

      {!isDashboard && (
      <header className="fixed top-0 left-0 right-0 z-30 border-b border-white/10 bg-[#0f0f0f] safe-area-top lg:hidden">
        <div className="flex items-center gap-2 px-3 py-2.5">
          <button
            onClick={() => setMobileSidebarOpen(true)}
            className="rounded-lg border border-white/10 p-2 text-white/60 transition-colors hover:bg-white/5 hover:text-white/88"
            title="Open menu"
          >
            <Icon icon={appIcons.menu} className="h-4.5 w-4.5" />
          </button>
          <h1 className="text-sm font-semibold tracking-[0.01em] text-white/92">
            Novel Crawler
          </h1>
          <div className="ml-auto w-9" />
        </div>
      </header>
      )}

      <div className="min-h-screen bg-[#050505] transition-colors duration-300">
        <div className={`${isDashboard ? 'pt-0 pl-0' : 'pt-14 lg:pt-0 pl-0 lg:pl-[248px]'} min-h-screen transition-all duration-300`}>
          <Suspense fallback={
            <div className="flex h-screen items-center justify-center bg-[#050505] text-white/45">
              Loading...
            </div>
          }>
            <Routes>
              <Route path="/" element={<HomePage themeMode={themeMode}  />} />
              <Route path="/crawl" element={<CrawlPage themeMode={themeMode}  />} />
              <Route path="/results" element={<ResultPage themeMode={themeMode} />} />
              <Route path="/results/all" element={<CrawlHistory themeMode={themeMode} />} />
              <Route path="/bedread" element={<BedReadPage themeMode={themeMode} />} />
              <Route path="/bedread/jobs" element={<BedReadJobsPage themeMode={themeMode} />} />
              <Route path="/drive-sync" element={<DriveSyncPage themeMode={themeMode}  />} />
              <Route path="/drive-sync/content-update" element={<ChapterContentUpdatePage themeMode={themeMode}  />} />
              <Route path="/drive-sync/cover-update" element={<CoverUpdatePage themeMode={themeMode}  />} />
              <Route path="/drive-sync/history" element={<DriveSyncHistoryPage themeMode={themeMode}  />} />
              <Route path="/auto-audio" element={<AutoAudioPage themeMode={themeMode}  />} />
              <Route path="/auto-audio/history" element={<AutoAudioHistoryPage themeMode={themeMode}  />} />
              <Route path="/settings" element={<Navigate to="/" replace />} />
              <Route path="/supported-sites" element={<SupportedSitesPage themeMode={themeMode} />} />
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

function AuthLoading({ themeMode: _ }: Readonly<{ themeMode: ThemeMode }>) {
  return (
    <div className="flex min-h-screen items-center justify-center bg-[#050505] text-white/45">
      Loading...
    </div>
  );
}

export default App;
