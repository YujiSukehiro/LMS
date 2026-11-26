import { NextResponse } from 'next/server';
import { loadRepeatMissHint } from '@/lib/services/sim-repeat-hint';
import { adminDb } from '@/lib/firebase/admin';
import { jsonError, requireAuth } from '@/lib/firebase/auth-guard';
import { LLMStructuredOutputError, isLLMOutputTruncatedError } from '@/lib/ai/types';
import { SimSessionDocSchema, type SimJudgeReview, type SimSessionDoc } from '@/lib/schemas/analytics';
import { EvaluateSimRequestSchema, type EvaluateSimResponse } from '@/lib/schemas/api';
import { evaluationForViewer } from '@/lib/services/learner-views';
import type { SessionUser } from '@/lib/schemas/domain';
import { DRAFT_VERSION_ID } from '@/lib/schemas/curriculum';
import { CertificationDocSchema } from '@/lib/schemas/learning';
import { isCertificationActive } from '@/lib/services/certification';
import { certificationsCollection, selectCurrentCertification } from '@/lib/services/learning-evidence';
import { recordSimulationEvaluation, saveSimulationEvaluation } from '@/lib/services/analytics-rollup';
import { ServiceError, isServiceError } from '@/lib/services/errors';
import { errorResponse, parseJsonBody } from '@/lib/services/route-helpers';
import { isSimAiUnavailable, toSimAiUnavailable } from '@/lib/services/sim-ai-availability';
import {
  appendDialogueEvent,
  applyDeterministicAssessment,
  assessmentEligibility,
  evaluateDeterministicGates,
  validateDisposition,
} from '@/lib/services/scenario-state';
import { TRAINING_POLICY } from '@/lib/policy/training-policy';
import { completeVerbalWrapUp, createVerbalScenarioState } from '@/lib/services/verbal-practice';
import { simulationEventProvenanceFor } from '@/lib/services/simulation-engine';
import {
  JUDGE_DEADLINE_MS,
  evaluateSimulation,
  loadOwnedSimSession,
  simSessionsCollection,
} from '@/lib/services/simulation-engine';
import { loadSecretScenario, loadTrack, loadVersion } from '@/lib/services/track-loader';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
/** The heavy-tier Judge can take a while on local hardware. */
export const maxDuration = 300;

function normalizeDisposition(value: string): string {
  return value.trim().replace(/\s+/g, ' ').toLowerCase();
}

const MANUAL_JUDGE_MESSAGE = 'Your call was saved. The AI coach could not score it right now, so a Trainer will score it. Check back later for your scorecard.';

/** Body of the 202 "awaiting manual judge" response. */
type EvaluateSimPendingResponse = {
  pending: true;
  judgeReview: SimJudgeReview;
  message: string;
};

/** True when the learner holds an active certification for this Track (the certification register is the source). */
async function hasActiveCertification(learnerId: string, trackId: string): Promise<boolean> {
  const snap = await certificationsCollection().where('learnerId', '==', learnerId).where('trackId', '==', trackId).get();
  const records = snap.docs.flatMap((doc) => {
    const parsed = CertificationDocSchema.safeParse({ ...doc.data(), id: doc.id });
    return parsed.success ? [parsed.data] : [];
  });
  return isCertificationActive(selectCurrentCertification(records), Date.now());
}

async function storedEvaluationResponse(session: SimSessionDoc, viewer: SessionUser): Promise<NextResponse> {
  // A retry after a slow first evaluation: show the stored scorecard instead of an error.
  const evaluation = session.evaluation!;
  const demoReplay =
    session.provenance?.source === 'replay' ||
    evaluation.provenance?.source === 'replay' ||
    session.messages.some((message) => message.provenance?.source === 'replay');
  const certified = demoReplay || session.versionId === DRAFT_VERSION_ID
    ? false
    : await hasActiveCertification(session.userId, session.trackId).catch(() => false);
  const response: EvaluateSimResponse = { evaluation: evaluationForViewer(evaluation, viewer), certified, ...(demoReplay ? { demoReplay: true } : {}) };
  return NextResponse.json({ ...response, alreadyEvaluated: true });
}

