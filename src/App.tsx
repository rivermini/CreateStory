import { lazy, Suspense, useCallback, useEffect, useState, type FormEvent } from 'react';
import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom';
import { Sidebar } from './components/Sidebar';
import { MobileSidebar } from './components/MobileSidebar';
import { ToastContainer } from './components/Toast';
import { clearAuth, getCurrentUser, getStoredAuthUser, login, logout, register, type AuthUser } from './api/client';
import { type ThemeMode } from './types/theme';

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
        <AuthScreen
          themeMode={themeMode}
          onThemeChange={handleThemeChange}
          onAuthenticated={(user) => setAuthUser(user)}
        />
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
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [mobileSidebarOpen, setMobileSidebarOpen] = useState(false);

  return (
    <>
      <Sidebar
        themeMode={themeMode}
        onThemeChange={onThemeChange}
        isCollapsed={sidebarCollapsed}
        onToggleCollapse={() => setSidebarCollapsed((c) => !c)}
        rightActions={
          <UserBadge authUser={authUser} isDark={isDark} onLogout={onLogout} />
        }
      />

      <MobileSidebar
        themeMode={themeMode}
        onThemeChange={onThemeChange}
        isOpen={mobileSidebarOpen}
        onClose={() => setMobileSidebarOpen(false)}
      />

      {/* Mobile header */}
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
          <button
            type="button"
            onClick={onLogout}
            className={`ml-auto h-9 px-3 rounded-md text-sm font-medium border transition-colors ${
              isDark
                ? 'border-slate-700 text-slate-300 hover:bg-slate-800'
                : 'border-gray-300 text-gray-700 hover:bg-gray-100'
            }`}
          >
            Sign out
          </button>
        </div>
      </header>

      <div
        className={`min-h-screen transition-colors duration-300 ${
          isDark ? 'bg-slate-950' : 'bg-gray-50'
        }`}
      >
        <div className={`pt-14 lg:pt-0 ${sidebarCollapsed ? 'pl-[72px] lg:pl-[72px]' : 'pl-0 lg:pl-[248px]'} min-h-screen transition-all duration-300`}>
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

function AuthScreen({
  themeMode,
  onThemeChange,
  onAuthenticated,
}: {
  themeMode: ThemeMode;
  onThemeChange: (mode: ThemeMode) => void;
  onAuthenticated: (user: AuthUser) => void;
}) {
  const isDark = themeMode === 'dark';
  const [mode, setMode] = useState<'login' | 'register'>('login');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const tokens = mode === 'login'
        ? await login(email, password)
        : await register(email, password);
      onAuthenticated(tokens.user);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Authentication failed.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <main className={`min-h-screen flex items-center justify-center px-4 ${isDark ? 'bg-slate-950' : 'bg-gray-50'}`}>
      <div className="w-full max-w-sm">
        <div className="flex items-center justify-between mb-6">
          <div>
            <h1 className={`text-2xl font-bold ${isDark ? 'text-slate-100' : 'text-gray-950'}`}>
              CreateStory
            </h1>
            <p className={`mt-1 text-sm ${isDark ? 'text-slate-400' : 'text-gray-500'}`}>
              {mode === 'login' ? 'Sign in to continue.' : 'Create the first account to initialize admin access.'}
            </p>
          </div>
          <button
            type="button"
            onClick={() => onThemeChange(themeMode === 'dark' ? 'light' : 'dark')}
            className={`h-9 w-9 rounded-md border flex items-center justify-center ${
              isDark ? 'border-slate-700 text-slate-300 hover:bg-slate-900' : 'border-gray-300 text-gray-600 hover:bg-white'
            }`}
            title="Toggle theme"
          >
            {themeMode === 'dark' ? (
              <svg className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
                <circle cx="12" cy="12" r="4" />
                <path d="M12 2v2M12 20v2M4 12H2M22 12h-2M5 5l1.5 1.5M18.5 18.5 20 20M5 19l1.5-1.5M18.5 6.5 20 5" />
              </svg>
            ) : (
              <svg className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
                <path d="M21 12.8A9 9 0 1 1 11.2 3 7 7 0 0 0 21 12.8z" />
              </svg>
            )}
          </button>
        </div>

        <form
          onSubmit={submit}
          className={`rounded-lg border p-5 shadow-sm ${
            isDark ? 'border-slate-800 bg-slate-900' : 'border-gray-200 bg-white'
          }`}
        >
          <div className={`grid grid-cols-2 rounded-md p-1 mb-5 ${isDark ? 'bg-slate-950' : 'bg-gray-100'}`}>
            <button
              type="button"
              onClick={() => setMode('login')}
              className={`h-9 rounded text-sm font-medium transition-colors ${mode === 'login' ? 'bg-indigo-600 text-white' : isDark ? 'text-slate-400' : 'text-gray-600'}`}
            >
              Sign in
            </button>
            <button
              type="button"
              onClick={() => setMode('register')}
              className={`h-9 rounded text-sm font-medium transition-colors ${mode === 'register' ? 'bg-indigo-600 text-white' : isDark ? 'text-slate-400' : 'text-gray-600'}`}
            >
              Create
            </button>
          </div>

          <label className={`block text-sm font-medium mb-1 ${isDark ? 'text-slate-300' : 'text-gray-700'}`} htmlFor="auth-email">
            Email
          </label>
          <input
            id="auth-email"
            type="email"
            value={email}
            onChange={(event) => setEmail(event.target.value)}
            autoComplete="email"
            required
            className={`w-full h-11 rounded-md border px-3 text-sm outline-none focus:ring-2 focus:ring-indigo-500 ${
              isDark ? 'border-slate-700 bg-slate-950 text-slate-100' : 'border-gray-300 bg-white text-gray-900'
            }`}
          />

          <label className={`block text-sm font-medium mt-4 mb-1 ${isDark ? 'text-slate-300' : 'text-gray-700'}`} htmlFor="auth-password">
            Password
          </label>
          <input
            id="auth-password"
            type="password"
            value={password}
            onChange={(event) => setPassword(event.target.value)}
            autoComplete={mode === 'login' ? 'current-password' : 'new-password'}
            minLength={mode === 'register' ? 8 : undefined}
            required
            className={`w-full h-11 rounded-md border px-3 text-sm outline-none focus:ring-2 focus:ring-indigo-500 ${
              isDark ? 'border-slate-700 bg-slate-950 text-slate-100' : 'border-gray-300 bg-white text-gray-900'
            }`}
          />

          {error && (
            <div className={`mt-4 rounded-md border px-3 py-2 text-sm ${isDark ? 'border-red-900 bg-red-950 text-red-200' : 'border-red-200 bg-red-50 text-red-700'}`}>
              {error}
            </div>
          )}

          <button
            type="submit"
            disabled={busy}
            className="mt-5 w-full h-11 rounded-md bg-indigo-600 text-white text-sm font-semibold hover:bg-indigo-700 disabled:opacity-60 disabled:cursor-not-allowed"
          >
            {busy ? 'Working...' : mode === 'login' ? 'Sign in' : 'Create account'}
          </button>
        </form>
      </div>
    </main>
  );
}

function UserBadge({ authUser, isDark, onLogout }: { authUser: AuthUser; isDark: boolean; onLogout: () => void }) {
  return (
    <div className={`rounded-md border p-2 ${isDark ? 'border-slate-800 bg-slate-950/60' : 'border-gray-200 bg-white/70'}`}>
      <div className={`truncate text-xs font-semibold ${isDark ? 'text-slate-200' : 'text-gray-900'}`}>
        {authUser.email}
      </div>
      <div className="mt-2 flex items-center gap-2">
        <span className={`rounded px-2 py-1 text-[0.7rem] uppercase ${isDark ? 'bg-slate-800 text-slate-300' : 'bg-gray-100 text-gray-600'}`}>
          {authUser.role}
        </span>
        <button
          type="button"
          onClick={onLogout}
          className={`ml-auto rounded px-2 py-1 text-xs font-medium ${isDark ? 'text-slate-300 hover:bg-slate-800' : 'text-gray-600 hover:bg-gray-100'}`}
        >
          Sign out
        </button>
      </div>
    </div>
  );
}

export default App;
