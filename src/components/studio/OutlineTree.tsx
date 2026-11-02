'use client';

import { BookOpen, CircleAlert, Headset } from 'lucide-react';
import type { PublicSimScenario, TrackUnit } from '@/lib/schemas/curriculum';
import { cn } from '@/lib/utils';
import { DIFFICULTY_LABELS } from './editor/ScenarioEditor';

export type StudioSelection = { kind: 'unit'; unitId: string } | { kind: 'scenario'; scenarioId: string };

export function OutlineTree({
  units,
  scenarios,
  selection,
  onSelect,
  issueKeys,
}: {
  units: TrackUnit[];
  scenarios: PublicSimScenario[];
  selection: StudioSelection | null;
  onSelect: (selection: StudioSelection) => void;
  /** `unit:{id}` / `scenario:{id}` keys that have validation problems. */
  issueKeys: Set<string>;
}) {
  return (
    <nav aria-label="Track outline" className="flex flex-col gap-4">
      <div className="flex flex-col gap-1">
        <p className="pulse-label px-2">Checkpoints</p>
        {units.length === 0 ? <p className="px-2 text-xs text-pulse-muted">No Checkpoints.</p> : null}
        <ul className="flex flex-col gap-0.5">
          {units.map((unit, i) => {
            const active = selection?.kind === 'unit' && selection.unitId === unit.id;
            const hasIssue = issueKeys.has(`unit:${unit.id}`);
            return (
              <li key={unit.id}>
                <button
                  type="button"
                  onClick={() => onSelect({ kind: 'unit', unitId: unit.id })}
                  aria-current={active ? 'true' : undefined}
                  className={cn(
                    'flex w-full items-start gap-2.5 rounded-pulse-md px-2 py-2 text-left transition-colors',
                    active ? 'bg-pulse-indigo/15 ring-1 ring-pulse-indigo/40' : 'hover:bg-pulse-surface-2',
                  )}
                >
                  <span
                    className={cn(
                      'pulse-metric mt-0.5 flex size-6 shrink-0 items-center justify-center rounded-full border text-[0.7rem] font-bold',
                      active ? 'border-pulse-indigo text-pulse-indigo' : 'border-pulse-border text-pulse-muted',
                    )}
                  >
                    {i + 1}
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="line-clamp-2 text-sm font-medium leading-snug">{unit.title || 'Untitled Checkpoint'}</span>
                    <span className="mt-0.5 flex items-center gap-1 text-[0.7rem] text-pulse-muted">
                      <BookOpen aria-hidden className="size-3" />
                      {unit.briefingCards.length} cards · {unit.drills.length} drills
                    </span>
                  </span>
                  {hasIssue ? (
                    <CircleAlert aria-label="Has problems to fix" className="mt-1 size-4 shrink-0 text-pulse-crimson" />
                  ) : null}
                </button>
              </li>
            );
          })}
        </ul>
      </div>
      <div className="flex flex-col gap-1">
        <p className="pulse-label px-2">Live Call Sims</p>
        {scenarios.length === 0 ? <p className="px-2 text-xs text-pulse-muted">No Live Call Sims.</p> : null}
        <ul className="flex flex-col gap-0.5">
          {scenarios.map((scenario, i) => {
            const active = selection?.kind === 'scenario' && selection.scenarioId === scenario.id;
            const hasIssue = issueKeys.has(`scenario:${scenario.id}`);
            return (
              <li key={scenario.id}>
                <button
                  type="button"
                  onClick={() => onSelect({ kind: 'scenario', scenarioId: scenario.id })}
                  aria-current={active ? 'true' : undefined}
                  className={cn(
                    'flex w-full items-start gap-2.5 rounded-pulse-md px-2 py-2 text-left transition-colors',
                    active ? 'bg-pulse-indigo/15 ring-1 ring-pulse-indigo/40' : 'hover:bg-pulse-surface-2',
                  )}
                >
                  <Headset aria-hidden className={cn('mt-1 size-4 shrink-0', active ? 'text-pulse-indigo' : 'text-pulse-muted')} />
                  <span className="min-w-0 flex-1">
                    <span className="line-clamp-2 text-sm font-medium leading-snug">
                      {i + 1}. {scenario.title || 'Untitled Live Call Sim'}
                    </span>
                    <span className="mt-0.5 block text-[0.7rem] text-pulse-muted">{DIFFICULTY_LABELS[scenario.difficulty]}</span>
                  </span>
                  {hasIssue ? (
                    <CircleAlert aria-label="Has problems to fix" className="mt-1 size-4 shrink-0 text-pulse-crimson" />
                  ) : null}
                </button>
              </li>
            );
          })}
        </ul>
      </div>
    </nav>
  );
}
