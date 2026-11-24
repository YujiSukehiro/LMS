'use client';

import { useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Check, Copy, LoaderCircle, Send, TriangleAlert, Users, X } from 'lucide-react';
import { ALL_COHORTS_ID } from '@/lib/schemas/constants';
import { cn } from '@/lib/utils';
import { PublicationGatesError, publishTrack, saveTrackAssignment } from './api-client';
import type { PublicationGateReport } from '@/lib/schemas/source-truth';

export interface PublishPersonOption {
  uid: string;
  name: string;
  /** LC number or email, and home Cohort. */
  detail: string;
}

const PEOPLE_SHOWN = 40;

export interface PublishCohortOption {
  id: string;
  name: string;
  /** Active agents in this Cohort whose Divisions include the Track's Division. */
  reach: number;
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
  people = [],
  initialUserIds = [],
  published: alreadyPublished = false,
  mode = 'publish',
  autoOpen = false,
  divisionLabel,
  beforePublish,
  onOpenSourceReview,
  reviewItems = [],
  disabled,
}: {
  trackId: string;
  trackTitle: string;
  cohorts: PublishCohortOption[];
  initialCohortIds: string[];
  /** Active agents who can be assigned one by one (Connor 2026-11-24). */
  people?: PublishPersonOption[];
  initialUserIds?: string[];
  /** Already published: offer "Save assignment" without publishing a new version. */
  published?: boolean;
  /**
   * 'assign' = the "Edit assignment" button (Connor 2026-11-24: assignment had to be easy to find): only who takes a
   * published Track changes; no new version.
   */
  mode?: 'publish' | 'assign';
  /** Open on load (Track Studio list links here with ?assign=1). */
  autoOpen?: boolean;
  /** The Track's Division, for "Cohorts with Telehealth agents". */
  divisionLabel: string;
  /** Saves pending edits. Return false to stop the publish. */
  beforePublish: () => Promise<boolean>;
  onOpenSourceReview: () => void;
  /** Suggested checks before going live (publishReviewItems). Shown as a warning; never blocks Publish. */
  reviewItems?: string[];
  disabled?: boolean;
}) {
  const router = useRouter();
  const dialogRef = useRef<HTMLDialogElement>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set(initialCohortIds));
  const [selectedPeople, setSelectedPeople] = useState<Set<string>>(new Set(initialUserIds));
  const [personQuery, setPersonQuery] = useState('');
  const [assignmentSaved, setAssignmentSaved] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [gateReport, setGateReport] = useState<PublicationGateReport | null>(null);
  const [published, setPublished] = useState<{ versionId: string; link: string } | null>(null);
  const [copied, setCopied] = useState(false);

  const allSelected = selected.has(ALL_COHORTS_ID);
  // Only Cohorts with agents in this Division are listed; ones already assigned stay listed so they can be removed.
  const listed = cohorts.filter((cohort) => cohort.reach > 0 || selected.has(cohort.id));
  const hiddenCount = cohorts.length - listed.length;
  const reach = allSelected
    ? cohorts.reduce((sum, cohort) => sum + cohort.reach, 0)
    : cohorts.filter((cohort) => selected.has(cohort.id)).reduce((sum, cohort) => sum + cohort.reach, 0);

  function open() {
    setSelected(new Set(initialCohortIds));
    setSelectedPeople(new Set(initialUserIds));
    setPersonQuery('');
    setAssignmentSaved(false);
    setError(null);
    setGateReport(null);
    setPublished(null);
    setCopied(false);
    dialogRef.current?.showModal();
  }

  function close() {
    dialogRef.current?.close();
  }

  const assignOnly = mode === 'assign';
  const autoOpened = useRef(false);
  useEffect(() => {
    if (autoOpen && !autoOpened.current) {
      autoOpened.current = true;
      open();
    }
    // open() only reads the initial props; run once on mount.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [autoOpen]);

  function toggle(id: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      if (id === ALL_COHORTS_ID && next.has(ALL_COHORTS_ID)) return new Set([ALL_COHORTS_ID]);
      return next;
    });
  }

  function togglePerson(uid: string) {
    setSelectedPeople((prev) => {
      const next = new Set(prev);
      if (next.has(uid)) next.delete(uid);
      else next.add(uid);
      return next;
    });
  }

  async function onSaveAssignment() {
    if (selected.size === 0 && selectedPeople.size === 0) {
      setError('Pick at least one Cohort or person.');
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await saveTrackAssignment(trackId, [...selected], [...selectedPeople]);
      setAssignmentSaved(true);
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'The assignment was not saved.');
    } finally {
      setBusy(false);
    }
  }

  async function onPublish() {
    if (selected.size === 0 && selectedPeople.size === 0) {
      setError('Pick at least one Cohort or person.');
      return;
    }
    setBusy(true);
    setError(null);
    setGateReport(null);
    try {
      const saved = await beforePublish();
      if (!saved) {
        setError('Fix the problems in the draft before you publish.');
        return;
      }
      const versionId = await publishTrack(trackId, [...selected], [...selectedPeople]);
      setPublished({ versionId, link: `${window.location.origin}/learn/${encodeURIComponent(trackId)}` });
      router.refresh();
    } catch (err) {
      if (err instanceof PublicationGatesError) setGateReport(err.report);
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
      {assignOnly ? (
        <button type="button" className="pulse-btn" onClick={open} disabled={disabled}>
          <Users aria-hidden className="size-4" />
          Edit assignment
        </button>
      ) : (
        <button type="button" className="pulse-btn pulse-btn-primary" onClick={open} disabled={disabled}>
          <Send aria-hidden className="size-4" />
          Publish &amp; Assign
        </button>
      )}
      <dialog ref={dialogRef} className="pulse-dialog" aria-labelledby={assignOnly ? 'assign-dialog-title' : 'publish-dialog-title'}>
        <div className="flex items-start justify-between gap-3 border-b border-pulse-border px-5 py-4">
          <div>
            <h2 id={assignOnly ? 'assign-dialog-title' : 'publish-dialog-title'} className="text-base font-semibold">
              {assignOnly ? 'Edit assignment' : <>Publish &amp; Assign</>}
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
              {assignOnly
                ? `Pick the Cohorts and people who must take this Track. Only agents with the ${divisionLabel} Division see it. Saving changes who takes it right away; the published version and everyone's progress stay the same.`
                : `Pick the Cohorts and people who must take this Track. Only agents with the ${divisionLabel} Division see it. Publishing freezes the current draft as a new TrackVersion; earlier records stay intact.`}
            </p>
            {!assignOnly && reviewItems.length > 0 ? (
              <section className="rounded-pulse-md border border-pulse-amber/40 bg-pulse-amber/5 p-3" aria-label="Suggested review before going live">
                <p className="flex items-center gap-1.5 text-sm font-semibold text-pulse-amber">
                  <TriangleAlert aria-hidden className="size-4" />
                  Suggested review before going live ({reviewItems.length})
                </p>
                <p className="mt-1 text-xs text-pulse-secondary">
                  AI-built Tracks can repeat a situation or give away an answer. A trainer should play the Track once first. You can still publish now.
                </p>
                <ul className="mt-2 flex max-h-44 list-disc flex-col gap-1 overflow-y-auto pl-4 text-xs text-pulse-secondary">
                  {reviewItems.map((item, index) => <li key={index}>{item}</li>)}
                </ul>
              </section>
            ) : null}
            <fieldset className="flex flex-col gap-1.5">
              <legend className="pulse-label mb-2">Target Cohorts</legend>
              <div className="grid gap-1.5 sm:grid-cols-2">
                {listed.map((cohort) => (
                  <CohortCheckbox
                    key={cohort.id}
                    id={cohort.id}
                    label={cohort.name}
                    hint={`${cohort.reach} agent${cohort.reach === 1 ? '' : 's'}`}
                    checked={allSelected || selected.has(cohort.id)}
                    disabled={allSelected}
                    onToggle={toggle}
                  />
                ))}
              </div>
              {listed.length === 0 ? (
                <p className="text-xs text-pulse-muted">No Cohort has active {divisionLabel} agents yet.</p>
              ) : null}
              <CohortCheckbox
                id={ALL_COHORTS_ID}
                label="Every Cohort, including ones added later"
                checked={allSelected}
                onToggle={toggle}
              />
              {hiddenCount > 0 ? (
                <p className="text-xs text-pulse-muted">
                  {hiddenCount} Cohort{hiddenCount === 1 ? ' has' : 's have'} no {divisionLabel} agents and {hiddenCount === 1 ? 'is' : 'are'} not listed.
                </p>
              ) : null}
            </fieldset>
            <fieldset className="flex flex-col gap-1.5">
              <legend className="pulse-label mb-2">Specific people</legend>
              <p className="text-xs text-pulse-muted">
                Assign someone outside these Cohorts, or one person only. Only {divisionLabel} agents are listed.
              </p>
              {selectedPeople.size > 0 ? (
                <div className="flex flex-wrap gap-1.5">
                  {[...selectedPeople].map((uid) => {
                    const person = people.find((option) => option.uid === uid);
                    return (
                      <button
                        key={uid}
                        type="button"
                        className="pulse-pill pulse-pill-indigo flex items-center gap-1"
                        onClick={() => togglePerson(uid)}
                        aria-label={`Remove ${person?.name ?? uid}`}
                      >
                        {person?.name ?? uid}
                        <X aria-hidden className="size-3" />
                      </button>
                    );
                  })}
                </div>
              ) : null}
              {people.length > 0 ? (
                <>
                  <input
                    type="search"
                    className="pulse-input"
                    placeholder="Search by name, LC number or Cohort"
                    aria-label="Search people"
                    value={personQuery}
                    onChange={(e) => setPersonQuery(e.target.value)}
                  />
                  {personQuery.trim() ? (
                    <div className="flex max-h-40 flex-col gap-1 overflow-y-auto">
                      {people
                        .filter((person) => `${person.name} ${person.detail}`.toLowerCase().includes(personQuery.trim().toLowerCase()))
                        .slice(0, PEOPLE_SHOWN)
                        .map((person) => (
                          <CohortCheckbox
                            key={person.uid}
                            id={person.uid}
                            label={person.name}
                            hint={person.detail}
                            checked={selectedPeople.has(person.uid)}
                            onToggle={togglePerson}
                          />
                        ))}
                    </div>
                  ) : null}
                </>
              ) : (
                <p className="text-xs text-pulse-muted">No active {divisionLabel} agents yet.</p>
              )}
            </fieldset>
            <p className="text-sm font-medium text-pulse-secondary" aria-live="polite">
              {selected.size === 0 && selectedPeople.size === 0
                ? 'Pick at least one Cohort or person.'
                : `Reaches ${reach} agent${reach === 1 ? '' : 's'} in the Cohorts${selectedPeople.size > 0 ? `, plus ${selectedPeople.size} named ${selectedPeople.size === 1 ? 'person' : 'people'}` : ''}.`}
            </p>
            {assignmentSaved ? (
              <p className="flex items-center gap-2 text-sm font-semibold text-pulse-emerald" role="status">
                <Check aria-hidden className="size-4" />
                Assignment saved. Agents keep the same published version.
              </p>
            ) : null}
            {error ? (
              <p role="alert" className="rounded-pulse-md border border-pulse-crimson/40 bg-pulse-crimson/10 px-3 py-2 text-sm text-pulse-crimson">
                {error}
              </p>
            ) : null}
            {gateReport ? (
              <section className="rounded-pulse-md border border-pulse-crimson/30 bg-pulse-crimson/5 p-3" aria-label="Publication gate issues">
                <p className="text-xs font-semibold text-pulse-crimson">Source revision {gateReport.checkedSourceRevision}</p>
                <ul className="mt-2 flex max-h-56 flex-col gap-2 overflow-y-auto">
                  {gateReport.issues.map((issue, index) => (
                    <li key={`${issue.code}-${issue.affectedId}-${index}`} className="text-xs">
                      <span className="font-semibold">{issue.code} · {issue.affectedType} {issue.affectedId}</span>
                      <span className="mt-0.5 block text-pulse-secondary">{issue.message}</span>
                    </li>
                  ))}
                </ul>
                <button type="button" className="pulse-btn mt-3" onClick={() => { close(); onOpenSourceReview(); }}>
                  Open Source Review
                </button>
              </section>
            ) : null}
            <div className="flex justify-end gap-2">
              <button type="button" className="pulse-btn pulse-btn-ghost" onClick={close} disabled={busy}>
                Cancel
              </button>
              {assignOnly ? (
                <button type="button" className="pulse-btn pulse-btn-primary" onClick={onSaveAssignment} disabled={busy || (selected.size === 0 && selectedPeople.size === 0)}>
                  {busy ? <LoaderCircle aria-hidden className="size-4 animate-spin" /> : <Check aria-hidden className="size-4" />}
                  {busy ? 'Saving…' : 'Save assignment'}
                </button>
              ) : (
                <>
                  {alreadyPublished ? (
                    <button type="button" className="pulse-btn" onClick={onSaveAssignment} disabled={busy}>
                      Save assignment only
                    </button>
                  ) : null}
                  <button type="button" className="pulse-btn pulse-btn-success" onClick={onPublish} disabled={busy || (selected.size === 0 && selectedPeople.size === 0)}>
                    {busy ? <LoaderCircle aria-hidden className="size-4 animate-spin" /> : <Send aria-hidden className="size-4" />}
                    {busy ? 'Publishing…' : 'Publish Track'}
                  </button>
                </>
              )}
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
  hint,
}: {
  id: string;
  label: string;
  checked: boolean;
  disabled?: boolean;
  onToggle: (id: string) => void;
  hint?: string;
}) {
  return (
    <label
      className={cn(
        'flex cursor-pointer items-center gap-2.5 rounded-pulse-md border px-3 py-2 text-sm transition-colors',
        checked ? 'border-pulse-indigo/60 bg-pulse-indigo/10' : 'border-pulse-border-subtle hover:border-pulse-border',
        disabled && 'cursor-not-allowed opacity-60',
      )}
    >
      <input
        type="checkbox"
        className="size-4 accent-[var(--pulse-indigo)]"
        checked={checked}
        disabled={disabled}
        onChange={() => onToggle(id)}
      />
      <span className="min-w-0 flex-1">{label}</span>
      {hint ? <span className="pulse-metric shrink-0 text-xs text-pulse-muted">{hint}</span> : null}
    </label>
  );
}
