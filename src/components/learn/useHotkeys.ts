'use client';

import { useEffect, useRef } from 'react';

/** Attribute that lets Enter / Space reach the hotkey handler while a tile button has focus. */
export const HOTKEY_TILE_ATTR = 'data-pulse-hotkeys';

function isEditableTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  if (target.isContentEditable) return true;
  const elementName = target.tagName;
  return elementName === 'INPUT' || elementName === 'TEXTAREA' || elementName === 'SELECT';
}

function isNativeActivator(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  if (target.closest(`[${HOTKEY_TILE_ATTR}]`)) return false;
  return Boolean(target.closest('button, a[href], summary, [role="button"], [role="radio"], [role="checkbox"]'));
}

/**
 * Window-level keyboard shortcuts for the Briefing and Drill runners.
 * - Ignores keys typed into form fields and keys with Ctrl / Meta / Alt.
 * - Ignores keys while a modal `<dialog>` is open.
 * - Lets Enter / Space activate a focused normal button natively (tiles opt in with `data-pulse-hotkeys`).
 * Return `true` from the handler to mark the key as handled (calls preventDefault).
 */
export function useHotkeys(handler: (event: KeyboardEvent) => boolean | void, enabled = true): void {
  const handlerRef = useRef(handler);

  useEffect(() => {
    handlerRef.current = handler;
  });

  useEffect(() => {
    if (!enabled) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.defaultPrevented || event.ctrlKey || event.metaKey || event.altKey || event.isComposing) return;
      if (isEditableTarget(event.target)) return;
      if (document.querySelector('dialog[open]')) return;
      if ((event.key === 'Enter' || event.key === ' ') && isNativeActivator(event.target)) return;
      if (handlerRef.current(event) === true) event.preventDefault();
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [enabled]);
}

/** Returns the 0-based index for keys `1`..`9`, or -1. */
export function digitKeyIndex(event: KeyboardEvent): number {
  if (event.key.length !== 1) return -1;
  const n = Number.parseInt(event.key, 10);
  return Number.isInteger(n) && n >= 1 && n <= 9 ? n - 1 : -1;
}
