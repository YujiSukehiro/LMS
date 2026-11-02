'use client';

import { useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Check, Copy, LoaderCircle, Send, X } from 'lucide-react';
import { ALL_COHORTS_ID } from '@/lib/schemas/constants';
import { cn } from '@/lib/utils';
import { publishTrack } from './api-client';

export interface PublishCohortOption {
  id: string;
  name: string;
}

/**
 * "Publish & Assign" native <dialog>: select target Cohorts, publish an immutable TrackVersion,
 * then show the shareable learner link.
 */
export function PublishDialog({
  trackId,
  trackTitle,
  cohorts,
  initialCohortIds,
  beforePublish,
  disabled,
}: {
  trackId: string;
  trackTitle: string;
  cohorts: PublishCohortOption[];
  initialCohortIds: string[];
  /** Saves pending edits. Return false to stop the publish. */
  beforePublish: () => Promise<boolean>;
  disabled?: boolean;
}) {
  const router = useRouter();
  const dialogRef = useRef<HTMLDialogElement>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set(initialCohortIds));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [published, setPublished] = useState<{ versionId: string; link: string } | null>(null);
  const [copied, setCopied] = useState(false);

  const allSelected = selected.has(ALL_COHORTS_ID);

  function open() {
    setError(null);
    setPublished(null);
    setCopied(false);
    dialogRef.current?.showModal();
  }

  function close() {
    dialogRef.current?.close();
  }

  function toggle(id: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      if (id === ALL_COHORTS_ID && next.has(ALL_COHORTS_ID)) return new Set([ALL_COHORTS_ID]);
      return next;
    });
  }

  async function onPublish() {
    if (selected.size === 0) {
      setError('Select one or more Cohorts.');
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const saved = await beforePublish();
      if (!saved) {
        setError('Fix the problems in the draft before you publish.');
        return;
      }
      const versionId = await publishTrack(trackId, [...selected]);
      setPublished({ versionId, link: `${window.location.origin}/learn/${encodeURIComponent(trackId)}` });
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'The Track did not publish.');
    } finally {
      setBusy(false);
    }
  }

  async function copyLink() {
    if (!published) return;
    try {
      await navigator.clipboard.writeText(published.link);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      setError('Copy did not work. Select the link and copy it manually.');
    }
  }

  return (
    <>
      <button type="button" className="pulse-btn pulse-btn-primary" onClick={open} disabled={disabled}>
        <Send aria-hidden className="size-4" />
        Publish &amp; Assign
      </button>
      <dialog ref={dialogRef} className="pulse-dialog" aria-labelledby="publish-dialog-title">
        <div className="flex items-start justify-between gap-3 border-b border-pulse-border px-5 py-4">
          <div>
            <h2 id="publish-dialog-title" className="text-base font-semibold">
              Publish &amp; Assign
            </h2>
            <p className="mt-0.5 text-xs text-pulse-muted">{trackTitle}</p>
          </div>
          <button type="button" className="pulse-btn pulse-btn-ghost px-2" onClick={close} aria-label="Close">
            <X aria-hidden className="size-4" />
          </button>
        </div>

        {published ? (
          <div className="flex flex-col gap-4 px-5 py-5">
            <p className="flex items-center gap-2 text-sm font-semibold text-pulse-emerald">
              <Check aria-hidden className="size-4" />
              Published as TrackVersion <span className="pulse-metric">{published.versionId}</span>
            </p>
            <p className="text-sm text-pulse-secondary">
              Agents in the selected Cohorts see this Track on their home page. You can also share this link:
            </p>
            <div className="flex gap-2">
              <input
                readOnly
                className="pulse-input pulse-metric text-xs"
                value={published.link}
                aria-label="Shareable Track link"
                onFocus={(e) => e.currentTarget.select()}
              />
              <button type="button" className="pulse-btn shrink-0" onClick={copyLink}>
                {copied ? <Check aria-hidden className="size-4 text-pulse-emerald" /> : <Copy aria-hidden className="size-4" />}
                {copied ? 'Copied' : 'Copy'}
              </button>
            </div>
            {error ? <p role="alert" className="text-xs text-pulse-crimson">{error}</p> : null}
            <div className="flex justify-end">
              <button type="button" className="pulse-btn" onClick={close}>
                Done
              </button>
            </div>
          </div>
        ) : (
          <div className="flex flex-col gap-4 px-5 py-5">
            <p className="text-sm text-pulse-secondary">
              Select the Cohorts that must take this Track. Publishing freezes the current draft as a new TrackVersion; earlier
              records stay intact.
            </p>
            <fieldset className="flex flex-col gap-1.5">
              <legend className="pulse-label mb-2">Target Cohorts</legend>
              <CohortCheckbox
                id={ALL_COHORTS_ID}
                label="All Active Cohorts"
                checked={allSelected}
                onToggle={toggle}
                emphasis
              />
              <div className="grid gap-1.5 sm:grid-cols-2">
                {cohorts.map((cohort) => (
                  <CohortCheckbox
                    key={cohort.id}
                    id={cohort.id}
                    label={cohort.name}
                    checked={allSelected || selected.has(cohort.id)}
                    disabled={allSelected}
                    onToggle={toggle}
                  />
                ))}
              </div>
            </fieldset>
            {error ? (
              <p role="alert" className="rounded-pulse-md border border-pulse-crimson/40 bg-pulse-crimson/10 px-3 py-2 text-sm text-pulse-crimson">
                {error}
              </p>
            ) : null}
            <div className="flex justify-end gap-2">
              <button type="button" className="pulse-btn pulse-btn-ghost" onClick={close} disabled={busy}>
                Cancel
              </button>
              <button type="button" className="pulse-btn pulse-btn-success" onClick={onPublish} disabled={busy || selected.size === 0}>
                {busy ? <LoaderCircle aria-hidden className="size-4 animate-spin" /> : <Send aria-hidden className="size-4" />}
                {busy ? 'Publishing…' : 'Publish Track'}
              </button>
            </div>
          </div>
        )}
      </dialog>
    </>
  );
}

function CohortCheckbox({
  id,
  label,
  checked,
  disabled,
  onToggle,
  emphasis,
}: {
  id: string;
  label: string;
  checked: boolean;
  disabled?: boolean;
  onToggle: (id: string) => void;
  emphasis?: boolean;
}) {
  return (
    <label
      className={cn(
        'flex cursor-pointer items-center gap-2.5 rounded-pulse-md border px-3 py-2 text-sm transition-colors',
        checked ? 'border-pulse-indigo/60 bg-pulse-indigo/10' : 'border-pulse-border-subtle hover:border-pulse-border',
        disabled && 'cursor-not-allowed opacity-60',
        emphasis && 'font-semibold',
      )}
    >
      <input
        type="checkbox"
        className="size-4 accent-[var(--pulse-indigo)]"
        checked={checked}
        disabled={disabled}
        onChange={() => onToggle(id)}
      />
      {label}
    </label>
  );
}
