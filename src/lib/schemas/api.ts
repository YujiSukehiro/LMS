/**
 * Frozen REST + SSE contracts shared by API route handlers and UI components (docs/06 §2).
 */
import { z } from 'zod';
import { DivisionIdSchema, UserDocSchema, UserRoleSchema } from './domain';
import {
  BriefingCardSchema,
  DrillItemSchema,
  GenerationStepSchema,
  PublicSimScenarioSchema,
  SecretSimScenarioConfigSchema,
  TrackUnitSchema,
} from './curriculum';
import { EnrollmentDocSchema, SimEvaluationSchema, SimSessionDocSchema } from './analytics';
import { ClaimEvidenceSchema } from './source-truth';
import {
  AttemptKindSchema,
  DrillAnswerSchema,
  CertificationDocSchema,
  DrillAttemptDocSchema,
  ReviewScheduleDocSchema,
} from './learning';
import {
  ScenarioQAFixtureSchema,
  ScenarioStateSchema,
  SimulationActionSchema,
  SimulationAssessmentEligibilitySchema,
  SimulationEventSchema,
  SimulationGateResultSchema,
  SyntheticOutboxRecordSchema,
} from './simulation-state';

// ---------- Generic error body ----------
export const ApiErrorBodySchema = z.object({
  error: z.string(), // Machine code, e.g. 'UNAUTHENTICATED', 'FORBIDDEN', 'ACCOUNT_DEACTIVATED', 'VALIDATION_FAILED'
  message: z.string().optional(), // Plain-English message for the UI
  details: z.unknown().optional(),
});
export type ApiErrorBody = z.infer<typeof ApiErrorBodySchema>;

// ---------- Auth ----------
export const CreateSessionRequestSchema = z.object({ idToken: z.string().min(10) });
export const CreateSessionResponseSchema = z.object({
  user: UserDocSchema,
  refreshClaimsRequired: z.boolean(),
});
export type CreateSessionResponse = z.infer<typeof CreateSessionResponseSchema>;

export const ClaimInviteRequestSchema = z.object({
  joinCode: z.string().min(3).max(40),
  displayName: z.string().min(1).max(100),
  lcNumber: z.string().regex(/^LC-\d+$/i, 'LC Number must look like LC-1042'),
  password: z.string().min(8).max(128),
});
export const ClaimInviteResponseSchema = z.object({ emailForSignIn: z.string() });

// ---------- Tracks ----------
export const UploadTrackFieldsSchema = z.object({
  title: z.string().min(3).max(100),
  campaignCode: z.string().max(32).default(''),
  divisionId: DivisionIdSchema,
});
export const UploadTrackModeSchema = z.enum(['new-bundle', 'append-document']);
export const UploadTrackResponseSchema = z.object({
  trackId: z.string(),
  pageCount: z.number().int(),
  bundleId: z.string(),
  documentId: z.string(),
  sourceRevision: z.string(),
});

const SourceRevisionSchema = z.string().regex(/^sha256:[a-f0-9]{64}$/);
const SourceReviewBaseFields = {
  bundleId: z.string().min(1),
  expectedRevisionHash: SourceRevisionSchema.optional(),
};
const EffectiveDateSchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable().optional();

