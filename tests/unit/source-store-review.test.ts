import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextResponse } from 'next/server';
import { INTERNAL_OPS_ROLES } from '@/lib/schemas/constants';
import {
  OperationalAssetSchema,
  SharedRulePackSchema,
  SourceBundleSchema,
  SourceConflictSchema,
  SourcePageEvidenceSchema,
  type ClaimEvidence,
  type SourceBundle,
} from '@/lib/schemas/source-truth';
import { TrackVersionDocSchema, type TrackVersionDoc } from '@/lib/schemas/curriculum';

const { mockRequireAuth } = vi.hoisted(() => ({ mockRequireAuth: vi.fn() }));
const store = new Map<string, unknown>();
const writes: Array<{ path: string; data: unknown }> = [];

function clone<T>(value: T): T {
  return structuredClone(value);
}

function document(path: string) {
  return {
    path,
    id: path.split('/').at(-1),
    collection: (child: string) => collection(`${path}/${child}`),
    get: async () => ({ exists: store.has(path), data: () => clone(store.get(path)) }),
  };
}

function collection(path: string) {
  return {
    path,
    doc: (id: string) => document(`${path}/${id}`),
    get: async () => ({
      docs: [...store.entries()]
        .filter(([candidate]) => candidate.startsWith(`${path}/`) && !candidate.slice(path.length + 1).includes('/'))
        .map(([, value]) => ({ data: () => clone(value) })),
    }),
  };
}

vi.mock('@/lib/firebase/auth-guard', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/firebase/auth-guard')>();
  return { ...actual, requireAuth: mockRequireAuth };
});

vi.mock('@/lib/firebase/admin', () => ({
  adminDb: {
    collection: (path: string) => collection(path),
    runTransaction: async <T>(callback: (tx: {
      get(ref: { get(): Promise<unknown> }): Promise<unknown>;
      set(ref: { path: string }, data: unknown): void;
    }) => Promise<T>): Promise<T> => {
      const pending: Array<{ ref: { path: string }; data: unknown }> = [];
      const tx = {
        get: (ref: { get(): Promise<unknown> }) => ref.get(),
        set: (ref: { path: string }, data: unknown) => pending.push({ ref, data: clone(data) }),
      };
      const result = await callback(tx);
      for (const operation of pending) {
        store.set(operation.ref.path, clone(operation.data));
        writes.push({ path: operation.ref.path, data: clone(operation.data) });
      }
      return result;
    },
  },
}));

import { GET, POST } from '@/app/api/tracks/[trackId]/source-review/route';
import { POST as actionPOST } from '@/app/api/tracks/[trackId]/source-review/[action]/route';
import { computeSourceBundleRevisionHash, hashSourcePageContent } from '@/lib/services/source-store';

const trackId = 'track-1';
const bundleId = 'bundle-1';
const documentId = 'document-1';
const revisionId = 'revision-1';
const transcriptionText = 'Open the synthetic portal. Select Approve. Confirm the synthetic completion message.';
const params = Promise.resolve({ trackId });

function evidence(overrides: Partial<ClaimEvidence> = {}): ClaimEvidence {
  return {
    id: 'claim-interface',
    claim: 'The trainer must select Approve in the synthetic interface.',
    ruleIds: [],
    excerpts: [{
      documentId,
      revisionId,
      pageNumber: 1,
      exactText: 'Select Approve.',
      fromApprovedTranscription: true,
    }],
    support: 'supported',
    approvalStatus: 'approved',
    critical: true,
    requiresInterfaceDetails: true,
    reviewerUid: 'client-must-not-be-trusted',
    reviewedAt: 1,
    ...overrides,
  };
}

