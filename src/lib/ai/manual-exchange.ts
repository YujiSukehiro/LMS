import { createHash } from 'node:crypto';
import { z } from 'zod';
import { parseStructuredOutput, toJsonSchema } from '@/lib/ai/pipeline/structured-output';
import {
  createProvenance,
  ProvenancePromptMetadataSchema,
  type ProvenancePromptMetadata,
  type ProvenanceRecord,
} from '@/lib/ai/provenance';
import { assertSensitiveDataSafe, type SyntheticDataPolicy } from '@/lib/security/synthetic-data';

export const MANUAL_EXCHANGE_FORMAT = 'logicall.manual-chat' as const;
export const MANUAL_EXCHANGE_FORMAT_VERSION = 1 as const;
export const MANUAL_EXCHANGE_PACKAGE_SCHEMA_VERSION = 1 as const;

export const ManualTaskTypeSchema = z.enum(['curriculum_generation', 'judge']);
export const ManualActorRoleSchema = z.enum(['trainer', 'admin', 'learner', 'system']);
export type ManualTaskType = z.infer<typeof ManualTaskTypeSchema>;
export type ManualActorRole = z.infer<typeof ManualActorRoleSchema>;

export const ApprovedSourceExcerptSchema = z
  .object({
    id: z.string().min(1),
    sourceId: z.string().min(1),
    revision: z.string().min(1),
    page: z.number().int().positive().nullable().optional(),
    text: z.string().min(1),
    approved: z.literal(true),
  })
  .strict();
export type ApprovedSourceExcerpt = z.infer<typeof ApprovedSourceExcerptSchema>;

export const ManualExchangePackageSchema = z
  .object({
    format: z.literal(MANUAL_EXCHANGE_FORMAT),
    formatVersion: z.literal(MANUAL_EXCHANGE_FORMAT_VERSION),
    packageSchemaVersion: z.literal(MANUAL_EXCHANGE_PACKAGE_SCHEMA_VERSION),
    taskId: z.string().min(1),
    taskType: ManualTaskTypeSchema,
    instructions: z.string().min(1),
    outputSchemaName: z.string().min(1),
    outputSchemaVersion: z.string().min(1),
    outputJsonSchema: z.record(z.unknown()),
    approvedSourceExcerpts: z.array(ApprovedSourceExcerptSchema),
    scenarioState: z.unknown().optional(),
    validationRules: z.array(z.string().min(1)),
    prompt: ProvenancePromptMetadataSchema,
    external: z.object({ provider: z.literal(''), model: z.literal('') }).strict(),
    checksum: z.string().regex(/^sha256:[a-f0-9]{64}$/),
  })
  .strict();
export type ManualExchangePackage = z.infer<typeof ManualExchangePackageSchema>;

export const ManualImportEnvelopeSchema = z
  .object({
    format: z.literal(MANUAL_EXCHANGE_FORMAT),
    formatVersion: z.literal(MANUAL_EXCHANGE_FORMAT_VERSION),
    packageChecksum: z.string(),
    taskId: z.string(),
    taskType: ManualTaskTypeSchema,
    outputSchemaVersion: z.string(),
    output: z.unknown(),
  })
  .strict();
export type ManualImportEnvelope = z.infer<typeof ManualImportEnvelopeSchema>;

export interface ManualExchangeExportOptions<T extends z.ZodTypeAny> {
  actorRole: ManualActorRole;
  taskId: string;
  taskType: ManualTaskType;
  instructions: string;
  outputSchemaName: string;
  outputSchemaVersion: string;
  schema: T;
  approvedSourceExcerpts: ApprovedSourceExcerpt[];
  scenarioState?: unknown;
  validationRules: string[];
  prompt?: Partial<ProvenancePromptMetadata>;
  syntheticDataPolicy?: SyntheticDataPolicy;
}

export interface ManualValidationCheck {
  name: string;
  passed: boolean;
  detail: string;
}

export interface ManualValidationReport {
  valid: boolean;
  checks: ManualValidationCheck[];
}

export interface JsonDiffEntry {
  path: string;
  before: unknown;
  after: unknown;
}

export type ManualValidatorResult = boolean | string[] | { valid: boolean; issues?: string[] };
export type ManualValidator<T> = (
  output: T,
  context: { package: ManualExchangePackage },
) => ManualValidatorResult | Promise<ManualValidatorResult>;

export interface ManualCommitInput<T> {
  package: ManualExchangePackage;
  output: T;
  provenance: ProvenanceRecord;
  diff: JsonDiffEntry[];
  validationReport: ManualValidationReport;
}

