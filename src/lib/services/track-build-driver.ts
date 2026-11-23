/**
 * Runs Track builds in the background as a chain of short steps, independent of the trainer's browser.
 *
 * Why: App Hosting (Cloud Run) ends every request after 300 s and throttles CPU outside requests, and a deploy or
 * instance restart kills work that is not inside a request. Each step runs inside its own request for at most
 * BUILD_STEP_BUDGET_MS, starts no new stage after that, and hands off to the next step. Every stage is
 * checkpointed (generation-reliability.ts), so a step that is killed mid-stage loses at most that one stage.
 *
 * Production (TRACK_BUILD_QUEUE + TRACK_BUILD_TASK_SA + APP_BASE_URL set): each step is a Cloud Tasks HTTP task to
 * POST /api/internal/tracks/{trackId}/build-step with an OIDC token. Local dev (queue unset): the same steps run
 * in-process in a loop.
 */
import { GoogleAuth, OAuth2Client } from 'google-auth-library';
import { adminDb } from '@/lib/firebase/admin';
import { isGenerationPausedError, runTrackGeneration } from '@/lib/ai/pipeline/generate-track';
import { canTakeBuildStep, draftRef, parseTrack, trackRef } from '@/lib/ai/pipeline/track-store';
import type { LLMGateway } from '@/lib/ai/types';

/** Longest time a step keeps starting new stages. One stage can take ~2 min, so this leaves room under 300 s. */
export const BUILD_STEP_BUDGET_MS = 150_000;

export interface BuildQueueConfig {
  /** projects/{project}/locations/{region}/queues/{queue} */
  queuePath: string;
  serviceAccountEmail: string;
  baseUrl: string;
}

export function buildQueueConfig(env: NodeJS.ProcessEnv = process.env): BuildQueueConfig | null {
  const queuePath = env.TRACK_BUILD_QUEUE?.trim();
  const serviceAccountEmail = env.TRACK_BUILD_TASK_SA?.trim();
  const baseUrl = env.APP_BASE_URL?.trim().replace(/\/+$/, '');
  if (!queuePath || !serviceAccountEmail || !baseUrl) return null;
  return { queuePath, serviceAccountEmail, baseUrl };
}

export function buildStepUrl(config: BuildQueueConfig, trackId: string): string {
  return `${config.baseUrl}/api/internal/tracks/${encodeURIComponent(trackId)}/build-step`;
}

/** The Cloud Tasks request body for one build step (exported for tests). */
export function buildStepTask(config: BuildQueueConfig, trackId: string) {
  return {
    task: {
      dispatchDeadline: '300s',
      httpRequest: {
        httpMethod: 'POST',
        url: buildStepUrl(config, trackId),
        headers: { 'Content-Type': 'application/json' },
        body: Buffer.from(JSON.stringify({ trackId })).toString('base64'),
        oidcToken: { serviceAccountEmail: config.serviceAccountEmail, audience: config.baseUrl },
      },
    },
  };
}

let auth: GoogleAuth | null = null;

async function enqueueBuildStep(config: BuildQueueConfig, trackId: string): Promise<void> {
  auth ??= new GoogleAuth({ scopes: ['https://www.googleapis.com/auth/cloud-platform'] });
  const client = await auth.getClient();
  await client.request({
    url: `https://cloudtasks.googleapis.com/v2/${config.queuePath}/tasks`,
    method: 'POST',
    data: buildStepTask(config, trackId),
  });
}

export type BuildStepOutcome = 'completed' | 'paused' | 'failed' | 'skipped';

/**
 * Take the Track for one step (or skip when another step holds it or it is already built), then build until the
 * step budget runs out.
 */
export async function runBuildStep(
  trackId: string,
  options: { budgetMs?: number; gateway?: LLMGateway; now?: () => number } = {},
): Promise<BuildStepOutcome> {
  const now = options.now ?? Date.now;
  const taken = await adminDb.runTransaction(async (tx) => {
    const snap = await tx.get(trackRef(trackId));
    if (!snap.exists) return false;
    const track = parseTrack(snap.data());
    const draft = await tx.get(draftRef(trackId));
    if (track.generationProgress.step === 'READY' && track.status !== 'GENERATING' && draft.exists) return false;
    if (!canTakeBuildStep(track, now())) return false;
    tx.update(trackRef(trackId), { generationPausedAt: null, updatedAt: now() });
    return true;
  });
  if (!taken) return 'skipped';
  try {
    await runTrackGeneration(trackId, () => undefined, options.gateway, { deadlineAt: now() + (options.budgetMs ?? BUILD_STEP_BUDGET_MS) });
    console.info('[track-build] build finished', { trackId });
    return 'completed';
  } catch (error) {
    if (isGenerationPausedError(error)) {
      console.info('[track-build] step reached its time budget; continuing in the next step', { trackId });
      return 'paused';
    }
    return 'failed'; // runTrackGeneration already wrote FAILED with a plain message.
  }
}

async function runStepsInProcess(trackId: string): Promise<void> {
  for (;;) {
    const outcome = await runBuildStep(trackId);
    if (outcome !== 'paused') return;
  }
}

/** Start (or continue) a build in the background. Returns how it was started. */
export async function kickTrackBuild(trackId: string, env: NodeJS.ProcessEnv = process.env): Promise<'enqueued' | 'in_process'> {
  const config = buildQueueConfig(env);
  if (!config) {
    void runStepsInProcess(trackId).catch((error: unknown) => console.error('[track-build] in-process build stopped', { trackId, error }));
    return 'in_process';
  }
  try {
    await enqueueBuildStep(config, trackId);
    return 'enqueued';
  } catch (error) {
    // Queue missing or not permitted: build in this instance instead (the pre-queue behavior) rather than not at all.
    console.error('[track-build] could not queue the build; running it in-process', { trackId, error: error instanceof Error ? error.message : error });
    void runStepsInProcess(trackId).catch((inner: unknown) => console.error('[track-build] in-process build stopped', { trackId, error: inner }));
    return 'in_process';
  }
}

/** After a paused step: queue the next one (production) — callers in local mode loop in-process instead. */
export async function continueTrackBuild(trackId: string): Promise<void> {
  const config = buildQueueConfig();
  if (!config) return;
  await enqueueBuildStep(config, trackId);
}

const oidcClient = new OAuth2Client();

/** True when the request carries a Google OIDC token minted for our build-step task service account. */
export async function verifyBuildStepRequest(req: Request, config: BuildQueueConfig | null = buildQueueConfig()): Promise<boolean> {
  if (!config) return false;
  const header = req.headers.get('authorization') ?? '';
  const token = header.startsWith('Bearer ') ? header.slice('Bearer '.length).trim() : '';
  if (!token) return false;
  try {
    const ticket = await oidcClient.verifyIdToken({ idToken: token, audience: config.baseUrl });
    const payload = ticket.getPayload();
    return Boolean(payload?.email_verified && payload.email === config.serviceAccountEmail);
  } catch {
    return false;
  }
}
