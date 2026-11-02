import Link from 'next/link';
import { ArrowRight, Award, Check, Clock, Headset, Lock, RotateCcw, Trophy } from 'lucide-react';
import type { PublicSimScenario } from '@/lib/schemas/curriculum';
import { cn } from '@/lib/utils';
import { DifficultyBadge } from '@/components/simulation/DifficultyBadge';

export type CheckpointState = 'completed' | 'current' | 'locked';

export interface CheckpointMapUnit {
  id: string;
  title: string;
  summary: string;
  estimatedMinutes: number;
  state: CheckpointState;
  /** First-try accuracy of the best recorded completion, or null. */
  firstTryAccuracyPct: number | null;
}

export interface CheckpointMapScenario {
  id: string;
  title: string;
  difficulty: PublicSimScenario['difficulty'];
  counterpartyRoleLabel: string;
  passScoreThreshold: number;
  bestScorePct: number | null;
  passed: boolean;
}

export interface CheckpointMapProps {
  trackId: string;
  units: CheckpointMapUnit[];
  scenarios: CheckpointMapScenario[];
  /** Live Call Sim node is open (all Units complete, or staff access). */
  simUnlocked: boolean;
  certified: boolean;
  /** Query string appended to every link, e.g. `?version=draft`. */
  hrefSuffix?: string;
  /** Internal ops may open locked nodes for review. */
  staffAccess?: boolean;
}

function scoreTone(pct: number): string {
  if (pct >= 85) return 'pulse-pill-emerald';
  if (pct >= 70) return 'pulse-pill-amber';
  return 'pulse-pill-crimson';
}

