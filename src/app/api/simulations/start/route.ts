import { randomUUID } from 'node:crypto';
import { SIM_COPY } from '@/lib/policy/training-policy';
import { NextResponse } from 'next/server';
import { jsonError, requireAuth } from '@/lib/firebase/auth-guard';
import { SimSessionDocSchema, type SimSessionDoc } from '@/lib/schemas/analytics';
import { StartSimRequestSchema } from '@/lib/schemas/api';
import { ensureEnrollment, hasCompletedAllUnits } from '@/lib/services/analytics-rollup';
import { errorResponse, parseJsonBody } from '@/lib/services/route-helpers';
import {
  countSimSessionsTowardLimitToday,
  createSimulationProvenance,
  maxSimSessionsPerDay,
  simSessionsCollection,
} from '@/lib/services/simulation-engine';
import { loadLearnerTrackContext, loadSecretScenario } from '@/lib/services/track-loader';
import { appendDialogueEvent, createInitialScenarioState, evaluateDeterministicGates } from '@/lib/services/scenario-state';
import { TRAINING_POLICY } from '@/lib/policy/training-policy';
import { createVerbalScenarioState, evaluateVerbalPracticeGates } from '@/lib/services/verbal-practice';
import { assertSimAiAvailable } from '@/lib/services/sim-ai-availability';
import { findResumableSession, isResumableSession, simStartLockId } from '@/lib/services/sim-resume';
import { sessionForViewer } from '@/lib/services/learner-views';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * POST /api/simulations/start
 * Creates a Live Call Sim session seeded with the scenario's opening message.
 * Returns 200 with the learner's existing ACTIVE / READY_FOR_EVAL run of the same scenario instead of
 * creating a duplicate (page reload), and 503 AI_UNAVAILABLE when the AI caller cannot run.
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

    const existing = await findResumableSession(user.uid, track.id, resolvedVersionId, scenario.id);
    if (existing) return NextResponse.json({ session: sessionForViewer(existing, user), resumed: true }, { status: 200 });

    // Never open (or count) a new call while the AI caller is known to be down.
    assertSimAiAvailable();

    const now = Date.now();
    const limit = maxSimSessionsPerDay();
    const startedToday = await countSimSessionsTowardLimitToday(user.uid, user.partnerCohortId, now);
    if (startedToday >= limit) {
      return jsonError(
        429,
        'SIM_DAILY_LIMIT',
        // The browser rewrites this with the local reset time (QA L17); the limit day is the UTC day.
        `You started the maximum of ${limit} ${SIM_COPY.plural} today. The limit resets at midnight UTC.`,
      );
    }

    if (!isDraft) {
      const enrollment = await ensureEnrollment({ user, track, version });
      if (!hasCompletedAllUnits(enrollment, version)) {
        return jsonError(403, 'UNITS_INCOMPLETE', 'Complete every Unit in this Track to unlock the Simulation.');
      }
    }

    const ref = simSessionsCollection().doc();
    const verbalOnly = TRAINING_POLICY.simulationInteractionMode === 'verbal_only';
    const initialState = verbalOnly ? createVerbalScenarioState(scenario) : createInitialScenarioState(scenario);
    const messageId = randomUUID();
    const opening = appendDialogueEvent({
      sessionId: ref.id,
      state: initialState,
      events: [],
      actor: 'customer',
      content: scenario.openingMessage,
      provenance: 'deterministic',
      now: new Date(now),
      eventId: messageId,
    });
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
          id: messageId,
          role: 'counterparty',
          content: scenario.openingMessage,
          createdAt: now,
        },
      ],
      selectedDisposition: null,
      evaluation: null,
      scenarioState: opening.state,
      simulationEvents: [opening.event],
      gateResults: verbalOnly
        ? evaluateVerbalPracticeGates(scenario, opening.state, [opening.event])
        : evaluateDeterministicGates(scenario, opening.state, [opening.event]),
      nextEventSequence: 2,
      provenance: createSimulationProvenance({ task: 'session' }),
      startedAt: now,
      updatedAt: now,
    });
    // Find-or-create in one transaction per learner and scenario: two parallel Starts (double click, two tabs)
    // resolve to the same run instead of leaving duplicate ACTIVE sessions.
    const lockRef = ref.firestore.collection('simStartLocks').doc(simStartLockId(user.uid, track.id, resolvedVersionId, scenario.id));
    const created = await ref.firestore.runTransaction(async (tx) => {
      const lock = await tx.get(lockRef);
      const lockedSessionId = lock.exists ? lock.get('sessionId') : null;
      if (typeof lockedSessionId === 'string' && lockedSessionId) {
        const lockedSnap = await tx.get(simSessionsCollection().doc(lockedSessionId));
        const locked = lockedSnap.exists ? SimSessionDocSchema.safeParse({ ...lockedSnap.data(), id: lockedSnap.id }) : null;
        if (locked?.success && isResumableSession(locked.data, user.uid, resolvedVersionId)) return { session: locked.data, resumed: true };
      }
      tx.set(ref, session);
      tx.set(ref.collection('events').doc(opening.event.id), opening.event);
      tx.set(lockRef, { sessionId: ref.id, userId: user.uid, updatedAt: now });
      return { session, resumed: false };
    });

    return NextResponse.json(
      { session: sessionForViewer(created.session, user), ...(created.resumed ? { resumed: true } : {}) },
      { status: created.resumed ? 200 : 201 },
    );
  } catch (error) {
    return errorResponse(error, 'simulations/start');
  }
}
