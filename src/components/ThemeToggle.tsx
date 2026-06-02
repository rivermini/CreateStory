import { useState } from 'react';

export type ThemeMode = 'light' | 'dark';

const THEMES: ThemeMode[] = ['light', 'dark'];

const ThemeIcon = ({ mode, className }: { mode: ThemeMode; className?: string }) => {
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

    const isDark = mode === 'dark';

    return (
        <button
            type="button"
            onClick={cycleTheme}
            className="relative w-9 h-9 flex items-center justify-center rounded-full shadow-lg backdrop-blur-sm transition-all duration-200 group overflow-hidden"
            style={{
                background: isDark ? 'rgba(15,15,35,0.8)' : 'rgba(255,255,255,0.8)',
                backdropFilter: 'blur(16px)',
                border: `1px solid ${isDark ? 'rgba(255,255,255,0.1)' : 'rgba(0,0,0,0.1)'}`,
                boxShadow: isDark ? '0 4px 16px rgba(0,0,0,0.3)' : '0 4px 16px rgba(0,0,0,0.1)',
            }}
            title={`Theme: ${mode}`}
        >
            <div
                className="relative w-5 h-5 transition-all duration-200"
                style={{
                    transform: animating ? 'scale(0) rotate(90deg)' : 'scale(1) rotate(0deg)',
                    opacity: animating ? 0 : 1,
                    color: isDark ? 'rgba(255,255,255,0.45)' : 'rgba(0,0,0,0.5)',
                }}
            >
                <ThemeIcon mode={displayMode} className="absolute inset-0 w-full h-full" />
            </div>

            <div
                className="absolute inset-0 transition-transform duration-700"
                style={{
                    transform: 'translateX(-100%)',
                    background: isDark
                        ? 'linear-gradient(90deg, transparent, rgba(255,255,255,0.08), transparent)'
                        : 'linear-gradient(90deg, transparent, rgba(0,0,0,0.04), transparent)',
                }}
            />
        </button>
    );
}
