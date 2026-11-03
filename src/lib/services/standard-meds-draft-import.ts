import {
  DRAFT_VERSION_ID,
  EVAL_RUBRICS_DOC_ID,
  EvalRubricsDocSchema,
  TrackDocSchema,
  TrackVersionDocSchema,
  type CanonicalPillarKey,
  type CompetencyPillar,
  type EvalRubricsDoc,
  type TrackDoc,
  type TrackVersionDoc,
} from '@/lib/schemas/curriculum';
import {
  ClaimEvidenceSchema,
  SourceBundleSchema,
  SourcePageEvidenceSchema,
  type SourceBundle,
  type SourceDocumentRef,
  type SourcePageEvidence,
} from '@/lib/schemas/source-truth';
import {
  STANDARD_MEDS_CALL_PACKS,
  STANDARD_MEDS_ORIENTATION_PACK,
  StandardMedsSourceRegistrationSchema,
  getStandardMedsSource,
  type StandardMedsCallPack,
  type StandardMedsOrientationPack,
  type StandardMedsSourceCode,
} from '@/lib/content/standard-meds';
import type { DivisionId } from '@/lib/schemas/domain';
import {
  computeSourceBundleRevisionHash,
  sourcePageEvidenceId,
} from '@/lib/services/source-store';

export const STANDARD_MEDS_DRAFT_IMPORT_ACTOR = 'synthetic-standard-meds-draft-import';
export const STANDARD_MEDS_DRAFT_IMPORT_TIMESTAMP = Date.parse('2026-01-01T00:00:00.000Z');
export const STANDARD_MEDS_ORIENTATION_TRACK_ID = 'standard-meds-sm-00';

const SIM_ESTIMATED_MINUTES = 6;
const EXPECTED_CALL_CODES: readonly StandardMedsSourceCode[] = ['SM-01', 'SM-02', 'SM-03', 'SM-04', 'SM-05', 'SM-06', 'SM-07', 'SM-08'];

export type StandardMedsDraftImportWriteKind = 'track' | 'version' | 'secrets' | 'source_bundle' | 'page_evidence';

export interface StandardMedsDraftImportWrite {
  path: string;
  kind: StandardMedsDraftImportWriteKind;
  data: TrackDoc | TrackVersionDoc | EvalRubricsDoc | SourceBundle | SourcePageEvidence;
}

export type StandardMedsDraftImportIssueCode =
  | 'SOURCE_PAGE_TEXT_NOT_EMBEDDED'
  | 'RULE_PACK_EXACT_EXCERPTS_REQUIRED'
  | 'ASSET_EXACT_EXCERPTS_REQUIRED'
  | 'CONFLICT_EXACT_EXCERPTS_REQUIRED';

export interface StandardMedsDraftImportIssue {
  code: StandardMedsDraftImportIssueCode;
  sourceCode: StandardMedsSourceCode;
  message: string;
  affectedIds: string[];
}

export interface StandardMedsDraftImportTrackSummary {
  sourceCode: StandardMedsSourceCode;
  trackId: string;
  versionId: string;
  sourceBundleId: string;
  unitCount: number;
  scenarioCount: number;
  pageEvidenceCount: number;
  requiredRuleIds: string[];
  openSmeDecisionIds: string[];
  publication: StandardMedsCallPack['publication'];
  importIssues: StandardMedsDraftImportIssue[];
}

export interface StandardMedsDraftImportPlan {
  writes: StandardMedsDraftImportWrite[];
  tracks: StandardMedsDraftImportTrackSummary[];
}

export interface BuildStandardMedsDraftImportOptions {
  orientationPack?: StandardMedsOrientationPack;
  callPacks?: readonly StandardMedsCallPack[];
}

interface SourceNamespace {
  bundle: SourceBundle;
  pages: SourcePageEvidence[];
  writes: StandardMedsDraftImportWrite[];
}

