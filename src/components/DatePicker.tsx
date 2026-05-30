import { useEffect, useState, useRef } from 'react';

interface DatePickerProps {
    value: string;
    onDateChange: (date: string) => void;
    isDark: boolean;
}

export function DatePicker({ value, onDateChange, isDark }: DatePickerProps) {
    const [open, setOpen] = useState(false);
    const ref = useRef<HTMLDivElement>(null);

    useEffect(() => {
        const handleClick = (e: MouseEvent) => {
            if (ref.current && !ref.current.contains(e.target as Node)) {
                setOpen(false);
            }
        };
        document.addEventListener('mousedown', handleClick);
        return () => document.removeEventListener('mousedown', handleClick);
    }, []);

    const hasValue = !!value;

    return (
        <div ref={ref} className="relative">
            <button
                onClick={() => setOpen(v => !v)}
                className={`px-3 py-1.5 text-xs sm:text-sm rounded-xl transition-colors flex items-center gap-1.5 font-medium ${
                    hasValue
                        ? 'bg-indigo-600 text-white shadow-lg shadow-indigo-600/30'
                        : isDark
                            ? 'bg-slate-800 text-slate-300 hover:bg-slate-700 border border-slate-700'
                            : 'bg-white text-gray-700 hover:bg-gray-50 border border-gray-300 shadow-sm'
                }`}
            >
                <svg className="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
                    <rect x="3" y="4" width="18" height="18" rx="2" ry="2"/>
                    <line x1="16" y1="2" x2="16" y2="6"/>
                    <line x1="8" y1="2" x2="8" y2="6"/>
                    <line x1="3" y1="10" x2="21" y2="10"/>
                </svg>
                {value
                    ? new Date(value + 'T00:00:00').toLocaleDateString(undefined, { month: 'short', day: 'numeric' })
                    : 'Calendar'}
            </button>

            {open && (
                <DatePickerPanel
                    value={value}
                    onDateChange={(d) => { onDateChange(d); setOpen(false); }}
                    isDark={isDark}
                    onClose={() => setOpen(false)}
                />
            )}
        </div>
    );
}

interface DatePickerPanelProps {
    value: string;
    onDateChange: (date: string) => void;
    isDark: boolean;
    onClose: () => void;
}

