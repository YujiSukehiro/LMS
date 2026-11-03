import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { extractPlaybookPdf, sourcePageExtractionFlags } from '@/lib/ai/pdf-extractor';
import { DEFAULT_STANDARD_MEDS_PDF_DIRECTORY, STANDARD_MEDS_SOURCE_CATALOG } from './source-catalog';
import { StandardMedsSourceManifestSchema, type StandardMedsSourceManifest, type StandardMedsSourceRegistration } from './source-manifest-schema';

function sha256(value: Uint8Array | string): string {
  return `sha256:${createHash('sha256').update(value).digest('hex')}`;
}

export interface RegisterStandardMedsSourcesOptions {
  /** Repository root used to resolve the supplied PDF directory. */
  workspaceRoot: string;
  /** Override only for another local copy of the same nine-file inventory. */
  pdfDirectory?: string;
}

/**
 * Register actual local PDF bytes and extraction metadata. Raw text deliberately remains in the
 * existing source-upload flow; this deterministic manifest contains hashes and quality metadata only.
 */
export async function registerStandardMedsSources(options: RegisterStandardMedsSourcesOptions): Promise<StandardMedsSourceManifest> {
  const pdfDirectory = path.resolve(options.workspaceRoot, options.pdfDirectory ?? DEFAULT_STANDARD_MEDS_PDF_DIRECTORY);
  const sources: StandardMedsSourceRegistration[] = [];

  for (const definition of STANDARD_MEDS_SOURCE_CATALOG) {
    const relativePath = path.posix.join(DEFAULT_STANDARD_MEDS_PDF_DIRECTORY, definition.fileName);
    const bytes = await readFile(path.join(pdfDirectory, definition.fileName));
    const extracted = await extractPlaybookPdf(new Uint8Array(bytes), { fileName: definition.fileName, mimeType: 'application/pdf' });
    if (extracted.pageCount !== definition.expectedPageCount || extracted.pages.length !== definition.expectedPageCount) {
      throw new Error(`${definition.code} page count changed: expected ${definition.expectedPageCount}, extracted ${extracted.pageCount}.`);
    }

    const contentHash = sha256(bytes);
    sources.push({
      code: definition.code,
      documentId: `standard-meds-${definition.code.toLowerCase()}`,
      revisionId: contentHash,
      trackId: definition.trackId,
      role: definition.role,
      fileName: definition.fileName,
      relativePath,
      sourceVersion: 'supplied-pdf-unapproved',
      contentHash,
      pageCount: extracted.pageCount,
      pages: extracted.pages.map((page) => {
        const rawText = page.rawText ?? page.text;
        return {
          pageNumber: page.pageNumber,
          contentHash: sha256(rawText),
          characterCount: rawText.length,
          extractionFlags: sourcePageExtractionFlags(page),
        };
      }),
      approvalStatus: 'draft',
    });
  }

  return StandardMedsSourceManifestSchema.parse({ schemaVersion: 1, rawTextIncluded: false, sources });
}
