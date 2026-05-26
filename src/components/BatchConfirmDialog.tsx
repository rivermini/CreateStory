import { useEffect, useRef, useState } from 'react';

interface BatchConfirmDialogProps {
  isOpen: boolean;
  title: string;
  message: string;
  itemCount: number;
  confirmText: string;
  isDark: boolean;
  disabled?: boolean;
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

  return (
    <div
      ref={overlayRef}
      className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm"
      onClick={(e) => {
        if (e.target === overlayRef.current) onCancel();
      }}
    >
      <div className={`w-full max-w-lg rounded-2xl shadow-2xl overflow-hidden ${isDark ? 'bg-slate-900 border border-slate-800' : 'bg-white border border-gray-200'}`}>
        {/* Header */}
        <div className={`flex items-center justify-between px-6 py-4 ${isDark ? 'border-b border-slate-800' : 'border-b border-gray-200'}`}>
          <div className="flex items-center gap-3">
            <div className={`p-2.5 rounded-xl ${isDark ? 'bg-indigo-900/40' : 'bg-indigo-50'}`}>
              <svg className={`w-5 h-5 ${isDark ? 'text-indigo-400' : 'text-indigo-600'}`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
              </svg>
            </div>
            <div>
              <h2 className={`text-base font-semibold ${isDark ? 'text-slate-100' : 'text-gray-900'}`}>{title}</h2>
              <p className={`text-xs ${isDark ? 'text-slate-500' : 'text-gray-500'}`}>{itemCount} items</p>
            </div>
          </div>
          <button
            onClick={onCancel}
            className={`p-2 rounded-xl transition-colors ${isDark
              ? 'text-slate-400 hover:text-slate-200 hover:bg-slate-800'
              : 'text-gray-500 hover:text-gray-700 hover:bg-gray-100'
            }`}
          >
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        {/* Body */}
        <div className="px-6 py-5">
          <p className={`text-sm mb-5 ${isDark ? 'text-slate-300' : 'text-gray-600'}`}>{message}</p>

          {/* Warning checkbox */}
          <div className={`p-4 rounded-xl mb-5 ${isDark ? 'bg-slate-800/50' : 'bg-gray-50 border border-gray-200'}`}>
            <label className="flex items-start gap-3 cursor-pointer">
              <input
                type="checkbox"
                checked={checked}
                onChange={e => setChecked(e.target.checked)}
                className="mt-0.5 w-4 h-4 rounded border-gray-300 text-indigo-500 focus:ring-indigo-500"
              />
              <div className="flex-1">
                <p className={`text-sm font-medium ${isDark ? 'text-slate-200' : 'text-gray-700'}`}>
                  I understand this action may take a long time and consume significant resources
                </p>
                <p className={`text-xs mt-1 ${isDark ? 'text-slate-500' : 'text-gray-400'}`}>
                  The operation will run in the background and cannot be undone
                </p>
              </div>
            </label>
          </div>

          {/* Confirm input */}
          <div className="mb-6">
            <label className={`block text-sm font-medium mb-2 ${isDark ? 'text-slate-300' : 'text-gray-700'}`}>
              Type <span className="font-mono font-bold text-indigo-500">confirm</span> to proceed:
            </label>
            <input
              type="text"
              value={inputValue}
              onChange={e => setInputValue(e.target.value)}
              placeholder="Type confirm"
              className={`w-full px-4 py-2.5 rounded-xl border text-sm font-mono focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-transparent ${
                isDark
                  ? 'bg-slate-800/60 border-slate-700 text-slate-100 placeholder:text-slate-600'
                  : 'bg-gray-50 border-gray-300 text-gray-900 placeholder:text-gray-400'
              }`}
            />
          </div>

          {/* Buttons */}
          <div className="flex items-center gap-3">
            <button
              onClick={onCancel}
              className={`flex-1 px-4 py-2.5 text-sm font-medium rounded-xl transition-colors ${
                isDark
                  ? 'bg-slate-800 hover:bg-slate-700 text-slate-300'
                  : 'bg-gray-100 hover:bg-gray-200 text-gray-700'
              }`}
            >
              Cancel
            </button>
            <button
              onClick={handleConfirm}
              disabled={!isConfirmEnabled}
              className={`flex-1 px-4 py-2.5 text-sm font-semibold rounded-xl transition-all ${
                isConfirmEnabled
                  ? 'bg-indigo-600 hover:bg-indigo-500 text-white shadow-lg shadow-indigo-600/20'
                  : isDark
                    ? 'bg-slate-700 text-slate-500 cursor-not-allowed'
                    : 'bg-gray-200 text-gray-400 cursor-not-allowed'
              }`}
            >
              {confirmText}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
