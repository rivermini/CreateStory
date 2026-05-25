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
      <svg className="w-2.5 h-2.5 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
      </svg>
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
            ? 'bg-slate-700/50 text-slate-400 border-slate-600/40'
            : 'bg-gray-100 text-gray-600 border-gray-300'
      }`}>
      {prefix}
    </span>
  );
}

function EmptyState({ message, icon, isDark }: { message: string; icon: React.ReactNode; isDark: boolean }) {
  return (
    <div className={`flex flex-col items-center justify-center py-16 px-4 rounded-2xl ${isDark ? 'bg-slate-900/40' : 'bg-gray-50'}`}>
      <div className={`w-16 h-16 rounded-2xl flex items-center justify-center mb-4 ${isDark ? 'bg-slate-800/60' : 'bg-white border border-gray-200'}`}>
        {icon}
      </div>
      <p className={`text-sm text-center max-w-xs ${isDark ? 'text-slate-500' : 'text-gray-500'}`}>{message}</p>
    </div>
  );
}

export { ValidationErrorBadge, StatusBadge, EmptyState };
