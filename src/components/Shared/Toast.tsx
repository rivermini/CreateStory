import { useCallback, useEffect, useRef, useState } from 'react';
import { Icon, appIcons } from './Icon';

export type ToastType = 'success' | 'error' | 'info' | 'warning';
export type ToastPosition = 'bottom-right' | 'top-center';

export interface Toast {
  id: string;
  message: string;
  type: ToastType;
  duration?: number;
  position?: ToastPosition;
}

let toastCounter = 0;
const listeners = new Set<(toast: Toast) => void>();

// eslint-disable-next-line react-refresh/only-export-components
export function showToast(
  message: string,
  type: ToastType = 'success',
  duration = 2000,
  position: ToastPosition = 'bottom-right',
) {
  const t: Toast = {
    id: `toast-${++toastCounter}`,
    message,
    type,
    duration,
    position,
  };
  listeners.forEach((listener) => listener(t));
}

function dismissToast(id: string) {
  setToastsForDismiss((prev) => prev.filter((x) => x.id !== id));
}

let setToastsForDismiss: (fn: (prev: Toast[]) => Toast[]) => void = () => {};

export function ToastContainer() {
  const [toasts, setToasts] = useState<Toast[]>([]);

  useEffect(() => {
    setToastsForDismiss = setToasts;
  }, [setToasts]);

  const scheduleAutoDismiss = useCallback((t: Toast) => {
    const delay = t.duration ?? 2000;
    setTimeout(() => dismissToast(t.id), delay);
  }, []);

  const addToast = useCallback((t: Toast) => {
    setToasts((prev) => [...prev, t]);
    scheduleAutoDismiss(t);
  }, [scheduleAutoDismiss]);

  useEffect(() => {
    listeners.add(addToast);
    return () => {
      listeners.delete(addToast);
    };
  }, [addToast]);

  if (toasts.length === 0) return null;

  const bottomRightToasts = toasts.filter((t) => t.position !== 'top-center');
  const topCenterToasts = toasts.filter((t) => t.position === 'top-center');

  return (
    <>
      {topCenterToasts.length > 0 && (
        <div className="pointer-events-none fixed left-1/2 top-6 z-[100] flex -translate-x-1/2 flex-col gap-3 px-4">
          {topCenterToasts.map((t) => (
            <ToastItem key={t.id} toast={t} />
          ))}
        </div>
      )}

      {bottomRightToasts.length > 0 && (
        <div className="pointer-events-none fixed bottom-6 right-6 z-[100] flex max-w-[calc(100vw-2rem)] flex-col gap-3">
          {bottomRightToasts.map((t) => (
            <ToastItem key={t.id} toast={t} />
          ))}
        </div>
      )}
    </>
  );
}

