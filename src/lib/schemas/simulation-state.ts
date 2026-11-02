import { z } from 'zod';
import { ProvenanceRecordSchema } from '@/lib/ai/provenance';
import { CanonicalDispositionSchema, SeveritySchema, SourceExcerptRefSchema } from './source-truth';

export const ScenarioContextSchema = z.object({
  direction: z.enum(['outbound', 'inbound', 'callback']),
  queue: z.enum(['recovery', 'customer_support', 'medical_chat', 'renewals']),
  product: z.string().min(1),
  stage: z.enum(['dosage', 'checkout', 'dosage_checkout', 'score', 'support_case', 'pending_info', 'renewal_declined']),
  contactState: z.enum(['lead', 'existing_patient', 'third_party', 'voicemail']),
  pricingPosture: z.enum(['active', 'passive', 'not_applicable']),
  caseBranch: z.string().min(1),
  syntheticTimezone: z.string().min(1),
  syntheticNow: z.string().datetime(),
  sourceRevision: z.string().min(1),
  curriculumVersion: z.string().min(1),
});
export type ScenarioContext = z.infer<typeof ScenarioContextSchema>;

export const ScenarioEvidenceRequirementsSchema = z.object({
  minimumLearnerTurns: z.number().int().min(0).max(12).default(2),
  requiredInspections: z.array(z.string().min(1)).default([]),
  requiredWorkflowActions: z.array(z.string().min(1)).default([]),
  requiredWrapUpEvidence: z.array(z.string().min(1)).default([]),
  requiredGateIds: z.array(z.string().min(1)).default([]),
  requiredCustomerConcerns: z.array(z.string().min(1)).default([]),
  expectedDurationMinutes: z.number().int().min(1).max(30).nullable().default(null),
  gateSourceRefs: z.record(z.string(), z.array(SourceExcerptRefSchema).min(1)).default({}),
  maximumCriticalFailures: z.number().int().nonnegative().default(0),
  maximumMajorFailures: z.number().int().nonnegative().default(0),
});
export type ScenarioEvidenceRequirements = z.infer<typeof ScenarioEvidenceRequirementsSchema>;

export const SimulationLifecycleSchema = z.enum(['pre_call', 'ready_to_dial', 'in_call', 'wrap_up', 'evaluated', 'aborted']);
export const ContactReachedSchema = z.enum(['patient', 'third_party', 'voicemail', 'no_answer']);
export const RecordingStateSchema = z.enum(['inactive', 'active', 'paused']);
export const PaymentStateSchema = z.enum(['not_started', 'awaiting_confirmation', 'confirmation_shown', 'update_failed']);

export const ScenarioStateSchema = z.object({
  lifecycle: SimulationLifecycleSchema,
  context: ScenarioContextSchema,
  inspectionIds: z.array(z.string().min(1)),
  identityVerified: z.boolean(),
  localTimeValidated: z.boolean(),
  recordingDisclosureRequired: z.boolean(),
  recordingDisclosed: z.boolean(),
  contactReached: ContactReachedSchema.nullable(),
  customerIntent: z.string().nullable(),
  clinicalRiskBranch: z.string().nullable(),
  optOut: z.boolean(),
  suppressionRecorded: z.boolean(),
  customerAskedPrice: z.boolean(),
  pricingDiscussed: z.boolean(),
  selectedPlanId: z.string().nullable(),
  baseRecoveryCommitted: z.boolean(),
  offerAssetIds: z.array(z.string().min(1)),
  smsPermissionGranted: z.boolean(),
  sentLinkAssetIds: z.array(z.string().min(1)),
  workflowActionIds: z.array(z.string().min(1)),
  recording: RecordingStateSchema,
  paymentState: PaymentStateSchema,
  patientCompletionIds: z.array(z.string().min(1)),
  organicCompletionIds: z.array(z.string().min(1)),
  escalationReceiptIds: z.array(z.string().min(1)),
  noteReceiptIds: z.array(z.string().min(1)),
  callbackAt: z.string().datetime().nullable(),
  selectedDisposition: CanonicalDispositionSchema.nullable(),
  dispositionCorrect: z.boolean().nullable(),
  wrapUpComplete: z.boolean(),
  abortReason: z.string().nullable(),
});
export type ScenarioState = z.infer<typeof ScenarioStateSchema>;

