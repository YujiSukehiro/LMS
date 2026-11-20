import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextResponse } from 'next/server';
import { INTERNAL_OPS_ROLES } from '@/lib/schemas/constants';
import type { SourceBundle, SourcePageEvidence } from '@/lib/schemas/source-truth';

const { mockRequireAuth, mockExtract, mockSave } = vi.hoisted(() => ({
  mockRequireAuth: vi.fn(),
  mockExtract: vi.fn(),
  mockSave: vi.fn(),
}));

const store = new Map<string, unknown>();
const writes: Array<{ kind: 'set' | 'delete'; path: string }> = [];
let autoId = 0;

function clone<T>(value: T): T {
  return structuredClone(value);
}

interface FakeDocument {
  path: string;
  id: string;
  collection(child: string): FakeCollection;
  get(): Promise<{ exists: boolean; data(): unknown }>;
}

interface FakeCollection {
  path: string;
  doc(id?: string): FakeDocument;
  get(): Promise<{ docs: Array<{ data(): unknown }> }>;
  listDocuments(): Promise<FakeDocument[]>;
}

function document(path: string): FakeDocument {
  return {
    path,
    id: path.split('/').at(-1)!,
    collection: (child: string) => collection(`${path}/${child}`),
    get: async () => ({ exists: store.has(path), data: () => clone(store.get(path)) }),
  };
}

function directDocuments(path: string): FakeDocument[] {
  return [...store.keys()]
    .filter((candidate) => candidate.startsWith(`${path}/`) && !candidate.slice(path.length + 1).includes('/'))
    .map(document);
}

function collection(path: string): FakeCollection {
  return {
    path,
    doc: (id?: string) => document(`${path}/${id ?? `generated-${++autoId}`}`),
    get: async () => ({ docs: directDocuments(path).map((ref) => ({ data: () => clone(store.get(ref.path)) })) }),
    listDocuments: async () => directDocuments(path),
  };
}

vi.mock('@/lib/firebase/auth-guard', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/firebase/auth-guard')>();
  return { ...actual, requireAuth: mockRequireAuth };
});

vi.mock('@/lib/firebase/admin', () => ({
  adminDb: {
    collection: (path: string) => collection(path),
    batch: () => {
      const pending: Array<{ kind: 'set' | 'delete'; ref: { path: string }; data?: unknown }> = [];
      return {
        set: (ref: { path: string }, data: unknown) => pending.push({ kind: 'set', ref, data: clone(data) }),
        delete: (ref: { path: string }) => pending.push({ kind: 'delete', ref }),
        commit: async () => {
          for (const operation of pending) {
            if (operation.kind === 'set') store.set(operation.ref.path, clone(operation.data));
            else store.delete(operation.ref.path);
            writes.push({ kind: operation.kind, path: operation.ref.path });
          }
        },
      };
    },
  },
  getAdminBucket: () => ({ file: (path: string) => ({ save: async (...args: unknown[]) => mockSave(path, ...args) }) }),
}));

vi.mock('@/lib/ai/pdf-extractor', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/ai/pdf-extractor')>();
  return { ...actual, extractPlaybookPdf: mockExtract };
});

import { POST } from '@/app/api/tracks/upload/route';
import { hashSourceBytes, hashSourcePageContent } from '@/lib/services/source-store';

function extraction(label: string) {
  const dense = `${label}: Follow the synthetic compliance rule, preserve the exact source wording, and escalate any missing operational detail to the trainer. This sentence keeps the page dense enough for ordinary extraction review.`;
  return {
    pageCount: 2,
    totalChars: dense.length + 24,
    pages: [
      { pageNumber: 1, text: dense, rawText: dense },
      { pageNumber: 2, text: `Screenshot: ${label} interface`, rawText: `Screenshot: ${label} interface` },
    ],
  };
}

interface UploadOptions {
  trackId?: string;
  mode?: string;
  documentRole?: string;
  sharedRulePackIds?: string;
  inheritanceOrder?: string;
  bytes?: string;
  fileName?: string;
}

