/** Spreadsheet apps run a cell that starts with one of these as a formula (CSV/formula injection). */
const FORMULA_PREFIX = /^[=+\-@\t\r]/;

/**
 * One CSV cell. Learner-chosen text (for example a display name of `=HYPERLINK(...)`) is neutralised with a
 * leading single quote so Excel, Sheets and Numbers show it as text, then quoted if it holds `"`, `,` or a newline.
 */
export function csvEscape(value: string): string {
  const safe = FORMULA_PREFIX.test(value) ? `'${value}` : value;
  return /[",\n\r]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe;
}
