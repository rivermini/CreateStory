import { useState } from 'react';

export type ThemeMode = 'system' | 'light' | 'dark';

const THEMES: ThemeMode[] = ['system', 'light', 'dark'];

const ThemeIcon = ({ mode, className }: { mode: ThemeMode; className?: string }) => {
    if (mode === 'system') {
        return (
            <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
                <rect x={2} y={3} width={20} height={14} rx={2} ry={2} />
                <line x1={8} y1={21} x2={16} y2={21} />
                <line x1={12} y1={17} x2={12} y2={21} />
            </svg>
        );
    }
    if (mode === 'light') {
        return (
            <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
                <circle cx={12} cy={12} r={5} />
                <line x1={12} y1={1} x2={12} y2={3} />
                <line x1={12} y1={21} x2={12} y2={23} />
                <line x1="4.22" y1="4.22" x2="5.64" y2="5.64" />
                <line x1="18.36" y1="18.36" x2="19.78" y2="19.78" />
                <line x1={1} y1={12} x2={3} y2={12} />
                <line x1={21} y1={12} x2={23} y2={12} />
                <line x1="4.22" y1="19.78" x2="5.64" y2="18.36" />
                <line x1="18.36" y1="5.64" x2="19.78" y2="4.22" />
            </svg>
        );
    }
    return (
        <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
            <path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z" />
        </svg>
    );
};

export function ThemeToggle({ mode, onChange }: { mode: ThemeMode; onChange: (mode: ThemeMode) => void }) {
    const [animating, setAnimating] = useState(false);
    const [displayMode, setDisplayMode] = useState(mode);

    const cycleTheme = () => {
        setAnimating(true);
        const currentIndex = THEMES.indexOf(mode);
        const nextIndex = (currentIndex + 1) % THEMES.length;
        setTimeout(() => {
            onChange(THEMES[nextIndex]);
            setDisplayMode(THEMES[nextIndex]);
            setAnimating(false);
        }, 150);
    };

    return (
        <button
            type="button"
            onClick={cycleTheme}
            className="relative w-9 h-9 flex items-center justify-center rounded-full border border-slate-700 bg-slate-900/90 shadow-lg backdrop-blur-sm hover:bg-slate-800/90 hover:border-slate-600 transition-all duration-200 group overflow-hidden"
            title={`Theme: ${mode}`}
        >
            <div
                className={`relative w-5 h-5 text-slate-400 transition-all duration-200 ${
                    animating ? 'scale-0 opacity-0 rotate-90' : 'scale-100 opacity-100 rotate-0'
                } group-hover:text-slate-200`}
            >
                <ThemeIcon mode={displayMode} className="absolute inset-0 w-full h-full" />
            </div>

            <div className="absolute inset-0 -translate-x-full group-hover:translate-x-full transition-transform duration-700 bg-gradient-to-r from-transparent via-white/5 to-transparent" />
        </button>
    );
}
