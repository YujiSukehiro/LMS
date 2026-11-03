import { z } from 'zod';
import { ExtractionQualityFlagSchema, SourceDocumentRoleSchema } from '@/lib/schemas/source-truth';
import { STANDARD_MEDS_SOURCE_CODES } from './source-catalog';

const Sha256Schema = z.string().regex(/^sha256:[a-f0-9]{64}$/);

export const StandardMedsSourcePageSchema = z.object({
  pageNumber: z.number().int().positive(),
  contentHash: Sha256Schema,
  characterCount: z.number().int().nonnegative(),
  extractionFlags: z.array(ExtractionQualityFlagSchema),
});

export const StandardMedsSourceRegistrationSchema = z.object({
  code: z.enum(STANDARD_MEDS_SOURCE_CODES),
  documentId: z.string().min(1),
  revisionId: Sha256Schema,
  trackId: z.string().min(1).nullable(),
  role: SourceDocumentRoleSchema,
  fileName: z.string().min(1),
  relativePath: z.string().min(1),
  sourceVersion: z.literal('supplied-pdf-unapproved'),
  contentHash: Sha256Schema,
  pageCount: z.number().int().positive(),
  pages: z.array(StandardMedsSourcePageSchema).min(1),
  approvalStatus: z.literal('draft'),
}).superRefine((source, context) => {
  if (source.pages.length !== source.pageCount) {
    context.addIssue({ code: z.ZodIssueCode.custom, message: 'Page metadata count must equal the PDF page count.' });
  }
  source.pages.forEach((page, index) => {
    if (page.pageNumber !== index + 1) {
      context.addIssue({ code: z.ZodIssueCode.custom, message: 'Page metadata must be contiguous and ordered from page 1.' });
    }
  });
});

export const StandardMedsSourceManifestSchema = z.object({
  schemaVersion: z.literal(1),
  rawTextIncluded: z.literal(false),
  sources: z.array(StandardMedsSourceRegistrationSchema).length(9),
});

export type StandardMedsSourcePage = z.infer<typeof StandardMedsSourcePageSchema>;
export type StandardMedsSourceRegistration = z.infer<typeof StandardMedsSourceRegistrationSchema>;
export type StandardMedsSourceManifest = z.infer<typeof StandardMedsSourceManifestSchema>;
