import type { z } from 'zod';
import { SourceDocumentRoleSchema } from '@/lib/schemas/source-truth';

type SourceDocumentRole = z.infer<typeof SourceDocumentRoleSchema>;

export const STANDARD_MEDS_SOURCE_CODES = ['SM-00', 'SM-01', 'SM-02', 'SM-03', 'SM-04', 'SM-05', 'SM-06', 'SM-07', 'SM-08'] as const;
export type StandardMedsSourceCode = (typeof STANDARD_MEDS_SOURCE_CODES)[number];

export interface StandardMedsSourceDefinition {
  code: StandardMedsSourceCode;
  fileName: string;
  expectedPageCount: number;
  role: SourceDocumentRole;
  trackId: string | null;
}

/** The supplied local source inventory from document 06; no remote source fallback is permitted. */
export const STANDARD_MEDS_SOURCE_CATALOG: readonly StandardMedsSourceDefinition[] = [
  { code: 'SM-00', fileName: 'Standard Meds - 00 Training Hub Overview.pdf', expectedPageCount: 2, role: 'reference', trackId: null },
  { code: 'SM-01', fileName: 'Standard Meds - 01 Neuropathy - NeuroCalmRx.pdf', expectedPageCount: 16, role: 'shared_foundation', trackId: 'standard-meds-sm-01' },
  { code: 'SM-02', fileName: 'Standard Meds - 02 Anti-Aging Skin - LiftRx.pdf', expectedPageCount: 13, role: 'product', trackId: 'standard-meds-sm-02' },
  { code: 'SM-03', fileName: 'Standard Meds - 03 Erectile Dysfunction - QuattroRx TriShot.pdf', expectedPageCount: 9, role: 'product', trackId: 'standard-meds-sm-03' },
  { code: 'SM-04', fileName: 'Standard Meds - 04 Nail Fungus - ZoliraRx.pdf', expectedPageCount: 10, role: 'product', trackId: 'standard-meds-sm-04' },
  { code: 'SM-05', fileName: 'Standard Meds - 05 Longevity - NAD+ Therapy.pdf', expectedPageCount: 12, role: 'product', trackId: 'standard-meds-sm-05' },
  { code: 'SM-06', fileName: 'Standard Meds - 06 Customer Support - All Products.pdf', expectedPageCount: 19, role: 'support', trackId: 'standard-meds-sm-06' },
  { code: 'SM-07', fileName: 'Standard Meds - 07 Medical Chat - Pending Information.pdf', expectedPageCount: 22, role: 'medical_chat', trackId: 'standard-meds-sm-07' },
  { code: 'SM-08', fileName: 'Standard Meds - 08 Renewals - Failed Payment.pdf', expectedPageCount: 17, role: 'renewals', trackId: 'standard-meds-sm-08' },
] as const;

export const DEFAULT_STANDARD_MEDS_PDF_DIRECTORY = 'demo-recordings/Standard Meds training PDFs';
