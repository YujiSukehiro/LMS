import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  SourceBundleSchema,
  SourcePageEvidenceSchema,
  type SourceDocumentRef,
} from '@/lib/schemas/source-truth';

const store = new Map<string, unknown>();

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

vi.mock('@/lib/firebase/admin', () => ({
  adminDb: { collection: (path: string) => collection(path) },
}));

import {
  computeLegacySourceBundleRevisionHash,
  computeSourceBundleRevisionHash,
  sourceBundleRevisionMatches,
  hashSourceBytes,
  hashSourcePageContent,
  loadSourceReview,
  withSourceRevision,
} from '@/lib/services/source-store';

function sourceDocument(id: string, role: SourceDocumentRef['role'], inheritanceOrder: number): SourceDocumentRef {
  return {
    id,
    revisionId: `rev-${id}`,
    bundleId: 'bundle-1',
    trackId: 'track-1',
    role,
    fileName: `${id}.pdf`,
    storagePath: `synthetic/${id}.pdf`,
    sourceVersion: `version-${id}`,
    effectiveDate: null,
    uploadedAt: 1,
    uploadedByUid: 'trainer-1',
    contentHash: hashSourceBytes(new TextEncoder().encode(`bytes-${id}`)),
    pageCount: 1,
    inheritanceOrder,
    excluded: false,
    exclusionReason: null,
  };
}

function page(documentId: string, pageNumber: number, rawText: string) {
  return SourcePageEvidenceSchema.parse({
    id: `${documentId}-page-${pageNumber}`,
    documentId,
    revisionId: `rev-${documentId}`,
    pageNumber,
    rawText,
    normalizedText: rawText,
    contentHash: hashSourcePageContent(rawText),
    characterCount: rawText.length,
    extractionFlags: [],
    transcription: null,
    approvedExcerpts: [],
  });
}

const documents = [sourceDocument('shared', 'shared_foundation', 0), sourceDocument('product', 'product', 1)];
const pages = [page('product', 1, 'Product-specific synthetic rule.'), page('shared', 1, 'Inherited synthetic compliance rule.')];
const bundle = SourceBundleSchema.parse({
  schemaVersion: 1,
  id: 'bundle-1',
  trackId: 'track-1',
  documents,
  sharedRulePackIds: ['pack-shared'],
  precedencePolicyId: 'standard-meds-precedence-v1',
  conflictIds: [],
  status: 'approved',
  revisionHash: computeSourceBundleRevisionHash({ documents, sharedRulePackIds: ['pack-shared'], precedencePolicyId: 'standard-meds-precedence-v1' }, pages),
  approvedSourceRevision: null,
  approvedByUid: 'trainer-1',
  approvedAt: 1,
  createdAt: 1,
  updatedAt: 1,
});

beforeEach(() => store.clear());

describe('source revision identity', () => {
  it('hashes actual bytes and page content and changes for ordered multi-document inheritance', () => {
    expect(hashSourceBytes(new TextEncoder().encode('same bytes'))).toBe(hashSourceBytes(new TextEncoder().encode('same bytes')));
    expect(hashSourceBytes(new TextEncoder().encode('same bytes'))).not.toBe(hashSourceBytes(new TextEncoder().encode('changed bytes')));
    expect(hashSourcePageContent('raw page')).not.toBe(hashSourcePageContent('raw page changed'));

    const original = bundle.revisionHash;
    const reordered = documents.map((document) => ({ ...document, inheritanceOrder: document.inheritanceOrder === 0 ? 1 : 0 }));
    expect(computeSourceBundleRevisionHash({ ...bundle, documents: reordered }, pages)).not.toBe(original);
    expect(computeSourceBundleRevisionHash({ ...bundle, sharedRulePackIds: [] }, pages)).not.toBe(original);
    expect(computeSourceBundleRevisionHash(bundle, pages)).toBe(original);
  });

  it('advances revision and invalidates bundle approval when approved transcription changes source content', () => {
    const transcribed = pages.map((candidate, index) => index === 0
      ? { ...candidate, transcription: { text: 'Approved synthetic interface transcription.', approvedByUid: 'trainer-1', approvedAt: 2 } }
      : candidate);
    const revised = withSourceRevision({ ...bundle, approvedSourceRevision: bundle.revisionHash }, transcribed, 3);

    expect(revised.revisionHash).not.toBe(bundle.revisionHash);
    expect(revised.status).toBe('draft');
    expect(revised.approvedSourceRevision).toBeNull();
    expect(revised.approvedByUid).toBeNull();
    expect(revised.approvedAt).toBeNull();
    expect(revised.createdAt).toBe(bundle.createdAt);
  });
});