export interface ManualExchangeImportOptions<T extends z.ZodTypeAny, R> {
  actorRole: ManualActorRole;
  /** The trusted, previously exported package; never accept this object from the import text. */
  package: ManualExchangePackage;
  input: string | { text(): Promise<string> };
  schema: T;
  outputSchemaVersion: string;
  externalProvider: string;
  externalModel: string;
  expectedTaskId?: string;
  expectedTaskType?: ManualTaskType;
  diffAgainst?: unknown;
  validateEvidence?: ManualValidator<z.infer<T>>;
  additionalValidators?: Record<string, ManualValidator<z.infer<T>>>;
  syntheticDataPolicy?: SyntheticDataPolicy;
  importedAt?: string;
  /** Invoked exactly once, only after every package/output/evidence validation passes. */
  commit: (input: ManualCommitInput<z.infer<T>>) => R | Promise<R>;
}

export interface ManualExchangeImportResult<T, R> {
  output: T;
  provenance: ProvenanceRecord;
  diff: JsonDiffEntry[];
  validationReport: ManualValidationReport;
  commitResult: R;
}

export class ManualExchangeValidationError extends Error {
  constructor(
    message: string,
    public readonly validationReport: ManualValidationReport,
    public readonly diff: JsonDiffEntry[] = [],
  ) {
    super(message);
    this.name = 'ManualExchangeValidationError';
  }
}

/** Judge packages are never learner/admin/self-service exports. */
export function assertManualTaskRole(taskType: ManualTaskType, actorRole: ManualActorRole): void {
  if (taskType === 'judge' && actorRole !== 'trainer') {
    throw new ManualExchangeValidationError('Judge manual exchange is trainer-only.', {
      valid: false,
      checks: [{ name: 'task_role', passed: false, detail: 'A trainer role is required for judge tasks.' }],
    });
  }
}

function canonicalJson(value: unknown): string {
  const visited = new WeakSet<object>();
  function normalize(current: unknown): unknown {
    if (current === null || typeof current === 'string' || typeof current === 'boolean') return current;
    if (typeof current === 'number' && Number.isFinite(current)) return current;
    if (!current || typeof current !== 'object') throw new TypeError('Manual exchange values must be finite JSON data.');
    if (visited.has(current)) throw new TypeError('Manual exchange values must not contain cycles.');
    visited.add(current);
    if (Array.isArray(current)) return current.map(normalize);
    const prototype = Object.getPrototypeOf(current);
    if (prototype !== Object.prototype && prototype !== null) throw new TypeError('Manual exchange values must be plain JSON objects.');
    const output: Record<string, unknown> = {};
    for (const key of Object.keys(current).sort()) {
      const entry = (current as Record<string, unknown>)[key];
      if (entry === undefined) throw new TypeError('Manual exchange values must not contain undefined properties.');
      output[key] = normalize(entry);
    }
    return output;
  }
  return JSON.stringify(normalize(value));
}

export function checksumManualExchangePackage(packageWithoutChecksum: unknown): string {
  return `sha256:${createHash('sha256').update(canonicalJson(packageWithoutChecksum), 'utf8').digest('hex')}`;
}

function packageChecksum(manualPackage: ManualExchangePackage): string {
  const content = Object.fromEntries(Object.entries(manualPackage).filter(([key]) => key !== 'checksum'));
  return checksumManualExchangePackage(content);
}

export function exportManualExchangePackage<T extends z.ZodTypeAny>(
  options: ManualExchangeExportOptions<T>,
): ManualExchangePackage {
  assertManualTaskRole(options.taskType, options.actorRole);
  const prompt = ProvenancePromptMetadataSchema.parse(options.prompt ?? {});
  const content = {
    format: MANUAL_EXCHANGE_FORMAT,
    formatVersion: MANUAL_EXCHANGE_FORMAT_VERSION,
    packageSchemaVersion: MANUAL_EXCHANGE_PACKAGE_SCHEMA_VERSION,
    taskId: options.taskId,
    taskType: options.taskType,
    instructions: options.instructions,
    outputSchemaName: options.outputSchemaName,
    outputSchemaVersion: options.outputSchemaVersion,
    outputJsonSchema: toJsonSchema(options.schema),
    approvedSourceExcerpts: options.approvedSourceExcerpts,
    ...(options.scenarioState === undefined ? {} : { scenarioState: options.scenarioState }),
    validationRules: options.validationRules,
    prompt,
    external: { provider: '', model: '' },
  };
  const withoutChecksum = ManualExchangePackageSchema.omit({ checksum: true }).parse(content);
  assertSensitiveDataSafe(withoutChecksum, options.syntheticDataPolicy);
  return ManualExchangePackageSchema.parse({ ...withoutChecksum, checksum: checksumManualExchangePackage(withoutChecksum) });
}