function DatePickerPanel({ value, onDateChange, isDark, onClose }: DatePickerPanelProps) {
    const today = new Date();
    const [viewYear, setViewYear] = useState(() => {
        if (value) { const d = new Date(value); return d.getFullYear(); }
        return today.getFullYear();
    });
    const [viewMonth, setViewMonth] = useState(() => {
        if (value) { const d = new Date(value); return d.getMonth(); }
        return today.getMonth();
    });

    const DAYS = ['Su', 'Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa'];
    const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June',
        'July', 'August', 'September', 'October', 'November', 'December'];

    const firstDay = new Date(viewYear, viewMonth, 1).getDay();
    const daysInMonth = new Date(viewYear, viewMonth + 1, 0).getDate();

    const cells: (number | null)[] = [
        ...Array(firstDay).fill(null),
        ...Array.from({ length: daysInMonth }, (_, i) => i + 1),
    ];
    while (cells.length % 7 !== 0) cells.push(null);

    const selected = value ? new Date(value) : null;
    const isToday = (d: number) =>
        d === today.getDate() && viewMonth === today.getMonth() && viewYear === today.getFullYear();
    const isSelected = (d: number) =>
        !!selected && d === selected.getDate() &&
        viewMonth === selected.getMonth() && viewYear === selected.getFullYear();

    const prevMonth = () => {
        if (viewMonth === 0) { setViewMonth(11); setViewYear(y => y - 1); }
        else setViewMonth(m => m - 1);
    };
    const nextMonth = () => {
        if (viewMonth === 11) { setViewMonth(0); setViewYear(y => y + 1); }
        else setViewMonth(m => m + 1);
    };

    const selectDay = (d: number) => {
        const mm = String(viewMonth + 1).padStart(2, '0');
        const dd = String(d).padStart(2, '0');
        onDateChange(`${viewYear}-${mm}-${dd}`);
        onClose();
    };

    const goToToday = () => {
        setViewYear(today.getFullYear());
        setViewMonth(today.getMonth());
        const mm = String(today.getMonth() + 1).padStart(2, '0');
        const dd = String(today.getDate()).padStart(2, '0');
        onDateChange(`${today.getFullYear()}-${mm}-${dd}`);
        onClose();
    };

    const clearSelection = () => { onDateChange(''); onClose(); };

    const panelBg = isDark ? 'bg-slate-900 border border-slate-700' : 'bg-white border border-gray-200';
    const headerText = isDark ? 'text-slate-100' : 'text-gray-900';
    const subText = isDark ? 'text-slate-400' : 'text-gray-500';
    const dayText = isDark ? 'text-slate-300' : 'text-gray-700';
    const dayHover = isDark ? 'hover:bg-slate-700' : 'hover:bg-gray-100';
    const todayRing = isDark ? 'ring-1 ring-indigo-400' : 'ring-1 ring-indigo-500';
    const selectedBg = 'bg-indigo-600 text-white';

    return (
        <div className={`absolute top-full left-0 mt-2 rounded-2xl shadow-2xl z-50 p-4 w-[280px] ${panelBg}`}>
            {/* Header */}
            <div className="flex items-center justify-between mb-3">
                <button onClick={prevMonth} className={`p-1.5 rounded-lg transition-colors ${isDark ? 'hover:bg-slate-700 text-slate-400' : 'hover:bg-gray-100 text-gray-500'}`}>
                    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" /></svg>
                </button>
                <span className={`text-sm font-semibold ${headerText}`}>{MONTHS[viewMonth]} {viewYear}</span>
                <button onClick={nextMonth} className={`p-1.5 rounded-lg transition-colors ${isDark ? 'hover:bg-slate-700 text-slate-400' : 'hover:bg-gray-100 text-gray-500'}`}>
                    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" /></svg>
                </button>
            </div>

            {/* Day labels */}
            <div className="grid grid-cols-7 mb-1">
                {DAYS.map(d => (
                    <div key={d} className={`text-center text-[10px] font-medium py-1 ${subText}`}>{d}</div>
                ))}
            </div>

            {/* Day cells */}
            <div className="grid grid-cols-7 gap-0.5">
                {cells.map((day, i) => {
                    if (day === null) return <div key={'e' + i} />;
                    const sel = isSelected(day);
                    const todayCell = isToday(day);
                    return (
                        <button
                            key={day}
                            onClick={() => selectDay(day)}
                            className={[
                                'w-8 h-8 rounded-lg text-xs flex items-center justify-center transition-all',
                                sel ? selectedBg + ' shadow-md' :
                                    todayCell ? `${todayRing} ${dayText} ${dayHover}` :
                                        `${dayText} ${dayHover}`,
                            ].join(' ')}
                        >
                            {day}
                        </button>
                    );
                })}
            </div>

            {/* Footer */}
            <div className="mt-3 pt-3 border-t flex justify-between">
                <button
                    onClick={clearSelection}
                    className={`text-xs px-3 py-1.5 rounded-lg transition-colors ${isDark ? 'text-slate-400 hover:text-red-400 hover:bg-slate-800' : 'text-gray-500 hover:text-red-600 hover:bg-gray-100'}`}
                >
                    Clear
                </button>
                <button
                    onClick={goToToday}
                    className={`text-xs px-3 py-1.5 rounded-lg transition-colors font-medium ${isDark ? 'text-indigo-400 hover:text-indigo-300 hover:bg-slate-800' : 'text-indigo-600 hover:text-indigo-700 hover:bg-indigo-50'}`}
                >
                    Today
                </button>
            </div>
        </div>
    );
}