const ORIENTATION_PILLAR_DEFINITIONS: ReadonlyArray<readonly [CanonicalPillarKey, string]> = [
  ['verification_crm', 'Source registration checks'],
  ['product_offer_terms', 'Source scope and terms'],
  ['retention_objection', 'Source-specific recovery boundaries'],
  ['escalation_triage', 'Readiness gap routing'],
  ['compliance_boundaries', 'Evidence and publication boundaries'],
  ['empathy_communication', 'Track-specific communication'],
  ['closing_next_steps', 'Observed outcomes'],
  ['workflow_execution', 'Source navigation and bundle readiness'],
];

function orientationPillars(pack: StandardMedsOrientationPack): CompetencyPillar[] {
  const requiredIds = new Set(pack.units.flatMap((unit) => unit.drills.map((drill) => drill.competencyPillarId)));
  const pillars = ORIENTATION_PILLAR_DEFINITIONS.map(([key, label]) => ({
    id: `sm-00-${key}`,
    key,
    label,
    description: `Orientation-only competency for ${label.toLowerCase()}; it does not certify a call track.`,
  })).filter((pillar) => requiredIds.has(pillar.id));
  if (pillars.length !== requiredIds.size) throw new Error('SM-00 has a drill mapped to an unknown orientation pillar.');
  return pillars;
}

function divisionFor(code: StandardMedsSourceCode): DivisionId {
  if (code === 'SM-00') return 'TELEHEALTH';
  return code === 'SM-06' ? 'INBOUND' : 'OUTBOUND';
}

function buildSourceNamespace(
  sourceCodes: readonly StandardMedsSourceCode[],
  trackId: string,
  bundleId: string,
  openSmeDecisionIds: readonly string[],
): SourceNamespace {
  if (sourceCodes.length === 0) throw new Error(`${trackId} needs at least one registered source.`);
  const sources = sourceCodes.map((code) => StandardMedsSourceRegistrationSchema.parse(getStandardMedsSource(code)));
  if (new Set(sources.map((source) => source.documentId)).size !== sources.length) {
    throw new Error(`${trackId} has duplicate inherited source documents.`);
  }

  const documents: SourceDocumentRef[] = sources.map((source, inheritanceOrder) => ({
    id: source.documentId,
    revisionId: source.revisionId,
    bundleId,
    trackId,
    role: source.role,
    fileName: source.fileName,
    storagePath: `local-only/${source.relativePath}`,
    sourceVersion: source.sourceVersion,
    effectiveDate: null,
    uploadedAt: STANDARD_MEDS_DRAFT_IMPORT_TIMESTAMP,
    uploadedByUid: STANDARD_MEDS_DRAFT_IMPORT_ACTOR,
    contentHash: source.contentHash,
    pageCount: source.pageCount,
    inheritanceOrder,
    excluded: false,
    exclusionReason: null,
  }));

  // The registration manifest deliberately excludes raw text. Keep hashes and extraction
  // metadata, but leave text and approvals empty rather than manufacturing exact excerpts.
  const pages = sources.flatMap((source) => source.pages.map((page) => SourcePageEvidenceSchema.parse({
    id: sourcePageEvidenceId(source.documentId, page.pageNumber),
    documentId: source.documentId,
    revisionId: source.revisionId,
    pageNumber: page.pageNumber,
    rawText: '',
    normalizedText: '',
    contentHash: page.contentHash,
    characterCount: page.characterCount,
    extractionFlags: page.extractionFlags,
    transcription: null,
    approvedExcerpts: [],
  })));
  const sharedRulePackIds: string[] = [];
  const precedencePolicyId = 'standard-meds-precedence-v1';
  const revisionHash = computeSourceBundleRevisionHash({ documents, sharedRulePackIds, precedencePolicyId }, pages);
  const bundle = SourceBundleSchema.parse({
    schemaVersion: 1,
    id: bundleId,
    trackId,
    documents,
    sharedRulePackIds,
    precedencePolicyId,
    conflictIds: [],
    unresolvedSmeDecisionIds: [...openSmeDecisionIds],
    status: openSmeDecisionIds.length > 0 ? 'needs_sme' : 'draft',
    revisionHash,
    approvedSourceRevision: null,
    approvedByUid: null,
    approvedAt: null,
    createdAt: STANDARD_MEDS_DRAFT_IMPORT_TIMESTAMP,
    updatedAt: STANDARD_MEDS_DRAFT_IMPORT_TIMESTAMP,
  });
  const root = `tracks/${trackId}/sourceBundles/${bundleId}`;
  return {
    bundle,
    pages,
    writes: [
      { path: root, kind: 'source_bundle', data: bundle },
      ...pages.map((page) => ({ path: `${root}/pageEvidence/${page.id}`, kind: 'page_evidence' as const, data: page })),
    ],
  };
}