/** Trainer review commands. Approval identity and support labels are always recomputed on the server. */
export const SourceReviewRequestSchema = z.discriminatedUnion('action', [
  z.object({
    action: z.literal('approve_excerpt'),
    ...SourceReviewBaseFields,
    evidence: ClaimEvidenceSchema.optional(),
    evidenceId: z.string().min(1).optional(),
    claimId: z.string().min(1).optional(),
    approvalStatus: z.literal('approved').optional(),
  }).strict(),
  z.object({
    action: z.literal('approve_transcription'),
    ...SourceReviewBaseFields,
    pageId: z.string().min(1).optional(),
    documentId: z.string().min(1).optional(),
    revisionId: z.string().min(1).optional(),
    pageNumber: z.number().int().positive().optional(),
    text: z.string().min(1).max(100_000),
  }).strict(),
  z.object({
    action: z.literal('approve_asset'),
    ...SourceReviewBaseFields,
    assetId: z.string().min(1),
  }).strict(),
  z.object({
    action: z.literal('approve_rule_pack'),
    ...SourceReviewBaseFields,
    rulePackId: z.string().min(1),
    ruleId: z.string().min(1).optional(),
  }).strict(),
  z.object({
    action: z.literal('approve_bundle'),
    ...SourceReviewBaseFields,
  }).strict(),
  z.object({
    action: z.literal('assign_conflict'),
    ...SourceReviewBaseFields,
    conflictId: z.string().min(1),
  }).strict(),
  z.object({
    action: z.literal('record_conflict_decision'),
    ...SourceReviewBaseFields,
    conflictId: z.string().min(1),
    status: z.enum(['resolved', 'accepted_context_difference']),
    decision: z.string().min(1).max(5_000),
    effectiveFrom: EffectiveDateSchema,
    effectiveTo: EffectiveDateSchema,
  }).strict(),
]);
export type SourceReviewRequest = z.infer<typeof SourceReviewRequestSchema>;

/** SSE `event: progress` payload for GET /api/tracks/[trackId]/generate */
export const GenerateProgressEventSchema = z.object({
  step: GenerationStepSchema,
  percent: z.number().min(0).max(100),
  message: z.string(),
});
export type GenerateProgressEvent = z.infer<typeof GenerateProgressEventSchema>;
/** SSE `event: complete` payload */
export const GenerateCompleteEventSchema = z.object({ trackId: z.string(), versionId: z.string() });
export type GenerateCompleteEvent = z.infer<typeof GenerateCompleteEventSchema>;
/** SSE `event: error` payload */
export const SseErrorEventSchema = z.object({ message: z.string() });
export type SseErrorEvent = z.infer<typeof SseErrorEventSchema>;

export const PatchTrackRequestSchema = z.object({
  title: z.string().min(3).max(100).optional(),
  units: z.array(TrackUnitSchema).optional(),
  simScenarios: z.array(PublicSimScenarioSchema).optional(),
  /** Internal-ops-only edits to the draft secret Simulation configs. */
  secretScenarios: z.array(SecretSimScenarioConfigSchema).optional(),
});
export type PatchTrackRequest = z.infer<typeof PatchTrackRequestSchema>;
export const PatchTrackResponseSchema = z.object({ ok: z.literal(true), updatedAt: z.number() });

export const RegenerateItemRequestSchema = z.object({
  targetType: z.enum(['CARD', 'DRILL', 'SCENARIO']),
  unitId: z.string().optional(),
  itemId: z.string(),
  trainerHint: z.string().max(400).optional(),
});
export type RegenerateItemRequest = z.infer<typeof RegenerateItemRequestSchema>;
export const RegenerateItemResponseSchema = z.object({
  item: z.union([BriefingCardSchema, DrillItemSchema, PublicSimScenarioSchema]),
});

export const PublishTrackRequestSchema = z.object({ assignedCohortIds: z.array(z.string()).min(1) });
export const PublishTrackResponseSchema = z.object({ publishedVersionId: z.string() });

// ---------- Progress ----------
export const DrillResultSchema = z.object({
  drillId: z.string(),
  competencyPillarId: z.string(),
  passedFirstTry: z.boolean(),
});
export type DrillResult = z.infer<typeof DrillResultSchema>;

export const DrillStartRequestSchema = z.object({
  trackId: z.string().min(1),
  versionId: z.string().min(1),
  unitId: z.string().min(1),
  drillId: z.string().min(1),
}).strict();
export type DrillStartRequest = z.infer<typeof DrillStartRequestSchema>;
export const DrillStartResponseSchema = z.object({
  startId: z.string().min(1),
  startedAt: z.string().datetime(),
});
export type DrillStartResponse = z.infer<typeof DrillStartResponseSchema>;