function draft(sourceRevision: string): TrackVersionDoc {
  const card = (id: string, claim?: ClaimEvidence) => ({
    id,
    headline: 'Synthetic evidence review',
    bodyMarkdown: 'Use the exact approved synthetic interface evidence.',
    keyTakeaway: 'Exact evidence is required.',
    doList: ['Review the source.'],
    dontList: ['Do not invent interface details.'],
    sourcePages: [1],
    evidence: claim ? [claim] : [],
  });
  const drills = Array.from({ length: 4 }, (_, index) => ({
    id: `drill-${index + 1}`,
    competencyPillarId: 'pillar-1',
    kind: 'TRUE_FALSE_SPOT' as const,
    prompt: 'Assess this synthetic statement.',
    explanation: 'Synthetic source evidence determines the answer.',
    sourcePages: [1],
    statement: 'The trainer reviewed exact evidence.',
    isCompliant: true,
  }));
  return TrackVersionDocSchema.parse({
    versionId: 'draft', trackId, versionNumber: 1, competencyPillars: [],
    units: [{
      id: 'unit-1', orderIndex: 0, title: 'Synthetic source review', summary: 'Review exact synthetic evidence.',
      estimatedMinutes: 2,
      briefingCards: [card('card-1', evidence({ approvalStatus: 'draft', reviewerUid: null, reviewedAt: null })), card('card-2')],
      drills,
    }],
    simScenarios: [], sourceBundleId: bundleId, sourceRevision, publishedAt: null, createdAt: 1,
  });
}

