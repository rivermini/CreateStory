import { useState } from 'react';
import { login, type AuthUser } from '../../api';

interface LoginPageProps {
  themeMode: 'light' | 'dark';
  onThemeChange: (mode: 'light' | 'dark') => void;
  onAuthenticated: (user: AuthUser) => void;
}

export function LoginPage({ onAuthenticated }: Readonly<LoginPageProps>) {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit: NonNullable<React.ComponentProps<'form'>['onSubmit']> = (event) => {
    event.preventDefault();
    void (async () => {
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
    })();
  };

  return (
    <main
      className="min-h-screen bg-[#050505] px-4 py-6 text-white sm:px-6"
      style={{ colorScheme: 'dark' }}
    >
      <div className="mx-auto flex min-h-[calc(100vh-3rem)] max-w-md items-center justify-center">
        <section className="w-full rounded-3xl border border-white/10 bg-[#111111] px-5 py-6 shadow-[0_24px_80px_rgba(0,0,0,0.45)] sm:px-6 sm:py-7">
          <div className="mb-2 flex flex-col items-center gap-2 text-center">
            <h1 className="mt-2 text-xl text-white">CreateStory</h1>
            <p className="font-semibold tracking-tight text-white/55">Sign in</p>
          </div>

          <form onSubmit={submit} className="space-y-4">
            <div>
              <label className="mb-2 block text-sm text-white/65" htmlFor="auth-email">
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
                className="h-11 w-full rounded-xl border border-white/10 bg-black/40 px-3 text-sm text-white outline-none transition placeholder:text-white/28 focus:border-white/30 focus:ring-2 focus:ring-white/10"
              />
            </div>

            <div>
              <label className="mb-2 block text-sm text-white/65" htmlFor="auth-password">
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
                className="h-11 w-full rounded-xl border border-white/10 bg-black/40 px-3 text-sm text-white outline-none transition placeholder:text-white/28 focus:border-white/30 focus:ring-2 focus:ring-white/10"
              />
            </div>

            {error && (
              <div className="rounded-xl border border-white/12 bg-white/5 px-4 py-3 text-sm text-white/70">
                {error}
              </div>
            )}

            <button
              type="submit"
              disabled={busy}
              className="mt-4 h-11 w-full rounded-xl bg-[#FFFFFF] text-sm font-medium text-black transition hover:bg-white/92 disabled:cursor-not-allowed disabled:opacity-60"
            >
              {busy ? 'Signing in...' : 'Sign in'}
            </button>
          </form>
        </section>
      </div>
    </main>
  );
}
