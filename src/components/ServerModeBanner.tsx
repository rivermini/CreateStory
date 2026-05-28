interface ServerModeBannerProps {
  serverUrl: string | null;
  isDark: boolean;
  isConfigLoading?: boolean;
  isConfigValid?: boolean;
  onConfigure?: () => void;
}

const PRODUCTION_URL = 'https://api-novel.santngo.com/';
const PRODUCTION_URL_V2 = 'https://api-novel.santngo.com';

export function ServerModeBanner({ serverUrl, isDark, isConfigLoading, isConfigValid, onConfigure }: ServerModeBannerProps) {
  if (isConfigLoading) return null;

  if (isConfigValid === false) {
    return (
      <div className={`mb-4 px-4 py-3 rounded-xl border flex items-start gap-3 ${isDark
          ? 'bg-red-900/20 border-red-800/40'
          : 'bg-red-50 border-red-200'
        }`}>
        <div className="flex-shrink-0 mt-0.5">
          <svg className={`w-5 h-5 ${isDark ? 'text-red-400' : 'text-red-600'}`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
          </svg>
        </div>
        <div className="flex-1 min-w-0">
          <p className={`text-sm font-semibold ${isDark ? 'text-red-400' : 'text-red-700'}`}>
            Drive Sync Not Configured
          </p>
          <p className={`text-xs mt-0.5 ${isDark ? 'text-red-400/70' : 'text-red-600'}`}>
            Auto Audio requires Drive Sync configuration to be set up before use.
          </p>
          {onConfigure && (
            <button
              onClick={onConfigure}
              className={`mt-2 px-3 py-1.5 text-xs font-medium rounded-lg transition-colors ${
                isDark
                  ? 'bg-red-800/60 hover:bg-red-700/60 text-red-200'
                  : 'bg-red-100 hover:bg-red-200 text-red-700'
              }`}
            >
              Configure Drive Sync
            </button>
          )}
        </div>
      </div>
    );
  }

  if (!serverUrl) return null;

  const normalizedUrl = serverUrl.endsWith('/') ? serverUrl.slice(0, -1) : serverUrl;
  const isProduction = normalizedUrl === PRODUCTION_URL_V2 || normalizedUrl === PRODUCTION_URL;

  if (isProduction) {
    return (
      <div className={`mb-4 px-4 py-3 rounded-xl border flex items-start gap-3 ${isDark
          ? 'bg-emerald-900/20 border-emerald-800/40'
          : 'bg-emerald-50 border-emerald-200'
        }`}>
        <div className="flex-shrink-0 mt-0.5">
          <svg className={`w-5 h-5 ${isDark ? 'text-emerald-400' : 'text-emerald-600'}`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m5.618-4.016A11.955 11.955 0 0112 2.944a11.955 11.955 0 01-8.618 3.04A12.02 12.02 0 003 9c0 5.591 3.824 10.29 9 11.622 5.176-1.332 9-6.03 9-11.622 0-1.042-.133-2.052-.382-3.016z" />
          </svg>
        </div>
        <div className="flex-1 min-w-0">
          <p className={`text-sm font-semibold ${isDark ? 'text-emerald-400' : 'text-emerald-700'}`}>
            Production Server
          </p>
          <p className={`text-xs mt-0.5 ${isDark ? 'text-emerald-400/70' : 'text-emerald-600'}`}>
            You are connected to <span className="font-mono">{serverUrl}</span>
          </p>
          <p className={`text-xs mt-1 ${isDark ? 'text-amber-400' : 'text-amber-700'}`}>
            <strong>Warning:</strong> Actions will affect real data. Please double-check before proceeding.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className={`mb-4 px-4 py-3 rounded-xl border flex items-start gap-3 ${isDark
        ? 'bg-blue-900/20 border-blue-800/40'
        : 'bg-blue-50 border-blue-200'
      }`}>
      <div className="flex-shrink-0 mt-0.5">
        <svg className={`w-5 h-5 ${isDark ? 'text-blue-400' : 'text-blue-600'}`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
        </svg>
      </div>
      <div className="flex-1 min-w-0">
        <p className={`text-sm font-semibold ${isDark ? 'text-blue-400' : 'text-blue-700'}`}>
          Non-Production Server
        </p>
        <p className={`text-xs mt-0.5 ${isDark ? 'text-blue-400/70' : 'text-blue-600'}`}>
          Connected to <span className="font-mono">{serverUrl}</span>
        </p>
        <p className={`text-xs mt-1 ${isDark ? 'text-blue-300/70' : 'text-blue-600'}`}>
          Feel free to test and experiment — changes here won't affect production data.
        </p>
      </div>
    </div>
  );
}
