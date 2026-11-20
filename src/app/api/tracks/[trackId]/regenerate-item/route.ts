/**
 * POST /api/tracks/[trackId]/regenerate-item — regenerate ONE BriefingCard, Drill, or Simulation scenario
 * in the draft TrackVersion (heavy tier, grounded in the SOURCE PAGES). Returns `{ item }`.
 *
 * `{ action: 'add_drill', unitId, trainerHint? }` adds ONE new Drill to a thin Checkpoint (for example a
 * local build that wrote 1 of 4 Drills) without a full rebuild. Returns `{ item, unit }`.
 */
import { NextResponse } from 'next/server';
import { z } from 'zod';
import { adminDb } from '@/lib/firebase/admin';
import { jsonError, requireAuth } from '@/lib/firebase/auth-guard';
import { INTERNAL_OPS_ROLES } from '@/lib/schemas/constants';
import { RegenerateItemRequestSchema } from '@/lib/schemas/api';
import { DRAFT_VERSION_ID, TrackVersionDocSchema, type TrackUnit } from '@/lib/schemas/curriculum';
import { describeGenerationError } from '@/lib/ai/pipeline/generate-track';
import { RegenerateItemError, regenerateDraftItem } from '@/lib/ai/pipeline/regenerate-item';
import { draftRef, isGenerationRunning, loadTrack, loadVersion, trackRef } from '@/lib/ai/pipeline/track-store';
import { ADD_DRILL_HINT, planAddedDrill, refreshUnitReviewNotes } from '@/components/studio/unit-review';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const AddDrillRequestSchema = z.object({
  action: z.literal('add_drill'),
  unitId: z.string().min(1),
  trainerHint: z.string().max(400).optional(),
});

export async function POST(req: Request, { params }: { params: Promise<{ trackId: string }> }): Promise<NextResponse> {
  const auth = await requireAuth(req, INTERNAL_OPS_ROLES);
  if (!auth.ok) return auth.response;
  const { trackId } = await params;

  let json: unknown;
  try {
    json = await req.json();
  } catch {
    return jsonError(400, 'VALIDATION_FAILED', 'The request body must be JSON.');
  }

  if (json && typeof json === 'object' && (json as { action?: unknown }).action === 'add_drill') {
    const add = AddDrillRequestSchema.safeParse(json);
    if (!add.success) return jsonError(400, 'VALIDATION_FAILED', 'Select the Checkpoint to add a Drill to.');
    try {
      return NextResponse.json(await addDrill(trackId, add.data));
    } catch (error) {
      if (error instanceof RegenerateItemError) return jsonError(error.status, error.code, error.message);
      return jsonError(502, 'AI_GENERATION_FAILED', describeGenerationError(error));
    }
  }

  const parsed = RegenerateItemRequestSchema.safeParse(json);
  if (!parsed.success) {
    const first = parsed.error.issues[0];
    return jsonError(400, 'VALIDATION_FAILED', `Check "${first?.path.join('.') || 'body'}": ${first?.message ?? 'invalid value'}.`);
  }

  try {
    const item = await regenerateDraftItem(trackId, parsed.data);
    return NextResponse.json({ item });
  } catch (error) {
    if (error instanceof RegenerateItemError) return jsonError(error.status, error.code, error.message);
    return jsonError(502, 'AI_GENERATION_FAILED', describeGenerationError(error));
  }
}

/**
 * Add a Drill using only the existing single-item regenerate path (no pipeline changes):
 *   1. In a transaction, append a placeholder copy of an existing Drill (new id, evidence reset to an
 *      unapproved draft so it can never pass the publication gates as-is).
 *   2. Regenerate that placeholder as a NEW Drill (heavy tier, source-grounded, evidence verified).
 *   3. On failure, remove the placeholder again if it is still untouched. On success, drop the
 *      "Needs more Drills" review note once the Checkpoint meets the minimum.
 */
async function addDrill(
  trackId: string,
  request: z.infer<typeof AddDrillRequestSchema>,
): Promise<{ item: unknown; unit: TrackUnit }> {
  const placeholder = await adminDb.runTransaction(async (tx) => {
    const [track, draft] = await Promise.all([loadTrack(trackId, tx), loadVersion(trackId, DRAFT_VERSION_ID, tx)]);
    if (!track) throw new RegenerateItemError(404, 'NOT_FOUND', 'This Track does not exist.');
    if (isGenerationRunning(track)) {
      throw new RegenerateItemError(409, 'GENERATION_RUNNING', 'A build is running for this Track. Wait for it to finish.');
    }
    if (!draft) throw new RegenerateItemError(409, 'NO_DRAFT', 'This Track has no draft yet. Build the Track first.');
    const planned = planAddedDrill(draft, request.unitId);
    if (!planned.ok) throw new RegenerateItemError(planned.status, planned.code, planned.message);
    tx.set(draftRef(trackId), TrackVersionDocSchema.parse(planned.draft));
    tx.update(trackRef(trackId), { updatedAt: Date.now() });
    return planned.placeholder;
  });

  let item: unknown;
  try {
    item = await regenerateDraftItem(trackId, {
      targetType: 'DRILL',
      unitId: request.unitId,
      itemId: placeholder.id,
      trainerHint: [ADD_DRILL_HINT, request.trainerHint?.trim()].filter(Boolean).join(' ').slice(0, 400),
    });
  } catch (error) {
    await adminDb
      .runTransaction(async (tx) => {
        const latest = await loadVersion(trackId, DRAFT_VERSION_ID, tx);
        if (!latest) return;
        const untouched = JSON.stringify(placeholder);
        const units = latest.units.map((unit) =>
          unit.id === request.unitId
            ? { ...unit, drills: unit.drills.filter((drill) => drill.id !== placeholder.id || JSON.stringify(drill) !== untouched) }
            : unit,
        );
        tx.set(draftRef(trackId), TrackVersionDocSchema.parse({ ...latest, units }));
      })
      .catch((cleanupError: unknown) => {
        console.warn('[add-drill] could not remove the placeholder Drill', { trackId, drillId: placeholder.id, cleanupError });
      });
    throw error;
  }

  const unit = await adminDb.runTransaction(async (tx) => {
    const latest = await loadVersion(trackId, DRAFT_VERSION_ID, tx);
    const current = latest?.units.find((candidate) => candidate.id === request.unitId);
    if (!latest || !current) throw new RegenerateItemError(409, 'ITEM_CHANGED', 'The Checkpoint changed while the Drill was written. Reload the Studio.');
    const refreshed = refreshUnitReviewNotes(current);
    if (refreshed !== current) {
      tx.set(draftRef(trackId), TrackVersionDocSchema.parse({
        ...latest,
        units: latest.units.map((candidate) => (candidate.id === refreshed.id ? refreshed : candidate)),
      }));
    }
    return refreshed;
  });
  return { item, unit };
}
