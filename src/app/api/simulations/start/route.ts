import { randomUUID } from 'node:crypto';
import { NextResponse } from 'next/server';
import { jsonError, requireAuth } from '@/lib/firebase/auth-guard';
import { SimSessionDocSchema, type SimSessionDoc } from '@/lib/schemas/analytics';
import { StartSimRequestSchema } from '@/lib/schemas/api';
import { ensureEnrollment, hasCompletedAllUnits } from '@/lib/services/analytics-rollup';
import { errorResponse, parseJsonBody, startOfUtcDay } from '@/lib/services/route-helpers';
import {
  createSimulationProvenance,
  maxSimSessionsPerDay,
  simSessionsCollection,
} from '@/lib/services/simulation-engine';
import { loadLearnerTrackContext, loadSecretScenario } from '@/lib/services/track-loader';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * Count the user's Simulation sessions started today (UTC).
 * Uses the existing (partnerCohortId ASC, startedAt DESC) composite index and filters by user in memory.
 */
async function countSessionsStartedToday(uid: string, partnerCohortId: string, nowMs: number): Promise<number> {
  const snap = await simSessionsCollection()
    .where('partnerCohortId', '==', partnerCohortId)
    .where('startedAt', '>=', startOfUtcDay(nowMs))
    .orderBy('startedAt', 'desc')
    .select('userId')
    .get();
  return snap.docs.filter((d) => d.get('userId') === uid).length;
}

/**
 * POST /api/simulations/start
 * Creates a Live Call Sim session seeded with the scenario's opening message.
 */
export async function POST(req: Request): Promise<NextResponse> {
  const auth = await requireAuth(req);
  if (!auth.ok) return auth.response;
  const { user } = auth;

  const body = await parseJsonBody(req, StartSimRequestSchema);
  if (!body.ok) return body.response;
  const { trackId, versionId, scenarioId } = body.data;

  try {
    const { track, version, versionId: resolvedVersionId, isDraft } = await loadLearnerTrackContext(
      user,
      trackId,
      versionId,
    );

    const scenario = version.simScenarios.find((s) => s.id === scenarioId);
    if (!scenario) return jsonError(404, 'SCENARIO_NOT_FOUND', 'This Simulation does not exist in the Track.');

    const secret = await loadSecretScenario(trackId, resolvedVersionId, scenarioId);
    if (!secret) {
      return jsonError(409, 'SIM_NOT_READY', 'This Simulation is not configured yet. Contact a Trainer.');
    }

    const now = Date.now();
    const limit = maxSimSessionsPerDay();
    const startedToday = await countSessionsStartedToday(user.uid, user.partnerCohortId, now);
    if (startedToday >= limit) {
      return jsonError(
        429,
        'SIM_DAILY_LIMIT',
        `You started the maximum of ${limit} Simulations today. Try again tomorrow (UTC).`,
      );
    }

    if (!isDraft) {
      const enrollment = await ensureEnrollment({ user, track, version });
      if (!hasCompletedAllUnits(enrollment, version)) {
        return jsonError(403, 'UNITS_INCOMPLETE', 'Complete every Unit in this Track to unlock the Simulation.');
      }
    }

    const ref = simSessionsCollection().doc();
    const session: SimSessionDoc = SimSessionDocSchema.parse({
      id: ref.id,
      userId: user.uid,
      userDisplayName: user.displayName,
      partnerCohortId: user.partnerCohortId,
      divisionId: track.divisionId,
      trackId: track.id,
      versionId: resolvedVersionId,
      scenarioId: scenario.id,
      scenarioTitle: scenario.title,
      status: 'ACTIVE',
      turnCount: 0,
      messages: [
        {
          id: randomUUID(),
          role: 'counterparty',
          content: scenario.openingMessage,
          createdAt: now,
        },
      ],
      selectedDisposition: null,
      evaluation: null,
      provenance: createSimulationProvenance({ task: 'session' }),
      startedAt: now,
      updatedAt: now,
    });
    await ref.set(session);

    return NextResponse.json({ session }, { status: 201 });
  } catch (error) {
    return errorResponse(error, 'simulations/start');
  }
}
