/**
 * GET /api/tracks/[trackId]/generate — SSE stream of the staged Track build.
 * Events: `progress` {step, percent, message}, `complete` {trackId, versionId}, `error` {message}.
 * The build itself runs in the background as short steps (src/lib/services/track-build-driver.ts): this route
 * only starts or re-queues it and streams progress from Firestore, so closing the page never stops a build.
 */
import { jsonError, requireAuth } from '@/lib/firebase/auth-guard';
import { adminDb } from '@/lib/firebase/admin';
import { INTERNAL_OPS_ROLES } from '@/lib/schemas/constants';
import { DRAFT_VERSION_ID, type TrackDoc } from '@/lib/schemas/curriculum';
import type { GenerateCompleteEvent, GenerateProgressEvent, SseErrorEvent } from '@/lib/schemas/api';
import { sseFrame } from '@/lib/utils';
import { describeGenerationError } from '@/lib/ai/pipeline/generate-track';
import { kickTrackBuild } from '@/lib/services/track-build-driver';
import { buildLimitMessage, claimBuildSlot, isFreshBuildStart } from '@/lib/services/build-quota';
import {
  draftRef,
  isGenerationRunning,
  loadTrack,
  parseTrack,
  trackRef,
} from '@/lib/ai/pipeline/track-store';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const KEEP_ALIVE_MS = 15_000;
const FOLLOW_POLL_MS = 2_000;

type LockResult =
  | { kind: 'missing' }
  | { kind: 'ready' }
  | { kind: 'running' }
  | { kind: 'limited'; limit: number }
  | { kind: 'queued' };

/** A paused build that no step picked up within this time is queued again (lost task, deploy, restart). */
const PAUSED_REKICK_MS = 60_000;

/** True when the build has no live step and nothing queued that is about to take it. */
function needsKick(track: TrackDoc, now: number): boolean {
  if (track.generationPausedAt) return now - track.generationPausedAt >= PAUSED_REKICK_MS;
  return !isGenerationRunning(track, now);
}

/**
 * Decide in a transaction: the Track is ready, a build is live (follow it), or it must be (re)queued. Queuing marks
 * the Track paused-now, so a second page that connects at the same moment follows instead of queuing again.
 */
async function acquireGenerationLock(trackId: string, uid: string): Promise<LockResult> {
  return adminDb.runTransaction(async (tx) => {
    const trackSnap = await tx.get(trackRef(trackId));
    if (!trackSnap.exists) return { kind: 'missing' } as const;
    const track = parseTrack(trackSnap.data());
    const draftSnap = await tx.get(draftRef(trackId));
    const now = Date.now();
    if (track.generationProgress.step === 'READY' && track.status !== 'GENERATING' && draftSnap.exists) {
      return { kind: 'ready' } as const;
    }
    if (!needsKick(track, now)) return { kind: 'running' } as const;
    // A new build counts toward the trainer's daily limit; a Retry or resume does not.
    if (isFreshBuildStart(track.generationProgress.step)) {
      const slot = await claimBuildSlot(tx, uid, trackId, now);
      if (!slot.ok) return { kind: 'limited', limit: slot.limit } as const;
    }
    const running = isGenerationRunning(track, now) || track.generationPausedAt;
    tx.update(trackRef(trackId), {
      ...(running ? {} : { generationProgress: { step: 'BLUEPRINTING', percent: 12, message: 'Starting the Track build...' } }),
      generationPausedAt: now,
      updatedAt: now,
    });
    return { kind: 'queued' } as const;
  });
}

/** Re-queue a build whose step was lost, at most once per PAUSED_REKICK_MS across all connected pages. */
async function claimRekick(trackId: string): Promise<boolean> {
  return adminDb.runTransaction(async (tx) => {
    const snap = await tx.get(trackRef(trackId));
    if (!snap.exists) return false;
    const track = parseTrack(snap.data());
    const now = Date.now();
    if (track.generationProgress.step === 'READY' || track.generationProgress.step === 'FAILED' || !needsKick(track, now)) return false;
    tx.update(trackRef(trackId), { generationPausedAt: now, updatedAt: now });
    return true;
  });
}

function sleep(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve) => {
    const timer = setTimeout(resolve, ms);
    signal.addEventListener(
      'abort',
      () => {
        clearTimeout(timer);
        resolve();
      },
      { once: true },
    );
  });
}

