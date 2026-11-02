'use client';

import { useEffect, useId, useRef, useState, type FormEvent } from 'react';
import { ClipboardCheck, LoaderCircle, TriangleAlert, X } from 'lucide-react';
import { cn } from '@/lib/utils';

export interface DispositionPickerProps {
  open: boolean;
  options: string[];
  onSubmit: (disposition: string) => void;
  /** Called when the learner closes the dialog without submitting (Esc or Close). */
  onClose: () => void;
  submitting?: boolean;
  error?: string | null;
  /** When false the dialog cannot be closed without submitting (for example after the call already ended). */
  dismissible?: boolean;
}

/** Wrap-up `<dialog>`: the learner picks the Primary Disposition they would log, then submits for evaluation. */
export function DispositionPicker({
  open,
  options,
  onSubmit,
  onClose,
  submitting = false,
  error = null,
  dismissible = true,
}: DispositionPickerProps) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const [selected, setSelected] = useState<string | null>(null);
  const titleId = useId();
  const descId = useId();
  const groupName = useId();

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;
    if (open && !dialog.open) {
      dialog.showModal();
      const first = dialog.querySelector<HTMLInputElement>('input[type="radio"]');
      first?.focus();
    } else if (!open && dialog.open) {
      dialog.close();
    }
  }, [open]);

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;
    const onCancel = (event: Event) => {
      event.preventDefault();
      if (dismissible && !submitting) onClose();
    };
    dialog.addEventListener('cancel', onCancel);
    return () => dialog.removeEventListener('cancel', onCancel);
  }, [dismissible, submitting, onClose]);

  const submit = (event: FormEvent) => {
    event.preventDefault();
    if (!selected || submitting) return;
    onSubmit(selected);
  };

  return (
    <dialog ref={dialogRef} className="pulse-dialog" aria-labelledby={titleId} aria-describedby={descId}>
      <form onSubmit={submit} className="flex flex-col">
        <header className="flex items-start justify-between gap-3 border-b border-pulse-border-subtle p-5">
          <div className="flex gap-3">
            <span className="grid size-9 shrink-0 place-items-center rounded-pulse-md bg-pulse-indigo/15 text-pulse-indigo">
              <ClipboardCheck aria-hidden className="size-5" />
            </span>
            <div>
              <h2 id={titleId} className="text-base font-bold">
                Wrap-Up Disposition
              </h2>
              <p id={descId} className="mt-0.5 text-sm text-pulse-secondary">
                Select the Primary Disposition you would log for this interaction.
              </p>
            </div>
          </div>
          {dismissible ? (
            <button
              type="button"
              className="pulse-btn pulse-btn-ghost size-9 min-h-0 p-0"
              onClick={onClose}
              disabled={submitting}
              aria-label="Close and return to the call"
            >
              <X aria-hidden className="size-4" />
            </button>
          ) : null}
        </header>

        <fieldset className="flex flex-col gap-2 p-5" disabled={submitting}>
          <legend className="sr-only">Primary Disposition</legend>
          {options.map((option) => {
            const checked = selected === option;
            return (
              <label
                key={option}
                className={cn(
                  'flex cursor-pointer items-center gap-3 rounded-pulse-md border-2 px-3.5 py-3 text-sm font-medium transition-colors',
                  checked
                    ? 'border-pulse-indigo bg-pulse-indigo/15 text-pulse-primary'
                    : 'border-pulse-border bg-pulse-surface-2 text-pulse-secondary hover:border-pulse-indigo/50',
                )}
              >
                <input
                  type="radio"
                  name={groupName}
                  value={option}
                  checked={checked}
                  onChange={() => setSelected(option)}
                  className="size-4 accent-[var(--pulse-indigo)]"
                />
                {option}
              </label>
            );
          })}
        </fieldset>

        {error ? (
          <p role="alert" className="mx-5 mb-1 flex items-start gap-2 rounded-pulse-md border border-pulse-crimson/40 bg-pulse-crimson/10 px-3 py-2 text-sm text-pulse-crimson">
            <TriangleAlert aria-hidden className="mt-0.5 size-4 shrink-0" />
            {error}
          </p>
        ) : null}

        <footer className="flex items-center justify-end gap-2 border-t border-pulse-border-subtle p-4">
          <button type="submit" className="pulse-btn pulse-btn-primary" disabled={!selected || submitting}>
            {submitting ? (
              <>
                <LoaderCircle aria-hidden className="size-4 animate-spin" />
                Grading your call…
              </>
            ) : (
              'Submit for Evaluation'
            )}
          </button>
        </footer>
      </form>
    </dialog>
  );
}
