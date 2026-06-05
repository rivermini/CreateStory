import { Icon, appIcons } from './Icon';

function ValidationErrorBadge({ error, isDark }: { error: string; isDark: boolean }) {
  const isFormat = error.startsWith("WRONG FORMAT");
  return (
    <span className={`inline-flex items-center gap-1 px-2 py-0.5 text-[10px] font-semibold rounded-lg border ${isFormat
        ? isDark
          ? 'bg-red-900/30 text-red-400 border-red-800/40'
          : 'bg-red-100 text-red-700 border-red-200'
        : isDark
          ? 'bg-amber-900/30 text-amber-400 border-amber-800/40'
          : 'bg-amber-100 text-amber-700 border-amber-200'
      }`}>
      <Icon icon={appIcons.statusWarning} className="w-2.5 h-2.5 shrink-0" />
      {error}
    </span>
  );
}

function StatusBadge({ prefix, isDark }: { prefix: string; isDark: boolean }) {
  const isDone = prefix === 'DONE' || prefix === 'EXTENDED';
  const isIng = prefix === 'ING';

  return (
    <span className={`inline-flex items-center px-2 py-0.5 text-[10px] font-semibold rounded-md border ${isDone
        ? isDark
          ? 'bg-emerald-900/40 text-emerald-400 border-emerald-800/40'
          : 'bg-emerald-50 text-emerald-700 border-emerald-200'
        : isIng
          ? isDark
            ? 'bg-amber-900/40 text-amber-400 border-amber-800/40'
            : 'bg-amber-50 text-amber-700 border-amber-200'
          : isDark
            ? 'bg-white/6 text-white/70 border-white/8'
            : 'bg-black/5 text-black/45 border-black/8'
      }`}>
      {prefix}
    </span>
  );
}

function EmptyState({ message, icon, isDark }: { message: string; icon: React.ReactNode; isDark: boolean }) {
  return (
    <div className={`flex flex-col w-full h-full items-center justify-center py-16 px-4 lg-glass-card`}>
      <div className="lg-glass w-16 h-16 rounded-2xl flex items-center justify-center mb-4">
        {icon}
      </div>
      <p className={`text-sm text-center max-w-xs ${isDark ? 'text-white/75' : 'text-black/35'}`}>{message}</p>
    </div>
  );
}

export { ValidationErrorBadge, StatusBadge, EmptyState };
