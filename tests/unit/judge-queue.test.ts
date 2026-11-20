import { describe, expect, it, vi } from 'vitest';
import { FieldValue } from 'firebase-admin/firestore';

const { txUpdate } = vi.hoisted(() => ({ txUpdate: vi.fn() }));
vi.mock('@/lib/firebase/admin', () => ({
  adminDb: {
    collection: () => ({ doc: (id: string) => ({ id, collection: () => ({ doc: (eventId: string) => ({ id: eventId }) }) }) }),
    runTransaction: async (callback: (tx: unknown) => Promise<unknown>) =>
      callback({ get: async () => ({ exists: true, get: () => 'READY_FOR_EVAL', data: () => ({}) }), update: txUpdate, set: vi.fn() }),
  },
}));

import { awaitingJudgeRows } from '@/lib/services/judge-queue';
import { saveSimulationEvaluation } from '@/lib/services/analytics-rollup';
import { scenarioSession } from './helpers/learning-service-fixtures';

describe('Trainer queue of calls awaiting a manual score', () => {
  const waiting = (id: string, requestedAt: number) => scenarioSession({
    id, status: 'READY_FOR_EVAL', evaluation: null, judgeReview: { status: 'awaiting_manual_judge', reason: 'judge_timeout', requestedAt },
  });

  it('lists only unscored READY_FOR_EVAL calls, oldest first, without transcript content', () => {
    const rows = awaitingJudgeRows([
      waiting('late', 20),
      waiting('early', 10),
      // Scored after all (stale flag from before the fix): never listed.
      scenarioSession({ id: 'scored', status: 'EVALUATED', judgeReview: { status: 'awaiting_manual_judge', reason: 'ai_unavailable', requestedAt: 5 } }),
      scenarioSession({ id: 'normal', status: 'READY_FOR_EVAL', evaluation: null }),
    ]);
    expect(rows.map((row) => row.sessionId)).toEqual(['early', 'late']);
    expect(rows[0]).toMatchObject({ reason: 'judge_timeout', scenarioTitle: expect.any(String), learnerName: expect.any(String) });
    expect(JSON.stringify(rows)).not.toContain('messages');
  });
});

describe('evaluation clears the manual-judge flag', () => {
  it('removes judgeReview when the session is scored', async () => {
    const session = scenarioSession({ status: 'READY_FOR_EVAL', evaluation: null, judgeReview: { status: 'awaiting_manual_judge', reason: 'ai_unavailable', requestedAt: 1 } });
    await saveSimulationEvaluation({ sessionId: session.id, session, evaluation: scenarioSession().evaluation!, selectedDisposition: 'Recovered' });
    expect(txUpdate.mock.calls[0]![1]).toMatchObject({ status: 'EVALUATED', judgeReview: FieldValue.delete() });
  });
});
