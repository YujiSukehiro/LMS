'use client';

import { useSyncExternalStore } from 'react';
import { Contrast, Monitor, Moon, Sun, type LucideIcon } from 'lucide-react';
import { cn } from '@/lib/utils';
import {
  THEME_COOKIE,
  THEME_COOKIE_MAX_AGE,
  THEME_OPTIONS,
  resolveTheme,
  type ThemeId,
} from '@/lib/theme/themes';

const ICONS: Record<ThemeId, LucideIcon> = { light: Sun, dark: Moon, contrast: Contrast, system: Monitor };

/** Watch <html data-theme> so every switcher on the page stays in sync. */
function subscribe(onChange: () => void): () => void {
  const observer = new MutationObserver(onChange);
  observer.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });
  return () => observer.disconnect();
}
const readTheme = (): string | undefined => document.documentElement.dataset.theme;
const readServerTheme = (): string | undefined => undefined;

/** Save the theme to the signed-in user's preferences. Best effort: the cookie is the source for rendering. */
async function saveThemePreference(uid: string, theme: ThemeId): Promise<void> {
  const [{ doc, serverTimestamp, updateDoc }, { getClientAuth, getClientDb }] = await Promise.all([
    import('firebase/firestore'),
    import('@/lib/firebase/client'),
  ]);
  if (getClientAuth().currentUser?.uid !== uid) return;
  await updateDoc(doc(getClientDb(), 'users', uid), { 'preferences.theme': theme, updatedAt: serverTimestamp() });
}

export function applyTheme(theme: ThemeId): void {
  document.documentElement.dataset.theme = theme;
  document.cookie = `${THEME_COOKIE}=${theme}; path=/; max-age=${THEME_COOKIE_MAX_AGE}; samesite=lax`;
}

/**
 * Theme picker. `variant="menu"` is the labeled list inside the account menu;
 * `variant="compact"` is an icon-only segmented control (sign-in pages).
 */
export function ThemeSwitcher({ uid, variant = 'menu', className }: { uid?: string; variant?: 'menu' | 'compact'; className?: string }) {
  const theme = resolveTheme(useSyncExternalStore(subscribe, readTheme, readServerTheme));

  function choose(next: ThemeId) {
    applyTheme(next);
    if (uid) void saveThemePreference(uid, next).catch(() => undefined);
  }

  if (variant === 'compact') {
    return (
      <div role="radiogroup" aria-label="Color theme" className={cn('inline-flex gap-0.5 rounded-pulse-md border border-pulse-border bg-pulse-surface-1 p-0.5', className)}>
        {THEME_OPTIONS.map((option) => {
          const Icon = ICONS[option.id];
          const selected = option.id === theme;
          return (
            <button
              key={option.id}
              type="button"
              role="radio"
              aria-checked={selected}
              title={option.label}
              aria-label={option.label}
              onClick={() => choose(option.id)}
              className={cn(
                'grid size-7 place-items-center rounded-pulse-sm text-pulse-muted transition-colors hover:text-pulse-primary',
                selected && 'bg-pulse-indigo text-pulse-on-accent hover:text-pulse-on-accent',
              )}
            >
              <Icon aria-hidden className="size-3.5" />
            </button>
          );
        })}
      </div>
    );
  }

  return (
    <fieldset className={cn('px-1', className)}>
      <legend className="pulse-label px-1.5 pb-1.5">Theme</legend>
      <div role="radiogroup" aria-label="Color theme" className="grid grid-cols-4 gap-1">
        {THEME_OPTIONS.map((option) => {
          const Icon = ICONS[option.id];
          const selected = option.id === theme;
          return (
            <button
              key={option.id}
              type="button"
              role="radio"
              aria-checked={selected}
              title={option.description}
              onClick={() => choose(option.id)}
              className={cn(
                'flex flex-col items-center gap-1 rounded-pulse-sm border px-1 py-1.5 text-[0.6875rem] font-medium leading-tight transition-colors',
                selected
                  ? 'border-pulse-indigo bg-pulse-indigo/10 text-pulse-indigo-text'
                  : 'border-transparent text-pulse-muted hover:bg-pulse-elevated hover:text-pulse-primary',
              )}
            >
              <Icon aria-hidden className="size-4" />
              {option.id === 'contrast' ? 'Contrast' : option.label}
            </button>
          );
        })}
      </div>
    </fieldset>
  );
}
