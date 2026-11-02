/**
 * Pure CSV helpers for the roster Bulk Import dialog.
 * Columns: displayName,lcNumber,email,role,partnerCohortId,divisionIds[,initialPassword]
 * divisionIds are separated by `|` (for example TELEHEALTH|INBOUND).
 */
import { RosterImportRowSchema, type RosterImportRow } from '@/lib/schemas/api';

export const ROSTER_CSV_COLUMNS = ['displayName', 'lcNumber', 'email', 'role', 'partnerCohortId', 'divisionIds'] as const;

export interface ParsedRosterLine {
  lineNumber: number;
  cells: string[];
  row: RosterImportRow | null;
  error: string | null;
}

/** RFC 4180 style parser (quoted cells, escaped quotes, CRLF). */
export function parseCsv(text: string): string[][] {
  const records: string[][] = [];
  let record: string[] = [];
  let cell = '';
  let inQuotes = false;
  for (let i = 0; i < text.length; i++) {
    const char = text[i];
    if (inQuotes) {
      if (char === '"') {
        if (text[i + 1] === '"') {
          cell += '"';
          i++;
        } else {
          inQuotes = false;
        }
      } else {
        cell += char;
      }
      continue;
    }
    if (char === '"') inQuotes = true;
    else if (char === ',') {
      record.push(cell);
      cell = '';
    } else if (char === '\n' || char === '\r') {
      if (char === '\r' && text[i + 1] === '\n') i++;
      record.push(cell);
      records.push(record);
      record = [];
      cell = '';
    } else cell += char;
  }
  if (cell.length > 0 || record.length > 0) {
    record.push(cell);
    records.push(record);
  }
  return records.filter((cells) => cells.some((value) => value.trim().length > 0));
}

function isHeaderRow(cells: string[]): boolean {
  return (cells[0] ?? '').trim().toLowerCase() === 'displayname';
}

export function parseRosterCsv(text: string): ParsedRosterLine[] {
  const records = parseCsv(text);
  const startsWithHeader = records.length > 0 && isHeaderRow(records[0]);
  const body = startsWithHeader ? records.slice(1) : records;
  return body.map((rawCells, index) => {
    const cells = rawCells.map((value) => value.trim());
    const lineNumber = index + (startsWithHeader ? 2 : 1);
    if (cells.length < ROSTER_CSV_COLUMNS.length) {
      return { lineNumber, cells, row: null, error: `Expected ${ROSTER_CSV_COLUMNS.length} columns, found ${cells.length}.` };
    }
    const [displayName, lcNumber, email, role, partnerCohortId, divisionIds, initialPassword] = cells;
    const candidate = {
      displayName,
      lcNumber: lcNumber ? lcNumber.toUpperCase() : undefined,
      email: email ? email.toLowerCase() : undefined,
      role: role.toUpperCase(),
      partnerCohortId: partnerCohortId.toUpperCase(),
      divisionIds: divisionIds
        .split('|')
        .map((value) => value.trim().toUpperCase())
        .filter((value) => value.length > 0),
      initialPassword: initialPassword ? initialPassword : undefined,
    };
    const parsed = RosterImportRowSchema.safeParse(candidate);
    if (!parsed.success) {
      const issue = parsed.error.issues[0];
      const field = issue?.path.join('.') || 'row';
      return { lineNumber, cells, row: null, error: issue ? `${field}: ${issue.message}` : 'The row is not valid.' };
    }
    return { lineNumber, cells, row: parsed.data, error: null };
  });
}
