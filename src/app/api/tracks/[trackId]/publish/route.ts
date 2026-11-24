/**
 * POST /api/tracks/[trackId]/publish — freeze the draft into an immutable TrackVersion `v{N}`,
 * write its secret rubrics ONLY to `versions/v{N}/secrets/evalRubrics`, and assign Cohorts.
 */
import { NextResponse } from 'next/server';
import { adminDb } from '@/lib/firebase/admin';
import { jsonError, requireAuth } from '@/lib/firebase/auth-guard';
import { resolveTrackAssignment, type TrackAssignment } from '@/lib/services/track-assignment';
import { evaluatePublicationGates } from '@/lib/services/source-evidence';
import { buildAssessmentBlueprint, mapAssessmentContentChanges, planRecertification } from '@/lib/services/certification';
import {
  readCertificationAggregateState,
  stageCertificationAggregateDelta,
  writeCertificationAggregateState,
} from '@/lib/services/analytics-rollup';
import {
  assessmentBlueprintRef,
  certificationsCollection,
  selectCurrentCertification,
} from '@/lib/services/learning-evidence';
import { runScenarioQAFixture } from '@/lib/services/scenario-state';
import { normalizeVerbalScenarioPairs } from '@/lib/services/verbal-defaults';
import { VERBAL_ONLY } from '@/lib/policy/training-policy';
import { loadSourceReview, SourceBundleNotFoundError } from '@/lib/services/source-store';
import type { PublicationGateReport } from '@/lib/schemas/source-truth';
import { INTERNAL_OPS_ROLES } from '@/lib/schemas/constants';
import { ServiceError } from '@/lib/services/errors';
import { PublishTrackRequestSchema } from '@/lib/schemas/api';
import { EnrollmentDocSchema, enrollmentIdFor } from '@/lib/schemas/analytics';
import { AssessmentBlueprintDocSchema, CertificationDocSchema } from '@/lib/schemas/learning';
import { UserStatsSchema } from '@/lib/schemas/domain';
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
    readonly gateReport?: PublicationGateReport,
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
  if (!parsed.success) return jsonError(400, 'VALIDATION_FAILED', 'Pick at least one Cohort or person.');

  let assignment: TrackAssignment;
  try {
    assignment = await resolveTrackAssignment({ cohortIds: parsed.data.assignedCohortIds, userIds: parsed.data.assignedUserIds });
  } catch (error) {
    if (error instanceof ServiceError) return jsonError(error.status, error.code, error.message);
    throw error;
  }
  const { assignedCohortIds, assignedUserIds } = assignment;

  try {
    const publishedVersionId = await adminDb.runTransaction(async (tx) => {
      const track = await loadTrack(trackId, tx);
      if (!track) throw new PublishError(404, 'NOT_FOUND', 'This Track does not exist.');
      if (isGenerationRunning(track) || track.generationProgress.step !== 'READY') {
        throw new PublishError(409, 'NOT_READY', 'The Track build is not complete. Finish the build before you publish.');
      }
      const storedDraft = await loadVersion(trackId, DRAFT_VERSION_ID, tx);
      if (!storedDraft) throw new PublishError(409, 'NO_DRAFT', 'This Track has no draft to publish.');
      const storedSecrets = await loadSecrets(trackId, DRAFT_VERSION_ID, tx);
      // Verbal Practice has no Studio QA editor: backfill canonical context and QA fixtures for scenarios that
      // lack them (Tracks built before fixtures were generated) instead of failing SCENARIO_GOLDEN_PASS_REQUIRED.
      // Complete, trainer-saved scenarios are left untouched.
      const backfill = VERBAL_ONLY
        ? normalizeVerbalScenarioPairs({
            scenarios: storedDraft.simScenarios,
            secrets: storedSecrets?.scenarios ?? [],
            defaults: {
              divisionId: track.divisionId,
              product: track.title,
              sourceRevision: storedDraft.sourceRevision ?? null,
              curriculumVersion: storedDraft.versionId,
            },
            onlyIncomplete: true,
          })
        : null;
      const draft = backfill?.changed ? TrackVersionDocSchema.parse({ ...storedDraft, simScenarios: backfill.scenarios }) : storedDraft;
      const secrets = backfill?.changed && storedSecrets
        ? EvalRubricsDocSchema.parse({ ...storedSecrets, scenarios: backfill.secrets })
        : storedSecrets;

      if (draft.units.length === 0) throw new PublishError(400, 'VALIDATION_FAILED', 'Add at least one Unit before you publish.');
      if (draft.simScenarios.length === 0) {
        throw new PublishError(400, 'VALIDATION_FAILED', 'Add at least one Live Call Simulation before you publish.');
      }
      const secretById = new Map((secrets?.scenarios ?? []).map((config) => [config.scenarioId, config]));
      const scenarioSecrets = draft.simScenarios.map((scenario) => secretById.get(scenario.id));
      if (scenarioSecrets.some((config) => config === undefined)) {
        throw new PublishError(400, 'VALIDATION_FAILED', 'Every Simulation needs a persona and grading rubric before you publish.');
      }

      // Source evidence is evaluated inside the same transaction as the version freeze. A missing
      // bundle/revision deliberately evaluates as legacy_unknown and cannot bypass the new gates.
      const emptySource = { bundle: null, pages: [], rulePacks: [], assets: [], conflicts: [] };
      let source: Awaited<ReturnType<typeof loadSourceReview>> | typeof emptySource = emptySource;
      if (draft.sourceBundleId) {
        try {
          source = await loadSourceReview(trackId, draft.sourceBundleId, tx);
        } catch (error) {
          if (!(error instanceof SourceBundleNotFoundError)) throw error;
        }
      }
      // The gate report also carries UNIT_CONTENT_INCOMPLETE: learners only ever get complete
      // Checkpoints, so a Unit a local build could only partly fill (see reviewNotes) stays a draft.
      const gateReport = evaluatePublicationGates({ draft, ...source, secrets: secrets?.scenarios ?? [], runScenarioQAFixture });
      if (!gateReport.eligible) {
        const count = gateReport.issues.filter((issue) => issue.blocking).length;
        const thinUnits = gateReport.issues.filter((issue) => issue.code === 'UNIT_CONTENT_INCOMPLETE').length;
        throw new PublishError(
          409,
          'PUBLICATION_GATES_FAILED',
          `Publication is blocked by ${count} issue${count === 1 ? '' : 's'}${thinUnits > 0 ? ` (${thinUnits} Checkpoint${thinUnits === 1 ? ' needs' : 's need'} more content)` : ''}. Resolve each item in Source Review and try again.`,
          gateReport,
        );
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

      let blueprint;
      try {
        blueprint = buildAssessmentBlueprint(published, { createdAt: new Date(now) });
      } catch {
        throw new PublishError(409, 'ASSESSMENT_REQUIREMENTS_INVALID', 'The published TrackVersion is missing stable assessment requirements or a source revision.');
      }

      // Read every previous requirement and certification before the first publication write.
      const previousVersion = track.publishedVersionId ? await loadVersion(trackId, track.publishedVersionId, tx) : null;
      const previousBlueprintSnap = track.publishedVersionId
        ? await tx.get(assessmentBlueprintRef(trackId, track.publishedVersionId))
        : null;
      const previousBlueprint = previousBlueprintSnap?.exists
        ? AssessmentBlueprintDocSchema.parse(previousBlueprintSnap.data())
        : previousVersion
          ? buildAssessmentBlueprint(previousVersion, { createdAt: new Date(previousVersion.publishedAt ?? previousVersion.createdAt) })
          : null;
      const certificationsSnap = await tx.get(certificationsCollection().where('trackId', '==', trackId));
      const byLearner = new Map<string, Array<ReturnType<typeof CertificationDocSchema.parse>>>();
      for (const doc of certificationsSnap.docs) {
        const certification = CertificationDocSchema.parse({ ...doc.data(), id: doc.id });
        const records = byLearner.get(certification.learnerId) ?? [];
        records.push(certification);
        byLearner.set(certification.learnerId, records);
      }
      const recertifications = [...byLearner.values()].flatMap((records) => {
        const existing = selectCurrentCertification(records);
        if (!existing || existing.status !== 'certified') return [];
        if (!previousBlueprint) {
          throw new PublishError(409, 'PREVIOUS_ASSESSMENT_REQUIREMENTS_MISSING', 'The previous assessment requirements are unavailable, so certification cannot be reconciled safely.');
        }
        const plan = planRecertification({
          existing,
          previousBlueprint,
          nextBlueprint: blueprint,
          mapping: previousVersion ? mapAssessmentContentChanges(previousVersion, published) : undefined,
          now: new Date(now),
          actorUid: auth.user.uid,
          reason: `Assessment requirements changed in published TrackVersion ${versionId}.`,
        });
        return plan.changed ? [plan] : [];
      });
      const enrollmentSnaps = recertifications.length > 0
        ? await tx.getAll(...recertifications.map((plan) =>
            adminDb.collection('enrollments').doc(enrollmentIdFor(plan.certification.learnerId, trackId))))
        : [];
      const userSnaps = recertifications.length > 0
        ? await tx.getAll(...recertifications.map((plan) => adminDb.collection('users').doc(plan.certification.learnerId)))
        : [];
      const aggregateTargets = recertifications.flatMap((plan) => plan.historicalCertification
        ? [{ partnerCohortId: plan.historicalCertification.partnerCohortId }]
        : []);
      const aggregates = await readCertificationAggregateState(tx, track, aggregateTargets);
      recertifications.forEach((plan) => {
        const historical = plan.historicalCertification;
        if (!historical || (historical.expiresAt && Date.parse(historical.expiresAt) <= now)) return;
        stageCertificationAggregateDelta(aggregates, { partnerCohortId: historical.partnerCohortId }, -1);
      });

      tx.set(assessmentBlueprintRef(trackId, versionId), blueprint);
      for (const plan of recertifications) {
        if (plan.historicalCertification) {
          tx.set(certificationsCollection().doc(plan.historicalCertification.id), plan.historicalCertification);
        }
        tx.set(certificationsCollection().doc(plan.certification.id), plan.certification);
      }
      enrollmentSnaps.forEach((snap) => {
        if (!snap.exists) return;
        const enrollment = EnrollmentDocSchema.parse({ ...snap.data(), id: snap.id });
        // Never rewrite or erase an unverified legacy enrollment assertion during publication.
        if (enrollment.certificationProvenance !== 'certification_register') return;
        tx.set(snap.ref, EnrollmentDocSchema.parse({
          ...enrollment,
          certifiedAt: null,
          certificationEvidenceLabel: 'historical_verified',
          status: enrollment.completedUnitIds.length > 0 || enrollment.passedScenarioIds.length > 0 ? 'IN_PROGRESS' : 'NOT_STARTED',
        }));
      });
      userSnaps.forEach((snap, index) => {
        const historical = recertifications[index]?.historicalCertification;
        if (!snap.exists || !historical || (historical.expiresAt && Date.parse(historical.expiresAt) <= now)) return;
        const stats = UserStatsSchema.safeParse(snap.get('stats'));
        if (!stats.success) return;
        tx.update(snap.ref, { 'stats.tracksCertifiedCount': Math.max(0, stats.data.tracksCertifiedCount - 1) });
      });
      writeCertificationAggregateState(tx, aggregates, now);

      tx.set(versionRef(trackId, versionId), published);
      tx.set(secretsRef(trackId, versionId), publishedSecrets);
      if (backfill?.changed) {
        tx.set(draftRef(trackId), TrackVersionDocSchema.parse({ ...draft, versionNumber: versionNumber + 1 }));
        if (secrets) tx.set(secretsRef(trackId, DRAFT_VERSION_ID), secrets);
      } else {
        tx.update(draftRef(trackId), { versionNumber: versionNumber + 1 });
      }
      tx.update(trackRef(trackId), {
        status: 'PUBLISHED',
        publishedVersionId: versionId,
        assignedCohortIds,
        assignedUserIds,
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
    if (error instanceof PublishError) {
      if (error.gateReport) {
        return NextResponse.json(
          {
            error: error.code,
            message: error.message,
            details: { publicationGate: error.gateReport, issues: error.gateReport.issues },
          },
          { status: error.status, headers: { 'Cache-Control': 'no-store' } },
        );
      }
      return jsonError(error.status, error.code, error.message);
    }
    throw error;
  }
}

