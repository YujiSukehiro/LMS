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
import { normalizeSourceText } from '@/lib/services/source-evidence';

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

type RevisionIdentity = Pick<SourceBundle, 'documents' | 'sharedRulePackIds' | 'precedencePolicyId'>;

function revisionHash(bundle: RevisionIdentity, pages: SourcePageEvidence[], transcriptionText: (text: string) => string): string {
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
      transcription: page.transcription ? transcriptionText(page.transcription.text) : null,
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

/**
 * Revision identity covers source bytes, ordered inheritance, and page/transcription content.
 * Review status and approver metadata deliberately do not change the source revision.
 * Transcription text is hashed after `normalizeSourceText` (the same Unicode/whitespace normalization
 * excerpt verification uses), so a whitespace-only re-approval keeps the revision and the draft bound to it.
 */
export function computeSourceBundleRevisionHash(bundle: RevisionIdentity, pages: SourcePageEvidence[] = []): string {
  return revisionHash(bundle, pages, normalizeSourceText);
}

/** The pre-normalization hash (raw transcription text). Only used to accept bundles persisted before the change. */
export function computeLegacySourceBundleRevisionHash(bundle: RevisionIdentity, pages: SourcePageEvidence[] = []): string {
  return revisionHash(bundle, pages, (text) => text);
}

/** True when the persisted revision hash matches the persisted content under the current or the legacy hash. */
export function sourceBundleRevisionMatches(bundle: SourceBundle, pages: SourcePageEvidence[]): boolean {
  return (
    computeSourceBundleRevisionHash(bundle, pages) === bundle.revisionHash ||
    computeLegacySourceBundleRevisionHash(bundle, pages) === bundle.revisionHash
  );
}

/** Advance a draft revision after source content changes and invalidate only the bundle approval. */
export function withSourceRevision(
  bundle: SourceBundle,
  pages: SourcePageEvidence[],
  now: number,
  /** Pages before the change. When their normalized content equals `pages`, the revision is kept (covers legacy hashes). */
  previousPages?: SourcePageEvidence[],
): SourceBundle {
  const equivalent =
    previousPages !== undefined &&
    sourceBundleRevisionMatches(bundle, previousPages) &&
    computeSourceBundleRevisionHash(bundle, previousPages) === computeSourceBundleRevisionHash(bundle, pages);
  const revisionHash = equivalent ? bundle.revisionHash : computeSourceBundleRevisionHash(bundle, pages);
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