function pendingResponse(judgeReview: SimJudgeReview): NextResponse {
  const body: EvaluateSimPendingResponse = { pending: true, judgeReview, message: MANUAL_JUDGE_MESSAGE };
  return NextResponse.json(body, { status: 202 });
}

/** Classify a Judge failure that should fall back to manual Trainer scoring; null = a real server error. */
function judgeFailureReason(error: unknown, deadlineHit: boolean): SimJudgeReview['reason'] | null {
  if (deadlineHit) return 'judge_timeout';
  // A provider or fetch timeout (DOMException "TimeoutError") is a slow judge, not a server error.
  if (error instanceof Error && error.name === 'TimeoutError') return 'judge_timeout';
  if (isSimAiUnavailable(error)) return 'ai_unavailable';
  if (error instanceof LLMStructuredOutputError || isLLMOutputTruncatedError(error)) return 'judge_output_invalid';
  if (error instanceof Error && error.name === 'LLMStructuredOutputError') return 'judge_output_invalid';
  return null;
}

/** Save deterministic evidence and mark the session for manual judging (status stays READY_FOR_EVAL). */
async function markAwaitingManualJudge(input: {
  sessionId: string;
  expectedUpdatedAt: number;
  judgeReview: SimJudgeReview;
  gateResults: SimSessionDoc['gateResults'];
  assessmentEligibility: SimSessionDoc['assessmentEligibility'];
  dispositionValidation: SimSessionDoc['dispositionValidation'];
}): Promise<'marked' | 'evaluated' | 'changed'> {
  const ref = simSessionsCollection().doc(input.sessionId);
  return adminDb.runTransaction(async (tx) => {
    const snap = await tx.get(ref);
    if (!snap.exists) throw new ServiceError(404, 'SESSION_NOT_FOUND', 'This Simulation session does not exist.');
    const status = snap.get('status');
    if (status === 'EVALUATED') return 'evaluated';
    if (status !== 'READY_FOR_EVAL' || snap.get('updatedAt') !== input.expectedUpdatedAt) return 'changed';
    tx.update(ref, {
      judgeReview: input.judgeReview,
      gateResults: input.gateResults,
      assessmentEligibility: input.assessmentEligibility,
      dispositionValidation: input.dispositionValidation,
      updatedAt: Date.now(),
    });
    return 'marked';
  });
}

async function reloadSession(sessionId: string): Promise<SimSessionDoc | null> {
  const snap = await simSessionsCollection().doc(sessionId).get();
  if (!snap.exists) return null;
  const parsed = SimSessionDocSchema.safeParse({ ...snap.data(), id: snap.id });
  return parsed.success ? parsed.data : null;
}

/**
 * POST /api/simulations/[sessionId]/evaluate
 * Runs the Rubric Judge, saves the SimEvaluation, and (for published TrackVersions) records progress.
 * - Already scored (a retry after a slow first request): 200 with the stored evaluation.
 * - Judge unavailable / invalid after repairs / over the deadline: deterministic gates and disposition are
 *   saved, the session is marked `judgeReview.awaiting_manual_judge`, and 202 tells the learner a Trainer
 *   will score it (manual judge exchange).
 */
