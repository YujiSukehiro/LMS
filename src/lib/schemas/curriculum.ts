import { z } from 'zod';
import { DivisionIdSchema } from './domain';
import { ProvenanceRecordSchema } from '@/lib/ai/provenance';
import { ClaimEvidenceSchema } from './source-truth';
import { ScenarioContextSchema, ScenarioEvidenceRequirementsSchema, ScenarioQAFixtureSchema } from './simulation-state';

/** The 8 canonical LogiCall skill keys (docs/04 §3.2). */
export const CanonicalPillarKeySchema = z.enum([
  'verification_crm',
  'product_offer_terms',
  'retention_objection',
  'escalation_triage',
  'compliance_boundaries',
  'empathy_communication',
  'closing_next_steps',
  'workflow_execution',
]);
export type CanonicalPillarKey = z.infer<typeof CanonicalPillarKeySchema>;

export const CompetencyPillarSchema = z.object({
  id: z.string(), // e.g., "pillar_verification"
  key: z.string(), // Normalized cross-track key, one of CanonicalPillarKeySchema values
  label: z.string(), // e.g., "Identity & CRM Verification"
  description: z.string(),
});
export type CompetencyPillar = z.infer<typeof CompetencyPillarSchema>;

// --- STAGE 1: BRIEFING CARDS (LEARN) ---
export const BriefingCardSchema = z.object({
  id: z.string(),
  headline: z.string().max(90),
  bodyMarkdown: z.string().max(600), // Concise operational rule (2-4 sentences max)
  keyTakeaway: z.string().max(160), // Highlighted callout banner
  doList: z.array(z.string().max(140)).max(4),
  dontList: z.array(z.string().max(140)).max(4),
  sourcePages: z.array(z.number().int().positive()),
  evidence: z.array(ClaimEvidenceSchema).optional(),
});
export type BriefingCard = z.infer<typeof BriefingCardSchema>;

// --- STAGE 2: 5 INTERACTIVE DRILL MECHANICS (TEST) ---
const BaseDrillFields = {
  id: z.string(),
  competencyPillarId: z.string(),
  prompt: z.string().max(300),
  explanation: z.string().max(350), // Displayed immediately after answering
  sourcePages: z.array(z.number().int().positive()),
  evidence: z.array(ClaimEvidenceSchema).optional(),
  /** Stable rule mapping for server-scored mastery and approved varied-retrieval items. */
  ruleIds: z.array(z.string().min(1)).optional(),
  variationOfDrillId: z.string().nullable().optional(),
};

export const MultipleChoiceDrillSchema = z.object({
  ...BaseDrillFields,
  kind: z.literal('MULTIPLE_CHOICE'),
  options: z.array(z.object({ id: z.string(), text: z.string().max(180) })).length(4),
  correctOptionId: z.string(),
});

export const TrueFalseSpotDrillSchema = z.object({
  ...BaseDrillFields,
  kind: z.literal('TRUE_FALSE_SPOT'),
  statement: z.string().max(260),
  isCompliant: z.boolean(), // true = Follows Policy, false = Policy Violation
});

export const SequenceOrderDrillSchema = z.object({
  ...BaseDrillFields,
  kind: z.literal('SEQUENCE_ORDER'),
  // Stored in canonical correct order in DB; client shuffles deterministically on render
  orderedSteps: z.array(z.object({ id: z.string(), text: z.string().max(140) })).min(3).max(5),
});

export const MatchPairsDrillSchema = z.object({
  ...BaseDrillFields,
  kind: z.literal('MATCH_PAIRS'),
  pairs: z
    .array(
      z.object({
        id: z.string(),
        leftPrompt: z.string().max(100),
        rightMatch: z.string().max(100),
      }),
    )
    .min(3)
    .max(4),
});

export const FillBlankChoiceDrillSchema = z.object({
  ...BaseDrillFields,
  kind: z.literal('FILL_BLANK_CHOICE'),
  // Template contains exact placeholder token "{{BLANK}}"
  sentenceTemplate: z.string().max(260),
  wordBank: z.array(z.string().max(60)).length(4),
  correctWord: z.string().max(60),
});

export const DrillItemSchema = z.discriminatedUnion('kind', [
  MultipleChoiceDrillSchema,
  TrueFalseSpotDrillSchema,
  SequenceOrderDrillSchema,
  MatchPairsDrillSchema,
  FillBlankChoiceDrillSchema,
]);
export type DrillItem = z.infer<typeof DrillItemSchema>;
export type DrillKind = DrillItem['kind'];
export type MultipleChoiceDrill = z.infer<typeof MultipleChoiceDrillSchema>;
export type TrueFalseSpotDrill = z.infer<typeof TrueFalseSpotDrillSchema>;
export type SequenceOrderDrill = z.infer<typeof SequenceOrderDrillSchema>;
export type MatchPairsDrill = z.infer<typeof MatchPairsDrillSchema>;
export type FillBlankChoiceDrill = z.infer<typeof FillBlankChoiceDrillSchema>;

