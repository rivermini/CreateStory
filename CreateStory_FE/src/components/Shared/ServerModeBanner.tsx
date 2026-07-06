import { useState } from 'react';
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
  error: 'var(--cs-danger)',
  production: 'var(--cs-success)',
  nonproduction: 'var(--cs-primary)',
  token_invalid: 'var(--cs-warning)',
};

export function ServerModeBanner({
  serverUrl,
  isDark: _isDark,
  isConfigLoading,
  isConfigValid,
  tokenInvalid,
  onConfigure,
}: Readonly<ServerModeBannerProps>) {
  const [isHovered, setIsHovered] = useState(false);

  if (isConfigLoading) return null;

  let variant: BannerVariant;
  if (tokenInvalid) {
    variant = 'token_invalid';
  } else if (isConfigValid === false) {
    variant = 'error';
  } else if (serverUrl) {
    const normalizedUrl = serverUrl.endsWith('/') ? serverUrl.slice(0, -1) : serverUrl;
    variant = (normalizedUrl === PRODUCTION_URL_V2 || normalizedUrl === PRODUCTION_URL) ? 'production' : 'nonproduction';
  } else {
    return null;
  }

  const accent = VARIANT_ACCENT[variant];

  return (
    <div
      className="relative z-50 inline-block"
      onMouseEnter={() => setIsHovered(true)}
      onMouseLeave={() => setIsHovered(false)}
    >
      {/* Small floating status pill */}
      <div
        className="flex items-center gap-1.5 rounded-full border px-3 py-1 text-xs font-bold shadow-sm cursor-help transition-all duration-200"
        style={{
          borderColor: accent,
          background: `${accent}12`,
          color: accent,
        }}
      >
        <span className="h-2 w-2 rounded-full animate-pulse" style={{ background: accent }} />
        {variant === 'error' ? (
          <span>Not Configured</span>
        ) : variant === 'token_invalid' ? (
          <span>Token Invalid</span>
        ) : variant === 'production' ? (
          <span>Production Server</span>
        ) : (
          <span>Local Server</span>
        )}
      </div>

      {/* Hover Information Popover */}
      {isHovered && (
        <div
          className="absolute right-0 top-full mt-2 w-72 rounded-xl border p-4 shadow-xl text-left bg-[var(--cs-surface-elevated)] border-[var(--cs-border)] z-50 backdrop-blur-md"
        >
          <div className="flex items-start gap-2.5">
            <div className="mt-0.5">
              {variant === 'error' || variant === 'token_invalid' ? (
                <Icon icon={appIcons.statusWarning} className="h-4 w-4" style={{ color: accent }} />
              ) : variant === 'production' ? (
                <Icon icon={appIcons.shield} className="h-4 w-4" style={{ color: accent }} />
              ) : (
                <Icon icon={appIcons.info} className="h-4 w-4" style={{ color: accent }} />
              )}
            </div>
            <div className="min-w-0 flex-1">
              <p className="text-xs font-bold text-[var(--cs-text)]">
                {variant === 'error' ? 'Drive Sync Not Configured'
                  : variant === 'token_invalid' ? 'Bearer Token Invalid'
                  : variant === 'production' ? 'Production Server'
                  : 'Non-Production Server'}
              </p>
              <p className="mt-1 text-[11px] text-[var(--cs-text-soft)] font-mono leading-relaxed break-all">
                {variant === 'error'
                  ? 'Auto Audio requires Drive Sync configuration.'
                  : variant === 'token_invalid'
                  ? `Connected: ${serverUrl} (Token expired 401)`
                  : `Connected: ${serverUrl}`}
              </p>

              {variant === 'production' && (
                <p className="mt-2 text-[10px] font-medium text-[var(--cs-warning)] leading-relaxed border-t border-[var(--cs-border)] pt-1.5">
                  Warning: Actions affect real production data.
                </p>
              )}
              {variant === 'nonproduction' && (
                <p className="mt-2 text-[10px] text-[var(--cs-text-muted)] border-t border-[var(--cs-border)] pt-1.5">
                  Test mode — safe to experiment.
                </p>
              )}

              {(variant === 'error' || variant === 'token_invalid') && onConfigure && (
                <button
                  onClick={onConfigure}
                  className="mt-3 w-full rounded bg-[var(--cs-primary)] py-1 text-[10px] font-bold text-[var(--cs-active-text)] hover:opacity-90 transition-opacity"
                >
                  {variant === 'error' ? 'Configure Sync' : 'Update Token'}
                </button>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