function upload(options: UploadOptions = {}): Request {
  const form = new FormData();
  form.set('title', 'Synthetic Source Track');
  form.set('campaignCode', 'SYNTH');
  form.set('divisionId', 'INBOUND');
  form.set('file', new File([options.bytes ?? `actual ${options.fileName ?? 'playbook.pdf'} bytes`], options.fileName ?? 'playbook.pdf', { type: 'application/pdf' }));
  if (options.trackId) form.set('trackId', options.trackId);
  if (options.mode) form.set('mode', options.mode);
  if (options.documentRole) form.set('documentRole', options.documentRole);
  if (options.sharedRulePackIds !== undefined) form.set('sharedRulePackIds', options.sharedRulePackIds);
  if (options.inheritanceOrder) form.set('inheritanceOrder', options.inheritanceOrder);
  return new Request('http://localhost/api/tracks/upload', { method: 'POST', body: form });
}

function bundleAt(trackId: string, bundleId: string): SourceBundle {
  return clone(store.get(`tracks/${trackId}/sourceBundles/${bundleId}`)) as SourceBundle;
}

function pagesAt(trackId: string, bundleId: string): SourcePageEvidence[] {
  return directDocuments(`tracks/${trackId}/sourceBundles/${bundleId}/pageEvidence`)
    .map((ref) => clone(store.get(ref.path)) as SourcePageEvidence)
    .sort((left, right) => left.documentId.localeCompare(right.documentId) || left.pageNumber - right.pageNumber);
}

beforeEach(() => {
  store.clear();
  writes.length = 0;
  autoId = 0;
  vi.clearAllMocks();
  mockSave.mockResolvedValue(undefined);
  mockExtract.mockImplementation(async (_bytes: Uint8Array, options: { fileName?: string }) => extraction(options.fileName ?? 'synthetic'));
  mockRequireAuth.mockResolvedValue({
    ok: true,
    user: {
      uid: 'trainer-1',
      email: 'trainer@synthetic.internal',
      displayName: 'Synthetic Trainer',
      role: 'TRAINER',
      partnerCohortId: 'INTERNAL',
      divisionIds: ['INBOUND'],
      active: true,
    },
  });
});

