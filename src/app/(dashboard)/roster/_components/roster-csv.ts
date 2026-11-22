/**
 * Pure CSV helpers for the roster Bulk Import dialog.
 * Columns: displayName,lcNumber,email,role,partnerCohortId,divisionIds[,initialPassword]
 * - With a header row, columns are matched by name (any order; optional columns may be left out).
 * - Blank role → AGENT (lowest permission). Blank divisionIds → the Cohort's default Divisions.
 * - divisionIds are separated by `|` (for example TELEHEALTH|INBOUND).
 */
import { RosterImportRowSchema, type RosterImportRow } from '@/lib/schemas/api';
import type { DivisionId } from '@/lib/schemas/domain';

export const ROSTER_CSV_COLUMNS = ['displayName', 'lcNumber', 'email', 'role', 'partnerCohortId', 'divisionIds'] as const;
const OPTIONAL_COLUMNS = ['initialPassword'] as const;
type Column = (typeof ROSTER_CSV_COLUMNS)[number] | (typeof OPTIONAL_COLUMNS)[number];
const ALL_COLUMNS: readonly Column[] = [...ROSTER_CSV_COLUMNS, ...OPTIONAL_COLUMNS];

/** Role used when the role cell is blank: a plain learner account. */
export const DEFAULT_IMPORT_ROLE = 'AGENT' as const;

/** Downloadable template: header plus two example rows (one LC-number agent, one email agent with blanks). */
export function rosterTemplateCsv(exampleCohortId = 'THS'): string {
  return [
    [...ROSTER_CSV_COLUMNS, 'initialPassword'].join(','),
    `Maria Lopez,LC-1101,,AGENT,${exampleCohortId},TELEHEALTH|INBOUND,`,
    `Jordan Blake,,jordan.blake@example.com,,${exampleCohortId},,`,
  ].join('\r\n') + '\r\n';
}

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

function normalizeHeader(value: string): string {
  return value.replace(/^\uFEFF/, '').trim().toLowerCase().replace(/[\s_-]+/g, '');
}

/** Map a header row to column positions; null when the row is not a header. */
function headerIndex(cells: string[]): Partial<Record<Column, number>> | null {
  if (normalizeHeader(cells[0] ?? '') !== 'displayname' && !cells.some((cell) => normalizeHeader(cell) === 'displayname')) return null;
  const byName = new Map(ALL_COLUMNS.map((column) => [column.toLowerCase(), column]));
  const index: Partial<Record<Column, number>> = {};
  cells.forEach((cell, position) => {
    const column = byName.get(normalizeHeader(cell));
    if (column && index[column] === undefined) index[column] = position;
  });
  return index;
}

const POSITIONAL: Partial<Record<Column, number>> = Object.fromEntries(ALL_COLUMNS.map((column, i) => [column, i]));

export function parseRosterCsv(
  text: string,
  options: { cohortDefaultDivisions?: Readonly<Record<string, readonly DivisionId[]>> } = {},
): ParsedRosterLine[] {
  const records = parseCsv(text.replace(/^\uFEFF/, ''));
  const header = records.length > 0 ? headerIndex(records[0]) : null;
  const columns = header ?? POSITIONAL;
  const body = header ? records.slice(1) : records;
  return body.map((rawCells, index) => {
    const cells = rawCells.map((value) => value.trim());
    const lineNumber = index + (header ? 2 : 1);
    const cell = (column: Column) => {
      const position = columns[column];
      return position === undefined ? '' : (cells[position] ?? '');
    };
    if (header && columns.displayName === undefined) {
      return { lineNumber, cells, row: null, error: 'The header needs a displayName column.' };
    }
    if (!header && cells.length < 5) {
      return { lineNumber, cells, row: null, error: 'Expected at least displayName, lcNumber, email, role and partnerCohortId.' };
    }
    const lcNumber = cell('lcNumber');
    const email = cell('email');
    const role = cell('role');
    const partnerCohortId = cell('partnerCohortId').toUpperCase();
    const initialPassword = cell('initialPassword');
    const divisionIds = cell('divisionIds')
      .split('|')
      .map((value) => value.trim().toUpperCase())
      .filter((value) => value.length > 0);
    const candidate = {
      displayName: cell('displayName'),
      lcNumber: lcNumber ? lcNumber.toUpperCase() : undefined,
      email: email ? email.toLowerCase() : undefined,
      role: role ? role.toUpperCase().replace(/[\s-]+/g, '_') : DEFAULT_IMPORT_ROLE,
      partnerCohortId,
      divisionIds: divisionIds.length > 0 ? divisionIds : [...(options.cohortDefaultDivisions?.[partnerCohortId] ?? [])],
      initialPassword: initialPassword ? initialPassword : undefined,
    };
    const parsed = RosterImportRowSchema.safeParse(candidate);
    if (!parsed.success) {
      const issue = parsed.error.issues[0];
      const field = issue?.path.join('.') || 'row';
      const message =
        field === 'divisionIds' && divisionIds.length === 0
          ? 'divisionIds: leave blank only for an existing Cohort (it uses that Cohort’s default Divisions).'
          : issue
            ? `${field}: ${issue.message}`
            : 'The row is not valid.';
      return { lineNumber, cells, row: null, error: message };
    }
    return { lineNumber, cells, row: parsed.data, error: null };
  });
}
