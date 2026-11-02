import { createHash } from 'node:crypto';
import type { CollectionReference, DocumentReference, Transaction } from 'firebase-admin/firestore';
import { adminDb } from '@/lib/firebase/admin';
import {
  OperationalAssetSchema,
  SharedRulePackSchema,
  SourceBundleSchema,
  SourceConflictSchema,
  SourcePageEvidenceSchema,
  type OperationalAsset,
  type SharedRulePack,
  type SourceBundle,
  type SourceConflict,
  type SourcePageEvidence,
} from '@/lib/schemas/source-truth';

export interface SourceReviewData {
  bundle: SourceBundle;
  pages: SourcePageEvidence[];
  rulePacks: SharedRulePack[];
  assets: OperationalAsset[];
  conflicts: SourceConflict[];
}

export class SourceBundleNotFoundError extends Error {
  constructor(readonly trackId: string, readonly bundleId: string) {
    super(`Source bundle ${bundleId} does not exist for track ${trackId}.`);
    this.name = 'SourceBundleNotFoundError';
  }
}

export function sourceBundlesCollection(trackId: string): CollectionReference {
  return adminDb.collection('tracks').doc(trackId).collection('sourceBundles');
}

export function sourceBundleRef(trackId: string, bundleId: string): DocumentReference {
  return sourceBundlesCollection(trackId).doc(bundleId);
}

export function sourcePageEvidenceCollection(trackId: string, bundleId: string): CollectionReference {
  return sourceBundleRef(trackId, bundleId).collection('pageEvidence');
}

export function sourcePageEvidenceRef(trackId: string, bundleId: string, pageId: string): DocumentReference {
  return sourcePageEvidenceCollection(trackId, bundleId).doc(pageId);
}

export function sourceRulePacksCollection(trackId: string, bundleId: string): CollectionReference {
  return sourceBundleRef(trackId, bundleId).collection('rulePacks');
}

export function sourceRulePackRef(trackId: string, bundleId: string, packId: string): DocumentReference {
  return sourceRulePacksCollection(trackId, bundleId).doc(packId);
}

export function sourceAssetsCollection(trackId: string, bundleId: string): CollectionReference {
  return sourceBundleRef(trackId, bundleId).collection('assets');
}

export function sourceAssetRef(trackId: string, bundleId: string, assetId: string): DocumentReference {
  return sourceAssetsCollection(trackId, bundleId).doc(assetId);
}

export function sourceConflictsCollection(trackId: string, bundleId: string): CollectionReference {
  return sourceBundleRef(trackId, bundleId).collection('conflicts');
}

export function sourceConflictRef(trackId: string, bundleId: string, conflictId: string): DocumentReference {
  return sourceConflictsCollection(trackId, bundleId).doc(conflictId);
}

export function sourcePageEvidenceId(documentId: string, pageNumber: number): string {
  return `${encodeURIComponent(documentId)}-page-${pageNumber}`;
}

function sha256(value: string | Uint8Array): string {
  return `sha256:${createHash('sha256').update(value).digest('hex')}`;
}

/** Hash the uploaded bytes, not a file name, normalized representation, or client-provided checksum. */
export function hashSourceBytes(bytes: Uint8Array): string {
  return sha256(bytes);
}

/** Hash exact extracted page content so extraction changes remain auditable. */
export function hashSourcePageContent(rawText: string): string {
  return sha256(rawText);
}

