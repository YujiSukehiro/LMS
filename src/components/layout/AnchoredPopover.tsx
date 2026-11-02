'use client';

import { useCallback, useEffect, useId, useRef, type ReactNode } from 'react';
import { cn } from '@/lib/utils';

/**
 * Native HTML `popover` menu anchored under its trigger button.
 * The browser handles light-dismiss, Escape and top-layer stacking; this component only sets the position.
 */
export function AnchoredPopover({
  trigger,
  triggerClassName,
  triggerLabel,
  align = 'end',
  panelClassName,
  children,
  disabled,
}: {
  trigger: ReactNode;
  triggerClassName?: string;
  /** Accessible name when the trigger shows only an icon. */
  triggerLabel?: string;
  align?: 'start' | 'end';
  panelClassName?: string;
  children: (close: () => void) => ReactNode;
  disabled?: boolean;
}) {
  const id = `pp-${useId().replace(/[^a-zA-Z0-9_-]/g, '')}`;
  const buttonRef = useRef<HTMLButtonElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const panel = panelRef.current;
    if (!panel) return;
    const onBeforeToggle = (event: Event) => {
      const next = (event as ToggleEvent).newState;
      if (next !== 'open') return;
      const rect = buttonRef.current?.getBoundingClientRect();
      if (!rect) return;
      panel.style.position = 'fixed';
      panel.style.top = `${Math.round(rect.bottom + 6)}px`;
      panel.style.bottom = 'auto';
      if (align === 'end') {
        panel.style.left = 'auto';
        panel.style.right = `${Math.max(8, Math.round(window.innerWidth - rect.right))}px`;
      } else {
        panel.style.right = 'auto';
        panel.style.left = `${Math.max(8, Math.round(rect.left))}px`;
      }
    };
    panel.addEventListener('beforetoggle', onBeforeToggle);
    return () => panel.removeEventListener('beforetoggle', onBeforeToggle);
  }, [align]);

  const close = useCallback(() => {
    const panel = panelRef.current;
    if (panel && panel.matches(':popover-open')) panel.hidePopover();
  }, []);

  return (
    <>
      <button
        ref={buttonRef}
        type="button"
        popoverTarget={id}
        aria-label={triggerLabel}
        className={triggerClassName}
        disabled={disabled}
      >
        {trigger}
      </button>
      <div ref={panelRef} id={id} popover="auto" className={cn('pulse-popover', panelClassName)}>
        {children(close)}
      </div>
    </>
  );
}
