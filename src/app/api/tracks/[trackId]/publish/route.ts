/**
 * POST /api/tracks/[trackId]/publish — freeze the draft into an immutable TrackVersion `v{N}`,
 * write its secret rubrics ONLY to `versions/v{N}/secrets/evalRubrics`, and assign Cohorts.
 */
import { NextResponse } from 'next/server';
import { adminDb } from '@/lib/firebase/admin';
import { jsonError, requireAuth } from '@/lib/firebase/auth-guard';
import { ALL_COHORTS_ID, INTERNAL_OPS_ROLES } from '@/lib/schemas/constants';
import { PublishTrackRequestSchema } from '@/lib/schemas/api';
import {
  DRAFT_VERSION_ID,
  EvalRubricsDocSchema,
  TrackVersionDocSchema,
} from '@/lib/schemas/curriculum';
import {
  draftRef,
  estimateTrackMinutes,
  isGenerationRunning,
  loadSecrets,
  loadTrack,
  loadVersion,
  secretsRef,
  trackRef,
  versionNumberFromId,
  versionRef,
} from '@/lib/ai/pipeline/track-store';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

class PublishError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
  ) {
    super(message);
  }
}

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
  const parsed = PublishTrackRequestSchema.safeParse(json);
  if (!parsed.success) return jsonError(400, 'VALIDATION_FAILED', 'Select at least one Cohort.');

  const requested = [...new Set(parsed.data.assignedCohortIds.map((id) => id.trim()).filter(Boolean))];
  if (requested.length === 0) return jsonError(400, 'VALIDATION_FAILED', 'Select at least one Cohort.');
  let assignedCohortIds: string[];
  if (requested.includes(ALL_COHORTS_ID)) {
    assignedCohortIds = [ALL_COHORTS_ID];
  } else {
    const snaps = await adminDb.getAll(...requested.map((id) => adminDb.collection('cohorts').doc(id)));
    const missing = snaps.filter((snap) => !snap.exists).map((snap) => snap.id);
    if (missing.length > 0) return jsonError(400, 'VALIDATION_FAILED', `These Cohorts do not exist: ${missing.join(', ')}.`);
    assignedCohortIds = requested;
  }

  try {
    const publishedVersionId = await adminDb.runTransaction(async (tx) => {
      const track = await loadTrack(trackId, tx);
      if (!track) throw new PublishError(404, 'NOT_FOUND', 'This Track does not exist.');
      if (isGenerationRunning(track) || track.generationProgress.step !== 'READY') {
        throw new PublishError(409, 'NOT_READY', 'The Track build is not complete. Finish the build before you publish.');
      }
      const draft = await loadVersion(trackId, DRAFT_VERSION_ID, tx);
      if (!draft) throw new PublishError(409, 'NO_DRAFT', 'This Track has no draft to publish.');
      const secrets = await loadSecrets(trackId, DRAFT_VERSION_ID, tx);

      if (draft.units.length === 0) throw new PublishError(400, 'VALIDATION_FAILED', 'Add at least one Unit before you publish.');
      if (draft.simScenarios.length === 0) {
        throw new PublishError(400, 'VALIDATION_FAILED', 'Add at least one Live Call Simulation before you publish.');
      }
      const secretById = new Map((secrets?.scenarios ?? []).map((config) => [config.scenarioId, config]));
      const scenarioSecrets = draft.simScenarios.map((scenario) => secretById.get(scenario.id));
      if (scenarioSecrets.some((config) => config === undefined)) {
        throw new PublishError(400, 'VALIDATION_FAILED', 'Every Simulation needs a persona and grading rubric before you publish.');
      }

      const versionNumber = Math.max(draft.versionNumber, versionNumberFromId(track.publishedVersionId) + 1);
      const versionId = `v${versionNumber}`;
      const existingVersion = await tx.get(versionRef(trackId, versionId));
      if (existingVersion.exists) {
        throw new PublishError(409, 'VERSION_EXISTS', `TrackVersion ${versionId} already exists. Reload the Studio and try again.`);
      }

      const now = Date.now();
      const published = TrackVersionDocSchema.parse({
        ...draft,
        versionId,
        versionNumber,
        publishedAt: now,
        createdAt: now,
      });
      const publishedSecrets = EvalRubricsDocSchema.parse({
        trackId,
        versionId,
        scenarios: scenarioSecrets,
        updatedAt: now,
      });

      tx.set(versionRef(trackId, versionId), published);
      tx.set(secretsRef(trackId, versionId), publishedSecrets);
      tx.update(draftRef(trackId), { versionNumber: versionNumber + 1 });
      tx.update(trackRef(trackId), {
        status: 'PUBLISHED',
        publishedVersionId: versionId,
        assignedCohortIds,
        competencyPillars: published.competencyPillars,
        unitCount: published.units.length,
        simScenarioCount: published.simScenarios.length,
        estimatedTotalMinutes: estimateTrackMinutes(published.units, published.simScenarios.length),
        updatedAt: now,
      });
      return versionId;
    });
    return NextResponse.json({ publishedVersionId });
  } catch (error) {
    if (error instanceof PublishError) return jsonError(error.status, error.code, error.message);
    throw error;
  }
}
