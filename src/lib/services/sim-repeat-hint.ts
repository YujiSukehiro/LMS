/**
 * Hint after repeated fails on one practice (Connor 2026-11-26): an agent failed the same practice six times for the
 * same missed rule. After REPEAT_MISS_THRESHOLD fails in a row, the scorecard names the rule they keep missing.
 */
import { SimEvaluationSchema, type SimEvaluation } from '@/lib/schemas/analytics';
import { repeatMissHint, type RepeatMissHint } from './sim-session-limits';
import { simSessionsCollection } from './simulation-engine';

export async function loadRepeatMissHint(input: {
  uid: string;
  trackId: string;
  scenarioId: string;
  current: { sessionId: string; evaluation: SimEvaluation };
}): Promise<RepeatMissHint | null> {
  if (input.current.evaluation.passed) return null;
  const snap = await simSessionsCollection()
    .where('userId', '==', input.uid)
    .where('trackId', '==', input.trackId)
    .where('scenarioId', '==', input.scenarioId)
    .get();
  const earlier = snap.docs
    .filter((doc) => doc.id !== input.current.sessionId && doc.get('status') === 'EVALUATED' && doc.get('versionId') !== 'draft')
    .flatMap((doc) => {
      const parsed = SimEvaluationSchema.safeParse(doc.get('evaluation'));
      return parsed.success ? [parsed.data] : [];
    })
    .sort((a, b) => b.evaluatedAt - a.evaluatedAt);
  return repeatMissHint([input.current.evaluation, ...earlier]);
}
