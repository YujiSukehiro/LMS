import { ChevronRight, CircleCheck, CircleX, Quote } from 'lucide-react';
import type { SimSessionDoc } from '@/lib/schemas/analytics';
import { cn } from '@/lib/utils';
import { formatDate } from '@/components/layout/labels';

function scoreTone(score: number): string {
  if (score >= 100) return 'pulse-pill-emerald';
  if (score >= 50) return 'pulse-pill-amber';
  return 'pulse-pill-crimson';
}

/** Expandable Live Call Sim transcript with its evaluation scorecard (native <details>). */
export function SimTranscriptDetails({ session, trackTitle }: { session: SimSessionDoc; trackTitle: string }) {
  const evaluation = session.evaluation;
  const passed = evaluation?.passed ?? false;
  const isDemoReplay =
    session.provenance?.source === 'replay' ||
    evaluation?.provenance?.source === 'replay' ||
    session.messages.some((message) => message.provenance?.source === 'replay');
  return (
    <details className="group pulse-card overflow-hidden open:border-pulse-border">
      <summary className="flex cursor-pointer list-none flex-wrap items-center gap-3 px-4 py-3 hover:bg-pulse-surface-2/40 [&::-webkit-details-marker]:hidden">
        <ChevronRight aria-hidden className="size-4 shrink-0 text-pulse-muted transition-transform group-open:rotate-90" />
        <span className="min-w-0 flex-1">
          <span className="block truncate text-sm font-semibold">{session.scenarioTitle}</span>
          <span className="block truncate text-xs text-pulse-muted">
            {trackTitle} · {formatDate(session.startedAt)} · {session.turnCount} turns
            {session.versionId === 'draft' ? ' · Draft test-play' : ''}
            {isDemoReplay ? ' · Demo replay' : ''}
          </span>
        </span>
        {isDemoReplay ? <span className="pulse-pill pulse-pill-amber">Demo replay</span> : null}
        {evaluation ? (
          <span className={cn('pulse-pill pulse-metric', passed ? 'pulse-pill-emerald' : 'pulse-pill-amber')}>
            {passed ? <CircleCheck aria-hidden className="size-3.5" /> : <CircleX aria-hidden className="size-3.5" />}
            {Math.round(evaluation.overallScorePct)}% {passed ? 'Passed' : 'Retry'}
          </span>
        ) : null}
      </summary>

      {isDemoReplay ? (
        <p role="status" className="border-t border-pulse-amber/30 bg-pulse-amber/10 px-4 py-2 text-sm text-pulse-secondary">
          <span className="font-semibold text-pulse-amber">Demo replay:</span> transcript and scorecard are for inspection only;
          no progress, readiness, or certification credit is recorded.
        </p>
      ) : null}
      <div className="grid gap-4 border-t border-pulse-border-subtle p-4 xl:grid-cols-2">
        <div className="flex flex-col gap-2">
          <p className="pulse-label">Transcript</p>
          <ol className="flex max-h-[480px] flex-col gap-2 overflow-y-auto pr-1">
            {session.messages.map((message) => (
              <li
                key={message.id}
                className={cn(
                  'max-w-[88%] rounded-pulse-lg px-3 py-2 text-sm leading-relaxed',
                  message.role === 'agent'
                    ? 'self-end rounded-tr-sm bg-pulse-indigo/20 text-pulse-primary'
                    : 'self-start rounded-tl-sm bg-pulse-surface-2 text-pulse-secondary',
                )}
              >
                <span className="pulse-label mb-0.5 block text-[0.62rem]">{message.role === 'agent' ? 'Agent' : 'Caller'}</span>
                <span className="whitespace-pre-wrap">{message.content}</span>
              </li>
            ))}
          </ol>
          {session.selectedDisposition ? (
            <p className="text-xs text-pulse-muted">
              Disposition logged: <span className="font-semibold text-pulse-secondary">{session.selectedDisposition}</span>
              {evaluation ? (
                <span className={evaluation.dispositionCorrect ? 'text-pulse-emerald' : 'text-pulse-crimson'}>
                  {evaluation.dispositionCorrect ? ' (correct)' : ' (not correct)'}
                </span>
              ) : null}
            </p>
          ) : null}
        </div>

        {evaluation ? (
          <div className="flex flex-col gap-3">
            <p className="pulse-label">Evaluation scorecard</p>
            {evaluation.autoFailedReason ? (
              <p className="rounded-pulse-md border border-pulse-crimson/40 bg-pulse-crimson/10 px-3 py-2 text-sm text-pulse-crimson">
                Auto-fail: {evaluation.autoFailedReason}
              </p>
            ) : null}
            <p className="text-sm text-pulse-secondary">{evaluation.summaryFeedback}</p>
            <ul className="flex flex-col gap-2">
              {evaluation.criterionResults.map((criterion) => (
                <li key={criterion.criterionId} className="rounded-pulse-md border border-pulse-border-subtle p-3">
                  <div className="flex items-start justify-between gap-2">
                    <p className="text-sm font-semibold">{criterion.criterionLabel}</p>
                    <span className={cn('pulse-pill pulse-metric', scoreTone(Number(criterion.score)))}>
                      {Number(criterion.score)} / 100
                    </span>
                  </div>
                  {criterion.agentQuoteEvidence ? (
                    <p className="mt-2 flex gap-1.5 text-xs italic text-pulse-secondary">
                      <Quote aria-hidden className="size-3.5 shrink-0 text-pulse-muted" />
                      {criterion.agentQuoteEvidence}
                    </p>
                  ) : null}
                  {criterion.coachingNote ? <p className="mt-1.5 text-xs text-pulse-muted">{criterion.coachingNote}</p> : null}
                  {criterion.betterResponseExample ? (
                    <p className="mt-1.5 rounded-pulse-sm bg-pulse-emerald/10 px-2 py-1.5 text-xs text-pulse-emerald">
                      Stronger response: {criterion.betterResponseExample}
                    </p>
                  ) : null}
                </li>
              ))}
            </ul>
            {evaluation.strengthsHighlighted.length > 0 || evaluation.coachingImprovements.length > 0 ? (
              <div className="grid gap-3 sm:grid-cols-2">
                <div>
                  <p className="pulse-label mb-1 text-pulse-emerald">Strengths</p>
                  <ul className="list-disc space-y-0.5 pl-4 text-xs text-pulse-secondary">
                    {evaluation.strengthsHighlighted.map((s, i) => (
                      <li key={i}>{s}</li>
                    ))}
                  </ul>
                </div>
                <div>
                  <p className="pulse-label mb-1 text-pulse-amber">Coaching</p>
                  <ul className="list-disc space-y-0.5 pl-4 text-xs text-pulse-secondary">
                    {evaluation.coachingImprovements.map((s, i) => (
                      <li key={i}>{s}</li>
                    ))}
                  </ul>
                </div>
              </div>
            ) : null}
          </div>
        ) : null}
      </div>
    </details>
  );
}
