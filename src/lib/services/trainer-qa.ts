import { adminDb } from '@/lib/firebase/admin';
import { scenarioEvidenceProvenance } from './scenario-coverage';
import type { SimSessionDoc } from '@/lib/schemas/analytics';
import {
  DRAFT_VERSION_ID,
  type PublicSimScenario,
  type SecretSimScenarioConfig,
  type TrackVersionDoc,
} from '@/lib/schemas/curriculum';
import {
  AssessmentBlueprintDocSchema,
  DrillAttemptDocSchema,
  ScenarioAttemptEvidenceSchema,
  type AssessmentBlueprintDoc,
  type DrillAttemptDoc,
} from '@/lib/schemas/learning';
import { SimSessionDocSchema } from '@/lib/schemas/analytics';
import type {
  ClaimEvidence,
  EvidenceSupportSchema,
  OperationalAsset,
  ReviewStatusSchema,
  SourceBundle,
  SourceConflict,
  SourcePageEvidence,
} from '@/lib/schemas/source-truth';
import { evaluateScenarioSessionEvidence, isEligibleDrillAttempt } from './certification';
import { assessmentBlueprintRef } from './learning-evidence';
import { verifyClaimEvidence, verifySourceExcerpt } from './source-evidence';
import { loadSourceReview, SourceBundleNotFoundError } from './source-store';
import { loadEvalRubrics, loadTrack, loadVersion } from './track-loader';
import type { z } from 'zod';

export const TRAINER_QA_MINIMUM_SAMPLE_SIZE = 5;
export const TRAINER_QA_HIGH_FAILURE_RATE = 0.4;

export const TRAINER_QA_CATEGORIES = [
  'unsupported_evidence',
  'critical_conflict',
  'high_learner_failure',
  'model_disagreement',
] as const;

export type TrainerQaCategory = (typeof TRAINER_QA_CATEGORIES)[number];
export type TrainerQaTargetKind = 'source' | 'claim' | 'rule' | 'asset' | 'scenario' | 'conflict' | 'drill' | 'simulation_session';

export interface TrainerQaFailureMetric {
  sampleSize: number;
  failures: number;
  failureRate: number;
  minimumSampleSize: number;
  highFailureRate: number;
}

export interface TrainerQaItem {
  id: string;
  category: TrainerQaCategory;
  target: {
    kind: TrainerQaTargetKind;
    id: string;
    contextId: string | null;
    label: string;
  };
  title: string;
  summary: string;
  details: string[];
  evidence?: {
    support: z.infer<typeof EvidenceSupportSchema> | 'not_applicable';
    approvalStatus: z.infer<typeof ReviewStatusSchema> | 'retired' | 'not_applicable';
    critical: boolean;
  };
  metric?: TrainerQaFailureMetric;
}

export interface TrainerQaQueue {
  trackId: string;
  draftVersionId: string;
  learningVersionId: string | null;
  generatedAt: number;
  policy: {
    minimumSampleSize: number;
    highFailureRate: number;
  };
  counts: {
    total: number;
    byCategory: Record<TrainerQaCategory, number>;
  };
  items: TrainerQaItem[];
}

export interface TrainerQaSourceData {
  bundle: SourceBundle | null;
  pages: SourcePageEvidence[];
  rulePacks: Awaited<ReturnType<typeof loadSourceReview>>['rulePacks'];
  assets: OperationalAsset[];
  conflicts: SourceConflict[];
}

export interface BuildTrainerQaQueueInput {
  trackId: string;
  draft: TrackVersionDoc;
  learningVersion: TrackVersionDoc | null;
  blueprint: AssessmentBlueprintDoc | null;
  source: TrainerQaSourceData;
  secrets?: SecretSimScenarioConfig[];
  drillAttempts?: readonly DrillAttemptDoc[];
  simSessions?: readonly SimSessionDoc[];
  now?: number;
  minimumSampleSize?: number;
  highFailureRate?: number;
}

export class TrainerQaDataError extends Error {
  constructor() {
    super('Persisted trainer QA evidence is invalid or inconsistent.');
    this.name = 'TrainerQaDataError';
  }
}

const EMPTY_COUNTS = (): Record<TrainerQaCategory, number> => ({
  unsupported_evidence: 0,
  critical_conflict: 0,
  high_learner_failure: 0,
  model_disagreement: 0,
});

