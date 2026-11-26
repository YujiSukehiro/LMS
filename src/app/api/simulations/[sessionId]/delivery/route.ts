import { NextResponse } from 'next/server';
import { jsonError, requireAuth } from '@/lib/firebase/auth-guard';
import { getLLMGateway } from '@/lib/ai/gateway';
import {
  DELIVERY_AUDIO_MIME_TYPES,
  DELIVERY_MAX_CLIPS,
  DELIVERY_MAX_TOTAL_BYTES,
  DELIVERY_MAX_TOTAL_SECONDS,
  DeliveryRequestMetaSchema,
} from '@/lib/schemas/delivery';
import { assessDelivery, type DeliveryClip } from '@/lib/services/delivery-coach';
import { errorResponse } from '@/lib/services/route-helpers';
import { toSimAiUnavailable } from '@/lib/services/sim-ai-availability';
import { loadOwnedSimSession, simSessionsCollection } from '@/lib/services/simulation-engine';
import { loadVersion } from '@/lib/services/track-loader';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 120;

/**
 * POST /api/simulations/[sessionId]/delivery (multipart: `meta` JSON + one `clip` file per spoken reply, in order)
 * Scores how the agent sounded once the call is graded. One assessment per session; a repeat returns the stored one.
 * Coaching only: never changes the Rubric score, pass result or certification. Audio is not stored.
 */
export async function POST(req: Request, { params }: { params: Promise<{ sessionId: string }> }): Promise<NextResponse> {
  const auth = await requireAuth(req);
  if (!auth.ok) return auth.response;
  const { sessionId } = await params;

  const declared = Number(req.headers.get('content-length') ?? '0');
  if (declared > DELIVERY_MAX_TOTAL_BYTES + 64 * 1024) {
    return jsonError(413, 'AUDIO_TOO_LARGE', 'The recording is too long to score. Try a shorter practice call.');
  }

  try {
    const session = await loadOwnedSimSession(auth.user, sessionId);
    if (session.deliveryAssessment) return NextResponse.json({ delivery: session.deliveryAssessment, alreadyAssessed: true });
    if (session.status !== 'EVALUATED' && session.status !== 'READY_FOR_EVAL') {
      return jsonError(409, 'NOT_GRADED_YET', 'Finish and grade the practice call first.');
    }
    const demoReplay = session.provenance?.source === 'replay' || session.messages.some((m) => m.provenance?.source === 'replay');
    if (demoReplay) return jsonError(409, 'DEMO_REPLAY', 'Delivery coaching is off for demo replays.');

    let form: FormData;
    try {
      form = await req.formData();
    } catch {
      return jsonError(400, 'INVALID_UPLOAD', 'The recording upload was not readable.');
    }
    let metaJson: unknown;
    try {
      metaJson = JSON.parse(String(form.get('meta') ?? ''));
    } catch {
      return jsonError(400, 'INVALID_UPLOAD', 'The recording details were not readable.');
    }
    const meta = DeliveryRequestMetaSchema.safeParse(metaJson);
    const files = form.getAll('clip').filter((value): value is File => typeof value !== 'string');
    if (!meta.success || files.length !== meta.data.clips.length || files.length > DELIVERY_MAX_CLIPS) {
      return jsonError(400, 'INVALID_UPLOAD', 'The recording details did not match the upload.');
    }
    const totalBytes = files.reduce((sum, f) => sum + f.size, 0);
    const totalMs = meta.data.clips.reduce((sum, c) => sum + c.durationMs, 0);
    if (totalBytes > DELIVERY_MAX_TOTAL_BYTES || totalMs > DELIVERY_MAX_TOTAL_SECONDS * 1000) {
      return jsonError(413, 'AUDIO_TOO_LARGE', 'The recording is too long to score. Try a shorter practice call.');
    }
    const seen = new Set<number>();
    const clips: DeliveryClip[] = [];
    for (let i = 0; i < files.length; i += 1) {
      const file = files[i];
      const mimeType = (file.type || '').split(';')[0].trim().toLowerCase();
      if (!(DELIVERY_AUDIO_MIME_TYPES as readonly string[]).includes(mimeType)) {
        return jsonError(415, 'UNSUPPORTED_AUDIO', 'This browser recorded audio in a format the coach cannot read.');
      }
      const { agentTurnIndex, durationMs } = meta.data.clips[i];
      if (seen.has(agentTurnIndex)) return jsonError(400, 'INVALID_UPLOAD', 'A reply was uploaded twice.');
      seen.add(agentTurnIndex);
      clips.push({ agentTurnIndex, durationMs, mimeType, base64: Buffer.from(await file.arrayBuffer()).toString('base64') });
    }

    const version = await loadVersion(session.trackId, session.versionId);
    const scenario = version?.simScenarios.find((s) => s.id === session.scenarioId);
    const delivery = await assessDelivery({
      gateway: getLLMGateway(),
      model: process.env.GEMINI_AUDIO_MODEL?.trim() || undefined,
      messages: session.messages,
      counterpartyLabel: scenario?.counterpartyRoleLabel ?? 'Caller',
      scenarioTitle: session.scenarioTitle,
      clips,
      signal: req.signal,
    });
    await simSessionsCollection().doc(session.id).update({ deliveryAssessment: delivery });
    return NextResponse.json({ delivery });
  } catch (error) {
    return errorResponse(toSimAiUnavailable(error) ?? error, 'simulations/delivery');
  }
}