function buildTrack(
  pack: StandardMedsCallPack | StandardMedsOrientationPack,
  trackId: string,
  version: TrackVersionDoc,
): TrackDoc {
  const source = StandardMedsSourceRegistrationSchema.parse(pack.source);
  return TrackDocSchema.parse({
    id: trackId,
    title: pack.title,
    campaignCode: pack.code,
    divisionId: divisionFor(pack.code),
    status: 'DRAFT',
    generationProgress: {
      step: 'READY',
      percent: 100,
      message: 'Synthetic draft import complete; evidence, asset, SME, and trainer blockers remain.',
    },
    sourcePdfStoragePath: `local-only/${source.relativePath}`,
    sourcePdfFileName: source.fileName,
    sourcePageCount: source.pageCount,
    activeSourceBundleId: version.sourceBundleId,
    currentDraftVersionId: version.versionId,
    publishedVersionId: null,
    assignedCohortIds: [],
    competencyPillars: version.competencyPillars,
    unitCount: version.units.length,
    simScenarioCount: version.simScenarios.length,
    estimatedTotalMinutes: version.units.reduce((sum, unit) => sum + unit.estimatedMinutes, 0)
      + version.simScenarios.length * SIM_ESTIMATED_MINUTES,
    createdByUid: STANDARD_MEDS_DRAFT_IMPORT_ACTOR,
    createdAt: STANDARD_MEDS_DRAFT_IMPORT_TIMESTAMP,
    updatedAt: STANDARD_MEDS_DRAFT_IMPORT_TIMESTAMP,
  });
}

function importIssuesFor(
  pack: StandardMedsCallPack | StandardMedsOrientationPack,
  requiredRuleIds: readonly string[],
): StandardMedsDraftImportIssue[] {
  const issues: StandardMedsDraftImportIssue[] = [{
    code: 'SOURCE_PAGE_TEXT_NOT_EMBEDDED',
    sourceCode: pack.code,
    message: 'The source manifest contains hashes, character counts, and extraction flags but no raw/normalized page text. Page evidence is metadata-only until the established extraction flow supplies exact text.',
    affectedIds: [pack.source.documentId],
  }];
  if (requiredRuleIds.length > 0) {
    issues.push({
      code: 'RULE_PACK_EXACT_EXCERPTS_REQUIRED',
      sourceCode: pack.code,
      message: 'Rule IDs and page references are available, but SharedRule evidence requires exact source excerpts. No rule pack is written until those excerpts are supplied and reviewed.',
      affectedIds: [...requiredRuleIds],
    });
  }
  if (pack.syntheticLinks.length > 0) {
    issues.push({
      code: 'ASSET_EXACT_EXCERPTS_REQUIRED',
      sourceCode: pack.code,
      message: 'Synthetic link definitions lack the exact source excerpts required by LinkAsset.sourceRefs. No operational asset is inferred or written; the existing asset-approval blocker remains.',
      affectedIds: pack.syntheticLinks.map((link) => link.id),
    });
  }
  if (pack.openSmeDecisionIds.length > 0) {
    issues.push({
      code: 'CONFLICT_EXACT_EXCERPTS_REQUIRED',
      sourceCode: pack.code,
      message: 'SME decisions remain open. SourceConflict requires at least two exact source excerpts, which the packs do not contain; no conflict values or resolutions are invented.',
      affectedIds: [...pack.openSmeDecisionIds],
    });
  }
  return issues;
}