function seed(): SourceBundle {
  store.set(`tracks/${trackId}`, {
    id: trackId,
    title: 'Synthetic Source Track',
    campaignCode: 'SYNTH',
    divisionId: 'INBOUND',
    status: 'DRAFT',
    generationProgress: { step: 'READY', percent: 100, message: 'Synthetic draft.' },
    sourcePdfStoragePath: 'synthetic/source.pdf',
    sourcePdfFileName: 'source.pdf',
    sourcePageCount: 2,
    activeSourceBundleId: bundleId,
    currentDraftVersionId: 'draft',
    publishedVersionId: null,
    assignedCohortIds: [],
    competencyPillars: [],
    unitCount: 0,
    simScenarioCount: 0,
    estimatedTotalMinutes: 0,
    createdByUid: 'trainer-1',
    createdAt: 1,
    updatedAt: 1,
  });
  const document = {
    id: documentId,
    revisionId,
    bundleId,
    trackId,
    role: 'product' as const,
    fileName: 'source.pdf',
    storagePath: 'synthetic/source.pdf',
    sourceVersion: 'synthetic-v1',
    effectiveDate: null,
    uploadedAt: 1,
    uploadedByUid: 'trainer-1',
    contentHash: `sha256:${'a'.repeat(64)}`,
    pageCount: 2,
    inheritanceOrder: 0,
    excluded: false,
    exclusionReason: null,
  };
  const rawOne = 'Screenshot: Approve interface';
  const rawTwo = 'The synthetic compliance rule requires exact evidence, trainer review, and escalation whenever required operational content is unavailable. This ordinary text page remains readable without a manual transcription and supports the inherited shared rule pack.';
  const pages = [
    SourcePageEvidenceSchema.parse({
      id: 'page-1', documentId, revisionId, pageNumber: 1, rawText: rawOne, normalizedText: rawOne,
      contentHash: hashSourcePageContent(rawOne), characterCount: rawOne.length,
      extractionFlags: ['low_text_density', 'manual_transcription_required'], transcription: null, approvedExcerpts: [],
    }),
    SourcePageEvidenceSchema.parse({
      id: 'page-2', documentId, revisionId, pageNumber: 2, rawText: rawTwo, normalizedText: rawTwo,
      contentHash: hashSourcePageContent(rawTwo), characterCount: rawTwo.length,
      extractionFlags: [], transcription: null, approvedExcerpts: [],
    }),
  ];
  const baseBundle = {
    schemaVersion: 1 as const,
    id: bundleId,
    trackId,
    documents: [document],
    sharedRulePackIds: ['pack-1'],
    precedencePolicyId: 'standard-meds-precedence-v1',
    conflictIds: ['conflict-1'],
    status: 'approved' as const,
    revisionHash: computeSourceBundleRevisionHash({ documents: [document], sharedRulePackIds: ['pack-1'], precedencePolicyId: 'standard-meds-precedence-v1' }, pages),
    approvedSourceRevision: null,
    approvedByUid: 'trainer-1',
    approvedAt: 1,
    createdAt: 1,
    updatedAt: 1,
  };
  const bundle = SourceBundleSchema.parse({ ...baseBundle, approvedSourceRevision: baseBundle.revisionHash });
  store.set(`tracks/${trackId}/sourceBundles/${bundleId}`, bundle);
  store.set(`tracks/${trackId}/versions/draft`, draft(bundle.revisionHash));
  for (const page of pages) store.set(`tracks/${trackId}/sourceBundles/${bundleId}/pageEvidence/${page.id}`, page);

  const ruleEvidence = evidence({
    id: 'claim-rule',
    claim: 'The synthetic compliance rule requires exact evidence.',
    critical: false,
    requiresInterfaceDetails: false,
    excerpts: [{ documentId, revisionId, pageNumber: 2, exactText: 'The synthetic compliance rule requires exact evidence', fromApprovedTranscription: false }],
  });
  const pack = SharedRulePackSchema.parse({
    id: 'pack-1', revision: 'pack-revision-1', title: 'Synthetic shared rules', sourceDocumentIds: [documentId],
    approvalStatus: 'draft', createdAt: 1, updatedAt: 1,
    rules: [{
      id: 'rule-1', packId: 'pack-1', title: 'Synthetic evidence rule', statement: 'Require exact evidence.', severity: 'critical',
      applicableTrackIds: [trackId], channels: ['synthetic'], stages: ['review'], evidence: ruleEvidence,
      requiredKnowledge: true, requiredScenarioCoverage: true, sourceRevision: bundle.revisionHash,
      approvalStatus: 'draft', approvedByUid: null, approvedAt: null,
    }],
  });
  store.set(`tracks/${trackId}/sourceBundles/${bundleId}/rulePacks/pack-1`, pack);

  const asset = OperationalAssetSchema.parse({
    id: 'workflow-1', trackId, kind: 'workflow', product: 'Synthetic', context: 'training', stage: 'approval',
    sourceRefs: [{ documentId, revisionId, pageNumber: 1, exactText: 'Select Approve.', fromApprovedTranscription: true }],
    effectiveFrom: null, effectiveTo: null, status: 'draft', approvedByUid: null, approvedAt: null,
    actionType: 'synthetic_approval', sequence: [{ order: 1, action: 'Select Approve', screenLabel: 'Approve' }],
    requiresInterfaceDetails: true, allowedFields: ['syntheticResult'],
  });
  store.set(`tracks/${trackId}/sourceBundles/${bundleId}/assets/workflow-1`, asset);

  const conflict = SourceConflictSchema.parse({
    id: 'conflict-1', trackId,
    sourceRefs: [
      { documentId, revisionId, pageNumber: 1, exactText: 'Open the synthetic portal.', fromApprovedTranscription: true },
      { documentId, revisionId, pageNumber: 1, exactText: 'Confirm the synthetic completion message.', fromApprovedTranscription: true },
    ],
    affectedProducts: ['Synthetic'], affectedContexts: ['training'], affectedStages: ['approval'],
    affectedAssetIds: [], affectedRuleIds: [], detectedValues: ['Open first', 'Confirm last'], severity: 'critical', status: 'open',
    decision: null, decisionOwnerUid: null, decidedAt: null, effectiveFrom: null, effectiveTo: null,
    downstreamInvalidationStatus: 'not_required',
  });
  store.set(`tracks/${trackId}/sourceBundles/${bundleId}/conflicts/conflict-1`, conflict);
  return bundle;
}

function request(body: unknown): Request {
  return new Request(`http://localhost/api/tracks/${trackId}/source-review`, {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body),
  });
}

async function command(body: Record<string, unknown>) {
  return POST(request({ bundleId, ...body }), { params });
}

beforeEach(() => {
  store.clear();
  writes.length = 0;
  vi.clearAllMocks();
  mockRequireAuth.mockResolvedValue({
    ok: true,
    user: {
      uid: 'trainer-1', email: 'trainer@synthetic.internal', displayName: 'Synthetic Trainer', role: 'TRAINER',
      partnerCohortId: 'INTERNAL', divisionIds: ['INBOUND'], active: true,
    },
  });
  seed();
});