describe('normalized transcription revision', () => {
  const withTranscription = (text: string) => pages.map((candidate, index) => index === 0
    ? { ...candidate, transcription: { text, approvedByUid: 'trainer-1', approvedAt: 2 } }
    : candidate);

  it('hashes normalized transcription text, so whitespace-only edits keep the revision', () => {
    const tidy = computeSourceBundleRevisionHash(bundle, withTranscription('Step 1: Open the CRM.\nStep 2: Search the order.'));
    expect(computeSourceBundleRevisionHash(bundle, withTranscription('  Step 1:   Open the CRM.\n\n\tStep 2: Search the order.  '))).toBe(tidy);
    expect(computeSourceBundleRevisionHash(bundle, withTranscription('Step 1: Open the CRM. Step 2: Search the refund.'))).not.toBe(tidy);
  });

  it('keeps the approved revision on a whitespace-only re-approval and advances it on a wording change', () => {
    const before = withTranscription('Click Save.\nThen click Close.');
    const approved = { ...bundle, revisionHash: computeSourceBundleRevisionHash(bundle, before), status: 'approved' as const, approvedByUid: 'trainer-1', approvedAt: 2 };
    const approvedBundle = { ...approved, approvedSourceRevision: approved.revisionHash };

    const kept = withSourceRevision(approvedBundle, withTranscription('Click Save.   Then click Close.'), 3, before);
    expect(kept.revisionHash).toBe(approvedBundle.revisionHash);
    expect(kept.status).toBe('approved');
    expect(kept.approvedSourceRevision).toBe(approvedBundle.revisionHash);

    const changed = withSourceRevision(approvedBundle, withTranscription('Click Submit. Then click Close.'), 3, before);
    expect(changed.revisionHash).not.toBe(approvedBundle.revisionHash);
    expect(changed.status).toBe('draft');
  });

  it('accepts bundles persisted under the legacy raw-text hash and keeps their revision on whitespace edits', () => {
    const before = withTranscription('Line one.\nLine two.');
    const legacy = { ...bundle, revisionHash: computeLegacySourceBundleRevisionHash(bundle, before), status: 'approved' as const, approvedByUid: 'trainer-1', approvedAt: 2 };
    const legacyBundle = { ...legacy, approvedSourceRevision: legacy.revisionHash };
    expect(legacyBundle.revisionHash).not.toBe(computeSourceBundleRevisionHash(bundle, before));
    expect(sourceBundleRevisionMatches(legacyBundle, before)).toBe(true);
    expect(sourceBundleRevisionMatches(legacyBundle, withTranscription('Line one. Line three.'))).toBe(false);
    expect(withSourceRevision(legacyBundle, withTranscription('Line one. Line two.'), 3, before).revisionHash).toBe(legacyBundle.revisionHash);
  });
});

describe('loadSourceReview', () => {
  it('loads the complete bundle namespace and returns pages in inheritance order', async () => {
    store.set('tracks/track-1/sourceBundles/bundle-1', clone(bundle));
    for (const evidence of pages) {
      store.set(`tracks/track-1/sourceBundles/bundle-1/pageEvidence/${evidence.id}`, clone(evidence));
    }

    const review = await loadSourceReview('track-1', 'bundle-1');
    expect(review.bundle).toEqual(bundle);
    expect(review.pages.map((candidate) => candidate.documentId)).toEqual(['shared', 'product']);
    expect(review.rulePacks).toEqual([]);
    expect(review.assets).toEqual([]);
    expect(review.conflicts).toEqual([]);
  });

  it('fails clearly for a missing required bundle', async () => {
    await expect(loadSourceReview('track-1', 'missing')).rejects.toThrow('Source bundle missing does not exist for track track-1.');
  });
});
