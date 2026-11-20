'use client';

import { useState } from 'react';
import { ClipboardCheck } from 'lucide-react';
import { ManualJudgeExchange } from '@/components/studio/ManualJudgeExchange';
import { cohortLabel, relativeTime } from '@/components/layout/labels';
import type { AwaitingJudgeRow } from '@/lib/services/judge-queue';

const REASON_LABELS: Record<AwaitingJudgeRow['reason'], string> = {
  ai_unavailable: 'AI coach unavailable',
  judge_output_invalid: 'AI coach answer was not usable',
  judge_timeout: 'AI coach timed out',
};

/** Team Progress (internal ops): calls the AI coach could not score, each with the manual judge export/import. */
export function AwaitingJudgeQueue({ rows, now }: { rows: AwaitingJudgeRow[]; now: number }) {
  const [openId, setOpenId] = useState<string | null>(null);
  if (rows.length === 0) return null;
  return (
    <section aria-labelledby="awaiting-judge-heading" className="pulse-card flex flex-col gap-3 p-4 md:p-5">
      <div className="flex items-center gap-2">
        <ClipboardCheck aria-hidden className="size-4 text-pulse-amber" />
        <h2 id="awaiting-judge-heading" className="text-base font-semibold">Calls waiting for a Trainer score</h2>
        <span className="pulse-pill pulse-pill-amber">{rows.length}</span>
      </div>
      <p className="text-xs text-pulse-muted">The AI coach could not score these calls. The learners were told a Trainer will. Export the judge package, then import the scored JSON.</p>
      <ul className="flex flex-col divide-y divide-pulse-border-subtle">
        {rows.map((row) => (
          <li key={row.sessionId} className="py-2.5">
            <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-sm">
              <span className="font-medium">{row.learnerName}</span>
              <span className="text-pulse-muted">{cohortLabel(row.partnerCohortId)}</span>
              <span className="min-w-0 flex-1 truncate">{row.scenarioTitle}</span>
              <span className="text-xs text-pulse-muted">{REASON_LABELS[row.reason]} · {relativeTime(row.requestedAt, now)}</span>
              <button
                type="button"
                className="pulse-btn px-2.5 py-1 text-xs"
                aria-expanded={openId === row.sessionId}
                onClick={() => setOpenId(openId === row.sessionId ? null : row.sessionId)}
              >
                {openId === row.sessionId ? 'Close' : 'Score this call'}
              </button>
            </div>
            {openId === row.sessionId ? (
              <div className="mt-3">
                <ManualJudgeExchange sessionId={row.sessionId} />
              </div>
            ) : null}
          </li>
        ))}
      </ul>
    </section>
  );
}