function assertPackRemainsDraft(pack: StandardMedsCallPack | StandardMedsOrientationPack): void {
  if (pack.publication.eligible !== false || pack.publication.approvalStatus !== 'draft') {
    throw new Error(`${pack.code} must remain an ineligible draft; the import cannot approve or publish it.`);
  }
  if (pack.source.approvalStatus !== 'draft') throw new Error(`${pack.code} source registration must remain draft.`);
  if (pack.kind === 'call_training' && pack.version.publishedAt !== null) {
    throw new Error(`${pack.code} curriculum must remain unpublished.`);
  }
  for (const link of pack.syntheticLinks) {
    if (!link.synthetic || link.approvalStatus !== 'draft' || !link.url.startsWith('https://synthetic.invalid/')) {
      throw new Error(`${pack.code} link ${link.id} is not an explicitly synthetic draft asset.`);
    }
  }
}

function summaryFor(
  pack: StandardMedsCallPack | StandardMedsOrientationPack,
  version: TrackVersionDoc,
  namespace: SourceNamespace,
): StandardMedsDraftImportTrackSummary {
  const requiredRuleIds = version.requiredRuleIds ?? [];
  return {
    sourceCode: pack.code,
    trackId: version.trackId,
    versionId: version.versionId,
    sourceBundleId: namespace.bundle.id,
    unitCount: version.units.length,
    scenarioCount: version.simScenarios.length,
    pageEvidenceCount: namespace.pages.length,
    requiredRuleIds: [...requiredRuleIds],
    openSmeDecisionIds: [...pack.openSmeDecisionIds],
    publication: pack.publication,
    importIssues: importIssuesFor(pack, requiredRuleIds),
  };
}

function buildOrientation(pack: StandardMedsOrientationPack): { writes: StandardMedsDraftImportWrite[]; summary: StandardMedsDraftImportTrackSummary } {
  if (pack.code !== 'SM-00' || pack.kind !== 'orientation') throw new Error('The Standard Meds orientation pack must be SM-00.');
  assertPackRemainsDraft(pack);
  const trackId = STANDARD_MEDS_ORIENTATION_TRACK_ID;
  const versionId = DRAFT_VERSION_ID;
  const bundleId = 'standard-meds-sm-00-bundle-unapproved';
  const namespace = buildSourceNamespace(['SM-00'], trackId, bundleId, pack.openSmeDecisionIds);
  const requiredRuleIds = [...new Set(pack.units.flatMap((unit) => unit.drills.flatMap((drill) => drill.ruleIds ?? [])))];
  const version = TrackVersionDocSchema.parse({
    versionId,
    trackId,
    versionNumber: 1,
    competencyPillars: orientationPillars(pack),
    units: pack.units,
    simScenarios: [],
    sourceBundleId: bundleId,
    sourceRevision: namespace.bundle.revisionHash,
    requiredRuleIds,
    publishedAt: null,
    createdAt: STANDARD_MEDS_DRAFT_IMPORT_TIMESTAMP,
  });
  const track = buildTrack(pack, trackId, version);
  return {
    writes: [
      { path: `tracks/${trackId}`, kind: 'track', data: track },
      { path: `tracks/${trackId}/versions/${versionId}`, kind: 'version', data: version },
      ...namespace.writes,
    ],
    summary: summaryFor(pack, version, namespace),
  };
}