function approvedClaim(evidence: ClaimEvidence): boolean {
  return evidence.approvalStatus === 'approved' && Boolean(evidence.reviewerUid) && evidence.reviewedAt !== null;
}

function isReplaySession(session: SimSessionDoc): boolean {
  return session.provenance?.source === 'replay' ||
    session.evaluation?.provenance?.source === 'replay' ||
    session.messages.some((message) => message.provenance?.source === 'replay') ||
    Boolean(session.simulationEvents?.some((event) =>
      event.provenance === 'replay' || event.runtimeProvenance?.source === 'replay'));
}

function scenarioEvidence(session: SimSessionDoc) {
  const source = session.provenance?.source;
  const gates = session.evaluation?.gateResults ?? session.gateResults ?? [];
  return ScenarioAttemptEvidenceSchema.parse({
    sessionId: session.id,
    passed: session.evaluation?.passed ?? false,
    evaluatedAt: new Date(session.evaluation?.evaluatedAt ?? session.updatedAt).toISOString(),
    criticalFailureRuleIds: [...new Set(gates
      .filter((gate) => gate.severity === 'critical' && gate.status === 'fail')
      .map((gate) => gate.ruleId))],
    workflowComplete: session.scenarioState?.wrapUpComplete === true && !gates.some((gate) => gate.status === 'fail'),
    dispositionValid: session.evaluation?.dispositionCorrect === true && session.evaluation.dispositionValidation?.valid === true,
    provenance: scenarioEvidenceProvenance(source),
  });
}

function assessedSessions(input: BuildTrainerQaQueueInput) {
  if (!input.learningVersion || !input.blueprint) return [];
  return (input.simSessions ?? [])
    .filter((session) =>
      session.trackId === input.trackId &&
      session.versionId === input.learningVersion!.versionId &&
      !isReplaySession(session))
    .map((session) => ({
      session,
      assessment: evaluateScenarioSessionEvidence({
        learnerId: session.userId,
        blueprint: input.blueprint!,
        session,
        evidence: scenarioEvidence(session),
        expectedScenarioId: session.scenarioId,
      }),
    }))
    .filter(({ assessment }) => assessment.evidenceEligible);
}

