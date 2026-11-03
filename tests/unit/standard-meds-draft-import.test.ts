import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  DRAFT_VERSION_ID,
  EvalRubricsDocSchema,
  TrackDocSchema,
  TrackVersionDocSchema,
  type EvalRubricsDoc,
  type TrackVersionDoc,
} from '@/lib/schemas/curriculum';
import {
  SourceBundleSchema,
  SourcePageEvidenceSchema,
  type ClaimEvidence,
  type SourceBundle,
  type SourcePageEvidence,
} from '@/lib/schemas/source-truth';
import {
  STANDARD_MEDS_CALL_PACKS,
  STANDARD_MEDS_ORIENTATION_PACK,
  STANDARD_MEDS_SME_DECISION_IDS,
} from '@/lib/content/standard-meds';
import {
  assertStandardMedsDraftImportWriteGate,
  buildStandardMedsDraftImport,
  standardMedsDraftImportWriteAction,
  type StandardMedsDraftImportWrite,
} from '@/lib/services/standard-meds-draft-import';

function writesOfKind(plan: ReturnType<typeof buildStandardMedsDraftImport>, kind: StandardMedsDraftImportWrite['kind']): StandardMedsDraftImportWrite[] {
  return plan.writes.filter((write) => write.kind === kind);
}

function clone<T>(value: T): T {
  return structuredClone(value);
}

function approvedClaimEvidence(): ClaimEvidence {
  return {
    id: 'synthetic-approved-claim',
    claim: 'A synthetic trainer-approved claim.',
    ruleIds: [],
    excerpts: [{
      documentId: 'synthetic-document',
      revisionId: 'synthetic-revision',
      pageNumber: 1,
      exactText: 'Exact synthetic source excerpt.',
      fromApprovedTranscription: false,
    }],
    support: 'supported',
    approvalStatus: 'approved',
    critical: true,
    requiresInterfaceDetails: false,
    reviewerUid: 'synthetic-trainer',
    reviewedAt: 123,
  };
}

