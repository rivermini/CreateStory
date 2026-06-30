import type { ButtonHTMLAttributes, HTMLAttributes, InputHTMLAttributes, ReactNode } from 'react';
import { Icon, appIcons } from './Icon';
import { getThemeTokens } from './design';
import type { ThemeMode } from '../../types/theme';

type Tone = 'default' | 'primary' | 'active' | 'danger' | 'success' | 'warning';

export function PageShell({
  themeMode,
  children,
  className = '',
  ...props
}: HTMLAttributes<HTMLDivElement> & { themeMode: ThemeMode }) {
  const tokens = getThemeTokens(themeMode);
  return (
    <div
      className={`cs-page-shell ${className}`}
      style={{ background: tokens.colors.page, color: tokens.colors.text, ...props.style }}
      {...props}
    >
      {children}
    </div>
  );
}

export function PageHeader({
  eyebrow,
  title,
  description,
  actions,
  themeMode,
}: {
  eyebrow?: string;
  title: ReactNode;
  description?: ReactNode;
  actions?: ReactNode;
  themeMode: ThemeMode;
}) {
  const tokens = getThemeTokens(themeMode);
  return (
    <section className="cs-page-header">
      <div className="min-w-0">
        {eyebrow && <div className="cs-eyebrow">{eyebrow}</div>}
        <h1 className="cs-page-title" style={{ color: tokens.colors.text }}>{title}</h1>
        {description && <p className="cs-page-description" style={{ color: tokens.colors.textSoft }}>{description}</p>}
      </div>
      {actions && <div className="cs-page-actions">{actions}</div>}
    </section>
  );
}

export function Surface({
  children,
  className = '',
  interactive = false,
  ...props
}: HTMLAttributes<HTMLDivElement> & { interactive?: boolean }) {
  return (
    <div className={`cs-surface ${interactive ? 'cs-surface--interactive' : ''} ${className}`} {...props}>
      {children}
    </div>
  );
}

export function ActionButton({
  tone = 'default',
  icon,
  children,
  className = '',
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & { tone?: Tone; icon?: keyof typeof appIcons }) {
  return (
    <button type="button" className={`cs-button cs-button--${tone} ${className}`} {...props}>
      {icon && <Icon icon={appIcons[icon]} className="h-3.5 w-3.5 shrink-0" />}
      <span className="min-w-0">{children}</span>
    </button>
  );
}

export function IconButton({
  icon,
  label,
  className = '',
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & { icon: keyof typeof appIcons; label: string }) {
  return (
    <button type="button" title={label} aria-label={label} className={`cs-icon-button ${className}`} {...props}>
      <Icon icon={appIcons[icon]} className="h-4 w-4" />
    </button>
  );
}

export function PillTabs({
  items,
  activeId,
  onChange,
}: {
  items: Array<{ id: string; label: ReactNode; disabled?: boolean }>;
  activeId: string;
  onChange: (id: string) => void;
}) {
  return (
    <div className="cs-pill-tabs" role="tablist">
      {items.map((item) => (
        <button
          key={item.id}
          type="button"
          disabled={item.disabled}
          onClick={() => onChange(item.id)}
          className={`cs-pill-tab ${activeId === item.id ? 'cs-pill-tab--active' : ''}`}
        >
          {item.label}
        </button>
      ))}
    </div>
  );
}

export function StatusBadge({
  tone = 'default',
  children,
  className = '',
}: {
  tone?: Tone;
  children: ReactNode;
  className?: string;
}) {
  return <span className={`cs-status-badge cs-status-badge--${tone} ${className}`}>{children}</span>;
}

export function TextInput({ className = '', ...props }: InputHTMLAttributes<HTMLInputElement>) {
  return <input className={`cs-input ${className}`} {...props} />;
}

export function Toolbar({ children, className = '' }: HTMLAttributes<HTMLDivElement>) {
  return <div className={`cs-toolbar ${className}`}>{children}</div>;
}

export function DataTableShell({ children, className = '' }: HTMLAttributes<HTMLDivElement>) {
  return <div className={`cs-table-shell ${className}`}>{children}</div>;
}

export function EmptyState({
  icon = 'info',
  title,
  description,
}: {
  icon?: keyof typeof appIcons;
  title: ReactNode;
  description?: ReactNode;
}) {
  return (
    <div className="cs-empty-state">
      <span className="cs-empty-state__icon">
        <Icon icon={appIcons[icon]} className="h-5 w-5" />
      </span>
      <div>
        <p className="cs-empty-state__title">{title}</p>
        {description && <p className="cs-empty-state__description">{description}</p>}
      </div>
    </div>
  );
}
