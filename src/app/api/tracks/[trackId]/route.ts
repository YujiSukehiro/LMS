/**
 * GET   /api/tracks/[trackId] — internal ops: Track header + draft TrackVersion + draft secret rubrics (Studio).
 * PATCH /api/tracks/[trackId] — internal ops: apply plain-English edits to the draft TrackVersion.
 */
import { NextResponse } from 'next/server';
import { adminDb } from '@/lib/firebase/admin';
import { jsonError, requireAuth } from '@/lib/firebase/auth-guard';
import { INTERNAL_OPS_ROLES } from '@/lib/schemas/constants';
import { PatchTrackRequestSchema } from '@/lib/schemas/api';
import {
  DRAFT_VERSION_ID,
  EvalRubricsDocSchema,
  FILL_BLANK_TOKEN,
  TrackVersionDocSchema,
  type EvalRubricsDoc,
  type SecretSimScenarioConfig,
  type TrackDoc,
  type TrackVersionDoc,
} from '@/lib/schemas/curriculum';
import { rubricWeightProblems } from '@/lib/ai/prompts/sim-builder';
import {
  draftRef,
  estimateTrackMinutes,
  isGenerationRunning,
  loadSecrets,
  loadTrack,
  loadVersion,
  secretsRef,
  trackRef,
} from '@/lib/ai/pipeline/track-store';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type RouteContext = { params: Promise<{ trackId: string }> };

export async function GET(req: Request, { params }: RouteContext): Promise<NextResponse> {
  const auth = await requireAuth(req, INTERNAL_OPS_ROLES);
  if (!auth.ok) return auth.response;
  const { trackId } = await params;

  const track = await loadTrack(trackId);
  if (!track) return jsonError(404, 'NOT_FOUND', 'This Track does not exist.');
  const [draft, secrets] = await Promise.all([loadVersion(trackId, DRAFT_VERSION_ID), loadSecrets(trackId, DRAFT_VERSION_ID)]);
  return NextResponse.json({ track, draft, secrets }, { headers: { 'Cache-Control': 'no-store' } });
}

/** Cross-reference checks that the zod document schemas cannot express. Returns plain-English problems. */
function consistencyProblems(draft: TrackVersionDoc, secrets: SecretSimScenarioConfig[]): string[] {
  const problems: string[] = [];
  const pillarIds = new Set(draft.competencyPillars.map((pillar) => pillar.id));

  const unitIds = draft.units.map((unit) => unit.id);
  if (new Set(unitIds).size !== unitIds.length) problems.push('Each Unit needs a different id.');

  for (const unit of draft.units) {
    const itemIds = [...unit.briefingCards.map((card) => card.id), ...unit.drills.map((drill) => drill.id)];
    if (new Set(itemIds).size !== itemIds.length) problems.push(`Unit "${unit.title}": each BriefingCard and Drill needs a different id.`);
    for (const drill of unit.drills) {
      const label = `Unit "${unit.title}", Drill ${drill.id}`;
      if (!pillarIds.has(drill.competencyPillarId)) problems.push(`${label}: the CompetencyPillar does not exist in this Track.`);
      if (drill.kind === 'MULTIPLE_CHOICE' && !drill.options.some((option) => option.id === drill.correctOptionId)) {
        problems.push(`${label}: the correct answer must be one of the 4 options.`);
      }
      if (drill.kind === 'FILL_BLANK_CHOICE') {
        if (drill.sentenceTemplate.split(FILL_BLANK_TOKEN).length - 1 !== 1) {
          problems.push(`${label}: the sentence must contain ${FILL_BLANK_TOKEN} exactly once.`);
        }
        if (!drill.wordBank.includes(drill.correctWord)) problems.push(`${label}: the correct word must be in the word bank.`);
      }
    }
  }

  const scenarioIds = draft.simScenarios.map((scenario) => scenario.id);
  if (new Set(scenarioIds).size !== scenarioIds.length) problems.push('Each Simulation scenario needs a different id.');
  const secretById = new Map(secrets.map((config) => [config.scenarioId, config]));
  for (const scenario of draft.simScenarios) {
    const secret = secretById.get(scenario.id);
    if (!secret) {
      problems.push(`Simulation "${scenario.title}" has no persona and grading rubric.`);
      continue;
    }
    if (!scenario.dispositionOptions.includes(secret.expectedDisposition)) {
      problems.push(`Simulation "${scenario.title}": the expected disposition must be one of the disposition options.`);
    }
    for (const criterion of secret.rubricCriteria) {
      if (!pillarIds.has(criterion.competencyPillarId)) {
        problems.push(`Simulation "${scenario.title}", rubric "${criterion.criterionLabel}": the CompetencyPillar does not exist in this Track.`);
      }
    }
  }
  problems.push(...rubricWeightProblems(secrets.filter((config) => scenarioIds.includes(config.scenarioId))));
  return problems;
}

