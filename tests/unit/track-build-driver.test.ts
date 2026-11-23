/** Background Track builds: who may take a step, the Cloud Tasks request, and OIDC checks on the step endpoint. */
import { describe, expect, it, vi } from 'vitest';

vi.mock('@/lib/firebase/admin', () => ({ adminDb: {} }));
vi.mock('@/lib/ai/gateway', () => ({ getLLMGateway: vi.fn(), getActiveAiRuntime: vi.fn() }));

const { BUILD_STEP_STALE_MS, canTakeBuildStep } = await import('@/lib/ai/pipeline/track-store');
const { buildQueueConfig, buildStepTask, verifyBuildStepRequest } = await import('@/lib/services/track-build-driver');

const env = {
  TRACK_BUILD_QUEUE: 'projects/telehealthlms/locations/us-central1/queues/track-builds',
  TRACK_BUILD_TASK_SA: 'firebase-app-hosting-compute@telehealthlms.iam.gserviceaccount.com',
  APP_BASE_URL: 'https://logicall-pulse--telehealthlms.us-central1.hosted.app/',
} as unknown as NodeJS.ProcessEnv;

const NOW = 1_800_000_000_000;
const running = { generationProgress: { step: 'BUILDING_UNITS' as const, percent: 40, message: '' }, updatedAt: NOW - 10_000 };

describe('canTakeBuildStep', () => {
  it('lets a step take an unbuilt, failed or paused Track', () => {
    expect(canTakeBuildStep({ ...running, generationProgress: { ...running.generationProgress, step: 'EXTRACTING_PDF' } }, NOW)).toBe(true);
    expect(canTakeBuildStep({ ...running, generationProgress: { ...running.generationProgress, step: 'FAILED' } }, NOW)).toBe(true);
    expect(canTakeBuildStep({ ...running, generationPausedAt: NOW - 1_000 }, NOW)).toBe(true);
  });

  it('never takes a Track another step is building, until its heartbeat goes stale', () => {
    expect(canTakeBuildStep({ ...running, generationPausedAt: null }, NOW)).toBe(false);
    expect(canTakeBuildStep({ ...running, updatedAt: NOW - BUILD_STEP_STALE_MS }, NOW)).toBe(true);
  });
});

describe('build queue', () => {
  it('is configured only when the queue, service account and base URL are all set', () => {
    expect(buildQueueConfig({} as NodeJS.ProcessEnv)).toBeNull();
    expect(buildQueueConfig({ ...env, TRACK_BUILD_TASK_SA: '' } as unknown as NodeJS.ProcessEnv)).toBeNull();
    expect(buildQueueConfig(env)?.baseUrl).toBe('https://logicall-pulse--telehealthlms.us-central1.hosted.app');
  });

  it('builds an OIDC-signed task to the build-step endpoint', () => {
    const config = buildQueueConfig(env)!;
    const { task } = buildStepTask(config, 'track 1');
    expect(task.httpRequest.url).toBe('https://logicall-pulse--telehealthlms.us-central1.hosted.app/api/internal/tracks/track%201/build-step');
    expect(task.httpRequest.oidcToken).toEqual({ serviceAccountEmail: env.TRACK_BUILD_TASK_SA, audience: config.baseUrl });
    expect(JSON.parse(Buffer.from(task.httpRequest.body, 'base64').toString())).toEqual({ trackId: 'track 1' });
    expect(task.dispatchDeadline).toBe('300s');
  });

  it('rejects step requests without a valid Google token', async () => {
    const config = buildQueueConfig(env);
    expect(await verifyBuildStepRequest(new Request('https://x/api'), null)).toBe(false);
    expect(await verifyBuildStepRequest(new Request('https://x/api'), config)).toBe(false);
    expect(await verifyBuildStepRequest(new Request('https://x/api', { headers: { authorization: 'Bearer not-a-jwt' } }), config)).toBe(false);
  });
});
