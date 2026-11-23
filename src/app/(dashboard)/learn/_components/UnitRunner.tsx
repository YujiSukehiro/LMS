'use client';

import { useCallback, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import { ArrowRight, BookOpen, Eye, Headset, LoaderCircle, Map as MapIcon, RotateCcw, Swords, Trophy, TriangleAlert, X } from 'lucide-react';
import { BriefingDeck } from '@/components/learn/BriefingDeck';
import { DrillRunner, type DrillRunnerProgress } from '@/components/learn/DrillRunner';
import { createIdempotencyKey } from '@/components/learn/drill-shared';
import { SegmentedProgress, type SegmentState } from '@/components/learn/SegmentedProgress';
import { CompleteUnitResponseSchema, type CompleteUnitRequest, type DrillResult } from '@/lib/schemas/api';
import type { CompetencyPillar, TrackUnit } from '@/lib/schemas/curriculum';
import type { LearnerDrill } from '@/lib/schemas/learning';
import { XP_RULES } from '@/lib/schemas/constants';
import { cn } from '@/lib/utils';
import { TRAINING_POLICY } from '@/lib/policy/training-policy';
import { describeApiError, describeNetworkError } from '../_lib/api-errors';
import { checkpointScoreLine, type DrillRoundSummary } from '@/components/learn/round-score';

export type LearnerUnit = Omit<TrackUnit, 'drills'> & { drills: LearnerDrill[] };

export interface UnitRunnerProps {
  trackId: string;
  trackTitle: string;
  campaignCode: string;
  versionId: string;
  isPreview: boolean;
  unit: LearnerUnit;
  unitNumber: number;
  unitCount: number;
  pillars: CompetencyPillar[];
  seed: string;
  mapHref: string;
  nextUnitHref: string | null;
  simHref: string | null;
}

type Phase = 'briefing' | 'drills' | 'saving' | 'saveError' | 'complete';

interface Outcome {
  accuracyPct: number;
  firstTryCorrect: number;
  total: number;
  xpAwarded: number | null;
  /** Checkpoints done on this Track after saving, or null when unknown (preview, save error). */
  checkpointsDone: number | null;
  certified: boolean;
  /** This sitting's score; shown instead of first-try accuracy on a replay. */
  round: DrillRoundSummary | null;
}

function localOutcome(results: DrillResult[]): Omit<Outcome, 'xpAwarded' | 'checkpointsDone' | 'certified' | 'round'> {
  const firstTryCorrect = results.filter((r) => r.passedFirstTry).length;
  const total = results.length;
  return { firstTryCorrect, total, accuracyPct: total === 0 ? 100 : Math.round((firstTryCorrect / total) * 100) };
}

function estimateXp(results: DrillResult[]): number {
  const correct = results.filter((r) => r.passedFirstTry).length;
  return (
    correct * XP_RULES.perFirstTryCorrectDrill +
    (results.length - correct) * XP_RULES.perRecoveredDrill +
    XP_RULES.unitCompletionBonus
  );
}

/** Client runner for one Checkpoint: BriefingDeck -> DrillRunner (with recovery) -> save -> completion screen. */
export function UnitRunner({
  trackId,
  trackTitle,
  campaignCode,
  versionId,
  isPreview,
  unit,
  unitNumber,
  unitCount,
  pillars,
  seed,
  mapHref,
  nextUnitHref,
  simHref,
}: UnitRunnerProps) {
  const [phase, setPhase] = useState<Phase>('briefing');
  const [cardIndex, setCardIndex] = useState(0);
  const [drillProgress, setDrillProgress] = useState<DrillRunnerProgress | null>(null);
  const [results, setResults] = useState<DrillResult[] | null>(null);
  const roundRef = useRef<DrillRoundSummary | null>(null);
  const [outcome, setOutcome] = useState<Outcome | null>(null);
  const [saveError, setSaveError] = useState<string | null>(null);
  const completionKeyRef = useRef<string | null>(null);
  if (completionKeyRef.current === null) completionKeyRef.current = createIdempotencyKey();

  const segments = useMemo<SegmentState[]>(() => {
    const cards: SegmentState[] = unit.briefingCards.map((_, index) => {
      if (phase !== 'briefing') return 'done';
      if (index < cardIndex) return 'done';
      return index === cardIndex ? 'current' : 'pending';
    });
    const drills: SegmentState[] =
      phase === 'briefing'
        ? unit.drills.map(() => 'pending')
        : (drillProgress?.segments ?? unit.drills.map((_, index) => (index === 0 ? 'current' : 'pending')));
    return [...cards, ...drills];
  }, [unit.briefingCards, unit.drills, phase, cardIndex, drillProgress]);

  const save = useCallback(
    async (drillResults: DrillResult[]) => {
      const local = { ...localOutcome(drillResults), round: roundRef.current };
      if (isPreview) {
        setOutcome({ ...local, xpAwarded: null, checkpointsDone: null, certified: false });
        setPhase('complete');
        return;
      }
      setPhase('saving');
      setSaveError(null);
      const body: CompleteUnitRequest = {
        trackId,
        versionId,
        unitId: unit.id,
        idempotencyKey: completionKeyRef.current ?? createIdempotencyKey(),
      };
      try {
        const response = await fetch('/api/progress/complete-unit', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(body),
        });
        if (!response.ok) {
          setSaveError(await describeApiError(response, 'progress'));
          setPhase('saveError');
          return;
        }
        const parsed = CompleteUnitResponseSchema.safeParse(await response.json());
        if (!parsed.success) {
          setSaveError('Your progress was sent, but the server reply was not readable. Open the Track Map to confirm it saved.');
          setPhase('saveError');
          return;
        }
        setOutcome({
          ...local,
          xpAwarded: parsed.data.xpAwarded,
          checkpointsDone: parsed.data.enrollment.completedUnitIds.length,
          certified: parsed.data.enrollment.status === 'CERTIFIED' &&
            parsed.data.enrollment.certificationEvidenceLabel === 'current_verified',
        });
        setPhase('complete');
      } catch (error) {
        setSaveError(describeNetworkError(error));
        setPhase('saveError');
      }
    },
    [isPreview, trackId, versionId, unit.id],
  );

  const onDrillsComplete = useCallback(
    (drillResults: DrillResult[], round: DrillRoundSummary) => {
      roundRef.current = round;
      setResults(drillResults);
      void save(drillResults);
    },
    [save],
  );

  const showRunner = phase === 'briefing' || phase === 'drills';

  return (
    <div className="mx-auto flex w-full max-w-3xl flex-col gap-5 pb-16">
      <div className="flex items-center gap-3">
        <Link
          href={mapHref}
          className="pulse-btn pulse-btn-ghost size-9 min-h-0 shrink-0 p-0"
          aria-label="Leave Checkpoint and return to the Track Map"
        >
          <X aria-hidden className="size-5" />
        </Link>
        <SegmentedProgress
          segments={segments}
          streak={phase === 'drills' ? (drillProgress?.streak ?? 0) : 0}
          className="flex-1"
        />
      </div>

      <div className="flex flex-wrap items-center gap-2 text-sm">
        {campaignCode ? (
          <span className="pulse-metric rounded-pulse-sm border border-pulse-border bg-pulse-bg px-1.5 py-0.5 text-xs font-semibold">
            {campaignCode}
          </span>
        ) : null}
        <span className="truncate text-pulse-muted">{trackTitle}</span>
        <span className="text-pulse-border">/</span>
        <span className="font-semibold text-pulse-primary">
          Checkpoint <span className="pulse-metric">{unitNumber}</span> of <span className="pulse-metric">{unitCount}</span>:{' '}
          {unit.title}
        </span>
        {isPreview ? (
          <span className="pulse-pill pulse-pill-amber ml-auto">
            <Eye aria-hidden className="size-3.5" /> Preview
          </span>
        ) : null}
      </div>

      {showRunner ? (
        <p className="pulse-label flex items-center gap-2">
          {phase === 'briefing' ? (
            <>
              <BookOpen aria-hidden className="size-3.5" /> Phase 1 · Briefing
            </>
          ) : (
            <>
              <Swords aria-hidden className="size-3.5" /> Phase 2 · Mastery Drills
            </>
          )}
          <span className="ml-auto hidden normal-case tracking-normal text-pulse-muted sm:inline">
            {phase === 'briefing' ? '← → or Enter to move · Space for citation' : '1–4 to pick · Enter to check'}
          </span>
        </p>
      ) : null}

      {phase === 'briefing' ? (
        <BriefingDeck
          cards={unit.briefingCards}
          onIndexChange={setCardIndex}
          onComplete={() => setPhase('drills')}
          completeLabel="Start Drills"
        />
      ) : null}

      {phase === 'drills' ? (
        <DrillRunner
          drills={unit.drills}
          pillars={pillars}
          seed={seed}
          trackId={trackId}
          versionId={versionId}
          unitId={unit.id}
          onComplete={onDrillsComplete}
          onProgress={setDrillProgress}
          hideProgress
        />
      ) : null}

      {phase === 'saving' ? (
        <div role="status" className="pulse-card-elevated flex flex-col items-center gap-3 p-10 text-center">
          <LoaderCircle aria-hidden className="size-8 animate-spin text-pulse-indigo" />
          <p className="font-semibold">Saving your Checkpoint results…</p>
        </div>
      ) : null}

      {phase === 'saveError' ? (
        <div role="alert" className="pulse-card-elevated flex flex-col items-center gap-4 p-8 text-center">
          <TriangleAlert aria-hidden className="size-8 text-pulse-amber" />
          <div>
            <p className="text-lg font-bold">Your results are not saved yet</p>
            <p className="mt-1 text-sm text-pulse-secondary">{saveError}</p>
          </div>
          <div className="flex flex-wrap justify-center gap-2">
            <Link href={mapHref} className="pulse-btn">
              <MapIcon aria-hidden className="size-4" /> Back to Track Map
            </Link>
            {results ? (
              <button type="button" className="pulse-btn pulse-btn-primary" onClick={() => void save(results)}>
                <RotateCcw aria-hidden className="size-4" /> Try Again
              </button>
            ) : null}
          </div>
        </div>
      ) : null}

      {phase === 'complete' && outcome ? (
        <CompletionPanel
          outcome={outcome}
          isPreview={isPreview}
          estimatedXp={results ? estimateXp(results) : 0}
          unitNumber={unitNumber}
          unitCount={unitCount}
          mapHref={mapHref}
          nextUnitHref={nextUnitHref}
          simHref={simHref}
        />
      ) : null}
    </div>
  );
}

