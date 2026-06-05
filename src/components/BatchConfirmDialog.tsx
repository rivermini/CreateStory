import { useEffect, useRef, useState } from 'react';
import { Icon, appIcons } from './Icon';

interface BatchConfirmDialogProps {
  isOpen: boolean;
  title: string;
  message: string;
  itemCount: number;
  confirmText: string;
  isDark: boolean;
  disabled?: boolean;
  validationMessage?: string;
  onConfirm: () => void;
  onCancel: () => void;
}

export function BatchConfirmDialog({
  isOpen,
  title,
  message,
  itemCount,
  confirmText,
  isDark,
  disabled = false,
  validationMessage,
  onConfirm,
  onCancel,
}: BatchConfirmDialogProps) {
  const [inputValue, setInputValue] = useState('');
  const [checked, setChecked] = useState(false);
  const overlayRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!isOpen) {
      setInputValue('');
      setChecked(false);
    }
  }, [isOpen]);

  useEffect(() => {
    if (!isOpen) return;
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onCancel();
    };
    document.addEventListener('keydown', handleKey);
    return () => document.removeEventListener('keydown', handleKey);
  }, [isOpen, onCancel]);

  if (!isOpen) return null;

  const isConfirmEnabled = !disabled && inputValue.toLowerCase() === 'confirm' && checked;

  const handleConfirm = () => {
    if (isConfirmEnabled) {
      onConfirm();
      setInputValue('');
      setChecked(false);
    }
  };

  const inputBase = isDark
    ? 'bg-white/8 border-white/12 text-white/85 placeholder:text-white/30 focus:border-indigo-500 focus:ring-0'
    : 'bg-black/4 border-black/10 text-black/80 placeholder:text-black/30 focus:border-indigo-500 focus:ring-0';

  return (
    <div
      ref={overlayRef}
      className="lg-modal-overlay"
      onClick={(e) => {
        if (e.target === overlayRef.current) onCancel();
      }}
    >
      <div className="lg-glass-deep w-full max-w-lg rounded-2xl overflow-hidden">
        {/* Header */}
        <div className={`flex items-center justify-between px-6 py-4 ${isDark ? 'border-b border-white/6' : 'border-b border-black/6'}`}>
          <div className="flex items-center gap-3">
            <div className="lg-icon-btn" style={{ background: isDark ? 'rgba(251,191,36,0.15)' : 'rgba(251,191,36,0.08)', color: '#fbbf24' }}>
              <Icon icon={appIcons.statusWarning} className="w-5 h-5" />
            </div>
            <div>
              <h2 className={`text-base font-semibold ${isDark ? 'text-white/85' : 'text-black/85'}`}>{title}</h2>
              <p className={`text-xs ${isDark ? 'text-white/75' : 'text-black/35'}`}>{itemCount} items</p>
            </div>
          </div>
          <button onClick={onCancel} className="lg-icon-btn">
            <Icon icon={appIcons.close} className="w-5 h-5" />
          </button>
        </div>

        {/* Body */}
        <div className="px-6 py-5">
          <p className={`text-sm mb-5 ${isDark ? 'text-white/80' : 'text-black/65'}`}>{message}</p>

          {validationMessage && (
            <div className="lg-glass mb-5 p-3 flex items-start gap-2" style={{ border: isDark ? '1px solid rgba(239,68,68,0.25)' : '1px solid rgba(239,68,68,0.3)', background: isDark ? 'rgba(239,68,68,0.08)' : 'rgba(239,68,68,0.04)' }}>
              <Icon icon={appIcons.statusWarning} className={`w-4 h-4 mt-0.5 shrink-0 ${isDark ? 'text-red-400' : 'text-red-500'}`} />
              <p className={`text-sm ${isDark ? 'text-red-300' : 'text-red-700'}`}>{validationMessage}</p>
            </div>
          )}

          <div className="lg-glass mb-5 p-4" style={{ border: isDark ? '1px solid rgba(255,255,255,0.06)' : '1px solid rgba(0,0,0,0.06)' }}>
            <label className="flex items-start gap-3 cursor-pointer">
              <input
                type="checkbox"
                checked={checked}
                onChange={e => setChecked(e.target.checked)}
                className="mt-0.5 w-4 h-4 rounded border-indigo-500 text-indigo-500 focus:ring-indigo-500"
              />
              <div className="flex-1">
                <p className={`text-sm font-medium ${isDark ? 'text-white/75' : 'text-black/65'}`}>
                  I understand this action may take a long time and consume significant resources
                </p>
                <p className={`text-xs mt-1 ${isDark ? 'text-white/55' : 'text-black/30'}`}>
                  The operation will run in the background and cannot be undone
                </p>
              </div>
            </label>
          </div>

          <div className="mb-6">
            <label className={`block text-sm font-medium mb-2 ${isDark ? 'text-white/65' : 'text-black/65'}`}>
              Type <span className="font-mono font-bold text-indigo-400">confirm</span> to proceed:
            </label>
            <input
              type="text"
              value={inputValue}
              onChange={e => setInputValue(e.target.value)}
              placeholder="Type confirm"
              className={`w-full px-4 py-2.5 rounded-xl border text-sm font-mono focus:outline-none ${inputBase}`}
            />
          </div>

          <div className="flex items-center gap-3">
            <button
              onClick={onCancel}
              className="lg-btn-ghost flex-1"
            >
              Cancel
            </button>
            <button
              onClick={handleConfirm}
              disabled={!isConfirmEnabled}
              className={isConfirmEnabled ? 'lg-btn-primary flex-1' : 'lg-btn-ghost flex-1 opacity-50 cursor-not-allowed'}
            >
              {confirmText}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
