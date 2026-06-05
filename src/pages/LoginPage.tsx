import { useState, type FormEvent } from 'react';
import { login, type AuthUser } from '../api/client';

interface LoginPageProps {
  themeMode: 'light' | 'dark';
  onThemeChange: (mode: 'light' | 'dark') => void;
  onAuthenticated: (user: AuthUser) => void;
}

export function LoginPage({ onAuthenticated }: LoginPageProps) {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

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

  return (
    <main
      className="relative min-h-screen overflow-hidden bg-[linear-gradient(180deg,#f8fbff_0%,#eef6ff_50%,#f8fafc_100%)] px-4 py-8 text-slate-900 sm:px-6 lg:px-8"
      style={{ colorScheme: 'light' }}
    >
      <div className="pointer-events-none absolute inset-0">
        <div className="absolute left-1/2 top-20 h-56 w-56 -translate-x-1/2 rounded-full bg-sky-200/40 blur-3xl" />
        <div className="absolute bottom-16 right-10 h-44 w-44 rounded-full bg-cyan-100/60 blur-3xl" />
      </div>

      <div className="relative mx-auto flex min-h-[calc(100vh-4rem)] w-full max-w-md items-center">
        <section className="w-full rounded-[2rem] border border-white/70 bg-white/55 p-6 shadow-[0_24px_60px_rgba(15,23,42,0.10)] backdrop-blur-2xl sm:p-8">
          <div className="mb-8 text-center">
            <h1 className="bg-[linear-gradient(135deg,#0f172a,#334155)] bg-clip-text text-3xl font-semibold tracking-tight text-transparent">
              CreateStory
            </h1>
            <p className="mt-2 text-sm text-slate-600">Sign in to continue</p>
          </div>

          <form onSubmit={submit} className="space-y-5">
            <div>
              <label className="mb-2 block text-sm font-medium text-slate-700" htmlFor="auth-email">
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
                className="h-12 w-full rounded-2xl border border-white/80 bg-white/65 px-4 text-sm text-slate-900 shadow-[inset_0_1px_0_rgba(255,255,255,0.7)] outline-none backdrop-blur-md transition focus:border-sky-300 focus:bg-white/75 focus:ring-4 focus:ring-sky-100"
              />
            </div>

            <div>
              <label className="mb-2 block text-sm font-medium text-slate-700" htmlFor="auth-password">
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
                className="h-12 w-full rounded-2xl border border-white/80 bg-white/65 px-4 text-sm text-slate-900 shadow-[inset_0_1px_0_rgba(255,255,255,0.7)] outline-none backdrop-blur-md transition focus:border-sky-300 focus:bg-white/75 focus:ring-4 focus:ring-sky-100"
              />
            </div>

            {error && (
              <div className="rounded-2xl border border-rose-200/80 bg-rose-50/85 px-4 py-3 text-sm text-rose-700 backdrop-blur-md">
                {error}
              </div>
            )}

            <button
              type="submit"
              disabled={busy}
              className="h-12 w-full rounded-2xl border border-white/60 bg-[linear-gradient(135deg,rgba(14,165,233,0.92),rgba(59,130,246,0.88))] text-sm font-semibold text-white shadow-[0_16px_30px_rgba(14,165,233,0.24),inset_0_1px_0_rgba(255,255,255,0.35)] backdrop-blur-md transition hover:brightness-105 disabled:cursor-not-allowed disabled:opacity-60"
            >
              {busy ? 'Signing in...' : 'Sign in'}
            </button>
          </form>
        </section>
      </div>
    </main>
  );
}
