import { z } from 'zod';

/** Provider-neutral provenance. No adapter imports are needed to read historical records. */
export const PROVENANCE_SCHEMA_VERSION = 1 as const;
export const PROVENANCE_SOURCES = ['local_ai', 'hosted_ai', 'replay', 'manual_chat', 'deterministic', 'trainer_override'] as const;

export type ProvenanceSource = (typeof PROVENANCE_SOURCES)[number];

export const ProvenancePromptMetadataSchema = z
  .object({
    templateId: z.string().nullable().default(null),
    templateVersion: z.string().nullable().default(null),
    inputHash: z.string().nullable().default(null),
  })
  .passthrough();

export const ProvenanceOutputSchemaMetadataSchema = z
  .object({
    name: z.string().nullable().default(null),
    version: z.string().nullable().default(null),
  })
  .passthrough();

export const ProvenanceRuntimeMetadataSchema = z
  .object({
    label: z.string().nullable().default(null),
    profileId: z.string().nullable().default(null),
    protocol: z.string().nullable().default(null),
  })
  .passthrough();

export const ProvenanceRecordSchema = z
  .object({
    schemaVersion: z.literal(PROVENANCE_SCHEMA_VERSION).default(PROVENANCE_SCHEMA_VERSION),
    source: z.enum(PROVENANCE_SOURCES),
    provider: z.string().nullable().default(null),
    model: z.string().nullable().default(null),
    prompt: ProvenancePromptMetadataSchema.default({}),
    schema: ProvenanceOutputSchemaMetadataSchema.default({}),
    runtime: ProvenanceRuntimeMetadataSchema.default({}),
    recordedAt: z.string().nullable().default(null),
  })
  .passthrough();

export type ProvenancePromptMetadata = z.infer<typeof ProvenancePromptMetadataSchema>;
export type ProvenanceOutputSchemaMetadata = z.infer<typeof ProvenanceOutputSchemaMetadataSchema>;
export type ProvenanceRuntimeMetadata = z.infer<typeof ProvenanceRuntimeMetadataSchema>;
export type ProvenanceRecord = z.infer<typeof ProvenanceRecordSchema>;

export interface CreateProvenanceInput {
  source: ProvenanceSource;
  provider?: string | null;
  model?: string | null;
  prompt?: Partial<ProvenancePromptMetadata> | null;
  schema?: Partial<ProvenanceOutputSchemaMetadata> | null;
  runtime?: Partial<ProvenanceRuntimeMetadata> | null;
  recordedAt?: string | null;
}

export function createProvenance(input: CreateProvenanceInput): ProvenanceRecord {
  return ProvenanceRecordSchema.parse({
    schemaVersion: PROVENANCE_SCHEMA_VERSION,
    source: input.source,
    provider: input.provider ?? null,
    model: input.model ?? null,
    prompt: input.prompt ?? {},
    schema: input.schema ?? {},
    runtime: input.runtime ?? {},
    recordedAt: input.recordedAt ?? null,
  });
}

/**
 * Read current or legacy provenance without loading a provider implementation.
 * Legacy string values and missing metadata remain readable, but are not implicitly verified.
 */
export function parseProvenance(value: unknown): ProvenanceRecord {
  if (typeof value === 'string') return ProvenanceRecordSchema.parse({ source: value });
  if (!value || typeof value !== 'object' || Array.isArray(value)) return ProvenanceRecordSchema.parse(value);

  const legacy = value as Record<string, unknown>;
  return ProvenanceRecordSchema.parse({
    ...legacy,
    schemaVersion: legacy.schemaVersion ?? PROVENANCE_SCHEMA_VERSION,
    source: legacy.source ?? legacy.type ?? legacy.kind,
    provider: legacy.provider ?? null,
    model: legacy.model ?? null,
    prompt: legacy.prompt ?? {},
    schema: legacy.schema ?? {},
    runtime: legacy.runtime ?? {},
    recordedAt: legacy.recordedAt ?? null,
  });
}

export type EvidenceVerificationStatus = 'verified' | 'unverified' | 'historical_unverified';

export interface AssessmentValidationChecks {
  schemaValid: boolean;
  evidenceValid: boolean;
  trainerApproved: boolean;
  preflightPassed: boolean;
  approvedContent: boolean;
}

export interface AssessmentEligibilityInput {
  provenance: unknown;
  /** Missing legacy verification is deliberately treated as historical_unverified. */
  evidenceStatus?: EvidenceVerificationStatus;
  checks?: Partial<AssessmentValidationChecks>;
}

export interface AssessmentEligibility {
  eligible: boolean;
  canCertify: boolean;
  countsTowardReadiness: boolean;
  reasons: string[];
}

/**
 * Fail-closed source/evidence gate. Callers must supply affirmative validation results;
 * replay and unverified legacy evidence can never become eligible by adding checks.
 */
export function getAssessmentEligibility(input: AssessmentEligibilityInput): AssessmentEligibility {
  const reasons: string[] = [];
  let provenance: ProvenanceRecord;
  try {
    provenance = parseProvenance(input.provenance);
  } catch {
    return {
      eligible: false,
      canCertify: false,
      countsTowardReadiness: false,
      reasons: ['invalid_provenance'],
    };
  }

  if (provenance.source === 'replay') reasons.push('replay_evidence');

  const evidenceStatus = input.evidenceStatus ?? 'historical_unverified';
  if (evidenceStatus === 'historical_unverified') reasons.push('historical_unverified_evidence');
  else if (evidenceStatus !== 'verified') reasons.push('unverified_evidence');

  const checks = input.checks ?? {};
  if (checks.schemaValid !== true) reasons.push('schema_not_validated');
  if (checks.evidenceValid !== true) reasons.push('evidence_not_validated');

  if (provenance.source === 'local_ai') {
    if (checks.preflightPassed !== true) reasons.push('preflight_not_passed');
    if (checks.approvedContent !== true) reasons.push('content_not_approved');
  }
  if (provenance.source === 'manual_chat' || provenance.source === 'trainer_override') {
    if (checks.trainerApproved !== true) reasons.push('trainer_approval_required');
  }

  const eligible = reasons.length === 0;
  return { eligible, canCertify: eligible, countsTowardReadiness: eligible, reasons };
}
