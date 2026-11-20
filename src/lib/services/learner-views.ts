/**
 * Learner-facing copies of Simulation records. Trainer-only fields stay in Firestore and in internal-ops
 * responses; learners and partner supervisors get the same shape without them.
 */
import type { SimEvaluation, SimSessionDoc } from '@/lib/schemas/analytics';
import type { SessionUser } from '@/lib/schemas/domain';
import type { SimulationGateResult } from '@/lib/schemas/simulation-state';
import { INTERNAL_OPS_ROLES } from '@/lib/schemas/constants';

function withoutTrainerDetail(gates: SimulationGateResult[]): SimulationGateResult[] {
  return gates.map((gate) => {
    const copy = { ...gate };
    delete copy.trainerDetail;
    return copy;
  });
}

export function learnerEvaluation<T extends Pick<SimEvaluation, 'gateResults'>>(evaluation: T): T {
  return evaluation.gateResults ? { ...evaluation, gateResults: withoutTrainerDetail(evaluation.gateResults) } : evaluation;
}

export function learnerSession(session: SimSessionDoc): SimSessionDoc {
  return {
    ...session,
    ...(session.gateResults ? { gateResults: withoutTrainerDetail(session.gateResults) } : {}),
    evaluation: session.evaluation ? learnerEvaluation(session.evaluation) : session.evaluation,
  };
}

const isOps = (viewer: Pick<SessionUser, 'role'>) => INTERNAL_OPS_ROLES.includes(viewer.role);

/** The session as this viewer may see it: full for internal ops, trainer-only detail removed for everyone else. */
export function sessionForViewer(session: SimSessionDoc, viewer: Pick<SessionUser, 'role'>): SimSessionDoc {
  return isOps(viewer) ? session : learnerSession(session);
}

export function evaluationForViewer<T extends Pick<SimEvaluation, 'gateResults'>>(evaluation: T, viewer: Pick<SessionUser, 'role'>): T {
  return isOps(viewer) ? evaluation : learnerEvaluation(evaluation);
}
