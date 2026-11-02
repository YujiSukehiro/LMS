/**
 * POST /api/tracks/upload — create a content-hashed source bundle and legacy sourcePages.
 * `mode=append-document` clones the active bundle's evidence and adds one ordered document.
 */
import { NextResponse } from 'next/server';
import type { DocumentData, DocumentReference } from 'firebase-admin/firestore';
import { z } from 'zod';
import { adminDb, getAdminBucket } from '@/lib/firebase/admin';
import { jsonError, requireAuth } from '@/lib/firebase/auth-guard';
import { INTERNAL_OPS_ROLES } from '@/lib/schemas/constants';
import { UploadTrackFieldsSchema, UploadTrackModeSchema, type UploadTrackResponseSchema } from '@/lib/schemas/api';
import { DRAFT_VERSION_ID, TrackDocSchema, type TrackDoc } from '@/lib/schemas/curriculum';
import {
  SourceBundleSchema,
  SourceDocumentRefSchema,
  SourceDocumentRoleSchema,
  SourcePageEvidenceSchema,
  type SourceDocumentRef,
  type SourcePageEvidence,
} from '@/lib/schemas/source-truth';
import { PlaybookPdfError, extractPlaybookPdf, sourcePageExtractionFlags } from '@/lib/ai/pdf-extractor';
import {
  buildSourcePageBatches,
  draftRef,
  isGenerationRunning,
  loadTrack,
  secretsRef,
  sourcePagesCollection,
  trackRef,
  tracksCollection,
} from '@/lib/ai/pipeline/track-store';
import {
  computeSourceBundleRevisionHash,
  hashSourceBytes,
  hashSourcePageContent,
  loadSourceReview,
  SourceBundleNotFoundError,
  sourceAssetsCollection,
  sourceBundlesCollection,
  sourceConflictsCollection,
  sourcePageEvidenceCollection,
  sourcePageEvidenceId,
  sourceRulePacksCollection,
  type SourceReviewData,
} from '@/lib/services/source-store';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const UploadOptionsSchema = z.object({
  mode: UploadTrackModeSchema.default('new-bundle'),
  documentRole: SourceDocumentRoleSchema.default('product'),
  sourceVersion: z.string().min(1).max(120).optional(),
  effectiveDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable().optional(),
  inheritanceOrder: z.number().int().nonnegative().optional(),
  sharedRulePackIds: z.array(z.string().min(1)).max(100).optional(),
});

type WriteOperation =
  | { kind: 'set'; ref: DocumentReference; data: DocumentData }
  | { kind: 'delete'; ref: DocumentReference };

function formString(form: FormData, name: string): string | undefined {
  const value = form.get(name);
  return typeof value === 'string' ? value.trim() : undefined;
}

function safeFileName(name: string): string {
  const base = name.split(/[\\/]/).pop() ?? 'playbook.pdf';
  const cleaned = base.replace(/[^A-Za-z0-9._-]+/g, '-').replace(/-{2,}/g, '-').replace(/^-+|-+$/g, '');
  const withExt = cleaned.toLowerCase().endsWith('.pdf') ? cleaned : `${cleaned || 'playbook'}.pdf`;
  return withExt.slice(-120);
}

function sharedRulePackIds(form: FormData): string[] | undefined | null {
  const raw = formString(form, 'sharedRulePackIds');
  if (!raw) return undefined;
  try {
    const parsed: unknown = JSON.parse(raw);
    const result = z.array(z.string().min(1)).max(100).safeParse(parsed);
    return result.success ? result.data : null;
  } catch {
    return null;
  }
}

/** Keep bundle contents complete before activating it; chunk large multi-document bundles. */
async function commitOperations(operations: WriteOperation[]): Promise<void> {
  for (let start = 0; start < operations.length; start += 400) {
    const batch = adminDb.batch();
    for (const operation of operations.slice(start, start + 400)) {
      if (operation.kind === 'set') batch.set(operation.ref, operation.data);
      else batch.delete(operation.ref);
    }
    await batch.commit();
  }
}