export async function POST(
  req: Request,
  { params }: { params: Promise<{ sessionId: string }> },
): Promise<NextResponse> {
  const auth = await requireAuth(req);
  if (!auth.ok) return auth.response;
  const { user } = auth;
  const { sessionId } = await params;

  const body = await parseJsonBody(req, EvaluateSimRequestSchema);
  if (!body.ok) return body.response;

  try {
    const session = await loadOwnedSimSession(user, sessionId);
    if (session.status === 'EVALUATED' && session.evaluation) return storedEvaluationResponse(session, user);
    if (session.status === 'EVALUATED') {
      return jsonError(409, 'ALREADY_EVALUATED', 'This Simulation is already scored. Start a new call to try again.');
    }

    const verbalOnly = TRAINING_POLICY.simulationInteractionMode === 'verbal_only';
    const isLegacyWrapped =
      session.status === 'READY_FOR_EVAL' &&
      session.scenarioState?.lifecycle === 'wrap_up' &&
      Boolean(body.data.selectedDisposition) &&
      Boolean(session.simulationEvents) &&
      !session.scenarioState.noteReceiptIds.includes('verbal-practice-note');

    if (!verbalOnly || isLegacyWrapped) {
      if (session.status !== 'READY_FOR_EVAL' || session.scenarioState?.lifecycle !== 'wrap_up' || !session.simulationEvents) {
        return jsonError(409, 'WRAP_UP_REQUIRED', 'Complete the required workflow evidence and a valid disposition before evaluation.');
      }
    } else {
      if (session.status !== 'ACTIVE' && session.status !== 'READY_FOR_EVAL') {
        return jsonError(409, 'SESSION_NOT_ACTIVE', 'This Verbal Practice session is closed.');
      }
      const hasLearnerTurn = session.turnCount >= 1 || session.messages.some((message) => message.role === 'agent');
      if (!hasLearnerTurn) {
        return jsonError(409, 'MINIMUM_TURNS_REQUIRED', 'Send at least one verbal reply before grading your practice.');
      }
    }

    const [track, sessionVersion, secret] = await Promise.all([
      loadTrack(session.trackId),
      loadVersion(session.trackId, session.versionId),
      loadSecretScenario(session.trackId, session.versionId, session.scenarioId),
    ]);
    const scenario = sessionVersion?.simScenarios.find((s) => s.id === session.scenarioId);
    if (!track || !sessionVersion || !scenario) {
      return jsonError(404, 'SCENARIO_NOT_FOUND', 'The Simulation for this session no longer exists.');
    }
    if (!secret) return jsonError(409, 'SIM_NOT_READY', 'This Simulation is not configured. Contact a Trainer.');

    let selectedDisposition: string;
    if (body.data.selectedDisposition) {
      const wanted = normalizeDisposition(body.data.selectedDisposition);
      const matched = scenario.dispositionOptions.find((o) => normalizeDisposition(o) === wanted);
      if (!matched) {
        return jsonError(400, 'INVALID_DISPOSITION', 'Select one of the dispositions in the list.');
      }
      selectedDisposition = matched;
    } else {
      selectedDisposition =
        session.selectedDisposition ??
        scenario.dispositionOptions.find((o) => normalizeDisposition(o) === normalizeDisposition(secret.expectedDisposition)) ??
        scenario.dispositionOptions[0] ??
        'Recovered';
    }

    let gateResults: NonNullable<SimSessionDoc['gateResults']>;
    let eligibility: NonNullable<SimSessionDoc['assessmentEligibility']>;
    let dispositionValidation: NonNullable<SimSessionDoc['dispositionValidation']>;

    if (isLegacyWrapped || !verbalOnly) {
      if (session.scenarioState!.selectedDisposition !== selectedDisposition) {
        return jsonError(409, 'DISPOSITION_CHANGED', 'Confirm the server-recorded disposition before evaluation.');
      }
      gateResults = evaluateDeterministicGates(scenario, session.scenarioState!, session.simulationEvents!);
      eligibility = assessmentEligibility(scenario, session.scenarioState!, session.simulationEvents!, gateResults);
      dispositionValidation = validateDisposition(session.scenarioState!, selectedDisposition);
    } else {
      let baseState = session.scenarioState ?? createVerbalScenarioState(scenario);
      let baseEvents = session.simulationEvents ?? [];
      if (baseEvents.length === 0 && session.messages.length > 0) {
        let state = baseState;
        const rebuilt = [] as NonNullable<SimSessionDoc['simulationEvents']>;
        for (const msg of session.messages) {
          const applied = appendDialogueEvent({
            sessionId: session.id,
            state,
            events: rebuilt,
            actor: msg.role === 'agent' ? 'learner' : 'customer',
            content: msg.content,
            provenance: msg.role === 'agent' ? 'learner' : simulationEventProvenanceFor(msg.provenance?.source),
            runtimeProvenance: msg.provenance,
            now: new Date(msg.createdAt),
            eventId: msg.id,
          });
          state = applied.state;
          rebuilt.push(applied.event);
        }
        baseState = state;
        baseEvents = rebuilt;
      }
      const verbal = completeVerbalWrapUp({
        scenario,
        state: baseState,
        events: baseEvents,
        selectedDisposition,
      });
      gateResults = verbal.gates;
      eligibility = verbal.eligibility;
      dispositionValidation = verbal.dispositionValidation;

      const wrapNow = Date.now();
      const ref = simSessionsCollection().doc(session.id);
      const transitioned = await adminDb.runTransaction(async (tx) => {
        const snap = await tx.get(ref);
        if (!snap.exists) throw new ServiceError(404, 'SESSION_NOT_FOUND', 'This Simulation session does not exist.');
        const status = snap.get('status');
        if (status === 'EVALUATED') return 'evaluated' as const;
        if (status !== 'ACTIVE' && status !== 'READY_FOR_EVAL') return 'closed' as const;
        tx.update(ref, {
          status: 'READY_FOR_EVAL',
          selectedDisposition,
          scenarioState: verbal.state,
          simulationEvents: baseEvents,
          gateResults,
          assessmentEligibility: eligibility,
          dispositionValidation,
          nextEventSequence: (baseEvents.at(-1)?.sequence ?? 0) + 1,
          updatedAt: wrapNow,
        });
        return 'wrapped' as const;
      });
      if (transitioned === 'evaluated') {
        const fresh = await reloadSession(session.id).catch(() => null);
        if (fresh?.evaluation) return storedEvaluationResponse(fresh, user);
        throw new ServiceError(409, 'ALREADY_EVALUATED', 'This call was just scored. Reload the page to see the scorecard.');
      }
      if (transitioned === 'closed') {
        throw new ServiceError(409, 'SESSION_NOT_ACTIVE', 'This Verbal Practice session is closed.');
      }
      session.status = 'READY_FOR_EVAL';
      session.selectedDisposition = selectedDisposition;
      session.scenarioState = verbal.state;
      session.simulationEvents = baseEvents;
      session.updatedAt = wrapNow;
    }

    // The Judge gets the request signal plus a deadline inside maxDuration (repair retries included).
    const judgeAbort = new AbortController();
    let deadlineHit = false;
    const deadline = setTimeout(() => {
      deadlineHit = true;
      judgeAbort.abort(new DOMException('The Rubric Judge exceeded its deadline.', 'TimeoutError'));
    }, JUDGE_DEADLINE_MS);
    const onClientAbort = () => judgeAbort.abort(req.signal.reason);
    if (req.signal.aborted) onClientAbort();
    else req.signal.addEventListener('abort', onClientAbort, { once: true });

    let judged: Awaited<ReturnType<typeof evaluateSimulation>>;
    try {
      judged = await evaluateSimulation({
        scenario,
        secret,
        messages: session.messages,
        selectedDisposition,
        pillars: sessionVersion.competencyPillars,
        events: session.simulationEvents,
        signal: judgeAbort.signal,
      });
    } catch (error) {
      if (req.signal.aborted && !deadlineHit) throw error; // The learner left; the call stays READY_FOR_EVAL for a retry.
      const reason = judgeFailureReason(error, deadlineHit);
      if (!reason) throw error;
      console.warn(`[simulations/evaluate] Judge unavailable for ${session.id} (${reason}); awaiting manual judge.`, error instanceof Error ? error.message : error);
      const judgeReview: SimJudgeReview = { status: 'awaiting_manual_judge', reason, requestedAt: Date.now() };
      const marked = await markAwaitingManualJudge({
        sessionId: session.id,
        expectedUpdatedAt: session.updatedAt,
        judgeReview,
        gateResults,
        assessmentEligibility: eligibility,
        dispositionValidation,
      });
      if (marked === 'evaluated') {
        // Another request scored it first: show that scorecard, never the "a Trainer will score it" state.
        const fresh = await reloadSession(session.id).catch(() => null);
        if (fresh?.evaluation) return storedEvaluationResponse(fresh, user);
        throw new ServiceError(409, 'ALREADY_EVALUATED', 'This call was just scored. Reload the page to see the scorecard.');
      }
      if (marked === 'changed') {
        // The call changed while the judge ran (for example another window). Never a 500 for a judge failure.
        throw new ServiceError(409, 'SIM_CONFLICT', 'This call changed while it was being scored. Reload the page, then try again.');
      }
      return pendingResponse(judgeReview);
    } finally {
      clearTimeout(deadline);
      req.signal.removeEventListener('abort', onClientAbort);
    }
    const evaluation = applyDeterministicAssessment({
      evaluation: judged,
      gates: gateResults,
      eligibility,
      disposition: dispositionValidation,
    });

    const isDemoReplay =
      session.provenance?.source === 'replay' ||
      evaluation.provenance?.source === 'replay' ||
      session.messages.some((message) => message.provenance?.source === 'replay');
    if (isDemoReplay) {
      // Keep the demo scorecard inspectable, but never touch enrollment, readiness, XP, or certification.
      await saveSimulationEvaluation({ sessionId: session.id, session, evaluation, selectedDisposition });
      const response: EvaluateSimResponse = { evaluation: evaluationForViewer(evaluation, user), certified: false, demoReplay: true };
      return NextResponse.json(response);
    }

    const isDraftSession = session.versionId === DRAFT_VERSION_ID;
    if (isDraftSession) {
      await saveSimulationEvaluation({ sessionId: session.id, session, evaluation, selectedDisposition });
      const response: EvaluateSimResponse = { evaluation: evaluationForViewer(evaluation, user), certified: false };
      return NextResponse.json(response);
    }

    // Progress is measured against the Track's current published TrackVersion.
    const currentVersion =
      track.publishedVersionId && track.publishedVersionId !== session.versionId
        ? ((await loadVersion(track.id, track.publishedVersionId)) ?? sessionVersion)
        : sessionVersion;

    const { certified } = await recordSimulationEvaluation({
      user,
      track,
      version: currentVersion,
      session,
      evaluation,
      scenario,
      pillars: sessionVersion.competencyPillars,
      selectedDisposition,
    });
    // Coaching only: a hint lookup failure must never break the scorecard.
    const repeatHint = evaluation.passed
      ? null
      : await loadRepeatMissHint({
          uid: user.uid,
          trackId: session.trackId,
          scenarioId: session.scenarioId,
          current: { sessionId: session.id, evaluation },
        }).catch((error) => {
          console.warn(`[simulations/evaluate] Repeat-miss hint unavailable for ${session.id}`, error instanceof Error ? error.message : error);
          return null;
        });
    const response: EvaluateSimResponse = {
      evaluation: evaluationForViewer(evaluation, user),
      certified,
      ...(repeatHint ? { repeatMissHint: repeatHint } : {}),
    };
    return NextResponse.json(response);
  } catch (error) {
    if (isServiceError(error) && error.code === 'ALREADY_EVALUATED') {
      // A concurrent (earlier, slower) request finished first: return its stored scorecard.
      const fresh = await reloadSession(sessionId).catch(() => null);
      if (fresh?.userId === user.uid && fresh.evaluation) return storedEvaluationResponse(fresh, user);
    }
    return errorResponse(toSimAiUnavailable(error) ?? error, 'simulations/evaluate');
  }
}
