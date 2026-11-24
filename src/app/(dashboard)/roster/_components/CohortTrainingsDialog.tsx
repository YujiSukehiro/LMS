'use client';

import { useId, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { BookOpen, Loader2, X } from 'lucide-react';
import { readApiError } from './RosterFormFields';

export interface CohortTrainingOption {
  id: string;
  title: string;
  divisionLabel: string;
  /** Assigned to every Cohort, so it cannot be turned off for one Cohort here. */
  everyCohort: boolean;
  assigned: boolean;
}

/**
 * Assign published trainings to one Cohort from the Roster (Connor 2026-11-24). Saving sets exactly the ticked
 * Trainings for this Cohort; Trainings assigned to every Cohort stay on.
 */
export function CohortTrainingsDialog({
  cohortId,
  cohortName,
  trainings,
}: {
  cohortId: string;
  cohortName: string;
  trainings: CohortTrainingOption[];
}) {
  const router = useRouter();
  const dialogRef = useRef<HTMLDialogElement>(null);
  const titleId = useId();
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const assignedCount = trainings.filter((training) => training.assigned || training.everyCohort).length;

  function open(): void {
    setSelected(new Set(trainings.filter((training) => training.assigned).map((training) => training.id)));
    setError(null);
    dialogRef.current?.showModal();
  }

  async function save(): Promise<void> {
    setPending(true);
    setError(null);
    try {
      const response = await fetch(`/api/roster/cohorts/${encodeURIComponent(cohortId)}/trainings`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ trackIds: [...selected] }),
      });
      if (!response.ok) throw new Error(await readApiError(response, 'The trainings were not saved.'));
      dialogRef.current?.close();
      router.refresh();
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : 'The trainings were not saved.');
    } finally {
      setPending(false);
    }
  }

  return (
    <>
      <button type="button" className="pulse-btn w-full justify-center px-2 py-1 text-xs" onClick={open}>
        <BookOpen className="h-3.5 w-3.5" aria-hidden="true" />
        Trainings ({assignedCount})
      </button>
      <dialog ref={dialogRef} className="pulse-dialog text-left" aria-labelledby={titleId}>
        <div className="flex items-start justify-between gap-4 border-b border-pulse-border-subtle p-5">
          <div>
            <h2 id={titleId} className="text-lg font-semibold">
              Trainings for {cohortName}
            </h2>
            <p className="mt-1 text-xs text-pulse-muted">
              Everyone in this Cohort (including people who are also in it) must take the ticked trainings. Only agents
              with the training&apos;s Division see it.
            </p>
          </div>
          <button type="button" className="pulse-btn pulse-btn-ghost p-2" aria-label="Close" onClick={() => dialogRef.current?.close()} disabled={pending}>
            <X className="h-4 w-4" aria-hidden="true" />
          </button>
        </div>
        <div className="flex max-h-[60vh] flex-col gap-1.5 overflow-y-auto p-5">
          {trainings.length === 0 ? (
            <p className="text-sm text-pulse-muted">No published trainings yet. Publish one in Track Studio first.</p>
          ) : (
            trainings.map((training) => (
              <label key={training.id} className="flex items-center gap-2.5 rounded-pulse-md border border-pulse-border-subtle px-3 py-2 text-sm">
                <input
                  type="checkbox"
                  className="size-4 accent-[var(--pulse-indigo)]"
                  checked={training.everyCohort || selected.has(training.id)}
                  disabled={training.everyCohort || pending}
                  onChange={() =>
                    setSelected((prev) => {
                      const next = new Set(prev);
                      if (next.has(training.id)) next.delete(training.id);
                      else next.add(training.id);
                      return next;
                    })
                  }
                />
                <span className="min-w-0 flex-1">{training.title}</span>
                <span className="text-xs text-pulse-muted">{training.everyCohort ? 'Every Cohort' : training.divisionLabel}</span>
              </label>
            ))
          )}
          {error ? (
            <p role="alert" className="text-sm text-pulse-crimson">
              {error}
            </p>
          ) : null}
        </div>
        <div className="flex justify-end gap-2 border-t border-pulse-border-subtle p-5">
          <button type="button" className="pulse-btn pulse-btn-ghost" onClick={() => dialogRef.current?.close()} disabled={pending}>
            Cancel
          </button>
          <button type="button" className="pulse-btn pulse-btn-primary" onClick={save} disabled={pending || trainings.length === 0}>
            {pending ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> : null}
            Save trainings
          </button>
        </div>
      </dialog>
    </>
  );
}