function buildCall(pack: StandardMedsCallPack): { writes: StandardMedsDraftImportWrite[]; summary: StandardMedsDraftImportTrackSummary } {
  if (pack.kind !== 'call_training') throw new Error('Invalid Standard Meds call pack.');
  assertPackRemainsDraft(pack);
  const registeredSource = StandardMedsSourceRegistrationSchema.parse(getStandardMedsSource(pack.code));
  const packSource = StandardMedsSourceRegistrationSchema.parse(pack.source);
  if (JSON.stringify(packSource) !== JSON.stringify(registeredSource)) {
    throw new Error(`${pack.code} source registration differs from the validated manifest.`);
  }
  const trackId = pack.version.trackId;
  if (!trackId || trackId !== pack.source.trackId) throw new Error(`${pack.code} has no consistent call track ID.`);
  const versionId = DRAFT_VERSION_ID;
  const bundleId = pack.version.sourceBundleId;
  if (!bundleId) throw new Error(`${pack.code} has no source bundle ID.`);
  const namespace = buildSourceNamespace(pack.inheritedSourceCodes, trackId, bundleId, pack.openSmeDecisionIds);
  const scenarios = pack.version.simScenarios.map((scenario) => {
    if (!scenario.context) throw new Error(`${pack.code} scenario ${scenario.id} has no synthetic source context.`);
    return {
      ...scenario,
      context: { ...scenario.context, sourceRevision: namespace.bundle.revisionHash, curriculumVersion: versionId },
    };
  });
  const version = TrackVersionDocSchema.parse({
    ...pack.version,
    versionId,
    sourceRevision: namespace.bundle.revisionHash,
    simScenarios: scenarios,
    publishedAt: null,
  });
  const evalRubrics = EvalRubricsDocSchema.parse({ ...pack.evalRubrics, versionId });
  if (evalRubrics.trackId !== trackId || evalRubrics.versionId !== versionId) {
    throw new Error(`${pack.code} secret rubrics do not match the draft version.`);
  }
  const track = buildTrack(pack, trackId, version);
  return {
    writes: [
      { path: `tracks/${trackId}`, kind: 'track', data: track },
      { path: `tracks/${trackId}/versions/${versionId}`, kind: 'version', data: version },
      { path: `tracks/${trackId}/versions/${versionId}/secrets/${EVAL_RUBRICS_DOC_ID}`, kind: 'secrets', data: evalRubrics },
      ...namespace.writes,
    ],
    summary: summaryFor(pack, version, namespace),
  };
}

/** Build and schema-validate every document without reading configuration or initializing Firebase. */
export function buildStandardMedsDraftImport(options: BuildStandardMedsDraftImportOptions = {}): StandardMedsDraftImportPlan {
  const orientationPack = options.orientationPack ?? STANDARD_MEDS_ORIENTATION_PACK;
  const callPacks = options.callPacks ?? STANDARD_MEDS_CALL_PACKS;
  if (callPacks.map((pack) => pack.code).join(',') !== EXPECTED_CALL_CODES.join(',')) {
    throw new Error('The import requires the original eight Standard Meds call packs in SM-01 through SM-08 order.');
  }
  const built = [buildOrientation(orientationPack), ...callPacks.map(buildCall)];
  const writes = built.flatMap((entry) => entry.writes);
  const paths = writes.map((write) => write.path);
  if (new Set(paths).size !== paths.length) throw new Error('Standard Meds draft import produced duplicate document paths.');
  return { writes, tracks: built.map((entry) => entry.summary) };
}

export function assertStandardMedsDraftImportWriteGate(options: {
  confirmSyntheticLocal: boolean;
  firestoreEmulatorHost: string | undefined;
}): void {
  if (!options.confirmSyntheticLocal) {
    throw new Error('Refusing Standard Meds draft writes: pass --confirm-synthetic-local explicitly.');
  }
  const host = options.firestoreEmulatorHost?.trim() ?? '';
  const match = /^(localhost|127\.0\.0\.1|\[::1\]):(\d{1,5})$/.exec(host);
  if (!match) {
    throw new Error('Refusing Standard Meds draft writes: FIRESTORE_EMULATOR_HOST must identify a loopback emulator as host:port.');
  }
  const port = Number(match[2]);
  if (port < 1 || port > 65_535) throw new Error('FIRESTORE_EMULATOR_HOST has an invalid emulator port.');
}

