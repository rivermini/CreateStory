import type { CSSProperties } from 'react';
import type { ThemeMode } from '../../types/theme';

export interface ThemeTokens {
  mode: ThemeMode;
  isDark: boolean;
  colors: {
    page: string;
    pageSoft: string;
    surface: string;
    surfaceElevated: string;
    surfaceMuted: string;
    border: string;
    borderStrong: string;
    text: string;
    textSoft: string;
    textMuted: string;
    textFaint: string;
    primary: string;
    primarySoft: string;
    active: string;
    activeText: string;
    danger: string;
    success: string;
    warning: string;
  };
  shadows: {
    soft: string;
    floating: string;
    modal: string;
  };
  radii: {
    sm: string;
    md: string;
    lg: string;
    xl: string;
  };
}

export function getThemeTokens(themeMode: ThemeMode): ThemeTokens {
  const isDark = themeMode === 'dark';

  return {
    mode: themeMode,
    isDark,
    colors: {
      page: isDark ? '#080808' : '#ffffff',
      pageSoft: isDark ? '#101010' : '#ffffff',
      surface: isDark ? 'rgba(20,20,19,0.92)' : 'rgba(255,255,255,0.88)',
      surfaceElevated: isDark ? 'rgba(27,27,26,0.96)' : 'rgba(255,255,255,0.96)',
      surfaceMuted: isDark ? 'rgba(255,255,255,0.06)' : 'rgba(17,17,17,0.045)',
      border: isDark ? 'rgba(255,255,255,0.08)' : 'rgba(17,17,17,0.09)',
      borderStrong: isDark ? 'rgba(255,255,255,0.16)' : 'rgba(17,17,17,0.16)',
      text: isDark ? 'rgba(255,255,255,0.94)' : '#111111',
      textSoft: isDark ? 'rgba(255,255,255,0.68)' : 'rgba(17,17,17,0.68)',
      textMuted: isDark ? 'rgba(255,255,255,0.48)' : 'rgba(17,17,17,0.52)',
      textFaint: isDark ? 'rgba(255,255,255,0.32)' : 'rgba(17,17,17,0.34)',
      primary: '#ff5b00',
      primarySoft: isDark ? 'rgba(255,91,0,0.14)' : 'rgba(255,91,0,0.09)',
      active: isDark ? '#f5f5f1' : '#111111',
      activeText: isDark ? '#111111' : '#ffffff',
      danger: '#dc2626',
      success: '#16a34a',
      warning: '#f59e0b',
    },
    shadows: {
      soft: isDark ? '0 18px 44px rgba(0,0,0,0.34)' : '0 18px 44px rgba(17,17,17,0.06)',
      floating: isDark ? '0 24px 70px rgba(0,0,0,0.48)' : '0 24px 70px rgba(17,17,17,0.10)',
      modal: isDark ? '0 30px 90px rgba(0,0,0,0.58)' : '0 30px 90px rgba(17,17,17,0.18)',
    },
    radii: {
      sm: '8px',
      md: '12px',
      lg: '18px',
      xl: '24px',
    },
  };
}

export function tokenStyle(themeMode: ThemeMode): CSSProperties {
  const tokens = getThemeTokens(themeMode);
  return {
    '--cs-page': tokens.colors.page,
    '--cs-page-soft': tokens.colors.pageSoft,
    '--cs-surface': tokens.colors.surface,
    '--cs-surface-elevated': tokens.colors.surfaceElevated,
    '--cs-surface-muted': tokens.colors.surfaceMuted,
    '--cs-border': tokens.colors.border,
    '--cs-border-strong': tokens.colors.borderStrong,
    '--cs-text': tokens.colors.text,
    '--cs-text-soft': tokens.colors.textSoft,
    '--cs-text-muted': tokens.colors.textMuted,
    '--cs-text-faint': tokens.colors.textFaint,
    '--cs-primary': tokens.colors.primary,
    '--cs-primary-soft': tokens.colors.primarySoft,
    '--cs-active': tokens.colors.active,
    '--cs-active-text': tokens.colors.activeText,
    '--cs-danger': tokens.colors.danger,
    '--cs-success': tokens.colors.success,
    '--cs-warning': tokens.colors.warning,
    '--cs-shadow-soft': tokens.shadows.soft,
    '--cs-shadow-floating': tokens.shadows.floating,
    '--cs-shadow-modal': tokens.shadows.modal,
  } as CSSProperties;
}
