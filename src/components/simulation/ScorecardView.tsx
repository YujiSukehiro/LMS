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
} from 'lucide-react';
import type { SimEvaluation } from '@/lib/schemas/analytics';
import { cn } from '@/lib/utils';
import { ScoreGauge, type ScoreTone } from './ScoreGauge';

export interface ScorecardViewProps {
  evaluation: SimEvaluation;
  certified: boolean;
  passThreshold: number;
  selectedDisposition?: string | null;
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

/** AI coach scorecard shown after a Live Call Sim is evaluated. */
export function ScorecardView({
  evaluation,
  certified,
  passThreshold,
  selectedDisposition,
  pillarLabels,
  onRetry,
  backHref,
  backLabel = 'Back to Track Map',
}: ScorecardViewProps) {
  const score = Math.round(evaluation.overallScorePct);
  const autoFailed = Boolean(evaluation.autoFailedReason);
  const tone: ScoreTone = evaluation.passed ? 'emerald' : autoFailed ? 'crimson' : 'amber';
  const status = evaluation.passed ? (certified ? 'PASSED & CERTIFIED' : 'PASSED') : 'RETRY RECOMMENDED';
  const toneText = tone === 'emerald' ? 'text-pulse-emerald' : tone === 'crimson' ? 'text-pulse-crimson' : 'text-pulse-amber';

  return (
    <section aria-label="Simulation scorecard" className="pulse-cq flex flex-col gap-5">
      <div className="pulse-card-elevated flex flex-col items-center gap-6 p-6 @2xl:flex-row @2xl:items-center">
        <ScoreGauge scorePct={score} tone={tone} statusLabel={status} thresholdPct={passThreshold} />
        <div className="min-w-0 flex-1 text-center @2xl:text-left">
          <p className={cn('pulse-metric text-2xl font-bold', toneText)} aria-live="polite">
            {score}% — {status}
          </p>
          <p className="mt-1 text-xs text-pulse-muted">
            Pass threshold <span className="pulse-metric">{passThreshold}%</span>
          </p>
          {certified ? (
            <p className="pulse-pill pulse-pill-emerald mt-3">
              <Award aria-hidden className="size-3.5" />
              Campaign Certified
            </p>
          ) : null}
          <p className="mt-3 text-sm leading-relaxed text-pulse-secondary">{evaluation.summaryFeedback}</p>
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
        </div>
      </div>

      {autoFailed ? (
        <div role="alert" className="flex gap-3 rounded-pulse-lg border border-pulse-crimson/50 bg-pulse-crimson/10 p-4">
          <OctagonAlert aria-hidden className="mt-0.5 size-5 shrink-0 text-pulse-crimson" />
          <div>
            <p className="font-bold text-pulse-crimson">Automatic Fail: critical Playbook rule broken</p>
            <p className="mt-1 text-sm text-pulse-primary">{evaluation.autoFailedReason}</p>
          </div>
        </div>
      ) : null}

      {evaluation.strengthsHighlighted.length > 0 || evaluation.coachingImprovements.length > 0 ? (
        <div className="grid gap-4 @2xl:grid-cols-2">
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
        <h3 className="pulse-label mb-3">Criterion-by-Criterion Breakdown</h3>
        <ol className="flex flex-col gap-3">
          {evaluation.criterionResults.map((criterion) => {
            const criterionScore = Number(criterion.score);
            const pillarLabel = pillarLabels?.[criterion.competencyPillarId];
            return (
              <li key={criterion.criterionId} className="pulse-card p-4">
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
                  <blockquote className="mt-3 flex gap-2 rounded-pulse-md border-l-2 border-pulse-border bg-pulse-bg px-3 py-2 text-sm italic text-pulse-secondary">
                    <MessageSquareQuote aria-hidden className="mt-0.5 size-4 shrink-0 not-italic text-pulse-muted" />
                    <span>&ldquo;{criterion.agentQuoteEvidence}&rdquo;</span>
                  </blockquote>
                ) : null}
                {criterion.coachingNote ? (
                  <p className="mt-3 text-sm leading-relaxed text-pulse-secondary">{criterion.coachingNote}</p>
                ) : null}
                {criterionScore < 100 && criterion.betterResponseExample ? (
                  <div className="mt-3 rounded-pulse-md border border-pulse-emerald/40 bg-pulse-emerald/10 p-3">
                    <p className="pulse-label flex items-center gap-1.5 text-pulse-emerald">
                      <Lightbulb aria-hidden className="size-3.5" /> Better Response Example
                    </p>
                    <p className="mt-1 text-sm text-pulse-primary">&ldquo;{criterion.betterResponseExample}&rdquo;</p>
                  </div>
                ) : null}
              </li>
            );
          })}
        </ol>
      </div>

      {onRetry || backHref ? (
        <div className="flex flex-wrap items-center justify-end gap-2">
          {backHref ? (
            <Link href={backHref} className="pulse-btn">
              <MapIcon aria-hidden className="size-4" />
              {backLabel}
            </Link>
          ) : null}
          {onRetry ? (
            <button type="button" className="pulse-btn pulse-btn-primary" onClick={onRetry}>
              <RotateCcw aria-hidden className="size-4" />
              Retry Simulation
            </button>
          ) : null}
        </div>
      ) : null}
    </section>
  );
}
