import { NextResponse } from 'next/server';
import { jsonError, requireAuth } from '@/lib/firebase/auth-guard';
import { EvaluateSimRequestSchema, type EvaluateSimResponse } from '@/lib/schemas/api';
import { DRAFT_VERSION_ID } from '@/lib/schemas/curriculum';
import { recordSimulationEvaluation, saveSimulationEvaluation } from '@/lib/services/analytics-rollup';
import { errorResponse, parseJsonBody } from '@/lib/services/route-helpers';
import { evaluateSimulation, loadOwnedSimSession } from '@/lib/services/simulation-engine';
import { loadSecretScenario, loadTrack, loadVersion } from '@/lib/services/track-loader';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
/** The heavy-tier Judge can take a while on local hardware. */
export const maxDuration = 300;

function normalizeDisposition(value: string): string {
  return value.trim().replace(/\s+/g, ' ').toLowerCase();
}

/**
 * POST /api/simulations/[sessionId]/evaluate
 * Runs the Rubric Judge, saves the SimEvaluation, and (for published TrackVersions) records progress.
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
    if (session.status === 'EVALUATED') {
      return jsonError(409, 'ALREADY_EVALUATED', 'This Simulation is already scored. Start a new call to try again.');
    }
    if (session.status !== 'ACTIVE' && session.status !== 'READY_FOR_EVAL') {
      return jsonError(409, 'SESSION_NOT_ACTIVE', 'This Simulation session is closed.');
    }
    if (!session.messages.some((m) => m.role === 'agent')) {
      return jsonError(400, 'NO_AGENT_TURNS', 'Reply to the caller at least once before you end the call.');
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

    const wanted = normalizeDisposition(body.data.selectedDisposition);
    const selectedDisposition = scenario.dispositionOptions.find((o) => normalizeDisposition(o) === wanted);
    if (!selectedDisposition) {
      return jsonError(400, 'INVALID_DISPOSITION', 'Select one of the dispositions in the list.');
    }

    const evaluation = await evaluateSimulation({
      scenario,
      secret,
      messages: session.messages,
      selectedDisposition,
      pillars: sessionVersion.competencyPillars,
    });

    const isDemoReplay =
      session.provenance?.source === 'replay' ||
      evaluation.provenance?.source === 'replay' ||
      session.messages.some((message) => message.provenance?.source === 'replay');
    if (isDemoReplay) {
      // Keep the demo scorecard inspectable, but never touch enrollment, readiness, XP, or certification.
      await saveSimulationEvaluation({ sessionId: session.id, evaluation, selectedDisposition });
      const response: EvaluateSimResponse = { evaluation, certified: false, demoReplay: true };
      return NextResponse.json(response);
    }

    const isDraftSession = session.versionId === DRAFT_VERSION_ID;
    if (isDraftSession) {
      await saveSimulationEvaluation({ sessionId: session.id, evaluation, selectedDisposition });
      const response: EvaluateSimResponse = { evaluation, certified: false };
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
    const response: EvaluateSimResponse = { evaluation, certified };
    return NextResponse.json(response);
  } catch (error) {
    return errorResponse(error, 'simulations/evaluate');
  }
}
