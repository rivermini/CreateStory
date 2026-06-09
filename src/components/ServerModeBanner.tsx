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
  const panelBorder = isDark ? 'rgba(255,255,255,0.08)' : 'rgba(55,53,47,0.12)';
  const pageText = isDark ? 'rgba(255,255,255,0.92)' : '#37352f';
  const secondaryText = isDark ? 'rgba(255,255,255,0.5)' : 'rgba(55,53,47,0.62)';
  const mutedSurface = isDark ? 'rgba(255,255,255,0.05)' : 'rgba(55,53,47,0.05)';

  return (
    <div
      className="rounded-xl border px-4 py-3"
      style={{
        background: mutedSurface,
        borderColor: isDark ? `${accent}22` : `${accent}16`,
      }}
    >
      <div className="flex items-start gap-3">
        <div
          className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-xl"
          style={{ background: isDark ? `${accent}15` : `${accent}12`, border: `1px solid ${isDark ? `${accent}28` : `${accent}22`}` }}
        >
          {variant === 'error' || variant === 'token_invalid' ? (
            <Icon icon={appIcons.statusWarning} className="h-4 w-4" style={{ color: accent }} />
          ) : variant === 'production' ? (
            <Icon icon={appIcons.shield} className="h-4 w-4" style={{ color: accent }} />
          ) : (
            <Icon icon={appIcons.info} className="h-4 w-4" style={{ color: accent }} />
          )}
        </div>

        <div className="min-w-0 flex-1">
          <p className="text-sm font-semibold" style={{ color: pageText }}>
            {variant === 'error' ? 'Drive Sync Not Configured'
              : variant === 'token_invalid' ? 'Bearer Token Invalid'
              : variant === 'production' ? 'Production Server'
              : 'Non-Production Server'}
          </p>
          <p className="mt-0.5 text-xs" style={{ color: secondaryText }}>
            {variant === 'error'
              ? 'Auto Audio requires Drive Sync configuration to be set up before use.'
              : variant === 'token_invalid'
              ? <>Connected to <span className="font-mono" style={{ fontSize: '0.65rem' }}>{serverUrl}</span> — The stored bearer token is invalid or expired (401).</>
              : <>Connected to <span className="font-mono" style={{ fontSize: '0.65rem' }}>{serverUrl}</span></>}
          </p>

          {variant === 'production' && (
            <p className="mt-1 text-xs" style={{ color: '#f59e0b' }}>
              <strong>Warning:</strong> Actions will affect real data. Please double-check before proceeding.
            </p>
          )}
          {variant === 'nonproduction' && (
            <p className="mt-1 text-xs" style={{ color: secondaryText }}>
              Feel free to test and experiment — changes here won't affect production data.
            </p>
          )}

          {(variant === 'error' || variant === 'token_invalid') && onConfigure && (
            <button
              onClick={onConfigure}
              className="mt-2 rounded-lg border px-4 py-1.5 text-xs font-medium transition-colors"
              style={{ background: mutedSurface, borderColor: panelBorder, color: secondaryText }}
            >
              {variant === 'error' ? 'Configure Drive Sync' : 'Update Bearer Token'}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
