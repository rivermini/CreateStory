import { Icon, appIcons } from '../../Shared/Icon';

const APP_ICON_PATH = `M1375 4946 c-41 -18 -83 -69 -90 -109 -3 -18 -5 -262 -3 -544 3 -497
4 -512 23 -540 12 -15 118 -93 238 -173 165 -111 216 -150 217 -166 0 -43 42
-182 75 -251 l34 -73 -47 -31 c-26 -18 -74 -55 -106 -83 -56 -48 -60 -49 -72
-31 -179 268 -254 373 -277 389 -28 20 -40 21 -487 21 -448 0 -459 0 -486 -21
-53 -39 -69 -71 -69 -134 0 -63 16 -95 69 -134 26 -20 42 -21 414 -24 l387 -3
122 -184 122 -184 -49 -93 c-46 -87 -120 -286 -120 -322 0 -9 -4 -16 -10 -16
-5 0 -85 18 -177 41 -190 46 -238 50 -285 20 -42 -25 -611 -598 -628 -630 -20
-39 -15 -115 10 -157 25 -39 86 -73 133 -74 63 0 102 31 362 289 l260 259 150
-37 150 -37 3 -34 c7 -96 38 -246 69 -335 19 -55 35 -108 36 -117 1 -12 -72
-67 -248 -185 -137 -92 -258 -181 -270 -196 -19 -27 -20 -44 -23 -392 -3 -407
-3 -411 64 -461 31 -24 47 -29 95 -29 62 0 94 17 133 69 20 26 21 43 24 334
l3 307 199 132 200 133 82 -86 c194 -202 430 -332 708 -391 118 -25 382 -25
500 0 277 59 509 186 700 383 l91 94 199 -131 200 -131 0 -295 c0 -329 2 -341
66 -389 31 -24 47 -29 95 -29 62 0 94 17 133 69 20 27 21 39 21 406 0 366 -1
379 -20 407 -17 23 -118 93 -509 356 -18 12 -17 16 17 107 38 103 63 212 75
329 l7 74 150 37 150 37 260 -258 c306 -303 328 -317 431 -270 68 31 103 109
83 184 -9 36 -52 83 -302 335 -161 162 -305 303 -320 314 -57 41 -86 40 -279
-8 -98 -24 -186 -44 -193 -44 -8 0 -15 7 -15 16 0 36 -74 235 -120 322 l-49
93 122 184 122 184 387 3 c372 3 388 4 414 24 53 39 69 71 69 134 0 63 -16 95
-69 134 -27 21 -38 21 -486 21 -447 0 -459 -1 -487 -21 -23 -16 -96 -119 -276
-388 -12 -17 -16 -15 -67 28 -30 26 -78 63 -107 82 l-52 34 34 73 c33 69 75
208 75 251 1 16 52 55 217 166 120 80 226 158 238 173 20 28 20 40 20 567 0
528 0 539 -21 566 -39 53 -71 69 -134 69 -63 0 -95 -16 -134 -69 -20 -27 -21
-41 -24 -494 l-3 -467 -102 -67 -102 -67 -27 60 c-79 173 -246 332 -426 405
-107 43 -180 57 -302 57 -122 0 -195 -14 -302 -57 -181 -74 -353 -238 -431
-415 l-22 -51 -102 68 -102 67 -3 467 c-3 453 -4 467 -24 494 -11 15 -32 37
-46 47 -33 25 -113 32 -153 13z m793 -2893 c48 -36 63 -67 73 -149 22 -178
125 -281 304 -303 120 -15 170 -62 170 -161 0 -63 -16 -95 -68 -134 -62 -46
-233 -26 -377 45 -164 81 -298 255 -335 434 -33 156 -9 240 80 281 40 19 119
12 153 -13z`;

function ValidationErrorBadge({ error, isDark }: { readonly error: string; readonly isDark: boolean }) {
  const isHardError =
    error.startsWith("WRONG") ||
    error.startsWith("DUPLICATE") ||
    error.startsWith("CHAPTERS_REWRITTEN") ||
    error.startsWith("NON_SEQUENTIAL");
  return (
    <span
      className="inline-flex max-w-full items-start gap-1 rounded-md border px-2 py-0.5 text-left text-[10px] font-semibold leading-4"
      style={
        isHardError
          ? isDark
            ? { background: 'rgba(239,68,68,0.14)', borderColor: 'rgba(239,68,68,0.24)', color: '#f87171' }
            : { background: 'rgba(239,68,68,0.08)', borderColor: 'rgba(239,68,68,0.16)', color: '#dc2626' }
          : isDark
            ? { background: 'rgba(245,158,11,0.14)', borderColor: 'rgba(245,158,11,0.24)', color: '#fcd34d' }
            : { background: 'rgba(245,158,11,0.08)', borderColor: 'rgba(245,158,11,0.16)', color: '#b45309' }
      }
    >
      <Icon icon={appIcons.statusWarning} className="mt-0.5 h-2.5 w-2.5 shrink-0" />
      <span className="min-w-0 whitespace-normal break-words">{error}</span>
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

function LoadingAppIcon({
  isDark,
  color = '#d97706',
  size = 'sm',
  className = '',
}: {
  readonly isDark: boolean;
  readonly color?: string;
  readonly size?: 'sm' | 'lg';
  readonly className?: string;
}) {
  const sizeClass = size === 'lg' ? 'h-16 w-16' : 'h-4 w-4';
  const iconClass = size === 'lg' ? 'h-11 w-11' : 'h-4 w-4';
  const shellClass = size === 'lg'
    ? 'mb-4 rounded-full border'
    : '';
  const shellStyle = size === 'lg'
    ? {
        background: isDark ? 'rgba(255,255,255,0.05)' : 'rgba(55,53,47,0.05)',
        borderColor: isDark ? 'rgba(255,255,255,0.08)' : 'rgba(55,53,47,0.12)',
      }
    : undefined;
  const baseStroke = isDark ? 'rgba(255,255,255,0.16)' : 'rgba(55,53,47,0.18)';

  return (
    <span
      className={`inline-flex ${sizeClass} items-center justify-center ${shellClass} ${className}`}
      style={shellStyle}
      aria-hidden="true"
    >
      <svg className={iconClass} viewBox="0 0 5120 5120" role="img">
        <g transform="translate(0 5120) scale(1 -1)">
          <path
            d={APP_ICON_PATH}
            fill="none"
            stroke={baseStroke}
            strokeWidth="170"
            strokeLinejoin="round"
            strokeLinecap="round"
          />
          <path
            d={APP_ICON_PATH}
            fill="none"
            stroke={color}
            strokeWidth="190"
            strokeLinejoin="round"
            strokeLinecap="round"
            pathLength="100"
            strokeDasharray="18 82"
            strokeDashoffset="100"
          >
            <animate
              attributeName="stroke-dashoffset"
              values="100;0"
              dur="1.6s"
              repeatCount="indefinite"
            />
          </path>
        </g>
      </svg>
    </span>
  );
}

export { ValidationErrorBadge, StatusBadge, EmptyState, LoadingAppIcon };
