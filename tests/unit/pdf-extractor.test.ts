import { describe, expect, it } from 'vitest';
import {
  PlaybookPdfError,
  extractPlaybookPdf,
  formatSourcePages,
  normalizePageText,
  selectPages,
} from '@/lib/ai/pdf-extractor';
import { makePdf } from './helpers/make-pdf';

const PAGE_ONE = [
  'MVP Retention Playbook - Refund Policy',
  'Step 1: Verify the full name, zip code, and order number.',
  'Step 2: Offer 25% first, then 50%, then 70% on price complaints.',
  'A medical complaint skips the ladder and receives an immediate 70% refund.',
];
const PAGE_TWO = [
  'Escalation Rules',
  'Chargeback threats go to a supervisor within the same call.',
  'Never read full card numbers aloud. Log the disposition before you end the call.',
];

async function expectPdfError(promise: Promise<unknown>, code: string) {
  await expect(promise).rejects.toBeInstanceOf(PlaybookPdfError);
  await promise.catch((err: unknown) => {
    expect((err as PlaybookPdfError).code).toBe(code);
  });
}

describe('pdf-extractor', () => {
  it('extracts per-page text and formats SOURCE PAGE boundaries', async () => {
    const result = await extractPlaybookPdf(makePdf([PAGE_ONE, PAGE_TWO]), { fileName: 'mvp.pdf', mimeType: 'application/pdf' });

    expect(result.pageCount).toBe(2);
    expect(result.pages.map((p) => p.pageNumber)).toEqual([1, 2]);
    expect(result.pages[0].text).toContain('immediate 70% refund');
    expect(result.pages[1].text).toContain('Chargeback threats');
    expect(result.totalChars).toBeGreaterThanOrEqual(150);

    const formatted = formatSourcePages(result.pages);
    expect(formatted.startsWith('=== SOURCE PAGE 1 ===\n')).toBe(true);
    expect(formatted).toContain('\n=== SOURCE PAGE 2 ===\n');
    expect(formatted.indexOf('=== SOURCE PAGE 2 ===')).toBeGreaterThan(formatted.indexOf('70% refund'));
  });

  it('formats arbitrary page numbers and selects pages', () => {
    const pages = [
      { pageNumber: 3, text: 'Third page' },
      { pageNumber: 4, text: 'Fourth page' },
      { pageNumber: 7, text: 'Seventh page' },
    ];
    expect(formatSourcePages(pages)).toBe(
      '=== SOURCE PAGE 3 ===\nThird page\n\n=== SOURCE PAGE 4 ===\nFourth page\n\n=== SOURCE PAGE 7 ===\nSeventh page',
    );
    expect(selectPages(pages, [7, 3]).map((p) => p.pageNumber).sort()).toEqual([3, 7]);
  });

  it('normalizes whitespace while keeping lines, bullets and table rows', () => {
    const out = normalizePageText('Refund  policy applies\r\n\r\n\r\n\r\n•   Verify  order\nTier\t\tRefund\nMedical    70%');
    expect(out).toContain('Refund policy applies');
    expect(out).toContain('• Verify order');
    expect(out).toContain('Tier | Refund');
    expect(out).toContain('Medical | 70%');
    expect(out).not.toMatch(/\n{3,}/);
    expect(out).not.toContain('\r');
  });

  it('rejects an image-only scan with fewer than 150 characters', async () => {
    await expectPdfError(extractPlaybookPdf(makePdf([['Scan'], ['']]), { mimeType: 'application/pdf' }), 'SCANNED_IMAGE');
  });

  it('rejects files that are not PDFs', async () => {
    const notPdf = new TextEncoder().encode('Hello, this is plain text and not a Playbook PDF.');
    await expectPdfError(extractPlaybookPdf(notPdf, { fileName: 'notes.txt', mimeType: 'text/plain' }), 'NOT_PDF');
  });

  it('rejects files larger than 20 MB', async () => {
    const big = new Uint8Array(20 * 1024 * 1024 + 1);
    big.set(new TextEncoder().encode('%PDF-1.4'));
    await expectPdfError(extractPlaybookPdf(big, { mimeType: 'application/pdf' }), 'TOO_LARGE');
  });

  it('rejects Playbooks longer than 80 pages', async () => {
    const pages = Array.from({ length: 81 }, (_, i) => [`Page ${i + 1} policy text for the refund ladder and escalation rules.`]);
    await expectPdfError(extractPlaybookPdf(makePdf(pages), { mimeType: 'application/pdf' }), 'TOO_MANY_PAGES');
  });
});
