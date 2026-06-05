import { Icon, appIcons } from './Icon';

interface ServerModeBannerProps {
  serverUrl: string | null;
  isDark: boolean;
  isConfigLoading?: boolean;
  isConfigValid?: boolean;
  tokenInvalid?: boolean;
  onConfigure?: () => void;
}

const PRODUCTION_URL = 'https://api-novel.santngo.com/';
const PRODUCTION_URL_V2 = 'https://api-novel.santngo.com';

type BannerVariant = 'error' | 'production' | 'nonproduction' | 'token_invalid';

const VARIANT_ACCENT: Record<BannerVariant, string> = {
  error: '#ef4444',
  production: '#10b981',
  nonproduction: '#6366f1',
  token_invalid: '#f97316',
};

const VARIANT_LIGHT_BG: Record<BannerVariant, string> = {
  error: 'rgba(239,68,68,0.09)',
  production: 'rgba(16,185,129,0.09)',
  nonproduction: 'rgba(99,102,241,0.09)',
  token_invalid: 'rgba(249,115,22,0.09)',
};

const VARIANT_LIGHT_BORDER: Record<BannerVariant, string> = {
  error: 'rgba(239,68,68,0.2)',
  production: 'rgba(16,185,129,0.2)',
  nonproduction: 'rgba(99,102,241,0.2)',
  token_invalid: 'rgba(249,115,22,0.2)',
};

const VARIANT_LIGHT_SOFT: Record<BannerVariant, string> = {
  error: 'rgba(255,255,255,0.56)',
  production: 'rgba(240,253,250,0.6)',
  nonproduction: 'rgba(238,242,255,0.6)',
  token_invalid: 'rgba(255,247,237,0.62)',
};

export function ServerModeBanner({ serverUrl, isDark, isConfigLoading, isConfigValid, tokenInvalid, onConfigure }: ServerModeBannerProps) {
  if (isConfigLoading) return null;

  let variant: BannerVariant;
  if (tokenInvalid) {
    variant = 'token_invalid';
  } else if (isConfigValid === false) {
    variant = 'error';
  } else if (!serverUrl) {
    return null;
  } else {
    const normalizedUrl = serverUrl.endsWith('/') ? serverUrl.slice(0, -1) : serverUrl;
    variant = (normalizedUrl === PRODUCTION_URL_V2 || normalizedUrl === PRODUCTION_URL) ? 'production' : 'nonproduction';
  }

  const accent = VARIANT_ACCENT[variant];
  const lightBg = VARIANT_LIGHT_BG[variant];
  const lightBorder = VARIANT_LIGHT_BORDER[variant];
  const lightSoft = VARIANT_LIGHT_SOFT[variant];

  const iconColor = accent;
  const textPrimary = isDark ? 'rgba(255,255,255,0.9)' : 'rgba(15,23,42,0.92)';
  const textSecondary = isDark ? 'rgba(255,255,255,0.5)' : 'rgba(15,23,42,0.68)';
  return (
    <div
      className="lg-glass px-4 py-3"
      style={{
        border: isDark ? `1px solid ${accent}25` : `1px solid ${lightBorder}`,
        background: isDark
          ? `linear-gradient(135deg, ${accent}12, ${accent}06)`
          : `linear-gradient(135deg, ${lightSoft}, ${lightBg})`,
        boxShadow: isDark
          ? `0 4px 20px ${accent}10, inset 0 1px 0 rgba(255,255,255,0.05)`
          : `0 8px 24px rgba(15,23,42,0.05), inset 0 1px 0 rgba(255,255,255,0.55)`,
        backdropFilter: isDark ? undefined : 'blur(10px)',
      }}
    >
      <div className="flex items-start gap-3">
        {/* Icon */}
        <div
          className="flex-shrink-0 w-8 h-8 rounded-xl flex items-center justify-center mt-0.5"
          style={{ background: isDark ? `${accent}15` : `${accent}16`, boxShadow: isDark ? 'none' : `inset 0 0 0 1px ${lightBorder}` }}
        >
          {variant === 'error' || variant === 'token_invalid' ? (
            <Icon icon={appIcons.statusWarning} className="w-4 h-4" style={{ color: iconColor }} />
          ) : variant === 'production' ? (
            <Icon icon={appIcons.shield} className="w-4 h-4" style={{ color: iconColor }} />
          ) : (
            <Icon icon={appIcons.info} className="w-4 h-4" style={{ color: iconColor }} />
          )}
        </div>

        {/* Content */}
        <div className="flex-1 min-w-0">
          <p className="text-sm font-semibold" style={{ color: textPrimary }}>
            {variant === 'error' ? 'Drive Sync Not Configured' : variant === 'token_invalid' ? 'Bearer Token Invalid' : variant === 'production' ? 'Production Server' : 'Non-Production Server'}
          </p>
          <p className="text-xs mt-0.5" style={{ color: textSecondary }}>
            {variant === 'error'
              ? 'Auto Audio requires Drive Sync configuration to be set up before use.'
              : variant === 'token_invalid'
              ? <>Connected to <span className="font-mono" style={{ fontSize: '0.65rem' }}>{serverUrl}</span> — The stored bearer token is invalid or expired (401).</>
              : <>Connected to <span className="font-mono" style={{ fontSize: '0.65rem' }}>{serverUrl}</span></>
            }
          </p>

          {variant === 'production' && (
            <p className="text-xs mt-1" style={{ color: isDark ? '#fbbf24' : '#b45309' }}>
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
          {variant === 'token_invalid' && onConfigure && (
            <button
              onClick={onConfigure}
              className="lg-btn-ghost mt-2"
              style={{ padding: '6px 12px', fontSize: '0.75rem', borderRadius: 10 }}
            >
              Update Bearer Token
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
