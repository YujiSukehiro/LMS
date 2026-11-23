'use client';

import { useState, type ReactNode } from 'react';
import { CircleAlert, LoaderCircle, Plus, TriangleAlert } from 'lucide-react';
import type { TrackUnit } from '@/lib/schemas/curriculum';
import { MAX_UNIT_DRILLS, trackAttention, unitAttention, unitNeedsAttention } from './unit-review';

/** Small amber chip for an item whose evidence the build could not match exactly. */
export function EvidenceReviewBadge() {
  return (
    <span
      className="inline-flex items-center gap-1 rounded-full bg-pulse-amber/15 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-pulse-amber"
      title="The build could not match this item's evidence to the source exactly. Fix it in Source Review or regenerate it."
    >
      <TriangleAlert aria-hidden className="size-3" />
      Needs evidence review
    </span>
  );
}

/** Per-Checkpoint "needs attention" panel for Play and Edit views. Renders nothing for a complete Unit. */
export function UnitAttentionPanel({
  unit,
  unitNumber,
  onOpenSourceReview,
  action,
  extraNotes = [],
}: {
  unit: TrackUnit;
  unitNumber: number;
  /** Track-level notes for this Unit, for example Drills that repeat an earlier Checkpoint. */
  extraNotes?: string[];
  onOpenSourceReview?: () => void;
  /** For example the Add Drill button. */
  action?: ReactNode;
}) {
  const base = unitAttention(unit, unitNumber);
  const attention = { ...base, notes: [...base.notes, ...extraNotes] };
  if (!unitNeedsAttention(attention)) return null;
  const evidenceCount = attention.cardIdsNeedingEvidence.length + attention.drillIdsNeedingEvidence.length;
  const labels = [
    ...unit.briefingCards.flatMap((card, i) => (attention.cardIdsNeedingEvidence.includes(card.id) ? [`Briefing Card ${i + 1}`] : [])),
    ...unit.drills.flatMap((drill, i) => (attention.drillIdsNeedingEvidence.includes(drill.id) ? [`Drill ${i + 1}`] : [])),
  ];
  // The live shortfall states the same thing as a "Needs more ..." build note with current counts.
  const notes = attention.shortfall ? attention.notes.filter((note) => !/^Needs more /i.test(note)) : attention.notes;
  return (
    <section
      aria-label={`Checkpoint ${unitNumber} needs attention`}
      className="rounded-pulse-lg border border-pulse-amber/40 bg-pulse-amber/5 p-4"
      data-testid="unit-attention"
    >
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="flex items-center gap-2 text-sm font-semibold text-pulse-amber">
            <CircleAlert aria-hidden className="size-4" />
            Checkpoint {unitNumber} needs attention before publishing
          </p>
          <ul className="mt-2 flex list-disc flex-col gap-1 pl-5 text-sm text-pulse-secondary">
            {attention.shortfall ? (
              <li>
                {attention.shortfall} Publishing is blocked until it has at least{' '}
                {attention.drillsNeeded > 0 ? `${attention.drillsNeeded} more Drill${attention.drillsNeeded === 1 ? '' : 's'}` : null}
                {attention.drillsNeeded > 0 && attention.cardsNeeded > 0 ? ' and ' : null}
                {attention.cardsNeeded > 0 ? `${attention.cardsNeeded} more Briefing Card${attention.cardsNeeded === 1 ? '' : 's'}` : null}.
              </li>
            ) : null}
            {notes.map((note, i) => (
              <li key={i}>{note}</li>
            ))}
            {evidenceCount > 0 ? (
              <li>
                {evidenceCount} item{evidenceCount === 1 ? ' needs' : 's need'} evidence review: {labels.join(', ')}.{' '}
                {onOpenSourceReview ? (
                  <button type="button" className="font-medium text-pulse-primary underline-offset-2 hover:underline" onClick={onOpenSourceReview}>
                    Open Source Review
                  </button>
                ) : null}
              </li>
            ) : null}
          </ul>
        </div>
        {action}
      </div>
    </section>
  );
}

