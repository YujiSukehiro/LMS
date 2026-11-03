import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextResponse } from 'next/server';
import { createProvenance } from '@/lib/ai/provenance';
import { INTERNAL_OPS_ROLES } from '@/lib/schemas/constants';
import type { TrackVersionDoc } from '@/lib/schemas/curriculum';
import type { SimSessionDoc } from '@/lib/schemas/analytics';
import {
  SourceConflictSchema,
  type ClaimEvidence,
  type SourcePageEvidence,
} from '@/lib/schemas/source-truth';
import {
  buildTrainerQaQueue,
  TrainerQaDataError,
  type BuildTrainerQaQueueInput,
} from '@/lib/services/trainer-qa';
import {
  drillAttempt,
  learningBlueprint,
  learningVersion,
  NOW,
  scenarioSession,
} from './helpers/learning-service-fixtures';

const { mockRequireAuth, mockLoadQueue } = vi.hoisted(() => ({
  mockRequireAuth: vi.fn(),
  mockLoadQueue: vi.fn(),
}));

vi.mock('@/lib/firebase/auth-guard', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/firebase/auth-guard')>();
  return { ...actual, requireAuth: mockRequireAuth };
});

vi.mock('@/lib/services/trainer-qa', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/services/trainer-qa')>();
  return { ...actual, loadTrainerQaQueue: mockLoadQueue };
});

import { GET } from '@/app/api/studio/tracks/[trackId]/qa/route';

function draft(): TrackVersionDoc {
  return learningVersion({ versionId: 'draft', publishedAt: null });
}

function input(overrides: Partial<BuildTrainerQaQueueInput> = {}): BuildTrainerQaQueueInput {
  return {
    trackId: 'track-1',
    draft: draft(),
    learningVersion: learningVersion(),
    blueprint: learningBlueprint(),
    source: { bundle: null, pages: [], rulePacks: [], assets: [], conflicts: [] },
    secrets: [],
    drillAttempts: [],
    simSessions: [],
    now: Date.parse(NOW),
    ...overrides,
  };
}

function exactClaim(overrides: Partial<ClaimEvidence> = {}): ClaimEvidence {
  return {
    id: 'claim-exact',
    claim: 'Synthetic operators must verify identity.',
    ruleIds: ['rule-privacy'],
    excerpts: [{
      documentId: 'document-1',
      revisionId: 'revision-1',
      pageNumber: 1,
      exactText: 'Verify identity before disclosure.',
      fromApprovedTranscription: false,
    }],
    support: 'supported',
    approvalStatus: 'approved',
    critical: true,
    requiresInterfaceDetails: false,
    reviewerUid: 'trainer-1',
    reviewedAt: 1,
    ...overrides,
  };
}

function exactPage(text = 'Verify identity before disclosure.'): SourcePageEvidence {
  return {
    id: 'page-1',
    documentId: 'document-1',
    revisionId: 'revision-1',
    pageNumber: 1,
    rawText: text,
    normalizedText: text,
    contentHash: `sha256:${'a'.repeat(64)}`,
    characterCount: text.length,
    extractionFlags: [],
    transcription: null,
    approvedExcerpts: [],
  };
}

function criticalConflict(status: 'open' | 'sme_review' | 'resolved' = 'open') {
  return SourceConflictSchema.parse({
    id: 'conflict-critical',
    trackId: 'track-1',
    sourceRefs: [
      { documentId: 'document-1', revisionId: 'revision-1', pageNumber: 1, exactText: 'Verify identity before disclosure.', fromApprovedTranscription: false },
      { documentId: 'document-2', revisionId: 'revision-1', pageNumber: 1, exactText: 'Synthetic conflicting value.', fromApprovedTranscription: false },
    ],
    affectedProducts: ['Synthetic'],
    affectedContexts: ['training'],
    affectedStages: ['verification'],
    affectedAssetIds: [],
    affectedRuleIds: ['rule-privacy'],
    detectedValues: ['Verify first', 'Synthetic alternate'],
    severity: 'critical',
    status,
    decision: status === 'resolved' ? 'Use the reviewed synthetic rule.' : null,
    decisionOwnerUid: status === 'resolved' ? 'sme-1' : null,
    decidedAt: status === 'resolved' ? 1 : null,
    effectiveFrom: null,
    effectiveTo: null,
    downstreamInvalidationStatus: 'not_required',
  });
}

function drillsWithFailures() {
  return Array.from({ length: 5 }, (_, index) => drillAttempt({
    id: `attempt-${index + 1}`,
    correct: index >= 2,
    score: index >= 2 ? 100 : 0,
  }));
}

function simulationsWithFailures(): SimSessionDoc[] {
  return Array.from({ length: 5 }, (_, index) => {
    const session = scenarioSession({ id: `session-${index + 1}` });
    if (index < 2) session.evaluation!.passed = false;
    return session;
  });
}

