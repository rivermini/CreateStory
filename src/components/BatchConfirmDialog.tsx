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

  const panelBackground = isDark ? '#202020' : '#ffffff';
  const panelBorder = isDark ? 'rgba(255,255,255,0.08)' : 'rgba(55,53,47,0.12)';
  const overlayBg = isDark ? 'rgba(0,0,0,0.55)' : 'rgba(0,0,0,0.35)';
  const pageText = isDark ? 'rgba(255,255,255,0.92)' : '#37352f';
  const secondaryText = isDark ? 'rgba(255,255,255,0.5)' : 'rgba(55,53,47,0.62)';
  const tertiaryText = isDark ? 'rgba(255,255,255,0.34)' : 'rgba(55,53,47,0.42)';
  const mutedSurface = isDark ? 'rgba(255,255,255,0.05)' : 'rgba(55,53,47,0.05)';
  const searchBg = isDark ? 'rgba(255,255,255,0.05)' : 'rgba(55,53,47,0.05)';

  return (
    <div
      ref={overlayRef}
      className="fixed inset-0 z-50 flex items-center justify-center p-4"
      style={{ background: overlayBg, backdropFilter: 'blur(4px)' }}
      onClick={(e) => {
        if (e.target === overlayRef.current) onCancel();
      }}
    >
      <div
        className="w-full max-w-lg overflow-hidden rounded-2xl border"
        style={{ background: panelBackground, borderColor: panelBorder, boxShadow: isDark ? '0 24px 64px rgba(0,0,0,0.6)' : '0 24px 64px rgba(0,0,0,0.18)' }}
      >
        <div className="flex items-center justify-between border-b px-6 py-4" style={{ borderColor: panelBorder }}>
          <div className="flex items-center gap-3">
            <div
              className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl"
              style={{ background: 'rgba(251,191,36,0.14)', border: `1px solid rgba(251,191,36,0.2)` }}
            >
              <Icon icon={appIcons.statusWarning} className="h-5 w-5" style={{ color: '#fbbf24' }} />
            </div>
            <div>
              <h2 className="text-base font-semibold" style={{ color: pageText }}>{title}</h2>
              <p className="text-xs" style={{ color: secondaryText }}>{itemCount} items</p>
            </div>
          </div>
          <button
            onClick={onCancel}
            className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg transition-colors"
            style={{ color: tertiaryText }}
          >
            <Icon icon={appIcons.close} className="h-5 w-5" />
          </button>
        </div>

        <div className="px-6 py-5">
          <p className="mb-5 text-sm" style={{ color: secondaryText }}>{message}</p>

          {validationMessage && (
            <div
              className="mb-5 flex items-start gap-2 rounded-xl p-3"
              style={{ background: isDark ? 'rgba(239,68,68,0.08)' : 'rgba(239,68,68,0.04)', border: `1px solid ${isDark ? 'rgba(239,68,68,0.2)' : 'rgba(239,68,68,0.15)'}` }}
            >
              <Icon icon={appIcons.statusWarning} className="mt-0.5 h-4 w-4 shrink-0" style={{ color: isDark ? '#f87171' : '#dc2626' }} />
              <p className="text-sm" style={{ color: isDark ? '#f87171' : '#dc2626' }}>{validationMessage}</p>
            </div>
          )}

          <div
            className="mb-5 cursor-pointer rounded-xl p-4"
            style={{ background: mutedSurface, border: `1px solid ${panelBorder}` }}
            onClick={() => setChecked((prev) => !prev)}
          >
            <label className="flex items-start gap-3 cursor-pointer">
              <input
                type="checkbox"
                checked={checked}
                onChange={(e) => setChecked(e.target.checked)}
                className="mt-0.5 h-4 w-4 shrink-0 rounded border-indigo-500 text-indigo-500 focus:ring-indigo-500"
              />
              <div className="flex-1">
                <p className="text-sm font-medium" style={{ color: pageText }}>
                  I understand this action may take a long time and consume significant resources
                </p>
                <p className="mt-1 text-xs" style={{ color: tertiaryText }}>
                  The operation will run in the background and cannot be undone
                </p>
              </div>
            </label>
          </div>

          <div className="mb-6">
            <label className="mb-2 block text-sm font-medium" style={{ color: secondaryText }}>
              Type <span className="font-mono font-bold" style={{ color: '#818cf8' }}>confirm</span> to proceed:
            </label>
            <input
              type="text"
              value={inputValue}
              onChange={(e) => setInputValue(e.target.value)}
              placeholder="Type confirm"
              className="w-full rounded-xl border py-2.5 px-4 font-mono text-sm outline-none transition focus:border-indigo-500 focus:ring-2 focus:ring-indigo-500"
              style={{ background: searchBg, borderColor: panelBorder, color: pageText }}
            />
          </div>

          <div className="flex items-center gap-3">
            <button
              onClick={onCancel}
              className="flex-1 rounded-xl border py-2.5 text-sm font-medium transition-colors"
              style={{ background: mutedSurface, borderColor: panelBorder, color: secondaryText }}
            >
              Cancel
            </button>
            <button
              onClick={handleConfirm}
              disabled={!isConfirmEnabled}
              className="flex-1 rounded-xl border py-2.5 text-sm font-medium transition-colors disabled:cursor-not-allowed"
              style={{
                background: isConfirmEnabled ? '#4f46e5' : mutedSurface,
                borderColor: isConfirmEnabled ? '#4f46e5' : panelBorder,
                color: isConfirmEnabled ? '#ffffff' : secondaryText,
                opacity: isConfirmEnabled ? 1 : 0.5,
              }}
            >
              {confirmText}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
