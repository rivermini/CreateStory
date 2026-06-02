interface ServerModeBannerProps {
  serverUrl: string | null;
  isDark: boolean;
  isConfigLoading?: boolean;
  isConfigValid?: boolean;
  onConfigure?: () => void;
}

const PRODUCTION_URL = 'https://api-novel.santngo.com/';
const PRODUCTION_URL_V2 = 'https://api-novel.santngo.com';

type BannerVariant = 'error' | 'production' | 'nonproduction';

const VARIANT_ACCENT: Record<BannerVariant, string> = {
  error: '#ef4444',
  production: '#10b981',
  nonproduction: '#6366f1',
};

const VARIANT_LIGHT_BG: Record<BannerVariant, string> = {
  error: 'rgba(239,68,68,0.06)',
  production: 'rgba(16,185,129,0.06)',
  nonproduction: 'rgba(99,102,241,0.06)',
};

export function ServerModeBanner({ serverUrl, isDark, isConfigLoading, isConfigValid, onConfigure }: ServerModeBannerProps) {
  if (isConfigLoading) return null;

  let variant: BannerVariant;
  if (isConfigValid === false) {
    variant = 'error';
  } else if (!serverUrl) {
    return null;
  } else {
    const normalizedUrl = serverUrl.endsWith('/') ? serverUrl.slice(0, -1) : serverUrl;
    variant = (normalizedUrl === PRODUCTION_URL_V2 || normalizedUrl === PRODUCTION_URL) ? 'production' : 'nonproduction';
  }

  const accent = VARIANT_ACCENT[variant];
  const lightBg = VARIANT_LIGHT_BG[variant];

  const iconColor = accent;
  const textPrimary = isDark ? 'rgba(255,255,255,0.9)' : 'rgba(0,0,0,0.85)';
  const textSecondary = isDark ? 'rgba(255,255,255,0.5)' : 'rgba(0,0,0,0.5)';
  return (
    <div
      className="lg-glass px-4 py-3"
      style={{
        border: `1px solid ${accent}25`,
        background: isDark
          ? `linear-gradient(135deg, ${accent}12, ${accent}06)`
          : `linear-gradient(135deg, ${lightBg}, ${VARIANT_LIGHT_BG[variant]})`,
        boxShadow: `0 4px 20px ${accent}10, inset 0 1px 0 rgba(255,255,255,0.05)`,
      }}
    >
      <div className="flex items-start gap-3">
        {/* Icon */}
        <div
          className="flex-shrink-0 w-8 h-8 rounded-xl flex items-center justify-center mt-0.5"
          style={{ background: `${accent}15` }}
        >
          {variant === 'error' ? (
            <svg className="w-4 h-4" style={{ color: iconColor }} fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
            </svg>
          ) : variant === 'production' ? (
            <svg className="w-4 h-4" style={{ color: iconColor }} fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m5.618-4.016A11.955 11.955 0 0112 2.944a11.955 11.955 0 01-8.618 3.04A12.02 12.02 0 003 9c0 5.591 3.824 10.29 9 11.622 5.176-1.332 9-6.03 9-11.622 0-1.042-.133-2.052-.382-3.016z" />
            </svg>
          ) : (
            <svg className="w-4 h-4" style={{ color: iconColor }} fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
            </svg>
          )}
        </div>

        {/* Content */}
        <div className="flex-1 min-w-0">
          <p className="text-sm font-semibold" style={{ color: textPrimary }}>
            {variant === 'error' ? 'Drive Sync Not Configured' : variant === 'production' ? 'Production Server' : 'Non-Production Server'}
          </p>
          <p className="text-xs mt-0.5" style={{ color: textSecondary }}>
            {variant === 'error'
              ? 'Auto Audio requires Drive Sync configuration to be set up before use.'
              : variant === 'production'
              ? <>Connected to <span className="font-mono" style={{ fontSize: '0.65rem' }}>{serverUrl}</span></>
              : <>Connected to <span className="font-mono" style={{ fontSize: '0.65rem' }}>{serverUrl}</span></>
            }
          </p>

          {variant === 'production' && (
            <p className="text-xs mt-1" style={{ color: '#fbbf24' }}>
              <strong>Warning:</strong> Actions will affect real data. Please double-check before proceeding.
            </p>
          )}
          {variant === 'nonproduction' && (
            <p className="text-xs mt-1" style={{ color: textSecondary }}>
              Feel free to test and experiment — changes here won't affect production data.
            </p>
          )}

          {variant === 'error' && onConfigure && (
            <button
              onClick={onConfigure}
              className="lg-btn-ghost mt-2"
              style={{ padding: '6px 12px', fontSize: '0.75rem', borderRadius: 10 }}
            >
              Configure Drive Sync
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
