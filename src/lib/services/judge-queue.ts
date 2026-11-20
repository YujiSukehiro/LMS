import type { SimSessionDoc } from '@/lib/schemas/analytics';

/** One "a Trainer will score it" call, as the Team Progress queue lists it (no transcript, no secrets). */
export interface AwaitingJudgeRow {
  sessionId: string;
  learnerName: string;
  partnerCohortId: string;
  trackId: string;
  scenarioTitle: string;
  reason: NonNullable<SimSessionDoc['judgeReview']>['reason'];
  requestedAt: number;
  selectedDisposition: string | null;
}

/** Calls still waiting for a manual score, oldest first. Already-evaluated sessions are skipped even if the flag lingers. */
export function awaitingJudgeRows(sessions: readonly SimSessionDoc[]): AwaitingJudgeRow[] {
  return sessions
    .filter((session) => session.judgeReview?.status === 'awaiting_manual_judge' && session.status === 'READY_FOR_EVAL' && !session.evaluation)
    .map((session) => ({
      sessionId: session.id,
      learnerName: session.userDisplayName,
      partnerCohortId: session.partnerCohortId,
      trackId: session.trackId,
      scenarioTitle: session.scenarioTitle,
      reason: session.judgeReview!.reason,
      requestedAt: session.judgeReview!.requestedAt,
      selectedDisposition: session.selectedDisposition,
    }))
    .sort((a, b) => a.requestedAt - b.requestedAt);
}
