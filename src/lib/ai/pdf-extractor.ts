/**
 * Playbook PDF text extraction (unpdf) and source-page formatting for the Track build pipeline.
 * No Firebase imports: unit tests import the pure helpers from this file.
 */
import { PDF_LIMITS } from '@/lib/schemas/constants';
import { extractionQualityFlags } from '@/lib/services/source-evidence';

export type PlaybookPdfErrorCode = 'NOT_PDF' | 'TOO_LARGE' | 'TOO_MANY_PAGES' | 'UNREADABLE' | 'SCANNED_IMAGE';

export class PlaybookPdfError extends Error {
  readonly code: PlaybookPdfErrorCode;

  constructor(code: PlaybookPdfErrorCode, message: string) {
    super(message);
    this.name = 'PlaybookPdfError';
    this.code = code;
  }
}

export interface ExtractedPage {
  pageNumber: number;
  text: string;
  /** Unmodified pdf.js page text retained for source evidence and quality detection. */
  rawText?: string;
}

/** Preserve the shared extraction heuristics and fail closed on sparse/caption-only evidence. */
export function sourcePageExtractionFlags(page: Pick<ExtractedPage, 'text' | 'rawText'>): ReturnType<typeof extractionQualityFlags> {
  const rawText = page.rawText ?? page.text;
  const flags = new Set(extractionQualityFlags(rawText));
  const normalizedLength = page.text.replace(/\s+/g, ' ').trim().length;
  const captionOnly = /(?:^|\n)\s*(?:image|figure|screenshot|screen shot)\s*\d*\s*[:.-]/i.test(rawText) && normalizedLength < 1_000;
  if (flags.has('low_text_density') || captionOnly) flags.add('manual_transcription_required');
  return [...flags];
}

export interface ExtractedPlaybook {
  pageCount: number;
  pages: ExtractedPage[];
  totalChars: number;
}

const PDF_MAGIC = [0x25, 0x50, 0x44, 0x46, 0x2d]; // "%PDF-"
const ACCEPTED_MIME_TYPES = new Set(['application/pdf', 'application/x-pdf', 'application/octet-stream', '']);
/** pdf.js may put up to 1 KB of junk before the header. */
const MAGIC_SEARCH_WINDOW = 1024;

function hasPdfMagic(data: Uint8Array): boolean {
  const limit = Math.min(data.length - PDF_MAGIC.length, MAGIC_SEARCH_WINDOW);
  for (let start = 0; start <= limit; start++) {
    let match = true;
    for (let i = 0; i < PDF_MAGIC.length; i++) {
      if (data[start + i] !== PDF_MAGIC[i]) {
        match = false;
        break;
      }
    }
    if (match) return true;
  }
  return false;
}

function formatMegabytes(bytes: number): string {
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

const BULLET_PATTERN = /^\s*(?:[•●▪◦‣∙·○■□➢►*-]|\d{1,3}[.)]|[a-zA-Z][.)])\s+/;
const INLINE_BULLET_SPLIT = /\s+(?=[•●▪◦‣∙○■□➢►]\s)/g;
/** Two or more cells separated by a tab or by 3+ spaces. */
const TABLE_GAP = /\t+| {3,}/;

/**
 * Normalize raw extracted page text: unify line endings, keep bullets on their own lines,
 * turn column gaps into " | " table rows, collapse spaces, and keep at most one blank line in a row.
 */
export function normalizePageText(raw: string): string {
  const unified = raw.replace(/\r\n?/g, '\n').replace(/ /g, ' ').replace(/[\f\v​﻿]/g, '');
  const lines: string[] = [];

  for (const sourceLine of unified.split('\n')) {
    const bulletSplit = sourceLine.replace(INLINE_BULLET_SPLIT, '\n').split('\n');
    for (const part of bulletSplit) {
      const trimmedRight = part.replace(/\s+$/, '');
      const content = trimmedRight.trim();
      if (!content) {
        lines.push('');
        continue;
      }
      const cells = content.split(TABLE_GAP).map((cell) => cell.trim()).filter(Boolean);
      let line: string;
      if (cells.length >= 2 && !BULLET_PATTERN.test(content)) {
        line = cells.map((cell) => cell.replace(/[ \t]+/g, ' ')).join(' | ');
      } else {
        line = content.replace(/[ \t]+/g, ' ');
      }
      const bullet = /^([•●▪◦‣∙·○■□➢►])\s*(.*)$/.exec(line);
      if (bullet) line = `${bullet[1]} ${bullet[2]}`.trimEnd();
      lines.push(line);
    }
  }

  const compact: string[] = [];
  for (const line of lines) {
    if (line === '' && (compact.length === 0 || compact[compact.length - 1] === '')) continue;
    compact.push(line);
  }
  while (compact.length > 0 && compact[compact.length - 1] === '') compact.pop();
  return compact.join('\n');
}