function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  if (value && typeof value === 'object') {
    const record = value as Record<string, unknown>;
    return `{${Object.keys(record)
      .filter((key) => record[key] !== undefined)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${canonicalJson(record[key])}`)
      .join(',')}}`;
  }
  return JSON.stringify(value);
}

/**
 * Revision identity covers source bytes, ordered inheritance, and page/transcription content.
 * Review status and approver metadata deliberately do not change the source revision.
 */
export function computeSourceBundleRevisionHash(
  bundle: Pick<SourceBundle, 'documents' | 'sharedRulePackIds' | 'precedencePolicyId'>,
  pages: SourcePageEvidence[] = [],
): string {
  const documents = bundle.documents.map((document) => ({
    id: document.id,
    revisionId: document.revisionId,
    role: document.role,
    sourceVersion: document.sourceVersion,
    effectiveDate: document.effectiveDate,
    contentHash: document.contentHash,
    pageCount: document.pageCount,
    inheritanceOrder: document.inheritanceOrder,
    excluded: document.excluded,
    exclusionReason: document.exclusionReason,
  }));
  const evidence = pages
    .map((page) => ({
      documentId: page.documentId,
      revisionId: page.revisionId,
      pageNumber: page.pageNumber,
      contentHash: page.contentHash,
      transcription: page.transcription?.text ?? null,
    }))
    .sort((left, right) =>
      left.documentId.localeCompare(right.documentId) ||
      left.revisionId.localeCompare(right.revisionId) ||
      left.pageNumber - right.pageNumber,
    );
  return sha256(canonicalJson({
    documents,
    sharedRulePackIds: bundle.sharedRulePackIds,
    precedencePolicyId: bundle.precedencePolicyId,
    evidence,
  }));
}

/** Advance a draft revision after source content changes and invalidate only the bundle approval. */
export function withSourceRevision(bundle: SourceBundle, pages: SourcePageEvidence[], now: number): SourceBundle {
  const revisionHash = computeSourceBundleRevisionHash(bundle, pages);
  const changed = revisionHash !== bundle.revisionHash;
  return SourceBundleSchema.parse({
    ...bundle,
    revisionHash,
    status: changed ? 'draft' : bundle.status,
    approvedSourceRevision: changed ? null : bundle.approvedSourceRevision,
    approvedByUid: changed ? null : bundle.approvedByUid,
    approvedAt: changed ? null : bundle.approvedAt,
    updatedAt: now,
  });
}

interface SchemaParser<T> {
  parse(value: unknown): T;
}

async function readDocument<T>(ref: DocumentReference, schema: SchemaParser<T>, tx?: Transaction): Promise<T | null> {
  const snapshot = tx ? await tx.get(ref) : await ref.get();
  return snapshot.exists ? schema.parse(snapshot.data()) : null;
}

async function readCollection<T>(ref: CollectionReference, schema: SchemaParser<T>, tx?: Transaction): Promise<T[]> {
  const snapshot = tx ? await tx.get(ref) : await ref.get();
  return snapshot.docs.map((document) => schema.parse(document.data()));
}

/** Load and schema-parse the complete trainer review surface for one exact bundle revision. */
export async function loadSourceReview(trackId: string, bundleId: string, tx?: Transaction): Promise<SourceReviewData> {
  const bundle = await readDocument(sourceBundleRef(trackId, bundleId), SourceBundleSchema, tx);
  if (!bundle) throw new SourceBundleNotFoundError(trackId, bundleId);

  const [pages, rulePacks, assets, conflicts] = await Promise.all([
    readCollection(sourcePageEvidenceCollection(trackId, bundleId), SourcePageEvidenceSchema, tx),
    readCollection(sourceRulePacksCollection(trackId, bundleId), SharedRulePackSchema, tx),
    readCollection(sourceAssetsCollection(trackId, bundleId), OperationalAssetSchema, tx),
    readCollection(sourceConflictsCollection(trackId, bundleId), SourceConflictSchema, tx),
  ]);
  const order = new Map(bundle.documents.map((document) => [document.id, document.inheritanceOrder] as const));
  pages.sort((left, right) =>
    (order.get(left.documentId) ?? Number.MAX_SAFE_INTEGER) - (order.get(right.documentId) ?? Number.MAX_SAFE_INTEGER) ||
    left.documentId.localeCompare(right.documentId) ||
    left.pageNumber - right.pageNumber,
  );
  rulePacks.sort((left, right) => left.id.localeCompare(right.id));
  assets.sort((left, right) => left.id.localeCompare(right.id));
  conflicts.sort((left, right) => left.id.localeCompare(right.id));
  return { bundle, pages, rulePacks, assets, conflicts };
}