function ToastItem({ toast }: Readonly<{ toast: Readonly<Toast> }>) {
  const isDark = document.documentElement.dataset.theme !== 'light';
  const [visible, setVisible] = useState(false);
  const [exiting, setExiting] = useState(false);
  const exitTimerRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  const startExitTimer = useCallback((duration: number) => {
    exitTimerRef.current = setTimeout(() => setExiting(true), duration - 300);
  }, []);

  useEffect(() => {
    requestAnimationFrame(() => setVisible(true));
    startExitTimer(toast.duration ?? 2000);
    return () => {
      if (exitTimerRef.current) clearTimeout(exitTimerRef.current);
    };
  }, [toast.duration, startExitTimer]);

  const handleClose = useCallback(() => {
    setExiting(true);
  }, []);

  const handleMouseEnter = useCallback((e: React.MouseEvent<HTMLButtonElement>) => {
    e.currentTarget.style.opacity = '1';
  }, []);

  const handleMouseLeave = useCallback((e: React.MouseEvent<HTMLButtonElement>) => {
    e.currentTarget.style.opacity = '0.7';
  }, []);

  const config: Record<
    ToastType,
    {
      accent: string;
      background: string;
      border: string;
      text: string;
      close: string;
      icon: React.ReactNode;
    }
  > = {
    success: {
      accent: '#10b981',
      background: isDark ? 'rgba(22,101,52,0.22)' : 'rgba(255,255,255,0.96)',
      border: isDark ? 'rgba(52,211,153,0.24)' : 'rgba(16,185,129,0.18)',
      text: isDark ? 'rgba(236,253,245,0.96)' : '#064e3b',
      close: isDark ? 'rgba(236,253,245,0.72)' : 'rgba(6,78,59,0.72)',
      icon: <Icon icon={appIcons.check} className="h-5 w-5" style={{ color: '#34d399' }} />,
    },
    error: {
      accent: '#ef4444',
      background: isDark ? 'rgba(127,29,29,0.24)' : 'rgba(255,255,255,0.96)',
      border: isDark ? 'rgba(248,113,113,0.24)' : 'rgba(239,68,68,0.18)',
      text: isDark ? 'rgba(254,242,242,0.96)' : '#7f1d1d',
      close: isDark ? 'rgba(254,242,242,0.72)' : 'rgba(127,29,29,0.72)',
      icon: <Icon icon={appIcons.close} className="h-5 w-5" style={{ color: '#f87171' }} />,
    },
    warning: {
      accent: '#f59e0b',
      background: isDark ? 'rgba(120,53,15,0.24)' : 'rgba(255,255,255,0.96)',
      border: isDark ? 'rgba(251,191,36,0.24)' : 'rgba(245,158,11,0.18)',
      text: isDark ? 'rgba(255,251,235,0.96)' : '#78350f',
      close: isDark ? 'rgba(255,251,235,0.72)' : 'rgba(120,53,15,0.72)',
      icon: <Icon icon={appIcons.statusWarning} className="h-5 w-5" style={{ color: '#fbbf24' }} />,
    },
    info: {
      accent: '#6366f1',
      background: isDark ? 'rgba(30,41,99,0.24)' : 'rgba(255,255,255,0.96)',
      border: isDark ? 'rgba(129,140,248,0.24)' : 'rgba(99,102,241,0.18)',
      text: isDark ? 'rgba(238,242,255,0.96)' : '#312e81',
      close: isDark ? 'rgba(238,242,255,0.72)' : 'rgba(49,46,129,0.72)',
      icon: <Icon icon={appIcons.info} className="h-5 w-5" style={{ color: '#818cf8' }} />,
    },
  };

  const isTopCenter = toast.position === 'top-center';
  const { accent, background, border, text, close, icon } = config[toast.type];

  const animationClass = isTopCenter
    ? visible && !exiting
      ? 'translate-y-0 opacity-100'
      : '-translate-y-4 opacity-0'
    : visible && !exiting
      ? 'translate-x-0 translate-y-0 opacity-100'
      : 'translate-x-4 translate-y-2 opacity-0';

  return (
    <div
      role="alert"
      aria-live="polite"
      aria-atomic="true"
      className={`pointer-events-auto flex min-w-[18rem] max-w-md items-center gap-3 rounded-xl border px-4 py-3 shadow-lg transition-all duration-300 ease-out ${animationClass}`}
      style={{
        background,
        borderColor: border,
        boxShadow: isDark ? '0 18px 40px rgba(0,0,0,0.45)' : '0 18px 40px rgba(15,23,42,0.12)',
        backdropFilter: 'blur(10px)',
      }}
    >
      <div
        className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg"
        style={{ background: isDark ? `${accent}18` : `${accent}10`, border: `1px solid ${border}` }}
      >
        {icon}
      </div>
      <p className="flex-1 text-sm font-medium leading-5" style={{ color: text }}>
        {toast.message}
      </p>
      <button
        onClick={handleClose}
        className="shrink-0 rounded-lg p-1 transition-opacity"
        style={{ color: close, opacity: 0.7 }}
        onMouseEnter={handleMouseEnter}
        onMouseLeave={handleMouseLeave}
      >
        <Icon icon={appIcons.close} className="h-4 w-4" />
      </button>
    </div>
  );
}