describe('trainer source review gates', () => {
  it('rejects wrong-page and image-caption evidence with zero writes even when the client claims support', async () => {
    const wrongPage = evidence({
      excerpts: [{ documentId, revisionId, pageNumber: 2, exactText: 'Select Approve.', fromApprovedTranscription: false }],
    });
    const wrongResponse = await command({ action: 'approve_excerpt', evidence: wrongPage });
    expect(wrongResponse.status).toBe(422);
    expect((await wrongResponse.json()).error).toBe('EVIDENCE_NOT_SUPPORTED');

    const captionResponse = await command({ action: 'approve_excerpt', evidence: evidence() });
    expect(captionResponse.status).toBe(422);
    expect(writes).toEqual([]);
  });

  it('enforces transcription, recomputes approvals, records SME decisions, and approves the complete bundle', async () => {
    const initial = seed();
    const packResponse = await command({ action: 'approve_rule_pack', rulePackId: 'pack-1' });
    expect(packResponse.status).toBe(200);
    expect((await packResponse.json()).rulePack.rules[0]).toMatchObject({ approvalStatus: 'approved', approvedByUid: 'trainer-1' });

    const gatedAsset = await command({ action: 'approve_asset', assetId: 'workflow-1' });
    expect(gatedAsset.status).toBe(422);
    expect((await gatedAsset.json()).error).toBe('ASSET_EVIDENCE_INVALID');
    const gatedBundle = await command({ action: 'approve_bundle' });
    expect(gatedBundle.status).toBe(422);
    expect((await gatedBundle.json()).error).toBe('TRANSCRIPTION_REQUIRED');
    expect(writes.filter((write) => write.path.includes('/assets/') || write.path.endsWith(`/sourceBundles/${bundleId}`))).toEqual([]);

    const transcriptionResponse = await command({
      action: 'approve_transcription', documentId, revisionId, pageNumber: 1, text: transcriptionText,
    });
    expect(transcriptionResponse.status).toBe(200);
    const transcriptionBody = await transcriptionResponse.json();
    expect(transcriptionBody.page.transcription).toMatchObject({ text: transcriptionText, approvedByUid: 'trainer-1' });
    expect(transcriptionBody.sourceRevision).not.toBe(initial.revisionHash);
    expect(transcriptionBody.bundle).toMatchObject({ status: 'draft', approvedSourceRevision: null, approvedByUid: null });

    const decisionResponse = await command({
      action: 'record_conflict_decision', conflictId: 'conflict-1', status: 'resolved',
      decision: 'Use the approved synthetic sequence for this training context.',
      effectiveFrom: '2026-01-01', effectiveTo: '2026-12-31',
    });
    expect(decisionResponse.status).toBe(200);
    expect((await decisionResponse.json()).conflict).toMatchObject({
      status: 'resolved', decisionOwnerUid: 'trainer-1', downstreamInvalidationStatus: 'required',
    });

    const excerptResponse = await command({ action: 'approve_excerpt', evidence: evidence() });
    expect(excerptResponse.status).toBe(200);
    expect((await excerptResponse.json()).evidence).toMatchObject({
      support: 'supported', approvalStatus: 'approved', reviewerUid: 'trainer-1',
    });
    const approvedAsset = await command({ action: 'approve_asset', assetId: 'workflow-1' });
    expect(approvedAsset.status).toBe(200);
    expect((await approvedAsset.json()).asset).toMatchObject({ status: 'approved', approvedByUid: 'trainer-1' });

    const bundleResponse = await command({ action: 'approve_bundle' });
    expect(bundleResponse.status).toBe(200);
    expect((await bundleResponse.json()).bundle).toMatchObject({
      status: 'approved', approvedSourceRevision: transcriptionBody.sourceRevision, approvedByUid: 'trainer-1',
    });
  });

  it('returns parsed review data and rejects malformed input or stale revisions without writes', async () => {
    const getResponse = await GET(new Request(`http://localhost/api/tracks/${trackId}/source-review`), { params });
    expect(getResponse.status).toBe(200);
    const review = await getResponse.json();
    expect(review.bundle.id).toBe(bundleId);
    expect(review.pages).toHaveLength(2);
    expect(review.rulePacks).toHaveLength(1);
    expect(review.assets).toHaveLength(1);
    expect(review.conflicts).toHaveLength(1);
    expect(writes).toEqual([]);

    const malformed = await command({ action: 'not-a-command' });
    expect(malformed.status).toBe(400);
    const stale = await command({ action: 'approve_bundle', expectedRevisionHash: `sha256:${'0'.repeat(64)}` });
    expect(stale.status).toBe(409);
    expect((await stale.json()).error).toBe('SOURCE_REVISION_CONFLICT');
    expect(writes).toEqual([]);
  });

  it('supports Studio action subroutes and persists draft evidence approval by ID', async () => {
    const call = (action: string, body: Record<string, unknown>) => actionPOST(
      new Request(`http://localhost/api/tracks/${trackId}/source-review/${action}`, {
        method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ bundleId, ...body }),
      }),
      { params: Promise.resolve({ trackId, action }) },
    );

    expect((await call('transcription', { pageId: 'page-1', text: transcriptionText, approve: true })).status).toBe(200);
    expect((await call('conflict', { conflictId: 'conflict-1', status: 'sme_review' })).status).toBe(200);
    expect((await call('conflict', {
      conflictId: 'conflict-1', status: 'resolved', decision: 'Use the approved synthetic sequence.',
    })).status).toBe(200);
    const approved = await call('excerpt', { evidenceId: 'claim-interface', claimId: 'claim-interface', approvalStatus: 'approved' });
    expect(approved.status).toBe(200);

    const savedDraft = store.get(`tracks/${trackId}/versions/draft`) as TrackVersionDoc;
    expect(savedDraft.units[0].briefingCards[0].evidence?.[0]).toMatchObject({
      id: 'claim-interface', support: 'supported', approvalStatus: 'approved', reviewerUid: 'trainer-1',
    });
    expect(savedDraft.units[0].briefingCards[1].evidence).toEqual([]);
  });

  it('rejects bundle approval for pack-level decisions and every open conflict severity', async () => {
    const transcription = await command({
      action: 'approve_transcription', documentId, revisionId, pageNumber: 1, text: transcriptionText,
    });
    expect(transcription.status).toBe(200);
    const bundlePath = `tracks/${trackId}/sourceBundles/${bundleId}`;
    const currentBundle = store.get(bundlePath) as SourceBundle;
    const writesBeforeGates = writes.length;

    store.set(bundlePath, { ...currentBundle, unresolvedSmeDecisionIds: ['SME-01'] });
    const registerResponse = await command({ action: 'approve_bundle' });
    expect(registerResponse.status).toBe(409);
    expect((await registerResponse.json()).error).toBe('SME_DECISION_REQUIRED');
    expect(writes).toHaveLength(writesBeforeGates);

    store.set(bundlePath, { ...currentBundle, unresolvedSmeDecisionIds: [] });
    const conflictPath = `${bundlePath}/conflicts/conflict-1`;
    const currentConflict = SourceConflictSchema.parse(store.get(conflictPath));
    store.set(conflictPath, { ...currentConflict, severity: 'major', status: 'open' });
    const majorResponse = await command({ action: 'approve_bundle' });
    expect(majorResponse.status).toBe(409);
    expect((await majorResponse.json()).error).toBe('SME_DECISION_REQUIRED');
    expect(writes).toHaveLength(writesBeforeGates);
  });

  it('uses internal-ops authorization before reading review data', async () => {
    mockRequireAuth.mockResolvedValue({ ok: false, response: NextResponse.json({ error: 'FORBIDDEN' }, { status: 403 }) });
    const response = await GET(new Request(`http://localhost/api/tracks/${trackId}/source-review`), { params });
    expect(response.status).toBe(403);
    expect(mockRequireAuth).toHaveBeenCalledWith(expect.any(Request), INTERNAL_OPS_ROLES);
    expect(writes).toEqual([]);
  });
});
