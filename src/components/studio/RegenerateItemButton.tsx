'use client';

import { useId, useState, type FormEvent } from 'react';
import { LoaderCircle, RefreshCw } from 'lucide-react';
import { AnchoredPopover } from '@/components/layout/AnchoredPopover';

/**
 * "↻ Regenerate This Item" with an optional plain-English hint, shown in a native popover.
 * `onRegenerate` must call the regenerate-item API and swap the item into local state.
 */
export function RegenerateItemButton({
  itemLabel,
  onRegenerate,
  disabled,
}: {
  itemLabel: string;
  onRegenerate: (hint: string | undefined) => Promise<void>;
  disabled?: boolean;
}) {
  const hintId = useId();
  const [hint, setHint] = useState('');
  const [running, setRunning] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function run(close: () => void, event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    close();
    setRunning(true);
    setError(null);
    try {
      await onRegenerate(hint.trim() ? hint.trim() : undefined);
      setHint('');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'The item did not regenerate.');
    } finally {
      setRunning(false);
    }
  }

  return (
    <div className="flex flex-col items-end gap-1">
      <AnchoredPopover
        align="end"
        disabled={disabled || running}
        triggerClassName="pulse-btn px-2.5 py-1 text-xs"
        trigger={
          <>
            {running ? <LoaderCircle aria-hidden className="size-3.5 animate-spin" /> : <RefreshCw aria-hidden className="size-3.5" />}
            {running ? 'Regenerating…' : 'Regenerate This Item'}
          </>
        }
        panelClassName="w-80 p-3"
      >
        {(close) => (
          <form onSubmit={(e) => run(close, e)} className="flex flex-col gap-2">
            <p className="text-sm font-semibold">Regenerate {itemLabel}</p>
            <p className="text-xs text-pulse-muted">
              Pulse writes a new version from the same Playbook pages. Add a hint to steer it (optional).
            </p>
            <label className="sr-only" htmlFor={hintId}>
              Hint
            </label>
            <textarea
              id={hintId}
              className="pulse-textarea text-sm"
              rows={3}
              maxLength={400}
              value={hint}
              placeholder="Focus this more on the 70% medical refund rule"
              onChange={(e) => setHint(e.target.value)}
            />
            <div className="flex justify-end gap-2">
              <button type="button" className="pulse-btn pulse-btn-ghost px-3 py-1 text-xs" onClick={close}>
                Cancel
              </button>
              <button type="submit" className="pulse-btn pulse-btn-primary px-3 py-1 text-xs">
                <RefreshCw aria-hidden className="size-3.5" />
                Regenerate
              </button>
            </div>
          </form>
        )}
      </AnchoredPopover>
      {error ? (
        <p role="alert" className="max-w-xs text-right text-xs text-pulse-crimson">
          {error}
        </p>
      ) : null}
    </div>
  );
}