export const DrillAnswerRequestSchema = z.object({
  trackId: z.string().min(1),
  versionId: z.string().min(1),
  unitId: z.string().min(1),
  drillId: z.string().min(1),
  startId: z.string().min(1),
  idempotencyKey: z.string().min(8).max(200),
  answer: DrillAnswerSchema,
}).strict();
export type DrillAnswerRequest = z.infer<typeof DrillAnswerRequestSchema>;
export const DrillAnswerResponseSchema = z.object({
  attempt: DrillAttemptDocSchema.nullable(),
  correct: z.boolean(),
  score: z.number().min(0).max(100),
  firstIndependent: z.boolean(),
  attemptKind: AttemptKindSchema,
  correctAnswer: DrillAnswerSchema.nullable(),
  explanation: z.string().max(350).nullable(),
  sourcePages: z.array(z.number().int().positive()),
  schedule: ReviewScheduleDocSchema.nullable(),
}).strict();
export type DrillAnswerResponse = z.infer<typeof DrillAnswerResponseSchema>;

export const CompleteUnitRequestSchema = z.object({
  trackId: z.string().min(1),
  versionId: z.string().min(1),
  unitId: z.string().min(1),
  idempotencyKey: z.string().min(8).max(200),
}).strict();
export type CompleteUnitRequest = z.infer<typeof CompleteUnitRequestSchema>;
export const CompleteUnitResponseSchema = z.object({
  xpAwarded: z.number().int().nonnegative(),
  enrollment: EnrollmentDocSchema,
});
export type CompleteUnitResponse = z.infer<typeof CompleteUnitResponseSchema>;

// ---------- Simulations ----------
export const StartSimRequestSchema = z.object({
  trackId: z.string(),
  versionId: z.string(),
  scenarioId: z.string(),
});
export type StartSimRequest = z.infer<typeof StartSimRequestSchema>;
export const StartSimResponseSchema = z.object({ session: SimSessionDocSchema });

export const SimMessageRequestSchema = z.object({ content: z.string().min(1).max(2000) });
export const SimulationActionRequestSchema = z.object({ action: SimulationActionSchema }).strict();
export const SimulationActionResponseSchema = z.object({
  session: SimSessionDocSchema,
  outboxRecord: SyntheticOutboxRecordSchema.nullable(),
});

/** Internal-ops, read-only execution of trainer-authored deterministic Simulation fixtures. */
export const ScenarioQARequestSchema = z.object({
  scenario: PublicSimScenarioSchema.strict(),
  fixtures: z.array(ScenarioQAFixtureSchema.strict()).min(1).max(20),
  fixtureId: z.string().min(1).optional(),
}).strict().superRefine((body, context) => {
  body.fixtures.forEach((fixture, index) => {
    if (fixture.steps.length > 100) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['fixtures', index, 'steps'],
        message: 'A QA fixture can contain at most 100 scripted steps.',
      });
    }
  });
});
export type ScenarioQARequest = z.infer<typeof ScenarioQARequestSchema>;

const ScenarioQAEventValueSchema = z.union([
  z.string(),
  z.number().finite(),
  z.boolean(),
  z.null(),
  z.array(z.string()),
]);
export const ScenarioQAEventResultSchema = z.object({
  id: z.string().min(1),
  sequence: z.number().int().positive(),
  type: SimulationEventSchema.shape.type,
  actor: SimulationEventSchema.shape.actor,
  provenance: SimulationEventSchema.shape.provenance,
  /** Whitelisted structured metadata; transcript, notes, correction text, tokens and hashes are never returned. */
  payload: z.record(z.string(), ScenarioQAEventValueSchema),
}).strict();
export const ScenarioQAGateResultSchema = SimulationGateResultSchema.omit({ sourceRefs: true }).extend({
  sourceRefCount: z.number().int().nonnegative(),
}).strict();
export const ScenarioQAResultSchema = z.object({
  fixtureId: z.string().min(1),
  title: z.string().min(1),
  kind: ScenarioQAFixtureSchema.shape.kind,
  passed: z.boolean(),
  outcome: ScenarioStateSchema.pick({
    lifecycle: true,
    selectedDisposition: true,
    dispositionCorrect: true,
    wrapUpComplete: true,
  }).strict(),
  events: z.array(ScenarioQAEventResultSchema),
  gates: z.array(ScenarioQAGateResultSchema),
  eligibility: SimulationAssessmentEligibilitySchema.strict(),
  errors: z.array(z.string()),
  expectationFailures: z.array(z.string()),
}).strict();
export type ScenarioQAResult = z.infer<typeof ScenarioQAResultSchema>;
export const ScenarioQAResponseSchema = z.object({
  trackId: z.string().min(1),
  scenarioId: z.string().min(1),
  results: z.array(ScenarioQAResultSchema),
}).strict();
export type ScenarioQAResponse = z.infer<typeof ScenarioQAResponseSchema>;