describe('trainer bulk QA aggregation', () => {
  it('recomputes exact support and complete approval instead of trusting persisted labels', () => {
    const reviewedDraft = draft();
    reviewedDraft.units[0].briefingCards[0].evidence = [exactClaim()];
    const supported = buildTrainerQaQueue(input({
      draft: reviewedDraft,
      source: { bundle: null, pages: [exactPage()], rulePacks: [], assets: [], conflicts: [] },
    }));
    expect(supported.items.some((item) => item.target.id === 'claim-exact')).toBe(false);

    const unapprovedDraft = structuredClone(reviewedDraft);
    unapprovedDraft.units[0].briefingCards[0].evidence![0].approvalStatus = 'draft';
    const unapproved = buildTrainerQaQueue(input({
      draft: unapprovedDraft,
      source: { bundle: null, pages: [exactPage()], rulePacks: [], assets: [], conflicts: [] },
    }));
    expect(unapproved.items.find((item) => item.target.id === 'claim-exact')).toMatchObject({
      category: 'unsupported_evidence',
      evidence: { support: 'supported', approvalStatus: 'draft' },
    });

    const mismatched = buildTrainerQaQueue(input({
      draft: reviewedDraft,
      source: { bundle: null, pages: [exactPage('Different persisted source text.')], rulePacks: [], assets: [], conflicts: [] },
    }));
    expect(mismatched.items.find((item) => item.target.id === 'claim-exact')).toMatchObject({
      category: 'unsupported_evidence',
      evidence: { support: 'unsupported', approvalStatus: 'draft' },
    });
  });

  it('queues missing exact evidence and only unresolved critical SME conflicts', () => {
    const missing = buildTrainerQaQueue(input());
    expect(missing.items.some((item) => item.category === 'unsupported_evidence' && item.target.id === 'u1-c1')).toBe(true);
    expect(missing.counts.byCategory.critical_conflict).toBe(0);

    const reviewedDraft = draft();
    reviewedDraft.units[0].briefingCards[0].evidence = [exactClaim()];
    const open = buildTrainerQaQueue(input({
      draft: reviewedDraft,
      source: { bundle: null, pages: [exactPage()], rulePacks: [], assets: [], conflicts: [criticalConflict()] },
    }));
    expect(open.counts.byCategory.critical_conflict).toBe(1);
    expect(open.items.find((item) => item.target.id === 'claim-exact')?.evidence?.support).toBe('conflicted');

    const resolved = buildTrainerQaQueue(input({
      draft: reviewedDraft,
      source: { bundle: null, pages: [exactPage()], rulePacks: [], assets: [], conflicts: [criticalConflict('resolved')] },
    }));
    expect(resolved.counts.byCategory.critical_conflict).toBe(0);
  });

  it('requires five eligible Drill attempts and reports the exact failure rate', () => {
    const attempts = drillsWithFailures();
    const excluded = [
      drillAttempt({ id: 'legacy-failure', correct: false, provenance: 'imported_legacy' }),
      drillAttempt({ id: 'historical-failure', correct: false, curriculumVersion: 'v0' }),
    ];
    const queue = buildTrainerQaQueue(input({ drillAttempts: [...attempts, ...excluded] }));
    const row = queue.items.find((item) => item.id === 'high_learner_failure:drill:u1-d1');
    expect(row?.metric).toMatchObject({ sampleSize: 5, failures: 2, failureRate: 0.4, minimumSampleSize: 5 });

    const tooSmall = buildTrainerQaQueue(input({
      drillAttempts: attempts.slice(0, 4).map((attempt) => ({ ...attempt, correct: false })),
    }));
    expect(tooSmall.items.some((item) => item.id === 'high_learner_failure:drill:u1-d1')).toBe(false);
  });

  it('computes Simulation failure from eligible evaluated evidence and excludes replay', () => {
    const replayFailures = Array.from({ length: 5 }, (_, index) => {
      const session = scenarioSession({
        id: `replay-${index + 1}`,
        provenance: createProvenance({ source: 'replay' }),
      });
      session.evaluation!.passed = false;
      return session;
    });
    const queue = buildTrainerQaQueue(input({ simSessions: [...simulationsWithFailures(), ...replayFailures] }));
    const row = queue.items.find((item) => item.id === 'high_learner_failure:scenario:s-easy');
    expect(row?.metric).toMatchObject({ sampleSize: 5, failures: 2, failureRate: 0.4 });

    const replayOnly = buildTrainerQaQueue(input({ simSessions: replayFailures }));
    expect(replayOnly.items.some((item) => item.category === 'high_learner_failure')).toBe(false);
  });

  it('detects deterministic critical and eligibility conflicts with judge pass claims and scores', () => {
    const conflicted = scenarioSession({ id: 'session-disagreement' });
    conflicted.evaluation!.assessmentEligibility = {
      eligible: false,
      reasons: ['Synthetic deterministic critical failure.'],
      minimumEvidenceMet: true,
      dispositionValid: true,
      deterministicCriticalFailure: true,
    };
    conflicted.evaluation!.gateResults![0].status = 'fail';
    conflicted.evaluation!.passed = true;
    conflicted.evaluation!.overallScorePct = 90;

    const queue = buildTrainerQaQueue(input({ simSessions: [conflicted] }));
    const row = queue.items.find((item) => item.id === 'model_disagreement:simulation_session:session-disagreement');
    expect(row).toBeDefined();
    expect(row?.details.join(' ')).toContain('critical failure');
    expect(row?.details.join(' ')).toContain('ineligibility');
    expect(row?.details.join(' ')).toContain('pass claim');
  });

  it('detects deterministic disposition conflicts without treating ordinary low scores as disagreement', () => {
    const conflicted = scenarioSession({ id: 'session-disposition' });
    conflicted.evaluation!.dispositionValidation = { disposition: 'Recovered', valid: false, reasons: ['Synthetic state mismatch.'] };
    conflicted.evaluation!.dispositionCorrect = true;
    conflicted.evaluation!.passed = false;
    conflicted.evaluation!.overallScorePct = 50;
    const queue = buildTrainerQaQueue(input({ simSessions: [conflicted] }));
    expect(queue.items.find((item) => item.target.id === 'session-disposition')?.details.join(' ')).toContain('correct-disposition claim');

    const ordinary = scenarioSession({ id: 'session-low-score' });
    ordinary.evaluation!.passed = false;
    ordinary.evaluation!.overallScorePct = 50;
    const noDisagreement = buildTrainerQaQueue(input({ simSessions: [ordinary] }));
    expect(noDisagreement.items.some((item) => item.category === 'model_disagreement')).toBe(false);
  });

  it('excludes replay from model-disagreement analysis and fails closed on inconsistent requirements', () => {
    const replay = scenarioSession({ id: 'replay-disagreement', provenance: createProvenance({ source: 'replay' }) });
    replay.evaluation!.assessmentEligibility!.eligible = false;
    replay.evaluation!.passed = true;
    const queue = buildTrainerQaQueue(input({ simSessions: [replay] }));
    expect(queue.items.some((item) => item.category === 'model_disagreement')).toBe(false);

    expect(() => buildTrainerQaQueue(input({
      blueprint: learningBlueprint({ curriculumVersion: 'different-version' }),
    }))).toThrow(TrainerQaDataError);
    expect(() => buildTrainerQaQueue(input({ learningVersion: learningVersion(), blueprint: null }))).toThrow(TrainerQaDataError);
  });
});

