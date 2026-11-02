/**
 * POST /api/tracks/upload — multipart Playbook PDF upload. Extracts pages, stores the PDF and the
 * source pages, and creates (or resets for re-certification) the Track header with status GENERATING.
 */
import { NextResponse } from 'next/server';
import { adminDb, getAdminBucket } from '@/lib/firebase/admin';
import { jsonError, requireAuth } from '@/lib/firebase/auth-guard';
import { INTERNAL_OPS_ROLES } from '@/lib/schemas/constants';
import { UploadTrackFieldsSchema, type UploadTrackResponseSchema } from '@/lib/schemas/api';
import { DRAFT_VERSION_ID, TrackDocSchema, type TrackDoc } from '@/lib/schemas/curriculum';
import { PlaybookPdfError, extractPlaybookPdf } from '@/lib/ai/pdf-extractor';
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
import type { z } from 'zod';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

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
  const existingTrackId = formString(form, 'trackId') || undefined;

  let existing: TrackDoc | null = null;
  if (existingTrackId) {
    existing = await loadTrack(existingTrackId);
    if (!existing) return jsonError(404, 'NOT_FOUND', 'This Track does not exist.');
    if (isGenerationRunning(existing)) {
      return jsonError(409, 'GENERATION_RUNNING', 'A build is running for this Track. Wait for it to finish, then upload again.');
    }
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
  const now = Date.now();
  const fileName = safeFileName(file.name || 'playbook.pdf');
  const storagePath = `playbooks/${trackId}/${now}-${fileName}`;

  try {
    await getAdminBucket()
      .file(storagePath)
      .save(Buffer.from(bytes), {
        resumable: false,
        contentType: 'application/pdf',
        metadata: { metadata: { trackId, uploadedByUid: auth.user.uid } },
      });
  } catch {
    return jsonError(502, 'STORAGE_FAILED', 'The Playbook PDF could not be saved. Try the upload again.');
  }

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
          // Learners keep training on the published TrackVersion while the new draft is built.
          status: existing.publishedVersionId ? 'PUBLISHED' : 'GENERATING',
          generationProgress,
          sourcePdfStoragePath: storagePath,
          sourcePdfFileName: file.name || fileName,
          sourcePageCount: extracted.pageCount,
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
  const batch = adminDb.batch();
  if (existing) {
    // A revised Playbook replaces the old source pages and the old draft (the published TrackVersion stays).
    const oldBatches = await sourcePagesCollection(trackId).listDocuments();
    for (const ref of oldBatches) if (!newBatchIds.has(ref.id)) batch.delete(ref);
    batch.delete(secretsRef(trackId, DRAFT_VERSION_ID));
    batch.delete(draftRef(trackId));
  }
  for (const pageBatch of pageBatches) {
    batch.set(sourcePagesCollection(trackId).doc(pageBatch.id), pageBatch);
  }
  batch.set(trackRef(trackId), track);
  await batch.commit();

  const body: z.infer<typeof UploadTrackResponseSchema> = { trackId, pageCount: extracted.pageCount };
  return NextResponse.json(body, { status: existing ? 200 : 201 });
}