export const SimulationActionSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('inspect'), inspectionId: z.string().min(1).max(100) }).strict(),
  z.object({ type: z.literal('dial') }).strict(),
  z.object({ type: z.literal('verify_identity') }).strict(),
  z.object({ type: z.literal('set_contact'), contact: ContactReachedSchema }).strict(),
  z.object({ type: z.literal('record_disclosure') }).strict(),
  z.object({ type: z.literal('set_opt_out') }).strict(),
  z.object({ type: z.literal('set_price_context'), customerAskedPrice: z.boolean(), selectedPlanId: z.string().nullable(), baseRecoveryCommitted: z.boolean() }).strict(),
  z.object({ type: z.literal('offer'), assetId: z.string().min(1) }).strict(),
  z.object({ type: z.literal('grant_sms_permission') }).strict(),
  z.object({ type: z.literal('send_sms'), assetId: z.string().min(1) }).strict(),
  z.object({ type: z.literal('recording'), state: z.enum(['active', 'paused']) }).strict(),
  z.object({ type: z.literal('secure_payment'), fakeToken: z.string().min(1).max(80) }).strict(),
  z.object({ type: z.literal('workflow'), actionId: z.string().min(1).max(100) }).strict(),
  z.object({ type: z.literal('patient_completion'), completionId: z.string().min(1).max(100), organic: z.boolean().default(false) }).strict(),
  z.object({ type: z.literal('escalate'), channel: z.string().min(1), orderId: z.string().min(1).max(80), vertical: z.string().min(1).max(80), requestedCorrection: z.string().min(1).max(500) }).strict(),
  z.object({ type: z.literal('note'), text: z.string().min(1).max(1_000) }).strict(),
  z.object({ type: z.literal('suppress') }).strict(),
  z.object({ type: z.literal('callback'), callbackAt: z.string().datetime() }).strict(),
  z.object({ type: z.literal('wrap_up'), disposition: CanonicalDispositionSchema }).strict(),
  z.object({ type: z.literal('abort'), reason: z.string().min(1).max(300) }).strict(),
]);
export type SimulationAction = z.infer<typeof SimulationActionSchema>;

export const SimulationEventTypeSchema = z.enum([
  'utterance',
  'inspect',
  'dial',
  'verify_identity',
  'contact',
  'offer',
  'sms',
  'record',
  'payment',
  'workflow',
  'patient_completion',
  'order_update',
  'subscription_update',
  'escalate',
  'note',
  'suppress',
  'callback',
  'disposition',
  'evaluate',
  'abort',
]);
export const SimulationEventProvenanceSchema = z.enum(['learner', 'deterministic', 'local_ai', 'manual_chat', 'replay']);
export const SimulationEventSchema = z.object({
  id: z.string().min(1),
  sessionId: z.string().min(1),
  sequence: z.number().int().positive(),
  actor: z.enum(['learner', 'customer', 'system', 'engine']),
  type: SimulationEventTypeSchema,
  payload: z.record(z.string(), z.unknown()),
  stateHash: z.string().regex(/^sha256:[a-f0-9]{64}$/),
  occurredAt: z.string().datetime(),
  provenance: SimulationEventProvenanceSchema,
  runtimeProvenance: ProvenanceRecordSchema.optional(),
});
export type SimulationEvent = z.infer<typeof SimulationEventSchema>;

export const SimulationGateResultSchema = z.object({
  ruleId: z.string().min(1),
  sourceRefs: z.array(SourceExcerptRefSchema),
  severity: SeveritySchema,
  status: z.enum(['pass', 'fail', 'not_observed', 'needs_review']),
  evidenceEventIds: z.array(z.string().min(1)),
  learnerFeedback: z.string().min(1),
  trainerDetail: z.string().min(1),
});
export type SimulationGateResult = z.infer<typeof SimulationGateResultSchema>;

export const DispositionValidationSchema = z.object({
  disposition: CanonicalDispositionSchema,
  valid: z.boolean(),
  reasons: z.array(z.string()),
});
export type DispositionValidation = z.infer<typeof DispositionValidationSchema>;

export const SimulationAssessmentEligibilitySchema = z.object({
  eligible: z.boolean(),
  reasons: z.array(z.string()),
  minimumEvidenceMet: z.boolean(),
  dispositionValid: z.boolean(),
  deterministicCriticalFailure: z.boolean(),
});
export type SimulationAssessmentEligibility = z.infer<typeof SimulationAssessmentEligibilitySchema>;

export const SyntheticOutboxRecordSchema = z.object({
  id: z.string().min(1),
  sessionId: z.string().min(1),
  kind: z.enum(['fake_sms', 'fake_slack']),
  destination: z.string().min(1),
  assetId: z.string().nullable(),
  displayText: z.string().max(1_000),
  eventId: z.string().min(1),
  createdAt: z.string().datetime(),
  synthetic: z.literal(true),
});
export type SyntheticOutboxRecord = z.infer<typeof SyntheticOutboxRecordSchema>;

export const ScriptedSimulationStepSchema = z.object({
  action: SimulationActionSchema.optional(),
  learnerUtterance: z.string().min(1).max(2_000).optional(),
  expectedEventType: SimulationEventTypeSchema.optional(),
}).strict().refine((step) => step.action !== undefined || step.learnerUtterance !== undefined, {
  message: 'A scripted step needs an action or learner utterance.',
});
export type ScriptedSimulationStep = z.infer<typeof ScriptedSimulationStepSchema>;
export const ScenarioQAFixtureSchema = z.object({
  id: z.string().min(1),
  title: z.string().min(1),
  kind: z.enum(['golden_pass', 'golden_critical_fail']),
  steps: z.array(ScriptedSimulationStepSchema).min(1),
  expectedDisposition: CanonicalDispositionSchema,
  expectedGateResults: z.array(z.object({ ruleId: z.string().min(1), status: z.enum(['pass', 'fail', 'not_observed', 'needs_review']) })).min(1),
});
export type ScenarioQAFixture = z.infer<typeof ScenarioQAFixtureSchema>;