export const DRILL_KINDS = [
  'MULTIPLE_CHOICE',
  'TRUE_FALSE_SPOT',
  'SEQUENCE_ORDER',
  'MATCH_PAIRS',
  'FILL_BLANK_CHOICE',
] as const satisfies readonly DrillKind[];

export const FILL_BLANK_TOKEN = '{{BLANK}}';

export const TrackUnitSchema = z.object({
  id: z.string(),
  orderIndex: z.number().int().nonnegative(),
  title: z.string().max(80),
  summary: z.string().max(180),
  estimatedMinutes: z.number().int().min(2).max(15),
  // Counts are sized per Unit from source depth (src/lib/ai/pipeline/content-depth.ts).
  // Drafts may hold fewer items when a local model's batch was only partly salvageable; such Units
  // carry a reviewNotes entry and the publish route blocks them below the DEPTH_LIMITS minimums.
  briefingCards: z.array(BriefingCardSchema).min(1).max(8),
  drills: z.array(DrillItemSchema).min(1).max(10),
  /** Trainer-visible build notes (for example "needs more Drills"). Absent on complete Units. */
  reviewNotes: z.array(z.string().min(1).max(300)).max(10).optional(),
});
export type TrackUnit = z.infer<typeof TrackUnitSchema>;

// --- STAGE 3: LIVE CALL SIM (PUBLIC LEARNER VIEW VS. SERVER-ONLY SECRETS) ---
export const PublicSimScenarioSchema = z.object({
  id: z.string(),
  title: z.string().max(80), // e.g., "Medical Side-Effect Refund Request"
  difficulty: z.enum(['STANDARD', 'EDGE_CASE', 'HIGH_PRESSURE']),
  counterpartyRoleLabel: z.string().max(60), // e.g., "Inbound Buyer" | "Telehealth Patient" | "Outbound Lead"
  contextTicketSummary: z.string().max(280), // Displayed in agent header (Queue, Campaign, Channel)
  openingMessage: z.string().max(350), // First message from the simulated caller/patient
  dispositionOptions: z.array(z.string().max(80)).min(3).max(6),
  maxTurns: z.number().int().min(6).max(12).default(8),
  passScoreThreshold: z.number().int().min(60).max(95).default(80),
  /** Required for all new runs; optional only so historical curriculum records remain readable. */
  context: ScenarioContextSchema.optional(),
  evidenceRequirements: ScenarioEvidenceRequirementsSchema.optional(),
});
export type PublicSimScenario = z.infer<typeof PublicSimScenarioSchema>;

export const RubricCriterionSchema = z.object({
  id: z.string(),
  competencyPillarId: z.string(),
  criterionLabel: z.string().max(100),
  evaluationRule: z.string().max(300), // Exact PDF-grounded rule for the Judge LLM
  weight: z.number().int().min(10).max(50), // Weights across a scenario sum to 100
  sourcePages: z.array(z.number().int().positive()),
  evidence: z.array(ClaimEvidenceSchema).optional(),
});
export type RubricCriterion = z.infer<typeof RubricCriterionSchema>;

// Stored ONLY in /tracks/{trackId}/versions/{versionId}/secrets/evalRubrics
export const SecretSimScenarioConfigSchema = z.object({
  scenarioId: z.string(),
  personaName: z.string(),
  personaBackstoryAndMood: z.string().max(400),
  hiddenFactsToRevealOnlyWhenAsked: z.array(z.string().max(180)),
  conditionalBehaviors: z.array(z.string().max(220)),
  expectedDisposition: z.string(),
  autoFailTriggers: z.array(z.string().max(180)),
  rubricCriteria: z.array(RubricCriterionSchema).min(3).max(6),
  /** Scripted assessment fixtures are trainer-only and never enter actor prompts. */
  qaFixtures: z.array(ScenarioQAFixtureSchema).optional(),
});
export type SecretSimScenarioConfig = z.infer<typeof SecretSimScenarioConfigSchema>;

/** Document ID of the single secrets document under every TrackVersion. */
export const EVAL_RUBRICS_DOC_ID = 'evalRubrics';

/** Shape of `tracks/{trackId}/versions/{versionId}/secrets/evalRubrics`. */
export const EvalRubricsDocSchema = z.object({
  trackId: z.string(),
  versionId: z.string(),
  scenarios: z.array(SecretSimScenarioConfigSchema),
  updatedAt: z.number(),
});
export type EvalRubricsDoc = z.infer<typeof EvalRubricsDocSchema>;

