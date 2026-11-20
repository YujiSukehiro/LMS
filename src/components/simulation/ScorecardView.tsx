'use client';

import Link from 'next/link';
import {
  Award,
  CircleCheck,
  CircleX,
  Lightbulb,
  Map as MapIcon,
  MessageSquareQuote,
  OctagonAlert,
  RotateCcw,
  Sparkles,
  Target,
  TriangleAlert,
} from 'lucide-react';
import type { SimEvaluation } from '@/lib/schemas/analytics';
import { TRAINING_POLICY } from '@/lib/policy/training-policy';
import { cn } from '@/lib/utils';
import { ScoreGauge, type ScoreTone } from './ScoreGauge';

export interface ScorecardViewProps {
  evaluation: SimEvaluation;
  certified: boolean;
  passThreshold: number;
  selectedDisposition?: string | null;
  /** Explicit route marker; replay provenance also enables the label for historical viewers. */
  demoReplay?: boolean;
  /** CompetencyPillar id -> label, to label each criterion. */
  pillarLabels?: Record<string, string>;
  onRetry?: () => void;
  backHref?: string;
  backLabel?: string;
}

function scoreChipClass(score: number): string {
  if (score >= 100) return 'pulse-pill-emerald';
  if (score >= 50) return 'pulse-pill-amber';
  return 'pulse-pill-crimson';
}