describe('trainer bulk QA route', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockRequireAuth.mockResolvedValue({
      ok: true,
      user: {
        uid: 'trainer-1', email: 'trainer@synthetic.internal', displayName: 'Synthetic Trainer', role: 'TRAINER',
        partnerCohortId: 'INTERNAL', divisionIds: ['INBOUND'], active: true,
      },
    });
  });

  it('uses internal-ops authorization before loading any QA data', async () => {
    mockRequireAuth.mockResolvedValue({ ok: false, response: NextResponse.json({ error: 'FORBIDDEN' }, { status: 403 }) });
    const response = await GET(new Request('http://localhost/api/studio/tracks/track-1/qa'), {
      params: Promise.resolve({ trackId: 'track-1' }),
    });
    expect(response.status).toBe(403);
    expect(mockRequireAuth).toHaveBeenCalledWith(expect.any(Request), INTERNAL_OPS_ROLES);
    expect(mockLoadQueue).not.toHaveBeenCalled();
  });

  it('returns a generic non-enumerating miss and a no-store queue response', async () => {
    mockLoadQueue.mockResolvedValueOnce(null);
    const missing = await GET(new Request('http://localhost/api/studio/tracks/not-present/qa'), {
      params: Promise.resolve({ trackId: 'not-present' }),
    });
    expect(missing.status).toBe(404);
    expect(await missing.json()).toEqual({ error: 'NOT_FOUND', message: 'The requested resource is not available.' });

    mockLoadQueue.mockResolvedValueOnce(buildTrainerQaQueue(input({ learningVersion: null, blueprint: null })));
    const found = await GET(new Request('http://localhost/api/studio/tracks/track-1/qa'), {
      params: Promise.resolve({ trackId: 'track-1' }),
    });
    expect(found.status).toBe(200);
    expect(found.headers.get('cache-control')).toBe('no-store');
    expect((await found.json()).trackId).toBe('track-1');
  });
});
