import { useEffect, useRef, useState, useCallback } from 'react';
import { Icon, appIcons } from './Icon';

export type ToastType = 'success' | 'error' | 'info' | 'warning';
export type ToastPosition = 'bottom-right' | 'top-center';

export interface toast {
  id: string;
  message: string;
  type: ToastType;
  duration?: number;
  position?: ToastPosition;
}

let toastCounter = 0;
const listeners = new Set<(toast: toast) => void>();

export function showToast(message: string, type: ToastType = 'success', duration = 2000, position: ToastPosition = 'bottom-right') {
  const t: toast = {
    id: `toast-${++toastCounter}`,
    message,
    type,
    duration,
    position,
  };
  listeners.forEach(listener => listener(t));
}

export function ToastContainer() {
  const [toasts, setToasts] = useState<toast[]>([]);

  useEffect(() => {
    const handler = (t: toast) => {
      setToasts(prev => [...prev, t]);

      setTimeout(() => {
        setToasts(prev => prev.filter(x => x.id !== t.id));
      }, t.duration ?? 2000);
    };

    listeners.add(handler);
    return () => {
      listeners.delete(handler);
    };
  }, []);

  if (toasts.length === 0) return null;

  const bottomRightToasts = toasts.filter(t => t.position !== 'top-center');
  const topCenterToasts = toasts.filter(t => t.position === 'top-center');

  return (
    <>
      {topCenterToasts.length > 0 && (
        <div className="fixed top-6 left-1/2 -translate-x-1/2 z-[100] flex flex-col gap-3 pointer-events-none">
          {topCenterToasts.map(t => (
            <ToastItem key={t.id} toast={t} />
          ))}
        </div>
      )}

      {bottomRightToasts.length > 0 && (
        <div className="fixed bottom-6 right-6 z-[100] flex flex-col gap-3 pointer-events-none">
          {bottomRightToasts.map(t => (
            <ToastItem key={t.id} toast={t} />
          ))}
        </div>
      )}
    </>
  );
}

function ToastItem({ toast }: { toast: toast }) {
  const isDark = document.documentElement.dataset.theme !== 'light';
  const [visible, setVisible] = useState(false);
  const [exiting, setExiting] = useState(false);
  const timerRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  useEffect(() => {
    requestAnimationFrame(() => setVisible(true));

    timerRef.current = setTimeout(() => {
      setExiting(true);
    }, (toast.duration ?? 2000) - 300);

    return () => {
      if (timerRef.current) clearTimeout(timerRef.current);
    };
  }, [toast.duration]);

  const handleClose = useCallback(() => {
    setExiting(true);
  }, []);

  const config: Record<ToastType, { bg: string; border: string; text: string; icon: React.ReactNode }> = {
    success: {
      bg: isDark ? 'rgba(5,150,105,0.9)' : 'rgba(255,255,255,0.95)',
      border: isDark ? 'rgba(52,211,153,0.4)' : 'rgba(52,211,153,0.3)',
      text: isDark ? 'rgba(209,250,229,1)' : 'rgba(5,46,22,0.9)',
      icon: <Icon icon={appIcons.check} className="w-5 h-5" style={{ color: '#34d399' }} />,
    },
    error: {
      bg: isDark ? 'rgba(127,29,29,0.9)' : 'rgba(255,255,255,0.95)',
      border: isDark ? 'rgba(248,113,113,0.4)' : 'rgba(248,113,113,0.3)',
      text: isDark ? 'rgba(254,215,215,1)' : 'rgba(39,5,5,0.9)',
      icon: <Icon icon={appIcons.close} className="w-5 h-5" style={{ color: '#f87171' }} />,
    },
    warning: {
      bg: isDark ? 'rgba(113,63,18,0.9)' : 'rgba(255,255,255,0.95)',
      border: isDark ? 'rgba(251,191,36,0.4)' : 'rgba(251,191,36,0.3)',
      text: isDark ? 'rgba(254,243,199,1)' : 'rgba(40,21,0,0.9)',
      icon: <Icon icon={appIcons.statusWarning} className="w-5 h-5" style={{ color: '#fbbf24' }} />,
    },
    info: {
      bg: isDark ? 'rgba(30,58,138,0.9)' : 'rgba(255,255,255,0.95)',
      border: isDark ? 'rgba(96,165,250,0.4)' : 'rgba(96,165,250,0.3)',
      text: isDark ? 'rgba(219,234,254,1)' : 'rgba(8,25,55,0.9)',
      icon: <Icon icon={appIcons.info} className="w-5 h-5" style={{ color: '#60a5fa' }} />,
    },
  };

  const isTopCenter = toast.position === 'top-center';
  const { bg, border, text, icon } = config[toast.type];

  const animationClass = isTopCenter
    ? visible && !exiting ? 'opacity-100 translate-y-0' : 'opacity-0 -translate-y-4'
    : visible && !exiting ? 'opacity-100 translate-y-0 translate-x-0' : 'opacity-0 translate-y-2 translate-x-4';

  return (
    <div
      className={`lg-glass flex items-center gap-3 px-4 py-3 pointer-events-auto min-w-72 max-w-md transition-all duration-300 ease-out ${animationClass}`}
      style={{ background: bg, border: `1px solid ${border}` }}
    >
      <div className="flex-shrink-0">{icon}</div>
      <p className="flex-1 text-sm font-medium" style={{ color: text }}>{toast.message}</p>
      <button
        onClick={handleClose}
        className="flex-shrink-0 p-1 rounded-lg transition-colors"
        style={{ color: text, opacity: 0.6 }}
        onMouseEnter={e => (e.currentTarget.style.opacity = '1')}
        onMouseLeave={e => (e.currentTarget.style.opacity = '0.6')}
      >
        <Icon icon={appIcons.close} className="w-4 h-4" />
      </button>
    </div>
  );
}