/** "=== SOURCE PAGE N ===\n<text>" blocks joined by one blank line. */
export function formatSourcePages(pages: ExtractedPage[]): string {
  return pages.map((page) => `=== SOURCE PAGE ${page.pageNumber} ===\n${page.text}`).join('\n\n');
}

/** The pages whose numbers are listed, in page order, without duplicates. */
export function selectPages(pages: ExtractedPage[], pageNumbers: number[]): ExtractedPage[] {
  const wanted = new Set(pageNumbers);
  return pages.filter((page) => wanted.has(page.pageNumber)).sort((a, b) => a.pageNumber - b.pageNumber);
}

/** Validate size, type, and magic bytes before parsing. Throws PlaybookPdfError. */
export function assertPdfUpload(data: Uint8Array, opts: { fileName?: string; mimeType?: string } = {}): void {
  const mime = (opts.mimeType ?? '').toLowerCase().split(';')[0].trim();
  const name = opts.fileName ?? 'The file';
  if (!ACCEPTED_MIME_TYPES.has(mime) || !hasPdfMagic(data)) {
    throw new PlaybookPdfError('NOT_PDF', `${name} is not a PDF. Export the Playbook as a PDF file and upload it again.`);
  }
  if (data.byteLength > PDF_LIMITS.maxBytes) {
    throw new PlaybookPdfError(
      'TOO_LARGE',
      `${name} is ${formatMegabytes(data.byteLength)}. The limit is ${formatMegabytes(PDF_LIMITS.maxBytes)}. Compress the PDF or split the Playbook into smaller files.`,
    );
  }
}

function isPasswordError(error: unknown): boolean {
  if (!error || typeof error !== 'object') return false;
  const name = (error as { name?: unknown }).name;
  const message = (error as { message?: unknown }).message;
  return name === 'PasswordException' || (typeof message === 'string' && /password|encrypt/i.test(message));
}

/** Extract normalized per-page text from a Playbook PDF. Throws PlaybookPdfError with a plain-English message. */
export async function extractPlaybookPdf(
  data: Uint8Array,
  opts: { fileName?: string; mimeType?: string } = {},
): Promise<ExtractedPlaybook> {
  assertPdfUpload(data, opts);
  const { extractText, getDocumentProxy } = await import('unpdf');

  // pdf.js can transfer (detach) the buffer it receives, so give it a copy.
  const copy = new Uint8Array(data);
  let document: Awaited<ReturnType<typeof getDocumentProxy>>;
  try {
    document = await getDocumentProxy(copy);
  } catch (error) {
    if (isPasswordError(error)) {
      throw new PlaybookPdfError(
        'UNREADABLE',
        'This PDF is password-protected. Remove the password, save a new copy, and upload it again.',
      );
    }
    throw new PlaybookPdfError(
      'UNREADABLE',
      'This PDF is damaged or cannot be read. Open it, save or export it again as a PDF, and upload the new copy.',
    );
  }

  try {
    const pageCount = document.numPages;
    if (pageCount < 1) {
      throw new PlaybookPdfError('UNREADABLE', 'This PDF has no pages. Upload the complete Playbook.');
    }
    if (pageCount > PDF_LIMITS.maxPages) {
      throw new PlaybookPdfError(
        'TOO_MANY_PAGES',
        `This Playbook has ${pageCount} pages. The limit is ${PDF_LIMITS.maxPages} pages. Split it into smaller Playbooks and make one Track for each part.`,
      );
    }

    let rawPages: string[];
    try {
      const result = await extractText(document, { mergePages: false });
      rawPages = result.text;
    } catch {
      throw new PlaybookPdfError(
        'UNREADABLE',
        'The text in this PDF cannot be read. Open it, save or export it again as a PDF, and upload the new copy.',
      );
    }

    const pages: ExtractedPage[] = rawPages.map((text, index) => ({
      pageNumber: index + 1,
      text: normalizePageText(text),
      rawText: text,
    }));
    const totalChars = pages.reduce((sum, page) => sum + page.text.length, 0);
    if (totalChars < PDF_LIMITS.minExtractedChars) {
      throw new PlaybookPdfError(
        'SCANNED_IMAGE',
        'This PDF has almost no readable text. It is probably a scanned image. Run OCR (text recognition) on the PDF, for example with "Make searchable" in your PDF tool, and upload it again.',
      );
    }
    return { pageCount, pages, totalChars };
  } finally {
    await document.loadingTask.destroy().catch(() => undefined);
  }
}
