/**
 * GET /api/tracks/[trackId]/generate — SSE stream of the staged Track build.
 * Events: `progress` {step, percent, message}, `complete` {trackId, versionId}, `error` {message}.
 * Only one build runs per Track: a second connection follows the running build's progress.
 */
import { jsonError, requireAuth } from '@/lib/firebase/auth-guard';
import { adminDb } from '@/lib/firebase/admin';
import { INTERNAL_OPS_ROLES } from '@/lib/schemas/constants';
import { DRAFT_VERSION_ID, type TrackDoc } from '@/lib/schemas/curriculum';
import type { GenerateCompleteEvent, GenerateProgressEvent, SseErrorEvent } from '@/lib/schemas/api';
import { sseFrame } from '@/lib/utils';
import { describeGenerationError, runTrackGeneration } from '@/lib/ai/pipeline/generate-track';
import {
  GENERATION_STALE_MS,
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
  | { kind: 'acquired' };

/** Take the generation lock in a transaction, or report that the Track is ready or already building. */
async function acquireGenerationLock(trackId: string): Promise<LockResult> {
  return adminDb.runTransaction(async (tx) => {
    const trackSnap = await tx.get(trackRef(trackId));
    if (!trackSnap.exists) return { kind: 'missing' } as const;
    const track = parseTrack(trackSnap.data());
    const draftSnap = await tx.get(draftRef(trackId));
    const now = Date.now();
    if (track.generationProgress.step === 'READY' && track.status !== 'GENERATING' && draftSnap.exists) {
      return { kind: 'ready' } as const;
    }
    if (isGenerationRunning(track, now)) return { kind: 'running' } as const;
    tx.update(trackRef(trackId), {
      generationProgress: { step: 'BLUEPRINTING', percent: 12, message: 'Starting the Track build...' },
      updatedAt: now,
    });
    return { kind: 'acquired' } as const;
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
          if (Date.now() - track.updatedAt > GENERATION_STALE_MS) {
            fail('The Track build stopped responding. Select Retry to build the Track again.');
            return;
          }
          await sleep(FOLLOW_POLL_MS, disconnect.signal);
        }
      };

      void (async () => {
        try {
          const lock = await acquireGenerationLock(trackId);
          if (lock.kind === 'missing') {
            fail('This Track does not exist.');
          } else if (lock.kind === 'ready') {
            progress({ step: 'READY', percent: 100, message: 'Track Ready! Redirecting to Preview Studio...' });
            complete();
          } else if (lock.kind === 'running') {
            await follow();
          } else {
            // The build continues to the end even if the trainer closes the page; a new connection follows it.
            await runTrackGeneration(trackId, progress);
            complete();
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
