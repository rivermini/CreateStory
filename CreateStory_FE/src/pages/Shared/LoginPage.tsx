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
      className="min-h-screen px-4 py-6 sm:px-6"
      style={{ background: 'var(--cs-page)', color: 'var(--cs-text)' }}
    >
      <div className="mx-auto flex min-h-[calc(100vh-3rem)] max-w-md items-center justify-center">
        <section className="w-full rounded-[24px] border px-5 py-6 shadow-xl sm:px-6 sm:py-7 cs-surface">
          <div className="mb-6 flex flex-col items-center gap-2 text-center">
            <h1 className="text-2xl font-bold tracking-tight" style={{ color: 'var(--cs-text)' }}>CreateStory</h1>
            <p className="text-sm" style={{ color: 'var(--cs-text-soft)' }}>Sign in to your account</p>
          </div>

          <form onSubmit={submit} className="space-y-4">
            <div>
              <label className="mb-2 block text-xs font-semibold uppercase tracking-[0.08em]" htmlFor="auth-email" style={{ color: 'var(--cs-text-soft)' }}>
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
                className="h-11 w-full rounded-xl border px-3 text-sm outline-none transition"
                style={{
                  background: 'var(--cs-surface-muted)',
                  borderColor: 'var(--cs-border)',
                  color: 'var(--cs-text)',
                }}
              />
            </div>

            <div>
              <label className="mb-2 block text-xs font-semibold uppercase tracking-[0.08em]" htmlFor="auth-password" style={{ color: 'var(--cs-text-soft)' }}>
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
                className="h-11 w-full rounded-xl border px-3 text-sm outline-none transition"
                style={{
                  background: 'var(--cs-surface-muted)',
                  borderColor: 'var(--cs-border)',
                  color: 'var(--cs-text)',
                }}
              />
            </div>

            {error && (
              <div className="rounded-xl border px-4 py-3 text-sm" style={{ borderColor: 'var(--cs-border)', background: 'var(--cs-primary-soft)', color: 'var(--cs-primary)' }}>
                {error}
              </div>
            )}

            <button
              type="submit"
              disabled={busy}
              className="mt-6 h-11 w-full rounded-full text-sm font-semibold transition-all disabled:cursor-not-allowed disabled:opacity-60 cs-button cs-button--primary"
            >
              {busy ? 'Signing in...' : 'Sign in'}
            </button>
          </form>
        </section>
      </div>
    </main>
  );
}
