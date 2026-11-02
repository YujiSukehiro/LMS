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
export const UploadTrackResponseSchema = z.object({ trackId: z.string(), pageCount: z.number().int() });

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

export const CompleteUnitRequestSchema = z.object({
  trackId: z.string(),
  versionId: z.string(),
  unitId: z.string(),
  drillResults: z.array(DrillResultSchema).min(1),
});
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
/** SSE `event: token` payload */
export const SimTokenEventSchema = z.object({ token: z.string() });
/** SSE `event: done` payload */
export const SimDoneEventSchema = z.object({ simEnded: z.boolean(), turnCount: z.number().int() });
export type SimDoneEvent = z.infer<typeof SimDoneEventSchema>;

export const EvaluateSimRequestSchema = z.object({ selectedDisposition: z.string().min(1).max(80) });
export const EvaluateSimResponseSchema = z.object({
  evaluation: SimEvaluationSchema,
  certified: z.boolean(),
});
export type EvaluateSimResponse = z.infer<typeof EvaluateSimResponseSchema>;

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
  error: z.string().optional(),
});
export type AiHealthResponse = z.infer<typeof AiHealthResponseSchema>;