/**
 * POST /api/tracks/[trackId]/generate — start (or re-queue) the background build without opening a stream, so a
 * trainer who approves the source and closes the page still gets a Track. 202 queued, 200 already running or ready.
 */
export async function POST(req: Request, { params }: { params: Promise<{ trackId: string }> }): Promise<Response> {
  const auth = await requireAuth(req, INTERNAL_OPS_ROLES);
  if (!auth.ok) return auth.response;
  const { trackId } = await params;
  const lock = await acquireGenerationLock(trackId, auth.user.uid);
  if (lock.kind === 'missing') return jsonError(404, 'NOT_FOUND', 'This Track does not exist.');
  if (lock.kind === 'limited') return jsonError(429, 'TRACK_BUILD_DAILY_LIMIT', buildLimitMessage(lock.limit));
  if (lock.kind === 'queued') {
    await kickTrackBuild(trackId);
    return Response.json({ status: 'queued' }, { status: 202 });
  }
  return Response.json({ status: lock.kind });
}

export async function GET(req: Request, { params }: { params: Promise<{ trackId: string }> }): Promise<Response> {
  const auth = await requireAuth(req, INTERNAL_OPS_ROLES);
  if (!auth.ok) return auth.response;
  const { trackId } = await params;

  const initial = await loadTrack(trackId);
  if (!initial) return jsonError(404, 'NOT_FOUND', 'This Track does not exist.');

  const encoder = new TextEncoder();
  const disconnect = new AbortController();
  let closed = false;
  let keepAlive: ReturnType<typeof setInterval> | undefined;

  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      const send = (chunk: string) => {
        if (closed) return;
        try {
          controller.enqueue(encoder.encode(chunk));
        } catch {
          closed = true;
        }
      };
      const close = () => {
        if (keepAlive) clearInterval(keepAlive);
        if (closed) return;
        closed = true;
        try {
          controller.close();
        } catch {
          // The stream is already closed by the client.
        }
      };
      const progress = (event: GenerateProgressEvent) => send(sseFrame('progress', event));
      const complete = () => {
        const payload: GenerateCompleteEvent = { trackId, versionId: DRAFT_VERSION_ID };
        send(sseFrame('complete', payload));
      };
      const fail = (message: string) => {
        const payload: SseErrorEvent = { message };
        send(sseFrame('error', payload));
      };

      keepAlive = setInterval(() => send(': keep-alive\n\n'), KEEP_ALIVE_MS);
      send(': connected\n\n');

      const follow = async () => {
        let lastKey = '';
        while (!disconnect.signal.aborted) {
          const track: TrackDoc | null = await loadTrack(trackId);
          if (!track) {
            fail('This Track was deleted.');
            return;
          }
          const { step, percent, message } = track.generationProgress;
          const key = `${step}|${percent}|${message}`;
          if (key !== lastKey) {
            lastKey = key;
            progress({ step, percent, message });
          }
          if (step === 'READY') {
            complete();
            return;
          }
          if (step === 'FAILED') {
            fail(message);
            return;
          }
          // A step lost to a deploy or restart: queue the build again (it resumes from saved checkpoints).
          if (needsKick(track, Date.now()) && (await claimRekick(trackId))) await kickTrackBuild(trackId);
          await sleep(FOLLOW_POLL_MS, disconnect.signal);
        }
      };

      void (async () => {
        try {
          const lock = await acquireGenerationLock(trackId, auth.user.uid);
          if (lock.kind === 'missing') {
            fail('This Track does not exist.');
          } else if (lock.kind === 'limited') {
            fail(buildLimitMessage(lock.limit));
          } else if (lock.kind === 'ready') {
            progress({ step: 'READY', percent: 100, message: 'Track Ready! Redirecting to Preview Studio...' });
            complete();
          } else if (lock.kind === 'running') {
            await follow();
          } else {
            // Queued: the build runs in background steps; this page only follows it and may close at any time.
            await kickTrackBuild(trackId);
            await follow();
          }
        } catch (error) {
          fail(describeGenerationError(error));
        } finally {
          close();
        }
      })();
    },
    cancel() {
      closed = true;
      disconnect.abort();
      if (keepAlive) clearInterval(keepAlive);
    },
  });

  req.signal.addEventListener('abort', () => {
    closed = true;
    disconnect.abort();
    if (keepAlive) clearInterval(keepAlive);
  });

  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream; charset=utf-8',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no',
    },
  });
}
