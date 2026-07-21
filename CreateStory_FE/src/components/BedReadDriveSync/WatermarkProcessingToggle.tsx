interface WatermarkProcessingToggleProps {
  readonly enabled: boolean;
  readonly onChange: (enabled: boolean) => void;
  readonly disabled?: boolean;
}

export function WatermarkProcessingToggle({
  enabled,
  onChange,
  disabled = false,
}: WatermarkProcessingToggleProps) {
  return (
    <div className="ml-auto flex min-w-[260px] items-center justify-between gap-4 rounded-xl border px-3 py-2" style={{ borderColor: 'var(--cs-border)', background: 'var(--cs-surface-muted)' }}>
      <div className="min-w-0">
        <div className="text-sm font-semibold" style={{ color: 'var(--cs-text)' }}>
          Remove watermark
        </div>
        <div className="text-xs" style={{ color: 'var(--cs-text-faint)' }}>
          {enabled ? 'Detect and clean before upload' : 'Upload the original Drive image'}
        </div>
      </div>
      <button
        type="button"
        role="switch"
        aria-checked={enabled}
        aria-label="Remove watermark before upload"
        disabled={disabled}
        onClick={() => onChange(!enabled)}
        className="relative h-7 w-12 shrink-0 rounded-full transition-colors disabled:cursor-not-allowed disabled:opacity-50"
        style={{ background: enabled ? '#ff5a0a' : 'var(--cs-border-strong)' }}
      >
        <span
          className="absolute top-1 h-5 w-5 rounded-full bg-white shadow-sm transition-transform"
          style={{ left: 4, transform: enabled ? 'translateX(20px)' : 'translateX(0)' }}
        />
      </button>
    </div>
  );
}