function canonical(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value as Record<string, unknown>)
      .filter(([, entry]) => entry !== undefined)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, entry]) => [key, canonical(entry)]));
  }
  return value;
}

function containsApprovedClaimEvidence(value: unknown): boolean {
  if (Array.isArray(value)) return value.some(containsApprovedClaimEvidence);
  if (!value || typeof value !== 'object') return false;
  const parsed = ClaimEvidenceSchema.safeParse(value);
  if (parsed.success && parsed.data.approvalStatus === 'approved' && parsed.data.reviewerUid && parsed.data.reviewedAt !== null) {
    return true;
  }
  return Object.values(value).some(containsApprovedClaimEvidence);
}

function protectedReason(write: StandardMedsDraftImportWrite, existing: Record<string, unknown>): string | null {
  if (write.kind === 'track' && (existing.status === 'PUBLISHED' || typeof existing.publishedVersionId === 'string')) {
    return 'the track has a published version';
  }
  if (write.kind === 'version' && existing.publishedAt !== null && existing.publishedAt !== undefined) {
    return 'the curriculum version is published';
  }
  if ((write.kind === 'version' || write.kind === 'secrets') && containsApprovedClaimEvidence(existing)) {
    return 'the record contains trainer-approved ClaimEvidence';
  }
  if (write.kind === 'source_bundle' && (
    existing.status === 'approved' || existing.status === 'published' ||
    existing.approvedSourceRevision != null || existing.approvedByUid != null || existing.approvedAt != null
  )) {
    return 'the source bundle has approval or publication state';
  }
  if (write.kind === 'source_bundle') {
    const nextBundle = write.data as SourceBundle;
    const existingConflictIds = Array.isArray(existing.conflictIds) ? existing.conflictIds.filter((id): id is string => typeof id === 'string') : [];
    const existingDecisionIds = Array.isArray(existing.unresolvedSmeDecisionIds) ? existing.unresolvedSmeDecisionIds.filter((id): id is string => typeof id === 'string') : [];
    if (
      existingConflictIds.some((id) => !nextBundle.conflictIds.includes(id)) ||
      existingDecisionIds.some((id) => !nextBundle.unresolvedSmeDecisionIds.includes(id))
    ) {
      return 'the source bundle has conflict or unresolved-SME registry state';
    }
  }
  if (write.kind === 'page_evidence' && (
    (typeof existing.rawText === 'string' && existing.rawText.length > 0) ||
    (typeof existing.normalizedText === 'string' && existing.normalizedText.length > 0) ||
    existing.transcription != null ||
    (Array.isArray(existing.approvedExcerpts) && existing.approvedExcerpts.length > 0)
  )) {
    return 'the page contains extracted, transcribed, or approved evidence';
  }
  return null;
}

/**
 * Deterministic IDs make an unchanged rerun a no-op. Changed protected records fail closed
 * instead of replacing published curriculum, approvals, transcription, or exact evidence.
 */
export function standardMedsDraftImportWriteAction(
  write: StandardMedsDraftImportWrite,
  existingData: unknown,
): 'write' | 'skip' {
  if (existingData === undefined) return 'write';
  if (JSON.stringify(canonical(existingData)) === JSON.stringify(canonical(write.data))) return 'skip';
  if (!existingData || typeof existingData !== 'object' || Array.isArray(existingData)) {
    throw new Error(`Refusing to overwrite unrecognized existing data at ${write.path}.`);
  }
  const reason = protectedReason(write, existingData as Record<string, unknown>);
  if (reason) throw new Error(`Refusing to overwrite ${write.path}: ${reason}.`);
  return 'write';
}