export async function PATCH(req: Request, { params }: RouteContext): Promise<NextResponse> {
  const auth = await requireAuth(req, INTERNAL_OPS_ROLES);
  if (!auth.ok) return auth.response;
  const { trackId } = await params;

  let json: unknown;
  try {
    json = await req.json();
  } catch {
    return jsonError(400, 'VALIDATION_FAILED', 'The request body must be JSON.');
  }
  const parsed = PatchTrackRequestSchema.safeParse(json);
  if (!parsed.success) {
    const first = parsed.error.issues[0];
    return jsonError(400, 'VALIDATION_FAILED', `Check "${first?.path.join('.') || 'body'}": ${first?.message ?? 'invalid value'}.`);
  }
  const edits = parsed.data;

  const [track, draft, secrets] = await Promise.all([
    loadTrack(trackId),
    loadVersion(trackId, DRAFT_VERSION_ID),
    loadSecrets(trackId, DRAFT_VERSION_ID),
  ]);
  if (!track) return jsonError(404, 'NOT_FOUND', 'This Track does not exist.');
  if (isGenerationRunning(track)) {
    return jsonError(409, 'GENERATION_RUNNING', 'A build is running for this Track. Wait for it to finish, then edit.');
  }
  if (!draft) return jsonError(409, 'NO_DRAFT', 'This Track has no draft yet. Build the Track first.');

  const now = Date.now();
  const nextUnits = edits.units ? edits.units.map((unit, index) => ({ ...unit, orderIndex: index })) : draft.units;
  const nextScenarios = edits.simScenarios ?? draft.simScenarios;
  const keptScenarioIds = new Set(nextScenarios.map((scenario) => scenario.id));
  const nextSecretList = (edits.secretScenarios ?? secrets?.scenarios ?? []).filter((config) => keptScenarioIds.has(config.scenarioId));

  const draftCheck = TrackVersionDocSchema.safeParse({ ...draft, units: nextUnits, simScenarios: nextScenarios });
  if (!draftCheck.success) {
    const first = draftCheck.error.issues[0];
    return jsonError(400, 'VALIDATION_FAILED', `The draft is not valid at "${first?.path.join('.')}": ${first?.message}.`);
  }
  const secretsCheck = EvalRubricsDocSchema.safeParse({
    trackId,
    versionId: DRAFT_VERSION_ID,
    scenarios: nextSecretList,
    updatedAt: now,
  });
  if (!secretsCheck.success) {
    const first = secretsCheck.error.issues[0];
    return jsonError(400, 'VALIDATION_FAILED', `The Simulation rubrics are not valid at "${first?.path.join('.')}": ${first?.message}.`);
  }
  const nextDraft: TrackVersionDoc = draftCheck.data;
  const nextSecrets: EvalRubricsDoc = secretsCheck.data;
  const problems = consistencyProblems(nextDraft, nextSecrets.scenarios);
  if (problems.length > 0) return jsonError(400, 'VALIDATION_FAILED', problems.slice(0, 5).join(' '));

  const headerUpdate: Partial<TrackDoc> = { updatedAt: now };
  if (edits.title) headerUpdate.title = edits.title;
  // The header counts describe the published TrackVersion once one exists; they change again at publish.
  if (!track.publishedVersionId) {
    headerUpdate.unitCount = nextDraft.units.length;
    headerUpdate.simScenarioCount = nextDraft.simScenarios.length;
    headerUpdate.estimatedTotalMinutes = estimateTrackMinutes(nextDraft.units, nextDraft.simScenarios.length);
  }

  const batch = adminDb.batch();
  batch.set(draftRef(trackId), nextDraft);
  batch.set(secretsRef(trackId, DRAFT_VERSION_ID), nextSecrets);
  batch.update(trackRef(trackId), headerUpdate);
  await batch.commit();

  return NextResponse.json({ ok: true as const, updatedAt: now });
}