function addSourceItems(items: TrainerQaItem[], input: BuildTrainerQaQueueInput): void {
  const { draft, source } = input;
  if (draft.sourceBundleId && !source.bundle) {
    items.push({
      id: `evidence:source:${draft.sourceBundleId}`,
      category: 'unsupported_evidence',
      target: { kind: 'source', id: draft.sourceBundleId, contextId: draft.versionId, label: 'Draft source bundle' },
      title: 'Source evidence is unavailable',
      summary: 'The draft references a source bundle that could not be loaded. Exact evidence cannot be approved until it is restored or replaced.',
      details: ['Missing source evidence fails closed; no support is inferred from persisted model labels.'],
      evidence: { support: 'unsupported', approvalStatus: 'not_applicable', critical: true },
    });
  }

  const addClaim = (args: {
    evidence: ClaimEvidence;
    ownerId: string;
    ownerLabel: string;
    contextId: string;
    targetKind?: 'claim' | 'rule';
    approved?: (verified: ClaimEvidence) => boolean;
    extraDetails?: string[];
  }) => {
    const verified = verifyClaimEvidence(args.evidence, source.pages, source.conflicts);
    const approved = args.approved?.(verified) ?? approvedClaim(verified);
    if (verified.support === 'supported' && approved) return;
    const reasons = [`Exact source support: ${verified.support.replaceAll('_', ' ')}.`];
    if (!approved) reasons.push('Trainer approval, reviewer identity, and review timestamp are required.');
    reasons.push(...(args.extraDetails ?? []));
    items.push({
      id: `evidence:${args.targetKind ?? 'claim'}:${args.ownerId}:${args.evidence.id}`,
      category: 'unsupported_evidence',
      target: {
        kind: args.targetKind ?? 'claim',
        id: args.evidence.id,
        contextId: args.contextId,
        label: args.ownerLabel,
      },
      title: `${args.ownerLabel} needs exact-evidence review`,
      summary: 'Recomputed source support or trainer approval is incomplete. Persisted support and approval labels are not trusted on their own.',
      details: reasons,
      evidence: {
        support: verified.support,
        approvalStatus: verified.approvalStatus,
        critical: verified.critical,
      },
    });
  };

  for (const unit of draft.units) {
    for (const card of unit.briefingCards) {
      if (!card.evidence?.length) {
        items.push({
          id: `evidence:claim:${card.id}:missing`,
          category: 'unsupported_evidence',
          target: { kind: 'claim', id: card.id, contextId: unit.id, label: `Briefing Card ${card.id}` },
          title: `Briefing Card ${card.id} has no exact evidence`,
          summary: 'Add and approve at least one exact source excerpt for this generated claim.',
          details: ['Missing claim evidence is unsupported.'],
          evidence: { support: 'unsupported', approvalStatus: 'not_applicable', critical: false },
        });
      }
      for (const evidence of card.evidence ?? []) {
        addClaim({ evidence, ownerId: card.id, ownerLabel: `Briefing Card ${card.id}`, contextId: unit.id });
      }
    }
    for (const drill of unit.drills) {
      if (!drill.evidence?.length) {
        items.push({
          id: `evidence:claim:${drill.id}:missing`,
          category: 'unsupported_evidence',
          target: { kind: 'drill', id: drill.id, contextId: unit.id, label: `Drill ${drill.id}` },
          title: `Drill ${drill.id} has no exact evidence`,
          summary: 'Add and approve at least one exact source excerpt for this Drill.',
          details: ['Missing claim evidence is unsupported.'],
          evidence: { support: 'unsupported', approvalStatus: 'not_applicable', critical: false },
        });
      }
      for (const evidence of drill.evidence ?? []) {
        addClaim({ evidence, ownerId: drill.id, ownerLabel: `Drill ${drill.id}`, contextId: unit.id });
      }
    }
  }

  for (const pack of source.rulePacks) {
    for (const rule of pack.rules) {
      addClaim({
        evidence: rule.evidence,
        ownerId: rule.id,
        ownerLabel: `Shared rule ${rule.id}`,
        contextId: pack.id,
        targetKind: 'rule',
        approved: (verified) => approvedClaim(verified) &&
          pack.approvalStatus === 'approved' &&
          rule.approvalStatus === 'approved' &&
          Boolean(rule.approvedByUid) && rule.approvedAt !== null,
        extraDetails: pack.approvalStatus !== 'approved' || rule.approvalStatus !== 'approved'
          ? ['The rule pack and rule must also be approved with reviewer identity and timestamp.']
          : [],
      });
    }
  }

  for (const secret of input.secrets ?? []) {
    const scenario = draft.simScenarios.find((candidate) => candidate.id === secret.scenarioId);
    if (!scenario) continue;
    for (const criterion of secret.rubricCriteria) {
      if (!criterion.evidence?.length) {
        items.push({
          id: `evidence:claim:${criterion.id}:missing`,
          category: 'unsupported_evidence',
          target: { kind: 'claim', id: criterion.id, contextId: scenario.id, label: `Scenario rubric ${criterion.id}` },
          title: `Scenario rubric ${criterion.id} has no exact evidence`,
          summary: 'Add and approve exact source evidence for this trainer-only grading criterion.',
          details: ['Missing rubric evidence is unsupported. No rubric secrets are included in this queue.'],
          evidence: { support: 'unsupported', approvalStatus: 'not_applicable', critical: false },
        });
      }
      for (const evidence of criterion.evidence ?? []) {
        addClaim({
          evidence,
          ownerId: criterion.id,
          ownerLabel: `Scenario rubric ${criterion.id}`,
          contextId: scenario.id,
        });
      }
    }
  }

  for (const asset of source.assets) {
    const invalid = asset.sourceRefs.flatMap((ref) => {
      const result = verifySourceExcerpt(ref, source.pages, {
        critical: true,
        requiresInterfaceDetails: asset.kind === 'workflow' && asset.requiresInterfaceDetails,
      });
      return result.matched ? [] : [`Source page ${ref.pageNumber}: ${result.reason.replaceAll('_', ' ')}.`];
    });
    const approved = asset.status === 'approved' && Boolean(asset.approvedByUid) && asset.approvedAt !== null;
    if (invalid.length === 0 && approved) continue;
    items.push({
      id: `evidence:asset:${asset.id}`,
      category: 'unsupported_evidence',
      target: { kind: 'asset', id: asset.id, contextId: source.bundle?.id ?? null, label: `Operational asset ${asset.id}` },
      title: `Operational asset ${asset.id} needs evidence review`,
      summary: approved ? 'At least one exact asset source reference failed verification.' : 'Exact source verification and complete trainer approval are required.',
      details: [...invalid, ...(approved ? [] : ['Asset approver identity and approval timestamp are required.'])],
      evidence: {
        support: invalid.length > 0 ? 'unsupported' : 'supported',
        approvalStatus: asset.status,
        critical: true,
      },
    });
  }

  for (const scenario of draft.simScenarios) {
    const requirements = scenario.evidenceRequirements;
    if (!requirements) continue;
    const invalidGateIds = requirements.requiredGateIds.filter((gateId) => {
      const refs = requirements.gateSourceRefs[gateId] ?? [];
      return refs.length === 0 || refs.some((ref) => !verifySourceExcerpt(ref, source.pages, { critical: true }).matched);
    });
    if (invalidGateIds.length === 0) continue;
    items.push({
      id: `evidence:scenario:${scenario.id}:gates`,
      category: 'unsupported_evidence',
      target: { kind: 'scenario', id: scenario.id, contextId: draft.versionId, label: scenario.title },
      title: `${scenario.title} has unsupported gate evidence`,
      summary: 'Every required deterministic gate needs at least one exact, verifiable source reference.',
      details: invalidGateIds.map((gateId) => `Review exact evidence for gate ${gateId}.`),
      evidence: { support: 'unsupported', approvalStatus: 'not_applicable', critical: true },
    });
  }
}

