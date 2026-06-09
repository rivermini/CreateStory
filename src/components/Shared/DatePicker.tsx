import { useEffect, useState, useRef } from 'react';
import { Icon, appIcons } from './Icon';

interface DatePickerProps {
  value: string;
  onDateChange: (date: string) => void;
  isDark: boolean;
}

function formatDisplayDate(value: string): string {
  if (!value) return 'Date';
  try {
    return new Date(`${value}T00:00:00`).toLocaleDateString(undefined, {
      month: 'short',
      day: 'numeric',
      year: 'numeric',
    });
  } catch {
    return value;
  }
}

export function DatePicker({ value, onDateChange, isDark }: DatePickerProps) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handleClick = (event: MouseEvent) => {
      if (ref.current && !ref.current.contains(event.target as Node)) {
        setOpen(false);
      }
    };

    document.addEventListener('mousedown', handleClick);
    return () => document.removeEventListener('mousedown', handleClick);
  }, []);

  const hasValue = !!value;
  const triggerBackground = hasValue
    ? isDark ? 'rgba(255,255,255,0.12)' : 'rgba(55,53,47,0.1)'
    : isDark ? 'rgba(255,255,255,0.05)' : 'rgba(55,53,47,0.05)';
  const triggerBorder = isDark ? 'rgba(255,255,255,0.08)' : 'rgba(55,53,47,0.12)';
  const triggerText = hasValue
    ? isDark ? 'rgba(255,255,255,0.92)' : '#37352f'
    : isDark ? 'rgba(255,255,255,0.5)' : 'rgba(55,53,47,0.62)';

  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        onClick={() => setOpen((current) => !current)}
        className="flex min-w-[140px] items-center justify-between gap-2 rounded-md border px-3 py-2 text-sm transition-colors"
        style={{
          background: triggerBackground,
          borderColor: triggerBorder,
          color: triggerText,
        }}
      >
        <span className="flex items-center gap-2 truncate">
          <Icon icon={appIcons.calendar} className="h-3.5 w-3.5 shrink-0" />
          <span className="truncate">{formatDisplayDate(value)}</span>
        </span>
        <Icon
          icon={appIcons.chevronDown}
          className={`h-3.5 w-3.5 shrink-0 transition-transform duration-200 ${open ? 'rotate-180' : ''}`}
        />
      </button>

      {open && (
        <DatePickerPanel
          value={value}
          onDateChange={(date) => {
            onDateChange(date);
            setOpen(false);
          }}
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
    if (value) {
      const date = new Date(value);
      return date.getFullYear();
    }
    return today.getFullYear();
  });
  const [viewMonth, setViewMonth] = useState(() => {
    if (value) {
      const date = new Date(value);
      return date.getMonth();
    }
    return today.getMonth();
  });

  const DAYS = ['Su', 'Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa'];
  const MONTHS = [
    'January',
    'February',
    'March',
    'April',
    'May',
    'June',
    'July',
    'August',
    'September',
    'October',
    'November',
    'December',
  ];

  const firstDay = new Date(viewYear, viewMonth, 1).getDay();
  const daysInMonth = new Date(viewYear, viewMonth + 1, 0).getDate();

  const cells: (number | null)[] = [
    ...Array(firstDay).fill(null),
    ...Array.from({ length: daysInMonth }, (_, index) => index + 1),
  ];

  while (cells.length % 7 !== 0) cells.push(null);

  const selected = value ? new Date(value) : null;
  const panelBackground = isDark ? '#202020' : '#ffffff';
  const panelBorder = isDark ? 'rgba(255,255,255,0.08)' : 'rgba(55,53,47,0.12)';
  const pageText = isDark ? 'rgba(255,255,255,0.92)' : '#37352f';
  const secondaryText = isDark ? 'rgba(255,255,255,0.5)' : 'rgba(55,53,47,0.62)';
  const tertiaryText = isDark ? 'rgba(255,255,255,0.34)' : 'rgba(55,53,47,0.42)';
  const mutedSurface = isDark ? 'rgba(255,255,255,0.05)' : 'rgba(55,53,47,0.05)';
  const activeSurface = isDark ? 'rgba(255,255,255,0.12)' : 'rgba(55,53,47,0.1)';

  const isToday = (day: number) =>
    day === today.getDate() && viewMonth === today.getMonth() && viewYear === today.getFullYear();
  const isSelected = (day: number) =>
    !!selected &&
    day === selected.getDate() &&
    viewMonth === selected.getMonth() &&
    viewYear === selected.getFullYear();

  const prevMonth = () => {
    if (viewMonth === 0) {
      setViewMonth(11);
      setViewYear((year) => year - 1);
    } else {
      setViewMonth((month) => month - 1);
    }
  };

  const nextMonth = () => {
    if (viewMonth === 11) {
      setViewMonth(0);
      setViewYear((year) => year + 1);
    } else {
      setViewMonth((month) => month + 1);
    }
  };

  const selectDay = (day: number) => {
    const month = String(viewMonth + 1).padStart(2, '0');
    const date = String(day).padStart(2, '0');
    onDateChange(`${viewYear}-${month}-${date}`);
    onClose();
  };

  const goToToday = () => {
    setViewYear(today.getFullYear());
    setViewMonth(today.getMonth());
    const month = String(today.getMonth() + 1).padStart(2, '0');
    const date = String(today.getDate()).padStart(2, '0');
    onDateChange(`${today.getFullYear()}-${month}-${date}`);
    onClose();
  };

  const clearSelection = () => {
    onDateChange('');
    onClose();
  };

  return (
    <div
      className="absolute left-0 top-full z-50 mt-2 w-[280px] rounded-2xl border p-4 shadow-2xl"
      style={{ background: panelBackground, borderColor: panelBorder }}
    >
      <div className="mb-3 flex items-center justify-between">
        <button
          type="button"
          onClick={prevMonth}
          className="flex h-8 w-8 items-center justify-center rounded-md border transition-colors"
          style={{ borderColor: panelBorder, background: mutedSurface, color: secondaryText }}
        >
          <Icon icon={appIcons.chevronLeft} className="h-4 w-4" />
        </button>
        <span className="text-sm font-semibold" style={{ color: pageText }}>
          {MONTHS[viewMonth]} {viewYear}
        </span>
        <button
          type="button"
          onClick={nextMonth}
          className="flex h-8 w-8 items-center justify-center rounded-md border transition-colors"
          style={{ borderColor: panelBorder, background: mutedSurface, color: secondaryText }}
        >
          <Icon icon={appIcons.chevronRight} className="h-4 w-4" />
        </button>
      </div>

      <div className="mb-1 grid grid-cols-7">
        {DAYS.map((day) => (
          <div key={day} className="py-1 text-center text-[10px] font-medium" style={{ color: tertiaryText }}>
            {day}
          </div>
        ))}
      </div>

      <div className="grid grid-cols-7 gap-1">
        {cells.map((day, index) => {
          if (day === null) {
            return <div key={`empty-${index}`} className="h-9 w-9" />;
          }

          const selectedDay = isSelected(day);
          const todayCell = isToday(day);

          return (
            <button
              key={`${viewYear}-${viewMonth}-${day}`}
              type="button"
              onClick={() => selectDay(day)}
              className="flex h-9 w-9 items-center justify-center rounded-md text-xs transition-colors"
              style={{
                background: selectedDay ? '#6366f1' : todayCell ? activeSurface : 'transparent',
                color: selectedDay ? '#ffffff' : pageText,
                border: `1px solid ${todayCell || selectedDay ? panelBorder : 'transparent'}`,
              }}
            >
              {day}
            </button>
          );
        })}
      </div>

      <div className="mt-4 flex justify-between border-t pt-4" style={{ borderColor: panelBorder }}>
        <button
          type="button"
          onClick={clearSelection}
          className="rounded-md px-3 py-1.5 text-xs transition-colors"
          style={{ background: mutedSurface, color: secondaryText }}
        >
          Clear
        </button>
        <button
          type="button"
          onClick={goToToday}
          className="rounded-md px-3 py-1.5 text-xs font-medium transition-colors"
          style={{ background: mutedSurface, color: pageText }}
        >
          Today
        </button>
      </div>
    </div>
  );
}