export async function POST(req: Request): Promise<NextResponse> {
  const auth = await requireAuth(req, INTERNAL_OPS_ROLES);
  if (!auth.ok) return auth.response;

  let form: FormData;
  try {
    form = await req.formData();
  } catch {
    return jsonError(400, 'VALIDATION_FAILED', 'Send the Playbook as multipart form data with a "file" field.');
  }

  const file = form.get('file');
  if (!(file instanceof File) || file.size === 0) {
    return jsonError(400, 'VALIDATION_FAILED', 'Select a Playbook PDF to upload.');
  }
  const fields = UploadTrackFieldsSchema.safeParse({
    title: formString(form, 'title'),
    campaignCode: formString(form, 'campaignCode') ?? '',
    divisionId: formString(form, 'divisionId'),
  });
  if (!fields.success) {
    const first = fields.error.issues[0];
    const field = first?.path.join('.') || 'form';
    return jsonError(400, 'VALIDATION_FAILED', `Check the "${field}" field: ${first?.message ?? 'invalid value'}.`);
  }

  const packIds = sharedRulePackIds(form);
  if (packIds === null) return jsonError(400, 'VALIDATION_FAILED', 'sharedRulePackIds must be a JSON array of rule-pack IDs.');
  const orderValue = formString(form, 'inheritanceOrder');
  const options = UploadOptionsSchema.safeParse({
    mode: formString(form, 'mode') || 'new-bundle',
    documentRole: formString(form, 'documentRole') || 'product',
    sourceVersion: formString(form, 'sourceVersion') || undefined,
    effectiveDate: formString(form, 'effectiveDate') || null,
    inheritanceOrder: orderValue ? Number(orderValue) : undefined,
    sharedRulePackIds: packIds,
  });
  if (!options.success) {
    const first = options.error.issues[0];
    return jsonError(400, 'VALIDATION_FAILED', `Check the "${first?.path.join('.') || 'source'}" field: ${first?.message ?? 'invalid value'}.`);
  }

  const existingTrackId = formString(form, 'trackId') || undefined;
  let existing: TrackDoc | null = null;
  let inherited: SourceReviewData | null = null;
  if (existingTrackId) {
    existing = await loadTrack(existingTrackId);
    if (!existing) return jsonError(404, 'NOT_FOUND', 'This Track does not exist.');
    if (isGenerationRunning(existing)) {
      return jsonError(409, 'GENERATION_RUNNING', 'A build is running for this Track. Wait for it to finish, then upload again.');
    }
  }
  if (options.data.mode === 'append-document') {
    if (!existing) return jsonError(400, 'VALIDATION_FAILED', 'Append-document mode requires an existing trackId.');
    if (!existing.activeSourceBundleId) {
      return jsonError(409, 'NO_ACTIVE_SOURCE_BUNDLE', 'Create a source bundle before appending another document.');
    }
    try {
      inherited = await loadSourceReview(existing.id, existing.activeSourceBundleId);
    } catch (error) {
      if (error instanceof SourceBundleNotFoundError) return jsonError(404, 'NOT_FOUND', 'The active source bundle does not exist.');
      throw error;
    }
    const insertionOrder = options.data.inheritanceOrder ?? inherited.bundle.documents.length;
    if (insertionOrder > inherited.bundle.documents.length) {
      return jsonError(400, 'VALIDATION_FAILED', 'inheritanceOrder must fit within the active document sequence.');
    }
  } else if (options.data.inheritanceOrder !== undefined && options.data.inheritanceOrder !== 0) {
    return jsonError(400, 'VALIDATION_FAILED', 'A new bundle must start at inheritanceOrder 0.');
  }

  const bytes = new Uint8Array(await file.arrayBuffer());
  let extracted;
  try {
    extracted = await extractPlaybookPdf(bytes, { fileName: file.name, mimeType: file.type });
  } catch (error) {
    if (error instanceof PlaybookPdfError) return jsonError(400, error.code, error.message);
    throw error;
  }

  const trackId = existingTrackId ?? tracksCollection().doc().id;
  const bundleId = sourceBundlesCollection(trackId).doc().id;
  const documentId = sourceBundlesCollection(trackId).doc().id;
  const now = Date.now();
  const fileName = safeFileName(file.name || 'playbook.pdf');
  const storagePath = `playbooks/${trackId}/${now}-${fileName}`;
  const contentHash = hashSourceBytes(bytes);
  const revisionId = `rev-${contentHash.slice(7)}`;

  const document: SourceDocumentRef = SourceDocumentRefSchema.parse({
    id: documentId,
    revisionId,
    bundleId,
    trackId,
    role: options.data.documentRole,
    fileName: file.name || fileName,
    storagePath,
    sourceVersion: options.data.sourceVersion ?? contentHash,
    effectiveDate: options.data.effectiveDate ?? null,
    uploadedAt: now,
    uploadedByUid: auth.user.uid,
    contentHash,
    pageCount: extracted.pageCount,
    inheritanceOrder: options.data.inheritanceOrder ?? inherited?.bundle?.documents.length ?? 0,
    excluded: false,
    exclusionReason: null,
  });
  const newPages: SourcePageEvidence[] = extracted.pages.map((page) => {
    const rawText = page.rawText ?? page.text;
    return SourcePageEvidenceSchema.parse({
      id: sourcePageEvidenceId(documentId, page.pageNumber),
      documentId,
      revisionId,
      pageNumber: page.pageNumber,
      rawText,
      normalizedText: page.text,
      contentHash: hashSourcePageContent(rawText),
      characterCount: rawText.length,
      extractionFlags: sourcePageExtractionFlags(page),
      transcription: null,
      approvedExcerpts: [],
    });
  });

  const inheritedDocuments = inherited?.bundle?.documents ?? [];
  const insertionOrder = document.inheritanceOrder;
  const documents = [
    ...inheritedDocuments.slice(0, insertionOrder).map((item) => ({ ...item, bundleId })),
    document,
    ...inheritedDocuments.slice(insertionOrder).map((item) => ({ ...item, bundleId })),
  ].map((item, inheritanceOrder) => ({ ...item, inheritanceOrder }));
  const pages = [...(inherited?.pages ?? []), ...newPages];
  const bundle = SourceBundleSchema.parse({
    schemaVersion: 1,
    id: bundleId,
    trackId,
    documents,
    sharedRulePackIds: options.data.sharedRulePackIds ?? inherited?.bundle?.sharedRulePackIds ?? [],
    precedencePolicyId: inherited?.bundle?.precedencePolicyId ?? 'standard-meds-precedence-v1',
    conflictIds: inherited?.bundle?.conflictIds ?? [],
    status: 'draft',
    revisionHash: computeSourceBundleRevisionHash({ documents, sharedRulePackIds: options.data.sharedRulePackIds ?? inherited?.bundle?.sharedRulePackIds ?? [], precedencePolicyId: inherited?.bundle?.precedencePolicyId ?? 'standard-meds-precedence-v1' }, pages),
    approvedSourceRevision: null,
    approvedByUid: null,
    approvedAt: null,
    createdAt: now,
    updatedAt: now,
  });

  const generationProgress = {
    step: 'EXTRACTING_PDF' as const,
    percent: 10,
    message: `Read ${extracted.pageCount} pages from the Playbook. Ready to build the Track.`,
  };
  const track: TrackDoc = TrackDocSchema.parse(
    existing
      ? {
          ...existing,
          title: fields.data.title,
          campaignCode: fields.data.campaignCode,
          divisionId: fields.data.divisionId,
          status: existing.publishedVersionId ? 'PUBLISHED' : 'GENERATING',
          generationProgress,
          sourcePdfStoragePath: storagePath,
          sourcePdfFileName: file.name || fileName,
          sourcePageCount: extracted.pageCount,
          activeSourceBundleId: bundleId,
          currentDraftVersionId: DRAFT_VERSION_ID,
          updatedAt: now,
        }
      : {
          id: trackId,
          title: fields.data.title,
          campaignCode: fields.data.campaignCode,
          divisionId: fields.data.divisionId,
          status: 'GENERATING',
          generationProgress,
          sourcePdfStoragePath: storagePath,
          sourcePdfFileName: file.name || fileName,
          sourcePageCount: extracted.pageCount,
          activeSourceBundleId: bundleId,
          currentDraftVersionId: DRAFT_VERSION_ID,
          publishedVersionId: null,
          assignedCohortIds: [],
          competencyPillars: [],
          unitCount: 0,
          simScenarioCount: 0,
          estimatedTotalMinutes: 0,
          createdByUid: auth.user.uid,
          createdAt: now,
          updatedAt: now,
        },
  );

  const pageBatches = buildSourcePageBatches(trackId, extracted.pages, now);
  const newBatchIds = new Set(pageBatches.map((pageBatch) => pageBatch.id));
  const oldBatches = existing ? await sourcePagesCollection(trackId).listDocuments() : [];
  const operations: WriteOperation[] = [
    { kind: 'set', ref: sourceBundlesCollection(trackId).doc(bundleId), data: bundle },
    ...pages.map((page): WriteOperation => ({ kind: 'set', ref: sourcePageEvidenceCollection(trackId, bundleId).doc(page.id), data: page })),
    ...(inherited?.rulePacks ?? []).map((pack): WriteOperation => ({ kind: 'set', ref: sourceRulePacksCollection(trackId, bundleId).doc(pack.id), data: pack })),
    ...(inherited?.assets ?? []).map((asset): WriteOperation => ({ kind: 'set', ref: sourceAssetsCollection(trackId, bundleId).doc(asset.id), data: asset })),
    ...(inherited?.conflicts ?? []).map((conflict): WriteOperation => ({ kind: 'set', ref: sourceConflictsCollection(trackId, bundleId).doc(conflict.id), data: conflict })),
  ];
  if (existing) {
    for (const ref of oldBatches) if (!newBatchIds.has(ref.id)) operations.push({ kind: 'delete', ref });
    operations.push({ kind: 'delete', ref: secretsRef(trackId, DRAFT_VERSION_ID) });
    operations.push({ kind: 'delete', ref: draftRef(trackId) });
  }
  for (const pageBatch of pageBatches) {
    operations.push({ kind: 'set', ref: sourcePagesCollection(trackId).doc(pageBatch.id), data: pageBatch });
  }
  operations.push({ kind: 'set', ref: trackRef(trackId), data: track });

  try {
    await getAdminBucket().file(storagePath).save(Buffer.from(bytes), {
      resumable: false,
      contentType: 'application/pdf',
      metadata: { metadata: { trackId, bundleId, documentId, contentHash, uploadedByUid: auth.user.uid } },
    });
  } catch {
    return jsonError(502, 'STORAGE_FAILED', 'The Playbook PDF could not be saved. Try the upload again.');
  }
  await commitOperations(operations);

  const body: z.infer<typeof UploadTrackResponseSchema> = {
    trackId,
    pageCount: extracted.pageCount,
    bundleId,
    documentId,
    sourceRevision: bundle.revisionHash,
  };
  return NextResponse.json(body, { status: existing ? 200 : 201 });
}