describe('Standard Meds controlled draft import builder', () => {
  it('builds and schema-validates the orientation, eight call drafts, secrets, bundles, and all inherited page metadata', () => {
    const plan = buildStandardMedsDraftImport();
    expect(plan.tracks.map((track) => track.sourceCode)).toEqual(['SM-00', 'SM-01', 'SM-02', 'SM-03', 'SM-04', 'SM-05', 'SM-06', 'SM-07', 'SM-08']);
    expect(writesOfKind(plan, 'track')).toHaveLength(9);
    expect(writesOfKind(plan, 'version')).toHaveLength(9);
    expect(writesOfKind(plan, 'secrets')).toHaveLength(8);
    expect(writesOfKind(plan, 'source_bundle')).toHaveLength(9);
    expect(writesOfKind(plan, 'page_evidence')).toHaveLength(283);
    expect(plan.writes).toHaveLength(318);
    expect(new Set(plan.writes.map((write) => write.path)).size).toBe(plan.writes.length);

    for (const write of plan.writes) {
      if (write.kind === 'track') TrackDocSchema.parse(write.data);
      if (write.kind === 'version') TrackVersionDocSchema.parse(write.data);
      if (write.kind === 'secrets') EvalRubricsDocSchema.parse(write.data);
      if (write.kind === 'source_bundle') SourceBundleSchema.parse(write.data);
      if (write.kind === 'page_evidence') SourcePageEvidenceSchema.parse(write.data);
    }

    const orientationVersion = writesOfKind(plan, 'version')
      .map((write) => write.data as TrackVersionDoc)
      .find((version) => version.trackId === 'standard-meds-sm-00');
    expect(orientationVersion?.units).toEqual(STANDARD_MEDS_ORIENTATION_PACK.units);
    expect(orientationVersion?.simScenarios).toEqual([]);
    expect(orientationVersion?.publishedAt).toBeNull();
    expect(orientationVersion?.versionId).toBe(DRAFT_VERSION_ID);
    expect(plan.writes.some((write) => write.path.includes('standard-meds-sm-00/versions/draft/secrets/'))).toBe(false);
  });

  it('is deterministic and makes unchanged reruns no-ops', () => {
    const first = buildStandardMedsDraftImport();
    const second = buildStandardMedsDraftImport();
    expect(second).toEqual(first);
    for (const write of first.writes) {
      expect(standardMedsDraftImportWriteAction(write, clone(write.data))).toBe('skip');
      expect(standardMedsDraftImportWriteAction(write, undefined)).toBe('write');
    }
  });

  it('binds every draft and scenario to its computed bundle revision without approving or publishing', () => {
    const plan = buildStandardMedsDraftImport();
    for (const summary of plan.tracks) {
      const bundle = plan.writes.find((write) => write.kind === 'source_bundle' && write.path === `tracks/${summary.trackId}/sourceBundles/${summary.sourceBundleId}`)?.data as SourceBundle;
      const version = plan.writes.find((write) => write.kind === 'version' && write.path === `tracks/${summary.trackId}/versions/${summary.versionId}`)?.data as TrackVersionDoc;
      expect(version.sourceBundleId).toBe(bundle.id);
      expect(version.sourceRevision).toBe(bundle.revisionHash);
      expect(version.publishedAt).toBeNull();
      expect(version.versionId).toBe(DRAFT_VERSION_ID);
      expect(bundle.status).toBe('needs_sme');
      expect(bundle.unresolvedSmeDecisionIds).toEqual(summary.openSmeDecisionIds);
      expect(bundle.approvedSourceRevision).toBeNull();
      expect(bundle.approvedByUid).toBeNull();
      expect(bundle.approvedAt).toBeNull();
      for (const scenario of version.simScenarios) {
        expect(scenario.context?.sourceRevision).toBe(bundle.revisionHash);
        expect(scenario.context?.curriculumVersion).toBe(DRAFT_VERSION_ID);
      }
      expect(summary.publication).toBe(summary.sourceCode === 'SM-00'
        ? STANDARD_MEDS_ORIENTATION_PACK.publication
        : STANDARD_MEDS_CALL_PACKS.find((pack) => pack.code === summary.sourceCode)?.publication);
    }

    const tracks = writesOfKind(plan, 'track').map((write) => TrackDocSchema.parse(write.data));
    for (const track of tracks) {
      expect(track.status).toBe('DRAFT');
      expect(track.currentDraftVersionId).toBe(DRAFT_VERSION_ID);
      expect(track.publishedVersionId).toBeNull();
      expect(track.assignedCohortIds).toEqual([]);
      expect(track.createdByUid).toBe('synthetic-standard-meds-draft-import');
    }
    expect(new Set(plan.tracks.flatMap((track) => track.openSmeDecisionIds))).toEqual(new Set(STANDARD_MEDS_SME_DECISION_IDS));
  });

  it('keeps page evidence metadata-only and defers evidence-dependent records with precise blockers', () => {
    const plan = buildStandardMedsDraftImport();
    const pages = writesOfKind(plan, 'page_evidence').map((write) => write.data as SourcePageEvidence);
    for (const page of pages) {
      expect(page.rawText).toBe('');
      expect(page.normalizedText).toBe('');
      expect(page.transcription).toBeNull();
      expect(page.approvedExcerpts).toEqual([]);
      expect(page.contentHash).toMatch(/^sha256:[a-f0-9]{64}$/);
      expect(page.characterCount).toBeGreaterThan(0);
    }
    expect(plan.writes.some((write) => /\/(rulePacks|assets|conflicts)\//.test(write.path))).toBe(false);

    for (const summary of plan.tracks) {
      const issueCodes = new Set(summary.importIssues.map((issue) => issue.code));
      expect(issueCodes).toContain('SOURCE_PAGE_TEXT_NOT_EMBEDDED');
      expect(issueCodes).toContain('RULE_PACK_EXACT_EXCERPTS_REQUIRED');
      expect(issueCodes).toContain('CONFLICT_EXACT_EXCERPTS_REQUIRED');
      const ruleIssue = summary.importIssues.find((issue) => issue.code === 'RULE_PACK_EXACT_EXCERPTS_REQUIRED');
      expect(ruleIssue?.affectedIds).toEqual(summary.requiredRuleIds);
      expect(summary.publication.eligible).toBe(false);
      expect(summary.publication.approvalStatus).toBe('draft');
    }
    for (const pack of STANDARD_MEDS_CALL_PACKS) {
      const summary = plan.tracks.find((track) => track.sourceCode === pack.code)!;
      const assetIssue = summary.importIssues.find((issue) => issue.code === 'ASSET_EXACT_EXCERPTS_REQUIRED');
      expect(assetIssue?.affectedIds).toEqual(pack.syntheticLinks.map((link) => link.id));
    }
  });

  it('writes each call pack secret rubric only below its unpublished version', () => {
    const plan = buildStandardMedsDraftImport();
    for (const pack of STANDARD_MEDS_CALL_PACKS) {
      const path = `tracks/${pack.version.trackId}/versions/${DRAFT_VERSION_ID}/secrets/evalRubrics`;
      const write = plan.writes.find((candidate) => candidate.path === path);
      expect(write?.kind).toBe('secrets');
      expect(write?.data).toEqual({ ...pack.evalRubrics, versionId: DRAFT_VERSION_ID });
      expect(pack.version.publishedAt).toBeNull();
    }
  });

  it('fails validation instead of building a plan for an approved or published input pack', () => {
    const invalid = clone(STANDARD_MEDS_CALL_PACKS[0]);
    invalid.version.publishedAt = 123;
    const callPacks = [invalid, ...STANDARD_MEDS_CALL_PACKS.slice(1)];
    expect(() => buildStandardMedsDraftImport({ callPacks })).toThrow('curriculum must remain unpublished');

    const approved = clone(STANDARD_MEDS_ORIENTATION_PACK);
    approved.publication.approvalStatus = 'approved' as never;
    expect(() => buildStandardMedsDraftImport({ orientationPack: approved })).toThrow('must remain an ineligible draft');
  });
});

describe('Standard Meds write safety', () => {
  it('requires explicit confirmation and a loopback Firestore emulator with no production override', () => {
    expect(() => assertStandardMedsDraftImportWriteGate({ confirmSyntheticLocal: false, firestoreEmulatorHost: '127.0.0.1:8080' })).toThrow('--confirm-synthetic-local');
    expect(() => assertStandardMedsDraftImportWriteGate({ confirmSyntheticLocal: true, firestoreEmulatorHost: undefined })).toThrow('loopback emulator');
    expect(() => assertStandardMedsDraftImportWriteGate({ confirmSyntheticLocal: true, firestoreEmulatorHost: 'firestore.googleapis.com:443' })).toThrow('loopback emulator');
    expect(() => assertStandardMedsDraftImportWriteGate({ confirmSyntheticLocal: true, firestoreEmulatorHost: '127.0.0.1:70000' })).toThrow('invalid emulator port');
    expect(() => assertStandardMedsDraftImportWriteGate({ confirmSyntheticLocal: true, firestoreEmulatorHost: '127.0.0.1:8080' })).not.toThrow();
    expect(() => assertStandardMedsDraftImportWriteGate({ confirmSyntheticLocal: true, firestoreEmulatorHost: 'localhost:8080' })).not.toThrow();
    expect(() => assertStandardMedsDraftImportWriteGate({ confirmSyntheticLocal: true, firestoreEmulatorHost: '[::1]:8080' })).not.toThrow();
  });

  it('allows changed ordinary drafts but refuses to replace a published track or version', () => {
    const plan = buildStandardMedsDraftImport();
    const version = writesOfKind(plan, 'version')[0];
    expect(standardMedsDraftImportWriteAction(version, { ...(version.data as object), units: [] })).toBe('write');
    expect(() => standardMedsDraftImportWriteAction(version, { ...(version.data as object), publishedAt: 123 })).toThrow('curriculum version is published');

    const track = writesOfKind(plan, 'track')[0];
    expect(() => standardMedsDraftImportWriteAction(track, { ...(track.data as object), status: 'PUBLISHED' })).toThrow('track has a published version');
    expect(() => standardMedsDraftImportWriteAction(track, { ...(track.data as object), publishedVersionId: 'v1' })).toThrow('track has a published version');
  });

  it('refuses changed unpublished versions containing approved ClaimEvidence but skips identical records', () => {
    const plan = buildStandardMedsDraftImport();
    const version = writesOfKind(plan, 'version')[0];
    const existing = clone(version.data) as TrackVersionDoc;
    existing.units[0].briefingCards[0].evidence = [approvedClaimEvidence()];
    expect(existing.publishedAt).toBeNull();

    expect(standardMedsDraftImportWriteAction({ ...version, data: existing }, clone(existing))).toBe('skip');
    expect(() => standardMedsDraftImportWriteAction(version, existing)).toThrow('trainer-approved ClaimEvidence');

    const unapproved = clone(existing);
    unapproved.units[0].briefingCards[0].evidence![0].approvalStatus = 'draft';
    unapproved.units[0].briefingCards[0].evidence![0].reviewerUid = null;
    unapproved.units[0].briefingCards[0].evidence![0].reviewedAt = null;
    expect(standardMedsDraftImportWriteAction(version, unapproved)).toBe('write');
  });

  it('refuses changed secrets containing approved ClaimEvidence but skips identical records and allows unapproved drafts', () => {
    const plan = buildStandardMedsDraftImport();
    const secrets = writesOfKind(plan, 'secrets')[0];
    const existing = clone(secrets.data) as EvalRubricsDoc;
    existing.scenarios[0].rubricCriteria[0].evidence = [approvedClaimEvidence()];

    expect(standardMedsDraftImportWriteAction({ ...secrets, data: existing }, clone(existing))).toBe('skip');
    expect(() => standardMedsDraftImportWriteAction(secrets, existing)).toThrow('trainer-approved ClaimEvidence');

    const unapproved = clone(existing);
    unapproved.scenarios[0].rubricCriteria[0].evidence![0].approvalStatus = 'draft';
    unapproved.scenarios[0].rubricCriteria[0].evidence![0].reviewerUid = null;
    unapproved.scenarios[0].rubricCriteria[0].evidence![0].reviewedAt = null;
    expect(standardMedsDraftImportWriteAction(secrets, unapproved)).toBe('write');
  });

  it('preflights the entire seed plan through the write action before chunked writes', () => {
    const seedScript = readFileSync(new URL('../../scripts/seed-standard-meds-drafts.ts', import.meta.url), 'utf8');
    const refs = seedScript.indexOf('const refs = plan.writes.map((write) => db.doc(write.path));');
    const preflight = seedScript.indexOf('const existing = await db.getAll(...refs);');
    const action = seedScript.indexOf('standardMedsDraftImportWriteAction(plan.writes[index], snapshot.exists ? snapshot.data() : undefined);');
    const chunkedWrites = seedScript.indexOf('for (let start = 0; start < plan.writes.length; start += WRITE_CHUNK_SIZE)');
    expect(refs).toBeGreaterThanOrEqual(0);
    expect(preflight).toBeGreaterThan(refs);
    expect(action).toBeGreaterThan(preflight);
    expect(chunkedWrites).toBeGreaterThan(action);
  });

  it('refuses to erase bundle approvals, extracted text, transcription, or approved excerpts', () => {
    const plan = buildStandardMedsDraftImport();
    const bundle = writesOfKind(plan, 'source_bundle')[0];
    expect(() => standardMedsDraftImportWriteAction(bundle, { ...(bundle.data as object), status: 'approved' })).toThrow('approval or publication state');
    expect(() => standardMedsDraftImportWriteAction(bundle, { ...(bundle.data as object), approvedByUid: 'trainer-1' })).toThrow('approval or publication state');

    const page = writesOfKind(plan, 'page_evidence')[0];
    expect(() => standardMedsDraftImportWriteAction(page, { ...(page.data as object), rawText: 'Existing extracted synthetic text.' })).toThrow('contains extracted, transcribed, or approved evidence');
    expect(() => standardMedsDraftImportWriteAction(page, { ...(page.data as object), transcription: { text: 'Existing synthetic transcription.' } })).toThrow('contains extracted, transcribed, or approved evidence');
    expect(() => standardMedsDraftImportWriteAction(page, { ...(page.data as object), approvedExcerpts: [{ id: 'existing-evidence' }] })).toThrow('contains extracted, transcribed, or approved evidence');
  });

  it('refuses changed imports that would erase conflict or unresolved-SME registry entries', () => {
    const plan = buildStandardMedsDraftImport();
    const bundle = writesOfKind(plan, 'source_bundle')[0];
    const withConflict = clone(bundle.data) as SourceBundle;
    withConflict.conflictIds = ['existing-conflict'];
    expect(() => standardMedsDraftImportWriteAction(bundle, withConflict)).toThrow('conflict or unresolved-SME registry state');

    const withAdditionalDecision = clone(bundle.data) as SourceBundle;
    withAdditionalDecision.unresolvedSmeDecisionIds = [...withAdditionalDecision.unresolvedSmeDecisionIds, 'SME-EXISTING-EXTRA'];
    expect(() => standardMedsDraftImportWriteAction(bundle, withAdditionalDecision)).toThrow('conflict or unresolved-SME registry state');
  });
});
