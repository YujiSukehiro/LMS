import { NextResponse } from 'next/server';
import { adminDb } from '@/lib/firebase/admin';
import { jsonError, requireAuth } from '@/lib/firebase/auth-guard';
import { SimSessionDocSchema, type SimSessionDoc } from '@/lib/schemas/analytics';
import { SimulationActionRequestSchema } from '@/lib/schemas/api';
import { SyntheticOutboxRecordSchema, type SyntheticOutboxRecord } from '@/lib/schemas/simulation-state';
import { ServiceError } from '@/lib/services/errors';
import { errorResponse, parseJsonBody } from '@/lib/services/route-helpers';
import {
  applySimulationAction,
  assessmentEligibility,
  evaluateDeterministicGates,
  validateDisposition,
} from '@/lib/services/scenario-state';
import { loadOwnedSimSession, simSessionsCollection } from '@/lib/services/simulation-engine';
import { loadVersion } from '@/lib/services/track-loader';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

async function loadScenario(session: SimSessionDoc) {
  const version = await loadVersion(session.trackId, session.versionId);
  const scenario = version?.simScenarios.find((item) => item.id === session.scenarioId);
  if (!scenario) throw new Error('The scenario for this session no longer exists.');
  return scenario;
}

/** Return the server-owned operations state and local synthetic outbox; never live external records. */
export async function GET(req: Request, { params }: { params: Promise<{ sessionId: string }> }): Promise<NextResponse> {
  const auth = await requireAuth(req);
  if (!auth.ok) return auth.response;
  const { sessionId } = await params;
  try {
    const session = await loadOwnedSimSession(auth.user, sessionId);
    const outbox = await adminDb.collection('simSyntheticOutbox').where('sessionId', '==', sessionId).get();
    const records = outbox.docs
      .map((doc) => SyntheticOutboxRecordSchema.parse({ ...doc.data(), id: doc.id }))
      .sort((a, b) => a.createdAt.localeCompare(b.createdAt));
    return NextResponse.json({ session, outboxRecords: records });
  } catch (error) {
    return errorResponse(error, 'simulations/action:get');
  }
}

/** Browser requests are validated and reduced on the server; no client-supplied outcome state is accepted. */
export async function POST(req: Request, { params }: { params: Promise<{ sessionId: string }> }): Promise<NextResponse> {
  const auth = await requireAuth(req);
  if (!auth.ok) return auth.response;
  const { sessionId } = await params;
  const body = await parseJsonBody(req, SimulationActionRequestSchema);
  if (!body.ok) return body.response;
  try {
    const owned = await loadOwnedSimSession(auth.user, sessionId);
    if (owned.status === 'EVALUATED' || owned.status === 'ABANDONED') {
      return jsonError(409, 'SIM_NOT_ACTIVE', 'This Simulation session is closed.');
    }
    if (!owned.scenarioState || !owned.simulationEvents) {
      return jsonError(409, 'LEGACY_SESSION_READ_ONLY', 'This historical session has no server scenario state. Start a new scenario run.');
    }
    const scenario = await loadScenario(owned);
    const ref = simSessionsCollection().doc(sessionId);
    let outboxRecord: SyntheticOutboxRecord | null = null;
    const session = await adminDb.runTransaction(async (tx) => {
      const snap = await tx.get(ref);
      if (!snap.exists) throw new ServiceError(404, 'SESSION_NOT_FOUND', 'This Simulation session does not exist.');
      const current = SimSessionDocSchema.parse({ ...snap.data(), id: snap.id });
      if (current.userId !== auth.user.uid || current.updatedAt !== owned.updatedAt) {
        throw new ServiceError(409, 'SIM_CONFLICT', 'This scenario changed in another window. Reload the operations panel.');
      }
      if (!current.scenarioState || !current.simulationEvents) throw new Error('Server scenario state is missing.');
      const applied = applySimulationAction({
        sessionId,
        scenario,
        state: current.scenarioState,
        events: current.simulationEvents,
        action: body.data.action,
      });
      const events = [...current.simulationEvents, applied.event];
      const gates = evaluateDeterministicGates(scenario, applied.state, events);
      const dispositionValidation = applied.state.selectedDisposition
        ? validateDisposition(applied.state, applied.state.selectedDisposition)
        : undefined;
      const next: SimSessionDoc = {
        ...current,
        status: applied.state.lifecycle === 'aborted' ? 'ABANDONED' : applied.state.lifecycle === 'wrap_up' ? 'READY_FOR_EVAL' : 'ACTIVE',
        scenarioState: applied.state,
        simulationEvents: events,
        gateResults: gates,
        dispositionValidation,
        assessmentEligibility: assessmentEligibility(scenario, applied.state, events, gates),
        selectedDisposition: applied.state.selectedDisposition,
        nextEventSequence: applied.event.sequence + 1,
        updatedAt: Date.now(),
      };
      tx.update(ref, {
        status: next.status,
        scenarioState: next.scenarioState,
        simulationEvents: next.simulationEvents,
        gateResults: next.gateResults,
        dispositionValidation: next.dispositionValidation,
        assessmentEligibility: next.assessmentEligibility,
        selectedDisposition: next.selectedDisposition,
        nextEventSequence: next.nextEventSequence,
        updatedAt: next.updatedAt,
      });
      tx.set(ref.collection('events').doc(applied.event.id), applied.event);
      if (applied.outboxRecord) {
        outboxRecord = applied.outboxRecord;
        tx.set(adminDb.collection('simSyntheticOutbox').doc(applied.outboxRecord.id), applied.outboxRecord);
      }
      return next;
    });
    return NextResponse.json({ session, outboxRecord });
  } catch (error) {
    return errorResponse(error, 'simulations/action');
  }
}
