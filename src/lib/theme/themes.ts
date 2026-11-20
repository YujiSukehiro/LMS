/**
 * Color themes. Light is the default. The choice lives in a cookie so the server can render
 * the right `data-theme` on <html> with no flash, and it is also saved to users/{uid}.preferences.theme.
 */
export const THEME_IDS = ['light', 'dark', 'contrast', 'system'] as const;
export type ThemeId = (typeof THEME_IDS)[number];

export const DEFAULT_THEME: ThemeId = 'light';
export const THEME_COOKIE = 'pulse-theme';
/** One year. */
export const THEME_COOKIE_MAX_AGE = 60 * 60 * 24 * 365;

export const THEME_OPTIONS: ReadonlyArray<{ id: ThemeId; label: string; description: string }> = [
  { id: 'light', label: 'Light', description: 'Bright surfaces for daytime and shared screens.' },
  { id: 'dark', label: 'Dark', description: 'Low-glare surfaces for long shifts.' },
  { id: 'contrast', label: 'High contrast', description: 'Stronger text, borders, and focus rings.' },
  { id: 'system', label: 'System', description: 'Follow the device light or dark setting.' },
];

export function isThemeId(value: unknown): value is ThemeId {
  return typeof value === 'string' && (THEME_IDS as readonly string[]).includes(value);
}

export function resolveTheme(value: unknown): ThemeId {
  return isThemeId(value) ? value : DEFAULT_THEME;
}
