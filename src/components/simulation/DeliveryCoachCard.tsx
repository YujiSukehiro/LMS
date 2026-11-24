'use client';

import { AudioLines, LoaderCircle, Lightbulb, Sparkles } from 'lucide-react';
import { DELIVERY_DIMENSION_LABELS, type DeliveryAssessment } from '@/lib/schemas/delivery';
import { cn } from '@/lib/utils';

export type DeliveryCoachState =
  | { status: 'loading' }
  | { status: 'ready'; delivery: DeliveryAssessment }
  | { status: 'error'; message: string };

function barTone(score: number): string {
  if (score >= 4) return 'bg-pulse-emerald';
  if (score >= 3) return 'bg-pulse-amber';
  return 'bg-pulse-crimson';
}

/** Coaching-only delivery score from the agent's spoken audio. Never part of pass/fail. */
export function DeliveryCoachCard({ state }: { state: DeliveryCoachState }) {
  return (
    <section aria-labelledby="delivery-coach-heading" className="pulse-card flex flex-col gap-3 p-4">
      <div className="flex items-start justify-between gap-3">
        <div className="flex items-start gap-2.5">
          <span className="grid size-9 shrink-0 place-items-center rounded-xl bg-pulse-indigo/15 text-pulse-indigo">
            <AudioLines aria-hidden className="size-4" />
          </span>
          <div>
            <h2 id="delivery-coach-heading" className="text-base font-semibold">
              How you sounded
            </h2>
            <p className="text-xs text-pulse-muted">Delivery coaching from your voice. It does not change your score or pass.</p>
          </div>
        </div>
        {state.status === 'ready' ? (
          <span className="pulse-metric text-2xl font-bold" aria-label={`Delivery score ${state.delivery.overallScore} out of 100`}>
            {state.delivery.overallScore}
            <span className="text-sm font-medium text-pulse-muted">/100</span>
          </span>
        ) : null}
      </div>

      {state.status === 'loading' ? (
        <p role="status" className="flex items-center gap-2 text-sm text-pulse-secondary">
          <LoaderCircle aria-hidden className="size-4 animate-spin" /> Listening to your replies…
        </p>
      ) : null}

      {state.status === 'error' ? <p className="text-sm text-pulse-amber">{state.message}</p> : null}

      {state.status === 'ready' ? (
        <>
          <p className="text-sm leading-relaxed text-pulse-secondary">{state.delivery.summary}</p>
          <ul className="flex flex-col gap-2.5">
            {state.delivery.dimensions.map((d) => (
              <li key={d.key} className="flex flex-col gap-1">
                <div className="flex items-center justify-between gap-2 text-sm">
                  <span className="font-medium">{DELIVERY_DIMENSION_LABELS[d.key]}</span>
                  <span className="pulse-metric text-pulse-secondary">{d.score}/5</span>
                </div>
                <div className="h-1.5 overflow-hidden rounded-full bg-pulse-surface-2" aria-hidden>
                  <div className={cn('h-full rounded-full', barTone(d.score))} style={{ width: `${(d.score / 5) * 100}%` }} />
                </div>
                {d.note ? <p className="text-xs text-pulse-muted">{d.note}</p> : null}
              </li>
            ))}
          </ul>
          {state.delivery.strengths.length > 0 ? (
            <div>
              <p className="pulse-label mb-1 flex items-center gap-1.5">
                <Sparkles aria-hidden className="size-3.5" /> What worked
              </p>
              <ul className="list-disc pl-5 text-sm text-pulse-secondary">
                {state.delivery.strengths.map((s) => (
                  <li key={s}>{s}</li>
                ))}
              </ul>
            </div>
          ) : null}
          {state.delivery.coachingTips.length > 0 ? (
            <div>
              <p className="pulse-label mb-1 flex items-center gap-1.5">
                <Lightbulb aria-hidden className="size-3.5" /> Try next time
              </p>
              <ul className="list-disc pl-5 text-sm text-pulse-secondary">
                {state.delivery.coachingTips.map((t) => (
                  <li key={t}>{t}</li>
                ))}
              </ul>
            </div>
          ) : null}
          <p className="text-xs text-pulse-muted">
            Based on {state.delivery.spokenTurns} spoken {state.delivery.spokenTurns === 1 ? 'reply' : 'replies'} (
            {Math.round(state.delivery.spokenSeconds)} s). Typed replies are not included. Your audio is not saved.
          </p>
        </>
      ) : null}
    </section>
  );
}