export const TrackStatusSchema = z.enum(['GENERATING', 'DRAFT', 'PUBLISHED', 'ARCHIVED']);
export type TrackStatus = z.infer<typeof TrackStatusSchema>;

export const GenerationStepSchema = z.enum([
  'UPLOADING',
  'EXTRACTING_PDF',
  'BLUEPRINTING',
  'BUILDING_UNITS',
  'BUILDING_SIMS',
  'READY',
  'FAILED',
]);
export type GenerationStep = z.infer<typeof GenerationStepSchema>;

const GenerationBudgetMetricSchema = z.object({
  used: z.number().nonnegative().nullable(),
  limit: z.number().nonnegative().nullable(),
  status: z.enum(['within_budget', 'exceeded', 'unknown', 'not_configured']),
});
export const GenerationBudgetReportSchema = z.object({
  attempts: z.number().int().nonnegative(),
  modelCalls: z.number().int().nonnegative(),
  cacheHits: z.number().int().nonnegative(),
  tokens: GenerationBudgetMetricSchema,
  characters: GenerationBudgetMetricSchema.extend({
    used: z.number().nonnegative(),
    input: z.number().nonnegative(),
    output: z.number().nonnegative(),
  }),
  duration: GenerationBudgetMetricSchema,
});
export type GenerationBudgetReport = z.infer<typeof GenerationBudgetReportSchema>;

export const TrackDocSchema = z.object({
  id: z.string(),
  title: z.string().min(3).max(100),
  campaignCode: z.string().max(32), // e.g., "MVP", "FLOW-B", "TH-INTAKE"
  divisionId: DivisionIdSchema,
  status: TrackStatusSchema,
  generationProgress: z.object({
    step: GenerationStepSchema,
    percent: z.number().min(0).max(100),
    message: z.string(),
  }),
  generationBudgets: z.record(z.string(), GenerationBudgetReportSchema).optional(),
  /** Set when a build step stopped at its time budget and handed off to the next step; null while a step runs. */
  generationPausedAt: z.number().nullable().optional(),
  sourcePdfStoragePath: z.string(),
  sourcePdfFileName: z.string(),
  sourcePageCount: z.number().int().positive(),
  activeSourceBundleId: z.string().nullable().optional(),
  currentDraftVersionId: z.string(),
  publishedVersionId: z.string().nullable(),
  assignedCohortIds: z.array(z.string()), // ['ALL'] or ['INTERNAL', 'THS', 'DOZ']
  competencyPillars: z.array(CompetencyPillarSchema),
  unitCount: z.number().int().nonnegative(),
  /** Checkpoint count the trainer chose on the Content map. Null = use the measured target. */
  unitTarget: z.number().int().min(2).max(12).nullable().optional(),
  simScenarioCount: z.number().int().nonnegative(),
  estimatedTotalMinutes: z.number().int().nonnegative(),
  createdByUid: z.string(),
  createdAt: z.number(),
  updatedAt: z.number(),
});
export type TrackDoc = z.infer<typeof TrackDocSchema>;

// Bundled immutable learner payload (~40-120 KB, 1 single Firestore read)
export const TrackVersionDocSchema = z.object({
  versionId: z.string(),
  trackId: z.string(),
  versionNumber: z.number().int().positive(),
  competencyPillars: z.array(CompetencyPillarSchema),
  units: z.array(TrackUnitSchema),
  simScenarios: z.array(PublicSimScenarioSchema),
  provenance: ProvenanceRecordSchema.optional(),
  sourceBundleId: z.string().nullable().optional(),
  sourceRevision: z.string().nullable().optional(),
  requiredRuleIds: z.array(z.string()).optional(),
  /** Trainer-visible build notes for the whole draft (for example fewer Live Call Sims than planned). */
  reviewNotes: z.array(z.string().min(1).max(300)).max(20).optional(),
  publishedAt: z.number().nullable(),
  createdAt: z.number(),
});
export type TrackVersionDoc = z.infer<typeof TrackVersionDocSchema>;

/** Version document ID that holds the editable draft of a Track. */
export const DRAFT_VERSION_ID = 'draft';

/** Number of Playbook pages stored per `tracks/{trackId}/sourcePages/{pageId}` batch document. */
export const SOURCE_PAGES_PER_BATCH = 10;

/** Shape of `tracks/{trackId}/sourcePages/{pageId}` (pageId = `batch-001`, `batch-002`, ...). */
export const SourcePageBatchDocSchema = z.object({
  id: z.string(),
  trackId: z.string(),
  startPage: z.number().int().positive(),
  endPage: z.number().int().positive(),
  pages: z.array(
    z.object({
      pageNumber: z.number().int().positive(),
      text: z.string(),
    }),
  ),
  createdAt: z.number(),
});
export type SourcePageBatchDoc = z.infer<typeof SourcePageBatchDocSchema>;