/** Scorecard: score and status, then what to fix (lowest scores first), with the next action in the header. */
export function ScorecardView({
  evaluation,
  certified,
  passThreshold,
  selectedDisposition,
  demoReplay = false,
  pillarLabels,
  onRetry,
  backHref,
  backLabel = 'Back to Track Map',
}: ScorecardViewProps) {
  const score = Math.round(evaluation.overallScorePct);
  const eligibilityReasons =
    evaluation.assessmentEligibility && !evaluation.assessmentEligibility.eligible ? evaluation.assessmentEligibility.reasons : [];
  // Older evaluations stored eligibility reasons in autoFailedReason; those are not an automatic fail.
  const legacyEligibilityOnly =
    eligibilityReasons.length > 0 && evaluation.autoFailedReason === eligibilityReasons.join(' ');
  const autoFailed = Boolean(evaluation.autoFailedReason) && !legacyEligibilityOnly;
  const isDemoReplay = demoReplay || evaluation.provenance?.source === 'replay';
  // GATE-04: cloud-scored practice is coaching only unless Connor allows hosted AI to certify.
  const hostedNotCounted =
    !isDemoReplay && evaluation.provenance?.source === 'hosted_ai' && !TRAINING_POLICY.allowHostedAiForCertification;
  const tone: ScoreTone = evaluation.passed ? 'emerald' : autoFailed ? 'crimson' : 'amber';
  const status = isDemoReplay
    ? 'DEMO REPLAY'
    : evaluation.passed
      ? certified
        ? 'PASSED & CERTIFIED'
        : 'PASSED'
      : 'RETRY RECOMMENDED';
  const toneText = tone === 'emerald' ? 'text-pulse-emerald' : tone === 'crimson' ? 'text-pulse-crimson' : 'text-pulse-amber';
  const sortedCriteria = [...evaluation.criterionResults].sort((a, b) => Number(a.score) - Number(b.score));
  const missed = sortedCriteria.filter((criterion) => Number(criterion.score) < 100);
  const met = sortedCriteria.filter((criterion) => Number(criterion.score) >= 100);
  const retryPrimary = !evaluation.passed;
  const actions =
    onRetry || backHref ? (
      <div className="flex shrink-0 flex-wrap items-center justify-center gap-2 @2xl:flex-col @2xl:items-stretch">
        {onRetry ? (
          <button type="button" className={cn('pulse-btn', retryPrimary && 'pulse-btn-primary')} onClick={onRetry}>
            <RotateCcw aria-hidden className="size-4" />
            {retryPrimary ? 'Try again' : 'Practice again'}
          </button>
        ) : null}
        {backHref ? (
          <Link href={backHref} className={cn('pulse-btn', !retryPrimary && 'pulse-btn-primary')}>
            <MapIcon aria-hidden className="size-4" />
            {backLabel}
          </Link>
        ) : null}
      </div>
    ) : null;

  return (
    <section aria-label="Simulation scorecard" className="pulse-cq flex flex-col gap-3">
      {isDemoReplay ? (
        <div role="status" className="rounded-pulse-lg border border-pulse-amber/50 bg-pulse-amber/10 p-4">
          <p className="font-bold text-pulse-amber">Demo replay</p>
          <p className="mt-1 text-sm text-pulse-secondary">
            This scorecard is for inspection only. It does not count toward progress, readiness, or certification.
          </p>
        </div>
      ) : null}
      <div className="pulse-card flex flex-col items-center gap-4 p-4 @2xl:flex-row @2xl:items-center">
        <ScoreGauge scorePct={score} tone={tone} statusLabel={status} thresholdPct={passThreshold} size={116} />
        <div className="min-w-0 flex-1 text-center @2xl:text-left">
          <p className={cn('pulse-metric text-xl font-bold', toneText)} aria-live="polite">
            {score}% — {status}
          </p>
          <p className="mt-0.5 flex flex-wrap items-center justify-center gap-2 text-xs text-pulse-muted @2xl:justify-start">
            <span>
              Pass at <span className="pulse-metric">{passThreshold}%</span>
            </span>
            {missed.length > 0 ? (
              <span>
                · <span className="pulse-metric">{missed.length}</span> of{' '}
                <span className="pulse-metric">{evaluation.criterionResults.length}</span> criteria to improve
              </span>
            ) : null}
            {certified ? (
              <span className="pulse-pill pulse-pill-emerald">
                <Award aria-hidden className="size-3.5" />
                Certified
              </span>
            ) : null}
          </p>
          <p className="mt-2 text-sm leading-relaxed text-pulse-secondary">{evaluation.summaryFeedback}</p>
          {TRAINING_POLICY.simulationInteractionMode !== 'verbal_only' || TRAINING_POLICY.requireDispositionInVerbalPractice ? (
            <p
              className={cn(
                'mt-3 flex items-start justify-center gap-2 text-sm @2xl:justify-start',
                evaluation.dispositionCorrect ? 'text-pulse-emerald' : 'text-pulse-crimson',
              )}
            >
              {evaluation.dispositionCorrect ? (
                <CircleCheck aria-hidden className="mt-0.5 size-4 shrink-0" />
              ) : (
                <CircleX aria-hidden className="mt-0.5 size-4 shrink-0" />
              )}
              <span>
                Disposition{selectedDisposition ? ` “${selectedDisposition}”` : ''}:{' '}
                {evaluation.dispositionCorrect ? 'Correct' : 'Incorrect — review the disposition rules in the coaching notes below'}
              </span>
            </p>
          ) : null}
        </div>
        {actions}
      </div>

      {hostedNotCounted ? (
        <p role="note" className="flex items-start gap-2 rounded-pulse-md border border-pulse-border bg-pulse-surface-2 px-3 py-2 text-sm text-pulse-secondary">
          <TriangleAlert aria-hidden className="mt-0.5 size-4 shrink-0 text-pulse-amber" />
          This practice was scored by cloud AI, so it is coaching only and does not count toward certification yet. Ask your
          Trainer how certification is scored for this Track.
        </p>
      ) : null}

      {autoFailed ? (
        <div role="alert" className="flex gap-3 rounded-pulse-lg border border-pulse-crimson/50 bg-pulse-crimson/10 p-4">
          <OctagonAlert aria-hidden className="mt-0.5 size-5 shrink-0 text-pulse-crimson" />
          <div>
            <p className="font-bold text-pulse-crimson">Automatic Fail: critical Playbook rule broken</p>
            <p className="mt-1 text-sm text-pulse-primary">{evaluation.autoFailedReason}</p>
          </div>
        </div>
      ) : null}

      {eligibilityReasons.length > 0 ? (
        <div role="status" className="flex gap-3 rounded-pulse-lg border border-pulse-amber/50 bg-pulse-amber/10 p-4">
          <TriangleAlert aria-hidden className="mt-0.5 size-5 shrink-0 text-pulse-amber" />
          <div>
            <p className="font-bold text-pulse-amber">Not eligible to pass: required evidence missing</p>
            <ul className="mt-1 list-disc space-y-0.5 pl-4 text-sm text-pulse-primary">
              {eligibilityReasons.map((reason, index) => (
                <li key={index}>{reason}</li>
              ))}
            </ul>
          </div>
        </div>
      ) : null}

      {evaluation.strengthsHighlighted.length > 0 || evaluation.coachingImprovements.length > 0 ? (
        <div className="grid gap-3 @2xl:grid-cols-2">
          {evaluation.strengthsHighlighted.length > 0 ? (
            <div className="pulse-card p-4">
              <p className="pulse-label flex items-center gap-1.5 text-pulse-emerald">
                <Sparkles aria-hidden className="size-3.5" /> Strengths
              </p>
              <ul className="mt-2 space-y-1.5 text-sm text-pulse-secondary">
                {evaluation.strengthsHighlighted.map((item, index) => (
                  <li key={index} className="flex gap-2">
                    <CircleCheck aria-hidden className="mt-0.5 size-4 shrink-0 text-pulse-emerald" />
                    {item}
                  </li>
                ))}
              </ul>
            </div>
          ) : null}
          {evaluation.coachingImprovements.length > 0 ? (
            <div className="pulse-card p-4">
              <p className="pulse-label flex items-center gap-1.5 text-pulse-amber">
                <Target aria-hidden className="size-3.5" /> Focus Next Time
              </p>
              <ul className="mt-2 space-y-1.5 text-sm text-pulse-secondary">
                {evaluation.coachingImprovements.map((item, index) => (
                  <li key={index} className="flex gap-2">
                    <Target aria-hidden className="mt-0.5 size-4 shrink-0 text-pulse-amber" />
                    {item}
                  </li>
                ))}
              </ul>
            </div>
          ) : null}
        </div>
      ) : null}

      <div>
        <h3 className="pulse-label mb-2">{missed.length > 0 ? 'What to fix' : 'Every criterion met'}</h3>
        <ol className="flex flex-col gap-2">
          {missed.map((criterion) => {
            const criterionScore = Number(criterion.score);
            const pillarLabel = pillarLabels?.[criterion.competencyPillarId];
            return (
              <li key={criterion.criterionId} className="pulse-card p-3.5">
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <div className="min-w-0">
                    <p className="font-semibold text-pulse-primary">{criterion.criterionLabel}</p>
                    {pillarLabel ? <p className="mt-0.5 text-xs text-pulse-muted">{pillarLabel}</p> : null}
                  </div>
                  <span className={cn('pulse-pill pulse-metric', scoreChipClass(criterionScore))}>
                    {criterionScore} / 100
                  </span>
                </div>
                {criterion.agentQuoteEvidence ? (
                  <blockquote className="mt-2 flex gap-2 rounded-pulse-md border-l-2 border-pulse-border bg-pulse-bg px-3 py-2 text-sm italic text-pulse-secondary">
                    <MessageSquareQuote aria-hidden className="mt-0.5 size-4 shrink-0 not-italic text-pulse-muted" />
                    <span>&ldquo;{criterion.agentQuoteEvidence}&rdquo;</span>
                  </blockquote>
                ) : null}
                {criterion.coachingNote ? (
                  <p className="mt-2 text-sm leading-relaxed text-pulse-secondary">{criterion.coachingNote}</p>
                ) : null}
                {criterionScore < 100 && criterion.betterResponseExample ? (
                  <div className="mt-2 rounded-pulse-md border border-pulse-emerald/40 bg-pulse-emerald/10 px-3 py-2">
                    <p className="pulse-label flex items-center gap-1.5 text-pulse-emerald">
                      <Lightbulb aria-hidden className="size-3.5" /> Try saying
                    </p>
                    <p className="mt-1 text-sm text-pulse-primary">&ldquo;{criterion.betterResponseExample}&rdquo;</p>
                  </div>
                ) : null}
              </li>
            );
          })}
        </ol>
        {met.length > 0 ? (
          <details className="group mt-2 pulse-card px-3.5 py-2.5" open={missed.length === 0}>
            <summary className="flex cursor-pointer list-none items-center gap-2 text-sm font-medium text-pulse-secondary">
              <CircleCheck aria-hidden className="size-4 text-pulse-emerald" />
              <span className="pulse-metric">{met.length}</span> met
              <span className="text-xs font-normal text-pulse-muted group-open:hidden">· show</span>
            </summary>
            <ul className="mt-2 flex flex-col gap-1.5">
              {met.map((criterion) => (
                <li key={criterion.criterionId} className="text-sm">
                  <p className="font-medium text-pulse-primary">{criterion.criterionLabel}</p>
                  {criterion.coachingNote ? <p className="text-xs text-pulse-muted">{criterion.coachingNote}</p> : null}
                </li>
              ))}
            </ul>
          </details>
        ) : null}
      </div>

    </section>
  );
}