function CompletionPanel({
  outcome,
  isPreview,
  estimatedXp,
  unitNumber,
  unitCount,
  mapHref,
  nextUnitHref,
  simHref,
}: {
  outcome: Outcome;
  isPreview: boolean;
  estimatedXp: number;
  unitNumber: number;
  unitCount: number;
  mapHref: string;
  nextUnitHref: string | null;
  simHref: string | null;
}) {
  const score = checkpointScoreLine(outcome, outcome.round);
  const accuracyTone =
    score.pct >= 85 ? 'text-pulse-emerald' : score.pct >= 70 ? 'text-pulse-amber' : 'text-pulse-crimson';
  return (
    <section
      aria-labelledby="checkpoint-complete-heading"
      className="pulse-card-elevated pulse-slide-up flex flex-col items-center gap-6 p-8 text-center"
    >
      <span className="grid size-16 place-items-center rounded-full bg-pulse-emerald text-pulse-on-emerald">
        <Trophy aria-hidden className="size-8" />
      </span>
      <div>
        <h2 id="checkpoint-complete-heading" className="text-2xl font-bold">
          Checkpoint <span className="pulse-metric">{unitNumber}</span> Complete
        </h2>
        <p className="mt-1 text-sm text-pulse-secondary">You cleared every missed concept. Nice work.</p>
      </div>

      <dl className="grid w-full max-w-md grid-cols-2 gap-3">
        <div className="rounded-pulse-md border border-pulse-border-subtle bg-pulse-surface-1 p-4">
          <dt className="pulse-label">{score.label}</dt>
          <dd className={cn('pulse-metric mt-1 text-3xl font-bold', accuracyTone)}>{score.pct}%</dd>
          <dd className="pulse-metric text-xs text-pulse-muted">{score.detail}</dd>
        </div>
        <div className="rounded-pulse-md border border-pulse-border-subtle bg-pulse-surface-1 p-4">
          <dt className="pulse-label">{isPreview ? 'XP (estimate)' : 'XP Awarded'}</dt>
          <dd className="pulse-metric mt-1 text-3xl font-bold text-pulse-amber">
            +{isPreview ? estimatedXp : (outcome.xpAwarded ?? 0)}
          </dd>
          {outcome.checkpointsDone !== null ? (
            <dd className="pulse-metric text-xs text-pulse-muted">
              Checkpoint {Math.min(outcome.checkpointsDone, unitCount)} of {unitCount} done
            </dd>
          ) : null}
        </div>
      </dl>

      {isPreview ? (
        <p className="flex items-center gap-2 rounded-pulse-md border border-pulse-amber/40 bg-pulse-amber/10 px-3 py-2 text-sm text-pulse-amber">
          <Eye aria-hidden className="size-4 shrink-0" />
          Preview only — progress not recorded.
        </p>
      ) : null}
      {outcome.certified ? (
        <p className="pulse-pill pulse-pill-emerald">
          <Trophy aria-hidden className="size-3.5" /> Campaign Certified
        </p>
      ) : null}

      <div className="flex flex-wrap justify-center gap-2">
        <Link href={mapHref} className="pulse-btn">
          <MapIcon aria-hidden className="size-4" /> Back to Track Map
        </Link>
        {nextUnitHref ? (
          <Link href={nextUnitHref} className="pulse-btn pulse-btn-primary" autoFocus>
            Next Checkpoint <ArrowRight aria-hidden className="size-4" />
          </Link>
        ) : simHref ? (
          <Link href={simHref} className="pulse-btn pulse-btn-primary" autoFocus>
            <Headset aria-hidden className="size-4" />{' '}
            {TRAINING_POLICY.simulationInteractionMode === 'verbal_only'
              ? 'Go to Verbal Practice'
              : 'Go to Live Call Sim'}
          </Link>
        ) : null}
      </div>
    </section>
  );
}
