/**
 * POST /api/internal/tracks/[trackId]/build-step — one background build step, called only by Cloud Tasks with an
 * OIDC token for TRACK_BUILD_TASK_SA. Runs the build for up to BUILD_STEP_BUDGET_MS, then queues the next step.
 * Answers 200 for every handled outcome (a failed build is recorded on the Track), so Cloud Tasks retries only
 * when the step itself could not run.
 */
import { NextResponse } from 'next/server';
import { jsonError } from '@/lib/firebase/auth-guard';
import { buildQueueConfig, continueTrackBuild, runBuildStep, verifyBuildStepRequest } from '@/lib/services/track-build-driver';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 300;

export async function POST(req: Request, { params }: { params: Promise<{ trackId: string }> }): Promise<NextResponse> {
  if (!buildQueueConfig()) return jsonError(404, 'NOT_FOUND', 'Not found.');
  if (!(await verifyBuildStepRequest(req))) return jsonError(401, 'UNAUTHENTICATED', 'This endpoint is only for the build queue.');
  const { trackId } = await params;
  const outcome = await runBuildStep(trackId);
  if (outcome === 'paused') {
    try {
      await continueTrackBuild(trackId);
    } catch (error) {
      // The Track stays paused; the next page visit (or a Cloud Tasks retry of this step) queues it again.
      console.error('[build-step] could not queue the next step', { trackId, error });
      return jsonError(500, 'ENQUEUE_FAILED', 'The next build step could not be queued.');
    }
  }
  return NextResponse.json({ trackId, outcome });
}