describe('source bundle upload', () => {
  it('persists hashed page evidence and legacy pages, then appends inheritance without mutating published versions', async () => {
    const firstResponse = await POST(upload({ documentRole: 'shared_foundation', sharedRulePackIds: '["pack-shared"]', fileName: 'foundation.pdf', bytes: 'foundation actual bytes' }));
    expect(firstResponse.status).toBe(201);
    const first = await firstResponse.json();
    const original = bundleAt(first.trackId, first.bundleId);
    const originalPages = pagesAt(first.trackId, first.bundleId);

    expect(original.documents).toHaveLength(1);
    expect(original.documents[0]).toMatchObject({
      role: 'shared_foundation',
      inheritanceOrder: 0,
      contentHash: hashSourceBytes(new TextEncoder().encode('foundation actual bytes')),
    });
    expect(original.sharedRulePackIds).toEqual(['pack-shared']);
    expect(original.revisionHash).toBe(first.sourceRevision);
    expect(originalPages).toHaveLength(2);
    expect(originalPages[0].contentHash).toBe(hashSourcePageContent(originalPages[0].rawText));
    expect(originalPages[1].extractionFlags).toEqual(expect.arrayContaining(['low_text_density', 'manual_transcription_required']));
    expect(store.get(`tracks/${first.trackId}/sourcePages/batch-001`)).toBeTruthy();

    const published = { versionId: 'v1', immutable: 'published curriculum must not change' };
    store.set(`tracks/${first.trackId}/versions/v1`, published);
    const track = clone(store.get(`tracks/${first.trackId}`)) as Record<string, unknown>;
    store.set(`tracks/${first.trackId}`, { ...track, status: 'PUBLISHED', publishedVersionId: 'v1' });
    const originalBeforeAppend = clone(original);

    const appendResponse = await POST(upload({
      trackId: first.trackId,
      mode: 'append-document',
      documentRole: 'product',
      inheritanceOrder: '1',
      fileName: 'product.pdf',
      bytes: 'product actual bytes',
    }));
    expect(appendResponse.status).toBe(200);
    const appended = await appendResponse.json();
    const appendedBundle = bundleAt(first.trackId, appended.bundleId);

    expect(appended.bundleId).not.toBe(first.bundleId);
    expect(appended.sourceRevision).not.toBe(first.sourceRevision);
    expect(appendedBundle.documents.map((document) => [document.role, document.inheritanceOrder])).toEqual([
      ['shared_foundation', 0],
      ['product', 1],
    ]);
    expect(appendedBundle.sharedRulePackIds).toEqual(['pack-shared']);
    expect(pagesAt(first.trackId, appended.bundleId)).toHaveLength(4);
    expect(bundleAt(first.trackId, first.bundleId)).toEqual(originalBeforeAppend);
    expect(store.get(`tracks/${first.trackId}/versions/v1`)).toEqual(published);
    expect((store.get(`tracks/${first.trackId}`) as { activeSourceBundleId: string }).activeSourceBundleId).toBe(appended.bundleId);
    // Legacy pages keep every bundle document, numbered with the pipeline's global PAGE labels 1..N.
    const legacyBatch = store.get(`tracks/${first.trackId}/sourcePages/batch-001`) as { pages: Array<{ pageNumber: number; text: string }> };
    expect(legacyBatch.pages.map((page) => page.pageNumber)).toEqual([1, 2, 3, 4]);
    expect(legacyBatch.pages[0].text).toContain('foundation.pdf');
    expect(legacyBatch.pages[2].text).toContain('product.pdf');

    const appendedBeforeReplacement = clone(appendedBundle);
    const replacementResponse = await POST(upload({ trackId: first.trackId, documentRole: 'reference', fileName: 'replacement.pdf' }));
    const replacement = await replacementResponse.json();
    expect(bundleAt(first.trackId, replacement.bundleId).documents).toHaveLength(1);
    expect(bundleAt(first.trackId, appended.bundleId)).toEqual(appendedBeforeReplacement);
    expect(bundleAt(first.trackId, first.bundleId)).toEqual(originalBeforeAppend);
    expect(store.get(`tracks/${first.trackId}/versions/v1`)).toEqual(published);
  });

  it('carries the unresolved SME register into a revised source bundle', async () => {
    const firstResponse = await POST(upload({ fileName: 'foundation.pdf' }));
    expect(firstResponse.status).toBe(201);
    const first = await firstResponse.json();
    const originalPath = `tracks/${first.trackId}/sourceBundles/${first.bundleId}`;
    const original = bundleAt(first.trackId, first.bundleId);
    store.set(originalPath, { ...original, status: 'needs_sme', unresolvedSmeDecisionIds: ['SME-01', 'SME-10'] });

    const revisedResponse = await POST(upload({ trackId: first.trackId, fileName: 'revised.pdf' }));
    expect(revisedResponse.status).toBe(200);
    const revised = await revisedResponse.json();
    const revisedBundle = bundleAt(first.trackId, revised.bundleId);

    expect(revised.bundleId).not.toBe(first.bundleId);
    expect(revisedBundle.status).toBe('draft');
    expect(revisedBundle.unresolvedSmeDecisionIds).toEqual(['SME-01', 'SME-10']);
    expect((store.get(originalPath) as SourceBundle).unresolvedSmeDecisionIds).toEqual(['SME-01', 'SME-10']);
  });

  it('rejects invalid append order and malformed inheritance with zero Firestore or storage writes', async () => {
    const validResponse = await POST(upload({ fileName: 'foundation.pdf' }));
    const { trackId } = await validResponse.json();
    writes.length = 0;
    mockSave.mockClear();
    mockExtract.mockClear();

    const invalidOrder = await POST(upload({ trackId, mode: 'append-document', inheritanceOrder: '99' }));
    expect(invalidOrder.status).toBe(400);
    const invalidPacks = await POST(upload({ sharedRulePackIds: 'not-json' }));
    expect(invalidPacks.status).toBe(400);

    expect(writes).toEqual([]);
    expect(mockSave).not.toHaveBeenCalled();
    expect(mockExtract).not.toHaveBeenCalled();
  });

  it('retains internal-ops authorization and writes nothing when access is denied', async () => {
    mockRequireAuth.mockResolvedValue({ ok: false, response: NextResponse.json({ error: 'FORBIDDEN' }, { status: 403 }) });
    const response = await POST(upload());
    expect(response.status).toBe(403);
    expect(mockRequireAuth).toHaveBeenCalledWith(expect.any(Request), INTERNAL_OPS_ROLES);
    expect(writes).toEqual([]);
    expect(mockSave).not.toHaveBeenCalled();
    expect(mockExtract).not.toHaveBeenCalled();
  });

  it('clears the old Checkpoint target and keeps the previous draft until the new build commits', async () => {
    const firstResponse = await POST(upload({ fileName: 'foundation.pdf' }));
    const { trackId } = await firstResponse.json();
    const trackPath = `tracks/${trackId}`;
    const draft = { versionId: 'draft', units: ['previous usable draft'] };
    store.set(`${trackPath}/versions/draft`, draft);
    store.set(trackPath, {
      ...(store.get(trackPath) as Record<string, unknown>),
      unitTarget: 7,
      generationProgress: { step: 'READY', percent: 100, message: 'Track Ready!' },
      status: 'DRAFT',
    });

    const revisedResponse = await POST(upload({ trackId, fileName: 'revised.pdf' }));
    expect(revisedResponse.status).toBe(200);
    const track = store.get(trackPath) as { unitTarget: number | null; generationProgress: { step: string } };
    expect(track.unitTarget).toBeNull();
    expect(track.generationProgress.step).toBe('EXTRACTING_PDF');
    expect(store.get(`${trackPath}/versions/draft`)).toEqual(draft);
    expect(writes.some((write) => write.kind === 'delete' && write.path.includes('/versions/draft'))).toBe(false);
  });

  it('copies only the selected shared rule packs into an appended bundle', async () => {
    const firstResponse = await POST(upload({ sharedRulePackIds: '["pack-a","pack-b"]', fileName: 'foundation.pdf' }));
    const first = await firstResponse.json();
    const packsPath = `tracks/${first.trackId}/sourceBundles/${first.bundleId}/rulePacks`;
    store.set(`${packsPath}/pack-a`, rulePack('pack-a', first.bundleId));
    store.set(`${packsPath}/pack-b`, rulePack('pack-b', first.bundleId));

    const appendResponse = await POST(upload({
      trackId: first.trackId,
      mode: 'append-document',
      sharedRulePackIds: '["pack-b"]',
      fileName: 'product.pdf',
      bytes: 'product actual bytes',
    }));
    expect(appendResponse.status).toBe(200);
    const appended = await appendResponse.json();
    expect(bundleAt(first.trackId, appended.bundleId).sharedRulePackIds).toEqual(['pack-b']);
    expect(directDocuments(`tracks/${first.trackId}/sourceBundles/${appended.bundleId}/rulePacks`).map((ref) => ref.id)).toEqual(['pack-b']);
  });
});

function rulePack(id: string, documentId: string) {
  const text = 'Agents must self-identify on every call.';
  return {
    id,
    revision: 'rules-rev1',
    title: `Pack ${id}`,
    sourceDocumentIds: [documentId],
    approvalStatus: 'approved',
    createdAt: 1,
    updatedAt: 1,
    rules: [
      {
        id: `${id}-rule`,
        packId: id,
        title: 'Identify',
        statement: text,
        severity: 'critical',
        applicableTrackIds: [],
        channels: ['voice'],
        stages: ['opening'],
        requiredKnowledge: true,
        requiredScenarioCoverage: true,
        sourceRevision: 'rev1',
        approvalStatus: 'approved',
        approvedByUid: 'trainer-1',
        approvedAt: 1,
        evidence: {
          id: `${id}-evidence`,
          claim: text,
          ruleIds: [`${id}-rule`],
          excerpts: [{ documentId, revisionId: 'rev1', pageNumber: 1, exactText: text, fromApprovedTranscription: false }],
        },
      },
    ],
  };
}
