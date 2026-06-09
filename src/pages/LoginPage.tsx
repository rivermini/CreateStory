import { useState, type FormEvent } from 'react';
import { login, type AuthUser } from '../api/client';
import { AppIcon } from '../components/AppIcon';

interface LoginPageProps {
  themeMode: 'light' | 'dark';
  onThemeChange: (mode: 'light' | 'dark') => void;
  onAuthenticated: (user: AuthUser) => void;
}

export function LoginPage({ themeMode, onThemeChange, onAuthenticated }: LoginPageProps) {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const isDark = themeMode === 'dark';

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const tokens = await login(email, password);
      onAuthenticated(tokens.user);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Authentication failed.');
    } finally {
      setBusy(false);
    }
  };

  const pageBackground = isDark
    ? 'linear-gradient(180deg, #191919 0%, #171717 100%)'
    : 'linear-gradient(180deg, #fbfbfa 0%, #f7f6f3 100%)';
  const panelBackground = isDark ? '#202020' : '#ffffff';
  const panelBorder = isDark ? 'rgba(255,255,255,0.08)' : 'rgba(55,53,47,0.12)';
  const pageText = isDark ? 'rgba(255,255,255,0.92)' : '#37352f';
  const secondaryText = isDark ? 'rgba(255,255,255,0.5)' : 'rgba(55,53,47,0.62)';
  const tertiaryText = isDark ? 'rgba(255,255,255,0.34)' : 'rgba(55,53,47,0.42)';
  const mutedSurface = isDark ? 'rgba(255,255,255,0.05)' : 'rgba(55,53,47,0.05)';
  const inputBackground = isDark ? 'rgba(255,255,255,0.05)' : '#ffffff';
  const inputBorder = isDark ? 'rgba(255,255,255,0.08)' : 'rgba(55,53,47,0.16)';
  const themeLabel = isDark ? 'Dark' : 'Light';

  return (
    <main
      className={`${isDark ? 'dark' : 'light'} min-h-screen px-4 py-8 sm:px-6 lg:px-8`}
      style={{ background: pageBackground, colorScheme: isDark ? 'dark' : 'light' }}
    >
      <div className="mx-auto flex min-h-[calc(100vh-4rem)] w-full max-w-5xl items-center justify-center">
        <div className="grid w-full gap-6 lg:grid-cols-[minmax(0,1.05fr)_420px] lg:items-center">
          <section className="hidden lg:block">
            <div className="max-w-xl space-y-5">
              <div className="text-xs font-medium uppercase tracking-[0.18em]" style={{ color: tertiaryText }}>
                CreateStory
              </div>
              <h1 className="text-4xl font-semibold tracking-tight" style={{ color: pageText }}>
                Sign in to continue your crawling workflow.
              </h1>
              <p className="text-base leading-7" style={{ color: secondaryText }}>
                Access crawl sessions, output files, admin tools, and the updated workspace from a single account.
              </p>
              <div className="grid gap-3 sm:grid-cols-2">
                <FeatureCard
                  title="Unified sessions"
                  description="Jump between crawl results, histories, and dashboard tools without leaving the app."
                  isDark={isDark}
                />
                <FeatureCard
                  title="Cleaner workflow"
                  description="The interface now uses a flatter document-style system across search, admin, and result screens."
                  isDark={isDark}
                />
              </div>
            </div>
          </section>

          <section
            className="w-full rounded-2xl border px-5 py-6 sm:px-6 sm:py-7"
            style={{ background: panelBackground, borderColor: panelBorder }}
          >
            <div className="mb-6 flex items-start justify-between gap-4">
              <div className="flex items-center gap-3">
                <AppIcon size="xl" className="shrink-0" />
                <div>
                  <h2 className="text-xl font-semibold tracking-tight" style={{ color: pageText }}>
                    Welcome back
                  </h2>
                  <p className="mt-1 text-sm" style={{ color: secondaryText }}>
                    Sign in to continue
                  </p>
                </div>
              </div>

              <button
                type="button"
                onClick={() => onThemeChange(isDark ? 'light' : 'dark')}
                className="rounded-md border px-3 py-2 text-sm transition-colors"
                style={{ borderColor: panelBorder, background: mutedSurface, color: secondaryText }}
              >
                {themeLabel}
              </button>
            </div>

            <form onSubmit={submit} className="space-y-5">
              <div>
                <label className="mb-2 block text-sm" style={{ color: secondaryText }} htmlFor="auth-email">
                  Email
                </label>
                <input
                  id="auth-email"
                  type="email"
                  value={email}
                  onChange={(event) => setEmail(event.target.value)}
                  autoComplete="email"
                  required
                  placeholder="you@example.com"
                  className="h-11 w-full rounded-md border px-3 text-sm outline-none transition focus:border-indigo-500 focus:ring-2 focus:ring-indigo-500"
                  style={{
                    background: inputBackground,
                    borderColor: inputBorder,
                    color: pageText,
                  }}
                />
              </div>

              <div>
                <label className="mb-2 block text-sm" style={{ color: secondaryText }} htmlFor="auth-password">
                  Password
                </label>
                <input
                  id="auth-password"
                  type="password"
                  value={password}
                  onChange={(event) => setPassword(event.target.value)}
                  autoComplete="current-password"
                  required
                  placeholder="Enter your password"
                  className="h-11 w-full rounded-md border px-3 text-sm outline-none transition focus:border-indigo-500 focus:ring-2 focus:ring-indigo-500"
                  style={{
                    background: inputBackground,
                    borderColor: inputBorder,
                    color: pageText,
                  }}
                />
              </div>

              {error && (
                <div
                  className="rounded-xl border px-4 py-3 text-sm"
                  style={{
                    background: isDark ? 'rgba(239,68,68,0.08)' : 'rgba(239,68,68,0.06)',
                    borderColor: isDark ? 'rgba(239,68,68,0.2)' : 'rgba(239,68,68,0.15)',
                    color: isDark ? '#f87171' : '#dc2626',
                  }}
                >
                  {error}
                </div>
              )}

              <button
                type="submit"
                disabled={busy}
                className="h-11 w-full rounded-md text-sm font-medium text-white transition-opacity disabled:cursor-not-allowed"
                style={{ background: '#4f46e5', opacity: busy ? 0.6 : 1 }}
              >
                {busy ? 'Signing in...' : 'Sign in'}
              </button>
            </form>
          </section>
        </div>
      </div>
    </main>
  );
}

function FeatureCard({
  title,
  description,
  isDark,
}: {
  title: string;
  description: string;
  isDark: boolean;
}) {
  return (
    <div
      className="rounded-2xl border px-4 py-4"
      style={{
        background: isDark ? '#202020' : '#ffffff',
        borderColor: isDark ? 'rgba(255,255,255,0.08)' : 'rgba(55,53,47,0.12)',
      }}
    >
      <h3 className="text-sm font-semibold" style={{ color: isDark ? 'rgba(255,255,255,0.9)' : '#37352f' }}>
        {title}
      </h3>
      <p className="mt-2 text-sm leading-6" style={{ color: isDark ? 'rgba(255,255,255,0.5)' : 'rgba(55,53,47,0.62)' }}>
        {description}
      </p>
    </div>
  );
}
