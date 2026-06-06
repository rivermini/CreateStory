import { useEffect, useRef } from 'react';
import { Link } from 'react-router-dom';
import { Icon, appIcons } from './Icon';
import type { AuthUser } from '../api/client';

interface AccountMenuProps {
  authUser: AuthUser;
  isDark: boolean;
  isOpen: boolean;
  onToggle: () => void;
  onClose: () => void;
  onLogout: () => void;
}

export function AccountMenu({ authUser, isDark, isOpen, onToggle, onClose, onLogout }: AccountMenuProps) {
  const isAdmin = authUser.role === 'admin';
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!isOpen) return;

    const handleClickOutside = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        onClose();
      }
    };

    const handleEscape = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };

    document.addEventListener('mousedown', handleClickOutside);
    document.addEventListener('keydown', handleEscape);
    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
      document.removeEventListener('keydown', handleEscape);
    };
  }, [isOpen, onClose]);

  return (
    <div className="fixed right-4 top-3 z-[70]" ref={menuRef}>
      <button
        type="button"
        onClick={onToggle}
        className={`group relative inline-flex h-10 items-center gap-2 rounded-xl border px-2.5 transition-all ${
          isDark
            ? 'border-white/[0.08] bg-slate-950/80 text-slate-200 hover:bg-slate-900'
            : 'border-black/10 bg-white/90 text-slate-700 hover:bg-slate-50 shadow-sm'
        }`}
        title="Account"
        aria-label="Account menu"
        aria-expanded={isOpen}
      >
        <span
          className={`inline-flex h-7.5 w-7.5 items-center justify-center rounded-lg border ${
            isDark
              ? 'border-white/[0.08] bg-white/[0.04] text-slate-200'
              : 'border-black/5 bg-slate-100 text-slate-700'
          }`}
        >
          <svg className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2" />
            <circle cx="12" cy="7" r="4" />
          </svg>
        </span>

        <span
          className={`hidden sm:inline-flex items-center rounded-full px-2 py-0.5 text-[0.62rem] font-semibold uppercase tracking-[0.18em] ${
            isAdmin
              ? isDark
                ? 'bg-indigo-500/18 text-indigo-200 ring-1 ring-inset ring-indigo-400/30'
                : 'bg-indigo-50 text-indigo-700 ring-1 ring-inset ring-indigo-200'
              : isDark
                ? 'bg-slate-800 text-slate-300 ring-1 ring-inset ring-white/10'
                : 'bg-slate-100 text-slate-600 ring-1 ring-inset ring-slate-200'
          }`}
        >
          {authUser.role}
        </span>
      </button>

      {isOpen && (
        <div className={`absolute right-0 mt-2 w-72 rounded-xl border p-3 shadow-2xl ${
          isDark
            ? 'border-white/[0.08] bg-slate-950/95 text-slate-200'
            : 'border-black/10 bg-white/95 text-slate-800'
        }`}>
          <div className={`px-3 py-3 rounded-xl ${isDark ? 'bg-white/[0.04]' : 'bg-black/[0.03]'}`}>
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <div className="truncate text-sm font-semibold">{authUser.email}</div>
              </div>
              <span
                className={`inline-flex shrink-0 items-center rounded-full px-2.5 py-1 text-[0.62rem] font-semibold uppercase tracking-[0.18em] ${
                  isAdmin
                    ? isDark
                      ? 'bg-indigo-500/18 text-indigo-200 ring-1 ring-inset ring-indigo-400/30'
                      : 'bg-indigo-50 text-indigo-700 ring-1 ring-inset ring-indigo-200'
                    : isDark
                      ? 'bg-slate-800 text-slate-300 ring-1 ring-inset ring-white/10'
                      : 'bg-slate-100 text-slate-600 ring-1 ring-inset ring-slate-200'
                }`}
              >
                {authUser.role}
              </span>
            </div>
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
                <Icon icon={appIcons.dashboardUsers} className="w-4 h-4" />
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
              <Icon icon={appIcons.logout} className="w-4 h-4" />
              Sign out
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
