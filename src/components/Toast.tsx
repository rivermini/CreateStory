import { useEffect, useRef, useState, useCallback } from 'react';

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

export function showToast(message: string, type: ToastType = 'success', duration = 2000, position: ToastPosition = 'bottom-right') {
  const toast: Toast = {
    id: `toast-${++toastCounter}`,
    message,
    type,
    duration,
    position,
  };
  listeners.forEach(listener => listener(toast));
}

export function ToastContainer() {
  const [toasts, setToasts] = useState<Toast[]>([]);

  useEffect(() => {
    const handler = (toast: Toast) => {
      setToasts(prev => [...prev, toast]);

      setTimeout(() => {
        setToasts(prev => prev.filter(t => t.id !== toast.id));
      }, toast.duration ?? 2000);
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
      {/* Top center toasts */}
      {topCenterToasts.length > 0 && (
        <div className="fixed top-6 left-1/2 -translate-x-1/2 z-[100] flex flex-col gap-3 pointer-events-none">
          {topCenterToasts.map(toast => (
            <ToastItem key={toast.id} toast={toast} />
          ))}
        </div>
      )}

      {/* Bottom right toasts */}
      {bottomRightToasts.length > 0 && (
        <div className="fixed bottom-6 right-6 z-[100] flex flex-col gap-3 pointer-events-none">
          {bottomRightToasts.map(toast => (
            <ToastItem key={toast.id} toast={toast} />
          ))}
        </div>
      )}
    </>
  );
}

function ToastItem({ toast }: { toast: Toast }) {
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

  const config = {
    success: {
      bg: isDark ? 'bg-emerald-900/95' : 'bg-emerald-50',
      border: isDark ? 'border-emerald-700' : 'border-emerald-200',
      text: isDark ? 'text-emerald-100' : 'text-emerald-800',
      icon: (
        <svg className="w-5 h-5 text-emerald-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
        </svg>
      ),
    },
    error: {
      bg: isDark ? 'bg-red-900/95' : 'bg-red-50',
      border: isDark ? 'border-red-700' : 'border-red-200',
      text: isDark ? 'text-red-100' : 'text-red-800',
      icon: (
        <svg className="w-5 h-5 text-red-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
        </svg>
      ),
    },
    warning: {
      bg: isDark ? 'bg-amber-900/95' : 'bg-amber-50',
      border: isDark ? 'border-amber-700' : 'border-amber-200',
      text: isDark ? 'text-amber-100' : 'text-amber-800',
      icon: (
        <svg className="w-5 h-5 text-amber-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
        </svg>
      ),
    },
    info: {
      bg: isDark ? 'bg-blue-900/95' : 'bg-blue-50',
      border: isDark ? 'border-blue-700' : 'border-blue-200',
      text: isDark ? 'text-blue-100' : 'text-blue-800',
      icon: (
        <svg className="w-5 h-5 text-blue-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
        </svg>
      ),
    },
  };

  const isTopCenter = toast.position === 'top-center';
  const { bg, border, text, icon } = config[toast.type];

  const animationClass = isTopCenter
    ? visible && !exiting
      ? 'opacity-100 translate-y-0'
      : 'opacity-0 -translate-y-4'
    : visible && !exiting
      ? 'opacity-100 translate-y-0 translate-x-0'
      : 'opacity-0 translate-y-2 translate-x-4';

  return (
    <div
      className={`
        flex items-center gap-3 px-4 py-3 rounded-xl border shadow-xl backdrop-blur-sm
        pointer-events-auto min-w-72 max-w-md
        transition-all duration-300 ease-out
        ${bg} ${border}
        ${animationClass}
      `}
    >
      <div className="flex-shrink-0">{icon}</div>
      <p className={`flex-1 text-sm font-medium ${text}`}>{toast.message}</p>
      <button
        onClick={handleClose}
        className={`flex-shrink-0 p-1 rounded-lg transition-colors ${text} hover:opacity-70`}
      >
        <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
        </svg>
      </button>
    </div>
  );
}