function addConflictItems(items: TrainerQaItem[], conflicts: readonly SourceConflict[]): void {
  for (const conflict of conflicts) {
    if (conflict.severity !== 'critical' || (conflict.status !== 'open' && conflict.status !== 'sme_review')) continue;
    items.push({
      id: `critical_conflict:conflict:${conflict.id}`,
      category: 'critical_conflict',
      target: { kind: 'conflict', id: conflict.id, contextId: null, label: `SME conflict ${conflict.id}` },
      title: `Critical SME conflict ${conflict.id} is unresolved`,
      summary: 'Record an explicit SME decision. Neither source value is selected automatically.',
      details: [
        `Status: ${conflict.status.replaceAll('_', ' ')}.`,
        `Affected rules: ${conflict.affectedRuleIds.join(', ') || 'none named'}.`,
        `Affected assets: ${conflict.affectedAssetIds.join(', ') || 'none named'}.`,
      ],
    });
  }
}

function addFailureItems(items: TrainerQaItem[], input: BuildTrainerQaQueueInput, minimumSampleSize: number, highFailureRate: number): void {
  const { learningVersion, blueprint } = input;
  if (!learningVersion || !blueprint) return;
  const drillById = new Map(learningVersion.units.flatMap((unit) => unit.drills.map((drill) => [drill.id, { drill, unit }] as const)));
  const drillGroups = new Map<string, { total: number; failures: number }>();
  for (const attempt of input.drillAttempts ?? []) {
    if (!isEligibleDrillAttempt(attempt, {
      learnerId: attempt.learnerId,
      blueprint,
    }) || !drillById.has(attempt.drillId)) continue;
    const group = drillGroups.get(attempt.drillId) ?? { total: 0, failures: 0 };
    group.total += 1;
    if (!attempt.correct) group.failures += 1;
    drillGroups.set(attempt.drillId, group);
  }
  for (const [drillId, group] of drillGroups) {
    const failureRate = group.failures / group.total;
    if (group.total < minimumSampleSize || failureRate < highFailureRate) continue;
    const owner = drillById.get(drillId)!;
    items.push({
      id: `high_learner_failure:drill:${drillId}`,
      category: 'high_learner_failure',
      target: { kind: 'drill', id: drillId, contextId: owner.unit.id, label: owner.drill.prompt },
      title: `Drill ${drillId} has high learner failure`,
      summary: `${group.failures} of ${group.total} eligible current-version Drill attempts were incorrect.`,
      details: ['Rates count persisted eligible attempts, not unique learners. Imported legacy and non-current attempts are excluded.'],
      metric: {
        sampleSize: group.total,
        failures: group.failures,
        failureRate,
        minimumSampleSize,
        highFailureRate,
      },
    });
  }

  const scenarioGroups = new Map<string, { total: number; failures: number }>();
  for (const { session, assessment } of assessedSessions(input)) {
    const group = scenarioGroups.get(session.scenarioId) ?? { total: 0, failures: 0 };
    group.total += 1;
    if (!assessment.certificationPass) group.failures += 1;
    scenarioGroups.set(session.scenarioId, group);
  }
  for (const [scenarioId, group] of scenarioGroups) {
    const failureRate = group.failures / group.total;
    if (group.total < minimumSampleSize || failureRate < highFailureRate) continue;
    const scenario = learningVersion.simScenarios.find((candidate) => candidate.id === scenarioId);
    if (!scenario) continue;
    items.push({
      id: `high_learner_failure:scenario:${scenarioId}`,
      category: 'high_learner_failure',
      target: { kind: 'scenario', id: scenarioId, contextId: learningVersion.versionId, label: scenario.title },
      title: `${scenario.title} has high learner failure`,
      summary: `${group.failures} of ${group.total} eligible evaluated Simulations did not meet all current assessment requirements.`,
      details: ['Failures use deterministic gates, eligibility, disposition, workflow evidence, model pass claims, and the passing threshold. Replay is excluded.'],
      metric: {
        sampleSize: group.total,
        failures: group.failures,
        failureRate,
        minimumSampleSize,
        highFailureRate,
      },
    });
  }
}

