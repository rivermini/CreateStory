import { Icon, appIcons } from '../../Shared/Icon';

function ValidationErrorBadge({ error, isDark }: { readonly error: string; readonly isDark: boolean }) {
  const isFormat = error.startsWith("WRONG FORMAT");
  return (
    <span
      className="inline-flex items-center gap-1 rounded-md border px-2 py-0.5 text-[10px] font-semibold"
      style={
        isFormat
          ? isDark
            ? { background: 'rgba(239,68,68,0.14)', borderColor: 'rgba(239,68,68,0.24)', color: '#f87171' }
            : { background: 'rgba(239,68,68,0.08)', borderColor: 'rgba(239,68,68,0.16)', color: '#dc2626' }
          : isDark
            ? { background: 'rgba(245,158,11,0.14)', borderColor: 'rgba(245,158,11,0.24)', color: '#fcd34d' }
            : { background: 'rgba(245,158,11,0.08)', borderColor: 'rgba(245,158,11,0.16)', color: '#b45309' }
      }
    >
      <Icon icon={appIcons.statusWarning} className="h-2.5 w-2.5 shrink-0" />
      {error}
    </span>
  );
}

function StatusBadge({ prefix, isDark }: { readonly prefix: string; readonly isDark: boolean }) {
  const isDone = prefix === 'DONE' || prefix === 'EXTENDED';
  const isIng = prefix === 'ING';
  const isError = prefix === 'ERROR';

  return (
    <span
      className="inline-flex items-center rounded-md border px-2 py-0.5 text-[10px] font-semibold"
      style={
        isDone
          ? isDark
            ? { background: 'rgba(16,185,129,0.14)', borderColor: 'rgba(16,185,129,0.24)', color: '#34d399' }
            : { background: 'rgba(5,150,105,0.08)', borderColor: 'rgba(5,150,105,0.16)', color: '#059669' }
          : isIng
            ? { background: 'rgba(245,158,11,0.14)', borderColor: 'rgba(245,158,11,0.24)', color: '#fcd34d' }
            : isError
              ? { background: 'rgba(239,68,68,0.14)', borderColor: 'rgba(239,68,68,0.24)', color: '#f87171' }
              : isDark
                ? { background: 'rgba(255,255,255,0.05)', borderColor: 'rgba(255,255,255,0.08)', color: 'rgba(255,255,255,0.5)' }
                : { background: 'rgba(55,53,47,0.05)', borderColor: 'rgba(55,53,47,0.08)', color: 'rgba(55,53,47,0.62)' }
      }
    >
      {prefix}
    </span>
  );
}

function EmptyState({ message, icon, isDark }: { readonly message: string; readonly icon: React.ReactNode; readonly isDark: boolean }) {
  const panelBorder = isDark ? 'rgba(255,255,255,0.08)' : 'rgba(55,53,47,0.12)';
  const secondaryText = isDark ? 'rgba(255,255,255,0.5)' : 'rgba(55,53,47,0.62)';

  return (
    <div
      className="flex h-full w-full flex-col items-center justify-center rounded-xl border px-4 py-16"
      style={{ background: isDark ? 'rgba(255,255,255,0.03)' : 'rgba(55,53,47,0.02)', borderColor: panelBorder }}
    >
      <div
        className="mb-4 flex h-16 w-16 items-center justify-center rounded-2xl"
        style={{ background: isDark ? 'rgba(255,255,255,0.05)' : 'rgba(55,53,47,0.05)', border: `1px solid ${panelBorder}` }}
      >
        {icon}
      </div>
      <p className="max-w-xs text-center text-sm" style={{ color: secondaryText }}>{message}</p>
    </div>
  );
}

export { ValidationErrorBadge, StatusBadge, EmptyState };