function issueSummary(error: z.ZodError): string {
  return error.issues
    .slice(0, 25)
    .map((issue) => `${issue.path.join('.') || '(root)'}: ${issue.message}`)
    .join('; ');
}

function assertNoExecutableContent(raw: string): void {
  const executablePatterns = [
    /<\/?\s*script\b/i,
    /\bjavascript\s*:/i,
    /\bdata\s*:\s*text\/html/i,
    /\bon(?:error|load|click)\s*=/i,
    /^\s*#!/,
    /\beval\s*\(/i,
    /\bFunction\s*\(/,
    /\bchild_process\b/i,
    /\bprocess\s*\.\s*(?:env|exit|binding)\b/,
    /\brequire\s*\(/,
    /\bimport\s*\(/,
  ];
  if (executablePatterns.some((pattern) => pattern.test(raw))) {
    throw new Error('Executable or active content is not permitted.');
  }
}

function assertNoImportedInstructions(output: unknown): void {
  const forbiddenKeys = new Set(['__instructions__', 'importedinstructions', 'systemprompt', 'developerprompt']);
  const visited = new WeakSet<object>();
  function visit(value: unknown): void {
    if (!value || typeof value !== 'object') return;
    if (visited.has(value)) return;
    visited.add(value);
    for (const [key, entry] of Object.entries(value)) {
      const normalized = key.toLowerCase().replace(/[^a-z_]/g, '');
      if (forbiddenKeys.has(normalized)) throw new Error('Imported instruction fields are not permitted.');
      visit(entry);
    }
  }
  visit(output);
  if (output && typeof output === 'object' && !Array.isArray(output)) {
    for (const key of ['instructions', 'instruction', 'prompt']) {
      if (Object.prototype.hasOwnProperty.call(output, key)) throw new Error('Imported instruction fields are not permitted.');
    }
  }
}

function pointerToken(value: string): string {
  return value.replace(/~/g, '~0').replace(/\//g, '~1');
}

/** Small deterministic JSON diff for trainer review before commit. */
export function diffJson(before: unknown, after: unknown): JsonDiffEntry[] {
  const entries: JsonDiffEntry[] = [];
  function visit(left: unknown, right: unknown, path: string): void {
    if (Object.is(left, right)) return;
    const leftObject = left !== null && typeof left === 'object';
    const rightObject = right !== null && typeof right === 'object';
    if (!leftObject || !rightObject || Array.isArray(left) !== Array.isArray(right)) {
      entries.push({ path, before: left, after: right });
      return;
    }
    if (Array.isArray(left) && Array.isArray(right)) {
      const length = Math.max(left.length, right.length);
      for (let index = 0; index < length; index += 1) visit(left[index], right[index], `${path}/${index}`);
      return;
    }
    const leftRecord = left as Record<string, unknown>;
    const rightRecord = right as Record<string, unknown>;
    const keys = [...new Set([...Object.keys(leftRecord), ...Object.keys(rightRecord)])].sort();
    for (const key of keys) visit(leftRecord[key], rightRecord[key], `${path}/${pointerToken(key)}`);
  }
  visit(before, after, '');
  return entries;
}

function validatorOutcome(result: ManualValidatorResult): { valid: boolean; issues: string[] } {
  if (typeof result === 'boolean') return { valid: result, issues: [] };
  if (Array.isArray(result)) return { valid: result.length === 0, issues: result };
  return { valid: result.valid, issues: result.issues ?? [] };
}

export async function importManualExchange<T extends z.ZodTypeAny, R>(
  options: ManualExchangeImportOptions<T, R>,
): Promise<ManualExchangeImportResult<z.infer<T>, R>> {
  const validationReport: ManualValidationReport = { valid: false, checks: [] };
  let diff: JsonDiffEntry[] = [];
  const pass = (name: string, detail: string): void => {
    validationReport.checks.push({ name, passed: true, detail });
  };
  const fail = (name: string, detail: string): never => {
    validationReport.checks.push({ name, passed: false, detail });
    throw new ManualExchangeValidationError(`${name}: ${detail}`, validationReport, diff);
  };

  assertManualTaskRole(options.package.taskType, options.actorRole);
  const packageResult = ManualExchangePackageSchema.safeParse(options.package);
  if (!packageResult.success) return fail('package_structure', issueSummary(packageResult.error));
  const manualPackage = packageResult.data;
  pass('package_structure', 'The trusted package has the required shape.');

  const actualChecksum = packageChecksum(manualPackage);
  if (actualChecksum !== manualPackage.checksum) fail('package_checksum', 'The package checksum does not match its content.');
  pass('package_checksum', 'The package checksum matches.');

  const raw = typeof options.input === 'string' ? options.input : await options.input.text();
  try {
    assertNoExecutableContent(raw);
    assertSensitiveDataSafe(raw, options.syntheticDataPolicy);
  } catch (error) {
    fail('safe_content', error instanceof Error ? error.message : 'Active or sensitive content is not permitted.');
  }
  pass('safe_content', 'No executable or undeclared sensitive content was found.');

  let decoded: unknown;
  try {
    decoded = JSON.parse(raw);
  } catch {
    fail('import_json', 'The import must contain one complete JSON object.');
  }
  try {
    assertNoImportedInstructions(decoded);
  } catch (error) {
    fail('imported_instructions', error instanceof Error ? error.message : 'Imported instructions are not permitted.');
  }

  const envelopeResult = ManualImportEnvelopeSchema.safeParse(decoded);
  if (!envelopeResult.success) return fail('import_envelope', issueSummary(envelopeResult.error));
  const envelope = envelopeResult.data;
  pass('import_envelope', 'The import envelope is valid and contains no imported instructions.');

  if (envelope.packageChecksum !== manualPackage.checksum) fail('import_checksum', 'The import belongs to a different package.');
  pass('import_checksum', 'The import is bound to the trusted package checksum.');

  const expectedTaskId = options.expectedTaskId ?? manualPackage.taskId;
  const expectedTaskType = options.expectedTaskType ?? manualPackage.taskType;
  if (
    envelope.taskId !== manualPackage.taskId ||
    envelope.taskType !== manualPackage.taskType ||
    manualPackage.taskId !== expectedTaskId ||
    manualPackage.taskType !== expectedTaskType
  ) {
    fail('task_match', 'The imported task ID/type does not match the expected task.');
  }
  pass('task_match', 'Task ID and task type match.');

  if (
    envelope.outputSchemaVersion !== manualPackage.outputSchemaVersion ||
    options.outputSchemaVersion !== manualPackage.outputSchemaVersion ||
    canonicalJson(toJsonSchema(options.schema)) !== canonicalJson(manualPackage.outputJsonSchema)
  ) {
    fail('schema_match', 'The imported schema version or supplied Zod JSON schema does not match the export.');
  }
  pass('schema_match', 'Schema version and JSON schema match the export.');

  try {
    assertNoImportedInstructions(envelope.output);
    assertSensitiveDataSafe(envelope.output, options.syntheticDataPolicy);
  } catch (error) {
    fail('output_safety', error instanceof Error ? error.message : 'Unsafe output is not permitted.');
  }

  const parsed = parseStructuredOutput(JSON.stringify(envelope.output), options.schema);
  if (!parsed.ok) return fail('output_schema', parsed.problem);
  const output = parsed.data;
  pass('output_schema', 'Output passed the exact supplied shared Zod validation path.');

  const validators: Record<string, ManualValidator<z.infer<T>> | undefined> = {
    ...(options.validateEvidence ? { evidence: options.validateEvidence } : {}),
    ...options.additionalValidators,
  };
  for (const [name, validator] of Object.entries(validators)) {
    if (!validator) continue;
    let outcome: { valid: boolean; issues: string[] } = { valid: false, issues: [] };
    try {
      outcome = validatorOutcome(await validator(output, { package: manualPackage }));
    } catch (error) {
      fail(name, error instanceof Error ? error.message : 'Validator failed.');
    }
    if (!outcome.valid) fail(name, outcome.issues.join('; ') || 'Required validation did not pass.');
    pass(name, outcome.issues.join('; ') || 'Required validation passed.');
  }

  const provider = options.externalProvider.trim();
  const model = options.externalModel.trim();
  if (!provider || !model) fail('external_provenance', 'Honest external provider and model labels are required.');
  try {
    assertSensitiveDataSafe({ provider, model }, options.syntheticDataPolicy);
  } catch (error) {
    fail('external_provenance', error instanceof Error ? error.message : 'Unsafe provenance labels are not permitted.');
  }

  const provenance = createProvenance({
    source: 'manual_chat',
    provider,
    model,
    prompt: manualPackage.prompt,
    schema: { name: manualPackage.outputSchemaName, version: manualPackage.outputSchemaVersion },
    runtime: { label: 'external_manual_chat', profileId: null, protocol: null },
    recordedAt: options.importedAt ?? new Date().toISOString(),
  });
  pass('manual_provenance', 'manual_chat provenance was created from the trusted package and supplied labels.');

  diff = diffJson(options.diffAgainst ?? null, output);
  validationReport.valid = true;

  // Atomic boundary: this is the first and only caller-visible write hook.
  const commitResult = await options.commit({ package: manualPackage, output, provenance, diff, validationReport });
  return { output, provenance, diff, validationReport, commitResult };
}