function modelDisagreementReasons(session: SimSessionDoc, scenario: PublicSimScenario): string[] {
  const evaluation = session.evaluation;
  const eligibility = evaluation?.assessmentEligibility;
  const disposition = evaluation?.dispositionValidation;
  if (!evaluation || !eligibility || !disposition) return [];
  const gates = evaluation.gateResults ?? session.gateResults ?? [];
  const criticalFailure = eligibility.deterministicCriticalFailure ||
    gates.some((gate) => gate.severity === 'critical' && gate.status === 'fail');
  const passingScore = evaluation.overallScorePct >= scenario.passScoreThreshold;
  const positiveModelClaim = evaluation.passed || passingScore;
  const reasons: string[] = [];
  if (criticalFailure && positiveModelClaim) {
    reasons.push(`Deterministic critical failure conflicts with ${evaluation.passed ? 'the persisted model pass claim' : `a passing score of ${evaluation.overallScorePct}%`}.`);
  }
  if (!eligibility.eligible && positiveModelClaim) {
    reasons.push(`Deterministic assessment ineligibility conflicts with ${evaluation.passed ? 'the persisted model pass claim' : `a passing score of ${evaluation.overallScorePct}%`}.`);
  }
  if (!disposition.valid && (evaluation.dispositionCorrect || positiveModelClaim)) {
    const claims = [
      evaluation.dispositionCorrect ? 'a correct-disposition claim' : null,
      evaluation.passed ? 'a pass claim' : null,
      passingScore ? `a passing score of ${evaluation.overallScorePct}%` : null,
    ].filter(Boolean).join(', ');
    reasons.push(`Deterministic disposition rejection conflicts with ${claims}.`);
  }
  return [...new Set(reasons)];
}

function addModelDisagreementItems(items: TrainerQaItem[], input: BuildTrainerQaQueueInput): void {
  if (!input.learningVersion) return;
  for (const { session } of assessedSessions(input)) {
    const scenario = input.learningVersion.simScenarios.find((candidate) => candidate.id === session.scenarioId);
    if (!scenario) continue;
    const reasons = modelDisagreementReasons(session, scenario);
    if (reasons.length === 0) continue;
    items.push({
      id: `model_disagreement:simulation_session:${session.id}`,
      category: 'model_disagreement',
      target: { kind: 'simulation_session', id: session.id, contextId: scenario.id, label: scenario.title },
      title: `${scenario.title}: deterministic verdict conflicts with judge output`,
      summary: 'Review the persisted evaluation and deterministic evidence. The deterministic verdict remains authoritative.',
      details: reasons,
    });
  }
}