/** SSE `event: token` payload */
export const SimTokenEventSchema = z.object({ token: z.string() });
/** SSE `event: done` payload */
export const SimDoneEventSchema = z.object({ simEnded: z.boolean(), turnCount: z.number().int() });
export type SimDoneEvent = z.infer<typeof SimDoneEventSchema>;

export const EvaluateSimRequestSchema = z.object({ selectedDisposition: z.string().min(1).max(80) });
export const EvaluateSimResponseSchema = z.object({
  evaluation: SimEvaluationSchema,
  certified: z.boolean(),
  /** Explicit inspection-only marker for Demo replay; omitted by assessed flows. */
  demoReplay: z.boolean().optional(),
});
export type EvaluateSimResponse = z.infer<typeof EvaluateSimResponseSchema>;

// ---------- Certification administration (server-derived transitions only) ----------
export const RevokeCertificationRequestSchema = z.object({
  learnerId: z.string().min(1),
  trackId: z.string().min(1),
  reason: z.string().trim().min(1).max(1_000),
}).strict();
export const RevokeCertificationResponseSchema = z.object({ certification: CertificationDocSchema }).strict();

export const ReconcileCertificationRequestSchema = z.object({
  learnerId: z.string().min(1),
  trackId: z.string().min(1),
  reason: z.string().trim().min(1).max(1_000),
}).strict();
export const ReconcileCertificationResponseSchema = z.object({
  certification: CertificationDocSchema.nullable(),
  blockers: z.array(z.string()),
}).strict();

// ---------- Roster ----------
export const RosterImportRowSchema = z
  .object({
    displayName: z.string().min(1).max(100),
    lcNumber: z.string().regex(/^LC-\d+$/i).optional(),
    email: z.string().email().optional(),
    role: UserRoleSchema,
    partnerCohortId: z.string().min(2).max(32),
    divisionIds: z.array(DivisionIdSchema).min(1),
    initialPassword: z.string().min(8).max(128).optional(),
  })
  .refine((row) => Boolean(row.lcNumber || row.email), { message: 'Each row needs an LC Number or an email.' });
export type RosterImportRow = z.infer<typeof RosterImportRowSchema>;
export const RosterImportRequestSchema = z.object({ rows: z.array(RosterImportRowSchema).min(1).max(500) });
export const RosterImportResponseSchema = z.object({
  createdCount: z.number().int(),
  errors: z.array(z.object({ rowIndex: z.number().int(), message: z.string() })),
  credentialsCsv: z.string(),
});
export type RosterImportResponse = z.infer<typeof RosterImportResponseSchema>;

export const RosterStatusRequestSchema = z.object({ active: z.boolean() });
export const RosterStatusResponseSchema = z.object({ ok: z.literal(true), uid: z.string(), active: z.boolean() });

// ---------- System ----------
export const AiHealthResponseSchema = z.object({
  ok: z.boolean(),
  provider: z.string(),
  models: z.array(z.string()),
  status: z.enum(['ready', 'degraded', 'blocked', 'not_configured', 'demo', 'manual']).optional(),
  runtimeLabel: z.string().optional(),
  capabilities: z.array(z.object({
    capability: z.string(),
    status: z.enum(['passed', 'failed', 'not_tested']),
    model: z.string().optional(),
    latencyMs: z.number().int().nonnegative(),
    outputChars: z.number().int().nonnegative().optional(),
    lastSuccessAt: z.string().optional(),
    error: z.string().optional(),
    nextStep: z.string().optional(),
  })).optional(),
  error: z.string().optional(),
});
export type AiHealthResponse = z.infer<typeof AiHealthResponseSchema>;