/** Vertical Checkpoint path: Units in order, then the capstone Live Call Sim node. */
export function CheckpointMap({
  trackId,
  units,
  scenarios,
  simUnlocked,
  certified,
  hrefSuffix = '',
  staffAccess = false,
}: CheckpointMapProps) {
  const unitHref = (unitId: string) => `/learn/${encodeURIComponent(trackId)}/unit/${encodeURIComponent(unitId)}${hrefSuffix}`;
  const simHref = (scenarioId: string) =>
    `/learn/${encodeURIComponent(trackId)}/sim/${encodeURIComponent(scenarioId)}${hrefSuffix}`;

  return (
    <ol aria-label="Checkpoint path" className="relative flex flex-col gap-5">
      <span aria-hidden className="absolute bottom-8 left-7 top-8 w-1 -translate-x-1/2 rounded-full bg-pulse-border-subtle" />

      {units.map((unit, index) => {
        const number = index + 1;
        const isCompleted = unit.state === 'completed';
        const isCurrent = unit.state === 'current';
        const isLocked = unit.state === 'locked';
        return (
          <li key={unit.id} className="relative flex items-start gap-4">
            <span
              aria-hidden
              className={cn(
                'relative z-[1] grid size-14 shrink-0 place-items-center rounded-full border-4 text-lg font-bold',
                isCompleted && 'border-pulse-emerald bg-pulse-emerald text-[#04140e]',
                isCurrent && 'pulse-ring border-pulse-indigo bg-pulse-indigo text-white',
                isLocked && 'border-pulse-border bg-pulse-surface-2 text-pulse-muted',
              )}
            >
              {isCompleted ? (
                <Check className="size-7" strokeWidth={3} />
              ) : isLocked ? (
                <Lock className="size-5" />
              ) : (
                <span className="pulse-metric">{number}</span>
              )}
            </span>

            <div
              className={cn(
                'min-w-0 flex-1 rounded-pulse-lg border p-4 transition-colors',
                isCurrent && 'border-pulse-indigo/60 bg-pulse-surface-2 shadow-[0_0_0_1px_var(--pulse-indigo)]',
                isCompleted && 'border-pulse-border-subtle bg-pulse-surface-1',
                isLocked && 'border-pulse-border-subtle bg-pulse-surface-1 opacity-70',
              )}
            >
              <div className="flex flex-wrap items-center gap-2">
                <span className="pulse-label">
                  Checkpoint <span className="pulse-metric">{number}</span>
                </span>
                <span className="sr-only">
                  {isCompleted ? 'Completed.' : isCurrent ? 'Unlocked, up next.' : 'Locked.'}
                </span>
                {isCompleted && unit.firstTryAccuracyPct !== null ? (
                  <span className={cn('pulse-pill pulse-metric', scoreTone(unit.firstTryAccuracyPct))}>
                    {Math.round(unit.firstTryAccuracyPct)}% first try
                  </span>
                ) : null}
                <span className="ml-auto inline-flex items-center gap-1 text-xs text-pulse-muted">
                  <Clock aria-hidden className="size-3.5" />
                  <span className="pulse-metric">{unit.estimatedMinutes}</span> mins
                </span>
              </div>
              <h3 className={cn('mt-1 font-semibold', isLocked ? 'text-pulse-muted' : 'text-pulse-primary')}>
                {unit.title}
              </h3>
              <p className="mt-0.5 text-sm text-pulse-muted">{unit.summary}</p>

              <div className="mt-3 flex flex-wrap gap-2">
                {isCurrent ? (
                  <Link href={unitHref(unit.id)} className="pulse-btn pulse-btn-primary">
                    Start Checkpoint
                    <ArrowRight aria-hidden className="size-4" />
                    <span className="pulse-metric font-normal opacity-80">{unit.estimatedMinutes} mins</span>
                  </Link>
                ) : null}
                {isCompleted ? (
                  <Link href={unitHref(unit.id)} className="pulse-btn">
                    <RotateCcw aria-hidden className="size-4" />
                    Practice Again
                  </Link>
                ) : null}
                {isLocked && staffAccess ? (
                  <Link href={unitHref(unit.id)} className="pulse-btn pulse-btn-ghost text-pulse-muted">
                    Open as Staff
                    <ArrowRight aria-hidden className="size-4" />
                  </Link>
                ) : null}
                {isLocked && !staffAccess ? (
                  <span className="text-xs text-pulse-muted">Complete Checkpoint {number - 1} to unlock.</span>
                ) : null}
              </div>
            </div>
          </li>
        );
      })}

      <li className="relative flex items-start gap-4">
        <span
          aria-hidden
          className={cn(
            'relative z-[1] grid size-14 shrink-0 place-items-center rounded-2xl border-4',
            certified
              ? 'border-pulse-emerald bg-pulse-emerald text-[#04140e]'
              : simUnlocked
                ? 'pulse-ring border-pulse-indigo bg-pulse-indigo text-white'
                : 'border-pulse-border bg-pulse-surface-2 text-pulse-muted',
          )}
        >
          {certified ? <Trophy className="size-6" /> : simUnlocked ? <Headset className="size-6" /> : <Lock className="size-5" />}
        </span>

        <div
          className={cn(
            'min-w-0 flex-1 rounded-pulse-lg border p-4',
            simUnlocked ? 'border-pulse-indigo/40 bg-pulse-surface-2' : 'border-pulse-border-subtle bg-pulse-surface-1 opacity-80',
          )}
        >
          <div className="flex flex-wrap items-center gap-2">
            <span className="pulse-label">Capstone</span>
            {certified ? (
              <span className="pulse-pill pulse-pill-emerald">
                <Award aria-hidden className="size-3.5" />
                Campaign Certified
              </span>
            ) : null}
          </div>
          <h3 className="mt-1 flex items-center gap-2 font-semibold text-pulse-primary">
            <Headset aria-hidden className="size-4 text-pulse-indigo" />
            Live Call Sim
          </h3>
          <p className="mt-0.5 text-sm text-pulse-muted">
            {simUnlocked
              ? 'Handle a realistic caller in your own words, then log the disposition. Pass one scenario to earn Campaign Certified.'
              : 'Unlocks when every Checkpoint is complete. Pass one scenario to earn Campaign Certified.'}
          </p>

          {scenarios.length === 0 ? (
            <p className="mt-3 text-sm text-pulse-muted">No Live Call Sim scenarios in this Track yet.</p>
          ) : (
            <ul className="mt-3 flex flex-col gap-2">
              {scenarios.map((scenario) => (
                <li
                  key={scenario.id}
                  className="flex flex-wrap items-center gap-3 rounded-pulse-md border border-pulse-border-subtle bg-pulse-bg px-3 py-2.5"
                >
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-semibold text-pulse-primary">{scenario.title}</p>
                    <div className="mt-1 flex flex-wrap items-center gap-2">
                      <DifficultyBadge difficulty={scenario.difficulty} />
                      <span className="text-xs text-pulse-muted">{scenario.counterpartyRoleLabel}</span>
                    </div>
                  </div>
                  <div className="text-right">
                    <p className="pulse-label">Best</p>
                    <p
                      className={cn(
                        'pulse-metric text-sm font-semibold',
                        scenario.bestScorePct === null
                          ? 'text-pulse-muted'
                          : scenario.passed
                            ? 'text-pulse-emerald'
                            : 'text-pulse-amber',
                      )}
                    >
                      {scenario.bestScorePct === null ? '—' : `${Math.round(scenario.bestScorePct)}%`}
                      {scenario.passed ? <Check aria-label="passed" className="ml-1 inline size-3.5" /> : null}
                    </p>
                  </div>
                  {simUnlocked ? (
                    <Link href={simHref(scenario.id)} className="pulse-btn pulse-btn-primary">
                      {scenario.bestScorePct === null ? 'Start' : 'Retry'}
                      <ArrowRight aria-hidden className="size-4" />
                    </Link>
                  ) : (
                    <span className="pulse-btn pointer-events-none opacity-50" aria-hidden>
                      <Lock className="size-4" />
                    </span>
                  )}
                </li>
              ))}
            </ul>
          )}
        </div>
      </li>
    </ol>
  );
}