/** Pure aggregation over persisted records. No model execution and no client-provided classification flags. */
export function buildTrainerQaQueue(input: BuildTrainerQaQueueInput): TrainerQaQueue {
  const minimumSampleSize = input.minimumSampleSize ?? TRAINER_QA_MINIMUM_SAMPLE_SIZE;
  const highFailureRate = input.highFailureRate ?? TRAINER_QA_HIGH_FAILURE_RATE;
  if (!Number.isInteger(minimumSampleSize) || minimumSampleSize < 1) throw new TrainerQaDataError();
  if (!Number.isFinite(highFailureRate) || highFailureRate <= 0 || highFailureRate > 1) throw new TrainerQaDataError();
  if (input.draft.trackId !== input.trackId ||
    (input.learningVersion && input.learningVersion.trackId !== input.trackId)) throw new TrainerQaDataError();
  if (input.blueprint && (!input.learningVersion ||
    input.blueprint.trackId !== input.trackId ||
    input.blueprint.curriculumVersion !== input.learningVersion.versionId)) throw new TrainerQaDataError();
  if (input.learningVersion && !input.blueprint) throw new TrainerQaDataError();

  const items: TrainerQaItem[] = [];
  addSourceItems(items, input);
  addConflictItems(items, input.source.conflicts);
  addFailureItems(items, input, minimumSampleSize, highFailureRate);
  addModelDisagreementItems(items, input);

  const categoryOrder = new Map(TRAINER_QA_CATEGORIES.map((category, index) => [category, index]));
  items.sort((left, right) =>
    categoryOrder.get(left.category)! - categoryOrder.get(right.category)! ||
    left.title.localeCompare(right.title) || left.id.localeCompare(right.id));
  const byCategory = EMPTY_COUNTS();
  for (const item of items) byCategory[item.category] += 1;
  return {
    trackId: input.trackId,
    draftVersionId: input.draft.versionId,
    learningVersionId: input.learningVersion?.versionId ?? null,
    generatedAt: input.now ?? Date.now(),
    policy: { minimumSampleSize, highFailureRate },
    counts: { total: items.length, byCategory },
    items,
  };
}

function invalidData(): never {
  throw new TrainerQaDataError();
}

/** Load the trainer queue from current persisted draft and current published learning evidence. */
export async function loadTrainerQaQueue(trackId: string): Promise<TrainerQaQueue | null> {
  const track = await loadTrack(trackId);
  if (!track) return null;
  const draft = await loadVersion(trackId, DRAFT_VERSION_ID);
  if (!draft) invalidData();
  const learningVersion = track.publishedVersionId ? await loadVersion(trackId, track.publishedVersionId) : null;
  if (track.publishedVersionId && !learningVersion) invalidData();

  let source: TrainerQaSourceData = { bundle: null, pages: [], rulePacks: [], assets: [], conflicts: [] };
  if (draft.sourceBundleId) {
    try {
      source = await loadSourceReview(trackId, draft.sourceBundleId);
    } catch (error) {
      if (!(error instanceof SourceBundleNotFoundError)) throw error;
    }
  }
  const secrets = await loadEvalRubrics(trackId, DRAFT_VERSION_ID);

  let blueprint: AssessmentBlueprintDoc | null = null;
  let drillAttempts: DrillAttemptDoc[] = [];
  let simSessions: SimSessionDoc[] = [];
  if (learningVersion) {
    const blueprintSnap = await assessmentBlueprintRef(trackId, learningVersion.versionId).get();
    if (!blueprintSnap.exists) invalidData();
    const parsedBlueprint = AssessmentBlueprintDocSchema.safeParse(blueprintSnap.data());
    if (!parsedBlueprint.success) invalidData();
    blueprint = parsedBlueprint.data;

    // Single-field Track queries avoid requiring a new composite index; version filtering is local.
    const [attemptSnap, sessionSnap] = await Promise.all([
      adminDb.collection('drillAttempts').where('trackId', '==', trackId).get(),
      adminDb.collection('simSessions').where('trackId', '==', trackId).get(),
    ]);
    drillAttempts = attemptSnap.docs.map((doc) => {
      const parsed = DrillAttemptDocSchema.safeParse({ ...doc.data(), id: doc.id });
      if (!parsed.success) invalidData();
      return parsed.data;
    }).filter((attempt) => attempt.curriculumVersion === learningVersion.versionId);
    simSessions = sessionSnap.docs.map((doc) => {
      const parsed = SimSessionDocSchema.safeParse({ ...doc.data(), id: doc.id });
      if (!parsed.success) invalidData();
      return parsed.data;
    }).filter((session) => session.versionId === learningVersion.versionId);
  }

  return buildTrainerQaQueue({
    trackId,
    draft,
    learningVersion,
    blueprint,
    source,
    secrets: secrets?.scenarios ?? [],
    drillAttempts,
    simSessions,
  });
}