/** Track-level summary of every Checkpoint that needs attention. */
export function TrackAttentionBanner({
  units,
  onSelectUnit,
}: {
  units: TrackUnit[];
  onSelectUnit: (unitId: string) => void;
}) {
  const summary = trackAttention(units);
  if (summary.units.length === 0) return null;
  const parts = [
    summary.thinUnitCount > 0 ? `${summary.thinUnitCount} Checkpoint${summary.thinUnitCount === 1 ? ' is' : 's are'} below the minimum content` : null,
    summary.itemsNeedingEvidence > 0 ? `${summary.itemsNeedingEvidence} item${summary.itemsNeedingEvidence === 1 ? ' needs' : 's need'} evidence review` : null,
  ].filter(Boolean);
  return (
    <section
      role="status"
      aria-label="Checkpoints that need attention"
      className="rounded-pulse-lg border border-pulse-amber/40 bg-pulse-amber/5 p-4"
      data-testid="track-attention"
    >
      <p className="flex items-center gap-2 text-sm font-semibold text-pulse-amber">
        <TriangleAlert aria-hidden className="size-4" />
        Review before publishing{parts.length > 0 ? `: ${parts.join('; ')}` : ''}
      </p>
      <ul className="mt-2 flex flex-col gap-1 text-sm">
        {summary.units.map((unit) => {
          const evidence = unit.cardIdsNeedingEvidence.length + unit.drillIdsNeedingEvidence.length;
          const details = [
            unit.shortfall ? `${unit.drillsNeeded > 0 ? `${unit.drillsNeeded} more Drill${unit.drillsNeeded === 1 ? '' : 's'}` : ''}${unit.drillsNeeded > 0 && unit.cardsNeeded > 0 ? ', ' : ''}${unit.cardsNeeded > 0 ? `${unit.cardsNeeded} more Briefing Card${unit.cardsNeeded === 1 ? '' : 's'}` : ''} needed` : null,
            evidence > 0 ? `${evidence} evidence review${evidence === 1 ? '' : 's'}` : null,
            !unit.shortfall ? unit.notes.join(' ') || null : null,
          ].filter(Boolean);
          return (
            <li key={unit.unitId} className="flex flex-wrap items-baseline gap-x-2">
              <button
                type="button"
                className="font-medium text-pulse-primary underline-offset-2 hover:underline"
                onClick={() => onSelectUnit(unit.unitId)}
              >
                Checkpoint {unit.unitNumber}: {unit.title}
              </button>
              <span className="text-pulse-secondary">{details.join(' · ')}</span>
            </li>
          );
        })}
      </ul>
    </section>
  );
}

/** "Add a Drill" for a thin Checkpoint: writes one new source-grounded Drill through the regenerate path. */
export function AddDrillButton({
  unit,
  onAdd,
  disabled,
}: {
  unit: TrackUnit;
  onAdd: () => Promise<void>;
  disabled?: boolean;
}) {
  const [running, setRunning] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const full = unit.drills.length >= MAX_UNIT_DRILLS;
  return (
    <div className="flex flex-col items-end gap-1">
      <button
        type="button"
        className="pulse-btn px-2.5 py-1 text-xs"
        disabled={disabled || running || full}
        title={full ? `A Checkpoint holds at most ${MAX_UNIT_DRILLS} Drills.` : 'Pulse writes one new Drill from this Checkpoint’s Playbook pages.'}
        onClick={async () => {
          setRunning(true);
          setError(null);
          try {
            await onAdd();
          } catch (err) {
            setError(err instanceof Error ? err.message : 'The Drill was not added.');
          } finally {
            setRunning(false);
          }
        }}
      >
        {running ? <LoaderCircle aria-hidden className="size-3.5 animate-spin" /> : <Plus aria-hidden className="size-3.5" />}
        {running ? 'Writing a Drill…' : 'Add a Drill'}
      </button>
      {error ? (
        <p role="alert" className="max-w-xs text-right text-xs text-pulse-crimson">
          {error}
        </p>
      ) : null}
    </div>
  );
}
