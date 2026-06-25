import { lazy, Suspense, useCallback, useEffect, useState } from 'react';
import { BrowserRouter, Navigate, Route, Routes, useLocation } from 'react-router-dom';
import faviconLightUrl from './assets/favicon.svg';
import faviconDarkUrl from './assets/favicon-dark.svg';
import { Sidebar } from './components/Shared/Sidebar';
import { MobileSidebar } from './components/Shared/Mobile/MobileSidebar';
import { ToastContainer } from './components/Shared/Toast';
import { ErrorBoundary } from './components/Shared/ErrorBoundary';
import {
  AUTH_SESSION_EXPIRED_EVENT,
  AUTH_USER_KEY,
  clearAuth,
  getCurrentUser,
  getStoredAuthUser,
  logout,
  type AuthUser,
} from './api';
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
const CheckBannerUpdatePage = lazy(() => import('./pages/BedReadDriveSync/CheckBannerUpdatePage').then(m => ({ default: m.CheckBannerUpdatePage })));
const MetadataUpdatePage = lazy(() => import('./pages/BedReadDriveSync/MetadataUpdatePage').then(m => ({ default: m.MetadataUpdatePage })));
const CheckTitleUpdatePage = lazy(() => import('./pages/BedReadDriveSync/CheckTitleUpdatePage').then(m => ({ default: m.CheckTitleUpdatePage })));
const AutoAudioPage = lazy(() => import('./pages/AutoAudio/AutoAudioPage').then(m => ({ default: m.AutoAudioPage })));
const AutoAudioHistoryPage = lazy(() => import('./pages/AutoAudio/AutoAudioHistoryPage').then(m => ({ default: m.AutoAudioHistoryPage })));
const SupportedSitesPage = lazy(() => import('./pages/Shared/SupportedSitesPage').then(m => ({ default: m.SupportedSitesPage })));
const SettingsPage = lazy(() => import('./pages/Shared/SettingsPage').then(m => ({ default: m.SettingsPage })));
const MobileSettingsPage = lazy(() => import('./pages/Shared/Mobile/MobileSettingsPage').then(m => ({ default: m.MobileSettingsPage })));
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

function usePrefersReducedMotion(): boolean {
  return window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false;
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

  useEffect(() => {
    const handleSessionExpired = () => setAuthUser(null);
    const handleStorageChange = (event: StorageEvent) => {
      if (event.key === AUTH_USER_KEY && event.newValue === null) {
        setAuthUser(null);
      }
    };

    window.addEventListener(AUTH_SESSION_EXPIRED_EVENT, handleSessionExpired);
    window.addEventListener('storage', handleStorageChange);
    return () => {
      window.removeEventListener(AUTH_SESSION_EXPIRED_EVENT, handleSessionExpired);
      window.removeEventListener('storage', handleStorageChange);
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
    <ErrorBoundary>
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
    </ErrorBoundary>
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
  const prefersReducedMotion = usePrefersReducedMotion();

  const handleOpenSettings = useCallback(() => {
    setSettingsOpen(true);
    setMobileSidebarOpen(false);
  }, []);

  const handleCloseSettings = useCallback(() => {
    setSettingsOpen(false);
  }, []);

  return (
    <>
      {/* Skip to main content link for keyboard accessibility */}
      <a
        href="#main-content"
        className="sr-only focus:not-sr-only focus:fixed focus:top-4 focus:left-4 focus:z-[200] focus:rounded-lg focus:bg-blue-600 focus:px-4 focus:py-2 focus:text-sm focus:font-medium focus:text-white focus:shadow-lg"
      >
        Skip to main content
      </a>

      {!isDashboard && (
        <Sidebar
          themeMode={themeMode}
          onOpenSettings={handleOpenSettings}
          authUser={authUser}
          onLogout={onLogout}
        />
      )}

      {!isDashboard && (
        <MobileSidebar
          themeMode={themeMode}
          onOpenSettings={handleOpenSettings}
          isOpen={mobileSidebarOpen}
          onClose={() => setMobileSidebarOpen(false)}
        />
      )}

      {!isDashboard && (
      <header className={`fixed top-0 left-0 right-0 z-30 border-b safe-area-top lg:hidden ${themeMode === 'dark' ? 'border-white/10 bg-[#191919]' : 'border-black/10 bg-[#fbfbfa]'}`}>
        <div className="flex items-center gap-2 px-3 py-2.5">
          <button
            onClick={() => setMobileSidebarOpen(true)}
            className={`rounded-lg border p-2 transition-colors ${themeMode === 'dark' ? 'border-white/10 text-white/60 hover:bg-white/5 hover:text-white/88' : 'border-black/10 text-black/60 hover:bg-black/5 hover:text-black/88'}`}
            title="Open menu"
          >
            <Icon icon={appIcons.menu} className="h-4.5 w-4.5" />
          </button>
          <h1 className={`text-sm font-semibold tracking-[0.01em] ${themeMode === 'dark' ? 'text-white/92' : 'text-[#37352f]'}`}>
            Novel Crawler
          </h1>
          <div className="ml-auto w-9" />
        </div>
      </header>
      )}

      <div className={`min-h-screen ${prefersReducedMotion ? '' : 'transition-colors duration-300'} ${themeMode === 'dark' ? 'bg-[#050505]' : 'bg-white'}`}>
        <div id="main-content" className={`${isDashboard ? 'pt-0 pl-0' : 'pt-14 lg:pt-0 pl-0 lg:pl-[248px]'} min-h-screen ${prefersReducedMotion ? '' : 'transition-all duration-300'}`}>
          <Suspense fallback={
            <div className={`flex h-screen items-center justify-center ${themeMode === 'dark' ? 'bg-[#050505] text-white/45' : 'bg-white text-black/30'}`}>
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
              <Route path="/drive-sync/banner-update" element={<CheckBannerUpdatePage themeMode={themeMode}  />} />
              <Route path="/drive-sync/metadata-update" element={<MetadataUpdatePage themeMode={themeMode} />} />
              <Route path="/drive-sync/title-update" element={<CheckTitleUpdatePage themeMode={themeMode} />} />
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
        <>
          <MobileSettingsPage themeMode={themeMode} onThemeChange={onThemeChange} onClose={handleCloseSettings} onLogout={onLogout} />
          <SettingsPage themeMode={themeMode} onThemeChange={onThemeChange} onClose={handleCloseSettings} onLogout={onLogout} />
        </>
      )}

      <ToastContainer />
    </>
  );
}

function AuthLoading({ themeMode }: Readonly<{ themeMode: ThemeMode }>) {
  const isDark = themeMode === 'dark';
  return (
    <div className={`flex min-h-screen items-center justify-center ${isDark ? 'bg-[#050505] text-white/45' : 'bg-white text-black/30'}`}>
      Loading...
    </div>
  );
}

export default App;
